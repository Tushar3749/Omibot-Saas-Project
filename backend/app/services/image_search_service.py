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
import asyncio
import json
import logging
import time
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
    "Describe this product image in detail. Include: product type, color, shape, "
    "packaging, brand text visible, size, material. Be specific for search matching."
)

# Vision prompt when customer sends an image — returns structured JSON
_CUSTOMER_IMAGE_PROMPT = (
    "This is a product image from a customer. Describe what product this is. "
    "Include: product name, type, category, approximate size/weight. "
    'Return JSON only, no markdown: {"product_description": "detailed description", '
    '"likely_product_name": "best guess name in Bangla", '
    '"category": "category guess", "confidence": "high/medium/low"}'
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


# ── Return photo validation ───────────────────────────────────────────────────

_RETURN_PHOTO_PROMPT = (
    "This image was sent by a customer as evidence for a product return/complaint.\n"
    "Analyze the image and return ONLY valid JSON (no markdown):\n"
    '{"is_product_photo": true, "damage_visible": false, "analysis": "brief description"}\n\n'
    "is_product_photo: true if image clearly shows a physical product (any packaged or unpackaged item)\n"
    "damage_visible: true if damage, defect, wrong product, or quality issue is clearly visible\n"
    "analysis: 1-2 sentence description of what you see\n"
    "Set is_product_photo=false for selfies, landscapes, screenshots, memes, or anything that is clearly not a product photo."
)


def validate_return_photo(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """Validate a customer return photo using Gemini Vision."""
    try:
        response = _client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[
                genai_types.Content(parts=[
                    genai_types.Part(
                        inline_data=genai_types.Blob(mime_type=mime_type, data=image_bytes)
                    ),
                    genai_types.Part(text=_RETURN_PHOTO_PROMPT),
                ])
            ],
        )
        text = (response.text or "").strip()
        if text.startswith("```"):
            import re
            text = re.sub(r"^```(?:json)?\n?", "", text)
            text = re.sub(r"\n?```$", "", text.strip())
        return json.loads(text)
    except Exception as exc:
        logger.warning(f"validate_return_photo failed: {exc}")
        return {"is_product_photo": True, "damage_visible": False, "analysis": "validation unavailable"}


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


# ── In-memory primary image URL cache (per product_id, 5-min TTL) ────────────

_image_url_cache: dict[str, tuple[Optional[str], float]] = {}
_CACHE_TTL = 300  # seconds


def get_primary_image_cached(tenant_id: str, product_id: str) -> Optional[str]:
    """Return primary image URL with 5-minute in-process cache."""
    now = time.time()
    cached = _image_url_cache.get(product_id)
    if cached and now - cached[1] < _CACHE_TTL:
        return cached[0]
    url = get_primary_image(tenant_id, product_id)
    _image_url_cache[product_id] = (url, now)
    return url


# ── Customer image analysis (JSON output) ────────────────────────────────────

def analyze_customer_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Analyze a customer-sent image with Gemini Vision.
    Returns structured JSON: product_description, likely_product_name, category, confidence.
    """
    try:
        response = _client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[
                genai_types.Content(parts=[
                    genai_types.Part(
                        inline_data=genai_types.Blob(mime_type=mime_type, data=image_bytes)
                    ),
                    genai_types.Part(text=_CUSTOMER_IMAGE_PROMPT),
                ])
            ],
        )
        raw = (response.text or "").strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:].strip()
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("analyze_customer_image: non-JSON response from Gemini")
        return {"product_description": "", "likely_product_name": "", "category": "", "confidence": "low"}
    except Exception as e:
        logger.error(f"analyze_customer_image failed: {e}")
        return {"product_description": "", "likely_product_name": "", "category": "", "confidence": "low"}


# ── Phase A: fast text search ─────────────────────────────────────────────────

def search_products_by_text(tenant_id: str, keywords: list[str], limit: int = 5) -> list[dict]:
    """
    Phase A: ILIKE search on product name and category.
    Fast (<100ms), used before vector search.
    """
    if not keywords:
        return []
    try:
        conditions = []
        for kw in keywords[:3]:
            safe = kw.replace("%", "").replace("'", "")[:60]
            if safe:
                conditions.append(f"name.ilike.%{safe}%")
                conditions.append(f"category.ilike.%{safe}%")
        if not conditions:
            return []
        result = (
            supabase.table("products")
            .select("product_id, name, sku, mrp, category, image_url")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .or_(",".join(conditions))
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error(f"search_products_by_text failed: {e}")
        return []


# ── 2-phase customer image recognition ───────────────────────────────────────

async def recognize_and_search_customer_image(
    tenant_id: str,
    image_url: str,
    access_token: Optional[str] = None,
    match_count: int = 3,
) -> tuple[list[dict], dict]:
    """
    Full customer-image recognition pipeline:
      1. Download image
      2. Gemini Vision (JSON, 5s timeout) → product_description + confidence
      3. Parallel: Phase A (text search) + Phase B embed
      4. Return Phase A if high/medium confidence, else Phase B, else Phase A fallback
    Returns (products, analysis_dict).
    """
    # 1. Download
    try:
        image_bytes, mime_type = await download_image(image_url, access_token)
    except Exception as e:
        logger.warning(f"Customer image download failed: {e}")
        return [], {}

    # 2. Vision with timeout
    try:
        analysis: dict = await asyncio.wait_for(
            asyncio.to_thread(analyze_customer_image, image_bytes, mime_type),
            timeout=5.0,
        )
    except asyncio.TimeoutError:
        logger.warning("Gemini Vision timed out for customer image")
        return [], {}
    except Exception as e:
        logger.warning(f"Gemini Vision error for customer image: {e}")
        return [], {}

    description  = analysis.get("product_description", "")
    product_name = analysis.get("likely_product_name", "")
    category     = analysis.get("category", "")
    confidence   = analysis.get("confidence", "low")

    logger.info(f"Customer image analysis: name={product_name!r} confidence={confidence}")

    if confidence == "low" and not description and not product_name:
        return [], analysis

    keywords = [kw for kw in [product_name, category] if kw]

    # 3. Parallel Phase A + Phase B setup
    async def _phase_a() -> list[dict]:
        if not keywords:
            return []
        return await asyncio.to_thread(search_products_by_text, tenant_id, keywords)

    async def _phase_b_embed() -> Optional[list[float]]:
        if not description:
            return None
        try:
            return await asyncio.to_thread(_embed_query, description)
        except Exception as exc:
            logger.warning(f"Embedding failed in customer image search: {exc}")
            return None

    text_products, query_embedding = await asyncio.gather(_phase_a(), _phase_b_embed())

    def _enrich_text(rows: list[dict], sim: float) -> list[dict]:
        result = []
        for p in rows[:match_count]:
            img_url = get_primary_image_cached(tenant_id, p["product_id"])
            result.append({**p, "image_url": img_url or p.get("image_url"), "image_description": "", "similarity": sim})
        return result

    # 4. Decide which results to return
    if text_products and confidence in ("high", "medium"):
        return _enrich_text(text_products, 0.9 if confidence == "high" else 0.75), analysis

    if query_embedding:
        matches = await asyncio.to_thread(
            search_product_images, tenant_id, query_embedding, match_count
        )
        vector_results = _enrich_with_product(tenant_id, matches)
        if vector_results:
            return vector_results, analysis

    if text_products:
        return _enrich_text(text_products, 0.5), analysis

    return [], analysis


# ── Image-recognition response formatter ─────────────────────────────────────

def format_image_recognition_reply(products: list[dict], analysis: dict) -> str:
    """Bangla reply for customer image recognition flow."""
    if not products:
        return (
            "দুঃখিত, এই পণ্যটি আমাদের কাছে নেই।\n"
            "আমাদের পণ্য তালিকা দেখতে চান?"
        )

    likely_name = (analysis.get("likely_product_name") or "").strip()

    if len(products) == 1:
        p    = products[0]
        name = p.get("name", "পণ্য")
        sku  = p.get("sku", "")
        mrp  = p.get("mrp", 0)
        intro = f"এটা দেখে মনে হচ্ছে {likely_name}!\n" if likely_name else ""
        return (
            f"{intro}আমাদের কাছে আছে:\n"
            f"🛒 {name} ({sku}) — ৳{mrp:,.0f}\n\n"
            "এটি কি নিতে চান?"
        )

    intro = (
        f"{likely_name} সম্পর্কিত পণ্যগুলো:\n"
        if likely_name
        else "এই পণ্যগুলোর সাথে মিলছে:\n"
    )
    lines = [intro]
    for i, p in enumerate(products[:3], 1):
        lines.append(f"{i}. {p['name']} — ৳{p.get('mrp', 0):,.0f}")
    lines.append("\nকোনটি আপনার?")
    return "\n".join(lines)


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
