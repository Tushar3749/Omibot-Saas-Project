"""
OmniBot SaaS — Meta Webhook Router
GET  /api/webhook/facebook   — Meta verification challenge
POST /api/webhook/facebook   — Incoming Facebook Messenger messages
POST /api/webhook/instagram  — Incoming Instagram DM messages (same handler)
"""
import json
import logging
from fastapi import APIRouter, Request, HTTPException, Query, BackgroundTasks
from app.config import settings
from app.services.webhook_service import (
    verify_signature,
    get_tenant_by_page_id,
    process_message,
)
from app.utils.security import decrypt_token

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Verification ──────────────────────────────────────────────────────────────

@router.get("/facebook")
@router.get("/instagram")
async def verify_webhook(
    hub_mode: str       = Query(None, alias="hub.mode"),
    hub_challenge: str  = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
):
    if (
        hub_mode == "subscribe"
        and hub_verify_token == settings.FACEBOOK_VERIFY_TOKEN
        and hub_challenge
    ):
        logger.info("Webhook verification successful")
        return int(hub_challenge)
    raise HTTPException(status_code=403, detail="Verification failed")


# ── Incoming Messages ─────────────────────────────────────────────────────────

async def _handle_webhook(request: Request, platform: str, background_tasks: BackgroundTasks):
    body_bytes = await request.body()
    signature  = request.headers.get("X-Hub-Signature-256", "")

    # Verify signature
    if not verify_signature(body_bytes, signature):
        logger.warning(f"Invalid {platform} webhook signature")
        raise HTTPException(status_code=403, detail="Invalid signature")

    try:
        payload = json.loads(body_bytes)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # Process each entry
    for entry in payload.get("entry", []):
        page_id = entry.get("id")

        for event in entry.get("messaging", []):
            sender_id = event.get("sender", {}).get("id")
            message   = event.get("message", {})
            text      = message.get("text", "")

            # Skip echo messages (the page itself)
            if message.get("is_echo") or not text or not sender_id:
                continue
            if sender_id == page_id:
                continue

            # Find which tenant owns this page
            page_info = get_tenant_by_page_id(page_id)
            if not page_info:
                logger.warning(f"Unknown page_id: {page_id}")
                continue

            tenant_id     = page_info["tenant_id"]
            access_token  = page_info["access_token_encrypted"]

            # Enqueue in background so Meta gets 200 OK fast
            background_tasks.add_task(
                process_message,
                tenant_id=tenant_id,
                page_id=page_id,
                sender_id=sender_id,
                message_text=text,
                platform=platform,
                access_token=access_token,
            )

    return {"status": "ok"}


@router.post("/facebook")
async def facebook_webhook(request: Request, background_tasks: BackgroundTasks):
    return await _handle_webhook(request, "facebook", background_tasks)


@router.post("/instagram")
async def instagram_webhook(request: Request, background_tasks: BackgroundTasks):
    return await _handle_webhook(request, "instagram", background_tasks)
