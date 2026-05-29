import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  width?: string | number
  height?: string | number
  rounded?: boolean
  style?: React.CSSProperties
}

/** Generic skeleton block */
export function Skeleton({ className, width, height, rounded, style }: SkeletonProps) {
  return (
    <div
      className={cn('skeleton', rounded && 'rounded-full', className)}
      style={{ width, height: height ?? 14, ...style }}
    />
  )
}

/** Skeleton for a stat card — uses the stat-card class for staggered animation */
export function SkeletonStatCard({ index = 0 }: { index?: number }) {
  return (
    <div
      className="card p-5 space-y-3"
      style={{ animation: `floatCard 0.45s cubic-bezier(0.22,1,0.36,1) ${index * 70}ms both` }}
    >
      <div className="flex items-center justify-between">
        <Skeleton width="50%" height={10} />
        <Skeleton width={36} height={36} rounded style={{ borderRadius: 8 }} />
      </div>
      <Skeleton width="45%" height={26} />
      <Skeleton width="30%" height={10} />
    </div>
  )
}

/** Skeleton for a table row */
export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton
            width={i === 0 ? '70%' : i === cols - 1 ? '40%' : '60%'}
            height={12}
          />
        </td>
      ))}
    </tr>
  )
}

/** Skeleton rows for a table body */
export function SkeletonTableRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} cols={cols} />
      ))}
    </>
  )
}

/** Skeleton for a card with text lines */
export function SkeletonCard({ lines = 3, index = 0 }: { lines?: number; index?: number }) {
  return (
    <div
      className="card p-5 space-y-3"
      style={{ animation: `floatUp 0.35s ease-out ${index * 60}ms both` }}
    >
      <Skeleton width="60%" height={14} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '45%' : '100%'} height={11} />
      ))}
    </div>
  )
}

/** Mobile-friendly list skeleton */
export function SkeletonListItem({ index = 0 }: { index?: number }) {
  return (
    <div
      className="card p-4 space-y-2.5"
      style={{ animation: `floatUp 0.3s ease-out ${index * 50}ms both` }}
    >
      <div className="flex items-center justify-between">
        <Skeleton width="55%" height={13} />
        <Skeleton width={60} height={22} style={{ borderRadius: 12 }} />
      </div>
      <div className="flex gap-2">
        <Skeleton width="35%" height={11} />
        <Skeleton width="30%" height={11} />
      </div>
    </div>
  )
}
