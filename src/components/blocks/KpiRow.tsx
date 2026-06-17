import { KpiTile } from '../ui/KpiTile'
import { kpiDelta } from '../../lib/metrics'
import { fmtMetric, KPI_LABELS } from '../../lib/format'
import { METRIC_COLOR } from '../../lib/palette'
import type { MetricsBundle, TimeseriesPoint } from '../../lib/types'
import { cn } from '../../lib/cn'

export interface KpiRowProps {
  current: MetricsBundle
  previous: MetricsBundle
  series?: TimeseriesPoint[]
  keys: (keyof MetricsBundle)[]
  targets?: { cpa?: number; roas?: number }
  columns?: string
}

export function KpiRow({ current, previous, series, keys, targets, columns }: KpiRowProps) {
  return (
    <div className={cn('grid gap-3', columns ?? 'grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4')}>
      {keys.map((key) => {
        const delta = kpiDelta(key, current[key], previous[key])
        const spark = series?.map((p) => p[key] as number)
        const accent = METRIC_COLOR[key as string] ?? 'rgb(var(--brand))'
        let target: React.ReactNode = undefined
        if (key === 'cpa' && targets?.cpa) {
          const ok = current.cpa > 0 && current.cpa <= targets.cpa
          target = (
            <span className={cn('font-medium', ok ? 'text-success' : 'text-warning')}>
              Target {fmtMetric('cpa', targets.cpa)} {ok ? '✓' : ''}
            </span>
          )
        } else if (key === 'roas' && targets?.roas) {
          const ok = current.roas >= targets.roas
          target = (
            <span className={cn('font-medium', ok ? 'text-success' : 'text-warning')}>
              Target {targets.roas.toFixed(2)}× {ok ? '✓' : ''}
            </span>
          )
        }
        return (
          <KpiTile
            key={key as string}
            label={KPI_LABELS[key as string] ?? (key as string)}
            value={fmtMetric(key as string, current[key])}
            delta={delta}
            spark={spark}
            sparkTone={accent}
            accent={accent}
            target={target}
          />
        )
      })}
    </div>
  )
}
