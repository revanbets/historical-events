"""
Web scraping module for non-video URLs.
Extracts article text, title, and metadata from web pages.
Includes special handling for social media platforms.
"""

import re


def scrape_url(url):
    """
    Extract text content from a web URL.
    For social media posts, tries yt-dlp metadata extraction first.
    Uses trafilatura for clean article extraction,
    falls back to beautifulsoup for structured scraping.

    Returns dict with: title, text, url, source_domain
    """
    from urllib.parse import urlparse

    domain = urlparse(url).hostname or ""
    # Strip www. prefix
    if domain.startswith("www."):
        domain = domain[4:]

    # For social media URLs, try yt-dlp metadata extraction first
    # (works better than web scraping for Twitter/X, Instagram, etc.)
    if _is_social_media(url):
        result = _scrape_social_media(url)
        if result and result.get("text") and len(result["text"]) > 30:
            result["source_domain"] = domain
            return result

    # Try trafilatura first (best for articles)
    result = _scrape_trafilatura(url)
    if result and result.get("text") and len(result["text"]) > 100:
        result["source_domain"] = domain
        return result

    # Fallback to beautifulsoup
    result = _scrape_beautifulsoup(url)
    result["source_domain"] = domain
    return result


def _is_social_media(url):
    """Check if URL is a social media platform."""
    return bool(re.search(
        r'twitter\.com|x\.com|instagram\.com|facebook\.com|reddit\.com'
        r'|threads\.net|truthsocial\.com|gab\.com|telegram\.me|t\.me'
        r'|tiktok\.com|rumble\.com|bitchute\.com|odysee\.com',
        url, re.I
    ))


def _scrape_social_media(url):
    """
    Extract social media post content using yt-dlp metadata extraction.
    yt-dlp can extract post text, author, date, etc. from most platforms
    even when there's no video (it extracts the post metadata).
    """
    try:
        import yt_dlp

        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": False,
        }

        # For YouTube-specific extractor args
        if "youtube" in url.lower() or "youtu.be" in url.lower():
            opts["extractor_args"] = {"youtube": {"player_client": ["android"]}}

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return None

            # Build text from available metadata
            parts = []
            title = info.get("title", "") or info.get("fulltitle", "")
            uploader = info.get("uploader", "") or info.get("channel", "") or info.get("creator", "")
            description = info.get("description", "") or ""
            upload_date = info.get("upload_date", "")

            if uploader:
                parts.append(f"Posted by: {uploader}")
            if upload_date:
                # Format YYYYMMDD to readable
                try:
                    from datetime import datetime
                    dt = datetime.strptime(upload_date, "%Y%m%d")
                    parts.append(f"Date: {dt.strftime('%B %d, %Y')}")
                except Exception:
                    parts.append(f"Date: {upload_date}")

            if title and title != description:
                parts.append(f"\n{title}")
            if description:
                parts.append(f"\n{description[:5000]}")

            # Include comment count, like count, view count if available
            stats = []
            if info.get("view_count"):
                stats.append(f"{info['view_count']:,} views")
            if info.get("like_count"):
                stats.append(f"{info['like_count']:,} likes")
            if info.get("comment_count"):
                stats.append(f"{info['comment_count']:,} comments")
            if stats:
                parts.append(f"\nEngagement: {', '.join(stats)}")

            text = "\n".join(parts)

            if not text or len(text.strip()) < 20:
                return None

            return {
                "title": title or f"Post by {uploader}" if uploader else "",
                "text": text,
                "url": url,
            }

    except Exception as e:
        print(f"Social media extraction via yt-dlp failed: {e}")
        return None


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
