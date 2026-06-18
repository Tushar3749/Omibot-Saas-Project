"""
OmniBot SaaS — AI Instructions Router
Per-tenant instruction cards that get injected into the system prompt.

Endpoints:
  GET    /    list all instructions (ordered by sort_order, created_at)
  POST   /    create instruction
  PUT    /{id}  update instruction
  DELETE /{id}  delete instruction
"""
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_tenant
from app.database import supabase

logger = logging.getLogger(__name__)
router = APIRouter()


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


@router.post("/")
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


@router.delete("/{instruction_id}")
async def delete_instruction(
    instruction_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    supabase.table("ai_instructions").delete().eq("id", instruction_id).eq("tenant_id", tenant["tenant_id"]).execute()
    return {"ok": True}
