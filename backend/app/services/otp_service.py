"""
OmniBot SaaS — OTP Service
Generates, hashes, stores, and verifies 6-digit OTPs for order tracking.
SMS dispatch via SSL Wireless (BD) or Twilio.

Security model:
  - OTP stored as HMAC-SHA256 (never plain text)
  - Expires in 5 minutes
  - Max 3 wrong attempts → 15-min block
  - Max 3 OTP requests per phone per hour
  - Phone validated to Bangladesh format before any action
"""
import hmac
import hashlib
import logging
import random
import re
import string
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from app.config import settings
from app.database import supabase

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

OTP_EXPIRY_MINUTES  = 5
OTP_MAX_ATTEMPTS    = 3
OTP_BLOCK_MINUTES   = 15
OTP_RATE_LIMIT_HOUR = 3     # max requests per phone per hour

BD_PHONE_RE = re.compile(r'^01[3-9]\d{8}$')

# ── Phone Helpers ─────────────────────────────────────────────────────────────

def normalize_bd_phone(raw: str) -> Optional[str]:
    """Normalize and validate a Bangladesh phone number. Returns None if invalid."""
    phone = raw.strip().replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
    if phone.startswith('+880'):
        phone = '0' + phone[4:]
    elif phone.startswith('880') and len(phone) == 13:
        phone = '0' + phone[3:]
    return phone if BD_PHONE_RE.match(phone) else None


# ── OTP Crypto ────────────────────────────────────────────────────────────────

def _generate_otp() -> str:
    return ''.join(random.choices(string.digits, k=6))


def _hash_otp(otp: str) -> str:
    """HMAC-SHA256 of OTP using the JWT secret as key."""
    return hmac.new(
        settings.JWT_SECRET_KEY.encode(),
        otp.encode(),
        hashlib.sha256,
    ).hexdigest()


def _verify_hash(otp: str, stored_hash: str) -> bool:
    return hmac.compare_digest(_hash_otp(otp), stored_hash)


# ── DB Helpers ────────────────────────────────────────────────────────────────

