'use client'
import { useEffect, useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { discountRulesAPI, configAPI, productsAPI, campaignsAPI } from '@/lib/api'
import {
  Plus, Trash2, Edit2, Save, ChevronDown, ChevronRight,
  ShoppingCart, RefreshCw, User, Tag, Layers, Hash,
  MapPin, Clock, Calendar, X, Percent, Megaphone, Gift, Search,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type RuleType =
  | 'cart_value' | 'repeated_customer' | 'new_customer'
  | 'specific_product' | 'specific_category' | 'bulk_quantity'
  | 'district' | 'time_based' | 'seasonal' | 'lifetime_value'

interface Product { product_id: string; sku: string; name: string; category?: string }

interface BonusItem { product_id: string; sku: string; name: string; quantity: number }

interface Reward {
  reward_type: 'percentage' | 'flat' | 'bonus' | 'free_delivery'
  discount_value: number
  bonus_items: BonusItem[]
}

interface DiscountRule {
  rule_id: string
  rule_type: RuleType
  rule_name: string
  conditions: Record<string, unknown>
  reward: Reward
  priority: number
  is_active: boolean
}

interface PrioritySetting { priority: number; enabled: boolean }

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
  bulk_quantity:     { label: 'Bulk Quantity',       icon: Hash,         color: '#2E7D32' },
  district:          { label: 'District/Location',  icon: MapPin,       color: '#558B2F' },
  time_based:        { label: 'Time-Based',         icon: Clock,        color: '#F57F17' },
  seasonal:          { label: 'Seasonal',           icon: Calendar,     color: '#C62828' },
  lifetime_value:    { label: 'Lifetime Value',     icon: Percent,      color: '#4527A0' },
}

// Combo removed from priority table — combos are now standalone product bundles
const ALL_PRIORITY_TYPES = [
  { key: 'campaign',          label: 'Campaign',          icon: Megaphone,    color: '#F57F17', defaultPriority: 1,  system: true  },
  { key: 'cart_value',        label: 'Cart Value',        icon: ShoppingCart, color: '#1565C0', defaultPriority: 2,  system: false },
  { key: 'repeated_customer', label: 'Repeated Customer', icon: RefreshCw,    color: '#6A1B9A', defaultPriority: 3,  system: false },
  { key: 'new_customer',      label: 'New Customer',      icon: User,         color: '#00695C', defaultPriority: 4,  system: false },
  { key: 'specific_product',  label: 'Specific Product',  icon: Tag,          color: '#E65100', defaultPriority: 5,  system: false },
  { key: 'specific_category', label: 'Specific Category', icon: Layers,       color: '#AD1457', defaultPriority: 6,  system: false },
  { key: 'bulk_quantity',     label: 'Bulk Quantity',     icon: Hash,         color: '#2E7D32', defaultPriority: 7,  system: false },
  { key: 'district',          label: 'District/Location', icon: MapPin,       color: '#558B2F', defaultPriority: 8,  system: false },
  { key: 'time_based',        label: 'Time Based',        icon: Clock,        color: '#F57F17', defaultPriority: 9,  system: false },
  { key: 'seasonal',          label: 'Seasonal',          icon: Calendar,     color: '#C62828', defaultPriority: 10, system: false },
  { key: 'lifetime_value',    label: 'Lifetime Value',    icon: Percent,      color: '#4527A0', defaultPriority: 11, system: false },
]

const EMPTY_REWARD: Reward = { reward_type: 'percentage', discount_value: 10, bonus_items: [] }

// ── Reward Selector ────────────────────────────────────────────────────────────

function RewardSelector({
  reward, onChange, products, includeDelivery = false,
}: {
  reward: Reward
  onChange: (r: Reward) => void
  products: Product[]
  includeDelivery?: boolean
}) {
  const [bonusSearch, setBonusSearch]           = useState('')
  const [bonusQty, setBonusQty]                 = useState(1)
  const [selectedProduct, setSelectedProduct]   = useState<Product | null>(null)
  const [showDropdown, setShowDropdown]         = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  const rtype      = reward.reward_type || 'percentage'
  const bonusItems = reward.bonus_items || []

  const filtered = bonusSearch.trim().length > 0
    ? products.filter(p =>
        p.sku.toLowerCase().includes(bonusSearch.toLowerCase()) ||
        p.name.toLowerCase().includes(bonusSearch.toLowerCase())
      ).slice(0, 8)
    : []

  function addBonusItem() {
    if (!selectedProduct) return
    const exists = bonusItems.find(b => b.product_id === selectedProduct.product_id)
    if (exists) {
      onChange({
        ...reward,
        bonus_items: bonusItems.map(b =>
          b.product_id === selectedProduct.product_id
            ? { ...b, quantity: b.quantity + bonusQty }
            : b
        ),
      })
    } else {
      onChange({
        ...reward,
        bonus_items: [...bonusItems, {
          product_id: selectedProduct.product_id,
          sku:        selectedProduct.sku,
          name:       selectedProduct.name,
          quantity:   bonusQty,
        }],
      })
    }
    setBonusSearch('')
    setSelectedProduct(null)
    setBonusQty(1)
    setShowDropdown(false)
  }

  function removeBonusItem(pid: string) {
    onChange({ ...reward, bonus_items: bonusItems.filter(b => b.product_id !== pid) })
  }

  const labelCls = "block text-xs font-medium mb-1"
  const lStyle   = { color: 'var(--c-text)' }

  return (
    <div className="space-y-3">
      {/* Reward type selector */}
      <div>
        <label className={labelCls} style={lStyle}>Reward Type</label>
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'percentage',    label: '% Discount' },
            { value: 'flat',          label: '৳ Flat Off' },
            { value: 'bonus',         label: 'Free Products' },
            ...(includeDelivery ? [{ value: 'free_delivery', label: 'Free Delivery' }] : []),
          ].map(opt => (
            <button key={opt.value} type="button"
              onClick={() => onChange({ ...reward, reward_type: opt.value as Reward['reward_type'] })}
              className="text-xs px-3 py-1.5 rounded-full border font-medium transition-all"
              style={rtype === opt.value
                ? { background: 'rgba(4,170,109,0.15)', color: '#04AA6D', borderColor: '#04AA6D' }
                : { background: 'var(--c-surface)', color: 'var(--c-muted)', borderColor: 'var(--c-border)' }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Value input */}
      {rtype === 'percentage' && (
        <div>
          <label className={labelCls} style={lStyle}>Discount (%)</label>
          <input type="number" min="0" max="90" step="0.5" className="input" placeholder="10"
            value={String(reward.discount_value || '')}
            onChange={e => onChange({ ...reward, discount_value: parseFloat(e.target.value) || 0 })} />
        </div>
      )}
      {rtype === 'flat' && (
        <div>
          <label className={labelCls} style={lStyle}>Amount (৳)</label>
          <input type="number" min="0" step="10" className="input" placeholder="50"
            value={String(reward.discount_value || '')}
            onChange={e => onChange({ ...reward, discount_value: parseFloat(e.target.value) || 0 })} />
        </div>
      )}
      {rtype === 'free_delivery' && (
        <p className="text-xs" style={{ color: 'var(--c-muted)' }}>ডেলিভারি চার্জ মাফ করা হবে।</p>
      )}

      {/* Bonus products builder */}
      {rtype === 'bonus' && (
        <div className="space-y-2">
          <label className={labelCls} style={lStyle}>Free Products</label>

          {/* Search + add */}
          <div className="relative" ref={dropRef}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }} />
                <input
                  className="input pl-7 text-xs"
                  placeholder="SKU বা পণ্যের নাম লিখুন..."
                  value={bonusSearch}
                  onChange={e => { setBonusSearch(e.target.value); setShowDropdown(true); setSelectedProduct(null) }}
                  onFocus={() => setShowDropdown(true)}
                />
              </div>
              <input type="number" min="1" className="input text-xs w-16 text-center" value={bonusQty}
                onChange={e => setBonusQty(Math.max(1, parseInt(e.target.value) || 1))} />
              <button type="button" onClick={addBonusItem} disabled={!selectedProduct}
                className="btn-primary text-xs py-1 px-3 gap-1 flex-shrink-0"
                style={{ opacity: selectedProduct ? 1 : 0.4 }}>
                <Plus size={11} /> Add
              </button>
            </div>

            {/* Dropdown */}
            {showDropdown && filtered.length > 0 && (
              <div className="absolute z-50 w-full mt-1 rounded shadow-lg overflow-hidden"
                style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                {filtered.map(p => (
                  <button key={p.product_id} type="button"
                    onClick={() => { setSelectedProduct(p); setBonusSearch(`${p.sku} — ${p.name}`); setShowDropdown(false) }}
                    className="w-full text-left px-3 py-2 text-xs flex items-center gap-2"
                    style={{ borderBottom: '1px solid var(--c-border-subtle)', color: 'var(--c-text)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-surface)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                    <code style={{ color: 'var(--c-accent)' }}>{p.sku}</code>
                    <span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Added bonus items */}
          {bonusItems.length > 0 && (
            <div className="space-y-1">
              {bonusItems.map(item => (
                <div key={item.product_id}
                  className="flex items-center justify-between px-3 py-1.5 rounded text-xs"
                  style={{ backgroundColor: 'rgba(4,170,109,0.08)', border: '1px solid rgba(4,170,109,0.2)' }}>
                  <div className="flex items-center gap-2">
                    <Gift size={11} style={{ color: '#04AA6D' }} />
                    <span style={{ color: 'var(--c-text)' }}>{item.name}</span>
                    <code className="text-2xs" style={{ color: 'var(--c-muted)' }}>{item.sku}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: '#04AA6D' }}>×{item.quantity}</span>
                    <button type="button" onClick={() => removeBonusItem(item.product_id)} style={{ color: '#EF5350' }}>
                      <X size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {bonusItems.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--c-muted)' }}>এখনো কোনো free product যোগ হয়নি।</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Rule Form by type ─────────────────────────────────────────────────────────

function RuleForm({ type, conditions, reward, onCondChange, onRewardChange, products, categories }: {
  type: RuleType
  conditions: Record<string, unknown>
  reward: Reward
  onCondChange: (c: Record<string, unknown>) => void
  onRewardChange: (r: Reward) => void
  products: Product[]
  categories: string[]
}) {
  type Tier = { from_days: number; to_days: number; discount_pct: number; reward?: Reward }
  const tiers = (conditions.tiers as Tier[]) || []

  function addTier() {
    onCondChange({ ...conditions, tiers: [...tiers, { from_days: 0, to_days: 30, discount_pct: 10, reward: { ...EMPTY_REWARD } }] })
  }
  function updateTier(i: number, key: string, val: unknown) {
    onCondChange({ ...conditions, tiers: tiers.map((t, idx) => idx === i ? { ...t, [key]: val } : t) })
  }
  function removeTier(i: number) {
    onCondChange({ ...conditions, tiers: tiers.filter((_, idx) => idx !== i) })
  }

  const selDistricts = (conditions.districts as string[]) || []
  const selDays      = (conditions.days_of_week as string[]) || []
  const selSkus      = (conditions.skus as string[]) || []
  const selCats      = (conditions.categories as string[]) || []

  const toggleArr = (key: string, arr: string[], val: string) =>
    onCondChange({ ...conditions, [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] })

  const labelCls = "block text-xs font-medium mb-1"
  const lStyle   = { color: 'var(--c-text)' }

  if (type === 'cart_value') return (
    <div className="space-y-3">
      <div><label className={labelCls} style={lStyle}>Minimum Cart Amount (৳)</label>
        <input type="number" min="0" className="input" placeholder="500"
          value={String(conditions.min_amount || '')}
          onChange={e => onCondChange({ ...conditions, min_amount: parseFloat(e.target.value) || 0 })} /></div>
      <div><label className={labelCls} style={lStyle}>Apply To</label>
        <select className="input" value={String(conditions.apply_to || 'all')}
          onChange={e => onCondChange({ ...conditions, apply_to: e.target.value })}>
          <option value="all">All products</option>
          {categories.map(c => <option key={c} value={`cat:${c}`}>{c}</option>)}
        </select></div>
      <RewardSelector reward={reward} onChange={onRewardChange} products={products} />
    </div>
  )

  if (type === 'repeated_customer') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium" style={lStyle}>Customer Return Tiers</p>
        <button type="button" onClick={addTier} className="btn-secondary text-xs py-1 px-2 gap-1"><Plus size={11} /> Tier যোগ</button>
      </div>
      {tiers.length === 0 && <p className="text-xs text-center py-3" style={{ color: 'var(--c-muted)' }}>কোনো tier নেই</p>}
      {tiers.map((tier, i) => (
        <div key={i} className="p-3 rounded space-y-3" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: 'var(--c-accent)' }}>Tier {i + 1}</span>
            <button type="button" onClick={() => removeTier(i)} style={{ color: '#EF5350' }}><X size={13} /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={labelCls} style={lStyle}>From (days)</label>
              <input type="number" min="0" className="input text-xs" value={tier.from_days}
                onChange={e => updateTier(i, 'from_days', parseInt(e.target.value) || 0)} /></div>
            <div><label className={labelCls} style={lStyle}>To (days)</label>
              <input type="number" min="0" className="input text-xs" value={tier.to_days}
                onChange={e => updateTier(i, 'to_days', parseInt(e.target.value) || 0)} /></div>
          </div>
          <RewardSelector
            reward={tier.reward || { reward_type: 'percentage', discount_value: tier.discount_pct || 10, bonus_items: [] }}
            onChange={r => updateTier(i, 'reward', r)}
            products={products}
          />
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
      <RewardSelector reward={reward} onChange={onRewardChange} products={products} />
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
              <input type="checkbox" checked={selSkus.includes(p.sku)} onChange={() => toggleArr('skus', selSkus, p.sku)} />
              <code className="font-mono" style={{ color: 'var(--c-accent)' }}>{p.sku}</code>
              <span style={{ color: 'var(--c-text)' }}>{p.name}</span>
            </label>
          ))}
        </div>
      </div>
      <RewardSelector reward={reward} onChange={onRewardChange} products={products} />
    </div>
  )

  if (type === 'specific_category') return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} style={lStyle}>Select Categories</label>
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <button key={cat} type="button" onClick={() => toggleArr('categories', selCats, cat)}
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
      <RewardSelector reward={reward} onChange={onRewardChange} products={products} />
    </div>
  )

  if (type === 'bulk_quantity') return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls} style={lStyle}>Minimum Quantity</label>
          <input type="number" min="2" className="input" placeholder="5"
            value={String(conditions.min_quantity || '')}
            onChange={e => onCondChange({ ...conditions, min_quantity: parseInt(e.target.value) || 2 })} /></div>
        <div><label className={labelCls} style={lStyle}>Apply To</label>
          <select className="input" value={String(conditions.apply_to || 'all')}
            onChange={e => onCondChange({ ...conditions, apply_to: e.target.value })}>
            <option value="all">All products</option>
            {products.slice(0, 30).map(p => <option key={p.sku} value={p.sku}>{p.sku} — {p.name}</option>)}
          </select></div>
      </div>
      <RewardSelector reward={reward} onChange={onRewardChange} products={products} />
    </div>
  )

  if (type === 'district') return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} style={lStyle}>Select Districts ({selDistricts.length} selected)</label>
        <div className="max-h-52 overflow-y-auto grid grid-cols-2 gap-1 p-2 rounded border" style={{ borderColor: 'var(--c-border)' }}>
          {BD_DISTRICTS.map(d => (
            <label key={d} className="flex items-center gap-1.5 text-xs cursor-pointer py-0.5">
              <input type="checkbox" checked={selDistricts.includes(d)} onChange={() => toggleArr('districts', selDistricts, d)} />
              <span style={{ color: 'var(--c-text)' }}>{d}</span>
            </label>
          ))}
        </div>
      </div>
      <RewardSelector reward={reward} onChange={onRewardChange} products={products} includeDelivery />
    </div>
  )

  if (type === 'time_based') return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} style={lStyle}>Days of Week</label>
        <div className="flex gap-1.5 flex-wrap">
          {DAYS.map(d => (
            <button key={d} type="button" onClick={() => toggleArr('days_of_week', selDays, d)}
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
      <RewardSelector reward={reward} onChange={onRewardChange} products={products} />
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
      <RewardSelector reward={reward} onChange={onRewardChange} products={products} />
    </div>
  )

  if (type === 'lifetime_value') return (
    <div className="space-y-3">
      <div><label className={labelCls} style={lStyle}>Minimum Lifetime Value (৳)</label>
        <input type="number" min="0" step="100" className="input" placeholder="10000"
          value={String(conditions.min_lifetime_value || '')}
          onChange={e => onCondChange({ ...conditions, min_lifetime_value: parseFloat(e.target.value) || 0 })} />
        <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>মোট lifetime purchase এই পরিমাণ বা বেশি হলে প্রযোজ্য</p>
      </div>
      <div><label className={labelCls} style={lStyle}>Apply To</label>
        <select className="input" value={String(conditions.apply_to || 'all')}
          onChange={e => onCondChange({ ...conditions, apply_to: e.target.value })}>
          <option value="all">All products</option>
          {categories.map(c => <option key={c} value={`cat:${c}`}>{c}</option>)}
        </select></div>
      <RewardSelector reward={reward} onChange={onRewardChange} products={products} />
    </div>
  )

  return null
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DiscountRulesPage() {
  const [rules, setRules]         = useState<DiscountRule[]>([])
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState<'rules' | 'priority'>('rules')
  const [expandedTypes, setExpandedTypes] = useState<Set<RuleType>>(new Set())
  const [products, setProducts]   = useState<Product[]>([])

  const [showModal, setShowModal]   = useState(false)
  const [modalType, setModalType]   = useState<RuleType>('cart_value')
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [ruleName, setRuleName]     = useState('')
  const [conditions, setConditions] = useState<Record<string, unknown>>({})
  const [reward, setReward]         = useState<Reward>(EMPTY_REWARD)
  const [saving, setSaving]         = useState(false)

  const [prioritySettings, setPrioritySettings] = useState<Record<string, PrioritySetting>>({})
  const [savingPriority, setSavingPriority]     = useState(false)
  const [campaignCount, setCampaignCount]       = useState(0)

  const [previewCart, setPreviewCart]         = useState('')
  const [previewQty, setPreviewQty]           = useState('')
  const [previewSku, setPreviewSku]           = useState('')
  const [previewCategory, setPreviewCategory] = useState('')
  const [previewPhone, setPreviewPhone]       = useState('')
  const [previewDistrict, setPreviewDistrict] = useState('')
  const [previewNewCust, setPreviewNewCust]   = useState(false)
  const [previewResult, setPreviewResult]     = useState<Record<string, unknown> | null>(null)
  const [previewing, setPreviewing]           = useState(false)

  const categories = [...new Set(products.map(p => p.category).filter(Boolean))] as string[]

  function buildDefaults(): Record<string, PrioritySetting> {
    return Object.fromEntries(
      ALL_PRIORITY_TYPES.map(t => [t.key, { priority: t.defaultPriority, enabled: true }])
    )
  }

  useEffect(() => {
    Promise.all([
      discountRulesAPI.list().then(setRules),
      productsAPI.list().then(setProducts),
      configAPI.get().then((c: Record<string, unknown>) => {
        const saved = c.discount_priority_settings as Record<string, PrioritySetting> | undefined
        setPrioritySettings(saved && Object.keys(saved).length > 0 ? saved : buildDefaults())
      }),
      campaignsAPI.list().then((d: unknown[]) => setCampaignCount(d.length)).catch(() => {}),
    ]).catch(() => setPrioritySettings(buildDefaults())).finally(() => setLoading(false))
  }, [])

  function toggleExpand(t: RuleType) {
    setExpandedTypes(prev => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  function openCreate(type: RuleType) {
    setEditingId(null); setModalType(type); setRuleName('')
    setConditions({}); setReward({ ...EMPTY_REWARD })
    setShowModal(true)
  }

  function openEdit(rule: DiscountRule) {
    setEditingId(rule.rule_id); setModalType(rule.rule_type); setRuleName(rule.rule_name)
    setConditions({ ...rule.conditions })
    // Normalise legacy reward shape
    const r = rule.reward as Record<string, unknown>
    setReward({
      reward_type:    (r?.reward_type || r?.discount_type || 'percentage') as Reward['reward_type'],
      discount_value: Number(r?.discount_value || 0),
      bonus_items:    (r?.bonus_items as BonusItem[]) || [],
    })
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
    } catch { toast.error('সমস্যা হয়েছে') }
    finally { setSaving(false) }
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

  function setPrioritySetting(key: string, field: keyof PrioritySetting, value: unknown) {
    setPrioritySettings(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? { priority: 99, enabled: true }), [field]: value },
    }))
  }

  async function handleSavePriority() {
    setSavingPriority(true)
    try {
      await configAPI.update({ discount_priority_settings: prioritySettings })
      toast.success('✅ Priority সংরক্ষিত!')
    } catch { toast.error('সংরক্ষণ ব্যর্থ') }
    finally { setSavingPriority(false) }
  }

  async function handlePreview() {
    if (!previewCart) { toast.error('Cart amount দিন'); return }
    setPreviewing(true)
    try {
      const res = await discountRulesAPI.preview({
        cart_amount:     parseFloat(previewCart),
        quantity:        previewQty ? parseInt(previewQty) : undefined,
        product_skus:    previewSku ? previewSku.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        categories:      previewCategory ? previewCategory.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        district:        previewDistrict || undefined,
        is_new_customer: previewNewCust,
        customer_phone:  previewPhone || undefined,
      })
      setPreviewResult(res)
    } catch { toast.error('Preview করা যায়নি') }
    finally { setPreviewing(false) }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>

  const rulesByType = (type: string) => rules.filter(r => r.rule_type === type)

  function rewardLabel(r: Reward) {
    if (!r) return '—'
    if (r.reward_type === 'percentage') return `${r.discount_value}%`
    if (r.reward_type === 'flat') return `৳${r.discount_value}`
    if (r.reward_type === 'bonus') return `Free: ${(r.bonus_items || []).length} item(s)`
    if (r.reward_type === 'free_delivery') return 'Free Delivery'
    return '—'
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">Smart Discount Rules</h1>
        <p className="page-subtitle">১০ ধরনের dynamic discount rule — percentage, flat, বা free product reward</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '2px solid var(--c-border)' }}>
        {(['rules', 'priority'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className="px-4 py-2 text-xs font-medium rounded-t transition-all"
            style={{
              color: activeTab === t ? '#04AA6D' : 'var(--c-muted)',
              borderBottom: activeTab === t ? '2px solid #04AA6D' : '2px solid transparent',
              marginBottom: -2,
              backgroundColor: activeTab === t ? 'rgba(4,170,109,0.07)' : 'transparent',
            }}>
            {t === 'rules' ? 'Discount Rules' : 'Priority & ON/OFF'}
          </button>
        ))}
      </div>

      {/* ── Rules Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'rules' && (
        <div className="space-y-3">
          {(Object.keys(RULE_META) as RuleType[]).map(type => {
            const meta      = RULE_META[type]
            const Icon      = meta.icon
            const typeRules = rulesByType(type)
            const expanded  = expandedTypes.has(type)

            return (
              <div key={type} className="card overflow-hidden">
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
                            <th className="th text-center" style={{ color: 'var(--c-muted)' }}>Reward</th>
                            <th className="th text-center" style={{ color: 'var(--c-muted)' }}>Active</th>
                            <th className="th text-right" style={{ color: 'var(--c-muted)' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {typeRules.map((rule, i) => (
                            <tr key={rule.rule_id} style={{ borderTop: i > 0 ? '1px solid var(--c-border-subtle)' : 'none' }}>
                              <td className="td text-xs font-medium" style={{ color: 'var(--c-text)' }}>{rule.rule_name || meta.label}</td>
                              <td className="td text-center">
                                <span className="text-xs font-medium" style={{ color: '#04AA6D' }}>
                                  {rewardLabel(rule.reward)}
                                </span>
                              </td>
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
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Product SKU(s)</label>
                <input type="text" className="input" placeholder="SKU001, SKU002"
                  value={previewSku} onChange={e => setPreviewSku(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Category</label>
                <input type="text" className="input" placeholder="Electronics"
                  value={previewCategory} onChange={e => setPreviewCategory(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>District</label>
                <select className="input" value={previewDistrict} onChange={e => setPreviewDistrict(e.target.value)}>
                  <option value="">নির্বাচন করুন</option>
                  {BD_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--c-text)' }}>Customer Phone (ঐচ্ছিক)</label>
                <input type="tel" className="input" placeholder="01XXXXXXXXX"
                  value={previewPhone} onChange={e => setPreviewPhone(e.target.value)} maxLength={11} />
              </div>
              <div className="flex items-center col-span-2">
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
                    {(previewResult.matched_rules as { rule_name: string; discount_value: number; discount_type: string; reason?: string }[]).map((r, i) => (
                      <p key={i} className="text-xs" style={{ color: 'var(--c-text)' }}>
                        • {r.rule_name} — {r.discount_type === 'bonus' ? 'Free Products' : `${r.discount_value}${r.discount_type === 'percentage' ? '%' : '৳'}`}
                        {r.reason && <span style={{ color: 'var(--c-muted)' }}> ({r.reason})</span>}
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
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>Rule Priority Order</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>
                Priority number সম্পাদনা করুন এবং rule type ON/OFF করুন
              </p>
            </div>
            <button onClick={handleSavePriority} disabled={savingPriority} className="btn-primary text-xs py-1.5 px-3 gap-1.5">
              {savingPriority ? <><span className="spinner h-3 w-3" /> সংরক্ষণ...</> : <><Save size={12} /> Save Order</>}
            </button>
          </div>

          <div className="overflow-hidden rounded" style={{ border: '1px solid var(--c-border)' }}>
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--c-surface)' }}>
                <tr>
                  <th className="th text-center w-16" style={{ color: 'var(--c-muted)' }}>Priority</th>
                  <th className="th text-left" style={{ color: 'var(--c-muted)' }}>Rule Type</th>
                  <th className="th text-center" style={{ color: 'var(--c-muted)' }}>Active Rules</th>
                  <th className="th text-center" style={{ color: 'var(--c-muted)' }}>ON / OFF</th>
                </tr>
              </thead>
              <tbody>
                {ALL_PRIORITY_TYPES.map((type, i) => {
                  const Icon    = type.icon
                  const setting = prioritySettings[type.key] ?? { priority: type.defaultPriority, enabled: true }
                  const count   = type.key === 'campaign' ? campaignCount : rulesByType(type.key).length

                  return (
                    <tr key={type.key} style={{ borderTop: i > 0 ? '1px solid var(--c-border-subtle)' : 'none' }}>
                      <td className="td text-center">
                        <input type="number" min="1" max="11" className="input text-center text-xs py-1 h-auto w-14"
                          value={setting.priority}
                          onChange={e => setPrioritySetting(type.key, 'priority', parseInt(e.target.value) || 1)} />
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: `${type.color}18` }}>
                            <Icon size={13} style={{ color: type.color }} />
                          </div>
                          <span className="text-xs font-medium" style={{ color: 'var(--c-text)' }}>{type.label}</span>
                        </div>
                      </td>
                      <td className="td text-center">
                        {count > 0 ? (
                          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: `${type.color}18`, color: type.color }}>
                            {count}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--c-muted)' }}>0</span>
                        )}
                      </td>
                      <td className="td text-center">
                        <button type="button" role="switch" aria-checked={setting.enabled}
                          onClick={() => setPrioritySetting(type.key, 'enabled', !setting.enabled)}
                          className={`toggle-track ${setting.enabled ? 'toggle-track-on' : ''}`}
                          style={{ transform: 'scale(0.8)' }}>
                          <span className={`toggle-thumb ${setting.enabled ? 'toggle-thumb-on' : ''}`} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
              <RuleForm type={modalType} conditions={conditions} reward={reward}
                onCondChange={setConditions} onRewardChange={setReward}
                products={products} categories={categories} />
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
