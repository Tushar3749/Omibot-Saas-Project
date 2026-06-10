'use client'
import { useEffect, useState } from 'react'
import { GitBranch, Info, X, ArrowDown, Users } from 'lucide-react'
import { conversationsAPI } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeDetail {
  title: string
  description: string
  botSays?: string
  customerSays?: string
  randomQuestion?: string
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
    id: 'intent', x: 280, y: 20, w: 260, h: 48,
    type: 'customer', lines: ['অর্ডার দিতে চাই'],
    detail: {
      title: 'অর্ডার শুরু',
      description: 'Customer যখন কিছু কিনতে চায় বা দাম জিজ্ঞেস করে, bot সেটি detect করে order flow শুরু করে।',
      customerSays: '"order dite chai", "kinbo", "price koto", "ekta diben?"',
      rules: [
        'Bangla / English / Banglish সব ভাষায় trigger হয়',
        'Order-related keyword bot detect করে',
        'AI conversation-এ active থাকলেই কাজ করে',
      ],
    },
  },
  {
    id: 'ask_product', x: 280, y: 116, w: 260, h: 48,
    type: 'bot', lines: ['কোন পণ্য নেবেন?'],
    detail: {
      title: 'পণ্য নির্বাচন',
      description: 'Bot customer-কে কোন পণ্য চান তা জিজ্ঞেস করে।',
      botSays: '"কোন পণ্য নেবেন? 🛍️"',
      customerSays: 'পণ্যের নাম বলুন — exact বা approximate',
      randomQuestion: 'অন্য প্রশ্নের উত্তর দিয়ে আবার product জিজ্ঞেস করে।',
      rules: [
        'DB catalog থেকে fuzzy matching করে',
        'Multiple products একসাথে handle করে',
        'Available stock আছে কিনা check করে',
      ],
    },
  },
  {
    id: 'say_product', x: 280, y: 212, w: 260, h: 48,
    type: 'customer', lines: ['পণ্যের নাম বলে'],
    detail: {
      title: 'Customer পণ্যের নাম বলে',
      description: 'Customer পণ্যের নাম উল্লেখ করে — partial name বা পুরো নাম চলে।',
      customerSays: '"আটা", "chini 1 kg", "সয়াবিন তেল", "2 kg tel"',
      rules: [
        'Case-insensitive partial name matching',
        'Gemini AI দিয়ে product name extract করা হয়',
        'Multiple products একবারে বললেও ধরে',
      ],
    },
  },
  {
    id: 'db_search', x: 280, y: 308, w: 260, h: 48,
    type: 'process', lines: ['DB-তে পণ্য খোঁজ'],
    detail: {
      title: 'Database-এ পণ্য খোঁজ',
      description: 'Bot আপনার product database-এ পণ্যটি খোঁজে এবং stock check করে।',
      rules: [
        'Active products-এ search হয়',
        'Stock 0 হলে "পাওয়া যায়নি" বলে',
        'Closest match use করে (exact না হলেও)',
        'পাওয়া না গেলে customer-কে জানানো হয়',
      ],
    },
  },
  {
    id: 'not_found', x: 592, y: 308, w: 188, h: 48,
    type: 'info', lines: ['পাওয়া যায়নি'],
    detail: {
      title: 'পণ্য পাওয়া যায়নি',
      description: 'পণ্য DB-তে নেই বা stock শেষ হলে bot জানায়।',
      botSays: '"দুঃখিত, এই পণ্যটি এখন নেই। অন্য কিছু নেবেন?"',
      rules: [
        'Order flow থামে না',
        'Customer অন্য পণ্য বলতে পারে',
        'Stock-শেষ হলেও এই message আসে',
      ],
    },
  },
  {
    id: 'ask_qty', x: 280, y: 428, w: 260, h: 48,
    type: 'bot', lines: ['কত পিস/কেজি নেবেন?'],
    detail: {
      title: 'পরিমাণ জিজ্ঞেস',
      description: 'পণ্য পাওয়া গেলে Bot quantity জিজ্ঞেস করে।',
      botSays: '"[পণ্যের নাম] — কত পিস নেবেন?"',
      customerSays: '"২ পিস", "৫ কেজি", "একটা", "3"',
      randomQuestion: 'অন্য প্রশ্নের উত্তর দিয়ে আবার quantity জিজ্ঞেস করে।',
      rules: [
        'Bangla (১, ২) + English (1, 2) সব বোঝে',
        'Available stock-এর বেশি order করলে জানায়',
        'Max quantity limit (AI config থেকে) enforce হয়',
      ],
    },
  },
  {
    id: 'say_qty', x: 280, y: 524, w: 260, h: 48,
    type: 'customer', lines: ['পরিমাণ বলে (২ পিস)'],
    detail: {
      title: 'Customer পরিমাণ বলে',
      description: 'Customer কত পিস / কেজি চান তা বলে।',
      customerSays: '"২ পিস", "5", "তিনটা"',
      rules: [
        'issued_stock update হয় immediately',
        'Cart-এ add করা হয়',
      ],
    },
  },
  {
    id: 'cart_added', x: 280, y: 620, w: 260, h: 48,
    type: 'bot', lines: ['কার্টে যোগ। আর কিছু?'],
    detail: {
      title: 'Cart-এ যোগ হয়েছে',
      description: 'Bot cart confirm করে এবং আর কিছু লাগবে কিনা জিজ্ঞেস করে।',
      botSays: '"✅ [পণ্য] × [পরিমাণ] কার্টে যোগ হয়েছে!\nআর কিছু নেবেন?"',
      customerSays: '"হ্যাঁ" → আরো পণ্য | "না" → checkout শুরু',
      rules: [
        'Multi-item cart support করে',
        '"হ্যাঁ" বললে আবার product selection-এ ফেরে (বাম loop)',
        'Discount preview calculate হয়',
      ],
    },
  },
  {
    id: 'ask_name', x: 280, y: 760, w: 260, h: 48,
    type: 'bot', lines: ['আপনার নাম কি?'],
    detail: {
      title: 'নাম সংগ্রহ',
      description: 'Bot customer-এর নাম জিজ্ঞেস করে।',
      botSays: '"আপনার নাম জানতে পারি?"',
      customerSays: '"রহিম", "MD Karim", "Tushar"',
      randomQuestion: 'উত্তর দিয়ে আবার নাম জিজ্ঞেস করে।',
      rules: [
        'আগের conversation থেকে নাম জানা থাকলে confirm করে',
        'নাম order-এ save হয়',
      ],
    },
  },
  {
    id: 'ask_phone', x: 280, y: 856, w: 260, h: 48,
    type: 'bot', lines: ['ফোন নম্বর দিন'],
    detail: {
      title: 'ফোন নম্বর সংগ্রহ',
      description: 'Bot customer-এর ফোন নম্বর চায়।',
      botSays: '"আপনার ফোন নম্বর দিন"',
      customerSays: '"01XXXXXXXXX"',
      randomQuestion: 'উত্তর দিয়ে আবার ফোন নম্বর চায়।',
      rules: [
        'Bangladesh format (01X) validate করে',
        '017 / 018 / 019 / 016 সব network accept করে',
      ],
    },
  },
  {
    id: 'ask_address', x: 280, y: 952, w: 260, h: 48,
    type: 'bot', lines: ['ডেলিভারি ঠিকানা?'],
    detail: {
      title: 'ঠিকানা সংগ্রহ',
      description: 'Bot ডেলিভারি ঠিকানা চায়। Address থেকে district auto-detect হয়।',
      botSays: '"ডেলিভারি ঠিকানা দিন (জেলাসহ লিখুন)"',
      customerSays: '"Mirpur-10, Dhaka", "Sylhet Sadar", "চট্টগ্রাম"',
      rules: [
        'Address থেকে district auto-detect করে',
        'District পেলে delivery charge fetch করে',
        'District না পেলে আলাদাভাবে জিজ্ঞেস করে (ask_district step)',
      ],
    },
  },
  {
    id: 'district', x: 280, y: 1068, w: 260, h: 52,
    type: 'process', lines: ['District detect', '→ Delivery charge'],
    detail: {
      title: 'District Detection & Delivery Charge',
      description: 'Address থেকে district বের করে delivery_charges table-এ lookup করে।',
      rules: [
        'Gemini AI দিয়ে district extract করা হয়',
        'delivery_charges table-এ charge lookup করে',
        'District না পেলে bot আলাদাভাবে জিজ্ঞেস করে',
        'Charge order summary-তে আলাদা লাইনে দেখায়',
        'District + charge দুটোই order row-এ save হয়',
      ],
    },
  },
  {
    id: 'summary', x: 280, y: 1176, w: 260, h: 48,
    type: 'bot', lines: ['Order Summary + Discount'],
    detail: {
      title: 'Order Summary',
      description: 'Bot সম্পূর্ণ order summary দেখায় — পণ্য, দাম, discount, delivery charge সহ।',
      botSays: '"📦 অর্ডার কনফার্ম করুন:\n━━━━━━━\n[পণ্য তালিকা]\n🛒 সাবটোটাল: ৳X\n🚚 ডেলিভারি (Dhaka): ৳Y\n💰 নেট মোট: ৳Z"',
      customerSays: '"হ্যাঁ" / "confirm" → order confirm | "না" / "cancel" → বাতিল',
      randomQuestion: 'Customer নাম/ঠিকানা পরিবর্তন করতে বললে সেই step-এ ফেরে।',
      rules: [
        'Discount automatically calculate এবং apply হয়',
        'Customer এখানে নাম/ঠিকানা edit করতে পারে',
        'নিশ্চিত না হওয়া পর্যন্ত summary বারবার দেখায়',
      ],
    },
  },
  {
    id: 'confirmed', x: 70, y: 1308, w: 230, h: 52,
    type: 'success', lines: ['✅ Order Pending'],
    detail: {
      title: 'Order Confirmed',
      description: 'Customer confirm করলে order create হয় এবং owner-কে notification যায়।',
      botSays: '"✅ অর্ডার সফলভাবে নেওয়া হয়েছে!\nID: #ORD-XXXX"',
      rules: [
        'DB-তে order insert হয় (status: pending)',
        'issued_stock বাড়ে (stock reserved)',
        'Owner dashboard-এ notification যায়',
        'Customer-কে order ID দেওয়া হয়',
      ],
    },
  },
  {
    id: 'cancelled', x: 520, y: 1308, w: 230, h: 52,
    type: 'error', lines: ['❌ Order বাতিল'],
    detail: {
      title: 'Order Cancelled',
      description: 'Customer না বললে বা cancel করলে order বাতিল হয়।',
      botSays: '"❌ অর্ডার বাতিল করা হয়েছে।"',
      rules: [
        'Cart clear হয়',
        'Stock-এ কোনো পরিবর্তন হয় না',
        'Customer নতুন order শুরু করতে পারে',
        'যেকোনো step থেকে cancel করা যায়',
      ],
    },
  },
]

