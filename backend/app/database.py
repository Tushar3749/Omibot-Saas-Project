"""
OmniBot SaaS — Supabase Database Client
Uses the service-role key so the backend can read/write without RLS restrictions.
Client is initialised lazily (on first call) to surface credential errors at
runtime rather than at import time.
"""
import logging
from supabase import create_client, Client
from app.config import settings

logger = logging.getLogger(__name__)

_client: Client | None = None


def get_supabase() -> Client:
    """Return a cached Supabase client (service role — bypasses RLS)."""
    global _client
    if _client is None:
        _client = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,
        )
        logger.info("Supabase client initialised")
    return _client


# Convenience proxy — call get_supabase() on first attribute access
class _LazyClient:
    """Transparent proxy that forwards every attribute to the real client."""
    def __getattr__(self, name: str):
        return getattr(get_supabase(), name)

supabase: Client = _LazyClient()  # type: ignore[assignment]
