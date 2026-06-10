'use client'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { stockAPI } from '@/lib/api'
import {
  Package, AlertTriangle, Edit2, Save, X, Clock,
  TrendingDown, TrendingUp, Settings, Upload, CheckCircle,
  Loader2, Download, BarChart2, Search,
} from 'lucide-react'
import CsvGuide from '@/components/ui/CsvGuide'

// ─── Types ────────────────────────────────────────────────────────────────────
interface StockProduct {
  product_id:     string
  sku:            string
  name:           string
  category:       string | null
  stock:          number
  physical_stock: number
  issued_stock:   number
  available:      number
  mrp:            number
  is_active:      boolean
  low_stock:      boolean
  out_of_stock:   boolean
}

interface StockHistory {
  id:              string
  product_id:      string | null
  sku:             string
  change_type:     string
  quantity_change: number
  quantity_before: number | null
  quantity_after:  number | null
  reference_id:    string | null
  note:            string | null
  created_at:      string
}

interface StockReportRow {
  product_id:    string
  product_name:  string
  sku:           string
  orders_count:  number
  qty_issued:    number
  qty_shipped:   number
  qty_returns:   number
  opening_stock: number | null
  closing_stock: number | null
}

type Tab = 'stock' | 'history' | 'report'

interface CSVImportResult {
  imported:   number
  skipped:    number
  errors:     number
  total_rows: number
  warnings:   { row: number; message: string }[]
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function todayISO() { return new Date().toISOString().slice(0, 10) }
function offsetDays(n: number) {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10)
}
function startOfWeek() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10)
}
function startOfMonth() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`
}
function startOfYear() { return `${new Date().getFullYear()}-01-01` }

const RANGE_PRESETS = [
  { label: 'আজ',      from: () => todayISO(),    to: () => todayISO() },
  { label: 'এই সপ্তাহ', from: startOfWeek,       to: todayISO },
  { label: 'এই মাস',  from: startOfMonth,         to: todayISO },
  { label: 'এই বছর',  from: startOfYear,          to: todayISO },
]

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
    manual_add:       'ম্যানুয়াল যোগ',
    manual_remove:    'ম্যানুয়াল বাদ',
    order_placed:     'অর্ডার প্লেসড',
    order_shipped:    'অর্ডার শিপড',
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

  const [showImportModal, setShowImportModal] = useState(false)
  const [importing,       setImporting]       = useState(false)
  const [importResult,    setImportResult]    = useState<CSVImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Report state
  const [reportRows,    setReportRows]    = useState<StockReportRow[]>([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportFrom,    setReportFrom]    = useState(startOfMonth())
  const [reportTo,      setReportTo]      = useState(todayISO())
  const [reportProduct, setReportProduct] = useState('')
  const [activePreset,  setActivePreset]  = useState(2) // "এই মাস" default

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

  async function loadReport() {
    setReportLoading(true)
    try {
      const params: Record<string, string> = { from_date: reportFrom, to_date: reportTo }
      if (reportProduct) params.product_id = reportProduct
      const data = await stockAPI.report(params)
      setReportRows(data)
    } catch {
      toast.error('Report লোড করা যায়নি')
    } finally {
      setReportLoading(false)
    }
  }

  useEffect(() => { loadStock() }, [])

  useEffect(() => {
    if (tab === 'history' && history.length === 0) loadHistory()
    if (tab === 'report') loadReport()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  function applyPreset(idx: number) {
    const p = RANGE_PRESETS[idx]
    setReportFrom(p.from())
    setReportTo(p.to())
    setActivePreset(idx)
  }

  function startEdit(p: StockProduct) {
    setEditingId(p.product_id)
    setEditQty(p.physical_stock || p.stock)
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
      setProducts(ps => ps.map(p => {
        if (p.product_id !== product_id) return p
        const avail = result.stock
        return { ...p, stock: avail, available: avail,
                 low_stock: avail <= threshold && avail > 0, out_of_stock: avail === 0 }
      }))
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
      await loadStock()
      toast.success(`Low stock সীমা ${thresholdInput} এ সেট হয়েছে`)
    } catch {
      toast.error('সীমা সেট করা যায়নি')
    } finally {
      setSavingThreshold(false)
    }
  }

  async function handleStockCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const result: CSVImportResult = await stockAPI.importCSV(file)
      setImportResult(result)
      if (result.imported > 0) {
        toast.success(`✅ ${result.imported} row${result.imported > 1 ? 's' : ''} imported!`)
        await loadStock()
      } else {
        toast.error('No rows imported — check warnings below')
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'CSV import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function downloadTemplate() {
    const rows = [
      '# Stock Bulk Update Template',
      '# Required: sku, current_stock',
      '# Optional: low_stock_threshold',
      '#',
      'sku,current_stock,low_stock_threshold',
      'FMCG-001,50,10',
      'FMCG-002,30,5',
    ].join('\n')
    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'stock-bulk-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalProducts = products.length
  const lowStockCount = products.filter(p => p.low_stock && !p.out_of_stock).length
  const outOfStock    = products.filter(p => p.out_of_stock).length
  const totalItems    = products.reduce((sum, p) => sum + (p.available || p.stock || 0), 0)
  const hasAlert      = lowStockCount > 0 || outOfStock > 0

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'stock',   label: 'Stock তালিকা',       icon: <Package size={13} /> },
    { key: 'history', label: 'পরিবর্তনের ইতিহাস', icon: <Clock size={13} /> },
    { key: 'report',  label: 'Stock রিপোর্ট',      icon: <BarChart2 size={13} /> },
  ]

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
        <button
          onClick={() => { setShowImportModal(true); setImportResult(null) }}
          className="btn-secondary flex items-center gap-1.5 text-sm"
        >
          <Upload size={15} /> CSV Import
        </button>
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

      {/* Threshold */}
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
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-medium transition-all"
            style={tab === t.key
              ? { backgroundColor: 'var(--c-card)', color: '#04AA6D', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
              : { color: 'var(--c-muted)' }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="spinner h-8 w-8" /></div>
      ) : tab === 'stock' ? (

        /* ── Stock list ─────────────────────────────────────────────────────── */
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ borderBottom: '1px solid var(--c-border)' }}>
              <tr>
                <th className="th text-left">SKU</th>
                <th className="th text-left">পণ্যের নাম</th>
                <th className="th text-left">বিভাগ</th>
                <th className="th text-right">Physical</th>
                <th className="th text-right">Issued</th>
                <th className="th text-right">Available</th>
                <th className="th text-center">অবস্থা</th>
                <th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="td text-center py-12" style={{ color: 'var(--c-muted)' }}>
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
                      <span className="font-semibold text-sm" style={{ color: 'var(--c-text)' }}>
                        {p.physical_stock || '—'}
                      </span>
                    )}
                  </td>
                  <td className="td text-right text-sm" style={{ color: '#F57F17' }}>
                    {p.issued_stock || 0}
                  </td>
                  <td className="td text-right">
                    <span className="font-semibold text-base"
                          style={{ color: p.out_of_stock ? '#C62828' : p.low_stock ? '#F57F17' : '#2E7D32' }}>
                      {p.available}
                    </span>
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
                          title="Physical Stock সম্পাদনা"
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

      ) : tab === 'history' ? (

        /* ── History tab ────────────────────────────────────────────────────── */
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

      ) : (

        /* ── Report tab ─────────────────────────────────────────────────────── */
        <div className="space-y-4">
          {/* Filters */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium" style={{ color: 'var(--c-muted)' }}>দ্রুত ফিল্টার:</span>
              {RANGE_PRESETS.map((p, idx) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(idx)}
                  className="px-3 py-1 rounded text-xs font-medium transition-all"
                  style={activePreset === idx
                    ? { backgroundColor: '#04AA6D', color: '#fff' }
                    : { backgroundColor: 'var(--c-surface)', color: 'var(--c-muted)' }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs" style={{ color: 'var(--c-muted)' }}>From:</label>
                <input
                  type="date"
                  className="input py-1.5 text-sm"
                  value={reportFrom}
                  onChange={e => { setReportFrom(e.target.value); setActivePreset(-1) }}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs" style={{ color: 'var(--c-muted)' }}>To:</label>
                <input
                  type="date"
                  className="input py-1.5 text-sm"
                  value={reportTo}
                  onChange={e => { setReportTo(e.target.value); setActivePreset(-1) }}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs" style={{ color: 'var(--c-muted)' }}>পণ্য:</label>
                <select
                  className="input py-1.5 text-sm min-w-[160px]"
                  value={reportProduct}
                  onChange={e => setReportProduct(e.target.value)}
                >
                  <option value="">সব পণ্য</option>
                  {products.map(p => (
                    <option key={p.product_id} value={p.product_id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={loadReport}
                disabled={reportLoading}
                className="btn-primary py-1.5 text-xs flex items-center gap-1.5"
              >
                {reportLoading
                  ? <><Loader2 size={13} className="animate-spin" /> লোড হচ্ছে...</>
                  : <><Search size={13} /> রিপোর্ট দেখুন</>}
              </button>
            </div>
          </div>

          {/* Report table */}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead style={{ borderBottom: '1px solid var(--c-border)' }}>
                <tr>
                  <th className="th text-left">পণ্য</th>
                  <th className="th text-left">SKU</th>
                  <th className="th text-right">অর্ডার</th>
                  <th className="th text-right">জারি (Issued)</th>
                  <th className="th text-right">চালান (Shipped)</th>
                  <th className="th text-right">রিটার্ন</th>
                  <th className="th text-right">শুরুর Stock</th>
                  <th className="th text-right">শেষের Stock</th>
                </tr>
              </thead>
              <tbody>
                {reportLoading ? (
                  <tr>
                    <td colSpan={8} className="td text-center py-10">
                      <Loader2 size={22} className="mx-auto animate-spin" style={{ color: '#04AA6D' }} />
                    </td>
                  </tr>
                ) : reportRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="td text-center py-12" style={{ color: 'var(--c-muted)' }}>
                      <BarChart2 size={24} className="mx-auto mb-2" style={{ color: 'var(--c-border)' }} />
                      <p>এই সময়কালে কোনো stock movement নেই</p>
                      <p className="text-xs mt-1">ফিল্টার পরিবর্তন করে আবার চেষ্টা করুন</p>
                    </td>
                  </tr>
                ) : reportRows.map((r, i) => (
                  <tr key={r.product_id} style={{ borderTop: i > 0 ? '1px solid var(--c-border)' : 'none' }}>
                    <td className="td font-medium" style={{ color: 'var(--c-text)' }}>{r.product_name}</td>
                    <td className="td font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{r.sku}</td>
                    <td className="td text-right font-semibold" style={{ color: '#1565C0' }}>{r.orders_count}</td>
                    <td className="td text-right" style={{ color: '#F57F17' }}>{r.qty_issued}</td>
                    <td className="td text-right" style={{ color: '#C62828' }}>{r.qty_shipped}</td>
                    <td className="td text-right" style={{ color: '#2E7D32' }}>{r.qty_returns}</td>
                    <td className="td text-right text-xs" style={{ color: 'var(--c-muted)' }}>
                      {r.opening_stock ?? '—'}
                    </td>
                    <td className="td text-right text-xs font-semibold" style={{ color: 'var(--c-text)' }}>
                      {r.closing_stock ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleStockCSV}
      />

      {/* ── MODAL: CSV Import ──────────────────────────────────────────────── */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">

            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">CSV Stock Import</h2>
                <p className="text-xs text-slate-500">একসাথে অনেক পণ্যের স্টক আপডেট করুন</p>
              </div>
              <button
                onClick={() => { setShowImportModal(false); setImportResult(null) }}
                className="btn-ghost p-1.5"
              >
                <X size={17} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <CsvGuide type="stock-bulk" defaultOpen />

              {importResult && (
                <div className={`rounded-lg p-4 ${
                  importResult.errors > 0 || importResult.skipped > 0
                    ? 'bg-amber-50 border border-amber-200'
                    : 'bg-green-50 border border-green-200'
                }`}>
                  <div className="flex items-center gap-2 mb-3">
                    {importResult.errors > 0
                      ? <AlertTriangle size={16} className="text-amber-600" />
                      : <CheckCircle   size={16} className="text-green-600" />
                    }
                    <span className="font-semibold text-sm">Import Complete</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mb-3">
                    <div className="bg-white rounded-lg p-2 border border-slate-100">
                      <p className="text-xl font-bold text-emerald-700">{importResult.imported}</p>
                      <p className="text-xs text-slate-500">Imported</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 border border-slate-100">
                      <p className="text-xl font-bold text-amber-600">{importResult.skipped}</p>
                      <p className="text-xs text-slate-500">Skipped</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 border border-slate-100">
                      <p className="text-xl font-bold text-red-600">{importResult.errors}</p>
                      <p className="text-xs text-slate-500">Errors</p>
                    </div>
                  </div>
                  <p className="text-xs text-center text-slate-500 mb-2">
                    Total: {importResult.total_rows} rows
                  </p>
                  {importResult.warnings.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer font-medium text-slate-700 hover:text-slate-900">
                        Show {importResult.warnings.length} warning(s)
                      </summary>
                      <div className="mt-2 max-h-36 overflow-y-auto space-y-1">
                        {importResult.warnings.map((w, i) => (
                          <p key={i} className="text-amber-700 bg-white rounded px-2 py-1">
                            <strong>Row {w.row}:</strong> {w.message}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="w-full border-2 border-dashed border-slate-200 hover:border-green-400 rounded-xl p-6 text-center transition-colors flex flex-col items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? (
                  <>
                    <Loader2 size={24} className="text-green-500 animate-spin" />
                    <p className="text-sm font-medium text-slate-700">Importing…</p>
                  </>
                ) : (
                  <>
                    <Upload size={24} className="text-slate-400" />
                    <p className="text-sm font-medium text-slate-700">Click to choose CSV file</p>
                    <p className="text-xs text-slate-400">Max 5 MB · UTF-8 or Excel CSV</p>
                  </>
                )}
              </button>

              <div className="flex items-center justify-between text-xs text-slate-500 border-t pt-3">
                <span>টেমপ্লেট দরকার?</span>
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-1 hover:underline"
                  style={{ color: '#04AA6D' }}
                >
                  <Download size={12} /> Download Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
