import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Sparkles, TrendingUp } from 'lucide-react'
import { PageHeader } from '../components/blocks/PageHeader'
import { KpiRow } from '../components/blocks/KpiRow'
import { PerformanceTrendCard } from '../components/blocks/PerformanceTrendCard'
import { SuggestionCard } from '../components/blocks/SuggestionCard'
import { AllocationDonut } from '../components/charts/AllocationDonut'
import { Avatar, EmptyState, SectionHeader, StatusBadge } from '../components/ui/primitives'
import { Sparkline } from '../components/charts/Sparkline'
import { useSnapshot } from '../app/hooks'
import { useStore } from '../app/store'
import {
  adIdsForScope,
  clientsForScope,
  insightsForAdIds,
  metricsForScope,
} from '../lib/selectors'
import { previousRange, timeseries } from '../lib/metrics'
import { analyzeScope } from '../lib/ai/engine'
import { fmtCurrency, fmtNumber, fmtPercent, fmtRoas } from '../lib/format'
import { seriesColor } from '../lib/palette'
import { cn } from '../lib/cn'
import type { Scope } from '../lib/types'

export function PortfolioOverview({ scope }: { scope: Scope }) {
  const snapshot = useSnapshot()!
  const range = useStore((s) => s.range)
  const setScope = useStore((s) => s.setScope)
  const dismissed = useStore((s) => s.dismissedSuggestionIds)

  const data = useMemo(() => {
    const prev = previousRange(range)
    const adIds = adIdsForScope(snapshot, scope)
    const insights = insightsForAdIds(snapshot, adIds)
    const current = metricsForScope(snapshot, scope, range)
    const previous = metricsForScope(snapshot, scope, prev)
    const series = timeseries(insights, range)
    const clients = clientsForScope(snapshot, scope)
    const clientRows = clients
      .map((c) => {
        const cs: Scope = { kind: 'client', clientId: c.id }
        const m = metricsForScope(snapshot, cs, range)
        const mp = metricsForScope(snapshot, cs, prev)
        const cts = timeseries(insightsForAdIds(snapshot, adIdsForScope(snapshot, cs)), range)
        return { client: c, m, mp, spark: cts.map((p) => p.spend) }
      })
      .sort((a, b) => b.m.spend - a.m.spend)
    const suggestions = analyzeScope(snapshot, scope).filter((s) => !dismissed.has(s.id))
    const allocation = clientRows
      .filter((r) => r.m.spend > 0)
      .map((r, i) => ({ label: r.client.name, value: r.m.spend, color: r.client.accentColor || seriesColor(i) }))
    return { current, previous, series, clientRows, suggestions, allocation }
  }, [snapshot, scope, range, dismissed])

  const critical = data.suggestions.filter((s) => s.severity === 'critical' || s.severity === 'high').length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={scope.kind === 'bm' ? 'Business manager' : 'Portfolio'}
        title="Command Overview"
        subtitle={`${data.clientRows.length} clients · ${fmtNumber(data.current.purchases)} orders · ${data.suggestions.length} open recommendations`}
        actions={
          <Link to="/recommendations" className="btn-primary">
            <Sparkles className="h-4 w-4" />
            {critical} priority {critical === 1 ? 'action' : 'actions'}
          </Link>
        }
      />

      <KpiRow
        current={data.current}
        previous={data.previous}
        series={data.series}
        keys={['spend', 'purchases', 'cpa', 'roas']}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PerformanceTrendCard series={data.series} subtitle="Blended across selected clients" />
        </div>
        <div className="card p-5">
          <SectionHeader title="Spend allocation" subtitle="By client, this period" />
          <div className="mt-5">
            {data.allocation.length ? (
              <AllocationDonut slices={data.allocation.slice(0, 7)} />
            ) : (
              <EmptyState title="No spend in range" />
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* clients table */}
        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <SectionHeader title="Clients" />
            <Link to="/clients" className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              View all <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 text-right font-medium">Spend</th>
                  <th className="px-3 py-2.5 text-right font-medium">Orders</th>
                  <th className="px-3 py-2.5 text-right font-medium">CPA</th>
                  <th className="px-3 py-2.5 text-right font-medium">ROAS</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">CTR</th>
                  <th className="hidden px-3 py-2.5 text-center font-medium lg:table-cell">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.clientRows.map(({ client, m, spark }) => {
                  const onCpa = m.cpa > 0 && m.cpa <= client.targetCPA
                  const onRoas = m.roas >= client.targetROAS
                  return (
                    <tr
                      key={client.id}
                      onClick={() => setScope({ kind: 'client', clientId: client.id })}
                      className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar monogram={client.monogram} color={client.accentColor} size={30} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink">{client.name}</div>
                            <div className="truncate text-2xs text-ink-subtle">{client.vertical}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums text-ink">{fmtCurrency(m.spend, { compact: true })}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-muted">{fmtNumber(m.purchases)}</td>
                      <td className={cn('px-3 py-3 text-right font-semibold tabular-nums', onCpa ? 'text-success' : 'text-warning')}>
                        {m.cpa > 0 ? fmtCurrency(m.cpa, { decimals: 2 }) : '—'}
                      </td>
                      <td className={cn('px-3 py-3 text-right tabular-nums', onRoas ? 'text-success' : 'text-ink-muted')}>{fmtRoas(m.roas)}</td>
                      <td className="hidden px-3 py-3 text-right tabular-nums text-ink-muted md:table-cell">{fmtPercent(m.ctr)}</td>
                      <td className="hidden px-3 py-3 lg:table-cell">
                        <div className="flex justify-center">
                          <Sparkline data={spark} tone={client.accentColor} width={72} height={24} fill={false} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* priority actions */}
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <SectionHeader title="Priority actions" />
            <Link to="/recommendations" className="text-xs font-medium text-brand hover:underline">
              All
            </Link>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: 640 }}>
            {data.suggestions.length ? (
              data.suggestions.slice(0, 5).map((s) => <SuggestionCard key={s.id} s={s} />)
            ) : (
              <EmptyState icon={<TrendingUp className="h-6 w-6" />} title="All clear" hint="No high-priority actions in this window." />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
