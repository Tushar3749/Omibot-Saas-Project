'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { discountCategoriesAPI } from '@/lib/api'
import { Tag, Plus, X, Edit2, Trash2, CheckCircle } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface DiscountCategory {
  category_id: string
  category_name: string
  description: string | null
  is_active: boolean
  created_at: string
}

type FormData = {
  category_name: string
  description: string
  is_active: boolean
}

const EMPTY_FORM: FormData = {
  category_name: '', description: '', is_active: true,
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DiscountCategoriesPage() {
  const [categories, setCategories]   = useState<DiscountCategory[]>([])
  const [loading, setLoading]         = useState(true)
  const [showModal, setShowModal]     = useState(false)
  const [editing, setEditing]         = useState<DiscountCategory | null>(null)
  const [form, setForm]               = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving]           = useState(false)
  const [deleting, setDeleting]       = useState<string | null>(null)

  async function load() {
    try {
      const data = await discountCategoriesAPI.list()
      setCategories(data)
    } catch {
      toast.error('Categories লোড করা যায়নি')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowModal(true)
  }

  function openEdit(c: DiscountCategory) {
    setEditing(c)
    setForm({
      category_name: c.category_name,
      description:   c.description || '',
      is_active:     c.is_active,
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.category_name.trim()) {
      toast.error('Category নাম আবশ্যক')
      return
    }
    setSaving(true)
    try {
      const payload = {
        category_name: form.category_name.trim(),
        description:   form.description || null,
        is_active:     form.is_active,
      }
      if (editing) {
        const updated = await discountCategoriesAPI.update(editing.category_id, payload)
        setCategories(cs => cs.map(c => c.category_id === editing.category_id ? updated : c))
        toast.success('Category আপডেট হয়েছে!')
      } else {
        const created = await discountCategoriesAPI.create(payload)
        setCategories(cs => [created, ...cs])
        toast.success('Category তৈরি হয়েছে!')
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
    if (!confirm('এই category মুছে ফেলবেন? এটি ব্যবহারকারী campaigns থেকেও সরিয়ে দেওয়া হবে।')) return
    setDeleting(id)
    try {
      await discountCategoriesAPI.delete(id)
      setCategories(cs => cs.filter(c => c.category_id !== id))
      toast.success('Category মুছে ফেলা হয়েছে')
    } catch {
      toast.error('মুছতে পারা যায়নি')
    } finally {
      setDeleting(null)
    }
  }

  async function toggleActive(c: DiscountCategory) {
    try {
      const updated = await discountCategoriesAPI.update(c.category_id, { is_active: !c.is_active })
      setCategories(cs => cs.map(x => x.category_id === c.category_id ? updated : x))
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
            <Tag size={22} style={{ color: '#04AA6D' }} />
            Discount Categories
          </h1>
          <p className="page-subtitle">Campaigns ও specific_category rules-এ ব্যবহারের জন্য category তৈরি করুন</p>
        </div>
        <button onClick={openCreate} className="btn-primary gap-2">
          <Plus size={15} /> নতুন Category
        </button>
      </div>

      {/* Info banner */}
      <div className="p-3 rounded-lg text-xs flex items-start gap-2"
           style={{ backgroundColor: '#EDE7F6', color: '#4527A0', border: '1px solid #CE93D8' }}>
        <CheckCircle size={14} className="flex-shrink-0 mt-0.5" />
        <span>
          এই categories campaigns তৈরির সময় বেছে নেওয়া যাবে এবং discount rules-এর
          <strong> specific_category</strong> rule-এ ব্যবহার করা যাবে।
        </span>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>
      ) : categories.length === 0 ? (
        <div className="card p-12 text-center">
          <Tag size={40} className="mx-auto mb-3" style={{ color: '#E0E0E0' }} />
          <p className="text-sm font-medium" style={{ color: '#282A35' }}>কোনো discount category নেই</p>
          <p className="text-xs mt-1 mb-4" style={{ color: '#9E9E9E' }}>প্রথম category তৈরি করুন</p>
          <button onClick={openCreate} className="btn-primary gap-2 mx-auto">
            <Plus size={14} /> Category তৈরি করুন
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: '#F9F9F9', borderBottom: '1px solid #E0E0E0' }}>
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: '#757575' }}>Category নাম</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: '#757575' }}>বিবরণ</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: '#757575' }}>তৈরির তারিখ</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: '#757575' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c, i) => (
                <tr key={c.category_id}
                    style={{ borderTop: i > 0 ? '1px solid #F0F0F0' : 'none' }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: '#282A35' }}>{c.category_name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                            style={c.is_active
                              ? { backgroundColor: '#E8F5E9', color: '#2E7D32' }
                              : { backgroundColor: '#F5F5F5', color: '#757575' }}>
                        {c.is_active ? 'সক্রিয়' : 'বন্ধ'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: '#616161' }}>
                    {c.description || <span style={{ color: '#BDBDBD' }}>—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#9E9E9E' }}>
                    {c.created_at.slice(0, 10)}
                  </td>
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
                        onClick={() => handleDelete(c.category_id)}
                        disabled={deleting === c.category_id}
                        className="p-1.5 rounded hover:bg-red-50 transition-colors"
                        style={{ color: '#EF5350' }}
                      >
                        {deleting === c.category_id
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

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden">

            <div className="flex items-center justify-between px-5 py-4"
                 style={{ backgroundColor: '#282A35' }}>
              <h2 className="font-semibold text-white text-sm">
                {editing ? 'Category সম্পাদনা' : 'নতুন Discount Category'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>
                  Category নাম *
                </label>
                <input
                  className="input"
                  placeholder="যেমন: রমজান স্পেশাল, ঈদ অফার"
                  value={form.category_name}
                  onChange={e => setForm(f => ({ ...f, category_name: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>বিবরণ</label>
                <textarea
                  className="input h-20 resize-none"
                  placeholder="Category সম্পর্কে সংক্ষিপ্ত বিবরণ..."
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded"
                   style={{ backgroundColor: '#F9F9F9', border: '1px solid #E0E0E0' }}>
                <span className="text-sm font-medium" style={{ color: '#282A35' }}>Category সক্রিয়</span>
                <button
                  type="button" role="switch" aria-checked={form.is_active}
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
