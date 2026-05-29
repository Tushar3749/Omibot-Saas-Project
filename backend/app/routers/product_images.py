"""
OmniBot SaaS — Product Images Router
CRUD for per-product images with Cloudinary upload + vector embedding.

Routes (static before parameterized):
  GET    /search           text-based image search
  GET    /                 list images for a product_id query-param
  POST   /                 upload a new image
  PATCH  /{image_id}/primary  set as primary (unsets others)
  DELETE /{image_id}       delete image
"""
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from app.auth.dependencies import get_current_tenant
from app.database import supabase
from app.services.cloudinary_service import upload_product_image, delete_product_image
from app.services.image_search_service import (
    embed_description,
    analyze_image,
    search_by_text,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Static routes first ───────────────────────────────────────────────────────

@router.get("/search")
async def text_search(
    q: str,
    limit: int = 5,
    tenant: dict = Depends(get_current_tenant),
):
    """Text-based product image search."""
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    results = search_by_text(tenant["tenant_id"], q.strip(), match_count=limit)
    return results


@router.get("/")
async def list_images(
    product_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    """Return all images for a product, primary first."""
    result = (
        supabase.table("product_images")
        .select("image_id, image_url, image_description, is_primary, created_at")
        .eq("tenant_id", tenant["tenant_id"])
        .eq("product_id", product_id)
        .order("is_primary", desc=True)
        .order("created_at")
        .execute()
    )
    return result.data or []


# ── Parameterized routes ──────────────────────────────────────────────────────

@router.post("/")
async def upload_image(
    product_id: str          = Form(...),
    description: str         = Form(""),
    is_primary: bool         = Form(False),
    auto_describe: bool      = Form(False),   # use Gemini Vision if True & description empty
    file: UploadFile         = File(...),
    tenant: dict             = Depends(get_current_tenant),
):
    """
    Upload a product image to Cloudinary, optionally auto-describe with Gemini,
    embed the description, and store everything in product_images.
    """
    tid = tenant["tenant_id"]

    # Verify product belongs to tenant
    prod = (
        supabase.table("products")
        .select("product_id, name")
        .eq("product_id", product_id)
        .eq("tenant_id", tid)
        .maybe_single()
        .execute()
    )
    if not prod.data:
        raise HTTPException(status_code=404, detail="Product not found")

    image_id = str(uuid.uuid4())
    file_bytes = await file.read()
    filename   = f"{image_id}_{file.filename or 'image.jpg'}"

    # Upload to Cloudinary
    try:
        image_url = upload_product_image(file_bytes, filename, f"{tid}/products/{product_id}")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Auto-describe with Gemini if requested and no description provided
    final_description = description.strip()
    if auto_describe and not final_description:
        mime = file.content_type or "image/jpeg"
        try:
            final_description = analyze_image(file_bytes, mime)
        except Exception as e:
            logger.warning(f"Auto-describe failed: {e}")
            final_description = prod.data.get("name", "")

    # Fallback description: product name
    if not final_description:
        final_description = prod.data.get("name", "")

    # Generate embedding
    embedding: Optional[list[float]] = None
    if final_description:
        embedding = embed_description(final_description)

    # If setting as primary, clear existing primary flag for this product
    if is_primary:
        supabase.table("product_images").update({"is_primary": False}).eq(
            "tenant_id", tid
        ).eq("product_id", product_id).execute()

    # Insert row
    row = {
        "image_id":          image_id,
        "tenant_id":         tid,
        "product_id":        product_id,
        "image_url":         image_url,
        "image_description": final_description or None,
        "is_primary":        is_primary,
    }
    if embedding:
        row["embedding"] = embedding

    result = supabase.table("product_images").insert(row).execute()
    return result.data[0] if result.data else row


@router.patch("/{image_id}/primary")
async def set_primary(
    image_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    """Make this image the primary one for its product; unset all others."""
    tid = tenant["tenant_id"]

    # Fetch the image to get its product_id
    img = (
        supabase.table("product_images")
        .select("product_id")
        .eq("image_id", image_id)
        .eq("tenant_id", tid)
        .maybe_single()
        .execute()
    )
    if not img.data:
        raise HTTPException(status_code=404, detail="Image not found")

    product_id = img.data["product_id"]

    # Clear primary on all images for this product, then set on this one
    supabase.table("product_images").update({"is_primary": False}).eq(
        "tenant_id", tid
    ).eq("product_id", product_id).execute()

    supabase.table("product_images").update({"is_primary": True}).eq(
        "image_id", image_id
    ).eq("tenant_id", tid).execute()

    return {"image_id": image_id, "is_primary": True}


@router.patch("/{image_id}/description")
async def update_description(
    image_id: str,
    body: dict,
    tenant: dict = Depends(get_current_tenant),
):
    """Update the description (and re-embed) for a product image."""
    tid = tenant["tenant_id"]
    description = (body.get("description") or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="Description cannot be empty")

    embedding = embed_description(description)
    update_data: dict = {"image_description": description}
    if embedding:
        update_data["embedding"] = embedding

    result = (
        supabase.table("product_images")
        .update(update_data)
        .eq("image_id", image_id)
        .eq("tenant_id", tid)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Image not found")
    return result.data[0]


@router.delete("/{image_id}")
async def delete_image(
    image_id: str,
    tenant: dict = Depends(get_current_tenant),
):
    """Delete a product image from DB and Cloudinary (best-effort)."""
    tid = tenant["tenant_id"]

    img = (
        supabase.table("product_images")
        .select("image_url, is_primary, product_id")
        .eq("image_id", image_id)
        .eq("tenant_id", tid)
        .maybe_single()
        .execute()
    )
    if not img.data:
        raise HTTPException(status_code=404, detail="Image not found")

    image_url = img.data.get("image_url", "")

    supabase.table("product_images").delete().eq(
        "image_id", image_id
    ).eq("tenant_id", tid).execute()

    # If this was primary, promote the next oldest image
    if img.data.get("is_primary"):
        next_img = (
            supabase.table("product_images")
            .select("image_id")
            .eq("tenant_id", tid)
            .eq("product_id", img.data["product_id"])
            .order("created_at")
            .limit(1)
            .execute()
        )
        if next_img.data:
            supabase.table("product_images").update({"is_primary": True}).eq(
                "image_id", next_img.data[0]["image_id"]
            ).execute()

    # Delete from Cloudinary (non-blocking best-effort)
    delete_product_image(image_url)

    return {"deleted": True}
