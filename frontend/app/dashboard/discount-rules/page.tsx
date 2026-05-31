'use client'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { discountRulesAPI, configAPI, productsAPI } from '@/lib/api'
import {
  Plus, Trash2, Edit2, Save, ChevronDown, ChevronRight,
  ShoppingCart, RefreshCw, User, Tag, Layers, Hash,
  MapPin, Clock, Calendar, GripVertical, X, Percent,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type RuleType =
  | 'cart_value' | 'repeated_customer' | 'new_customer'
  | 'specific_product' | 'specific_category' | 'bulk_quantity'
  | 'district' | 'time_based' | 'seasonal' | 'lifetime_value'

type ConflictResolution = 'best_deal' | 'priority_wins' | 'stack_all' | 'stack_with_cap'

interface DiscountRule {
  rule_id: string
  rule_type: RuleType
  rule_name: string
  conditions: Record<string, unknown>
  reward: Record<string, unknown>
  priority: number
  is_active: boolean
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

const RULE_META: Record<RuleType, { label: string; icon: React.ElementType; color: string }> = {
  cart_value:        { label: 'Cart Value',         icon: ShoppingCart, color: '#1565C0' },
  repeated_customer: { label: 'Repeated Customer',  icon: RefreshCw,    color: '#6A1B9A' },
  new_customer:      { label: 'New Customer',       icon: User,         color: '#00695C' },
  specific_product:  { label: 'Specific Product',   icon: Tag,          color: '#E65100' },
  specific_category: { label: 'Specific Category',  icon: Layers,       color: '#AD1457' },
  bulk_quantity:     { label: 'Bulk Quantity',      icon: Hash,         color: '#2E7D32' },
  district:          { label: 'District/Location',  icon: MapPin,       color: '#558B2F' },
  time_based:        { label: 'Time-Based',         icon: Clock,        color: '#F57F17' },
  seasonal:          { label: 'Seasonal',           icon: Calendar,     color: '#C62828' },
  lifetime_value:    { label: 'Lifetime Value',     icon: Percent,      color: '#4527A0' },
}

// ── Reward input helper ────────────────────────────────────────────────────────

function RewardFields({ reward, onChange }: {
  reward: Record<string, unknown>
  onChange: (r: Record<string, unknown>) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Discount Type</label>
        <select className="input" value={String(reward.discount_type || 'percentage')}
          onChange={e => onChange({ ...reward, discount_type: e.target.value })}>
          <option value="percentage">Percentage (%)</option>
          <option value="flat">Flat Amount (৳)</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>
          {reward.discount_type === 'flat' ? 'Amount (৳)' : 'Discount (%)'}
        </label>
        <input type="number" min="0" max={reward.discount_type === 'flat' ? undefined : 90}
          step={reward.discount_type === 'flat' ? 10 : 0.5} className="input"
          placeholder={reward.discount_type === 'flat' ? '100' : '10'}
          value={String(reward.discount_value || '')}
          onChange={e => onChange({ ...reward, discount_value: parseFloat(e.target.value) || 0 })} />
      </div>
    </div>
  )
}

// ── Rule Form by type ─────────────────────────────────────────────────────────

function RuleForm({ type, conditions, reward, onCondChange, onRewardChange, products, categories }: {
  type: RuleType
  conditions: Record<string, unknown>
  reward: Record<string, unknown>
  onCondChange: (c: Record<string, unknown>) => void
  onRewardChange: (r: Record<string, unknown>) => void
  products: { product_id: string; sku: string; name: string }[]
  categories: string[]
}) {
  // Repeated customer tiers
  const tiers = (conditions.tiers as { from_days: number; to_days: number; discount_pct: number; product_filter: string }[]) || []

  function addTier() {
    onCondChange({ ...conditions, tiers: [...tiers, { from_days: 0, to_days: 30, discount_pct: 10, product_filter: 'all' }] })
  }
  function updateTier(i: number, key: string, val: unknown) {
    const next = tiers.map((t, idx) => idx === i ? { ...t, [key]: val } : t)
    onCondChange({ ...conditions, tiers: next })
  }
  function removeTier(i: number) {
    onCondChange({ ...conditions, tiers: tiers.filter((_, idx) => idx !== i) })
  }

  // District multiselect
  const selDistricts = (conditions.districts as string[]) || []
  function toggleDistrict(d: string) {
    const next = selDistricts.includes(d) ? selDistricts.filter(x => x !== d) : [...selDistricts, d]
    onCondChange({ ...conditions, districts: next })
  }

  // Day checkboxes
  const selDays = (conditions.days_of_week as string[]) || []
  function toggleDay(d: string) {
    const next = selDays.includes(d) ? selDays.filter(x => x !== d) : [...selDays, d]
    onCondChange({ ...conditions, days_of_week: next })
  }

  // SKU list
  const selSkus = (conditions.skus as string[]) || []
  function toggleSku(sku: string) {
    const next = selSkus.includes(sku) ? selSkus.filter(x => x !== sku) : [...selSkus, sku]
    onCondChange({ ...conditions, skus: next })
  }

  // Category list
  const selCats = (conditions.categories as string[]) || []
  function toggleCat(cat: string) {
    const next = selCats.includes(cat) ? selCats.filter(x => x !== cat) : [...selCats, cat]
    onCondChange({ ...conditions, categories: next })
  }

  const labelCls = "block text-xs font-medium mb-1"
  const lStyle = { color: 'var(--c-text)' }

  if (type === 'cart_value') return (
    <div className="space-y-3">
      <div><label className={labelCls} style={lStyle}>Minimum Cart Amount (৳)</label>
        <input type="number" min="0" className="input" placeholder="500"
          value={String(conditions.min_cart_amount || '')}
          onChange={e => onCondChange({ ...conditions, min_cart_amount: parseFloat(e.target.value) || 0 })} /></div>
      <RewardFields reward={reward} onChange={onRewardChange} />
    </div>
  )

  if (type === 'repeated_customer') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium" style={lStyle}>Customer Return Tiers</p>
        <button type="button" onClick={addTier} className="btn-secondary text-xs py-1 px-2 gap-1"><Plus size={11} /> Tier যোগ</button>
      </div>
      {tiers.length === 0 && <p className="text-xs text-center py-3" style={{ color: 'var(--c-muted)' }}>কোনো tier নেই — উপরে যোগ করুন</p>}
      {tiers.map((tier, i) => (
        <div key={i} className="p-3 rounded space-y-3" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: 'var(--c-accent)' }}>Tier {i + 1}</span>
            <button type="button" onClick={() => removeTier(i)} style={{ color: '#EF5350' }}><X size={13} /></button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={labelCls} style={lStyle}>From (days)</label>
              <input type="number" min="0" className="input text-xs" value={tier.from_days}
                onChange={e => updateTier(i, 'from_days', parseInt(e.target.value) || 0)} /></div>
            <div><label className={labelCls} style={lStyle}>To (days)</label>
              <input type="number" min="0" className="input text-xs" value={tier.to_days}
                onChange={e => updateTier(i, 'to_days', parseInt(e.target.value) || 0)} /></div>
            <div><label className={labelCls} style={lStyle}>Discount %</label>
              <input type="number" min="0" max="90" className="input text-xs" value={tier.discount_pct}
                onChange={e => updateTier(i, 'discount_pct', parseFloat(e.target.value) || 0)} /></div>
          </div>
          <div><label className={labelCls} style={lStyle}>Apply To</label>
            <select className="input text-xs" value={tier.product_filter}
              onChange={e => updateTier(i, 'product_filter', e.target.value)}>
              <option value="all">All products</option>
              <option value="same_category">Same category as previous purchase</option>
              {categories.map(c => <option key={c} value={`cat:${c}`}>{c}</option>)}
              {products.slice(0, 20).map(p => <option key={p.sku} value={`sku:${p.sku}`}>{p.sku} — {p.name}</option>)}
            </select>
          </div>
        </div>
      ))}
    </div>
  )

  if (type === 'new_customer') return (
    <div className="space-y-3">
      <div><label className={labelCls} style={lStyle}>Apply To</label>
        <select className="input" value={String(conditions.apply_to || 'all')}
          onChange={e => onCondChange({ ...conditions, apply_to: e.target.value })}>
          <option value="all">All products</option>
          {categories.map(c => <option key={c} value={`cat:${c}`}>{c}</option>)}
        </select></div>
      <RewardFields reward={reward} onChange={onRewardChange} />
    </div>
  )

  if (type === 'specific_product') return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} style={lStyle}>Select Products (by SKU)</label>
        <div className="max-h-48 overflow-y-auto rounded border" style={{ borderColor: 'var(--c-border)' }}>
          {products.map(p => (
            <label key={p.sku} className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs"
              style={{ borderBottom: '1px solid var(--c-border-subtle)' }}>
              <input type="checkbox" checked={selSkus.includes(p.sku)} onChange={() => toggleSku(p.sku)} />
              <code className="font-mono" style={{ color: 'var(--c-accent)' }}>{p.sku}</code>
              <span style={{ color: 'var(--c-text)' }}>{p.name}</span>
            </label>
          ))}
        </div>
      </div>
      <RewardFields reward={reward} onChange={onRewardChange} />
    </div>
  )

  if (type === 'specific_category') return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} style={lStyle}>Select Categories</label>
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <button key={cat} type="button" onClick={() => toggleCat(cat)}
              className="text-xs px-2.5 py-1 rounded-full border font-medium transition-all"
              style={selCats.includes(cat)
                ? { background: 'rgba(4,170,109,0.15)', color: '#04AA6D', borderColor: '#04AA6D' }
                : { background: 'var(--c-surface)', color: 'var(--c-muted)', borderColor: 'var(--c-border)' }}>
              {cat}
            </button>
          ))}
          {categories.length === 0 && <p className="text-xs" style={{ color: 'var(--c-muted)' }}>কোনো category পাওয়া যায়নি</p>}
        </div>
      </div>
      <div><label className={labelCls} style={lStyle}>Discount %</label>
        <input type="number" min="0" max="90" className="input" placeholder="10"
          value={String(conditions.discount_pct || '')}
          onChange={e => onCondChange({ ...conditions, discount_pct: parseFloat(e.target.value) || 0 })} /></div>
    </div>
  )

  if (type === 'bulk_quantity') return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls} style={lStyle}>Minimum Quantity</label>
          <input type="number" min="2" className="input" placeholder="5"
            value={String(conditions.min_quantity || '')}
            onChange={e => onCondChange({ ...conditions, min_quantity: parseInt(e.target.value) || 2 })} /></div>
        <div><label className={labelCls} style={lStyle}>Discount %</label>
          <input type="number" min="0" max="90" className="input" placeholder="10"
            value={String(conditions.discount_pct || '')}
            onChange={e => onCondChange({ ...conditions, discount_pct: parseFloat(e.target.value) || 0 })} /></div>
      </div>
      <div><label className={labelCls} style={lStyle}>Apply To</label>
        <select className="input" value={String(conditions.apply_to || 'all')}
          onChange={e => onCondChange({ ...conditions, apply_to: e.target.value })}>
          <option value="all">All products</option>
          {products.slice(0, 30).map(p => <option key={p.sku} value={p.sku}>{p.sku} — {p.name}</option>)}
        </select></div>
    </div>
  )

  if (type === 'district') return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} style={lStyle}>Select Districts ({selDistricts.length} selected)</label>
        <div className="max-h-52 overflow-y-auto grid grid-cols-2 gap-1 p-2 rounded border" style={{ borderColor: 'var(--c-border)' }}>
          {BD_DISTRICTS.map(d => (
            <label key={d} className="flex items-center gap-1.5 text-xs cursor-pointer py-0.5">
              <input type="checkbox" checked={selDistricts.includes(d)} onChange={() => toggleDistrict(d)} />
              <span style={{ color: 'var(--c-text)' }}>{d}</span>
            </label>
          ))}
        </div>
      </div>
      <RewardFields reward={reward} onChange={onRewardChange} />
    </div>
  )

  if (type === 'time_based') return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} style={lStyle}>Days of Week</label>
        <div className="flex gap-1.5 flex-wrap">
          {DAYS.map(d => (
            <button key={d} type="button" onClick={() => toggleDay(d)}
              className="text-xs px-2.5 py-1 rounded border font-medium"
              style={selDays.includes(d)
                ? { background: 'rgba(4,170,109,0.15)', color: '#04AA6D', borderColor: '#04AA6D' }
                : { background: 'var(--c-surface)', color: 'var(--c-muted)', borderColor: 'var(--c-border)' }}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls} style={lStyle}>From Time</label>
          <input type="time" className="input" value={String(conditions.from_time || '09:00')}
            onChange={e => onCondChange({ ...conditions, from_time: e.target.value })} /></div>
        <div><label className={labelCls} style={lStyle}>To Time</label>
          <input type="time" className="input" value={String(conditions.to_time || '18:00')}
            onChange={e => onCondChange({ ...conditions, to_time: e.target.value })} /></div>
      </div>
      <div><label className={labelCls} style={lStyle}>Discount %</label>
        <input type="number" min="0" max="90" className="input" placeholder="10"
          value={String(conditions.discount_pct || '')}
          onChange={e => onCondChange({ ...conditions, discount_pct: parseFloat(e.target.value) || 0 })} /></div>
    </div>
  )

  if (type === 'lifetime_value') return (
    <div className="space-y-3">
      <div><label className={labelCls} style={lStyle}>Minimum Lifetime Value (৳)</label>
        <input type="number" min="0" step="100" className="input" placeholder="10000"
          value={String(conditions.min_lifetime_value || '')}
          onChange={e => onCondChange({ ...conditions, min_lifetime_value: parseFloat(e.target.value) || 0 })} />
        <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>গ্রাহকের সব অর্ডারের মোট মূল্য এই পরিমাণ বা বেশি হলে discount প্রযোজ্য</p>
      </div>
      <div><label className={labelCls} style={lStyle}>Apply To</label>
        <select className="input" value={String(conditions.apply_to || 'all')}
          onChange={e => onCondChange({ ...conditions, apply_to: e.target.value })}>
          <option value="all">All products</option>
          {categories.map(c => <option key={c} value={`cat:${c}`}>{c}</option>)}
        </select></div>
      <RewardFields reward={reward} onChange={onRewardChange} />
    </div>
  )

  if (type === 'seasonal') return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls} style={lStyle}>Start Date</label>
          <input type="date" className="input" value={String(conditions.start_date || '')}
            onChange={e => onCondChange({ ...conditions, start_date: e.target.value })} /></div>
        <div><label className={labelCls} style={lStyle}>End Date</label>
          <input type="date" className="input" value={String(conditions.end_date || '')}
            onChange={e => onCondChange({ ...conditions, end_date: e.target.value })} /></div>
      </div>
      <RewardFields reward={reward} onChange={onRewardChange} />
    </div>
  )

  return null
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DiscountRulesPage() {
  const [rules, setRules] = useState<DiscountRule[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'rules' | 'priority'>('rules')
  const [expandedTypes, setExpandedTypes] = useState<Set<RuleType>>(new Set())
  const [products, setProducts] = useState<{ product_id: string; sku: string; name: string; category?: string }[]>([])

  // Rule modal
  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState<RuleType>('cart_value')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [ruleName, setRuleName] = useState('')
  const [conditions, setConditions] = useState<Record<string, unknown>>({})
  const [reward, setReward] = useState<Record<string, unknown>>({ discount_type: 'percentage', discount_value: 10 })
  const [saving, setSaving] = useState(false)

  // Priority
  const [priorityList, setPriorityList] = useState<DiscountRule[]>([])
  const [savingPriority, setSavingPriority] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  // Conflict resolution
  const [resolution, setResolution] = useState<ConflictResolution>('best_deal')
  const [stackCap, setStackCap] = useState('30')
  const [savingConfig, setSavingConfig] = useState(false)

  // Preview calculator
  const [previewCart, setPreviewCart] = useState('')
  const [previewQty, setPreviewQty] = useState('')
  const [previewDistrict, setPreviewDistrict] = useState('')
  const [previewNewCust, setPreviewNewCust] = useState(false)
  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const categories = [...new Set(products.map(p => p.category).filter(Boolean))] as string[]

  useEffect(() => {
    Promise.all([
      discountRulesAPI.list().then(setRules),
      productsAPI.list().then((d: { product_id: string; sku: string; name: string; category?: string }[]) => setProducts(d)),
      configAPI.get().then((c: Record<string, unknown>) => {
        if (c.conflict_resolution) setResolution(c.conflict_resolution as ConflictResolution)
        if (c.discount_stack_cap)  setStackCap(String(c.discount_stack_cap))
      }),
    ]).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => { setPriorityList([...rules].sort((a, b) => a.priority - b.priority)) }, [rules])

  function toggleExpand(t: RuleType) {
    setExpandedTypes(prev => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  function openCreate(type: RuleType) {
    setEditingId(null)
    setModalType(type)
    setRuleName('')
    setConditions({})
    setReward({ discount_type: 'percentage', discount_value: 10 })
    setShowModal(true)
  }

  function openEdit(rule: DiscountRule) {
    setEditingId(rule.rule_id)
    setModalType(rule.rule_type)
    setRuleName(rule.rule_name)
    setConditions({ ...rule.conditions })
    setReward({ ...rule.reward })
    setShowModal(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = { rule_type: modalType, rule_name: ruleName || RULE_META[modalType].label, conditions, reward }
      if (editingId) {
        const updated = await discountRulesAPI.update(editingId, payload)
        setRules(rs => rs.map(r => r.rule_id === editingId ? updated : r))
        toast.success('✅ Rule আপডেট হয়েছে!')
      } else {
        const created = await discountRulesAPI.create({ ...payload, priority: rules.length + 1 })
        setRules(rs => [...rs, created])
        toast.success('✅ Rule তৈরি হয়েছে!')
      }
      setShowModal(false)
    } catch {
      toast.error('সমস্যা হয়েছে')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('এই rule মুছে ফেলবেন?')) return
    await discountRulesAPI.delete(id).catch(() => {})
    setRules(rs => rs.filter(r => r.rule_id !== id))
    toast.success('মুছে ফেলা হয়েছে')
  }

  async function handleToggleActive(rule: DiscountRule) {
    const updated = await discountRulesAPI.update(rule.rule_id, { is_active: !rule.is_active }).catch(() => null)
    if (updated) setRules(rs => rs.map(r => r.rule_id === rule.rule_id ? updated : r))
  }

  async function handleSavePriority() {
    setSavingPriority(true)
    try {
      await discountRulesAPI.updatePriority(priorityList.map((r, i) => ({ id: r.rule_id, priority: i + 1 })))
      setRules(priorityList.map((r, i) => ({ ...r, priority: i + 1 })))
      toast.success('✅ Priority সংরক্ষিত!')
    } catch {
      toast.error('সংরক্ষণ ব্যর্থ')
    } finally {
      setSavingPriority(false)
    }
  }

  async function handleSaveConfig() {
    setSavingConfig(true)
    try {
      await configAPI.update({ conflict_resolution: resolution, discount_stack_cap: parseFloat(stackCap) || 30 })
      toast.success('✅ Conflict settings সংরক্ষিত!')
    } catch {
      toast.error('সংরক্ষণ ব্যর্থ')
    } finally {
      setSavingConfig(false)
    }
  }

  async function handlePreview() {
    if (!previewCart) { toast.error('Cart amount দিন'); return }
    setPreviewing(true)
    try {
      const res = await discountRulesAPI.preview({
        cart_amount: parseFloat(previewCart),
        quantity: previewQty ? parseInt(previewQty) : undefined,
        district: previewDistrict || undefined,
        is_new_customer: previewNewCust,
      })
      setPreviewResult(res)
    } catch {
      toast.error('Preview করা যায়নি')
    } finally {
      setPreviewing(false)
    }
  }

  // Drag-and-drop for priority list
  const dragOver = useRef<number | null>(null)

  function onDragStart(i: number) { setDragIdx(i) }
  function onDragEnter(i: number) { dragOver.current = i }
  function onDragEnd() {
    if (dragIdx === null || dragOver.current === null || dragIdx === dragOver.current) {
      setDragIdx(null); dragOver.current = null; return
    }
    const next = [...priorityList]
    const [item] = next.splice(dragIdx, 1)
    next.splice(dragOver.current, 0, item)
    setPriorityList(next)
    setDragIdx(null); dragOver.current = null
  }

  if (loading) return <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>

  const rulesByType = (type: RuleType) => rules.filter(r => r.rule_type === type)

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div>
        <h1 className="page-title">Smart Discount Rules</h1>
        <p className="page-subtitle">৯ ধরনের dynamic discount rule + priority system</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '2px solid var(--c-border)' }}>
        {(['rules', 'priority'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className="px-4 py-2 text-xs font-medium rounded-t transition-all capitalize"
            style={{
              color: activeTab === t ? '#04AA6D' : 'var(--c-muted)',
              borderBottom: activeTab === t ? '2px solid #04AA6D' : '2px solid transparent',
              marginBottom: -2,
              backgroundColor: activeTab === t ? 'rgba(4,170,109,0.07)' : 'transparent',
            }}>
            {t === 'rules' ? 'Discount Rules' : 'Priority & Conflicts'}
          </button>
        ))}
      </div>

      {/* ── Rules Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'rules' && (
        <div className="space-y-3">
          {(Object.keys(RULE_META) as RuleType[]).map(type => {
            const meta = RULE_META[type]
            const Icon = meta.icon
            const typeRules = rulesByType(type)
            const expanded = expandedTypes.has(type)

            return (
              <div key={type} className="card overflow-hidden">
                {/* Section header */}
                <div className="flex items-center justify-between px-4 py-3 cursor-pointer"
                  style={{ borderBottom: expanded ? '1px solid var(--c-border)' : 'none' }}
                  onClick={() => toggleExpand(type)}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${meta.color}18` }}>
                      <Icon size={14} style={{ color: meta.color }} />
                    </div>
                    <span className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>{meta.label}</span>
                    {typeRules.length > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                        {typeRules.length}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={e => { e.stopPropagation(); openCreate(type) }}
                      className="btn-secondary text-xs py-1 px-2 gap-1">
                      <Plus size={11} /> Add
                    </button>
                    {expanded ? <ChevronDown size={15} style={{ color: 'var(--c-muted)' }} /> : <ChevronRight size={15} style={{ color: 'var(--c-muted)' }} />}
                  </div>
                </div>

                {/* Rules list */}
                {expanded && (
                  <div>
                    {typeRules.length === 0 ? (
                      <p className="text-center text-xs py-5" style={{ color: 'var(--c-muted)' }}>
                        কোনো rule নেই — Add বাটন দিয়ে তৈরি করুন
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead style={{ backgroundColor: 'var(--c-surface)' }}>
                          <tr>
                            <th className="th text-left" style={{ color: 'var(--c-muted)' }}>Name</th>
                            <th className="th text-center" style={{ color: 'var(--c-muted)' }}>Priority</th>
                            <th className="th text-center" style={{ color: 'var(--c-muted)' }}>Active</th>
                            <th className="th text-right" style={{ color: 'var(--c-muted)' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {typeRules.map((rule, i) => (
                            <tr key={rule.rule_id} style={{ borderTop: i > 0 ? '1px solid var(--c-border-subtle)' : 'none' }}>
                              <td className="td text-xs font-medium" style={{ color: 'var(--c-text)' }}>{rule.rule_name || meta.label}</td>
                              <td className="td text-center text-xs" style={{ color: 'var(--c-muted)' }}>#{rule.priority}</td>
                              <td className="td text-center">
                                <button type="button" role="switch" aria-checked={rule.is_active}
                                  onClick={() => handleToggleActive(rule)}
                                  className={`toggle-track ${rule.is_active ? 'toggle-track-on' : ''}`}
                                  style={{ transform: 'scale(0.75)' }}>
                                  <span className={`toggle-thumb ${rule.is_active ? 'toggle-thumb-on' : ''}`} />
                                </button>
                              </td>
                              <td className="td">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => openEdit(rule)} className="p-1.5 rounded" style={{ color: 'var(--c-muted)' }}><Edit2 size={13} /></button>
                                  <button onClick={() => handleDelete(rule.rule_id)} className="p-1.5 rounded" style={{ color: '#EF5350' }}><Trash2 size={13} /></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Preview Calculator */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Percent size={15} style={{ color: '#04AA6D' }} />
              <h2 className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>Preview Calculator</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Cart Amount (৳) *</label>
                <input type="number" min="0" className="input" placeholder="1000"
                  value={previewCart} onChange={e => setPreviewCart(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Quantity</label>
                <input type="number" min="1" className="input" placeholder="1"
                  value={previewQty} onChange={e => setPreviewQty(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>District</label>
                <select className="input" value={previewDistrict} onChange={e => setPreviewDistrict(e.target.value)}>
                  <option value="">নির্বাচন করুন</option>
                  {BD_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--c-text)' }}>
                  <input type="checkbox" checked={previewNewCust} onChange={e => setPreviewNewCust(e.target.checked)} />
                  New Customer
                </label>
              </div>
            </div>
            <button onClick={handlePreview} disabled={previewing} className="btn-primary gap-2">
              {previewing ? <><span className="spinner h-4 w-4" /> গণনা...</> : <><Percent size={14} /> Discount Calculate করুন</>}
            </button>
            {previewResult && (
              <div className="p-3 rounded space-y-2" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--c-text)' }}>Result ({String(previewResult.resolution)})</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: 'Discount %', value: `${previewResult.final_discount_pct}%` },
                    { label: 'Discount ৳', value: `৳${previewResult.discount_amount}` },
                    { label: 'Final Price', value: `৳${previewResult.final_price}` },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-2 rounded" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                      <p className="text-sm font-bold" style={{ color: '#04AA6D' }}>{String(value)}</p>
                      <p className="text-2xs" style={{ color: 'var(--c-muted)' }}>{label}</p>
                    </div>
                  ))}
                </div>
                {Array.isArray(previewResult.matched_rules) && previewResult.matched_rules.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-1" style={{ color: 'var(--c-muted)' }}>Matched Rules:</p>
                    {(previewResult.matched_rules as { rule_name: string; rule_type: string; discount_value: number; discount_type: string }[]).map((r, i) => (
                      <p key={i} className="text-xs" style={{ color: 'var(--c-text)' }}>
                        • {r.rule_name} — {r.discount_value}{r.discount_type === 'percentage' ? '%' : '৳'}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Priority Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'priority' && (
        <div className="space-y-4">
          {/* Conflict Resolution */}
          <div className="card p-5 space-y-4">
            <h2 className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>Conflict Resolution</h2>
            <p className="text-xs -mt-2" style={{ color: 'var(--c-muted)' }}>যখন একাধিক rule match করে তখন কোনটি প্রযোজ্য হবে</p>
            <div className="space-y-2">
              {([
                { value: 'best_deal',      label: 'Best Deal Wins',       desc: 'সর্বোচ্চ discount দেওয়া rule টি apply হবে' },
                { value: 'priority_wins',  label: 'Priority Wins',        desc: 'শুধু সর্বোচ্চ priority-র rule টি apply হবে' },
                { value: 'stack_all',      label: 'Stack All',            desc: 'সব matching rules একসাথে যোগ হবে' },
                { value: 'stack_with_cap', label: 'Stack with Cap',       desc: 'সব যোগ হবে কিন্তু সর্বোচ্চ cap পর্যন্ত' },
              ] as const).map(opt => (
                <label key={opt.value} className="flex items-start gap-3 p-3 rounded cursor-pointer"
                  style={{
                    border: `1px solid ${resolution === opt.value ? '#04AA6D' : 'var(--c-border)'}`,
                    background: resolution === opt.value ? 'rgba(4,170,109,0.06)' : 'var(--c-surface)',
                  }}>
                  <input type="radio" name="resolution" value={opt.value} checked={resolution === opt.value}
                    onChange={() => setResolution(opt.value)} className="mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--c-text)' }}>{opt.label}</p>
                    <p className="text-xs" style={{ color: 'var(--c-muted)' }}>{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
            {resolution === 'stack_with_cap' && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Maximum Stack Cap (%)</label>
                <input type="number" min="1" max="90" className="input w-32"
                  value={stackCap} onChange={e => setStackCap(e.target.value)} />
              </div>
            )}
            <button onClick={handleSaveConfig} disabled={savingConfig} className="btn-primary gap-2">
              {savingConfig ? <><span className="spinner h-4 w-4" /> সংরক্ষণ...</> : <><Save size={14} /> Save Settings</>}
            </button>
          </div>

          {/* Drag-and-drop priority list */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>Rule Priority Order</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>Drag করে priority পরিবর্তন করুন (১ = সর্বোচ্চ)</p>
              </div>
              <button onClick={handleSavePriority} disabled={savingPriority} className="btn-primary text-xs py-1.5 px-3 gap-1.5">
                {savingPriority ? <><span className="spinner h-3 w-3" /> সংরক্ষণ...</> : <><Save size={12} /> Save Order</>}
              </button>
            </div>

            {priorityList.length === 0 ? (
              <p className="text-center text-xs py-8" style={{ color: 'var(--c-muted)' }}>কোনো rule নেই</p>
            ) : (
              <div className="space-y-1.5">
                {priorityList.map((rule, i) => {
                  const meta = RULE_META[rule.rule_type]
                  const Icon = meta.icon
                  return (
                    <div key={rule.rule_id}
                      draggable
                      onDragStart={() => onDragStart(i)}
                      onDragEnter={() => onDragEnter(i)}
                      onDragEnd={onDragEnd}
                      onDragOver={e => e.preventDefault()}
                      className="flex items-center gap-3 px-3 py-2.5 rounded cursor-grab active:cursor-grabbing select-none"
                      style={{
                        border: `1px solid ${dragIdx === i ? '#04AA6D' : 'var(--c-border)'}`,
                        background: dragIdx === i ? 'rgba(4,170,109,0.06)' : 'var(--c-surface)',
                        opacity: dragIdx !== null && dragIdx !== i ? 0.6 : 1,
                      }}>
                      <GripVertical size={14} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
                      <span className="text-xs font-bold w-5 text-center" style={{ color: 'var(--c-muted)' }}>{i + 1}</span>
                      <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${meta.color}18` }}>
                        <Icon size={12} style={{ color: meta.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--c-text)' }}>{rule.rule_name || meta.label}</p>
                        <p className="text-2xs" style={{ color: 'var(--c-muted)' }}>{meta.label}</p>
                      </div>
                      <span className="text-xs px-1.5 py-0.5 rounded-full"
                        style={rule.is_active
                          ? { background: 'rgba(4,170,109,0.12)', color: '#04AA6D' }
                          : { background: 'var(--c-border)', color: 'var(--c-muted)' }}>
                        {rule.is_active ? 'Active' : 'Off'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Rule Modal ────────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md rounded-xl shadow-2xl overflow-hidden flex flex-col"
            style={{ backgroundColor: 'var(--c-card)', maxHeight: '90vh' }}>
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ backgroundColor: '#282A35' }}>
              <div>
                <h2 className="font-semibold text-white text-sm">
                  {editingId ? '✏️ Rule সম্পাদনা' : `➕ ${RULE_META[modalType].label}`}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: '#78909C' }}>{RULE_META[modalType].label} rule</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Rule Name</label>
                <input className="input" placeholder={RULE_META[modalType].label}
                  value={ruleName} onChange={e => setRuleName(e.target.value)} />
              </div>
              <RuleForm
                type={modalType}
                conditions={conditions}
                reward={reward}
                onCondChange={setConditions}
                onRewardChange={setReward}
                products={products}
                categories={categories}
              />
            </div>

            <div className="px-5 py-4 flex justify-end gap-3 flex-shrink-0"
              style={{ borderTop: '1px solid var(--c-border)' }}>
              <button onClick={() => setShowModal(false)} className="btn-secondary">বাতিল</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary gap-2">
                {saving ? <><span className="spinner h-4 w-4" /> সংরক্ষণ...</> : <><Save size={14} /> সংরক্ষণ করুন</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
