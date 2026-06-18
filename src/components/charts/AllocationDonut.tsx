import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { fmtCurrency, fmtPercent } from '../../lib/format'

export interface DonutSlice {
  label: string
  value: number
  color: string
}

/** Spend-allocation donut with a centered total + a compact legend. */
export function AllocationDonut({
  slices,
  size = 168,
  centerLabel = 'Spend',
}: {
  slices: DonutSlice[]
  size?: number
  centerLabel?: string
}) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  return (
    <div className="flex items-center gap-5">
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`Spend allocation by client — total ${fmtCurrency(total, { compact: true })} across ${slices.length} ${slices.length === 1 ? 'client' : 'clients'}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius={size * 0.34}
              outerRadius={size * 0.48}
              paddingAngle={2}
              stroke="none"
              startAngle={90}
              endAngle={-270}
            >
              {slices.map((s) => (
                <Cell key={s.label} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums text-ink">{fmtCurrency(total, { compact: true })}</span>
          <span className="text-2xs uppercase tracking-wide text-ink-subtle">{centerLabel}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="truncate text-ink-muted">{s.label}</span>
            </span>
            <span className="shrink-0 font-medium tabular-nums text-ink-subtle">{fmtPercent((s.value / (total || 1)) * 100, 0)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
