"""
OmniBot SaaS — Webhook Processing Service
Handles incoming Meta (Facebook / Instagram) webhook events:
  1. HMAC-SHA256 signature verification
  2. Tenant lookup via page_id
  3. OTP order-tracking flow (state machine, pre-AI)
  4. Customer image → Gemini Vision → product image search
  5. Text "দেখাও" → product image search + send image
  6. Normal AI reply flow
  7. Reply dispatch via Meta Graph API
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
from app.services.discount_engine import get_discount_context as get_discount_ctx
from app.services.memory_service import MemoryService
from app.services.otp_service import normalize_bd_phone, request_otp, verify_otp
from app.services import image_search_service as img_svc

logger = logging.getLogger(__name__)

META_GRAPH_API = "https://graph.facebook.com/v19.0"
ai_service     = AIService()
memory_service = MemoryService()

# OTP flow trigger keywords
_ORDER_TRACKING_TRIGGERS = [
    "অর্ডার দেখতে চাই", "আমার অর্ডার", "অর্ডার কোথায়",
    "অর্ডার স্ট্যাটাস", "অর্ডার চেক", "order track",
    "order status", "track order", "my order", "check order",
    "আমার প্রোডাক্ট", "ডেলিভারি কবে", "পণ্য কোথায়",
]


# ── Signature Verification ────────────────────────────────────────────────────

def verify_signature(payload_bytes: bytes, signature_header: str) -> bool:
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
    result = (
        supabase.table("connected_pages")
        .select("tenant_id, access_token_encrypted, platform")
        .eq("page_id", page_id)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    return result.data if result is not None else None


# ── Meta Graph API Senders ────────────────────────────────────────────────────

def send_reply(recipient_id: str, text: str, access_token: str) -> bool:
    """Send a plain-text message."""
    try:
        resp = httpx.post(
            f"{META_GRAPH_API}/me/messages",
            json={
                "recipient": {"id": recipient_id},
                "message":   {"text": text},
                "messaging_type": "RESPONSE",
            },
            params={"access_token": access_token},
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"send_reply error to {recipient_id}: {e}")
        return False


def send_image_attachment(recipient_id: str, image_url: str, access_token: str) -> bool:
    """Send an image attachment (reusable) via Meta Graph API."""
    try:
        resp = httpx.post(
            f"{META_GRAPH_API}/me/messages",
            json={
                "recipient": {"id": recipient_id},
                "message": {
                    "attachment": {
                        "type": "image",
                        "payload": {"url": image_url, "is_reusable": True},
                    }
                },
                "messaging_type": "RESPONSE",
            },
            params={"access_token": access_token},
            timeout=15,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"send_image_attachment error to {recipient_id}: {e}")
        return False


# ── Conversation Helpers ──────────────────────────────────────────────────────

def get_or_create_conversation(tenant_id: str, sender_id: str, platform: str) -> dict:
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
        "conversation_id":      str(uuid.uuid4()),
        "tenant_id":            tenant_id,
        "customer_platform_id": sender_id,
        "platform":             platform,
        "is_ai_active":         True,
        "conversation_state":   {},
        "conversation_summary": None,
    }
    created = supabase.table("conversations").insert(new_conv).execute()
    return created.data[0]


def save_message(conversation_id: str, tenant_id: str, role: str, content: str) -> None:
    supabase.table("messages").insert({
        "message_id":      str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "tenant_id":       tenant_id,
        "role":            role,
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
    return result.data if result is not None else {}


def save_order(tenant_id: str, conversation_id: str, sender_id: str, order_data: dict) -> None:
    supabase.table("orders").insert({
        "order_id":             str(uuid.uuid4()),
        "tenant_id":            tenant_id,
        "conversation_id":      conversation_id,
        "customer_platform_id": sender_id,
        "product_name":         order_data.get("product_name"),
        "product_id":           order_data.get("product_id"),
        "quantity":             order_data.get("quantity", 1),
        "agreed_price":         order_data.get("agreed_price"),
        "customer_phone":       order_data.get("customer_phone"),
        "delivery_address":     order_data.get("delivery_address"),
        "notes":                order_data.get("notes"),
        "status":               "pending",
    }).execute()


def _set_conv_state(conversation_id: str, state: dict) -> None:
    supabase.table("conversations").update({
        "conversation_state": state
    }).eq("conversation_id", conversation_id).execute()


# ── OTP Order Tracking Flow ───────────────────────────────────────────────────

def _should_start_tracking(text: str) -> bool:
    t = text.lower()
    return any(trigger in t for trigger in _ORDER_TRACKING_TRIGGERS)


def _get_orders_by_phone(tenant_id: str, phone: str) -> list[dict]:
    result = (
        supabase.table("orders")
        .select("product_name, quantity, agreed_price, status, tracking_number, courier_name, created_at")
        .eq("tenant_id", tenant_id)
        .eq("customer_phone", phone)
        .order("created_at", desc=True)
        .limit(5)
        .execute()
    )
    return result.data or []


def _format_orders_reply(orders: list[dict], phone: str) -> str:
    STATUS_EMOJI = {"pending": "⏳", "confirmed": "✅", "shipped": "🚚", "delivered": "📦", "cancelled": "❌"}
    if not orders:
        return f"✅ পরিচয় নিশ্চিত হয়েছে!\n\n{phone} নম্বরে কোনো অর্ডার পাওয়া যায়নি। নতুন অর্ডার করতে চান?"
    lines = ["✅ আপনার অর্ডার সমূহ:\n"]
    for i, o in enumerate(orders, 1):
        emoji = STATUS_EMOJI.get(o.get("status", ""), "📋")
        lines.append(f"{i}. {o.get('product_name', 'পণ্য')} ({o.get('quantity', 1)}টি)")
        lines.append(f"   {emoji} {o.get('status', 'pending').title()}")
        if o.get("agreed_price"):
            lines.append(f"   💰 ৳{o['agreed_price']:,.0f}")
        if o.get("tracking_number"):
            lines.append(f"   🔍 Tracking: {o['tracking_number']}")
        lines.append("")
    lines.append("আর কোনো সাহায্য লাগবে?")
    return "\n".join(lines)


def _handle_otp_flow(
    tenant_id: str,
    conversation_id: str,
    message_text: str,
    state: dict,
    otp_flow: dict,
    ai_config: dict,
) -> Optional[str]:
    flow_state = otp_flow.get("state")

    if flow_state == "awaiting_phone":
        phone = normalize_bd_phone(message_text)
        if not phone:
            misses = otp_flow.get("misses", 0) + 1
            if misses >= 2:
                _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "otp_flow"})
                return "দুঃখিত, বৈধ ফোন নম্বর পাইনি। অন্য কীভাবে সাহায্য করতে পারি?"
            _set_conv_state(conversation_id, {**state, "otp_flow": {**otp_flow, "misses": misses}})
            return "অনুগ্রহ করে সঠিক বাংলাদেশি ফোন নম্বর দিন (যেমন: 01712345678)"

        ok, err = request_otp(tenant_id, phone, ai_config)
        if not ok:
            _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "otp_flow"})
            return err if "ঘণ্টা" in err else "দুঃখিত, SMS পাঠাতে সমস্যা হয়েছে। একটু পরে চেষ্টা করুন।"

        _set_conv_state(conversation_id, {**state, "otp_flow": {"state": "awaiting_otp", "phone": phone}})
        return (
            f"✅ {phone[:4]}****{phone[-3:]} নম্বরে 6-সংখ্যার OTP পাঠানো হয়েছে।\n"
            f"OTP কোডটি লিখুন (৫ মিনিটের মধ্যে):"
        )

    if flow_state == "awaiting_otp":
        phone     = otp_flow.get("phone", "")
        otp_input = message_text.strip().replace(" ", "")

        if any(w in otp_input.lower() for w in ["বাতিল", "cancel", "back", "restart"]):
            _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "otp_flow"})
            return "ঠিক আছে, বাতিল করা হয়েছে।"

        if not otp_input.isdigit() or len(otp_input) != 6:
            return "অনুগ্রহ করে 6-সংখ্যার OTP কোডটি লিখুন।"

        result = verify_otp(tenant_id, phone, otp_input)
        _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "otp_flow"})

        if result.get("success"):
            return _format_orders_reply(_get_orders_by_phone(tenant_id, phone), phone)
        if result.get("blocked"):
            return "❌ অনেকবার ভুল OTP। ১৫ মিনিট পরে চেষ্টা করুন।"
        if result.get("expired"):
            return "OTP মেয়াদ শেষ। আবার চেষ্টা করতে 'আমার অর্ডার দেখতে চাই' লিখুন।"
        remaining = result.get("remaining_attempts", 0)
        return f"❌ OTP ভুল। আরও {remaining}টি সুযোগ বাকি।"

    return None


# ── Image Search Helpers ──────────────────────────────────────────────────────

async def _handle_customer_image(
    tenant_id: str,
    conversation_id: str,
    sender_id: str,
    image_url: str,
    plain_token: str,
) -> bool:
    """
    Analyze customer's image with Gemini → vector search → send top matches.
    Returns True if handled, False to fall through to AI.
    """
    logger.info(f"Processing customer image for tenant={tenant_id}")
    products = await img_svc.search_by_customer_image(
        tenant_id=tenant_id,
        image_url=image_url,
        access_token=plain_token,
    )
    if not products:
        reply = "আপনার ছবিটি দেখলাম, তবে আমাদের catalog-এ কাছাকাছি পণ্য খুঁজে পাইনি। পণ্যের নাম বলুন।"
        save_message(conversation_id, tenant_id, "bot", reply)
        send_reply(sender_id, reply, plain_token)
        return True

    # Send first product image + text summary
    first = products[0]
    if first.get("image_url"):
        send_image_attachment(sender_id, first["image_url"], plain_token)

    reply = img_svc.format_product_reply(products)
    save_message(conversation_id, tenant_id, "bot", reply)
    send_reply(sender_id, reply, plain_token)
    return True


async def _handle_text_image_request(
    tenant_id: str,
    conversation_id: str,
    sender_id: str,
    message_text: str,
    plain_token: str,
) -> bool:
    """
    "কালো শাড়ি দেখাও" → vector search → send image + details.
    Returns True if handled.
    """
    products = img_svc.search_by_text(tenant_id, message_text)
    if not products:
        return False  # fall through to AI

    # Send primary image of best match
    first = products[0]
    if first.get("image_url"):
        send_image_attachment(sender_id, first["image_url"], plain_token)

    reply = img_svc.format_product_reply(products)
    save_message(conversation_id, tenant_id, "bot", reply)
    send_reply(sender_id, reply, plain_token)
    return True


# ── Main Processor ────────────────────────────────────────────────────────────

async def process_message(
    tenant_id: str,
    page_id: str,
    sender_id: str,
    message_text: str,
    platform: str,
    access_token: str,
    image_urls: Optional[list[str]] = None,
) -> None:
    """Full message pipeline."""

    conv            = get_or_create_conversation(tenant_id, sender_id, platform)
    conversation_id = conv["conversation_id"]

    # Save customer message (use first image URL as content if no text)
    content_to_save = message_text or (f"[Image: {image_urls[0]}]" if image_urls else "")
    if content_to_save:
        save_message(conversation_id, tenant_id, "customer", content_to_save)

    if not conv.get("is_ai_active", True):
        return

    from app.utils.security import decrypt_token
    plain_token = decrypt_token(access_token)

    ai_config = get_ai_config(tenant_id)
    state     = conv.get("conversation_state") or {}
    otp_flow  = state.get("otp_flow")

    # ── 1. OTP Flow ───────────────────────────────────────────────────────────
    if otp_flow and message_text:
        reply = _handle_otp_flow(tenant_id, conversation_id, message_text, state, otp_flow, ai_config)
        if reply:
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
            return

    # ── 2. Customer sent an image ─────────────────────────────────────────────
    if image_urls:
        handled = await _handle_customer_image(
            tenant_id, conversation_id, sender_id, image_urls[0], plain_token
        )
        if handled:
            return

    if not message_text:
        return

    # ── 3. Text "দেখাও" → image search ───────────────────────────────────────
    if ai_config.get("product_image_auto_send") and img_svc.should_trigger_image_search(message_text):
        handled = await _handle_text_image_request(
            tenant_id, conversation_id, sender_id, message_text, plain_token
        )
        if handled:
            return

    # ── 4. OTP order-tracking start ───────────────────────────────────────────
    if _should_start_tracking(message_text) and ai_config.get("sms_enabled"):
        new_state = {**state, "otp_flow": {"state": "awaiting_phone"}}
        _set_conv_state(conversation_id, new_state)
        reply = "আপনার অর্ডার দেখতে আপনার ফোন নম্বরটি দিন (01XXXXXXXXX):"
        save_message(conversation_id, tenant_id, "bot", reply)
        send_reply(sender_id, reply, plain_token)
        return

    # ── 5. Discount context ───────────────────────────────────────────────────
    discount_ctx: dict = {}
    try:
        discount_ctx = get_discount_ctx(tenant_id=tenant_id, customer_platform_id=sender_id)
    except Exception as _de:
        logger.warning(f"Discount engine error: {_de}")

    # ── 6. Normal AI flow ─────────────────────────────────────────────────────
    messages = get_recent_messages(conversation_id)
    summary  = conv.get("conversation_summary")

    result = await ai_service.generate_reply(
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        customer_message=message_text,
        ai_config=ai_config,
        raw_messages=messages,
        conversation_state=state,
        conversation_summary=summary,
        discount_context=discount_ctx,
    )

    reply_text   = result["reply"]
    order_data   = result.get("order_data")
    state_update = result.get("state_update")

    if order_data:
        save_order(tenant_id, conversation_id, sender_id, order_data)
        # Auto-send product image if enabled and product has an image
        if ai_config.get("product_image_auto_send") and order_data.get("product_id"):
            img_url = img_svc.get_primary_image(tenant_id, order_data["product_id"])
            if img_url:
                send_image_attachment(sender_id, img_url, plain_token)

    if state_update:
        memory_service.update_state(conversation_id, state_update)

    save_message(conversation_id, tenant_id, "bot", reply_text)

    try:
        memory_service.maybe_summarise(conversation_id)
    except Exception as e:
        logger.warning(f"Summarise failed: {e}")

    send_reply(sender_id, reply_text, plain_token)
