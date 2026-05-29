"""
OmniBot SaaS — Settings Router
Delivery charges (district-wise) and bulk discount rules.
"""
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import DeliveryChargesUpdate, BulkDiscountRuleCreate, BulkDiscountRuleUpdate

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
