"""
OmniBot SaaS — Test Bot Router
Lets the tenant owner chat with their own configured bot from the dashboard.

POST /api/test-bot/chat  — send a message, receive the bot's reply
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from google import genai
from google.genai import types as genai_types

from app.auth.dependencies import get_current_tenant
from app.config import settings
from app.database import supabase
from app.services.rag_service import RAGService


class TestBotRequest(BaseModel):
    message: str
    customer_phone: Optional[str] = None
    quick_reply_payload: Optional[str] = None
    order_state: Optional[dict] = None

logger = logging.getLogger(__name__)
router = APIRouter()
rag    = RAGService()

_client = genai.Client(api_key=settings.GEMINI_API_KEY)


def _build_system_prompt(ai_cfg: dict, products: list[dict]) -> str:
    """Build a rich system prompt from the tenant's AI config + top products."""
    bot_name   = ai_cfg.get("bot_name") or "OmniBot"
    language   = ai_cfg.get("language") or "bangla"
    sys_prompt = ai_cfg.get("system_prompt") or ""
    esc_kws    = ai_cfg.get("escalation_keywords") or []
    forbidden  = ai_cfg.get("forbidden_topics") or []

    # Language instruction
    lang_map = {
        "bangla":   "সব সময় বাংলায় উত্তর দাও।",
        "english":  "Always respond in English.",
        "banglish": "Respond in Banglish (Bengali written in English letters).",
    }
    lang_instr = lang_map.get(language, lang_map["bangla"])

    lines = [
        f"তুমি {bot_name}, একটি বাংলাদেশী ই-কমার্স চ্যাটবট।",
        lang_instr,
    ]

    if sys_prompt:
        lines.append(sys_prompt)

    # Products summary (first 20)
    if products:
        lines.append("\n## পণ্য তালিকা (প্রথম ২০টি):")
        for p in products[:20]:
            lines.append(f"- {p['name']} (SKU: {p.get('sku','')}) — ৳{p['mrp']}")

    if esc_kws:
        lines.append(f"\nযদি কেউ এই কথা বলে: {', '.join(esc_kws[:10])} — মানব সহায়তায় রেফার করো।")

    if forbidden:
        lines.append(f"\nএই বিষয়গুলো নিয়ে কথা বলবে না: {', '.join(forbidden[:10])}")

    lines.append("\n(এটি একটি পরীক্ষামূলক চ্যাট — ড্যাশবোর্ড থেকে বট পরীক্ষা করা হচ্ছে।)")

    return "\n".join(lines)


