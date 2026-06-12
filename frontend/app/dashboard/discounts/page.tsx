'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { discountsAPI, discountRulesAPI, configAPI } from '@/lib/api'
import type {
  Discount, DiscountRule, OrderDiscount,
  DiscountMonthSummary, DiscountMonthDetail, DiscountReportRow,
} from '@/types'
import {
  Plus, Trash2, Edit2, X, Receipt, CheckCircle,
  Search, Eye, TrendingDown, Layers, Settings,
  ShoppingBag, RefreshCw, ChevronDown, ChevronRight,
  Calculator, ArrowRight,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────

interface SimulateResult {
  discount_id:    string
  discount_code:  string
  discount_name:  string
  cart_value:     number
  rules: Array<{
    rule_id:        string
    rule_name:      string
    rule_type:      string
    matched:        boolean
    reason:         string
    reward_type:    string
    discount_value: number
    discount_amount: number
  }>
  total_discount: number
  net_amount:     number
}

// ── Constants ─────────────────────────────────────────────────

const BANGLA_MONTHS = [
  '', 'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
]

const CR_META: Record<string, { label: string; bangla: string; desc: string; color: string; bg: string; border: string }> = {
  priority_wins: {
    label: 'Priority Wins',
    bangla: 'Priority Wins',
    desc: 'সর্বোচ্চ priority-র (সবচেয়ে ছোট P নম্বর) discount apply হবে',
    color: '#FFC107', bg: 'rgba(255,193,7,0.07)', border: 'rgba(255,193,7,0.25)',
  },
  best_deal: {
    label: 'Best Deal Wins',
    bangla: 'Best Deal Wins',
    desc: 'একাধিক discount match হলে সর্বোচ্চ ছাড়ের discount apply হবে',
    color: '#2196F3', bg: 'rgba(33,150,243,0.07)', border: 'rgba(33,150,243,0.25)',
  },
  stack_all: {
    label: 'Stack All',
    bangla: 'Stack All',
    desc: 'সব matched discount একসাথে apply হবে — সর্বোচ্চ সুবিধা',
    color: '#4CAF50', bg: 'rgba(76,175,80,0.07)', border: 'rgba(76,175,80,0.25)',
  },
  stack_with_cap: {
    label: 'Stack with Cap',
    bangla: 'Stack with Cap',
    desc: 'একটি সর্বোচ্চ সীমা পর্যন্ত discounts stack হবে',
    color: '#FF7043', bg: 'rgba(255,112,67,0.07)', border: 'rgba(255,112,67,0.25)',
  },
}

const RULE_TYPE_COLORS: Record<string, string> = {
  cart_value:        '#1565C0',
  repeated_customer: '#6A1B9A',
  new_customer:      '#00695C',
  specific_product:  '#E65100',
  specific_category: '#AD1457',
  bulk_quantity:     '#F57F17',
  district:          '#2E7D32',
  time_based:        '#0277BD',
  seasonal:          '#6A1B9A',
  lifetime_value:    '#BF360C',
}

// ── Helpers ───────────────────────────────────────────────────

function fmtDate(v: string | null | undefined) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function banglaMonthLabel(year: number, month: number) {
  return `${BANGLA_MONTHS[month] || ''} ${year}`
}

function banglaDateShort(v: string | null | undefined): string {
  if (!v) return ''
  try {
    const d = new Date(v)
    if (isNaN(d.getTime())) return ''
    return `${d.getDate()} ${BANGLA_MONTHS[d.getMonth() + 1] || ''}`
  } catch { return '' }
}

function effectiveDateLabel(row: { effective_from?: string | null; effective_to?: string | null; is_lifetime?: boolean }): string {
  const from = banglaDateShort(row.effective_from)
  if (!from) return ''
  if (row.is_lifetime) return `${from} → আজীবন`
  const to = banglaDateShort(row.effective_to)
  return to ? `${from} → ${to}` : from
}

function conditionText(rule: DiscountRule): string {
  const c = rule.conditions || {}
  const g = (k: string) => (c as Record<string, unknown>)[k]
  switch (rule.rule_type) {
    case 'cart_value':        return `Cart ≥ ৳${g('min_cart_value') || g('cart_value') || '?'}`
    case 'specific_category': return `Category = ${(g('categories') as string[] | undefined)?.[0] || g('category') || '?'}`
    case 'specific_product':  return `Product = ${g('product_name') || g('sku') || '?'}`
    case 'new_customer':      return 'First order'
    case 'repeated_customer': return `Orders ≥ ${g('min_orders') || '?'}`
    case 'bulk_quantity':     return `Qty ≥ ${g('min_quantity') || '?'}`
    case 'district':          return `District = ${(g('districts') as string[] | undefined)?.[0] || g('district') || '?'}`
    case 'time_based':        return `${g('start_time') || '?'} – ${g('end_time') || '?'}`
    case 'seasonal':          return `${g('season') || g('holiday') || '?'}`
    case 'lifetime_value':    return `LTV ≥ ৳${g('min_lifetime_value') || '?'}`
    default:
      return Object.entries(c as Record<string, unknown>).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'
  }
}

// ── RewardBadge ───────────────────────────────────────────────

const REWARD_STYLES = {
  percentage:    { bg: 'rgba(76,175,80,0.15)',   color: '#4CAF50' },
  flat:          { bg: 'rgba(33,150,243,0.15)',  color: '#42A5F5' },
  bonus:         { bg: 'rgba(156,39,176,0.15)',  color: '#CE93D8' },
  free_delivery: { bg: 'rgba(255,112,67,0.15)',  color: '#FF7043' },
} as const

function RewardBadge({ reward }: { reward: DiscountRule['reward'] | undefined }) {
  if (!reward) return null
  const s = REWARD_STYLES[reward.reward_type as keyof typeof REWARD_STYLES] || { bg: 'var(--c-surface2)', color: 'var(--c-muted)' }
  let label = ''
  if (reward.reward_type === 'percentage')         label = `${reward.discount_value}% ছাড়`
  else if (reward.reward_type === 'flat')          label = `৳${reward.discount_value} ছাড়`
  else if (reward.reward_type === 'free_delivery') label = 'ফ্রি ডেলিভারি'
  else if (reward.reward_type === 'bonus') {
    const items = (reward.bonus_items || []).slice(0, 2).map(b => `${b.name} ×${b.quantity}`).join(', ')
    label = `ফ্রি: ${items || 'Bonus'}`
  }
  return (
    <span style={{
      fontSize: 11, padding: '2px 7px', borderRadius: 4,
      background: s.bg, color: s.color, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function RewardSummary({ rules }: { rules?: DiscountRule[] }) {
  const rs = rules || []
  if (rs.length === 0) return <span style={{ color: 'var(--c-muted)' }}>—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {rs.map(r => <RewardBadge key={r.rule_id} reward={r.reward} />)}
    </div>
  )
}

function priorityStyle(priority: number) {
  if (priority === 1)      return { bg: 'rgba(255,193,7,0.18)',  color: '#FFC107' }
  if (priority <= 5)       return { bg: 'rgba(255,213,79,0.14)', color: '#FFD54F' }
  return { bg: 'var(--c-surface2)', color: 'var(--c-muted)' }
}

// ── Discount Form Modal ───────────────────────────────────────

interface FormState {
  discount_name:  string
  effective_from: string
  effective_to:   string
  is_lifetime:    boolean
  is_active:      boolean
  rule_ids:       string[]
  priority:       number
}

function DiscountModal({
  discount, allRules, onSave, onClose, error,
}: {
  discount: Discount | null
  allRules: DiscountRule[]
  onSave: (data: Partial<FormState>) => Promise<void>
  onClose: () => void
  error?: string | null
}) {
  const isEdit = !!discount?.discount_id
  const today  = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState<FormState>({
    discount_name:  discount?.discount_name  || '',
    effective_from: discount?.effective_from ? discount.effective_from.split('T')[0] : today,
    effective_to:   discount?.effective_to   ? discount.effective_to.split('T')[0]   : '',
    is_lifetime:    discount?.is_lifetime    ?? false,
    is_active:      discount?.is_active      ?? true,
    rule_ids:       discount?.rule_ids       || [],
    priority:       discount?.priority       ?? 99,
  })
  const [ruleSearch, setRuleSearch] = useState('')
  const [saving,     setSaving]     = useState(false)

  const set = (k: keyof FormState, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  function toggleRule(rid: string) {
    set('rule_ids', form.rule_ids.includes(rid)
      ? form.rule_ids.filter(r => r !== rid)
      : [...form.rule_ids, rid]
    )
  }

  async function handleSubmit() {
    if (!form.discount_name.trim()) return
    setSaving(true)
    try {
      await onSave({
        ...form,
        effective_to: form.is_lifetime ? undefined : (form.effective_to || undefined),
      })
    } finally {
      setSaving(false)
    }
  }

  const inpStyle = {
    background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)',
  }
  const filteredRules  = allRules.filter(r =>
    r.rule_name.toLowerCase().includes(ruleSearch.toLowerCase()) ||
    r.rule_type.toLowerCase().includes(ruleSearch.toLowerCase())
  )
  const selectedRules = allRules.filter(r => form.rule_ids.includes(r.rule_id))
  const ps = priorityStyle(form.priority)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl overflow-y-auto"
           style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', maxHeight: '92vh' }}>

        <div className="flex items-center justify-between px-5 py-4"
             style={{ borderBottom: '1px solid var(--c-border)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--c-text)' }}>
            {isEdit ? 'Edit Discount' : 'New Discount'}
          </h2>
          <button onClick={onClose}><X size={18} style={{ color: 'var(--c-muted)' }} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs mb-1 block font-semibold" style={{ color: 'var(--c-muted)' }}>
              Discount Name *
            </label>
            <input value={form.discount_name}
              onChange={e => set('discount_name', e.target.value)}
              placeholder="e.g. রমজান স্পেশাল"
              className="w-full rounded px-3 py-2 text-sm" style={inpStyle} />
          </div>

          <div>
            <label className="text-xs mb-1 block font-semibold" style={{ color: 'var(--c-muted)' }}>
              Discount Code{' '}
              <span style={{ color: '#4CAF50', fontWeight: 400 }}>(auto-generated by server)</span>
            </label>
            <div className="w-full rounded px-3 py-2 text-xs font-mono"
                 style={{ ...inpStyle, color: isEdit ? '#04AA6D' : '#607D8B', opacity: 0.85 }}>
              {isEdit ? discount!.discount_code : 'DISC-YYYYMMDD-XXXX  ←  generated on save'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block font-semibold" style={{ color: 'var(--c-muted)' }}>
                Priority <span style={{ color: 'var(--c-muted)', fontWeight: 400 }}>(১ = সর্বোচ্চ)</span>
              </label>
              <input type="number" min={1} max={999} value={form.priority}
                onChange={e => set('priority', Math.max(1, parseInt(e.target.value) || 99))}
                className="w-full rounded px-3 py-2 text-sm" style={inpStyle} />
            </div>
            <div className="flex flex-col justify-end pb-1">
              <button type="button"
                onClick={() => set('is_active', !form.is_active)}
                className="flex items-center gap-2 px-3 py-2 rounded text-sm"
                style={{
                  background: form.is_active ? 'rgba(76,175,80,0.12)' : 'rgba(239,83,80,0.08)',
                  border: `1px solid ${form.is_active ? '#4CAF50' : '#EF5350'}`,
                  color: form.is_active ? '#4CAF50' : '#EF5350',
                }}>
                <span className="w-2 h-2 rounded-full"
                      style={{ background: form.is_active ? '#4CAF50' : '#EF5350' }} />
                {form.is_active ? 'সক্রিয়' : 'বন্ধ'}
              </button>
            </div>
          </div>

          <div className="rounded-lg p-3 text-xs space-y-1"
               style={{ background: 'rgba(255,193,7,0.06)', border: '1px solid rgba(255,193,7,0.2)' }}>
            <p className="font-semibold mb-1" style={{ color: '#FFC107' }}>Priority সম্পর্কে</p>
            <p style={{ color: 'var(--c-muted)' }}>• ১ = সর্বোচ্চ priority, ৯৯ = ডিফল্ট</p>
            <p style={{ color: 'var(--c-muted)' }}>• একই cart-এ একাধিক discount থাকলে priority অনুযায়ী সাজানো হয়</p>
            <p style={{ color: 'var(--c-muted)' }}>• <em>priority_wins</em>: শুধু সর্বোচ্চ priority-র discount প্রযোজ্য</p>
            <p style={{ color: 'var(--c-muted)' }}>• <em>best_deal</em>: সর্বোচ্চ discount amount স্বয়ংক্রিয়ভাবে বেছে নেওয়া হয়</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block font-semibold" style={{ color: 'var(--c-muted)' }}>Effective From</label>
              <input type="date" value={form.effective_from}
                onChange={e => set('effective_from', e.target.value)}
                className="w-full rounded px-3 py-2 text-sm" style={inpStyle} />
            </div>
            <div>
              <label className="text-xs mb-1 block font-semibold" style={{ color: 'var(--c-muted)' }}>Effective To</label>
              <input type="date" value={form.effective_to}
                disabled={form.is_lifetime}
                onChange={e => set('effective_to', e.target.value)}
                className="w-full rounded px-3 py-2 text-sm"
                style={{ ...inpStyle, opacity: form.is_lifetime ? 0.4 : 1 }} />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_lifetime}
              onChange={e => set('is_lifetime', e.target.checked)} className="rounded" />
            <span className="text-sm" style={{ color: 'var(--c-text)' }}>No end date (আজীবন)</span>
          </label>

          <div>
            <label className="text-xs mb-2 block font-semibold" style={{ color: 'var(--c-muted)' }}>
              Attach Rules ({form.rule_ids.length} selected)
            </label>
            {selectedRules.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedRules.map(r => (
                  <span key={r.rule_id}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded"
                    style={{
                      background: `${RULE_TYPE_COLORS[r.rule_type] || '#607D8B'}18`,
                      color:      RULE_TYPE_COLORS[r.rule_type] || '#90A4AE',
                      border:     `1px solid ${RULE_TYPE_COLORS[r.rule_type] || '#607D8B'}40`,
                    }}>
                    {r.rule_name}
                    <button type="button" onClick={() => toggleRule(r.rule_id)}><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative mb-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2"
                      style={{ color: 'var(--c-muted)' }} />
              <input value={ruleSearch} onChange={e => setRuleSearch(e.target.value)}
                placeholder="Search rules to add..."
                className="w-full rounded pl-7 pr-3 py-1.5 text-xs"
                style={inpStyle} />
            </div>
            <div className="rounded border overflow-y-auto"
                 style={{ border: '1px solid var(--c-border)', maxHeight: 180 }}>
              {filteredRules.length === 0 ? (
                <p className="text-xs text-center py-4" style={{ color: 'var(--c-muted)' }}>
                  No rules found. Create rules in the Discount Rules page first.
                </p>
              ) : filteredRules.map(r => (
                <button key={r.rule_id} type="button"
                  onClick={() => toggleRule(r.rule_id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                  style={{
                    background: form.rule_ids.includes(r.rule_id)
                      ? `${RULE_TYPE_COLORS[r.rule_type] || '#607D8B'}12` : 'transparent',
                    borderBottom: '1px solid var(--c-border)',
                    color: 'var(--c-text)',
                  }}>
                  <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                        style={{
                          background: form.rule_ids.includes(r.rule_id)
                            ? 'var(--c-accent)' : 'var(--c-surface2)',
                        }}>
                    {form.rule_ids.includes(r.rule_id) && <CheckCircle size={11} style={{ color: '#fff' }} />}
                  </span>
                  <span className="flex-1 font-medium">{r.rule_name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: `${RULE_TYPE_COLORS[r.rule_type] || '#607D8B'}20`,
                          color: RULE_TYPE_COLORS[r.rule_type] || '#90A4AE',
                        }}>
                    {r.rule_type.replace(/_/g, ' ')}
                  </span>
                  <RewardBadge reward={r.reward} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <p className="px-5 pb-1 text-xs" style={{ color: '#EF5350' }}>{error}</p>
        )}
        <div className="flex gap-3 px-5 py-4" style={{ borderTop: '1px solid var(--c-border)' }}>
          <button onClick={handleSubmit}
            disabled={saving || !form.discount_name.trim()}
            className="flex-1 py-2 rounded font-semibold text-sm text-white"
            style={{ background: saving || !form.discount_name.trim() ? 'var(--c-muted)' : 'var(--c-accent)' }}>
            {saving ? 'Saving…' : isEdit ? 'Update Discount' : 'Create Discount'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2 rounded text-sm"
            style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Detail Modal ──────────────────────────────────────────────

function DetailModal({ discount, onClose, onEdit }: {
  discount: Discount
  onClose: () => void
  onEdit:  () => void
}) {
  const [data,    setData]    = useState<Discount | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    discountsAPI.get(discount.discount_id)
      .then(setData)
      .finally(() => setLoading(false))
  }, [discount.discount_id])

  const od: OrderDiscount[] = data?.order_discounts || []
  const totalDisc   = od.reduce((s, r) => s + (Number(r.discount_amount) || 0), 0)
  const uniqueOrders = new Set(od.map(r => r.order_id)).size
  const avgPerOrder  = uniqueOrders > 0 ? totalDisc / uniqueOrders : 0
  const ps = priorityStyle(discount.priority ?? 99)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-3xl rounded-2xl overflow-y-auto"
           style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', maxHeight: '90vh' }}>

        <div className="flex items-center justify-between px-5 py-4"
             style={{ borderBottom: '1px solid var(--c-border)' }}>
          <div>
            <h2 className="font-bold text-base" style={{ color: 'var(--c-text)' }}>
              {discount.discount_name}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-xs px-2 py-0.5 rounded"
                    style={{ background: 'rgba(4,170,109,0.12)', color: '#04AA6D' }}>
                {discount.discount_code}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded font-mono"
                    style={{ background: ps.bg, color: ps.color }}>
                P{discount.priority ?? 99}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded"
                    style={{
                      background: discount.is_active ? 'rgba(76,175,80,0.12)' : 'rgba(239,83,80,0.1)',
                      color:      discount.is_active ? '#4CAF50' : '#EF5350',
                    }}>
                {discount.is_active ? 'সক্রিয়' : 'বন্ধ'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs"
              style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
              <Edit2 size={11} /> Edit
            </button>
            <button onClick={onClose}><X size={18} style={{ color: 'var(--c-muted)' }} /></button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="spinner h-5 w-5" /></div>
        ) : (
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Orders Used',      value: uniqueOrders,               color: '#2196F3', Icon: ShoppingBag },
                { label: 'Total Discounted', value: uniqueOrders > 0 ? `৳${totalDisc.toFixed(2)}` : '—', color: '#4CAF50', Icon: TrendingDown },
                { label: 'Avg per Order',    value: uniqueOrders > 0 ? `৳${avgPerOrder.toFixed(2)}` : '—', color: '#FF7043', Icon: Receipt },
              ].map(({ label, value, color, Icon }) => (
                <div key={label} className="rounded-xl p-3 text-center"
                     style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                  <Icon size={16} className="mx-auto mb-1" style={{ color }} />
                  <p className="text-xs mb-0.5" style={{ color: 'var(--c-muted)' }}>{label}</p>
                  <p className="text-sm font-bold" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs" style={{ color: 'var(--c-muted)' }}>
              Active: {fmtDate(discount.effective_from)} → {discount.is_lifetime ? 'আজীবন' : fmtDate(discount.effective_to)}
            </p>
            <div>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--c-text)' }}>
                Attached Rules ({(data?.rules || []).length})
              </h3>
              {(data?.rules || []).length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--c-muted)' }}>No rules attached.</p>
              ) : (data?.rules || []).map(r => (
                <div key={r.rule_id}
                     className="flex items-center gap-3 rounded px-3 py-2 mb-1.5"
                     style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                  <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: `${RULE_TYPE_COLORS[r.rule_type] || '#607D8B'}20`,
                          color: RULE_TYPE_COLORS[r.rule_type] || '#90A4AE',
                        }}>
                    {r.rule_type.replace(/_/g, ' ')}
                  </span>
                  <span className="flex-1 text-sm font-medium" style={{ color: 'var(--c-text)' }}>
                    {r.rule_name}
                  </span>
                  <RewardBadge reward={r.reward} />
                </div>
              ))}
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--c-text)' }}>
                Order History ({uniqueOrders} orders)
              </h3>
              {od.length === 0 ? (
                <div className="rounded-lg p-4 text-center"
                     style={{ background: 'var(--c-surface)', border: '1px dashed var(--c-border)' }}>
                  <p className="text-xs font-medium" style={{ color: 'var(--c-muted)' }}>No orders yet</p>
                  <p className="text-xs mt-1 opacity-60" style={{ color: 'var(--c-muted)' }}>
                    Orders will appear here after a customer uses this discount
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: 640 }}>
                        <thead>
                          <tr style={{ background: 'var(--c-surface2)' }}>
                            {['Order ID', 'Customer', 'Product', 'Original ৳', 'Discount ৳', 'Net ৳', 'Date'].map(h => (
                              <th key={h} className="px-3 py-2 text-left font-semibold"
                                  style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {od.slice(0, 50).map((row, i) => (
                            <tr key={row.id} style={{
                              background: i%2===0 ? 'var(--c-card)' : 'var(--c-surface)',
                              borderTop: '1px solid var(--c-border)',
                            }}>
                              <td className="px-3 py-2 font-mono text-xs"
                                  style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                                {row.order_id?.slice(0, 8)}…
                              </td>
                              <td className="px-3 py-2" style={{ color: 'var(--c-text)', whiteSpace: 'nowrap' }}>
                                {row.customer_phone || row.customer_name || '—'}
                              </td>
                              <td className="px-3 py-2" style={{ color: 'var(--c-text)' }}>
                                {row.product_name || row.rule_name || '—'}
                              </td>
                              <td className="px-3 py-2" style={{ color: 'var(--c-muted)' }}>
                                {row.original_price != null ? `৳${row.original_price}` : '—'}
                              </td>
                              <td className="px-3 py-2 font-semibold" style={{ color: '#FF7043' }}>
                                ৳{Number(row.discount_amount).toFixed(2)}
                              </td>
                              <td className="px-3 py-2 font-semibold" style={{ color: '#4CAF50' }}>
                                {row.final_price != null ? `৳${row.final_price}` : '—'}
                              </td>
                              <td className="px-3 py-2" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                                {fmtDate(row.created_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 px-3 py-2 rounded"
                       style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)' }}>
                    <span className="text-xs" style={{ color: 'var(--c-muted)' }}>
                      মোট orders: <strong style={{ color: 'var(--c-text)' }}>{uniqueOrders}</strong>
                    </span>
                    <span className="text-xs" style={{ color: 'var(--c-muted)' }}>
                      মোট ছাড়: <strong style={{ color: '#FF7043' }}>৳{totalDisc.toFixed(2)}</strong>
                    </span>
                    <span className="text-xs" style={{ color: 'var(--c-muted)' }}>
                      গড় প্রতি order: <strong style={{ color: '#4CAF50' }}>৳{avgPerOrder.toFixed(2)}</strong>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Inline Priority Editor ────────────────────────────────────

function PriorityCell({ priority, discountId, onSave }: {
  priority: number
  discountId: string
  onSave: (id: string, p: number) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [val,     setVal]     = useState(priority)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() { setVal(priority); setEditing(true) }

  async function commit() {
    setEditing(false)
    if (val !== priority) await onSave(discountId, val)
  }

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  const ps = priorityStyle(priority)

  if (editing) {
    return (
      <input ref={inputRef}
        type="number" min={1} max={999} value={val}
        onChange={e => setVal(Math.max(1, parseInt(e.target.value) || 99))}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        className="w-14 rounded px-2 py-0.5 text-xs text-center font-mono"
        style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-accent)', color: 'var(--c-text)' }}
      />
    )
  }
  return (
    <button onClick={startEdit} title="Click to edit priority"
      className="text-xs px-2 py-0.5 rounded font-mono cursor-pointer transition-colors"
      style={{
        background: ps.bg,
        color:      ps.color,
        border: '1px solid var(--c-border)',
      }}>
      P{priority}
    </button>
  )
}

// ── Rules Hover Tooltip ───────────────────────────────────────

function RulesCell({ rules }: { rules?: DiscountRule[] }) {
  const [hover, setHover] = useState(false)
  const count = (rules || []).length
  return (
    <div className="relative inline-block"
         onMouseEnter={() => setHover(true)}
         onMouseLeave={() => setHover(false)}>
      <span className="text-xs px-2 py-0.5 rounded font-semibold cursor-default"
            style={{ background: 'rgba(33,150,243,0.12)', color: '#64B5F6' }}>
        {count} rule{count !== 1 ? 's' : ''}
      </span>
      {hover && count > 0 && (
        <div className="absolute z-30 left-0 top-full mt-1 rounded-lg shadow-xl p-2 min-w-max"
             style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
          {(rules || []).map(r => (
            <div key={r.rule_id} className="flex items-center gap-2 py-1 px-1 text-xs whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: RULE_TYPE_COLORS[r.rule_type] || '#607D8B' }} />
              <span style={{ color: 'var(--c-text)' }}>{r.rule_name}</span>
              <RewardBadge reward={r.reward} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Discount Calculator Panel ─────────────────────────────────

function DiscountCalculator({ discountId, discountName, onClose }: {
  discountId:   string
  discountName: string
  onClose:      () => void
}) {
  const [form, setForm]       = useState({ product_sku: '', quantity: '1', cart_value: '', customer_phone: '', district: '' })
  const [result, setResult]   = useState<SimulateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const inp = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  async function runCalc() {
    if (!form.cart_value) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await discountsAPI.simulate(discountId, {
        product_sku:    form.product_sku   || null,
        quantity:       parseInt(form.quantity) || 1,
        cart_value:     parseFloat(form.cart_value) || 0,
        customer_phone: form.customer_phone || null,
        district:       form.district      || null,
      })
      setResult(res)
    } catch {
      setError('Simulation failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inpStyle = {
    background: 'var(--c-surface)', border: '1px solid var(--c-border)', color: 'var(--c-text)',
  }

  return (
    <div className="p-4 rounded-xl mt-1"
         style={{ background: 'rgba(33,150,243,0.04)', border: '1px solid rgba(33,150,243,0.2)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calculator size={14} style={{ color: '#64B5F6' }} />
          <span className="text-xs font-semibold" style={{ color: '#64B5F6' }}>
            Calculator — {discountName}
          </span>
        </div>
        <button onClick={onClose}><X size={14} style={{ color: 'var(--c-muted)' }} /></button>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Cart Value (৳) *</label>
          <input value={form.cart_value} onChange={inp('cart_value')}
            type="number" placeholder="500"
            className="w-full rounded px-2 py-1.5 text-xs" style={inpStyle} />
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Quantity</label>
          <input value={form.quantity} onChange={inp('quantity')}
            type="number" min="1" placeholder="1"
            className="w-full rounded px-2 py-1.5 text-xs" style={inpStyle} />
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Product SKU (optional)</label>
          <input value={form.product_sku} onChange={inp('product_sku')}
            placeholder="e.g. SHIRT-001"
            className="w-full rounded px-2 py-1.5 text-xs" style={inpStyle} />
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Customer Phone (optional)</label>
          <input value={form.customer_phone} onChange={inp('customer_phone')}
            placeholder="01XXXXXXXXX"
            className="w-full rounded px-2 py-1.5 text-xs" style={inpStyle} />
        </div>
        <div className="col-span-2">
          <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>District (optional)</label>
          <input value={form.district} onChange={inp('district')}
            placeholder="e.g. ঢাকা, Dhaka"
            className="w-full rounded px-2 py-1.5 text-xs" style={inpStyle} />
        </div>
      </div>

      <button onClick={runCalc} disabled={loading || !form.cart_value}
        className="flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold text-white"
        style={{ background: loading || !form.cart_value ? 'var(--c-muted)' : '#2196F3' }}>
        {loading ? 'Calculating…' : <><Calculator size={12} /> Calculate</>}
      </button>

      {error && <p className="mt-2 text-xs" style={{ color: '#EF5350' }}>{error}</p>}

      {result && (
        <div className="mt-3 space-y-2">
          {result.rules.map(r => (
            <div key={r.rule_id} className="flex items-start gap-2 rounded px-3 py-2 text-xs"
                 style={{
                   background: r.matched ? 'rgba(76,175,80,0.08)' : 'rgba(144,164,174,0.08)',
                   border: `1px solid ${r.matched ? 'rgba(76,175,80,0.25)' : 'rgba(144,164,174,0.2)'}`,
                 }}>
              <span className="mt-0.5 flex-shrink-0">{r.matched ? '✅' : '❌'}</span>
              <div className="flex-1">
                <p className="font-semibold" style={{ color: r.matched ? '#4CAF50' : '#90A4AE' }}>
                  {r.rule_name}
                </p>
                <p style={{ color: 'var(--c-muted)' }}>{r.reason}</p>
                {r.matched && r.discount_amount > 0 && (
                  <p className="font-semibold mt-0.5" style={{ color: '#FF7043' }}>
                    ছাড়: ৳{r.discount_amount.toFixed(2)}
                    {r.reward_type === 'percentage' && ` (${r.discount_value}%)`}
                    {r.reward_type === 'flat' && ' (flat)'}
                  </p>
                )}
              </div>
            </div>
          ))}
          {result.total_discount > 0 ? (
            <div className="rounded px-3 py-2 text-xs"
                 style={{ background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.25)' }}>
              <div className="flex justify-between mb-1">
                <span style={{ color: 'var(--c-muted)' }}>মূল মূল্য:</span>
                <span style={{ color: 'var(--c-text)' }}>৳{result.cart_value.toFixed(2)}</span>
              </div>
              <div className="flex justify-between mb-1">
                <span style={{ color: 'var(--c-muted)' }}>ছাড়:</span>
                <span style={{ color: '#FF7043', fontWeight: 600 }}>৳{result.total_discount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between pt-1" style={{ borderTop: '1px solid rgba(76,175,80,0.2)' }}>
                <span className="font-semibold" style={{ color: 'var(--c-text)' }}>নেট মূল্য:</span>
                <span className="font-bold" style={{ color: '#4CAF50' }}>৳{result.net_amount.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="rounded px-3 py-2 text-xs text-center"
                 style={{ background: 'rgba(144,164,174,0.08)', border: '1px solid rgba(144,164,174,0.2)' }}>
              <span style={{ color: '#90A4AE' }}>কোনো rule match হয়নি — এই discount প্রযোজ্য না</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Report Discount Row ───────────────────────────────────────

function ReportDiscountRow({ row, onPrioritySave }: {
  row:            DiscountReportRow
  onPrioritySave: (id: string, p: number) => Promise<void>
}) {
  const [calcOpen,   setCalcOpen]   = useState(false)
  const [expandOpen, setExpandOpen] = useState(false)
  const [expandData, setExpandData] = useState<Discount | null>(null)
  const [expandLoad, setExpandLoad] = useState(false)

  async function toggleExpand() {
    if (expandOpen) { setExpandOpen(false); return }
    setExpandOpen(true)
    if (expandData) return
    setExpandLoad(true)
    try {
      const d: Discount = await discountsAPI.get(row.discount_id)
      setExpandData(d)
    } finally {
      setExpandLoad(false)
    }
  }

  const od: OrderDiscount[]  = expandData?.order_discounts || []
  const uniqueOrders = new Set(od.map(r => r.order_id)).size
  const totalDisc    = od.reduce((s, r) => s + (Number(r.discount_amount) || 0), 0)
  const ps           = priorityStyle(row.priority ?? 99)
  const dateLabel    = effectiveDateLabel(row)

  return (
    <div className="rounded-xl overflow-hidden"
         style={{
           border: `1px solid ${expandOpen || calcOpen ? '#2196F330' : 'var(--c-border)'}`,
           marginBottom: 6,
         }}>

      {/* ── Header row ── */}
      <div className="flex items-center gap-2 px-3 py-2.5"
           style={{ background: expandOpen ? 'rgba(33,150,243,0.04)' : 'var(--c-card)' }}>

        <div className="flex-shrink-0">
          <PriorityCell priority={row.priority ?? 99} discountId={row.discount_id} onSave={onPrioritySave} />
        </div>

        <span className="font-mono text-xs px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ background: 'rgba(4,170,109,0.12)', color: '#04AA6D' }}>
          {row.discount_code}
        </span>

        <span className="flex-1 text-xs font-semibold truncate" style={{ color: 'var(--c-text)', minWidth: 0 }}>
          {row.discount_name}
        </span>

        {/* Rules count */}
        <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ background: 'rgba(33,150,243,0.1)', color: '#64B5F6' }}>
          {row.rules_count} rule{row.rules_count !== 1 ? 's' : ''}
        </span>

        {/* Effective date */}
        {dateLabel && (
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--c-muted)' }}>
            {dateLabel}
          </span>
        )}

        {/* Status */}
        <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
              style={{
                background: row.is_active ? 'rgba(76,175,80,0.12)' : 'rgba(239,83,80,0.1)',
                color:      row.is_active ? '#4CAF50' : '#EF5350',
              }}>
          {row.is_active ? 'সক্রিয়' : 'বন্ধ'}
        </span>

        {/* Orders count — grey if 0 */}
        <span className="text-xs flex-shrink-0"
              style={{ color: row.orders_count > 0 ? '#2196F3' : 'var(--c-muted)' }}>
          {row.orders_count} orders
        </span>

        {/* Discount amount — only if > 0 */}
        {row.total_discount_amount > 0 && (
          <span className="text-xs font-bold flex-shrink-0" style={{ color: '#FF7043' }}>
            ৳{row.total_discount_amount.toLocaleString()}
          </span>
        )}

        <button
          onClick={() => { setCalcOpen(p => !p); if (expandOpen) setExpandOpen(false) }}
          title="Open Calculator"
          className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded transition-colors"
          style={{
            background: calcOpen ? 'rgba(33,150,243,0.15)' : 'var(--c-surface2)',
            color: calcOpen ? '#64B5F6' : 'var(--c-muted)',
            border: `1px solid ${calcOpen ? 'rgba(33,150,243,0.3)' : 'var(--c-border)'}`,
          }}>
          <Calculator size={11} />
        </button>

        <button
          onClick={toggleExpand}
          title="Expand details"
          className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded transition-colors"
          style={{
            background: expandOpen ? 'rgba(33,150,243,0.15)' : 'var(--c-surface2)',
            color: expandOpen ? '#64B5F6' : 'var(--c-muted)',
            border: `1px solid ${expandOpen ? 'rgba(33,150,243,0.3)' : 'var(--c-border)'}`,
          }}>
          {expandOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
      </div>

      {/* ── Calculator panel ── */}
      {calcOpen && (
        <div className="px-3 pb-3" style={{ borderTop: '1px solid var(--c-border)' }}>
          <DiscountCalculator
            discountId={row.discount_id}
            discountName={row.discount_name}
            onClose={() => setCalcOpen(false)}
          />
        </div>
      )}

      {/* ── Expanded panel ── */}
      {expandOpen && (
        <div className="p-3 space-y-3" style={{ borderTop: '1px solid var(--c-border)' }}>
          {expandLoad ? (
            <div className="flex justify-center py-4"><div className="spinner h-4 w-4" /></div>
          ) : !expandData ? (
            <p className="text-xs text-center py-3" style={{ color: 'var(--c-muted)' }}>Failed to load details</p>
          ) : (
            <>
              {/* ── Attached Rules ── */}
              <div className="rounded-xl p-3"
                   style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                <p className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: 'var(--c-text)' }}>
                  📋 Attached Rules
                  <span className="text-xs font-normal px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(33,150,243,0.1)', color: '#64B5F6' }}>
                    {(expandData.rules || []).length}
                  </span>
                </p>

                {(expandData.rules || []).length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--c-muted)' }}>No rules attached.</p>
                ) : (
                  <div className="space-y-2">
                    {(expandData.rules || []).map((r, idx) => (
                      <div key={r.rule_id} className="rounded-lg p-3"
                           style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span className="text-xs font-semibold" style={{ color: 'var(--c-text)' }}>
                            Rule {idx + 1}: {r.rule_name}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                                style={{
                                  background: `${RULE_TYPE_COLORS[r.rule_type] || '#607D8B'}20`,
                                  color: RULE_TYPE_COLORS[r.rule_type] || '#90A4AE',
                                }}>
                            {r.rule_type.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs" style={{ color: 'var(--c-muted)' }}>
                            Condition: <span style={{ color: 'var(--c-text)' }}>{conditionText(r)}</span>
                          </span>
                          <span style={{ color: 'var(--c-border)' }}>·</span>
                          <span className="text-xs" style={{ color: 'var(--c-muted)' }}>Reward:</span>
                          <RewardBadge reward={r.reward} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Orders ── */}
              <div className="rounded-xl p-3"
                   style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                <p className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: 'var(--c-text)' }}>
                  📦 Orders
                  <span className="text-xs font-normal px-1.5 py-0.5 rounded"
                        style={{
                          background: uniqueOrders > 0 ? 'rgba(33,150,243,0.1)' : 'var(--c-surface2)',
                          color: uniqueOrders > 0 ? '#64B5F6' : 'var(--c-muted)',
                        }}>
                    {uniqueOrders}
                  </span>
                </p>

                {od.length === 0 ? (
                  <div className="rounded-lg p-4 text-center"
                       style={{ background: 'var(--c-card)', border: '1px dashed var(--c-border)' }}>
                    <p className="text-xs font-medium" style={{ color: 'var(--c-muted)' }}>No orders yet</p>
                    <p className="text-xs mt-1 opacity-60" style={{ color: 'var(--c-muted)' }}>
                      Orders will appear here after a customer uses this discount
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="rounded overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: 520 }}>
                          <thead>
                            <tr style={{ background: 'var(--c-surface2)' }}>
                              {['Order ID', 'Customer', 'Original ৳', 'Discount ৳', 'Net ৳', 'Date'].map(h => (
                                <th key={h} className="px-2 py-1.5 text-left font-semibold"
                                    style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {od.slice(0, 20).map((o, i) => (
                              <tr key={o.id} style={{
                                background: i%2===0 ? 'var(--c-card)' : 'var(--c-surface)',
                                borderTop: '1px solid var(--c-border)',
                              }}>
                                <td className="px-2 py-1.5 font-mono" style={{ color: 'var(--c-muted)' }}>
                                  {o.order_id?.slice(0, 8)}…
                                </td>
                                <td className="px-2 py-1.5" style={{ color: 'var(--c-text)', whiteSpace: 'nowrap' }}>
                                  {o.customer_phone || o.customer_name || '—'}
                                </td>
                                <td className="px-2 py-1.5" style={{ color: 'var(--c-muted)' }}>
                                  {o.original_price != null ? `৳${o.original_price}` : '—'}
                                </td>
                                <td className="px-2 py-1.5 font-semibold" style={{ color: '#FF7043' }}>
                                  ৳{Number(o.discount_amount).toFixed(2)}
                                </td>
                                <td className="px-2 py-1.5 font-semibold" style={{ color: '#4CAF50' }}>
                                  {o.final_price != null ? `৳${o.final_price}` : '—'}
                                </td>
                                <td className="px-2 py-1.5" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                                  {fmtDate(o.created_at)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="flex gap-4 mt-1.5 px-2 py-1.5 rounded text-xs"
                         style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)' }}>
                      <span style={{ color: 'var(--c-muted)' }}>
                        মোট orders: <strong style={{ color: 'var(--c-text)' }}>{uniqueOrders}</strong>
                      </span>
                      <span style={{ color: 'var(--c-muted)' }}>
                        মোট ছাড়: <strong style={{ color: '#FF7043' }}>৳{totalDisc.toFixed(2)}</strong>
                      </span>
                      <span style={{ color: 'var(--c-muted)' }}>
                        গড়: <strong style={{ color: '#4CAF50' }}>
                          ৳{uniqueOrders > 0 ? (totalDisc / uniqueOrders).toFixed(2) : '0.00'}
                        </strong>
                      </span>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Report Tab ────────────────────────────────────────────────

function ReportTab({ crMode }: { crMode: string }) {
  const [months,     setMonths]     = useState<DiscountMonthSummary[]>([])
  const [loading,    setLoading]    = useState(true)
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set())
  const [details,    setDetails]    = useState<Record<string, DiscountMonthDetail>>({})
  const [detailLoad, setDetailLoad] = useState<Set<string>>(new Set())

  useEffect(() => {
    discountsAPI.reportMonthly()
      .then((r: { months: DiscountMonthSummary[] }) => setMonths(r.months || []))
      .catch(() => setMonths([]))
      .finally(() => setLoading(false))
  }, [])

  const now      = new Date()
  const curMonth = months.find(m => m.year === now.getFullYear() && m.month === now.getMonth() + 1)

  async function toggleMonth(key: string, year: number, month: number) {
    if (expanded.has(key)) {
      setExpanded(prev => { const s = new Set(prev); s.delete(key); return s })
      return
    }
    setExpanded(prev => new Set(prev).add(key))
    if (details[key]) return
    setDetailLoad(prev => new Set(prev).add(key))
    try {
      const data: DiscountMonthDetail = await discountsAPI.reportMonthlyDetail(year, month)
      data.rows.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      setDetails(prev => ({ ...prev, [key]: data }))
    } finally {
      setDetailLoad(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }

  async function handlePrioritySave(monthKey: string, discountId: string, priority: number) {
    await discountsAPI.updatePriority(discountId, priority)
    setDetails(prev => {
      const d = prev[monthKey]
      if (!d) return prev
      const rows = d.rows
        .map(r => r.discount_id === discountId ? { ...r, priority } : r)
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      return { ...prev, [monthKey]: { ...d, rows } }
    })
  }

  if (loading) return <div className="flex justify-center py-16"><div className="spinner h-6 w-6" /></div>

  const cr         = CR_META[crMode] || CR_META['best_deal']
  const hasAnyData = months.length > 0

  return (
    <div className="space-y-4">
      {/* ── Conflict Resolution Banner ── */}
      <div className="rounded-xl p-4"
           style={{ background: cr.bg, border: `1px solid ${cr.border}` }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Settings size={16} className="mt-0.5 flex-shrink-0" style={{ color: cr.color }} />
            <div>
              <p className="text-sm font-bold" style={{ color: cr.color }}>
                ⚙️ বর্তমান নিয়ম: {cr.bangla}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>
                {cr.desc}
              </p>
            </div>
          </div>
          <a href="/dashboard/ai-config"
             className="flex items-center gap-1 text-xs flex-shrink-0 px-2.5 py-1.5 rounded font-medium"
             style={{ color: cr.color, background: cr.bg, border: `1px solid ${cr.border}` }}>
            AI Settings থেকে পরিবর্তন করুন <ArrowRight size={11} />
          </a>
        </div>
      </div>

      {/* ── Current month summary cards ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: banglaMonthLabel(now.getFullYear(), now.getMonth() + 1) + ' — Orders',
            value: curMonth?.orders_count ?? 0,
            color: '#2196F3', Icon: ShoppingBag,
          },
          {
            label: 'এই মাসের মোট ছাড়',
            value: (curMonth?.total_discount_amount ?? 0) > 0
              ? `৳${(curMonth!.total_discount_amount).toLocaleString()}`
              : 'অর্ডার হলে দেখাবে',
            color: '#FF7043', Icon: TrendingDown,
          },
          {
            label: 'সক্রিয় Discounts',
            value: curMonth?.active_discounts_count ?? 0,
            color: '#4CAF50', Icon: Layers,
          },
        ].map(({ label, value, color, Icon }) => (
          <div key={label} className="rounded-xl p-3 text-center"
               style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
            <Icon size={16} className="mx-auto mb-1" style={{ color }} />
            <p className="text-xs mb-0.5" style={{ color: 'var(--c-muted)' }}>{label}</p>
            <p className="text-sm font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {!hasAnyData && (
        <div className="text-center py-10" style={{ color: 'var(--c-muted)' }}>
          <TrendingDown size={32} className="mx-auto mb-3 opacity-25" />
          <p className="text-sm font-medium">No discounts created yet</p>
          <p className="text-xs mt-1 opacity-70">Create a discount to see monthly activity</p>
        </div>
      )}

      {/* ── Month accordion ── */}
      {months.map(m => {
        const key       = `${m.year}-${String(m.month).padStart(2, '0')}`
        const isOpen    = expanded.has(key)
        const isLoading = detailLoad.has(key)
        const detail    = details[key]

        return (
          <div key={key} className="rounded-xl overflow-hidden"
               style={{ border: `1px solid ${isOpen ? '#2196F340' : 'var(--c-border)'}` }}>

            {/* Month header button */}
            <button
              onClick={() => toggleMonth(key, m.year, m.month)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
              style={{ background: isOpen ? 'rgba(33,150,243,0.04)' : 'var(--c-card)' }}>
              <span className="font-bold text-sm flex-1" style={{ color: 'var(--c-text)' }}>
                {banglaMonthLabel(m.year, m.month)}
              </span>

              <span className="text-xs px-2 py-0.5 rounded"
                    style={{ background: 'rgba(33,150,243,0.12)', color: '#64B5F6', flexShrink: 0 }}>
                {m.active_discounts_count} discount{m.active_discounts_count !== 1 ? 's' : ''}
              </span>

              {/* Orders — grey if 0 */}
              <span className="text-xs px-2 py-0.5 rounded flex-shrink-0"
                    style={{
                      background: m.orders_count > 0 ? 'rgba(76,175,80,0.12)' : 'var(--c-surface2)',
                      color:      m.orders_count > 0 ? '#81C784' : 'var(--c-muted)',
                    }}>
                {m.orders_count} orders
              </span>

              {/* Amount — only if > 0 */}
              {m.total_discount_amount > 0 && (
                <span className="font-bold text-sm flex-shrink-0" style={{ color: '#FF7043' }}>
                  ৳{m.total_discount_amount.toLocaleString()}
                </span>
              )}

              {isOpen
                ? <ChevronDown  size={15} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
                : <ChevronRight size={15} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
              }
            </button>

            {/* Month body */}
            {isOpen && (
              <div className="p-3" style={{ borderTop: '1px solid var(--c-border)' }}>
                {isLoading ? (
                  <div className="flex justify-center py-5"><div className="spinner h-4 w-4" /></div>
                ) : !detail || detail.rows.length === 0 ? (
                  <p className="text-xs text-center py-4" style={{ color: 'var(--c-muted)' }}>
                    No data for this month
                  </p>
                ) : (
                  <>
                    {/* Stats bar */}
                    <div className="flex items-center gap-4 mb-3 px-1 text-xs"
                         style={{ color: 'var(--c-muted)' }}>
                      <span>
                        সক্রিয়: <strong style={{ color: 'var(--c-text)' }}>{detail.active_discounts}</strong>
                      </span>
                      {detail.total_orders > 0 && (
                        <span>
                          Orders: <strong style={{ color: '#2196F3' }}>{detail.total_orders}</strong>
                        </span>
                      )}
                      {detail.total_discount_amount > 0 && (
                        <span>
                          মোট ছাড়: <strong style={{ color: '#FF7043' }}>৳{detail.total_discount_amount.toLocaleString()}</strong>
                        </span>
                      )}
                      <span style={{ color: 'var(--c-muted)', fontSize: 11 }}>
                        Priority অনুযায়ী সাজানো
                      </span>
                    </div>

                    {detail.rows.map(row => (
                      <ReportDiscountRow
                        key={row.discount_id || row.discount_code}
                        row={row}
                        onPrioritySave={(id, p) => handlePrioritySave(key, id, p)}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

type Tab = 'discounts' | 'report'

export default function DiscountsPage() {
  const [tab,       setTab]       = useState<Tab>('discounts')
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [rules,     setRules]     = useState<DiscountRule[]>([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState<'create' | Discount | null>(null)
  const [detail,    setDetail]    = useState<Discount | null>(null)
  const [search,    setSearch]    = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [crMode,       setCrMode]       = useState<string>('best_deal')
  const [stackCap,     setStackCap]     = useState<number>(30)
  const [savingCr,     setSavingCr]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, r, cfg] = await Promise.all([
        discountsAPI.list(),
        discountRulesAPI.list(),
        configAPI.get().catch(() => null),
      ])
      setDiscounts(d)
      setRules(r)
      if (cfg?.conflict_resolution) setCrMode(cfg.conflict_resolution)
      if (cfg?.discount_stack_cap)  setStackCap(Number(cfg.discount_stack_cap) || 30)
    } finally {
      setLoading(false)
    }
  }, [])

  async function saveCrMode() {
    setSavingCr(true)
    try {
      await configAPI.update({ conflict_resolution: crMode, discount_stack_cap: stackCap })
      toast.success('✅ Conflict resolution সংরক্ষিত!')
    } catch {
      toast.error('সংরক্ষণ ব্যর্থ')
    } finally {
      setSavingCr(false)
    }
  }

  useEffect(() => { load() }, [load])

  async function handleSave(data: Record<string, unknown>) {
    setSaveError(null)
    try {
      if (modal === 'create') {
        const created = await discountsAPI.create(data)
        setDiscounts(prev => [created, ...prev])
      } else if (modal && typeof modal !== 'string') {
        const updated = await discountsAPI.update(modal.discount_id, data)
        setDiscounts(prev => prev.map(d => d.discount_id === updated.discount_id ? updated : d))
      }
      setModal(null)
      setDetail(null)
    } catch (err: unknown) {
      const errDetail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSaveError(errDetail || (err instanceof Error ? err.message : 'Failed to save discount. Please try again.'))
    }
  }

  async function handleDelete(d: Discount) {
    if (!confirm(`Delete "${d.discount_name}"?`)) return
    await discountsAPI.delete(d.discount_id)
    setDiscounts(prev => prev.filter(x => x.discount_id !== d.discount_id))
  }

  async function handleToggle(d: Discount) {
    const updated = await discountsAPI.update(d.discount_id, { is_active: !d.is_active })
    setDiscounts(prev => prev.map(x => x.discount_id === updated.discount_id ? updated : x))
  }

  async function handlePrioritySave(id: string, priority: number) {
    const updated = await discountsAPI.updatePriority(id, priority)
    setDiscounts(prev => prev.map(x => x.discount_id === updated.discount_id ? updated : x))
  }

  const filtered = discounts.filter(d =>
    d.discount_name.toLowerCase().includes(search.toLowerCase()) ||
    d.discount_code.toLowerCase().includes(search.toLowerCase())
  )

  const editingDiscount = modal && modal !== 'create' ? modal : null
  const cr = CR_META[crMode] || CR_META['best_deal']

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold" style={{ color: 'var(--c-text)' }}>Discounts</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: cr.bg, color: cr.color, border: `1px solid ${cr.border}` }}>
              {cr.label}
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--c-muted)' }}>
            Named discount offer তৈরি করুন এবং rules যোগ করুন।
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} disabled={loading}
            className="w-8 h-8 rounded flex items-center justify-center"
            style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--c-muted)' }} />
          </button>
          {tab === 'discounts' && (
            <button onClick={() => setModal('create')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: 'var(--c-accent)' }}>
              <Plus size={15} /> New Discount
            </button>
          )}
        </div>
      </div>

      {/* Conflict Resolution Banner */}
      <div className="mb-4 p-4 rounded-xl" style={{ background: 'var(--c-card)', border: `1px solid ${cr.border}` }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingDown size={14} style={{ color: cr.color }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>Discount Conflict Resolution</p>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: cr.bg, color: cr.color, border: `1px solid ${cr.border}` }}>
              {cr.label}
            </span>
          </div>
          <button
            onClick={saveCrMode}
            disabled={savingCr}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{ background: 'var(--c-accent)', opacity: savingCr ? 0.7 : 1 }}
          >
            {savingCr ? <><span className="spinner h-3 w-3" /> সংরক্ষণ...</> : <>সংরক্ষণ করুন</>}
          </button>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--c-muted)' }}>একাধিক discount rule match হলে কোনটি প্রযোজ্য হবে</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'best_deal',      label: 'Best Deal Wins',   desc: 'সর্বোচ্চ ছাড়ের rule apply হবে' },
            { value: 'priority_wins',  label: 'Priority Wins',    desc: 'সর্বোচ্চ priority-র rule apply হবে' },
            { value: 'stack_all',      label: 'Stack All',        desc: 'সব matching rules একসাথে যোগ হবে' },
            { value: 'stack_with_cap', label: 'Stack with Cap',   desc: 'সব যোগ হবে সর্বোচ্চ cap পর্যন্ত' },
          ] as const).map(opt => {
            const m = CR_META[opt.value]
            return (
              <label key={opt.value}
                className="flex items-start gap-2 p-2.5 rounded-lg cursor-pointer"
                style={{
                  border: `1px solid ${crMode === opt.value ? m.border : 'var(--c-border)'}`,
                  background: crMode === opt.value ? m.bg : 'var(--c-surface)',
                }}>
                <input type="radio" name="cr_mode" value={opt.value}
                  checked={crMode === opt.value}
                  onChange={() => setCrMode(opt.value)}
                  className="mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold" style={{ color: crMode === opt.value ? m.color : 'var(--c-text)' }}>{opt.label}</p>
                  <p className="text-xs" style={{ color: 'var(--c-muted)' }}>{opt.desc}</p>
                </div>
              </label>
            )
          })}
        </div>
        {crMode === 'stack_with_cap' && (
          <div className="mt-3 flex items-center gap-3">
            <label className="text-xs font-medium whitespace-nowrap" style={{ color: 'var(--c-text)' }}>Maximum Stack Cap</label>
            <div className="relative w-28">
              <input
                type="number" min={1} max={100} step={1}
                className="w-full rounded px-3 py-1.5 text-sm pr-8"
                style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}
                value={stackCap}
                onChange={e => setStackCap(parseFloat(e.target.value) || 30)}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--c-muted)' }}>%</span>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 mb-5 p-1 rounded-xl w-fit"
           style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)' }}>
        {(['discounts', 'report'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: tab === t ? 'var(--c-accent)' : 'transparent',
              color:      tab === t ? '#fff' : 'var(--c-muted)',
            }}>
            {t === 'discounts' ? 'Discounts' : 'Monthly Report'}
          </button>
        ))}
      </div>

      {/* ── DISCOUNTS TAB ── */}
      {tab === 'discounts' && (
        <>
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--c-muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or code..."
              className="w-full rounded-lg pl-9 pr-4 py-2 text-sm"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><div className="spinner h-6 w-6" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16" style={{ color: 'var(--c-muted)' }}>
              <Receipt size={36} className="mx-auto mb-3 opacity-25" />
              <p className="text-sm font-medium">No discounts yet</p>
              <p className="text-xs mt-1 opacity-70">Create your first named discount offer</p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: 980 }}>
                  <thead>
                    <tr style={{ background: 'var(--c-surface2)', borderBottom: '1px solid var(--c-border)' }}>
                      {['P', 'Discount Name', 'Code', 'Rules', 'Reward Summary', 'Effective', 'Status', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold"
                            style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d, i) => {
                      const ps = priorityStyle(d.priority ?? 99)
                      return (
                        <tr key={d.discount_id}
                            style={{
                              background: i%2===0 ? 'var(--c-card)' : 'var(--c-surface)',
                              borderBottom: '1px solid var(--c-border)',
                            }}>
                          <td className="px-4 py-3">
                            <PriorityCell priority={d.priority ?? 99} discountId={d.discount_id} onSave={handlePrioritySave} />
                          </td>
                          <td className="px-4 py-3 font-semibold" style={{ color: 'var(--c-text)' }}>
                            {d.discount_name}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs px-2 py-0.5 rounded"
                                  style={{ background: 'rgba(4,170,109,0.12)', color: '#04AA6D' }}>
                              {d.discount_code}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <RulesCell rules={d.rules} />
                          </td>
                          <td className="px-4 py-3">
                            <RewardSummary rules={d.rules} />
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                            {fmtDate(d.effective_from)}
                            <span style={{ color: 'var(--c-border)', margin: '0 4px' }}>→</span>
                            {d.is_lifetime
                              ? <span style={{ color: '#4CAF50' }}>আজীবন</span>
                              : (d.effective_to ? fmtDate(d.effective_to) : '—')
                            }
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => handleToggle(d)} title={d.is_active ? 'Click to deactivate' : 'Click to activate'}>
                              <span className="text-xs px-2 py-0.5 rounded"
                                    style={{
                                      background: d.is_active ? 'rgba(76,175,80,0.12)' : 'rgba(239,83,80,0.1)',
                                      color:      d.is_active ? '#4CAF50' : '#EF5350',
                                    }}>
                                {d.is_active ? 'সক্রিয়' : 'বন্ধ'}
                              </span>
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => setDetail(d)} title="View"
                                className="w-7 h-7 rounded flex items-center justify-center"
                                style={{ background: 'rgba(33,150,243,0.12)' }}>
                                <Eye size={12} style={{ color: '#64B5F6' }} />
                              </button>
                              <button onClick={() => setModal(d)} title="Edit"
                                className="w-7 h-7 rounded flex items-center justify-center"
                                style={{ background: 'var(--c-surface2)' }}>
                                <Edit2 size={12} style={{ color: 'var(--c-muted)' }} />
                              </button>
                              <button onClick={() => handleDelete(d)} title="Delete"
                                className="w-7 h-7 rounded flex items-center justify-center"
                                style={{ background: 'rgba(244,67,54,0.12)' }}>
                                <Trash2 size={12} style={{ color: '#ef9a9a' }} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 text-xs flex justify-between"
                   style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', borderTop: '1px solid var(--c-border)' }}>
                <span>{filtered.length} discount{filtered.length !== 1 ? 's' : ''}</span>
                <span>{discounts.filter(d => d.is_active).length} active</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── REPORT TAB ── */}
      {tab === 'report' && <ReportTab crMode={crMode} />}

      {/* Modals */}
      {modal !== null && (
        <DiscountModal
          discount={editingDiscount}
          allRules={rules}
          onSave={handleSave}
          onClose={() => { setModal(null); setSaveError(null) }}
          error={saveError}
        />
      )}
      {detail && !modal && (
        <DetailModal
          discount={detail}
          onClose={() => setDetail(null)}
          onEdit={() => { setModal(detail); setDetail(null) }}
        />
      )}
    </div>
  )
}
