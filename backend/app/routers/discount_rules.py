"""
OmniBot SaaS — Discount Rules Router
Pure CRUD — no priority, no is_active, no dates.
Rules are reusable logic blocks attached to Discounts.
"""
from datetime import datetime
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


class RuleCreate(BaseModel):
    rule_name: str
    rule_type: str
    conditions: dict = {}
    reward: dict = {}


class RuleUpdate(BaseModel):
    rule_name: Optional[str] = None
    conditions: Optional[dict] = None
    reward: Optional[dict] = None


@router.get("/")
async def list_rules(tenant=Depends(get_current_tenant)):
    res = (
        supabase.table("discount_rules")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("created_at", desc=False)
        .execute()
    )
    return res.data or []


@router.post("/")
async def create_rule(body: RuleCreate, tenant=Depends(get_current_tenant)):
    if body.rule_type not in VALID_TYPES:
        raise HTTPException(400, f"Invalid rule_type. Must be one of: {', '.join(sorted(VALID_TYPES))}")
    res = (
        supabase.table("discount_rules")
        .insert({
            "tenant_id":  tenant["tenant_id"],
            "rule_name":  body.rule_name,
            "rule_type":  body.rule_type,
            "conditions": body.conditions,
            "reward":     body.reward,
        })
        .execute()
    )
    if not res.data:
        raise HTTPException(500, "Failed to create rule")
    return res.data[0]


@router.patch("/{rule_id}")
@router.put("/{rule_id}")
async def update_rule(rule_id: str, body: RuleUpdate, tenant=Depends(get_current_tenant)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    res = (
        supabase.table("discount_rules")
        .update(updates)
        .eq("rule_id", rule_id)
        .eq("tenant_id", tenant["tenant_id"])
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Rule not found")
    return res.data[0]


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str, tenant=Depends(get_current_tenant)):
    (
        supabase.table("discount_rules")
        .delete()
        .eq("rule_id", rule_id)
        .eq("tenant_id", tenant["tenant_id"])
        .execute()
    )
    return {"ok": True}
