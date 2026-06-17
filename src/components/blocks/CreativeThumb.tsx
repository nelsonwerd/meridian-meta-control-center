import { Film, Image as ImageIcon, Layers, Play } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Chip } from '../ui/primitives'
import { DIAGNOSIS_META } from '../../lib/labels'
import { fmtCurrency, fmtPercent } from '../../lib/format'
import type { CreativePerformance } from '../../lib/types'

const FORMAT_ICON = { video: Film, image: ImageIcon, carousel: Layers }

/** Creative card with a placeholder thumbnail (no real asset in demo), diagnosis
 *  badge, and the headline metrics. */
export function CreativeThumb({
  perf,
  targetCPA,
  onClick,
}: {
  perf: CreativePerformance
  targetCPA: number
  onClick?: () => void
}) {
  const { creative: c, metrics: m, diagnosis } = perf
  const Icon = FORMAT_ICON[c.format]
  const diag = DIAGNOSIS_META[diagnosis]
  const onCpa = m.cpa > 0 && m.cpa <= targetCPA
  const [from, to] = c.thumbnailGradient
  return (
    <button
      onClick={onClick}
      className={cn(
        'card group block overflow-hidden p-0 text-left transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop',
      )}
    >
      {/* thumbnail */}
      <div className="relative aspect-[4/5] w-full overflow-hidden" style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}>
        <div className="absolute inset-0 bg-black/10" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm ring-1 ring-white/25">
            {c.format === 'video' ? <Play className="h-5 w-5 translate-x-0.5 fill-white" /> : <Icon className="h-5 w-5" />}
          </span>
        </div>
        <div className="absolute left-2 top-2 flex items-center gap-1">
          <span className="rounded-md bg-black/35 px-1.5 py-0.5 text-2xs font-medium text-white backdrop-blur-sm">{c.ratio}</span>
          {c.durationSec && <span className="rounded-md bg-black/35 px-1.5 py-0.5 text-2xs font-medium text-white backdrop-blur-sm">{c.durationSec}s</span>}
        </div>
        <div className="absolute right-2 top-2">
          <Chip tone={diag.tone} className="border-0 bg-black/35 px-1.5 py-0.5 text-2xs text-white backdrop-blur-sm">
            {diag.label}
          </Chip>
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent p-2.5">
          <div className="truncate text-xs font-semibold text-white">{c.angle}</div>
          <div className="truncate text-2xs text-white/70">{c.batch}</div>
        </div>
      </div>
      {/* metrics */}
      <div className="grid grid-cols-3 divide-x divide-line">
        <Metric label="CPA" value={m.cpa > 0 ? fmtCurrency(m.cpa, { decimals: 0 }) : '—'} tone={onCpa ? 'text-success' : 'text-warning'} />
        <Metric label="CTR" value={fmtPercent(m.ctr)} />
        <Metric label="Spend" value={fmtCurrency(m.spend, { compact: true })} />
      </div>
    </button>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="px-2 py-2 text-center">
      <div className="text-2xs uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', tone ?? 'text-ink')}>{value}</div>
    </div>
  )
}
