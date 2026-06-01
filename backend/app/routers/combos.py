"""
OmniBot SaaS — Combo Offers Router
Combos are separate product bundles with a fixed price.
Stock is managed through component products (combo_products → stock table).
"""
import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import ComboCreate, ComboUpdate

logger = logging.getLogger(__name__)
router = APIRouter()


def _auto_sku(tenant_id: str) -> str:
    res = supabase.table("combos").select("combo_id", count="exact") \
        .eq("tenant_id", tenant_id).execute()
    n = (res.count or 0) + 1
    return f"COMBO-{n:03d}"


def _enrich_products(combo_id: str, tenant_id: str) -> list:
    """Fetch combo_products joined with product info + stock."""
    prods = supabase.table("combo_products") \
        .select("id, product_id, quantity") \
        .eq("combo_id", combo_id).execute().data or []

    if not prods:
        return []

    product_ids = [p["product_id"] for p in prods]

    prod_data = supabase.table("products") \
        .select("product_id, sku, name, mrp, category") \
        .in_("product_id", product_ids).execute().data or []
    prod_map = {p["product_id"]: p for p in prod_data}

    stock_data = supabase.table("stock") \
        .select("product_id, current_stock, low_stock_threshold") \
        .eq("tenant_id", tenant_id) \
        .in_("product_id", product_ids).execute().data or []
    stock_map = {s["product_id"]: s for s in stock_data}

    result = []
    for cp in prods:
        pid  = cp["product_id"]
        info = prod_map.get(pid, {})
        stk  = stock_map.get(pid, {})
        result.append({
            "id":                  cp.get("id"),
            "combo_id":            combo_id,
            "product_id":          pid,
            "quantity":            cp["quantity"],
            "sku":                 info.get("sku", ""),
            "name":                info.get("name", ""),
            "mrp":                 info.get("mrp"),
            "category":            info.get("category"),
            "current_stock":       stk.get("current_stock", 0),
            "low_stock_threshold": stk.get("low_stock_threshold", 5),
        })
    return result


@router.get("/")
async def list_combos(tenant: dict = Depends(get_current_tenant)):
    tid    = tenant["tenant_id"]
    combos = supabase.table("combos").select("*") \
        .eq("tenant_id", tid).order("created_at", desc=True).execute().data or []
    for c in combos:
        c["products"] = _enrich_products(c["combo_id"], tid)
    return combos


@router.get("/{combo_id}")
async def get_combo(combo_id: str, tenant: dict = Depends(get_current_tenant)):
    tid   = tenant["tenant_id"]
    combo = supabase.table("combos").select("*") \
        .eq("tenant_id", tid).eq("combo_id", combo_id).maybe_single().execute().data
    if not combo:
        raise HTTPException(404, "Combo not found")
    combo["products"] = _enrich_products(combo_id, tid)
    return combo


@router.post("/", status_code=201)
async def create_combo(body: ComboCreate, tenant: dict = Depends(get_current_tenant)):
    tid      = tenant["tenant_id"]
    combo_id = str(uuid.uuid4())
    combo_sku = _auto_sku(tid)

    row = {
        "combo_id":    combo_id,
        "tenant_id":   tid,
        "combo_sku":   combo_sku,
        "name":        body.name,
        "description": body.description,
        "price":       body.price,
        "image_url":   body.image_url,
        "is_active":   True,
    }
    result = supabase.table("combos").insert(row).execute()
    combo  = result.data[0]

    if body.products:
        prod_rows = [
            {"combo_id": combo_id, "product_id": p.product_id, "quantity": p.quantity}
            for p in body.products
        ]
        supabase.table("combo_products").insert(prod_rows).execute()

    combo["products"] = _enrich_products(combo_id, tid)
    return combo


@router.patch("/{combo_id}")
async def update_combo(combo_id: str, body: ComboUpdate, tenant: dict = Depends(get_current_tenant)):
    tid         = tenant["tenant_id"]
    update_data = {k: v for k, v in body.model_dump().items() if v is not None and k != "products"}

    if update_data:
        result = supabase.table("combos").update(update_data) \
            .eq("tenant_id", tid).eq("combo_id", combo_id).execute()
        if not result.data:
            raise HTTPException(404, "Combo not found")

    if body.products is not None:
        supabase.table("combo_products").delete().eq("combo_id", combo_id).execute()
        if body.products:
            prod_rows = [
                {"combo_id": combo_id, "product_id": p.product_id, "quantity": p.quantity}
                for p in body.products
            ]
            supabase.table("combo_products").insert(prod_rows).execute()

    combo = supabase.table("combos").select("*") \
        .eq("tenant_id", tid).eq("combo_id", combo_id).maybe_single().execute().data
    if not combo:
        raise HTTPException(404, "Combo not found")
    combo["products"] = _enrich_products(combo_id, tid)
    return combo


@router.delete("/{combo_id}", status_code=204)
async def delete_combo(combo_id: str, tenant: dict = Depends(get_current_tenant)):
    supabase.table("combos").delete() \
        .eq("tenant_id", tenant["tenant_id"]).eq("combo_id", combo_id).execute()
    return None
