import { useState } from 'react'
import { TrendChart, type TrendSeries } from '../charts/TrendChart'
import { Segmented, SectionHeader } from '../ui/primitives'
import { C } from '../../lib/palette'
import type { TimeseriesPoint } from '../../lib/types'

type View = 'volume' | 'efficiency' | 'engagement'

const VIEWS: Record<View, TrendSeries[]> = {
  volume: [
    { key: 'spend', label: 'Spend', color: C.brand, type: 'area', yAxis: 'left' },
    { key: 'purchases', label: 'Orders', color: C.teal, type: 'line', yAxis: 'right' },
  ],
  efficiency: [
    { key: 'cpa', label: 'CPA', color: C.warning, type: 'line', yAxis: 'left' },
    { key: 'roas', label: 'ROAS', color: C.success, type: 'line', yAxis: 'right' },
  ],
  engagement: [
    { key: 'ctr', label: 'CTR', color: C.info, type: 'line', yAxis: 'left' },
    { key: 'cpm', label: 'CPM', color: C.pink, type: 'line', yAxis: 'right' },
  ],
}

export function PerformanceTrendCard({
  series,
  title = 'Performance trend',
  subtitle,
  defaultView = 'volume',
  height = 280,
}: {
  series: TimeseriesPoint[]
  title?: string
  subtitle?: string
  defaultView?: View
  height?: number
}) {
  const [view, setView] = useState<View>(defaultView)
  return (
    <div className="card p-5">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        action={
          <Segmented<View>
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'volume', label: 'Volume' },
              { value: 'efficiency', label: 'Efficiency' },
              { value: 'engagement', label: 'Engagement' },
            ]}
          />
        }
      />
      <div className="mt-4" role="img" aria-label={`${title}: ${VIEWS[view].map((s) => s.label).join(' and ')} over ${series.length} days`}>
        <TrendChart data={series} series={VIEWS[view]} height={height} showRightAxis />
      </div>
    </div>
  )
}
