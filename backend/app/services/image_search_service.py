"""
OmniBot SaaS — Image Search Service

Two search paths:
  1. Customer sends image  → download → Gemini Vision → text description
                           → embed → pgvector search → top-3 products
  2. Customer texts "দেখাও" → extract query → embed → pgvector search
                             → primary image → send via Meta Graph API

Embedding model: text-embedding-004 (768-dim)
Vision model   : gemini-2.5-flash (multimodal)
"""
import logging
from typing import Optional

import httpx
from google import genai
from google.genai import types as genai_types

from app.config import settings
from app.database import supabase

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=settings.GEMINI_API_KEY)

# ── Vision prompt ─────────────────────────────────────────────────────────────
_VISION_PROMPT = (
    "এই ছবিতে কী দেখা যাচ্ছে? পণ্যের ধরন, রং, আকার, কাপড়/উপাদান, "
    "ডিজাইন এবং বৈশিষ্ট্য বাংলায় বিস্তারিত বর্ণনা করুন। "
    "শুধু পণ্যের তথ্য দিন, অন্য কিছু নয়।"
)

# ── Text-to-image trigger keywords ───────────────────────────────────────────
IMAGE_SHOW_TRIGGERS = [
    "দেখাও", "দেখান", "ছবি দাও", "ছবি দেখাও", "photo দেখাও",
    "picture দেখাও", "show me", "show photo", "image দেখাও",
    "কেমন দেখতে", "দেখতে চাই", "ছবি পাঠাও",
]


# ── Embedding helpers ─────────────────────────────────────────────────────────

def _embed_query(text: str) -> list[float]:
    result = _client.models.embed_content(
        model=settings.GEMINI_EMBEDDING_MODEL,
        contents=text,
        config=genai_types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
    )
    return list(result.embeddings[0].values)


def _embed_document(text: str) -> list[float]:
    result = _client.models.embed_content(
        model=settings.GEMINI_EMBEDDING_MODEL,
        contents=text,
        config=genai_types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
    )
    return list(result.embeddings[0].values)


# ── Image Download ────────────────────────────────────────────────────────────

async def download_image(url: str, access_token: Optional[str] = None) -> tuple[bytes, str]:
    """
    Download an image from a URL, optionally using a Meta access token.
    Returns (image_bytes, mime_type).
    """
    headers = {"User-Agent": "OmniBot/1.0"}
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        # Try without token first (for publicly accessible URLs)
        resp = await client.get(url, headers=headers)
        if resp.status_code != 200 and access_token:
            # Retry with access token for Meta CDN URLs
            resp = await client.get(url, params={"access_token": access_token}, headers=headers)
        resp.raise_for_status()
        mime_type = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        return resp.content, mime_type


# ── Gemini Vision ─────────────────────────────────────────────────────────────

def analyze_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    """Use Gemini Vision to generate a text description of an image."""
    try:
        response = _client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[
                genai_types.Content(parts=[
                    genai_types.Part(
                        inline_data=genai_types.Blob(
                            mime_type=mime_type,
                            data=image_bytes,
                        )
                    ),
                    genai_types.Part(text=_VISION_PROMPT),
                ])
            ],
        )
        return (response.text or "").strip()
    except Exception as e:
        logger.error(f"Gemini Vision analysis failed: {e}")
        return ""


# ── Vector Search ─────────────────────────────────────────────────────────────

def search_product_images(
    tenant_id: str,
    query_embedding: list[float],
    match_count: int = 3,
    match_threshold: float = 0.55,
) -> list[dict]:
    """Run pgvector cosine similarity search against product_images."""
    try:
        result = supabase.rpc(
            "match_product_images",
            {
                "query_embedding": query_embedding,
                "match_threshold":  match_threshold,
                "match_count":      match_count,
                "p_tenant_id":      tenant_id,
            },
        ).execute()
        return result.data or []
    except Exception as e:
        logger.error(f"product_images vector search error: {e}")
        return []


