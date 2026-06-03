'use client'
import { useEffect, useState } from 'react'
import { discountRulesAPI, productsAPI } from '@/lib/api'
import type { DiscountRule, Product } from '@/types'
import {
  Plus, Trash2, Edit2, X, ShoppingCart, RefreshCw, User,
  Tag, Hash, MapPin, Clock, Calendar, Percent, Gift, Search,
  Package,
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

const RULE_META: Record<RuleType, { label: string; icon: React.ElementType; color: string }> = {
  cart_value:        { label: 'Cart Value',        icon: ShoppingCart, color: '#1565C0' },
  repeated_customer: { label: 'Repeated Customer', icon: RefreshCw,    color: '#6A1B9A' },
  new_customer:      { label: 'New Customer',      icon: User,         color: '#00695C' },
  specific_product:  { label: 'Specific Product',  icon: Tag,          color: '#E65100' },
  specific_category: { label: 'Specific Category', icon: Package,      color: '#AD1457' },
  bulk_quantity:     { label: 'Bulk Quantity',      icon: Hash,         color: '#F57F17' },
  district:          { label: 'District',           icon: MapPin,       color: '#2E7D32' },
  time_based:        { label: 'Time-Based',         icon: Clock,        color: '#0277BD' },
  seasonal:          { label: 'Seasonal',           icon: Calendar,     color: '#6A1B9A' },
  lifetime_value:    { label: 'Lifetime Value',     icon: Percent,      color: '#BF360C' },
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
    default:                  return {}
  }
}

function conditionSummary(rule: DiscountRule): string {
  const c = rule.conditions as Record<string, unknown>
  switch (rule.rule_type) {
    case 'cart_value':        return `Min ৳${c.min_amount}`
    case 'new_customer':      return 'First order only'
    case 'bulk_quantity':     return `Min qty ${c.min_quantity}`
    case 'district':          return `Districts: ${(c.districts as string[])?.slice(0,2).join(', ') || '—'}`
    case 'time_based':        return `${((c.days_of_week as string[]) || []).slice(0,3).join(',')} ${c.from_time}–${c.to_time}`
    case 'seasonal':          return `${c.start_date} → ${c.end_date}`
    case 'lifetime_value':    return `Min LTV ৳${c.min_lifetime_value}`
    case 'specific_product':  return `SKUs: ${(c.skus as string[])?.slice(0,2).join(', ') || '—'}`
    case 'specific_category': return `Cats: ${(c.categories as string[])?.slice(0,2).join(', ') || '—'}`
    case 'repeated_customer': {
      const tiers = (c.tiers as Array<{ from_days: number; to_days: number }>) || []
      return `${tiers.length} tier${tiers.length !== 1 ? 's' : ''}`
    }
    default: return '—'
  }
}

function rewardSummary(reward: Reward | undefined): string {
  if (!reward) return '—'
  if (reward.reward_type === 'percentage') return `${reward.discount_value}% off`
  if (reward.reward_type === 'flat')       return `৳${reward.discount_value} off`
  if (reward.reward_type === 'bonus')      return `Bonus (${reward.bonus_items?.length ?? 0} items)`
  if (reward.reward_type === 'free_delivery') return 'Free Delivery'
  return '—'
}

// ── Reward Selector ───────────────────────────────────────────

