"""
OmniBot SaaS — Smart Discount Rules Router
GET/POST/PUT/DELETE rules + priority batch update + preview calculator
"""
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_tenant
from app.database import supabase

router = APIRouter()

VALID_TYPES = {
    'cart_value', 'repeated_customer', 'new_customer',
    'specific_product', 'specific_category', 'bulk_quantity',
    'district', 'time_based', 'seasonal', 'lifetime_value',
}


# ── Schemas ───────────────────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    rule_type: str
    rule_name: str = ""
    conditions: dict = {}
    reward: dict = {}
    priority: int = 99
    is_active: bool = True


class RuleUpdate(BaseModel):
    rule_name: Optional[str] = None
    conditions: Optional[dict] = None
    reward: Optional[dict] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None


class PriorityItem(BaseModel):
    id: str
    priority: int


class PriorityBatch(BaseModel):
    rules: list[PriorityItem]


class PreviewRequest(BaseModel):
    cart_amount: float
    product_skus: Optional[list[str]] = None
    categories: Optional[list[str]] = None
    district: Optional[str] = None
    is_new_customer: Optional[bool] = None
    days_since_last_order: Optional[int] = None
    quantity: Optional[int] = None
    customer_phone: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_rules(tenant=Depends(get_current_tenant)):
    res = (supabase.table("discount_rules")
           .select("*")
           .eq("tenant_id", tenant["tenant_id"])
           .order("priority")
           .execute())
    return res.data or []


@router.post("/")
async def create_rule(body: RuleCreate, tenant=Depends(get_current_tenant)):
    if body.rule_type not in VALID_TYPES:
        raise HTTPException(400, f"Invalid rule_type. Must be one of: {', '.join(sorted(VALID_TYPES))}")
    res = (supabase.table("discount_rules")
           .insert({
               "tenant_id":  tenant["tenant_id"],
               "rule_type":  body.rule_type,
               "rule_name":  body.rule_name,
               "conditions": body.conditions,
               "reward":     body.reward,
               "priority":   body.priority,
               "is_active":  body.is_active,
           })
           .execute())
    if not res.data:
        raise HTTPException(500, "Failed to create rule")
    return res.data[0]


@router.put("/{rule_id}")
@router.patch("/{rule_id}")
async def update_rule(rule_id: str, body: RuleUpdate, tenant=Depends(get_current_tenant)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates["updated_at"] = datetime.utcnow().isoformat()
    res = (supabase.table("discount_rules")
           .update(updates)
           .eq("rule_id", rule_id)
           .eq("tenant_id", tenant["tenant_id"])
           .execute())
    if not res.data:
        raise HTTPException(404, "Rule not found")
    return res.data[0]


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str, tenant=Depends(get_current_tenant)):
    (supabase.table("discount_rules")
     .delete()
     .eq("rule_id", rule_id)
     .eq("tenant_id", tenant["tenant_id"])
     .execute())
    return {"ok": True}


@router.put("/priority/batch")
async def update_priority(body: PriorityBatch, tenant=Depends(get_current_tenant)):
    now = datetime.utcnow().isoformat()
    for item in body.rules:
        (supabase.table("discount_rules")
         .update({"priority": item.priority, "updated_at": now})
         .eq("rule_id", item.id)
         .eq("tenant_id", tenant["tenant_id"])
         .execute())
    return {"ok": True, "updated": len(body.rules)}


@router.post("/preview")
async def preview_discount(body: PreviewRequest, tenant=Depends(get_current_tenant)):
    from app.services.discount_engine import match_rules, apply_conflict_resolution

    # Use real customer metrics if phone provided, otherwise mock from request
    if body.customer_phone:
        from app.services.discount_engine import get_customer_metrics
        mock_metrics = get_customer_metrics(tenant["tenant_id"], customer_phone=body.customer_phone)
    else:
        mock_metrics = {
            "total_orders":         0 if body.is_new_customer else 5,
            "total_lifetime_value": 0.0,
            "avg_basket_value":     0.0,
            "last_order_days_ago":  body.days_since_last_order,
            "last_order_date":      None,
            "previous_product_ids": [],
            "previous_categories":  list(body.categories or []),
            "current_month_orders": 0,
            "is_new_customer":      bool(body.is_new_customer),
        }
    cart_ctx = {
        "cart_amount":  body.cart_amount,
        "product_skus": body.product_skus or [],
        "categories":   body.categories or [],
        "district":     body.district,
        "quantity":     body.quantity or 1,
    }
    matched = match_rules(tenant["tenant_id"], mock_metrics, cart_ctx)

    cfg_res = (supabase.table("ai_config")
               .select("conflict_resolution, discount_stack_cap")
               .eq("tenant_id", tenant["tenant_id"])
               .maybe_single()
               .execute())
    cfg        = cfg_res.data or {}
    resolution = cfg.get("conflict_resolution", "best_deal")
    stack_cap  = float(cfg.get("discount_stack_cap", 30))

    final_pct, final_flat, applied = apply_conflict_resolution(
        matched, resolution, stack_cap, body.cart_amount
    )
    discount_amount = (body.cart_amount * final_pct / 100) + final_flat
    final_price     = max(0.0, body.cart_amount - discount_amount)

    return {
        "matched_rules":       matched,
        "applied_rules":       applied,
        "final_discount_pct":  round(final_pct, 2),
        "final_discount_flat": round(final_flat, 2),
        "discount_amount":     round(discount_amount, 2),
        "final_price":         round(final_price, 2),
        "resolution":          resolution,
    }

