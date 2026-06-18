'use client'
import { useState, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import { testBotAPI } from '@/lib/api'
import { FlaskConical, Send, Bot, User, Loader2, ChevronDown, ChevronRight, Percent, ShoppingCart, Plus, Camera, X } from 'lucide-react'

interface ProductMatch {
  product_id: string
  name:       string
  sku:        string
  mrp:        number
  image_url?: string
}

interface ChatMessage {
  role:        'user' | 'bot'
  text:        string
  ts:          Date
  isOrderFlow?: boolean
  imageUrl?:   string       // user-sent image preview
  products?:   ProductMatch[] // bot product match cards
}

interface DiscountCtx {
  customer_metrics: {
    total_orders: number
    total_lifetime_value: number
    avg_basket_value: number
    last_order_days_ago: number | null
    current_month_orders: number
    is_new_customer: boolean
  }
  matched_rules: { rule_name: string; rule_type: string; discount_value: number; discount_type: string; reason: string }[]
  applied_rules: { rule_name: string; discount_value: number; discount_type: string }[]
  final_discount_pct: number
  final_discount_flat: number
  discount_message: string
  resolution: string
}

// Keywords that identify order-flow bot messages
const ORDER_FLOW_PHRASES = [
  'আপনার নাম কী',
  'ফোন নম্বর দিন',
  'ঠিকানা দিন',
  'আর কোনো পণ্য',
  'অর্ডার কনফার্ম',
  'অর্ডার নিশ্চিত',
  'টেস্ট অর্ডার',
  '📦', '📞', '📍', '🛒', '✅',
]

function isOrderFlowMessage(text: string): boolean {
  return ORDER_FLOW_PHRASES.some(phrase => text.includes(phrase))
}

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser    = msg.role === 'user'
  const isOrder   = !isUser && msg.isOrderFlow
  const botBg     = isOrder ? '#2563eb' : '#fff'
  const botColor  = isOrder ? '#fff'    : '#282A35'
  const botBorder = isOrder ? 'none'    : '1px solid #E0E0E0'
  const iconBg    = isOrder ? '#1d4ed8' : '#282A35'

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: isUser ? '#04AA6D' : iconBg }}
      >
        {isUser ? <User size={13} className="text-white" /> : <Bot size={13} className="text-white" />}
      </div>

      <div className="max-w-[75%] flex flex-col gap-1.5">
        {/* User-sent image preview */}
        {isUser && msg.imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={msg.imageUrl}
            alt="sent image"
            className="rounded-xl object-cover"
            style={{ maxWidth: 180, maxHeight: 180, border: '2px solid #04AA6D' }}
          />
        )}

        {/* Text bubble */}
        {msg.text && (
          <div
            className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
            style={isUser
              ? { backgroundColor: '#04AA6D', color: '#fff', borderBottomRightRadius: 4 }
              : { backgroundColor: botBg, color: botColor, border: botBorder, borderBottomLeftRadius: 4 }
            }
          >
            {msg.text}
          </div>
        )}

        {/* Bot product match cards */}
        {!isUser && msg.products && msg.products.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-1">
            {msg.products.map(p => (
              <div
                key={p.product_id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs"
                style={{ backgroundColor: '#fff', border: '1px solid #E0E0E0' }}
              >
                {p.image_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.image_url} alt={p.name}
                    className="w-10 h-10 object-cover rounded-lg flex-shrink-0 border border-slate-100" />
                ) : (
                  <div className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: '#F5F5F5' }}>
                    <Camera size={14} style={{ color: '#BDBDBD' }} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate" style={{ color: '#282A35' }}>{p.name}</p>
                  <p style={{ color: '#9E9E9E' }}>{p.sku} · ৳{p.mrp.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TypingIndicator({ inOrderFlow }: { inOrderFlow: boolean }) {
  return (
    <div className="flex gap-2.5">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center"
        style={{ backgroundColor: inOrderFlow ? '#1d4ed8' : '#282A35' }}
      >
        <Bot size={13} className="text-white" />
      </div>
      <div
        className="px-4 py-3 rounded-2xl border"
        style={{
          backgroundColor: inOrderFlow ? '#2563eb' : '#fff',
          borderColor: inOrderFlow ? '#2563eb' : '#e5e7eb',
          borderBottomLeftRadius: 4,
        }}
      >
        <div className="flex gap-1 items-center">
          <span className={`w-1.5 h-1.5 rounded-full animate-bounce ${inOrderFlow ? 'bg-blue-200' : 'bg-gray-400'}`} style={{ animationDelay: '0ms' }} />
          <span className={`w-1.5 h-1.5 rounded-full animate-bounce ${inOrderFlow ? 'bg-blue-200' : 'bg-gray-400'}`} style={{ animationDelay: '150ms' }} />
          <span className={`w-1.5 h-1.5 rounded-full animate-bounce ${inOrderFlow ? 'bg-blue-200' : 'bg-gray-400'}`} style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

function OrderFlowBanner() {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
      style={{ backgroundColor: '#2563eb', color: '#fff' }}
    >
      <ShoppingCart size={15} />
      <span>🛒 অর্ডার প্রক্রিয়া চলছে...</span>
    </div>
  )
}

function DiscountPanel({ ctx }: { ctx: DiscountCtx }) {
  const [open, setOpen] = useState(true)
  const m = ctx.customer_metrics
  const hasDiscount = ctx.final_discount_pct > 0 || ctx.final_discount_flat > 0

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: hasDiscount ? 'rgba(4,170,109,0.08)' : 'var(--c-surface)' }}>
        <div className="flex items-center gap-2">
          <Percent size={14} style={{ color: hasDiscount ? '#04AA6D' : 'var(--c-muted)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--c-text)' }}>
            Discount Engine
            {hasDiscount && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-bold"
                style={{ background: '#04AA6D', color: '#fff' }}>
                {ctx.final_discount_pct > 0 ? `${ctx.final_discount_pct}% OFF` : `৳${ctx.final_discount_flat} OFF`}
              </span>
            )}
          </span>
        </div>
        {open ? <ChevronDown size={13} style={{ color: 'var(--c-muted)' }} /> : <ChevronRight size={13} style={{ color: 'var(--c-muted)' }} />}
      </button>

      {open && (
        <div className="p-4 space-y-4" style={{ borderTop: '1px solid var(--c-border)' }}>

          {/* Customer metrics */}
          <div>
            <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>Customer Metrics</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Orders', value: m.total_orders },
                { label: 'LTV ৳', value: m.total_lifetime_value.toLocaleString() },
                { label: 'Avg Basket', value: `৳${m.avg_basket_value.toLocaleString()}` },
                { label: 'Last Order', value: m.last_order_days_ago != null ? `${m.last_order_days_ago}d ago` : '—' },
                { label: 'This Month', value: m.current_month_orders },
                { label: 'Status', value: m.is_new_customer ? 'New' : 'Returning' },
              ].map(({ label, value }) => (
                <div key={label} className="p-2 rounded text-center"
                  style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                  <p className="text-xs font-bold" style={{ color: 'var(--c-text)' }}>{value}</p>
                  <p className="text-2xs" style={{ color: 'var(--c-muted)' }}>{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Matched rules */}
          {ctx.matched_rules.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>Matched Rules ({ctx.matched_rules.length})</p>
              <div className="space-y-1.5">
                {ctx.matched_rules.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded text-xs"
                    style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                    <span style={{ color: 'var(--c-text)' }}>{r.rule_name}</span>
                    <div className="flex items-center gap-2">
                      <span style={{ color: 'var(--c-muted)', fontSize: 10 }}>{r.reason}</span>
                      <span className="font-bold" style={{ color: '#04AA6D' }}>
                        {r.discount_type === 'percentage' ? `${r.discount_value}%` : `৳${r.discount_value}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Final result */}
          {hasDiscount && (
            <div className="px-3 py-2.5 rounded" style={{ background: 'rgba(4,170,109,0.08)', border: '1px solid rgba(4,170,109,0.2)' }}>
              <p className="text-xs font-semibold" style={{ color: '#04AA6D' }}>{ctx.discount_message}</p>
              <p className="text-2xs mt-0.5" style={{ color: 'var(--c-muted)' }}>Resolution: {ctx.resolution}</p>
            </div>
          )}

          {!hasDiscount && ctx.matched_rules.length === 0 && (
            <p className="text-xs text-center py-2" style={{ color: 'var(--c-muted)' }}>
              কোনো discount rule match হয়নি
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function TestBotPage() {
  const [messages, setMessages]           = useState<ChatMessage[]>([])
  const [input, setInput]                 = useState('')
  const [typing, setTyping]               = useState(false)
  const [resetting, setResetting]         = useState(false)
  const [customerPhone, setCustomerPhone] = useState('')
  const [discountCtx, setDiscountCtx]     = useState<DiscountCtx | null>(null)
  const [orderFlow, setOrderFlow]         = useState<string | null>(null)
  const [pendingImage, setPendingImage]   = useState<File | null>(null)
  const [imagePreview, setImagePreview]   = useState<string | null>(null)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, typing])

  // Clear backend state on every page load so each session starts fresh
  useEffect(() => {
    testBotAPI.reset().catch(() => {/* ignore — server may not be reachable yet */})
  }, [])

  const inOrderFlow = orderFlow !== null && orderFlow !== 'idle'

  async function send() {
    const text = input.trim()
    if (!text || typing) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text, ts: new Date() }])
    setTyping(true)

    try {
      const res = await testBotAPI.chat(text, customerPhone || undefined)
      const newFlow = res.order_flow ?? null
      setOrderFlow(newFlow)

      const isOrderMsg = isOrderFlowMessage(res.reply) || (newFlow !== null && newFlow !== 'idle')
      setMessages(prev => [...prev, { role: 'bot', text: res.reply, ts: new Date(), isOrderFlow: isOrderMsg }])
      if (res.discount_context) setDiscountCtx(res.discount_context as unknown as DiscountCtx)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setMessages(prev => [...prev, {
        role: 'bot',
        text: detail || 'দুঃখিত, AI সার্ভিস সাময়িকভাবে অনুপলব্ধ। একটু পরে আবার চেষ্টা করুন।',
        ts: new Date(),
        isOrderFlow: false,
      }])
      toast.error('AI response ব্যর্থ হয়েছে')
    } finally {
      setTyping(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  async function newConversation() {
    if (resetting) return
    setResetting(true)
    try {
      await testBotAPI.reset()
      setMessages([])
      setDiscountCtx(null)
      setOrderFlow(null)
      setInput('')
      setTimeout(() => inputRef.current?.focus(), 50)
    } catch {
      toast.error('রিসেট ব্যর্থ হয়েছে')
    } finally {
      setResetting(false)
    }
  }

  function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('শুধু image file বেছে নিন'); return }
    if (file.size > 5 * 1024 * 1024)    { toast.error('5MB-এর বেশি image দেওয়া যাবে না'); return }
    setPendingImage(file)
    setImagePreview(URL.createObjectURL(file))
    if (imgInputRef.current) imgInputRef.current.value = ''
  }

  async function sendImage() {
    if (!pendingImage || typing) return
    const preview = imagePreview!
    setPendingImage(null)
    setImagePreview(null)
    setMessages(prev => [...prev, { role: 'user', text: '', imageUrl: preview, ts: new Date() }])
    setTyping(true)
    try {
      const res = await testBotAPI.sendImage(pendingImage)
      setMessages(prev => [...prev, {
        role:     'bot',
        text:     res.reply,
        ts:       new Date(),
        products: res.products.length > 0 ? res.products : undefined,
      }])
    } catch {
      setMessages(prev => [...prev, { role: 'bot', text: 'দুঃখিত, ছবি প্রসেস করতে পারিনি।', ts: new Date() }])
      toast.error('Image recognition ব্যর্থ হয়েছে')
    } finally {
      setTyping(false)
    }
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-7rem)]">

      {/* ── Chat column ─────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <FlaskConical size={22} style={{ color: '#04AA6D' }} /> Test Bot
            </h1>
            <p className="page-subtitle">আপনার বটের সাথে কথা বলুন এবং পরীক্ষা করুন</p>
          </div>
          <button
            onClick={newConversation}
            disabled={resetting}
            className="btn-secondary gap-1.5 text-sm"
            title="State clear করে নতুন কথোপকথন শুরু করুন"
          >
            {resetting
              ? <Loader2 size={13} className="animate-spin" />
              : <Plus size={13} />
            }
            নতুন কথোপকথন
          </button>
        </div>

        {/* Order flow banner */}
        {inOrderFlow && <div className="mb-3"><OrderFlowBanner /></div>}

        {/* Customer phone (optional) */}
        <div className="flex items-center gap-2 mb-3">
          <input
            type="tel"
            className="input flex-1 text-sm"
            placeholder="গ্রাহকের ফোন নম্বর (ঐচ্ছিক — discount engine চালু করতে)"
            value={customerPhone}
            onChange={e => setCustomerPhone(e.target.value)}
            maxLength={11}
          />
          {customerPhone && (
            <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(4,170,109,0.1)', color: '#04AA6D' }}>
              Engine Active
            </span>
          )}
        </div>

        {/* Chat window */}
        <div className="flex-1 rounded-xl overflow-y-auto p-4 space-y-4"
          style={{ backgroundColor: '#F4F6F8', border: `1px solid ${inOrderFlow ? '#2563eb' : '#E0E0E0'}`, transition: 'border-color 0.3s' }}>
          {messages.length === 0 && !typing && (
            <div className="h-full flex flex-col items-center justify-center text-center py-10 gap-3">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: '#282A35' }}>
                <Bot size={32} className="text-white" />
              </div>
              <div>
                <p className="font-semibold" style={{ color: '#282A35' }}>আপনার বট প্রস্তুত!</p>
                <p className="text-sm mt-1" style={{ color: '#9E9E9E' }}>
                  একটি বার্তা পাঠান — বট আপনার AI settings অনুযায়ী উত্তর দেবে
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {['আপনাদের পণ্যের দাম কত?', 'কি কি পণ্য আছে?', 'রিটার্ন পলিসি কি?', 'ছাড় পাওয়া যাবে?'].map(q => (
                  <button key={q} onClick={() => { setInput(q); inputRef.current?.focus() }}
                    className="text-xs px-3 py-1.5 rounded-full border transition-colors hover:border-green-400"
                    style={{ borderColor: '#E0E0E0', color: '#616161', backgroundColor: '#fff' }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}
          {typing && <TypingIndicator inOrderFlow={inOrderFlow} />}
          <div ref={bottomRef} />
        </div>

        {/* Image preview bar */}
        {imagePreview && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl"
               style={{ backgroundColor: '#fff', border: '1px solid #04AA6D' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagePreview} alt="preview"
                 className="w-12 h-12 object-cover rounded-lg border border-slate-200 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: '#282A35' }}>{pendingImage?.name}</p>
              <p className="text-2xs" style={{ color: '#9E9E9E' }}>
                {pendingImage ? (pendingImage.size / 1024).toFixed(0) + ' KB' : ''}
              </p>
            </div>
            <button
              onClick={() => { setPendingImage(null); setImagePreview(null) }}
              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}
            >
              <X size={11} />
            </button>
            <button
              onClick={sendImage}
              disabled={typing}
              className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 flex-shrink-0"
              style={{ backgroundColor: '#04AA6D', color: '#fff' }}
            >
              {typing ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
              পাঠান
            </button>
          </div>
        )}

        {/* Text input + camera button */}
        <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
        <div className="mt-3 flex gap-2 p-2 rounded-xl" style={{ backgroundColor: '#fff', border: '1px solid #E0E0E0' }}>
          {/* Camera button */}
          <button
            onClick={() => imgInputRef.current?.click()}
            disabled={typing}
            title="ছবি পাঠান"
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
            style={{ backgroundColor: pendingImage ? 'rgba(4,170,109,0.12)' : 'transparent', color: pendingImage ? '#04AA6D' : '#9E9E9E' }}
          >
            <Camera size={16} />
          </button>

          <input ref={inputRef} type="text"
            className="flex-1 px-2 py-2 text-sm outline-none bg-transparent"
            style={{ color: '#282A35' }}
            placeholder={inOrderFlow ? 'অর্ডার তথ্য লিখুন...' : 'বার্তা লিখুন... (Enter পাঠাতে)'}
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown} disabled={typing} autoFocus />
          <button onClick={send} disabled={!input.trim() || typing}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{
              backgroundColor: !input.trim() || typing ? '#E0E0E0' : inOrderFlow ? '#2563eb' : '#04AA6D',
              color: !input.trim() || typing ? '#9E9E9E' : '#fff',
            }}>
            {typing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
        <p className="text-xs text-center mt-2" style={{ color: '#BDBDBD' }}>
          এটি পরীক্ষামূলক — গ্রাহকের কথোপকথনে এটি প্রভাব ফেলবে না
        </p>
      </div>

      {/* ── Discount panel (right sidebar) ──────────────────────────────── */}
      <div className="hidden lg:flex flex-col w-72 flex-shrink-0 space-y-3 overflow-y-auto">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
          Discount Engine
        </p>
        {discountCtx ? (
          <DiscountPanel ctx={discountCtx} />
        ) : (
          <div className="rounded-xl p-4 text-center" style={{ border: '1px dashed var(--c-border)' }}>
            <Percent size={24} className="mx-auto mb-2" style={{ color: 'var(--c-border)' }} />
            <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
              ফোন নম্বর দিয়ে message পাঠালে এখানে customer metrics ও matched discount rules দেখাবে
            </p>
          </div>
        )}
      </div>

    </div>
  )
}
