export interface Tenant {
  tenant_id: string
  email: string
  business_name: string
  plan: 'starter' | 'pro' | 'enterprise'
  plan_expires_at: string | null
  is_active: boolean
  onboarding_done: boolean
  created_at: string
}

export interface AIConfig {
  config_id: string
  tenant_id: string
  bot_name: string
  system_prompt: string | null
  language: 'bangla' | 'english' | 'banglish'
  conflict_resolution?: 'priority_wins' | 'best_deal' | 'stack_all' | 'stack_with_cap'
  escalation_keywords: string[]
  forbidden_topics: string[]
  prompt_injection_guard: boolean
  // Order management
  min_order_amount: number
  max_order_qty_per_customer: number
  preorder_enabled: boolean
  waitlist_enabled: boolean
  partial_payment_enabled: boolean
  partial_payment_advance_pct: number
  payment_deadline_hours: number
  installment_enabled: boolean
  // Message templates
  tpl_shipping_confirm: string | null
  tpl_delay_notify: string | null
  tpl_out_of_stock: string | null
  tpl_wrong_item: string | null
  tpl_review_request: string | null
  tpl_referral: string | null
  // Smart AI
  price_range_filter_enabled: boolean
  product_image_auto_send: boolean
  catalog_pdf_auto_send: boolean
  competitor_response_template: string | null
  // Bangladesh
  pathao_store_id: string | null
  pathao_client_id: string | null
  pathao_client_secret: string | null
  steadfast_api_key: string | null
  steadfast_api_secret: string | null
  sundarban_enabled: boolean
  hartal_mode: boolean
  hartal_message: string | null
  friday_offline_enabled: boolean
  ramadan_mode: boolean
  ramadan_start_time: string
  ramadan_end_time: string
  eid_greeting_enabled: boolean
  eid_greeting_date: string | null
  eid_greeting_message: string | null
  // SMS / OTP order tracking
  sms_enabled: boolean
  sms_provider: 'ssl_wireless' | 'twilio'
  ssl_wireless_api_key: string | null
  ssl_wireless_sid: string | null
  twilio_account_sid: string | null
  twilio_auth_token: string | null
  twilio_from_number: string | null
  // Loyalty & referral
  loyalty_enabled: boolean
  loyalty_points_per_taka: number
  loyalty_min_redeem: number
  loyalty_point_value: number
  referral_enabled: boolean
  referral_discount_pct: number
  referral_reward_pct: number
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface Product {
  product_id: string
  tenant_id: string
  sku: string
  name: string
  mrp: number
  current_stock: number
  category: string | null
  image_url: string | null
  extra_fields: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ProductCustomColumn {
  id: string
  tenant_id: string
  column_name: string
  display_name: string
  column_type: 'text' | 'number' | 'boolean' | 'url'
  is_required: boolean
  sort_order: number
  created_at: string
}

export type CSVImportType = 'products' | 'stock'

export interface CSVImportWarning {
  row: number
  message: string
}

export interface CSVImportResult {
  imported: number
  skipped: number
  errors: number
  total_rows: number
  warnings: CSVImportWarning[]
  log_id: string
}

export interface CSVImportLog {
  id: string
  import_type: CSVImportType
  filename: string | null
  total_rows: number
  imported: number
  skipped: number
  errors: number
  created_at: string
}

// ─── Conversations ────────────────────────────────────────────────────────────

export interface Conversation {
  conversation_id: string
  tenant_id: string
  customer_platform_id: string
  customer_phone: string | null
  platform: 'facebook' | 'instagram'
  is_ai_active: boolean
  conversation_state: {
    customer_name?: string
    interested_product?: string
    negotiated_price?: number
    customer_phone?: string
    delivery_location?: string
  }
  conversation_summary: string | null
  created_at: string
  updated_at: string
}

export interface Message {
  message_id: string
  conversation_id: string
  tenant_id: string
  role: 'customer' | 'bot' | 'owner'
  content: string
  created_at: string
}

export interface Order {
  order_id: string
  tenant_id: string
  conversation_id: string | null
  customer_platform_id: string | null
  product_name: string
  product_id: string | null
  quantity: number
  agreed_price: number | null
  original_amount: number | null
  net_amount: number | null
  discount_code: string | null
  customer_phone: string | null
  customer_name: string | null
  delivery_address: string | null
  notes: string | null
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled'
  tracking_number: string | null
  courier_name: string | null
  tracking_sent_at: string | null
  advance_paid: number | null
  payment_deadline_at: string | null
  created_at: string
}

// ─── Discount Rules ───────────────────────────────────────────────────────────

export interface DiscountRule {
  rule_id: string
  tenant_id: string
  rule_name: string
  rule_type: string
  conditions: Record<string, unknown>
  reward: {
    reward_type: 'percentage' | 'flat' | 'bonus' | 'free_delivery'
    discount_value: number
    bonus_items: Array<{ product_id: string; sku: string; name: string; quantity: number }>
  }
  created_at: string
}

// ─── Discounts (named offers) ─────────────────────────────────────────────────

export interface Discount {
  discount_id: string
  tenant_id: string
  discount_name: string
  discount_code: string
  rule_ids: string[]
  effective_from: string
  effective_to: string | null
  is_lifetime: boolean
  is_active: boolean
  priority: number
  created_at: string
  // enriched by API
  rules?: DiscountRule[]
  orders_count?: number
  total_discount_amount?: number
  order_discounts?: OrderDiscount[]
}

// ─── Order Discounts (applied log) ───────────────────────────────────────────

export interface OrderDiscount {
  id: string
  tenant_id: string
  order_id: string
  discount_id: string
  discount_code: string
  discount_name: string
  rule_id: string
  rule_name: string
  rule_type: string
  product_id: string | null
  sku: string | null
  product_name: string | null
  reward_type: string
  discount_pct: number
  discount_flat: number
  bonus_items: Array<{ product_id: string; sku: string; name: string; quantity: number }>
  original_price: number | null
  discount_amount: number
  final_price: number | null
  created_at: string
  // enriched by GET /{discount_id}
  customer_phone?: string | null
  customer_name?: string | null
}

export interface DiscountReportRow {
  discount_id: string
  discount_code: string
  discount_name: string
  rules_count: number
  orders_count: number
  total_discount_amount: number
  is_active: boolean
  priority: number
}

export interface DiscountMonthSummary {
  year: number
  month: number
  label: string
  orders_count: number
  total_discount_amount: number
  active_discounts_count: number
}

export interface DiscountMonthDetail {
  year: number
  month: number
  label: string
  total_discount_amount: number
  total_orders: number
  active_discounts: number
  rows: DiscountReportRow[]
}

export interface DiscountBreakdown {
  discount_code: string | null
  rows: DiscountRow[]
  total_discount: number
  original_amount: number | null
  net_amount: number | null
}

export interface ConnectedPage {
  page_id: string
  page_name: string
  platform: 'facebook' | 'instagram'
  is_active: boolean
  created_at: string
}

export interface AnalyticsOverview {
  total_conversations: number
  total_messages: number
  messages_this_month: number
  total_orders: number
  revenue_total: number
  top_products: Array<{ name: string; count: number }>
}

export interface ProductImage {
  image_id:          string
  tenant_id?:        string
  product_id:        string
  image_url:         string
  image_description: string | null
  is_primary:        boolean
  created_at:        string
}

export interface DeliveryCharge {
  district: string
  charge: number
}

export interface BulkDiscountRule {
  id: string
  tenant_id: string
  min_quantity: number
  discount_pct: number
  product_id: string | null
  product_name: string | null
  is_active: boolean
  created_at: string
}
