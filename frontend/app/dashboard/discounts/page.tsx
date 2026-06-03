'use client'
import { useEffect, useState } from 'react'
import { discountsAPI, discountCategoriesAPI } from '@/lib/api'
import type { DiscountReportRow } from '@/types'
import {
  Receipt, TrendingDown, CheckCircle, Filter,
  RefreshCw, ToggleLeft, ToggleRight,
} from 'lucide-react'

interface Filters {
  created_from: string
  created_to: string
  eff_from: string
  eff_to: string
  discount_category_id: string
  discount_rule_type: string
  is_active: string
}

const DEFAULT_FILTERS: Filters = {
  created_from: '',
  created_to: '',
  eff_from: '',
  eff_to: '',
  discount_category_id: '',
  discount_rule_type: '',
  is_active: 'all',
}

const RULE_TYPES = ['campaign', 'combo', 'discount_rule', 'bulk', 'negotiation', 'manual']

const REWARD_COLOR: Record<string, string> = {
  percentage:    '#4CAF50',
  flat:          '#2196F3',
  bonus:         '#9C27B0',
  free_delivery: '#FF9800',
}

const RULE_BG: Record<string, string> = {
  campaign:      'rgba(33,150,243,0.15)',
  combo:         'rgba(156,39,176,0.15)',
  discount_rule: 'rgba(76,175,80,0.15)',
  bulk:          'rgba(255,152,0,0.15)',
  negotiation:   'rgba(244,67,54,0.15)',
  manual:        'rgba(96,125,139,0.15)',
}

const RULE_TEXT: Record<string, string> = {
  campaign:      '#64B5F6',
  combo:         '#CE93D8',
  discount_rule: '#81C784',
  bulk:          '#FFB74D',
  negotiation:   '#EF9A9A',
  manual:        '#90A4AE',
}

