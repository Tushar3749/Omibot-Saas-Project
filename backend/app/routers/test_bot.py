"""
OmniBot SaaS — Test Bot Router
Uses the real order-flow state machine + AIService.
Conversation state persists in Supabase (platform="test").
Each tenant gets ONE stable test conversation so state carries across messages.
"""
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.services.ai_service import AIService
from app.services.webhook_service import (
    _ALL_FLOW_KEYS,
    _SOFT_NO,
    _STRONG_CANCEL,
    _build_order_summary,
    _extract_product_for_order,
    _set_conv_state,
    get_ai_config,
    get_or_create_conversation,
    get_recent_messages,
    save_message,
)

logger = logging.getLogger(__name__)
router = APIRouter()
ai_service = AIService()


class TestBotRequest(BaseModel):
    message: str
    quick_reply_payload: Optional[str] = None


# ── Inline order-flow state machine (no Meta API calls) ───────────────────────

def _run_order_flow(
    msg: str,
    msg_lower: str,
    payload: str,
    state: dict,
    conversation_id: str,
    tenant_id: str,
) -> Optional[str]:
    """
    Mirrors _handle_strict_order_flow but returns the reply string directly
    instead of calling send_reply / send_quick_reply.
    Returns None when there is no active order_flow (caller should use Gemini).
    """
    step = state.get("order_flow")
    if not step:
        return None

    def _clear_flow() -> str:
        new_state = {k: v for k, v in state.items() if k not in _ALL_FLOW_KEYS}
        _set_conv_state(conversation_id, new_state)
        return "অর্ডার বাতিল হয়েছে। আর কোনো সাহায্য করতে পারি?"

    # Hard cancel via quick-reply
    if payload == "ORDER_CANCEL":
        return _clear_flow()

    # ── collecting_name ────────────────────────────────────────────────────────
    if step == "collecting_name":
        digits_only = all(c.isdigit() or c.isspace() for c in msg)
        if len(msg) < 2 or digits_only:
            return "আপনার পূর্ণ নাম লিখুন (শুধু নম্বর নয়):"
        new_state = {**state, "order_flow": "collecting_phone", "customer_name": msg}
        _set_conv_state(conversation_id, new_state)
        return "📞 আপনার ফোন নম্বর দিন (01XXXXXXXXX):"

    # ── collecting_phone ───────────────────────────────────────────────────────
    if step == "collecting_phone":
        digits = "".join(c for c in msg if c.isdigit())
        phone = digits if re.match(r"^01[3-9]\d{8}$", digits) else None
        if not phone:
            return "সঠিক বাংলাদেশি ফোন নম্বর দিন (01XXXXXXXXX):"
        new_state = {**state, "order_flow": "collecting_address", "customer_phone": phone}
        _set_conv_state(conversation_id, new_state)
        return "📍 ডেলিভারি ঠিকানা দিন (বাড়ি/গ্রাম, থানা, জেলা):"

    # ── collecting_address ─────────────────────────────────────────────────────
    if step == "collecting_address":
        if len(msg) < 10:
            return "সম্পূর্ণ ঠিকানা দিন (বাড়ি/গ্রাম, থানা, জেলা — কমপক্ষে ১০ অক্ষর):"
        new_state = {**state, "order_flow": "adding_more_products", "delivery_address": msg}
        _set_conv_state(conversation_id, new_state)
        return "আর কোনো পণ্য যোগ করতে চান? (হ্যাঁ / না)"

    # ── adding_more_products ───────────────────────────────────────────────────
    if step == "adding_more_products":
        yes_kws = ["হ্যাঁ", "হা", "yes", "ha", "hae", "আরো", "আর", "যোগ"]
        # Strong cancel → wipe entire order
        if any(w in msg_lower for w in _STRONG_CANCEL) or payload == "ORDER_CANCEL":
            return _clear_flow()
        # Soft "no more products" → advance to confirming
        if any(w in msg_lower for w in _SOFT_NO):
            new_state = {**state, "order_flow": "confirming"}
            _set_conv_state(conversation_id, new_state)
            summary, _ = _build_order_summary(new_state)
            return summary
        # Yes → ask for product name
        if any(w in msg_lower for w in yes_kws):
            new_state = {**state, "order_flow": "idle_with_cart"}
            _set_conv_state(conversation_id, new_state)
            return "কোন পণ্য যোগ করতে চান? নাম বা বিবরণ লিখুন:"
        return "আর কোনো পণ্য যোগ করতে চান? (হ্যাঁ / না)"

    # ── idle_with_cart ─────────────────────────────────────────────────────────
    if step == "idle_with_cart":
        product_info = _extract_product_for_order(tenant_id, msg, state)
        if product_info:
            cart = list(state.get("cart") or [])
            cart.append({
                "name":       product_info.get("name", msg),
                "product_id": product_info.get("product_id"),
                "price":      product_info.get("price"),
                "qty":        1,
            })
            new_state = {**state, "cart": cart, "order_flow": "adding_more_products"}
            _set_conv_state(conversation_id, new_state)
            pname = cart[-1]["name"]
            return f"✅ '{pname}' কার্টে যোগ হয়েছে! আর কোনো পণ্য যোগ করতে চান? (হ্যাঁ / না)"
        return "পণ্যটি খুঁজে পাওয়া যায়নি। অন্য নাম দিয়ে চেষ্টা করুন:"

    # ── confirming ─────────────────────────────────────────────────────────────
    if step == "confirming":
        _CANCEL_KWS  = ["না", "na", "no", "cancel", "বাতিল", "na chai"]
        _CONFIRM_KWS = ["হ্যাঁ", "হা", "ha", "hae", "yes", "ok", "okay", "confirm",
                        "ঠিক আছে", "ji", "জি", "নিশ্চিত", "হ্যা"]
        if any(w in msg_lower for w in _CANCEL_KWS):
            return _clear_flow()
        if payload == "ORDER_CONFIRM" or any(w in msg_lower for w in _CONFIRM_KWS):
            summary, _ = _build_order_summary(state)
            new_state = {k: v for k, v in state.items() if k not in _ALL_FLOW_KEYS}
            _set_conv_state(conversation_id, new_state)
            return (
                f"✅ টেস্ট অর্ডার সিমুলেশন সম্পন্ন!\n\n{summary}\n\n"
                "(টেস্ট মোডে অর্ডার ডেটাবেজে সেভ হয়নি — লাইভ বটে আসল অর্ডার হবে।)"
            )
        summary, _ = _build_order_summary(state)
        return f"{summary}\n\nনিশ্চিত করতে 'হ্যাঁ' বা বাতিল করতে 'না' লিখুন।"

    # Unknown step — clear it and fall through to Gemini
    new_state = {k: v for k, v in state.items() if k not in _ALL_FLOW_KEYS}
    _set_conv_state(conversation_id, new_state)
    return None


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/chat")
async def test_bot_chat(
    body: TestBotRequest,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]

    # Stable test conversation — same conversation_id for ALL messages from this tenant
    conv = get_or_create_conversation(tid, f"test_{tid}", "test")
    conversation_id = conv["conversation_id"]

    # Load state BEFORE saving customer message (prevents duplication in history)
    state   = conv.get("conversation_state") or {}
    summary = conv.get("conversation_summary")
    messages = get_recent_messages(conversation_id, limit=20)

    print(f"TEST_BOT conv={conversation_id} step={state.get('order_flow')} payload={body.quick_reply_payload}")
    logger.info(f"TEST_BOT conv={conversation_id} state={state}")

    # Save customer message
    msg = (body.message or "").strip()
    save_message(conversation_id, tid, "customer", msg)

    msg_lower = msg.lower()
    payload   = body.quick_reply_payload or ""

    # 1. Try order flow state machine first
    reply = _run_order_flow(msg, msg_lower, payload, state, conversation_id, tid)

    # 2. If no active order flow, call real AI service
    if reply is None:
        ai_cfg = get_ai_config(tid)
        try:
            ai_result = await ai_service.generate_reply(
                tenant_id=tid,
                conversation_id=conversation_id,
                customer_message=msg,
                ai_config=ai_cfg,
                raw_messages=messages,
                conversation_state=state,
                conversation_summary=summary,
            )
            reply = ai_result.get("reply") or "দুঃখিত, উত্তর দিতে পারছি না।"

            # If Gemini detected order intent, start the flow
            order_data   = ai_result.get("order_data")
            state_update = ai_result.get("state_update") or {}
            if order_data and not state.get("order_flow"):
                from app.services.webhook_service import _extract_product_for_order as _epfo
                product_name = order_data.get("product_name") or ""
                cart_item = _epfo(tid, product_name, state) if product_name else {}
                if not cart_item and product_name:
                    cart_item = {
                        "name":       product_name,
                        "product_id": None,
                        "price":      order_data.get("agreed_price"),
                        "qty":        int(order_data.get("quantity") or 1),
                    }
                cart = [cart_item] if cart_item else []
                timeout_dt = (datetime.now() + timedelta(hours=2)).isoformat()
                new_state = {
                    **state,
                    **state_update,
                    "order_flow":    "collecting_name",
                    "cart":          cart,
                    "order_timeout": timeout_dt,
                }
                _set_conv_state(conversation_id, new_state)
                reply = "আপনার নাম কী?"
            elif state_update:
                _set_conv_state(conversation_id, {**state, **state_update})

        except Exception as exc:
            logger.error(f"test_bot AI error: {exc}", exc_info=True)
            raise HTTPException(status_code=502, detail=f"AI সার্ভিস সমস্যা: {exc}")

    # Save bot reply
    save_message(conversation_id, tid, "bot", reply)

    # Re-read final state from DB for response
    conv_now = (
        supabase.table("conversations")
        .select("conversation_state")
        .eq("conversation_id", str(conversation_id))
        .single()
        .execute()
    )
    final_state = (conv_now.data or {}).get("conversation_state") or {}
    print(f"TEST_BOT FINAL STATE: {final_state}")

    return {
        "reply":           reply,
        "conversation_id": conversation_id,
        "order_flow":      final_state.get("order_flow"),
        "state":           final_state,
    }
