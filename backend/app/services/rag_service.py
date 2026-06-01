"""
OmniBot SaaS — LangChain RAG Service  (google-genai SDK)
Handles document embedding and tenant-filtered pgvector semantic search.
Uses Google text-embedding-004 (768-dim) via the new google.genai SDK.
"""
import logging
from typing import Optional

from google import genai
from google.genai import types as genai_types

from app.config import settings
from app.database import supabase

logger = logging.getLogger(__name__)

# One shared client instance
_client = genai.Client(api_key=settings.GEMINI_API_KEY)


class RAGService:
    """Retrieval-Augmented Generation helper backed by Supabase pgvector."""

    # ── Embedding ─────────────────────────────────────────────────────────────

    def _embed(self, text: str) -> list[float]:
        """Create a 768-dim embedding for indexing a document."""
        result = _client.models.embed_content(
            model=settings.GEMINI_EMBEDDING_MODEL,
            contents=text,
            config=genai_types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
        )
        return list(result.embeddings[0].values)

    def _embed_query(self, text: str) -> list[float]:
        """Create a 768-dim embedding optimised for a search query."""
        result = _client.models.embed_content(
            model=settings.GEMINI_EMBEDDING_MODEL,
            contents=text,
            config=genai_types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
        )
        return list(result.embeddings[0].values)

    # ── Retrieval ─────────────────────────────────────────────────────────────

    async def get_relevant_context(
        self,
        tenant_id: str,
        query: str,
        match_count: int = 5,
        match_threshold: float = 0.65,
    ) -> str:
        """Search the knowledge base and return a formatted context string."""
        try:
            query_embedding = self._embed_query(query)

            result = supabase.rpc(
                "match_knowledge_base",
                {
                    "query_embedding": query_embedding,
                    "match_threshold": match_threshold,
                    "match_count": match_count,
                    "p_tenant_id": tenant_id,
                },
            ).execute()

            if not result.data:
                return ""

            context_parts = []
            for doc in result.data:
                ct      = doc.get("content_type", "info")
                content = doc.get("content", "")
                context_parts.append(f"[{ct.upper()}] {content}")

            return "\n\n".join(context_parts)

        except Exception as e:
            logger.error(f"RAG retrieval error for tenant {tenant_id}: {e}")
            return ""

    # ── Ingestion ─────────────────────────────────────────────────────────────

    def add_document(
        self,
        tenant_id: str,
        content: str,
        content_type: str,
        metadata: Optional[dict] = None,
        source_id: Optional[str] = None,
    ) -> dict:
        """Embed a document and upsert it into knowledge_base."""
        try:
            embedding = self._embed(content)
            row = {
                "tenant_id":    tenant_id,
                "content":      content,
                "content_type": content_type,
                "metadata":     metadata or {},
                "embedding":    embedding,
            }
            if source_id:
                row["source_id"] = source_id

            result = supabase.table("knowledge_base").upsert(row).execute()
            return result.data[0] if result.data else {}
        except Exception as e:
            logger.error(f"RAG add_document error: {e}")
            raise

    def sync_products_to_rag(self, tenant_id: str) -> int:
        """
        Rebuild knowledge-base entries for all active products of a tenant.
        Deletes old product entries first, then re-embeds.
        Returns count of documents added.
        """
        supabase.table("knowledge_base").delete().eq(
            "tenant_id", tenant_id
        ).eq("content_type", "product").execute()

        products_res = (
            supabase.table("products")
            .select("*")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .execute()
        )
        products = products_res.data or []

        count = 0
        for p in products:
            price_info = f"MRP: ৳{p['mrp']}"
            description = p.get("description") or (p.get("extra_fields") or {}).get("description", "")

            doc_text = f"পণ্যের নাম: {p['name']}\nSKU: {p.get('sku', '')}\n{price_info}\n"
            if description:
                doc_text += f"বিবরণ: {description}\n"
            if p.get("category"):
                doc_text += f"ক্যাটাগরি: {p['category']}\n"

            extra = p.get("extra_fields") or {}
            for key, val in extra.items():
                if key != "description" and val:
                    doc_text += f"{key}: {val}\n"

            self.add_document(
                tenant_id=tenant_id,
                content=doc_text,
                content_type="product",
                metadata={
                    "product_id": p["product_id"],
                    "name":       p["name"],
                    "sku":        p.get("sku", ""),
                    "mrp":        p["mrp"],
                },
                source_id=p["product_id"],
            )
            count += 1

        logger.info(f"RAG sync: {count} products embedded for tenant {tenant_id}")
        return count

    def delete_document(self, tenant_id: str, doc_id: str) -> None:
        supabase.table("knowledge_base").delete().eq(
            "tenant_id", tenant_id
        ).eq("id", doc_id).execute()
