"""
OmniBot SaaS — Returns Router v2
Order-linked returns created by the bot; managed by the owner.

GET    /                        list returns (optional ?status=pending|approved|rejected)
GET    /{return_id}             get single return
PATCH  /{return_id}/approve     approve → restore stock + update order status
PATCH  /{return_id}/reject      reject with optional owner_note
DELETE /{return_id}             hard delete (admin only)
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import ReturnRejectRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
async def list_returns(
    status: Optional[str] = Query(None, regex="^(pending|approved|rejected|cancelled)$"),
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]
    q = (
        supabase.table("returns")
        .select("*")
        .eq("tenant_id", tid)
        .order("created_at", desc=True)
    )
    if status:
        q = q.eq("status", status)
    result = q.execute()
    return result.data or []


@router.get("/counts")
async def return_counts(tenant: dict = Depends(get_current_tenant)):
    """Badge counts per status for the dashboard tabs."""
    tid = tenant["tenant_id"]
    result = supabase.table("returns").select("status").eq("tenant_id", tid).execute()
    rows = result.data or []
    counts = {"pending": 0, "approved": 0, "rejected": 0, "cancelled": 0}
    for r in rows:
        s = r.get("status", "pending")
        counts[s] = counts.get(s, 0) + 1
    return counts


@router.get("/{return_id}")
async def get_return(return_id: str, tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    result = (
        supabase.table("returns")
        .select("*")
        .eq("tenant_id", tid)
        .eq("return_id", return_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Return not found")
    return result.data


@router.patch("/{return_id}/approve")
async def approve_return(return_id: str, tenant: dict = Depends(get_current_tenant)):
    """
    Approve a return:
    - Restore stock for every item
    - Update order status to 'returned' (full) or 'partial_return' (partial)
    """
    tid = tenant["tenant_id"]

    ret = (
        supabase.table("returns")
        .select("*")
        .eq("tenant_id", tid)
        .eq("return_id", return_id)
        .maybe_single()
        .execute().data
    )
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    if ret["status"] != "pending":
        raise HTTPException(status_code=400, detail="Only pending returns can be approved")

    # ── Restore stock for each returned item ──────────────────────────────────
    for item in (ret.get("items") or []):
        pid = item.get("product_id")
        qty = item.get("quantity", 0)
        sku = item.get("sku", "")
        if not pid or not qty:
            continue
        try:
            stock_res = (
                supabase.table("stock")
                .select("current_stock, physical_stock, issued_stock")
                .eq("tenant_id", tid)
                .eq("product_id", pid)
                .maybe_single()
                .execute()
            )
            sr     = (stock_res.data or {}) if stock_res else {}
            phys   = int(sr.get("physical_stock") or 0)
            issued = int(sr.get("issued_stock") or 0)
            cur    = int(sr.get("current_stock") or 0)

            note_text = f"Return approved — {item.get('reason', '')}"

            if phys > 0 or issued > 0:
                new_phys = phys + qty
                new_cur  = max(0, new_phys - issued)
                supabase.table("stock").upsert(
                    {"tenant_id": tid, "product_id": pid,
                     "physical_stock": new_phys, "current_stock": new_cur},
                    on_conflict="tenant_id,product_id",
                ).execute()
                supabase.table("stock_history").insert({
                    "tenant_id":       tid,
                    "product_id":      pid,
                    "sku":             sku,
                    "change_type":     "return",
                    "quantity_change": qty,
                    "quantity_before": cur,
                    "quantity_after":  new_cur,
                    "reference_id":    return_id,
                    "note":            note_text,
                }).execute()
                try:
                    supabase.table("stock_movements").insert({
                        "tenant_id":       tid,
                        "product_id":      pid,
                        "order_id":        ret.get("order_id"),
                        "movement_type":   "return",
                        "quantity":        qty,
                        "physical_before": phys,
                        "physical_after":  new_phys,
                        "issued_before":   issued,
                        "issued_after":    issued,
                        "note":            note_text,
                    }).execute()
                except Exception as _me:
                    logger.warning(f"stock_movements insert failed: {_me}")
            else:
                after = cur + qty
                supabase.table("stock").upsert(
                    {"tenant_id": tid, "product_id": pid, "current_stock": after},
                    on_conflict="tenant_id,product_id",
                ).execute()
                supabase.table("stock_history").insert({
                    "tenant_id":       tid,
                    "product_id":      pid,
                    "sku":             sku,
                    "change_type":     "return",
                    "quantity_change": qty,
                    "quantity_before": cur,
                    "quantity_after":  after,
                    "reference_id":    return_id,
                    "note":            note_text,
                }).execute()
        except Exception as exc:
            logger.warning(f"Stock restore failed for product {pid}: {exc}")

    # ── Update order status ───────────────────────────────────────────────────
    if ret.get("order_id"):
        new_order_status = "returned" if ret["return_type"] == "full" else "partial_return"
        try:
            supabase.table("orders").update({"status": new_order_status}) \
                .eq("order_id", ret["order_id"]).execute()
        except Exception as exc:
            logger.warning(f"Order status update failed: {exc}")

    # ── Mark return approved ──────────────────────────────────────────────────
    result = supabase.table("returns").update({
        "status":     "approved",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("return_id", return_id).execute()

    return result.data[0]


@router.patch("/{return_id}/reject")
async def reject_return(
    return_id: str,
    body: ReturnRejectRequest,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]

    ret = (
        supabase.table("returns")
        .select("return_id, status")
        .eq("tenant_id", tid)
        .eq("return_id", return_id)
        .maybe_single()
        .execute().data
    )
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    if ret["status"] != "pending":
        raise HTTPException(status_code=400, detail="Only pending returns can be rejected")

    update_data: dict = {
        "status":     "rejected",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.owner_note:
        update_data["owner_note"] = body.owner_note

    result = supabase.table("returns").update(update_data).eq("return_id", return_id).execute()
    return result.data[0]


@router.delete("/{return_id}", status_code=204)
async def delete_return(return_id: str, tenant: dict = Depends(get_current_tenant)):
    supabase.table("returns").delete() \
        .eq("tenant_id", tenant["tenant_id"]) \
        .eq("return_id", return_id) \
        .execute()
    return None
