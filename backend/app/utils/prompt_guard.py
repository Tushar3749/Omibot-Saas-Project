"""
OmniBot SaaS — Prompt Injection Guard
Detects malicious patterns in customer messages and blocks them.
"""
import re
import logging

logger = logging.getLogger(__name__)

# ── Suspicious patterns (Bangla + English) ───────────────────────────────────
INJECTION_PATTERNS = [
    # Role-change attempts
    r"তুমি (এখন|আজ থেকে|এখন থেকে).*(হবে|হও|হ)",
    r"you are now",
    r"pretend (to be|you are|you're)",
    r"act as",
    r"roleplay as",
    r"from now on (you|you're|you are)",
    # System prompt extraction
    r"(তোমার|তোর|আপনার).*(system prompt|instructions?|rules?|নিয়ম|নির্দেশ).*(বলো|বলুন|দেখাও|দাও|বলে দাও)",
    r"(reveal|show|tell me|print|output|repeat).*(system prompt|instructions?|your rules|your prompt)",
    r"ignore (previous|all|your) instructions?",
    r"(পূর্ববর্তী|আগের|সব).*(নির্দেশ|instruction).*(উপেক্ষা|ignore)",
    # Jailbreak keywords
    r"jailbreak",
    r"DAN ",
    r"do anything now",
    r"developer mode",
    r"sudo ",
    # Override attempts
    r"override (your|the) (settings?|instructions?|rules?|constraints?)",
    r"forget (your|all|previous) (instructions?|rules?|training|constraints?)",
    r"disregard (your|all) (instructions?|rules?)",
]

COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE | re.UNICODE) for p in INJECTION_PATTERNS]


class PromptGuard:
    """Detects and blocks prompt-injection attempts."""

    def is_injection(self, message: str) -> bool:
        """Return True if the message contains an injection pattern."""
        for pattern in COMPILED_PATTERNS:
            if pattern.search(message):
                logger.warning(f"Injection pattern matched: {pattern.pattern!r}")
                return True
        return False

    def sanitize(self, message: str) -> str:
        """
        Light sanitization — strip unusual Unicode control chars.
        Does NOT strip Bengali text (those are regular Unicode letters).
        """
        # Remove null bytes and other C0/C1 control characters (keep \n \t \r)
        sanitized = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", message)
        return sanitized.strip()
