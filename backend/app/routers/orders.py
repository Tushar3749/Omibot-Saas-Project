"""
OmniBot SaaS — Orders Router
View and manage AI-extracted orders.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import OrderStatusUpdate

logger = logging.getLogger(__name__)
router = APIRouter()

# ─── Stock helpers ────────────────────────────────────────────────────────────

def _get_stock_row(tenant_id: str, product_id: str) -> dict:
    res = (
        supabase.table("stock")
        .select("current_stock, physical_stock, issued_stock")
        .eq("tenant_id", tenant_id)
        .eq("product_id", product_id)
        .maybe_single()
        .execute()
    )
    return (res.data or {}) if res else {}


def _log_movement(
    tenant_id: str, product_id: str, order_id: str | None,
    movement_type: str, quantity: int,
    physical_before: int, physical_after: int,
    issued_before: int, issued_after: int,
    note: str = None,
):
    try:
        supabase.table("stock_movements").insert({
            "tenant_id":       tenant_id,
            "product_id":      product_id,
            "order_id":        order_id,
            "movement_type":   movement_type,
            "quantity":        quantity,
            "physical_before": physical_before,
            "physical_after":  physical_after,
            "issued_before":   issued_before,
            "issued_after":    issued_after,
            "note":            note,
        }).execute()
    except Exception as e:
        logger.warning(f"stock_movements insert failed: {e}")


def _log_history(
    tenant_id: str, product_id: str, sku: str,
    change_type: str, qty_change: int,
    before: int, after: int, order_id: str = None,
):
    try:
        supabase.table("stock_history").insert({
            "tenant_id":       tenant_id,
            "product_id":      product_id,
            "sku":             sku,
            "change_type":     change_type,
            "quantity_change": qty_change,
            "quantity_before": before,
            "quantity_after":  after,
            "reference_id":    order_id,
        }).execute()
    except Exception as e:
        logger.warning(f"stock_history insert failed: {e}")


def _apply_stock_transition(
    tenant_id: str, product_id: str, quantity: int,
    old_status: str, new_status: str, order_id: str,
):
    """Apply physical/issued stock changes for an order status transition."""
    sr = _get_stock_row(tenant_id, product_id)
    if not sr:
        return

    phys       = int(sr.get("physical_stock") or 0)
    issued     = int(sr.get("issued_stock") or 0)
    cur        = int(sr.get("current_stock") or 0)
    new_model  = (phys > 0 or issued > 0)

    prod = (
        supabase.table("products")
        .select("sku")
        .eq("product_id", product_id)
        .maybe_single()
        .execute().data
    )
    sku = (prod or {}).get("sku", "")

    if new_status == "shipped" and old_status in ("pending", "confirmed"):
        if new_model:
            new_phys   = max(0, phys - quantity)
            new_issued = max(0, issued - quantity)
            new_cur    = max(0, new_phys - new_issued)
            supabase.table("stock").update({
                "physical_stock": new_phys,
                "issued_stock":   new_issued,
                "current_stock":  new_cur,
            }).eq("tenant_id", tenant_id).eq("product_id", product_id).execute()
            _log_movement(tenant_id, product_id, order_id, "ship", quantity,
                          phys, new_phys, issued, new_issued, note="Order shipped")
            _log_history(tenant_id, product_id, sku, "order_shipped",
                         -quantity, phys, new_phys, order_id)
        else:
            new_cur = max(0, cur - quantity)
            supabase.table("stock").update({"current_stock": new_cur}) \
                .eq("tenant_id", tenant_id).eq("product_id", product_id).execute()
            _log_history(tenant_id, product_id, sku, "order_shipped",
                         -quantity, cur, new_cur, order_id)

    elif new_status == "cancelled" and old_status in ("pending", "confirmed"):
        if new_model:
            new_issued = max(0, issued - quantity)
            new_cur    = max(0, phys - new_issued)
            supabase.table("stock").update({
                "issued_stock":  new_issued,
                "current_stock": new_cur,
            }).eq("tenant_id", tenant_id).eq("product_id", product_id).execute()
            _log_movement(tenant_id, product_id, order_id, "cancel", quantity,
                          phys, phys, issued, new_issued, note="Order cancelled")
            _log_history(tenant_id, product_id, sku, "order_cancelled",
                         +quantity, issued, new_issued, order_id)
        else:
            new_cur = cur + quantity
            supabase.table("stock").update({"current_stock": new_cur}) \
                .eq("tenant_id", tenant_id).eq("product_id", product_id).execute()
            _log_history(tenant_id, product_id, sku, "order_cancelled",
                         +quantity, cur, new_cur, order_id)


def _get_order_items(order: dict) -> list[dict]:
    """Return list of {product_id, quantity} from an order row (multi-item aware)."""
    items = order.get("items") or []
    if items:
        return [
            {"product_id": it.get("product_id"), "quantity": int(it.get("quantity") or 0)}
            for it in items
            if it.get("product_id") and int(it.get("quantity") or 0) > 0
        ]
    pid = order.get("product_id")
    qty = int(order.get("quantity") or 0)
    if pid and qty > 0:
        return [{"product_id": pid, "quantity": qty}]
    return []


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/")
async def list_orders(
    status: str = None,
    tenant: dict = Depends(get_current_tenant),
):
    query = (
        supabase.table("orders")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("created_at", desc=True)
    )
    if status:
        query = query.eq("status", status)
    result = query.execute()
    return result.data or []


@router.get("/{order_id}")
async def get_order(order_id: str, tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("orders")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .eq("order_id", order_id)
        .maybe_single()
        .execute()
    )
    data = result.data if (result is not None and hasattr(result, "data")) else result
    if data is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return data


@router.patch("/{order_id}/status")
async def update_order_status(
    order_id: str,
    body: OrderStatusUpdate,
    tenant: dict = Depends(get_current_tenant),
):
    valid_statuses = {"pending", "confirmed", "shipped", "delivered", "cancelled"}
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use: {valid_statuses}")

    tid = tenant["tenant_id"]

    current = (
        supabase.table("orders")
        .select("*")
        .eq("tenant_id", tid)
        .eq("order_id", order_id)
        .maybe_single()
        .execute()
    )
    if not current or not current.data:
        raise HTTPException(status_code=404, detail="Order not found")

    old_order  = current.data
    old_status = old_order.get("status", "pending")

    if old_status == body.status:
        return old_order

    result = (
        supabase.table("orders")
        .update({"status": body.status})
        .eq("tenant_id", tid)
        .eq("order_id", order_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Order update failed")

    order = result.data[0]

    for item in _get_order_items(old_order):
        try:
            _apply_stock_transition(
                tid, item["product_id"], item["quantity"],
                old_status, body.status, order_id,
            )
        except Exception as e:
            logger.warning(f"Stock transition failed for {item['product_id']}: {e}")

    return order