def _check_rate_limit(tenant_id: str, phone: str) -> tuple[bool, str]:
    """Returns (allowed, message). Fails if >= OTP_RATE_LIMIT_HOUR recent requests."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    result = (
        supabase.table("otp_verifications")
        .select("id", count="exact")
        .eq("tenant_id", tenant_id)
        .eq("phone", phone)
        .gte("created_at", cutoff)
        .execute()
    )
    count = result.count or 0
    if count >= OTP_RATE_LIMIT_HOUR:
        return False, "❌ এই নম্বরে ১ ঘণ্টায় সর্বোচ্চ ৩টি OTP পাঠানো যাবে। একটু পরে চেষ্টা করুন।"
    return True, ""


def _check_blocked(tenant_id: str, phone: str) -> tuple[bool, str]:
    """Returns (is_blocked, message)."""
    now = datetime.now(timezone.utc)
    result = (
        supabase.table("otp_verifications")
        .select("blocked_until")
        .eq("tenant_id", tenant_id)
        .eq("phone", phone)
        .eq("is_used", False)
        .gt("blocked_until", now.isoformat())
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if result.data:
        blocked_until = result.data[0]["blocked_until"]
        return True, f"❌ অনেকবার ভুল OTP দিয়েছেন। ১৫ মিনিট পরে আবার চেষ্টা করুন।"
    return False, ""


def _invalidate_previous(tenant_id: str, phone: str) -> None:
    """Mark all previous unused OTPs for this phone as used."""
    (
        supabase.table("otp_verifications")
        .update({"is_used": True})
        .eq("tenant_id", tenant_id)
        .eq("phone", phone)
        .eq("is_used", False)
        .execute()
    )


def _store_otp(tenant_id: str, phone: str, otp_hash: str) -> None:
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES)).isoformat()
    supabase.table("otp_verifications").insert({
        "id":         str(uuid.uuid4()),
        "tenant_id":  tenant_id,
        "phone":      phone,
        "otp_hash":   otp_hash,
        "expires_at": expires_at,
        "attempts":   0,
        "is_used":    False,
    }).execute()


# ── SMS Dispatch ──────────────────────────────────────────────────────────────

def _send_ssl_wireless(phone: str, message: str, api_key: str, sid: str) -> tuple[bool, str]:
    """Send SMS via SSL Wireless Bangladesh API."""
    try:
        resp = httpx.post(
            "https://sms.sslwireless.com/pushapi/dynamic/server.php",
            data={
                "apikey":  api_key,
                "sid":     sid,
                "smstext": message,
                "csmsid":  str(uuid.uuid4()).replace("-", "")[:20],
                "msisdn":  phone,
            },
            timeout=15,
        )
        body = resp.json() if resp.headers.get("content-type", "").startswith("application") else {}
        status = str(body.get("status_code", resp.status_code))
        if status in ("200", "200-OK") or resp.status_code == 200:
            return True, "sent"
        logger.warning(f"SSL Wireless error: status={status} body={body}")
        return False, f"SSL Wireless error: {status}"
    except Exception as e:
        logger.error(f"SSL Wireless SMS failed: {e}")
        return False, str(e)


def _send_twilio(phone: str, message: str, account_sid: str, auth_token: str, from_number: str) -> tuple[bool, str]:
    """Send SMS via Twilio."""
    try:
        # Format: Bangladesh numbers need +88 prefix
        to_number = f"+88{phone}" if phone.startswith("01") else phone
        resp = httpx.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json",
            data={"From": from_number, "To": to_number, "Body": message},
            auth=(account_sid, auth_token),
            timeout=15,
        )
        if resp.status_code in (200, 201):
            return True, "sent"
        logger.warning(f"Twilio error: {resp.status_code} {resp.text}")
        return False, f"Twilio error: {resp.status_code}"
    except Exception as e:
        logger.error(f"Twilio SMS failed: {e}")
        return False, str(e)


def _dispatch_sms(phone: str, message: str, ai_config: dict) -> tuple[bool, str]:
    """Route to the correct SMS provider based on ai_config."""
    if not ai_config.get("sms_enabled"):
        return False, "SMS not enabled"

    provider = ai_config.get("sms_provider", "ssl_wireless")

    if provider == "twilio":
        sid   = ai_config.get("twilio_account_sid", "")
        token = ai_config.get("twilio_auth_token", "")
        frm   = ai_config.get("twilio_from_number", "")
        if not all([sid, token, frm]):
            return False, "Twilio credentials not configured"
        return _send_twilio(phone, message, sid, token, frm)

    # Default: SSL Wireless
    api_key = ai_config.get("ssl_wireless_api_key", "")
    sid     = ai_config.get("ssl_wireless_sid", "")
    if not all([api_key, sid]):
        return False, "SSL Wireless credentials not configured"
    return _send_ssl_wireless(phone, message, api_key, sid)


# ── Public API ────────────────────────────────────────────────────────────────

def request_otp(tenant_id: str, phone: str, ai_config: dict) -> tuple[bool, str]:
    """
    Generate and send an OTP to the given phone.
    Returns (success, message).
    """
    # Rate limit
    ok, msg = _check_rate_limit(tenant_id, phone)
    if not ok:
        return False, msg

    # Generate OTP and hash it (never log the plain OTP)
    otp = _generate_otp()
    otp_hash = _hash_otp(otp)

    # Invalidate previous OTPs for this phone
    _invalidate_previous(tenant_id, phone)

    # Store new OTP
    _store_otp(tenant_id, phone, otp_hash)

    # Build SMS message
    sms_text = f"OmniBot OTP: {otp}\nOrder tracking-এর জন্য ব্যবহার করুন। {OTP_EXPIRY_MINUTES} মিনিটে মেয়াদ শেষ।"

    # Dispatch
    sent, err = _dispatch_sms(phone, sms_text, ai_config)
    if not sent:
        logger.warning(f"OTP SMS dispatch failed for {phone[:7]}**** — {err}")
        return False, err

    # Mask OTP in all logs
    logger.info(f"OTP sent to {phone[:7]}**** (tenant={tenant_id})")
    return True, "sent"


def verify_otp(tenant_id: str, phone: str, otp_input: str) -> dict:
    """
    Verify an OTP submission.
    Returns:
      {"success": True} on valid OTP
      {"success": False, "blocked": True} when max attempts hit
      {"success": False, "remaining_attempts": N} on wrong OTP
      {"success": False, "expired": True} on expired OTP
    """
    now = datetime.now(timezone.utc)

    # Find the most recent unused, unexpired record
    result = (
        supabase.table("otp_verifications")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("phone", phone)
        .eq("is_used", False)
        .is_("blocked_until", "null")   # not blocked
        .gt("expires_at", now.isoformat())
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not result.data:
        # Check if there's a blocked record
        blocked, bmsg = _check_blocked(tenant_id, phone)
        if blocked:
            return {"success": False, "blocked": True}
        return {"success": False, "expired": True}

    record = result.data[0]
    attempts = record.get("attempts", 0)

    # Verify hash
    if _verify_hash(otp_input, record["otp_hash"]):
        # Mark used
        supabase.table("otp_verifications").update({
            "is_used": True,
            "attempts": attempts + 1,
        }).eq("id", record["id"]).execute()
        logger.info(f"OTP verified OK for {phone[:7]}**** (tenant={tenant_id})")
        return {"success": True}

    # Wrong OTP — increment attempts
    new_attempts = attempts + 1
    update_data: dict = {"attempts": new_attempts}

    if new_attempts >= OTP_MAX_ATTEMPTS:
        # Block this phone for 15 minutes
        blocked_until = (now + timedelta(minutes=OTP_BLOCK_MINUTES)).isoformat()
        update_data["blocked_until"] = blocked_until
        supabase.table("otp_verifications").update(update_data).eq("id", record["id"]).execute()
        logger.warning(f"OTP blocked after {OTP_MAX_ATTEMPTS} attempts for {phone[:7]}****")
        return {"success": False, "blocked": True}

    supabase.table("otp_verifications").update(update_data).eq("id", record["id"]).execute()
    return {"success": False, "remaining_attempts": OTP_MAX_ATTEMPTS - new_attempts}
