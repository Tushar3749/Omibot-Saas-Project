"""
OmniBot SaaS — Test Bot Router
Fully Gemini-powered order flow — mirrors _handle_strict_order_flow logic
without Meta API calls. Returns reply strings directly.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.services.ai_service import AIService
import json

from app.services.webhook_service import (
    _ALL_FLOW_KEYS,
    _apply_extracted_to_state,
    _build_order_summary_v2,
    _cart_add_item,
    _extract_product_for_order,
    _gen_order_ref,
    _gemini_order_intent,
    _next_missing_step,
    _set_conv_state,
    _step_question_v2,
    get_ai_config,
    get_or_create_conversation,
    get_recent_messages,
    save_message,
    save_order,
)

logger = logging.getLogger(__name__)
router = APIRouter()
ai_service = AIService()


class TestBotRequest(BaseModel):
    message: str
    quick_reply_payload: Optional[str] = None


# ── Gemini-powered order flow (no Meta API calls) ─────────────────────────────

def _run_order_flow(
    msg: str,
    payload: str,
    state: dict,
    conversation_id: str,
    tenant_id: str,
) -> Optional[str]:
    """
    Mirrors _handle_strict_order_flow using _gemini_order_intent.
    Returns reply string or None (caller falls through to normal AI).
    """
    step = state.get("order_flow")
    if not step:
        return None

    def _clear_flow() -> str:
        clean = {k: v for k, v in state.items() if k not in _ALL_FLOW_KEYS}
        _set_conv_state(conversation_id, clean)
        return "❌ অর্ডার বাতিল করা হয়েছে।"

    _ACTIVE_STEPS = {
        "selecting_products", "collecting_name", "collecting_phone",
        "collecting_address", "confirming",
        "adding_more_products", "idle_with_cart",  # legacy aliases
    }
    if step not in _ACTIVE_STEPS:
        return None

    # Normalise legacy step names
    if step in ("adding_more_products", "idle_with_cart"):
        step = "selecting_products"
        state = {**state, "order_flow": "selecting_products"}

    # Hard cancel via quick-reply
    if payload == "ORDER_CANCEL":
        return _clear_flow()

    intent_data = _gemini_order_intent(msg, state, tenant_id)
    intent      = intent_data.get("intent", "other")
    extracted   = intent_data.get("extracted_data") or {}
    suggested   = intent_data.get("suggested_reply") or ""

    new_state = _apply_extracted_to_state(state, extracted)
    new_state["order_flow"] = step

    # ── cancel ────────────────────────────────────────────────────────────────
    if intent == "cancel_order":
        return _clear_flow()

    # ── provide_product ───────────────────────────────────────────────────────
    if intent == "provide_product":
        search_term  = extracted.get("product_name") or msg
        qty          = int(extracted.get("product_quantity") or 1)
        product_info = _extract_product_for_order(tenant_id, search_term, state)
        if product_info:
            product_info["quantity"] = qty
            cart      = _cart_add_item(new_state.get("cart") or [], product_info)
            new_state = {
                **new_state, "cart": cart,
                "order_flow":    "selecting_products",
                "order_timeout": (datetime.now() + timedelta(hours=2)).isoformat(),
            }
            _set_conv_state(conversation_id, new_state)
            pname = product_info.get("product_name") or search_term
            return f"✅ '{pname}' কার্টে যোগ হয়েছে! আর কিছু নেবেন? (হ্যাঁ / না)"
        new_state["order_flow"] = "selecting_products"
        _set_conv_state(conversation_id, new_state)
        return f"'{search_term}' পাওয়া যায়নি। অন্য নামে চেষ্টা করুন:"

    # ── done_adding ───────────────────────────────────────────────────────────
    if intent == "done_adding":
        if not (new_state.get("cart") or []):
            _set_conv_state(conversation_id, new_state)
            return "আপনার কার্টে কোনো পণ্য নেই। আগে পণ্য যোগ করুন।"
        next_step = _next_missing_step(new_state)
        new_state["order_flow"] = next_step
        _set_conv_state(conversation_id, new_state)
        if next_step == "confirming":
            return _build_order_summary_v2(new_state)
        return _step_question_v2(next_step)

    # ── provide_name / provide_phone / provide_address ────────────────────────
    if intent in ("provide_name", "provide_phone", "provide_address"):
        next_step = _next_missing_step(new_state)
        new_state["order_flow"] = next_step
        _set_conv_state(conversation_id, new_state)
        if next_step == "confirming":
            return _build_order_summary_v2(new_state)
        return _step_question_v2(next_step)

    # ── modify_name / modify_phone / modify_address ───────────────────────────
    import re as _re
    if intent in ("modify_name", "modify_phone", "modify_address"):
        field_map = {
            "modify_name":    ("customer_name",    "নাম",    extracted.get("customer_name")),
            "modify_phone":   ("customer_phone",   "ফোন",    extracted.get("phone")),
            "modify_address": ("delivery_address", "ঠিকানা", extracted.get("address")),
        }
        key, label, raw_value = field_map[intent]
        value = (raw_value or "").strip()
        if key == "customer_phone" and value:
            digits = "".join(c for c in value if c.isdigit())
            value  = digits if _re.match(r"^01[3-9]\d{8}$", digits) else ""
        if value:
            new_state[key] = value
        next_step = _next_missing_step(new_state)
        new_state["order_flow"] = next_step
        _set_conv_state(conversation_id, new_state)
        if next_step == "confirming":
            return f"✏️ {label} আপডেট হয়েছে!\n\n{_build_order_summary_v2(new_state)}"
        return f"✏️ {label} আপডেট হয়েছে! {_step_question_v2(next_step)}"

    # ── modify_product ────────────────────────────────────────────────────────
    if intent == "modify_product":
        pname   = (extracted.get("product_name") or "").lower()
        new_qty = int(extracted.get("product_quantity") or 0)
        cart    = list(new_state.get("cart") or [])
        updated = False
        if pname and new_qty > 0:
            for item in cart:
                iname = (item.get("product_name") or item.get("name") or "").lower()
                if pname in iname or iname in pname:
                    item["quantity"] = new_qty
                    updated = True
                    break
        if updated:
            new_state["cart"] = cart
            _set_conv_state(conversation_id, new_state)
            return f"✏️ পণ্য আপডেট হয়েছে!\n\n{_build_order_summary_v2(new_state)}"
        _set_conv_state(conversation_id, new_state)
        return "কোন পণ্যটি পরিবর্তন করতে চান? নাম ও নতুন পরিমাণ বলুন।"

    # ── remove_product ────────────────────────────────────────────────────────
    if intent == "remove_product":
        pname    = (extracted.get("product_name") or "").lower()
        cart     = new_state.get("cart") or []
        new_cart = [
            item for item in cart
            if pname not in (item.get("product_name") or item.get("name") or "").lower()
        ]
        new_state["cart"] = new_cart
        if new_cart:
            new_state["order_flow"] = _next_missing_step(new_state)
            _set_conv_state(conversation_id, new_state)
            return f"🗑️ পণ্য সরানো হয়েছে!\n\n{_build_order_summary_v2(new_state)}"
        new_state["order_flow"] = "selecting_products"
        _set_conv_state(conversation_id, new_state)
        return "কার্ট এখন খালি। কোন পণ্য নিতে চান?"

    # ── confirm_order ─────────────────────────────────────────────────────────
    if intent == "confirm_order" or payload == "ORDER_CONFIRM":
        missing = _next_missing_step(new_state)
        if missing != "confirming":
            _set_conv_state(conversation_id, new_state)
            return f"অর্ডার করতে আরও তথ্য দরকার। {_step_question_v2(missing)}"

        cart             = new_state.get("cart") or []
        customer_name    = new_state.get("customer_name", "")
        customer_phone   = new_state.get("customer_phone", "")
        delivery_address = new_state.get("delivery_address", "")
        first_item       = cart[0] if cart else {}
        product_name     = first_item.get("product_name") or first_item.get("name") or "পণ্য"
        product_id       = first_item.get("product_id")
        price            = first_item.get("price")
        quantity         = int(first_item.get("quantity") or 1)
        order_ref        = _gen_order_ref()

        order_data = {
            "product_name":     product_name,
            "product_id":       product_id,
            "quantity":         quantity,
            "agreed_price":     float(price) if price else None,
            "customer_name":    customer_name,
            "customer_phone":   customer_phone,
            "delivery_address": delivery_address,
            "order_ref":        order_ref,
            "notes":            json.dumps({"cart": cart}) if len(cart) > 1 else None,
        }
        save_order(tenant_id, conversation_id, f"test_{tenant_id}", order_data)

        clean = {k: v for k, v in new_state.items() if k not in _ALL_FLOW_KEYS}
        _set_conv_state(conversation_id, clean)

        total     = sum(float(i.get("price") or 0) * int(i.get("quantity") or 1) for i in cart)
        items_str = "\n".join(
            f"  - {i.get('product_name') or 'পণ্য'} × {i.get('quantity') or 1}"
            for i in cart
        )
        return (
            f"✅ অর্ডার নেওয়া হয়েছে!\n"
            f"🔖 ID: {order_ref}\n"
            f"🛒 পণ্য:\n{items_str}\n"
            f"💰 মোট: ৳{total:.0f}\n"
            f"👤 {customer_name}\n"
            f"📞 {customer_phone}\n"
            f"📍 {delivery_address}\n\n"
            f"আমরা শীঘ্রই যোগাযোগ করব। ধন্যবাদ! 🙏"
        )

    # ── ask_question / frustrated / other ─────────────────────────────────────
    current_step = new_state.get("order_flow") or step
    reminder = f"\n\n📌 আপনার অর্ডার চলছে। {_step_question_v2(current_step)}"
    _set_conv_state(conversation_id, new_state)
    return (suggested or "দুঃখিত, বুঝতে পারিনি।") + reminder


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/chat")
async def test_bot_chat(
    body: TestBotRequest,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]

    conv = get_or_create_conversation(tid, f"test_{tid}", "test")
    conversation_id = conv["conversation_id"]

    state    = conv.get("conversation_state") or {}
    summary  = conv.get("conversation_summary")
    messages = get_recent_messages(conversation_id, limit=20)

    print(f"TEST_BOT conv={conversation_id} step={state.get('order_flow')} payload={body.quick_reply_payload}")
    logger.info(f"TEST_BOT conv={conversation_id} state={state}")

    msg     = (body.message or "").strip()
    payload = body.quick_reply_payload or ""
    save_message(conversation_id, tid, "customer", msg)

    # 1. Active order flow → Gemini state machine
    reply = _run_order_flow(msg, payload, state, conversation_id, tid)

    # 2. No active flow → normal AI + check for order intent
    if reply is None:
        ai_cfg = get_ai_config(tid)
        try:
            ai_result    = await ai_service.generate_reply(
                tenant_id=tid,
                conversation_id=conversation_id,
                customer_message=msg,
                ai_config=ai_cfg,
                raw_messages=messages,
                conversation_state=state,
                conversation_summary=summary,
            )
            reply        = ai_result.get("reply") or "দুঃখিত, উত্তর দিতে পারছি না।"
            order_data   = ai_result.get("order_data")
            state_update = ai_result.get("state_update") or {}

            if order_data and not state.get("order_flow"):
                product_name = order_data.get("product_name") or ""
                cart_item  = _extract_product_for_order(tid, product_name, state) if product_name else {}
                cart       = _cart_add_item([], cart_item) if cart_item else []
                timeout_dt = (datetime.now() + timedelta(hours=2)).isoformat()
                new_state  = {
                    **state,
                    **state_update,
                    "order_flow":    "selecting_products",
                    "cart":          cart,
                    "order_timeout": timeout_dt,
                }
                _set_conv_state(conversation_id, new_state)
                if cart and cart_item:
                    pname = cart_item.get("product_name") or "পণ্য"
                    reply = f"✅ '{pname}' কার্টে যোগ হয়েছে! আর কিছু নেবেন? (হ্যাঁ / না)"
                else:
                    reply = "কোন পণ্য অর্ডার করতে চান? পণ্যের নাম বলুন।"
            elif state_update:
                _set_conv_state(conversation_id, {**state, **state_update})

        except Exception as exc:
            logger.error(f"test_bot AI error: {exc}", exc_info=True)
            raise HTTPException(status_code=502, detail=f"AI সার্ভিস সমস্যা: {exc}")

    save_message(conversation_id, tid, "bot", reply)

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


@router.post("/reset")
async def test_bot_reset(tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    conv = get_or_create_conversation(tid, f"test_{tid}", "test")
    conversation_id = conv["conversation_id"]

    _set_conv_state(conversation_id, {})
    try:
        supabase.table("messages").delete().eq("conversation_id", str(conversation_id)).execute()
    except Exception as e:
        logger.warning(f"test_bot_reset: failed to delete messages: {e}")

    logger.info(f"TEST_BOT reset for tenant={tid} conv={conversation_id}")
    return {"ok": True, "conversation_id": conversation_id}
