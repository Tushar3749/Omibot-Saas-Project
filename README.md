# 🤖 OmniBot SaaS — Technical Blueprint v3.0

> বাংলাদেশের প্রথম Enterprise AI-Powered Omnichannel Customer Support SaaS  
> **Gemini 2.5 Flash · LangChain RAG · Facebook + Instagram · SSLCommerz**

---

## 📁 Project Structure

```
OmniBot-SaaS/
├── backend/                    # FastAPI Python backend
│   ├── app/
│   │   ├── main.py             # App entrypoint (Sentry, CORS, routes)
│   │   ├── config.py           # Settings via pydantic-settings
│   │   ├── database.py         # Supabase client
│   │   ├── auth/
│   │   │   ├── jwt_handler.py  # JWT create/decode
│   │   │   └── dependencies.py # FastAPI auth dependency
│   │   ├── models/
│   │   │   └── schemas.py      # Pydantic request/response schemas
│   │   ├── routers/
│   │   │   ├── auth.py         # Register, login
│   │   │   ├── webhook.py      # Facebook + Instagram webhooks
│   │   │   ├── products.py     # Product CRUD + RAG sync
│   │   │   ├── conversations.py# Conversation + takeover
│   │   │   ├── orders.py       # Order management
│   │   │   ├── analytics.py    # Dashboard analytics
│   │   │   ├── channels.py     # Page connect + Facebook OAuth
│   │   │   └── payment.py      # SSLCommerz payment
│   │   ├── services/
│   │   │   ├── ai_service.py   # Gemini 2.5 Flash + Function Calling
│   │   │   ├── rag_service.py  # LangChain RAG + pgvector
│   │   │   ├── memory_service.py # Summary + Structured State
│   │   │   ├── webhook_service.py# Message pipeline
│   │   │   └── payment_service.py# SSLCommerz integration
│   │   └── utils/
│   │       ├── security.py     # AES-256 token encryption
│   │       ├── prompt_guard.py # Prompt injection protection
│   │       └── rate_limiter.py # SlowAPI rate limits
│   ├── requirements.txt
│   ├── .env.example
│   └── Dockerfile
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # All tables + RLS + pgvector
└── frontend/                   # Next.js 14 dashboard
    ├── app/
    │   ├── (auth)/login/       # Login page
    │   ├── (auth)/register/    # Register page
    │   ├── onboarding/         # 6-step setup wizard
    │   └── (dashboard)/        # Protected dashboard
    │       ├── page.tsx        # Overview + charts
    │       ├── products/       # Product management
    │       ├── conversations/  # Chat view + takeover
    │       ├── orders/         # Order management
    │       ├── analytics/      # Analytics charts
    │       ├── channels/       # Facebook OAuth connect
    │       ├── settings/       # AI config + security
    │       └── subscription/   # Plans + SSLCommerz
    ├── lib/api.ts              # Typed API client
    ├── lib/utils.ts            # Helper functions
    └── types/index.ts          # TypeScript types
```

---

## 🚀 Setup Guide (Step by Step)

### Step 1 — Supabase Setup

