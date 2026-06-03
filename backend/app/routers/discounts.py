"""
OmniBot SaaS — Discounts Router
Read-only API for normalized discount records created at order time.
"""
import logging
from collections import defaultdict, Counter
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Body
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


@router.get("/report")
async def discounts_report(
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    eff_from: Optional[str] = None,
    eff_to: Optional[str] = None,
    discount_category_id: Optional[str] = None,
    discount_rule_type: Optional[str] = None,
    is_active: Optional[bool] = None,
    limit: int = 500,
    tenant: dict = Depends(get_current_tenant),
):
    """Aggregated discount report grouped by discount_code."""
    tid = tenant["tenant_id"]
    q = supabase.table("discounts").select("*").eq("tenant_id", tid)

    if created_from:
        q = q.gte("created_at", created_from)
    if created_to:
        q = q.lte("created_at", created_to + "T23:59:59")
    if eff_from:
        q = q.gte("effective_from", eff_from)
    if eff_to:
        q = q.lte("effective_to", eff_to + "T23:59:59")
    if discount_category_id:
        q = q.eq("discount_category_id", discount_category_id)
    if discount_rule_type:
        q = q.eq("discount_rule_type", discount_rule_type)
    if is_active is not None:
        q = q.eq("is_active", is_active)

    rows = q.order("created_at", desc=True).limit(limit).execute().data or []

    # Group by discount_code; keep first row's metadata
    groups: dict = defaultdict(list)
    for row in rows:
        groups[row["discount_code"]].append(row)

    # Count orders per discount_code from the orders table
    codes = list(groups.keys())
    order_count_map: Counter = Counter()
    if codes:
        try:
            order_rows = (
                supabase.table("orders")
                .select("discount_code")
                .eq("tenant_id", tid)
                .in_("discount_code", codes)
                .execute().data or []
            )
            order_count_map = Counter(r["discount_code"] for r in order_rows)
        except Exception:
            pass

    result = []
    for code, code_rows in groups.items():
        first = code_rows[0]
        total_disc = round(sum(float(r.get("discount_amount") or 0) for r in code_rows), 2)
        result.append({
            **first,
            "orders_count": order_count_map.get(code, 0),
            "total_discount_amount": total_disc,
        })

    result.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return result


@router.patch("/toggle/{discount_code}")
async def toggle_discount_active(
    discount_code: str,
    is_active: bool = Body(..., embed=True),
    tenant: dict = Depends(get_current_tenant),
):
    """Set is_active on all rows for a discount_code."""
    tid = tenant["tenant_id"]
    (
        supabase.table("discounts")
        .update({"is_active": is_active})
        .eq("tenant_id", tid)
        .eq("discount_code", discount_code)
        .execute()
    )
    return {"ok": True, "is_active": is_active}


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
