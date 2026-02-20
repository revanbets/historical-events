"""
File text extraction utilities.
Each function takes a file path and returns extracted text as a string.
"""

import os


def extract_pdf(path: str) -> str:
    import pdfplumber

    text_parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n\n".join(text_parts)


def extract_docx(path: str) -> str:
    from docx import Document

    doc = Document(path)
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


def extract_excel(path: str) -> str:
    import pandas as pd

    text_parts = []
    xls = pd.ExcelFile(path)
    for sheet_name in xls.sheet_names:
        df = pd.read_excel(xls, sheet_name=sheet_name)
        text_parts.append(f"--- Sheet: {sheet_name} ---")
        text_parts.append(df.to_string(index=False))
    return "\n\n".join(text_parts)


def extract_csv(path: str) -> str:
    import pandas as pd

    df = pd.read_csv(path)
    return df.to_string(index=False)


def extract_image(path: str) -> str:
    """Extract text from image using OCR. Falls back gracefully if tesseract isn't installed."""
    try:
        from PIL import Image
        import pytesseract

        img = Image.open(path)
        text = pytesseract.image_to_string(img)
        return text.strip() if text.strip() else "[Image detected but no text could be extracted via OCR]"
    except Exception as e:
        if "tesseract" in str(e).lower():
            return "[OCR unavailable — install Tesseract to extract text from images: brew install tesseract]"
        return f"[Image text extraction failed: {e}]"


def extract_text_file(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


# Extension → extractor mapping
EXTRACTORS = {
    ".pdf": extract_pdf,
    ".docx": extract_docx,
    ".doc": extract_docx,
    ".xlsx": extract_excel,
    ".xls": extract_excel,
    ".csv": extract_csv,
    ".txt": extract_text_file,
    ".md": extract_text_file,
    ".png": extract_image,
    ".jpg": extract_image,
    ".jpeg": extract_image,
    ".gif": extract_image,
    ".bmp": extract_image,
    ".tiff": extract_image,
    ".webp": extract_image,
}


def extract(path: str) -> str:
    """Dispatch to the correct extractor based on file extension."""
    ext = os.path.splitext(path)[1].lower()
    extractor = EXTRACTORS.get(ext)
    if not extractor:
        return f"[Unsupported file type: {ext}]"
    return extractor(path)


def get_file_type(filename: str) -> str:
    """Return a human-readable file type string."""
    ext = os.path.splitext(filename)[1].lower()
    type_map = {
        ".pdf": "PDF",
        ".docx": "Word",
        ".doc": "Word",
        ".xlsx": "Excel",
        ".xls": "Excel",
        ".csv": "CSV",
        ".txt": "Text",
        ".md": "Markdown",
        ".png": "Image",
        ".jpg": "Image",
        ".jpeg": "Image",
        ".gif": "Image",
        ".bmp": "Image",
        ".tiff": "Image",
        ".webp": "Image",
    }
    return type_map.get(ext, "Unknown")