function buildParams(f: Filters): Record<string, string> {
  const p: Record<string, string> = {}
  if (f.created_from) p.created_from = f.created_from
  if (f.created_to)   p.created_to   = f.created_to
  if (f.eff_from)     p.eff_from      = f.eff_from
  if (f.eff_to)       p.eff_to        = f.eff_to
  if (f.discount_category_id) p.discount_category_id = f.discount_category_id
  if (f.discount_rule_type)   p.discount_rule_type   = f.discount_rule_type
  if (f.is_active !== 'all')  p.is_active            = f.is_active
  return p
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function discountValueLabel(r: DiscountReportRow): string {
  if (r.reward_type === 'percentage')    return `${r.discount_pct}%`
  if (r.reward_type === 'flat')          return `৳${Number(r.discount_flat).toFixed(2)}`
  if (r.reward_type === 'bonus')         return 'Bonus Items'
  if (r.reward_type === 'free_delivery') return 'Free Delivery'
  return '—'
}

export default function DiscountsReportPage() {
  const [rows,       setRows]       = useState<DiscountReportRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [categories, setCategories] = useState<{ category_id: string; name: string }[]>([])
  const [applied,    setApplied]    = useState<Filters>(DEFAULT_FILTERS)
  const [pending,    setPending]    = useState<Filters>(DEFAULT_FILTERS)
  const [toggling,   setToggling]   = useState<string | null>(null)

  // Load categories once
  useEffect(() => {
    discountCategoriesAPI.list().then(setCategories).catch(() => {})
  }, [])

  // Fetch report whenever applied filters change
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    discountsAPI.report(buildParams(applied))
      .then(data => { if (!cancelled) setRows(data) })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as { message?: string }).message || 'Failed to load')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [applied])

  function applyFilters() { setApplied({ ...pending }) }
  function resetFilters()  { const f = DEFAULT_FILTERS; setPending(f); setApplied(f) }

  async function handleToggle(code: string, current: boolean) {
    if (toggling) return
    setToggling(code)
    try {
      await discountsAPI.toggle(code, !current)
      setRows(prev => prev.map(r =>
        r.discount_code === code ? { ...r, is_active: !current } : r
      ))
    } catch { /* keep original state */ }
    finally { setToggling(null) }
  }

  const totalDiscountAmount = rows.reduce((s, r) => s + (r.total_discount_amount ?? 0), 0)
  const activeCount = rows.filter(r => r.is_active !== false).length

  const inputStyle = {
    background: 'var(--c-surface2)',
    border: '1px solid var(--c-border)',
    color: 'var(--c-text)',
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--c-text)' }}>
            Discounts Report
          </h1>
          <p className="text-sm" style={{ color: 'var(--c-muted)' }}>
            Applied discount codes, performance tracking and activation control
          </p>
        </div>
        <button
          onClick={() => setApplied(a => ({ ...a }))}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs"
          style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {[
          { icon: Receipt,      label: 'Total Codes',     value: String(rows.length),                  color: '#2196F3' },
          { icon: CheckCircle,  label: 'Active',          value: String(activeCount),                  color: '#4CAF50' },
          { icon: TrendingDown, label: 'Total Discounted', value: `৳${totalDiscountAmount.toFixed(2)}`, color: '#FF5722' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="rounded-xl p-4"
               style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded flex items-center justify-center"
                   style={{ background: `${color}20` }}>
                <Icon size={14} style={{ color }} />
              </div>
              <span className="text-xs" style={{ color: 'var(--c-muted)' }}>{label}</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--c-text)' }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="rounded-xl p-4 mb-5"
           style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} style={{ color: 'var(--c-muted)' }} />
          <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--c-muted)' }}>FILTERS</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-3">
          {/* Created from */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Created From</label>
            <input type="date" value={pending.created_from}
              onChange={e => setPending(p => ({ ...p, created_from: e.target.value }))}
              className="w-full rounded px-2 py-1.5 text-xs" style={inputStyle} />
          </div>

          {/* Created to */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Created To</label>
            <input type="date" value={pending.created_to}
              onChange={e => setPending(p => ({ ...p, created_to: e.target.value }))}
              className="w-full rounded px-2 py-1.5 text-xs" style={inputStyle} />
          </div>

          {/* Effective from */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Effective From</label>
            <input type="date" value={pending.eff_from}
              onChange={e => setPending(p => ({ ...p, eff_from: e.target.value }))}
              className="w-full rounded px-2 py-1.5 text-xs" style={inputStyle} />
          </div>

          {/* Effective to */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Effective To</label>
            <input type="date" value={pending.eff_to}
              onChange={e => setPending(p => ({ ...p, eff_to: e.target.value }))}
              className="w-full rounded px-2 py-1.5 text-xs" style={inputStyle} />
          </div>

          {/* Category */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Category</label>
            <select value={pending.discount_category_id}
              onChange={e => setPending(p => ({ ...p, discount_category_id: e.target.value }))}
              className="w-full rounded px-2 py-1.5 text-xs" style={inputStyle}>
              <option value="">All Categories</option>
              {categories.map(c => (
                <option key={c.category_id} value={c.category_id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Rule type */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Rule Type</label>
            <select value={pending.discount_rule_type}
              onChange={e => setPending(p => ({ ...p, discount_rule_type: e.target.value }))}
              className="w-full rounded px-2 py-1.5 text-xs" style={inputStyle}>
              <option value="">All Types</option>
              {RULE_TYPES.map(t => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {/* Is Active */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Status</label>
            <select value={pending.is_active}
              onChange={e => setPending(p => ({ ...p, is_active: e.target.value }))}
              className="w-full rounded px-2 py-1.5 text-xs" style={inputStyle}>
              <option value="all">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={applyFilters}
            className="px-4 py-1.5 rounded text-xs font-semibold text-white"
            style={{ background: 'var(--c-accent)' }}>
            Apply
          </button>
          <button onClick={resetFilters}
            className="px-4 py-1.5 rounded text-xs"
            style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
            Reset
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg p-3 mb-4 text-sm"
             style={{ background: 'rgba(244,67,54,0.1)', color: '#EF9A9A' }}>
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="spinner h-6 w-6" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--c-muted)' }}>
          <Receipt size={36} className="mx-auto mb-3 opacity-25" />
          <p className="text-sm font-medium">No discount records found</p>
          <p className="text-xs mt-1 opacity-70">
            Discounts appear here once orders with discount codes are placed
          </p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden"
             style={{ border: '1px solid var(--c-border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: '1160px' }}>
              <thead>
                <tr style={{ background: 'var(--c-surface2)', borderBottom: '1px solid var(--c-border)' }}>
                  {[
                    'Discount Code', 'Rule Type', 'Rule Name', 'Category',
                    'Reward Type', 'Discount Value', 'Creation Date',
                    'Eff. From', 'Eff. To', 'Active',
                    'Orders', 'Total Discount',
                  ].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold"
                        style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.discount_code}
                      style={{
                        background: i % 2 === 0 ? 'var(--c-card)' : 'var(--c-surface)',
                        borderBottom: '1px solid var(--c-border)',
                        opacity: row.is_active === false ? 0.55 : 1,
                      }}>

                    {/* Discount Code */}
                    <td className="px-3 py-2.5">
                      <span className="font-mono px-2 py-0.5 rounded text-xs"
                            style={{ background: 'rgba(4,170,109,0.12)', color: '#04AA6D' }}>
                        {row.discount_code}
                      </span>
                    </td>

                    {/* Rule Type */}
                    <td className="px-3 py-2.5">
                      <span className="px-2 py-0.5 rounded text-xs"
                            style={{
                              background: RULE_BG[row.discount_rule_type]  || 'rgba(96,125,139,0.15)',
                              color:      RULE_TEXT[row.discount_rule_type] || '#90A4AE',
                            }}>
                        {row.discount_rule_type.replace(/_/g, ' ')}
                      </span>
                    </td>

                    {/* Rule Name */}
                    <td className="px-3 py-2.5"
                        style={{ color: 'var(--c-text)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={row.discount_rule_name}>
                      {row.discount_rule_name || '—'}
                    </td>

                    {/* Category */}
                    <td className="px-3 py-2.5" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                      {row.discount_category_name || '—'}
                    </td>

                    {/* Reward Type */}
                    <td className="px-3 py-2.5">
                      <span className="px-2 py-0.5 rounded text-xs"
                            style={{
                              background: `${REWARD_COLOR[row.reward_type] || '#607D8B'}20`,
                              color:      REWARD_COLOR[row.reward_type]  || '#90A4AE',
                            }}>
                        {row.reward_type.replace(/_/g, ' ')}
                      </span>
                    </td>

                    {/* Discount Value */}
                    <td className="px-3 py-2.5 font-semibold" style={{ color: '#FF7043' }}>
                      {discountValueLabel(row)}
                    </td>

                    {/* Creation Date */}
                    <td className="px-3 py-2.5" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                      {fmtDate(row.created_at)}
                    </td>

                    {/* Effective From */}
                    <td className="px-3 py-2.5" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                      {fmtDate(row.effective_from)}
                    </td>

                    {/* Effective To */}
                    <td className="px-3 py-2.5" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                      {fmtDate(row.effective_to)}
                    </td>

                    {/* Is Active toggle */}
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => handleToggle(row.discount_code, row.is_active)}
                        disabled={toggling === row.discount_code}
                        title={row.is_active ? 'Deactivate' : 'Activate'}
                        style={{ opacity: toggling === row.discount_code ? 0.5 : 1 }}
                      >
                        {row.is_active
                          ? <ToggleRight size={22} style={{ color: '#4CAF50' }} />
                          : <ToggleLeft  size={22} style={{ color: '#607D8B' }} />
                        }
                      </button>
                    </td>

                    {/* Orders Count */}
                    <td className="px-3 py-2.5 text-center font-semibold" style={{ color: 'var(--c-text)' }}>
                      {row.orders_count}
                    </td>

                    {/* Total Discount Amount */}
                    <td className="px-3 py-2.5 font-bold" style={{ color: '#4CAF50' }}>
                      ৳{Number(row.total_discount_amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-4 py-2 text-xs flex items-center justify-between"
               style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', borderTop: '1px solid var(--c-border)' }}>
            <span>{rows.length} discount code{rows.length !== 1 ? 's' : ''}</span>
            <span>Total saved: ৳{totalDiscountAmount.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