@router.post("/chat")
async def test_bot_chat(
    body:   TestBotRequest,
    tenant: dict = Depends(get_current_tenant),
):
    """
    Send a message and receive the bot's reply.
    Uses the tenant's full AI config + their product list to build the context.
    """
    tid = tenant["tenant_id"]

    # ── Load AI config ────────────────────────────────────────────────────────
    cfg_res = (
        supabase.table("ai_config")
        .select("*")
        .eq("tenant_id", tid)
        .maybe_single()
        .execute()
    )
    ai_cfg: dict = {}
    if cfg_res is not None and cfg_res.data:
        ai_cfg = cfg_res.data

    # ── Load products (names, prices, stock) ──────────────────────────────────
    prod_res = (
        supabase.table("products")
        .select("name, sku, mrp, category")
        .eq("tenant_id", tid)
        .eq("is_active", True)
        .limit(20)
        .execute()
    )
    products = prod_res.data or []

    # ── RAG context retrieval ─────────────────────────────────────────────────
    try:
        rag_ctx = await rag.get_relevant_context(tid, body.message, match_count=4)
    except Exception:
        rag_ctx = ""

    # ── Discount context (if customer_phone provided) ─────────────────────────
    discount_ctx: dict = {}
    if body.customer_phone:
        try:
            from app.services.discount_engine import get_discount_context as _gdc
            discount_ctx = _gdc(tenant_id=tid, customer_phone=body.customer_phone)
        except Exception as _de:
            logger.warning(f"Test bot discount engine error: {_de}")

    # ── Order flow simulation hint ────────────────────────────────────────────
    order_flow_note: Optional[dict] = None
    effective_message = body.message

    if body.quick_reply_payload:
        payload_labels = {
            "ORDER_START":   "অর্ডার শুরু করুন",
            "ORDER_INFO":    "আরো তথ্য",
            "ORDER_CONFIRM": "অর্ডার নিশ্চিত",
            "ORDER_CANCEL":  "অর্ডার বাতিল",
        }
        label = payload_labels.get(body.quick_reply_payload, body.quick_reply_payload)
        order_flow_note = {
            "payload":      body.quick_reply_payload,
            "label":        label,
            "description":  f"Quick Reply tapped: [{label}] (payload: {body.quick_reply_payload})",
        }
        effective_message = f"[Quick Reply: {label}] {body.message}".strip()

    if body.order_state:
        step = body.order_state.get("state", "")
        step_hints = {
            "triggered":      "Bot showed order QR buttons. Waiting for ORDER_START or ORDER_INFO.",
            "asking_name":    "Bot asked for customer name.",
            "asking_phone":   "Bot asked for phone number (01XXXXXXXXX format).",
            "asking_address": "Bot asked for delivery address.",
            "confirming":     "Bot showed order summary. Waiting for ORDER_CONFIRM or ORDER_CANCEL.",
        }
        hint = step_hints.get(step, f"Order flow step: {step}")
        if order_flow_note:
            order_flow_note["order_step"] = hint
        else:
            order_flow_note = {"order_step": hint}

    # ── Build system prompt ───────────────────────────────────────────────────
    system_prompt = _build_system_prompt(ai_cfg, products)
    if rag_ctx:
        system_prompt += f"\n\n## জ্ঞানভাণ্ডার থেকে প্রাসঙ্গিক তথ্য:\n{rag_ctx}"

    if order_flow_note:
        system_prompt += (
            "\n\n## অর্ডার ফ্লো সিমুলেশন\n"
            "এটি একটি অর্ডার ফ্লো টেস্ট। "
            "অর্ডার নেওয়ার সময় নাম, ফোন, ঠিকানা সংগ্রহ করো এবং "
            "Quick Reply বোতাম সম্পর্কে সচেতন থাকো।"
        )
    pct_d  = discount_ctx.get("final_discount_pct", 0)
    flat_d = discount_ctx.get("final_discount_flat", 0)
    msg_d  = discount_ctx.get("discount_message", "")
    bonus_d = discount_ctx.get("bonus_items") or []
    if pct_d > 0 or flat_d > 0 or msg_d or bonus_d:
        if not msg_d:
            if pct_d > 0:
                msg_d = f"Customer qualifies for {pct_d:.0f}% discount."
            elif flat_d > 0:
                msg_d = f"Customer qualifies for ৳{flat_d:.0f} flat discount."
            elif bonus_d:
                bonus_names = ", ".join(b.get("name", "") for b in bonus_d[:3])
                msg_d = f"Customer qualifies for bonus items: {bonus_names}"
        system_prompt += (
            f"\n\n[DISCOUNT ENGINE — Active]\n"
            f"{msg_d}\n"
            f"Mention this discount naturally when confirming the order."
        )

    # ── Call Gemini ───────────────────────────────────────────────────────────
    try:
        response = _client.models.generate_content(
            model    = settings.GEMINI_MODEL,
            contents = effective_message,
            config   = genai_types.GenerateContentConfig(
                system_instruction = system_prompt,
                max_output_tokens  = 1024,
                temperature        = 0.4,
            ),
        )
        reply = response.text or "দুঃখিত, আমি এখন উত্তর দিতে পারছি না।"
    except Exception as exc:
        logger.error("test_bot Gemini error: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=f"AI সার্ভিস সাময়িকভাবে অনুপলব্ধ: {exc}"
        )

    # Suggest what QR buttons the real bot would show next
    quick_replies_hint: Optional[list] = None
    if "অর্ডার করতে চান" in reply or "অর্ডার করবেন" in reply:
        quick_replies_hint = [
            {"title": "✅ অর্ডার করি",  "payload": "ORDER_START"},
            {"title": "❓ আরো জানি",    "payload": "ORDER_INFO"},
        ]
    elif "নিশ্চিত করবেন" in reply or "অর্ডার সামারি" in reply:
        quick_replies_hint = [
            {"title": "✅ নিশ্চিত করুন", "payload": "ORDER_CONFIRM"},
            {"title": "❌ বাতিল",        "payload": "ORDER_CANCEL"},
        ]

    return {
        "message":           body.message,
        "reply":             reply,
        "model":             settings.GEMINI_MODEL,
        "discount_context":  discount_ctx or None,
        "order_flow":        order_flow_note,
        "quick_replies_hint": quick_replies_hint,
    }
