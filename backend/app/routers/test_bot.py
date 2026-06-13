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

    # 2. No active flow → normal AI + check for order intent
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
        "conversation_id": conversation_id,
        "order_flow":      final_state.get("order_flow"),
        "state":           final_state,
    }


@router.post("/image")
async def test_bot_image(
    file: UploadFile = File(...),
    tenant: dict = Depends(get_current_tenant),
):
    """Process an image sent to the test bot — runs full 2-phase image recognition."""
    from app.services.image_search_service import (
        analyze_customer_image,
        search_products_by_text,
        search_product_images,
        get_primary_image_cached,
        format_image_recognition_reply,
        _enrich_with_product,
        _embed_query,
    )

    tid = tenant["tenant_id"]

    allowed = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Only JPEG/PNG/WebP/GIF images accepted")

    image_bytes = await file.read()
    if len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be under 5MB")

    mime_type = file.content_type or "image/jpeg"

    # Vision with 8s timeout (slightly relaxed for test environment)
    try:
        analysis: dict = await asyncio.wait_for(
            asyncio.to_thread(analyze_customer_image, image_bytes, mime_type),
            timeout=8.0,
        )
    except asyncio.TimeoutError:
        analysis = {"product_description": "", "likely_product_name": "", "category": "", "confidence": "low"}
    except Exception as exc:
        logger.warning(f"test_bot image Vision error: {exc}")
        analysis = {"product_description": "", "likely_product_name": "", "category": "", "confidence": "low"}

    description  = analysis.get("product_description", "")
    product_name = analysis.get("likely_product_name", "")
    category     = analysis.get("category", "")
    confidence   = analysis.get("confidence", "low")
    keywords     = [kw for kw in [product_name, category] if kw]

    # Parallel Phase A + Phase B embed
    async def _phase_a() -> list[dict]:
        if not keywords:
            return []
        return await asyncio.to_thread(search_products_by_text, tid, keywords)

    async def _phase_b() -> list[float] | None:
        if not description:
            return None
        try:
            return await asyncio.to_thread(_embed_query, description)
        except Exception:
            return None

    text_products, query_embedding = await asyncio.gather(_phase_a(), _phase_b())

    products: list[dict] = []

    if text_products and confidence in ("high", "medium"):
        for p in text_products[:3]:
            img_url = get_primary_image_cached(tid, p["product_id"])
            products.append({**p, "image_url": img_url or p.get("image_url"), "similarity": 0.9})
    elif query_embedding:
        matches = await asyncio.to_thread(search_product_images, tid, query_embedding, 3)
        products = _enrich_with_product(tid, matches)
        if not products and text_products:
            for p in text_products[:3]:
                img_url = get_primary_image_cached(tid, p["product_id"])
                products.append({**p, "image_url": img_url or p.get("image_url"), "similarity": 0.5})
    elif text_products:
        for p in text_products[:3]:
            img_url = get_primary_image_cached(tid, p["product_id"])
            products.append({**p, "image_url": img_url or p.get("image_url"), "similarity": 0.5})

    reply = format_image_recognition_reply(products, analysis)

    # Persist to test conversation
    conv = get_or_create_conversation(tid, f"test_{tid}", "test")
    cid  = conv["conversation_id"]
    save_message(cid, tid, "customer", "[ছবি পাঠানো হয়েছে]")
    save_message(cid, tid, "bot", reply)

    return {
        "reply":           reply,
        "analysis":        analysis,
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
