"""
Video analysis pipeline.
Downloads/streams videos, extracts transcripts + visual frames,
sends both to Claude for comprehensive audio+visual analysis.
"""

import base64
import io
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

from dotenv import load_dotenv

# Ensure Homebrew binaries (ffmpeg) are on PATH
if "/opt/homebrew/bin" not in os.environ.get("PATH", ""):
    os.environ["PATH"] = "/opt/homebrew/bin:" + os.environ.get("PATH", "")

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# YouTube requires android client to avoid SABR streaming 403 errors
YT_EXTRACTOR_ARGS = {"youtube": {"player_client": ["android"]}}

# Paths — downloads go to project-level downloads/ folder
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOWNLOADS_DIR = os.path.join(PROJECT_DIR, "downloads")
FRAMES_DIR = os.path.join(DOWNLOADS_DIR, "frames")
TRANSCRIPTS_DIR = os.path.join(DOWNLOADS_DIR, "transcripts")
TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloads")

for d in [DOWNLOADS_DIR, FRAMES_DIR, TRANSCRIPTS_DIR, TEMP_DIR]:
    os.makedirs(d, exist_ok=True)


def _sanitize_filename(name, max_len=80):
    """Make a string safe for use as a filename."""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = re.sub(r'\s+', '_', name.strip())
    return name[:max_len] if name else "untitled"


def _format_time(seconds):
    """Format seconds as M:SS or H:MM:SS."""
    seconds = int(seconds)
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


# ── Helpers ──

def extract_video_id(url):
    """Extract YouTube video ID from various URL formats."""
    parsed = urlparse(url)
    if "youtu.be" in (parsed.hostname or ""):
        return parsed.path.lstrip("/").split("/")[0]
    if "youtube" in (parsed.hostname or ""):
        return parse_qs(parsed.query).get("v", [None])[0]
    return None


def is_video_url(url):
    """Check if URL is a supported video platform."""
    return bool(re.search(r'youtube|youtu\.be|vimeo|dailymotion', url, re.I))


# ── Step 1: Extract metadata (always, no download) ──

def get_video_metadata(url):
    """Extract video metadata without downloading. Returns dict."""
    import yt_dlp
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extractor_args": YT_EXTRACTOR_ARGS,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                "title": info.get("title", ""),
                "uploader": info.get("uploader", ""),
                "upload_date": info.get("upload_date", ""),
                "duration": info.get("duration", 0),
                "description": (info.get("description", "") or "")[:2000],
                "view_count": info.get("view_count", 0),
                "channel": info.get("channel", ""),
            }
    except Exception as e:
        print(f"Metadata extraction failed: {e}")
        return {"title": "", "uploader": "", "duration": 0}


# ── Step 2: Get transcript (fast path — YouTube captions) ──

