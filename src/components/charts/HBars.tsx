import { cn } from '../../lib/cn'

export interface HBarItem {
  label: string
  value: number
  display: string
  sub?: string
  tone?: string
}

/** Horizontal comparison bars — themeable, no chart lib. Used for cohort / breakdown
 *  comparisons (CPA by angle, spend by format, etc.). */
export function HBars({ items, className }: { items: HBarItem[]; className?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className={cn('space-y-2.5', className)}>
      {items.map((it) => (
        <div key={it.label} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-ink">{it.label}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
              {it.display}
              {it.sub && <span className="ml-1.5 text-2xs font-normal text-ink-subtle">{it.sub}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(it.value / max) * 100}%`, background: it.tone ?? 'rgb(var(--brand))' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
