"""
OmniBot SaaS — Products Router
Full CRUD + CSV import/export + custom column management.
Every write triggers a RAG re-sync so the knowledge base stays fresh.

Endpoints (static routes FIRST, parameterized routes LAST):
  GET    /                         list products (with current_stock from stock table)
  POST   /                         create product + auto-create stock row
  GET    /custom-columns           list tenant's custom column definitions
  POST   /custom-columns           add a custom column definition
  DELETE /custom-columns/{name}    remove a custom column definition
  GET    /templates/{type}         download CSV template (products|stock)
  POST   /import/csv               bulk import via CSV upload
  GET    /import/history           last 10 import logs
  GET    /{product_id}             get single product
  PATCH  /{product_id}             update product
  DELETE /{product_id}             soft-delete product
"""
import csv
import io
import uuid
import logging
from typing import Optional

from fastapi import (
    APIRouter, BackgroundTasks, Depends,
    Form, HTTPException, UploadFile, File
)
from fastapi.responses import StreamingResponse

from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.models.schemas import (
    ProductCreate, ProductUpdate,
    CustomColumnCreate, CSVImportResponse,
)
from app.services.rag_service import RAGService
from app.services.cloudinary_service import upload_product_image

logger = logging.getLogger(__name__)
router = APIRouter()
rag    = RAGService()

# ── Constants ─────────────────────────────────────────────────────────────────

_SKIP_COLS: set[str] = {
    "product_id", "tenant_id", "is_active",
    "created_at", "updated_at",
}

_KNOWN_COLS: set[str] = {
    "sku", "name", "mrp", "weight", "category", "image_url",
}

_REQUIRED_COLS: dict[str, list[str]] = {
    "products": ["sku", "name", "mrp"],
    "stock":    ["sku"],
}

_ALLOWED_COLS: dict[str, set[str]] = {
    "products": _KNOWN_COLS,
    "stock":    {"sku", "stock"},
}


def _upsert_stock(tenant_id: str, product_id: str, current_stock: int) -> None:
    """Insert or update the stock row for a product."""
    supabase.table("stock").upsert(
        {
            "tenant_id":     tenant_id,
            "product_id":    product_id,
            "current_stock": current_stock,
        },
        on_conflict="tenant_id,product_id",
    ).execute()