def get_youtube_transcript(video_id, start_time=None, end_time=None):
    """Fetch existing YouTube captions. Returns (text, segments) or (None, None).
    If start_time/end_time (seconds) are given, only segments within that range are returned."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        ytt_api = YouTubeTranscriptApi()
        transcript = ytt_api.fetch(video_id)
        segments = []
        for snippet in transcript.snippets:
            segments.append({
                "text": snippet.text,
                "start": snippet.start,
                "duration": snippet.duration,
            })

        # Filter to time range if specified
        if start_time is not None or end_time is not None:
            filtered = [
                s for s in segments
                if (start_time is None or s["start"] + s["duration"] > start_time)
                and (end_time is None or s["start"] < end_time)
            ]
            if filtered:
                segments = filtered

        full_text = " ".join([s["text"] for s in segments])
        return full_text, segments
    except Exception as e:
        print(f"YouTube captions not available: {e}")
        return None, None


# ── Step 3: Get stream URL for frame extraction (no download) ──

def get_stream_url(url, max_height=720):
    """Get a direct stream URL for the video using yt-dlp. No download.
    Prefers a combined mp4 format that OpenCV can handle (not DASH/HLS)."""
    import yt_dlp

    # First try: get a combined (muxed) format — these work with OpenCV
    try:
        opts = {
            "format": f"best[height<={max_height}][ext=mp4]/best[height<={max_height}]",
            "quiet": True,
            "no_warnings": True,
            "extractor_args": YT_EXTRACTOR_ARGS,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            stream = info.get("url", "")
            if stream:
                print(f"  Got combined stream URL (format: {info.get('format_id', '?')}, {info.get('height', '?')}p)")
                return stream
    except Exception as e:
        print(f"  Combined stream URL failed: {e}")

    # Fallback: try separate video stream
    try:
        opts = {
            "format": f"bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]",
            "quiet": True,
            "no_warnings": True,
            "extractor_args": YT_EXTRACTOR_ARGS,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get("requested_formats"):
                for fmt in info["requested_formats"]:
                    if fmt.get("vcodec", "none") != "none":
                        print(f"  Got video-only stream URL (format: {fmt.get('format_id', '?')}, {fmt.get('height', '?')}p)")
                        return fmt["url"]
            return info.get("url", "")
    except Exception as e:
        print(f"  Stream URL extraction failed: {e}")
        return None


# ── Step 4: Download video (only when Whisper needed) ──

def download_video(url, max_height=720):
    """Download video using yt-dlp. Returns filepath. Retries once on failure."""
    import yt_dlp

    output_template = os.path.join(TEMP_DIR, "%(id)s.%(ext)s")
    opts = {
        "format": f"bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]",
        "outtmpl": output_template,
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
        "extractor_args": YT_EXTRACTOR_ARGS,
    }

    for attempt in range(2):
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                filename = ydl.prepare_filename(info)
                filename = os.path.splitext(filename)[0] + ".mp4"
                return filename
        except Exception as e:
            print(f"Download attempt {attempt + 1} failed: {e}")
            if attempt == 1:
                raise
    return None


# ── Step 5: Whisper fallback (when no captions) ──

def transcribe_with_whisper(video_path, model_size="base"):
    """Transcribe audio using OpenAI Whisper. Requires ffmpeg."""
    try:
        import whisper
        model = whisper.load_model(model_size)
        result = model.transcribe(video_path)
        segments = [{"text": s["text"], "start": s["start"], "duration": s["end"] - s["start"]}
                    for s in result["segments"]]
        return result["text"], segments
    except ImportError:
        return None, None
    except Exception as e:
        print(f"Whisper transcription failed: {e}")
        return None, None


# ── Step 6: Extract visual frames (from stream URL or local file) ──

def extract_frames(source, interval_seconds=30, max_frames=20, start_time=None, end_time=None):
    """
    Extract frames at regular intervals from video.
    `source` can be a local file path or a stream URL.
    start_time / end_time (seconds) optionally restrict the range.
    Returns list of dicts with base64 JPEG, timestamp, and label.
    """
    import cv2
    from PIL import Image

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"  [frames] Could not open video source: {source[:100]}...")
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if total_frames > 0 and fps > 0 else 0
    print(f"  [frames] Opened source — fps={fps:.1f}, total_frames={total_frames}, duration={duration:.1f}s")

    start_sec = start_time if start_time is not None else 0.0

    # For streams, duration might be 0 — try reading sequentially
    if duration <= 0:
        print(f"  [frames] Duration unknown (stream), reading frames sequentially...")
        frames = []
        frame_count = 0
        skip_interval = max(1, int(fps * interval_seconds))
        while cap.isOpened() and len(frames) < max_frames:
            ret, frame = cap.read()
            if not ret:
                break
            cur_ts = frame_count / fps
            # Stop if past end_time
            if end_time is not None and cur_ts > end_time:
                break
            # Grab every Nth frame within the range
            if frame_count % skip_interval == 0 and cur_ts >= start_sec:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                pil_img = Image.fromarray(frame_rgb)
                pil_img.thumbnail((1024, 1024))
                buffer = io.BytesIO()
                pil_img.save(buffer, format="JPEG", quality=80)
                b64 = base64.standard_b64encode(buffer.getvalue()).decode("utf-8")
                mins = int(cur_ts // 60)
                secs = int(cur_ts % 60)
                frames.append({
                    "base64": b64,
                    "timestamp": cur_ts,
                    "label": f"{mins}:{secs:02d}",
                })
            frame_count += 1
        cap.release()
        return frames

    # Effective range
    end_sec = end_time if end_time is not None else duration
    range_sec = max(1.0, end_sec - start_sec)

    # Adjust interval so we get good coverage of the range
    if range_sec < interval_seconds * 3:
        interval_seconds = max(5, int(range_sec / max_frames))

    frame_interval = int(fps * interval_seconds)
    start_frame = int(fps * start_sec)
    end_frame = int(fps * end_sec)
    frames = []
    frame_num = start_frame

    while cap.isOpened() and len(frames) < max_frames:
        if frame_num >= end_frame:
            break
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
        ret, frame = cap.read()
        if not ret:
            break

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(frame_rgb)
        pil_img.thumbnail((1024, 1024))

        buffer = io.BytesIO()
        pil_img.save(buffer, format="JPEG", quality=80)
        b64 = base64.standard_b64encode(buffer.getvalue()).decode("utf-8")

        timestamp = frame_num / fps
        mins = int(timestamp // 60)
        secs = int(timestamp % 60)
        frames.append({
            "base64": b64,
            "timestamp": timestamp,
            "label": f"{mins}:{secs:02d}",
        })

        frame_num += frame_interval

    cap.release()
    return frames


# ── Step 7: Claude vision analysis (transcript + frames) ──

VIDEO_ANALYSIS_PROMPT_LONG = """You are analyzing a video for a historical events research database focused on controversial, censored, or under-reported topics.

