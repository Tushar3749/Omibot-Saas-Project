"""
OmniBot SaaS — Supabase Storage Service
Uploads/deletes product images using Supabase Storage bucket "product-images".
Path convention: {folder}/{filename}  where folder = "{tenant_id}/{product_id}"
"""
import mimetypes
import logging

logger = logging.getLogger(__name__)

BUCKET = "product-images"


def ensure_bucket_exists() -> None:
    """Create the product-images Storage bucket if it doesn't exist yet."""
    from app.database import supabase
    try:
        supabase.storage.get_bucket(BUCKET)
    except Exception:
        try:
            supabase.storage.create_bucket(BUCKET, {"public": True})
            logger.info(f"Created Supabase Storage bucket: {BUCKET}")
        except Exception as exc:
            logger.warning(f"ensure_bucket_exists: could not create bucket: {exc}")


def upload_product_image(file_bytes: bytes, filename: str, folder: str) -> str:
    """
    Upload image bytes to Supabase Storage.
    Returns the public URL.
    """
    from app.database import supabase

    mime = mimetypes.guess_type(filename)[0] or "image/jpeg"
    path = f"{folder}/{filename}"

    try:
        supabase.storage.from_(BUCKET).upload(
            path,
            file_bytes,
            file_options={"content-type": mime, "upsert": "true"},
        )
    except Exception as exc:
        raise RuntimeError(f"Supabase Storage upload failed: {exc}") from exc

    public_url: str = supabase.storage.from_(BUCKET).get_public_url(path)
    logger.info("Uploaded to Supabase Storage: %s", public_url)
    return public_url


def delete_product_image(image_url: str) -> None:
    """Best-effort deletion from Supabase Storage. Does not raise on failure."""
    if not image_url:
        return
    try:
        from app.database import supabase

        # URL format: https://<project>.supabase.co/storage/v1/object/public/product-images/<path>
        marker = f"/object/public/{BUCKET}/"
        if marker not in image_url:
            return
        path = image_url.split(marker, 1)[1].split("?")[0]
        supabase.storage.from_(BUCKET).remove([path])
        logger.info("Deleted from Supabase Storage: %s", path)
    except Exception as exc:
        logger.warning("Could not delete from Supabase Storage: %s — %s", image_url, exc)
