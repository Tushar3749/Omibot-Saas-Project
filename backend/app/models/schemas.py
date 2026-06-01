"""
OmniBot SaaS — Pydantic Request / Response Schemas
"""
from __future__ import annotations
from datetime import datetime, date
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
    # Bot identity
    bot_name: Optional[str] = None
    system_prompt: Optional[str] = None
    language: Optional[str] = None
    escalation_keywords: Optional[list[str]] = None
    forbidden_topics: Optional[list[str]] = None
    prompt_injection_guard: Optional[bool] = True

    # Order management
    min_order_amount: Optional[float] = None
    max_order_qty_per_customer: Optional[int] = None
    preorder_enabled: Optional[bool] = None
    waitlist_enabled: Optional[bool] = None
    partial_payment_enabled: Optional[bool] = None
    partial_payment_advance_pct: Optional[float] = None
    payment_deadline_hours: Optional[int] = None
    installment_enabled: Optional[bool] = None

    # Message templates
    tpl_shipping_confirm: Optional[str] = None
    tpl_delay_notify: Optional[str] = None
    tpl_out_of_stock: Optional[str] = None
    tpl_wrong_item: Optional[str] = None
    tpl_review_request: Optional[str] = None
    tpl_referral: Optional[str] = None

    # Smart AI
    price_range_filter_enabled: Optional[bool] = None
    product_image_auto_send: Optional[bool] = None
    catalog_pdf_auto_send: Optional[bool] = None
    competitor_response_template: Optional[str] = None

    # Bangladesh specific
    pathao_store_id: Optional[str] = None
    pathao_client_id: Optional[str] = None
    pathao_client_secret: Optional[str] = None
    steadfast_api_key: Optional[str] = None
    steadfast_api_secret: Optional[str] = None
    sundarban_enabled: Optional[bool] = None
    hartal_mode: Optional[bool] = None
    hartal_message: Optional[str] = None
    friday_offline_enabled: Optional[bool] = None
    ramadan_mode: Optional[bool] = None
    ramadan_start_time: Optional[str] = None
    ramadan_end_time: Optional[str] = None
    eid_greeting_enabled: Optional[bool] = None
    eid_greeting_date: Optional[date] = None
    eid_greeting_message: Optional[str] = None

    # Loyalty & referral
    loyalty_enabled: Optional[bool] = None
    loyalty_points_per_taka: Optional[float] = None
    loyalty_min_redeem: Optional[int] = None
    loyalty_point_value: Optional[float] = None
    referral_enabled: Optional[bool] = None
    referral_discount_pct: Optional[float] = None
    referral_reward_pct: Optional[float] = None


# ─── Delivery Charges ─────────────────────────────────────────────────────────

class DeliveryChargeItem(BaseModel):
    district: str
    charge: float = Field(ge=0)

class DeliveryChargesUpdate(BaseModel):
    charges: list[DeliveryChargeItem]


# ─── Bulk Discount Rules ──────────────────────────────────────────────────────

class BulkDiscountRuleCreate(BaseModel):
    min_quantity: int = Field(ge=1)
    discount_pct: float = Field(ge=0, le=90)
    product_id: Optional[str] = None
    product_name: Optional[str] = None

class BulkDiscountRuleUpdate(BaseModel):
    min_quantity: Optional[int] = None
    discount_pct: Optional[float] = None
    is_active: Optional[bool] = None


# ─── Courier / Tracking ───────────────────────────────────────────────────────

class TrackingUpdate(BaseModel):
    tracking_number: str
    courier_name: str   # pathao | steadfast | sundarban | other

class CourierOrderCreate(BaseModel):
    order_id: str
    courier: str = Field(pattern=r'^(pathao|steadfast)$')
    recipient_name: str
    recipient_phone: str
    recipient_address: str
    recipient_city: str
    cod_amount: float = Field(ge=0)
    item_type: str = "parcel"
    note: Optional[str] = None


# ─── Products ────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=500)
    mrp: float = Field(gt=0)
    weight: Optional[str] = None
    initial_stock: Optional[int] = 0
    category: Optional[str] = None
    image_url: Optional[str] = None
    extra_fields: Optional[dict] = None

