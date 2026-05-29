'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { stockAPI } from '@/lib/api'
import { Package, AlertTriangle, Edit2, Save, X, Clock, TrendingDown, TrendingUp, Settings } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface StockProduct {
  product_id: string
  sku: string
  name: string
  category: string | null
  stock: number
  mrp: number
  is_active: boolean
  low_stock: boolean
  out_of_stock: boolean
}

interface StockHistory {
  id: string
  product_id: string | null
  sku: string
  change_type: string
  quantity_change: number
  quantity_before: number | null
  quantity_after: number | null
  reference_id: string | null
  note: string | null
  created_at: string
}

type Tab = 'stock' | 'history'

// ─── Badge helpers ────────────────────────────────────────────────────────────
function StockBadge({ p }: { p: StockProduct }) {
  if (p.out_of_stock) return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: '#FFEBEE', color: '#C62828' }}>Stock শেষ</span>
  )
  if (p.low_stock) return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: '#FFF8E1', color: '#F57F17' }}>কম Stock</span>
  )
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: '#E8F5E9', color: '#2E7D32' }}>স্বাভাবিক</span>
  )
}

function changeTypeLabel(t: string) {
  const map: Record<string, string> = {
    manual:           'ম্যানুয়াল আপডেট',
    order_placed:     'অর্ডার ডেলিভারি',
    order_cancelled:  'অর্ডার বাতিল',
    return:           'রিটার্ন',
    damage:           'ক্ষতিগ্রস্ত',
    expiry:           'মেয়াদ শেষ',
    import:           'CSV Import',
  }
  return map[t] || t
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function StockPage() {
  const [products, setProducts]     = useState<StockProduct[]>([])
  const [history, setHistory]       = useState<StockHistory[]>([])
  const [threshold, setThreshold]   = useState(5)
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<Tab>('stock')
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editQty, setEditQty]       = useState<number>(0)
  const [editNote, setEditNote]     = useState('')
  const [savingId, setSavingId]     = useState<string | null>(null)
  const [thresholdInput, setThresholdInput] = useState<number>(5)
  const [savingThreshold, setSavingThreshold] = useState(false)

  async function loadStock() {
    try {
      const data = await stockAPI.list()
      setProducts(data.products || [])
      setThreshold(data.threshold)
      setThresholdInput(data.threshold)
    } catch {
      toast.error('Stock লোড করা যায়নি')
    } finally {
      setLoading(false)
    }
  }

  async function loadHistory() {
    try {
      const data = await stockAPI.history()
      setHistory(data)
    } catch {
      toast.error('History লোড করা যায়নি')
    }
  }

  useEffect(() => { loadStock() }, [])

  useEffect(() => {
    if (tab === 'history' && history.length === 0) loadHistory()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(p: StockProduct) {
    setEditingId(p.product_id)
    setEditQty(p.stock)
    setEditNote('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditNote('')
  }

  async function saveEdit(product_id: string) {
    setSavingId(product_id)
    try {
      const result = await stockAPI.update({ product_id, quantity: editQty, note: editNote || undefined })
      setProducts(ps => ps.map(p =>
        p.product_id === product_id
          ? { ...p, stock: result.stock, low_stock: result.stock <= threshold, out_of_stock: result.stock === 0 }
          : p
      ))
      toast.success('Stock আপডেট হয়েছে')
      setEditingId(null)
    } catch {
      toast.error('Stock আপডেট ব্যর্থ')
    } finally {
      setSavingId(null)
    }
  }

  async function saveThreshold() {
    setSavingThreshold(true)
    try {
      await stockAPI.setThreshold(thresholdInput)
      setThreshold(thresholdInput)
      // Refresh stock status
      await loadStock()
      toast.success(`Low stock সীমা ${thresholdInput} এ সেট হয়েছে`)
    } catch {
      toast.error('সীমা সেট করা যায়নি')
    } finally {
      setSavingThreshold(false)
    }
  }

  // Stat calculations
  const totalProducts = products.length
  const lowStockCount = products.filter(p => p.low_stock && !p.out_of_stock).length
  const outOfStock    = products.filter(p => p.out_of_stock).length
  const totalItems    = products.reduce((sum, p) => sum + (p.stock || 0), 0)

  const hasAlert = lowStockCount > 0 || outOfStock > 0

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Package size={22} style={{ color: '#04AA6D' }} />
            Stock Management
            {hasAlert && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: '#FFEBEE', color: '#C62828' }}>
                {lowStockCount + outOfStock} সতর্কতা
              </span>
            )}
          </h1>
          <p className="page-subtitle">পণ্যের মজুদ পর্যবেক্ষণ ও আপডেট করুন</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'মোট পণ্য',    value: totalProducts, icon: Package,       color: '#1565C0', bg: '#E3F2FD' },
          { label: 'কম Stock',    value: lowStockCount,  icon: AlertTriangle, color: '#F57F17', bg: '#FFF8E1' },
          { label: 'Stock শেষ',   value: outOfStock,     icon: TrendingDown,  color: '#C62828', bg: '#FFEBEE' },
          { label: 'মোট আইটেম',  value: totalItems,     icon: TrendingUp,    color: '#2E7D32', bg: '#E8F5E9' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0"
                 style={{ backgroundColor: bg }}>
              <Icon size={16} style={{ color }} />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--c-muted)' }}>{label}</p>
              <p className="text-xl font-bold" style={{ color: 'var(--c-text)' }}>{value.toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Threshold setting */}
      <div className="card p-4 flex items-center gap-4">
        <Settings size={16} style={{ color: 'var(--c-muted)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>Low Stock সীমা:</span>
        <input
          type="number" min="0"
          className="input w-24 py-1.5 text-sm"
          value={thresholdInput}
          onChange={e => setThresholdInput(parseInt(e.target.value) || 0)}
        />
        <span className="text-xs" style={{ color: 'var(--c-muted)' }}>
          এর নিচে হলে low stock alert দেখাবে
        </span>
        <button
          onClick={saveThreshold}
          disabled={savingThreshold}
          className="btn-primary py-1.5 text-xs gap-1.5"
        >
          {savingThreshold ? <><span className="spinner h-3.5 w-3.5" /> সংরক্ষণ...</> : <><Save size={12} /> সংরক্ষণ</>}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ backgroundColor: 'var(--c-surface)' }}>
        {([
          { key: 'stock',   label: 'Stock তালিকা' },
          { key: 'history', label: 'পরিবর্তনের ইতিহাস' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2 rounded text-xs font-medium transition-all"
            style={tab === t.key
              ? { backgroundColor: 'var(--c-card)', color: '#04AA6D', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
              : { color: 'var(--c-muted)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>
      ) : tab === 'stock' ? (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ borderBottom: '1px solid var(--c-border)' }}>
              <tr>
                <th className="th text-left">SKU</th>
                <th className="th text-left">পণ্যের নাম</th>
                <th className="th text-left">বিভাগ</th>
                <th className="th text-right">বর্তমান Stock</th>
                <th className="th text-center">অবস্থা</th>
                <th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={6} className="td text-center py-12" style={{ color: 'var(--c-muted)' }}>
                    কোনো পণ্য নেই
                  </td>
                </tr>
              ) : products.map((p, i) => (
                <tr key={p.product_id}
                    style={{
                      borderTop: i > 0 ? '1px solid var(--c-border)' : 'none',
                      backgroundColor: p.out_of_stock ? 'rgba(198,40,40,0.03)' : p.low_stock ? 'rgba(245,127,23,0.03)' : 'transparent',
                    }}>
                  <td className="td font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{p.sku}</td>
                  <td className="td font-medium" style={{ color: 'var(--c-text)' }}>{p.name}</td>
                  <td className="td text-xs" style={{ color: 'var(--c-muted)' }}>{p.category || '—'}</td>
                  <td className="td text-right">
                    {editingId === p.product_id ? (
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number" min="0"
                          className="input w-20 py-1 text-sm text-right"
                          value={editQty}
                          onChange={e => setEditQty(parseInt(e.target.value) || 0)}
                          autoFocus
                        />
                        <input
                          className="input flex-1 py-1 text-xs min-w-[100px]"
                          placeholder="নোট (ঐচ্ছিক)"
                          value={editNote}
                          onChange={e => setEditNote(e.target.value)}
                        />
                      </div>
                    ) : (
                      <span className={`font-semibold text-base`}
                            style={{ color: p.out_of_stock ? '#C62828' : p.low_stock ? '#F57F17' : 'var(--c-text)' }}>
                        {p.stock}
                      </span>
                    )}
                  </td>
                  <td className="td text-center">
                    <StockBadge p={p} />
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1.5">
                      {editingId === p.product_id ? (
                        <>
                          <button
                            onClick={() => saveEdit(p.product_id)}
                            disabled={savingId === p.product_id}
                            className="p-1.5 rounded transition-colors"
                            style={{ color: '#04AA6D' }}
                            title="সংরক্ষণ"
                          >
                            {savingId === p.product_id
                              ? <span className="spinner h-3.5 w-3.5" />
                              : <Save size={14} />}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1.5 rounded transition-colors"
                            style={{ color: '#EF5350' }}
                            title="বাতিল"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEdit(p)}
                          className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                          style={{ color: 'var(--c-muted)' }}
                          title="Stock সম্পাদনা"
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* History tab */
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ borderBottom: '1px solid var(--c-border)' }}>
              <tr>
                <th className="th text-left">SKU</th>
                <th className="th text-left">পরিবর্তনের ধরন</th>
                <th className="th text-right">পরিবর্তন</th>
                <th className="th text-right">আগে</th>
                <th className="th text-right">পরে</th>
                <th className="th text-left">নোট</th>
                <th className="th text-right">তারিখ</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="td text-center py-12" style={{ color: 'var(--c-muted)' }}>
                    <Clock size={24} className="mx-auto mb-2" style={{ color: 'var(--c-border)' }} />
                    <p>কোনো ইতিহাস নেই</p>
                  </td>
                </tr>
              ) : history.map((h, i) => (
                <tr key={h.id} style={{ borderTop: i > 0 ? '1px solid var(--c-border)' : 'none' }}>
                  <td className="td font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{h.sku}</td>
                  <td className="td text-xs">{changeTypeLabel(h.change_type)}</td>
                  <td className="td text-right">
                    <span className="font-semibold"
                          style={{ color: h.quantity_change >= 0 ? '#2E7D32' : '#C62828' }}>
                      {h.quantity_change >= 0 ? '+' : ''}{h.quantity_change}
                    </span>
                  </td>
                  <td className="td text-right text-xs" style={{ color: 'var(--c-muted)' }}>
                    {h.quantity_before ?? '—'}
                  </td>
                  <td className="td text-right text-xs" style={{ color: 'var(--c-muted)' }}>
                    {h.quantity_after ?? '—'}
                  </td>
                  <td className="td text-xs max-w-[160px] truncate" style={{ color: 'var(--c-muted)' }}>
                    {h.note || h.reference_id || '—'}
                  </td>
                  <td className="td text-right text-xs" style={{ color: 'var(--c-muted)' }}>
                    {new Date(h.created_at).toLocaleDateString('bn-BD')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
