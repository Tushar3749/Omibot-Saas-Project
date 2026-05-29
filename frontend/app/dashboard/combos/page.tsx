'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { combosAPI } from '@/lib/api'
import { Layers, Plus, X, Edit2, Trash2, Download, Package } from 'lucide-react'
import ProductPicker, { type SelectedProduct } from '@/components/ui/ProductPicker'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ComboProduct {
  id?: string
  combo_id?: string
  product_id: string
  sku: string
  name: string
  mrp: number | null
  quantity: number
}

interface Combo {
  combo_id: string
  combo_sku: string
  tenant_id: string
  name: string
  description: string | null
  price: number
  offer_price: number
  stock: number
  image_url: string | null
  is_active: boolean
  created_at: string
  products: ComboProduct[]
}

type ComboForm = {
  name: string
  description: string
  price: string
  offer_price: string
  stock: string
  image_url: string
  is_active: boolean
}

const EMPTY_FORM: ComboForm = {
  name: '', description: '', price: '', offer_price: '',
  stock: '0', image_url: '', is_active: true,
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
      offer_price: String(c.offer_price),
      stock:       String(c.stock),
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
    if (!form.name.trim() || !form.price || !form.offer_price) {
      toast.error('নাম, মূল্য ও অফার মূল্য আবশ্যক')
      return
    }
    const priceVal = parseFloat(form.price)
    const offerVal = parseFloat(form.offer_price)
    if (isNaN(priceVal) || priceVal <= 0 || isNaN(offerVal) || offerVal <= 0) {
      toast.error('মূল্য সঠিকভাবে লিখুন')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name:        form.name.trim(),
        description: form.description || null,
        price:       priceVal,
        offer_price: offerVal,
        stock:       parseInt(form.stock) || 0,
        image_url:   form.image_url || null,
        is_active:   form.is_active,
        products:    selectedProducts.map(p => ({
          product_id: p.product_id,
          sku:        p.sku,
          name:       p.name,
          mrp:        p.mrp,
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

  async function handleDownloadTemplate() {
    try {
      await combosAPI.downloadTemplate()
    } catch {
      toast.error('Template download ব্যর্থ')
    }
  }

  const discount = (p: number, o: number) =>
    p > 0 ? Math.round(((p - o) / p) * 100) : 0

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Layers size={22} style={{ color: '#04AA6D' }} />
            Combo Offers
          </h1>
          <p className="page-subtitle">পণ্য combo তৈরি করুন ও পরিচালনা করুন</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleDownloadTemplate} className="btn-secondary gap-2">
            <Download size={14} /> Template
          </button>
          <button onClick={openCreate} className="btn-primary gap-2">
            <Plus size={15} /> নতুন Combo
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>
      ) : combos.length === 0 ? (
        <div className="card p-12 text-center">
          <Layers size={40} className="mx-auto mb-3" style={{ color: 'var(--c-border)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>কোনো combo নেই</p>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--c-muted)' }}>প্রথম combo তৈরি করুন</p>
          <button onClick={openCreate} className="btn-primary gap-2 mx-auto">
            <Plus size={14} /> Combo তৈরি করুন
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ borderBottom: '1px solid var(--c-border)' }}>
              <tr>
                <th className="th text-left">Combo SKU</th>
                <th className="th text-left">নাম</th>
                <th className="th text-left">পণ্যসমূহ</th>
                <th className="th text-right">মূল্য (৳)</th>
                <th className="th text-right">অফার মূল্য (৳)</th>
                <th className="th text-center">Stock</th>
                <th className="th text-center">Status</th>
                <th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {combos.map((c, i) => (
                <tr key={c.combo_id} style={{ borderTop: i > 0 ? '1px solid var(--c-border)' : 'none' }}>
                  <td className="td font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{c.combo_sku}</td>
                  <td className="td">
                    <p className="font-medium" style={{ color: 'var(--c-text)' }}>{c.name}</p>
                    {c.description && (
                      <p className="text-xs mt-0.5 truncate max-w-[180px]" style={{ color: 'var(--c-muted)' }}>
                        {c.description}
                      </p>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-1">
                      <Package size={12} style={{ color: 'var(--c-muted)' }} />
                      <span className="text-xs" style={{ color: 'var(--c-muted)' }}>
                        {c.products.length} টি
                      </span>
                    </div>
                    {c.products[0] && (
                      <p className="text-xs mt-0.5 truncate max-w-[140px]" style={{ color: 'var(--c-muted)' }}>
                        {c.products[0].name}
                        {c.products.length > 1 ? ` +${c.products.length - 1}` : ''}
                      </p>
                    )}
                  </td>
                  <td className="td text-right" style={{ color: 'var(--c-text)' }}>
                    <span className="line-through text-xs" style={{ color: 'var(--c-muted)' }}>
                      ৳{c.price.toLocaleString()}
                    </span>
                  </td>
                  <td className="td text-right">
                    <span className="font-semibold" style={{ color: '#04AA6D' }}>
                      ৳{c.offer_price.toLocaleString()}
                    </span>
                    <span className="ml-1 text-xs" style={{ color: '#E53935' }}>
                      -{discount(c.price, c.offer_price)}%
                    </span>
                  </td>
                  <td className="td text-center">
                    <span className={`text-xs font-medium ${c.stock === 0 ? 'text-red-500' : ''}`}
                          style={{ color: c.stock === 0 ? '#E53935' : 'var(--c-text)' }}>
                      {c.stock}
                    </span>
                  </td>
                  <td className="td text-center">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={c.is_active
                            ? { backgroundColor: '#E8F5E9', color: '#2E7D32' }
                            : { backgroundColor: '#F5F5F5', color: '#757575' }}>
                      {c.is_active ? 'সক্রিয়' : 'বন্ধ'}
                    </span>
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1.5">
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
          <div className="relative w-full max-w-lg rounded-xl shadow-2xl overflow-hidden flex flex-col"
               style={{ backgroundColor: 'var(--c-card)', maxHeight: '85vh' }}>

            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
                 style={{ backgroundColor: '#282A35' }}>
              <h2 className="font-semibold text-white text-sm">
                {editing ? 'Combo সম্পাদনা' : 'নতুন Combo'}
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
                    নিয়মিত মূল্য (৳) *
                  </label>
                  <input
                    type="number" min="0" step="0.01" className="input"
                    placeholder="0" value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>
                    অফার মূল্য (৳) *
                  </label>
                  <input
                    type="number" min="0" step="0.01" className="input"
                    placeholder="0" value={form.offer_price}
                    onChange={e => setForm(f => ({ ...f, offer_price: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>Stock</label>
                  <input
                    type="number" min="0" className="input"
                    placeholder="0" value={form.stock}
                    onChange={e => setForm(f => ({ ...f, stock: e.target.value }))}
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
                  type="button"
                  role="switch"
                  aria-checked={form.is_active}
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
