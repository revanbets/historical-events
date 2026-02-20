"""
Anthropic API integration for document analysis.
Sends extracted text to Claude and gets back structured data.
"""

import json
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

ANALYSIS_PROMPT = """You are analyzing an uploaded document for a historical events research database.
The document's filename is: {file_name}

Analyze the following extracted text and return a JSON object with these fields:
- "summary": A concise 2-4 sentence summary of the document's content and significance.
- "topics": An array of topic/category strings (e.g., "Government", "Technology", "CIA", "Cold War"). Extract 3-10 relevant topics.
- "people": An array of full names of people mentioned in the document. Only include names that appear to be real people.
- "organizations": An array of organization names mentioned (government agencies, companies, NGOs, etc.).

Return ONLY valid JSON, no markdown fences, no explanation. Example:
{{"summary": "...", "topics": ["..."], "people": ["..."], "organizations": ["..."]}}

Document text:
{text}"""


def analyze_text(text: str, file_name: str) -> dict:
    """Send text to Anthropic API for analysis. Returns structured dict."""
    if not ANTHROPIC_API_KEY:
        return {
            "summary": "[Analysis unavailable — set ANTHROPIC_API_KEY in analysis/.env]",
            "topics": [],
            "people": [],
            "organizations": [],
        }

    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Truncate very long texts to avoid token limits (keep ~50k chars)
    truncated = text[:50000] if len(text) > 50000 else text

    prompt = ANALYSIS_PROMPT.format(file_name=file_name, text=truncated)

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
            "topics": [],
            "people": [],
            "organizations": [],
        }

    return {
        "summary": result.get("summary", ""),
        "topics": result.get("topics", []),
        "people": result.get("people", []),
        "organizations": result.get("organizations", []),
    }


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
