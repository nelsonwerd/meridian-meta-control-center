import { useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, Download, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { PageHeader } from '../components/blocks/PageHeader'
import { SuggestionCard } from '../components/blocks/SuggestionCard'
import { CreativeThumb } from '../components/blocks/CreativeThumb'
import { Avatar, Delta, EmptyState, ProgressRing, SectionHeader } from '../components/ui/primitives'
import { useSnapshot } from '../app/hooks'
import { useStore } from '../app/store'
import { clientsForScope } from '../lib/selectors'
import { buildWeeklyReport, lastCompletedWeek } from '../lib/ai/report'
import { fmtCurrency, fmtMetric, KPI_LABELS } from '../lib/format'
import { fmtFull } from '../lib/metrics'
import { cn } from '../lib/cn'
import type { Client, WeeklyReport } from '../lib/types'

export function WeeklyReportScreen() {
  const snapshot = useSnapshot()!
  const scope = useStore((s) => s.scope)
  const pushToast = useStore((s) => s.pushToast)
  const clients = clientsForScope(snapshot, scope)
  const [selected, setSelected] = useState<string | null>(scope.kind === 'client' ? scope.clientId : null)
  const week = lastCompletedWeek()

  const client = selected ? snapshot.clientById.get(selected) : null

  if (client) {
    return (
      <ReportView
        client={client}
        onBack={clients.length > 1 ? () => setSelected(null) : undefined}
        onShare={() => pushToast('success', `${client.name} weekly report exported (simulated).`)}
      />
    )
  }

  return <Digest clients={clients} week={week} onOpen={setSelected} />
}

/* ---------------- Portfolio Monday digest ---------------- */
function Digest({ clients, week, onOpen }: { clients: Client[]; week: { start: string; end: string }; onOpen: (id: string) => void }) {
  const snapshot = useSnapshot()!
  const reports = useMemo(() => clients.map((c) => ({ c, r: buildWeeklyReport(snapshot, c.id) })), [snapshot, clients])
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Monday digest"
        title="Weekly Reports"
        subtitle={`Week of ${fmtFull(week.start)} – ${fmtFull(week.end)}. One designed report per client, ready to read or send.`}
        actions={<span className="chip"><CalendarDays className="h-3.5 w-3.5" /> {clients.length} reports</span>}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {reports.map(({ c, r }) => {
          // Icon follows the report's computed sentiment, so it can never disagree
          // with the headline (e.g. an "up" arrow over a "soft week" headline).
          const dirStyle =
            r.direction === 'positive' ? 'bg-success/10 text-success' : r.direction === 'caution' ? 'bg-warning/10 text-warning' : 'bg-surface-3 text-ink-muted'
          const DirIcon = r.direction === 'positive' ? TrendingUp : r.direction === 'caution' ? TrendingDown : Minus
          return (
            <button
              key={c.id}
              onClick={() => onOpen(c.id)}
              className="card group p-5 text-left transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
            >
              <div className="flex items-center gap-3">
                <Avatar monogram={c.monogram} color={c.accentColor} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{c.name}</div>
                  <div className="text-2xs text-ink-subtle">{c.vertical}</div>
                </div>
                <span className={cn('grid h-8 w-8 place-items-center rounded-lg', dirStyle)}>
                  <DirIcon className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-3 text-sm font-medium text-ink">{r.headline}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted line-clamp-2">{r.summary}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
                <DigestStat label="Orders" value={fmtMetric('purchases', r.current.purchases)} d={r.kpis.purchases} />
                <DigestStat label="CPA" value={fmtMetric('cpa', r.current.cpa)} d={r.kpis.cpa} />
                <DigestStat label="ROAS" value={fmtMetric('roas', r.current.roas)} d={r.kpis.roas} />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DigestStat({ label, value, d }: { label: string; value: string; d: WeeklyReport['kpis'][string] }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-ink">{value}</span>
        <Delta d={d} className="text-2xs" />
      </div>
    </div>
  )
}

/* ---------------- Full client report ---------------- */
function ReportView({ client, onBack, onShare }: { client: Client; onBack?: () => void; onShare: () => void }) {
  const snapshot = useSnapshot()!
  const r = useMemo(() => buildWeeklyReport(snapshot, client.id), [snapshot, client])
  const kpiKeys = ['spend', 'purchases', 'cpa', 'roas', 'ctr', 'frequency'] as const

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button aria-label="Back to all reports" onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-muted hover:bg-surface-3 hover:text-ink">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <Avatar monogram={client.monogram} color={client.accentColor} size={40} />
          <div>
            <div className="text-lg font-semibold tracking-tight text-ink">{client.name}</div>
            <div className="text-xs text-ink-subtle">Weekly performance review</div>
          </div>
        </div>
        <button onClick={onShare} className="btn-outline">
          <Download className="h-4 w-4" /> Export
        </button>
      </div>

      {/* hero narrative */}
      <div className="card relative overflow-hidden p-6">
        <div className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
        <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
          <CalendarDays className="h-3.5 w-3.5" /> {fmtFull(r.weekStart)} – {fmtFull(r.weekEnd)}
        </div>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{r.headline}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{r.summary}</p>
      </div>

      {/* KPI deltas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpiKeys.map((k) => (
          <div key={k} className="card p-4">
            <div className="text-2xs uppercase tracking-wide text-ink-subtle">{KPI_LABELS[k]}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{fmtMetric(k, r.current[k])}</div>
            <div className="mt-1"><Delta d={r.kpis[k]} /></div>
            <div className="mt-1 text-2xs text-ink-subtle">prior {fmtMetric(k, r.previous[k])}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* movers */}
        <div className="card p-5 lg:col-span-2">
          <SectionHeader title="Top movers" subtitle="Biggest week-over-week shifts" />
          <div className="mt-4 space-y-2">
            {r.topMovers.length ? (
              r.topMovers.map((mv, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                  <span className={cn('grid h-7 w-7 place-items-center rounded-md', mv.direction === 'up' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                    {mv.direction === 'up' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  </span>
                  <span className="flex-1 text-sm text-ink">{mv.label}</span>
                  <span className="text-xs text-ink-muted">{mv.detail}</span>
                </div>
              ))
            ) : (
              <EmptyState title="No significant movers" />
            )}
          </div>
        </div>
        {/* pacing */}
        <div className="card flex flex-col items-center justify-center p-5 text-center">
          <SectionHeader title="Budget pacing" />
          <div className="my-4">
            {r.pacing.budget > 0 ? (
              <ProgressRing value={r.pacing.pace} size={92} stroke={7} tone={r.pacing.pace > 1.1 ? 'rgb(var(--warning))' : 'rgb(var(--success))'}>
                {Math.round(r.pacing.pace * 100)}%
              </ProgressRing>
            ) : (
              <ProgressRing value={0} size={92} stroke={7} tone="rgb(var(--ink-subtle))">
                —
              </ProgressRing>
            )}
          </div>
          <div className="text-sm text-ink-muted">
            {r.pacing.budget > 0 ? (
              <>
                Projected <span className="font-semibold text-ink">{fmtCurrency(r.pacing.projection, { compact: true })}</span> of {fmtCurrency(r.pacing.budget, { compact: true })}
              </>
            ) : (
              <>no monthly budget set</>
            )}
          </div>
        </div>
      </div>

      {/* creative leaderboard */}
      <div className="card p-5">
        <SectionHeader title="Creative leaderboard" subtitle="Best performers this week" />
        {r.creativeLeaderboard.length ? (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {r.creativeLeaderboard.map((p) => (
              <CreativeThumb key={p.creative.id} perf={p} targetCPA={client.targetCPA} />
            ))}
          </div>
        ) : (
          <EmptyState title="No creative data this week" />
        )}
      </div>

      {/* recommended changes */}
      <div>
        <SectionHeader title="Recommended changes" subtitle="Apply directly or take into your Monday planning" className="mb-4" />
        {r.recommendations.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {r.recommendations.map((s) => (
              <SuggestionCard key={s.id} s={s} showClient={false} />
            ))}
          </div>
        ) : (
          <EmptyState title="No changes recommended" hint="Steady week — hold course." />
        )}
      </div>
    </div>
  )
}
