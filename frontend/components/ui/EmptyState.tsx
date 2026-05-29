import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  illustration?: 'inbox' | 'orders' | 'products' | 'conversations' | 'analytics' | 'search'
  className?: string
  compact?: boolean
}

const ILLUSTRATIONS: Record<string, () => JSX.Element> = {
  inbox: () => (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <rect x="10" y="20" width="60" height="45" rx="4" fill="var(--c-border)" />
      <rect x="10" y="20" width="60" height="12" rx="4" fill="var(--c-text-3)" opacity=".4" />
      <path d="M10 32 40 50 70 32" stroke="var(--c-card)" strokeWidth="2" fill="none" />
      <circle cx="58" cy="22" r="10" fill="var(--c-accent)" />
      <path d="M55 22h6M58 19v6" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  orders: () => (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <rect x="15" y="15" width="50" height="55" rx="4" fill="var(--c-border)" />
      <rect x="22" y="28" width="36" height="3" rx="1.5" fill="var(--c-text-3)" opacity=".5" />
      <rect x="22" y="36" width="28" height="3" rx="1.5" fill="var(--c-text-3)" opacity=".4" />
      <rect x="22" y="44" width="32" height="3" rx="1.5" fill="var(--c-text-3)" opacity=".3" />
      <circle cx="40" cy="18" r="5" fill="var(--c-card)" stroke="var(--c-border)" strokeWidth="2" />
      <path d="M37 18l2 2 4-4" stroke="var(--c-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  products: () => (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <rect x="12" y="32" width="56" height="36" rx="4" fill="var(--c-border)" />
      <rect x="24" y="20" width="32" height="20" rx="4" fill="var(--c-text-3)" opacity=".4" />
      <circle cx="32" cy="52" r="5" fill="var(--c-card)" />
      <circle cx="48" cy="52" r="5" fill="var(--c-card)" />
      <path d="M28 40h24" stroke="var(--c-card)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  conversations: () => (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <rect x="8" y="15" width="46" height="32" rx="6" fill="var(--c-border)" />
      <rect x="14" y="25" width="34" height="3" rx="1.5" fill="var(--c-text-3)" opacity=".5" />
      <rect x="14" y="33" width="22" height="3" rx="1.5" fill="var(--c-text-3)" opacity=".4" />
      <path d="M12 47l4 6h16" stroke="var(--c-border)" strokeWidth="2" fill="var(--c-border)" />
      <rect x="28" y="38" width="44" height="28" rx="6" fill="var(--c-accent)" opacity=".15" />
      <rect x="35" y="46" width="30" height="3" rx="1.5" fill="var(--c-accent)" opacity=".5" />
      <rect x="35" y="54" width="20" height="3" rx="1.5" fill="var(--c-accent)" opacity=".4" />
    </svg>
  ),
  analytics: () => (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <rect x="10" y="55" width="12" height="15" rx="2" fill="var(--c-border)" />
      <rect x="28" y="40" width="12" height="30" rx="2" fill="var(--c-text-3)" opacity=".5" />
      <rect x="46" y="28" width="12" height="42" rx="2" fill="var(--c-accent)" opacity=".4" />
      <rect x="64" y="18" width="12" height="52" rx="2" fill="var(--c-accent)" opacity=".7" />
      <path d="M10 55 28 42 46 30 64 20" stroke="var(--c-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  search: () => (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <circle cx="36" cy="36" r="22" fill="var(--c-border)" />
      <circle cx="36" cy="36" r="16" fill="var(--c-card)" stroke="var(--c-text-3)" strokeWidth="2" opacity=".8" />
      <path d="M52 52l14 14" stroke="var(--c-text-3)" strokeWidth="3" strokeLinecap="round" />
      <path d="M30 36h12M36 30v12" stroke="var(--c-text-3)" strokeWidth="2" strokeLinecap="round" opacity=".5" />
    </svg>
  ),
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  illustration,
  className,
  compact = false,
}: EmptyStateProps) {
  const IllustrationEl = illustration ? ILLUSTRATIONS[illustration] : null

  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center anim-fade-in',
      compact ? 'py-8 space-y-2' : 'py-16 space-y-4',
      className,
    )}>
      {IllustrationEl ? (
        <div className="mb-2 empty-icon">
          <IllustrationEl />
        </div>
      ) : icon ? (
        <div className="mb-2 empty-icon" style={{ color: 'var(--c-text-3)' }}>{icon}</div>
      ) : null}

      <div className="space-y-1.5">
        <p className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}
           style={{ color: 'var(--c-text)' }}>
          {title}
        </p>
        {description && (
          <p className="text-sm max-w-xs" style={{ color: 'var(--c-text-2)' }}>
            {description}
          </p>
        )}
      </div>

      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}
