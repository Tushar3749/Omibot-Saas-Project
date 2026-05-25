"""
OmniBot SaaS — Document Text Extraction Service
Extracts plain text from PDF, DOCX, and TXT files, then chunks it for RAG.
"""
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Chunk size: ~800 tokens ≈ ~3200 chars; overlap 200 chars
CHUNK_SIZE    = 3200
CHUNK_OVERLAP = 200


def extract_text(file_bytes: bytes, filename: str) -> str:
    """
    Extract all text from a file.
    Supports: .pdf, .docx, .doc, .txt
    """
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

    if ext == 'pdf':
        return _extract_pdf(file_bytes)
    elif ext in ('docx', 'doc'):
        return _extract_docx(file_bytes)
    elif ext in ('txt', 'md', 'csv'):
        return file_bytes.decode('utf-8-sig', errors='replace')
    else:
        raise ValueError(f"Unsupported file type: .{ext}  (use PDF, DOCX, or TXT)")


def _extract_pdf(file_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        raise RuntimeError("pypdf not installed. Run: pip install pypdf")

    reader = PdfReader(io.BytesIO(file_bytes))
    parts  = []
    for page in reader.pages:
        text = page.extract_text() or ''
        parts.append(text)
    return '\n'.join(parts)


def _extract_docx(file_bytes: bytes) -> str:
    try:
        from docx import Document
    except ImportError:
        raise RuntimeError("python-docx not installed. Run: pip install python-docx")

    doc   = Document(io.BytesIO(file_bytes))
    paras = [p.text for p in doc.paragraphs if p.text.strip()]
    return '\n'.join(paras)


def chunk_text(text: str) -> list[str]:
    """
    Split text into overlapping chunks for RAG embedding.
    Returns a list of string chunks.
    """
    text   = text.strip()
    chunks = []
    start  = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start += CHUNK_SIZE - CHUNK_OVERLAP
        if start >= len(text):
            break
    return [c for c in chunks if len(c.strip()) > 50]  # drop tiny tail chunks


def file_type_label(filename: str) -> str:
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'txt'
    return ext
