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
  allow_negotiation: boolean
  escalation_keywords: string[]
  forbidden_topics: string[]
  prompt_injection_guard: boolean
  max_discount_pct: number | null
  negotiation_style: 'aggressive' | 'moderate' | 'soft' | null
  negotiation_phrases: string[]
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface Product {
  product_id: string
  tenant_id: string
  sku: string
  name: string
  mrp: number
  discount_price: number | null
  discount_category: string | null
  stock: number | null
  category: string | null
  image_url: string | null
  min_price: number | null
  negotiation_style: 'aggressive' | 'moderate' | 'soft' | null
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

export type CSVImportType = 'products' | 'stock' | 'campaign'

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
  customer_phone: string | null
  delivery_address: string | null
  notes: string | null
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled'
  created_at: string
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
