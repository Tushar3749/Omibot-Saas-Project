"""
OmniBot SaaS — Notifications Router

Run once in Supabase SQL editor to create the table:

  create table if not exists notifications (
    id         uuid        primary key default gen_random_uuid(),
    tenant_id  text        not null references tenants(tenant_id) on delete cascade,
    type       text        not null default 'new_order',
    title      text        not null,
    body       text        not null default '',
    ref_id     text,
    is_read    boolean     not null default false,
    created_at timestamptz not null default now()
  );
  create index if not exists notifications_tenant_unread
    on notifications(tenant_id, is_read, created_at desc);
"""
import logging
from fastapi import APIRouter, Depends
from app.auth.dependencies import get_current_tenant
from app.database import supabase

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/count")
async def get_unread_count(tenant: dict = Depends(get_current_tenant)):
    try:
        result = (
            supabase.table("notifications")
            .select("id", count="exact")
            .eq("tenant_id", tenant["tenant_id"])
            .eq("is_read", False)
            .execute()
        )
        return {"count": result.count or 0}
    except Exception:
        return {"count": 0}


@router.get("/")
async def list_notifications(
    limit: int = 30,
    tenant: dict = Depends(get_current_tenant),
):
    try:
        result = (
            supabase.table("notifications")
            .select("*")
            .eq("tenant_id", tenant["tenant_id"])
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception:
        return []


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    try:
        supabase.table("notifications") \
            .update({"is_read": True}) \
            .eq("id", notification_id) \
            .eq("tenant_id", tenant["tenant_id"]) \
            .execute()
    except Exception:
        pass
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(tenant: dict = Depends(get_current_tenant)):
    try:
        supabase.table("notifications") \
            .update({"is_read": True}) \
            .eq("tenant_id", tenant["tenant_id"]) \
            .eq("is_read", False) \
            .execute()
    except Exception:
        pass
    return {"ok": True}
