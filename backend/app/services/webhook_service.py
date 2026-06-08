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
import re
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

from google import genai as _genai

logger = logging.getLogger(__name__)

META_GRAPH_API  = "https://graph.facebook.com/v19.0"
ai_service      = AIService()
memory_service  = MemoryService()
_gemini_client  = _genai.Client(api_key=settings.GEMINI_API_KEY)

# ── Order flow trigger keywords ───────────────────────────────────────────────

_ORDER_TRIGGERS = [
    # Bangla — explicit buy/order intent
    "অর্ডার করতে চাই", "অর্ডার করব", "অর্ডার দিতে চাই", "অর্ডার করি",
    "অর্ডার করতে চাইছি", "অর্ডার দেব", "অর্ডার দিন", "অর্ডার নিন",
    "কিনতে চাই", "কিনব", "কিনতে চাইছি", "কিনতে পারি",
    "নিতে চাই", "নেব", "নিতে চাইছি", "নিতে পারি",
    "নিয়ে যাব", "নিয়ে নেব",
    "বুক করব", "বুকিং দিতে চাই", "বুক করতে চাই",
    "দিয়ে দেন", "দিয়ে দিন", "পাঠিয়ে দিন", "পাঠিয়ে দেন",
    "অর্ডার", "purchase", "buy",
    # Romanized Bangla
    "order korte chai", "order debo", "order dite chai", "order korbo",
    "kinbo", "nite chai", "nebo", "buy korbo", "book korbo",
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

# Order history query keywords (direct DB lookup — no OTP required)
_ORDER_HISTORY_TRIGGERS = [
    "আমার অর্ডার", "আগের অর্ডার", "পুরোনো অর্ডার", "অর্ডার দেখতে চাই",
    "অর্ডার ইতিহাস", "অর্ডার লিস্ট", "কী অর্ডার করেছিলাম", "আমি কী কিনেছিলাম",
    "order history", "my orders", "previous orders", "order list",
    "আমার কি অর্ডার আছে", "অর্ডার কখন আসবে", "ডেলিভারি কবে",
]


def _is_order_history_query(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in _ORDER_HISTORY_TRIGGERS)


def _get_order_history_reply(tenant_id: str, phone: str) -> str:
    """Query orders table and return formatted last-3-orders reply."""
    STATUS_MAP = {
        "pending":   "⏳ অপেক্ষারত",
        "confirmed": "✅ নিশ্চিত",
        "shipped":   "🚚 শিপড",
        "delivered": "📦 ডেলিভারি হয়েছে",
        "cancelled": "❌ বাতিল",
    }
    try:
        res = (
            supabase.table("orders")
            .select("product_name, quantity, agreed_price, status, created_at, tracking_number")
            .eq("tenant_id", tenant_id)
            .eq("customer_phone", phone)
            .order("created_at", desc=True)
            .limit(3)
            .execute()
        )
        orders = res.data or []
        if not orders:
            return "আপনার কোনো পূর্ববর্তী অর্ডার পাওয়া যায়নি।"

        lines = ["📋 আপনার সাম্প্রতিক অর্ডার:\n"]
        for i, o in enumerate(orders, 1):
            status = STATUS_MAP.get(o.get("status", ""), o.get("status", ""))
            date   = (o.get("created_at") or "")[:10]
            lines.append(f"{i}. {o.get('product_name', 'পণ্য')} × {o.get('quantity', 1)}")
            if o.get("agreed_price"):
                lines.append(f"   💰 ৳{float(o['agreed_price']):,.0f}")
            lines.append(f"   {status} | 📅 {date}")
            if o.get("tracking_number"):
                lines.append(f"   🔍 Tracking: {o['tracking_number']}")
        lines.append("\nআর কোনো সাহায্য লাগবে?")
        return "\n".join(lines)
    except Exception as exc:
        logger.warning(f"Order history query failed: {exc}")
        return "অর্ডার তথ্য লোড করতে সমস্যা হয়েছে। একটু পরে চেষ্টা করুন।"


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
    import string
    today  = datetime.now().strftime("%Y%m%d")
    chars  = string.ascii_uppercase + string.digits
    suffix = "".join(random.choices(chars, k=4))
    return f"ORD-{today}-{suffix}"


# ── Order state keys (all cleared on completion / cancel) ────────────────────

_ORDER_STATE_KEYS = (
    "order_flow", "current_step", "cart",
    "customer_name", "customer_phone", "delivery_address",
    "completed_states", "last_searched_product",
    "order_timeout", "last_bot_message",
    # legacy keys
    "order_flow_interrupted", "interrupted_question",
    "order_flow_paused", "paused_flow", "interruption_pending",
)
_ALL_FLOW_KEYS = _ORDER_STATE_KEYS  # backwards-compat alias used by test_bot imports

# English common grocery words → Bangla (for fuzzy product search)
_EN_TO_BN: dict[str, str] = {
    "mustard": "সরিষা",
    "oil":     "তেল",
    "rice":    "চাল",
    "dal":     "ডাল",
    "lentil":  "ডাল",
    "salt":    "লবণ",
    "sugar":   "চিনি",
    "flour":   "আটা",
    "honey":   "মধু",
    "ghee":    "ঘি",
}


# ── Order flow v2 helpers ─────────────────────────────────────────────────────

def _get_product_catalog(tenant_id: str, limit: int = 40) -> list[dict]:
    """Fetch active products for the Gemini order intent prompt."""
    try:
        res = (
            supabase.table("products")
            .select("name, sku, mrp, category")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


def _format_cart_for_prompt(cart: list) -> str:
    if not cart:
        return "খালি"
    parts = []
    for item in cart:
        name  = item.get("product_name") or item.get("name") or "পণ্য"
        qty   = item.get("quantity") or 1
        price = item.get("price") or 0
        parts.append(f"{name} × {qty} (৳{price})")
    return ", ".join(parts)


def _query_stock(tenant_id: str, product_name: str) -> Optional[dict]:
    """Returns {name, current_stock} for the closest matching product, or None."""
    try:
        prods = (
            supabase.table("products")
            .select("product_id, name")
            .eq("tenant_id", tenant_id)
            .ilike("name", f"%{product_name}%")
            .eq("is_active", True)
            .limit(1)
            .execute()
            .data or []
        )
        if not prods:
            return None
        p = prods[0]
        stock_row = (
            supabase.table("stock")
            .select("current_stock")
            .eq("tenant_id", tenant_id)
            .eq("product_id", p["product_id"])
            .maybe_single()
            .execute()
        )
        stock = (stock_row.data or {}).get("current_stock", 0) if stock_row else 0
        return {"name": p["name"], "current_stock": int(stock or 0)}
    except Exception as e:
        logger.warning(f"_query_stock error: {e}")
        return None


def _query_price(tenant_id: str, product_name: str) -> Optional[dict]:
    """Returns {name, mrp} for the closest matching product, or None."""
    try:
        prods = (
            supabase.table("products")
            .select("name, mrp")
            .eq("tenant_id", tenant_id)
            .ilike("name", f"%{product_name}%")
            .eq("is_active", True)
            .limit(1)
            .execute()
            .data or []
        )
        return prods[0] if prods else None
    except Exception as e:
        logger.warning(f"_query_price error: {e}")
        return None


def _query_active_discounts(tenant_id: str) -> list[dict]:
    """Returns currently active discounts with name and basic reward info."""
    try:
        now = datetime.now(timezone.utc).isoformat()
        rows = (
            supabase.table("discounts")
            .select("discount_name, discount_code, rule_ids, effective_to, is_lifetime")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .lte("effective_from", now)
            .execute()
            .data or []
        )
        active = []
        for d in rows:
            eff_to = d.get("effective_to")
            if not eff_to or d.get("is_lifetime"):
                active.append(d)
            else:
                try:
                    if datetime.fromisoformat(eff_to.replace("Z", "+00:00")) >= datetime.now(timezone.utc):
                        active.append(d)
                except Exception:
                    active.append(d)
        return active
    except Exception as e:
        logger.warning(f"_query_active_discounts error: {e}")
        return []


def _query_product_list(tenant_id: str, category: Optional[str] = None) -> list[dict]:
    """Returns active products, optionally filtered by category."""
    try:
        q = (
            supabase.table("products")
            .select("name, mrp, category")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .order("category")
            .limit(40)
        )
        if category:
            q = q.ilike("category", f"%{category}%")
        return q.execute().data or []
    except Exception as e:
        logger.warning(f"_query_product_list error: {e}")
        return []


def _query_delivery_charge(tenant_id: str, district: Optional[str] = None) -> Optional[dict]:
    """Returns {district, charge} for the given district, or the default/first entry."""
    try:
        if district:
            row = (
                supabase.table("delivery_charges")
                .select("district, charge")
                .eq("tenant_id", tenant_id)
                .ilike("district", f"%{district}%")
                .maybe_single()
                .execute()
            )
            if row and row.data:
                return row.data
        rows = (
            supabase.table("delivery_charges")
            .select("district, charge")
            .eq("tenant_id", tenant_id)
            .limit(3)
            .execute()
            .data or []
        )
        return rows[0] if rows else None
    except Exception as e:
        logger.warning(f"_query_delivery_charge error: {e}")
        return None


# ── New order flow helpers ────────────────────────────────────────────────────

def _translate_for_search(text: str) -> str:
    words = text.lower().split()
    return " ".join(_EN_TO_BN.get(w, w) for w in words)


def _new_order_state() -> dict:
    return {
        "order_flow":            "active",
        "current_step":          "selecting_products",
        "cart":                  [],
        "customer_name":         None,
        "customer_phone":        None,
        "delivery_address":      None,
        "completed_states": {
            "product":   False,
            "quantity":  False,
            "name":      False,
            "phone":     False,
            "address":   False,
            "confirmed": False,
        },
        "last_searched_product": None,
        "order_timeout":         (datetime.now() + timedelta(hours=2)).isoformat(),
        "last_bot_message":      "",
    }


def _get_store_name(tenant_id: str) -> str:
    try:
        cfg = (supabase.table("ai_config").select("store_name")
               .eq("tenant_id", tenant_id).maybe_single().execute())
        return (cfg.data or {}).get("store_name") or "আমাদের স্টোর"
    except Exception:
        return "আমাদের স্টোর"


def _search_product_db(tenant_id: str, search_term: str) -> list:
    translated = _translate_for_search(search_term)
    seen: set  = set()
    results    = []
    for word in translated.split():
        if len(word) < 2:
            continue
        try:
            safe = word.replace("%", "").replace("_", "")
            res  = (
                supabase.table("products")
                .select("product_id, name, sku, mrp")
                .eq("tenant_id", tenant_id)
                .eq("is_active", True)
                .or_(f"name.ilike.%{safe}%,sku.ilike.%{safe}%,category.ilike.%{safe}%")
                .limit(5)
                .execute()
            )
            for p in (res.data or []):
                if p["product_id"] not in seen:
                    seen.add(p["product_id"])
                    results.append({
                        "product_id":   p["product_id"],
                        "product_name": p["name"],
                        "sku":          p.get("sku") or "",
                        "price":        float(p.get("mrp") or 0),
                    })
        except Exception:
            continue
    return results


def _build_cart_text(cart: list) -> str:
    if not cart:
        return "খালি"
    rows  = []
    total = 0.0
    for item in cart:
        name  = item.get("product_name") or "পণ্য"
        qty   = int(item.get("quantity") or 1)
        price = float(item.get("price") or 0)
        total += qty * price
        rows.append(f"{name} × {qty} (৳{price:.0f}/পিস)")
    rows.append(f"মোট: ৳{total:.0f}")
    return "\n".join(rows)


def _build_order_summary_v2(state: dict) -> str:
    cart  = state.get("cart") or []
    total = 0.0
    rows  = []
    for item in cart:
        name  = item.get("product_name") or "পণ্য"
        qty   = int(item.get("quantity") or 1)
        price = float(item.get("price") or 0)
        total += qty * price
        rows.append(f"🛒 {name} × {qty} — ৳{price * qty:.0f}")
    items_str = "\n".join(rows) if rows else "কোনো পণ্য নেই"
    return (
        "📦 অর্ডার কনফার্ম করুন:\n"
        "━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"{items_str}\n"
        f"💰 মোট: ৳{total:.0f}\n"
        f"👤 {state.get('customer_name') or '—'}\n"
        f"📱 {state.get('customer_phone') or '—'}\n"
        f"📍 {state.get('delivery_address') or '—'}\n"
        "━━━━━━━━━━━━━━━━━━━━━━━\n"
        "✏️ পরিবর্তন করতে চাইলে বলুন\n"
        "✅ 'হ্যাঁ' — নিশ্চিত করুন\n"
        "❌ 'না' — বাতিল করুন"
    )


def _get_step_question(step: str) -> str:
    return {
        "selecting_products": "কোন পণ্য অর্ডার করতে চান? পণ্যের নাম বলুন।",
        "ask_quantity":       "কত পিস নেবেন?",
        "confirm_add":        "আর কিছু নেবেন? (হ্যাঁ/না)",
        "ask_name":           "👤 আপনার নাম কী?",
        "ask_phone":          "📞 ফোন নম্বর দিন (01XXXXXXXXX):",
        "ask_address":        "📍 ডেলিভারি ঠিকানা দিন (বাড়ি/এলাকা/জেলা):",
        "show_summary":       "অর্ডার নিশ্চিত করতে 'হ্যাঁ' লিখুন।",
    }.get(step, "অর্ডার চালিয়ে যান।")


def _gemini_classify(msg: str, state: dict, tenant_id: str, last_bot_msg: str) -> dict:
    current_step = state.get("current_step", "selecting_products")
    store_name   = _get_store_name(tenant_id)
    catalog_text = "\n".join(
        f"- {p['name']} (SKU: {p.get('sku','')}, দাম: ৳{p.get('mrp') or 0}, ক্যাট: {p.get('category','')})"
        for p in _get_product_catalog(tenant_id)
    ) or "কোনো পণ্য নেই"
    cs = state.get("completed_states") or {}
    prompt = (
        f"You are an order processing AI for '{store_name}' (Bangladeshi e-commerce).\n"
        f"Current step: {current_step}\n"
        f"Cart: {_build_cart_text(state.get('cart') or [])}\n"
        f"Customer name: {state.get('customer_name') or 'not yet collected'}\n"
        f"Phone: {state.get('customer_phone') or 'not yet collected'}\n"
        f"Address: {state.get('delivery_address') or 'not yet collected'}\n"
        f"Completed: product={cs.get('product',False)}, name={cs.get('name',False)}, phone={cs.get('phone',False)}, address={cs.get('address',False)}\n"
        f"Last searched product_id: {state.get('last_searched_product') or 'none'}\n"
        f"Last bot message: {last_bot_msg or 'none'}\n"
        f"Available products:\n{catalog_text}\n\n"
        f"Customer said: '{msg}'\n\n"
        "RULES:\n"
        "- 'order korte chai' without product \u2192 start_order\n"
        "- 'mustard oil nite chai' \u2192 provide_product\n"
        "- 'mustard oil koto?' \u2192 ask_price (NOT buying)\n"
        "- 'mustard oil ache?' \u2192 stock_check\n"
        "- '2'/'2 ta'/'dui ta' after quantity question \u2192 ask_quantity_answer\n"
        "- '\u09b9\u09cd\u09af\u09be\u0981'/'yes' ALONE after quantity question \u2192 NOT quantity, re-ask\n"
        "- 11-digit number starting with 01 \u2192 provide_phone\n"
        "- 'cancel'/'\u09ac\u09be\u09a4\u09bf\u09b2'/'order korbo na' \u2192 cancel_order\n"
        "- '\u09b9\u09cd\u09af\u09be\u0981' after '\u0986\u09b0 \u0995\u09bf\u099b\u09c1 \u09a8\u09c7\u09ac\u09c7\u09a8?' \u2192 want_more\n"
        "- '\u09a8\u09be' after '\u0986\u09b0 \u0995\u09bf\u099b\u09c1 \u09a8\u09c7\u09ac\u09c7\u09a8?' \u2192 done_adding\n"
        "- '\u09b9\u09cd\u09af\u09be\u0981' after order summary \u2192 confirm_order\n"
        "- Detect ALL fields if customer gives multiple at once\n\n"
        'Return JSON ONLY:\n'
        '{\n'
        '  "intent": "start_order|provide_product|ask_quantity_answer|want_more|done_adding|provide_name|provide_phone|provide_address|confirm_order|cancel_order|modify_cart|modify_info|ask_price|stock_check|ask_recommendation|product_list|discount_check|delivery_info|payment_info|frustrated|off_topic|unclear",\n'
        '  "data": {\n'
        '    "product_search_term": null,\n'
        '    "quantity": null,\n'
        '    "name": null,\n'
        '    "phone": null,\n'
        '    "address": null,\n'
        '    "modify_field": null,\n'
        '    "modify_value": null,\n'
        '    "district": null,\n'
        '    "category": null,\n'
        '    "question": null\n'
        '  },\n'
        '  "natural_reply": "Natural Bangla reply"\n'
        '}\n'
        "Return ONLY the JSON, no other text."
    )
    try:
        resp = _gemini_client.models.generate_content(model=settings.GEMINI_MODEL, contents=prompt)
        text = resp.text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\n?", "", text)
            text = re.sub(r"\n?```$", "", text.strip())
        return json.loads(text)
    except Exception as e:
        logger.warning(f"_gemini_classify failed: {e}")
        return {"intent": "unclear", "data": {}, "natural_reply": "দুঃখিত, আবার বলুন।"}


def _handle_info_query(intent: str, data: dict, tenant_id: str, state: dict) -> Optional[str]:
    if intent == "ask_price":
        term = data.get("product_search_term") or data.get("question") or ""
        hits = _search_product_db(tenant_id, term) if term else []
        if hits:
            p = hits[0]
            return f"💰 {p['product_name']}: ৳{p['price']:.0f}/পিস"
        return "দুঃখিত, এই পণ্যের দাম পাওয়া যাচ্ছে না।"
    if intent == "stock_check":
        term = data.get("product_search_term") or data.get("question") or ""
        hit  = _query_stock(tenant_id, term) if term else None
        if hit:
            avail = hit.get("available_quantity") or 0
            name  = hit.get("product_name") or term
            return (f"✅ {name}: {avail} পিস স্টকে আছে।"
                    if avail > 0 else f"❌ {name} এখন স্টকে নেই।")
        return "এই পণ্যের স্টক তথ্য পাওয়া যাচ্ছে না।"
    if intent == "discount_check":
        discounts = _query_active_discounts(tenant_id)
        if discounts:
            rows = [f"🏷️ {d.get('discount_name','অফার')}: {d.get('discount_value','')}% ছাড়" for d in discounts[:3]]
            return "বর্তমান অফার:\n" + "\n".join(rows)
        return "এখন কোনো বিশেষ ছাড় নেই।"
    if intent == "product_list":
        cat  = data.get("category") or ""
        hits = _query_product_list(tenant_id, cat)
        if hits:
            rows = [f"• {p.get('name','পণ্য')} — ৳{p.get('mrp') or 0}" for p in hits[:8]]
            return "পণ্য তালিকা:\n" + "\n".join(rows)
        return "পণ্য তালিকা পাওয়া যাচ্ছে না।"
    if intent == "delivery_info":
        dist = data.get("district") or ""
        row  = _query_delivery_charge(tenant_id, dist) if dist else None
        if row:
            return f"🚚 {dist} এলাকায় ডেলিভারি চার্জ: ৳{row.get('delivery_charge',0)}"
        return "ডেলিভারি চার্জ এলাকাভেদে ভিন্ন। ঠিকানা দিলে জানাতে পারব।"
    if intent == "payment_info":
        return "💳 পেমেন্ট পদ্ধতি:\n• বিকাশ\n• নগদ\n• ক্যাশ অন ডেলিভারি"
    if intent == "ask_recommendation":
        hits = _search_product_db(tenant_id, data.get("category") or "")
        if hits:
            rows = [f"• {p['product_name']} — ৳{p['price']:.0f}" for p in hits[:5]]
            return "জনপ্রিয় পণ্য:\n" + "\n".join(rows)
        return "আপনি কোন ধরনের পণ্য খুঁজছেন?"
    return None


def _clear_order_state(conversation_id: str, state: dict) -> None:
    clean = {k: v for k, v in state.items() if k not in _ORDER_STATE_KEYS}
    _set_conv_state(conversation_id, clean)


def _fuzzy_product_search(tenant_id: str, term: str, neg_price) -> dict:
    """
    LIKE search on name, sku, category for each word in term.
    Returns first match as {product_id, name, price, qty} or {}.
    """
    translated = _translate_for_search(term)
    for word in translated.split():
        if len(word) < 2:
            continue
        try:
            safe = word.replace("%", "").replace("_", "")
            res = (
                supabase.table("products")
                .select("product_id, name, sku, mrp")
                .eq("tenant_id", tenant_id)
                .eq("is_active", True)
                .or_(f"name.ilike.%{safe}%,sku.ilike.%{safe}%,category.ilike.%{safe}%")
                .limit(5)
                .execute()
            )
            if res and res.data:
                p = res.data[0]
                return {
                    "product_id":   p["product_id"],
                    "product_name": p["name"],
                    "sku":          p.get("sku") or "",
                    "price":        float(neg_price or p.get("mrp") or 0),
                    "quantity":     1,
                }
        except Exception:
            continue
    return {}


def _extract_product_for_order(tenant_id: str, message_text: str, state: dict) -> dict:
    """
    Returns {product_id, name, price, qty} or {} if nothing found.
    1. Checks conversation_state.interested_product first (fuzzy).
    2. Falls back to fuzzy search on the message text itself.
    """
    interested = state.get("interested_product")
    neg_price  = state.get("negotiated_price")

    if interested:
        hit = _fuzzy_product_search(tenant_id, interested, neg_price)
        if hit:
            return hit
        # Product not in DB but we know what they want — keep as free-text
        return {
            "product_id":   None,
            "product_name": interested,
            "sku":          "",
            "price":        float(neg_price or 0),
            "quantity":     1,
        }

    return _fuzzy_product_search(tenant_id, message_text, neg_price)


def _cart_add_item(cart: list, item: dict) -> list:
    """
    Add item to cart. If same product already exists (matched by product_id
    or product_name), increment quantity instead of adding a duplicate row.
    Always normalises existing entries to the standard schema on first touch.
    """
    if not item:
        return list(cart)

    pid  = item.get("product_id")
    name = item.get("product_name") or item.get("name", "")
    new_cart: list[dict] = []

    for existing in cart:
        e_pid  = existing.get("product_id")
        e_name = existing.get("product_name") or existing.get("name", "")
        same = (pid and e_pid and pid == e_pid) or (name and name == e_name)
        if same:
            # normalise + merge
            merged = {
                "product_id":   e_pid or pid,
                "product_name": e_name or name,
                "sku":          existing.get("sku") or item.get("sku") or "",
                "price":        existing.get("price") or item.get("price"),
                "quantity":     int(existing.get("quantity") or existing.get("qty") or 1)
                                + int(item.get("quantity") or item.get("qty") or 1),
            }
            new_cart.append(merged)
            new_cart.extend(
                {
                    "product_id":   e.get("product_id"),
                    "product_name": e.get("product_name") or e.get("name", ""),
                    "sku":          e.get("sku", ""),
                    "price":        e.get("price"),
                    "quantity":     int(e.get("quantity") or e.get("qty") or 1),
                }
                for e in cart[cart.index(existing) + 1:]
            )
            return new_cart
        new_cart.append({
            "product_id":   e_pid,
            "product_name": e_name,
            "sku":          existing.get("sku", ""),
            "price":        existing.get("price"),
            "quantity":     int(existing.get("quantity") or existing.get("qty") or 1),
        })

    # No match — append new item normalised
    new_cart.append({
        "product_id":   pid,
        "product_name": name,
        "sku":          item.get("sku", ""),
        "price":        item.get("price"),
        "quantity":     int(item.get("quantity") or item.get("qty") or 1),
    })
    return new_cart



async def _step_selecting_products(
    tenant_id: str, conversation_id: str, sender_id: str,
    msg: str, state: dict, plain_token: str, ai_config: dict,
) -> str:
    classified    = _gemini_classify(msg, state, tenant_id, state.get("last_bot_message") or "")
    intent        = classified.get("intent", "unclear")
    data          = classified.get("data") or {}
    natural_reply = classified.get("natural_reply") or ""

    info_reply = _handle_info_query(intent, data, tenant_id, state)
    if info_reply:
        return info_reply

    if intent == "cancel_order":
        _clear_order_state(conversation_id, state)
        return "❌ অর্ডার বাতিল করা হয়েছে।"

    search_term = data.get("product_search_term") or ""
    if intent == "provide_product" and search_term:
        hits = _search_product_db(tenant_id, search_term)
        if hits:
            p         = hits[0]
            new_state = {**state, "last_searched_product": p["product_id"], "current_step": "ask_quantity"}
            _set_conv_state(conversation_id, new_state)
            return f"✅ পাওয়া গেছে: {p['product_name']} (৳{p['price']:.0f}/পিস)\nকত পিস নেবেন?"
        return f"'{search_term}' নামে কোনো পণ্য পাওয়া যায়নি। অন্য কোনো পণ্য বলুন।"

    if intent == "start_order":
        return "কোন পণ্য অর্ডার করতে চান? পণ্যের নাম বলুন।"

    return natural_reply or "কোন পণ্য অর্ডার করতে চান? পণ্যের নাম বলুন।"


async def _step_ask_quantity(
    tenant_id: str, conversation_id: str, sender_id: str,
    msg: str, state: dict, plain_token: str, ai_config: dict,
) -> str:
    classified = _gemini_classify(msg, state, tenant_id, state.get("last_bot_message") or "")
    intent     = classified.get("intent", "unclear")
    data       = classified.get("data") or {}

    info_reply = _handle_info_query(intent, data, tenant_id, state)
    if info_reply:
        return info_reply

    if intent == "cancel_order":
        _clear_order_state(conversation_id, state)
        return "❌ অর্ডার বাতিল করা হয়েছে।"

    qty = data.get("quantity")
    if intent == "ask_quantity_answer" and qty:
        try:
            qty = int(qty)
        except (TypeError, ValueError):
            qty = 1
        pid     = state.get("last_searched_product")
        product = None
        if pid:
            try:
                row = (supabase.table("products").select("product_id, name, sku, mrp")
                       .eq("product_id", pid).eq("tenant_id", tenant_id)
                       .maybe_single().execute().data)
                if row:
                    product = {
                        "product_id":   row["product_id"],
                        "product_name": row["name"],
                        "sku":          row.get("sku") or "",
                        "price":        float(row.get("mrp") or 0),
                    }
            except Exception:
                pass
        if not product:
            new_state = {**state, "current_step": "selecting_products"}
            _set_conv_state(conversation_id, new_state)
            return "পণ্য খুঁজে পাওয়া যাচ্ছে না। আবার পণ্যের নাম বলুন।"
        cart = list(state.get("cart") or [])
        existing = next((i for i, x in enumerate(cart) if x.get("product_id") == product["product_id"]), None)
        if existing is not None:
            cart[existing]["quantity"] = cart[existing].get("quantity", 0) + qty
        else:
            cart.append({**product, "quantity": qty})
        cs = dict(state.get("completed_states") or {})
        cs["product"]  = True
        cs["quantity"] = True
        new_state = {**state, "cart": cart, "completed_states": cs, "current_step": "confirm_add"}
        _set_conv_state(conversation_id, new_state)
        return f"✅ {product['product_name']} × {qty} কার্টে যোগ হয়েছে!\nআর কিছু নেবেন? (হ্যাঁ/না)"

    return "কত পিস নেবেন? শুধু সংখ্যা লিখুন।"


async def _step_confirm_add(
    tenant_id: str, conversation_id: str, sender_id: str,
    msg: str, state: dict, plain_token: str, ai_config: dict,
) -> str:
    classified = _gemini_classify(msg, state, tenant_id, state.get("last_bot_message") or "")
    intent     = classified.get("intent", "unclear")
    data       = classified.get("data") or {}

    info_reply = _handle_info_query(intent, data, tenant_id, state)
    if info_reply:
        return info_reply

    if intent == "cancel_order":
        _clear_order_state(conversation_id, state)
        return "❌ অর্ডার বাতিল করা হয়েছে।"

    if intent == "want_more":
        new_state = {**state, "current_step": "selecting_products"}
        _set_conv_state(conversation_id, new_state)
        return "ঠিক আছে! আর কোন পণ্য নেবেন? নাম বলুন।"

    if intent in ("done_adding", "provide_name"):
        cs   = dict(state.get("completed_states") or {})
        name = data.get("name")
        if intent == "provide_name" and name:
            cs["name"] = True
            new_state  = {**state, "customer_name": name, "completed_states": cs, "current_step": "ask_phone"}
            _set_conv_state(conversation_id, new_state)
            return "📞 ফোন নম্বর দিন (01XXXXXXXXX):"
        new_state = {**state, "completed_states": cs, "current_step": "ask_name"}
        _set_conv_state(conversation_id, new_state)
        return "👤 আপনার নাম কী?"

    if intent == "provide_product":
        search_term = data.get("product_search_term") or ""
        if search_term:
            hits = _search_product_db(tenant_id, search_term)
            if hits:
                p         = hits[0]
                new_state = {**state, "last_searched_product": p["product_id"], "current_step": "ask_quantity"}
                _set_conv_state(conversation_id, new_state)
                return f"✅ {p['product_name']} (৳{p['price']:.0f}/পিস)\nকত পিস নেবেন?"
            new_state = {**state, "current_step": "ask_quantity"}
            _set_conv_state(conversation_id, new_state)
            return f"'{search_term}' পাওয়া যায়নি। আর কিছু নেবেন? (হ্যাঁ/না)"

    msg_lower = msg.strip().lower()
    if any(w in msg_lower for w in ["না", "na", "no", "nah", "nope"]):
        cs = dict(state.get("completed_states") or {})
        new_state = {**state, "completed_states": cs, "current_step": "ask_name"}
        _set_conv_state(conversation_id, new_state)
        return "👤 আপনার নাম কী?"

    return "আর কিছু নেবেন? হ্যাঁ বা না বলুন।"


async def _step_ask_name(
    tenant_id: str, conversation_id: str, sender_id: str,
    msg: str, state: dict, plain_token: str, ai_config: dict,
) -> str:
    classified = _gemini_classify(msg, state, tenant_id, state.get("last_bot_message") or "")
    intent     = classified.get("intent", "unclear")
    data       = classified.get("data") or {}

    info_reply = _handle_info_query(intent, data, tenant_id, state)
    if info_reply:
        return info_reply

    if intent == "cancel_order":
        _clear_order_state(conversation_id, state)
        return "❌ অর্ডার বাতিল করা হয়েছে।"

    name = data.get("name") or (msg.strip() if len(msg.strip()) >= 2 else None)
    if name and len(name) >= 2:
        cs    = dict(state.get("completed_states") or {})
        cs["name"] = True
        phone = data.get("phone")
        if phone and len(phone) == 11 and phone.startswith("01"):
            cs["phone"] = True
            address = data.get("address")
            if address:
                cs["address"] = True
                new_state = {**state, "customer_name": name, "customer_phone": phone,
                             "delivery_address": address, "completed_states": cs, "current_step": "show_summary"}
                _set_conv_state(conversation_id, new_state)
                return _build_order_summary_v2(new_state)
            new_state = {**state, "customer_name": name, "customer_phone": phone,
                         "completed_states": cs, "current_step": "ask_address"}
            _set_conv_state(conversation_id, new_state)
            return "📍 ডেলিভারি ঠিকানা দিন (বাড়ি/এলাকা/জেলা):"
        new_state = {**state, "customer_name": name, "completed_states": cs, "current_step": "ask_phone"}
        _set_conv_state(conversation_id, new_state)
        return "📞 ফোন নম্বর দিন (01XXXXXXXXX):"

    return "👤 আপনার নাম কী? (অন্তত ২ অক্ষর)"


async def _step_ask_phone(
    tenant_id: str, conversation_id: str, sender_id: str,
    msg: str, state: dict, plain_token: str, ai_config: dict,
) -> str:
    classified = _gemini_classify(msg, state, tenant_id, state.get("last_bot_message") or "")
    intent     = classified.get("intent", "unclear")
    data       = classified.get("data") or {}

    info_reply = _handle_info_query(intent, data, tenant_id, state)
    if info_reply:
        return info_reply

    if intent == "cancel_order":
        _clear_order_state(conversation_id, state)
        return "❌ অর্ডার বাতিল করা হয়েছে।"

    phone = data.get("phone") or normalize_bd_phone(msg.strip())
    if phone and len(phone) == 11 and phone.startswith("01"):
        cs    = dict(state.get("completed_states") or {})
        cs["phone"] = True
        address = data.get("address")
        if address:
            cs["address"] = True
            new_state = {**state, "customer_phone": phone, "delivery_address": address,
                         "completed_states": cs, "current_step": "show_summary"}
            _set_conv_state(conversation_id, new_state)
            return _build_order_summary_v2(new_state)
        new_state = {**state, "customer_phone": phone, "completed_states": cs, "current_step": "ask_address"}
        _set_conv_state(conversation_id, new_state)
        return "📍 ডেলিভারি ঠিকানা দিন (বাড়ি/এলাকা/জেলা):"

    return "📞 সঠিক ফোন নম্বর দিন (01XXXXXXXXX — ১১ ডিজিট):"


async def _step_ask_address(
    tenant_id: str, conversation_id: str, sender_id: str,
    msg: str, state: dict, plain_token: str, ai_config: dict,
) -> str:
    classified = _gemini_classify(msg, state, tenant_id, state.get("last_bot_message") or "")
    intent     = classified.get("intent", "unclear")
    data       = classified.get("data") or {}

    info_reply = _handle_info_query(intent, data, tenant_id, state)
    if info_reply:
        return info_reply

    if intent == "cancel_order":
        _clear_order_state(conversation_id, state)
        return "❌ অর্ডার বাতিল করা হয়েছে।"

    address = data.get("address") or (msg.strip() if len(msg.strip()) >= 5 else None)
    if address and len(address) >= 5:
        cs    = dict(state.get("completed_states") or {})
        cs["address"] = True
        new_state = {**state, "delivery_address": address, "completed_states": cs, "current_step": "show_summary"}
        _set_conv_state(conversation_id, new_state)
        return _build_order_summary_v2(new_state)

    return "📍 ডেলিভারি ঠিকানা দিন (বাড়ি নম্বর/এলাকা/জেলা — কমপক্ষে ৫ অক্ষর):"


async def _step_show_summary(
    tenant_id: str, conversation_id: str, sender_id: str,
    msg: str, state: dict, plain_token: str, ai_config: dict,
) -> str:
    classified = _gemini_classify(msg, state, tenant_id, state.get("last_bot_message") or "")
    intent     = classified.get("intent", "unclear")
    data       = classified.get("data") or {}

    info_reply = _handle_info_query(intent, data, tenant_id, state)
    if info_reply:
        return info_reply

    if intent == "cancel_order":
        _clear_order_state(conversation_id, state)
        return "❌ অর্ডার বাতিল করা হয়েছে।"

    if intent == "modify_info":
        field = (data.get("modify_field") or "").lower()
        value = data.get("modify_value") or ""
        if field == "name" and value:
            new_state = {**state, "customer_name": value}
            _set_conv_state(conversation_id, new_state)
            return _build_order_summary_v2(new_state)
        if field == "phone" and value:
            new_state = {**state, "customer_phone": value}
            _set_conv_state(conversation_id, new_state)
            return _build_order_summary_v2(new_state)
        if field == "address" and value:
            new_state = {**state, "delivery_address": value}
            _set_conv_state(conversation_id, new_state)
            return _build_order_summary_v2(new_state)
        return "কী পরিবর্তন করতে চান? নাম, ফোন, নাকি ঠিকানা?"

    if intent == "confirm_order":
        return await _execute_create_order(tenant_id, conversation_id, sender_id, state, plain_token, ai_config)

    msg_lower = msg.strip().lower()
    confirm_words = ["হ্যাঁ", "ha", "haa", "hya", "yes", "ok", "confirm", "done", "ঠিক আছে"]
    cancel_words  = ["না", "na", "no", "cancel", "বাতিল"]
    if any(w in msg_lower for w in confirm_words):
        return await _execute_create_order(tenant_id, conversation_id, sender_id, state, plain_token, ai_config)
    if any(w in msg_lower for w in cancel_words):
        _clear_order_state(conversation_id, state)
        return "❌ অর্ডার বাতিল করা হয়েছে।"

    return _build_order_summary_v2(state)


async def _execute_create_order(
    tenant_id: str, conversation_id: str, sender_id: str,
    state: dict, plain_token: str, ai_config: dict,
) -> str:
    cart    = state.get("cart") or []
    name    = state.get("customer_name") or ""
    phone   = state.get("customer_phone") or ""
    address = state.get("delivery_address") or ""

    if not cart:
        _clear_order_state(conversation_id, state)
        return "কার্টে কোনো পণ্য নেই। আবার শুরু করুন।"

    order_ids = []
    for item in cart:
        pid      = item.get("product_id")
        qty      = int(item.get("quantity") or 1)
        price    = float(item.get("price") or 0)
        pname    = item.get("product_name") or ""
        order_id = str(uuid.uuid4())
        row = {
            "order_id":             order_id,
            "tenant_id":            tenant_id,
            "conversation_id":      conversation_id,
            "customer_platform_id": sender_id,
            "product_id":           pid,
            "product_name":         pname,
            "quantity":             qty,
            "agreed_price":         price,
            "customer_name":        name,
            "customer_phone":       phone,
            "delivery_address":     address,
            "status":               "pending",
        }
        print(f"ORDER_INSERT attempting: {row}")
        try:
            result = supabase.table("orders").insert(row).execute()
            print(f"ORDER_INSERT result.data: {result.data}")
            if result.data:
                order_ids.append(order_id[:8])
            else:
                print(f"ORDER_INSERT no data returned (possible silent error)")
        except Exception as e:
            print(f"ORDER_INSERT exception: {type(e).__name__}: {e}")
            logger.error(f"_execute_create_order insert error: {type(e).__name__}: {e}")

    _clear_order_state(conversation_id, state)

    if not order_ids:
        return "অর্ডার সেভ করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।"

    total = sum(float(i.get("price") or 0) * int(i.get("quantity") or 1) for i in cart)
    refs  = ", ".join(order_ids)
    return (
        f"🎉 অর্ডার নিশ্চিত হয়েছে!\n"
        f"অর্ডার নং: {refs}\n"
        f"মোট: ৳{total:.0f}\n"
        f"আমরা শীঘ্রই যোগাযোগ করব।"
    )


async def _dispatch_step(
    tenant_id: str, conversation_id: str, sender_id: str,
    msg: str, state: dict, plain_token: str, ai_config: dict,
) -> str:
    step   = state.get("current_step", "selecting_products")
    kwargs = dict(
        tenant_id=tenant_id, conversation_id=conversation_id, sender_id=sender_id,
        msg=msg, state=state, plain_token=plain_token, ai_config=ai_config,
    )
    if step == "selecting_products":
        return await _step_selecting_products(**kwargs)
    if step == "ask_quantity":
        return await _step_ask_quantity(**kwargs)
    if step == "confirm_add":
        return await _step_confirm_add(**kwargs)
    if step == "ask_name":
        return await _step_ask_name(**kwargs)
    if step == "ask_phone":
        return await _step_ask_phone(**kwargs)
    if step == "ask_address":
        return await _step_ask_address(**kwargs)
    if step == "show_summary":
        return await _step_show_summary(**kwargs)
    _clear_order_state(conversation_id, state)
    return "অর্ডার ফ্লো রিসেট হয়েছে। আবার শুরু করুন।"


async def _handle_order_flow(
    tenant_id: str,
    conversation_id: str,
    sender_id: str,
    message_text: str,
    quick_reply_payload: Optional[str],
    state: dict,
    plain_token: str,
    ai_config: dict,
) -> bool:
    msg = (message_text or quick_reply_payload or "").strip()
    if not msg:
        return False

    order_timeout = state.get("order_timeout")
    if order_timeout:
        try:
            if datetime.now() > datetime.fromisoformat(order_timeout):
                _clear_order_state(conversation_id, state)
                timeout_msg = "⏰ অর্ডার সময়সীমা পেরিয়ে গেছে। নতুন অর্ডার দিতে আবার পণ্যের নাম লিখুন।"
                save_message(conversation_id, tenant_id, "bot", timeout_msg)
                send_reply(sender_id, timeout_msg, plain_token)
                return True
        except (ValueError, TypeError):
            pass

    reply = await _dispatch_step(tenant_id, conversation_id, sender_id, msg, state, plain_token, ai_config)

    try:
        fresh = (supabase.table("conversations")
                 .select("conversation_state")
                 .eq("conversation_id", conversation_id)
                 .maybe_single().execute().data or {})
        updated_state = fresh.get("conversation_state") or state
    except Exception:
        updated_state = state

    updated_state = {**updated_state, "last_bot_message": reply}
    _set_conv_state(conversation_id, updated_state)
    save_message(conversation_id, tenant_id, "bot", reply)
    send_reply(sender_id, reply, plain_token)
    return True

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
    try:
        result = supabase.table("conversations").update({
            "conversation_state": state,
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("conversation_id", str(conversation_id)).execute()
        print(f"SAVE RESULT conv={conversation_id}: {result.data}")
        logger.info(f"SAVE RESULT conv={conversation_id}: {result.data}")
        if not result.data:
            print(f"ERROR: Save returned no data! conv={conversation_id} state={state}")
            logger.error(f"ERROR: conversation_state save returned no data for conv={conversation_id}. State was: {state}")
            return
        # Verify the write actually landed
        verify = (
            supabase.table("conversations")
            .select("conversation_state")
            .eq("conversation_id", str(conversation_id))
            .single()
            .execute()
        )
        print(f"VERIFY STATE IN DB: {verify.data}")
        logger.info(f"VERIFY STATE IN DB conv={conversation_id}: {verify.data}")
    except Exception as e:
        print(f"SAVE EXCEPTION conv={conversation_id}: {e}")
        logger.error(f"SAVE EXCEPTION conv={conversation_id}: {e}", exc_info=True)


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
    # ── 0. Migrate legacy order_flow formats ─────────────────────────────────
    if isinstance(state.get("order_flow"), dict):
        state = {k: v for k, v in state.items() if k not in _ORDER_STATE_KEYS}
        _set_conv_state(conversation_id, state)
    elif isinstance(state.get("order_flow"), str) and state.get("order_flow") not in ("active", ""):
        # Old format: order_flow stored the step name; migrate to new format
        old_step = state["order_flow"]
        new_state = {**{k: v for k, v in state.items() if k not in _ORDER_STATE_KEYS},
                     **_new_order_state(), "current_step": old_step}
        state = new_state
        _set_conv_state(conversation_id, state)

    # ── 0.5. Abuse detection ──────────────────────────────────────────────────
    escalation_keywords = ai_config.get("escalation_keywords") or []
    is_abusive = _detect_abuse(message_text or "") if message_text else False
    is_escalation = message_text and any(
        kw.lower() in message_text.lower() for kw in escalation_keywords if kw
    )
    if is_abusive or is_escalation:
        abusive_count = state.get("abusive_count", 0) + 1
        state = {**state, "abusive_count": abusive_count}
        if abusive_count >= 3:
            supabase.table("conversations").update({
                "is_ai_active": False,
                "conversation_state": state,
            }).eq("conversation_id", conversation_id).execute()
            escalation_msg = (
                "আমি আপনার সমস্যা সমাধানে অক্ষম।\n"
                "আমাদের টিম শীঘ্রই যোগাযোগ করবে।"
            )
            save_message(conversation_id, tenant_id, "bot", escalation_msg)
            send_reply(sender_id, escalation_msg, plain_token)
            return
        _set_conv_state(conversation_id, state)
        if abusive_count == 1:
            calm_reply = (
                "আমি আপনাকে সাহায্য করতে এখানে আছি।\n"
                "আপনার কি কোনো পণ্য দরকার বা অন্য কিছু জানতে চান?"
            )
        else:
            calm_reply = (
                "⚠️ অনুগ্রহ করে ভদ্রভাবে কথা বলুন।\n"
                "আরও সমস্যা হলে আমাদের টিম সরাসরি সাহায্য করবে।"
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

    # ── 2.5 Active Order Flow ────────────────────────────────────────────────
    if state.get("order_flow") == "active" and (message_text or quick_reply_payload):
        handled = await _handle_order_flow(
            tenant_id, conversation_id, sender_id, message_text,
            quick_reply_payload, state, plain_token, ai_config,
        )
        if handled:
            return

    # ── 2.7 Order history — direct DB lookup, no Gemini needed ─────────────────
    if message_text and _is_order_history_query(message_text):
        phone = state.get("customer_phone")
        if phone:
            reply = _get_order_history_reply(tenant_id, phone)
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
            return
        else:
            # Phone not in state — ask for it, store intent
            _set_conv_state(conversation_id, {**state, "pending_action": "order_history"})
            reply = "অর্ডার দেখতে আপনার ফোন নম্বর দিন (01XXXXXXXXX):"
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
            return

    # ── 2.8 Pending action: order_history — customer just gave their phone ──────
    if message_text and state.get("pending_action") == "order_history":
        phone = normalize_bd_phone(message_text)
        if phone:
            new_state = {k: v for k, v in state.items() if k != "pending_action"}
            new_state["customer_phone"] = phone
            _set_conv_state(conversation_id, new_state)
            reply = _get_order_history_reply(tenant_id, phone)
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
            return
        else:
            reply = "সঠিক ফোন নম্বর দিন (01XXXXXXXXX):"
            save_message(conversation_id, tenant_id, "bot", reply)
            send_reply(sender_id, reply, plain_token)
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

    # ── 5.5 Order trigger — keyword fast path (no extra API call) ───────────────
    if message_text and _is_order_trigger(message_text) and not state.get("order_flow"):
        new_flow = {**{k: v for k, v in state.items() if k not in _ORDER_STATE_KEYS}, **_new_order_state()}
        cart_item = _extract_product_for_order(tenant_id, message_text, state)
        if cart_item and cart_item.get("product_id"):
            new_flow["cart"]            = [cart_item]
            new_flow["current_step"]    = "ask_quantity"
            new_flow["last_searched_product"] = cart_item["product_id"]
        _set_conv_state(conversation_id, new_flow)
        if cart_item and cart_item.get("product_id"):
            pname = cart_item.get("product_name") or "পণ্য"
            reply = f"✅ পাওয়া গেছে: {pname} (৳{float(cart_item.get('price') or 0):.0f}/পিস)\nকত পিস নেবেন?"
        else:
            reply = "কোন পণ্য অর্ডার করতে চান? পণ্যের নাম বলুন।"
        new_flow["last_bot_message"] = reply
        _set_conv_state(conversation_id, new_flow)
        save_message(conversation_id, tenant_id, "bot", reply)
        send_reply(sender_id, reply, plain_token)
        return

    # ── 5.6 Gemini intent detection — only when buying context exists ────────────
    # Guard: only fire when customer previously showed interest in a product OR
    # message contains a quick buying-adjacent word. Avoids extra API call for
    # every general chat message.
    _BUYING_ADJACENT = ["nibo", "nebo", "dao", "den", "pathao", "jog", "add", "chai", "hae", "ha", "ok", "hm"]
    _has_buying_context = (
        bool(state.get("interested_product"))
        or bool(state.get("negotiated_price"))
        or any(w in (message_text or "").lower() for w in _BUYING_ADJACENT)
    )
    if message_text and not state.get("order_flow") and _has_buying_context:
        intent = await ai_service.detect_order_intent(message_text, messages, state)
        if intent["is_order_intent"] and intent["confidence"] in ("high", "medium"):
            product_name = intent.get("product_name") or state.get("interested_product") or ""
            cart_item    = _extract_product_for_order(tenant_id, product_name, state) if product_name else {}
            new_flow     = {**{k: v for k, v in state.items() if k not in _ORDER_STATE_KEYS}, **_new_order_state()}
            if cart_item and cart_item.get("product_id"):
                new_flow["cart"]                  = [cart_item]
                new_flow["current_step"]          = "ask_quantity"
                new_flow["last_searched_product"] = cart_item["product_id"]
                pname  = cart_item.get("product_name") or "পণ্য"
                reply  = f"✅ পাওয়া গেছে: {pname} (৳{float(cart_item.get('price') or 0):.0f}/পিস)\nকত পিস নেবেন?"
            else:
                reply = "কোন পণ্য অর্ডার করতে চান? পণ্যের নাম বলুন।"
            new_flow["last_bot_message"] = reply
            _set_conv_state(conversation_id, new_flow)
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

    if order_data and not state.get("order_flow"):
        product_name = order_data.get("product_name") or ""
        cart_item    = _extract_product_for_order(tenant_id, product_name, state) if product_name else {}
        new_flow     = {**{k: v for k, v in state.items() if k not in _ORDER_STATE_KEYS}, **_new_order_state()}
        if state_update:
            new_flow.update(state_update)
        if cart_item and cart_item.get("product_id"):
            new_flow["cart"]                  = [cart_item]
            new_flow["current_step"]          = "ask_quantity"
            new_flow["last_searched_product"] = cart_item["product_id"]
            pname      = cart_item.get("product_name") or "পণ্য"
            flow_reply = f"✅ পাওয়া গেছে: {pname} (৳{float(cart_item.get('price') or 0):.0f}/পিস)\nকত পিস নেবেন?"
        else:
            flow_reply = "কোন পণ্য অর্ডার করতে চান? পণ্যের নাম বলুন।"
        new_flow["last_bot_message"] = flow_reply
        _set_conv_state(conversation_id, new_flow)
        save_message(conversation_id, tenant_id, "bot", flow_reply)
        send_reply(sender_id, flow_reply, plain_token)
        return

    if state_update:
        memory_service.update_state(conversation_id, state_update)

    save_message(conversation_id, tenant_id, "bot", reply_text)

    try:
        memory_service.maybe_summarise(conversation_id)
    except Exception as e:
        logger.warning(f"Summarise failed: {e}")

    send_reply(sender_id, reply_text, plain_token)