"""
OmniBot SaaS — Products Router
Full CRUD + CSV import/export + custom column management.
Every write triggers a RAG re-sync so the knowledge base stays fresh.

Endpoints (static routes FIRST, parameterized routes LAST):
  GET    /                         list products
  POST   /                         create product
  GET    /custom-columns           list tenant's custom column definitions
  POST   /custom-columns           add a custom column definition
  DELETE /custom-columns/{name}    remove a custom column definition
  GET    /templates/{type}         download CSV template (products|stock|campaign)
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

# Columns that must NEVER be imported from CSV (PK / FK / system fields)
_SKIP_COLS: set[str] = {
    "product_id", "tenant_id", "is_active",
    "created_at", "updated_at",
}

# Named columns that map directly to DB table columns
_KNOWN_COLS: set[str] = {
    "sku", "name", "mrp",
    "discount_price", "discount_category",
    "stock", "category", "image_url",
}

# Required columns per import type
_REQUIRED_COLS: dict[str, list[str]] = {
    "products": ["sku", "name", "mrp"],
    "stock":    ["sku"],
    "campaign": ["sku"],
}

# Which DB columns each import type may touch
_ALLOWED_COLS: dict[str, set[str]] = {
    "products": _KNOWN_COLS,
    "stock":    {"sku", "stock"},
    "campaign": {"sku", "discount_price", "discount_category"},
}


# ─────────────────────────────────────────────────────────────────────────────
#  List all products
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/")
async def list_products(tenant: dict = Depends(get_current_tenant)):
    result = (
        supabase.table("products")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


# ─────────────────────────────────────────────────────────────────────────────
#  Create a single product
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/", status_code=201)
async def create_product(
    body: ProductCreate,
    background_tasks: BackgroundTasks,
    tenant: dict = Depends(get_current_tenant),
):
    tid = tenant["tenant_id"]

    # Plan limit check
    if tenant["plan"] == "starter":
        count_res = (
            supabase.table("products")
            .select("product_id", count="exact")
            .eq("tenant_id", tid)
            .eq("is_active", True)
            .execute()
        )
        if (count_res.count or 0) >= 500:
            raise HTTPException(status_code=402, detail="Starter plan limit: 500 products")

    # Check SKU uniqueness
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

    row = {
        "product_id":        str(uuid.uuid4()),
        "tenant_id":         tid,
        "sku":               body.sku,
        "name":              body.name,
        "mrp":               body.mrp,
        "discount_price":    body.discount_price,
        "discount_category": body.discount_category,
        "stock":             body.stock,
        "category":          body.category,
        "image_url":         body.image_url,
        "min_price":         body.min_price,
        "negotiation_style": body.negotiation_style,
        "extra_fields":      body.extra_fields or {},
        "is_active":         True,
    }
    result = supabase.table("products").insert(row).execute()
    product = result.data[0]

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

    # Prevent overriding built-in column names
    if body.column_name in _KNOWN_COLS | _SKIP_COLS:
        raise HTTPException(
            status_code=400,
            detail=f"'{body.column_name}' is a reserved column name"
        )

    # Limit custom columns per tenant
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
    """
    Returns a downloadable CSV template with correct headers for the given type.
    product  → all standard + custom columns  (sku required)
    stock    → sku + stock
    campaign → sku + discount_price + discount_category
    """
    if template_type not in ("products", "stock", "campaign"):
        raise HTTPException(status_code=400, detail="template_type must be: products | stock | campaign")

    tid = tenant["tenant_id"]

    # Fetch tenant's custom column definitions
    custom_cols_res = (
        supabase.table("product_custom_columns")
        .select("column_name, display_name")
        .eq("tenant_id", tid)
        .order("sort_order")
        .execute()
    )
    custom_cols = custom_cols_res.data or []

    # Build header row
    if template_type == "products":
        headers = ["sku", "name", "mrp", "discount_price", "discount_category",
                   "stock", "category", "image_url"]
        headers += [c["column_name"] for c in custom_cols]
        example  = ["SKU001", "Sample Product", "500", "450", "Summer Sale",
                    "10", "Electronics", "https://example.com/image.jpg"]
        example += ["" for _ in custom_cols]
        instructions = [
            "# PRODUCT IMPORT TEMPLATE",
            "# Required columns: sku, name, mrp",
            "# Optional: discount_price, discount_category, stock, category, image_url + custom columns",
            "# Rows with missing sku / name / mrp will be skipped",
            "# If SKU already exists, the row will UPDATE that product",
            "#",
        ]
    elif template_type == "stock":
        headers = ["sku", "stock"]
        example  = ["SKU001", "25"]
        instructions = [
            "# STOCK UPDATE TEMPLATE",
            "# Required: sku",
            "# Updates only the stock quantity for matching SKUs",
            "#",
        ]
    else:  # campaign
        headers = ["sku", "discount_price", "discount_category"]
        example  = ["SKU001", "450", "Eid Sale 2026"]
        instructions = [
            "# CAMPAIGN / DISCOUNT TEMPLATE",
            "# Required: sku",
            "# Updates discount_price and discount_category for matching SKUs",
            "#",
        ]

    # Write to in-memory CSV
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
    Bulk import products via CSV upload.

    import_type = products  → upsert full product rows (sku, name, mrp required)
    import_type = stock     → update stock quantity for existing SKUs
    import_type = campaign  → update discount_price / discount_category for existing SKUs

    Rules:
    - Required columns must be present; rows missing them are SKIPPED (warning shown).
    - PK / FK / system columns (product_id, tenant_id, …) are silently ignored.
    - Unknown columns → saved into extra_fields JSONB automatically.
    - For 'products': if SKU already exists → UPDATE; else → INSERT (upsert).
    - For 'stock' / 'campaign': SKU must already exist; unknown SKUs are SKIPPED.
    """
    if import_type not in ("products", "stock", "campaign"):
        raise HTTPException(
            status_code=400,
            detail="import_type must be: products | stock | campaign"
        )

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted")

    tid = tenant["tenant_id"]

    # ── Read & decode file ────────────────────────────────────────────────────
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:   # 5 MB hard cap
        raise HTTPException(status_code=413, detail="CSV file must be under 5 MB")

    try:
        # utf-8-sig handles Excel-generated BOM automatically
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            content = raw.decode("latin-1")
        except Exception:
            raise HTTPException(status_code=400, detail="Could not decode CSV (use UTF-8 encoding)")

    # ── Parse CSV ─────────────────────────────────────────────────────────────
    # Strip comment/instruction lines that start with '#'
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

    # Normalise header names in the reader
    reader.fieldnames = headers

    required = _REQUIRED_COLS[import_type]
    missing_required = [r for r in required if r not in headers]
    if missing_required:
        raise HTTPException(
            status_code=422,
            detail=f"CSV is missing required columns: {', '.join(missing_required)}"
        )

    # ── Pre-fetch existing SKU → product_id map for this tenant ──────────────
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

    # ── Process rows ──────────────────────────────────────────────────────────
    imported = 0
    skipped  = 0
    errors   = 0
    warnings: list[dict] = []

    rows = list(reader)

    for row_num, raw_row in enumerate(rows, start=2):
        # Normalise: strip whitespace, lower-case keys
        row = {k.strip().lower(): (v.strip() if v else "") for k, v in raw_row.items() if k}

        # ── Check required fields ─────────────────────────────────────────
        missing = [col for col in required if not row.get(col)]
        if missing:
            skipped += 1
            warnings.append({
                "row": row_num,
                "message": f"Skipped — missing required field(s): {', '.join(missing)}"
            })
            continue

        sku = row["sku"]
        exists_id = existing_map.get(sku)

        try:
            # ── STOCK update mode ─────────────────────────────────────────
            if import_type == "stock":
                if not exists_id:
                    skipped += 1
                    warnings.append({
                        "row": row_num,
                        "message": f"Skipped — SKU '{sku}' not found in catalog"
                    })
                    continue

                stock_val = row.get("stock", "")
                if not stock_val:
                    skipped += 1
                    warnings.append({
                        "row": row_num,
                        "message": f"Skipped — 'stock' value is missing for SKU '{sku}'"
                    })
                    continue

                try:
                    stock_int = int(float(stock_val))
                except ValueError:
                    warnings.append({
                        "row": row_num,
                        "message": f"Skipped — 'stock' value '{stock_val}' is not a number"
                    })
                    skipped += 1
                    continue

                supabase.table("products") \
                    .update({"stock": stock_int}) \
                    .eq("tenant_id", tid) \
                    .eq("product_id", exists_id) \
                    .execute()
                imported += 1
                continue

            # ── CAMPAIGN update mode ──────────────────────────────────────
            if import_type == "campaign":
                if not exists_id:
                    skipped += 1
                    warnings.append({
                        "row": row_num,
                        "message": f"Skipped — SKU '{sku}' not found in catalog"
                    })
                    continue

                update_data: dict = {}
                if row.get("discount_price"):
                    try:
                        dp = float(row["discount_price"])
                        if dp > 0:
                            update_data["discount_price"] = dp
                    except ValueError:
                        warnings.append({
                            "row": row_num,
                            "message": f"Invalid discount_price '{row['discount_price']}' for SKU '{sku}' — skipping that field"
                        })

                if row.get("discount_category"):
                    update_data["discount_category"] = row["discount_category"]

                if not update_data:
                    skipped += 1
                    warnings.append({
                        "row": row_num,
                        "message": f"Skipped — no valid discount data for SKU '{sku}'"
                    })
                    continue

                supabase.table("products") \
                    .update(update_data) \
                    .eq("tenant_id", tid) \
                    .eq("product_id", exists_id) \
                    .execute()
                imported += 1
                continue

            # ── PRODUCTS upsert mode ──────────────────────────────────────
            # Validate MRP
            try:
                mrp_val = float(row["mrp"])
                if mrp_val <= 0:
                    raise ValueError("MRP must be greater than 0")
            except ValueError as e:
                skipped += 1
                warnings.append({
                    "row": row_num,
                    "message": f"Skipped — invalid mrp '{row.get('mrp')}': {e}"
                })
                continue

            product_data: dict = {
                "sku":  sku,
                "name": row["name"],
                "mrp":  mrp_val,
            }

            # Optional known columns (skip if empty or not present in CSV)
            if "discount_price" in headers and row.get("discount_price"):
                try:
                    dp = float(row["discount_price"])
                    if dp > 0:
                        product_data["discount_price"] = dp
                except ValueError:
                    warnings.append({
                        "row": row_num,
                        "message": f"Invalid discount_price '{row['discount_price']}' — skipping that field"
                    })

            if "discount_category" in headers and row.get("discount_category"):
                product_data["discount_category"] = row["discount_category"]

            if "stock" in headers and row.get("stock"):
                try:
                    product_data["stock"] = int(float(row["stock"]))
                except ValueError:
                    warnings.append({
                        "row": row_num,
                        "message": f"Invalid stock '{row['stock']}' — skipping that field"
                    })

            if "category" in headers and row.get("category"):
                product_data["category"] = row["category"]

            if "image_url" in headers and row.get("image_url"):
                product_data["image_url"] = row["image_url"]

            # Extra / custom columns → extra_fields JSONB
            extra_fields: dict = {}
            for col in headers:
                if col in _SKIP_COLS or col in _KNOWN_COLS:
                    continue
                if row.get(col):
                    extra_fields[col] = row[col]
            if extra_fields:
                product_data["extra_fields"] = extra_fields

            # Upsert by SKU
            if exists_id:
                # UPDATE existing product
                update_payload = {k: v for k, v in product_data.items() if k != "sku"}
                supabase.table("products") \
                    .update(update_payload) \
                    .eq("tenant_id", tid) \
                    .eq("product_id", exists_id) \
                    .execute()
            else:
                # INSERT new product
                product_data["product_id"] = str(uuid.uuid4())
                product_data["tenant_id"]  = tid
                supabase.table("products").insert(product_data).execute()
                existing_map[sku] = product_data["product_id"]   # prevent duplicate on repeat SKU in CSV

            imported += 1

        except Exception as exc:
            errors += 1
            logger.warning(f"CSV import row {row_num} error: {exc}")
            warnings.append({
                "row": row_num,
                "message": f"Error — {str(exc)}"
            })

    total_rows = imported + skipped + errors

    # ── Save import log ───────────────────────────────────────────────────────
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

    # ── Re-sync RAG in background ─────────────────────────────────────────────
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
    """
    Upload a product image to Cloudinary.
    If product_id is provided, also patches that product's image_url in the DB.
    Returns { image_url: str }.
    """
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG, WebP, or GIF images are accepted"
        )

    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be under 5 MB")

    tid = tenant["tenant_id"]
    try:
        image_url = upload_product_image(raw, file.filename or "product.jpg", tid)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # Optionally update the product row immediately
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
    result = (
        supabase.table("products")
        .select("*")
        .eq("tenant_id", tenant["tenant_id"])
        .eq("product_id", product_id)
        .maybe_single()
        .execute()
    )
    if result is None or result.data is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return result.data


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

    # If SKU is changing, check it won't conflict
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
