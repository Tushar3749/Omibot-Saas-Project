"""
OmniBot SaaS — FastAPI Auth Dependencies
Use `get_current_tenant` as a dependency to protect any route.
Use `get_current_tenant_auth_only` for endpoints that must remain accessible
even when the subscription has expired (payment, notifications).
"""
import logging
from datetime import datetime, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.auth.jwt_handler import decode_access_token
from app.database import supabase

logger = logging.getLogger(__name__)
bearer_scheme = HTTPBearer()


async def _resolve_tenant(credentials: HTTPAuthorizationCredentials) -> dict:
    """Shared auth logic: decode JWT, fetch tenant, check is_active."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise credentials_exception

    tenant_id: str = payload.get("sub")
    if not tenant_id:
        raise credentials_exception

    result = (
        supabase.table("tenants")
        .select("*")
        .eq("tenant_id", tenant_id)
        .single()
        .execute()
    )
    if not result.data:
        raise credentials_exception

    tenant = result.data
    if not tenant.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account suspended. Contact support.",
        )
    return tenant


async def get_current_tenant_auth_only(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Auth-only dependency: verifies JWT and account status but does NOT
    enforce subscription expiry. Use this for payment and notification
    endpoints that must remain reachable after a subscription expires.
    """
    return await _resolve_tenant(credentials)


async def get_current_tenant(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Full dependency: verifies JWT, account status, and subscription expiry.
    Raises 402 only when plan_expires_at is a real past date.
    null / missing plan_expires_at is treated as no-expiry (always valid).
    """
    tenant = await _resolve_tenant(credentials)

    expires_at = tenant.get("plan_expires_at")
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if exp_dt < datetime.now(timezone.utc):
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail="Subscription expired. Please renew your plan.",
                )
        except (ValueError, AttributeError):
            pass

    return tenant
