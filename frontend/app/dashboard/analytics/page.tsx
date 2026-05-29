'use client'
import { useEffect, useState } from 'react'
import { analyticsAPI } from '@/lib/api'
import { formatBDT } from '@/lib/utils'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  TrendingUp, MessageSquare, ShoppingBag, Users, RefreshCw,
  ArrowUpRight, Package, Clock, Star,
} from 'lucide-react'

const CT = {
  borderRadius: 6, border: '1px solid var(--c-border)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12,
  backgroundColor: 'var(--c-card)', color: 'var(--c-text)',
}

type Period = '7d' | '30d' | '90d'
type AdvancedData = {
  period: string
  revenue_chart: { date: string; revenue: number; orders: number }[]
  top_products: { name: string; count: number; revenue: number }[]
  avg_order_value: number
  total_revenue: number
  conversion_funnel: { conversations: number; orders: number; delivered: number; conv_to_order: number; order_to_paid: number }
  peak_hours: { hour: string; count: number }[]
  new_vs_returning: { new: number; returning: number; total: number; retention_rate: number }
  popular_questions: { keyword: string; count: number }[]
}

const PIE_COLORS = ['#04AA6D', '#7B1FA2']

function KpiCard({ label, value, icon: Icon, bg, color, sub, trend }: {
  label: string; value: string; icon: React.ElementType
  bg: string; color: string; sub?: string; trend?: number
}) {
  return (
    <div className="card p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: bg }}>
          <Icon size={17} style={{ color }} />
        </div>
        {trend !== undefined && (
          <span className="text-xs font-medium flex items-center gap-0.5" style={{ color: trend >= 0 ? '#04AA6D' : '#EF5350' }}>
            <ArrowUpRight size={12} style={{ transform: trend < 0 ? 'rotate(90deg)' : undefined }} />
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold" style={{ color: 'var(--c-text)' }}>{value}</p>
      <p className="text-sm mt-1" style={{ color: 'var(--c-muted)' }}>{label}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--c-muted)' }}>{sub}</p>}
    </div>
  )
}

function FunnelStep({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span style={{ color: 'var(--c-text)' }}>{label}</span>
        <span className="font-bold" style={{ color }}>{value.toLocaleString()}</span>
      </div>
      <div className="h-2 rounded-full" style={{ backgroundColor: 'var(--c-surface)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-xs" style={{ color: 'var(--c-muted)' }}>{pct}% of total</p>
    </div>
  )
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null)
  const [advanced, setAdvanced] = useState<AdvancedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [period, setPeriod] = useState<Period>('30d')

  async function loadData(p: Period = period, silent = false) {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const [ov, adv] = await Promise.all([
        analyticsAPI.overview(),
        analyticsAPI.advanced(p),
      ])
      setOverview(ov)
      setAdvanced(adv)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { loadData() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!loading) loadData(period, true) }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  const funnel = advanced?.conversion_funnel
  const nvr    = advanced?.new_vs_returning
  const pieData = nvr ? [
    { name: 'নতুন গ্রাহক', value: nvr.new },
    { name: 'পুরনো গ্রাহক', value: nvr.returning },
  ] : []

  // Format peak hours for display
  const peakHours = (advanced?.peak_hours || []).map(h => ({
    ...h,
    label: `${String(h.hour).padStart(2, '0')}:00`,
  }))
  const maxPeak = Math.max(...peakHours.map(h => h.count), 1)

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Business performance overview</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--c-border)' }}>
            {(['7d', '30d', '90d'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                      className="px-3 py-1.5 text-xs font-medium transition-all"
                      style={{
                        backgroundColor: period === p ? '#04AA6D' : 'var(--c-card)',
                        color: period === p ? 'white' : 'var(--c-muted)',
                      }}>
                {p}
              </button>
            ))}
          </div>
          <button onClick={() => loadData(period, true)} disabled={refreshing}
                  className="btn-secondary gap-1.5 text-sm">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          [0,1,2,3].map(i => <div key={i} className="card p-5 h-28 skeleton" />)
        ) : (
          <>
            <KpiCard label="Total Conversations" value={String(overview?.total_conversations ?? 0)} icon={Users} bg="#E8F5E9" color="#04AA6D" sub="all time" />
            <KpiCard label="Total Orders" value={String(overview?.total_orders ?? 0)} icon={ShoppingBag} bg="#F3E5F5" color="#7B1FA2" sub="AI extracted" />
            <KpiCard label="Revenue (period)" value={formatBDT(advanced?.total_revenue ?? 0)} icon={TrendingUp} bg="#FFF8E1" color="#F57F17" sub="confirmed + delivered" />
            <KpiCard label="Avg Order Value" value={formatBDT(advanced?.avg_order_value ?? 0)} icon={Package} bg="#E8F5E9" color="#388E3C" sub="per completed order" />
          </>
        )}
      </div>

      {/* Revenue Chart */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold" style={{ color: 'var(--c-text)' }}>Revenue & Orders Chart</h2>
          <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: 'var(--c-surface)', color: 'var(--c-muted)' }}>
            {period === '7d' ? 'শেষ ৭ দিন' : period === '30d' ? 'শেষ ৩০ দিন' : 'শেষ ৯০ দিন'}
          </span>
        </div>
        {loading ? (
          <div className="skeleton rounded h-56" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={advanced?.revenue_chart || []} margin={{ top: 2, right: 2, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#04AA6D" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#04AA6D" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--c-muted)' }} tickFormatter={v => String(v).slice(5)} axisLine={false} tickLine={false} interval={period === '7d' ? 0 : period === '30d' ? 4 : 10} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--c-muted)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CT} labelFormatter={v => `তারিখ: ${v}`} formatter={(v: number, n: string) => [n === 'revenue' ? formatBDT(v) : v, n === 'revenue' ? 'Revenue' : 'Orders']} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="revenue" stroke="#04AA6D" fill="url(#revGrad)" strokeWidth={2} name="revenue" dot={false} />
              <Line type="monotone" dataKey="orders" stroke="#7B1FA2" strokeWidth={2} name="orders" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top Products + Conversion Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top 10 Products */}
        <div className="card p-5">
          <h2 className="font-semibold mb-4" style={{ color: 'var(--c-text)' }}>Top 10 Best Selling Products</h2>
          {loading ? (
            <div className="space-y-3">{[0,1,2,3,4].map(i => <div key={i} className="skeleton h-7 rounded" />)}</div>
          ) : (advanced?.top_products || []).length === 0 ? (
            <p className="text-xs text-center py-8" style={{ color: 'var(--c-muted)' }}>অর্ডার আসলে এখানে দেখাবে</p>
          ) : (
            <div className="space-y-3">
              {(advanced?.top_products || []).map((p, i) => {
                const maxCount = advanced!.top_products[0].count
                const pct = Math.round((p.count / maxCount) * 100)
                return (
                  <div key={p.name}>
                    <div className="flex justify-between text-xs mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold w-5 text-right flex-shrink-0" style={{ color: i < 3 ? '#F57F17' : 'var(--c-muted)' }}>#{i+1}</span>
                        <span className="truncate font-medium" style={{ color: 'var(--c-text)' }}>{p.name}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span style={{ color: '#04AA6D' }}>{p.count} orders</span>
                        <span style={{ color: 'var(--c-muted)' }}>{formatBDT(p.revenue)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ backgroundColor: 'var(--c-surface)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: i < 3 ? '#F57F17' : '#04AA6D' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Conversion Funnel */}
        <div className="card p-5">
          <h2 className="font-semibold mb-4" style={{ color: 'var(--c-text)' }}>Conversion Funnel</h2>
          {loading ? (
            <div className="space-y-4">{[0,1,2].map(i => <div key={i} className="skeleton h-10 rounded" />)}</div>
          ) : funnel ? (
            <div className="space-y-4">
              <FunnelStep label="Conversations" value={funnel.conversations} total={funnel.conversations} color="#04AA6D" />
              <FunnelStep label="Orders Created" value={funnel.orders} total={funnel.conversations} color="#7B1FA2" />
              <FunnelStep label="Delivered / Paid" value={funnel.delivered} total={funnel.conversations} color="#F57F17" />
              <div className="grid grid-cols-2 gap-3 pt-2" style={{ borderTop: '1px solid var(--c-border-subtle)' }}>
                <div className="text-center p-3 rounded" style={{ backgroundColor: 'var(--c-surface)' }}>
                  <p className="text-lg font-bold" style={{ color: '#7B1FA2' }}>{funnel.conv_to_order}%</p>
                  <p className="text-xs" style={{ color: 'var(--c-muted)' }}>Conv → Order</p>
                </div>
                <div className="text-center p-3 rounded" style={{ backgroundColor: 'var(--c-surface)' }}>
                  <p className="text-lg font-bold" style={{ color: '#F57F17' }}>{funnel.order_to_paid}%</p>
                  <p className="text-xs" style={{ color: 'var(--c-muted)' }}>Order → Paid</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Peak Hours + New vs Returning */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Peak Hours Heatmap */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} style={{ color: '#04AA6D' }} />
            <h2 className="font-semibold" style={{ color: 'var(--c-text)' }}>Peak Hours Heatmap</h2>
          </div>
          {loading ? (
            <div className="skeleton rounded h-40" />
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-0.5">
                {peakHours.map(h => {
                  const intensity = maxPeak > 0 ? (h.count / maxPeak) : 0
                  const alpha = 0.1 + intensity * 0.9
                  return (
                    <div key={h.hour} className="relative group">
                      <div className="h-8 rounded-sm transition-all" style={{ backgroundColor: `rgba(4,170,109,${alpha})` }} />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 z-10 pointer-events-none"
                           style={{ backgroundColor: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
                        {h.label}: {h.count}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between text-xs" style={{ color: 'var(--c-muted)' }}>
                <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
              </div>
              <p className="text-xs" style={{ color: 'var(--c-muted)' }}>সবচেয়ে গাঢ় সবুজ = সর্বোচ্চ message activity</p>
            </div>
          )}
        </div>

        {/* New vs Returning Customers */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} style={{ color: '#04AA6D' }} />
            <h2 className="font-semibold" style={{ color: 'var(--c-text)' }}>New vs Returning Customers</h2>
          </div>
          {loading ? (
            <div className="skeleton rounded h-40" />
          ) : nvr && nvr.total > 0 ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={130} height={130}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip contentStyle={CT} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-3 flex-1">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#04AA6D' }} />
                    <span className="text-sm" style={{ color: 'var(--c-text)' }}>নতুন গ্রাহক</span>
                  </div>
                  <p className="text-2xl font-bold ml-4" style={{ color: '#04AA6D' }}>{nvr.new}</p>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#7B1FA2' }} />
                    <span className="text-sm" style={{ color: 'var(--c-text)' }}>পুরনো গ্রাহক</span>
                  </div>
                  <p className="text-2xl font-bold ml-4" style={{ color: '#7B1FA2' }}>{nvr.returning}</p>
                </div>
                <div className="p-2 rounded" style={{ backgroundColor: 'var(--c-surface)' }}>
                  <p className="text-xs" style={{ color: 'var(--c-muted)' }}>Retention Rate</p>
                  <p className="text-lg font-bold" style={{ color: '#F57F17' }}>{nvr.retention_rate}%</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-center py-10" style={{ color: 'var(--c-muted)' }}>অর্ডার আসলে customer data দেখাবে</p>
          )}
        </div>
      </div>

      {/* Popular Questions */}
      {!loading && (advanced?.popular_questions || []).length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Star size={16} style={{ color: '#04AA6D' }} />
            <h2 className="font-semibold" style={{ color: 'var(--c-text)' }}>Popular Customer Questions (Keywords)</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(advanced?.popular_questions || []).map((q, i) => {
              const maxCount = advanced!.popular_questions[0].count
              const size = 10 + Math.round((q.count / maxCount) * 6)
              return (
                <span key={q.keyword}
                      className="px-3 py-1.5 rounded-full font-medium"
                      style={{
                        fontSize: size,
                        backgroundColor: `rgba(4,170,109,${0.08 + (q.count / maxCount) * 0.25})`,
                        color: `rgba(4,170,109,${0.6 + (q.count / maxCount) * 0.4})`,
                        border: '1px solid rgba(4,170,109,0.2)',
                      }}>
                  {q.keyword} ({q.count})
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Original top products bar chart for reference */}
      <div className="card p-5">
        <h2 className="font-semibold mb-5" style={{ color: 'var(--c-text)' }}>Orders by Day (Bar View)</h2>
        {loading ? (
          <div className="skeleton rounded h-44" />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={advanced?.revenue_chart || []} margin={{ top: 2, right: 2, left: -10, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--c-muted)' }} tickFormatter={v => String(v).slice(5)} interval={period === '7d' ? 0 : period === '30d' ? 4 : 10} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--c-muted)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CT} />
              <Bar dataKey="orders" fill="#04AA6D" radius={[3,3,0,0]} name="Orders" opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
