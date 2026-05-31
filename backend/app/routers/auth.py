"""
OmniBot SaaS — Authentication Router
POST /api/auth/register        — new owner sign-up
POST /api/auth/login           — returns JWT
GET  /api/auth/me              — get current tenant profile
POST /api/auth/forgot-password — send password reset email
POST /api/auth/reset-password  — apply new password via token
"""
import uuid
import secrets
import logging
from datetime import datetime, timezone, timedelta

import bcrypt as _bcrypt

from fastapi import APIRouter, HTTPException, status, Depends

from app.auth.jwt_handler import create_access_token, decode_access_token
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import (
    RegisterRequest, LoginRequest, TokenResponse,
    ForgotPasswordRequest, ResetPasswordRequest,
)
from app.services.email_service import send_password_reset_email

logger = logging.getLogger(__name__)
router  = APIRouter()


def _hash_password(plain: str) -> str:
    """Hash a plain-text password with bcrypt."""
    return _bcrypt.hashpw(plain.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def _verify_password(plain: str, hashed: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest):
    # Check email uniqueness
    existing = (
        supabase.table("tenants")
        .select("tenant_id")
        .eq("email", body.email)
        .maybe_single()
        .execute()
    )
    # supabase-py ≥2.7: result is APIResponse with .data=None when 0 rows found
    # supabase-py <2.7: result itself is None when 0 rows found
    existing_data = existing.data if (existing is not None and hasattr(existing, 'data')) else existing
    if existing_data is not None:
        raise HTTPException(status_code=400, detail="Email already registered")

    tenant_id     = str(uuid.uuid4())
    password_hash = _hash_password(body.password)
    # Starter plan — 14-day free trial
    trial_expires = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()

    tenant_row = {
        "tenant_id":      tenant_id,
        "email":          body.email,
        "password_hash":  password_hash,
        "business_name":  body.business_name,
        "plan":           "starter",
        "plan_expires_at": trial_expires,
        "is_active":      True,
    }
    result = supabase.table("tenants").insert(tenant_row).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Registration failed")

    # Create default ai_config
    supabase.table("ai_config").insert({
        "tenant_id":              tenant_id,
        "bot_name":               "Assistant",
        "language":               "bangla",
        "allow_negotiation":      False,
        "prompt_injection_guard": True,
        "system_prompt":          f"তুমি {body.business_name}-এর AI assistant। "
                                  "Customer-দের সাথে বিনয়ের সাথে কথা বলো।",
    }).execute()

    token   = create_access_token(tenant_id, body.email)
    tenant  = result.data[0]
    tenant.pop("password_hash", None)

    return {"access_token": token, "token_type": "bearer", "tenant": tenant}


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    result = (
        supabase.table("tenants")
        .select("*")
        .eq("email", body.email)
        .maybe_single()
        .execute()
    )
    # safe for both supabase-py <2.7 (result=None) and ≥2.7 (result.data=None)
    tenant = result.data if (result is not None and hasattr(result, 'data')) else result
    if tenant is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not _verify_password(body.password, tenant["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not tenant.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account suspended")

    token = create_access_token(tenant["tenant_id"], tenant["email"])
    tenant.pop("password_hash", None)
    return {"access_token": token, "token_type": "bearer", "tenant": tenant}


@router.get("/me")
async def me(tenant: dict = Depends(get_current_tenant)):
    tenant.pop("password_hash", None)
    return tenant


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(tenant: dict = Depends(get_current_tenant)):
    """Issue a fresh 7-day JWT for the authenticated tenant."""
    token = create_access_token(tenant["tenant_id"], tenant["email"])
    tenant.pop("password_hash", None)
    return {"access_token": token, "token_type": "bearer", "tenant": tenant}


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest):
    """
    Send a password reset email.
    Always returns 200 to prevent email enumeration.
    In dev mode (SMTP_HOST not configured) the token is echoed in the response.
    """
    # Look up tenant (silently do nothing if not found)
    result = (
        supabase.table("tenants")
        .select("tenant_id, email")
        .eq("email", body.email)
        .maybe_single()
        .execute()
    )

    tenant = result.data if (result is not None and hasattr(result, 'data')) else result
    if tenant is None:
        # Don't reveal whether the email exists
        return {"message": "যদি এই ইমেইলটি নিবন্ধিত থাকে তাহলে একটি reset link পাঠানো হবে।"}
    token   = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()

    # Store token in DB
    supabase.table("tenants").update({
        "reset_token": token,
        "reset_token_expires_at": expires,
    }).eq("tenant_id", tenant["tenant_id"]).execute()

    # Send email (falls back to log in dev mode)
    from app.config import settings
    email_sent = send_password_reset_email(tenant["email"], token)

    response: dict = {"message": "যদি এই ইমেইলটি নিবন্ধিত থাকে তাহলে একটি reset link পাঠানো হবে।"}

    # Dev mode: return token so it can be tested without SMTP
    if not settings.SMTP_HOST:
        response["dev_token"] = token

    return response


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest):
    """
    Validate the reset token and update the password.
    """
    result = (
        supabase.table("tenants")
        .select("tenant_id, reset_token_expires_at")
        .eq("reset_token", body.token)
        .maybe_single()
        .execute()
    )

    tenant = result.data if (result is not None and hasattr(result, 'data')) else result
    if tenant is None:
        raise HTTPException(status_code=400, detail="Token অকার্যকর বা মেয়াদোত্তীর্ণ")

    # Check expiry
    expires_at = datetime.fromisoformat(tenant["reset_token_expires_at"])
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if datetime.now(timezone.utc) > expires_at:
        # Clear the expired token
        supabase.table("tenants").update({
            "reset_token": None,
            "reset_token_expires_at": None,
        }).eq("tenant_id", tenant["tenant_id"]).execute()
        raise HTTPException(status_code=400, detail="Token-এর মেয়াদ শেষ হয়ে গেছে। আবার চেষ্টা করুন।")

    # Update password and clear token
    new_hash = _hash_password(body.new_password)
    supabase.table("tenants").update({
        "password_hash": new_hash,
        "reset_token": None,
        "reset_token_expires_at": None,
    }).eq("tenant_id", tenant["tenant_id"]).execute()

    return {"message": "পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে। এখন লগইন করুন।"}
