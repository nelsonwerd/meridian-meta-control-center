import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, FileBarChart, Images, Target } from 'lucide-react'
import { PageHeader } from '../components/blocks/PageHeader'
import { KpiRow } from '../components/blocks/KpiRow'
import { PerformanceTrendCard } from '../components/blocks/PerformanceTrendCard'
import { SuggestionCard } from '../components/blocks/SuggestionCard'
import { CreativeThumb } from '../components/blocks/CreativeThumb'
import { Avatar, Chip, EmptyState, ProgressRing, SectionHeader, StatusBadge } from '../components/ui/primitives'
import { useSnapshot } from '../app/hooks'
import { useStore } from '../app/store'
import { adIdsForScope, insightsForAdIds, metricsForEntity, metricsForScope } from '../lib/selectors'
import { previousRange, timeseries } from '../lib/metrics'
import { analyzeClient } from '../lib/ai/engine'
import { creativePerformance } from '../lib/ai/creative'
import { buildWeeklyReport } from '../lib/ai/report'
import { fmtCurrency, fmtNumber, fmtPercent, fmtRoas, KPI_LABELS } from '../lib/format'
import { CAMPAIGN_KIND_LABEL } from '../lib/labels'
import { cn } from '../lib/cn'
import type { Client } from '../lib/types'

