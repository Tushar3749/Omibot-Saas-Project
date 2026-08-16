"""
OmniBot SaaS — Tenant Gemini API Key Resolution & Validation

Each tenant may set their own Gemini API key from the dashboard (AI Settings
→ ইন্টিগ্রেশন → 🤖 Gemini AI API). When a tenant has a saved, validated key
we use it for their bot's Gemini calls; otherwise we fall back to the
platform default key (settings.GEMINI_API_KEY) so the bot keeps working.
"""
import logging
from typing import Optional

from google import genai

from app.config import settings
from app.database import supabase
from app.utils.security import decrypt_token

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-2.5-flash"


def mask_key(api_key: str) -> str:
    """first 8 + last 4 chars, e.g. AIzaSyBx...9kQr"""
    if not api_key:
        return ""
    if len(api_key) <= 12:
        return "••••"
    return f"{api_key[:8]}...{api_key[-4:]}"


def validate_gemini_key(api_key: str, model: str = DEFAULT_MODEL) -> dict:
    """Live-check a Gemini API key with a minimal generate_content call."""
    api_key = (api_key or "").strip()
    if not api_key:
        return {"valid": False, "error": "API key খালি থাকতে পারবে না।"}
    try:
        client = genai.Client(api_key=api_key)
        client.models.generate_content(model=model, contents="Say hello")
        return {"valid": True, "model": model, "message": "API key কাজ করছে ✅"}
    except Exception as e:
        logger.warning(f"Gemini key validation failed: {e}")
        return {"valid": False, "error": "Invalid API key অথবা Gemini API-তে সমস্যা হয়েছে।"}


def resolve_gemini_client(ai_config: Optional[dict] = None, tenant_id: Optional[str] = None) -> genai.Client:
    """
    Return a genai.Client using the tenant's own key if saved & marked valid,
    otherwise the platform default key. Pass either an already-fetched
    ai_config dict, or a tenant_id to look it up (lightweight query).
    """
    cfg = ai_config
    if cfg is None and tenant_id:
        try:
            row = (
                supabase.table("ai_config")
                .select("gemini_api_key, gemini_key_valid")
                .eq("tenant_id", tenant_id)
                .maybe_single()
                .execute()
            )
            cfg = row.data if row is not None else None
        except Exception as e:
            logger.warning(f"Could not load tenant Gemini key (tenant={tenant_id}): {e}")
        cfg = cfg or {}

    cfg = cfg or {}
    if cfg.get("gemini_key_valid") and cfg.get("gemini_api_key"):
        try:
            api_key = decrypt_token(cfg["gemini_api_key"])
            return genai.Client(api_key=api_key)
        except Exception as e:
            logger.warning(f"Failed to decrypt tenant Gemini key, using platform default: {e}")

    return genai.Client(api_key=settings.GEMINI_API_KEY)
