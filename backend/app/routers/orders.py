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

    # After updating status, adjust stock
    order = result.data[0]
    product_id = order.get("product_id")
    quantity = order.get("quantity", 1)

    if product_id and body.status == "delivered":
        # Decrease stock on delivery
        prod = (
            supabase.table("products")
            .select("stock,sku")
            .eq("product_id", product_id)
            .maybe_single()
            .execute().data
        )
        if prod:
            before = prod.get("stock") or 0
            after = max(0, before - quantity)
            supabase.table("products").update({"stock": after}).eq("product_id", product_id).execute()
            supabase.table("stock_history").insert({
                "tenant_id": tenant["tenant_id"], "product_id": product_id, "sku": prod["sku"],
                "change_type": "order_placed", "quantity_change": -quantity,
                "quantity_before": before, "quantity_after": after,
                "reference_id": order_id,
            }).execute()
    elif product_id and body.status == "cancelled":
        # Restore stock on cancellation
        prod = (
            supabase.table("products")
            .select("stock,sku")
            .eq("product_id", product_id)
            .maybe_single()
            .execute().data
        )
        if prod:
            before = prod.get("stock") or 0
            after = before + quantity
            supabase.table("products").update({"stock": after}).eq("product_id", product_id).execute()
            supabase.table("stock_history").insert({
                "tenant_id": tenant["tenant_id"], "product_id": product_id, "sku": prod["sku"],
                "change_type": "order_cancelled", "quantity_change": quantity,
                "quantity_before": before, "quantity_after": after,
                "reference_id": order_id,
            }).execute()

    return order