def _enrich_with_product(tenant_id: str, matches: list[dict]) -> list[dict]:
    """Fetch product details for each matched image, deduplicate by product."""
    if not matches:
        return []

    seen_products: set[str] = set()
    enriched: list[dict] = []

    for m in matches:
        pid = m["product_id"]
        if pid in seen_products:
            continue
        seen_products.add(pid)

        # Fetch product row
        prod_res = (
            supabase.table("products")
            .select("product_id, name, mrp, sku")
            .eq("product_id", pid)
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        if not prod_res.data:
            continue

        # Fetch primary image for this product
        img_res = (
            supabase.table("product_images")
            .select("image_url, image_description")
            .eq("product_id", pid)
            .eq("is_primary", True)
            .limit(1)
            .execute()
        )
        primary_image = img_res.data[0] if img_res.data else {"image_url": m["image_url"]}

        enriched.append({
            **prod_res.data,
            "image_url":         primary_image.get("image_url", ""),
            "image_description": primary_image.get("image_description", ""),
            "similarity":        m.get("similarity", 0),
        })

    return enriched


# ── Public API ────────────────────────────────────────────────────────────────

async def search_by_customer_image(
    tenant_id: str,
    image_url: str,
    access_token: Optional[str] = None,
    match_count: int = 3,
) -> list[dict]:
    """
    Full flow: download → Gemini Vision → embed → vector search → enrich.
    Returns enriched product list.
    """
    # 1. Download
    try:
        image_bytes, mime_type = await download_image(image_url, access_token)
    except Exception as e:
        logger.warning(f"Image download failed ({image_url[:60]}): {e}")
        return []

    # 2. Describe with Gemini
    description = analyze_image(image_bytes, mime_type)
    if not description:
        logger.warning("Gemini Vision returned no description")
        return []

    logger.info(f"Vision description: {description[:120]}")

    # 3. Embed description
    try:
        embedding = _embed_query(description)
    except Exception as e:
        logger.error(f"Embedding failed: {e}")
        return []

    # 4. Vector search
    matches = search_product_images(tenant_id, embedding, match_count)

    # 5. Enrich with product details
    return _enrich_with_product(tenant_id, matches)


def search_by_text(
    tenant_id: str,
    query: str,
    match_count: int = 3,
) -> list[dict]:
    """
    Text query → embed → vector search → enrich.
    Used for "কালো শাড়ি দেখাও" type requests.
    """
    try:
        embedding = _embed_query(query)
    except Exception as e:
        logger.error(f"Text embedding failed: {e}")
        return []

    matches = search_product_images(tenant_id, embedding, match_count)
    return _enrich_with_product(tenant_id, matches)


def embed_description(description: str) -> Optional[list[float]]:
    """Embed a description text for storage in product_images."""
    try:
        return _embed_document(description)
    except Exception as e:
        logger.error(f"embed_description failed: {e}")
        return None


def get_primary_image(tenant_id: str, product_id: str) -> Optional[str]:
    """Return the primary image URL for a product, or None."""
    res = (
        supabase.table("product_images")
        .select("image_url")
        .eq("tenant_id", tenant_id)
        .eq("product_id", product_id)
        .eq("is_primary", True)
        .limit(1)
        .execute()
    )
    return res.data[0]["image_url"] if res.data else None


def should_trigger_image_search(text: str) -> bool:
    """Return True if the message text suggests the customer wants to see a product image."""
    t = text.lower()
    return any(kw in t for kw in IMAGE_SHOW_TRIGGERS)


def format_product_reply(products: list[dict]) -> str:
    """Format matched products into a chatbot reply."""
    if not products:
        return "দুঃখিত, এই ধরনের পণ্য আমাদের কাছে পাওয়া যায়নি।"

    lines = ["🔍 মিলে যাওয়া পণ্য:\n"]
    for i, p in enumerate(products, 1):
        mrp = p.get("mrp", 0)
        lines.append(f"{i}. *{p['name']}*")
        lines.append(f"   💰 ৳{mrp:,.0f}")
        lines.append("")

    lines.append("অর্ডার করতে বা বিস্তারিত জানতে বলুন।")
    return "\n".join(lines)
