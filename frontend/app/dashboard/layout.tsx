'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearAuth, getStoredTenant } from '@/lib/utils'
import {
  LayoutDashboard, Package, MessageSquare, ShoppingBag,
  BarChart2, Settings, CreditCard, Link as LinkIcon,
  LogOut, Bot, Menu, X, Megaphone, BookOpen, FlaskConical,
} from 'lucide-react'

const NAV_GROUPS = [
  {
    label: null,
    items: [
      { href: '/dashboard',               icon: LayoutDashboard, label: 'Overview' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/dashboard/conversations', icon: MessageSquare,   label: 'Conversations' },
      { href: '/dashboard/orders',        icon: ShoppingBag,     label: 'Orders' },
      { href: '/dashboard/products',      icon: Package,         label: 'Products' },
      { href: '/dashboard/campaigns',     icon: Megaphone,       label: 'Campaigns' },
    ],
  },
  {
    label: 'AI',
    items: [
      { href: '/dashboard/knowledge',     icon: BookOpen,        label: 'Knowledge Base' },
      { href: '/dashboard/test-bot',      icon: FlaskConical,    label: 'Test Bot' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/dashboard/analytics',     icon: BarChart2,       label: 'Analytics' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/dashboard/channels',      icon: LinkIcon,        label: 'Channels' },
      { href: '/dashboard/settings',      icon: Settings,        label: 'AI Settings' },
      { href: '/dashboard/subscription',  icon: CreditCard,      label: 'Subscription' },
    ],
  },
]

const PLAN_BADGE: Record<string, string> = {
  starter:    'bg-gray-600 text-gray-200',
  pro:        'text-white',
  enterprise: 'text-white',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [tenant, setTenant]       = useState<Record<string, unknown> | null>(null)
  const [sidebarOpen, setSidebar] = useState(false)

  useEffect(() => {
    const t = getStoredTenant()
    if (!t) { router.replace('/login'); return }
    setTenant(t)
  }, [router])

  function handleLogout() {
    clearAuth()
    router.push('/login')
  }

  if (!tenant) return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="spinner h-8 w-8" />
    </div>
  )

  /* ─── Sidebar content ─────────────────────────────────────────────────── */
  function SidebarContent() {
    return (
      <div className="flex flex-col h-full">

        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
               style={{ backgroundColor: '#04AA6D' }}>
            <Bot size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-white text-sm leading-tight">OmniBot</p>
            <p className="text-xs truncate" style={{ color: '#B0BEC5' }}>
              {tenant.business_name as string}
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="section-label px-3 mb-1.5">{group.label}</p>
              )}
              <div className="space-y-0.5">
                {group.items.map(({ href, icon: Icon, label }) => {
                  const active = pathname === href ||
                    (href !== '/dashboard' && pathname?.startsWith(href))
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setSidebar(false)}
                      className={active ? 'nav-link-active' : 'nav-link'}
                    >
                      <Icon size={16} className="flex-shrink-0" />
                      <span className="flex-1">{label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom — plan + logout */}
        <div className="px-3 py-4 border-t border-white/10 space-y-1">
          <div className="px-3 py-2.5 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <p className="text-xs mb-0.5" style={{ color: '#78909C' }}>Current Plan</p>
            <p className="text-sm font-semibold text-white capitalize">{tenant.plan as string}</p>
          </div>
          <button
            onClick={handleLogout}
            className="nav-link w-full hover:bg-red-500/20 hover:text-red-400"
          >
            <LogOut size={15} />
            <span>Log out</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#F9F9F9' }}>

      {/* ── Desktop sidebar ───────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-56 flex-shrink-0"
             style={{ backgroundColor: '#282A35' }}>
        <SidebarContent />
      </aside>

      {/* ── Mobile sidebar overlay ────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50"
               onClick={() => setSidebar(false)} />
          <aside className="relative w-56 h-full flex flex-col z-10"
                 style={{ backgroundColor: '#282A35' }}>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top header — dark */}
        <header className="h-14 flex items-center gap-4 px-5 flex-shrink-0"
                style={{ backgroundColor: '#282A35', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            className="md:hidden p-2 rounded transition-colors"
            style={{ color: '#B0BEC5' }}
            onClick={() => setSidebar(true)}
            aria-label="Open menu"
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Menu size={20} />
          </button>

          {/* Page breadcrumb / title */}
          <div className="flex items-center gap-2 text-xs" style={{ color: '#78909C' }}>
            <Bot size={14} style={{ color: '#04AA6D' }} />
            <span>OmniBot</span>
            <span>/</span>
            <span className="text-white font-medium">
              {NAV_GROUPS.flatMap(g => g.items).find(i =>
                pathname === i.href || (i.href !== '/dashboard' && pathname?.startsWith(i.href))
              )?.label || 'Overview'}
            </span>
          </div>

          <div className="flex-1" />

          {/* Right side */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-medium text-white">{tenant.business_name as string}</span>
              <span className="text-2xs" style={{ color: '#78909C' }}>{tenant.email as string}</span>
            </div>
            <div className="w-8 h-8 rounded flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                 style={{ backgroundColor: '#04AA6D' }}>
              {String(tenant.business_name || 'O')[0].toUpperCase()}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-5 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
