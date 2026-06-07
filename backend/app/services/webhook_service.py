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
from datetime import datetime, timezone, timedelta
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

# ── Order flow trigger keywords ───────────────────────────────────────────────

_ORDER_TRIGGERS = [
    "অর্ডার করতে চাই", "অর্ডার করব", "অর্ডার দিতে চাই", "অর্ডার করি",
    "কিনতে চাই", "কিনব", "নিতে চাই", "নেব", "নিয়ে যাব",
    "বুক করব", "বুকিং দিতে চাই", "অর্ডার করতে চাইছি",
    "order korte chai", "order debo", "buy korbo", "nite chai",
]


def _is_order_trigger(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in _ORDER_TRIGGERS)


# ── Return flow trigger keywords ──────────────────────────────────────────────

_RETURN_TRIGGERS = [
    "নষ্ট", "ভাঙা", "ভুল পণ্য", "ফেরত", "রিটার্ন",
    "damaged", "wrong product", "return",
    "ফেরত দিতে চাই", "পণ্য ফেরত", "return করতে চাই",
]


def _is_return_trigger(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in _RETURN_TRIGGERS)


# ── Abuse & sentiment detection ───────────────────────────────────────────────

_ABUSE_WORDS = [
    "হেডা", "বাল", "মাগি", "মাগী", "চোদা", "মাদারচোদ", "শালা", "হারামি",
    "বেশ্যা", "গাধা", "বোকাচোদা", "খানকি", "কুত্তা", "শুওরের বাচ্চা",
    "shala", "harami", "madarchod", "khankir",
]

_ANGRY_KEYWORDS    = ["কেন", "কবে", "কই", "বলছ না", "দিচ্ছ না", "কেন দিচ্ছ না", "কোথায় গেল"]
_FRUSTRATED_KEYWORDS = ["আবার", "এখনো", "কতক্ষণ", "বুঝছ না", "বুঝলে না", "আগেও বললাম", "কতবার বলব"]


def _detect_abuse(text: str) -> bool:
    t = text.lower()
    return any(w.lower() in t for w in _ABUSE_WORDS)


def _detect_sentiment(text: str) -> str:
    """Returns 'angry', 'frustrated', or '' based on message heuristics."""
    t = text.strip()
    exclaim_count = t.count("!") + t.count("！")
    caps_ratio    = sum(1 for c in t if c.isupper()) / max(len(t), 1)
    if exclaim_count >= 2 or caps_ratio > 0.4 or any(k in t for k in _ANGRY_KEYWORDS):
        return "angry"
    if any(k in t for k in _FRUSTRATED_KEYWORDS):
        return "frustrated"
    return ""