export function ClientDashboard({ client }: { client: Client }) {
  const snapshot = useSnapshot()!
  const range = useStore((s) => s.range)
  const dismissed = useStore((s) => s.dismissedSuggestionIds)
  const applied = useStore((s) => s.appliedSuggestionIds)
  const bm = snapshot.businessManagers.find((b) => b.id === client.bmId)

  const data = useMemo(() => {
    const scope = { kind: 'client', clientId: client.id } as const
    const prev = previousRange(range)
    const insights = insightsForAdIds(snapshot, adIdsForScope(snapshot, scope))
    const current = metricsForScope(snapshot, scope, range)
    const previous = metricsForScope(snapshot, scope, prev)
    const series = timeseries(insights, range)
    const campaigns = (snapshot.campaignsByClient.get(client.id) ?? [])
      .map((c) => ({
        c,
        m: metricsForEntity(snapshot, 'campaign', c.id, range),
        spark: timeseries(insightsForAdIds(snapshot, adIdsForScope(snapshot, scope).filter((id) => snapshot.adById.get(id)?.campaignId === c.id)), range).map((p) => p.spend),
      }))
      .sort((a, b) => b.m.spend - a.m.spend)
    const suggestions = analyzeClient(snapshot, client.id).filter((s) => !dismissed.has(s.id) && !applied.has(s.id))
    const creatives = creativePerformance(snapshot, client.id, range)
      .filter((p) => p.metrics.purchases > 0)
      .sort((a, b) => a.metrics.cpa - b.metrics.cpa)
      .slice(0, 4)
    const report = buildWeeklyReport(snapshot, client.id)
    return { current, previous, series, campaigns, suggestions, creatives, report }
  }, [snapshot, client, range, dismissed, applied])

  const onCpa = data.current.cpa > 0 && data.current.cpa <= client.targetCPA
  const pacing = data.report.pacing

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={bm?.name}
        title={
          <span className="flex items-center gap-3">
            <Avatar monogram={client.monogram} color={client.accentColor} size={36} />
            {client.name}
          </span>
        }
        subtitle={`${client.vertical} · Target CPA ${fmtCurrency(client.targetCPA, { decimals: 0 })} · ${fmtRoas(client.targetROAS)} ROAS`}
        actions={
          <>
            <Link to="/creatives" className="btn-outline">
              <Images className="h-4 w-4" /> Creative Lab
            </Link>
            <Link to="/report" className="btn-primary">
              <FileBarChart className="h-4 w-4" /> Weekly report
            </Link>
          </>
        }
      />

      <KpiRow
        current={data.current}
        previous={data.previous}
        series={data.series}
        keys={['spend', 'purchases', 'cpa', 'roas']}
        targets={{ cpa: client.targetCPA, roas: client.targetROAS }}
      />

      {/* secondary stat strip */}
      <div className="card grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
        {(['ctr', 'cpc', 'cpm', 'frequency', 'aov', 'cvr'] as const).map((k) => (
          <div key={k} className="px-4 py-3">
            <div className="text-2xs uppercase tracking-wide text-ink-subtle">{KPI_LABELS[k]}</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums text-ink">
              {k === 'frequency' ? data.current.frequency.toFixed(2) : k === 'ctr' || k === 'cvr' ? fmtPercent(data.current[k]) : fmtCurrency(data.current[k], { decimals: 2 })}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PerformanceTrendCard series={data.series} defaultView="efficiency" subtitle={`${client.name} · ${range.label}`} />
        </div>
        <div className="card flex flex-col p-5">
          <SectionHeader title="Monthly pacing" subtitle="Projected vs contracted budget" />
          <div className="mt-4 flex items-center gap-4">
            <ProgressRing value={pacing.pace} size={72} stroke={6} tone={pacing.pace > 1.1 ? 'rgb(var(--warning))' : 'rgb(var(--brand))'}>
              {Math.round(pacing.pace * 100)}%
            </ProgressRing>
            <div className="text-sm">
              <div className="text-ink-muted">Projected spend</div>
              <div className="text-lg font-semibold tabular-nums text-ink">{fmtCurrency(pacing.projection, { compact: true })}</div>
              <div className="text-2xs text-ink-subtle">of {fmtCurrency(pacing.budget, { compact: true })} budget</div>
            </div>
          </div>
          <div className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">MTD spend</span>
              <span className="font-medium tabular-nums text-ink">{fmtCurrency(pacing.spent, { compact: true })}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Target attainment</span>
              <span className={cn('flex items-center gap-1 font-medium', onCpa ? 'text-success' : 'text-warning')}>
                <Target className="h-3.5 w-3.5" /> {onCpa ? 'On target' : 'Above target CPA'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* campaigns */}
        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <SectionHeader title="Campaigns" subtitle={`${data.campaigns.length} active structures`} />
            <Link to="/campaigns" className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              Drill in <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Campaign</th>
                  <th className="px-3 py-2.5 text-right font-medium">Spend</th>
                  <th className="px-3 py-2.5 text-right font-medium">Orders</th>
                  <th className="px-3 py-2.5 text-right font-medium">CPA</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map(({ c, m }) => {
                  const cOnCpa = m.cpa > 0 && m.cpa <= client.targetCPA
                  return (
                    <tr key={c.id} className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2">
                      <td className="px-5 py-3">
                        <div className="font-medium text-ink">{c.name}</div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <Chip tone="default" className="px-1.5 py-0 text-2xs">{CAMPAIGN_KIND_LABEL[c.kind]}</Chip>
                          <Chip tone="default" className="px-1.5 py-0 text-2xs">{c.budgetType}</Chip>
                          <StatusBadge status={c.status} />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums text-ink">{fmtCurrency(m.spend, { compact: true })}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-muted">{fmtNumber(m.purchases)}</td>
                      <td className={cn('px-3 py-3 text-right font-semibold tabular-nums', cOnCpa ? 'text-success' : 'text-warning')}>
                        {m.cpa > 0 ? fmtCurrency(m.cpa, { decimals: 2 }) : '—'}
                      </td>
                      <td className="hidden px-3 py-3 text-right tabular-nums text-ink-muted md:table-cell">{fmtRoas(m.roas)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* suggestions */}
        <div className="card flex flex-col overflow-hidden">
          <div className="border-b border-line px-5 py-3.5">
            <SectionHeader title="Recommended actions" />
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 max-h-[60vh]">
            {data.suggestions.length ? (
              data.suggestions.slice(0, 5).map((s) => <SuggestionCard key={s.id} s={s} showClient={false} />)
            ) : (
              <EmptyState title="No actions" hint="This client is steady in the selected window." />
            )}
          </div>
        </div>
      </div>

      {/* top creatives */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <SectionHeader title="Top creatives" subtitle="Best CPA this period" />
          <Link to="/creatives" className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            Creative Lab <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {data.creatives.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {data.creatives.map((p) => (
              <CreativeThumb key={p.creative.id} perf={p} targetCPA={client.targetCPA} />
            ))}
          </div>
        ) : (
          <EmptyState title="No creative data" />
        )}
      </div>
    </div>
  )
}
