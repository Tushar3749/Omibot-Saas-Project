'use client'
import { useEffect, useState } from 'react'
import { RotateCcw, Info, X, Users } from 'lucide-react'
import { conversationsAPI } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeDetail {
  title: string
  description: string
  botSays?: string
  customerSays?: string
  rules: string[]
}

interface FlowNode {
  id: string
  x: number; y: number; w: number; h: number
  type: 'customer' | 'bot' | 'process' | 'success' | 'error' | 'info'
  lines: string[]
  detail: NodeDetail
}

interface FlowEdge {
  d: string
  label?: string; lx?: number; ly?: number
  marker?: 'main' | 'green' | 'red' | 'loop'
  dashed?: boolean
}

// ─── Node colours ─────────────────────────────────────────────────────────────

const C = {
  customer: { bg: '#E3F2FD', border: '#1565C0', text: '#0D47A1', tag: 'Customer' },
  bot:      { bg: '#E8F5E9', border: '#2E7D32', text: '#1B5E20', tag: 'Bot' },
  process:  { bg: '#EDE7F6', border: '#5E35B1', text: '#4527A0', tag: 'System' },
  success:  { bg: '#E8F5E9', border: '#04AA6D', text: '#1B5E20', tag: '' },
  error:    { bg: '#FFEBEE', border: '#C62828', text: '#B71C1C', tag: '' },
  info:     { bg: '#FFF8E1', border: '#F57F17', text: '#E65100', tag: '' },
}

// ─── Flow data ────────────────────────────────────────────────────────────────

