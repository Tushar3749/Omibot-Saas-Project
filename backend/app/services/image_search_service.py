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
import re
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
    # Bengali
    "দেখাও", "দেখান", "ছবি দাও", "ছবি দেখাও", "ছবি পাঠাও",
    "photo দেখাও", "picture দেখাও", "image দেখাও",
    "কেমন দেখতে", "দেখতে কেমন", "দেখতে চাই",
    # Romanized / mixed — "chobi" catches "chobita" as substring
    "chobi", "chobita", "photo dao", "photo pathao", "photo daw",
    "photo dekhao", "photo dekhan", "dekhao", "dekhan",
    "pic dao", "pic dekhao", "picture dao",
    # English
    "show me", "show photo", "show image", "show picture",
    "send photo", "send image", "send pic",
]

# ── Product name extraction prompt (caller already confirmed it's an image request) ──
_PRODUCT_NAME_EXTRACT_PROMPT = (
    "The customer wants to see a product image. Extract the product name from their message.\n"
    "Message: \"{message}\"\n\n"
    "Rules:\n"
    "- Bengali genitive suffix '-r'/'-er' means 'of X' → remove it: 'MODHUR' → 'মধু', 'teler' → 'তেল'\n"
    "- Romanized → Bengali: modhu=মধু, tel=তেল, sorisar=সরিষা, chini=চিনি, lobon=লবণ, dal=ডাল, atta=আটা\n"
    "- Include weight/size if mentioned: '500 gram er modhu' → product_name='মধু', keywords=['500','gram']\n"
    "- SKU pattern (letters+digits+hyphen like FMCG-016): return as sku field\n"
    "- If no product is mentioned, return null for both fields\n\n"
    "Return JSON only — no markdown:\n"
    '{{\"product_name\": \"Bengali name or null\", \"sku\": \"SKU or null\", \"keywords\": [\"raw word1\", \"word2\"]}}'
)

# ── Legacy intent prompt — kept for backward compat, prefer extract_product_from_image_request ──
_PRODUCT_IMAGE_INTENT_PROMPT = _PRODUCT_NAME_EXTRACT_PROMPT

# ── Per-tenant catalog cache (10-minute TTL) ──────────────────────────────────
_catalog_cache: dict[str, tuple[float, list]] = {}
_CATALOG_CACHE_TTL = 600  # seconds


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


# ── Direct Catalog Match (Gemini Vision + full catalog) ───────────────────────

_CATALOG_MATCH_PROMPT = (
    "A customer sent the attached product image to a Bangladeshi grocery/FMCG shop's chatbot.\n"
    "Our full product catalog (JSON) — names are mostly in Bangla:\n"
    "{catalog_json}\n\n"
    "Common English/Romanized ↔ Bangla grocery equivalents (use these to bridge language gaps):\n"
    "honey=মধু, oil/tel=তেল, rice/chal=চাল, lentil/dal/dal=ডাল, flour/atta=আটা, "
    "sugar/chini=চিনি, salt/lobon=লবণ, ghee=ঘি, milk/dudh=দুধ, egg/dim=ডিম, "
    "spice/moshla=মসলা, tea/cha=চা, biscuit=বিস্কুট, soap/shaban=সাবান.\n\n"
    "Be GENEROUS and visual: identify the product category/type from the image "
    "(jar, bottle, packet, box shape, color, label) and match it to the closest catalog "
    "product even if the brand or exact label text isn't fully readable. Only return "
    "matched=false if the image is clearly NOT any kind of product the catalog could "
    "plausibly contain (e.g. a person, animal, landscape, screenshot, unrelated object).\n"
    "If you're not fully certain but the image plausibly resembles a catalog item, still "
    "return matched=true with confidence=\"low\" and your best-guess product, plus 2-3 "
    "alternates in similar_products — never leave the customer with no suggestion at all "
    "when the image is some kind of product.\n\n"
    "Return JSON only — no markdown, no extra text:\n"
    '{{"matched": true_or_false, '
    '"product_name": "exact name from catalog or null", '
    '"sku": "SKU from catalog or null", '
    '"price": price_number_or_null, '
    '"confidence": "high or medium or low", '
    '"image_description": "brief description of what is visible in the image", '
    '"similar_products": ["up to 3 similar product names from catalog"]}}'
)

