"""
OmniBot SaaS — Webhook Processing Service
Handles incoming Meta (Facebook / Instagram) webhook events:
  1. HMAC-SHA256 signature verification
  2. Tenant lookup via page_id
  3. Conversation + message persistence
  4. AI reply generation
  5. Reply dispatch via Meta Graph API
"""
import hashlib
import hmac
import json
import logging
import uuid
from typing import Optional

import httpx
from app.config import settings
from app.database import supabase
from app.services.ai_service import AIService
from app.services.memory_service import MemoryService

logger = logging.getLogger(__name__)

META_GRAPH_API = "https://graph.facebook.com/v19.0"
ai_service = AIService()
memory_service = MemoryService()


# ── Signature Verification ───────────────────────────────────────────────────

def verify_signature(payload_bytes: bytes, signature_header: str) -> bool:
    """Verify Meta's X-Hub-Signature-256 header."""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(
        settings.FACEBOOK_APP_SECRET.encode(),
        payload_bytes,
        hashlib.sha256,
    ).hexdigest()
    received = signature_header.split("sha256=", 1)[1]
    return hmac.compare_digest(expected, received)


# ── Tenant Lookup ─────────────────────────────────────────────────────────────

def get_tenant_by_page_id(page_id: str) -> Optional[dict]:
    """Find the tenant who owns a given Meta page_id."""
    result = (
        supabase.table("connected_pages")
        .select("tenant_id, access_token_encrypted, platform")
        .eq("page_id", page_id)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    # maybe_single().execute() returns None when 0 rows found
    return result.data if result is not None else None


# ── Message Sender ────────────────────────────────────────────────────────────

def send_reply(recipient_id: str, reply_text: str, access_token: str) -> bool:
    """POST a text reply to a Facebook/Instagram user via Graph API."""
    url = f"{META_GRAPH_API}/me/messages"
    payload = {
        "recipient": {"id": recipient_id},
        "message":   {"text": reply_text},
        "messaging_type": "RESPONSE",
    }
    try:
        resp = httpx.post(url, json=payload, params={"access_token": access_token}, timeout=10)
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Meta send_reply error to {recipient_id}: {e}")
        return False


# ── Conversation Helpers ──────────────────────────────────────────────────────

def get_or_create_conversation(tenant_id: str, sender_id: str, platform: str) -> dict:
    """Return existing conversation or create a new one."""
    result = (
        supabase.table("conversations")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("customer_platform_id", sender_id)
        .eq("platform", platform)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if result.data:
        return result.data[0]

    new_conv = {
        "conversation_id":    str(uuid.uuid4()),
        "tenant_id":          tenant_id,
        "customer_platform_id": sender_id,
        "platform":           platform,
        "is_ai_active":       True,
        "conversation_state": {},
        "conversation_summary": None,
    }
    created = supabase.table("conversations").insert(new_conv).execute()
    return created.data[0]


def save_message(conversation_id: str, tenant_id: str, role: str, content: str) -> None:
    supabase.table("messages").insert({
        "message_id":      str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "tenant_id":       tenant_id,
        "role":            role,    # customer | bot
        "content":         content,
    }).execute()


def get_recent_messages(conversation_id: str, limit: int = 30) -> list[dict]:
    result = (
        supabase.table("messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .limit(limit)
        .execute()
    )
    return result.data or []


def get_ai_config(tenant_id: str) -> dict:
    result = (
        supabase.table("ai_config")
        .select("*")
        .eq("tenant_id", tenant_id)
        .maybe_single()
        .execute()
    )
    # maybe_single().execute() returns None when 0 rows found
    return result.data if result is not None else {}


def save_order(tenant_id: str, conversation_id: str, sender_id: str, order_data: dict) -> None:
    supabase.table("orders").insert({
        "order_id":           str(uuid.uuid4()),
        "tenant_id":          tenant_id,
        "conversation_id":    conversation_id,
        "customer_platform_id": sender_id,
        "product_name":       order_data.get("product_name"),
        "product_id":         order_data.get("product_id"),
        "quantity":           order_data.get("quantity", 1),
        "agreed_price":       order_data.get("agreed_price"),
        "customer_phone":     order_data.get("customer_phone"),
        "delivery_address":   order_data.get("delivery_address"),
        "notes":              order_data.get("notes"),
        "status":             "pending",
    }).execute()


# ── Main Processor ────────────────────────────────────────────────────────────

async def process_message(
    tenant_id: str,
    page_id: str,
    sender_id: str,
    message_text: str,
    platform: str,
    access_token: str,
) -> None:
    """
    Full pipeline: save message → AI reply → save reply → send reply.
    Skipped silently if AI is disabled (manual takeover mode).
    """
    # 1. Get/create conversation
    conv = get_or_create_conversation(tenant_id, sender_id, platform)
    conversation_id = conv["conversation_id"]

    # 2. Save customer message
    save_message(conversation_id, tenant_id, "customer", message_text)

    # 3. Skip AI if owner has taken over
    if not conv.get("is_ai_active", True):
        logger.info(f"AI disabled for conv {conversation_id} — skipping reply")
        return

    # 4. Fetch context
    ai_config   = get_ai_config(tenant_id)
    messages    = get_recent_messages(conversation_id)
    state       = conv.get("conversation_state") or {}
    summary     = conv.get("conversation_summary")

    # 5. Generate AI reply
    result = await ai_service.generate_reply(
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        customer_message=message_text,
        ai_config=ai_config,
        raw_messages=messages,
        conversation_state=state,
        conversation_summary=summary,
    )

    reply_text   = result["reply"]
    order_data   = result.get("order_data")
    state_update = result.get("state_update")

    # 6. Save extracted order if any
    if order_data:
        save_order(tenant_id, conversation_id, sender_id, order_data)
        logger.info(f"Order extracted for tenant {tenant_id}: {order_data}")

    # 7. Update structured state if any
    if state_update:
        memory_service.update_state(conversation_id, state_update)

    # 8. Save bot reply
    save_message(conversation_id, tenant_id, "bot", reply_text)

    # 9. Possibly trigger summarisation (async, non-blocking)
    try:
        memory_service.maybe_summarise(conversation_id)
    except Exception as e:
        logger.warning(f"Summarise failed (non-critical): {e}")

    # 10. Send reply via Meta Graph API
    from app.utils.security import decrypt_token
    plain_token = decrypt_token(access_token)
    send_reply(sender_id, reply_text, plain_token)
