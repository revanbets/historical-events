"""
FastAPI server for the Knowledge Management System.
Handles file uploads, text extraction, AI analysis, and serves the frontend.
"""

import os
import shutil
from datetime import datetime, timezone

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from database import init_db, insert_record, update_record, get_record, get_all_records, get_pending_records
from extractors import extract, get_file_type
from analyzer import analyze_text, condense_text
from video_analyzer import analyze_video_url, fetch_video_metadata_only, is_video_url, save_frames_to_disk, save_transcript_to_disk
from web_scraper import scrape_url

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
PENDING_DIR = os.path.join(BASE_DIR, "pending_analysis")

# Downloads directories (project-level)
DOWNLOADS_DIR = os.path.join(PARENT_DIR, "downloads")
FRAMES_DIR = os.path.join(DOWNLOADS_DIR, "frames")
TRANSCRIPTS_DIR = os.path.join(DOWNLOADS_DIR, "transcripts")
ATTACHMENTS_DIR = os.path.join(DOWNLOADS_DIR, "attachments")

app = FastAPI(title="Knowledge Management System", version="1.0.0")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    for d in [UPLOADS_DIR, PENDING_DIR, FRAMES_DIR, TRANSCRIPTS_DIR, ATTACHMENTS_DIR]:
        os.makedirs(d, exist_ok=True)
    init_db()
    print(f"Server ready. Uploads dir: {UPLOADS_DIR}")
    print(f"Downloads dir: {DOWNLOADS_DIR}")
    print(f"Open http://localhost:8000 in your browser")


# --- Serve the frontend HTML ---

@app.get("/")
def serve_frontend():
    html_path = os.path.join(PARENT_DIR, "historical-events-v2.2.html")
    if not os.path.exists(html_path):
        raise HTTPException(status_code=404, detail="Frontend HTML file not found")
    return FileResponse(html_path, media_type="text/html")


# --- File Upload ---

@app.post("/api/upload")
async def upload_files(files: list[UploadFile] = File(...)):
    """
    Accept one or more files, save them, extract text, store in DB.
    Returns a list of records with extracted data.
    """
    results = []

    for file in files:
        # Save uploaded file
        safe_name = file.filename.replace("/", "_").replace("\\", "_")
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        saved_name = f"{timestamp}_{safe_name}"
        file_path = os.path.join(UPLOADS_DIR, saved_name)

        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Extract text
        file_type = get_file_type(safe_name)
        try:
            extracted_text = extract(file_path)
        except Exception as e:
            extracted_text = f"[Extraction error: {e}]"

        # Save extracted text to pending_analysis
        txt_name = os.path.splitext(saved_name)[0] + ".txt"
        txt_path = os.path.join(PENDING_DIR, txt_name)
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(extracted_text)

        # Insert into database
        record_id = insert_record(
            file_name=safe_name,
            file_type=file_type,
            extracted_text=extracted_text,
            saved_filename=saved_name,
        )

        record = get_record(record_id)
        results.append(record)

    return JSONResponse(content={"records": results, "count": len(results)})


# --- Analysis ---