Video title: {title}
Video channel/uploader: {uploader}

You have been provided with:
1. The full transcript of what is said in the video
2. Visual frames captured at regular intervals showing what appears on screen

Analyze BOTH the spoken content AND the visual content (any documents, charts, images, text overlays, maps, photographs, or evidence shown on screen). Pay special attention to visual evidence — many videos display source documents, screenshots, data, or images that add crucial context beyond what is spoken.

Return a JSON object with these fields:

- "summary": A detailed paragraph (or multiple paragraphs) summarizing the video's content, key arguments, visual evidence shown, and significance. Mention specific things shown on screen. Do NOT just repeat the transcript — synthesize, analyze, and highlight what matters.
- "description": Bullet-point key facts. Use "- " prefix. Include 4-8 bullets covering: main claims, evidence shown, who was involved, why it matters.
- "visual_content": Bullet-point description of notable visual elements shown on screen. Use "- " prefix. Describe any documents, charts, images, text overlays, or other visual evidence. Include timestamps.
- "topics": An array of topic/category strings (3-10 topics).
- "people": An array of full real names of people mentioned or shown.
- "organizations": An array of organization names mentioned or shown.
- "source": The channel or uploader name.
- "primary_source": The original source of the information discussed. If the video creator IS the primary source, say "This video".
- "main_link": The video URL.

Return ONLY valid JSON, no markdown fences, no explanation."""

VIDEO_ANALYSIS_PROMPT_SHORT = """You are analyzing a video for a historical events research database.

Video title: {title}
Video channel/uploader: {uploader}

You have the transcript and visual frames from this video. Analyze both spoken and visual content.

Return a JSON object:
- "summary": Concise 2-3 sentence summary including key visual evidence shown. Do NOT repeat the transcript.
- "description": 3-4 bullet points with "- " prefix.
- "visual_content": 2-3 bullet points describing notable visuals shown on screen with timestamps.
- "topics": Array of 3-5 topics.
- "people": Array of people mentioned or shown.
- "organizations": Array of organizations mentioned or shown.
- "source": Channel/uploader name.
- "primary_source": Original source of info discussed.
- "main_link": The video URL.

Return ONLY valid JSON, no markdown fences."""

VIDEO_ANALYSIS_PROMPT_QUICK = """Analyze this video transcript for a research database.

Video: {title} by {uploader}

Return a JSON object:
- "summary": 2-3 sentence summary of the content and significance. Synthesize, don't repeat.
- "description": 3-4 bullet points with "- " prefix covering key claims and facts.
- "topics": Array of 3-5 topics.
- "people": Array of people mentioned.
- "organizations": Array of organizations mentioned.
- "source": Channel/uploader name.
- "primary_source": Original source of info discussed.
- "main_link": The video URL.

Return ONLY valid JSON."""

VIDEO_ANALYSIS_PROMPT_FAST = """Quickly extract key info from this video transcript.

Video: {title} by {uploader}

Return JSON:
- "summary": 1-2 sentence summary.
- "description": 2-3 bullet points with "- " prefix.
- "topics": Array of 3-5 topics.
- "people": Array of people mentioned.
- "organizations": Array of organizations mentioned.
- "source": Channel name.
- "primary_source": Original source.
- "main_link": Video URL.

