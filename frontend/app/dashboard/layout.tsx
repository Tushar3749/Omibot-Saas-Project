'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearAuth, getStoredTenant } from '@/lib/utils'
import { useTheme } from '@/app/providers'
import {
  LayoutDashboard, Package, MessageSquare, ShoppingBag,
  BarChart2, Settings, CreditCard, Link as LinkIcon,
  LogOut, Bot, Megaphone, BookOpen, FlaskConical,
  ChevronLeft, ChevronRight, Sun, Moon,
  RotateCcw, Layers, AlertTriangle, MoreHorizontal,
  RefreshCw, Percent, Tag, Receipt,
} from 'lucide-react'

// ─── Nav configuration ────────────────────────────────────────────────────────

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
      { href: '/dashboard/campaigns',      icon: Megaphone,       label: 'Campaigns' },
      { href: '/dashboard/discount-rules',       icon: Percent, label: 'Discount Rules' },
      { href: '/dashboard/discount-categories', icon: Tag,     label: 'Discount Categories' },
      { href: '/dashboard/combos',              icon: Layers,  label: 'Combos' },
      { href: '/dashboard/stock',         icon: Package,         label: 'Stock' },
      { href: '/dashboard/returns',       icon: RotateCcw,       label: 'Returns' },
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
      { href: '/dashboard/complaints',    icon: AlertTriangle,   label: 'Complaints' },
      { href: '/dashboard/discounts',     icon: Receipt,         label: 'Discounts Report' },
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

const BOTTOM_NAV = [
  { href: '/dashboard',               icon: LayoutDashboard, label: 'Home' },
  { href: '/dashboard/conversations', icon: MessageSquare,   label: 'Chats' },
  { href: '/dashboard/orders',        icon: ShoppingBag,     label: 'Orders' },
  { href: '/dashboard/analytics',     icon: BarChart2,       label: 'Analytics' },
]

// ─── Ripple hook ──────────────────────────────────────────────────────────────

function useRipple() {
  const createRipple = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height) * 2
    const x = e.clientX - rect.left - size / 2
    const y = e.clientY - rect.top  - size / 2

    const ripple = document.createElement('span')
    ripple.style.cssText = `
      position:absolute; border-radius:50%;
      width:${size}px; height:${size}px;
      left:${x}px; top:${y}px;
      background:rgba(255,255,255,0.3);
      transform:scale(0); opacity:0.6;
      animation:rippleEffect 0.5s ease-out forwards;
      pointer-events:none;
    `
    el.style.position = 'relative'
    el.style.overflow = 'hidden'
    el.appendChild(ripple)
    setTimeout(() => ripple.remove(), 500)
  }, [])
  return { createRipple }
}

// ─── Pull-to-refresh hook ─────────────────────────────────────────────────────

function usePullToRefresh(mainRef: React.RefObject<HTMLDivElement>, onRefresh: () => void) {
  const touchStartY = useRef(0)
  const [pulling, setPulling]     = useState(false)
  const [distance, setDistance]   = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const THRESHOLD = 72

  const onTouchStart = useCallback((e: TouchEvent) => {
    if ((mainRef.current?.scrollTop ?? 0) === 0) {
      touchStartY.current = e.touches[0].clientY
    }
  }, [mainRef])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if ((mainRef.current?.scrollTop ?? 0) > 0) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0 && dy < 160) {
      setPulling(true)
      setDistance(Math.round(dy * 0.45))
      if (dy > 12) e.preventDefault()
    }
  }, [mainRef])

  const onTouchEnd = useCallback(() => {
    if (distance >= THRESHOLD) {
      setRefreshing(true)
      onRefresh()
      setTimeout(() => { setRefreshing(false); setPulling(false); setDistance(0) }, 1200)
    } else {
      setPulling(false)
      setDistance(0)
    }
  }, [distance, onRefresh])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
    }
  }, [mainRef, onTouchStart, onTouchMove, onTouchEnd])

  return { pulling, distance, refreshing }
}

// ─── Swipe gesture hook ───────────────────────────────────────────────────────

function useSwipeGesture(
  onSwipeRight: () => void,
  onSwipeLeft: () => void,
) {
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)

  const onTouchStart = useCallback((e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }, [])

  const onTouchEnd = useCallback((e: TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 55) {
      if (dx > 0 && touchStartX.current < 32) onSwipeRight()
      if (dx < 0) onSwipeLeft()
    }
  }, [onSwipeRight, onSwipeLeft])

  useEffect(() => {
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend',   onTouchEnd,   { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend',   onTouchEnd)
    }
  }, [onTouchStart, onTouchEnd])
}

