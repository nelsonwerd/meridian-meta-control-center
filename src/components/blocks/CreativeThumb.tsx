import { useState } from 'react'
import { Film, Image as ImageIcon, Layers, Play } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Chip } from '../ui/primitives'
import { DIAGNOSIS_META } from '../../lib/labels'
import { fmtCurrency, fmtPercent } from '../../lib/format'
import type { CreativePerformance } from '../../lib/types'

const FORMAT_ICON = { video: Film, image: ImageIcon, carousel: Layers }

/** Where a creative actually runs. A creative is often shared by several ads, so
 *  this is either one ad's name or a count — never a single ad passed off as the
 *  whole story. */
export interface CreativePlacement {
  label: string
  sub?: string
}

/** Creative card: the real asset when Meta gives us one, the angle-keyed gradient
 *  when it doesn't (always in demo, and whenever a signed CDN URL has expired). */
export function CreativeThumb({
  perf,
  targetCPA,
  onClick,
  placement,
}: {
  perf: CreativePerformance
  targetCPA: number
  onClick?: () => void
  placement?: CreativePlacement
}) {
  const { creative: c, metrics: m, diagnosis } = perf
  const [imgFailed, setImgFailed] = useState(false)
  const Icon = FORMAT_ICON[c.format]
  const diag = DIAGNOSIS_META[diagnosis]
  const onCpa = m.cpa > 0 && m.cpa <= targetCPA
  const [from, to] = c.thumbnailGradient
  const showImage = Boolean(c.thumbnailUrl) && !imgFailed
  return (
    <button
      onClick={onClick}
      title={onClick ? `${c.name} — open details` : c.name}
      className={cn(
        'card group block w-full overflow-hidden p-0 text-left transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop focus-ring',
      )}
    >
      {/* thumbnail — gradient is the backdrop, so a slow or failed image never
          flashes an empty box */}
      <div className="relative aspect-[4/5] w-full overflow-hidden" style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}>
        {showImage && (
          <img
            src={c.thumbnailUrl}
            alt=""
            loading="lazy"
            // don't leak the page URL to Meta's CDN; treat expiry as "no image"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-black/10" />
        {/* over a real image, only video keeps the centred affordance — the
            format icon would just cover the creative it is describing */}
        {(!showImage || c.format === 'video') && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm ring-1 ring-white/25">
              {c.format === 'video' ? <Play className="h-5 w-5 translate-x-0.5 fill-white" /> : <Icon className="h-5 w-5" />}
            </span>
          </div>
        )}
        <div className="absolute left-2 top-2 flex items-center gap-1">
          <span className="rounded-md bg-black/35 px-1.5 py-0.5 text-2xs font-medium text-white backdrop-blur-sm">{c.ratio}</span>
          {c.durationSec && <span className="rounded-md bg-black/35 px-1.5 py-0.5 text-2xs font-medium text-white backdrop-blur-sm">{c.durationSec}s</span>}
        </div>
        <div className="absolute right-2 top-2">
          <Chip tone={diag.tone} className="border-0 bg-black/35 px-1.5 py-0.5 text-2xs text-white backdrop-blur-sm">
            {diag.label}
          </Chip>
        </div>
        {/* the creative's own name identifies it; angle/batch are our derived
            classification and belong underneath it, not in place of it */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5 pt-6">
          <div className="truncate text-xs font-semibold text-white">{c.name}</div>
          <div className="truncate text-2xs text-white/70">
            {c.angle} · {c.batch}
          </div>
        </div>
      </div>
      {/* metrics */}
      <div className="grid grid-cols-3 divide-x divide-line">
        <Metric label="CPA" value={m.cpa > 0 ? fmtCurrency(m.cpa, { decimals: 0 }) : '—'} tone={onCpa ? 'text-success' : 'text-warning'} />
        <Metric label="CTR" value={fmtPercent(m.ctr)} />
        <Metric label="Spend" value={fmtCurrency(m.spend, { compact: true })} />
      </div>
      {placement && (
        <div className="border-t border-line px-2.5 py-2">
          <div className="truncate text-2xs font-medium text-ink-muted">{placement.label}</div>
          {placement.sub && <div className="truncate text-2xs text-ink-subtle">{placement.sub}</div>}
        </div>
      )}
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
