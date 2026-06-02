"""
OmniBot SaaS — Discounts Router
Read-only API for normalized discount records created at order time.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/order/{order_id}")
async def get_discount_by_order(order_id: str, tenant: dict = Depends(get_current_tenant)):
    """Return the discount breakdown for a given order."""
    tid = tenant["tenant_id"]

    order = (
        supabase.table("orders")
        .select("discount_code, original_amount, net_amount, agreed_price")
        .eq("tenant_id", tid)
        .eq("order_id", order_id)
        .maybe_single()
        .execute().data
    )
    if not order:
        raise HTTPException(404, "Order not found")

    code = order.get("discount_code")
    if not code:
        return {
            "discount_code":   None,
            "rows":            [],
            "total_discount":  0,
            "original_amount": order.get("original_amount") or order.get("agreed_price"),
            "net_amount":      order.get("net_amount") or order.get("agreed_price"),
        }

    rows = (
        supabase.table("discounts")
        .select("*")
        .eq("tenant_id", tid)
        .eq("discount_code", code)
        .execute().data or []
    )
    total_discount = sum(float(r.get("discount_amount") or 0) for r in rows)

    return {
        "discount_code":   code,
        "rows":            rows,
        "total_discount":  round(total_discount, 2),
        "original_amount": order.get("original_amount") or order.get("agreed_price"),
        "net_amount":      order.get("net_amount") or order.get("agreed_price"),
    }


@router.get("/{discount_code}")
async def get_discount_by_code(discount_code: str, tenant: dict = Depends(get_current_tenant)):
    """Return all rows for a specific discount code."""
    tid = tenant["tenant_id"]
    rows = (
        supabase.table("discounts")
        .select("*")
        .eq("tenant_id", tid)
        .eq("discount_code", discount_code)
        .execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Discount code not found")
    total_discount = sum(float(r.get("discount_amount") or 0) for r in rows)
    return {
        "discount_code":  discount_code,
        "rows":           rows,
        "total_discount": round(total_discount, 2),
    }


@router.get("/")
async def list_discounts(
    limit: int = 50,
    tenant: dict = Depends(get_current_tenant),
):
    """List recent discounts for the tenant."""
    tid = tenant["tenant_id"]
    rows = (
        supabase.table("discounts")
        .select("*")
        .eq("tenant_id", tid)
        .order("created_at", desc=True)
        .limit(limit)
        .execute().data or []
    )
    return rows
