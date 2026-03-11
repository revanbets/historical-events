"""
Source Finder pipeline.
Extracts claims from event content using Claude, searches the web for sources
using Google Custom Search + Brave Search, scrapes pages with Firecrawl,
analyzes results, and saves everything to Supabase.
"""

import json
import os
import re
import time
import uuid
import traceback
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GOOGLE_CSE_KEY = os.getenv("GOOGLE_CSE_KEY", "")
GOOGLE_CSE_ID = os.getenv("GOOGLE_CSE_ID", "")
BRAVE_SEARCH_KEY = os.getenv("BRAVE_SEARCH_KEY", "")
FIRECRAWL_KEY = os.getenv("FIRECRAWL_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://dfkxdbkjrfarjudlpqbw.supabase.co")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# ─── Supabase helpers ────────────────────────────────────────────────────────

def _sb_headers():
    """Standard Supabase REST headers using the service role key."""
    key = SUPABASE_SERVICE_KEY or os.getenv("SUPABASE_ANON_KEY", "")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _sb_url(table: str) -> str:
    return f"{SUPABASE_URL}/rest/v1/{table}"


def sb_insert(table: str, row: dict) -> dict:
    """Insert a row and return the inserted record."""
    resp = httpx.post(_sb_url(table), headers=_sb_headers(), json=row, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    return data[0] if isinstance(data, list) else data


def sb_update(table: str, match: dict, updates: dict) -> dict | None:
    """Update rows matching filter and return the first updated record."""
    params = {f"{k}": f"eq.{v}" for k, v in match.items()}
    resp = httpx.patch(_sb_url(table), headers=_sb_headers(), params=params, json=updates, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    return data[0] if data else None


def sb_select(table: str, match: dict | None = None, order: str | None = None) -> list:
    """Select rows with optional filters and ordering."""
    params = {}
    if match:
        for k, v in match.items():
            params[k] = f"eq.{v}"
    if order:
        params["order"] = order
    resp = httpx.get(_sb_url(table), headers=_sb_headers(), params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def sb_get_event(event_id: str) -> dict | None:
    """Fetch a single event from Supabase."""
    rows = sb_select("events", {"id": event_id})
    return rows[0] if rows else None


# ─── In-memory search state (for cancel tracking) ───────────────────────────

_active_searches: dict = {}  # search_id -> {"cancel": False}


def cancel_search(search_id: str):
    """Signal a running search to stop."""
    if search_id in _active_searches:
        _active_searches[search_id]["cancel"] = True


def _is_cancelled(search_id: str) -> bool:
    state = _active_searches.get(search_id)
    return state["cancel"] if state else False


# ─── Claude: Extract claims ─────────────────────────────────────────────────

CLAIM_EXTRACTION_PROMPT = """You are a research assistant analyzing content to identify specific factual claims, assertions, and references that can be verified with external sources.

Content to analyze:
---
{content}
---

Extract every verifiable claim, assertion, fact, statistic, quote, or reference to external documents/events/studies. For each claim:
1. State the claim clearly and specifically
2. If this is from a video/audio with timestamps, include the approximate timestamp
3. If this is from text, include which section/paragraph it came from

Return a JSON array of claims. Each claim object has:
- "claim_text": The specific claim stated clearly (string)
- "timestamp_start": Start time in seconds if video/audio, null otherwise (float or null)
- "timestamp_end": End time in seconds if video/audio, null otherwise (float or null)
- "section_index": Paragraph/section number for text content, null for video (int or null)
- "section_text": The original text snippet containing this claim (string, max ~200 chars)

Focus on claims that are:
- References to specific documents, studies, reports, laws, or court cases
- Statistics, numbers, dates, or quantitative assertions
- Quotes attributed to specific people
- Assertions about what organizations or governments did
- Historical claims about events
- References to other media (books, articles, interviews)

Do NOT include:
- Opinions or subjective interpretations (unless attributed to a named source)
- Vague generalities without specifics
- Rhetorical questions

Return ONLY valid JSON array, no markdown fences, no explanation.
Example: [{{"claim_text": "The CIA's MKUltra program ran from 1953 to 1973", "timestamp_start": 45.0, "timestamp_end": 52.0, "section_index": null, "section_text": "...the CIA ran its infamous MKUltra program from 1953..."}}]
"""


def extract_claims(content: str, is_video: bool = False) -> list[dict]:
    """Use Claude to extract verifiable claims from content."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Truncate to ~80k chars to stay within token limits
    truncated = content[:80000]

    prompt = CLAIM_EXTRACTION_PROMPT.format(content=truncated)

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1])

    try:
        claims = json.loads(raw)
        if not isinstance(claims, list):
            claims = [claims]
    except json.JSONDecodeError:
        print(f"[source_finder] Failed to parse claims JSON: {raw[:200]}")
        claims = []

    return claims


# ─── Content chunking for long videos ───────────────────────────────────────

def chunk_content(content: str, is_video: bool = False, chunk_minutes: int = 30) -> list[dict]:
    """
    Split long content into chunks for processing.
    For video transcripts: split by timestamp into ~30-min segments.
    For text: split into ~5000-word chunks.
    Returns list of {"text": ..., "offset_seconds": ...}
    """
    if is_video:
        # Try to find timestamp patterns like [00:30:00] or (30:00) or 00:30:00
        # If timestamps exist, chunk by them; otherwise chunk by word count
        timestamp_pattern = r'\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?'
        matches = list(re.finditer(timestamp_pattern, content))

        if matches and len(matches) > 5:
            chunk_seconds = chunk_minutes * 60
            chunks = []
            current_chunk_start = 0
            current_chunk_text_start = 0

            for match in matches:
                h_or_m = int(match.group(1))
                m_or_s = int(match.group(2))
                s = int(match.group(3)) if match.group(3) else 0

                # Determine if format is H:MM:SS or MM:SS
                if match.group(3) is not None:
                    total_seconds = h_or_m * 3600 + m_or_s * 60 + s
                else:
                    total_seconds = h_or_m * 60 + m_or_s

                if total_seconds - current_chunk_start >= chunk_seconds:
                    chunk_text = content[current_chunk_text_start:match.start()]
                    if chunk_text.strip():
                        chunks.append({
                            "text": chunk_text.strip(),
                            "offset_seconds": current_chunk_start,
                        })
                    current_chunk_start = total_seconds
                    current_chunk_text_start = match.start()

            # Add final chunk
            remaining = content[current_chunk_text_start:].strip()
            if remaining:
                chunks.append({
                    "text": remaining,
                    "offset_seconds": current_chunk_start,
                })

            if chunks:
                return chunks

    # Fallback: chunk by word count (~5000 words per chunk)
    words = content.split()
    chunk_size = 5000
    chunks = []
    for i in range(0, len(words), chunk_size):
        chunk_text = " ".join(words[i:i + chunk_size])
        chunks.append({
            "text": chunk_text,
            "offset_seconds": 0,
        })

    return chunks if chunks else [{"text": content, "offset_seconds": 0}]


# ─── Web search: Google Custom Search ───────────────────────────────────────

def search_google(query: str, num_results: int = 5) -> list[dict]:
    """Search using Google Custom Search API. Returns list of {url, title, snippet}."""
    if not GOOGLE_CSE_KEY or not GOOGLE_CSE_ID:
        return []

    try:
        resp = httpx.get(
            "https://www.googleapis.com/customsearch/v1",
            params={
                "key": GOOGLE_CSE_KEY,
                "cx": GOOGLE_CSE_ID,
                "q": query,
                "num": min(num_results, 10),
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        results = []
        for item in data.get("items", []):
            results.append({
                "url": item.get("link", ""),
                "title": item.get("title", ""),
                "snippet": item.get("snippet", ""),
                "source": "google",
            })
        return results
    except Exception as e:
        print(f"[source_finder] Google search error: {e}")
        return []


# ─── Web search: Brave Search ───────────────────────────────────────────────

def search_brave(query: str, num_results: int = 5) -> list[dict]:
    """Search using Brave Search API. Returns list of {url, title, snippet}."""
    if not BRAVE_SEARCH_KEY:
        return []

    try:
        resp = httpx.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={"X-Subscription-Token": BRAVE_SEARCH_KEY, "Accept": "application/json"},
            params={"q": query, "count": min(num_results, 20)},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        results = []
        for item in data.get("web", {}).get("results", []):
            results.append({
                "url": item.get("url", ""),
                "title": item.get("title", ""),
                "snippet": item.get("description", ""),
                "source": "brave",
            })
        return results
    except Exception as e:
        print(f"[source_finder] Brave search error: {e}")
        return []


def search_web(query: str, num_results: int = 5) -> list[dict]:
    """Search using all available search APIs, deduplicate by URL."""
    results = []

    google_results = search_google(query, num_results)
    brave_results = search_brave(query, num_results)

    results.extend(google_results)
    results.extend(brave_results)

    # Deduplicate by URL
    seen_urls = set()
    deduped = []
    for r in results:
        url = r["url"].rstrip("/").lower()
        if url not in seen_urls:
            seen_urls.add(url)
            deduped.append(r)

    return deduped[:num_results * 2]  # Return up to 2x num_results (from both engines)


# ─── Web scraping: Firecrawl ────────────────────────────────────────────────

def scrape_page(url: str) -> dict | None:
    """Scrape a page with Firecrawl to get clean markdown/text content."""
    if not FIRECRAWL_KEY:
        # Fallback to basic scraping if no Firecrawl key
        return _scrape_basic(url)

    try:
        resp = httpx.post(
            "https://api.firecrawl.dev/v1/scrape",
            headers={
                "Authorization": f"Bearer {FIRECRAWL_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "url": url,
                "formats": ["markdown"],
                "onlyMainContent": True,
                "timeout": 15000,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        if not data.get("success"):
            return _scrape_basic(url)

        page_data = data.get("data", {})
        return {
            "url": url,
            "title": page_data.get("metadata", {}).get("title", ""),
            "content": page_data.get("markdown", "") or page_data.get("content", ""),
        }
    except Exception as e:
        print(f"[source_finder] Firecrawl scrape error for {url}: {e}")
        return _scrape_basic(url)


def _scrape_basic(url: str) -> dict | None:
    """Basic fallback scraper using requests + BeautifulSoup."""
    try:
        resp = httpx.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36"
            },
            timeout=15,
            follow_redirects=True,
        )
        resp.raise_for_status()

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(resp.text, "html.parser")

        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()

        title = soup.find("title").get_text(strip=True) if soup.find("title") else ""
        paragraphs = [p.get_text(strip=True) for p in soup.find_all("p") if len(p.get_text(strip=True)) > 20]
        text = "\n\n".join(paragraphs)

        return {"url": url, "title": title, "content": text} if text else None
    except Exception as e:
        print(f"[source_finder] Basic scrape error for {url}: {e}")
        return None


# ─── Claude: Analyze source page against claim ──────────────────────────────

ANALYZE_SOURCE_PROMPT = """You are a research verification assistant. Analyze whether this source page supports, contradicts, or is relevant to the given claim.

CLAIM: {claim}

SOURCE PAGE CONTENT (from {url}):
---
{page_content}
---

Analyze this source and return a JSON object:
- "relevant": true/false — Is this page relevant to the claim?
- "summary": A 1-3 sentence summary of what this source says about the claim (string)
- "source_type": One of: "government_doc", "news", "academic", "court_record", "book", "interview", "archive", "social_media", "wiki", "other"
- "key_quotes": Array of 1-3 direct quotes from the source that are most relevant to the claim (array of strings). Extract exact text. If no good quotes, return empty array.
- "is_primary": true if this is a primary/original source (the actual document, study, speech, etc.), false if it's a secondary source reporting on it

Return ONLY valid JSON, no markdown fences.
"""


def analyze_source_page(claim_text: str, url: str, page_content: str) -> dict | None:
    """Use Claude to analyze whether a scraped page supports a claim."""
    if not ANTHROPIC_API_KEY:
        return None

    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Truncate page content to ~15k chars
    truncated_content = page_content[:15000]

    prompt = ANALYZE_SOURCE_PROMPT.format(
        claim=claim_text,
        url=url,
        page_content=truncated_content,
    )

    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(lines[1:-1])

        result = json.loads(raw)
        return result
    except Exception as e:
        print(f"[source_finder] Source analysis error: {e}")
        return None


# ─── Claude: Generate search queries for a claim ────────────────────────────

SEARCH_QUERY_PROMPT = """Generate {num_queries} different web search queries to find the original source or supporting evidence for this claim. Each query should approach the search from a different angle.

CLAIM: {claim}

Return a JSON array of search query strings. Aim for specificity — include names, dates, document titles, or organizations mentioned in the claim.
Return ONLY the JSON array, no markdown fences.
Example: ["CIA MKUltra program declassified documents 1977", "Senate hearing MKUltra testimony Frank Church committee"]
"""


def generate_search_queries(claim_text: str, num_queries: int = 2, user_context: str = "") -> list[str]:
    """Use Claude to generate optimized search queries for a claim."""
    if not ANTHROPIC_API_KEY:
        # Fallback: just use the claim text as-is
        return [claim_text[:200]]

    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    prompt = SEARCH_QUERY_PROMPT.format(claim=claim_text, num_queries=num_queries)
    if user_context:
        prompt += f"\n\nAdditional context from the user to guide the search: {user_context}"

    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(lines[1:-1])

        queries = json.loads(raw)
        if isinstance(queries, list):
            return [str(q) for q in queries[:num_queries]]
    except Exception as e:
        print(f"[source_finder] Query generation error: {e}")

    return [claim_text[:200]]


# ─── Depth tier configuration ───────────────────────────────────────────────

DEPTH_CONFIG = {
    "scan": {
        "queries_per_claim": 1,
        "results_per_query": 3,
        "scrape_top_n": 3,
        "follow_links": False,
        "check_archives": False,
    },
    "investigate": {
        "queries_per_claim": 3,
        "results_per_query": 5,
        "scrape_top_n": 5,
        "follow_links": False,
        "check_archives": False,
    },
    "deep_dive": {
        "queries_per_claim": 5,
        "results_per_query": 10,
        "scrape_top_n": 8,
        "follow_links": True,
        "check_archives": True,
    },
}


# ─── Process a single claim ─────────────────────────────────────────────────

def process_claim(
    claim_id: str,
    claim_text: str,
    event_id: str,
    user_id: str,
    depth_tier: str,
    search_id: str,
    user_context: str = "",
) -> list[dict]:
    """
    Search the web for sources supporting a single claim.
    Returns list of source_results dicts that were saved.
    """
    config = DEPTH_CONFIG.get(depth_tier, DEPTH_CONFIG["scan"])

    # Check for cancellation
    if _is_cancelled(search_id):
        return []

    # Mark claim as searching
    sb_update("source_claims", {"id": claim_id}, {"status": "searching"})

    # Step 1: Generate search queries
    queries = generate_search_queries(
        claim_text,
        num_queries=config["queries_per_claim"],
        user_context=user_context,
    )

    # Step 2: Search the web with each query
    all_search_results = []
    seen_urls = set()
    for query in queries:
        if _is_cancelled(search_id):
            break
        results = search_web(query, num_results=config["results_per_query"])
        for r in results:
            url_key = r["url"].rstrip("/").lower()
            if url_key not in seen_urls:
                seen_urls.add(url_key)
                all_search_results.append(r)

    # Step 3: Scrape top results
    scraped_pages = []
    for result in all_search_results[:config["scrape_top_n"]]:
        if _is_cancelled(search_id):
            break
        page = scrape_page(result["url"])
        if page and page.get("content") and len(page["content"]) > 50:
            page["search_title"] = result.get("title", "")
            page["search_snippet"] = result.get("snippet", "")
            scraped_pages.append(page)

    # Step 4: Analyze each scraped page against the claim
    saved_results = []
    for page in scraped_pages:
        if _is_cancelled(search_id):
            break

        analysis = analyze_source_page(claim_text, page["url"], page["content"])
        if not analysis or not analysis.get("relevant", False):
            continue

        # Save to Supabase
        source_row = {
            "id": str(uuid.uuid4()),
            "claim_id": claim_id,
            "event_id": event_id,
            "user_id": user_id,
            "url": page["url"],
            "title": page.get("search_title") or page.get("title", ""),
            "summary": analysis.get("summary", ""),
            "source_type": analysis.get("source_type", "other"),
            "key_quotes": json.dumps(analysis.get("key_quotes", [])),
            "is_primary": analysis.get("is_primary", False),
            "found_by_ai": True,
        }

        try:
            saved = sb_insert("source_results", source_row)
            saved_results.append(saved)
        except Exception as e:
            print(f"[source_finder] Failed to save source result: {e}")

    # Step 5: Deep Dive extras — follow links from found sources
    if config["follow_links"] and saved_results and not _is_cancelled(search_id):
        _follow_source_links(claim_id, claim_text, event_id, user_id, search_id, saved_results)

    # Update claim status
    status = "found" if saved_results else "not_found"
    update_data = {"status": status}

    # If not found, generate suggested search terms
    if not saved_results:
        fallback_terms = queries[:3] if queries else [claim_text[:100]]
        update_data["search_terms"] = fallback_terms

    sb_update("source_claims", {"id": claim_id}, update_data)

    return saved_results


def _follow_source_links(claim_id, claim_text, event_id, user_id, search_id, existing_results):
    """Deep Dive: follow links found in source pages to trace primary sources."""
    # Extract URLs mentioned in source summaries/quotes that might be primary sources
    existing_urls = {r.get("url", "").rstrip("/").lower() for r in existing_results}

    for result in existing_results[:3]:  # Only follow links from top 3 results
        if _is_cancelled(search_id):
            break

        # Re-scrape to find links within the page
        page = scrape_page(result.get("url", ""))
        if not page or not page.get("content"):
            continue

        # Find URLs in the page content that look like primary sources
        url_pattern = r'https?://[^\s\]\)\>\"\']{10,200}'
        found_urls = re.findall(url_pattern, page["content"])

        # Filter to likely primary source domains
        primary_domains = [
            "gov", ".edu", "archives.org", "congress.gov", "whitehouse.gov",
            "judiciary", "courtlistener", "jstor", "pubmed", "ncbi.nlm.nih",
            "doi.org", "arxiv.org", "ssrn.com",
        ]

        for found_url in found_urls[:5]:
            if _is_cancelled(search_id):
                break
            url_lower = found_url.rstrip("/").lower()
            if url_lower in existing_urls:
                continue
            if not any(d in url_lower for d in primary_domains):
                continue

            existing_urls.add(url_lower)
            linked_page = scrape_page(found_url)
            if not linked_page or not linked_page.get("content"):
                continue

            analysis = analyze_source_page(claim_text, found_url, linked_page["content"])
            if not analysis or not analysis.get("relevant", False):
                continue

            source_row = {
                "id": str(uuid.uuid4()),
                "claim_id": claim_id,
                "event_id": event_id,
                "user_id": user_id,
                "url": found_url,
                "title": linked_page.get("title", ""),
                "summary": analysis.get("summary", ""),
                "source_type": analysis.get("source_type", "other"),
                "key_quotes": json.dumps(analysis.get("key_quotes", [])),
                "is_primary": analysis.get("is_primary", False),
                "found_by_ai": True,
            }

            try:
                sb_insert("source_results", source_row)
            except Exception as e:
                print(f"[source_finder] Failed to save followed link result: {e}")


# ─── Main pipeline ──────────────────────────────────────────────────────────

def run_source_search(event_id: str, user_id: str, depth_tier: str, search_id: str):
    """
    Main pipeline: runs as a background task.
    1. Fetch event content from Supabase
    2. Chunk long content if needed
    3. Extract claims using Claude
    4. Search + scrape + analyze for each claim
    5. Save results to Supabase
    6. Update search status
    """
    _active_searches[search_id] = {"cancel": False}

    try:
        # Fetch event from Supabase
        event = sb_get_event(event_id)
        if not event:
            sb_update("source_searches", {"id": search_id}, {
                "status": "failed",
                "error_message": "Event not found",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
            return

        # Build content to analyze
        content_parts = []
        is_video = event.get("is_video", False)

        if event.get("title"):
            content_parts.append(f"Title: {event['title']}")
        if event.get("description"):
            content_parts.append(f"Description: {event['description']}")
        if event.get("ai_summary"):
            content_parts.append(f"AI Summary: {event['ai_summary']}")

        # For video events, try to get the transcript
        transcript_file = event.get("transcript_file", "")
        transcription_data = event.get("transcription")

        if transcription_data and isinstance(transcription_data, list):
            # Transcription is stored as JSON array of segments
            transcript_text = "\n".join(
                f"[{seg.get('start', 0):.0f}s] {seg.get('text', '')}"
                for seg in transcription_data
                if seg.get("text")
            )
            if transcript_text:
                content_parts.append(f"Transcript:\n{transcript_text}")
                is_video = True
        elif transcription_data and isinstance(transcription_data, str):
            content_parts.append(f"Transcript:\n{transcription_data}")
            is_video = True

        content = "\n\n".join(content_parts)

        if not content or len(content.strip()) < 30:
            sb_update("source_searches", {"id": search_id}, {
                "status": "failed",
                "error_message": "Not enough content to analyze",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
            return

        # Chunk content if long
        if len(content) > 30000:
            chunks = chunk_content(content, is_video=is_video)
        else:
            chunks = [{"text": content, "offset_seconds": 0}]

        # Extract claims from all chunks
        all_claims = []
        for chunk in chunks:
            if _is_cancelled(search_id):
                break
            chunk_claims = extract_claims(chunk["text"], is_video=is_video)
            # Adjust timestamps for chunked video content
            offset = chunk.get("offset_seconds", 0)
            for claim in chunk_claims:
                if offset > 0 and claim.get("timestamp_start") is not None:
                    claim["timestamp_start"] = (claim["timestamp_start"] or 0) + offset
                    if claim.get("timestamp_end") is not None:
                        claim["timestamp_end"] = (claim["timestamp_end"] or 0) + offset
            all_claims.extend(chunk_claims)

        if not all_claims:
            sb_update("source_searches", {"id": search_id}, {
                "status": "completed",
                "total_claims": 0,
                "sourced_claims": 0,
                "progress": 100,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
            return

        # Update total claims count
        sb_update("source_searches", {"id": search_id}, {
            "total_claims": len(all_claims),
            "estimated_time": _estimate_time(len(all_claims), depth_tier),
        })

        # Save claims to Supabase
        claim_rows = []
        for idx, claim in enumerate(all_claims):
            claim_row = {
                "id": str(uuid.uuid4()),
                "search_id": search_id,
                "event_id": event_id,
                "claim_text": claim.get("claim_text", ""),
                "timestamp_start": claim.get("timestamp_start"),
                "timestamp_end": claim.get("timestamp_end"),
                "section_index": claim.get("section_index"),
                "section_text": (claim.get("section_text") or "")[:500],
                "order_index": idx,
                "status": "pending",
            }
            try:
                saved = sb_insert("source_claims", claim_row)
                claim_rows.append(saved)
            except Exception as e:
                print(f"[source_finder] Failed to save claim: {e}")

        # Process each claim
        sourced_count = 0
        for idx, claim_row in enumerate(claim_rows):
            if _is_cancelled(search_id):
                break

            results = process_claim(
                claim_id=claim_row["id"],
                claim_text=claim_row["claim_text"],
                event_id=event_id,
                user_id=user_id,
                depth_tier=depth_tier,
                search_id=search_id,
            )

            if results:
                sourced_count += 1

            # Update progress
            progress = int(((idx + 1) / len(claim_rows)) * 100)
            remaining_claims = len(claim_rows) - (idx + 1)
            est_per_claim = _seconds_per_claim(depth_tier)
            sb_update("source_searches", {"id": search_id}, {
                "progress": progress,
                "sourced_claims": sourced_count,
                "estimated_time": remaining_claims * est_per_claim,
            })

        # Final status
        final_status = "cancelled" if _is_cancelled(search_id) else "completed"
        sb_update("source_searches", {"id": search_id}, {
            "status": final_status,
            "progress": 100,
            "sourced_claims": sourced_count,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })

    except Exception as e:
        print(f"[source_finder] Pipeline error: {traceback.format_exc()}")
        try:
            sb_update("source_searches", {"id": search_id}, {
                "status": "failed",
                "error_message": str(e)[:500],
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
    finally:
        _active_searches.pop(search_id, None)


def _estimate_time(num_claims: int, depth_tier: str) -> int:
    """Estimate total seconds for a search."""
    return num_claims * _seconds_per_claim(depth_tier)


def _seconds_per_claim(depth_tier: str) -> int:
    """Estimated seconds per claim for each depth tier."""
    return {"scan": 15, "investigate": 40, "deep_dive": 90}.get(depth_tier, 20)


# ─── Re-search a single claim ───────────────────────────────────────────────

def research_single_claim(
    claim_id: str,
    user_id: str,
    user_context: str = "",
    auto_deep_dive: bool = False,
) -> list[dict]:
    """
    Re-search a specific claim, optionally with user-provided context or auto deep-dive.
    Returns list of new source results.
    """
    # Fetch the claim
    claims = sb_select("source_claims", {"id": claim_id})
    if not claims:
        raise ValueError("Claim not found")
    claim = claims[0]

    depth_tier = "deep_dive" if auto_deep_dive else "investigate"

    # Create a temporary search_id for cancel tracking
    temp_search_id = str(uuid.uuid4())
    _active_searches[temp_search_id] = {"cancel": False}

    try:
        results = process_claim(
            claim_id=claim_id,
            claim_text=claim["claim_text"],
            event_id=claim["event_id"],
            user_id=user_id,
            depth_tier=depth_tier,
            search_id=temp_search_id,
            user_context=user_context,
        )
        return results
    finally:
        _active_searches.pop(temp_search_id, None)


# ─── Get all source data for an event ────────────────────────────────────────

def get_event_sources(event_id: str) -> dict:
    """
    Get all source data for an event: searches, claims, results, annotations.
    Returns a structured dict ready for the frontend.
    """
    searches = sb_select("source_searches", {"event_id": event_id}, order="created_at.desc")
    claims = sb_select("source_claims", {"event_id": event_id}, order="order_index.asc")
    results = sb_select("source_results", {"event_id": event_id}, order="created_at.asc")
    annotations = []

    # Fetch annotations for all claims
    claim_ids = [c["id"] for c in claims]
    for cid in claim_ids:
        anns = sb_select("source_annotations", {"claim_id": cid}, order="created_at.asc")
        annotations.extend(anns)

    # Build claim -> results mapping
    results_by_claim = {}
    for r in results:
        cid = r.get("claim_id")
        if cid not in results_by_claim:
            results_by_claim[cid] = []
        results_by_claim[cid].append(r)

    # Build claim -> annotations mapping
    annotations_by_claim = {}
    for a in annotations:
        cid = a.get("claim_id")
        if cid not in annotations_by_claim:
            annotations_by_claim[cid] = []
        annotations_by_claim[cid].append(a)

    # Enrich claims with their results and annotations
    enriched_claims = []
    for claim in claims:
        claim["results"] = results_by_claim.get(claim["id"], [])
        claim["annotations"] = annotations_by_claim.get(claim["id"], [])
        enriched_claims.append(claim)

    total_sources = len(results)
    total_claims = len(claims)
    sourced_claims = sum(1 for c in claims if c.get("status") == "found")

    return {
        "searches": searches,
        "claims": enriched_claims,
        "total_sources": total_sources,
        "total_claims": total_claims,
        "sourced_claims": sourced_claims,
        "latest_search": searches[0] if searches else None,
    }


# ─── Add manual source ──────────────────────────────────────────────────────

def add_manual_source(event_id: str, user_id: str, url: str, title: str = "", notes: str = "", claim_id: str | None = None) -> dict:
    """Add a manually found source to an event."""
    row = {
        "id": str(uuid.uuid4()),
        "event_id": event_id,
        "user_id": user_id,
        "url": url,
        "title": title,
        "summary": notes,
        "source_type": "other",
        "key_quotes": "[]",
        "is_primary": False,
        "found_by_ai": False,
        "manual_notes": notes,
    }
    if claim_id:
        row["claim_id"] = claim_id
    else:
        # If no claim_id specified, attach to the first claim for this event (or create a placeholder)
        claims = sb_select("source_claims", {"event_id": event_id}, order="order_index.asc")
        if claims:
            row["claim_id"] = claims[0]["id"]
        else:
            # No claims exist — we need to create a placeholder claim
            # Find or create a search record first
            searches = sb_select("source_searches", {"event_id": event_id}, order="created_at.desc")
            if searches:
                search_id = searches[0]["id"]
            else:
                search_row = sb_insert("source_searches", {
                    "id": str(uuid.uuid4()),
                    "event_id": event_id,
                    "user_id": user_id,
                    "depth_tier": "scan",
                    "status": "completed",
                    "total_claims": 1,
                    "sourced_claims": 1,
                    "progress": 100,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                })
                search_id = search_row["id"]

            placeholder_claim = sb_insert("source_claims", {
                "id": str(uuid.uuid4()),
                "search_id": search_id,
                "event_id": event_id,
                "claim_text": "Manually added source",
                "order_index": 0,
                "status": "found",
            })
            row["claim_id"] = placeholder_claim["id"]

    return sb_insert("source_results", row)


# ─── Add annotation ─────────────────────────────────────────────────────────

def add_annotation(claim_id: str, user_id: str, note_text: str) -> dict:
    """Add a user annotation to a claim."""
    row = {
        "id": str(uuid.uuid4()),
        "claim_id": claim_id,
        "user_id": user_id,
        "note_text": note_text,
    }
    return sb_insert("source_annotations", row)
