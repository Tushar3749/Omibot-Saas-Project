'use client'
import { useEffect, useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { campaignsAPI } from '@/lib/api'
import {
  Megaphone, Plus, X, Edit2, Trash2, Upload,
  CheckCircle, Clock, AlertCircle, XCircle, Package,
} from 'lucide-react'
import ProductPicker, { type SelectedProduct } from '@/components/ui/ProductPicker'
import CsvGuide from '@/components/ui/CsvGuide'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Campaign {
  campaign_id: string
  name: string
  description: string | null
  type: 'percentage' | 'flat' | 'bonus'
  amount: number
  start_date: string | null
  end_date: string | null
  apply_to: 'all' | 'specific'
  product_ids: string[]
  is_active: boolean
  status: 'active' | 'inactive' | 'scheduled' | 'expired'
  created_at: string
}

type FormData = {
  name: string
  description: string
  type: 'percentage' | 'flat' | 'bonus'
  amount: string
  start_date: string
  end_date: string
  apply_to: 'all' | 'specific'
  is_active: boolean
}

const EMPTY_FORM: FormData = {
  name: '', description: '', type: 'percentage',
  amount: '', start_date: '', end_date: '',
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

// ─── Type label ───────────────────────────────────────────────────────────────
function typeLabel(type: string, amount: number) {
  if (type === 'percentage') return `${amount}% ছাড়`
  if (type === 'flat')       return `৳${amount} ছাড়`
  return `৳${amount} বোনাস`
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CampaignsPage() {
  const [campaigns, setCampaigns]       = useState<Campaign[]>([])
  const [loading, setLoading]           = useState(true)
  const [showModal, setShowModal]       = useState(false)
  const [editing, setEditing]           = useState<Campaign | null>(null)
  const [form, setForm]                 = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving]             = useState(false)
  const [importing, setImporting]       = useState(false)
  const [deleting, setDeleting]         = useState<string | null>(null)
  const [showPicker, setShowPicker]     = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([])
  const csvRef = useRef<HTMLInputElement>(null)

  // ── Load ──────────────────────────────────────────────────────────────────
  async function load() {
    try {
      const data = await campaignsAPI.list()
      setCampaigns(data)
    } catch {
      toast.error('Campaigns লোড করা যায়নি')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // ── Open modal ────────────────────────────────────────────────────────────
  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setSelectedProducts([])
    setShowModal(true)
  }

  function openEdit(c: Campaign) {
    setEditing(c)
    setForm({
      name:        c.name,
      description: c.description || '',
      type:        c.type,
      amount:      String(c.amount),
      start_date:  c.start_date ? c.start_date.slice(0, 10) : '',
      end_date:    c.end_date   ? c.end_date.slice(0, 10)   : '',
      apply_to:    c.apply_to,
      is_active:   c.is_active,
    })
    // Restore selected products if editing a specific campaign
    if (c.apply_to === 'specific' && c.product_ids?.length) {
      setSelectedProducts(c.product_ids.map(id => ({
        product_id: id, sku: '', name: id, mrp: 0, quantity: 1,
      })))
    } else {
      setSelectedProducts([])
    }
    setShowModal(true)
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.name.trim() || !form.amount) {
      toast.error('নাম ও পরিমাণ আবশ্যক')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name:        form.name.trim(),
        description: form.description || null,
        type:        form.type,
        amount:      parseFloat(form.amount),
        start_date:  form.start_date || null,
        end_date:    form.end_date   || null,
        apply_to:    form.apply_to,
        is_active:   form.is_active,
        product_ids: form.apply_to === 'specific' ? selectedProducts.map(p => p.product_id) : null,
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

  // ── Delete ────────────────────────────────────────────────────────────────
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

  // ── Toggle active ─────────────────────────────────────────────────────────
  async function toggleActive(c: Campaign) {
    try {
      const updated = await campaignsAPI.update(c.campaign_id, { is_active: !c.is_active })
      setCampaigns(cs => cs.map(x => x.campaign_id === c.campaign_id ? updated : x))
    } catch {
      toast.error('আপডেট ব্যর্থ')
    }
  }

  // ── CSV Import ────────────────────────────────────────────────────────────
  async function handleCSVImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const result = await campaignsAPI.importCSV(file)
      toast.success(`${result.imported} টি campaign import হয়েছে`)
      await load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Import ব্যর্থ হয়েছে')
    } finally {
      setImporting(false)
      if (csvRef.current) csvRef.current.value = ''
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
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
        <div className="flex gap-2">
          <input
            ref={csvRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleCSVImport}
          />
          <button
            onClick={() => csvRef.current?.click()}
            disabled={importing}
            className="btn-secondary gap-2"
          >
            {importing
              ? <><span className="spinner h-4 w-4" /> Import হচ্ছে...</>
              : <><Upload size={14} /> CSV Import</>}
          </button>
          <button onClick={openCreate} className="btn-primary gap-2">
            <Plus size={15} /> নতুন Campaign
          </button>
        </div>
      </div>

      {/* CSV Guide */}
      <CsvGuide type="campaign" />

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
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: '#757575' }}>ছাড়/বোনাস</th>
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
                      {typeLabel(c.type, c.amount)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#616161' }}>
                    {c.start_date ? <p>শুরু: {c.start_date.slice(0, 10)}</p> : <p style={{ color: '#BDBDBD' }}>—</p>}
                    {c.end_date   ? <p>শেষ: {c.end_date.slice(0, 10)}</p>   : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Toggle active */}
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
          <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden">

            <div className="flex items-center justify-between px-5 py-4"
                 style={{ backgroundColor: '#282A35' }}>
              <h2 className="font-semibold text-white text-sm">
                {editing ? 'Campaign সম্পাদনা' : 'নতুন Campaign'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">

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

              {/* Type + Amount */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>ধরন *</label>
                  <select
                    className="input"
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as FormData['type'] }))}
                  >
                    <option value="percentage">শতকরা ছাড় (%)</option>
                    <option value="flat">নির্দিষ্ট ছাড় (৳)</option>
                    <option value="bonus">বোনাস (৳)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>
                    পরিমাণ * {form.type === 'percentage' ? '(%)' : '(৳)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    placeholder="0"
                    value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>শুরুর তারিখ</label>
                  <input
                    type="date"
                    className="input"
                    value={form.start_date}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>শেষ তারিখ</label>
                  <input
                    type="date"
                    className="input"
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
                        type="radio"
                        name="apply_to"
                        value={v}
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

            <div className="px-5 py-4 flex justify-end gap-3"
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