# ── Keyword fallback for when Gemini is overly conservative ──────────────────
_GROCERY_TERM_MAP = {
    "honey": "মধু", "tel": "তেল", "oil": "তেল", "dal": "ডাল", "lentil": "ডাল",
    "chal": "চাল", "rice": "চাল", "atta": "আটা", "flour": "আটা",
    "chini": "চিনি", "sugar": "চিনি", "lobon": "লবণ", "salt": "লবণ",
    "ghee": "ঘি", "dudh": "দুধ", "milk": "দুধ", "dim": "ডিম", "egg": "ডিম",
    "moshla": "মসলা", "spice": "মসলা", "cha": "চা", "tea": "চা",
    "biscuit": "বিস্কুট", "shaban": "সাবান", "soap": "সাবান",
}


def _keyword_fallback_match(products: list[dict], text: str) -> list[dict]:
    """
    Last-resort match when Gemini returns matched=false: look for any catalog
    product whose name appears in (or shares a translated grocery term with)
    the description/guess text Gemini already gave us. Returns scored matches.
    """
    if not text:
        return []
    t = text.lower()
    # Expand text with Bangla equivalents of any English/Romanized grocery terms found
    expanded_terms = set()
    for en, bn in _GROCERY_TERM_MAP.items():
        if en in t:
            expanded_terms.add(bn)

    hits = []
    for p in products:
        name = (p.get("name") or "")
        name_lower = name.lower()
        score = 0
        if name_lower and name_lower in t:
            score = 3
        elif any(term in name for term in expanded_terms):
            score = 2
        elif any(tok and tok in name for tok in t.split() if len(tok) > 2):
            score = 1
        if score:
            hits.append((score, p))

    hits.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in hits[:3]]


def _get_catalog_cached(tenant_id: str) -> list:
    """Load active products for tenant; cached 10 minutes to avoid per-message DB round-trips."""
    now = time.time()
    ts, products = _catalog_cache.get(tenant_id, (0, []))
    if now - ts < _CATALOG_CACHE_TTL and products:
        return products
    try:
        res = (
            supabase.table("products")
            .select("product_id,name,sku,mrp,category,image_url")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .limit(200)
            .execute()
        )
        products = res.data or []
    except Exception as exc:
        logger.warning(f"_get_catalog_cached: DB load failed: {exc}")
        products = []
    _catalog_cache[tenant_id] = (time.time(), products)
    return products


def invalidate_catalog_cache(tenant_id: str) -> None:
    """Call after product edits so the next request sees fresh data."""
    _catalog_cache.pop(tenant_id, None)


