'use client'
import { useEffect, useState, useMemo } from 'react'
import { X, Search, Check } from 'lucide-react'
import { productsAPI } from '@/lib/api'

export interface SelectedProduct {
  product_id: string
  sku: string
  name: string
  mrp: number
  quantity: number
}

interface RawProduct {
  product_id: string
  sku: string
  name: string
  mrp: number
  stock?: number
  category?: string
}

interface ProductPickerProps {
  open: boolean
  onClose: () => void
  onConfirm: (products: SelectedProduct[]) => void
  selected: SelectedProduct[]
}

export default function ProductPicker({ open, onClose, onConfirm, selected }: ProductPickerProps) {
  const [products, setProducts]   = useState<RawProduct[]>([])
  const [loading, setLoading]     = useState(false)
  const [search, setSearch]       = useState('')
  const [picked, setPicked]       = useState<Map<string, SelectedProduct>>(new Map())

  // Initialise picked from `selected` whenever modal opens
  useEffect(() => {
    if (!open) return
    const map = new Map<string, SelectedProduct>()
    selected.forEach(p => map.set(p.product_id, { ...p }))
    setPicked(map)
    setSearch('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load products on first open
  useEffect(() => {
    if (!open || products.length > 0) return
    setLoading(true)
    productsAPI.list()
      .then(data => setProducts(data.filter((p: RawProduct & { is_active?: boolean }) => p.is_active !== false)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return products
    return products.filter(p =>
      p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    )
  }, [products, search])

  function toggle(p: RawProduct) {
    setPicked(prev => {
      const next = new Map(prev)
      if (next.has(p.product_id)) {
        next.delete(p.product_id)
      } else {
        next.set(p.product_id, { product_id: p.product_id, sku: p.sku, name: p.name, mrp: p.mrp, quantity: 1 })
      }
      return next
    })
  }

  function setQty(product_id: string, qty: number) {
    setPicked(prev => {
      const next = new Map(prev)
      const item = next.get(product_id)
      if (item) next.set(product_id, { ...item, quantity: Math.max(1, qty) })
      return next
    })
  }

  function handleConfirm() {
    onConfirm(Array.from(picked.values()))
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl rounded-xl shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--c-card)', maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
             style={{ backgroundColor: '#282A35', borderRadius: '12px 12px 0 0' }}>
          <h2 className="font-semibold text-white text-sm">পণ্য নির্বাচন করুন</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--c-border)' }}>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }} />
            <input
              className="input pl-9"
              placeholder="SKU বা নাম দিয়ে খুঁজুন..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="spinner h-6 w-6" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: 'var(--c-muted)' }}>
              কোনো পণ্য পাওয়া যায়নি
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--c-surface)', position: 'sticky', top: 0 }}>
                <tr>
                  <th className="th w-10"></th>
                  <th className="th text-left">SKU</th>
                  <th className="th text-left">নাম</th>
                  <th className="th text-right">MRP (৳)</th>
                  <th className="th text-center w-24">পরিমাণ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const isSelected = picked.has(p.product_id)
                  const item = picked.get(p.product_id)
                  return (
                    <tr
                      key={p.product_id}
                      style={{
                        borderTop: i > 0 ? '1px solid var(--c-border)' : 'none',
                        backgroundColor: isSelected ? 'rgba(4,170,109,0.06)' : 'transparent',
                        cursor: 'pointer',
                      }}
                      onClick={() => toggle(p)}
                    >
                      <td className="td text-center">
                        <div
                          className="w-4 h-4 rounded border flex items-center justify-center mx-auto transition-colors"
                          style={{
                            backgroundColor: isSelected ? '#04AA6D' : 'transparent',
                            borderColor: isSelected ? '#04AA6D' : 'var(--c-border)',
                          }}
                        >
                          {isSelected && <Check size={10} className="text-white" />}
                        </div>
                      </td>
                      <td className="td font-mono text-xs" style={{ color: 'var(--c-muted)' }}>{p.sku}</td>
                      <td className="td font-medium" style={{ color: 'var(--c-text)' }}>{p.name}</td>
                      <td className="td text-right" style={{ color: 'var(--c-text)' }}>৳{p.mrp?.toLocaleString()}</td>
                      <td className="td text-center" onClick={e => e.stopPropagation()}>
                        {isSelected ? (
                          <input
                            type="number"
                            min="1"
                            value={item?.quantity || 1}
                            onChange={e => setQty(p.product_id, parseInt(e.target.value) || 1)}
                            className="input text-center w-16 py-1 text-xs"
                            style={{ padding: '4px 6px' }}
                          />
                        ) : (
                          <span style={{ color: 'var(--c-muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-4 flex items-center justify-between flex-shrink-0"
          style={{ borderTop: '1px solid var(--c-border)' }}
        >
          <span className="text-sm" style={{ color: 'var(--c-muted)' }}>
            {picked.size} টি পণ্য নির্বাচিত
          </span>
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary">বাতিল</button>
            <button onClick={handleConfirm} className="btn-primary gap-2">
              <Check size={14} /> নিশ্চিত করুন
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
