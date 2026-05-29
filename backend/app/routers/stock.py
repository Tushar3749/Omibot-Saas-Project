"""
OmniBot SaaS — Stock Management Router
View, update, and track stock levels + history.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import StockManualUpdate, LowStockThreshold

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_threshold(tenant_id: str) -> int:
    try:
        res = supabase.table("tenants").select("low_stock_threshold").eq("tenant_id", tenant_id).maybe_single().execute()
        if res and res.data:
            return res.data.get("low_stock_threshold") or 5
    except Exception:
        pass
    return 5


def _log_stock_change(tenant_id: str, product_id: str, sku: str, change_type: str,
                       quantity_change: int, before: int, after: int,
                       reference_id: str = None, note: str = None):
    supabase.table("stock_history").insert({
        "tenant_id": tenant_id, "product_id": product_id, "sku": sku,
        "change_type": change_type, "quantity_change": quantity_change,
        "quantity_before": before, "quantity_after": after,
        "reference_id": reference_id, "note": note,
    }).execute()


@router.get("/")
async def list_stock(tenant: dict = Depends(get_current_tenant)):
    """All products with current stock levels."""
    products = (
        supabase.table("products")
        .select("product_id,sku,name,stock,category,mrp,is_active")
        .eq("tenant_id", tenant["tenant_id"])
        .eq("is_active", True)
        .order("name")
        .execute().data or []
    )
    threshold = _get_threshold(tenant["tenant_id"])
    for p in products:
        stock_val = p.get("stock") or 0
        p["low_stock"] = stock_val <= threshold
        p["out_of_stock"] = stock_val == 0
    return {"products": products, "threshold": threshold}


@router.patch("/update")
async def update_stock(body: StockManualUpdate, tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    product = (
        supabase.table("products")
        .select("product_id,sku,stock")
        .eq("tenant_id", tid)
        .eq("product_id", body.product_id)
        .maybe_single()
        .execute().data
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    before = product.get("stock") or 0
    after = body.quantity
    supabase.table("products").update({"stock": after}).eq("product_id", body.product_id).execute()
    _log_stock_change(tid, body.product_id, product["sku"], "manual", after - before, before, after, note=body.note)
    return {"product_id": body.product_id, "sku": product["sku"], "stock": after}


@router.get("/history")
async def stock_history(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("stock_history")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    return result.data or []


@router.get("/alerts")
async def low_stock_alerts(tenant: dict = Depends(get_current_tenant)):
    threshold = _get_threshold(tenant["tenant_id"])
    products = (
        supabase.table("products")
        .select("product_id,sku,name,stock,category")
        .eq("tenant_id", tenant["tenant_id"])
        .eq("is_active", True)
        .lte("stock", threshold)
        .execute().data or []
    )
    return {"alerts": products, "threshold": threshold, "count": len(products)}


@router.patch("/threshold")
async def set_threshold(body: LowStockThreshold, tenant: dict = Depends(get_current_tenant)):
    supabase.table("tenants").update({"low_stock_threshold": body.threshold}).eq("tenant_id", tenant["tenant_id"]).execute()
    return {"threshold": body.threshold}
