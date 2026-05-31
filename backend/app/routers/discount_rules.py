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
    'district', 'time_based', 'seasonal',
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
    res = (supabase.table("discount_rules")
           .select("*")
           .eq("tenant_id", tenant["tenant_id"])
           .eq("is_active", True)
           .order("priority")
           .execute())
    all_rules = res.data or []

    matched = []
    today = date.today()

    for rule in all_rules:
        conds = rule.get("conditions", {})
        rtype = rule["rule_type"]
        hit = False

        if rtype == "cart_value":
            hit = body.cart_amount >= float(conds.get("min_cart_amount", 0))

        elif rtype == "new_customer":
            hit = bool(body.is_new_customer)

        elif rtype == "repeated_customer" and body.days_since_last_order is not None:
            for tier in conds.get("tiers", []):
                if int(tier.get("from_days", 0)) <= body.days_since_last_order <= int(tier.get("to_days", 9999)):
                    hit = True
                    break

        elif rtype == "bulk_quantity" and body.quantity:
            hit = body.quantity >= int(conds.get("min_quantity", 1))

        elif rtype == "district" and body.district:
            hit = body.district in conds.get("districts", [])

        elif rtype == "specific_product" and body.product_skus:
            hit = any(sku in conds.get("skus", []) for sku in body.product_skus)

        elif rtype == "specific_category" and body.categories:
            hit = any(cat in conds.get("categories", []) for cat in body.categories)

        elif rtype == "time_based":
            from datetime import datetime as dt
            now_dt = dt.now()
            dow = now_dt.strftime("%a").lower()  # mon, tue, …
            active_days = [d.lower() for d in conds.get("days_of_week", [])]
            if dow in active_days:
                from_t = conds.get("from_time", "00:00")
                to_t   = conds.get("to_time",   "23:59")
                cur    = now_dt.strftime("%H:%M")
                hit    = from_t <= cur <= to_t

        elif rtype == "seasonal":
            start = conds.get("start_date")
            end   = conds.get("end_date")
            if start and end:
                try:
                    hit = date.fromisoformat(start) <= today <= date.fromisoformat(end)
                except ValueError:
                    pass

        if hit:
            reward = rule.get("reward", {})
            matched.append({
                "rule_id":       rule["rule_id"],
                "rule_name":     rule["rule_name"],
                "rule_type":     rtype,
                "priority":      rule["priority"],
                "discount_type": reward.get("discount_type", "percentage"),
                "discount_value": float(reward.get("discount_value", 0)),
            })

    # Fetch conflict resolution config
    cfg_res = (supabase.table("ai_config")
               .select("conflict_resolution, discount_stack_cap")
               .eq("tenant_id", tenant["tenant_id"])
               .maybe_single()
               .execute())
    cfg        = cfg_res.data or {}
    resolution = cfg.get("conflict_resolution", "best_deal")
    stack_cap  = float(cfg.get("discount_stack_cap", 30))

    if not matched:
        return {"matched_rules": [], "final_discount_pct": 0, "final_discount_flat": 0,
                "discount_amount": 0, "final_price": body.cart_amount, "resolution": resolution}

    final_pct  = 0.0
    final_flat = 0.0

    if resolution == "priority_wins":
        top = matched[0]
        if top["discount_type"] == "percentage":
            final_pct = top["discount_value"]
        else:
            final_flat = top["discount_value"]
        matched = [top]

    elif resolution == "best_deal":
        best = max(matched, key=lambda r: (
            r["discount_value"] * body.cart_amount / 100
            if r["discount_type"] == "percentage"
            else r["discount_value"]
        ))
        if best["discount_type"] == "percentage":
            final_pct = best["discount_value"]
        else:
            final_flat = best["discount_value"]
        matched = [best]

    else:  # stack_all or stack_with_cap
        for r in matched:
            if r["discount_type"] == "percentage":
                final_pct += r["discount_value"]
            else:
                final_flat += r["discount_value"]
        if resolution == "stack_with_cap":
            final_pct = min(final_pct, stack_cap)

    discount_amount = (body.cart_amount * final_pct / 100) + final_flat
    final_price     = max(0.0, body.cart_amount - discount_amount)

    return {
        "matched_rules":       matched,
        "final_discount_pct":  round(final_pct, 2),
        "final_discount_flat": round(final_flat, 2),
        "discount_amount":     round(discount_amount, 2),
        "final_price":         round(final_price, 2),
        "resolution":          resolution,
    }
