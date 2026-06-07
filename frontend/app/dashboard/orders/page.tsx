'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ordersAPI, discountsAPI } from '@/lib/api'
import type { Order, DiscountBreakdown } from '@/types'
import { formatBDT, formatDateTime } from '@/lib/utils'
import {
  ShoppingBag, Phone, MapPin, TrendingUp, Tag, X,
  ChevronDown, ChevronUp, Gift, User,
} from 'lucide-react'

const STATUSES = ['all', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled']

const STATUS_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  pending:   { bg: '#FFF8E1', color: '#F57F17', border: '#FFE082' },
  confirmed: { bg: '#E8F5E9', color: '#2E7D32', border: '#A5D6A7' },
  shipped:   { bg: '#E8EAF6', color: '#283593', border: '#9FA8DA' },
  delivered: { bg: '#E8F5E9', color: '#1B5E20', border: '#81C784' },
  cancelled: { bg: '#FFEBEE', color: '#B71C1C', border: '#EF9A9A' },
}

// ─── Discount Breakdown Modal ─────────────────────────────────────────────────
function DiscountModal({
  orderId, orderName, onClose,
}: {
  orderId: string
  orderName: string
  onClose: () => void
}) {
  const [data, setData]       = useState<DiscountBreakdown | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    discountsAPI.getByOrder(orderId)
      .then(setData)
      .catch(() => toast.error('Discount লোড ব্যর্থ'))
      .finally(() => setLoading(false))
  }, [orderId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4"
             style={{ backgroundColor: '#282A35' }}>
          <div>
            <h2 className="font-semibold text-white text-sm">Discount Breakdown</h2>
            <p className="text-xs mt-0.5" style={{ color: '#B0BEC5' }}>{orderName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="flex justify-center py-8"><div className="spinner h-6 w-6" /></div>
          ) : !data || !data.discount_code ? (
            <p className="text-sm text-center py-6" style={{ color: '#9E9E9E' }}>
              এই অর্ডারে কোনো discount প্রযোজ্য হয়নি
            </p>
          ) : (
            <div className="space-y-4">

              {/* Code badge */}
              <div className="flex items-center gap-2">
                <Tag size={13} style={{ color: '#04AA6D' }} />
                <span className="font-mono text-sm font-semibold" style={{ color: '#04AA6D' }}>
                  {data.discount_code}
                </span>
              </div>

              {/* Per-product rows */}
              {data.rows.map(r => (
                <div key={r.discount_id}
                     className="rounded-lg p-3 space-y-2"
                     style={{ backgroundColor: '#F9F9F9', border: '1px solid #E0E0E0' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium" style={{ color: '#282A35' }}>
                        {r.product_name || 'সব পণ্যে প্রযোজ্য'}
                      </p>
                      {r.sku && (
                        <p className="text-xs font-mono mt-0.5" style={{ color: '#9E9E9E' }}>{r.sku}</p>
                      )}
                      <p className="text-xs mt-0.5 capitalize"
                         style={{ color: '#757575' }}>
                        {r.discount_rule_name} ({r.discount_rule_type.replace(/_/g, ' ')})
                      </p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                          style={{ backgroundColor: '#E8F5E9', color: '#2E7D32' }}>
                      {r.reward_type === 'percentage' ? `${r.discount_pct}% ছাড়`
                        : r.reward_type === 'flat'     ? `৳${r.discount_flat} ছাড়`
                        : r.reward_type === 'bonus'    ? 'ফ্রি পণ্য'
                        : 'ফ্রি ডেলিভারি'}
                    </span>
                  </div>

                  {/* Bonus items */}
                  {r.reward_type === 'bonus' && r.bonus_items?.length > 0 && (
                    <div className="space-y-1">
                      {r.bonus_items.map((b, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs"
                             style={{ color: '#2E7D32' }}>
                          <Gift size={10} />
                          <span>{b.name} ×{b.quantity}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Price breakdown */}
                  {r.original_price != null && r.reward_type !== 'bonus' && (
                    <div className="grid grid-cols-3 gap-2 text-xs pt-1"
                         style={{ borderTop: '1px solid #E0E0E0' }}>
                      <div>
                        <p style={{ color: '#9E9E9E' }}>মূল মূল্য</p>
                        <p className="font-medium" style={{ color: '#424242' }}>৳{r.original_price.toLocaleString()}</p>
                      </div>
                      <div>
                        <p style={{ color: '#9E9E9E' }}>ছাড়</p>
                        <p className="font-semibold" style={{ color: '#E53935' }}>-৳{r.discount_amount.toLocaleString()}</p>
                      </div>
                      <div>
                        <p style={{ color: '#9E9E9E' }}>নেট মূল্য</p>
                        <p className="font-bold" style={{ color: '#1B5E20' }}>৳{(r.final_price ?? 0).toLocaleString()}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Total summary */}
              <div className="rounded-lg p-3"
                   style={{ backgroundColor: '#E8F5E9', border: '1px solid #A5D6A7' }}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: '#4CAF50' }}>মূল মোট</span>
                  <span style={{ color: '#282A35' }}>৳{(data.original_amount ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs mb-2">
                  <span style={{ color: '#E53935' }}>মোট ছাড়</span>
                  <span className="font-semibold" style={{ color: '#E53935' }}>-৳{data.total_discount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm font-bold"
                     style={{ borderTop: '1px solid #A5D6A7', paddingTop: '8px' }}>
                  <span style={{ color: '#1B5E20' }}>নেট পেমেন্ট</span>
                  <span style={{ color: '#1B5E20' }}>৳{(data.net_amount ?? 0).toLocaleString()}</span>
                </div>
              </div>

            </div>
          )}
        </div>

        <div className="px-5 py-3 flex justify-end"
             style={{ borderTop: '1px solid #E0E0E0' }}>
          <button onClick={onClose} className="btn-secondary text-sm">বন্ধ করুন</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const [orders, setOrders]           = useState<Order[]>([])
  const [filter, setFilter]           = useState('all')
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState<string | null>(null)
  const [discountModal, setDiscountModal] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => { loadOrders() }, [filter])

  async function loadOrders() {
    setLoading(true)
    try { setOrders(await ordersAPI.list(filter === 'all' ? undefined : filter)) }
    catch { toast.error('Orders লোড হয়নি') }
    finally { setLoading(false) }
  }

  async function updateStatus(id: string, status: string) {
    try {
      await ordersAPI.updateStatus(id, status)
      toast.success('Status আপডেট হয়েছে!')
      loadOrders()
    } catch { toast.error('আপডেট ব্যর্থ') }
  }

  // Revenue uses net_amount if available, fallback to agreed_price
  const revenue = orders
    .filter(o => ['confirmed', 'delivered'].includes(o.status))
    .reduce((sum, o) => sum + (o.net_amount ?? o.agreed_price ?? 0), 0)

  const totalDiscount = orders
    .filter(o => ['confirmed', 'delivered'].includes(o.status))
    .reduce((sum, o) => {
      const orig = o.original_amount ?? o.agreed_price ?? 0
      const net  = o.net_amount ?? orig
      return sum + (orig - net)
    }, 0)

  function toggleExpand(id: string) {
    setExpanded(prev => prev === id ? null : id)
  }

  return (
    <div className="space-y-5 max-w-5xl">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="page-subtitle">{orders.length} টি order</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {revenue > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded"
                 style={{ backgroundColor: '#E8F5E9', border: '1px solid #A5D6A7' }}>
              <TrendingUp size={15} style={{ color: '#2E7D32' }} />
              <span className="text-sm font-semibold" style={{ color: '#1B5E20' }}>{formatBDT(revenue)}</span>
              <span className="text-xs" style={{ color: '#4CAF50' }}>নেট রেভিনিউ</span>
            </div>
          )}
          {totalDiscount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded"
                 style={{ backgroundColor: '#FFF8E1', border: '1px solid #FFE082' }}>
              <Tag size={14} style={{ color: '#F57F17' }} />
              <span className="text-sm font-semibold" style={{ color: '#E65100' }}>{formatBDT(totalDiscount)}</span>
              <span className="text-xs" style={{ color: '#FB8C00' }}>মোট ছাড়</span>
            </div>
          )}
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className="flex-shrink-0 px-3.5 py-2 rounded-lg text-sm font-medium capitalize transition-all duration-200 tap-target"
            style={filter === s
              ? { backgroundColor: '#04AA6D', color: '#FFFFFF', boxShadow: '0 2px 8px rgba(4,170,109,0.3)', transform: 'scale(1.03)' }
              : { backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }
            }
          >
            {s === 'all' ? 'সব' : s}
          </button>
        ))}
      </div>

      {/* Orders list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="spinner h-8 w-8" />
        </div>
      ) : orders.length === 0 ? (
        <div className="card p-14">
          <div className="empty-state">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center empty-icon"
                 style={{ backgroundColor: 'var(--c-surface)', border: '2px dashed var(--c-border)' }}>
              <ShoppingBag size={24} style={{ color: 'var(--c-muted)' }} />
            </div>
            <p className="font-medium" style={{ color: '#616161' }}>কোনো order নেই</p>
            <p className="text-sm" style={{ color: '#9E9E9E' }}>AI function calling দিয়ে orders স্বয়ংক্রিয়ভাবে তৈরি হয়</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order, idx) => {
            const style    = STATUS_STYLES[order.status]
            const isOpen   = expanded === order.order_id
            const origAmt  = order.original_amount ?? order.agreed_price
            const netAmt   = order.net_amount ?? order.agreed_price
            const hasDisc  = !!(order.discount_code && origAmt && netAmt && origAmt > netAmt)
            const discAmt  = hasDisc ? (origAmt! - netAmt!) : 0

            return (
              <div key={order.order_id}
                   className="card overflow-hidden"
                   style={{ animation: `floatUp 0.3s ease-out ${idx * 40}ms both` }}>

                {/* Main row */}
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">

                      {/* Title + status */}
                      <div className="flex items-center gap-2.5 mb-3 flex-wrap">
                        <h3 className="font-semibold" style={{ color: '#282A35' }}>{order.product_name}</h3>
                        {style && (
                          <span className="badge border text-xs"
                                style={{ backgroundColor: style.bg, color: style.color, borderColor: style.border }}>
                            {order.status}
                          </span>
                        )}
                        {order.discount_code && (
                          <button
                            onClick={() => setDiscountModal({ id: order.order_id, name: order.product_name })}
                            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-mono hover:opacity-80 transition-opacity"
                            style={{ backgroundColor: '#E3F2FD', color: '#1565C0', border: '1px solid #90CAF9' }}
                            title="Discount breakdown দেখুন"
                          >
                            <Tag size={9} />
                            {order.discount_code}
                          </button>
                        )}
                      </div>

                      {/* Metrics grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-2.5 rounded" style={{ backgroundColor: '#F9F9F9' }}>
                          <p className="text-xs mb-0.5" style={{ color: '#9E9E9E' }}>পরিমাণ</p>
                          <p className="text-sm font-semibold" style={{ color: '#282A35' }}>{order.quantity} টি</p>
                        </div>

                        {/* Price: show net if discounted, else agreed */}
                        {(netAmt != null || order.agreed_price != null) && (
                          <div className="p-2.5 rounded" style={{ backgroundColor: hasDisc ? '#E8F5E9' : '#F9F9F9' }}>
                            <p className="text-xs mb-0.5" style={{ color: hasDisc ? '#4CAF50' : '#9E9E9E' }}>
                              {hasDisc ? 'নেট মূল্য' : 'মূল্য'}
                            </p>
                            {hasDisc && origAmt != null && (
                              <p className="text-xs line-through" style={{ color: '#9E9E9E' }}>
                                ৳{origAmt.toLocaleString()}
                              </p>
                            )}
                            <p className="text-sm font-bold" style={{ color: hasDisc ? '#1B5E20' : '#282A35' }}>
                              {formatBDT(netAmt ?? order.agreed_price ?? 0)}
                            </p>
                            {hasDisc && (
                              <p className="text-xs font-medium" style={{ color: '#E53935' }}>
                                -৳{discAmt.toFixed(2)}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Customer info: name + phone stacked */}
                        {(order.customer_name || order.customer_phone) && (
                          <div className="p-2.5 rounded" style={{ backgroundColor: '#F9F9F9' }}>
                            <p className="text-xs mb-0.5 flex items-center gap-1" style={{ color: '#9E9E9E' }}>
                              <User size={10} /> কাস্টমার
                            </p>
                            {order.customer_name && (
                              <p className="text-sm font-semibold" style={{ color: '#282A35' }}>{order.customer_name}</p>
                            )}
                            {order.customer_phone && (
                              <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: '#616161' }}>
                                <Phone size={9} />{order.customer_phone}
                              </p>
                            )}
                          </div>
                        )}

                        {order.delivery_address && (
                          <div className="p-2.5 rounded" style={{ backgroundColor: '#F9F9F9' }}>
                            <p className="text-xs mb-0.5 flex items-center gap-1" style={{ color: '#9E9E9E' }}>
                              <MapPin size={10} /> ঠিকানা
                            </p>
                            <p className="text-xs font-medium truncate" style={{ color: '#424242' }}>{order.delivery_address}</p>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-3 flex-wrap">
                        <p className="text-xs" style={{ color: '#9E9E9E' }}>{formatDateTime(order.created_at)}</p>
                        {/* Expand toggle for notes */}
                        {order.notes && (
                          <button
                            onClick={() => toggleExpand(order.order_id)}
                            className="flex items-center gap-0.5 text-xs"
                            style={{ color: '#757575' }}
                          >
                            {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            নোট
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Status dropdown */}
                    <select
                      value={order.status}
                      onChange={e => updateStatus(order.order_id, e.target.value)}
                      className="input text-sm w-auto shrink-0 py-1.5 pr-8 cursor-pointer"
                    >
                      {['pending','confirmed','shipped','delivered','cancelled'].map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Expandable notes */}
                {isOpen && order.notes && (
                  <div className="px-4 pb-4 pt-0">
                    <div className="text-xs px-3 py-2 rounded"
                         style={{ backgroundColor: '#F9F9F9', color: '#616161', border: '1px solid #E0E0E0' }}>
                      {order.notes}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Discount breakdown modal */}
      {discountModal && (
        <DiscountModal
          orderId={discountModal.id}
          orderName={discountModal.name}
          onClose={() => setDiscountModal(null)}
        />
      )}
    </div>
  )
}
