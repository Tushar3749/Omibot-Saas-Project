'use client'
import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { analyticsAPI, ordersAPI, conversationsAPI } from '@/lib/api'
import { getStoredTenant, formatBDT, formatDateTime } from '@/lib/utils'
import {
  MessageSquare, ShoppingBag, TrendingUp, Users,
  ArrowUpRight, ArrowRight, Package, RefreshCw,
} from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { SkeletonStatCard } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import toast from 'react-hot-toast'

/* ── useCountUp hook ────────────────────────────────────────────────────── */
function useCountUp(target: number, duration = 900, active = true) {
  const [count, setCount] = useState(0)
  const raf = useRef<number>()

  useEffect(() => {
    if (!active || !target) { setCount(target); return }
    const start = performance.now()
    function step(now: number) {
      const elapsed  = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased    = 1 - Math.pow(1 - progress, 3)   // ease-out cubic
      setCount(Math.round(eased * target))
      if (progress < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [target, duration, active])

  return count
}

const CHART_TOOLTIP_STYLE = {
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  fontSize: 12,
  backgroundColor: 'var(--c-card)',
  color: 'var(--c-text)',
}

const QUICK_ACTIONS = [
  { label: 'Product যোগ করুন',   href: '/dashboard/products',      desc: 'Catalog update করুন',       icon: Package },
  { label: 'Conversations',       href: '/dashboard/conversations',  desc: 'Live messages দেখুন',        icon: MessageSquare },
  { label: 'Orders',              href: '/dashboard/orders',         desc: 'Order status পরিচালনা',      icon: ShoppingBag },
  { label: 'Analytics',           href: '/dashboard/analytics',      desc: 'Full data & insights',       icon: TrendingUp },
]

/* ── Activity types ─────────────────────────────────────────────────────── */
type ActivityItem = {
  id: string
  type: 'order' | 'conversation' | 'message'
  label: string
  sub: string
  dot: string
  time: string
}

/* ── Stat card component ────────────────────────────────────────────────── */
function StatCard({
  label, rawValue, display, icon: Icon, bg, color, index,
}: {
  label: string; rawValue: number; display: string
  icon: React.ElementType; bg: string; color: string; index: number
}) {
  const count   = useCountUp(rawValue, 900)
  const isCount = !display.includes('৳')
  const shown   = isCount ? count.toLocaleString('en-BD') : display

  return (
    <div className="stat-card" style={{ animationDelay: `${index * 70}ms` }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--c-text-2)' }}>{label}</p>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
             style={{ backgroundColor: bg }}>
          <Icon size={16} style={{ color }} />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight anim-count-up"
           style={{ color: 'var(--c-text)', animationDelay: `${index * 70 + 180}ms` }}>
          {shown}
        </p>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const tenant = getStoredTenant()

  const [overview, setOverview]   = useState<Record<string, unknown> | null>(null)
  const [daily,    setDaily]      = useState<Record<string, unknown>[]>([])
  const [activity, setActivity]   = useState<ActivityItem[]>([])
  const [loading,  setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function loadData(silent = false) {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const [ov, d, orders, convs] = await Promise.allSettled([
        analyticsAPI.overview(),
        analyticsAPI.daily(14),
        ordersAPI.list(),
        conversationsAPI.list(),
      ])

      if (ov.status === 'fulfilled') setOverview(ov.value)
      if (d.status  === 'fulfilled') setDaily(d.value)

      /* Build activity feed from real data */
      const feed: ActivityItem[] = []
      if (orders.status === 'fulfilled' && Array.isArray(orders.value)) {
        orders.value.slice(0, 4).forEach((o: Record<string, unknown>) => {
          feed.push({
            id:    `order-${o.id}`,
            type:  'order',
            label: `নতুন Order — ${o.customer_name ?? 'Customer'}`,
            sub:   `#${String(o.id).slice(0,8)} · ${o.status ?? 'pending'}`,
            dot:   'activity-dot-green',
            time:  o.created_at ? formatDateTime(o.created_at as string) : '',
          })
        })
      }
      if (convs.status === 'fulfilled' && Array.isArray(convs.value)) {
        convs.value.slice(0, 4).forEach((c: Record<string, unknown>) => {
          feed.push({
            id:    `conv-${c.id}`,
            type:  'conversation',
            label: `Conversation — ${c.customer_name ?? 'User'}`,
            sub:   `${c.message_count ?? 0} messages · ${c.channel ?? 'Facebook'}`,
            dot:   'activity-dot-blue',
            time:  c.updated_at ? formatDateTime(c.updated_at as string) : '',
          })
        })
      }

      /* Sort by time desc, keep top 6 */
      feed.sort((a, b) => (b.time > a.time ? 1 : -1))
      setActivity(feed.slice(0, 6))

      if (silent) toast.success('Dashboard updated')
    } catch {
      if (!silent) toast.error('Data load failed')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { loadData() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Stat definitions ─────────────────────────────────────────────────── */
  const stats = overview ? [
    {
      label:    'Conversations',
      rawValue: Number(overview.total_conversations ?? 0),
      display:  String(overview.total_conversations ?? 0),
      icon:     Users,
      bg:       'var(--c-primary-light)',
      color:    '#04AA6D',
    },
    {
      label:    'Messages (month)',
      rawValue: Number(overview.messages_this_month ?? 0),
      display:  String(overview.messages_this_month ?? 0),
      icon:     MessageSquare,
      bg:       '#F3E5F5',
      color:    '#7B1FA2',
    },
    {
      label:    'Total Orders',
      rawValue: Number(overview.total_orders ?? 0),
      display:  String(overview.total_orders ?? 0),
      icon:     ShoppingBag,
      bg:       'var(--c-primary-light)',
      color:    '#388E3C',
    },
    {
      label:    'Revenue',
      rawValue: Number(overview.revenue_total ?? 0),
      display:  formatBDT(Number(overview.revenue_total ?? 0)),
      icon:     TrendingUp,
      bg:       '#FFF8E1',
      color:    '#F57F17',
    },
  ] : []

  return (
    <div className="space-y-5 max-w-6xl">

      {/* ── Animated gradient greeting banner ─────────────────────────── */}
      <div
        className="rounded-xl p-5 relative overflow-hidden anim-fade-in"
        style={{
          background: 'linear-gradient(135deg, #282A35 0%, #1a3530 50%, #223330 100%)',
          backgroundSize: '200% 200%',
          animation: 'gradientShift 8s ease infinite, fadeIn 0.4s ease-out',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        }}
      >
        {/* Subtle grid pattern overlay */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'radial-gradient(circle, #04AA6D 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }} />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">
              স্বাগতম, {String(tenant?.business_name || '')} 👋
            </h1>
            <p className="text-xs mt-1" style={{ color: 'rgba(176,190,197,0.85)' }}>
              আপনার OmniBot-এর real-time overview
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all tap-target"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#B0BEC5', border: '1px solid rgba(255,255,255,0.15)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <Link
              href="/dashboard/analytics"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all tap-target"
              style={{ background: 'rgba(4,170,109,0.25)', color: '#4CAF50', border: '1px solid rgba(4,170,109,0.3)' }}
              onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.background = 'rgba(4,170,109,0.35)')}
              onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.background = 'rgba(4,170,109,0.25)')}
            >
              Analytics <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </div>

      {/* ── Stat cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {loading
          ? [0,1,2,3].map(i => <SkeletonStatCard key={i} index={i} />)
          : stats.map((s, i) => <StatCard key={s.label} {...s} index={i} />)
        }
      </div>

      {/* ── Chart + Top products ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Real-time chart */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold" style={{ color: 'var(--c-text)' }}>
                Activity (14 days)
              </h2>
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--c-primary-light)', color: '#04AA6D' }}>
                <span className="live-dot" />
                Live
              </span>
            </div>
            <span className="text-2xs px-2 py-1 rounded-full"
                  style={{ backgroundColor: 'var(--c-surface)', color: 'var(--c-text-2)' }}>
              14d
            </span>
          </div>

          {loading ? (
            <div className="skeleton rounded h-36 sm:h-44" />
          ) : daily.length ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={daily} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#04AA6D" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#04AA6D" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#7B1FA2" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#7B1FA2" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'var(--c-text-3)' }}
                  tickFormatter={v => String(v).slice(5)}
                  axisLine={false} tickLine={false}
                />
                <YAxis tick={{ fontSize: 10, fill: 'var(--c-text-3)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelFormatter={v => `তারিখ: ${v}`} />
                <Legend iconType="circle" iconSize={8}
                        wrapperStyle={{ fontSize: 11, paddingTop: 8, color: 'var(--c-text-2)' }} />
                <Area type="monotone" dataKey="messages" stroke="#04AA6D"
                      fill="url(#msgGrad)" strokeWidth={2} name="Messages" dot={false} />
                {daily.some(d => d.orders !== undefined) && (
                  <Area type="monotone" dataKey="orders" stroke="#7B1FA2"
                        fill="url(#ordGrad)" strokeWidth={2} name="Orders" dot={false} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              illustration="analytics"
              title="No chart data yet"
              description="Data will appear once conversations start"
              compact
            />
          )}
        </div>

        {/* Top products */}
        <div className="card p-5">
          <h2 className="font-semibold mb-4" style={{ color: 'var(--c-text)' }}>
            Top Products
          </h2>
          {loading ? (
            <div className="space-y-3">
              {[0,1,2,3].map(i => (
                <div key={i} className="flex justify-between gap-2">
                  <div className="skeleton h-3 rounded flex-1" />
                  <div className="skeleton h-3 rounded w-8" />
                </div>
              ))}
            </div>
          ) : (overview?.top_products as { name: string; count: number }[] | undefined)?.length ? (
            <div className="space-y-3">
              {(overview!.top_products as { name: string; count: number }[]).map((p, i) => (
                <div key={p.name}
                     className="flex items-center justify-between gap-2 anim-fade-in"
                     style={{ animationDelay: `${i * 50}ms` }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold w-4 flex-shrink-0"
                          style={{ color: 'var(--c-text-3)' }}>#{i+1}</span>
                    <span className="text-sm truncate" style={{ color: 'var(--c-text)' }}>
                      {p.name}
                    </span>
                  </div>
                  <span className="text-xs font-semibold flex-shrink-0"
                        style={{ color: '#04AA6D' }}>
                    {p.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              illustration="products"
              title="No orders yet"
              description="Top products appear when orders come in"
              compact
            />
          )}
        </div>
      </div>

      {/* ── Activity feed + Quick actions ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Activity feed */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold" style={{ color: 'var(--c-text)' }}>
              Recent Activity
            </h2>
            <span className="flex items-center gap-1 text-2xs"
                  style={{ color: 'var(--c-text-3)' }}>
              <span className="live-dot" />
              Real-time
            </span>
          </div>

          {loading ? (
            <div className="space-y-4">
              {[0,1,2,3].map(i => (
                <div key={i} className="flex gap-3">
                  <div className="skeleton w-2 h-2 rounded-full mt-1.5 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-3 rounded w-3/4" />
                    <div className="skeleton h-2.5 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length ? (
            <div className="space-y-4">
              {activity.map((item, i) => (
                <div key={item.id}
                     className="flex gap-3 anim-fade-in"
                     style={{ animationDelay: `${i * 50}ms` }}>
                  <span className={`activity-dot ${item.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate"
                       style={{ color: 'var(--c-text)' }}>
                      {item.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-2)' }}>
                      {item.sub}
                    </p>
                    {item.time && (
                      <p className="text-2xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                        {item.time}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              illustration="inbox"
              title="No recent activity"
              description="Orders and conversations will appear here"
              compact
            />
          )}
        </div>

        {/* Quick actions */}
        <div className="card p-5">
          <h2 className="font-semibold mb-4" style={{ color: 'var(--c-text)' }}>
            Quick Actions
          </h2>
          <div className="space-y-2">
            {QUICK_ACTIONS.map(({ label, href, desc, icon: Icon }, i) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 p-3 rounded transition-all duration-150 group anim-fade-in"
                style={{
                  backgroundColor: 'var(--c-surface)',
                  border: '1px solid var(--c-border)',
                  animationDelay: `${i * 50}ms`,
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--c-primary-light)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = '#A5D6A7'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--c-surface)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--c-border)'
                }}
              >
                <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
                     style={{ backgroundColor: 'var(--c-primary-light)' }}>
                  <Icon size={13} style={{ color: '#04AA6D' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--c-text)' }}>
                    {label}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>{desc}</p>
                </div>
                <ArrowUpRight size={13} style={{ color: 'var(--c-text-3)' }}
                              className="flex-shrink-0 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
