'use client'
import { useEffect, useState, useCallback } from 'react'
import { discountRulesAPI, productsAPI } from '@/lib/api'
import type { DiscountRule, Product } from '@/types'
import {
  Plus, Trash2, Edit2, X, ChevronDown, ChevronRight,
  ShoppingCart, RefreshCw, User, Tag, Hash, MapPin,
  Clock, Calendar, Percent, Gift, Package, Search,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────

type RuleType =
  | 'cart_value' | 'repeated_customer' | 'new_customer'
  | 'specific_product' | 'specific_category' | 'bulk_quantity'
  | 'district' | 'time_based' | 'seasonal' | 'lifetime_value'

interface BonusItem { product_id: string; sku: string; name: string; quantity: number }

interface Reward {
  reward_type: 'percentage' | 'flat' | 'bonus' | 'free_delivery'
  discount_value: number
  bonus_items: BonusItem[]
}

// ── Constants ─────────────────────────────────────────────────

const RULE_TYPES: RuleType[] = [
  'cart_value', 'repeated_customer', 'new_customer',
  'specific_product', 'specific_category', 'bulk_quantity',
  'district', 'time_based', 'seasonal', 'lifetime_value',
]

const RULE_META: Record<RuleType, {
  label: string
  description: string
  icon: React.ElementType
  color: string
}> = {
  cart_value:        { label: 'Cart Value',          description: '৳ amount threshold',        icon: ShoppingCart, color: '#1565C0' },
  repeated_customer: { label: 'Repeated Customer',   description: 'Time-based return tiers',   icon: RefreshCw,    color: '#6A1B9A' },
  new_customer:      { label: 'New Customer',        description: 'First order only',          icon: User,         color: '#00695C' },
  specific_product:  { label: 'Specific Product',    description: 'By product SKU',            icon: Tag,          color: '#E65100' },
  specific_category: { label: 'Specific Category',   description: 'By product category',      icon: Package,      color: '#AD1457' },
  bulk_quantity:     { label: 'Bulk Quantity',        description: 'Minimum quantity ordered', icon: Hash,         color: '#F57F17' },
  district:          { label: 'District / Location', description: 'Delivery area',            icon: MapPin,       color: '#2E7D32' },
  time_based:        { label: 'Time Based',          description: 'Day / hour window',        icon: Clock,        color: '#0277BD' },
  seasonal:          { label: 'Seasonal',            description: 'Date range',               icon: Calendar,     color: '#6A1B9A' },
  lifetime_value:    { label: 'Lifetime Value',      description: 'Total purchase history',   icon: Percent,      color: '#BF360C' },
}

const BD_DISTRICTS = [
  'Bagerhat','Bandarban','Barguna','Barisal','Bhola','Bogra','Brahmanbaria',
  'Chandpur','Chapainawabganj','Chattogram','Chuadanga','Cumilla',"Cox's Bazar",
  'Dhaka','Dinajpur','Faridpur','Feni','Gaibandha','Gazipur','Gopalganj',
  'Habiganj','Jamalpur','Jashore','Jhalokathi','Jhenaidah','Joypurhat',
  'Khagrachhari','Khulna','Kishoreganj','Kurigram','Kushtia','Lakshmipur',
  'Lalmonirhat','Madaripur','Magura','Manikganj','Meherpur','Moulvibazar',
  'Munshiganj','Mymensingh','Naogaon','Narail','Narayanganj','Narsingdi',
  'Natore','Netrakona','Nilphamari','Noakhali','Pabna','Panchagarh',
  'Patuakhali','Pirojpur','Rajbari','Rajshahi','Rangamati','Rangpur',
  'Satkhira','Shariatpur','Sherpur','Sirajganj','Sunamganj','Sylhet',
  'Tangail','Thakurgaon',
]

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

// ── Helpers ───────────────────────────────────────────────────

function emptyReward(): Reward {
  return { reward_type: 'percentage', discount_value: 0, bonus_items: [] }
}

function emptyConditions(type: RuleType): Record<string, unknown> {
  switch (type) {
    case 'cart_value':        return { min_amount: 500 }
    case 'repeated_customer': return { tiers: [{ from_days: 0, to_days: 30, reward: emptyReward() }] }
    case 'new_customer':      return {}
    case 'specific_product':  return { skus: [] }
    case 'specific_category': return { categories: [] }
    case 'bulk_quantity':     return { min_quantity: 2 }
    case 'district':          return { districts: [] }
    case 'time_based':        return { days_of_week: [], from_time: '09:00', to_time: '21:00' }
    case 'seasonal':          return { start_date: '', end_date: '' }
    case 'lifetime_value':    return { min_lifetime_value: 5000 }
  }
}

function conditionSummary(rule: DiscountRule): string {
  const c = rule.conditions as Record<string, unknown>
  switch (rule.rule_type) {
    case 'cart_value':        return `Min ৳${c.min_amount}`
    case 'new_customer':      return 'First order only'
    case 'bulk_quantity':     return `Min qty ${c.min_quantity}`
    case 'district':          return `${(c.districts as string[] | undefined)?.slice(0,2).join(', ') || '—'}`
    case 'time_based': {
      const days = ((c.days_of_week as string[]) || []).slice(0, 3).join(',')
      return `${days || '—'} ${c.from_time}–${c.to_time}`
    }
    case 'seasonal':          return `${c.start_date} → ${c.end_date}`
    case 'lifetime_value':    return `Min LTV ৳${c.min_lifetime_value}`
    case 'specific_product':  return `SKU: ${(c.skus as string[] | undefined)?.slice(0,2).join(', ') || '—'}`
    case 'specific_category': return `Cat: ${(c.categories as string[] | undefined)?.slice(0,2).join(', ') || '—'}`
    case 'repeated_customer': {
      const tiers = (c.tiers as unknown[]) || []
      return `${tiers.length} tier${tiers.length !== 1 ? 's' : ''}`
    }
    default: return '—'
  }
}

function rewardSummary(reward: Reward | undefined): string {
  if (!reward) return '—'
  if (reward.reward_type === 'percentage')    return `${reward.discount_value}% off`
  if (reward.reward_type === 'flat')          return `৳${reward.discount_value} off`
  if (reward.reward_type === 'bonus')         return `Bonus (${reward.bonus_items?.length ?? 0} items)`
  if (reward.reward_type === 'free_delivery') return 'Free Delivery'
  return '—'
}

// ── Reward Selector ───────────────────────────────────────────

function RewardSelector({ reward, onChange, products }: {
  reward: Reward
  onChange: (r: Reward) => void
  products: Product[]
}) {
  const [search, setSearch] = useState('')
  const inp = { background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {(['percentage','flat','bonus','free_delivery'] as const).map(t => (
          <button key={t} type="button"
            onClick={() => onChange({ ...reward, reward_type: t })}
            className="flex-1 py-1.5 rounded text-xs font-semibold"
            style={{
              background: reward.reward_type === t ? 'var(--c-accent)' : 'var(--c-surface2)',
              color:      reward.reward_type === t ? '#fff' : 'var(--c-muted)',
              border:     '1px solid var(--c-border)',
            }}>
            {t === 'percentage' ? '% Off' : t === 'flat' ? '৳ Off' : t === 'bonus' ? 'Bonus' : 'Free Del.'}
          </button>
        ))}
      </div>

      {reward.reward_type === 'percentage' && (
        <input type="number" min={0} max={100} value={reward.discount_value}
          onChange={e => onChange({ ...reward, discount_value: Number(e.target.value) })}
          placeholder="Discount %" className="w-full rounded px-3 py-2 text-sm" style={inp} />
      )}
      {reward.reward_type === 'flat' && (
        <input type="number" min={0} value={reward.discount_value}
          onChange={e => onChange({ ...reward, discount_value: Number(e.target.value) })}
          placeholder="Flat discount ৳" className="w-full rounded px-3 py-2 text-sm" style={inp} />
      )}
      {reward.reward_type === 'bonus' && (
        <div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search product to add as bonus…"
            className="w-full rounded px-3 py-2 text-xs mb-1.5" style={inp} />
          {search && (
            <div className="rounded border mb-2 overflow-y-auto" style={{ border: '1px solid var(--c-border)', maxHeight: 130 }}>
              {products
                .filter(p => (p.name + p.sku).toLowerCase().includes(search.toLowerCase()))
                .slice(0, 6)
                .map(p => (
                  <button key={p.product_id} type="button"
                    className="w-full text-left px-3 py-1.5 text-xs"
                    style={{ color: 'var(--c-text)', borderBottom: '1px solid var(--c-border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--c-surface2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => {
                      if (!reward.bonus_items.find(b => b.product_id === p.product_id)) {
                        onChange({ ...reward, bonus_items: [...reward.bonus_items, { product_id: p.product_id, sku: p.sku, name: p.name, quantity: 1 }] })
                      }
                      setSearch('')
                    }}>
                    {p.name} <span style={{ color: 'var(--c-muted)' }}>({p.sku})</span>
                  </button>
                ))}
            </div>
          )}
          {reward.bonus_items.map((b, i) => (
            <div key={b.product_id} className="flex items-center gap-2 mb-1">
              <span className="flex-1 text-xs truncate" style={{ color: 'var(--c-text)' }}>{b.name}</span>
              <input type="number" min={1} value={b.quantity}
                onChange={e => {
                  const items = [...reward.bonus_items]
                  items[i] = { ...b, quantity: Number(e.target.value) }
                  onChange({ ...reward, bonus_items: items })
                }}
                className="w-14 rounded px-2 py-1 text-xs" style={inp} />
              <button type="button" onClick={() => onChange({ ...reward, bonus_items: reward.bonus_items.filter((_, j) => j !== i) })}>
                <X size={12} style={{ color: 'var(--c-muted)' }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Condition Fields ──────────────────────────────────────────

function ConditionFields({ type, conditions, onChange, products }: {
  type: RuleType
  conditions: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  products: Product[]
}) {
  const inp = { background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }
  const label = (t: string) => (
    <label className="text-xs mb-1 block font-medium" style={{ color: 'var(--c-muted)' }}>{t}</label>
  )
  const [prodSearch,  setProdSearch]  = useState('')
  const [distSearch,  setDistSearch]  = useState('')

  if (type === 'cart_value') return (
    <div>
      {label('Minimum cart amount (৳)')}
      <input type="number" value={Number(conditions.min_amount) || 0}
        onChange={e => onChange({ ...conditions, min_amount: Number(e.target.value) })}
        className="w-full rounded px-3 py-2 text-sm" style={inp} />
    </div>
  )

  if (type === 'bulk_quantity') return (
    <div>
      {label('Minimum quantity')}
      <input type="number" min={1} value={Number(conditions.min_quantity) || 1}
        onChange={e => onChange({ ...conditions, min_quantity: Number(e.target.value) })}
        className="w-full rounded px-3 py-2 text-sm" style={inp} />
    </div>
  )

  if (type === 'lifetime_value') return (
    <div>
      {label('Minimum lifetime purchase value (৳)')}
      <input type="number" value={Number(conditions.min_lifetime_value) || 0}
        onChange={e => onChange({ ...conditions, min_lifetime_value: Number(e.target.value) })}
        className="w-full rounded px-3 py-2 text-sm" style={inp} />
    </div>
  )

  if (type === 'new_customer') return (
    <p className="text-xs py-2" style={{ color: 'var(--c-muted)' }}>
      No extra conditions — rule automatically applies to any customer placing their first order.
    </p>
  )

  if (type === 'specific_product') {
    const skus: string[] = (conditions.skus as string[]) || []
    return (
      <div>
        <div className="relative mb-2">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }} />
          <input value={prodSearch} onChange={e => setProdSearch(e.target.value)}
            placeholder="Search product…"
            className="w-full rounded pl-7 pr-3 py-1.5 text-xs" style={inp} />
        </div>
        {prodSearch && (
          <div className="rounded border mb-2 overflow-y-auto" style={{ border: '1px solid var(--c-border)', maxHeight: 120 }}>
            {products.filter(p => (p.name + p.sku).toLowerCase().includes(prodSearch.toLowerCase()))
              .slice(0, 6).map(p => (
                <button key={p.sku} type="button"
                  className="w-full text-left px-3 py-1.5 text-xs"
                  style={{ color: 'var(--c-text)', borderBottom: '1px solid var(--c-border)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--c-surface2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => {
                    if (!skus.includes(p.sku)) onChange({ ...conditions, skus: [...skus, p.sku] })
                    setProdSearch('')
                  }}>
                  {p.name} <span style={{ color: 'var(--c-muted)' }}>({p.sku})</span>
                </button>
              ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {skus.map(s => (
            <span key={s} className="flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                  style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}>
              {s}
              <button type="button" onClick={() => onChange({ ...conditions, skus: skus.filter(x => x !== s) })}>
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
        {skus.length === 0 && !prodSearch && (
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>No products selected yet.</p>
        )}
      </div>
    )
  }

  if (type === 'specific_category') {
    const cats = Array.from(new Set(products.map(p => p.category).filter(Boolean))) as string[]
    const sel: string[] = (conditions.categories as string[]) || []
    return (
      <div>
        {cats.length === 0
          ? <p className="text-xs" style={{ color: 'var(--c-muted)' }}>No categories found in your products.</p>
          : <div className="flex flex-wrap gap-1.5">
              {cats.map(c => (
                <button key={c} type="button"
                  className="px-2.5 py-1 rounded text-xs"
                  style={{
                    background: sel.includes(c) ? 'var(--c-accent)' : 'var(--c-surface2)',
                    color:      sel.includes(c) ? '#fff' : 'var(--c-muted)',
                    border:     '1px solid var(--c-border)',
                  }}
                  onClick={() => onChange({ ...conditions, categories: sel.includes(c) ? sel.filter(x => x !== c) : [...sel, c] })}>
                  {c}
                </button>
              ))}
            </div>
        }
        {sel.length > 0 && (
          <p className="text-xs mt-1.5" style={{ color: 'var(--c-muted)' }}>{sel.length} selected</p>
        )}
      </div>
    )
  }

  if (type === 'district') {
    const sel: string[] = (conditions.districts as string[]) || []
    const filtered = BD_DISTRICTS.filter(d => d.toLowerCase().includes(distSearch.toLowerCase()))
    return (
      <div>
        <div className="relative mb-2">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }} />
          <input value={distSearch} onChange={e => setDistSearch(e.target.value)}
            placeholder="Search district…"
            className="w-full rounded pl-7 pr-3 py-1.5 text-xs" style={inp} />
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto mb-1.5">
          {filtered.slice(0, 30).map(d => (
            <button key={d} type="button"
              className="px-2 py-0.5 rounded text-xs"
              style={{
                background: sel.includes(d) ? 'var(--c-accent)' : 'var(--c-surface2)',
                color:      sel.includes(d) ? '#fff' : 'var(--c-muted)',
                border:     '1px solid var(--c-border)',
              }}
              onClick={() => onChange({ ...conditions, districts: sel.includes(d) ? sel.filter(x => x !== d) : [...sel, d] })}>
              {d}
            </button>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--c-muted)' }}>{sel.length} district{sel.length !== 1 ? 's' : ''} selected</p>
      </div>
    )
  }

  if (type === 'time_based') {
    const activeDays: string[] = (conditions.days_of_week as string[]) || []
    return (
      <div className="space-y-3">
        <div>
          {label('Days of week')}
          <div className="flex gap-1 flex-wrap">
            {DAYS.map(d => (
              <button key={d} type="button"
                className="px-2.5 py-1 rounded text-xs font-medium"
                style={{
                  background: activeDays.includes(d) ? 'var(--c-accent)' : 'var(--c-surface2)',
                  color:      activeDays.includes(d) ? '#fff' : 'var(--c-muted)',
                  border:     '1px solid var(--c-border)',
                }}
                onClick={() => onChange({ ...conditions, days_of_week: activeDays.includes(d) ? activeDays.filter(x => x !== d) : [...activeDays, d] })}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            {label('From time')}
            <input type="time" value={String(conditions.from_time || '09:00')}
              onChange={e => onChange({ ...conditions, from_time: e.target.value })}
              className="w-full rounded px-3 py-2 text-sm" style={inp} />
          </div>
          <div>
            {label('To time')}
            <input type="time" value={String(conditions.to_time || '21:00')}
              onChange={e => onChange({ ...conditions, to_time: e.target.value })}
              className="w-full rounded px-3 py-2 text-sm" style={inp} />
          </div>
        </div>
      </div>
    )
  }

  if (type === 'seasonal') return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        {label('Start date')}
        <input type="date" value={String(conditions.start_date || '')}
          onChange={e => onChange({ ...conditions, start_date: e.target.value })}
          className="w-full rounded px-3 py-2 text-sm" style={inp} />
      </div>
      <div>
        {label('End date')}
        <input type="date" value={String(conditions.end_date || '')}
          onChange={e => onChange({ ...conditions, end_date: e.target.value })}
          className="w-full rounded px-3 py-2 text-sm" style={inp} />
      </div>
    </div>
  )

  if (type === 'repeated_customer') {
    type Tier = { from_days: number; to_days: number; reward: Reward }
    const tiers: Tier[] = (conditions.tiers as Tier[]) || []
    return (
      <div>
        {label('Tiers — days since last order → reward')}
        {tiers.map((tier, i) => (
          <div key={i} className="rounded-lg p-3 mb-2"
               style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <input type="number" min={0} value={tier.from_days}
                onChange={e => { const t = [...tiers]; t[i] = { ...t[i], from_days: Number(e.target.value) }; onChange({ ...conditions, tiers: t }) }}
                placeholder="From days"
                className="flex-1 rounded px-2 py-1.5 text-xs" style={inp} />
              <span className="text-xs" style={{ color: 'var(--c-muted)' }}>—</span>
              <input type="number" min={0} value={tier.to_days}
                onChange={e => { const t = [...tiers]; t[i] = { ...t[i], to_days: Number(e.target.value) }; onChange({ ...conditions, tiers: t }) }}
                placeholder="To days"
                className="flex-1 rounded px-2 py-1.5 text-xs" style={inp} />
              <button type="button" onClick={() => onChange({ ...conditions, tiers: tiers.filter((_, j) => j !== i) })}>
                <X size={13} style={{ color: '#ef9a9a' }} />
              </button>
            </div>
            <p className="text-xs mb-1" style={{ color: 'var(--c-muted)' }}>Reward for this tier:</p>
            <RewardSelector reward={tier.reward || emptyReward()} products={[]}
              onChange={r => { const t = [...tiers]; t[i] = { ...t[i], reward: r }; onChange({ ...conditions, tiers: t }) }} />
          </div>
        ))}
        <button type="button"
          onClick={() => onChange({ ...conditions, tiers: [...tiers, { from_days: 0, to_days: 30, reward: emptyReward() }] })}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded mt-1"
          style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
          <Plus size={11} /> Add Tier
        </button>
      </div>
    )
  }

  return null
}

// ── Inline Rule Form ──────────────────────────────────────────

function RuleForm({ type, initial, products, onSave, onCancel, color }: {
  type: RuleType
  initial?: DiscountRule
  products: Product[]
  color: string
  onSave: (data: { rule_name: string; conditions: Record<string, unknown>; reward: Reward }) => Promise<void>
  onCancel: () => void
}) {
  const [name,       setName]       = useState(initial?.rule_name || '')
  const [conditions, setConditions] = useState<Record<string, unknown>>(
    (initial?.conditions as Record<string, unknown>) || emptyConditions(type)
  )
  const [reward, setReward] = useState<Reward>(
    (initial?.reward as unknown as Reward) || emptyReward()
  )
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setSaving(true)
    try { await onSave({ rule_name: name, conditions, reward }) }
    finally { setSaving(false) }
  }

  return (
    <div className="rounded-xl p-4 mt-2"
         style={{ background: 'var(--c-surface)', border: `1px solid ${color}40` }}>
      <div className="space-y-3">
        {/* Name */}
        <div>
          <label className="text-xs mb-1 block font-semibold" style={{ color: 'var(--c-muted)' }}>Rule Name *</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder={`e.g. ${RULE_META[type].label} Offer`}
            className="w-full rounded px-3 py-2 text-sm"
            style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
        </div>

        {/* Conditions */}
        <div>
          <p className="text-xs mb-1.5 font-semibold" style={{ color: 'var(--c-muted)' }}>Conditions</p>
          <ConditionFields key={`${type}-${initial?.rule_id || 'new'}`}
            type={type} conditions={conditions} onChange={setConditions} products={products} />
        </div>

        {/* Reward — repeated_customer handles per-tier rewards inside ConditionFields */}
        {type !== 'repeated_customer' && (
          <div>
            <p className="text-xs mb-1.5 font-semibold" style={{ color: 'var(--c-muted)' }}>Reward</p>
            <RewardSelector reward={reward} onChange={setReward} products={products} />
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2 pt-1">
          <button onClick={submit} disabled={saving || !name.trim()}
            className="px-4 py-1.5 rounded text-xs font-semibold text-white"
            style={{ background: saving || !name.trim() ? 'var(--c-muted)' : color }}>
            {saving ? 'Saving…' : initial ? 'Update' : 'Save Rule'}
          </button>
          <button onClick={onCancel}
            className="px-4 py-1.5 rounded text-xs"
            style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Rule Card ─────────────────────────────────────────────────

function RuleCard({ rule, color, onEdit, onDelete }: {
  rule: DiscountRule
  color: string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2.5"
         style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
      <div className="w-1.5 self-stretch rounded-full flex-shrink-0 mt-0.5"
           style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>{rule.rule_name}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>
          <span>{conditionSummary(rule)}</span>
          <span className="mx-1.5 opacity-40">·</span>
          <span style={{ color: '#4CAF50' }}>{rewardSummary(rule.reward as unknown as Reward)}</span>
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={onEdit} title="Edit"
          className="w-7 h-7 rounded flex items-center justify-center"
          style={{ background: 'var(--c-surface2)' }}>
          <Edit2 size={11} style={{ color: 'var(--c-muted)' }} />
        </button>
        <button onClick={onDelete} title="Delete"
          className="w-7 h-7 rounded flex items-center justify-center"
          style={{ background: 'rgba(244,67,54,0.1)' }}>
          <Trash2 size={11} style={{ color: '#ef9a9a' }} />
        </button>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

export default function DiscountRulesPage() {
  const [rules,     setRules]     = useState<DiscountRule[]>([])
  const [products,  setProducts]  = useState<Product[]>([])
  const [loading,   setLoading]   = useState(true)
  // which sections are open
  const [expanded,  setExpanded]  = useState<Set<RuleType>>(new Set())
  // which section's "add" form is open
  const [addingTo,  setAddingTo]  = useState<RuleType | null>(null)
  // which rule_id's "edit" form is open
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([discountRulesAPI.list(), productsAPI.list()])
      .then(([r, p]) => { setRules(r); setProducts(p) })
      .finally(() => setLoading(false))
  }, [])

  function toggleSection(type: RuleType) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
        if (addingTo  === type) setAddingTo(null)
        if (editingId) {
          const r = rules.find(r => r.rule_id === editingId)
          if (r?.rule_type === type) setEditingId(null)
        }
      } else {
        next.add(type)
      }
      return next
    })
  }

  function openAdd(type: RuleType) {
    setExpanded(prev => new Set(prev).add(type))
    setEditingId(null)
    setAddingTo(type)
  }

  function openEdit(rule: DiscountRule) {
    const type = rule.rule_type as RuleType
    setExpanded(prev => new Set(prev).add(type))
    setAddingTo(null)
    setEditingId(rule.rule_id)
  }

  async function handleSave(type: RuleType, data: { rule_name: string; conditions: Record<string, unknown>; reward: Reward }) {
    const payload = { rule_type: type, ...data }
    if (editingId) {
      const updated = await discountRulesAPI.update(editingId, payload)
      setRules(prev => prev.map(r => r.rule_id === updated.rule_id ? updated : r))
      setEditingId(null)
    } else {
      const created = await discountRulesAPI.create(payload)
      setRules(prev => [...prev, created])
      setAddingTo(null)
    }
  }

  async function handleDelete(rule: DiscountRule) {
    if (!confirm(`Delete "${rule.rule_name}"?`)) return
    await discountRulesAPI.delete(rule.rule_id)
    setRules(prev => prev.filter(r => r.rule_id !== rule.rule_id))
    if (editingId === rule.rule_id) setEditingId(null)
  }

  const totalRules = rules.length

  if (loading) return (
    <div className="flex justify-center py-20"><div className="spinner h-6 w-6" /></div>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--c-text)' }}>Discount Rules</h1>
          <p className="text-sm" style={{ color: 'var(--c-muted)' }}>
            Discount-এর জন্য logic তৈরি করুন। এই rules পরে Discount-এ add করা যাবে।
          </p>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
              style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
          {totalRules} rule{totalRules !== 1 ? 's' : ''}
        </span>
      </div>

      {/* 10 sections */}
      <div className="space-y-2">
        {RULE_TYPES.map(type => {
          const { label, description, icon: Icon, color } = RULE_META[type]
          const typeRules = rules.filter(r => r.rule_type === type)
          const isOpen    = expanded.has(type)
          const isAdding  = addingTo === type

          return (
            <div key={type} className="rounded-xl overflow-hidden"
                 style={{ border: `1px solid ${isOpen ? color + '50' : 'var(--c-border)'}`, transition: 'border-color 0.2s' }}>

              {/* Section header */}
              <button
                onClick={() => toggleSection(type)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
                style={{ background: isOpen ? `${color}0D` : 'var(--c-card)' }}>

                {/* Icon */}
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                     style={{ background: `${color}20` }}>
                  <Icon size={15} style={{ color }} />
                </div>

                {/* Labels */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>{label}</p>
                  <p className="text-xs" style={{ color: 'var(--c-muted)' }}>{description}</p>
                </div>

                {/* Rule count badge */}
                {typeRules.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold flex-shrink-0"
                        style={{ background: `${color}20`, color }}>
                    {typeRules.length}
                  </span>
                )}

                {/* Chevron */}
                {isOpen
                  ? <ChevronDown  size={16} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
                  : <ChevronRight size={16} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
                }
              </button>

              {/* Section body */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1"
                     style={{ background: 'var(--c-surface)', borderTop: `1px solid ${color}30` }}>

                  {/* Existing rules */}
                  {typeRules.length > 0 ? (
                    <div className="space-y-2 mb-3">
                      {typeRules.map(rule => (
                        editingId === rule.rule_id ? (
                          <RuleForm
                            key={rule.rule_id}
                            type={type}
                            initial={rule}
                            products={products}
                            color={color}
                            onSave={data => handleSave(type, data)}
                            onCancel={() => setEditingId(null)}
                          />
                        ) : (
                          <RuleCard
                            key={rule.rule_id}
                            rule={rule}
                            color={color}
                            onEdit={() => openEdit(rule)}
                            onDelete={() => handleDelete(rule)}
                          />
                        )
                      ))}
                    </div>
                  ) : (
                    !isAdding && (
                      <p className="text-xs py-2 mb-2" style={{ color: 'var(--c-muted)' }}>
                        No {label.toLowerCase()} rules yet.
                      </p>
                    )
                  )}

                  {/* Add form */}
                  {isAdding ? (
                    <RuleForm
                      key={`add-${type}`}
                      type={type}
                      products={products}
                      color={color}
                      onSave={data => handleSave(type, data)}
                      onCancel={() => setAddingTo(null)}
                    />
                  ) : (
                    <button
                      onClick={() => openAdd(type)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold"
                      style={{ background: `${color}15`, color, border: `1px dashed ${color}60` }}>
                      <Plus size={12} />
                      Add {label} Rule
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