const EDGES: FlowEdge[] = [
  // Main vertical flow
  { d: 'M 410 68 L 410 116', marker: 'main' },
  { d: 'M 410 164 L 410 212', marker: 'main' },
  { d: 'M 410 260 L 410 308', marker: 'main' },
  // db_search → ask_qty (found)
  { d: 'M 410 356 L 410 428', marker: 'green', label: 'পাওয়া গেছে', lx: 422, ly: 398 },
  // db_search → not_found (right branch)
  { d: 'M 540 332 L 592 332', marker: 'main', label: 'পাওয়া যায়নি', lx: 554, ly: 322 },
  // ask_qty → say_qty → cart_added
  { d: 'M 410 476 L 410 524', marker: 'main' },
  { d: 'M 410 572 L 410 620', marker: 'main' },
  // cart_added → ask_name (না)
  { d: 'M 410 668 L 410 760', marker: 'main', label: 'না', lx: 422, ly: 715 },
  // cart_added loop back (হ্যাঁ)
  {
    d: 'M 280 644 L 60 644 L 60 140 L 280 140',
    marker: 'loop', dashed: true, label: 'হ্যাঁ', lx: 14, ly: 400,
  },
  // ask_name → ask_phone → ask_address
  { d: 'M 410 808 L 410 856', marker: 'main' },
  { d: 'M 410 904 L 410 952', marker: 'main' },
  // ask_address → district
  { d: 'M 410 1000 L 410 1068', marker: 'main' },
  // district → summary
  { d: 'M 410 1120 L 410 1176', marker: 'main' },
  // summary → confirmed (confirm)
  { d: 'M 410 1224 L 185 1224 L 185 1308', marker: 'green', label: 'নিশ্চিত', lx: 288, ly: 1215 },
  // summary → cancelled (cancel)
  { d: 'M 410 1224 L 635 1224 L 635 1308', marker: 'red', label: 'বাতিল', lx: 528, ly: 1215 },
]

