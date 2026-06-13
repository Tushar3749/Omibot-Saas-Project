'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { returnsAPI } from '@/lib/api'
import {
  RotateCcw, Check, XCircle, Clock, AlertTriangle,
  Trash2, X, Loader2, Package, ChevronDown, ChevronUp, FileText,
} from 'lucide-react'
import PolicyDocs from '@/components/ui/PolicyDocs'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReturnItem {
  product_id?: string
  sku?: string
  name: string
  weight?: string
  quantity: number
  reason?: string
}

interface Return {
  return_id: string
  tenant_id: string
  order_id: string | null
  customer_phone: string | null
  return_type: 'full' | 'partial'
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  items: ReturnItem[]
  owner_note: string | null
  created_at: string
  updated_at: string
}

type StatusTab = 'pending' | 'approved' | 'rejected'
type PageTab = 'list' | 'policy'

interface Counts { pending: number; approved: number; rejected: number; cancelled: number }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: Return['status'] }) {
  const map = {
    pending:   { label: 'অপেক্ষায়',      bg: '#FFF8E1', color: '#F57F17', Icon: Clock },
    approved:  { label: 'অনুমোদিত',      bg: '#E8F5E9', color: '#2E7D32', Icon: Check },
    rejected:  { label: 'প্রত্যাখ্যাত',   bg: '#FFEBEE', color: '#C62828', Icon: XCircle },
    cancelled: { label: 'বাতিল',          bg: '#ECEFF1', color: '#546E7A', Icon: X },
  }
  const { label, bg, color, Icon } = map[status] ?? map.pending
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: bg, color }}>
      <Icon size={10} /> {label}
    </span>
  )
}

function TypeBadge({ type }: { type: Return['return_type'] }) {
  return type === 'full'
    ? <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#E3F2FD', color: '#1565C0' }}>সম্পূর্ণ</span>
    : <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#FFF3E0', color: '#E65100' }}>আংশিক</span>
}

