"""
OmniBot SaaS — Combo Offers Router
CRUD for product combos with auto SKU generation.
"""
import uuid, logging, io, csv
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import ComboCreate, ComboUpdate

logger = logging.getLogger(__name__)
router = APIRouter()


def _auto_sku(name: str, tenant_id: str) -> str:
    prefix = "".join(c.upper() for c in name if c.isalpha())[:4] or "CMB"
    suffix = str(uuid.uuid4())[:6].upper()
    return f"{prefix}-{suffix}"


@router.get("/templates/combo")
async def download_combo_template(tenant: dict = Depends(get_current_tenant)):
    """Download CSV template for combo stock update."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerows([
        ["# COMBO STOCK UPDATE TEMPLATE"],
        ["# combo_sku: Combo-এর SKU (required)"],
        ["# stock: নতুন stock পরিমাণ (required)"],
        ["#"],
        ["combo_sku", "stock"],
        ["CMB-ABC123", "10"],
    ])
    return StreamingResponse(
        io.StringIO(output.getvalue()),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="combo-template.csv"'},
    )


@router.get("/")
async def list_combos(tenant: dict = Depends(get_current_tenant)):
    combos = supabase.table("combos").select("*").eq("tenant_id", tenant["tenant_id"]).order("created_at", desc=True).execute().data or []
    for c in combos:
        prods = supabase.table("combo_products").select("*").eq("combo_id", c["combo_id"]).execute().data or []
        c["products"] = prods
    return combos


@router.post("/", status_code=201)
async def create_combo(body: ComboCreate, tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    combo_sku = _auto_sku(body.name, tid)
    combo_id = str(uuid.uuid4())
    row = {
        "combo_id": combo_id, "tenant_id": tid,
        "combo_sku": combo_sku, "name": body.name,
        "description": body.description, "price": body.price,
        "offer_price": body.offer_price, "stock": body.stock,
        "image_url": body.image_url, "is_active": True,
    }
    result = supabase.table("combos").insert(row).execute()
    combo = result.data[0]

    if body.products:
        prod_rows = [{
            "combo_id": combo_id, "product_id": p.product_id,
            "sku": p.sku, "name": p.name, "mrp": p.mrp, "quantity": p.quantity
        } for p in body.products]
        supabase.table("combo_products").insert(prod_rows).execute()

    combo["products"] = [p.model_dump() for p in body.products] if body.products else []
    return combo


@router.patch("/{combo_id}")
async def update_combo(combo_id: str, body: ComboUpdate, tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    update_data = {k: v for k, v in body.model_dump().items() if v is not None and k != "products"}

    if update_data:
        result = supabase.table("combos").update(update_data).eq("tenant_id", tid).eq("combo_id", combo_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Combo not found")

    if body.products is not None:
        supabase.table("combo_products").delete().eq("combo_id", combo_id).execute()
        if body.products:
            prod_rows = [{
                "combo_id": combo_id, "product_id": p.product_id,
                "sku": p.sku, "name": p.name, "mrp": p.mrp, "quantity": p.quantity
            } for p in body.products]
            supabase.table("combo_products").insert(prod_rows).execute()

    combo = supabase.table("combos").select("*").eq("combo_id", combo_id).maybe_single().execute().data
    prods = supabase.table("combo_products").select("*").eq("combo_id", combo_id).execute().data or []
    combo["products"] = prods
    return combo


@router.delete("/{combo_id}", status_code=204)
async def delete_combo(combo_id: str, tenant: dict = Depends(get_current_tenant)):
    supabase.table("combos").delete().eq("tenant_id", tenant["tenant_id"]).eq("combo_id", combo_id).execute()
    return None
