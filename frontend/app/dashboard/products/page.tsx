'use client'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { productsAPI, uploadAPI } from '@/lib/api'
import ProductImageManager from '@/components/ui/ProductImageManager'
import { formatBDT, formatDate } from '@/lib/utils'
import type {
  Product,
  ProductCustomColumn,
  CSVImportResult,
  CSVImportLog,
  CSVImportType,
} from '@/types'
import {
  Plus, Edit2, Trash2, Package, Search,
  Upload, Download, ChevronDown, X, AlertTriangle,
  CheckCircle, Columns, Loader2, FileText, Clock, ImagePlus, Image,
} from 'lucide-react'
import CsvGuide from '@/components/ui/CsvGuide'

const IMPORT_TYPE_LABELS: Record<CSVImportType, string> = {
  products: 'Products (Full Import)',
  stock:    'Stock Update',
}

export default function ProductsPage() {
  const [products,      setProducts]      = useState<Product[]>([])
  const [customColumns, setCustomColumns] = useState<ProductCustomColumn[]>([])
  const [importHistory, setImportHistory] = useState<CSVImportLog[]>([])
  const [loading,       setLoading]       = useState(true)

  const [showForm,         setShowForm]         = useState(false)
  const [showColsModal,    setShowColsModal]    = useState(false)
  const [showImportModal,  setShowImportModal]  = useState(false)
  const [showTemplateMenu, setShowTemplateMenu] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)

  const [editing, setEditing] = useState<Product | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [form, setForm] = useState({
    sku: '', name: '', mrp: '', category: '', image_url: '',
  })
  const [uploadingImg, setUploadingImg] = useState(false)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const [extraFieldForm, setExtraFieldForm] = useState<Record<string, string>>({})

  const [importType,   setImportType]   = useState<CSVImportType>('products')
  const [importing,    setImporting]    = useState(false)
  const [importResult, setImportResult] = useState<CSVImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [colForm, setColForm] = useState({
    column_name: '', display_name: '', column_type: 'text', is_required: false,
  })
  const [savingCol, setSavingCol] = useState(false)

  const [imageManagerProduct, setImageManagerProduct] = useState<{ id: string; name: string } | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [prodsRes, colsRes, histRes] = await Promise.allSettled([
        productsAPI.list(),
        productsAPI.customColumns.list(),
        productsAPI.importHistory(),
      ])
      if (prodsRes.status === 'fulfilled') {
        setProducts(prodsRes.value)
      } else {
        const detail = (prodsRes.reason as { response?: { data?: { detail?: string } } })
          ?.response?.data?.detail
        toast.error('Products লোড হয়নি: ' + (detail || 'Backend connection error'))
      }
      if (colsRes.status === 'fulfilled') setCustomColumns(colsRes.value)
      if (histRes.status === 'fulfilled') setImportHistory(histRes.value)
    } catch {
      toast.error('ডেটা লোড করা যায়নি')
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditing(null)
    setForm({ sku: '', name: '', mrp: '', category: '', image_url: '' })
    setExtraFieldForm({})
    setShowForm(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setForm({
      sku:           p.sku,
      name:          p.name,
      mrp:           String(p.mrp),
      category:      p.category   ?? '',
      image_url:     p.image_url  ?? '',
    })
    const extra: Record<string, string> = {}
    for (const col of customColumns) {
      const val = p.extra_fields?.[col.column_name]
      extra[col.column_name] = val != null ? String(val) : ''
    }
    setExtraFieldForm(extra)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const extra: Record<string, unknown> = {}
      for (const col of customColumns) {
        const val = extraFieldForm[col.column_name]
        if (val) {
          extra[col.column_name] = col.column_type === 'number' ? Number(val) : val
        }
      }

      const data: Record<string, unknown> = {
        sku:      form.sku,
        name:     form.name,
        mrp:      parseFloat(form.mrp),
        category: form.category || null,
        image_url: form.image_url || null,
      }
      if (Object.keys(extra).length > 0) data.extra_fields = extra

      if (editing) {
        await productsAPI.update(editing.product_id, data)
        toast.success('Product আপডেট হয়েছে!')
      } else {
        await productsAPI.create(data)
        toast.success('Product যোগ হয়েছে!')
      }
      setShowForm(false)
      loadAll()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'সমস্যা হয়েছে')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('এই product delete করবেন?')) return
    try {
      await productsAPI.delete(id)
      toast.success('Product মুছে গেছে')
      loadAll()
    } catch {
      toast.error('মুছতে পারেনি')
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImg(true)
    try {
      const result = await uploadAPI.productImage(file)
      setForm(f => ({ ...f, image_url: result.image_url }))
      toast.success('ছবি আপলোড হয়েছে!')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'ছবি আপলোড ব্যর্থ হয়েছে')
    } finally {
      setUploadingImg(false)
      if (imgInputRef.current) imgInputRef.current.value = ''
    }
  }

  function openImport(type: CSVImportType) {
    setImportType(type)
    setImportResult(null)
    setShowImportModal(true)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const result = await productsAPI.importCSV(file, importType)
      setImportResult(result)
      if (result.imported > 0) {
        toast.success(`✅ ${result.imported} rows imported!`)
        loadAll()
      } else {
        toast.error('No rows were imported — check warnings')
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDownloadTemplate(type: CSVImportType) {
    setShowTemplateMenu(false)
    try {
      await productsAPI.downloadTemplate(type)
      toast.success(`${IMPORT_TYPE_LABELS[type]} template downloaded!`)
    } catch {
      toast.error('Template download failed')
    }
  }

  async function handleAddColumn(e: React.FormEvent) {
    e.preventDefault()
    if (!colForm.column_name || !colForm.display_name) return
    setSavingCol(true)
    try {
      await productsAPI.customColumns.create(colForm)
      toast.success(`Column '${colForm.display_name}' added!`)
      setColForm({ column_name: '', display_name: '', column_type: 'text', is_required: false })
      const cols = await productsAPI.customColumns.list()
      setCustomColumns(cols)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(msg || 'Column যোগ করা যায়নি')
    } finally {
      setSavingCol(false)
    }
  }

  async function handleDeleteColumn(columnName: string, displayName: string) {
    if (!confirm(`"${displayName}" column মুছে ফেলবেন?`)) return
    try {
      await productsAPI.customColumns.delete(columnName)
      toast.success(`Column '${displayName}' removed`)
      const cols = await productsAPI.customColumns.list()
      setCustomColumns(cols)
    } catch {
      toast.error('Column মুছা যায়নি')
    }
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    (p.category?.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <>
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="page-subtitle">{products.length} টি পণ্য</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">

          {/* Template download */}
          <div className="relative">
            <button
              onClick={() => setShowTemplateMenu(v => !v)}
              className="btn-secondary flex items-center gap-1.5 text-sm"
            >
              <Download size={15} /> Template <ChevronDown size={13} />
            </button>
            {showTemplateMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowTemplateMenu(false)} />
                <div className="absolute right-0 top-10 z-40 bg-white border border-slate-200 rounded-lg shadow-lg w-52 overflow-hidden">
                  {(['products', 'stock'] as CSVImportType[]).map(type => (
                    <button
                      key={type}
                      onClick={() => handleDownloadTemplate(type)}
                      className="w-full px-4 py-2.5 text-sm text-left hover:bg-slate-50 flex items-center gap-2"
                    >
                      <FileText size={14} className="text-slate-400" />
                      {IMPORT_TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Import CSV */}
          <div className="relative group">
            <button className="btn-secondary flex items-center gap-1.5 text-sm">
              <Upload size={15} /> Import CSV <ChevronDown size={13} />
            </button>
            <div className="absolute right-0 top-9 z-40 bg-white border border-slate-200 rounded-lg shadow-lg w-52 overflow-hidden hidden group-hover:block">
              {(['products', 'stock'] as CSVImportType[]).map(type => (
                <button
                  key={type}
                  onClick={() => openImport(type)}
                  className="w-full px-4 py-2.5 text-sm text-left hover:bg-slate-50 flex items-center gap-2"
                >
                  <Upload size={14} className="text-slate-400" />
                  {IMPORT_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setShowColsModal(true)}
            className="btn-secondary flex items-center gap-1.5 text-sm"
          >
            <Columns size={15} /> Custom Columns
          </button>

          <button
            onClick={() => setShowHistoryModal(true)}
            className="btn-secondary flex items-center gap-1.5 text-sm"
            title="Import history"
          >
            <Clock size={15} />
          </button>

          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> নতুন Product
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="SKU, নাম বা category খুঁজুন..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Product table */}
      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center"><div className="spinner h-8 w-8 mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Package size={40} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">কোনো product নেই</p>
            <button onClick={openCreate} className="mt-3 text-blue-600 text-sm hover:underline">
              প্রথম product যোগ করুন →
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="th" style={{ width: 48 }}></th>
                <th className="th whitespace-nowrap">SKU</th>
                <th className="th">পণ্য</th>
                <th className="th whitespace-nowrap">MRP</th>
                <th className="th">Stock</th>
                <th className="th">Category</th>
                {customColumns.map(col => (
                  <th key={col.column_name} className="text-left px-4 py-3 text-xs font-semibold text-purple-600 uppercase whitespace-nowrap">
                    {col.display_name}
                  </th>
                ))}
                <th className="th">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(p => (
                <tr key={p.product_id} className="hover:bg-slate-50 transition-colors">
                  <td className="td pl-3 pr-1">
                    <div className="relative inline-block">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name}
                             className="w-9 h-9 object-cover rounded-lg border border-slate-200 flex-shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                             style={{ backgroundColor: '#F5F5F5' }}>
                          <Package size={14} style={{ color: '#BDBDBD' }} />
                        </div>
                      )}
                      {(p.image_count ?? 0) > 0 && (
                        <span
                          className="absolute -bottom-1 -right-1 text-white text-[9px] font-bold rounded-full leading-none flex items-center justify-center"
                          style={{ backgroundColor: '#7B1FA2', minWidth: 16, height: 16, padding: '0 3px' }}
                        >
                          {p.image_count}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono">{p.sku}</code>
                  </td>
                  <td className="td">
                    <p className="font-medium text-slate-900 max-w-[200px] truncate">{p.name}</p>
                  </td>
                  <td className="td whitespace-nowrap">
                    <p className="font-semibold text-slate-900">{formatBDT(p.mrp)}</p>
                  </td>
                  <td className="td text-slate-600">
                    <span className={p.current_stock === 0 ? 'text-red-500 font-medium' : p.current_stock <= 10 ? 'text-amber-600 font-medium' : ''}>
                      {p.current_stock}
                    </span>
                  </td>
                  <td className="td">
                    {p.category ? (
                      <span className="badge bg-primary-50 text-primary-700 border border-primary-100">{p.category}</span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  {customColumns.map(col => (
                    <td key={col.column_name} className="td text-slate-600 text-xs">
                      {p.extra_fields?.[col.column_name] != null
                        ? String(p.extra_fields[col.column_name])
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                  ))}
                  <td className="td">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setImageManagerProduct({ id: p.product_id, name: p.name })}
                        className="flex items-center gap-1 px-1.5 py-1 rounded-lg transition-colors text-xs font-medium"
                        style={{ color: '#7B1FA2' }}
                        title="ছবি আপলোড ও পরিচালনা"
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F3E5F5')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <Image size={14} />
                        {(p.image_count ?? 0) > 0
                          ? <span>{p.image_count} টি ছবি</span>
                          : <span>ছবি</span>
                        }
                      </button>
                      <button onClick={() => openEdit(p)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors hover:text-primary-600">
                        <Edit2 size={15} />
                      </button>
                      <button onClick={() => handleDelete(p.product_id)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>


      {/* ── MODAL: Create / Edit Product ─────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-lg my-4 shadow-xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">{editing ? 'Product Edit' : 'নতুন Product'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-ghost p-1.5"><X size={17} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">

              {/* SKU + Name */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                    SKU <span className="text-red-500">*</span>
                  </label>
                  <input
                    required className="input font-mono text-sm"
                    placeholder="SKU001"
                    value={form.sku}
                    onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                    পণ্যের নাম <span className="text-red-500">*</span>
                  </label>
                  <input
                    required className="input"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
              </div>

              {/* MRP + Category */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                    MRP (৳) <span className="text-red-500">*</span>
                  </label>
                  <input
                    required type="number" min="0.01" step="0.01" className="input"
                    placeholder="500"
                    value={form.mrp}
                    onChange={e => setForm(f => ({ ...f, mrp: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">Category</label>
                  <input
                    className="input"
                    placeholder="Electronics, শাড়ি…"
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  />
                </div>
              </div>

              {/* Image upload */}
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1.5 block">পণ্যের ছবি</label>
                <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                <div className="flex gap-2 items-start">
                  {form.image_url ? (
                    <img src={form.image_url} alt="preview"
                         className="w-14 h-14 object-cover rounded-lg border border-slate-200 flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0"
                         style={{ backgroundColor: '#F5F5F5', border: '1px dashed #BDBDBD' }}>
                      <ImagePlus size={18} style={{ color: '#BDBDBD' }} />
                    </div>
                  )}
                  <div className="flex-1 space-y-2">
                    <button
                      type="button"
                      onClick={() => imgInputRef.current?.click()}
                      disabled={uploadingImg}
                      className="btn-secondary text-sm gap-1.5 w-full"
                    >
                      {uploadingImg
                        ? <><span className="spinner h-3.5 w-3.5" /> আপলোড হচ্ছে...</>
                        : <><Upload size={13} /> ছবি আপলোড</>}
                    </button>
                    <input
                      type="url" className="input text-sm"
                      placeholder="অথবা URL সরাসরি লিখুন..."
                      value={form.image_url}
                      onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {/* Custom columns */}
              {customColumns.length > 0 && (
                <div className="border-t pt-4">
                  <p className="text-xs font-semibold text-purple-700 uppercase mb-3">Custom Fields</p>
                  <div className="space-y-3">
                    {customColumns.map(col => (
                      <div key={col.column_name}>
                        <label className="text-sm font-medium text-slate-700 mb-1.5 block">
                          {col.display_name}
                          {col.is_required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        <input
                          type={col.column_type === 'number' ? 'number' : col.column_type === 'url' ? 'url' : 'text'}
                          className="input text-sm"
                          required={col.is_required}
                          value={extraFieldForm[col.column_name] ?? ''}
                          onChange={e => setExtraFieldForm(prev => ({ ...prev, [col.column_name]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">বাতিল</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  {saving && <Loader2 size={15} className="animate-spin" />}
                  {saving ? 'সংরক্ষণ...' : editing ? 'আপডেট করুন' : 'যোগ করুন'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* ── MODAL: CSV Import ─────────────────────────────────────────────── */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">CSV Import</h2>
                <p className="text-sm text-slate-500">{IMPORT_TYPE_LABELS[importType]}</p>
              </div>
              <button onClick={() => { setShowImportModal(false); setImportResult(null) }} className="btn-ghost p-1.5">
                <X size={17} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">Import Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['products', 'stock'] as CSVImportType[]).map(type => (
                    <button
                      key={type}
                      onClick={() => { setImportType(type); setImportResult(null) }}
                      className={`p-2.5 text-xs font-medium rounded-lg border text-center transition-colors ${
                        importType === type
                          ? 'border-primary-600 bg-primary-50 text-primary-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {IMPORT_TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
              </div>

              <CsvGuide type={importType} defaultOpen />

              {importResult && (
                <div className={`rounded-lg p-4 ${
                  importResult.errors > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'
                }`}>
                  <div className="flex items-center gap-2 mb-3">
                    {importResult.errors > 0
                      ? <AlertTriangle size={16} className="text-amber-600" />
                      : <CheckCircle size={16} className="text-green-600" />
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
                  <p className="text-xs text-center text-slate-500 mb-2">Total: {importResult.total_rows} rows</p>
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

              <div>
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="w-full border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-xl p-6 text-center transition-colors flex flex-col items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing ? (
                    <><Loader2 size={24} className="text-blue-500 animate-spin" /><p className="text-sm font-medium text-slate-700">Importing…</p></>
                  ) : (
                    <><Upload size={24} className="text-slate-400" /><p className="text-sm font-medium text-slate-700">Click to choose CSV file</p><p className="text-xs text-slate-400">Max 5 MB · UTF-8 or Excel CSV</p></>
                  )}
                </button>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 border-t pt-3">
                <span>Need a template?</span>
                <button
                  onClick={() => handleDownloadTemplate(importType)}
                  className="flex items-center gap-1 hover:underline" style={{ color: '#04AA6D' }}
                >
                  <Download size={12} /> Download {IMPORT_TYPE_LABELS[importType]} template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ── MODAL: Custom Columns ─────────────────────────────────────────── */}
      {showColsModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Custom Product Columns</h2>
                <p className="text-xs text-slate-500">Values stored in extra_fields JSONB · appear in table & CSV templates</p>
              </div>
              <button onClick={() => setShowColsModal(false)} className="btn-ghost p-1.5"><X size={17} /></button>
            </div>
            <div className="p-6 space-y-5">
              {customColumns.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">কোনো custom column নেই</p>
              ) : (
                <div className="space-y-2">
                  {customColumns.map(col => (
                    <div key={col.column_name} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{col.display_name}</p>
                        <p className="text-xs text-slate-400">
                          key: <code className="bg-slate-200 px-1 rounded font-mono">{col.column_name}</code>
                          {' · '}{col.column_type}
                          {col.is_required && ' · required'}
                        </p>
                      </div>
                      <button onClick={() => handleDeleteColumn(col.column_name, col.display_name)}
                              className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-3">নতুন Column যোগ করুন</p>
                <form onSubmit={handleAddColumn} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1.5 block">Column Key <span className="text-red-500">*</span></label>
                      <input required className="input text-sm font-mono" placeholder="color"
                             pattern="^[a-z][a-z0-9_]*$" title="lowercase letters, numbers, underscores only"
                             value={colForm.column_name}
                             onChange={e => setColForm(f => ({ ...f, column_name: e.target.value.toLowerCase() }))} />
                      <p className="text-xs text-slate-400 mt-0.5">snake_case only</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1.5 block">Display Name <span className="text-red-500">*</span></label>
                      <input required className="input text-sm" placeholder="Color"
                             value={colForm.display_name}
                             onChange={e => setColForm(f => ({ ...f, display_name: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1.5 block">Type</label>
                      <select className="input text-sm" value={colForm.column_type}
                              onChange={e => setColForm(f => ({ ...f, column_type: e.target.value }))}>
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="url">URL</option>
                      </select>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={colForm.is_required}
                               onChange={e => setColForm(f => ({ ...f, is_required: e.target.checked }))}
                               className="w-4 h-4 text-blue-600 rounded" />
                        Required field
                      </label>
                    </div>
                  </div>
                  <button type="submit" disabled={savingCol}
                          className="btn-primary w-full flex items-center justify-center gap-2">
                    {savingCol && <Loader2 size={14} className="animate-spin" />}
                    Column যোগ করুন
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ── MODAL: Import History ─────────────────────────────────────────── */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">CSV Import History</h2>
              <button onClick={() => setShowHistoryModal(false)} className="btn-ghost p-1.5"><X size={17} /></button>
            </div>
            <div className="p-4 divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
              {importHistory.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">কোনো import history নেই</p>
              ) : importHistory.map(log => (
                <div key={log.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{log.filename || 'Unnamed file'}</p>
                    <p className="text-xs text-slate-400">
                      {IMPORT_TYPE_LABELS[log.import_type as CSVImportType] ?? log.import_type} · {formatDate(log.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span className="text-green-700 font-semibold">{log.imported} ✓</span>
                    <span className="text-amber-600">{log.skipped} skip</span>
                    {log.errors > 0 && <span className="text-red-600">{log.errors} err</span>}
                    <span className="text-slate-400">{log.total_rows} rows</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>

    {/* Product Image Manager */}
    {imageManagerProduct && (
      <ProductImageManager
        productId={imageManagerProduct.id}
        productName={imageManagerProduct.name}
        onClose={() => setImageManagerProduct(null)}
      />
    )}
    </>
  )
}
