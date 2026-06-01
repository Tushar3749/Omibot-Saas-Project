"""
OmniBot SaaS — Stock Management Router
Reads and writes from the dedicated `stock` table.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import StockManualUpdate, LowStockThreshold

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_tenant_threshold(tenant_id: str) -> int:
    try:
        res = supabase.table("tenants").select("low_stock_threshold").eq("tenant_id", tenant_id).maybe_single().execute()
        if res and res.data:
            return res.data.get("low_stock_threshold") or 10
    except Exception:
        pass
    return 10


def _log_stock_change(tenant_id: str, product_id: str, sku: str, change_type: str,
                       quantity_change: int, before: int, after: int,
                       reference_id: str = None, note: str = None):
    supabase.table("stock_history").insert({
        "tenant_id":       tenant_id,
        "product_id":      product_id,
        "sku":             sku,
        "change_type":     change_type,
        "quantity_change": quantity_change,
        "quantity_before": before,
        "quantity_after":  after,
        "reference_id":    reference_id,
        "note":            note,
    }).execute()


@router.get("/")
async def list_stock(tenant: dict = Depends(get_current_tenant)):
    """All active products with current stock levels from the stock table."""
    tid = tenant["tenant_id"]

    products_res = (
        supabase.table("products")
        .select("product_id, sku, name, category, mrp, is_active")
        .eq("tenant_id", tid)
        .eq("is_active", True)
        .order("name")
        .execute()
    )
    products = products_res.data or []

    if not products:
        return {"products": [], "threshold": _get_tenant_threshold(tid)}

    pids = [p["product_id"] for p in products]
    stock_res = (
        supabase.table("stock")
        .select("product_id, current_stock, low_stock_threshold")
        .eq("tenant_id", tid)
        .in_("product_id", pids)
        .execute()
    )
    stock_map = {s["product_id"]: s for s in (stock_res.data or [])}
    default_threshold = _get_tenant_threshold(tid)

    for p in products:
        s = stock_map.get(p["product_id"], {})
        stock_val = s.get("current_stock", 0)
        threshold = s.get("low_stock_threshold", default_threshold)
        p["stock"] = stock_val
        p["low_stock"]    = 0 < stock_val <= threshold
        p["out_of_stock"] = stock_val == 0

    return {"products": products, "threshold": default_threshold}


@router.patch("/update")
async def update_stock(body: StockManualUpdate, tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]

    product = (
        supabase.table("products")
        .select("product_id, sku")
        .eq("tenant_id", tid)
        .eq("product_id", body.product_id)
        .maybe_single()
        .execute().data
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    stock_row = (
        supabase.table("stock")
        .select("current_stock")
        .eq("tenant_id", tid)
        .eq("product_id", body.product_id)
        .maybe_single()
        .execute().data
    )
    before = (stock_row or {}).get("current_stock", 0)
    after  = body.quantity

    supabase.table("stock").upsert(
        {"tenant_id": tid, "product_id": body.product_id, "current_stock": after},
        on_conflict="tenant_id,product_id",
    ).execute()

    _log_stock_change(
        tid, body.product_id, product["sku"],
        "manual", after - before, before, after,
        note=body.note,
    )
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
    tid = tenant["tenant_id"]

    stock_res = (
        supabase.table("stock")
        .select("product_id, current_stock, low_stock_threshold")
        .eq("tenant_id", tid)
        .execute()
    )
    all_stock = stock_res.data or []
    low = [s for s in all_stock if s["current_stock"] <= s.get("low_stock_threshold", 10)]

    if not low:
        return {"alerts": [], "threshold": _get_tenant_threshold(tid), "count": 0}

    pids = [s["product_id"] for s in low]
    prods = (
        supabase.table("products")
        .select("product_id, sku, name, category")
        .eq("tenant_id", tid)
        .in_("product_id", pids)
        .execute().data or []
    )
    prod_map = {p["product_id"]: p for p in prods}

    alerts = []
    for s in low:
        p = prod_map.get(s["product_id"], {})
        alerts.append({
            **p,
            "stock":             s["current_stock"],
            "low_stock_threshold": s.get("low_stock_threshold", 10),
        })

    return {"alerts": alerts, "threshold": _get_tenant_threshold(tid), "count": len(alerts)}


@router.patch("/threshold")
async def set_threshold(body: LowStockThreshold, tenant: dict = Depends(get_current_tenant)):
    supabase.table("tenants").update({"low_stock_threshold": body.threshold}) \
        .eq("tenant_id", tenant["tenant_id"]).execute()
    return {"threshold": body.threshold}
