"""
OmniBot SaaS — Test Bot Router
Mirrors _handle_order_flow without Meta API calls.
"""
import logging
from datetime import datetime
from typing import Optional

import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.services.ai_service import AIService
from app.services import image_search_service as img_svc

from app.services.webhook_service import (
    _ORDER_STATE_KEYS,
    _build_cart_text,
    _build_order_summary_v2,
    _build_product_catalog_for_ai,
    _clear_order_state,
    _dispatch_step,
    _extract_product_for_order,
    _gen_order_ref,
    _gemini_classify,
    _get_step_question,
    _handle_info_query,
    _new_order_state,
    _query_active_discounts,
    _query_delivery_charge,
    _query_price,
    _query_product_list,
    _query_stock,
    _search_product_db,
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


async def _run_order_flow(
    msg: str,
    payload: str,
    state: dict,
    conversation_id: str,
    tenant_id: str,
) -> Optional[str]:
    """
    Mirrors _handle_order_flow without send_reply calls.
    Returns reply string or None (falls through to normal AI).
    """
    if state.get("order_flow") != "active":
        return None

    effective_msg = (msg or payload or "").strip()
    if not effective_msg:
        return None

    # Timeout check
    order_timeout = state.get("order_timeout")
    if order_timeout:
        try:
            if datetime.now() > datetime.fromisoformat(order_timeout):
                _clear_order_state(conversation_id, state)
                return "⏰ অর্ডার সময়সীমা পেরিয়ে গেছে। নতুন অর্ডার দিতে আবার পণ্যের নাম লিখুন।"
        except (ValueError, TypeError):
            pass

    reply = await _dispatch_step(
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        sender_id=f"test_{tenant_id}",
        msg=effective_msg,
        state=state,
        plain_token="",
        ai_config=get_ai_config(tenant_id),
    )

    # Refresh state and save last_bot_message
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
    return reply


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/chat")
async def test_bot_chat(
    body: TestBotRequest,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]

    conv            = get_or_create_conversation(tid, f"test_{tid}", "test")
    conversation_id = conv["conversation_id"]

    state    = conv.get("conversation_state") or {}
    summary  = conv.get("conversation_summary")
    messages = get_recent_messages(conversation_id, limit=20)

    logger.info(f"TEST_BOT conv={conversation_id} step={state.get('current_step')} flow={state.get('order_flow')}")

    msg     = (body.message or "").strip()
    payload = body.quick_reply_payload or ""
    save_message(conversation_id, tid, "customer", msg)

    # Migrate legacy order_flow format
    if isinstance(state.get("order_flow"), str) and state.get("order_flow") not in ("active", ""):
        old_step = state["order_flow"]
        state = {**{k: v for k, v in state.items() if k not in _ORDER_STATE_KEYS},
                 **_new_order_state(), "current_step": old_step}
        _set_conv_state(conversation_id, state)

    # 1. Active order flow
    reply = await _run_order_flow(msg, payload, state, conversation_id, tid)

    # 2. No active flow → check for product image request BEFORE calling Gemini
    image_url: Optional[str] = None
    if reply is None:
        ai_cfg = get_ai_config(tid)
        if ai_cfg.get("product_image_auto_send", True) and img_svc.should_trigger_image_search(msg):
            intent = await asyncio.to_thread(img_svc.extract_product_image_intent, msg)
            if intent.get("intent") == "see_product_image":
                product_name = intent.get("product_name") or None
                sku          = intent.get("sku") or None
                extra_kw     = intent.get("keywords") or []
                product = await asyncio.to_thread(
                    img_svc.get_product_with_image, tid, product_name, sku, extra_kw or None
                )
                # Context fallback: last product the customer was discussing
                if not product:
                    last_pid = state.get("last_searched_product") or state.get("last_mentioned_product")
                    if last_pid:
                        product = await asyncio.to_thread(
                            img_svc.get_product_with_image_by_id, tid, last_pid
                        )
                if product:
                    image_url = product.get("image_url") or None
                    name  = product["name"]
                    price = float(product.get("mrp") or 0)
                    if image_url:
                        reply = f"এই হলো {name}-এর ছবি: (৳{price:,.0f})"
                    else:
                        reply = f"দুঃখিত, {name}-এর ছবি এখন নেই।"
                else:
                    reply = "কোন পণ্যের ছবি দেখতে চান? পণ্যের নাম বলুন।"

    # 3. Normal AI + check for order intent
    if reply is None:
        ai_cfg = get_ai_config(tid)
        try:
            ai_result  = await ai_service.generate_reply(
                tenant_id=tid,
                conversation_id=conversation_id,
                customer_message=msg,
                ai_config=ai_cfg,
                raw_messages=messages,
                conversation_state=state,
                conversation_summary=summary,
                product_catalog=_build_product_catalog_for_ai(tid),
            )
            reply        = ai_result.get("reply") or "দুঃখিত, উত্তর দিতে পারছি না।"
            order_data   = ai_result.get("order_data")
            state_update = ai_result.get("state_update") or {}

            if order_data and not state.get("order_flow"):
                product_name = order_data.get("product_name") or ""
                cart_item    = _extract_product_for_order(tid, product_name, state) if product_name else {}
                new_flow     = {**{k: v for k, v in state.items() if k not in _ORDER_STATE_KEYS},
                                **_new_order_state()}
                if state_update:
                    new_flow.update(state_update)
                if cart_item and cart_item.get("product_id"):
                    new_flow["cart"]                  = [cart_item]
                    new_flow["current_step"]          = "ask_quantity"
                    new_flow["last_searched_product"] = cart_item["product_id"]
                    pname = cart_item.get("product_name") or "পণ্য"
                    reply = f"✅ পাওয়া গেছে: {pname} (৳{float(cart_item.get('price') or 0):.0f}/পিস)\nকত পিস নেবেন?"
                else:
                    reply = "কোন পণ্য অর্ডার করতে চান? পণ্যের নাম বলুন।"
                new_flow["last_bot_message"] = reply
                _set_conv_state(conversation_id, new_flow)
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
    logger.info(f"TEST_BOT FINAL STATE: {final_state}")

    return {
        "reply":           reply,
        "image_url":       image_url,          # product image URL when customer requests a photo
        "conversation_id": conversation_id,
        "order_flow":      final_state.get("order_flow"),
        "state":           final_state,
    }


@router.post("/image")
async def test_bot_image(
    file: UploadFile = File(...),
    tenant: dict = Depends(get_current_tenant),
):
    """Process an image sent to the test bot using direct Gemini catalog matching."""
    from app.services import image_search_service as img_svc

    tid = tenant["tenant_id"]

    allowed = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="শুধু JPG, PNG বা WebP ছবি পাঠান।")

    image_bytes = await file.read()
    if len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="ছবিটি অনেক বড়। ৫MB এর কম সাইজের ছবি পাঠান।")

    mime_type = file.content_type or "image/jpeg"

    try:
        match = await asyncio.wait_for(
            asyncio.to_thread(img_svc.match_image_to_catalog, tid, image_bytes, mime_type),
            timeout=20.0,
        )
    except asyncio.TimeoutError:
        match = {"matched": False, "image_description": "timeout", "_catalog": []}
    except Exception as exc:
        logger.warning(f"test_bot_image: match_image_to_catalog error: {exc}")
        match = {"matched": False, "image_description": "", "_catalog": []}

    reply = img_svc.format_catalog_match_reply(match)

    # Build product card list for frontend rendering
    products: list[dict] = []
    if match.get("matched") and match.get("product_id"):
        products = [{
            "product_id": match["product_id"],
            "name":       match.get("product_name") or "",
            "sku":        match.get("sku") or "",
            "mrp":        float(match.get("price") or 0),
            "image_url":  match.get("image_url") or "",
        }]

    # Persist to test conversation
    conv = get_or_create_conversation(tid, f"test_{tid}", "test")
    cid  = conv["conversation_id"]
    save_message(cid, tid, "customer", "[ছবি পাঠানো হয়েছে]")
    save_message(cid, tid, "bot", reply)

    return {
        "reply":           reply,
        "analysis": {
            "likely_product_name": match.get("product_name") or "",
            "confidence":          match.get("confidence") or "low",
            "product_description": match.get("image_description") or "",
            "category":            match.get("category") or "",
        },
        "products":        products,
        "conversation_id": str(cid),
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
