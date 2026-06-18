"""
OmniBot SaaS — Stock Management Router
Reads and writes from the dedicated `stock` table.
"""
import csv
import io
import logging
from collections import defaultdict
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
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


def _log_movement(tenant_id: str, product_id: str, movement_type: str,
                   quantity: int, physical_before: int, physical_after: int,
                   issued_before: int, issued_after: int, note: str = None):
    try:
        supabase.table("stock_movements").insert({
            "tenant_id":       tenant_id,
            "product_id":      product_id,
            "order_id":        None,
            "movement_type":   movement_type,
            "quantity":        quantity,
            "physical_before": physical_before,
            "physical_after":  physical_after,
            "issued_before":   issued_before,
            "issued_after":    issued_after,
            "note":            note,
        }).execute()
    except Exception as e:
        logger.warning(f"stock_movements insert failed: {e}")


def _compute_available(row: dict) -> int:
    phys   = int(row.get("physical_stock") or 0)
    issued = int(row.get("issued_stock") or 0)
    if phys > 0 or issued > 0:
        return max(0, phys - issued)
    return int(row.get("current_stock") or 0)


@router.get("/")
async def list_stock(tenant: dict = Depends(get_current_tenant)):
    """All active products with current stock levels from the stock table."""
    tid = tenant["tenant_id"]

    products_res = (
        supabase.table("products")
        .select("product_id, sku, name, category, mrp, is_active, extra_fields")
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
        .select("product_id, current_stock, physical_stock, issued_stock, low_stock_threshold")
        .eq("tenant_id", tid)
        .in_("product_id", pids)
        .execute()
    )
    stock_map = {s["product_id"]: s for s in (stock_res.data or [])}
    default_threshold = _get_tenant_threshold(tid)

    for p in products:
        s         = stock_map.get(p["product_id"], {})
        phys      = int(s.get("physical_stock") or 0)
        issued    = int(s.get("issued_stock") or 0)
        available = _compute_available(s)

        # Fallback: if stock table has no data, check extra_fields.stock
        # (products imported via CSV with a "stock" column land here)
        if available == 0 and phys == 0 and issued == 0:
            ef_stock = (p.get("extra_fields") or {}).get("stock")
            if ef_stock is not None:
                try:
                    available = int(float(str(ef_stock)))
                    phys      = available
                except (ValueError, TypeError):
                    pass

        threshold = s.get("low_stock_threshold") or default_threshold

        p["stock"]          = available
        p["physical_stock"] = phys
        p["issued_stock"]   = issued
        p["available"]      = available
        p["low_stock"]      = 0 < available <= threshold
        p["out_of_stock"]   = available == 0
        p.pop("extra_fields", None)  # don't send to frontend

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
        .select("current_stock, physical_stock, issued_stock")
        .eq("tenant_id", tid)
        .eq("product_id", body.product_id)
        .maybe_single()
        .execute().data
    ) or {}

    phys_before   = int(stock_row.get("physical_stock") or 0)
    issued        = int(stock_row.get("issued_stock") or 0)
    cur_before    = int(stock_row.get("current_stock") or 0)
    new_physical  = body.quantity
    new_model     = (phys_before > 0 or issued > 0)

    if new_model:
        new_cur = max(0, new_physical - issued)
        upsert_data = {
            "tenant_id":      tid,
            "product_id":     body.product_id,
            "physical_stock": new_physical,
            "current_stock":  new_cur,
        }
        movement_type = "manual_add" if new_physical >= phys_before else "manual_remove"
        _log_movement(tid, body.product_id, movement_type,
                      abs(new_physical - phys_before),
                      phys_before, new_physical, issued, issued, note=body.note)
    else:
        new_cur = new_physical
        upsert_data = {
            "tenant_id":     tid,
            "product_id":    body.product_id,
            "current_stock": new_cur,
        }

    supabase.table("stock").upsert(upsert_data, on_conflict="tenant_id,product_id").execute()

    _log_stock_change(
        tid, body.product_id, product["sku"],
        "manual", new_cur - cur_before, cur_before, new_cur,
        note=body.note,
    )
    return {"product_id": body.product_id, "sku": product["sku"], "stock": new_cur}