1. Go to [supabase.com](https://supabase.com) → New Project
2. **SQL Editor** → Paste the entire content of `supabase/migrations/001_initial_schema.sql` → **Run**
3. Go to **Project Settings → API** → copy:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role secret` key → `SUPABASE_SERVICE_ROLE_KEY`

### Step 2 — Google Gemini API Key

1. Go to [aistudio.google.com](https://aistudio.google.com) → Get API Key
2. Copy the key → `GEMINI_API_KEY`

### Step 3 — Facebook App Setup

1. Go to [developers.facebook.com](https://developers.facebook.com) → Create App → **Business**
2. Add **Messenger** product
3. **App Settings → Basic**:
   - Copy `App ID` → `FACEBOOK_APP_ID`
   - Copy `App Secret` → `FACEBOOK_APP_SECRET`
4. **Messenger → Settings → Webhooks**:
   - Callback URL: `https://your-backend.railway.app/api/webhook/facebook`
   - Verify Token: your custom `FACEBOOK_VERIFY_TOKEN`
   - Subscribe to: `messages`, `messaging_postbacks`

### Step 4 — SSLCommerz (Bangladesh Payment)

1. Go to [sslcommerz.com](https://sslcommerz.com) → Merchant → Sandbox Account
2. Copy `Store ID` → `SSLCOMMERZ_STORE_ID`
3. Copy `Store Password` → `SSLCOMMERZ_STORE_PASS`

### Step 5 — Backend Setup

```bash
cd backend

# Copy and fill environment variables
cp .env.example .env
# Edit .env with your keys

# Create virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac/Linux

# Install dependencies
pip install -r requirements.txt

# Run development server
uvicorn app.main:app --reload --port 8000
```

**Verify:** Open http://localhost:8000/health → `{"status":"ok"}`

### Step 6 — Frontend Setup

```bash
cd frontend

# Copy env file
cp .env.local.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:8000

# Install dependencies
npm install

# Run development server
npm run dev
```

**Open:** http://localhost:3000

---

## 🌐 Deployment

### Backend → Railway

```bash
# railway.app → New Project → Deploy from GitHub
# Set all .env variables in Railway dashboard
# Railway auto-deploys on every git push
```

### Frontend → Vercel

```bash
# vercel.com → Import Git repository → Next.js
# Set NEXT_PUBLIC_API_URL=https://your-backend.railway.app
# Vercel deploys automatically
```

### After Deployment — Register Webhook

```
Facebook Developers → Messenger → Webhooks:
Callback URL: https://your-backend.railway.app/api/webhook/facebook
Verify Token: (same as FACEBOOK_VERIFY_TOKEN in .env)
```

---

## 🔑 Key Features Implementation

### ✅ Multi-Tenancy
Every DB row has `tenant_id`. Supabase RLS policies enforce `tenant_id = auth.uid()`. The FastAPI service role key bypasses RLS but manually filters by `tenant_id` in every query.

### ✅ Prompt Injection Protection
`app/utils/prompt_guard.py` scans every incoming message for 15+ Bangla + English injection patterns. Suspicious messages receive a canned response; normal messages proceed to AI.

### ✅ Conversation Memory
- **Structured State** (JSONB): customer name, product interest, negotiated price, phone, address — always available regardless of message count
- **Summary Approach**: After 20+ messages, Gemini summarises old messages. Only summary + last 5 messages are fed to the AI — infinite conversation support with minimal tokens

### ✅ Function Calling (Order Extraction)
Gemini is given two tools: `extract_order` and `update_conversation_state`. When a customer confirms an order, Gemini calls `extract_order` with structured data → saved to the `orders` table automatically.

### ✅ RAG Pipeline
Products and policies are embedded using `text-embedding-004` (768-dim vectors) and stored in `knowledge_base` with pgvector. On each webhook, the customer message is embedded and matched against the tenant's knowledge base (cosine similarity > 0.65).

### ✅ AES-256 Token Encryption
Facebook page access tokens are AES-256-CBC encrypted before database storage. Even if the database is compromised, tokens cannot be used without the `AES_SECRET_KEY`.

---

## 💰 Cost Estimate (MVP — 10 owners)

| Service       | Plan      | Cost/month |
|---------------|-----------|------------|
| Supabase      | Free      | $0         |
| Railway       | Starter   | $5         |
| Vercel        | Free      | $0         |
| Gemini 2.5    | Pay-as-go | ~$2–5      |
| Sentry        | Free      | $0         |
| **Total**     |           | **~$7–10** |

Revenue from 10 owners × ৳3,000 = **৳30,000/month**  
Infrastructure cost: **৳1,050/month**  
**Profit margin: 96%+** 🚀

---

## 📞 Support

- Email: tusharexremianz@gmail.com
- Blueprint version: v3.0 (2026)
