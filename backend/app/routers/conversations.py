"""
OmniBot SaaS — Conversations Router
List conversations, view messages, and toggle AI / manual takeover.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import TakeoverRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
async def list_conversations(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("conversations")
        .select("*, messages(count)")
        .eq("tenant_id", tenant["tenant_id"])
        .order("updated_at", desc=True)
        .limit(100)
        .execute()
    )
    return result.data or []


@router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    result = (
        supabase.table("conversations")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .eq("conversation_id", conversation_id)
        .maybe_single()
        .execute()
    )
    # maybe_single().execute() returns None when 0 rows found
    data = result.data if (result is not None and hasattr(result, 'data')) else result
    if data is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return data


@router.get("/{conversation_id}/messages")
async def get_messages(
    conversation_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    # Verify ownership
    conv = (
        supabase.table("conversations")
        .select("conversation_id")
        .eq("tenant_id", tenant["tenant_id"])
        .eq("conversation_id", conversation_id)
        .maybe_single()
        .execute()
    )
    conv_data = conv.data if (conv is not None and hasattr(conv, 'data')) else conv
    if conv_data is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    msgs = (
        supabase.table("messages")
        .select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .execute()
    )
    return msgs.data or []


@router.patch("/{conversation_id}/takeover")
async def toggle_takeover(
    conversation_id: str,
    body: TakeoverRequest,
    tenant: dict = Depends(get_current_tenant),
):
    """Enable / disable AI for a conversation (manual takeover)."""
    # Pro / Enterprise only
    if tenant["plan"] == "starter":
        raise HTTPException(status_code=403, detail="Manual takeover requires Pro plan or higher")

    result = (
        supabase.table("conversations")
        .update({"is_ai_active": body.is_ai_active})
        .eq("tenant_id", tenant["tenant_id"])
        .eq("conversation_id", conversation_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Conversation not found")

    status_str = "AI enabled" if body.is_ai_active else "Manual takeover active"
    return {"message": status_str, "is_ai_active": body.is_ai_active}
