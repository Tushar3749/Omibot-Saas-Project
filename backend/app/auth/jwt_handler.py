"""
OmniBot SaaS — JWT Token Handler
Creates and validates HS256 JWTs with tenant_id embedded in claims.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import jwt, JWTError
from app.config import settings

logger = logging.getLogger(__name__)


def create_access_token(tenant_id: str, email: str) -> str:
    """Create a signed JWT access token."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {
        "sub": tenant_id,
        "email": email,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """Decode and validate a JWT. Returns payload dict or None."""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except JWTError as e:
        logger.warning(f"JWT decode error: {e}")
        return None
