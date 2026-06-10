'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ordersAPI, discountsAPI } from '@/lib/api'
import type { Order, DiscountBreakdown } from '@/types'
import { formatBDT, formatDateTime } from '@/lib/utils'
import {
  ShoppingBag, Phone, MapPin, TrendingUp, Tag, X,
  Gift, User, Package, Truck, Hash,
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
  orderId, orderRef, onClose,
}: {
  orderId: string
  orderRef: string
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
            <p className="text-xs mt-0.5" style={{ color: '#B0BEC5' }}>{orderRef}</p>
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
              <div className="flex items-center gap-2">
                <Tag size={13} style={{ color: '#04AA6D' }} />
                <span className="font-mono text-sm font-semibold" style={{ color: '#04AA6D' }}>
                  {data.discount_code}
                </span>
              </div>
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
                      <p className="text-xs mt-0.5 capitalize" style={{ color: '#757575' }}>
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

// ─── Order Card ───────────────────────────────────────────────────────────────
function OrderCard({
  order,
  onStatusChange,
  onDiscountClick,
}: {
  order: Order
  onStatusChange: (id: string, status: string) => void
  onDiscountClick: (id: string, ref: string) => void
}) {
  const style         = STATUS_STYLES[order.status]
  const subtotal      = order.agreed_price ?? 0
  const deliveryCharge= order.delivery_charge ?? 0
  const origAmt       = order.original_amount ?? subtotal
  const netAmt        = order.net_amount ?? (subtotal + deliveryCharge)
  const discAmt       = origAmt > 0 && netAmt < (origAmt + deliveryCharge)
                        ? Math.max(0, origAmt - (netAmt - deliveryCharge))
                        : 0
  const hasDisc       = !!(order.discount_code && discAmt > 0)
  const displayRef    = order.order_ref || order.order_id.slice(0, 8).toUpperCase()

  return (
    <div className="card overflow-hidden">

      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3"
           style={{ borderBottom: '1px solid var(--c-border)', backgroundColor: 'var(--c-surface)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <Hash size={13} style={{ color: '#9E9E9E', flexShrink: 0 }} />
          <span className="font-mono text-sm font-semibold truncate" style={{ color: '#282A35' }}>
            {displayRef}
          </span>
          <span className="text-xs flex-shrink-0" style={{ color: '#9E9E9E' }}>
            {formatDateTime(order.created_at)}
          </span>
          {style && (
            <span className="badge border text-xs flex-shrink-0"
                  style={{ backgroundColor: style.bg, color: style.color, borderColor: style.border }}>
              {order.status}
            </span>
          )}
          {order.discount_code && (
            <button
              onClick={() => onDiscountClick(order.order_id, displayRef)}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-mono hover:opacity-80 transition-opacity flex-shrink-0"
              style={{ backgroundColor: '#E3F2FD', color: '#1565C0', border: '1px solid #90CAF9' }}
              title="Discount breakdown দেখুন"
            >
              <Tag size={9} />
              {order.discount_code}
            </button>
          )}
        </div>
        <select
          value={order.status}
          onChange={e => onStatusChange(order.order_id, e.target.value)}
          className="input text-sm w-auto shrink-0 py-1.5 pr-8 cursor-pointer"
        >
          {['pending','confirmed','shipped','delivered','cancelled'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="p-4 space-y-4">

        {/* ── Product list ───────────────────────────────────────────────── */}
        {order.items && order.items.length > 0 ? (
          <div className="rounded-lg overflow-hidden"
               style={{ border: '1px solid #E0E0E0' }}>
            <div className="flex items-center gap-1.5 px-3 py-2"
                 style={{ backgroundColor: '#F5F5F5', borderBottom: '1px solid #E0E0E0' }}>
              <Package size={12} style={{ color: '#757575' }} />
              <span className="text-xs font-medium" style={{ color: '#424242' }}>পণ্য তালিকা</span>
            </div>
            {order.items.map((item, idx) => (
              <div key={idx}
                   className="flex items-center justify-between px-3 py-2 text-xs"
                   style={{
                     borderBottom: idx < order.items!.length - 1 ? '1px solid #F0F0F0' : undefined,
                     backgroundColor: '#FAFAFA',
                   }}>
                <div>
                  <span className="font-medium" style={{ color: '#282A35' }}>{item.product_name}</span>
                  <span className="ml-2" style={{ color: '#9E9E9E' }}>× {item.quantity}</span>
                </div>
                <span className="font-semibold" style={{ color: '#282A35' }}>
                  ৳{item.line_total.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm"
               style={{ color: '#424242' }}>
            <span>{order.product_name}</span>
            <span className="font-medium">× {order.quantity}</span>
          </div>
        )}

        {/* ── Price breakdown ────────────────────────────────────────────── */}
        <div className="rounded-lg overflow-hidden text-xs"
             style={{ border: '1px solid #E0E0E0' }}>
          <div className="flex justify-between px-3 py-2"
               style={{ backgroundColor: '#FAFAFA', borderBottom: '1px solid #F0F0F0' }}>
            <span style={{ color: '#757575' }}>🛒 পণ্য সাবটোটাল</span>
            <span className="font-medium" style={{ color: '#282A35' }}>৳{subtotal.toLocaleString()}</span>
          </div>
          <div className="flex justify-between px-3 py-2"
               style={{ backgroundColor: '#FAFAFA', borderBottom: '1px solid #F0F0F0' }}>
            <span className="flex items-center gap-1" style={{ color: '#757575' }}>
              <Truck size={10} /> ডেলিভারি চার্জ
              {order.district && (
                <span className="ml-1 px-1.5 py-0.5 rounded text-xs"
                      style={{ backgroundColor: '#E8F5E9', color: '#2E7D32' }}>
                  {order.district}
                </span>
              )}
            </span>
            <span className="font-medium" style={{ color: '#424242' }}>
              {deliveryCharge > 0 ? `৳${deliveryCharge.toLocaleString()}` : 'ফ্রি'}
            </span>
          </div>
          {hasDisc && (
            <div className="flex justify-between px-3 py-2"
                 style={{ backgroundColor: '#FAFAFA', borderBottom: '1px solid #F0F0F0' }}>
              <span style={{ color: '#E53935' }}>🏷️ ছাড় ({order.discount_code})</span>
              <span className="font-semibold" style={{ color: '#E53935' }}>-৳{discAmt.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between px-3 py-2.5 font-bold text-sm"
               style={{ backgroundColor: hasDisc ? '#E8F5E9' : '#F5F5F5' }}>
            <span style={{ color: hasDisc ? '#1B5E20' : '#282A35' }}>💰 নেট মোট</span>
            <span style={{ color: hasDisc ? '#1B5E20' : '#282A35' }}>৳{netAmt.toLocaleString()}</span>
          </div>
        </div>

        {/* ── Customer + address ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(order.customer_name || order.customer_phone) && (
            <div className="flex items-start gap-2 p-2.5 rounded"
                 style={{ backgroundColor: '#F9F9F9', border: '1px solid #F0F0F0' }}>
              <User size={13} style={{ color: '#9E9E9E', marginTop: 1, flexShrink: 0 }} />
              <div className="min-w-0">
                {order.customer_name && (
                  <p className="text-sm font-semibold truncate" style={{ color: '#282A35' }}>
                    {order.customer_name}
                  </p>
                )}
                {order.customer_phone && (
                  <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: '#616161' }}>
                    <Phone size={9} />{order.customer_phone}
                  </p>
                )}
              </div>
            </div>
          )}
          {order.delivery_address && (
            <div className="flex items-start gap-2 p-2.5 rounded"
                 style={{ backgroundColor: '#F9F9F9', border: '1px solid #F0F0F0' }}>
              <MapPin size={13} style={{ color: '#9E9E9E', marginTop: 1, flexShrink: 0 }} />
              <div className="min-w-0">
                <p className="text-xs font-medium" style={{ color: '#424242' }}>
                  {order.delivery_address}
                </p>
                {order.district && (
                  <p className="text-xs mt-0.5 font-semibold" style={{ color: '#2E7D32' }}>
                    {order.district}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        {order.notes && (
          <div className="text-xs px-3 py-2 rounded"
               style={{ backgroundColor: '#F9F9F9', color: '#616161', border: '1px solid #E0E0E0' }}>
            {order.notes}
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const [orders, setOrders]           = useState<Order[]>([])
  const [filter, setFilter]           = useState('all')
  const [loading, setLoading]         = useState(true)
  const [discountModal, setDiscountModal] = useState<{ id: string; ref: string } | null>(null)

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

  const revenue = orders
    .filter(o => ['confirmed', 'delivered'].includes(o.status))
    .reduce((sum, o) => sum + (o.net_amount ?? o.agreed_price ?? 0), 0)

  const totalDiscount = orders
    .filter(o => ['confirmed', 'delivered'].includes(o.status))
    .reduce((sum, o) => {
      const orig = o.original_amount ?? o.agreed_price ?? 0
      const net  = o.net_amount ?? orig
      return sum + Math.max(0, orig - net)
    }, 0)

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
          {orders.map((order, idx) => (
            <div key={order.order_id} style={{ animation: `floatUp 0.3s ease-out ${idx * 40}ms both` }}>
              <OrderCard
                order={order}
                onStatusChange={updateStatus}
                onDiscountClick={(id, ref) => setDiscountModal({ id, ref })}
              />
            </div>
          ))}
        </div>
      )}

      {discountModal && (
        <DiscountModal
          orderId={discountModal.id}
          orderRef={discountModal.ref}
          onClose={() => setDiscountModal(null)}
        />
      )}
    </div>
  )
}