Return ONLY valid JSON."""

# Mode → (prompt_template, model, max_tokens)
MODE_CONFIG = {
    "fast":  (VIDEO_ANALYSIS_PROMPT_FAST,  "claude-haiku-4-5-20251001",   1500),
    "quick": (VIDEO_ANALYSIS_PROMPT_QUICK, "claude-sonnet-4-5-20250929",  2500),
    "short": (VIDEO_ANALYSIS_PROMPT_SHORT, "claude-sonnet-4-5-20250929",  3000),
    "long":  (VIDEO_ANALYSIS_PROMPT_LONG,  "claude-sonnet-4-5-20250929",  4096),
}


def analyze_video_with_claude(transcript, frames, title="", uploader="", url="", mode="long", time_range_note=""):
    """Send transcript + visual frames to Claude for comprehensive analysis."""
    if not ANTHROPIC_API_KEY:
        return {
            "summary": "[Analysis unavailable — set ANTHROPIC_API_KEY in analysis/.env]",
            "description": "", "visual_content": "",
            "topics": [], "people": [], "organizations": [],
            "source": uploader, "primary_source": "", "main_link": url,
        }

    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Build multi-modal content
    content = []

    # Select mode config
    config = MODE_CONFIG.get(mode, MODE_CONFIG["long"])
    prompt_template, model_id, max_tokens = config

    content.append({
        "type": "text",
        "text": prompt_template.format(title=title, uploader=uploader),
    })

    # Add transcript
    truncated_transcript = (transcript or "No transcript available.")[:50000]
    range_header = f"\n{time_range_note}" if time_range_note else ""
    content.append({
        "type": "text",
        "text": f"\n## TRANSCRIPT:{range_header}\n{truncated_transcript}",
    })

    # Add visual frames with timestamps
    if frames:
        content.append({"type": "text", "text": "\n## VISUAL FRAMES (screenshots from the video):"})
        for frame in frames:
            content.append({
                "type": "text",
                "text": f"\n--- Frame at {frame['label']} ---",
            })
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": frame["base64"],
                },
            })

    message = client.messages.create(
        model=model_id,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": content}],
    )

    response_text = message.content[0].text.strip()

    # Parse JSON
    if response_text.startswith("```"):
        lines = response_text.split("\n")
        response_text = "\n".join(lines[1:-1])

    try:
        result = json.loads(response_text)
    except json.JSONDecodeError:
        result = {
            "summary": response_text[:500],
            "description": "", "visual_content": "",
            "topics": [], "people": [], "organizations": [],
            "source": uploader, "primary_source": "", "main_link": url,
        }

    # Normalize fields — Claude sometimes returns lists instead of strings
    def _to_str(val):
        if isinstance(val, list):
            return "\n".join(str(v) for v in val)
        return str(val) if val else ""

    return {
        "summary": _to_str(result.get("summary", "")),
        "description": _to_str(result.get("description", "")),
        "visual_content": _to_str(result.get("visual_content", "")),
        "topics": result.get("topics", []),
        "people": result.get("people", []),
        "organizations": result.get("organizations", []),
        "source": _to_str(result.get("source", uploader)),
        "primary_source": _to_str(result.get("primary_source", "")),
        "main_link": _to_str(result.get("main_link", url)),
    }


# ── Step 8: Save frames as images ──

def save_frames_to_disk(frames, record_id, title=""):
    """Save extracted frames as JPEG files to downloads/frames/. Returns list of filenames."""
    os.makedirs(FRAMES_DIR, exist_ok=True)

    safe_title = _sanitize_filename(title) if title else f"record_{record_id}"
    saved = []
    for i, frame in enumerate(frames):
        filename = f"{safe_title}_frame_{i}_{frame['label'].replace(':','m')}s.jpg"
        filepath = os.path.join(FRAMES_DIR, filename)
        img_bytes = base64.standard_b64decode(frame["base64"])
        with open(filepath, "wb") as f:
            f.write(img_bytes)
        saved.append({"filename": filename, "timestamp": frame["label"], "base64": frame["base64"]})
    return saved


# ── Step 9: Save transcript to disk ──

def save_transcript_to_disk(transcript, title="", record_id=None):
    """Save transcript as .txt file to downloads/transcripts/. Returns filename."""
    if not transcript or len(transcript.strip()) < 10:
        return None

    os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)

    safe_title = _sanitize_filename(title) if title else f"record_{record_id or 'unknown'}"
    filename = f"{safe_title}_transcript.txt"
    filepath = os.path.join(TRANSCRIPTS_DIR, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"Transcript: {title}\n")
        f.write(f"Saved: {datetime.now(timezone.utc).isoformat()}\n")
        f.write("=" * 60 + "\n\n")
        f.write(transcript)

    return filename


# ── Metadata-only pipeline (no AI) ──

def fetch_video_metadata_only(url):
    """
    Extract metadata + transcript without AI analysis.
    Returns dict with: metadata, transcript, segments.
    Fast (~3-5 seconds for YouTube).
    """
    video_id = extract_video_id(url)
    transcript = None
    segments = None

    print(f"[1/2] Extracting metadata for: {url}")
    metadata = get_video_metadata(url)

    print(f"[2/2] Fetching transcript...")
    if video_id:
        transcript, segments = get_youtube_transcript(video_id)

    return {
        "metadata": metadata,
        "transcript": transcript or "",
        "segments": segments,
    }


# ── Full pipeline ──

def analyze_video_url(url, mode="long", skip_frames=False, start_time=None, end_time=None):
    """
    Full video analysis pipeline:
    1. Extract metadata (no download)
    2. Get transcript (captions or whisper), filtered to start_time–end_time if given
    3. Get stream URL or download for frame extraction (unless skip_frames)
    4. Extract visual frames within start_time–end_time (unless skip_frames)
    5. Send transcript + frames to Claude
    6. Return structured analysis + metadata

    start_time / end_time: float seconds, optional. Restrict analysis to a segment.
    Returns dict with: analysis, metadata, transcript, frames
    """
    video_id = extract_video_id(url)
    transcript = None
    segments = None
    video_path = None

    # Build time range note for Claude
    time_range_note = ""
    if start_time is not None or end_time is not None:
        start_str = _format_time(start_time or 0)
        end_str = _format_time(end_time) if end_time is not None else "end"
        time_range_note = f"[Segment analyzed: {start_str} – {end_str}]"
        print(f"  Time range: {time_range_note}")

    # Step 1: Always get metadata first (no download)
    print(f"[1/5] Extracting metadata for: {url}")
    metadata = get_video_metadata(url)

    # Step 2: Try YouTube captions first (instant, free)
    print(f"[2/5] Fetching transcript...")
    if video_id:
        transcript, segments = get_youtube_transcript(video_id, start_time=start_time, end_time=end_time)

    # Step 3: Extract visual frames (unless skipped)
    frames = []

    if skip_frames:
        print(f"[3/5] Skipping frame extraction (frames disabled)")
        if not transcript:
            # No captions and no frames — still need to download for Whisper
            print("  No captions available, downloading for Whisper...")
            try:
                video_path = download_video(url)
            except Exception as e:
                print(f"  Video download failed: {e}")
            if video_path:
                print(f"[3b] Running Whisper transcription...")
                transcript, segments = transcribe_with_whisper(video_path)
                if not transcript:
                    transcript = f"[Transcript unavailable for: {metadata.get('title', url)}]"
            else:
                transcript = f"[Transcript unavailable for: {metadata.get('title', url)}]"
    else:
        print(f"[3/5] Extracting visual frames...")
        if transcript:
            # We have captions — try streaming (no download needed)
            stream_url = get_stream_url(url)
            if stream_url:
                print("  Using stream URL for frame extraction (no download)")
                frames = extract_frames(stream_url, interval_seconds=30, max_frames=20,
                                        start_time=start_time, end_time=end_time)
                print(f"  Stream frame extraction: {len(frames)} frames captured")

            # If streaming failed, try downloading as fallback
            if not frames:
                print(f"  Stream extraction got {len(frames)} frames, trying download fallback...")
                try:
                    video_path = download_video(url)
                    if video_path:
                        frames = extract_frames(video_path, interval_seconds=30, max_frames=20,
                                                start_time=start_time, end_time=end_time)
                except Exception as e:
                    print(f"  Download also failed: {e}")
        else:
            # No captions — must download for Whisper transcription + frames
            print("  No captions available, downloading for Whisper + frames...")
            try:
                video_path = download_video(url)
            except Exception as e:
                print(f"  Video download failed: {e}")

            if video_path:
                print(f"[3b] Running Whisper transcription...")
                transcript, segments = transcribe_with_whisper(video_path)
                if not transcript:
                    transcript = f"[Transcript unavailable for: {metadata.get('title', url)}]"
                frames = extract_frames(video_path, interval_seconds=30, max_frames=20,
                                        start_time=start_time, end_time=end_time)
            else:
                transcript = f"[Transcript unavailable for: {metadata.get('title', url)}]"

    # Step 4: Claude analysis with transcript + frames
    print(f"[4/5] Sending to Claude for analysis ({len(frames)} frames, mode={mode})...")
    analysis = analyze_video_with_claude(
        transcript, frames,
        title=metadata.get("title", ""),
        uploader=metadata.get("uploader", ""),
        url=url, mode=mode,
        time_range_note=time_range_note,
    )

    # Step 5: Cleanup downloaded video if any (keep frames)
    if video_path:
        try:
            if os.path.exists(video_path):
                os.remove(video_path)
                print("  Cleaned up temp video file")
        except Exception:
            pass

    print(f"[5/5] Analysis complete!")
    return {
        "analysis": analysis,
        "metadata": metadata,
        "transcript": transcript,
        "segments": segments,
        "frames": frames,  # base64 frames for saving later
        "has_visual_analysis": len(frames) > 0,
    }
