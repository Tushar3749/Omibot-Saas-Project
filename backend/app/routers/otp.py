"""
OmniBot SaaS — OTP Router
Dashboard endpoints for testing SMS dispatch.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.services.otp_service import normalize_bd_phone, request_otp

logger = logging.getLogger(__name__)
router = APIRouter()


class OTPTestRequest(BaseModel):
    phone: str


@router.post("/test-send")
async def test_otp_send(
    body: OTPTestRequest,
    tenant: dict = Depends(get_current_tenant),
):
    """Send a test OTP to the given phone number using tenant's SMS config."""
    tid = tenant["tenant_id"]

    phone = normalize_bd_phone(body.phone)
    if not phone:
        raise HTTPException(
            status_code=400,
            detail="বৈধ বাংলাদেশি ফোন নম্বর দিন (যেমন: 01712345678)",
        )

    # Get ai_config
    result = (
        supabase.table("ai_config")
        .select("sms_enabled, sms_provider, ssl_wireless_api_key, ssl_wireless_sid, "
                "twilio_account_sid, twilio_auth_token, twilio_from_number")
        .eq("tenant_id", tid)
        .maybe_single()
        .execute()
    )
    ai_config = result.data or {}

    if not ai_config.get("sms_enabled"):
        raise HTTPException(status_code=400, detail="SMS চালু নেই। প্রথমে SMS Settings সেভ করুন।")

    ok, err = request_otp(tid, phone, ai_config)
    if not ok:
        raise HTTPException(status_code=502, detail=f"SMS পাঠানো যায়নি: {err}")

    return {"message": f"Test OTP পাঠানো হয়েছে {phone[:4]}****{phone[-3:]} নম্বরে"}
