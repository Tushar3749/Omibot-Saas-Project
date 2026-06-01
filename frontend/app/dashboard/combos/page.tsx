'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { combosAPI } from '@/lib/api'
import { Layers, Plus, X, Edit2, Trash2, Package, AlertTriangle } from 'lucide-react'
import ProductPicker, { type SelectedProduct } from '@/components/ui/ProductPicker'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ComboProduct {
  id?: string
  combo_id?: string
  product_id: string
  sku: string
  name: string
  mrp: number | null
  category?: string
  quantity: number
  current_stock: number
  low_stock_threshold: number
}

interface Combo {
  combo_id: string
  combo_sku: string
  tenant_id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  is_active: boolean
  created_at: string
  products: ComboProduct[]
}

type ComboForm = {
  name: string
  description: string
  price: string
  image_url: string
  is_active: boolean
}

const EMPTY_FORM: ComboForm = {
  name: '', description: '', price: '', image_url: '', is_active: true,
}

// ─── Stock badge ──────────────────────────────────────────────────────────────
function StockBadge({ current, threshold }: { current: number; threshold: number }) {
  if (current === 0) {
    return <span className="text-xs font-semibold" style={{ color: '#C62828' }}>স্টক নেই</span>
  }
  if (current <= threshold) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium" style={{ color: '#E65100' }}>
        <AlertTriangle size={10} /> {current}
      </span>
    )
  }
  return <span className="text-xs" style={{ color: '#2E7D32' }}>{current}</span>
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CombosPage() {
  const [combos, setCombos]           = useState<Combo[]>([])
  const [loading, setLoading]         = useState(true)
  const [showModal, setShowModal]     = useState(false)
  const [editing, setEditing]         = useState<Combo | null>(null)
  const [form, setForm]               = useState<ComboForm>(EMPTY_FORM)
  const [saving, setSaving]           = useState(false)
  const [deleting, setDeleting]       = useState<string | null>(null)
  const [showPicker, setShowPicker]   = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([])

  async function load() {
    try {
      const data = await combosAPI.list()
      setCombos(data)
    } catch {
      toast.error('Combos লোড করা যায়নি')
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

  function openEdit(c: Combo) {
    setEditing(c)
    setForm({
      name:        c.name,
      description: c.description || '',
      price:       String(c.price),
      image_url:   c.image_url || '',
      is_active:   c.is_active,
    })
    setSelectedProducts(c.products.map(p => ({
      product_id: p.product_id,
      sku:        p.sku,
      name:       p.name,
      mrp:        p.mrp || 0,
      quantity:   p.quantity,
    })))
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim() || !form.price) {
      toast.error('নাম ও মূল্য আবশ্যক')
      return
    }
    const priceVal = parseFloat(form.price)
    if (isNaN(priceVal) || priceVal <= 0) {
      toast.error('মূল্য সঠিকভাবে লিখুন')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name:        form.name.trim(),
        description: form.description || null,
        price:       priceVal,
        image_url:   form.image_url || null,
        is_active:   form.is_active,
        products:    selectedProducts.map(p => ({
          product_id: p.product_id,
          quantity:   p.quantity,
        })),
      }
      if (editing) {
        const updated = await combosAPI.update(editing.combo_id, payload)
        setCombos(cs => cs.map(c => c.combo_id === editing.combo_id ? updated : c))
        toast.success('Combo আপডেট হয়েছে!')
      } else {
        const created = await combosAPI.create(payload)
        setCombos(cs => [created, ...cs])
        toast.success('Combo তৈরি হয়েছে!')
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
    if (!confirm('এই combo মুছে ফেলবেন?')) return
    setDeleting(id)
    try {
      await combosAPI.delete(id)
      setCombos(cs => cs.filter(c => c.combo_id !== id))
      toast.success('Combo মুছে ফেলা হয়েছে')
    } catch {
      toast.error('মুছতে পারা যায়নি')
    } finally {
      setDeleting(null)
    }
  }

  function minStock(products: ComboProduct[]): number {
    if (!products.length) return 0
    return Math.min(...products.map(p => Math.floor(p.current_stock / p.quantity)))
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Layers size={22} style={{ color: '#04AA6D' }} />
            Combo Bundles
          </h1>
          <p className="page-subtitle">পণ্যের bundle তৈরি ও পরিচালনা করুন</p>
        </div>
        <button onClick={openCreate} className="btn-primary gap-2">
          <Plus size={15} /> নতুন Combo
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>
      ) : combos.length === 0 ? (
        <div className="card p-12 text-center">
          <Layers size={40} className="mx-auto mb-3" style={{ color: 'var(--c-border)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>কোনো combo নেই</p>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--c-muted)' }}>প্রথম combo bundle তৈরি করুন</p>
          <button onClick={openCreate} className="btn-primary gap-2 mx-auto">
            <Plus size={14} /> Combo তৈরি করুন
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {combos.map(c => {
            const availableUnits = minStock(c.products)
            const lowStock = availableUnits > 0 && availableUnits <= 3
            const noStock  = availableUnits === 0

            return (
              <div key={c.combo_id} className="card p-4">
                <div className="flex items-start justify-between gap-3">

                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: '#F5F5F5', color: '#757575' }}>
                        {c.combo_sku}
                      </span>
                      <span className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>{c.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={c.is_active
                              ? { backgroundColor: '#E8F5E9', color: '#2E7D32' }
                              : { backgroundColor: '#F5F5F5', color: '#757575' }}>
                        {c.is_active ? 'সক্রিয়' : 'বন্ধ'}
                      </span>
                    </div>

                    {c.description && (
                      <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>{c.description}</p>
                    )}

                    <p className="text-sm font-bold mt-1" style={{ color: '#04AA6D' }}>
                      ৳{c.price.toLocaleString()}
                    </p>

                    {/* Component products */}
                    {c.products.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {c.products.map(p => (
                          <div key={p.product_id}
                               className="flex items-center gap-2 text-xs px-2 py-1.5 rounded"
                               style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                            <Package size={11} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
                            <span className="font-mono" style={{ color: 'var(--c-muted)' }}>{p.sku}</span>
                            <span className="flex-1 truncate" style={{ color: 'var(--c-text)' }}>{p.name}</span>
                            <span style={{ color: 'var(--c-muted)' }}>×{p.quantity}</span>
                            <span className="ml-1">
                              <StockBadge current={p.current_stock} threshold={p.low_stock_threshold} />
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Available units indicator */}
                    <p className="text-xs mt-1.5" style={{ color: noStock ? '#C62828' : lowStock ? '#E65100' : 'var(--c-muted)' }}>
                      {noStock
                        ? 'উপাদান পণ্যের স্টক নেই'
                        : `আনুমানিক ${availableUnits} টি combo তৈরি করা সম্ভব`}
                    </p>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => openEdit(c)}
                      className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                      style={{ color: 'var(--c-muted)' }}
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(c.combo_id)}
                      disabled={deleting === c.combo_id}
                      className="p-1.5 rounded hover:bg-red-50 transition-colors"
                      style={{ color: '#EF5350' }}
                    >
                      {deleting === c.combo_id
                        ? <span className="spinner h-3.5 w-3.5" />
                        : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
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
          <div className="relative w-full max-w-lg rounded-xl shadow-2xl overflow-hidden flex flex-col"
               style={{ backgroundColor: 'var(--c-card)', maxHeight: '85vh' }}>

            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
                 style={{ backgroundColor: '#282A35' }}>
              <h2 className="font-semibold text-white text-sm">
                {editing ? 'Combo সম্পাদনা' : 'নতুন Combo Bundle'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>
                  Combo নাম *
                </label>
                <input
                  className="input"
                  placeholder="যেমন: ঈদ স্পেশাল প্যাকেজ"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>বিবরণ</label>
                <textarea
                  className="input h-16 resize-none"
                  placeholder="Combo সম্পর্কে সংক্ষিপ্ত বিবরণ..."
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>
                    Combo মূল্য (৳) *
                  </label>
                  <input
                    type="number" min="0" step="0.01" className="input"
                    placeholder="0" value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>Image URL</label>
                  <input
                    className="input"
                    placeholder="https://..."
                    value={form.image_url}
                    onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))}
                  />
                </div>
              </div>

              {/* Products */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--c-text)' }}>
                  Combo-তে পণ্য
                </label>
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="btn-secondary gap-2 text-sm w-full"
                >
                  <Package size={14} /> পণ্য যোগ করুন ({selectedProducts.length} টি নির্বাচিত)
                </button>
                {selectedProducts.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {selectedProducts.map(p => (
                      <div key={p.product_id}
                           className="flex items-center justify-between px-3 py-2 rounded text-xs"
                           style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                        <span>
                          <span className="font-mono" style={{ color: 'var(--c-muted)' }}>{p.sku}</span>
                          <span className="mx-1.5" style={{ color: 'var(--c-muted)' }}>·</span>
                          <span style={{ color: 'var(--c-text)' }}>{p.name}</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <span style={{ color: 'var(--c-muted)' }}>×{p.quantity}</span>
                          <button
                            onClick={() => setSelectedProducts(sp => sp.filter(x => x.product_id !== p.product_id))}
                            style={{ color: '#EF5350' }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between p-3 rounded"
                   style={{ backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
                <span className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>Combo সক্রিয়</span>
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
                 style={{ borderTop: '1px solid var(--c-border)' }}>
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
