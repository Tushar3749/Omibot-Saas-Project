'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ordersAPI } from '@/lib/api'
import type { Order } from '@/types'
import { formatBDT, formatDateTime, getStatusColor } from '@/lib/utils'
import { ShoppingBag, Phone, MapPin, TrendingUp } from 'lucide-react'

const STATUSES = ['all', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled']

const STATUS_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  pending:   { bg: '#FFF8E1', color: '#F57F17', border: '#FFE082' },
  confirmed: { bg: '#E8F5E9', color: '#2E7D32', border: '#A5D6A7' },
  shipped:   { bg: '#E8EAF6', color: '#283593', border: '#9FA8DA' },
  delivered: { bg: '#E8F5E9', color: '#1B5E20', border: '#81C784' },
  cancelled: { bg: '#FFEBEE', color: '#B71C1C', border: '#EF9A9A' },
}

export default function OrdersPage() {
  const [orders, setOrders]   = useState<Order[]>([])
  const [filter, setFilter]   = useState('all')
  const [loading, setLoading] = useState(true)

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
    .reduce((sum, o) => sum + (o.agreed_price || 0), 0)

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="page-subtitle">{orders.length} টি order</p>
        </div>
        {revenue > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded"
               style={{ backgroundColor: '#E8F5E9', border: '1px solid #A5D6A7' }}>
            <TrendingUp size={15} style={{ color: '#2E7D32' }} />
            <span className="text-sm font-semibold" style={{ color: '#1B5E20' }}>{formatBDT(revenue)}</span>
            <span className="text-xs" style={{ color: '#4CAF50' }}>revenue</span>
          </div>
        )}
      </div>

      {/* ── Status filter tabs ────────────────────────────────────────────── */}
      <div className="flex gap-1.5 flex-wrap">
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className="px-3.5 py-1.5 rounded text-sm font-medium capitalize transition-all duration-150"
            style={filter === s
              ? { backgroundColor: '#04AA6D', color: '#FFFFFF' }
              : { backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', color: '#424242' }
            }
          >
            {s === 'all' ? 'সব' : s}
          </button>
        ))}
      </div>

      {/* ── Orders list ───────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="spinner h-8 w-8" />
        </div>
      ) : orders.length === 0 ? (
        <div className="card p-14">
          <div className="empty-state">
            <div className="w-14 h-14 rounded flex items-center justify-center"
                 style={{ backgroundColor: '#F5F5F5' }}>
              <ShoppingBag size={24} style={{ color: '#9E9E9E' }} />
            </div>
            <p className="font-medium" style={{ color: '#616161' }}>কোনো order নেই</p>
            <p className="text-sm" style={{ color: '#9E9E9E' }}>AI function calling দিয়ে orders স্বয়ংক্রিয়ভাবে তৈরি হয়</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => {
            const style = STATUS_STYLES[order.status]
            return (
              <div key={order.order_id} className="card p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-3 flex-wrap">
                      <h3 className="font-semibold" style={{ color: '#282A35' }}>{order.product_name}</h3>
                      {style ? (
                        <span className="badge border text-xs"
                              style={{ backgroundColor: style.bg, color: style.color, borderColor: style.border }}>
                          {order.status}
                        </span>
                      ) : (
                        <span className={`badge border ${getStatusColor(order.status)}`}>{order.status}</span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-2.5 rounded" style={{ backgroundColor: '#F9F9F9' }}>
                        <p className="text-xs mb-0.5" style={{ color: '#9E9E9E' }}>পরিমাণ</p>
                        <p className="text-sm font-semibold" style={{ color: '#282A35' }}>{order.quantity} টি</p>
                      </div>
                      {order.agreed_price && (
                        <div className="p-2.5 rounded" style={{ backgroundColor: '#E8F5E9' }}>
                          <p className="text-xs mb-0.5" style={{ color: '#4CAF50' }}>মূল্য</p>
                          <p className="text-sm font-bold" style={{ color: '#1B5E20' }}>{formatBDT(order.agreed_price)}</p>
                        </div>
                      )}
                      {order.customer_phone && (
                        <div className="p-2.5 rounded" style={{ backgroundColor: '#F9F9F9' }}>
                          <p className="text-xs mb-0.5 flex items-center gap-1" style={{ color: '#9E9E9E' }}>
                            <Phone size={10} /> Phone
                          </p>
                          <p className="text-sm font-medium" style={{ color: '#424242' }}>{order.customer_phone}</p>
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

                    <p className="text-xs mt-3" style={{ color: '#9E9E9E' }}>{formatDateTime(order.created_at)}</p>
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
            )
          })}
        </div>
      )}
    </div>
  )
}
