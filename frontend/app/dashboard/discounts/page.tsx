'use client'
import { useEffect, useState, useCallback } from 'react'
import { discountsAPI, discountRulesAPI } from '@/lib/api'
import type { Discount, DiscountRule, OrderDiscount, DiscountReportRow } from '@/types'
import {
  Plus, Trash2, Edit2, X, Receipt, CheckCircle, XCircle,
  ToggleLeft, ToggleRight, Search, Eye, TrendingDown,
  ShoppingBag, RefreshCw, ChevronDown, ChevronRight,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────

function genCode() {
  const d = new Date()
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  const rand = Array.from({ length: 4 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*36)]).join('')
  return `DISC-${date}-${rand}`
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function rewardLabel(reward: DiscountRule['reward'] | undefined) {
  if (!reward) return '—'
  if (reward.reward_type === 'percentage')    return `${reward.discount_value}% off`
  if (reward.reward_type === 'flat')          return `৳${reward.discount_value} off`
  if (reward.reward_type === 'bonus')         return `Bonus items`
  if (reward.reward_type === 'free_delivery') return 'Free delivery'
  return '—'
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

// ── Discount Form Modal ───────────────────────────────────────

interface FormState {
  discount_name: string
  discount_code: string
  effective_from: string
  effective_to: string
  is_lifetime: boolean
  is_active: boolean
  rule_ids: string[]
}

function DiscountModal({
  discount, allRules, onSave, onClose,
}: {
  discount: Discount | null
  allRules: DiscountRule[]
  onSave: (data: Partial<FormState>) => Promise<void>
  onClose: () => void
}) {
  const isEdit = !!discount?.discount_id
  const today  = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState<FormState>({
    discount_name:  discount?.discount_name  || '',
    discount_code:  discount?.discount_code  || genCode(),
    effective_from: discount?.effective_from ? discount.effective_from.split('T')[0] : today,
    effective_to:   discount?.effective_to   ? discount.effective_to.split('T')[0]   : '',
    is_lifetime:    discount?.is_lifetime    ?? false,
    is_active:      discount?.is_active      ?? true,
    rule_ids:       discount?.rule_ids       || [],
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

  const filteredRules = allRules.filter(r =>
    r.rule_name.toLowerCase().includes(ruleSearch.toLowerCase()) ||
    r.rule_type.toLowerCase().includes(ruleSearch.toLowerCase())
  )

  const selectedRules = allRules.filter(r => form.rule_ids.includes(r.rule_id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl overflow-y-auto"
           style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', maxHeight: '92vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
             style={{ borderBottom: '1px solid var(--c-border)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--c-text)' }}>
            {isEdit ? 'Edit Discount' : 'New Discount'}
          </h2>
          <button onClick={onClose}><X size={18} style={{ color: 'var(--c-muted)' }} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs mb-1 block font-semibold" style={{ color: 'var(--c-muted)' }}>Discount Name *</label>
            <input value={form.discount_name}
              onChange={e => set('discount_name', e.target.value)}
              placeholder="e.g. রমজান স্পেশাল"
              className="w-full rounded px-3 py-2 text-sm"
              style={inpStyle} />
          </div>

          {/* Code (read-only) */}
          <div>
            <label className="text-xs mb-1 block font-semibold" style={{ color: 'var(--c-muted)' }}>
              Discount Code <span style={{ color: '#4CAF50', fontWeight: 400 }}>(auto-generated)</span>
            </label>
            <input value={form.discount_code} readOnly
              className="w-full rounded px-3 py-2 text-sm font-mono"
              style={{ ...inpStyle, color: '#04AA6D', opacity: 0.9 }} />
          </div>

          {/* Dates */}
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

          {/* Lifetime + Active row */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_lifetime}
                onChange={e => set('is_lifetime', e.target.checked)}
                className="rounded" />
              <span className="text-sm" style={{ color: 'var(--c-text)' }}>No end date (Lifetime)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <button type="button" onClick={() => set('is_active', !form.is_active)}>
                {form.is_active
                  ? <ToggleRight size={22} style={{ color: '#4CAF50' }} />
                  : <ToggleLeft  size={22} style={{ color: '#607D8B' }} />
                }
              </button>
              <span className="text-sm" style={{ color: 'var(--c-text)' }}>Active</span>
            </label>
          </div>

          {/* Rules selector */}
          <div>
            <label className="text-xs mb-2 block font-semibold" style={{ color: 'var(--c-muted)' }}>
              Attach Rules ({form.rule_ids.length} selected)
            </label>

            {/* Selected rules chips */}
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
                    <button type="button" onClick={() => toggleRule(r.rule_id)}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="relative mb-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }} />
              <input value={ruleSearch} onChange={e => setRuleSearch(e.target.value)}
                placeholder="Search rules to add..."
                className="w-full rounded pl-7 pr-3 py-1.5 text-xs"
                style={inpStyle} />
            </div>

            {/* Rule list */}
            <div className="rounded border overflow-y-auto" style={{ border: '1px solid var(--c-border)', maxHeight: 180 }}>
              {filteredRules.length === 0 ? (
                <p className="text-xs text-center py-4" style={{ color: 'var(--c-muted)' }}>
                  No rules found. Create rules in the Discount Rules page first.
                </p>
              ) : filteredRules.map(r => (
                <button key={r.rule_id} type="button"
                  onClick={() => toggleRule(r.rule_id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                  style={{
                    background: form.rule_ids.includes(r.rule_id) ? `${RULE_TYPE_COLORS[r.rule_type] || '#607D8B'}12` : 'transparent',
                    borderBottom: '1px solid var(--c-border)',
                    color: 'var(--c-text)',
                  }}>
                  <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                        style={{ background: form.rule_ids.includes(r.rule_id) ? 'var(--c-accent)' : 'var(--c-surface2)' }}>
                    {form.rule_ids.includes(r.rule_id) && <CheckCircle size={11} style={{ color: '#fff' }} />}
                  </span>
                  <span className="flex-1 font-medium">{r.rule_name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: `${RULE_TYPE_COLORS[r.rule_type] || '#607D8B'}20`, color: RULE_TYPE_COLORS[r.rule_type] || '#90A4AE' }}>
                    {r.rule_type.replace(/_/g, ' ')}
                  </span>
                  <span style={{ color: 'var(--c-muted)' }}>{rewardLabel(r.reward)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4" style={{ borderTop: '1px solid var(--c-border)' }}>
          <button onClick={handleSubmit} disabled={saving || !form.discount_name.trim()}
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
  onEdit: () => void
}) {
  const [data,    setData]    = useState<Discount | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    discountsAPI.get(discount.discount_id)
      .then(setData)
      .finally(() => setLoading(false))
  }, [discount.discount_id])

  const od: OrderDiscount[] = data?.order_discounts || []
  const totalDisc = od.reduce((s, r) => s + (Number(r.discount_amount) || 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-y-auto"
           style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', maxHeight: '90vh' }}>

        <div className="flex items-center justify-between px-5 py-4"
             style={{ borderBottom: '1px solid var(--c-border)' }}>
          <div>
            <h2 className="font-bold text-base" style={{ color: 'var(--c-text)' }}>{discount.discount_name}</h2>
            <span className="font-mono text-xs px-2 py-0.5 rounded mt-1 inline-block"
                  style={{ background: 'rgba(4,170,109,0.12)', color: '#04AA6D' }}>
              {discount.discount_code}
            </span>
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
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Orders Used',      value: od.length,               color: '#2196F3', icon: ShoppingBag },
                { label: 'Total Discounted', value: `৳${totalDisc.toFixed(2)}`, color: '#4CAF50', icon: TrendingDown },
                { label: 'Status',           value: discount.is_active ? 'Active' : 'Inactive',
                  color: discount.is_active ? '#4CAF50' : '#EF9A9A', icon: discount.is_active ? CheckCircle : XCircle },
              ].map(({ label, value, color, icon: Icon }) => (
                <div key={label} className="rounded-xl p-3 text-center"
                     style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                  <Icon size={16} className="mx-auto mb-1" style={{ color }} />
                  <p className="text-xs mb-0.5" style={{ color: 'var(--c-muted)' }}>{label}</p>
                  <p className="text-sm font-bold" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Effective window */}
            <div className="text-xs" style={{ color: 'var(--c-muted)' }}>
              Active: {fmtDate(discount.effective_from)} → {discount.is_lifetime ? 'No end date' : fmtDate(discount.effective_to)}
            </div>

            {/* Attached rules */}
            <div>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--c-text)' }}>
                Attached Rules ({(data?.rules || []).length})
              </h3>
              {(data?.rules || []).length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--c-muted)' }}>No rules attached.</p>
              ) : (data?.rules || []).map(r => (
                <div key={r.rule_id} className="flex items-center gap-3 rounded px-3 py-2 mb-1.5"
                     style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                  <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: `${RULE_TYPE_COLORS[r.rule_type] || '#607D8B'}20`, color: RULE_TYPE_COLORS[r.rule_type] || '#90A4AE' }}>
                    {r.rule_type.replace(/_/g, ' ')}
                  </span>
                  <span className="flex-1 text-sm font-medium" style={{ color: 'var(--c-text)' }}>{r.rule_name}</span>
                  <span className="text-xs" style={{ color: '#4CAF50' }}>{rewardLabel(r.reward)}</span>
                </div>
              ))}
            </div>

            {/* Order history */}
            <div>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--c-text)' }}>
                Order History ({od.length})
              </h3>
              {od.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--c-muted)' }}>No orders have used this discount yet.</p>
              ) : (
                <div className="rounded overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
                  <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--c-surface2)' }}>
                        {['Rule', 'Product', 'Original', 'Discount', 'Final', 'Date'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-semibold"
                              style={{ color: 'var(--c-muted)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {od.slice(0, 20).map((row, i) => (
                        <tr key={row.id}
                            style={{ background: i%2===0 ? 'var(--c-card)' : 'var(--c-surface)', borderTop: '1px solid var(--c-border)' }}>
                          <td className="px-3 py-2" style={{ color: 'var(--c-muted)' }}>{row.rule_name}</td>
                          <td className="px-3 py-2" style={{ color: 'var(--c-text)' }}>{row.product_name || '—'}</td>
                          <td className="px-3 py-2" style={{ color: 'var(--c-muted)' }}>৳{row.original_price ?? '—'}</td>
                          <td className="px-3 py-2 font-semibold" style={{ color: '#FF7043' }}>৳{Number(row.discount_amount).toFixed(2)}</td>
                          <td className="px-3 py-2 font-semibold" style={{ color: '#4CAF50' }}>৳{row.final_price ?? '—'}</td>
                          <td className="px-3 py-2" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>{fmtDate(row.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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

  // Report state
  const [report,      setReport]      = useState<{ active_discounts: number; total_discount_amount: number; rows: DiscountReportRow[] } | null>(null)
  const [reportLoading, setReportLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, r] = await Promise.all([discountsAPI.list(), discountRulesAPI.list()])
      setDiscounts(d)
      setRules(r)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (tab !== 'report' || report) return
    setReportLoading(true)
    discountsAPI.report().then(setReport).finally(() => setReportLoading(false))
  }, [tab, report])

  async function handleSave(data: Record<string, unknown>) {
    if (modal === 'create') {
      const created = await discountsAPI.create(data)
      setDiscounts(prev => [created, ...prev])
    } else if (modal && typeof modal !== 'string') {
      const updated = await discountsAPI.update(modal.discount_id, data)
      setDiscounts(prev => prev.map(d => d.discount_id === updated.discount_id ? updated : d))
    }
    setModal(null)
    setDetail(null)
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

  const filtered = discounts.filter(d =>
    d.discount_name.toLowerCase().includes(search.toLowerCase()) ||
    d.discount_code.toLowerCase().includes(search.toLowerCase())
  )

  const editingDiscount = modal && modal !== 'create' ? modal : null

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--c-text)' }}>Discounts</h1>
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
            {t === 'discounts' ? 'Discounts' : 'Report'}
          </button>
        ))}
      </div>

      {/* ── DISCOUNTS TAB ── */}
      {tab === 'discounts' && (
        <>
          {/* Search */}
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }} />
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
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: 800 }}>
                  <thead>
                    <tr style={{ background: 'var(--c-surface2)', borderBottom: '1px solid var(--c-border)' }}>
                      {['Code', 'Name', 'Rules', 'Eff. From', 'Eff. To', 'Active', 'Created', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold"
                            style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d, i) => (
                      <tr key={d.discount_id}
                          style={{
                            background: i%2===0 ? 'var(--c-card)' : 'var(--c-surface)',
                            borderBottom: '1px solid var(--c-border)',
                            opacity: d.is_active ? 1 : 0.6,
                          }}>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs px-2 py-0.5 rounded"
                                style={{ background: 'rgba(4,170,109,0.12)', color: '#04AA6D' }}>
                            {d.discount_code}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold" style={{ color: 'var(--c-text)' }}>
                          {d.discount_name}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-0.5 rounded font-semibold"
                                style={{ background: 'rgba(33,150,243,0.12)', color: '#64B5F6' }}>
                            {(d.rules || []).length} rule{(d.rules || []).length !== 1 ? 's' : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                          {fmtDate(d.effective_from)}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                          {d.is_lifetime ? <span style={{ color: '#4CAF50' }}>Lifetime</span> : fmtDate(d.effective_to)}
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleToggle(d)} title={d.is_active ? 'Deactivate' : 'Activate'}>
                            {d.is_active
                              ? <ToggleRight size={22} style={{ color: '#4CAF50' }} />
                              : <ToggleLeft  size={22} style={{ color: '#607D8B' }} />
                            }
                          </button>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                          {fmtDate(d.created_at)}
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
                    ))}
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
      {tab === 'report' && (
        <div>
          {reportLoading ? (
            <div className="flex justify-center py-16"><div className="spinner h-6 w-6" /></div>
          ) : !report ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--c-muted)' }}>No report data</p>
          ) : (
            <>
              {/* Month stats */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="rounded-xl p-4" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--c-muted)' }}>Active Discounts Used</p>
                  <p className="text-2xl font-bold" style={{ color: '#2196F3' }}>{report.active_discounts}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>this month</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--c-muted)' }}>Total Discounted</p>
                  <p className="text-2xl font-bold" style={{ color: '#4CAF50' }}>৳{report.total_discount_amount.toFixed(2)}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>this month</p>
                </div>
              </div>

              {/* Discount rows */}
              {report.rows.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--c-muted)' }}>
                  No discount activity this month
                </p>
              ) : (
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
                  <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--c-surface2)', borderBottom: '1px solid var(--c-border)' }}>
                        {['Discount Code', 'Discount Name', 'Orders Used', 'Total Discounted'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold"
                              style={{ color: 'var(--c-muted)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row, i) => (
                        <tr key={row.discount_code}
                            style={{
                              background: i%2===0 ? 'var(--c-card)' : 'var(--c-surface)',
                              borderBottom: '1px solid var(--c-border)',
                              cursor: 'pointer',
                            }}
                            onClick={() => {
                              const d = discounts.find(x => x.discount_code === row.discount_code)
                              if (d) { setDetail(d); setTab('discounts') }
                            }}>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs px-2 py-0.5 rounded"
                                  style={{ background: 'rgba(4,170,109,0.12)', color: '#04AA6D' }}>
                              {row.discount_code}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold" style={{ color: 'var(--c-text)' }}>
                            {row.discount_name}
                          </td>
                          <td className="px-4 py-3 text-center font-semibold" style={{ color: '#2196F3' }}>
                            {row.orders_count}
                          </td>
                          <td className="px-4 py-3 font-bold" style={{ color: '#4CAF50' }}>
                            ৳{Number(row.total_discount_amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {modal !== null && (
        <DiscountModal
          discount={editingDiscount}
          allRules={rules}
          onSave={handleSave}
          onClose={() => setModal(null)}
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