def match_image_to_catalog(
    tenant_id: str,
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
) -> dict:
    """
    Single-pass Gemini catalog match: image + full product catalog JSON → structured result.
    Returns dict with keys: matched, product_name, sku, price, confidence,
    image_description, similar_products, _catalog; and (if matched) product_id,
    category, image_url populated from the DB row.
    """
    products = _get_catalog_cached(tenant_id)
    if not products:
        logger.warning(f"match_image_to_catalog: empty catalog for tenant={tenant_id}")
        return {"matched": False, "image_description": "", "_catalog": []}

    catalog = [
        {
            "name":     p["name"],
            "sku":      p["sku"],
            "price":    p.get("mrp"),
            "category": p.get("category") or "",
        }
        for p in products
    ]
    prompt = _CATALOG_MATCH_PROMPT.format(
        catalog_json=json.dumps(catalog, ensure_ascii=False)
    )

    logger.info(
        f"match_image_to_catalog: tenant={tenant_id} catalog_size={len(products)} "
        f"names={[p['name'] for p in products][:10]}"
    )

    try:
        response = _client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[
                genai_types.Content(parts=[
                    genai_types.Part(
                        inline_data=genai_types.Blob(mime_type=mime_type, data=image_bytes)
                    ),
                    genai_types.Part(text=prompt),
                ])
            ],
        )
        text = (response.text or "").strip()
        logger.info(f"match_image_to_catalog: raw Gemini response={text[:500]!r}")
        text = re.sub(r"^```(?:json)?\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
        result = json.loads(text)
    except Exception as exc:
        logger.warning(f"match_image_to_catalog: Gemini/parse failed: {exc}")
        result = {"matched": False, "image_description": ""}

    logger.info(
        f"match_image_to_catalog: parsed matched={result.get('matched')} "
        f"product_name={result.get('product_name')!r} sku={result.get('sku')!r} "
        f"confidence={result.get('confidence')}"
    )

    # Gemini was too conservative (matched=false) — try a deterministic keyword
    # fallback against the catalog before giving up entirely.
    if not result.get("matched"):
        guess_text = " ".join(filter(None, [
            result.get("image_description") or "",
            result.get("product_name") or "",
        ]))
        fallback_hits = _keyword_fallback_match(products, guess_text)
        if fallback_hits:
            best = fallback_hits[0]
            logger.info(
                f"match_image_to_catalog: keyword fallback matched "
                f"{[p['name'] for p in fallback_hits]} for guess_text={guess_text!r}"
            )
            result["matched"]          = True
            result["confidence"]       = "low"
            result["product_name"]     = best["name"]
            result["sku"]              = best["sku"]
            result["price"]            = best.get("mrp")
            result["similar_products"] = [p["name"] for p in fallback_hits]

    # Enrich with DB values (product_id, real price, image_url) for matched SKU
    if result.get("matched") and result.get("sku"):
        sku = result["sku"]
        for p in products:
            if p["sku"] == sku:
                result["product_id"] = p["product_id"]
                result["category"]   = p.get("category") or ""
                result["image_url"]  = p.get("image_url") or ""
                result["price"]      = p.get("mrp") or result.get("price") or 0
                break

    result["_catalog"] = products
    return result


def format_catalog_match_reply(match: dict) -> str:
    """Bangla reply for a catalog-match result. Three branches: matched, similar, no match."""
    catalog = match.get("_catalog") or []

    if not match.get("matched"):
        cats = list({p.get("category") for p in catalog if p.get("category")})[:5]
        if cats:
            return (
                "❌ দুঃখিত, এই পণ্যটি আমাদের catalog-এ নেই।\n"
                "আমাদের পণ্যের ক্যাটাগরি: " + " | ".join(cats)
            )
        return "❌ দুঃখিত, এই পণ্যটি আমাদের catalog-এ নেই। পণ্যের নাম লিখে জানান।"

    confidence   = match.get("confidence", "low")
    product_name = match.get("product_name") or "পণ্য"
    sku          = match.get("sku") or ""
    price        = float(match.get("price") or 0)
    category     = match.get("category") or ""

    if confidence in ("high", "medium"):
        lines = [
            f"✅ এটা *{product_name}* পাওয়া গেছে!",
            f"SKU: {sku}",
            f"💰 মূল্য: ৳{price:,.0f}",
        ]
        if category:
            lines.append(f"📦 ক্যাটাগরি: {category}")
        lines.append("\nএটি কি অর্ডার করতে চান?")
        return "\n".join(lines)

    # Low confidence — list similar products with SKU + price
    similar_names = set(match.get("similar_products") or [])
    similar_rows = [p for p in catalog if p.get("name") in similar_names][:3]
    if not similar_rows:
        similar_rows = catalog[:3]

    lines = ["🔍 নিচের পণ্যগুলোর মধ্যে কোনটি খুঁজছেন?"]
    for i, p in enumerate(similar_rows, 1):
        p_price = float(p.get("mrp") or 0)
        lines.append(f"{i}. {p['name']} ({p.get('sku', '')}) — ৳{p_price:,.0f}")
    lines.append("\nপণ্যের নাম বা নম্বর বলুন।")
    return "\n".join(lines)


def extract_product_from_image_request(text: str) -> dict:
    """
    Extract product name/SKU from a message already confirmed as an image request.
    Caller has already verified intent via should_trigger_image_search — no intent check here.
    Returns {"product_name": ..., "sku": ..., "keywords": [...]}.
    """
    prompt = _PRODUCT_NAME_EXTRACT_PROMPT.format(message=text)
    try:
        response = _client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt,
        )
        raw = (response.text or "").strip()
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
        result = json.loads(raw)
        # Normalise — ensure expected keys exist
        return {
            "product_name": result.get("product_name") or None,
            "sku":          result.get("sku") or None,
            "keywords":     result.get("keywords") or [],
        }
    except Exception as exc:
        logger.warning(f"extract_product_from_image_request failed: {exc}")
        return {"product_name": None, "sku": None, "keywords": []}


