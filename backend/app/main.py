"""
OmniBot SaaS — FastAPI Application Entry Point
"""
import logging
import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import settings
from app.routers import auth, webhook, products, conversations, orders, analytics, channels, payment, campaigns, knowledge, test_bot

# ── Sentry ────────────────────────────────────────────────────────────────────
if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        traces_sample_rate=0.1,
        profiles_sample_rate=0.1,
        environment="production" if not settings.DEBUG else "development",
    )

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ── Rate Limiter ──────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router,          prefix="/api/auth",          tags=["Auth"])
app.include_router(webhook.router,       prefix="/api/webhook",       tags=["Webhook"])
app.include_router(products.router,      prefix="/api/products",      tags=["Products"])
app.include_router(conversations.router, prefix="/api/conversations", tags=["Conversations"])
app.include_router(orders.router,        prefix="/api/orders",        tags=["Orders"])
app.include_router(analytics.router,     prefix="/api/analytics",     tags=["Analytics"])
app.include_router(channels.router,      prefix="/api/channels",      tags=["Channels"])
app.include_router(payment.router,       prefix="/api/payment",       tags=["Payment"])
app.include_router(campaigns.router,     prefix="/api/campaigns",     tags=["Campaigns"])
app.include_router(knowledge.router,     prefix="/api/knowledge",     tags=["Knowledge"])
app.include_router(test_bot.router,      prefix="/api/test-bot",      tags=["TestBot"])


# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/health")
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}


# ── Global Exception Handler ─────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
