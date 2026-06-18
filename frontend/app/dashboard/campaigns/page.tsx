'use client'
import { useEffect, useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { campaignsAPI, productsAPI } from '@/lib/api'
import {
  Megaphone, Plus, X, Edit2, Trash2,
  CheckCircle, Clock, AlertCircle, XCircle, Package, Search, Gift,
} from 'lucide-react'
import ProductPicker, { type SelectedProduct } from '@/components/ui/ProductPicker'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BonusItem { product_id: string; sku: string; name: string; quantity: number }

interface Reward {
  reward_type: 'percentage' | 'flat' | 'bonus'
  discount_value: number
  bonus_items: BonusItem[]
}

interface Campaign {
  campaign_id: string
  name: string
  description: string | null
  reward: Reward
  type?: string
  amount?: number
  start_date: string | null
  end_date: string | null
  apply_to: 'all' | 'specific'
  product_ids: string[]
  is_active: boolean
  status: 'active' | 'inactive' | 'scheduled' | 'expired'
  created_at: string
}

interface Product { product_id: string; sku: string; name: string; category?: string }

const EMPTY_REWARD: Reward = { reward_type: 'percentage', discount_value: 10, bonus_items: [] }

type FormData = {
  name: string
  description: string
  reward: Reward
  start_date: string
  end_date: string
  apply_to: 'all' | 'specific'
  is_active: boolean
}

const EMPTY_FORM: FormData = {
  name: '', description: '',
  reward: EMPTY_REWARD,
  start_date: '', end_date: '',
  apply_to: 'all', is_active: true,
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: Campaign['status'] }) {
  const map = {
    active:    { label: 'সক্রিয়',     bg: '#E8F5E9', color: '#2E7D32', Icon: CheckCircle },
    scheduled: { label: 'নির্ধারিত',   bg: '#E3F2FD', color: '#1565C0', Icon: Clock },
    expired:   { label: 'মেয়াদ শেষ',  bg: '#FFEBEE', color: '#C62828', Icon: AlertCircle },
    inactive:  { label: 'নিষ্ক্রিয়',  bg: '#F5F5F5', color: '#757575', Icon: XCircle },
  }
  const { label, bg, color, Icon } = map[status]
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: bg, color }}>
      <Icon size={10} />
      {label}
    </span>
  )
}

// ─── Reward label ─────────────────────────────────────────────────────────────
function rewardLabel(c: Campaign): string {
  const r = c.reward
  if (r?.reward_type === 'percentage') return `${r.discount_value}% ছাড়`
  if (r?.reward_type === 'flat')       return `৳${r.discount_value} ছাড়`
  if (r?.reward_type === 'bonus')      return `ফ্রি পণ্য (${(r.bonus_items || []).length} টি)`
  if (c.type === 'percentage')         return `${c.amount}% ছাড়`
  if (c.type === 'flat')               return `৳${c.amount} ছাড়`
  return `৳${c.amount || 0} বোনাস`
}

