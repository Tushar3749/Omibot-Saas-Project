"""
OmniBot SaaS — FastAPI Auth Dependencies
Use `get_current_tenant` as a dependency to protect any route.
"""
import logging
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.auth.jwt_handler import decode_access_token
from app.database import supabase

logger = logging.getLogger(__name__)
bearer_scheme = HTTPBearer()


async def get_current_tenant(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """
    Extract tenant from Authorization: Bearer <token>.
    Returns the full tenant row from Supabase.
    Raises 401 if token is invalid or tenant is inactive.
    """
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

    # Fetch tenant from DB
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

    # Check account is active
    if not tenant.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account suspended. Contact support.",
        )

    # Check subscription expiry
    from datetime import datetime, timezone
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
