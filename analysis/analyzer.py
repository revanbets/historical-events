"""
Anthropic API integration for document analysis.
Sends extracted text to Claude and gets back structured data.
"""

import json
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

ANALYSIS_PROMPT_LONG = """You are analyzing an uploaded document for a historical events research database focused on controversial, censored, or under-reported topics.
The document's filename is: {file_name}

Analyze the following extracted text and return a JSON object with these fields:

- "summary": A detailed paragraph (or multiple paragraphs) summarizing the document's content, significance, and context. Write this as a full narrative.
- "description": Bullet-point key facts for quick scanning. Use "- " prefix for each bullet. Include 4-8 bullets covering: what happened, who was involved, when, why it matters.
- "topics": An array of topic/category strings (e.g., "Government", "Technology", "CIA", "Cold War"). Extract 3-10 relevant topics. Do NOT include generic terms like "Document", "PDF", "Word", "signed", "recommended".
- "people": An array of full real names of people mentioned. Deduplicate: if someone is referred to by a nickname and a real name, use only the real name. Do NOT include bylines like "By Al Jazeera Staff" or photographer credits.
- "organizations": An array of organization names mentioned (government agencies, companies, NGOs, media outlets, etc.).
- "source": The publisher or outlet that created/published this document (e.g., "Al Jazeera", "New York Times", "CDC", "Wikipedia"). If it's a personal document with no publisher, use "Unknown".
- "primary_source": The ORIGINAL source of the information described. For example, if a news article reports on a politician's statement, the primary source is the politician's statement (e.g., "Trump's Truth Social post, Nov 28 2025"), not the news outlet. If the document IS the primary source, say "This document".
- "main_link": If a URL/link appears in the document text (especially at the beginning), extract it as the canonical link. If no URL found, return "".

Return ONLY valid JSON, no markdown fences, no explanation. Example:
{{"summary": "...", "description": "- Fact 1\\n- Fact 2\\n- Fact 3", "topics": ["..."], "people": ["..."], "organizations": ["..."], "source": "...", "primary_source": "...", "main_link": ""}}

Document text:
{text}"""

ANALYSIS_PROMPT_SHORT = """You are analyzing an uploaded document for a historical events research database.
The document's filename is: {file_name}

Analyze the following extracted text and return a JSON object with these fields:

- "summary": A concise 2-3 sentence summary of the document's content and significance.
- "description": Bullet-point key facts. Use "- " prefix. Include 3-4 bullets maximum.
- "topics": An array of 3-5 topic/category strings. Do NOT include generic terms like "Document", "PDF".
- "people": An array of full real names of people mentioned. Deduplicate names.
- "organizations": An array of organization names mentioned.
- "source": The publisher or outlet (e.g., "Al Jazeera", "CDC"). Use "Unknown" if none.
- "primary_source": The ORIGINAL source of the information. If this IS the primary source, say "This document".
- "main_link": If a URL appears in the text, extract it. Otherwise return "".

Return ONLY valid JSON, no markdown fences, no explanation.

Document text:
{text}"""

CONDENSE_PROMPT = """Condense the following text into 2-3 concise sentences while preserving the most important facts and key details. Return only the condensed text, no explanation.

Text:
{text}"""


def analyze_text(text: str, file_name: str, mode: str = "long", search_focus: str = "") -> dict:
    """Send text to Anthropic API for analysis. Returns structured dict."""
    if not ANTHROPIC_API_KEY:
        return {
            "summary": "[Analysis unavailable — set ANTHROPIC_API_KEY in analysis/.env]",
            "description": "",
            "topics": [],
            "people": [],
            "organizations": [],
            "source": "",
            "primary_source": "",
            "main_link": "",
        }

    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Truncate very long texts to avoid token limits (keep ~50k chars)
    truncated = text[:50000] if len(text) > 50000 else text

    prompt_template = ANALYSIS_PROMPT_SHORT if mode == "short" else ANALYSIS_PROMPT_LONG
    prompt = prompt_template.format(file_name=file_name, text=truncated)

    # Prepend focus instruction if provided
    if search_focus and search_focus.strip():
        prompt = (
            f'IMPORTANT: The user is specifically looking for information about: "{search_focus.strip()}". '
            f'Prioritize finding, highlighting, and expanding on anything related to this in your analysis.\n\n'
        ) + prompt

    message = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()

    # Parse JSON from response (handle potential markdown fences)
    if response_text.startswith("```"):
        lines = response_text.split("\n")
        response_text = "\n".join(lines[1:-1])

    try:
        result = json.loads(response_text)
    except json.JSONDecodeError:
        result = {
            "summary": response_text[:500],
            "description": "",
            "topics": [],
            "people": [],
            "organizations": [],
            "source": "",
            "primary_source": "",
            "main_link": "",
        }

    # Normalize — Claude sometimes returns lists instead of strings
    def _to_str(val):
        if isinstance(val, list):
            return "\n".join(str(v) for v in val)
        return str(val) if val else ""

    return {
        "summary": _to_str(result.get("summary", "")),
        "description": _to_str(result.get("description", "")),
        "topics": result.get("topics", []),
        "people": result.get("people", []),
        "organizations": result.get("organizations", []),
        "source": _to_str(result.get("source", "")),
        "primary_source": _to_str(result.get("primary_source", "")),
        "main_link": _to_str(result.get("main_link", "")),
    }


