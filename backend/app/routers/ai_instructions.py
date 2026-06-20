"""
OmniBot SaaS — AI Instructions Router
Per-tenant instruction cards + AI-generated knowledge summary.

Static routes come BEFORE parameterised routes to avoid FastAPI path conflicts.

  GET    /                   list all instructions (ordered)
  POST   /                   create instruction
  GET    /summary             read saved ai_summary from ai_config
  POST   /generate-summary   Gemini-merge all instructions + KB docs → save
  PUT    /{instruction_id}   update instruction text / order
  DELETE /{instruction_id}   delete instruction
"""
import json
import logging
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_tenant
from app.config import settings
from app.database import supabase

from google import genai as _genai

logger = logging.getLogger(__name__)
router = APIRouter()

_client = _genai.Client(api_key=settings.GEMINI_API_KEY)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class InstructionCreate(BaseModel):
    title: str
    body: str
    sort_order: int = 0
    is_active: bool = True


class InstructionUpdate(BaseModel):
    title:       Optional[str]  = None
    body:        Optional[str]  = None
    sort_order:  Optional[int]  = None
    is_active:   Optional[bool] = None


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_instructions(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("ai_instructions")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("sort_order")
        .order("created_at")
        .execute()
    )
    return result.data or []


# ── Get saved summary (static — must come before /{instruction_id}) ──────────

@router.get("/summary")
async def get_summary(tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    res = (
        supabase.table("ai_config")
        .select("ai_summary, ai_summary_points, ai_summary_updated_at")
        .eq("tenant_id", tid)
        .maybe_single()
        .execute()
    )
    data = res.data or {}
    return {
        "summary_text":          data.get("ai_summary") or "",
        "display_points":        data.get("ai_summary_points") or [],
        "ai_summary_updated_at": data.get("ai_summary_updated_at"),
    }


# ── Generate summary with Gemini (static — must come before /{instruction_id}) ─

@router.post("/generate-summary")
async def generate_summary(tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]

    # 1. All active text instructions
    instr_res = (
        supabase.table("ai_instructions")
        .select("title, body, sort_order")
        .eq("tenant_id", tid)
        .eq("is_active", True)
        .order("sort_order")
        .execute()
    )
    instructions = instr_res.data or []

    # 2. All non-product knowledge-base chunks, capped to avoid token overrun
    doc_res = (
        supabase.table("knowledge_base")
        .select("content, content_type, file_name, chunk_index")
        .eq("tenant_id", tid)
        .neq("content_type", "product")
        .order("file_name")
        .order("chunk_index")
        .limit(80)
        .execute()
    )
    doc_chunks = [r.get("content") or "" for r in (doc_res.data or []) if r.get("content")]

    if not instructions and not doc_chunks:
        raise HTTPException(
            status_code=422,
            detail="কোনো নির্দেশনা বা ডকুমেন্ট পাওয়া যায়নি। আগে কিছু যোগ করুন।"
        )

    # 3. Build Gemini prompt
    parts: list[str] = []
    if instructions:
        lines = "\n".join(
            f"• [{inst['title']}] {inst['body']}"
            for inst in instructions
            if inst.get("title") and inst.get("body")
        )
        parts.append(f"=== OWNER RULES ===\n{lines}")
    if doc_chunks:
        parts.append("=== UPLOADED DOCUMENTS ===\n" + "\n\n".join(doc_chunks[:40]))

    gemini_prompt = (
        "You are an AI trainer. A Bangladeshi shop owner has uploaded the following rules "
        "and documents to teach their chatbot how to behave.\n\n"
        + "\n\n".join(parts)
        + "\n\nMerge, deduplicate, and structure these into a clean bot knowledge summary. "
        "Write in Bangla. Return ONLY valid JSON — no markdown, no extra text:\n"
        '{"summary_text": "2-3 sentence overview in Bangla", '
        '"display_points": ["✅ Point 1 in Bangla", "📦 Point 2", "...up to 8 emoji bullet points"], '
        f'"rules_count": {len(instructions)}, '
        f'"merged_count": {len(instructions) + len(doc_chunks)}}}'
    )

    try:
        response = _client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=gemini_prompt,
        )
        raw = (response.text or "").strip()
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
        result = json.loads(raw)
    except Exception as exc:
        logger.warning(f"generate_summary Gemini call failed: {exc}")
        raise HTTPException(status_code=500, detail=f"AI সারাংশ তৈরিতে সমস্যা হয়েছে: {exc}")

    summary_text   = result.get("summary_text") or ""
    display_points = result.get("display_points") or []
    rules_count    = result.get("rules_count", len(instructions))
    merged_count   = result.get("merged_count", len(instructions) + len(doc_chunks))

    # 4. Upsert into ai_config
    existing = (
        supabase.table("ai_config")
        .select("tenant_id")
        .eq("tenant_id", tid)
        .maybe_single()
        .execute()
    )
    payload = {
        "ai_summary":            summary_text,
        "ai_summary_points":     display_points,
        "ai_summary_updated_at": "now()",
    }
    if existing.data:
        supabase.table("ai_config").update(payload).eq("tenant_id", tid).execute()
    else:
        supabase.table("ai_config").insert({"tenant_id": tid, **payload}).execute()

    logger.info(f"generate_summary: tenant={tid} rules={rules_count} merged={merged_count}")
    return {
        "summary_text":   summary_text,
        "display_points": display_points,
        "rules_count":    rules_count,
        "merged_count":   merged_count,
    }


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/", status_code=201)
async def create_instruction(body: InstructionCreate, tenant: dict = Depends(get_current_tenant)):
    row = {
        "id":         str(uuid.uuid4()),
        "tenant_id":  tenant["tenant_id"],
        "title":      body.title.strip(),
        "body":       body.body.strip(),
        "sort_order": body.sort_order,
        "is_active":  body.is_active,
    }
    if not row["title"] or not row["body"]:
        raise HTTPException(status_code=422, detail="title এবং body আবশ্যক")
    result = supabase.table("ai_instructions").insert(row).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Instruction তৈরি করা যায়নি")
    return result.data[0]


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{instruction_id}")
async def update_instruction(
    instruction_id: str,
    body: InstructionUpdate,
    tenant: dict = Depends(get_current_tenant),
):
    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="আপডেট করার কোনো ডেটা নেই")
    if "title" in update_data:
        update_data["title"] = update_data["title"].strip()
    if "body" in update_data:
        update_data["body"] = update_data["body"].strip()
    result = (
        supabase.table("ai_instructions")
        .update(update_data)
        .eq("id", instruction_id)
        .eq("tenant_id", tenant["tenant_id"])
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Instruction পাওয়া যায়নি")
    return result.data[0]


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{instruction_id}", status_code=204)
async def delete_instruction(
    instruction_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    supabase.table("ai_instructions").delete() \
        .eq("id", instruction_id) \
        .eq("tenant_id", tenant["tenant_id"]) \
        .execute()
    return None
