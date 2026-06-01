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


def _adjust_stock(tenant_id: str, product_id: str, quantity: int, change_type: str, order_id: str):
    """Deduct (negative quantity) or restore (positive quantity) stock from the stock table."""
    stock_row = (
        supabase.table("stock")
        .select("current_stock, product_id")
        .eq("tenant_id", tenant_id)
        .eq("product_id", product_id)
        .maybe_single()
        .execute().data
    )
    if not stock_row:
        return

    # Get sku for history log
    prod = (
        supabase.table("products")
        .select("sku")
        .eq("product_id", product_id)
        .maybe_single()
        .execute().data
    )
    sku = (prod or {}).get("sku", "")

    before = stock_row.get("current_stock", 0)
    after  = max(0, before + quantity)

    supabase.table("stock").update({"current_stock": after}) \
        .eq("tenant_id", tenant_id) \
        .eq("product_id", product_id) \
        .execute()

    supabase.table("stock_history").insert({
        "tenant_id":       tenant_id,
        "product_id":      product_id,
        "sku":             sku,
        "change_type":     change_type,
        "quantity_change": quantity,
        "quantity_before": before,
        "quantity_after":  after,
        "reference_id":    order_id,
    }).execute()


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
    data = result.data if (result is not None and hasattr(result, 'data')) else result
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

    result = (
        supabase.table("orders")
        .update({"status": body.status})
        .eq("tenant_id", tenant["tenant_id"])
        .eq("order_id", order_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Order not found")

    order      = result.data[0]
    product_id = order.get("product_id")
    quantity   = order.get("quantity", 1)
    tid        = tenant["tenant_id"]

    if product_id and body.status == "cancelled":
        # Restore stock when order is cancelled
        _adjust_stock(tid, product_id, +quantity, "order_cancelled", order_id)

    return order