function RewardSelector({
  reward, onChange, products,
}: {
  reward: Reward
  onChange: (r: Reward) => void
  products: Product[]
}) {
  const [search, setSearch] = useState('')

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {(['percentage','flat','bonus','free_delivery'] as const).map(t => (
          <button key={t}
            type="button"
            onClick={() => onChange({ ...reward, reward_type: t })}
            className="flex-1 py-1.5 rounded text-xs font-semibold transition-colors"
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
          placeholder="Discount %"
          className="w-full rounded px-3 py-2 text-sm"
          style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
      )}
      {reward.reward_type === 'flat' && (
        <input type="number" min={0} value={reward.discount_value}
          onChange={e => onChange({ ...reward, discount_value: Number(e.target.value) })}
          placeholder="Flat discount ৳"
          className="w-full rounded px-3 py-2 text-sm"
          style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
      )}
      {reward.reward_type === 'bonus' && (
        <div>
          <div className="flex gap-2 mb-2">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search product to add as bonus..."
              className="flex-1 rounded px-3 py-2 text-xs"
              style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
          </div>
          {search && (
            <div className="rounded border overflow-hidden mb-2"
                 style={{ border: '1px solid var(--c-border)', maxHeight: 140, overflowY: 'auto' }}>
              {products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.includes(search))
                .slice(0,6).map(p => (
                  <button key={p.product_id} type="button"
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--c-surface2)]"
                    style={{ color: 'var(--c-text)' }}
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
              <span className="flex-1 text-xs" style={{ color: 'var(--c-text)' }}>{b.name}</span>
              <input type="number" min={1} value={b.quantity}
                onChange={e => {
                  const items = [...reward.bonus_items]
                  items[i] = { ...b, quantity: Number(e.target.value) }
                  onChange({ ...reward, bonus_items: items })
                }}
                className="w-14 rounded px-2 py-1 text-xs"
                style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
              <button type="button" onClick={() => onChange({ ...reward, bonus_items: reward.bonus_items.filter((_, j) => j !== i) })}>
                <X size={13} style={{ color: 'var(--c-muted)' }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Condition Fields ─────────────────────────────────────────

function ConditionFields({
  type, conditions, onChange, products,
}: {
  type: RuleType
  conditions: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  products: Product[]
}) {
  const inp = (
    style?: React.CSSProperties
  ) => ({ className: 'rounded px-3 py-2 text-sm', style: { background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)', ...style } })

  if (type === 'cart_value') return (
    <div>
      <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Minimum cart amount (৳)</label>
      <input type="number" value={Number(conditions.min_amount) || 0}
        onChange={e => onChange({ ...conditions, min_amount: Number(e.target.value) })}
        {...inp({ width: '100%' })} />
    </div>
  )

  if (type === 'bulk_quantity') return (
    <div>
      <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Minimum quantity</label>
      <input type="number" min={1} value={Number(conditions.min_quantity) || 1}
        onChange={e => onChange({ ...conditions, min_quantity: Number(e.target.value) })}
        {...inp({ width: '100%' })} />
    </div>
  )

  if (type === 'lifetime_value') return (
    <div>
      <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Minimum lifetime value (৳)</label>
      <input type="number" value={Number(conditions.min_lifetime_value) || 0}
        onChange={e => onChange({ ...conditions, min_lifetime_value: Number(e.target.value) })}
        {...inp({ width: '100%' })} />
    </div>
  )

  if (type === 'new_customer') return (
    <p className="text-xs" style={{ color: 'var(--c-muted)' }}>No conditions — applies to first-time customers automatically.</p>
  )

  if (type === 'specific_product') {
    const skus: string[] = (conditions.skus as string[]) || []
    const [q, setQ] = useState('')
    return (
      <div>
        <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Products (SKU)</label>
        <div className="flex gap-2 mb-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search product..."
            className="flex-1 rounded px-3 py-2 text-xs"
            style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
        </div>
        {q && (
          <div className="rounded border mb-2" style={{ border: '1px solid var(--c-border)', maxHeight: 130, overflowY: 'auto' }}>
            {products.filter(p => (p.name+p.sku).toLowerCase().includes(q.toLowerCase())).slice(0,6).map(p => (
              <button key={p.sku} type="button"
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--c-surface2)]"
                style={{ color: 'var(--c-text)' }}
                onClick={() => {
                  if (!skus.includes(p.sku)) onChange({ ...conditions, skus: [...skus, p.sku] })
                  setQ('')
                }}>
                {p.name} <span style={{ color: 'var(--c-muted)' }}>({p.sku})</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {skus.map(s => (
            <span key={s} className="flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                  style={{ background: 'var(--c-surface2)', color: 'var(--c-text)', border: '1px solid var(--c-border)' }}>
              {s}
              <button type="button" onClick={() => onChange({ ...conditions, skus: skus.filter(x => x !== s) })}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      </div>
    )
  }

  if (type === 'specific_category') {
    const cats = Array.from(new Set(products.map(p => p.category).filter(Boolean))) as string[]
    const sel: string[] = (conditions.categories as string[]) || []
    return (
      <div>
        <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Categories</label>
        <div className="flex flex-wrap gap-1">
          {cats.map(c => (
            <button key={c} type="button"
              className="px-2 py-0.5 rounded text-xs"
              style={{
                background: sel.includes(c) ? 'var(--c-accent)' : 'var(--c-surface2)',
                color:      sel.includes(c) ? '#fff' : 'var(--c-muted)',
                border: '1px solid var(--c-border)',
              }}
              onClick={() => onChange({ ...conditions, categories: sel.includes(c) ? sel.filter(x => x !== c) : [...sel, c] })}>
              {c}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (type === 'district') {
    const sel: string[] = (conditions.districts as string[]) || []
    const [q, setQ] = useState('')
    const filtered = BD_DISTRICTS.filter(d => d.toLowerCase().includes(q.toLowerCase()))
    return (
      <div>
        <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Districts</label>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search district..."
          className="w-full rounded px-3 py-2 text-xs mb-2"
          style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
        <div className="flex flex-wrap gap-1 mb-2 max-h-32 overflow-y-auto">
          {filtered.slice(0,20).map(d => (
            <button key={d} type="button"
              className="px-2 py-0.5 rounded text-xs"
              style={{
                background: sel.includes(d) ? 'var(--c-accent)' : 'var(--c-surface2)',
                color:      sel.includes(d) ? '#fff' : 'var(--c-muted)',
                border: '1px solid var(--c-border)',
              }}
              onClick={() => onChange({ ...conditions, districts: sel.includes(d) ? sel.filter(x => x !== d) : [...sel, d] })}>
              {d}
            </button>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--c-muted)' }}>{sel.length} selected</p>
      </div>
    )
  }

  if (type === 'time_based') {
    const activeDays: string[] = (conditions.days_of_week as string[]) || []
    return (
      <div className="space-y-2">
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Days of week</label>
          <div className="flex gap-1 flex-wrap">
            {DAYS.map(d => (
              <button key={d} type="button"
                className="px-2 py-0.5 rounded text-xs"
                style={{
                  background: activeDays.includes(d) ? 'var(--c-accent)' : 'var(--c-surface2)',
                  color:      activeDays.includes(d) ? '#fff' : 'var(--c-muted)',
                  border: '1px solid var(--c-border)',
                }}
                onClick={() => onChange({ ...conditions, days_of_week: activeDays.includes(d) ? activeDays.filter(x => x !== d) : [...activeDays, d] })}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>From</label>
            <input type="time" value={String(conditions.from_time || '09:00')}
              onChange={e => onChange({ ...conditions, from_time: e.target.value })}
              className="w-full rounded px-3 py-2 text-sm"
              style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
          </div>
          <div className="flex-1">
            <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>To</label>
            <input type="time" value={String(conditions.to_time || '21:00')}
              onChange={e => onChange({ ...conditions, to_time: e.target.value })}
              className="w-full rounded px-3 py-2 text-sm"
              style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
          </div>
        </div>
      </div>
    )
  }

  if (type === 'seasonal') return (
    <div className="flex gap-3">
      <div className="flex-1">
        <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>Start date</label>
        <input type="date" value={String(conditions.start_date || '')}
          onChange={e => onChange({ ...conditions, start_date: e.target.value })}
          className="w-full rounded px-3 py-2 text-sm"
          style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
      </div>
      <div className="flex-1">
        <label className="text-xs mb-1 block" style={{ color: 'var(--c-muted)' }}>End date</label>
        <input type="date" value={String(conditions.end_date || '')}
          onChange={e => onChange({ ...conditions, end_date: e.target.value })}
          className="w-full rounded px-3 py-2 text-sm"
          style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
      </div>
    </div>
  )

  if (type === 'repeated_customer') {
    const tiers: Array<{ from_days: number; to_days: number; reward: Reward }> =
      (conditions.tiers as Array<{ from_days: number; to_days: number; reward: Reward }>) || []
    return (
      <div>
        <label className="text-xs mb-2 block" style={{ color: 'var(--c-muted)' }}>
          Tiers (days since last order → reward)
        </label>
        {tiers.map((tier, i) => (
          <div key={i} className="rounded p-3 mb-2" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <input type="number" min={0} value={tier.from_days}
                onChange={e => { const t = [...tiers]; t[i] = { ...t[i], from_days: Number(e.target.value) }; onChange({ ...conditions, tiers: t }) }}
                placeholder="From days"
                className="flex-1 rounded px-2 py-1 text-xs"
                style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
              <span className="text-xs" style={{ color: 'var(--c-muted)' }}>–</span>
              <input type="number" min={0} value={tier.to_days}
                onChange={e => { const t = [...tiers]; t[i] = { ...t[i], to_days: Number(e.target.value) }; onChange({ ...conditions, tiers: t }) }}
                placeholder="To days"
                className="flex-1 rounded px-2 py-1 text-xs"
                style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
              <button type="button" onClick={() => onChange({ ...conditions, tiers: tiers.filter((_, j) => j !== i) })}>
                <X size={13} style={{ color: '#ef9a9a' }} />
              </button>
            </div>
            <RewardSelector reward={tier.reward || emptyReward()} products={[]}
              onChange={r => { const t = [...tiers]; t[i] = { ...t[i], reward: r }; onChange({ ...conditions, tiers: t }) }} />
          </div>
        ))}
        <button type="button"
          onClick={() => onChange({ ...conditions, tiers: [...tiers, { from_days: 0, to_days: 30, reward: emptyReward() }] })}
          className="text-xs px-3 py-1 rounded"
          style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
          + Add Tier
        </button>
      </div>
    )
  }

  return null
}

// ── Rule Modal ───────────────────────────────────────────────

function RuleModal({
  rule, products, onSave, onClose,
}: {
  rule: Partial<DiscountRule> | null
  products: Product[]
  onSave: (data: { rule_name: string; rule_type: string; conditions: Record<string, unknown>; reward: Reward }) => void
  onClose: () => void
}) {
  const isEdit = !!rule?.rule_id
  const [name,       setName]       = useState(rule?.rule_name || '')
  const [type,       setType]       = useState<RuleType>((rule?.rule_type as RuleType) || 'cart_value')
  const [conditions, setConditions] = useState<Record<string, unknown>>(
    rule?.conditions as Record<string, unknown> || emptyConditions('cart_value')
  )
  const [reward, setReward] = useState<Reward>(
    (rule?.reward as unknown as Reward) || emptyReward()
  )
  const [saving, setSaving] = useState(false)

  function handleTypeChange(t: RuleType) {
    setType(t)
    setConditions(emptyConditions(t))
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ rule_name: name, rule_type: type, conditions, reward })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-2xl overflow-y-auto"
           style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
             style={{ borderBottom: '1px solid var(--c-border)' }}>
          <h2 className="font-bold text-base" style={{ color: 'var(--c-text)' }}>
            {isEdit ? 'Edit Rule' : 'New Discount Rule'}
          </h2>
          <button onClick={onClose}><X size={18} style={{ color: 'var(--c-muted)' }} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs mb-1 block font-semibold" style={{ color: 'var(--c-muted)' }}>Rule Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. রমজান বাল্ক অফার"
              className="w-full rounded px-3 py-2 text-sm"
              style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
          </div>

          {/* Type */}
          <div>
            <label className="text-xs mb-1 block font-semibold" style={{ color: 'var(--c-muted)' }}>Rule Type *</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(RULE_META) as RuleType[]).map(t => {
                const { label, icon: Icon, color } = RULE_META[t]
                return (
                  <button key={t} type="button"
                    onClick={() => handleTypeChange(t)}
                    className="flex items-center gap-2 px-3 py-2 rounded text-xs text-left"
                    style={{
                      background: type === t ? `${color}20` : 'var(--c-surface2)',
                      border:     `1px solid ${type === t ? color : 'var(--c-border)'}`,
                      color:      type === t ? color : 'var(--c-muted)',
                    }}>
                    <Icon size={13} />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Conditions */}
          <div>
            <label className="text-xs mb-2 block font-semibold" style={{ color: 'var(--c-muted)' }}>Conditions</label>
            <ConditionFields type={type} conditions={conditions} onChange={setConditions} products={products} />
          </div>

          {/* Reward (not for repeated_customer which has per-tier rewards) */}
          {type !== 'repeated_customer' && (
            <div>
              <label className="text-xs mb-2 block font-semibold" style={{ color: 'var(--c-muted)' }}>Reward</label>
              <RewardSelector reward={reward} onChange={setReward} products={products} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4" style={{ borderTop: '1px solid var(--c-border)' }}>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="flex-1 py-2 rounded font-semibold text-sm text-white"
            style={{ background: saving || !name.trim() ? 'var(--c-muted)' : 'var(--c-accent)' }}>
            {saving ? 'Saving…' : isEdit ? 'Update Rule' : 'Create Rule'}
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

// ── Main Page ─────────────────────────────────────────────────

export default function DiscountRulesPage() {
  const [rules,    setRules]    = useState<DiscountRule[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState<Partial<DiscountRule> | null | false>(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [search,   setSearch]   = useState('')

  useEffect(() => {
    Promise.all([
      discountRulesAPI.list(),
      productsAPI.list(),
    ]).then(([r, p]) => {
      setRules(r)
      setProducts(p)
    }).finally(() => setLoading(false))
  }, [])

  async function handleSave(data: { rule_name: string; rule_type: string; conditions: Record<string, unknown>; reward: unknown }) {
    const isEdit = !!(modal as DiscountRule)?.rule_id
    if (isEdit) {
      const updated = await discountRulesAPI.update((modal as DiscountRule).rule_id, data)
      setRules(prev => prev.map(r => r.rule_id === updated.rule_id ? updated : r))
    } else {
      const created = await discountRulesAPI.create(data)
      setRules(prev => [...prev, created])
    }
    setModal(false)
  }

  async function handleDelete(rule_id: string) {
    if (!confirm('Delete this rule? Discounts using it won\'t be affected immediately.')) return
    setDeleting(rule_id)
    await discountRulesAPI.delete(rule_id)
    setRules(prev => prev.filter(r => r.rule_id !== rule_id))
    setDeleting(null)
  }

  const filtered = rules.filter(r =>
    r.rule_name.toLowerCase().includes(search.toLowerCase()) ||
    r.rule_type.toLowerCase().includes(search.toLowerCase())
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
        <button
          onClick={() => setModal({})}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ background: 'var(--c-accent)' }}>
          <Plus size={15} /> New Rule
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search rules..."
          className="w-full rounded-lg pl-9 pr-4 py-2 text-sm"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }} />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="spinner h-6 w-6" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--c-muted)' }}>
          <Gift size={36} className="mx-auto mb-3 opacity-25" />
          <p className="text-sm font-medium">No rules yet</p>
          <p className="text-xs mt-1 opacity-70">Create your first discount rule to get started</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--c-surface2)', borderBottom: '1px solid var(--c-border)' }}>
                {['Rule Name', 'Rule Type', 'Conditions', 'Reward', 'Created', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold"
                      style={{ color: 'var(--c-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((rule, i) => {
                const meta = RULE_META[rule.rule_type as RuleType]
                const Icon = meta?.icon || Tag
                return (
                  <tr key={rule.rule_id}
                      style={{
                        background: i % 2 === 0 ? 'var(--c-card)' : 'var(--c-surface)',
                        borderBottom: '1px solid var(--c-border)',
                      }}>
                    <td className="px-4 py-3 font-semibold" style={{ color: 'var(--c-text)' }}>
                      {rule.rule_name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded w-fit"
                            style={{ background: `${meta?.color || '#607D8B'}18`, color: meta?.color || '#90A4AE' }}>
                        <Icon size={11} />
                        {meta?.label || rule.rule_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted)' }}>
                      {conditionSummary(rule)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-text)' }}>
                      {rewardSummary(rule.reward as unknown as Reward)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(rule.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setModal(rule)} title="Edit"
                          className="w-7 h-7 rounded flex items-center justify-center"
                          style={{ background: 'var(--c-surface2)' }}>
                          <Edit2 size={12} style={{ color: 'var(--c-muted)' }} />
                        </button>
                        <button onClick={() => handleDelete(rule.rule_id)}
                          disabled={deleting === rule.rule_id}
                          title="Delete"
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
          <div className="px-4 py-2 text-xs" style={{ background: 'var(--c-surface2)', color: 'var(--c-muted)', borderTop: '1px solid var(--c-border)' }}>
            {filtered.length} rule{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Modal */}
      {modal !== false && (
        <RuleModal
          rule={modal}
          products={products}
          onSave={handleSave}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  )
}
