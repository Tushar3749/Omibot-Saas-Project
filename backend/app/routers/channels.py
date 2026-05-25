"""
OmniBot SaaS — Channels Router
Connect / manage Facebook and Instagram pages.
"""
import uuid
import logging
import httpx
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import PageConnectRequest
from app.utils.security import encrypt_token
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

META_GRAPH = "https://graph.facebook.com/v19.0"


@router.get("/")
async def list_connected_pages(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("connected_pages")
        .select("page_id, page_name, platform, is_active, created_at")
        .eq("tenant_id", tenant["tenant_id"])
        .execute()
    )
    return result.data or []


@router.post("/connect")
async def connect_page(
    body: PageConnectRequest,
    tenant: dict = Depends(get_current_tenant),
):
    """
    Connect a Facebook / Instagram page.
    The access_token is AES-256 encrypted before storage.
    """
    # Plan limit: Starter = 1 page (Messenger only)
    if tenant["plan"] == "starter" and body.platform != "facebook":
        raise HTTPException(
            status_code=402,
            detail="Instagram requires Pro plan or higher",
        )

    encrypted_token = encrypt_token(body.access_token)

    # Upsert by page_id + tenant_id
    result = supabase.table("connected_pages").upsert({
        "page_id":                body.page_id,
        "tenant_id":              tenant["tenant_id"],
        "page_name":              body.page_name,
        "platform":               body.platform,
        "access_token_encrypted": encrypted_token,
        "is_active":              True,
    }, on_conflict="page_id,tenant_id").execute()

    return {"message": "Page connected successfully", "page_id": body.page_id}


@router.delete("/{page_id}")
async def disconnect_page(page_id: str, tenant: dict = Depends(get_current_tenant)):
    supabase.table("connected_pages").update({"is_active": False}).eq(
        "tenant_id", tenant["tenant_id"]
    ).eq("page_id", page_id).execute()
    return {"message": "Page disconnected"}


@router.get("/facebook/oauth-url")
async def facebook_oauth_url(tenant: dict = Depends(get_current_tenant)):
    """Return the Facebook OAuth URL for one-click page connection."""
    redirect_uri = f"{settings.BACKEND_URL}/api/channels/facebook/callback"
    scope = "pages_messaging,pages_manage_metadata,pages_read_engagement"
    url = (
        f"https://www.facebook.com/v19.0/dialog/oauth"
        f"?client_id={settings.FACEBOOK_APP_ID}"
        f"&redirect_uri={redirect_uri}"
        f"&scope={scope}"
        f"&state={tenant['tenant_id']}"
    )
    return {"oauth_url": url}


@router.get("/facebook/callback")
async def facebook_oauth_callback(code: str, state: str):
    """
    Exchange OAuth code for long-lived page tokens and save them.
    `state` is the tenant_id.
    """
    redirect_uri = f"{settings.BACKEND_URL}/api/channels/facebook/callback"

    # 1. Exchange code for short-lived token
    async with httpx.AsyncClient() as client:
        token_resp = await client.get(
            f"{META_GRAPH}/oauth/access_token",
            params={
                "client_id":     settings.FACEBOOK_APP_ID,
                "client_secret": settings.FACEBOOK_APP_SECRET,
                "redirect_uri":  redirect_uri,
                "code":          code,
            },
        )
        token_data = token_resp.json()
        short_token = token_data.get("access_token")
        if not short_token:
            raise HTTPException(status_code=400, detail="OAuth failed — no token received")

        # 2. Get pages
        pages_resp = await client.get(
            f"{META_GRAPH}/me/accounts",
            params={"access_token": short_token},
        )
        pages_data = pages_resp.json()

    pages_connected = []
    for page in pages_data.get("data", []):
        encrypted = encrypt_token(page["access_token"])
        supabase.table("connected_pages").upsert({
            "page_id":                page["id"],
            "tenant_id":              state,
            "page_name":              page["name"],
            "platform":               "facebook",
            "access_token_encrypted": encrypted,
            "is_active":              True,
        }, on_conflict="page_id,tenant_id").execute()
        pages_connected.append(page["name"])

    # Redirect back to dashboard
    from fastapi.responses import RedirectResponse
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL}/dashboard/channels?connected=true"
    )