@router.get("/report")
async def stock_report(
    from_date: str = Query(None),
    to_date:   str = Query(None),
    product_id: str = Query(None),
    tenant: dict = Depends(get_current_tenant),
):
    """Per-product stock movement summary for a date range."""
    tid = tenant["tenant_id"]

    q = (
        supabase.table("stock_movements")
        .select("*")
        .eq("tenant_id", tid)
        .order("created_at", desc=False)
    )
    if from_date:
        q = q.gte("created_at", from_date)
    if to_date:
        q = q.lte("created_at", to_date + "T23:59:59Z" if len(to_date) == 10 else to_date)
    if product_id:
        q = q.eq("product_id", product_id)

    movements = q.execute().data or []

    if not movements:
        return []

    groups: dict[str, list] = defaultdict(list)
    for m in movements:
        groups[m["product_id"]].append(m)

    all_pids = list(groups.keys())
    prods_res = (
        supabase.table("products")
        .select("product_id, sku, name")
        .eq("tenant_id", tid)
        .in_("product_id", all_pids)
        .execute()
    )
    prod_map = {p["product_id"]: p for p in (prods_res.data or [])}

    stock_res = (
        supabase.table("stock")
        .select("product_id, current_stock, physical_stock, issued_stock")
        .eq("tenant_id", tid)
        .in_("product_id", all_pids)
        .execute()
    )
    stock_map = {s["product_id"]: s for s in (stock_res.data or [])}

    rows = []
    for pid, ms in groups.items():
        prod = prod_map.get(pid, {})
        st   = stock_map.get(pid, {})

        issued_ms = [m for m in ms if m["movement_type"] == "issue"]
        ship_ms   = [m for m in ms if m["movement_type"] == "ship"]
        ret_ms    = [m for m in ms if m["movement_type"] == "return"]

        qty_issued  = sum(m["quantity"] for m in issued_ms)
        qty_shipped = sum(m["quantity"] for m in ship_ms)
        qty_returns = sum(m["quantity"] for m in ret_ms)
        orders_count = len({m["order_id"] for m in issued_ms if m.get("order_id")})

        sorted_ms     = sorted(ms, key=lambda m: m["created_at"])
        opening_stock = sorted_ms[0].get("physical_before") if sorted_ms else None
        closing_stock = sorted_ms[-1].get("physical_after") if sorted_ms else None

        current_phys = int(st.get("physical_stock") or st.get("current_stock") or 0)
        if opening_stock is None:
            opening_stock = current_phys
        if closing_stock is None:
            closing_stock = current_phys

        rows.append({
            "product_id":    pid,
            "product_name":  prod.get("name", ""),
            "sku":           prod.get("sku", ""),
            "orders_count":  orders_count,
            "qty_issued":    qty_issued,
            "qty_shipped":   qty_shipped,
            "qty_returns":   qty_returns,
            "opening_stock": opening_stock,
            "closing_stock": closing_stock,
        })

    rows.sort(key=lambda r: r["product_name"])
    return rows


