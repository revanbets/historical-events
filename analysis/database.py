import json
import os
from datetime import datetime, timezone

from sqlalchemy import create_engine, Column, Integer, Text
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "knowledge_base.db")

engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


class AnalyzedContent(Base):
    __tablename__ = "analyzed_content"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_name = Column(Text, nullable=False)
    file_type = Column(Text, nullable=False)
    summary = Column(Text, default="")
    extracted_text = Column(Text, default="")
    topics = Column(Text, default="[]")          # JSON array
    people = Column(Text, default="[]")          # JSON array
    organizations = Column(Text, default="[]")   # JSON array
    description = Column(Text, default="")         # AI bullet points
    source = Column(Text, default="")              # Publisher/outlet
    primary_source = Column(Text, default="")      # Original source of info
    main_link = Column(Text, default="")           # Canonical URL
    saved_filename = Column(Text, default="")      # Filename in uploads/ dir
    timestamp = Column(Text, default="")
    status = Column(Text, default="pending")       # pending | analyzed | error
    # URL/Video fields
    source_url = Column(Text, default="")            # Original URL submitted
    content_type = Column(Text, default="file")      # file | video | web
    transcript = Column(Text, default="")             # Video transcript text
    visual_content = Column(Text, default="")         # AI description of visual frames
    video_metadata = Column(Text, default="{}")       # JSON: title, channel, duration, etc.
    frames_data = Column(Text, default="[]")          # JSON: list of saved frame filenames
    attachments = Column(Text, default="[]")           # JSON: user-uploaded attachments
    transcript_file = Column(Text, default="")         # Saved transcript filename
    analysis_mode = Column(Text, default="")           # fast|quick|short|long
    has_frames = Column(Integer, default=0)            # 1 if frames were captured

    def to_dict(self):
        return {
            "id": self.id,
            "file_name": self.file_name,
            "file_type": self.file_type,
            "summary": self.summary,
            "extracted_text": self.extracted_text,
            "description": self.description,
            "topics": json.loads(self.topics) if self.topics else [],
            "people": json.loads(self.people) if self.people else [],
            "organizations": json.loads(self.organizations) if self.organizations else [],
            "source": self.source,
            "primary_source": self.primary_source,
            "main_link": self.main_link,
            "saved_filename": self.saved_filename,
            "timestamp": self.timestamp,
            "status": self.status,
            "source_url": self.source_url or "",
            "content_type": self.content_type or "file",
            "transcript": self.transcript or "",
            "visual_content": self.visual_content or "",
            "video_metadata": json.loads(self.video_metadata) if self.video_metadata else {},
            "frames_data": json.loads(self.frames_data) if self.frames_data else [],
            "attachments": json.loads(self.attachments) if self.attachments else [],
            "transcript_file": self.transcript_file or "",
            "analysis_mode": self.analysis_mode or "",
            "has_frames": bool(self.has_frames) if self.has_frames else False,
        }


def init_db():
    Base.metadata.create_all(engine)


def insert_record(file_name: str, file_type: str, extracted_text: str, saved_filename: str = "") -> int:
    session = SessionLocal()
    try:
        record = AnalyzedContent(
            file_name=file_name,
            file_type=file_type,
            extracted_text=extracted_text,
            saved_filename=saved_filename,
            timestamp=datetime.now(timezone.utc).isoformat(),
            status="pending",
        )
        session.add(record)
        session.commit()
        record_id = record.id
        return record_id
    finally:
        session.close()


def update_record(record_id: int, **kwargs):
    session = SessionLocal()
    try:
        record = session.query(AnalyzedContent).filter_by(id=record_id).first()
        if not record:
            return None
        for key, value in kwargs.items():
            if key in ("topics", "people", "organizations", "frames_data", "attachments") and isinstance(value, list):
                value = json.dumps(value)
            if key in ("video_metadata",) and isinstance(value, dict):
                value = json.dumps(value)
            setattr(record, key, value)
        session.commit()
        return record.to_dict()
    finally:
        session.close()


def get_record(record_id: int):
    session = SessionLocal()
    try:
        record = session.query(AnalyzedContent).filter_by(id=record_id).first()
        return record.to_dict() if record else None
    finally:
        session.close()


def get_all_records():
    session = SessionLocal()
    try:
        records = session.query(AnalyzedContent).order_by(AnalyzedContent.id.desc()).all()
        return [r.to_dict() for r in records]
    finally:
        session.close()


def get_pending_records():
    session = SessionLocal()
    try:
        records = session.query(AnalyzedContent).filter_by(status="pending").all()
        return [r.to_dict() for r in records]
    finally:
        session.close()