def _get_delivered_orders_for_return(tenant_id: str, phone: str, window_days: int) -> list[dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()
    result = (
        supabase.table("orders")
        .select("order_id, product_name, product_id, quantity, agreed_price, created_at, status")
        .eq("tenant_id", tenant_id)
        .eq("customer_phone", phone)
        .eq("status", "delivered")
        .gte("created_at", cutoff)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )
    return result.data or []


def _order_already_returned(tenant_id: str, order_id: str) -> bool:
    try:
        result = (
            supabase.table("returns")
            .select("return_id")
            .eq("tenant_id", tenant_id)
            .eq("order_id", order_id)
            .maybe_single()
            .execute()
        )
        return result is not None and result.data is not None
    except Exception:
        return False


def _within_return_window(order_created_at: str, window_days: int) -> bool:
    try:
        created = datetime.fromisoformat(order_created_at.replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return created >= datetime.now(timezone.utc) - timedelta(days=window_days)
    except Exception:
        return True


def _get_product_weight(tenant_id: str, product_id: str) -> str:
    if not product_id:
        return ""
    try:
        res = (
            supabase.table("products")
            .select("weight")
            .eq("product_id", product_id)
            .maybe_single()
            .execute()
        )
        return (res.data or {}).get("weight") or "" if res else ""
    except Exception:
        return ""


def _save_return_request(
    tenant_id: str, order_id: str, phone: str,
    return_type: str, items: list,
) -> str:
    return_id = str(uuid.uuid4())
    short_id  = return_id.replace("-", "")[:8].upper()
    supabase.table("returns").insert({
        "return_id":      return_id,
        "tenant_id":      tenant_id,
        "order_id":       order_id,
        "customer_phone": phone,
        "return_type":    return_type,
        "status":         "pending",
        "items":          items,
    }).execute()
    return f"RET-{short_id}"


def _fmt_order_date(created_at: str) -> str:
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return dt.strftime("%d %b")
    except Exception:
        return created_at[:10]


def _handle_return_flow(
    tenant_id: str,
    conversation_id: str,
    message_text: str,
    state: dict,
    return_flow: dict,
    ai_config: dict,
) -> Optional[str]:
    """
    Return-request state machine.
    Returns reply text, or None if this state doesn't consume the message.
    """
    flow_state  = return_flow.get("state", "")
    msg         = message_text.strip()
    msg_lower   = msg.lower()
    window_days = int(return_flow.get("window_days") or ai_config.get("return_window_days") or 7)

    # Universal cancel
    if any(w in msg_lower for w in ["বাতিল", "cancel"]):
        _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
        return "রিটার্ন প্রক্রিয়া বাতিল করা হয়েছে।"

    # ── STEP 1: Collect phone ─────────────────────────────────────────────────
    if flow_state == "asking_phone":
        phone  = normalize_bd_phone(msg)
        misses = return_flow.get("misses", 0)
        if not phone:
            misses += 1
            if misses >= 3:
                _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
                return "দুঃখিত, বৈধ ফোন নম্বর পাইনি। অন্য সাহায্য লাগলে বলুন।"
            _set_conv_state(conversation_id, {**state, "return_flow": {**return_flow, "misses": misses}})
            return "সঠিক বাংলাদেশি ফোন নম্বর দিন (যেমন: 01712345678)"
        _set_conv_state(conversation_id, {**state, "return_flow": {
            **return_flow, "state": "asking_order_known", "phone": phone, "misses": 0,
        }})
        return "আপনার Order ID জানা আছে? (হ্যাঁ / না)"

    # ── STEP 2: Know order ID? ────────────────────────────────────────────────
    if flow_state == "asking_order_known":
        yes = any(w in msg_lower for w in ["হ্যাঁ", "হা", "yes", "জানি", "আছে", "হ্যা"])
        no  = any(w in msg_lower for w in ["না", "no", "নেই", "মনে নেই", "জানি না", "জানিনা"])
        if yes:
            _set_conv_state(conversation_id, {**state, "return_flow": {
                **return_flow, "state": "asking_order_id", "misses": 0,
            }})
            return "Order ID টি দিন:"
        if no:
            _set_conv_state(conversation_id, {**state, "return_flow": {
                **return_flow, "state": "asking_product_name", "misses": 0,
            }})
            return "ঠিক আছে। পণ্যের নাম বলুন (যেমন: মধু ৫০০ গ্রাম, সরিষার তেল):"
        return "অনুগ্রহ করে 'হ্যাঁ' অথবা 'না' বলুন।"

    # ── STEP 3a: Explicit order ID ────────────────────────────────────────────
    if flow_state == "asking_order_id":
        phone     = return_flow.get("phone", "")
        misses    = return_flow.get("misses", 0)
        order_in  = msg.strip()

        res = (
            supabase.table("orders")
            .select("order_id,product_name,product_id,quantity,agreed_price,created_at,status,customer_phone")
            .eq("tenant_id", tenant_id)
            .eq("order_id", order_in)
            .maybe_single()
            .execute()
        )
        order = res.data if res and res.data else None

        if not order:
            misses += 1
            if misses >= 3:
                _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
                return "এই Order ID পাওয়া যায়নি। রিটার্ন প্রক্রিয়া বাতিল।"
            _set_conv_state(conversation_id, {**state, "return_flow": {**return_flow, "misses": misses}})
            return f"এই Order ID পাওয়া যায়নি। আবার চেষ্টা করুন। ({3 - misses}টি সুযোগ বাকি)"

        if order.get("customer_phone") != phone:
            misses += 1
            if misses >= 3:
                _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
                return "এই অর্ডারটি আপনার ফোন নম্বরের সাথে মিলছে না।"
            _set_conv_state(conversation_id, {**state, "return_flow": {**return_flow, "misses": misses}})
            return "এই অর্ডারটি আপনার ফোন নম্বরে নেই। অন্য Order ID দিন।"

        if order.get("status") != "delivered":
            _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
            return "শুধুমাত্র ডেলিভারি হয়ে যাওয়া অর্ডার ফেরত দেওয়া যায়।"

        if not _within_return_window(order["created_at"], window_days):
            _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
            return f"দুঃখিত, এই অর্ডারের রিটার্ন উইন্ডো ({window_days} দিন) পার হয়ে গেছে।"

        if _order_already_returned(tenant_id, order["order_id"]):
            _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
            return "এই অর্ডারে আগেই রিটার্ন রিকোয়েস্ট করা হয়েছে।"

        return _go_to_full_partial(conversation_id, state, return_flow, order, tenant_id)

    # ── STEP 3b: Search by product name ──────────────────────────────────────
    if flow_state == "asking_product_name":
        phone  = return_flow.get("phone", "")
        orders = _get_delivered_orders_for_return(tenant_id, phone, window_days)

        if not orders:
            _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
            return f"গত {window_days} দিনে ডেলিভারি হওয়া কোনো অর্ডার পাওয়া যায়নি।"

        # Filter by name similarity; fall back to all
        filtered = [o for o in orders if msg_lower in o.get("product_name", "").lower()]
        if not filtered:
            filtered = orders

        if len(filtered) == 1:
            # Skip the list, go directly
            order = filtered[0]
            if _order_already_returned(tenant_id, order["order_id"]):
                _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
                return "এই অর্ডারে আগেই রিটার্ন রিকোয়েস্ট করা হয়েছে।"
            return _go_to_full_partial(conversation_id, state, return_flow, order, tenant_id)

        lines = ["আপনার সাম্প্রতিক অর্ডারগুলো:\n"]
        for i, o in enumerate(filtered[:5], 1):
            lines.append(f"{i}. {o.get('product_name', 'পণ্য')} ({_fmt_order_date(o.get('created_at', ''))})")
        lines.append("\nকোন অর্ডারটি ফেরত দিতে চান? নম্বর বলুন।")

        _set_conv_state(conversation_id, {**state, "return_flow": {
            **return_flow, "state": "showing_orders", "recent_orders": filtered[:5], "misses": 0,
        }})
        return "\n".join(lines)

    # ── STEP 3c: Pick from list ───────────────────────────────────────────────
    if flow_state == "showing_orders":
        orders = return_flow.get("recent_orders", [])
        try:
            idx = int(msg.strip()) - 1
            if not (0 <= idx < len(orders)):
                raise ValueError()
        except (ValueError, TypeError):
            return f"১ থেকে {len(orders)} এর মধ্যে নম্বর বলুন।"

        order = orders[idx]
        if _order_already_returned(tenant_id, order["order_id"]):
            _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
            return "এই অর্ডারে আগেই রিটার্ন রিকোয়েস্ট করা হয়েছে।"

        return _go_to_full_partial(conversation_id, state, return_flow, order, tenant_id)

    # ── STEP 4: Full or partial ───────────────────────────────────────────────
    if flow_state == "asking_full_partial":
        order = return_flow.get("order", {})
        qty   = order.get("quantity", 1)

        is_full    = any(w in msg_lower for w in ["সম্পূর্ণ", "পুরো", "full", "সব", "সকল"])
        is_partial = any(w in msg_lower for w in ["আংশিক", "কিছু", "partial", "নির্দিষ্ট"])

        if is_full or qty == 1:
            _set_conv_state(conversation_id, {**state, "return_flow": {
                **return_flow, "state": "asking_reason", "return_type": "full", "return_quantity": qty,
            }})
            return "কারণ বলুন (নষ্ট / ভুল পণ্য / অন্য কারণ):"

        if is_partial:
            _set_conv_state(conversation_id, {**state, "return_flow": {
                **return_flow, "state": "asking_partial_qty", "return_type": "partial",
            }})
            return f"কতটি ফেরত দিতে চান?\n(অর্ডার ছিল {qty}টি, ১ থেকে {qty - 1} এর মধ্যে)"

        return "অনুগ্রহ করে 'সম্পূর্ণ' বা 'আংশিক' বলুন।"

    # ── STEP 4b: Partial quantity ─────────────────────────────────────────────
    if flow_state == "asking_partial_qty":
        max_qty = return_flow.get("order", {}).get("quantity", 1)
        try:
            return_qty = int(msg.strip())
            if not (1 <= return_qty < max_qty):
                raise ValueError()
        except (ValueError, TypeError):
            return f"সঠিক সংখ্যা দিন (১ থেকে {max_qty - 1})"

        _set_conv_state(conversation_id, {**state, "return_flow": {
            **return_flow, "state": "asking_reason", "return_quantity": return_qty,
        }})
        return "কারণ বলুন (নষ্ট / ভুল পণ্য / অন্য কারণ):"

    # ── STEP 5: Reason ────────────────────────────────────────────────────────
    if flow_state == "asking_reason":
        if len(msg.strip()) < 2:
            return "অনুগ্রহ করে কারণটি বলুন।"

        order        = return_flow.get("order", {})
        return_type  = return_flow.get("return_type", "full")
        return_qty   = return_flow.get("return_quantity", order.get("quantity", 1))
        product_name = order.get("product_name", "পণ্য")
        weight       = _get_product_weight(tenant_id, order.get("product_id", ""))
        item_label   = f"{product_name}{' ' + weight if weight else ''} × {return_qty}"
        order_id     = order.get("order_id", "")
        type_label   = "সম্পূর্ণ" if return_type == "full" else "আংশিক"

        _set_conv_state(conversation_id, {**state, "return_flow": {
            **return_flow, "state": "confirming", "reason": msg.strip(),
        }})
        return (
            f"নিশ্চিত করুন:\n"
            f"📦 অর্ডার: #{order_id[:8]}\n"
            f"🔄 ফেরতের ধরন: {type_label}\n"
            f"📋 পণ্য: {item_label}\n"
            f"📝 কারণ: {msg.strip()}\n\n"
            f"সঠিক হলে 'হ্যাঁ' বলুন, বাতিল করতে 'না' বলুন।"
        )

    # ── STEP 6: Confirm & save ────────────────────────────────────────────────
    if flow_state == "confirming":
        yes = any(w in msg_lower for w in ["হ্যাঁ", "হা", "yes", "ঠিক", "confirm", "হ্যা"])
        no  = any(w in msg_lower for w in ["না", "no", "বাতিল"])

        if no:
            _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
            return "রিটার্ন রিকোয়েস্ট বাতিল করা হয়েছে।"

        if yes:
            order        = return_flow.get("order", {})
            return_type  = return_flow.get("return_type", "full")
            return_qty   = return_flow.get("return_quantity", order.get("quantity", 1))
            reason       = return_flow.get("reason", "")
            phone        = return_flow.get("phone", "")
            order_id     = order.get("order_id", "")
            product_id   = order.get("product_id", "")
            product_name = order.get("product_name", "পণ্য")
            weight       = _get_product_weight(tenant_id, product_id)

            try:
                sku_res = (
                    supabase.table("products").select("sku")
                    .eq("product_id", product_id).maybe_single().execute()
                )
                sku = (sku_res.data or {}).get("sku", "") if sku_res else ""
            except Exception:
                sku = ""

            items = [{
                "product_id": product_id,
                "sku":        sku,
                "name":       product_name,
                "weight":     weight,
                "quantity":   return_qty,
                "reason":     reason,
            }]
            try:
                ret_label = _save_return_request(tenant_id, order_id, phone, return_type, items)
            except Exception as exc:
                logger.error(f"Return save failed: {exc}")
                _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
                return "দুঃখিত, রিটার্ন সংরক্ষণ করতে সমস্যা হয়েছে। একটু পরে চেষ্টা করুন।"

            _set_conv_state(conversation_id, {k: v for k, v in state.items() if k != "return_flow"})
            return (
                f"✅ আপনার রিটার্ন রিকোয়েস্ট ({ret_label}) নেওয়া হয়েছে।\n"
                f"আমরা শীঘ্রই যোগাযোগ করব।"
            )

        return "অনুগ্রহ করে 'হ্যাঁ' বা 'না' বলুন।"

    return None


def _go_to_full_partial(
    conversation_id: str,
    state: dict,
    return_flow: dict,
    order: dict,
    tenant_id: str,
) -> str:
    """Build the full/partial choice prompt and update state."""
    product_name = order.get("product_name", "পণ্য")
    quantity     = order.get("quantity", 1)
    weight       = _get_product_weight(tenant_id, order.get("product_id", ""))
    item_label   = f"{product_name}{' ' + weight if weight else ''} × {quantity}"

    _set_conv_state(conversation_id, {**state, "return_flow": {
        **return_flow, "state": "asking_full_partial", "order": order, "misses": 0,
    }})
    return (
        f"এই অর্ডারে ছিল:\n1. {item_label}\n\n"
        f"পুরো অর্ডার ফেরত দিতে চান নাকি আংশিক?\n"
        f"(সম্পূর্ণ / আংশিক)"
    )


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


def send_quick_reply(recipient_id: str, text: str, quick_replies: list, access_token: str) -> bool:
    """Send a message with Quick Reply buttons."""
    try:
        resp = httpx.post(
            f"{META_GRAPH_API}/me/messages",
            json={
                "recipient": {"id": recipient_id},
                "message": {
                    "text": text,
                    "quick_replies": quick_replies,
                },
                "messaging_type": "RESPONSE",
            },
            params={"access_token": access_token},
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"send_quick_reply error to {recipient_id}: {e}")
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


def _generate_discount_code() -> str:
    import random
    import string
    today = datetime.now().strftime("%Y%m%d")
    chars = string.ascii_uppercase + string.digits
    rand_part = "".join(random.choices(chars, k=4))
    return f"DISC-{today}-{rand_part}"


def _gen_order_ref() -> str:
    import random
    today = datetime.now().strftime("%Y%m%d")
    return f"ORD-{today}-{random.randint(0, 9999):04d}"


_CONFIRM_QR_BUTTONS = [
    {"content_type": "text", "title": "✅ নিশ্চিত করুন", "payload": "ORDER_CONFIRM"},
    {"content_type": "text", "title": "❌ বাতিল",        "payload": "ORDER_CANCEL"},
]

_ORDER_FLOW_KEYS  = ("order_flow", "cart", "customer_name", "customer_phone", "delivery_address")
_INTERRUPT_KEYS   = ("order_flow_interrupted", "interrupted_question", "order_flow_paused")
_ALL_FLOW_KEYS    = _ORDER_FLOW_KEYS + _INTERRUPT_KEYS

_INTERRUPT_QR_BUTTONS = [
    {"content_type": "text", "title": "বের হই",           "payload": "EXIT_FLOW_ANSWER"},
    {"content_type": "text", "title": "অর্ডার চালিয়ে যাই", "payload": "CONTINUE_ORDER"},
]


def _get_step_question(step: str) -> str:
    return {
        "collecting_name":    "আপনার নাম কী?",
        "collecting_phone":   "📞 আপনার ফোন নম্বর দিন (01XXXXXXXXX):",
        "collecting_address": "📍 ডেলিভারি ঠিকানা দিন (বাড়ি/গ্রাম, থানা, জেলা):",
        "confirming":         "অর্ডার নিশ্চিত করতে 'হ্যাঁ' লিখুন অথবা বাতিল করতে 'বাতিল' লিখুন।",
    }.get(step, "অর্ডার চালিয়ে যান।")


def _is_expected_answer(step: str, msg: str, payload: str) -> bool:
    """True if msg is a plausible direct answer for the current order step (not a side question)."""
    if payload in ("ORDER_CONFIRM", "ORDER_CANCEL", "EXIT_FLOW_ANSWER", "CONTINUE_ORDER"):
        return True
    if not msg:
        return False
    if "?" in msg or "？" in msg:
        return False
    msg_lower = msg.lower()
    if step == "collecting_name":
        return 2 <= len(msg) <= 60
    if step == "collecting_phone":
        digits = "".join(c for c in msg if c.isdigit())
        return len(digits) >= 8
    if step == "collecting_address":
        question_kws = ["কত", "কেন", "কীভাবে", "কিভাবে", "কখন", "কবে", "পাঠাবেন", "চার্জ"]
        return len(msg) >= 5 and not any(k in msg_lower for k in question_kws)
    if step == "confirming":
        words = ["হ্যাঁ", "হা", "yes", "নিশ্চিত", "confirm", "ok", "ঠিক আছে", "হ্যা",
                 "না", "no", "বাতিল", "cancel"]
        return any(w in msg_lower for w in words)
    return True


def _extract_product_for_order(tenant_id: str, message_text: str, state: dict) -> dict:
    """
    Returns {product_id, name, price, qty} or {} if nothing found.
    Checks conversation_state.interested_product first, then keyword-searches products table.
    """
    interested = state.get("interested_product")
    neg_price  = state.get("negotiated_price")

    if interested:
        try:
            res = (
                supabase.table("products")
                .select("product_id, name, mrp")
                .eq("tenant_id", tenant_id)
                .ilike("name", f"%{interested}%")
                .limit(1)
                .execute()
            )
            if res and res.data:
                p = res.data[0]
                return {
                    "product_id": p["product_id"],
                    "name":       p["name"],
                    "price":      float(neg_price or p.get("mrp") or 0),
                    "qty":        1,
                }
        except Exception:
            pass
        return {
            "product_id": None,
            "name":       interested,
            "price":      float(neg_price or 0),
            "qty":        1,
        }

    # Fallback: keyword match against active products
    try:
        all_prods = (
            supabase.table("products")
            .select("product_id, name, mrp")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .limit(80)
            .execute()
        ).data or []
        msg_lower = message_text.lower()
        for p in all_prods:
            name_lower = (p.get("name") or "").lower()
            words = [w for w in name_lower.split() if len(w) > 2]
            if words and any(w in msg_lower for w in words):
                return {
                    "product_id": p["product_id"],
                    "name":       p["name"],
                    "price":      float(neg_price or p.get("mrp") or 0),
                    "qty":        1,
                }
    except Exception:
        pass

    return {}


async def _handle_strict_order_flow(
    tenant_id: str,
    conversation_id: str,
    sender_id: str,
    message_text: str,
    quick_reply_payload: Optional[str],
    state: dict,
    plain_token: str,
    ai_config: dict,
) -> bool:
    """
    Strict order collection state machine.
    conversation_state.order_flow is a plain string:
      collecting_name → collecting_phone → collecting_address → confirming
    Returns True when the message is consumed (caller must return immediately).
    Returns False only for an unrecognised step (state is cleared; caller may fall through).
    """
    step      = state.get("order_flow", "")
    msg       = (message_text or "").strip()
    msg_lower = msg.lower()
    payload   = quick_reply_payload or ""

    def _cancel(reason: str = "❌ অর্ডার বাতিল করা হয়েছে।"):
        clean = {k: v for k, v in state.items() if k not in _ALL_FLOW_KEYS}
        _set_conv_state(conversation_id, clean)
        save_message(conversation_id, tenant_id, "bot", reason)
        send_reply(sender_id, reason, plain_token)

    # ── Universal cancel ──────────────────────────────────────────────────────
    if payload == "ORDER_CANCEL" or any(w in msg_lower for w in ["বাতিল", "cancel"]):
        _cancel()
        return True

    # ── INTERRUPT: customer chose EXIT_FLOW_ANSWER (leave flow, get AI answer) ─
    if payload == "EXIT_FLOW_ANSWER" or state.get("order_flow_interrupted"):
        if payload == "CONTINUE_ORDER":
            # Customer changed mind — stay in flow
            new_state = {**state}
            new_state.pop("order_flow_interrupted", None)
            new_state.pop("interrupted_question", None)
            _set_conv_state(conversation_id, new_state)
            re_ask = _get_step_question(step)
            save_message(conversation_id, tenant_id, "bot", re_ask)
            send_reply(sender_id, re_ask, plain_token)
            return True

        if payload == "EXIT_FLOW_ANSWER":
            # Customer wants to exit temporarily — answer their saved question via AI
            interrupted_q = state.get("interrupted_question") or msg
            new_state = {**state, "order_flow_paused": True}
            new_state.pop("order_flow_interrupted", None)
            new_state.pop("interrupted_question", None)
            _set_conv_state(conversation_id, new_state)

            ai_answer = ""
            try:
                from app.services.ai_service import generate_reply
                ai_answer = await generate_reply(
                    tenant_id=tenant_id,
                    conversation_id=conversation_id,
                    user_message=interrupted_q,
                    ai_config=ai_config,
                )
            except Exception:
                ai_answer = "দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না।"

            reminder = "\n\n📌 আপনার অর্ডার সংরক্ষিত আছে। চালিয়ে যেতে 'অর্ডার চালু করুন' বলুন।"
            full_reply = (ai_answer or "") + reminder
            save_message(conversation_id, tenant_id, "bot", full_reply)
            send_reply(sender_id, full_reply, plain_token)
            return True

        # Still in interrupted state waiting for button press — re-show buttons
        prompt = (
            "আপনি এখন অর্ডার প্রক্রিয়ার মধ্যে আছেন।\n"
            "কী করতে চান?"
        )
        save_message(conversation_id, tenant_id, "bot", prompt)
        send_quick_reply(sender_id, prompt, _INTERRUPT_QR_BUTTONS, plain_token)
        return True

    # ── PAUSED: customer exited flow earlier, waiting for resume keyword ───────
    if state.get("order_flow_paused"):
        resume_kws = ["অর্ডার চালু করুন", "order চালু", "চালিয়ে যাই", "resume", "অর্ডার"]
        if any(k in msg_lower for k in resume_kws):
            new_state = {**state}
            new_state.pop("order_flow_paused", None)
            _set_conv_state(conversation_id, new_state)
            re_ask = _get_step_question(step)
            reply = f"স্বাগতম! আপনার অর্ডার চালিয়ে যাচ্ছি।\n\n{re_ask}"
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
        else:
            reminder = (
                "📌 আপনার অর্ডার অপেক্ষায় আছে। "
                "চালিয়ে যেতে 'অর্ডার চালু করুন' লিখুন।"
            )
            save_message(conversation_id, tenant_id, "bot", reminder)
            send_reply(sender_id, reminder, plain_token)
        return True

    # ── INTERRUPT GUARD: unexpected answer for current step ───────────────────
    if not _is_expected_answer(step, msg, payload):
        new_state = {**state, "order_flow_interrupted": True, "interrupted_question": msg}
        _set_conv_state(conversation_id, new_state)
        prompt = (
            "আপনি এখন অর্ডার প্রক্রিয়ার মধ্যে আছেন। "
            "প্রথমে প্রশ্নের উত্তর নিতে চাইলে অর্ডার থেকে বের হতে পারেন, "
            "অথবা সরাসরি অর্ডার চালিয়ে যেতে পারেন।"
        )
        save_message(conversation_id, tenant_id, "bot", prompt)
        send_quick_reply(sender_id, prompt, _INTERRUPT_QR_BUTTONS, plain_token)
        return True

    # ── STEP 1: Collect name (RULE 2) ─────────────────────────────────────────
    if step == "collecting_name":
        if len(msg) < 2:
            reply = "আপনার নাম কী?"
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
            return True
        new_state = {**state, "order_flow": "collecting_phone", "customer_name": msg}
        _set_conv_state(conversation_id, new_state)
        reply = "📞 আপনার ফোন নম্বর দিন (01XXXXXXXXX):"
        save_message(conversation_id, tenant_id, "bot", reply)
        send_reply(sender_id, reply, plain_token)
        return True

    # ── STEP 2: Collect phone (RULE 3) ────────────────────────────────────────
    if step == "collecting_phone":
        phone = normalize_bd_phone(msg)
        if not phone:
            reply = "সঠিক ফোন নম্বর দিন (01XXXXXXXXX)"
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
            return True
        new_state = {**state, "order_flow": "collecting_address", "customer_phone": phone}
        _set_conv_state(conversation_id, new_state)
        reply = "📍 ডেলিভারি ঠিকানা দিন (বাড়ি/গ্রাম, থানা, জেলা):"
        save_message(conversation_id, tenant_id, "bot", reply)
        send_reply(sender_id, reply, plain_token)
        return True

    # ── STEP 3: Collect address (RULE 4) ──────────────────────────────────────
    if step == "collecting_address":
        if len(msg) < 5:
            reply = "সম্পূর্ণ ঠিকানা দিন (বাড়ি/গ্রাম, থানা, জেলা):"
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
            return True

        customer_name  = state.get("customer_name", "")
        customer_phone = state.get("customer_phone", "")
        cart           = state.get("cart") or []

        new_state = {**state, "order_flow": "confirming", "delivery_address": msg}
        _set_conv_state(conversation_id, new_state)

        cart_lines: list[str] = []
        total = 0.0
        for item in cart:
            price = float(item.get("price") or 0)
            qty   = int(item.get("qty") or 1)
            total += price * qty
            cart_lines.append(f"🛒 {item['name']} × {qty}")
            if price > 0:
                cart_lines.append(f"💰 মূল্য: ৳{price:.0f}")
        if not cart_lines:
            int_product = state.get("interested_product")
            neg_price   = state.get("negotiated_price")
            if int_product:
                cart_lines.append(f"🛒 {int_product} × 1")
                if neg_price:
                    cart_lines.append(f"💰 মূল্য: ৳{int(neg_price)}")
                    total = float(neg_price)
        if not cart_lines:
            cart_lines = ["🛒 পণ্য (কথোপকথন অনুযায়ী)"]

        total_text = f"৳{total:.0f}" if total > 0 else "আলোচনা অনুযায়ী"
        summary = (
            "📦 অর্ডার কনফার্ম করুন:\n"
            "━━━━━━━━━━━━━━━━━━━\n"
            + "\n".join(cart_lines) + "\n"
            + f"💰 মোট: {total_text}\n"
            + f"👤 {customer_name}\n"
            + f"📱 {customer_phone}\n"
            + f"📍 {msg}\n"
            + "━━━━━━━━━━━━━━━━━━━\n"
            + "নিশ্চিত করতে হ্যাঁ লিখুন"
        )
        save_message(conversation_id, tenant_id, "bot", summary)
        send_quick_reply(sender_id, summary, _CONFIRM_QR_BUTTONS, plain_token)
        return True

    # ── STEP 4: Confirm (RULE 5) ──────────────────────────────────────────────
    if step == "confirming":
        if any(w in msg_lower for w in ["না", "no", "বাতিল", "cancel"]) or payload == "ORDER_CANCEL":
            _cancel()
            return True

        confirmed = (
            payload == "ORDER_CONFIRM"
            or any(w in msg_lower for w in ["হ্যাঁ", "হা", "yes", "নিশ্চিত", "confirm", "ok", "ঠিক আছে", "হ্যা"])
        )
        if confirmed:
            cart             = state.get("cart") or []
            customer_name    = state.get("customer_name", "")
            customer_phone   = state.get("customer_phone", "")
            delivery_address = state.get("delivery_address", "")

            product_name = state.get("interested_product") or "পণ্য"
            product_id   = None
            price        = state.get("negotiated_price")
            quantity     = 1

            if cart:
                first        = cart[0]
                product_name = first.get("name", product_name)
                product_id   = first.get("product_id")
                price        = first.get("price") or price
                quantity     = int(first.get("qty") or 1)

            order_data = {
                "product_name":     product_name,
                "product_id":       product_id,
                "quantity":         quantity,
                "agreed_price":     float(price) if price else None,
                "customer_name":    customer_name,
                "customer_phone":   customer_phone,
                "delivery_address": delivery_address,
                "notes":            None,
            }
            discount_summary = save_order(tenant_id, conversation_id, sender_id, order_data)
            order_ref        = _gen_order_ref()

            clean = {k: v for k, v in state.items() if k not in _ALL_FLOW_KEYS}
            _set_conv_state(conversation_id, clean)

            confirm_text = (
                f"✅ অর্ডার নেওয়া হয়েছে!\n"
                f"🔖 ID: #{order_ref}\n"
                f"📦 পণ্য: {product_name}\n"
                f"📞 ফোন: {customer_phone}\n\n"
                f"আমরা শীঘ্রই যোগাযোগ করব। ধন্যবাদ! 🙏"
            )
            if discount_summary:
                confirm_text += discount_summary
            save_message(conversation_id, tenant_id, "bot", confirm_text)
            send_reply(sender_id, confirm_text, plain_token)
            return True

        # Ambiguous — re-prompt without AI
        re_prompt = "অর্ডার নিশ্চিত করতে 'হ্যাঁ' লিখুন অথবা বাতিল করতে 'বাতিল' লিখুন।"
        save_message(conversation_id, tenant_id, "bot", re_prompt)
        send_quick_reply(sender_id, re_prompt, _CONFIRM_QR_BUTTONS, plain_token)
        return True

    # Unknown step — clear stale state, fall through to AI
    clean = {k: v for k, v in state.items() if k not in _ALL_FLOW_KEYS}
    _set_conv_state(conversation_id, clean)
    return False


def save_order(tenant_id: str, conversation_id: str, sender_id: str, order_data: dict) -> Optional[str]:
    """Insert order + discount rows. Returns a discount summary string if a discount was applied."""
    order_id     = str(uuid.uuid4())
    product_id   = order_data.get("product_id")
    quantity     = int(order_data.get("quantity") or 1)
    agreed_price = float(order_data.get("agreed_price") or 0) or None

    # ── Look up product SKU + category for discount engine ─────────────────────
    sku, category = None, None
    if product_id:
        try:
            p = (supabase.table("products")
                 .select("sku, category")
                 .eq("product_id", product_id)
                 .maybe_single()
                 .execute().data)
            if p:
                sku      = p.get("sku")
                category = p.get("category")
        except Exception:
            pass

    # ── Run discount engine with cart context ──────────────────────────────────
    discount_ctx    = {}
    discount_code   = None
    discount_amount = 0.0
    net_amount      = agreed_price
    discount_summary: Optional[str] = None

    try:
        discount_ctx = get_discount_ctx(
            tenant_id=tenant_id,
            customer_platform_id=sender_id,
            customer_phone=order_data.get("customer_phone"),
            cart_context={
                "cart_amount":   agreed_price or 0,
                "product_skus":  [sku] if sku else [],
                "categories":    [category] if category else [],
                "quantity":      quantity,
                "district":      order_data.get("delivery_address") or "",
            },
        )
        discount_amount = float(discount_ctx.get("discount_amount") or 0)
        has_bonus       = bool(discount_ctx.get("bonus_items"))
        # discount_code comes from the matched active Discount offer
        discount_code   = discount_ctx.get("discount_code")

        applied_discounts = discount_ctx.get("applied_discounts") or []

        if discount_code and (discount_amount > 0 or has_bonus) and agreed_price:
            net_amount = round(max(0.0, agreed_price - discount_amount), 2)
            n_applied  = len(applied_discounts)
            if discount_amount > 0:
                if n_applied > 1:
                    disc_label = f"৳{discount_amount:.0f} ছাড় ({n_applied}টি অফার)"
                else:
                    pct_val  = float(discount_ctx.get("final_discount_pct") or 0)
                    flat_val = float(discount_ctx.get("final_discount_flat") or 0)
                    if pct_val > 0:
                        disc_label = f"{pct_val:.0f}% ছাড়"
                    elif flat_val > 0:
                        disc_label = f"৳{flat_val:.0f} ছাড়"
                    else:
                        disc_label = f"৳{discount_amount:.0f} ছাড়"
                discount_summary = (
                    f"\n\n✅ আপনার অর্ডারে {disc_label} প্রযোজ্য হয়েছে।\n"
                    f"মূল মূল্য: ৳{agreed_price:.0f}, নেট মূল্য: ৳{net_amount:.0f}"
                )
            elif has_bonus:
                items_str = ", ".join(
                    f"{b.get('name','')} ×{b.get('quantity',1)}"
                    for b in discount_ctx["bonus_items"][:3]
                )
                discount_summary = f"\n\n🎁 আপনি বোনাস পণ্য পাচ্ছেন: {items_str}"
    except Exception as _de:
        logger.warning(f"Discount engine error in save_order: {_de}")

    # ── Insert order ───────────────────────────────────────────────────────────
    customer_name_val = order_data.get("customer_name") or ""
    customer_phone    = order_data.get("customer_phone") or ""
    supabase.table("orders").insert({
        "order_id":             order_id,
        "tenant_id":            tenant_id,
        "conversation_id":      conversation_id,
        "customer_platform_id": sender_id,
        "product_name":         order_data.get("product_name"),
        "product_id":           product_id,
        "quantity":             quantity,
        "agreed_price":         agreed_price,
        "customer_name":        customer_name_val,
        "customer_phone":       customer_phone,
        "delivery_address":     order_data.get("delivery_address"),
        "notes":                order_data.get("notes"),
        "status":               "pending",
        "discount_code":        discount_code,
        "original_amount":      agreed_price,
        "net_amount":           net_amount,
    }).execute()

    # ── Push notification to owner dashboard ──────────────────────────────────
    try:
        body_parts = [order_data.get("product_name") or "পণ্য"]
        if customer_name_val:
            body_parts.append(customer_name_val)
        if customer_phone:
            body_parts.append(customer_phone)
        supabase.table("notifications").insert({
            "tenant_id": tenant_id,
            "type":      "new_order",
            "title":     "📦 নতুন অর্ডার",
            "body":      " | ".join(body_parts),
            "ref_id":    order_id,
            "is_read":   False,
        }).execute()
    except Exception as _ne:
        logger.warning(f"Notification insert failed: {_ne}")

    # ── Insert order_discounts rows (one per applied discount) ───────────────
    if discount_code and applied_discounts:
        for ad in applied_discounts:
            if not ad or not ad.get("discount_id"):
                continue
            rtype_d = ad.get("reward_type") or "percentage"
            if rtype_d not in ("percentage", "flat", "bonus", "free_delivery"):
                rtype_d = "percentage"
            try:
                supabase.table("order_discounts").insert({
                    "tenant_id":       tenant_id,
                    "order_id":        order_id,
                    "discount_id":     ad.get("discount_id"),
                    "discount_code":   ad.get("discount_code") or discount_code,
                    "discount_name":   ad.get("discount_name") or "",
                    "rule_id":         ad.get("rule_id"),
                    "rule_name":       ad.get("rule_name") or "",
                    "rule_type":       ad.get("rule_type") or "",
                    "product_id":      product_id,
                    "sku":             sku,
                    "product_name":    order_data.get("product_name"),
                    "reward_type":     rtype_d,
                    "discount_pct":    ad.get("discount_value", 0) if rtype_d == "percentage" else 0,
                    "discount_flat":   ad.get("discount_value", 0) if rtype_d == "flat" else 0,
                    "bonus_items":     ad.get("bonus_items") or [],
                    "original_price":  agreed_price,
                    "discount_amount": float(ad.get("discount_amount") or 0),
                    "final_price":     net_amount,
                }).execute()
            except Exception as _die:
                logger.warning(f"order_discounts insert failed: {_die}")

    # ── Deduct stock immediately when order is placed ──────────────────────────
    quantity   = order_data.get("quantity", 1)
    if product_id and quantity:
        try:
            stock_row = (
                supabase.table("stock")
                .select("current_stock")
                .eq("tenant_id", tenant_id)
                .eq("product_id", product_id)
                .maybe_single()
                .execute().data
            )
            if stock_row is not None:
                before = stock_row.get("current_stock", 0)
                after  = max(0, before - quantity)
                supabase.table("stock").update({"current_stock": after}) \
                    .eq("tenant_id", tenant_id).eq("product_id", product_id).execute()
                prod = supabase.table("products").select("sku").eq("product_id", product_id) \
                    .maybe_single().execute().data
                supabase.table("stock_history").insert({
                    "tenant_id":       tenant_id,
                    "product_id":      product_id,
                    "sku":             (prod or {}).get("sku", ""),
                    "change_type":     "order_placed",
                    "quantity_change": -quantity,
                    "quantity_before": before,
                    "quantity_after":  after,
                }).execute()
        except Exception as _se:
            logger.warning(f"Stock deduction failed for product {product_id}: {_se}")


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
    quick_reply_payload: Optional[str] = None,
) -> None:
    """Full message pipeline."""

    conv            = get_or_create_conversation(tenant_id, sender_id, platform)
    conversation_id = conv["conversation_id"]

    # Fetch history BEFORE saving current message — prevents context duplication in AI
    messages = get_recent_messages(conversation_id, limit=20)
    summary  = conv.get("conversation_summary")

    # Save customer message immediately (all paths need this)
    content_to_save = message_text or (f"[Image: {image_urls[0]}]" if image_urls else "")
    if content_to_save:
        save_message(conversation_id, tenant_id, "customer", content_to_save)

    if not conv.get("is_ai_active", True):
        return

    from app.utils.security import decrypt_token
    plain_token = decrypt_token(access_token)

    ai_config   = get_ai_config(tenant_id)
    state       = conv.get("conversation_state") or {}
    otp_flow    = state.get("otp_flow")
    return_flow = state.get("return_flow")
    # ── 0. Migrate legacy dict-format order_flow ─────────────────────────────
    if isinstance(state.get("order_flow"), dict):
        state = {k: v for k, v in state.items() if k not in _ALL_FLOW_KEYS}
        _set_conv_state(conversation_id, state)

    # ── 0.5. Abuse detection ──────────────────────────────────────────────────
    if message_text and _detect_abuse(message_text):
        abusive_count = state.get("abusive_count", 0) + 1
        state = {**state, "abusive_count": abusive_count}
        if abusive_count >= 3:
            supabase.table("conversations").update({
                "is_ai_active": False,
                "conversation_state": state,
            }).eq("conversation_id", conversation_id).execute()
            escalation = (
                "আমি আপনার সমস্যা সমাধানে অক্ষম।\n"
                "আমাদের টিম শীঘ্রই যোগাযোগ করবে।"
            )
            save_message(conversation_id, tenant_id, "bot", escalation)
            send_reply(sender_id, escalation, plain_token)
            return
        _set_conv_state(conversation_id, state)
        calm_reply = (
            "আমি আপনাকে সাহায্য করতে এখানে আছি।\n"
            "আপনার কি কোনো পণ্য দরকার বা অন্য কিছু জানতে চান?"
        )
        save_message(conversation_id, tenant_id, "bot", calm_reply)
        send_reply(sender_id, calm_reply, plain_token)
        return

    # ── 1. OTP Flow ───────────────────────────────────────────────────────────
    if otp_flow and message_text:
        reply = _handle_otp_flow(tenant_id, conversation_id, message_text, state, otp_flow, ai_config)
        if reply:
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
            return

    # ── 2. Return Flow (active) ───────────────────────────────────────────────
    if return_flow and message_text:
        reply = _handle_return_flow(
            tenant_id, conversation_id, message_text, state, return_flow, ai_config
        )
        if reply is not None:
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
            return

    # ── 2.5 Active Order Flow — strict state machine, NEVER falls through to AI
    order_flow_step = state.get("order_flow")
    if order_flow_step and isinstance(order_flow_step, str) and (message_text or quick_reply_payload):
        handled = await _handle_strict_order_flow(
            tenant_id, conversation_id, sender_id, message_text,
            quick_reply_payload, state, plain_token, ai_config,
        )
        if handled:
            return

    # ── 3. Customer sent an image ─────────────────────────────────────────────
    if image_urls:
        handled = await _handle_customer_image(
            tenant_id, conversation_id, sender_id, image_urls[0], plain_token
        )
        if handled:
            return

    if not message_text:
        return

    # ── 4. Text "দেখাও" → image search ───────────────────────────────────────
    if ai_config.get("product_image_auto_send") and img_svc.should_trigger_image_search(message_text):
        handled = await _handle_text_image_request(
            tenant_id, conversation_id, sender_id, message_text, plain_token
        )
        if handled:
            return

    # ── 5. Return trigger (start new flow) ───────────────────────────────────
    if message_text and _is_return_trigger(message_text) and not return_flow:
        window_days = ai_config.get("return_window_days", 7)
        _set_conv_state(conversation_id, {
            **state,
            "return_flow": {"state": "asking_phone", "window_days": window_days},
        })
        reply = "আপনার ফোন নম্বরটি দিন (01XXXXXXXXX)"
        save_message(conversation_id, tenant_id, "bot", reply)
        send_reply(sender_id, reply, plain_token)
        return

    # ── 5.5 Order trigger — RULE 1: extract product, start flow immediately ─────
    if message_text and _is_order_trigger(message_text) and not state.get("order_flow"):
        cart_item = _extract_product_for_order(tenant_id, message_text, state)
        cart      = [cart_item] if cart_item else []
        _set_conv_state(conversation_id, {**state, "order_flow": "collecting_name", "cart": cart})
        reply = "আপনার নাম কী?"
        save_message(conversation_id, tenant_id, "bot", reply)
        send_reply(sender_id, reply, plain_token)
        return

    # ── 6. OTP order-tracking start ───────────────────────────────────────────
    if _should_start_tracking(message_text) and ai_config.get("sms_enabled"):
        new_state = {**state, "otp_flow": {"state": "awaiting_phone"}}
        _set_conv_state(conversation_id, new_state)
        reply = "আপনার অর্ডার দেখতে আপনার ফোন নম্বরটি দিন (01XXXXXXXXX):"
        save_message(conversation_id, tenant_id, "bot", reply)
        send_reply(sender_id, reply, plain_token)
        return

    # ── 7. Discount context ───────────────────────────────────────────────────
    discount_ctx: dict = {}
    try:
        discount_ctx = get_discount_ctx(tenant_id=tenant_id, customer_platform_id=sender_id)
    except Exception as _de:
        logger.warning(f"Discount engine error: {_de}")

    # ── 8. Normal AI flow ─────────────────────────────────────────────────────
    sentiment = _detect_sentiment(message_text) if message_text else ""

    result = await ai_service.generate_reply(
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        customer_message=message_text,
        ai_config=ai_config,
        raw_messages=messages,
        conversation_state=state,
        conversation_summary=summary,
        discount_context=discount_ctx,
        sentiment_hint=sentiment,
    )

    reply_text   = result["reply"]
    order_data   = result.get("order_data")
    state_update = result.get("state_update")

    if order_data:
        discount_summary = save_order(tenant_id, conversation_id, sender_id, order_data)
        if discount_summary:
            reply_text = reply_text + discount_summary
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
