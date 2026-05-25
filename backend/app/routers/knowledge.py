"""
OmniBot SaaS — Knowledge Base Router
File upload (PDF/DOCX/TXT), chunking, RAG embedding, list, delete.

Endpoints (static routes FIRST):
  GET    /                          list documents grouped by file_name
  POST   /upload                    upload & embed a document file
  POST   /text                      add a plain-text document directly
  DELETE /file/{file_name}          delete ALL chunks for a file  ← BEFORE /{doc_id}
  DELETE /{doc_id}                  delete a single chunk
"""
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import KnowledgeDocCreate
from app.services.doc_service import extract_text, chunk_text, file_type_label
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)
router = APIRouter()
rag    = RAGService()

# Allowed content types (must match DB CHECK constraint)
_CONTENT_TYPES = {
    "policy", "faq", "product",
    "return_policy", "bonus_policy", "company_desc",
}

# Allowed upload extensions
_ALLOWED_EXTS = {".pdf", ".docx", ".doc", ".txt", ".md"}

# 10 MB upload cap
_MAX_FILE_SIZE = 10 * 1024 * 1024


# ─── List ─────────────────────────────────────────────────────────────────────
@router.get("/")
async def list_knowledge(tenant: dict = Depends(get_current_tenant)):
    """
    Return all knowledge-base entries for the tenant, grouped by file.
    Each group carries: file_name, file_type, file_size, content_type, chunk_count, created_at.
    Plain-text documents (no file_name) are listed individually.
    """
    result = (
        supabase.table("knowledge_base")
        .select("id, content_type, metadata, file_name, file_type, file_size, chunk_index, created_at")
        .eq("tenant_id", tenant["tenant_id"])
        .neq("content_type", "product")   # products are auto-managed via products router
        .order("created_at", desc=True)
        .execute()
    )
    rows = result.data or []

    # Group chunks by file_name; ungrouped (plain text) entries listed as-is
    grouped: dict[str, dict] = {}
    ungrouped: list[dict] = []

    for row in rows:
        fn = row.get("file_name")
        if fn:
            if fn not in grouped:
                grouped[fn] = {
                    "file_name":    fn,
                    "file_type":    row.get("file_type", "txt"),
                    "file_size":    row.get("file_size", 0),
                    "content_type": row.get("content_type"),
                    "chunk_count":  0,
                    "created_at":   row.get("created_at"),
                    "first_id":     row["id"],
                }
            grouped[fn]["chunk_count"] += 1
        else:
            ungrouped.append({
                "id":           row["id"],
                "content_type": row.get("content_type"),
                "file_name":    None,
                "chunk_count":  1,
                "created_at":   row.get("created_at"),
            })

    return list(grouped.values()) + ungrouped


# ─── Upload file ──────────────────────────────────────────────────────────────
@router.post("/upload", status_code=201)
async def upload_knowledge_file(
    tenant: dict  = Depends(get_current_tenant),
    file:   UploadFile = File(...),
    content_type: str  = Form(default="policy"),
):
    """
    Upload a PDF, DOCX, or TXT file.
    The file is text-extracted, chunked, and embedded into knowledge_base.
    If a file with the same name already exists, the old chunks are replaced.

    content_type choices: policy | faq | return_policy | bonus_policy | company_desc
    """
    if content_type not in _CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"content_type must be one of: {', '.join(sorted(_CONTENT_TYPES))}"
        )

    fname = (file.filename or "upload.txt").strip()
    ext   = "." + fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    if ext not in _ALLOWED_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: pdf, docx, doc, txt, md"
        )

    raw = await file.read()
    if len(raw) > _MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File must be under 10 MB")

    # Extract text
    try:
        text = extract_text(raw, fname)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not text or not text.strip():
        raise HTTPException(status_code=422, detail="Could not extract any text from the file")

    tid      = tenant["tenant_id"]
    ftype    = file_type_label(fname)
    fsize    = len(raw)
    chunks   = chunk_text(text)

    if not chunks:
        raise HTTPException(status_code=422, detail="File contained no usable text content")

    # Delete previous chunks with the same file_name (re-upload = replace)
    supabase.table("knowledge_base").delete() \
        .eq("tenant_id", tid) \
        .eq("file_name", fname) \
        .execute()

    # Embed and insert each chunk
    inserted = 0
    errors   = 0
    for idx, chunk in enumerate(chunks):
        try:
            embedding = rag._embed(chunk)
            supabase.table("knowledge_base").insert({
                "id":           str(uuid.uuid4()),
                "tenant_id":    tid,
                "content":      chunk,
                "content_type": content_type,
                "metadata":     {"source": fname, "chunk": idx},
                "embedding":    embedding,
                "file_name":    fname,
                "file_type":    ftype,
                "file_size":    fsize,
                "chunk_index":  idx,
            }).execute()
            inserted += 1
        except Exception as exc:
            logger.warning("knowledge upload: chunk %d embed error: %s", idx, exc)
            errors += 1

    if inserted == 0:
        raise HTTPException(status_code=500, detail="Failed to embed any chunks from the file")

    logger.info(
        "Knowledge upload: tenant=%s file=%s chunks=%d/%d content_type=%s",
        tid, fname, inserted, len(chunks), content_type
    )
    return {
        "file_name":    fname,
        "content_type": content_type,
        "chunks":       inserted,
        "errors":       errors,
        "file_size":    fsize,
    }


# ─── Add plain-text document ──────────────────────────────────────────────────
@router.post("/text", status_code=201)
async def add_text_document(
    body:   KnowledgeDocCreate,
    tenant: dict = Depends(get_current_tenant),
):
    """
    Add a plain-text knowledge entry directly (no file upload).
    The text is NOT chunked — it is stored as a single document.
    """
    if body.content_type not in _CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"content_type must be one of: {', '.join(sorted(_CONTENT_TYPES))}"
        )

    try:
        result = rag.add_document(
            tenant_id    = tenant["tenant_id"],
            content      = body.content,
            content_type = body.content_type,
            metadata     = body.metadata or {},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}")

    return result


# ─── Delete all chunks for a file  (MUST be before /{doc_id}) ────────────────
@router.delete("/file/{file_name}", status_code=204)
async def delete_knowledge_file(
    file_name: str,
    tenant: dict = Depends(get_current_tenant),
):
    """Delete ALL chunks that belong to a particular uploaded file."""
    supabase.table("knowledge_base").delete() \
        .eq("tenant_id", tenant["tenant_id"]) \
        .eq("file_name", file_name) \
        .execute()
    return None


# ─── Delete a single chunk ────────────────────────────────────────────────────
@router.delete("/{doc_id}", status_code=204)
async def delete_knowledge_doc(
    doc_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    """Delete a single knowledge-base entry by its UUID."""
    rag.delete_document(tenant["tenant_id"], doc_id)
    return None
