"""
OmniBot SaaS — Settings Router
Delivery charges (district-wise), bulk discount rules, and per-tenant
Gemini API key management.
"""
import logging
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import (
    DeliveryChargesUpdate, BulkDiscountRuleCreate, BulkDiscountRuleUpdate,
    GeminiKeyValidateRequest, GeminiKeySaveRequest,
)
from app.utils.security import encrypt_token
from app.services.gemini_key_service import validate_gemini_key, mask_key, DEFAULT_MODEL

logger = logging.getLogger(__name__)
router = APIRouter()

BD_DISTRICTS = [
    "Bagerhat", "Bandarban", "Barguna", "Barisal", "Bhola", "Bogra",
    "Brahmanbaria", "Chandpur", "Chapainawabganj", "Chattogram", "Chuadanga",
    "Cumilla", "Cox's Bazar", "Dhaka", "Dinajpur", "Faridpur", "Feni",
    "Gaibandha", "Gazipur", "Gopalganj", "Habiganj", "Jamalpur", "Jashore",
    "Jhalokathi", "Jhenaidah", "Joypurhat", "Khagrachhari", "Khulna",
    "Kishoreganj", "Kurigram", "Kushtia", "Lakshmipur", "Lalmonirhat",
    "Madaripur", "Magura", "Manikganj", "Meherpur", "Moulvibazar",
    "Munshiganj", "Mymensingh", "Naogaon", "Narail", "Narayanganj",
    "Narsingdi", "Natore", "Netrakona", "Nilphamari", "Noakhali", "Pabna",
    "Panchagarh", "Patuakhali", "Pirojpur", "Rajbari", "Rajshahi",
    "Rangamati", "Rangpur", "Satkhira", "Shariatpur", "Sherpur", "Sirajganj",
    "Sunamganj", "Sylhet", "Tangail", "Thakurgaon",
]


# ── Delivery Charges ──────────────────────────────────────────────────────────

@router.get("/delivery-charges")
async def get_delivery_charges(tenant: dict = Depends(get_current_tenant)):
    """Return all 64 districts with their charge amounts for this tenant."""
    tid = tenant["tenant_id"]
    result = (
        supabase.table("delivery_charges")
        .select("district, charge")
        .eq("tenant_id", tid)
        .execute()
    )
    saved = {row["district"]: float(row["charge"]) for row in (result.data or [])}
    # Fill in any missing districts with 0
    return [
        {"district": d, "charge": saved.get(d, 0.0)}
        for d in BD_DISTRICTS
    ]


@router.put("/delivery-charges")
async def save_delivery_charges(
    body: DeliveryChargesUpdate,
    tenant: dict = Depends(get_current_tenant),
):
    """Upsert delivery charges for all provided districts."""
    tid = tenant["tenant_id"]
    rows = [
        {
            "id": str(uuid.uuid4()),
            "tenant_id": tid,
            "district": item.district,
            "charge": item.charge,
            "updated_at": "now()",
        }
        for item in body.charges
        if item.district in BD_DISTRICTS
    ]
    if not rows:
        raise HTTPException(status_code=400, detail="No valid districts provided")

    result = (
        supabase.table("delivery_charges")
        .upsert(rows, on_conflict="tenant_id,district")
        .execute()
    )
    return {"saved": len(rows)}


# ── Bulk Discount Rules ───────────────────────────────────────────────────────

@router.get("/bulk-discounts")
async def list_bulk_discounts(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("bulk_discount_rules")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("min_quantity")
        .execute()
    )
    return result.data or []


@router.post("/bulk-discounts")
async def create_bulk_discount(
    body: BulkDiscountRuleCreate,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]
    row = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "min_quantity": body.min_quantity,
        "discount_pct": body.discount_pct,
        "product_id": body.product_id,
        "product_name": body.product_name,
    }
    result = supabase.table("bulk_discount_rules").insert(row).execute()
    return result.data[0] if result.data else row


@router.patch("/bulk-discounts/{rule_id}")
async def update_bulk_discount(
    rule_id: str,
    body: BulkDiscountRuleUpdate,
    tenant: dict = Depends(get_current_tenant),
):
    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = (
        supabase.table("bulk_discount_rules")
        .update(update_data)
        .eq("id", rule_id)
        .eq("tenant_id", tenant["tenant_id"])
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Rule not found")
    return result.data[0]


@router.delete("/bulk-discounts/{rule_id}")
async def delete_bulk_discount(
    rule_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    supabase.table("bulk_discount_rules").delete().eq("id", rule_id).eq("tenant_id", tenant["tenant_id"]).execute()
    return {"deleted": True}


# ── Gemini API Key ────────────────────────────────────────────────────────────

@router.post("/validate-gemini-key")
async def validate_gemini_key_endpoint(
    body: GeminiKeyValidateRequest,
    tenant: dict = Depends(get_current_tenant),
):
    """Live-check a Gemini API key without saving it."""
    return validate_gemini_key(body.api_key, DEFAULT_MODEL)


@router.put("/gemini-key")
async def save_gemini_key(
    body: GeminiKeySaveRequest,
    tenant: dict = Depends(get_current_tenant),
):
    """Validate then save (encrypted) the tenant's own Gemini API key."""
    result = validate_gemini_key(body.api_key, body.model or DEFAULT_MODEL)
    if not result.get("valid"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Invalid API key")

    tid = tenant["tenant_id"]
    update_data = {
        "gemini_api_key":          encrypt_token(body.api_key.strip()),
        "gemini_model":            body.model or DEFAULT_MODEL,
        "gemini_key_valid":        True,
        "gemini_key_last_checked": datetime.now(timezone.utc).isoformat(),
    }

    existing = (
        supabase.table("ai_config")
        .select("config_id")
        .eq("tenant_id", tid)
        .maybe_single()
        .execute()
    )
    if existing.data:
        supabase.table("ai_config").update(update_data).eq("tenant_id", tid).execute()
    else:
        supabase.table("ai_config").insert({
            "config_id": str(uuid.uuid4()), "tenant_id": tid, **update_data,
        }).execute()

    return {
        "saved": True,
        "valid": True,
        "model": update_data["gemini_model"],
        "message": result.get("message"),
        "key_preview": mask_key(body.api_key.strip()),
    }


@router.get("/gemini-status")
async def gemini_status(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("ai_config")
        .select("gemini_api_key, gemini_model, gemini_key_valid, gemini_key_last_checked")
        .eq("tenant_id", tenant["tenant_id"])
        .maybe_single()
        .execute()
    )
    cfg = (result.data if result is not None else None) or {}
    raw_key = cfg.get("gemini_api_key")

    key_preview = ""
    if raw_key:
        try:
            from app.utils.security import decrypt_token
            key_preview = mask_key(decrypt_token(raw_key))
        except Exception:
            key_preview = "••••"

    return {
        "has_key":      bool(raw_key),
        "key_valid":    bool(cfg.get("gemini_key_valid")),
        "model":        cfg.get("gemini_model") or DEFAULT_MODEL,
        "last_checked": cfg.get("gemini_key_last_checked"),
        "key_preview":  key_preview,
    }
