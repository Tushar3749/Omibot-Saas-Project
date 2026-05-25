-- ════════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Supabase Database Schema  (v3.0)
--  Run this in: Supabase Dashboard → SQL Editor → Run
-- ════════════════════════════════════════════════════════════════════════════

-- Enable pgvector extension for RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
--  1. TENANTS — Master account table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
    tenant_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    business_name   VARCHAR(255) NOT NULL,
    plan            TEXT NOT NULL DEFAULT 'starter'
                        CHECK (plan IN ('starter', 'pro', 'enterprise')),
    plan_expires_at TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    onboarding_done BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email);

-- ─────────────────────────────────────────────────────────────────────────────
--  2. AI_CONFIG — Bot personality and rules
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_config (
    config_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    bot_name                TEXT NOT NULL DEFAULT 'Assistant',
    system_prompt           TEXT,
    language                TEXT NOT NULL DEFAULT 'bangla'
                                CHECK (language IN ('bangla', 'english', 'banglish')),
    allow_negotiation       BOOLEAN NOT NULL DEFAULT false,
    escalation_keywords     TEXT[] DEFAULT '{}',
    forbidden_topics        TEXT[] DEFAULT '{}',
    prompt_injection_guard  BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_config_tenant ON ai_config(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  3. CONNECTED_PAGES — Facebook / Instagram pages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connected_pages (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    page_id                 TEXT NOT NULL,
    page_name               TEXT NOT NULL,
    platform                TEXT NOT NULL DEFAULT 'facebook'
                                CHECK (platform IN ('facebook', 'instagram')),
    access_token_encrypted  TEXT NOT NULL,
    is_active               BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(page_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_pages_page_id  ON connected_pages(page_id);
CREATE INDEX IF NOT EXISTS idx_pages_tenant   ON connected_pages(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  4. PRODUCTS — Product catalog
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    product_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT,
    price        NUMERIC(10, 2) NOT NULL CHECK (price > 0),
    min_price    NUMERIC(10, 2),
    stock        INTEGER,
    category     TEXT,
    image_url    TEXT,
    extra_fields JSONB NOT NULL DEFAULT '{}',   -- Schema-on-Read
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(tenant_id, is_active);

-- ─────────────────────────────────────────────────────────────────────────────
--  5. KNOWLEDGE_BASE — RAG documents with pgvector embeddings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_base (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    content      TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'general'
                     CHECK (content_type IN ('product', 'policy', 'faq', 'general')),
    metadata     JSONB NOT NULL DEFAULT '{}',
    source_id    TEXT,                           -- e.g. product_id
    embedding    vector(768),                    -- text-embedding-004 dimension
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_tenant        ON knowledge_base(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_content_type  ON knowledge_base(tenant_id, content_type);
-- IVFFlat index for fast approximate nearest-neighbour search
CREATE INDEX IF NOT EXISTS idx_kb_embedding ON knowledge_base
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ── Tenant-filtered vector similarity search function ────────────────────────
CREATE OR REPLACE FUNCTION match_knowledge_base(
    query_embedding vector(768),
    match_threshold float DEFAULT 0.65,
    match_count     int   DEFAULT 5,
    p_tenant_id     uuid  DEFAULT NULL
)
RETURNS TABLE (
    id           uuid,
    content      text,
    content_type text,
    metadata     jsonb,
    similarity   float
)
LANGUAGE sql STABLE AS $$
    SELECT
        kb.id,
        kb.content,
        kb.content_type,
        kb.metadata,
        1 - (kb.embedding <=> query_embedding) AS similarity
    FROM knowledge_base kb
    WHERE
        kb.tenant_id = p_tenant_id
        AND kb.embedding IS NOT NULL
        AND 1 - (kb.embedding <=> query_embedding) > match_threshold
    ORDER BY kb.embedding <=> query_embedding
    LIMIT match_count;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
--  6. CONVERSATIONS — Cross-channel customer threads
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    customer_platform_id TEXT NOT NULL,           -- Meta sender ID
    customer_phone      TEXT,                      -- For cross-channel identity
    platform            TEXT NOT NULL DEFAULT 'facebook'
                            CHECK (platform IN ('facebook', 'instagram')),
    is_ai_active        BOOLEAN NOT NULL DEFAULT true,
    conversation_state  JSONB NOT NULL DEFAULT '{}',   -- Structured State
    conversation_summary TEXT,                     -- Rolling summary after 20+ msgs
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_tenant    ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conv_platform  ON conversations(tenant_id, customer_platform_id, platform);

-- ─────────────────────────────────────────────────────────────────────────────
--  7. MESSAGES — Individual chat messages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    message_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('customer', 'bot', 'owner')),
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msgs_conv   ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msgs_tenant ON messages(tenant_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
--  8. ORDERS — AI-extracted orders via Function Calling
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    order_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    conversation_id      UUID REFERENCES conversations(conversation_id),
    customer_platform_id TEXT,
    product_name         TEXT NOT NULL,
    product_id           UUID REFERENCES products(product_id),
    quantity             INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    agreed_price         NUMERIC(10, 2),
    customer_phone       TEXT,
    delivery_address     TEXT,
    notes                TEXT,
    status               TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','confirmed','shipped','delivered','cancelled')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(tenant_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
--  9. TRANSACTIONS — SSLCommerz payment records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    tran_id        TEXT NOT NULL UNIQUE,          -- SSLCommerz transaction ID
    plan           TEXT NOT NULL,
    amount         NUMERIC(10, 2) NOT NULL,
    currency       TEXT NOT NULL DEFAULT 'BDT',
    status         TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_tenant ON transactions(tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  10. AUTO-UPDATE updated_at TRIGGER
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['tenants','ai_config','products','conversations','orders']
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS set_updated_at ON %I;
             CREATE TRIGGER set_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION update_updated_at();', tbl, tbl
        );
    END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
--  11. ROW-LEVEL SECURITY (Extra safety layer)
--      Note: FastAPI uses the service_role key which bypasses RLS.
--      These policies protect against direct DB access and future frontend queries.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_pages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions     ENABLE ROW LEVEL SECURITY;

-- Allow each tenant to see only their own data
-- (These are for anon/authenticated Supabase client — service_role bypasses them)

CREATE POLICY "tenants_own_data"
    ON tenants FOR ALL
    USING (tenant_id = auth.uid());

CREATE POLICY "ai_config_own"
    ON ai_config FOR ALL
    USING (tenant_id = auth.uid());

CREATE POLICY "pages_own"
    ON connected_pages FOR ALL
    USING (tenant_id = auth.uid());

CREATE POLICY "products_own"
    ON products FOR ALL
    USING (tenant_id = auth.uid());

CREATE POLICY "knowledge_base_own"
    ON knowledge_base FOR ALL
    USING (tenant_id = auth.uid());

CREATE POLICY "conversations_own"
    ON conversations FOR ALL
    USING (tenant_id = auth.uid());

CREATE POLICY "messages_own"
    ON messages FOR ALL
    USING (tenant_id = auth.uid());

CREATE POLICY "orders_own"
    ON orders FOR ALL
    USING (tenant_id = auth.uid());

CREATE POLICY "transactions_own"
    ON transactions FOR ALL
    USING (tenant_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
--  DONE! Schema is ready.
-- ─────────────────────────────────────────────────────────────────────────────