def extract_product_image_intent(text: str) -> dict:
    """Legacy wrapper — prefer extract_product_from_image_request."""
    result = extract_product_from_image_request(text)
    # Always returns see_product_image since caller confirmed intent via keyword match
    return {"intent": "see_product_image", **result}


def _attach_primary_image(tenant_id: str, product: dict) -> dict:
    """Overlay primary image URL from product_images onto a product dict."""
    try:
        img_res = (
            supabase.table("product_images")
            .select("image_url")
            .eq("tenant_id", tenant_id)
            .eq("product_id", product["product_id"])
            .eq("is_primary", True)
            .limit(1)
            .execute()
        )
        if img_res.data:
            return {**product, "image_url": img_res.data[0]["image_url"]}
    except Exception:
        pass
    return product


def get_product_with_image(
    tenant_id: str,
    product_name: Optional[str] = None,
    sku: Optional[str] = None,
    keywords: Optional[list[str]] = None,
) -> Optional[dict]:
    """
    Find a product by SKU (exact) or name with its primary image URL.
    Search order:
      1. SKU exact match (if sku provided)
      2. Full name ILIKE substring match
      3. Multi-keyword AND search (splits name on spaces, matches all parts)
    Checks product_images.is_primary, falls back to products.image_url.
    """
    if not product_name and not sku:
        return None

    base_q = (
        supabase.table("products")
        .select("product_id,name,sku,mrp,category,image_url")
        .eq("tenant_id", tenant_id)
        .eq("is_active", True)
    )

    product = None
    try:
        if sku:
            res = base_q.ilike("sku", sku.strip()).limit(1).execute()
            product = (res.data or [None])[0]

        if not product and product_name:
            # Try exact substring match first
            res = base_q.ilike("name", f"%{product_name.strip()}%").limit(1).execute()
            product = (res.data or [None])[0]

        if not product and product_name:
            # Multi-keyword AND: split product_name into tokens, require each in name
            tokens = [t for t in product_name.strip().split() if len(t) >= 2]
            if len(tokens) > 1:
                conditions = ",".join(f"name.ilike.%{t}%" for t in tokens[:4])
                res = base_q.or_(conditions).limit(10).execute()
                # Score rows: most token matches wins
                best, best_score = None, 0
                for row in (res.data or []):
                    n = (row.get("name") or "").lower()
                    score = sum(1 for t in tokens if t.lower() in n)
                    if score > best_score:
                        best, best_score = row, score
                if best_score > 0:
                    product = best

        if not product and keywords:
            # Extra keywords extracted by Gemini (e.g. from mixed-language input)
            conditions = ",".join(f"name.ilike.%{kw}%" for kw in keywords[:4] if kw)
            if conditions:
                res = base_q.or_(conditions).limit(1).execute()
                product = (res.data or [None])[0]

    except Exception as exc:
        logger.warning(f"get_product_with_image: DB error: {exc}")
        return None

    if not product:
        return None

    return _attach_primary_image(tenant_id, product)


def get_product_with_image_by_id(tenant_id: str, product_id: str) -> Optional[dict]:
    """Find a product by its ID with primary image — used for context-based lookup."""
    try:
        res = (
            supabase.table("products")
            .select("product_id,name,sku,mrp,category,image_url")
            .eq("tenant_id", tenant_id)
            .eq("product_id", product_id)
            .eq("is_active", True)
            .maybe_single()
            .execute()
        )
        if not res.data:
            return None
        return _attach_primary_image(tenant_id, res.data)
    except Exception as exc:
        logger.warning(f"get_product_with_image_by_id: DB error: {exc}")
        return None


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