@app.post("/api/analyze/{record_id}")
async def analyze_record(record_id: int, mode: str = "long"):
    """Trigger AI analysis for a specific record. mode=short|long"""
    record = get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    text = record["extracted_text"]
    if not text or text.startswith("["):
        update_record(record_id, status="error", summary="No extractable text found")
        raise HTTPException(status_code=400, detail="No extractable text in this file")

    try:
        analysis = analyze_text(text, record["file_name"], mode=mode)
        updated = update_record(
            record_id,
            status="analyzed",
            summary=analysis["summary"],
            description=analysis.get("description", ""),
            topics=analysis["topics"],
            people=analysis["people"],
            organizations=analysis["organizations"],
            source=analysis.get("source", ""),
            primary_source=analysis.get("primary_source", ""),
            main_link=analysis.get("main_link", ""),
            analysis_mode=mode,
        )
        return JSONResponse(content={"record": updated})
    except Exception as e:
        update_record(record_id, status="error", summary=f"Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


@app.get("/api/analyze-all")
async def analyze_all():
    """Trigger AI analysis for all pending records."""
    pending = get_pending_records()
    if not pending:
        return JSONResponse(content={"message": "No pending records", "analyzed": 0})

    analyzed = []
    errors = []

    for record in pending:
        text = record["extracted_text"]
        if not text or text.startswith("["):
            update_record(record["id"], status="error", summary="No extractable text")
            errors.append(record["id"])
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
            analyzed.append(updated)
        except Exception as e:
            update_record(record["id"], status="error", summary=f"Analysis failed: {e}")
            errors.append(record["id"])

    return JSONResponse(content={
        "analyzed": len(analyzed),
        "errors": len(errors),
        "records": analyzed,
    })


# --- URL Analysis ---

@app.post("/api/analyze-url")
async def analyze_url(body: dict):
    """
    Analyze a URL (video or web page).
    For videos: streams/downloads, transcribes, extracts frames, sends to Claude vision.
    For web: scrapes text, sends to Claude for analysis.
    """
    url = body.get("url", "").strip()
    mode = body.get("mode", "long")
    skip_frames = body.get("skip_frames", False)
    skip_analysis = body.get("skip_analysis", False)
    start_time = body.get("start_time")  # float seconds or None
    end_time = body.get("end_time")      # float seconds or None
    if not url:
        raise HTTPException(status_code=400, detail="No URL provided")

    try:
        if is_video_url(url):
            if skip_analysis:
                # ── Metadata-only path (no AI) ──
                result = fetch_video_metadata_only(url)
                metadata = result["metadata"]
                video_title = metadata.get("title", "") or url
                transcript_text = result.get("transcript", "")

                record_id = insert_record(
                    file_name=video_title,
                    file_type="Video URL",
                    extracted_text=transcript_text[:100000] if transcript_text else "",
                )

                # Save transcript to disk if available
                transcript_file = None
                if transcript_text:
                    transcript_file = save_transcript_to_disk(
                        transcript_text, title=video_title, record_id=record_id,
                    )

                updated = update_record(
                    record_id,
                    status="pending",
                    source=metadata.get("uploader", "") or metadata.get("channel", ""),
                    main_link=url,
                    source_url=url,
                    content_type="video",
                    transcript=transcript_text[:100000] if transcript_text else "",
                    video_metadata=metadata,
                    transcript_file=transcript_file or "",
                )

                return JSONResponse(content={
                    "record": updated,
                    "type": "video",
                    "has_visual_analysis": False,
                    "frames_count": 0,
                    "transcript_file": transcript_file,
                    "metadata_only": True,
                })

            else:
                # ── Full video analysis pipeline ──
                result = analyze_video_url(url, mode=mode, skip_frames=skip_frames,
                                           start_time=start_time, end_time=end_time)
                if "error" in result:
                    raise HTTPException(status_code=500, detail=result["error"])

                analysis = result["analysis"]
                metadata = result.get("metadata", {})
                video_title = metadata.get("title", "") or url

                # Insert record into DB
                record_id = insert_record(
                    file_name=video_title,
                    file_type="Video URL",
                    extracted_text=result.get("transcript", "")[:100000],
                )

                # Save frames to disk
                frames_saved = []
                if result.get("frames"):
                    frames_saved = save_frames_to_disk(result["frames"], record_id, title=video_title)

                # Save transcript to disk
                transcript_file = save_transcript_to_disk(
                    result.get("transcript", ""),
                    title=video_title,
                    record_id=record_id,
                )

                # Update record with analysis results
                updated = update_record(
                    record_id,
                    status="analyzed",
                    summary=analysis.get("summary", ""),
                    description=analysis.get("description", ""),
                    visual_content=analysis.get("visual_content", ""),
                    topics=analysis.get("topics", []),
                    people=analysis.get("people", []),
                    organizations=analysis.get("organizations", []),
                    source=analysis.get("source", metadata.get("uploader", "")),
                    primary_source=analysis.get("primary_source", ""),
                    main_link=url,
                    source_url=url,
                    content_type="video",
                    transcript=result.get("transcript", "")[:100000],
                    video_metadata=metadata,
                    frames_data=frames_saved,
                    transcript_file=transcript_file or "",
                    analysis_mode=mode,
                    has_frames=1 if len(frames_saved) > 0 else 0,
                )

                return JSONResponse(content={
                    "record": updated,
                    "type": "video",
                    "has_visual_analysis": result.get("has_visual_analysis", False),
                    "frames_count": len(frames_saved),
                    "transcript_file": transcript_file,
                })

        else:
            # ── Web page analysis pipeline ──
            scraped = scrape_url(url)
            text = scraped.get("text", "")
            page_title = scraped.get("title", url)

            if not text or text.startswith("["):
                raise HTTPException(status_code=400, detail="Could not extract text from this URL")

            # Insert record
            record_id = insert_record(
                file_name=page_title or url,
                file_type="Web URL",
                extracted_text=text[:100000],
            )

            if skip_analysis:
                # Metadata-only for web — just save extracted text
                updated = update_record(
                    record_id,
                    status="pending",
                    source=scraped.get("source_domain", ""),
                    main_link=url,
                    source_url=url,
                    content_type="web",
                )
                return JSONResponse(content={
                    "record": updated,
                    "type": "web",
                    "metadata_only": True,
                })

            # Analyze with Claude
            analysis = analyze_text(text, page_title or url, mode=mode)

            # Update record
            updated = update_record(
                record_id,
                status="analyzed",
                summary=analysis.get("summary", ""),
                description=analysis.get("description", ""),
                topics=analysis.get("topics", []),
                people=analysis.get("people", []),
                organizations=analysis.get("organizations", []),
                source=analysis.get("source", scraped.get("source_domain", "")),
                primary_source=analysis.get("primary_source", ""),
                main_link=analysis.get("main_link", "") or url,
                source_url=url,
                content_type="web",
                analysis_mode=mode,
            )

            return JSONResponse(content={
                "record": updated,
                "type": "web",
            })

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"URL analysis failed: {e}")