def condense_text(text: str) -> str:
    """Condense text to 2-3 sentences using AI."""
    if not ANTHROPIC_API_KEY:
        return text[:200] + "..."

    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = CONDENSE_PROMPT.format(text=text[:10000])

    message = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )

    return message.content[0].text.strip()


def generate_presentation_slides(events: list, focuses: list, detail_level: str, presentation_name: str) -> dict:
    """Generate presentation slides from event data using Claude."""
    if not ANTHROPIC_API_KEY:
        return {"slides": [{"layout": "content", "title": e.get("title", ""), "date": e.get("date", ""), "bullets": [e.get("summary", "")[:80]]} for e in events]}

    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    detail_instructions = {
        "brief": "Be concise — 3 bullets max per content slide, each under 7 words.",
        "standard": "Moderate detail — 4-5 bullets per content slide, each 6-8 words.",
        "comprehensive": "Be thorough — 5 bullets per content slide, plus richer key_figures and timeline slides when relevant.",
    }

    events_text = "\n\n".join([
        f"Event {i+1}: {e.get('title', 'Untitled')}\nDate: {e.get('date', 'Unknown')}\nSummary: {e.get('summary', '')}\nTopics: {', '.join(e.get('topics', []))}\nPeople: {', '.join(e.get('people', []))}\nOrganizations: {', '.join(e.get('organizations', []))}"
        for i, e in enumerate(events)
    ])

    focus_text = ""
    if focuses:
        focus_text = f"\n\nUser focus areas to emphasize: {', '.join(focuses)}"

    prompt = f"""You are a professional presentation designer creating slides for a presentation titled "{presentation_name}" about historical events.

{detail_instructions.get(detail_level, detail_instructions['standard'])}{focus_text}

Create a well-structured, visually engaging presentation using VARIED slide layouts. Cover all events provided.

LAYOUT TYPES — choose the best fit for each slide:

1. "title" — Opening slide. Exactly ONE per presentation, always first.
   Format: {{"layout": "title", "title": "main title", "subtitle": "brief context phrase", "date": "era/date"}}

2. "overview" — Summary with bullet points. Use for broad context or multi-event overviews.
   Format: {{"layout": "overview", "title": "...", "date": "...", "bullets": ["point", "point", ...]}}

3. "key_figures" — Person cards. Use ONLY when 2 or more notable people are involved.
   Format: {{"layout": "key_figures", "title": "Key Figures", "cards": [{{"name": "Full Name", "role": "Their role/title", "detail": "One sentence on what they did."}}]}}

4. "timeline" — Horizontal timeline. Use ONLY when there are 3 or more clearly dated events in sequence.
   Format: {{"layout": "timeline", "title": "Timeline", "nodes": [{{"year": "1963", "label": "Short label"}}]}}

5. "content" — Standard event slide. Use for each major event.
   Format: {{"layout": "content", "title": "...", "date": "...", "bullets": ["point", "point", ...]}}

CONTENT RULES:
- Bullets: max 5 per slide — keep each bullet a clear, complete thought; a sentence or two is fine, but avoid dumping a whole paragraph into one bullet
- Timeline nodes: max 5, keep labels short
- Key figures cards: max 3 cards

STRUCTURE — use your judgment, not a formula:
You are NOT required to follow a fixed template. Design the slide sequence the way a human presenter would — based on what best serves the content. Some guidance:
- A title slide is a natural opener but isn't mandatory if the content speaks for itself another way
- You can give a single complex event multiple slides if it deserves that depth
- Use key_figures or timeline only when the data genuinely calls for them, not as a checkbox
- Vary the layout types so consecutive slides don't all look identical
- If given multiple events, find the narrative thread and build around it

Events to cover:
{events_text}

Respond with ONLY valid JSON — no other text:
{{"slides": [
  {{"layout": "title", "title": "...", "subtitle": "...", "date": "..."}},
  {{"layout": "content", "title": "...", "date": "...", "bullets": ["...", "...", "..."]}}
]}}"""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=6000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1])
        if raw.startswith("json"):
            raw = raw[4:].strip()

    result = json.loads(raw)

    # Normalize: if any slide still uses old "body" field, convert to bullets
    for slide in result.get("slides", []):
        if "body" in slide and "bullets" not in slide:
            body = slide.pop("body", "")
            slide["bullets"] = [s.strip() for s in body.split(".") if s.strip()][:5]
        if "layout" not in slide:
            slide["layout"] = "content"

    return result


def analyze_pending():
    """Analyze all pending files in pending_analysis/ and update the database."""
    from database import get_pending_records, update_record

    pending = get_pending_records()
    results = []

    for record in pending:
        text = record["extracted_text"]
        if not text or text.startswith("["):
            update_record(record["id"], status="error", summary="No extractable text")
            continue

        try:
            analysis = analyze_text(text, record["file_name"])
            updated = update_record(
                record["id"],
                status="analyzed",
                summary=analysis["summary"],
                topics=analysis["topics"],
                people=analysis["people"],
                organizations=analysis["organizations"],
            )
            results.append(updated)
        except Exception as e:
            update_record(record["id"], status="error", summary=f"Analysis failed: {e}")

    return results


if __name__ == "__main__":
    # CLI usage: python analyzer.py
    results = analyze_pending()
    print(f"Analyzed {len(results)} document(s)")
    for r in results:
        print(f"  - {r['file_name']}: {r['summary'][:80]}...")