@router.post("/import/csv")
async def import_stock_csv(
    tenant: dict = Depends(get_current_tenant),
    file:   UploadFile = File(...),
):
    """
    Bulk-update stock from CSV.
    Required columns: sku, current_stock
    Optional column:  low_stock_threshold
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted")

    tid = tenant["tenant_id"]
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV file must be under 5 MB")

    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("latin-1")

    clean_lines = [
        line for line in content.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not clean_lines:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    reader  = csv.DictReader(io.StringIO("\n".join(clean_lines)))
    headers = [h.strip().lower() for h in (reader.fieldnames or [])]
    if "sku" not in headers or "current_stock" not in headers:
        raise HTTPException(
            status_code=422,
            detail="CSV must have columns: sku, current_stock  (low_stock_threshold optional)",
        )
    reader.fieldnames = headers

    sku_res = (
        supabase.table("products")
        .select("product_id, sku")
        .eq("tenant_id", tid)
        .eq("is_active", True)
        .execute()
    )
    sku_map: dict[str, str] = {
        row["sku"]: row["product_id"]
        for row in (sku_res.data or [])
    }

    imported = 0
    skipped  = 0
    errors   = 0
    warnings: list[dict] = []

    for row_num, raw_row in enumerate(list(reader), start=2):
        row = {k.strip().lower(): (v.strip() if v else "") for k, v in raw_row.items() if k}

        sku = row.get("sku", "")
        if not sku:
            skipped += 1
            warnings.append({"row": row_num, "message": "Skipped — missing SKU"})
            continue

        product_id = sku_map.get(sku)
        if not product_id:
            skipped += 1
            warnings.append({"row": row_num, "message": f"Skipped — SKU '{sku}' not found"})
            continue

        stock_val = row.get("current_stock", "")
        if not stock_val:
            skipped += 1
            warnings.append({"row": row_num, "message": f"Skipped — missing current_stock for SKU '{sku}'"})
            continue

        try:
            new_stock = int(float(stock_val))
        except ValueError:
            skipped += 1
            warnings.append({"row": row_num, "message": f"Skipped — invalid current_stock '{stock_val}'"})
            continue

        try:
            before_res = (
                supabase.table("stock")
                .select("current_stock, physical_stock, issued_stock")
                .eq("tenant_id", tid)
                .eq("product_id", product_id)
                .maybe_single()
                .execute()
            )
            sr     = (before_res.data or {}) if before_res else {}
            before = int(sr.get("current_stock") or 0)
            phys   = int(sr.get("physical_stock") or 0)
            issued = int(sr.get("issued_stock") or 0)

            upsert_data: dict = {"tenant_id": tid, "product_id": product_id}

            if phys > 0 or issued > 0:
                new_cur = max(0, new_stock - issued)
                upsert_data["physical_stock"] = new_stock
                upsert_data["current_stock"]  = new_cur
            else:
                new_cur = new_stock
                upsert_data["current_stock"] = new_cur

            threshold_val = row.get("low_stock_threshold", "")
            if threshold_val:
                try:
                    upsert_data["low_stock_threshold"] = int(float(threshold_val))
                except ValueError:
                    warnings.append({
                        "row": row_num,
                        "message": f"low_stock_threshold '{threshold_val}' invalid — ignored",
                    })

            supabase.table("stock").upsert(upsert_data, on_conflict="tenant_id,product_id").execute()

            _log_stock_change(
                tid, product_id, sku,
                "import", new_cur - before, before, new_cur,
                note="CSV bulk import",
            )
            imported += 1

        except Exception as exc:
            errors += 1
            logger.warning(f"Stock CSV import row {row_num} error: {exc}")
            warnings.append({"row": row_num, "message": f"Error — {str(exc)}"})

    return {
        "imported":   imported,
        "skipped":    skipped,
        "errors":     errors,
        "total_rows": imported + skipped + errors,
        "warnings":   warnings,
    }


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
        .select("product_id, current_stock, physical_stock, issued_stock, low_stock_threshold")
        .eq("tenant_id", tid)
        .execute()
    )
    all_stock = stock_res.data or []

    low = []
    for s in all_stock:
        avail     = _compute_available(s)
        threshold = s.get("low_stock_threshold") or 10
        if avail <= threshold:
            low.append({**s, "_available": avail})

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
            "stock":               s["_available"],
            "low_stock_threshold": s.get("low_stock_threshold", 10),
        })

    return {"alerts": alerts, "threshold": _get_tenant_threshold(tid), "count": len(alerts)}


@router.patch("/threshold")
async def set_threshold(body: LowStockThreshold, tenant: dict = Depends(get_current_tenant)):
    supabase.table("tenants").update({"low_stock_threshold": body.threshold}) \
        .eq("tenant_id", tenant["tenant_id"]).execute()
    return {"threshold": body.threshold}
