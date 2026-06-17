import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import type { KpiDelta } from '../../lib/types'
import { Delta } from './primitives'
import { Sparkline } from '../charts/Sparkline'

/** Headline metric card: label, big value, period delta, optional spark + target. */
export function KpiTile({
  label,
  value,
  delta,
  spark,
  sparkTone,
  target,
  hint,
  accent,
  className,
}: {
  label: string
  value: string
  delta?: KpiDelta
  spark?: number[]
  sparkTone?: string
  target?: ReactNode
  hint?: ReactNode
  accent?: string
  className?: string
}) {
  return (
    <div className={cn('card relative overflow-hidden p-4', className)}>
      {accent && <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: accent }} />}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        {delta && <Delta d={delta} />}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tracking-tight tnum text-ink">{value}</span>
        {spark && spark.length > 1 && <Sparkline data={spark} tone={sparkTone ?? accent ?? 'rgb(var(--brand))'} width={84} height={30} />}
      </div>
      {(target || hint) && (
        <div className="mt-2 flex items-center justify-between gap-2 text-2xs text-ink-subtle">
          {target}
          {hint}
        </div>
      )}
    </div>
  )
}