// ─── Step → node ID map (for live indicator) ─────────────────────────────────

const STEP_TO_NODE: Record<string, string> = {
  ask_quantity:      'ask_qty',
  confirm_add:       'cart_added',
  ask_name:          'ask_name',
  ask_phone:         'ask_phone',
  ask_address:       'ask_address',
  ask_district:      'district',
  show_summary:      'summary',
  selecting_products:'ask_product',
}

const STEP_LABELS: Record<string, string> = {
  ask_quantity:      'পণ্যের পরিমাণ',
  confirm_add:       'কার্ট নিশ্চিতকরণ',
  ask_name:          'নাম সংগ্রহ',
  ask_phone:         'ফোন সংগ্রহ',
  ask_address:       'ঠিকানা সংগ্রহ',
  ask_district:      'District সংগ্রহ',
  show_summary:      'Order Summary',
  selecting_products:'পণ্য নির্বাচন',
}

const ACTIVE_STEPS = new Set(Object.keys(STEP_LABELS))

const RULES = [
  { icon: '🔄', text: 'Order cancel: যেকোনো step-এ customer বাতিল করতে পারে' },
  { icon: '💬', text: 'Random প্রশ্ন: order থামবে না — উত্তর দিয়ে চালিয়ে যাবে' },
  { icon: '🏷️', text: 'Discount: summary-তে automatically calculate হবে' },
  { icon: '🚚', text: 'Delivery charge: district থেকে auto detect হবে' },
  { icon: '📦', text: 'Stock check: available stock না থাকলে জানাবে' },
  { icon: '🚫', text: 'Abuse: ৩ বার গালি দিলে owner-কে handover করবে' },
  { icon: '⏰', text: 'Timeout: ২ ঘণ্টা সাড়া না দিলে "abandoned" মেসেজ পাঠাবে' },
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

      {node.detail.randomQuestion && (
        <div className="rounded-lg p-3 space-y-1"
             style={{ backgroundColor: '#FFF8E1', border: '1px solid #FFE082' }}>
          <p className="text-xs font-semibold" style={{ color: '#F57F17' }}>Random প্রশ্ন হলে:</p>
          <p className="text-xs" style={{ color: '#E65100' }}>{node.detail.randomQuestion}</p>
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
        Diagram-এর যেকোনো node click করলে সেই ধাপের বিস্তারিত তথ্য এখানে দেখাবে — bot কী বলে, customer কী বলতে পারে, এবং কোন নিয়ম প্রযোজ্য।
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
          <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>সফল পরিণতি</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: C.error.bg, border: `2px solid ${C.error.border}` }} />
          <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>বাতিল পরিণতি</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: C.info.bg, border: `2px solid ${C.info.border}` }} />
          <span className="text-xs" style={{ color: 'var(--c-text-2)' }}>তথ্য / বিকল্প পথ</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrderProcessPage() {
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
          const step  = state?.current_step as string | undefined
          return step && ACTIVE_STEPS.has(step)
        })
        setActiveCount(active.length)
        const nodeIdSet: Record<string, true> = {}
        active.forEach(c => {
          const step = ((c.conversation_state as Record<string, unknown>)?.current_step as string) || ''
          const nid  = STEP_TO_NODE[step] || ''
          if (nid) nodeIdSet[nid] = true
        })
        setActiveNodes(Object.keys(nodeIdSet))
        if (active.length === 1) {
          const step = ((active[0].conversation_state as Record<string, unknown>)?.current_step as string) || ''
          setActiveSummary(STEP_LABELS[step] || step)
        } else if (active.length > 1) {
          const stepSet: Record<string, true> = {}
          active.forEach(c => {
            const lbl = STEP_LABELS[((c.conversation_state as Record<string, unknown>)?.current_step as string) || ''] || ''
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
          <GitBranch size={22} style={{ color: '#04AA6D' }} />
          অর্ডার প্রক্রিয়া
        </h1>
        <p className="page-subtitle">Bot কীভাবে customer-এর order handle করে তার সম্পূর্ণ flow</p>
      </div>

      {/* Live indicator */}
      {activeCount > 0 && (
        <div className="card p-3 flex items-center gap-3"
             style={{ borderLeft: '4px solid #04AA6D', backgroundColor: 'rgba(4,170,109,0.05)' }}>
          <div className="relative flex-shrink-0">
            <Users size={18} style={{ color: '#04AA6D' }} />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-500 animate-ping" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-500" />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#04AA6D' }}>
              এখন {activeCount} জন customer অর্ডার প্রক্রিয়ায় আছে
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
            viewBox="0 0 820 1430"
            style={{ minWidth: 600, width: '100%', maxWidth: 820, display: 'block', margin: '0 auto' }}
          >
            <defs>
              {/* Arrowhead markers */}
              {[
                { id: 'arrow-main',  color: '#9E9E9E' },
                { id: 'arrow-green', color: '#2E7D32' },
                { id: 'arrow-red',   color: '#C62828' },
                { id: 'arrow-loop',  color: '#1565C0' },
              ].map(({ id, color }) => (
                <marker key={id} id={id} markerWidth="8" markerHeight="6"
                        refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill={color} />
                </marker>
              ))}
              {/* Active glow filter */}
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {/* Drop shadow */}
              <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.08" />
              </filter>
              <style>{`
                @keyframes glowPulse {
                  0%, 100% { opacity: 0.5; }
                  50% { opacity: 1; }
                }
                .glow-ring { animation: glowPulse 1.8s ease-in-out infinite; }
              `}</style>
            </defs>

            {/* ── Edges ──────────────────────────────────────────────────── */}
            {EDGES.map((e, i) => {
              const markerUrl = e.marker === 'green' ? 'url(#arrow-green)'
                              : e.marker === 'red'   ? 'url(#arrow-red)'
                              : e.marker === 'loop'  ? 'url(#arrow-loop)'
                              : 'url(#arrow-main)'
              const strokeColor = e.marker === 'green' ? '#4CAF50'
                                : e.marker === 'red'   ? '#EF5350'
                                : e.marker === 'loop'  ? '#42A5F5'
                                : '#BDBDBD'
              return (
                <g key={i}>
                  <path
                    d={e.d}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth="1.8"
                    strokeDasharray={e.dashed ? '6 4' : undefined}
                    markerEnd={markerUrl}
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

            {/* ── Nodes ──────────────────────────────────────────────────── */}
            {NODES.map(node => {
              const col     = C[node.type]
              const isActive  = activeNodes.includes(node.id)
              const isSelected = selectedId === node.id
              const cx = node.x + node.w / 2
              return (
                <g
                  key={node.id}
                  onClick={() => setSelectedId(prev => prev === node.id ? null : node.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Active glow ring */}
                  {isActive && (
                    <rect
                      x={node.x - 4} y={node.y - 4}
                      width={node.w + 8} height={node.h + 8}
                      rx="14" ry="14"
                      fill="none"
                      stroke="#04AA6D"
                      strokeWidth="3"
                      className="glow-ring"
                      filter="url(#glow)"
                    />
                  )}
                  {/* Node background */}
                  <rect
                    x={node.x} y={node.y} width={node.w} height={node.h}
                    rx="10" ry="10"
                    fill={col.bg}
                    stroke={isSelected ? '#FF8F00' : isActive ? '#04AA6D' : col.border}
                    strokeWidth={isSelected ? 2.5 : isActive ? 2 : 1.5}
                    filter="url(#shadow)"
                  />
                  {/* Type badge on left side */}
                  {col.tag && (
                    <rect
                      x={node.x} y={node.y}
                      width={4} height={node.h}
                      rx="2" ry="2"
                      fill={col.border}
                    />
                  )}
                  {/* Node text (1 or 2 lines) */}
                  {node.lines.map((line, li) => {
                    const cy = node.y + node.h / 2
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
                        fontSize="12.5"
                        fontWeight="600"
                        fill={col.text}
                        style={{ fontFamily: 'inherit', userSelect: 'none' }}
                      >
                        {line}
                      </text>
                    )
                  })}
                  {/* Selected indicator dot */}
                  {isSelected && (
                    <circle cx={node.x + node.w - 10} cy={node.y + 10} r="4" fill="#FF8F00" />
                  )}
                </g>
              )
            })}

            {/* "হ্যাঁ loop" label box */}
            <rect x="6" y="376" width="44" height="48" rx="6" fill="#E3F2FD" stroke="#42A5F5" strokeWidth="1" />
            <text x="28" y="396" textAnchor="middle" dominantBaseline="middle" fontSize="10" fontWeight="700" fill="#1565C0" style={{ fontFamily: 'inherit' }}>হ্যাঁ</text>
            <text x="28" y="412" textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="#1565C0" style={{ fontFamily: 'inherit' }}>↩ Loop</text>

          </svg>
        </div>

        {/* Detail panel */}
        <div className="lg:w-80 xl:w-96 lg:sticky lg:top-5">
          {selected
            ? <DetailPanel node={selected} onClose={() => setSelectedId(null)} />
            : <DefaultPanel />
          }

          {/* Step index */}
          <div className="card p-4 mt-4 space-y-2">
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--c-muted)' }}>
              সব ধাপ ({NODES.length}টি)
            </p>
            {NODES.map(n => (
              <button
                key={n.id}
                onClick={() => setSelectedId(prev => prev === n.id ? null : n.id)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors"
                style={{
                  backgroundColor: selectedId === n.id ? C[n.type].bg : 'transparent',
                  border: `1px solid ${selectedId === n.id ? C[n.type].border : 'transparent'}`,
                  color: 'var(--c-text)',
                }}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: C[n.type].border }} />
                <span className="flex-1 truncate">{n.detail.title}</span>
                {activeNodes.includes(n.id) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-ping flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Rules */}
      <div className="card p-5">
        <h2 className="text-sm font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--c-text)' }}>
          <ArrowDown size={15} style={{ color: '#04AA6D' }} />
          সর্বজনীন নিয়মাবলী
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {RULES.map((r, i) => (
            <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl"
                 style={{ backgroundColor: 'var(--c-surface)' }}>
              <span className="text-base flex-shrink-0">{r.icon}</span>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--c-text-2)' }}>{r.text}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