const NODES: FlowNode[] = [
  {
    id: 'intent', x: 240, y: 20, w: 280, h: 48,
    type: 'customer', lines: ['রিটার্ন করতে চাই / পণ্য নষ্ট'],
    detail: {
      title: 'রিটার্ন শুরু',
      description: 'Customer যখন পণ্য ফেরত দিতে চায়, bot সেটি detect করে return flow শুরু করে।',
      customerSays: '"ফেরত দিতে চাই", "পণ্য নষ্ট", "wrong item", "exchange করতে চাই"',
      rules: [
        'Bangla / English / Banglish সব ভাষায় trigger হয়',
        'Order flow চলাকালে return trigger block হয়',
        'Max returns per month limit enforce হয়',
        'Order flow active থাকলে: "আগে অর্ডার সম্পন্ন করুন"',
      ],
    },
  },
  {
    id: 'ask_order_id', x: 240, y: 116, w: 280, h: 48,
    type: 'bot', lines: ['Order ID জানা আছে?'],
    detail: {
      title: 'Order ID জিজ্ঞেস',
      description: 'Bot প্রথমে Order ID দিয়ে search করতে বলে। না জানলে phone দিয়ে খোঁজা হয়।',
      botSays: '"আপনার Order ID জানা আছে? (যেমন: ORD-20260609-A1B2)\nজানা না থাকলে \'জানি না\' বলুন।"',
      customerSays: '"ORD-20260609-A1B2" বা "জানি না"',
      rules: [
        'ORD-... format detect করে automatically',
        'Gemini AI দিয়ে intent classify করা হয়',
        'Order ID দিয়ে সরাসরি verify হয়',
        '"জানি না" বললে phone collection শুরু হয়',
      ],
    },
  },
  {
    id: 'phone_collect', x: 20, y: 212, w: 200, h: 48,
    type: 'bot', lines: ['Phone নম্বর চাও'],
    detail: {
      title: 'Phone দিয়ে অর্ডার খোঁজ',
      description: 'Order ID না জানলে bot phone number দিয়ে delivered orders খোঁজে।',
      botSays: '"📞 ফোন নম্বর দিন (01XXXXXXXXX):"',
      customerSays: '"01712345678"',
      rules: [
        'Bangladesh format (01X) validate করে',
        'শুধু delivered orders দেখায়',
        `Return window-এর মধ্যে orders ফিল্টার হয়`,
        'পাওয়া না গেলে flow বন্ধ হয়',
      ],
    },
  },
  {
    id: 'order_verify', x: 240, y: 212, w: 280, h: 48,
    type: 'process', lines: ['Order verify', '(delivered + window check)'],
    detail: {
      title: 'Order Verification',
      description: 'Bot নিশ্চিত করে: delivered status, return window, ও duplicate check।',
      rules: [
        'Status = "delivered" check করে',
        'Return window (ai_config.return_window_days) enforce করে',
        'Duplicate return check (pending/approved only)',
        'Combo order = full return only',
        'Phone মিলিয়ে verify করা হয় (phone flow-এ)',
      ],
    },
  },
  {
    id: 'order_list', x: 20, y: 308, w: 200, h: 48,
    type: 'bot', lines: ['Last 3 orders দেখাও'],
    detail: {
      title: 'Order List',
      description: 'Phone দিয়ে পাওয়া orders-এর list দেখানো হয়।',
      botSays: '"📋 আপনার সাম্প্রতিক অর্ডার:\n━━━━━━━━━\n1️⃣ #ORD-... (12 Jun)\n   🛒 পণ্যের নাম ×1\n   💰 ৳XXX"',
      customerSays: '"1" বা "2" বা "3"',
      rules: [
        'সর্বোচ্চ ৩টি অর্ডার দেখায়',
        'Gemini দিয়ে number intent classify করা হয়',
      ],
    },
  },
  {
    id: 'order_select', x: 240, y: 308, w: 280, h: 48,
    type: 'customer', lines: ['Order নির্বাচন করে'],
    detail: {
      title: 'Order নির্বাচন',
      description: 'Customer কোন order ফেরত দিতে চায় সেটি নির্বাচন করে।',
      customerSays: '"1", "2", "3" — list থেকে number বলে',
      rules: [
        'Already returned order re-select করলে block হয়',
        'Return window passed হলে block হয়',
      ],
    },
  },
  {
    id: 'show_items', x: 240, y: 404, w: 280, h: 48,
    type: 'bot', lines: ['Order-এর পণ্য দেখাও'],
    detail: {
      title: 'পণ্য তালিকা',
      description: 'Selected order-এর সব items দেখানো হয়।',
      botSays: '"📦 অর্ডার #ORD-... এর পণ্য:\n━━━━━━\n1️⃣ সরিষার তেল — 2 পিস (৳৩৬০)\n2️⃣ মধু — 1 পিস (৳২৮০)"',
      customerSays: '"সম্পূর্ণ" বা "নির্দিষ্ট"',
      rules: [
        'items JSONB থেকে পড়া হয়',
        'Fallback: single product fields ব্যবহার করে',
        'Combo order-এ partial option দেখায় না',
      ],
    },
  },
  {
    id: 'full_partial', x: 80, y: 500, w: 140, h: 44,
    type: 'info', lines: ['সম্পূর্ণ / আংশিক?'],
    detail: {
      title: 'Return Type নির্বাচন',
      description: 'Customer পুরো অর্ডার ফেরত দেবে নাকি নির্দিষ্ট কিছু পণ্য?',
      customerSays: '"সম্পূর্ণ", "full", "সব" — অথবা — "আংশিক", "partial", "নির্দিষ্ট"',
      rules: [
        'Single-item order-এ automatically full',
        'Combo order-এ full only',
        'Partial select করলে item list থেকে বেছে নিতে হয়',
      ],
    },
  },
  {
    id: 'item_select', x: 340, y: 500, w: 180, h: 44,
    type: 'customer', lines: ['পণ্য & পরিমাণ নির্বাচন'],
    detail: {
      title: 'Partial — Item নির্বাচন',
      description: 'Partial return-এ customer কোন পণ্য কত পিস ফেরত দেবে সেটি বলে।',
      customerSays: '"1" বা "2" → number; তারপর quantity যদি >1 হয়',
      rules: [
        'Multi-item selection supported',
        'Quantity > 1 হলে exact count জিজ্ঞেস করে',
        '"না"/"আর নেই" → পরের ধাপে যায়',
        'Gemini intent: done_adding_items',
      ],
    },
  },
  {
    id: 'reason', x: 240, y: 600, w: 280, h: 52,
    type: 'bot', lines: ['ফেরতের কারণ কী?'],
    detail: {
      title: 'কারণ সংগ্রহ',
      description: 'Bot ফেরতের কারণ জানতে চায় — predefined options বা free text।',
      botSays: '"ফেরতের কারণ কী?\n- পণ্য নষ্ট/ক্ষতিগ্রস্ত\n- ভুল পণ্য এসেছে\n- মান খারাপ\n- সাইজ/পরিমাণ ভুল\n- অন্য কারণ"',
      customerSays: '"tel ta kharap chilo" → Gemini extracts: পণ্য নষ্ট',
      rules: [
        'Gemini reason extraction — যেকোনো natural language বোঝে',
        'Bangla / English / Banglish সব accept করে',
        'Minimum 3 character reason দরকার',
      ],
    },
  },
  {
    id: 'photo', x: 240, y: 708, w: 280, h: 52,
    type: 'bot', lines: ['📷 পণ্যের ছবি পাঠাবেন? (হ্যাঁ/না)'],
    detail: {
      title: 'Photo সংগ্রহ (Optional)',
      description: 'Customer ছবি পাঠাতে চাইলে Gemini Vision দিয়ে validate করা হয়।',
      botSays: '"📷 পণ্যের ছবি পাঠালে দ্রুত অনুমোদন হবে।\nছবি পাঠাবেন? (হ্যাঁ/না)"',
      customerSays: '"হ্যাঁ" → ছবি পাঠায় | "না"/"skip" → ছাড়াই এগিয়ে যায়',
      rules: [
        'Gemini Vision: is_product_photo + damage_visible check করে',
        'Invalid photo (selfie, landscape) → "সঠিক ছবি পাঠান"',
        'Valid photo → photo_verified=true DB-তে save হয়',
        'Optional — skip করা যায়',
      ],
    },
  },
  {
    id: 'summary', x: 240, y: 820, w: 280, h: 68,
    type: 'bot', lines: ['📦 রিটার্ন Summary + Confirm'],
    detail: {
      title: 'Return Summary',
      description: 'Bot সম্পূর্ণ return summary দেখায়। Customer confirm বা modify করতে পারে।',
      botSays: '"📦 রিটার্ন রিকোয়েস্ট:\n━━━━━━━━━━━━━\n📋 অর্ডার: #ORD-...\n🔄 ধরন: আংশিক ফেরত\n📦 পণ্য:\n   • সরিষার তেল ×1 (৳১৮০)\n📝 কারণ: পণ্য নষ্ট\n📷 ছবি: ✅\n━━━━━━━━━━━━━\n✏️ পরিবর্তন করতে চাইলে বলুন\n✅ \'হ্যাঁ\' — নিশ্চিত করুন\n❌ \'না\' — বাতিল করুন"',
      customerSays: '"হ্যাঁ" / "কারণ পরিবর্তন" / "পণ্য পরিবর্তন" / "না"',
      rules: [
        'কারণ পরিবর্তন → collecting_reason step-এ ফেরে',
        'পণ্য পরিবর্তন → select_return_type step-এ ফেরে',
        'Summary নিশ্চিত না হওয়া পর্যন্ত বারবার দেখায়',
      ],
    },
  },
  {
    id: 'submitted', x: 60, y: 960, w: 210, h: 56,
    type: 'success', lines: ['✅ RET-YYYYMMDD-XXXX', 'Pending অনুমোদন'],
    detail: {
      title: 'Return Submitted',
      description: 'DB-তে return save হয় এবং owner dashboard-এ দেখা যায়।',
      botSays: '"✅ রিটার্ন রিকোয়েস্ট সফলভাবে নেওয়া হয়েছে!\n━━━━━━━━━\n📋 রিটার্ন ID: #RET-20260610-B2C3\n📦 পণ্য: সরিষার তেল ×1\n📝 কারণ: পণ্য নষ্ট\n━━━━━━━━━\nআমরা যাচাই করে শীঘ্রই জানাব। ধন্যবাদ! 🙏"',
      rules: [
        'Label format: RET-YYYYMMDD-XXXX',
        'Status: pending',
        'photo_verified বা False save হয়',
        'gemini_analysis JSONB save হয়',
        'conversation_id save হয় (notification-এর জন্য)',
      ],
    },
  },
  {
    id: 'cancelled', x: 490, y: 960, w: 210, h: 56,
    type: 'error', lines: ['❌ রিটার্ন বাতিল'],
    detail: {
      title: 'Return Cancelled',
      description: 'যেকোনো ধাপে বাতিল করলে return state clear হয়।',
      botSays: '"রিটার্ন প্রক্রিয়া বাতিল করা হয়েছে।"',
      rules: [
        'যেকোনো step থেকে "বাতিল"/"cancel" বললে হয়',
        'Conversation state clear হয়',
        'Customer নতুন return শুরু করতে পারে',
      ],
    },
  },
  {
    id: 'approved', x: 60, y: 1084, w: 210, h: 56,
    type: 'success', lines: ['✅ Owner Approved', 'Stock পুনরুদ্ধার'],
    detail: {
      title: 'Owner Approval',
      description: 'Owner dashboard থেকে approve করলে stock restore হয় এবং customer-কে notify করা হয়।',
      botSays: '"✅ আপনার রিটার্ন অনুমোদিত হয়েছে!"',
      rules: [
        'physical_stock += return quantity (per item)',
        'stock_history + stock_movements create হয়',
        'Order status → "returned" বা "partial_return"',
        'Customer-কে bot message পাঠানো হয়',
      ],
    },
  },
  {
    id: 'rejected', x: 490, y: 1084, w: 210, h: 56,
    type: 'error', lines: ['❌ Owner Rejected', 'Stock অপরিবর্তিত'],
    detail: {
      title: 'Owner Rejection',
      description: 'Owner reject করলে stock-এ কোনো পরিবর্তন হয় না এবং customer-কে কারণ জানানো হয়।',
      botSays: '"দুঃখিত, আপনার রিটার্ন প্রত্যাখ্যান করা হয়েছে।\nকারণ: ..."',
      rules: [
        'Stock unchanged',
        'owner_note DB-তে save হয়',
        'Customer-কে rejection কারণ পাঠানো হয়',
        'Return status → "rejected"',
      ],
    },
  },
]

