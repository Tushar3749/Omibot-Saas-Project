'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { complaintsAPI } from '@/lib/api'
import {
  AlertTriangle, Plus, X, CheckCircle, Clock, XCircle,
  MessageSquare, Flag, TrendingUp,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Complaint {
  complaint_id: string
  tenant_id: string
  conversation_id: string | null
  customer_name: string | null
  customer_id: string | null
  product_mentioned: string | null
  complaint_text: string
  complaint_type: string
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed'
  priority: 'low' | 'medium' | 'high'
  source: 'ai' | 'manual'
  resolution_note: string | null
  created_at: string
  resolved_at: string | null
}

interface Stats {
  total: number
  open: number
  in_progress: number
  resolved: number
  high_priority: number
}

type StatusFilter = 'all' | 'open' | 'in_progress' | 'resolved' | 'dismissed'

type ComplaintForm = {
  customer_name: string
  product_mentioned: string
  complaint_text: string
  complaint_type: string
  priority: 'low' | 'medium' | 'high'
}

const EMPTY_FORM: ComplaintForm = {
  customer_name: '', product_mentioned: '', complaint_text: '',
  complaint_type: 'general', priority: 'medium',
}

// ─── Badge helpers ────────────────────────────────────────────────────────────
function PriorityBadge({ priority }: { priority: Complaint['priority'] }) {
  const map = {
    high:   { label: 'জরুরি',    bg: '#FFEBEE', color: '#C62828' },
    medium: { label: 'মধ্যম',   bg: '#FFF8E1', color: '#F57F17' },
    low:    { label: 'সাধারণ',  bg: '#E8F5E9', color: '#2E7D32' },
  }
  const { label, bg, color } = map[priority]
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: bg, color }}>
      {label}
    </span>
  )
}

function StatusBadge({ status }: { status: Complaint['status'] }) {
  const map = {
    open:        { label: 'খোলা',         bg: '#FFEBEE', color: '#C62828', Icon: AlertTriangle },
    in_progress: { label: 'প্রক্রিয়াধীন', bg: '#E3F2FD', color: '#1565C0', Icon: Clock },
    resolved:    { label: 'সমাধান হয়েছে', bg: '#E8F5E9', color: '#2E7D32', Icon: CheckCircle },
    dismissed:   { label: 'বাদ দেওয়া',   bg: '#F5F5F5', color: '#757575', Icon: XCircle },
  }
  const { label, bg, color, Icon } = map[status]
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: bg, color }}>
      <Icon size={9} /> {label}
    </span>
  )
}