# --- Serve saved frames ---

@app.get("/api/frames/{filename}")
def serve_frame(filename: str):
    """Serve a saved video frame image from downloads/frames/."""
    file_path = os.path.join(FRAMES_DIR, filename)
    if not os.path.exists(file_path):
        # Fallback: check old location
        old_path = os.path.join(BASE_DIR, "frames", filename)
        if os.path.exists(old_path):
            return FileResponse(old_path, media_type="image/jpeg")
        raise HTTPException(status_code=404, detail="Frame not found")
    return FileResponse(file_path, media_type="image/jpeg")


# --- Serve transcripts ---

@app.get("/api/transcripts/{filename}")
def serve_transcript(filename: str):
    """Serve a saved transcript file from downloads/transcripts/."""
    file_path = os.path.join(TRANSCRIPTS_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Transcript not found")
    return FileResponse(file_path, media_type="text/plain", filename=filename)


# --- Attachments ---

@app.get("/api/attachments/{filename}")
def serve_attachment(filename: str):
    """Serve a user-uploaded attachment from downloads/attachments/."""
    file_path = os.path.join(ATTACHMENTS_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Attachment not found")
    return FileResponse(file_path, filename=filename)


@app.post("/api/attachments/{record_id}")
async def upload_attachment(record_id: int, files: list[UploadFile] = File(...)):
    """Upload one or more attachments to a record."""
    record = get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    os.makedirs(ATTACHMENTS_DIR, exist_ok=True)
    existing = record.get("attachments", []) or []
    new_attachments = []

    for file in files:
        safe_name = file.filename.replace("/", "_").replace("\\", "_")
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        saved_name = f"r{record_id}_{timestamp}_{safe_name}"
        file_path = os.path.join(ATTACHMENTS_DIR, saved_name)

        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Determine type category
        ext = os.path.splitext(safe_name)[1].lower()
        type_cat = "file"
        if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"):
            type_cat = "image"
        elif ext in (".mp4", ".webm", ".mov", ".avi", ".mkv"):
            type_cat = "video"
        elif ext in (".mp3", ".wav", ".ogg", ".m4a", ".flac"):
            type_cat = "audio"
        elif ext in (".pdf",):
            type_cat = "pdf"
        elif ext in (".doc", ".docx", ".txt", ".rtf"):
            type_cat = "document"

        attachment = {
            "filename": saved_name,
            "original_name": file.filename,
            "type": type_cat,
            "size": len(content),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }
        new_attachments.append(attachment)

    all_attachments = existing + new_attachments
    updated = update_record(record_id, attachments=all_attachments)

    return JSONResponse(content={
        "record": updated,
        "new_attachments": new_attachments,
    })


@app.delete("/api/attachments/{record_id}/{filename}")
async def delete_attachment(record_id: int, filename: str):
    """Delete an attachment from a record."""
    record = get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    existing = record.get("attachments", []) or []
    updated_attachments = [a for a in existing if a.get("filename") != filename]

    # Delete file from disk
    file_path = os.path.join(ATTACHMENTS_DIR, filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    updated = update_record(record_id, attachments=updated_attachments)
    return JSONResponse(content={"record": updated})


# --- Condense ---

@app.post("/api/condense")
async def condense_summary(body: dict):
    """Condense text to 2-3 sentences using AI."""
    text = body.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")
    try:
        condensed = condense_text(text)
        return JSONResponse(content={"condensed": condensed})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Condense failed: {e}")


# --- Records ---

@app.get("/api/records")
def list_records():
    """Return all records from the database."""
    records = get_all_records()
    return JSONResponse(content={"records": records, "count": len(records)})


@app.get("/api/records/{record_id}")
def get_single_record(record_id: int):
    """Return a single record by ID."""
    record = get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    return JSONResponse(content={"record": record})


# --- File Download ---

@app.get("/api/uploads/{filename}")
def download_uploaded_file(filename: str):
    """Serve an uploaded file for download."""
    file_path = os.path.join(UPLOADS_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, filename=filename)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
