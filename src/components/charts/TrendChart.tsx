import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TimeseriesPoint } from '../../lib/types'
import { fmtMetric, KPI_LABELS } from '../../lib/format'
import { fmtShort } from '../../lib/metrics'

export interface TrendSeries {
  key: keyof TimeseriesPoint
  label?: string
  color: string
  type?: 'area' | 'line'
  yAxis?: 'left' | 'right'
}

function TooltipContent({ active, payload, label, series }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-surface-3/95 px-3 py-2 shadow-pop backdrop-blur">
      <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">{fmtShort(label)}</div>
      <div className="space-y-1">
        {payload.map((p: any) => {
          const s = series.find((x: TrendSeries) => x.key === p.dataKey)
          return (
            <div key={p.dataKey} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-ink-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                {s?.label ?? KPI_LABELS[p.dataKey] ?? p.dataKey}
              </span>
              <span className="font-semibold tabular-nums text-ink">{fmtMetric(p.dataKey, p.value)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TrendChart({
  data,
  series,
  height = 260,
  showRightAxis = false,
}: {
  data: TimeseriesPoint[]
  series: TrendSeries[]
  height?: number
  showRightAxis?: boolean
}) {
  const tickEvery = Math.max(1, Math.floor(data.length / 6))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: showRightAxis ? 4 : 8, bottom: 0, left: -16 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key as string} id={`grad-${s.key as string}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => fmtShort(d)}
          interval={tickEvery - 1}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis yAxisId="left" tickLine={false} axisLine={false} width={48} tickFormatter={(v) => compact(v)} />
        {showRightAxis && (
          <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={44} tickFormatter={(v) => compact(v)} />
        )}
        <Tooltip content={<TooltipContent series={series} />} cursor={{ stroke: 'rgb(var(--line-strong))', strokeWidth: 1 }} />
        {series.map((s) =>
          (s.type ?? 'area') === 'area' ? (
            <Area
              key={s.key as string}
              yAxisId={s.yAxis ?? 'left'}
              type="monotone"
              dataKey={s.key as string}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#grad-${s.key as string})`}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 0 }}
            />
          ) : (
            <Line
              key={s.key as string}
              yAxisId={s.yAxis ?? 'left'}
              type="monotone"
              dataKey={s.key as string}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 0 }}
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function compact(v: number): string {
  if (Math.abs(v) >= 1000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  return String(Math.round(v))
}