// ─── Reward Selector ──────────────────────────────────────────────────────────
function RewardSelector({
  reward, onChange, products,
}: {
  reward: Reward
  onChange: (r: Reward) => void
  products: Product[]
}) {
  const [bonusSearch, setBonusSearch]         = useState('')
  const [bonusQty, setBonusQty]               = useState(1)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showDropdown, setShowDropdown]       = useState(false)
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
      onChange({ ...reward, bonus_items: bonusItems.map(b =>
        b.product_id === selectedProduct.product_id ? { ...b, quantity: b.quantity + bonusQty } : b
      )})
    } else {
      onChange({ ...reward, bonus_items: [...bonusItems, {
        product_id: selectedProduct.product_id,
        sku: selectedProduct.sku,
        name: selectedProduct.name,
        quantity: bonusQty,
      }]})
    }
    setBonusSearch('')
    setSelectedProduct(null)
    setBonusQty(1)
    setShowDropdown(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {(['percentage', 'flat', 'bonus'] as const).map(rt => (
          <label key={rt} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name={`reward_type_campaign_${Math.random()}`}
              checked={rtype === rt}
              onChange={() => onChange({ ...reward, reward_type: rt })}
              style={{ accentColor: '#04AA6D' }}
            />
            <span className="text-sm" style={{ color: '#282A35' }}>
              {rt === 'percentage' ? '% ছাড়' : rt === 'flat' ? '৳ ফ্ল্যাট ছাড়' : 'ফ্রি পণ্য'}
            </span>
          </label>
        ))}
      </div>

      {rtype === 'percentage' && (
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#616161' }}>ছাড়ের পরিমাণ (%)</label>
          <input
            type="number" min="0" max="100" step="0.1"
            className="input w-40"
            value={reward.discount_value}
            onChange={e => onChange({ ...reward, discount_value: parseFloat(e.target.value) || 0 })}
          />
        </div>
      )}

      {rtype === 'flat' && (
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: '#616161' }}>ছাড়ের পরিমাণ (৳)</label>
          <input
            type="number" min="0" step="0.01"
            className="input w-40"
            value={reward.discount_value}
            onChange={e => onChange({ ...reward, discount_value: parseFloat(e.target.value) || 0 })}
          />
        </div>
      )}

      {rtype === 'bonus' && (
        <div className="space-y-2">
          <label className="block text-xs font-medium mb-1" style={{ color: '#616161' }}>ফ্রি পণ্য যোগ করুন</label>
          <div className="flex gap-2">
            <div className="relative flex-1" ref={dropRef}>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#9E9E9E' }} />
                <input
                  className="input pl-8"
                  placeholder="SKU বা নাম দিয়ে খুঁজুন..."
                  value={bonusSearch}
                  onChange={e => { setBonusSearch(e.target.value); setShowDropdown(true); setSelectedProduct(null) }}
                  onFocus={() => setShowDropdown(true)}
                />
              </div>
              {showDropdown && filtered.length > 0 && (
                <div className="absolute z-20 w-full mt-1 rounded-lg shadow-lg overflow-hidden"
                     style={{ backgroundColor: '#fff', border: '1px solid #E0E0E0' }}>
                  {filtered.map(p => (
                    <button
                      key={p.product_id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                      onClick={() => { setSelectedProduct(p); setBonusSearch(`${p.sku} – ${p.name}`); setShowDropdown(false) }}
                    >
                      <span className="font-mono" style={{ color: '#9E9E9E' }}>{p.sku}</span>
                      <span className="mx-1.5" style={{ color: '#E0E0E0' }}>·</span>
                      <span style={{ color: '#282A35' }}>{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              type="number" min="1" className="input w-16 text-center"
              value={bonusQty}
              onChange={e => setBonusQty(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <button
              type="button"
              onClick={addBonusItem}
              disabled={!selectedProduct}
              className="btn-primary px-3 text-xs gap-1"
            >
              <Gift size={12} /> যোগ
            </button>
          </div>

          {bonusItems.length > 0 && (
            <div className="space-y-1.5 mt-1">
              {bonusItems.map(b => (
                <div key={b.product_id}
                     className="flex items-center justify-between px-3 py-1.5 rounded text-xs"
                     style={{ backgroundColor: '#F1F8E9', border: '1px solid #C8E6C9' }}>
                  <span>
                    <span className="font-mono" style={{ color: '#558B2F' }}>{b.sku}</span>
                    <span className="mx-1" style={{ color: '#A5D6A7' }}>·</span>
                    <span style={{ color: '#282A35' }}>{b.name}</span>
                    <span className="ml-1 font-semibold" style={{ color: '#2E7D32' }}>×{b.quantity}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange({ ...reward, bonus_items: bonusItems.filter(x => x.product_id !== b.product_id) })}
                    style={{ color: '#EF5350' }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CampaignsPage() {
  const [campaigns, setCampaigns]       = useState<Campaign[]>([])
  const [products, setProducts]         = useState<Product[]>([])
  const [loading, setLoading]           = useState(true)
  const [showModal, setShowModal]       = useState(false)
  const [editing, setEditing]           = useState<Campaign | null>(null)
  const [form, setForm]                 = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving]             = useState(false)
  const [deleting, setDeleting]         = useState<string | null>(null)
  const [showPicker, setShowPicker]     = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([])

  async function load() {
    try {
      const [campData, prodData] = await Promise.all([
        campaignsAPI.list(),
        productsAPI.list().catch(() => []),
      ])
      setCampaigns(campData)
      setProducts(prodData)
    } catch {
      toast.error('Data লোড করা যায়নি')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setSelectedProducts([])
    setShowModal(true)
  }

  function openEdit(c: Campaign) {
    setEditing(c)
    const reward: Reward = c.reward?.reward_type
      ? c.reward
      : {
          reward_type: (c.type === 'bonus' ? 'bonus' : c.type === 'flat' ? 'flat' : 'percentage') as Reward['reward_type'],
          discount_value: c.amount || 0,
          bonus_items: [],
        }
    setForm({
      name:                 c.name,
      description:          c.description || '',
      reward,
      start_date:           c.start_date ? c.start_date.slice(0, 10) : '',
      end_date:             c.end_date   ? c.end_date.slice(0, 10)   : '',
      apply_to:             c.apply_to,
      is_active:            c.is_active,
    })
    if (c.apply_to === 'specific' && c.product_ids?.length) {
      setSelectedProducts(c.product_ids.map(id => ({
        product_id: id, sku: '', name: id, mrp: 0, quantity: 1,
      })))
    } else {
      setSelectedProducts([])
    }
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Campaign নাম আবশ্যক')
      return
    }
    const r = form.reward
    if (r.reward_type !== 'bonus' && (r.discount_value <= 0)) {
      toast.error('ছাড়ের পরিমাণ দিন')
      return
    }
    if (r.reward_type === 'bonus' && r.bonus_items.length === 0) {
      toast.error('কমপক্ষে একটি ফ্রি পণ্য যোগ করুন')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name:                 form.name.trim(),
        description:          form.description || null,
        reward:               form.reward,
        start_date:           form.start_date || null,
        end_date:             form.end_date   || null,
        apply_to:             form.apply_to,
        is_active:            form.is_active,
        product_ids:          form.apply_to === 'specific' ? selectedProducts.map(p => p.product_id) : null,
      }
      if (editing) {
        const updated = await campaignsAPI.update(editing.campaign_id, payload)
        setCampaigns(cs => cs.map(c => c.campaign_id === editing.campaign_id ? updated : c))
        toast.success('Campaign আপডেট হয়েছে!')
      } else {
        const created = await campaignsAPI.create(payload)
        setCampaigns(cs => [created, ...cs])
        toast.success('Campaign তৈরি হয়েছে!')
      }
      setShowModal(false)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'সমস্যা হয়েছে')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('এই campaign মুছে ফেলবেন?')) return
    setDeleting(id)
    try {
      await campaignsAPI.delete(id)
      setCampaigns(cs => cs.filter(c => c.campaign_id !== id))
      toast.success('Campaign মুছে ফেলা হয়েছে')
    } catch {
      toast.error('মুছতে পারা যায়নি')
    } finally {
      setDeleting(null)
    }
  }

  async function toggleActive(c: Campaign) {
    try {
      const updated = await campaignsAPI.update(c.campaign_id, { is_active: !c.is_active })
      setCampaigns(cs => cs.map(x => x.campaign_id === c.campaign_id ? updated : x))
    } catch {
      toast.error('আপডেট ব্যর্থ')
    }
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Megaphone size={22} style={{ color: '#04AA6D' }} />
            Campaigns
          </h1>
          <p className="page-subtitle">অফার, ছাড় ও বোনাস campaign পরিচালনা করুন</p>
        </div>
        <button onClick={openCreate} className="btn-primary gap-2">
          <Plus size={15} /> নতুন Campaign
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>
      ) : campaigns.length === 0 ? (
        <div className="card p-12 text-center">
          <Megaphone size={40} className="mx-auto mb-3" style={{ color: '#E0E0E0' }} />
          <p className="text-sm font-medium" style={{ color: '#282A35' }}>কোনো campaign নেই</p>
          <p className="text-xs mt-1 mb-4" style={{ color: '#9E9E9E' }}>প্রথম campaign তৈরি করুন</p>
          <button onClick={openCreate} className="btn-primary gap-2 mx-auto">
            <Plus size={14} /> Campaign তৈরি করুন
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: '#F9F9F9', borderBottom: '1px solid #E0E0E0' }}>
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: '#757575' }}>Campaign নাম</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: '#757575' }}>পুরস্কার</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: '#757575' }}>তারিখ</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: '#757575' }}>Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: '#757575' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr key={c.campaign_id}
                    style={{ borderTop: i > 0 ? '1px solid #F0F0F0' : 'none' }}>
                  <td className="px-4 py-3">
                    <p className="font-medium" style={{ color: '#282A35' }}>{c.name}</p>
                    {c.description && (
                      <p className="text-xs mt-0.5 truncate max-w-xs" style={{ color: '#9E9E9E' }}>
                        {c.description}
                      </p>
                    )}
                    <p className="text-xs mt-0.5" style={{ color: '#9E9E9E' }}>
                      {c.apply_to === 'all' ? 'সব পণ্যে প্রযোজ্য' : `${c.product_ids?.length || 0} পণ্যে`}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold" style={{ color: '#04AA6D' }}>
                      {rewardLabel(c)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#616161' }}>
                    {c.start_date ? <p>শুরু: {c.start_date.slice(0, 10)}</p> : <p style={{ color: '#BDBDBD' }}>—</p>}
                    {c.end_date   ? <p>শেষ: {c.end_date.slice(0, 10)}</p>   : null}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => toggleActive(c)}
                        className="text-xs px-2 py-1 rounded border transition-colors"
                        style={c.is_active
                          ? { backgroundColor: '#E8F5E9', color: '#2E7D32', borderColor: '#A5D6A7' }
                          : { backgroundColor: '#F5F5F5', color: '#757575', borderColor: '#E0E0E0' }}
                      >
                        {c.is_active ? 'সক্রিয়' : 'বন্ধ'}
                      </button>
                      <button
                        onClick={() => openEdit(c)}
                        className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                        style={{ color: '#757575' }}
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(c.campaign_id)}
                        disabled={deleting === c.campaign_id}
                        className="p-1.5 rounded hover:bg-red-50 transition-colors"
                        style={{ color: '#EF5350' }}
                      >
                        {deleting === c.campaign_id
                          ? <span className="spinner h-3.5 w-3.5" />
                          : <Trash2 size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Product Picker */}
      <ProductPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onConfirm={setSelectedProducts}
        selected={selectedProducts}
      />

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col"
               style={{ maxHeight: '85vh' }}>

            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
                 style={{ backgroundColor: '#282A35' }}>
              <h2 className="font-semibold text-white text-sm">
                {editing ? 'Campaign সম্পাদনা' : 'নতুন Campaign'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">

              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>
                  Campaign নাম *
                </label>
                <input
                  className="input"
                  placeholder="যেমন: ঈদ স্পেশাল অফার"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>বিবরণ</label>
                <textarea
                  className="input h-20 resize-none"
                  placeholder="Campaign সম্পর্কে সংক্ষিপ্ত বিবরণ..."
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              {/* Reward Selector */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: '#282A35' }}>পুরস্কার *</label>
                <div className="p-3 rounded-lg" style={{ backgroundColor: '#F9F9F9', border: '1px solid #E0E0E0' }}>
                  <RewardSelector
                    reward={form.reward}
                    onChange={r => setForm(f => ({ ...f, reward: r }))}
                    products={products}
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>শুরুর তারিখ</label>
                  <input
                    type="date" className="input"
                    value={form.start_date}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>শেষ তারিখ</label>
                  <input
                    type="date" className="input"
                    value={form.end_date}
                    onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>

              {/* Apply to */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>প্রযোজ্য</label>
                <div className="flex gap-3 mb-3">
                  {(['all', 'specific'] as const).map(v => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio" name="apply_to" value={v}
                        checked={form.apply_to === v}
                        onChange={() => setForm(f => ({ ...f, apply_to: v }))}
                        style={{ accentColor: '#04AA6D' }}
                      />
                      <span className="text-sm" style={{ color: '#282A35' }}>
                        {v === 'all' ? 'সব পণ্যে' : 'নির্দিষ্ট পণ্যে'}
                      </span>
                    </label>
                  ))}
                </div>
                {form.apply_to === 'specific' && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowPicker(true)}
                      className="btn-secondary gap-2 text-xs"
                    >
                      <Package size={13} /> পণ্য নির্বাচন করুন ({selectedProducts.length} টি)
                    </button>
                    {selectedProducts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {selectedProducts.map(p => (
                          <span
                            key={p.product_id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: '#E8F5E9', color: '#2E7D32' }}
                          >
                            {p.sku || p.name}
                            <button
                              onClick={() => setSelectedProducts(sp => sp.filter(x => x.product_id !== p.product_id))}
                              className="hover:text-red-600"
                            >
                              <X size={9} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between p-3 rounded"
                   style={{ backgroundColor: '#F9F9F9', border: '1px solid #E0E0E0' }}>
                <span className="text-sm font-medium" style={{ color: '#282A35' }}>Campaign সক্রিয়</span>
                <button
                  type="button" role="switch" aria-checked={form.is_active}
                  onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={`toggle-track ${form.is_active ? 'toggle-track-on' : ''}`}
                >
                  <span className={`toggle-thumb ${form.is_active ? 'toggle-thumb-on' : ''}`} />
                </button>
              </div>
            </div>

            <div className="px-5 py-4 flex justify-end gap-3 flex-shrink-0"
                 style={{ borderTop: '1px solid #E0E0E0' }}>
              <button onClick={() => setShowModal(false)} className="btn-secondary">বাতিল</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary gap-2">
                {saving ? <><span className="spinner h-4 w-4" /> সংরক্ষণ...</> : 'সংরক্ষণ করুন'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