const EDGES: FlowEdge[] = [
  // intent → ask_order_id
  { d: 'M 380 68 L 380 116', marker: 'main' },
  // ask_order_id → phone_collect (জানি না — left)
  { d: 'M 240 140 L 120 140 L 120 212', marker: 'main', label: 'জানি না', lx: 168, ly: 130 },
  // ask_order_id → order_verify (ORD-... — right)
  { d: 'M 380 164 L 380 212', marker: 'main', label: 'ORD-...', lx: 396, ly: 195 },
  // phone_collect → order_list
  { d: 'M 120 260 L 120 308', marker: 'main' },
  // order_list → order_select
  { d: 'M 220 332 L 240 332', marker: 'main' },
  // order_verify → show_items
  { d: 'M 380 260 L 380 404', marker: 'green', label: 'verified', lx: 396, ly: 338 },
  // order_select → order_verify
  { d: 'M 380 356 L 380 404', marker: 'main' },
  // show_items → full_partial (left)
  { d: 'M 310 452 L 150 452 L 150 500', marker: 'main', label: 'সম্পূর্ণ', lx: 210, ly: 442 },
  // show_items → item_select (right)
  { d: 'M 450 452 L 430 452 L 430 500', marker: 'main', label: 'আংশিক', lx: 478, ly: 442 },
  // full_partial → reason
  { d: 'M 150 544 L 150 624 L 240 624', marker: 'green' },
  // item_select → reason
  { d: 'M 430 544 L 430 624 L 520 624', marker: 'green' },
  // reason → photo
  { d: 'M 380 652 L 380 708', marker: 'main' },
  // photo → summary
  { d: 'M 380 760 L 380 820', marker: 'main' },
  // summary → submitted
  { d: 'M 310 888 L 165 888 L 165 960', marker: 'green', label: 'নিশ্চিত', lx: 220, ly: 878 },
  // summary → cancelled
  { d: 'M 450 888 L 595 888 L 595 960', marker: 'red', label: 'বাতিল', lx: 520, ly: 878 },
  // submitted → approved
  { d: 'M 165 1016 L 165 1084', marker: 'green', label: 'approve', lx: 180, ly: 1055 },
  // submitted → rejected
  { d: 'M 165 1016 L 595 1016 L 595 1084', marker: 'red', label: 'reject', lx: 390, ly: 1006 },
  // modify reason loop
  {
    d: 'M 240 854 L 180 854 L 180 624 L 240 624',
    marker: 'loop', dashed: true, label: 'কারণ পরিবর্তন', lx: 120, ly: 740,
  },
  // modify items loop
  {
    d: 'M 520 844 L 580 844 L 580 428 L 520 428',
    marker: 'loop', dashed: true, label: 'পণ্য পরিবর্তন', lx: 630, ly: 636,
  },
]