class ProductUpdate(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    mrp: Optional[float] = None
    weight: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    extra_fields: Optional[dict] = None
    is_active: Optional[bool] = None


# ─── Discount Categories ─────────────────────────────────────────────────────

class DiscountCategoryCreate(BaseModel):
    category_name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    is_active: bool = True

class DiscountCategoryUpdate(BaseModel):
    category_name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


# ─── Campaigns ────────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    reward: dict = Field(default_factory=lambda: {"reward_type": "percentage", "discount_value": 0, "bonus_items": []})
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    apply_to: str = Field(default='all', pattern=r'^(all|specific)$')
    product_ids: Optional[list[str]] = None
    discount_category_id: Optional[str] = None
    is_active: bool = True

class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    reward: Optional[dict] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    apply_to: Optional[str] = None
    product_ids: Optional[list[str]] = None
    discount_category_id: Optional[str] = None
    is_active: Optional[bool] = None


# ─── Test Bot ─────────────────────────────────────────────────────────────────

class TestBotMessage(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


# ─── Custom Product Columns ───────────────────────────────────────────────────

class CustomColumnCreate(BaseModel):
    column_name: str = Field(
        min_length=1, max_length=50,
        pattern=r'^[a-z][a-z0-9_]*$',
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
    content_type: str = "policy"
    metadata: Optional[dict] = None


# ─── Conversations ───────────────────────────────────────────────────────────

class TakeoverRequest(BaseModel):
    is_ai_active: bool


# ─── Orders ──────────────────────────────────────────────────────────────────

class OrderStatusUpdate(BaseModel):
    status: str


# ─── Payment ─────────────────────────────────────────────────────────────────

class PaymentInitRequest(BaseModel):
    plan: str
    customer_name: str
    customer_phone: str
    customer_address: Optional[str] = None


# ─── Channels ────────────────────────────────────────────────────────────────

class PageConnectRequest(BaseModel):
    page_id: str
    page_name: str
    access_token: str
    platform: str = "facebook"


# ─── Analytics ───────────────────────────────────────────────────────────────

class AnalyticsResponse(BaseModel):
    total_conversations: int
    total_messages: int
    total_orders: int
    revenue_this_month: float
    messages_this_month: int
    top_products: list[dict]
    daily_stats: list[dict]


# ─── Combos ──────────────────────────────────────────────────────────────────

class ComboProductItem(BaseModel):
    product_id: str
    quantity: int = Field(ge=1)

class ComboCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    price: float = Field(gt=0)
    image_url: Optional[str] = None
    products: list[ComboProductItem] = []

class ComboUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    image_url: Optional[str] = None
    is_active: Optional[bool] = None
    products: Optional[list[ComboProductItem]] = None


# ─── Stock ───────────────────────────────────────────────────────────────────

class StockManualUpdate(BaseModel):
    product_id: str
    quantity: int
    note: Optional[str] = None

class LowStockThreshold(BaseModel):
    threshold: int = Field(ge=0)


# ─── Returns ─────────────────────────────────────────────────────────────────

class ReturnItem(BaseModel):
    product_id: Optional[str] = None
    sku: Optional[str] = None
    name: str
    weight: Optional[str] = None
    quantity: int = Field(ge=1)
    reason: Optional[str] = None

class ReturnRejectRequest(BaseModel):
    owner_note: Optional[str] = None


# ─── Complaints ───────────────────────────────────────────────────────────────

class ComplaintCreate(BaseModel):
    conversation_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_id: Optional[str] = None
    product_mentioned: Optional[str] = None
    complaint_text: str = Field(min_length=5)
    complaint_type: str = 'general'
    priority: str = 'medium'

class ComplaintUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    resolution_note: Optional[str] = None


# ─── Negotiation Rules ────────────────────────────────────────────────────────

class NegotiationRuleCreate(BaseModel):
    product_id: str
    sku: str
    product_name: Optional[str] = None
    max_discount_pct: float = Field(default=15.0, ge=0, le=90)
    min_price: Optional[float] = None
    negotiation_style: str = Field(default='moderate', pattern=r'^(aggressive|moderate|soft)$')

class NegotiationRuleUpdate(BaseModel):
    max_discount_pct: Optional[float] = None
    min_price: Optional[float] = None
    negotiation_style: Optional[str] = None
    is_active: Optional[bool] = None
