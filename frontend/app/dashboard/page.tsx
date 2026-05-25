'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { analyticsAPI } from '@/lib/api'
import { getStoredTenant, formatBDT } from '@/lib/utils'
import { MessageSquare, ShoppingBag, TrendingUp, Users, ArrowUpRight, ArrowRight } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const CHART_TOOLTIP = {
  borderRadius: 4,
  border: '1px solid #E0E0E0',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  fontSize: 12,
}

const QUICK_ACTIONS = [
  { label: 'Product যোগ করুন',    href: '/dashboard/products',      desc: 'Catalog update করুন' },
  { label: 'Conversations',        href: '/dashboard/conversations',  desc: 'Live conversations দেখুন' },
  { label: 'Orders',               href: '/dashboard/orders',         desc: 'Order status পরিচালনা করুন' },
  { label: 'AI Settings',          href: '/dashboard/settings',       desc: 'Bot personality কাস্টমাইজ করুন' },
]

export default function DashboardPage() {
  const tenant = getStoredTenant()
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null)
  const [daily, setDaily]       = useState<Record<string, unknown>[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    Promise.all([analyticsAPI.overview(), analyticsAPI.daily(14)])
      .then(([ov, d]) => { setOverview(ov); setDaily(d) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const stats = overview ? [
    { label: 'Conversations',    value: overview.total_conversations,                icon: Users,         bg: '#E8F5E9', color: '#04AA6D' },
    { label: 'Messages (month)', value: overview.messages_this_month,                icon: MessageSquare, bg: '#F3E5F5', color: '#7B1FA2' },
    { label: 'Total Orders',     value: overview.total_orders,                       icon: ShoppingBag,   bg: '#E8F5E9', color: '#388E3C' },
    { label: 'Revenue',          value: formatBDT(overview.revenue_total as number), icon: TrendingUp,    bg: '#FFF8E1', color: '#F57F17' },
  ] : []

  return (
    <div className="space-y-6 max-w-6xl">

      {/* ── Greeting ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">
            স্বাগতম, {String(tenant?.business_name || '')} 👋
          </h1>
          <p className="page-subtitle">আপনার OmniBot-এর overview দেখুন</p>
        </div>
        <Link href="/dashboard/analytics" className="btn-secondary text-sm gap-1.5">
          Full Analytics <ArrowRight size={14} />
        </Link>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading
          ? [1,2,3,4].map(i => (
              <div key={i} className="card p-5 animate-pulse space-y-3">
                <div className="h-3 rounded w-3/4" style={{ backgroundColor: '#F5F5F5' }} />
                <div className="h-7 rounded w-1/2" style={{ backgroundColor: '#F5F5F5' }} />
              </div>
            ))
          : stats.map(({ label, value, icon: Icon, bg, color }) => (
              <div key={label} className="card p-5 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm" style={{ color: '#757575' }}>{label}</p>
                  <div className="w-8 h-8 rounded flex items-center justify-center"
                       style={{ backgroundColor: bg }}>
                    <Icon size={15} style={{ color }} />
                  </div>
                </div>
                <p className="text-2xl font-bold" style={{ color: '#282A35' }}>{String(value)}</p>
              </div>
            ))
        }
      </div>

      {/* ── Chart + Top products ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Chart */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold" style={{ color: '#282A35' }}>Messages (last 14 days)</h2>
            <span className="text-2xs px-2 py-1 rounded-full"
                  style={{ backgroundColor: '#F5F5F5', color: '#757575' }}>14d</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={daily} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#04AA6D" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#04AA6D" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9E9E9E' }}
                tickFormatter={v => String(v).slice(5)} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9E9E9E' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP} labelFormatter={v => `তারিখ: ${v}`} />
              <Area type="monotone" dataKey="messages" stroke="#04AA6D"
                fill="url(#msgGrad)" strokeWidth={2} name="Messages" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Top products */}
        <div className="card p-5">
          <h2 className="font-semibold mb-4" style={{ color: '#282A35' }}>Top Products</h2>
          {(overview?.top_products as { name: string; count: number }[] | undefined)?.length ? (
            <div className="space-y-3">
              {(overview!.top_products as { name: string; count: number }[]).map((p, i) => (
                <div key={p.name} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold w-4 flex-shrink-0" style={{ color: '#BDBDBD' }}>#{i + 1}</span>
                    <span className="text-sm truncate" style={{ color: '#424242' }}>{p.name}</span>
                  </div>
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#04AA6D' }}>{p.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state py-8">
              <ShoppingBag size={28} style={{ color: '#BDBDBD' }} />
              <p className="text-sm" style={{ color: '#9E9E9E' }}>এখনো কোনো order নেই</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="font-semibold mb-4" style={{ color: '#282A35' }}>Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {QUICK_ACTIONS.map(({ label, href, desc }) => (
            <Link key={href} href={href}
              className="group p-4 rounded transition-all duration-200 flex flex-col gap-1.5"
              style={{ backgroundColor: '#F9F9F9', border: '1px solid #E0E0E0' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#E8F5E9'
                ;(e.currentTarget as HTMLAnchorElement).style.borderColor = '#A5D6A7'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#F9F9F9'
                ;(e.currentTarget as HTMLAnchorElement).style.borderColor = '#E0E0E0'
              }}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium" style={{ color: '#282A35' }}>{label}</p>
                <ArrowUpRight size={14} style={{ color: '#9E9E9E' }} />
              </div>
              <p className="text-xs" style={{ color: '#757575' }}>{desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
