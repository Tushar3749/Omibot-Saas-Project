"""
OmniBot SaaS — Pydantic Request / Response Schemas
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional, Literal
from pydantic import BaseModel, EmailStr, Field


# ─── Auth ────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    business_name: str = Field(min_length=2, max_length=255)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    tenant: dict

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=6)


# ─── AI Config ───────────────────────────────────────────────────────────────

class AIConfigUpdate(BaseModel):
    bot_name: Optional[str] = None
    system_prompt: Optional[str] = None
    language: Optional[str] = None          # bangla | english | banglish
    allow_negotiation: Optional[bool] = None
    escalation_keywords: Optional[list[str]] = None
    forbidden_topics: Optional[list[str]] = None
    prompt_injection_guard: Optional[bool] = True
    # Negotiation
    max_discount_pct: Optional[float] = None
    negotiation_style: Optional[str] = None   # aggressive | moderate | soft
    negotiation_phrases: Optional[list[str]] = None


# ─── Products ────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=500)
    mrp: float = Field(gt=0)
    discount_price: Optional[float] = None
    discount_category: Optional[str] = None
    stock: Optional[int] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    min_price: Optional[float] = None
    negotiation_style: Optional[str] = None   # aggressive | moderate | soft
    extra_fields: Optional[dict] = None    # Schema-on-read JSONB for custom columns

class ProductUpdate(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    mrp: Optional[float] = None
    discount_price: Optional[float] = None
    discount_category: Optional[str] = None
    stock: Optional[int] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    min_price: Optional[float] = None
    negotiation_style: Optional[str] = None
    extra_fields: Optional[dict] = None
    is_active: Optional[bool] = None


# ─── Campaigns ────────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    type: str = Field(pattern=r'^(percentage|flat|bonus)$')
    amount: float = Field(gt=0)
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    apply_to: str = Field(default='all', pattern=r'^(all|specific)$')
    product_ids: Optional[list[str]] = None
    is_active: bool = True

class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None
    amount: Optional[float] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    apply_to: Optional[str] = None
    product_ids: Optional[list[str]] = None
    is_active: Optional[bool] = None


# ─── Test Bot ─────────────────────────────────────────────────────────────────

class TestBotMessage(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


# ─── Custom Product Columns ───────────────────────────────────────────────────

class CustomColumnCreate(BaseModel):
    column_name: str = Field(
        min_length=1, max_length=50,
        pattern=r'^[a-z][a-z0-9_]*$',
        description="snake_case key used in extra_fields JSONB and CSV headers"
    )
    display_name: str = Field(min_length=1, max_length=100)
    column_type: Literal["text", "number", "boolean", "url"] = "text"
    is_required: bool = False
    sort_order: int = 0


# ─── CSV Import ───────────────────────────────────────────────────────────────

class CSVImportWarning(BaseModel):
    row: int
    message: str

class CSVImportResponse(BaseModel):
    imported: int
    skipped: int
    errors: int
    total_rows: int
    warnings: list[CSVImportWarning]
    log_id: str


# ─── Knowledge Base ──────────────────────────────────────────────────────────

class KnowledgeDocCreate(BaseModel):
    content: str = Field(min_length=10)
    content_type: str = "policy"   # product | policy | faq
    metadata: Optional[dict] = None


# ─── Conversations ───────────────────────────────────────────────────────────

class TakeoverRequest(BaseModel):
    is_ai_active: bool


# ─── Orders ──────────────────────────────────────────────────────────────────

class OrderStatusUpdate(BaseModel):
    status: str    # pending | confirmed | shipped | delivered | cancelled


# ─── Payment ─────────────────────────────────────────────────────────────────

class PaymentInitRequest(BaseModel):
    plan: str       # starter | pro | enterprise
    customer_name: str
    customer_phone: str
    customer_address: Optional[str] = None


# ─── Channels ────────────────────────────────────────────────────────────────

class PageConnectRequest(BaseModel):
    page_id: str
    page_name: str
    access_token: str        # Plain-text; will be AES-encrypted before storing
    platform: str = "facebook"   # facebook | instagram


# ─── Analytics ───────────────────────────────────────────────────────────────

class AnalyticsResponse(BaseModel):
    total_conversations: int
    total_messages: int
    total_orders: int
    revenue_this_month: float
    messages_this_month: int
    top_products: list[dict]
    daily_stats: list[dict]
