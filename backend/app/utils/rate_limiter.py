"""
OmniBot SaaS — Rate-Limit helpers (SlowAPI wrappers).
Import `limiter` from here and use as a decorator on routes.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

# Pre-built limit strings
WEBHOOK_RATE  = "200/minute"
AUTH_RATE     = "10/minute"
API_RATE      = "60/minute"