# ─────────────────────────────────────────────────────────────────────────────
#  List all products  (joins stock for current_stock)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/")
async def list_products(tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    result = (
        supabase.table("products")
        .select("*")
        .eq("tenant_id", tid)
        .order("created_at", desc=True)
        .execute()
    )
    products = result.data or []

    if products:
        pids = [p["product_id"] for p in products]
        stock_res = (
            supabase.table("stock")
            .select("product_id, current_stock")
            .eq("tenant_id", tid)
            .in_("product_id", pids)
            .execute()
        )
        stock_map = {s["product_id"]: s["current_stock"] for s in (stock_res.data or [])}
        for p in products:
            p["current_stock"] = stock_map.get(p["product_id"], 0)

    return products


# ─────────────────────────────────────────────────────────────────────────────
#  Create a single product  (auto-creates stock row)
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/", status_code=201)
async def create_product(
    body: ProductCreate,
    background_tasks: BackgroundTasks,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]

    if tenant["plan"] == "starter":
        count_res = (
            supabase.table("products")
            .select("product_id", count="exact")
            .eq("tenant_id", tid)
            .eq("is_active", True)
            .execute()
        )
        if (count_res.count or 0) >= 500:
            raise HTTPException(status_code=403, detail="Starter plan limit: 500 products")

    existing = (
        supabase.table("products")
        .select("product_id")
        .eq("tenant_id", tid)
        .eq("sku", body.sku)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        raise HTTPException(status_code=409, detail=f"SKU '{body.sku}' already exists")

    product_id = str(uuid.uuid4())
    row = {
        "product_id":   product_id,
        "tenant_id":    tid,
        "sku":          body.sku,
        "name":         body.name,
        "mrp":          body.mrp,
        "weight":       body.weight,
        "category":     body.category,
        "image_url":    body.image_url,
        "extra_fields": body.extra_fields or {},
        "is_active":    True,
    }
    result = supabase.table("products").insert(row).execute()
    product = result.data[0]

    # Auto-create stock row
    _upsert_stock(tid, product_id, body.initial_stock or 0)
    product["current_stock"] = body.initial_stock or 0

    background_tasks.add_task(rag.sync_products_to_rag, tid)
    return product


# ─────────────────────────────────────────────────────────────────────────────
#  Custom column definitions
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/custom-columns")
async def list_custom_columns(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("product_custom_columns")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("sort_order")
        .execute()
    )
    return result.data or []


@router.post("/custom-columns", status_code=201)
async def create_custom_column(
    body: CustomColumnCreate,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]

    if body.column_name in _KNOWN_COLS | _SKIP_COLS:
        raise HTTPException(
            status_code=400,
            detail=f"'{body.column_name}' is a reserved column name"
        )

    count_res = (
        supabase.table("product_custom_columns")
        .select("id", count="exact")
        .eq("tenant_id", tid)
        .execute()
    )
    if (count_res.count or 0) >= 20:
        raise HTTPException(status_code=400, detail="Maximum 20 custom columns allowed")

    result = (
        supabase.table("product_custom_columns")
        .insert({
            "tenant_id":    tid,
            "column_name":  body.column_name,
            "display_name": body.display_name,
            "column_type":  body.column_type,
            "is_required":  body.is_required,
            "sort_order":   body.sort_order,
        })
        .execute()
    )
    return result.data[0]


@router.delete("/custom-columns/{column_name}", status_code=204)
async def delete_custom_column(
    column_name: str,
    tenant: dict = Depends(get_current_tenant),
):
    supabase.table("product_custom_columns").delete() \
        .eq("tenant_id", tenant["tenant_id"]) \
        .eq("column_name", column_name) \
        .execute()
    return None


# ─────────────────────────────────────────────────────────────────────────────
#  CSV Template downloads
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/templates/{template_type}")
async def download_template(
    template_type: str,
    tenant: dict = Depends(get_current_tenant),
):
    if template_type not in ("products", "stock", "combo"):
        raise HTTPException(status_code=400, detail="template_type must be: products | stock | combo")

    if template_type == "combo":
        output = io.StringIO()
        writer = csv.writer(output)
        for line in [
            "# COMBO STOCK UPDATE TEMPLATE",
            "# combo_sku: Combo-এর SKU (required)",
            "# stock: নতুন stock পরিমাণ (required)",
            "#",
        ]:
            writer.writerow([line])
        writer.writerow(["combo_sku", "stock"])
        writer.writerow(["CMB-ABC123", "10"])
        return StreamingResponse(
            io.StringIO(output.getvalue()),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="combo-template.csv"'},
        )

    tid = tenant["tenant_id"]
    custom_cols_res = (
        supabase.table("product_custom_columns")
        .select("column_name, display_name")
        .eq("tenant_id", tid)
        .order("sort_order")
        .execute()
    )
    custom_cols = custom_cols_res.data or []

    if template_type == "products":
        headers = ["sku", "name", "mrp", "category", "weight", "image_url"]
        headers += [c["column_name"] for c in custom_cols]
        example  = ["SKU001", "Sample Product", "500", "Electronics", "500 গ্রাম", "https://example.com/image.jpg"]
        example += ["" for _ in custom_cols]
        instructions = [
            "# PRODUCT IMPORT TEMPLATE | পণ্য আমদানি টেমপ্লেট",
            "# Required columns | আবশ্যক কলাম: sku, name, mrp",
            "# sku: পণ্যের অনন্য কোড | Unique product code",
            "# name: পণ্যের নাম | Product name",
            "# mrp: সর্বোচ্চ খুচরা মূল্য | Maximum retail price (must be > 0)",
            "# category: পণ্য বিভাগ (ঐচ্ছিক) | Product category (optional)",
            "# weight: পরিমাণ/ওজন যেমন '500 গ্রাম', '১ কেজি' (ঐচ্ছিক) | Weight/volume (optional)",
            "# image_url: পণ্যের ছবির লিঙ্ক (ঐচ্ছিক) | Product image URL (optional)",
            "# Stock is managed separately from /dashboard/stock",
            "# If SKU already exists, the row will UPDATE that product | SKU থাকলে পণ্য আপডেট হবে",
            "#",
        ]
    else:  # stock
        headers = ["sku", "stock"]
        example  = ["SKU001", "25"]
        instructions = [
            "# STOCK UPDATE TEMPLATE",
            "# Required: sku",
            "# Updates current_stock in the stock table for matching SKUs",
            "#",
        ]

    output = io.StringIO()
    writer = csv.writer(output)
    for line in instructions:
        writer.writerow([line])
    writer.writerow(headers)
    writer.writerow(example)
    csv_content = output.getvalue()

    filename = f"{template_type}-template.csv"
    return StreamingResponse(
        io.StringIO(csv_content),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
#  CSV Import
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/import/csv", response_model=CSVImportResponse)
async def import_csv(
    background_tasks: BackgroundTasks,
    tenant: dict = Depends(get_current_tenant),
    file: UploadFile = File(...),
    import_type: str = Form(default="products"),
):
    """
    Bulk import via CSV upload.

    import_type = products  → upsert products; stock column writes to stock table
    import_type = stock     → update current_stock in stock table for existing SKUs
    """
    if import_type not in ("products", "stock"):
        raise HTTPException(
            status_code=400,
            detail="import_type must be: products | stock"
        )

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted")

    tid = tenant["tenant_id"]

    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV file must be under 5 MB")

    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            content = raw.decode("latin-1")
        except Exception:
            raise HTTPException(status_code=400, detail="Could not decode CSV (use UTF-8 encoding)")

    clean_lines = [
        line for line in content.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not clean_lines:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    reader = csv.DictReader(io.StringIO("\n".join(clean_lines)))
    headers: list[str] = [h.strip().lower() for h in (reader.fieldnames or [])]
    if not headers:
        raise HTTPException(status_code=400, detail="CSV has no headers")
    reader.fieldnames = headers

    required = _REQUIRED_COLS[import_type]
    missing_required = [r for r in required if r not in headers]
    if missing_required:
        raise HTTPException(
            status_code=422,
            detail=f"CSV is missing required columns: {', '.join(missing_required)}"
        )

    # Pre-fetch existing SKU → product_id map
    existing_res = (
        supabase.table("products")
        .select("product_id, sku")
        .eq("tenant_id", tid)
        .execute()
    )
    existing_map: dict[str, str] = {
        row["sku"]: row["product_id"]
        for row in (existing_res.data or [])
    }

    imported = 0
    skipped  = 0
    errors   = 0
    warnings: list[dict] = []

    for row_num, raw_row in enumerate(list(reader), start=2):
        row = {k.strip().lower(): (v.strip() if v else "") for k, v in raw_row.items() if k}

        missing = [col for col in required if not row.get(col)]
        if missing:
            skipped += 1
            warnings.append({"row": row_num, "message": f"Skipped — missing: {', '.join(missing)}"})
            continue

        sku = row["sku"]
        exists_id = existing_map.get(sku)

        try:
            # ── STOCK update mode ─────────────────────────────────────────
            if import_type == "stock":
                if not exists_id:
                    skipped += 1
                    warnings.append({"row": row_num, "message": f"Skipped — SKU '{sku}' not found"})
                    continue

                stock_val = row.get("stock", "")
                if not stock_val:
                    skipped += 1
                    warnings.append({"row": row_num, "message": f"Skipped — missing stock for SKU '{sku}'"})
                    continue

                try:
                    stock_int = int(float(stock_val))
                except ValueError:
                    skipped += 1
                    warnings.append({"row": row_num, "message": f"Skipped — invalid stock '{stock_val}'"})
                    continue

                _upsert_stock(tid, exists_id, stock_int)
                imported += 1
                continue

            # ── PRODUCTS upsert mode ──────────────────────────────────────
            try:
                mrp_val = float(row["mrp"])
                if mrp_val <= 0:
                    raise ValueError("MRP must be > 0")
            except ValueError as e:
                skipped += 1
                warnings.append({"row": row_num, "message": f"Skipped — invalid mrp: {e}"})
                continue

            product_data: dict = {
                "sku":  sku,
                "name": row["name"],
                "mrp":  mrp_val,
            }

            if "category" in headers and row.get("category"):
                product_data["category"] = row["category"]
            if "weight" in headers and row.get("weight"):
                product_data["weight"] = row["weight"]
            if "image_url" in headers and row.get("image_url"):
                product_data["image_url"] = row["image_url"]

            # Custom columns → extra_fields JSONB
            extra_fields: dict = {}
            for col in headers:
                if col in _SKIP_COLS or col in _KNOWN_COLS:
                    continue
                if row.get(col):
                    extra_fields[col] = row[col]
            if extra_fields:
                product_data["extra_fields"] = extra_fields

            if exists_id:
                update_payload = {k: v for k, v in product_data.items() if k != "sku"}
                supabase.table("products").update(update_payload) \
                    .eq("tenant_id", tid).eq("product_id", exists_id).execute()
            else:
                pid = str(uuid.uuid4())
                product_data["product_id"] = pid
                product_data["tenant_id"]  = tid
                supabase.table("products").insert(product_data).execute()
                existing_map[sku] = pid

            imported += 1

        except Exception as exc:
            errors += 1
            logger.warning(f"CSV import row {row_num} error: {exc}")
            warnings.append({"row": row_num, "message": f"Error — {str(exc)}"})

    total_rows = imported + skipped + errors

    log_res = supabase.table("csv_import_logs").insert({
        "tenant_id":    tid,
        "import_type":  import_type,
        "filename":     file.filename,
        "total_rows":   total_rows,
        "imported":     imported,
        "skipped":      skipped,
        "errors":       errors,
        "error_details": warnings,
    }).execute()
    log_id = log_res.data[0]["id"] if log_res.data else ""

    if imported > 0:
        background_tasks.add_task(rag.sync_products_to_rag, tid)

    return {
        "imported":   imported,
        "skipped":    skipped,
        "errors":     errors,
        "total_rows": total_rows,
        "warnings":   warnings,
        "log_id":     log_id,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Import history
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/import/history")
async def import_history(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("csv_import_logs")
        .select("id, import_type, filename, total_rows, imported, skipped, errors, created_at")
        .eq("tenant_id", tenant["tenant_id"])
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )
    return result.data or []


# ─────────────────────────────────────────────────────────────────────────────
#  Image Upload  (Cloudinary)   ← BEFORE parameterised /{product_id}
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/upload-image")
async def upload_image(
    tenant:     dict = Depends(get_current_tenant),
    file:       UploadFile = File(...),
    product_id: str  = Form(default=""),
):
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, or GIF images are accepted")

    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be under 5 MB")

    tid = tenant["tenant_id"]
    try:
        image_url = upload_product_image(raw, file.filename or "product.jpg", tid)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if product_id:
        supabase.table("products") \
            .update({"image_url": image_url}) \
            .eq("tenant_id", tid) \
            .eq("product_id", product_id) \
            .execute()

    return {"image_url": image_url}


# ─────────────────────────────────────────────────────────────────────────────
#  Single product operations  (KEEP LAST — parameterised routes)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/{product_id}")
async def get_product(product_id: str, tenant: dict = Depends(get_current_tenant)):
    tid = tenant["tenant_id"]
    result = (
        supabase.table("products")
        .select("*")
        .eq("tenant_id", tid)
        .eq("product_id", product_id)
        .maybe_single()
        .execute()
    )
    if result is None or result.data is None:
        raise HTTPException(status_code=404, detail="Product not found")
    product = result.data
    stock_res = (
        supabase.table("stock")
        .select("current_stock")
        .eq("tenant_id", tid)
        .eq("product_id", product_id)
        .maybe_single()
        .execute()
    )
    product["current_stock"] = (stock_res.data or {}).get("current_stock", 0) if stock_res else 0
    return product


@router.patch("/{product_id}")
async def update_product(
    product_id: str,
    body: ProductUpdate,
    background_tasks: BackgroundTasks,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]

    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "sku" in update_data:
        conflict = (
            supabase.table("products")
            .select("product_id")
            .eq("tenant_id", tid)
            .eq("sku", update_data["sku"])
            .maybe_single()
            .execute()
        )
        if conflict and conflict.data and conflict.data["product_id"] != product_id:
            raise HTTPException(status_code=409, detail=f"SKU '{update_data['sku']}' already in use")

    result = (
        supabase.table("products")
        .update(update_data)
        .eq("tenant_id", tid)
        .eq("product_id", product_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Product not found")

    background_tasks.add_task(rag.sync_products_to_rag, tid)
    return result.data[0]


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: str,
    background_tasks: BackgroundTasks,
    tenant: dict = Depends(get_current_tenant),
):
    supabase.table("products").update({"is_active": False}) \
        .eq("tenant_id", tenant["tenant_id"]) \
        .eq("product_id", product_id) \
        .execute()

    background_tasks.add_task(rag.sync_products_to_rag, tenant["tenant_id"])
    return None
