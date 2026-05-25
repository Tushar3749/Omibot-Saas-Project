'use client'
import { useEffect, useState } from 'react'
import { analyticsAPI } from '@/lib/api'
import { formatBDT } from '@/lib/utils'
import type { AnalyticsOverview } from '@/types'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { TrendingUp, MessageSquare, ShoppingBag, Users } from 'lucide-react'

const CHART_TOOLTIP = {
  borderRadius: 4,
  border: '1px solid #E0E0E0',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  fontSize: 12,
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [daily30, setDaily30]   = useState<Record<string, unknown>[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    Promise.all([analyticsAPI.overview(), analyticsAPI.daily(30)])
      .then(([ov, d]) => { setOverview(ov); setDaily30(d) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="spinner h-10 w-10" />
    </div>
  )

  const stats = overview ? [
    { label: 'Conversations', value: overview.total_conversations,      icon: Users,         bg: '#E8F5E9', color: '#04AA6D', sub: 'all time' },
    { label: 'Messages',      value: overview.total_messages,           icon: MessageSquare, bg: '#F3E5F5', color: '#7B1FA2', sub: 'all time' },
    { label: 'Orders',        value: overview.total_orders,             icon: ShoppingBag,   bg: '#E8F5E9', color: '#388E3C', sub: 'AI extracted' },
    { label: 'Revenue',       value: formatBDT(overview.revenue_total), icon: TrendingUp,    bg: '#FFF8E1', color: '#F57F17', sub: 'confirmed + delivered' },
  ] : []

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="page-title">Analytics</h1>
        <p className="page-subtitle">শেষ ৩০ দিনের performance overview</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, bg, color, sub }) => (
          <div key={label} className="card p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0"
                   style={{ backgroundColor: bg }}>
                <Icon size={17} style={{ color }} />
              </div>
              <p className="text-sm leading-tight" style={{ color: '#757575' }}>{label}</p>
            </div>
            <p className="text-2xl font-bold" style={{ color: '#282A35' }}>{String(value)}</p>
            <p className="text-xs mt-1" style={{ color: '#9E9E9E' }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Messages area chart */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold" style={{ color: '#282A35' }}>Messages (30 days)</h2>
            <span className="text-2xs px-2 py-1 rounded-full"
                  style={{ backgroundColor: '#F5F5F5', color: '#757575' }}>last 30d</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={daily30} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="msgArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#04AA6D" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#04AA6D" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9E9E9E' }}
                tickFormatter={v => String(v).slice(5)} interval={4}
                axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9E9E9E' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP} labelFormatter={v => `Date: ${v}`} />
              <Area type="monotone" dataKey="messages" stroke="#04AA6D"
                fill="url(#msgArea)" strokeWidth={2} name="Messages" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Orders bar chart */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold" style={{ color: '#282A35' }}>Orders (30 days)</h2>
            <span className="text-2xs px-2 py-1 rounded-full"
                  style={{ backgroundColor: '#F5F5F5', color: '#757575' }}>last 30d</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={daily30} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9E9E9E' }}
                tickFormatter={v => String(v).slice(5)} interval={4}
                axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9E9E9E' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP} labelFormatter={v => `Date: ${v}`} />
              <Bar dataKey="orders" fill="#04AA6D" radius={[3, 3, 0, 0]} name="Orders" opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top products */}
      {overview?.top_products && overview.top_products.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold mb-5" style={{ color: '#282A35' }}>Top Products by Orders</h2>
          <div className="space-y-4">
            {overview.top_products.map((p, i) => {
              const maxCount = overview.top_products[0].count
              const pct = Math.round((p.count / maxCount) * 100)
              return (
                <div key={p.name} className="flex items-center gap-4">
                  <span className="text-sm font-bold w-6 text-right flex-shrink-0"
                        style={{ color: '#BDBDBD' }}>#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="font-medium truncate" style={{ color: '#282A35' }}>{p.name}</span>
                      <span className="flex-shrink-0 ml-2" style={{ color: '#9E9E9E' }}>{p.count} orders</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#F5F5F5' }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, backgroundColor: '#04AA6D' }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
