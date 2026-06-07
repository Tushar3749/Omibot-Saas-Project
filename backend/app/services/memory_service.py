"""
OmniBot SaaS — Conversation Memory Service  (google-genai SDK)
Two-layer memory strategy:
  1. Structured State  — key fields extracted from conversation (always carried)
  2. Summary Approach  — messages > 20 are summarised via Gemini
"""
import logging
from typing import Optional

from google import genai

from app.config import settings
from app.database import supabase

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=settings.GEMINI_API_KEY)

SUMMARY_THRESHOLD = 30
KEEP_RECENT       = 15


class MemoryService:

    # ── Context builder ───────────────────────────────────────────────────────

    def get_context_messages(
        self,
        conversation_id: str,
        raw_messages: list[dict],
        conversation_summary: Optional[str],
    ) -> list[dict]:
        """
        < 20 messages  → return all messages
        ≥ 20 messages  → return [SUMMARY_MSG] + last KEEP_RECENT messages
        """
        if len(raw_messages) < SUMMARY_THRESHOLD:
            return raw_messages

        recent = raw_messages[-KEEP_RECENT:]
        if conversation_summary:
            return [
                {"role": "system", "content": f"[কথোপকথনের সারসংক্ষেপ]\n{conversation_summary}"}
            ] + recent
        return recent

    # ── Summarisation ─────────────────────────────────────────────────────────

    def summarise_messages(self, messages_to_summarise: list[dict]) -> str:
        """Ask Gemini to produce a concise Bangla summary of old messages."""
        if not messages_to_summarise:
            return ""
        try:
            formatted = "\n".join(
                f"{'Customer' if m['role'] == 'customer' else 'Bot'}: {m['content']}"
                for m in messages_to_summarise
            )
            prompt = (
                "নিচের কথোপকথনটি সংক্ষেপ করো বাংলায়। "
                "গুরুত্বপূর্ণ তথ্য যেমন: পণ্যের নাম, দাম, customer-এর নাম, "
                "ঠিকানা, phone, আলোচনার অবস্থা — এগুলো অবশ্যই রাখো।\n\n"
                f"{formatted}"
            )
            response = _client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=prompt,
            )
            return response.text.strip()
        except Exception as e:
            logger.error(f"Summary generation failed: {e}")
            return ""

    def maybe_summarise(self, conversation_id: str) -> None:
        """
        Check message count. If ≥ SUMMARY_THRESHOLD, summarise old messages
        and update the conversation row in Supabase.
        """
        msgs_res = (
            supabase.table("messages")
            .select("role, content, created_at")
            .eq("conversation_id", conversation_id)
            .order("created_at")
            .execute()
        )
        messages = msgs_res.data or []

        if len(messages) < SUMMARY_THRESHOLD:
            return

        conv_res = (
            supabase.table("conversations")
            .select("conversation_summary")
            .eq("conversation_id", conversation_id)
            .single()
            .execute()
        )
        existing_summary = (conv_res.data or {}).get("conversation_summary", "")
        old_messages     = messages[: -KEEP_RECENT]

        new_summary = self.summarise_messages(old_messages)
        if existing_summary:
            new_summary = f"{existing_summary}\n\n[আপডেট] {new_summary}"

        supabase.table("conversations").update(
            {"conversation_summary": new_summary}
        ).eq("conversation_id", conversation_id).execute()

        logger.info(f"Summary updated for conversation {conversation_id}")

    # ── Structured State ──────────────────────────────────────────────────────

    def update_state(self, conversation_id: str, state_patch: dict) -> None:
        """Merge non-None values of `state_patch` into conversation_state JSONB."""
        conv_res = (
            supabase.table("conversations")
            .select("conversation_state")
            .eq("conversation_id", conversation_id)
            .single()
            .execute()
        )
        current_state = (conv_res.data or {}).get("conversation_state") or {}

        for k, v in state_patch.items():
            if v is not None:
                current_state[k] = v

        supabase.table("conversations").update(
            {"conversation_state": current_state}
        ).eq("conversation_id", conversation_id).execute()
