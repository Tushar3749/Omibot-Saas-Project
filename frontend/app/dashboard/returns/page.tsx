'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { returnsAPI } from '@/lib/api'
import { RotateCcw, Plus, X, Check, XCircle, Clock, AlertTriangle, Trash2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Return {
  return_id: string
  tenant_id: string
  product_id: string | null
  sku: string
  product_name: string
  quantity: number
  return_type: 'return' | 'damage' | 'expiry'
  reason: string | null
  order_id: string | null
  customer_name: string | null
  status: 'pending' | 'processed' | 'rejected'
  notes: string | null
  created_at: string
  processed_at: string | null
}

type ReturnType = 'all' | 'return' | 'damage' | 'expiry'

type ReturnForm = {
  sku: string
  product_name: string
  quantity: string
  return_type: 'return' | 'damage' | 'expiry'
  reason: string
  order_id: string
  customer_name: string
  notes: string
}

const EMPTY_FORM: ReturnForm = {
  sku: '', product_name: '', quantity: '1',
  return_type: 'return', reason: '', order_id: '',
  customer_name: '', notes: '',
}

// ─── Badge helpers ─────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: Return['return_type'] }) {
  const map = {
    return: { label: 'রিটার্ন',   bg: '#E3F2FD', color: '#1565C0' },
    damage: { label: 'ক্ষতিগ্রস্ত', bg: '#FFF3E0', color: '#E65100' },
    expiry: { label: 'মেয়াদ শেষ',  bg: '#FFEBEE', color: '#C62828' },
  }
  const { label, bg, color } = map[type]
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: bg, color }}>
      {label}
    </span>
  )
}

