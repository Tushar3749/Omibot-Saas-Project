"""
OmniBot SaaS — Per-Product Negotiation Rules Router
"""
import uuid, logging
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import NegotiationRuleCreate, NegotiationRuleUpdate

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
async def list_rules(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("negotiation_rules")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.post("/", status_code=201)
async def create_rule(body: NegotiationRuleCreate, tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    # Check if rule already exists for this product
    existing = (
        supabase.table("negotiation_rules")
        .select("id")
        .eq("tenant_id", tid)
        .eq("product_id", body.product_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        raise HTTPException(
            status_code=409,
            detail="Negotiation rule already exists for this product. Use PATCH to update."
        )

    row = {
        "id":                str(uuid.uuid4()),
        "tenant_id":         tid,
        "product_id":        body.product_id,
        "sku":               body.sku,
        "product_name":      body.product_name,
        "max_discount_pct":  body.max_discount_pct,
        "min_price":         body.min_price,
        "negotiation_style": body.negotiation_style,
        "is_active":         True,
    }
    result = supabase.table("negotiation_rules").insert(row).execute()
    return result.data[0]


@router.patch("/{rule_id}")
async def update_rule(rule_id: str, body: NegotiationRuleUpdate, tenant: dict = Depends(get_current_tenant)):
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="Nothing to update")
    result = (
        supabase.table("negotiation_rules")
        .update(update_data)
        .eq("tenant_id", tenant["tenant_id"])
        .eq("id", rule_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Rule not found")
    return result.data[0]


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(rule_id: str, tenant: dict = Depends(get_current_tenant)):
    supabase.table("negotiation_rules").delete().eq("tenant_id", tenant["tenant_id"]).eq("id", rule_id).execute()
    return None