// ─── Step → node map ──────────────────────────────────────────────────────────

const STEP_TO_NODE: Record<string, string> = {
  asking_order_id:         'ask_order_id',
  collecting_return_phone: 'phone_collect',
  selecting_order:         'order_list',
  select_return_type:      'show_items',
  selecting_items:         'item_select',
  selecting_qty:           'item_select',
  collecting_reason:       'reason',
  collecting_photo:        'photo',
  awaiting_photo:          'photo',
  return_summary:          'summary',
}

const STEP_LABELS: Record<string, string> = {
  asking_order_id:         'Order ID জিজ্ঞেস',
  collecting_return_phone: 'Phone সংগ্রহ',
  selecting_order:         'Order নির্বাচন',
  select_return_type:      'Return Type নির্বাচন',
  selecting_items:         'Item নির্বাচন',
  selecting_qty:           'পরিমাণ নির্বাচন',
  collecting_reason:       'কারণ সংগ্রহ',
  collecting_photo:        'Photo জিজ্ঞেস',
  awaiting_photo:          'Photo প্রতীক্ষা',
  return_summary:          'Return Summary',
}

const ACTIVE_STEPS = new Set(Object.keys(STEP_LABELS))

const RULES = [
  { icon: '🔄', text: 'Cancel: যেকোনো step-এ customer বাতিল করতে পারে' },
  { icon: '💬', text: 'Random প্রশ্ন: return থামবে না — উত্তর দিয়ে চালিয়ে যাবে' },
  { icon: '😤', text: 'Frustrated: acknowledge করে clarify করবে' },
  { icon: '📷', text: 'Photo: Gemini Vision দিয়ে product photo validate হয়' },
  { icon: '🔒', text: 'Security: delivered + window + one return per order enforce হয়' },
  { icon: '🚫', text: 'Conflict: order flow active থাকলে return trigger block হয়' },
  { icon: '⏰', text: 'Timeout: ২ ঘণ্টা সাড়া না দিলে return state clear হয়' },
  { icon: '📦', text: 'Stock: approve হলে physical_stock বাড়ে, reject-এ অপরিবর্তিত' },
]

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ node, onClose }: { node: FlowNode; onClose: () => void }) {
  const col = C[node.type]
  return (
    <div className="card p-5 space-y-4" style={{ borderLeft: `4px solid ${col.border}` }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: col.bg, color: col.border }}>
            {col.tag || node.type}
          </span>
          <h3 className="text-base font-bold mt-1" style={{ color: 'var(--c-text)' }}>
            {node.detail.title}
          </h3>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"
                style={{ color: 'var(--c-muted)', flexShrink: 0 }}>
          <X size={15} />
        </button>
      </div>

      <p className="text-sm leading-relaxed" style={{ color: 'var(--c-text-2)' }}>
        {node.detail.description}
      </p>

      {node.detail.botSays && (
        <div className="rounded-lg p-3 space-y-1"
             style={{ backgroundColor: '#E8F5E9', border: '1px solid #A5D6A7' }}>
          <p className="text-xs font-semibold" style={{ color: '#2E7D32' }}>Bot বলে:</p>
          <p className="text-xs whitespace-pre-line" style={{ color: '#1B5E20' }}>
            {node.detail.botSays}
          </p>
        </div>
      )}

      {node.detail.customerSays && (
        <div className="rounded-lg p-3 space-y-1"
             style={{ backgroundColor: '#E3F2FD', border: '1px solid #90CAF9' }}>
          <p className="text-xs font-semibold" style={{ color: '#1565C0' }}>Customer বলতে পারে:</p>
          <p className="text-xs" style={{ color: '#0D47A1' }}>{node.detail.customerSays}</p>
        </div>
      )}

      {node.detail.rules.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--c-muted)' }}>
            এই ধাপে প্রযোজ্য নিয়ম:
          </p>
          <ul className="space-y-1.5">
            {node.detail.rules.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--c-text-2)' }}>
                <span className="mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: col.border, marginTop: 5 }} />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function DefaultPanel() {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Info size={16} style={{ color: '#04AA6D' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>
          কোনো node click করুন
        </span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--c-text-2)' }}>
        Diagram-এর যেকোনো node click করলে সেই ধাপের বিস্তারিত তথ্য দেখাবে — bot কী বলে, customer কী বলতে পারে, এবং কোন নিয়ম প্রযোজ্য।
      </p>
      <div className="space-y-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--c-muted)' }}>রঙের অর্থ:</p>
        {Object.entries(C).map(([type, col]) => col.tag ? (
          <div key={type} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: col.bg, border: `2px solid ${col.border}` }} />
            <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>
              {col.tag} — {type === 'customer' ? 'Customer message বা action' : type === 'bot' ? 'Bot message' : 'System / background process'}
            </span>
          </div>
        ) : null)}
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: C.success.bg, border: `2px solid ${C.success.border}` }} />
          <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>সফল পরিণতি / Approval</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: C.error.bg, border: `2px solid ${C.error.border}` }} />
          <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>বাতিল / Rejection</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: C.info.bg, border: `2px solid ${C.info.border}` }} />
          <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>বিকল্প পথ / Decision</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReturnProcessPage() {
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [activeNodes, setActiveNodes] = useState<string[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [activeSummary, setActiveSummary] = useState('')

  const selected = NODES.find(n => n.id === selectedId)

  useEffect(() => {
    async function loadActive() {
      try {
        const convs: Record<string, unknown>[] = await conversationsAPI.list()
        const active = convs.filter(c => {
          const state = c.conversation_state as Record<string, unknown> | null
          return state?.return_flow === 'active' && state?.return_step &&
                 ACTIVE_STEPS.has(state.return_step as string)
        })
        setActiveCount(active.length)
        const nodeIdSet: Record<string, true> = {}
        active.forEach(c => {
          const step = ((c.conversation_state as Record<string, unknown>)?.return_step as string) || ''
          const nid  = STEP_TO_NODE[step] || ''
          if (nid) nodeIdSet[nid] = true
        })
        setActiveNodes(Object.keys(nodeIdSet))
        if (active.length === 1) {
          const step = ((active[0].conversation_state as Record<string, unknown>)?.return_step as string) || ''
          setActiveSummary(STEP_LABELS[step] || step)
        } else if (active.length > 1) {
          const stepSet: Record<string, true> = {}
          active.forEach(c => {
            const lbl = STEP_LABELS[((c.conversation_state as Record<string, unknown>)?.return_step as string) || ''] || ''
            if (lbl) stepSet[lbl] = true
          })
          const steps = Object.keys(stepSet)
          setActiveSummary(steps.slice(0, 2).join(', ') + (steps.length > 2 ? '...' : ''))
        } else {
          setActiveSummary('')
        }
      } catch { /* silent */ }
    }
    loadActive()
    const id = setInterval(loadActive, 15_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h1 className="page-title flex items-center gap-2">
          <RotateCcw size={22} style={{ color: '#E53935' }} />
          রিটার্ন প্রক্রিয়া
        </h1>
        <p className="page-subtitle">Bot কীভাবে customer-এর রিটার্ন request handle করে তার সম্পূর্ণ flow</p>
      </div>

      {/* Live indicator */}
      {activeCount > 0 && (
        <div className="card p-3 flex items-center gap-3"
             style={{ borderLeft: '4px solid #E53935', backgroundColor: 'rgba(229,57,53,0.05)' }}>
          <div className="relative flex-shrink-0">
            <Users size={18} style={{ color: '#E53935' }} />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 animate-ping" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#E53935' }}>
              এখন {activeCount} জন customer রিটার্ন প্রক্রিয়ায় আছে
            </p>
            {activeSummary && (
              <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
                সক্রিয় ধাপ: {activeSummary}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Diagram + panel */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* SVG diagram */}
        <div className="card overflow-x-auto p-4 flex-1 min-w-0">
          <svg
            viewBox="0 0 760 1200"
            style={{ minWidth: 580, width: '100%', maxWidth: 760, display: 'block', margin: '0 auto' }}
          >
            <defs>
              {[
                { id: 'arr-main',  color: '#9E9E9E' },
                { id: 'arr-green', color: '#2E7D32' },
                { id: 'arr-red',   color: '#C62828' },
                { id: 'arr-loop',  color: '#1565C0' },
              ].map(({ id, color }) => (
                <marker key={id} id={id} markerWidth="8" markerHeight="6"
                        refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill={color} />
                </marker>
              ))}
              <filter id="glow2">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="shadow2" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.08" />
              </filter>
              <style>{`
                @keyframes glowPulse2 { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
                .glow-ring2 { animation: glowPulse2 1.8s ease-in-out infinite; }
              `}</style>
            </defs>

            {/* Edges */}
            {EDGES.map((e, i) => {
              const strokeColor = e.marker === 'green' ? '#4CAF50'
                                : e.marker === 'red'   ? '#EF5350'
                                : e.marker === 'loop'  ? '#42A5F5'
                                : '#BDBDBD'
              const markerId = e.marker === 'green' ? 'url(#arr-green)'
                             : e.marker === 'red'   ? 'url(#arr-red)'
                             : e.marker === 'loop'  ? 'url(#arr-loop)'
                             : 'url(#arr-main)'
              return (
                <g key={i}>
                  <path
                    d={e.d}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth="1.8"
                    strokeDasharray={e.dashed ? '6 4' : undefined}
                    markerEnd={markerId}
                  />
                  {e.label && (
                    <text
                      x={e.lx} y={e.ly}
                      fontSize="10" fontWeight="600"
                      fill={strokeColor}
                      textAnchor="middle"
                      style={{ fontFamily: 'inherit' }}
                    >
                      {e.label}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Nodes */}
            {NODES.map(node => {
              const col        = C[node.type]
              const isActive   = activeNodes.includes(node.id)
              const isSelected = selectedId === node.id
              const cx         = node.x + node.w / 2
              return (
                <g
                  key={node.id}
                  onClick={() => setSelectedId(prev => prev === node.id ? null : node.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {isActive && (
                    <rect
                      x={node.x - 4} y={node.y - 4}
                      width={node.w + 8} height={node.h + 8}
                      rx="14" ry="14"
                      fill="none"
                      stroke="#E53935"
                      strokeWidth="3"
                      className="glow-ring2"
                      filter="url(#glow2)"
                    />
                  )}
                  <rect
                    x={node.x} y={node.y} width={node.w} height={node.h}
                    rx="10" ry="10"
                    fill={col.bg}
                    stroke={isSelected ? '#FF8F00' : isActive ? '#E53935' : col.border}
                    strokeWidth={isSelected ? 2.5 : isActive ? 2 : 1.5}
                    filter="url(#shadow2)"
                  />
                  {col.tag && (
                    <rect
                      x={node.x} y={node.y}
                      width={4} height={node.h}
                      rx="2" ry="2"
                      fill={col.border}
                    />
                  )}
                  {node.lines.map((line, li) => {
                    const cy      = node.y + node.h / 2
                    const offsetY = node.lines.length > 1
                      ? (li - (node.lines.length - 1) / 2) * 16
                      : 0
                    return (
                      <text
                        key={li}
                        x={cx + (col.tag ? 2 : 0)}
                        y={cy + offsetY}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize="11.5"
                        fontWeight="600"
                        fill={col.text}
                        style={{ fontFamily: 'inherit', userSelect: 'none' }}
                      >
                        {line}
                      </text>
                    )
                  })}
                  {isSelected && (
                    <circle cx={node.x + node.w - 10} cy={node.y + 10} r="4" fill="#FF8F00" />
                  )}
                </g>
              )
            })}
          </svg>
        </div>

        {/* Right panel */}
        <div className="lg:w-80 xl:w-96 flex-shrink-0 space-y-4">
          {selected
            ? <DetailPanel node={selected} onClose={() => setSelectedId(null)} />
            : <DefaultPanel />
          }

          {/* Rules */}
          <div className="card p-4 space-y-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>
              সার্বজনীন নিয়ম
            </p>
            {RULES.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--c-text-2)' }}>
                <span className="flex-shrink-0">{r.icon}</span>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
