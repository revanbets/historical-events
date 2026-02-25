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
        return {"slides": [{"title": e.get("title", ""), "date": e.get("date", ""), "body": e.get("summary", "")} for e in events]}

    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    detail_instructions = {
        "brief": "Keep each slide concise — 1-2 sentences for the body.",
        "standard": "Give moderate detail — 3-5 sentences per slide body.",
        "comprehensive": "Be thorough — provide detailed analysis, 5-8 sentences per slide body.",
    }

    events_text = "\n\n".join([
        f"Event: {e.get('title', 'Untitled')}\nDate: {e.get('date', 'Unknown')}\nSummary: {e.get('summary', '')}\nTopics: {', '.join(e.get('topics', []))}\nPeople: {', '.join(e.get('people', []))}\nOrganizations: {', '.join(e.get('organizations', []))}"
        for e in events
    ])

    focus_text = ""
    if focuses:
        focus_text = f"\n\nFocus areas the user wants emphasized: {', '.join(focuses)}"

    prompt = f"""You are creating slides for a presentation titled "{presentation_name}".
{detail_instructions.get(detail_level, detail_instructions['standard'])}{focus_text}

Create one slide per event. Each slide should have a title, date, and body text written in a clear, presentation-friendly style.

Events to cover:
{events_text}

Respond with a JSON object in this exact format:
{{"slides": [{{"title": "slide title here", "date": "date string here", "body": "slide body text here"}}]}}

Only respond with the JSON — no other text."""

    message = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1])
        if raw.startswith("json"):
            raw = raw[4:].strip()

    return json.loads(raw)


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