function ItemsList({ items }: { items: ReturnItem[] }) {
  if (!items?.length) return <span className="text-xs" style={{ color: 'var(--c-muted)' }}>—</span>
  return (
    <div className="space-y-0.5">
      {items.map((item, i) => (
        <div key={i} className="text-xs" style={{ color: 'var(--c-text)' }}>
          <span className="font-medium">{item.name}</span>
          {item.weight && <span style={{ color: 'var(--c-muted)' }}> {item.weight}</span>}
          <span style={{ color: 'var(--c-muted)' }}> × {item.quantity}</span>
          {item.reason && (
            <span className="ml-1.5 italic" style={{ color: 'var(--c-muted)' }}>— {item.reason}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ReturnsPage() {
  const [returns,    setReturns]    = useState<Return[]>([])
  const [counts,     setCounts]     = useState<Counts>({ pending: 0, approved: 0, rejected: 0, cancelled: 0 })
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState<StatusTab>('pending')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Reject modal
  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const [rejectNote,   setRejectNote]   = useState('')
  const [rejecting,    setRejecting]    = useState(false)

  async function load(status: StatusTab) {
    setLoading(true)
    try {
      const [data, cnts] = await Promise.all([
        returnsAPI.list(status),
        returnsAPI.counts(),
      ])
      setReturns(data)
      setCounts(cnts)
    } catch {
      toast.error('Returns লোড করা যায়নি')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(tab) }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleApprove(id: string) {
    setUpdatingId(id)
    try {
      const updated: Return = await returnsAPI.approve(id)
      setReturns(rs => rs.filter(r => r.return_id !== id))
      setCounts(c => ({ ...c, pending: Math.max(0, c.pending - 1), approved: c.approved + 1 }))
      toast.success('রিটার্ন অনুমোদিত হয়েছে — স্টক পুনরুদ্ধার হয়েছে')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'অনুমোদন ব্যর্থ হয়েছে')
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleReject() {
    if (!rejectTarget) return
    setRejecting(true)
    try {
      await returnsAPI.reject(rejectTarget, rejectNote || undefined)
      setReturns(rs => rs.filter(r => r.return_id !== rejectTarget))
      setCounts(c => ({ ...c, pending: Math.max(0, c.pending - 1), rejected: c.rejected + 1 }))
      toast.success('রিটার্ন প্রত্যাখ্যান করা হয়েছে')
      setRejectTarget(null)
      setRejectNote('')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'প্রত্যাখ্যান ব্যর্থ')
    } finally {
      setRejecting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('এই রিটার্ন রেকর্ড মুছে ফেলবেন?')) return
    setDeletingId(id)
    try {
      await returnsAPI.delete(id)
      setReturns(rs => rs.filter(r => r.return_id !== id))
      setCounts(c => ({ ...c, [tab]: Math.max(0, c[tab] - 1) }))
      toast.success('মুছে ফেলা হয়েছে')
    } catch {
      toast.error('মুছতে পারা যায়নি')
    } finally {
      setDeletingId(null)
    }
  }

  const TABS: { key: StatusTab; label: string }[] = [
    { key: 'pending',  label: 'অপেক্ষায়' },
    { key: 'approved', label: 'অনুমোদিত' },
    { key: 'rejected', label: 'প্রত্যাখ্যাত' },
  ]

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <RotateCcw size={22} style={{ color: '#04AA6D' }} />
            Return Management
            {counts.pending > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                    style={{ backgroundColor: '#FFEBEE', color: '#C62828' }}>
                {counts.pending} নতুন
              </span>
            )}
          </h1>
          <p className="page-subtitle">বট-এর মাধ্যমে গ্রাহকের রিটার্ন রিকোয়েস্ট পরিচালনা করুন</p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ backgroundColor: 'var(--c-surface)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2 rounded text-xs font-medium transition-all flex items-center gap-1.5"
            style={tab === t.key
              ? { backgroundColor: 'var(--c-card)', color: '#04AA6D', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
              : { color: 'var(--c-muted)' }}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold min-w-[20px] text-center"
                    style={{
                      backgroundColor: tab === t.key
                        ? (t.key === 'pending' ? '#FFEBEE' : t.key === 'approved' ? '#E8F5E9' : '#FFEBEE')
                        : 'var(--c-border)',
                      color: tab === t.key
                        ? (t.key === 'pending' ? '#C62828' : t.key === 'approved' ? '#2E7D32' : '#C62828')
                        : 'var(--c-muted)',
                    }}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>
      ) : returns.length === 0 ? (
        <div className="card p-12 text-center">
          <Package size={40} className="mx-auto mb-3" style={{ color: 'var(--c-border)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>কোনো রিটার্ন রিকোয়েস্ট নেই</p>
          <p className="text-xs mt-1" style={{ color: 'var(--c-muted)' }}>
            গ্রাহক বট-এ "ফেরত" বললে এখানে রিকোয়েস্ট আসবে
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ borderBottom: '1px solid var(--c-border)' }}>
              <tr>
                <th className="th text-left" style={{ width: 28 }}></th>
                <th className="th text-left">Return ID</th>
                <th className="th text-left">Order</th>
                <th className="th text-left">গ্রাহকের ফোন</th>
                <th className="th text-left">পণ্যসমূহ</th>
                <th className="th text-center">ধরন</th>
                <th className="th text-center">অবস্থা</th>
                <th className="th text-right">তারিখ</th>
                <th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r, i) => (
                <>
                  <tr
                    key={r.return_id}
                    style={{
                      borderTop: i > 0 ? '1px solid var(--c-border)' : 'none',
                      backgroundColor: r.status === 'pending' ? 'rgba(245,127,23,0.02)' : 'transparent',
                    }}
                  >
                    {/* Expand toggle */}
                    <td className="td pl-3 pr-1">
                      <button
                        onClick={() => setExpandedId(expandedId === r.return_id ? null : r.return_id)}
                        className="p-0.5 rounded transition-colors"
                        style={{ color: 'var(--c-muted)' }}
                      >
                        {expandedId === r.return_id
                          ? <ChevronUp size={13} />
                          : <ChevronDown size={13} />}
                      </button>
                    </td>

                    <td className="td">
                      <code className="text-xs font-mono" style={{ color: 'var(--c-text)' }}>
                        {r.return_id.slice(0, 8).toUpperCase()}
                      </code>
                    </td>

                    <td className="td">
                      {r.order_id
                        ? <code className="text-xs font-mono" style={{ color: 'var(--c-muted)' }}>
                            {r.order_id.slice(0, 8)}…
                          </code>
                        : <span style={{ color: 'var(--c-muted)' }}>—</span>
                      }
                    </td>

                    <td className="td text-xs" style={{ color: 'var(--c-text)' }}>
                      {r.customer_phone || '—'}
                    </td>

                    <td className="td max-w-[220px]">
                      <ItemsList items={r.items} />
                    </td>

                    <td className="td text-center"><TypeBadge type={r.return_type} /></td>
                    <td className="td text-center"><StatusBadge status={r.status} /></td>

                    <td className="td text-right text-xs" style={{ color: 'var(--c-muted)' }}>
                      {new Date(r.created_at).toLocaleDateString('bn-BD')}
                    </td>

                    <td className="td">
                      <div className="flex items-center justify-end gap-1">
                        {r.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleApprove(r.return_id)}
                              disabled={updatingId === r.return_id}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium transition-colors"
                              style={{ backgroundColor: '#E8F5E9', color: '#2E7D32', borderColor: '#A5D6A7' }}
                              title="অনুমোদন করুন"
                            >
                              {updatingId === r.return_id
                                ? <Loader2 size={11} className="animate-spin" />
                                : <Check size={11} />}
                              অনুমোদন
                            </button>
                            <button
                              onClick={() => { setRejectTarget(r.return_id); setRejectNote('') }}
                              disabled={updatingId === r.return_id}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded border font-medium transition-colors"
                              style={{ backgroundColor: '#FFEBEE', color: '#C62828', borderColor: '#EF9A9A' }}
                              title="প্রত্যাখ্যান করুন"
                            >
                              <XCircle size={11} /> প্রত্যাখ্যান
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
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Trash2 size={13} />}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {expandedId === r.return_id && (
                    <tr key={`${r.return_id}-detail`} style={{ borderTop: '1px solid var(--c-border-subtle)' }}>
                      <td colSpan={9} className="px-6 py-3"
                          style={{ backgroundColor: 'var(--c-surface)' }}>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                          <div>
                            <p className="font-semibold mb-1" style={{ color: 'var(--c-muted)' }}>পূর্ণ Order ID</p>
                            <code style={{ color: 'var(--c-text)' }}>{r.order_id || '—'}</code>
                          </div>
                          <div>
                            <p className="font-semibold mb-1" style={{ color: 'var(--c-muted)' }}>ফেরতের ধরন</p>
                            <p style={{ color: 'var(--c-text)' }}>{r.return_type === 'full' ? 'সম্পূর্ণ ফেরত' : 'আংশিক ফেরত'}</p>
                          </div>
                          <div>
                            <p className="font-semibold mb-1" style={{ color: 'var(--c-muted)' }}>কারণ</p>
                            <p style={{ color: 'var(--c-text)' }}>{r.items?.[0]?.reason || '—'}</p>
                          </div>
                          {r.owner_note && (
                            <div className="col-span-2 md:col-span-3">
                              <p className="font-semibold mb-1" style={{ color: 'var(--c-muted)' }}>মালিকের নোট</p>
                              <p style={{ color: 'var(--c-text)' }}>{r.owner_note}</p>
                            </div>
                          )}
                          <div>
                            <p className="font-semibold mb-1" style={{ color: 'var(--c-muted)' }}>তৈরির সময়</p>
                            <p style={{ color: 'var(--c-text)' }}>{new Date(r.created_at).toLocaleString('bn-BD')}</p>
                          </div>
                          <div>
                            <p className="font-semibold mb-1" style={{ color: 'var(--c-muted)' }}>শেষ আপডেট</p>
                            <p style={{ color: 'var(--c-text)' }}>{new Date(r.updated_at).toLocaleString('bn-BD')}</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── MODAL: Reject with note ──────────────────────────────────────────── */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">রিটার্ন প্রত্যাখ্যান করুন</h2>
              <button onClick={() => setRejectTarget(null)} className="btn-ghost p-1.5"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                  প্রত্যাখ্যানের কারণ <span className="text-slate-400 font-normal">(ঐচ্ছিক)</span>
                </label>
                <textarea
                  className="input h-20 resize-none text-sm"
                  placeholder="গ্রাহককে জানানোর জন্য কারণ লিখুন..."
                  value={rejectNote}
                  onChange={e => setRejectNote(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setRejectTarget(null)}
                  className="btn-secondary flex-1"
                >
                  বাতিল
                </button>
                <button
                  onClick={handleReject}
                  disabled={rejecting}
                  className="flex-1 flex items-center justify-center gap-2 text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
                  style={{ backgroundColor: '#FFEBEE', color: '#C62828' }}
                >
                  {rejecting
                    ? <><Loader2 size={14} className="animate-spin" /> প্রক্রিয়া...</>
                    : <><XCircle size={14} /> প্রত্যাখ্যান নিশ্চিত করুন</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