function typeLabel(t: string) {
  const map: Record<string, string> = {
    delivery:        'ডেলিভারি',
    product_quality: 'পণ্যের মান',
    wrong_item:      'ভুল পণ্য',
    general:         'সাধারণ',
    pricing:         'মূল্য',
  }
  return map[t] || t
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [stats, setStats]           = useState<Stats | null>(null)
  const [loading, setLoading]       = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showModal, setShowModal]   = useState(false)
  const [form, setForm]             = useState<ComplaintForm>(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  async function load(status?: string) {
    try {
      const [data, statsData] = await Promise.all([
        complaintsAPI.list(status === 'all' ? undefined : status),
        complaintsAPI.stats(),
      ])
      setComplaints(data)
      setStats(statsData)
    } catch {
      toast.error('Complaints লোড করা যায়নি')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function handleFilterChange(f: StatusFilter) {
    setStatusFilter(f)
    setLoading(true)
    load(f === 'all' ? undefined : f)
  }

  async function handleCreate() {
    if (!form.complaint_text.trim() || form.complaint_text.trim().length < 5) {
      toast.error('অভিযোগের বিবরণ কমপক্ষে ৫ অক্ষর হতে হবে')
      return
    }
    setSaving(true)
    try {
      const payload = {
        customer_name:     form.customer_name || undefined,
        product_mentioned: form.product_mentioned || undefined,
        complaint_text:    form.complaint_text.trim(),
        complaint_type:    form.complaint_type,
        priority:          form.priority,
      }
      const created = await complaintsAPI.create(payload)
      setComplaints(cs => [created, ...cs])
      if (stats) setStats({ ...stats, total: stats.total + 1, open: stats.open + 1 })
      toast.success('Complaint তৈরি হয়েছে!')
      setShowModal(false)
      setForm(EMPTY_FORM)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'সমস্যা হয়েছে')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(id: string, status: string) {
    setUpdatingId(id)
    try {
      const updated = await complaintsAPI.update(id, { status })
      setComplaints(cs => cs.map(c => c.complaint_id === id ? updated : c))
      // Re-fetch stats
      const newStats = await complaintsAPI.stats()
      setStats(newStats)
      toast.success('Status আপডেট হয়েছে')
    } catch {
      toast.error('আপডেট ব্যর্থ')
    } finally {
      setUpdatingId(null)
    }
  }

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all',         label: 'সব' },
    { key: 'open',        label: 'খোলা' },
    { key: 'in_progress', label: 'প্রক্রিয়াধীন' },
    { key: 'resolved',    label: 'সমাধান হয়েছে' },
    { key: 'dismissed',   label: 'বাদ দেওয়া' },
  ]

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <AlertTriangle size={22} style={{ color: '#04AA6D' }} />
            Complaints
          </h1>
          <p className="page-subtitle">AI-সনাক্তকৃত ও ম্যানুয়াল অভিযোগ পরিচালনা</p>
        </div>
        <button onClick={() => { setForm(EMPTY_FORM); setShowModal(true) }} className="btn-primary gap-2">
          <Plus size={15} /> নতুন Complaint
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'মোট',           value: stats.total,         color: '#1565C0', bg: '#E3F2FD', Icon: MessageSquare },
            { label: 'খোলা',          value: stats.open,          color: '#C62828', bg: '#FFEBEE', Icon: AlertTriangle },
            { label: 'প্রক্রিয়াধীন', value: stats.in_progress,  color: '#1565C0', bg: '#E3F2FD', Icon: Clock },
            { label: 'সমাধান হয়েছে', value: stats.resolved,      color: '#2E7D32', bg: '#E8F5E9', Icon: CheckCircle },
            { label: 'জরুরি',         value: stats.high_priority, color: '#E65100', bg: '#FFF3E0', Icon: Flag },
          ].map(({ label, value, color, bg, Icon }) => (
            <div key={label} className="card p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
                   style={{ backgroundColor: bg }}>
                <Icon size={14} style={{ color }} />
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--c-muted)' }}>{label}</p>
                <p className="text-lg font-bold" style={{ color: 'var(--c-text)' }}>{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-1 p-1 rounded-lg w-fit flex-wrap" style={{ backgroundColor: 'var(--c-surface)' }}>
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => handleFilterChange(t.key)}
            className="px-3 py-2 rounded text-xs font-medium transition-all"
            style={statusFilter === t.key
              ? { backgroundColor: 'var(--c-card)', color: '#04AA6D', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
              : { color: 'var(--c-muted)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>
      ) : complaints.length === 0 ? (
        <div className="card p-12 text-center">
          <MessageSquare size={40} className="mx-auto mb-3" style={{ color: 'var(--c-border)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>কোনো অভিযোগ নেই</p>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--c-muted)' }}>AI বা ম্যানুয়ালি অভিযোগ যোগ করুন</p>
          <button onClick={() => { setForm(EMPTY_FORM); setShowModal(true) }} className="btn-primary gap-2 mx-auto">
            <Plus size={14} /> Complaint যোগ করুন
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ borderBottom: '1px solid var(--c-border)' }}>
              <tr>
                <th className="th text-left">Customer</th>
                <th className="th text-left">পণ্য</th>
                <th className="th text-left">অভিযোগ</th>
                <th className="th text-center">ধরন</th>
                <th className="th text-center">গুরুত্ব</th>
                <th className="th text-center">Status</th>
                <th className="th text-right">তারিখ</th>
                <th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((c, i) => (
                <tr key={c.complaint_id} style={{ borderTop: i > 0 ? '1px solid var(--c-border)' : 'none' }}>
                  <td className="td">
                    <p className="text-xs font-medium" style={{ color: 'var(--c-text)' }}>
                      {c.customer_name || '—'}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>
                      {c.source === 'ai' ? 'AI সনাক্ত' : 'ম্যানুয়াল'}
                    </p>
                  </td>
                  <td className="td text-xs" style={{ color: 'var(--c-muted)' }}>
                    {c.product_mentioned || '—'}
                  </td>
                  <td className="td max-w-[200px]">
                    <p className="text-xs truncate" style={{ color: 'var(--c-text)' }} title={c.complaint_text}>
                      {c.complaint_text}
                    </p>
                  </td>
                  <td className="td text-center text-xs" style={{ color: 'var(--c-muted)' }}>
                    {typeLabel(c.complaint_type)}
                  </td>
                  <td className="td text-center">
                    <PriorityBadge priority={c.priority} />
                  </td>
                  <td className="td text-center">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="td text-right text-xs" style={{ color: 'var(--c-muted)' }}>
                    {new Date(c.created_at).toLocaleDateString('bn-BD')}
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1">
                      {c.status === 'open' && (
                        <button
                          onClick={() => updateStatus(c.complaint_id, 'in_progress')}
                          disabled={updatingId === c.complaint_id}
                          className="text-xs px-2 py-1 rounded border transition-colors whitespace-nowrap"
                          style={{ backgroundColor: '#E3F2FD', color: '#1565C0', borderColor: '#90CAF9' }}
                        >
                          {updatingId === c.complaint_id ? <span className="spinner h-3 w-3" /> : 'শুরু করুন'}
                        </button>
                      )}
                      {(c.status === 'open' || c.status === 'in_progress') && (
                        <>
                          <button
                            onClick={() => updateStatus(c.complaint_id, 'resolved')}
                            disabled={updatingId === c.complaint_id}
                            className="text-xs px-2 py-1 rounded border transition-colors"
                            style={{ backgroundColor: '#E8F5E9', color: '#2E7D32', borderColor: '#A5D6A7' }}
                            title="সমাধান করুন"
                          >
                            <CheckCircle size={11} />
                          </button>
                          <button
                            onClick={() => updateStatus(c.complaint_id, 'dismissed')}
                            disabled={updatingId === c.complaint_id}
                            className="text-xs px-2 py-1 rounded border transition-colors"
                            style={{ backgroundColor: '#F5F5F5', color: '#757575', borderColor: '#E0E0E0' }}
                            title="বাদ দিন"
                          >
                            <XCircle size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
               style={{ backgroundColor: 'var(--c-card)' }}>
            <div className="flex items-center justify-between px-5 py-4"
                 style={{ backgroundColor: '#282A35' }}>
              <h2 className="font-semibold text-white text-sm">নতুন Complaint</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>
                    Customer নাম
                  </label>
                  <input
                    className="input"
                    placeholder="ঐচ্ছিক"
                    value={form.customer_name}
                    onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>
                    পণ্য
                  </label>
                  <input
                    className="input"
                    placeholder="উল্লেখিত পণ্য"
                    value={form.product_mentioned}
                    onChange={e => setForm(f => ({ ...f, product_mentioned: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>
                  অভিযোগের বিবরণ *
                </label>
                <textarea
                  className="input h-24 resize-none"
                  placeholder="অভিযোগের বিস্তারিত লিখুন..."
                  value={form.complaint_text}
                  onChange={e => setForm(f => ({ ...f, complaint_text: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>ধরন</label>
                  <select
                    className="input"
                    value={form.complaint_type}
                    onChange={e => setForm(f => ({ ...f, complaint_type: e.target.value }))}
                  >
                    <option value="general">সাধারণ</option>
                    <option value="delivery">ডেলিভারি</option>
                    <option value="product_quality">পণ্যের মান</option>
                    <option value="wrong_item">ভুল পণ্য</option>
                    <option value="pricing">মূল্য</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--c-text)' }}>গুরুত্ব</label>
                  <select
                    className="input"
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value as ComplaintForm['priority'] }))}
                  >
                    <option value="low">সাধারণ</option>
                    <option value="medium">মধ্যম</option>
                    <option value="high">জরুরি</option>
                  </select>
                </div>
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
