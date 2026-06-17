import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { deltaIsGood } from '../../lib/metrics'
import { fmtDeltaPct } from '../../lib/format'
import type { EntityStatus, KpiDelta, Severity } from '../../lib/types'

/* ---------------- Avatar (client monogram) ---------------- */
export function Avatar({
  monogram,
  color,
  size = 32,
  className,
}: {
  monogram: string
  color: string
  size?: number
  className?: string
}) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, ${color}, ${color}aa)`,
        boxShadow: `inset 0 0 0 1px ${color}55`,
      }}
    >
      {monogram}
    </span>
  )
}

/* ---------------- Status badge ---------------- */
const STATUS_STYLES: Record<EntityStatus, { label: string; cls: string }> = {
  ACTIVE: { label: 'Active', cls: 'text-success bg-success/10 ring-success/20' },
  PAUSED: { label: 'Paused', cls: 'text-ink-subtle bg-ink-subtle/10 ring-ink-subtle/20' },
  LEARNING: { label: 'Learning', cls: 'text-info bg-info/10 ring-info/20' },
  LEARNING_LIMITED: { label: 'Learning Limited', cls: 'text-warning bg-warning/10 ring-warning/20' },
  ARCHIVED: { label: 'Archived', cls: 'text-ink-subtle bg-ink-subtle/10 ring-ink-subtle/20' },
}

export function StatusBadge({ status, className }: { status: EntityStatus; className?: string }) {
  const s = STATUS_STYLES[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset', s.cls, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  )
}

/* ---------------- Severity dot ---------------- */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'bg-danger',
  high: 'bg-warning',
  medium: 'bg-info',
  low: 'bg-ink-subtle',
}
export const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'text-danger',
  high: 'text-warning',
  medium: 'text-info',
  low: 'text-ink-subtle',
}

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  return <span className={cn('h-2 w-2 rounded-full', SEVERITY_COLOR[severity], className)} />
}

/* ---------------- Chip ---------------- */
export function Chip({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode
  tone?: 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'info'
  className?: string
}) {
  const tones: Record<string, string> = {
    default: 'border-line bg-surface-2 text-ink-muted',
    brand: 'border-brand/30 bg-brand/10 text-brand',
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    danger: 'border-danger/30 bg-danger/10 text-danger',
    info: 'border-info/30 bg-info/10 text-info',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}

/* ---------------- Delta pill ---------------- */
export function Delta({ d, className, invertColor }: { d: KpiDelta; className?: string; invertColor?: boolean }) {
  let good = deltaIsGood(d)
  if (invertColor && good !== null) good = !good
  const tone = good === null ? 'text-ink-subtle' : good ? 'text-success' : 'text-danger'
  const Icon = d.delta === 0 ? Minus : d.delta > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold tnum', tone, className)}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      {fmtDeltaPct(Math.abs(d.deltaPct))}
    </span>
  )
}

/* ---------------- Confidence bar ---------------- */
export function ConfidenceBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100)
  const tone = value >= 0.8 ? 'bg-success' : value >= 0.65 ? 'bg-teal' : value >= 0.5 ? 'bg-warning' : 'bg-ink-subtle'
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-2xs font-medium tabular-nums text-ink-muted">{pct}%</span>
    </div>
  )
}

/* ---------------- Progress ring (pacing) ---------------- */
export function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  tone = 'rgb(var(--brand))',
  children,
}: {
  value: number
  size?: number
  stroke?: number
  tone?: string
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, value))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--surface-3))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <span className="absolute text-2xs font-semibold tabular-nums text-ink">{children}</span>
    </div>
  )
}

/* ---------------- Skeleton ---------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />
}

/* ---------------- Empty state ---------------- */
export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface/40 px-6 py-12 text-center">
      {icon && <div className="text-ink-subtle">{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {hint && <div className="max-w-sm text-xs text-ink-muted">{hint}</div>}
    </div>
  )
}

/* ---------------- Section header ---------------- */
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  action,
  className,
}: {
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div>
        {eyebrow && <div className="label-eyebrow mb-1">{eyebrow}</div>}
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/* ---------------- Segmented control ---------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md font-medium transition-colors focus-ring',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-surface-3 text-ink shadow-soft' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------- Tooltip (lightweight) ---------------- */
export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface-3 px-2 py-1 text-2xs text-ink opacity-0 shadow-pop transition-opacity duration-150 group-hover/tt:opacity-100">
        {label}
      </span>
    </span>
  )
}