// ─── Main layout ──────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()
  const mainRef  = useRef<HTMLDivElement>(null)

  const [tenant, setTenant]         = useState<Record<string, unknown> | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed]   = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const openMobile  = useCallback(() => setMobileOpen(true),  [])
  const closeMobile = useCallback(() => setMobileOpen(false), [])

  useSwipeGesture(openMobile, closeMobile)

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true)
    router.refresh()
    setTimeout(() => setIsRefreshing(false), 1000)
  }, [router])

  const { pulling, distance, refreshing: pullRefreshing } = usePullToRefresh(mainRef, handleRefresh)

  useEffect(() => {
    const t = getStoredTenant()
    if (!t) { router.replace('/login'); return }
    setTenant(t)
    const saved = localStorage.getItem('sidebar_collapsed')
    if (saved === 'true') setCollapsed(true)
  }, [router])

  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const toggleCollapse = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebar_collapsed', String(next))
      return next
    })
  }, [])

  const sidebarBg = theme === 'dark' ? 'var(--c-sidebar)' : '#282A35'
  const headerBg  = theme === 'dark' ? 'var(--c-header)'  : '#282A35'

  const currentPage = NAV_GROUPS
    .flatMap(g => g.items)
    .find(i => pathname === i.href || (i.href !== '/dashboard' && pathname?.startsWith(i.href)))

  if (!tenant) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--c-surface)' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="spinner h-8 w-8" />
        <p className="text-xs" style={{ color: 'var(--c-muted)' }}>Loading...</p>
      </div>
    </div>
  )

  /* ─── Sidebar content ────────────────────────────────────────────────── */
  function SidebarContent({ isMobile = false }: { isMobile?: boolean }) {
    const show = isMobile || !collapsed

    return (
      <div className="flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className="flex-shrink-0" style={{ borderBottom: '1px solid var(--c-sidebar-sep)' }}>
          {show ? (
            <div className="flex items-center gap-3 px-3 py-3">
              <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
                   style={{ background: 'linear-gradient(135deg, #04AA6D, #388E3C)' }}>
                <Bot size={15} className="text-white" />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <p className="font-bold text-white text-sm leading-tight">OmniBot</p>
                <p className="text-xs truncate" style={{ color: 'var(--c-sidebar-text)' }}>
                  {tenant!.business_name as string}
                </p>
              </div>
              {isMobile ? (
                <button
                  onClick={closeMobile}
                  className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors tap-target"
                  style={{ color: 'var(--c-sidebar-text)' }}
                  aria-label="Close menu"
                >
                  {/* Animated X */}
                  <span className="hamburger open">
                    <span className="hamburger-line" />
                    <span className="hamburger-line" />
                    <span className="hamburger-line" />
                  </span>
                </button>
              ) : (
                <button
                  onClick={toggleCollapse}
                  className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                  style={{ color: 'var(--c-sidebar-text)' }}
                  title="Collapse sidebar"
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-sidebar-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <ChevronLeft size={18} />
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 py-3">
              <div className="w-8 h-8 rounded flex items-center justify-center"
                   style={{ background: 'linear-gradient(135deg, #04AA6D, #388E3C)' }}>
                <Bot size={15} className="text-white" />
              </div>
              <button
                onClick={toggleCollapse}
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                style={{ color: 'var(--c-sidebar-text)' }}
                title="Expand sidebar"
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--c-sidebar-hover)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi}>
              {group.label && show && (
                <p className="section-label px-3 mb-1.5">{group.label}</p>
              )}
              {group.label && !show && (
                <div className="mx-3 my-1.5 h-px" style={{ backgroundColor: 'var(--c-sidebar-sep)' }} />
              )}
              <div className="space-y-0.5">
                {group.items.map(({ href, icon: Icon, label }) => {
                  const active = pathname === href ||
                    (href !== '/dashboard' && pathname?.startsWith(href))
                  return (
                    <Link
                      key={href}
                      href={href}
                      title={!show ? label : undefined}
                      className={active ? 'nav-link-active' : 'nav-link'}
                      style={!show ? { justifyContent: 'center', padding: '10px 0' } : {}}
                    >
                      <Icon size={16} className="flex-shrink-0" />
                      {show && <span className="flex-1 truncate">{label}</span>}
                      {show && active && (
                        <span className="w-1.5 h-1.5 rounded-full bg-white opacity-70 flex-shrink-0" />
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className="px-3 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--c-sidebar-sep)' }}>
          {show && (
            <div className="px-3 py-2.5 rounded mb-2"
                 style={{ background: 'linear-gradient(135deg, rgba(4,170,109,0.15), rgba(4,170,109,0.05))', border: '1px solid rgba(4,170,109,0.2)' }}>
              <p className="text-xs mb-0.5" style={{ color: 'var(--c-sidebar-dim)' }}>Current Plan</p>
              <p className="text-sm font-bold text-white capitalize">{tenant!.plan as string}</p>
            </div>
          )}
          <button
            onClick={() => { clearAuth(); router.push('/login') }}
            className="nav-link w-full"
            style={{
              ...((!show) ? { justifyContent: 'center', padding: '10px 0' } : {}),
              color: '#EF9A9A',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(239,68,68,0.12)'; (e.currentTarget as HTMLElement).style.color = '#f44336' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#EF9A9A' }}
            title={!show ? 'Log out' : undefined}
          >
            <LogOut size={15} />
            {show && <span>Log out</span>}
          </button>
        </div>
      </div>
    )
  }

  const pullOffset = pulling ? Math.min(distance, 64) : 0
  const showPullIndicator = pulling && distance > 20

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--c-surface)' }}>

      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col flex-shrink-0"
        style={{
          backgroundColor: sidebarBg,
          width: collapsed ? 'var(--sidebar-w-sm)' : 'var(--sidebar-w)',
          transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1)',
          overflow: 'hidden',
          boxShadow: '2px 0 8px rgba(0,0,0,0.15)',
        }}
      >
        <SidebarContent />
      </aside>

      {/* ── Mobile sidebar overlay ───────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0"
            style={{
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(3px)',
              animation: 'backdropIn 0.2s ease-out',
            }}
            onClick={closeMobile}
          />
          {/* Drawer */}
          <aside
            className="relative h-full flex flex-col flex-shrink-0 z-10"
            style={{
              width: '280px',
              backgroundColor: sidebarBg,
              animation: 'slideInLeft 0.28s cubic-bezier(0.22,1,0.36,1)',
              boxShadow: '4px 0 20px rgba(0,0,0,0.3)',
            }}
          >
            <SidebarContent isMobile />
          </aside>
        </div>
      )}

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <header
          className="flex-shrink-0 flex items-center gap-3 px-4 md:px-5"
          style={{
            height: 'var(--header-h)',
            backgroundColor: headerBg,
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            background: theme === 'dark'
              ? 'linear-gradient(90deg, #0d0f17 0%, #111520 100%)'
              : 'linear-gradient(90deg, #282A35 0%, #1e2535 100%)',
          }}
        >
          {/* Hamburger */}
          <button
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg transition-colors tap-target flex-shrink-0"
            style={{ color: '#B0BEC5' }}
            onClick={openMobile}
            aria-label="Open navigation"
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.09)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <span className={`hamburger ${mobileOpen ? 'open' : ''}`} style={{ color: '#B0BEC5' }}>
              <span className="hamburger-line" />
              <span className="hamburger-line" />
              <span className="hamburger-line" />
            </span>
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs min-w-0" style={{ color: '#78909C' }}>
            <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                 style={{ backgroundColor: 'rgba(4,170,109,0.2)' }}>
              <Bot size={11} style={{ color: '#04AA6D' }} />
            </div>
            <span className="hidden sm:inline">OmniBot</span>
            <span className="hidden sm:inline opacity-40">/</span>
            <span className="text-white font-semibold truncate">{currentPage?.label ?? 'Overview'}</span>
          </div>

          <div className="flex-1" />

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors flex-shrink-0"
            style={{ color: '#78909C' }}
            title="Refresh"
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={toggleTheme}
            className="hidden sm:flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors text-xs tap-target"
            style={{ color: '#B0BEC5' }}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {theme === 'dark'
              ? <Sun  size={14} style={{ color: '#FDD835' }} />
              : <Moon size={14} style={{ color: '#B0BEC5' }} />
            }
          </button>

          {/* Avatar */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-medium text-white leading-tight">
                {String(tenant.business_name || '').slice(0, 18)}
              </span>
              <span className="text-2xs" style={{ color: '#607D8B' }}>
                {String(tenant.plan || 'free').toUpperCase()}
              </span>
            </div>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, #04AA6D, #388E3C)',
                boxShadow: '0 2px 6px rgba(4,170,109,0.4)',
              }}
            >
              {String(tenant.business_name || 'O')[0].toUpperCase()}
            </div>
          </div>
        </header>

        {/* Pull-to-refresh indicator */}
        {showPullIndicator && (
          <div className="pull-indicator md:hidden">
            <div className="spinner h-3 w-3" />
            <span>{distance >= 72 ? 'ছেড়ে দিন' : 'নামিয়ে আনুন...'}</span>
          </div>
        )}
        {pullRefreshing && (
          <div className="pull-indicator md:hidden">
            <div className="spinner h-3 w-3" />
            <span>Refresh হচ্ছে...</span>
          </div>
        )}

        {/* Page content */}
        <main
          ref={mainRef}
          key={pathname}
          className="flex-1 overflow-y-auto page-enter"
          style={{
            padding: '20px',
            paddingBottom: '20px',
            transform: pullOffset > 0 ? `translateY(${pullOffset}px)` : undefined,
            transition: pulling ? 'none' : 'transform 0.3s ease',
          }}
        >
          {children}
          {/* Bottom padding for mobile nav */}
          <div className="md:hidden" style={{ height: '80px' }} />
        </main>
      </div>

      {/* ── Bottom navigation (mobile only) ─────────────────────────────── */}
      <nav className="bottom-nav md:hidden">
        {BOTTOM_NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href ||
            (href !== '/dashboard' && pathname?.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`bottom-nav-item ${active ? 'active' : ''}`}
              aria-label={label}
            >
              <span className="bottom-nav-icon">
                <Icon size={20} />
              </span>
              <span style={{ fontSize: 10 }}>{label}</span>
            </Link>
          )
        })}
        {/* More button */}
        <button
          className={`bottom-nav-item ${mobileOpen ? 'active' : ''}`}
          onClick={openMobile}
          aria-label="More"
        >
          <span className="bottom-nav-icon">
            <MoreHorizontal size={20} />
          </span>
          <span style={{ fontSize: 10 }}>More</span>
        </button>
      </nav>
    </div>
  )
}
