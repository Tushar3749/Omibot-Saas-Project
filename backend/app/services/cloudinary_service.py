"""
OmniBot SaaS — Cloudinary Image Upload Service
Uploads product images to Cloudinary and returns the secure URL.
Falls back to a descriptive error if credentials are not configured.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def upload_product_image(file_bytes: bytes, filename: str, tenant_id: str) -> str:
    """
    Upload an image to Cloudinary under folder omnibot/{tenant_id}/.
    Returns the secure HTTPS URL of the uploaded image.
    Raises RuntimeError if Cloudinary is not configured or upload fails.
    """
    from app.config import settings

    if not settings.CLOUDINARY_CLOUD_NAME:
        raise RuntimeError(
            "Cloudinary not configured. Add CLOUDINARY_CLOUD_NAME, "
            "CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET to backend/.env"
        )

    try:
        import cloudinary
        import cloudinary.uploader
    except ImportError:
        raise RuntimeError("cloudinary package not installed. Run: pip install cloudinary")

    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
        secure=True,
    )

    # Build a stable public_id from filename (strip extension)
    import os, re
    base = os.path.splitext(filename)[0]
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', base)[:80]
    public_id = f"omnibot/{tenant_id}/{safe_name}"

    result = cloudinary.uploader.upload(
        file_bytes,
        public_id=public_id,
        overwrite=True,
        resource_type="image",
        quality="auto",
        fetch_format="auto",
    )

    url: str = result.get("secure_url", "")
    if not url:
        raise RuntimeError("Cloudinary returned no URL")

    logger.info("Image uploaded to Cloudinary: %s", url)
    return url


def delete_product_image(image_url: str) -> None:
    """Best-effort deletion of an image from Cloudinary. Does not raise."""
    from app.config import settings
    if not settings.CLOUDINARY_CLOUD_NAME or not image_url:
        return
    try:
        import cloudinary, cloudinary.uploader
        cloudinary.config(
            cloud_name=settings.CLOUDINARY_CLOUD_NAME,
            api_key=settings.CLOUDINARY_API_KEY,
            api_secret=settings.CLOUDINARY_API_SECRET,
        )
        # Extract public_id from URL
        # URL format: https://res.cloudinary.com/<cloud>/image/upload/v123/omnibot/...
        if "/upload/" in image_url:
            after = image_url.split("/upload/")[1]
            # Remove version prefix like v1234567/
            import re
            after = re.sub(r'^v\d+/', '', after)
            public_id = after.rsplit('.', 1)[0]  # strip extension
            cloudinary.uploader.destroy(public_id)
    except Exception as exc:
        logger.warning("Could not delete Cloudinary image %s: %s", image_url, exc)
