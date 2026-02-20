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
from analyzer import analyze_text

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
PENDING_DIR = os.path.join(BASE_DIR, "pending_analysis")

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
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    os.makedirs(PENDING_DIR, exist_ok=True)
    init_db()
    print(f"Server ready. Uploads dir: {UPLOADS_DIR}")
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
        )

        record = get_record(record_id)
        results.append(record)

    return JSONResponse(content={"records": results, "count": len(results)})


# --- Analysis ---

@app.post("/api/analyze/{record_id}")
async def analyze_record(record_id: int):
    """Trigger AI analysis for a specific record."""
    record = get_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    if record["status"] == "analyzed":
        return JSONResponse(content={"record": record, "message": "Already analyzed"})

    text = record["extracted_text"]
    if not text or text.startswith("["):
        update_record(record_id, status="error", summary="No extractable text found")
        raise HTTPException(status_code=400, detail="No extractable text in this file")

    try:
        analysis = analyze_text(text, record["file_name"])
        updated = update_record(
            record_id,
            status="analyzed",
            summary=analysis["summary"],
            topics=analysis["topics"],
            people=analysis["people"],
            organizations=analysis["organizations"],
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
