"""
Web scraping module for non-video URLs.
Extracts article text, title, and metadata from web pages.
"""

import re


def scrape_url(url):
    """
    Extract text content from a web URL.
    Uses trafilatura for clean article extraction,
    falls back to beautifulsoup for structured scraping.

    Returns dict with: title, text, url, source_domain
    """
    from urllib.parse import urlparse

    domain = urlparse(url).hostname or ""
    # Strip www. prefix
    if domain.startswith("www."):
        domain = domain[4:]

    # Try trafilatura first (best for articles)
    result = _scrape_trafilatura(url)
    if result and result.get("text") and len(result["text"]) > 100:
        result["source_domain"] = domain
        return result

    # Fallback to beautifulsoup
    result = _scrape_beautifulsoup(url)
    result["source_domain"] = domain
    return result


def _scrape_trafilatura(url):
    """Extract article content using trafilatura."""
    try:
        import trafilatura

        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return None

        text = trafilatura.extract(
            downloaded,
            include_comments=False,
            include_tables=True,
            include_links=True,
        )

        # Get metadata
        metadata = trafilatura.extract_metadata(downloaded)
        title = ""
        if metadata:
            title = metadata.title or ""

        if not text:
            return None

        return {
            "title": title,
            "text": text,
            "url": url,
        }
    except Exception as e:
        print(f"Trafilatura extraction failed: {e}")
        return None


def _scrape_beautifulsoup(url):
    """Fallback scraper using requests + BeautifulSoup."""
    try:
        import requests
        from bs4 import BeautifulSoup

        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/120.0.0.0 Safari/537.36"
        }

        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove scripts, styles, navs
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()

        title = ""
        if soup.find("title"):
            title = soup.find("title").get_text(strip=True)

        # Get main content
        paragraphs = [p.get_text(strip=True) for p in soup.find_all("p") if len(p.get_text(strip=True)) > 20]
        text = "\n\n".join(paragraphs)

        return {
            "title": title,
            "text": text or "[Could not extract text content from this page]",
            "url": url,
        }
    except Exception as e:
        return {
            "title": "",
            "text": f"[Scraping failed: {e}]",
            "url": url,
        }