function StatusBadge({ status }: { status: Return['status'] }) {
  const map = {
    pending:   { label: 'অপেক্ষায়',   bg: '#FFF8E1', color: '#F57F17', Icon: Clock },
    processed: { label: 'সম্পন্ন',    bg: '#E8F5E9', color: '#2E7D32', Icon: Check },
    rejected:  { label: 'প্রত্যাখ্যাত', bg: '#FFEBEE', color: '#C62828', Icon: XCircle },
  }
  const { label, bg, color, Icon } = map[status]
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: bg, color }}>
      <Icon size={10} /> {label}
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ReturnsPage() {
  const [returns, setReturns]     = useState<Return[]>([])
  const [loading, setLoading]     = useState(true)
  const [typeFilter, setTypeFilter] = useState<ReturnType>('all')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]           = useState<ReturnForm>(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    try {
      const data = await returnsAPI.list()
      setReturns(data)
    } catch {
      toast.error('Returns লোড করা যায়নি')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = typeFilter === 'all'
    ? returns
    : returns.filter(r => r.return_type === typeFilter)

  async function handleCreate() {
    if (!form.sku.trim() || !form.product_name.trim()) {
      toast.error('SKU ও পণ্যের নাম আবশ্যক')
      return
    }
    const qty = parseInt(form.quantity)
    if (!qty || qty < 1) {
      toast.error('সঠিক পরিমাণ লিখুন')
      return
    }
    setSaving(true)
    try {
      const payload = {
        sku:          form.sku.trim(),
        product_name: form.product_name.trim(),
        quantity:     qty,
        return_type:  form.return_type,
        reason:       form.reason || undefined,
        order_id:     form.order_id || undefined,
        customer_name: form.customer_name || undefined,
        notes:        form.notes || undefined,
      }
      const created = await returnsAPI.create(payload)
      setReturns(rs => [created, ...rs])
      toast.success('Return তৈরি হয়েছে!')
      setShowModal(false)
      setForm(EMPTY_FORM)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'সমস্যা হয়েছে')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(id: string, status: 'processed' | 'rejected') {
    setUpdatingId(id)
    try {
      const updated = await returnsAPI.update(id, { status })
      setReturns(rs => rs.map(r => r.return_id === id ? updated : r))
      toast.success(status === 'processed' ? 'Return সম্পন্ন করা হয়েছে' : 'Return প্রত্যাখ্যান করা হয়েছে')
    } catch {
      toast.error('আপডেট ব্যর্থ')
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('এই return মুছে ফেলবেন?')) return
    setDeletingId(id)
    try {
      await returnsAPI.delete(id)
      setReturns(rs => rs.filter(r => r.return_id !== id))
      toast.success('মুছে ফেলা হয়েছে')
    } catch {
      toast.error('মুছতে পারা যায়নি')
    } finally {
      setDeletingId(null)
    }
  }

  const TABS: { key: ReturnType; label: string }[] = [
    { key: 'all',    label: 'সব' },
    { key: 'return', label: 'রিটার্ন' },
    { key: 'damage', label: 'ক্ষতিগ্রস্ত' },
    { key: 'expiry', label: 'মেয়াদ শেষ' },
  ]

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <RotateCcw size={22} style={{ color: '#04AA6D' }} />
            Returns & Damage
          </h1>
          <p className="page-subtitle">রিটার্ন, ক্ষতিগ্রস্ত ও মেয়াদ শেষ পণ্য ব্যবস্থাপনা</p>
        </div>
        <button onClick={() => { setForm(EMPTY_FORM); setShowModal(true) }} className="btn-primary gap-2">
          <Plus size={15} /> নতুন Return
        </button>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ backgroundColor: 'var(--c-surface)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTypeFilter(t.key)}
            className="px-4 py-2 rounded text-xs font-medium transition-all"
            style={typeFilter === t.key
              ? { backgroundColor: 'var(--c-card)', color: '#04AA6D', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
              : { color: 'var(--c-muted)' }}
          >
            {t.label}
            <span className="ml-1.5 text-xs opacity-70">
              ({t.key === 'all' ? returns.length : returns.filter(r => r.return_type === t.key).length})
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <AlertTriangle size={40} className="mx-auto mb-3" style={{ color: 'var(--c-border)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>কোনো রেকর্ড নেই</p>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--c-muted)' }}>নতুন return / damage তৈরি করুন</p>
          <button onClick={() => { setForm(EMPTY_FORM); setShowModal(true) }} className="btn-primary gap-2 mx-auto">
            <Plus size={14} /> নতুন Return
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ borderBottom: '1px solid var(--c-border)' }}>
              <tr>
                <th className="th text-left">SKU</th>
                <th className="th text-left">পণ্য</th>
                <th className="th text-center">পরিমাণ</th>
                <th className="th text-center">ধরন</th>
                <th className="th text-left">কারণ</th>
                <th className="th text-left">Customer</th>
                <th className="th text-center">Status</th>
                <th className="th text-right">তারিখ</th>
                <th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.return_id} style={{ borderTop: i > 0 ? '1px solid var(--c-border)' : 'none' }}>
                  <td className="td font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{r.sku}</td>
                  <td className="td">
                    <p className="font-medium text-xs" style={{ color: 'var(--c-text)' }}>{r.product_name}</p>
                    {r.order_id && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>Order: {r.order_id}</p>
                    )}
                  </td>
                  <td className="td text-center font-semibold">{r.quantity}</td>
                  <td className="td text-center"><TypeBadge type={r.return_type} /></td>
                  <td className="td text-xs max-w-[140px] truncate" style={{ color: 'var(--c-muted)' }}>
                    {r.reason || '—'}
                  </td>
                  <td className="td text-xs" style={{ color: 'var(--c-muted)' }}>{r.customer_name || '—'}</td>
                  <td className="td text-center"><StatusBadge status={r.status} /></td>
                  <td className="td text-right text-xs" style={{ color: 'var(--c-muted)' }}>
                    {new Date(r.created_at).toLocaleDateString('bn-BD')}
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1">
                      {r.status === 'pending' && (
                        <>
                          <button
                            onClick={() => updateStatus(r.return_id, 'processed')}
                            disabled={updatingId === r.return_id}
                            className="text-xs px-2 py-1 rounded border transition-colors"
                            style={{ backgroundColor: '#E8F5E9', color: '#2E7D32', borderColor: '#A5D6A7' }}
                            title="সম্পন্ন করুন"
                          >
                            {updatingId === r.return_id ? <span className="spinner h-3 w-3" /> : <Check size={11} />}
                          </button>
                          <button
                            onClick={() => updateStatus(r.return_id, 'rejected')}
                            disabled={updatingId === r.return_id}
                            className="text-xs px-2 py-1 rounded border transition-colors"
                            style={{ backgroundColor: '#FFEBEE', color: '#C62828', borderColor: '#EF9A9A' }}
                            title="প্রত্যাখ্যান করুন"
                          >
                            <XCircle size={11} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDelete(r.return_id)}
                        disabled={deletingId === r.return_id}
                        className="p-1.5 rounded hover:bg-red-50 transition-colors"
                        style={{ color: '#EF5350' }}
                      >
                        {deletingId === r.return_id
                          ? <span className="spinner h-3.5 w-3.5" />
                          : <Trash2 size={13} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
               style={{ backgroundColor: 'var(--c-card)' }}>
            <div className="flex items-center justify-between px-5 py-4"
                 style={{ backgroundColor: '#282A35' }}>
              <h2 className="font-semibold text-white text-sm">নতুন Return / Damage</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>SKU *</label>
                  <input
                    className="input"
                    placeholder="পণ্যের SKU"
                    value={form.sku}
                    onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>পরিমাণ *</label>
                  <input
                    type="number" min="1" className="input"
                    value={form.quantity}
                    onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>পণ্যের নাম *</label>
                <input
                  className="input"
                  placeholder="পণ্যের নাম"
                  value={form.product_name}
                  onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>ধরন *</label>
                <select
                  className="input"
                  value={form.return_type}
                  onChange={e => setForm(f => ({ ...f, return_type: e.target.value as ReturnForm['return_type'] }))}
                >
                  <option value="return">রিটার্ন (ফিরিয়ে দেওয়া)</option>
                  <option value="damage">ক্ষতিগ্রস্ত</option>
                  <option value="expiry">মেয়াদ শেষ</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>কারণ</label>
                <textarea
                  className="input h-16 resize-none"
                  placeholder="Return-এর কারণ..."
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>Order ID</label>
                  <input
                    className="input"
                    placeholder="ঐচ্ছিক"
                    value={form.order_id}
                    onChange={e => setForm(f => ({ ...f, order_id: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>Customer নাম</label>
                  <input
                    className="input"
                    placeholder="ঐচ্ছিক"
                    value={form.customer_name}
                    onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>নোট</label>
                <textarea
                  className="input h-14 resize-none"
                  placeholder="অতিরিক্ত নোট..."
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="px-5 py-4 flex justify-end gap-3"
                 style={{ borderTop: '1px solid var(--c-border)' }}>
              <button onClick={() => setShowModal(false)} className="btn-secondary">বাতিল</button>
              <button onClick={handleCreate} disabled={saving} className="btn-primary gap-2">
                {saving ? <><span className="spinner h-4 w-4" /> তৈরি হচ্ছে...</> : 'তৈরি করুন'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
