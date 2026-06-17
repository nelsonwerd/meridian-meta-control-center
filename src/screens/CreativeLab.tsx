import { useMemo, useState } from 'react'
import { Beaker, FlaskConical, Lightbulb, Trophy, XCircle } from 'lucide-react'
import { PageHeader } from '../components/blocks/PageHeader'
import { CreativeThumb } from '../components/blocks/CreativeThumb'
import { HBars, type HBarItem } from '../components/charts/HBars'
import { Avatar, Chip, EmptyState, Segmented, SectionHeader } from '../components/ui/primitives'
import { useSnapshot } from '../app/hooks'
import { useStore } from '../app/store'
import { clientsForScope } from '../lib/selectors'
import { creativeCohorts, creativePerformance, nextBatchPlan } from '../lib/ai/creative'
import { fmtCurrency, fmtNumber, fmtPercent } from '../lib/format'
import { DIAGNOSIS_META } from '../lib/labels'
import { cn } from '../lib/cn'
import type { CreativePerformance } from '../lib/types'

type Dim = 'format' | 'angle' | 'batch'
type Metric = 'cpa' | 'ctr' | 'purchases'
type DiagFilter = 'all' | CreativePerformance['diagnosis']

export function CreativeLab() {
  const snapshot = useSnapshot()!
  const scope = useStore((s) => s.scope)
  const range = useStore((s) => s.range)

  const scopeClients = clientsForScope(snapshot, scope)
  const initial = scope.kind === 'client' ? scope.clientId : scopeClients[0]?.id
  const [clientId, setClientId] = useState(initial)
  const client = snapshot.clientById.get(clientId ?? '') ?? scopeClients[0]
  const [dim, setDim] = useState<Dim>('angle')
  const [metric, setMetric] = useState<Metric>('cpa')
  const [diag, setDiag] = useState<DiagFilter>('all')

  const data = useMemo(() => {
    if (!client) return null
    const perf = creativePerformance(snapshot, client.id, range)
    const cohorts = creativeCohorts(snapshot, client.id, range, dim)
    const plan = nextBatchPlan(snapshot, client.id, range)
    const counts = { winner: 0, fatigued: 0, weak: 0 }
    perf.forEach((p) => {
      if (p.diagnosis === 'winner') counts.winner++
      else if (p.diagnosis === 'fatigued') counts.fatigued++
      else if (p.diagnosis === 'hook_weak' || p.diagnosis === 'body_weak' || p.diagnosis === 'convert_weak') counts.weak++
    })
    return { perf, cohorts, plan, counts }
  }, [snapshot, client, range, dim])

  if (!client || !data) return <EmptyState title="No client selected" />

  const bars: HBarItem[] = [...data.cohorts]
    .sort((a, b) => (metric === 'cpa' ? a.metrics.cpa - b.metrics.cpa : b.metrics[metric] - a.metrics[metric]))
    .map((c) => {
      const v = c.metrics[metric]
      const onTarget = metric === 'cpa' && v > 0 && v <= client.targetCPA
      return {
        label: c.label,
        value: metric === 'cpa' ? v : v,
        display: metric === 'cpa' ? fmtCurrency(v, { decimals: 2 }) : metric === 'ctr' ? fmtPercent(v) : fmtNumber(v),
        sub: `${c.count} ${c.count === 1 ? 'ad' : 'ads'}`,
        tone: metric === 'cpa' ? (onTarget ? 'rgb(var(--success))' : 'rgb(var(--warning))') : 'rgb(var(--brand))',
      }
    })

  const gallery = data.perf.filter((p) => diag === 'all' || p.diagnosis === diag)

  const DIAG_FILTERS: { value: DiagFilter; label: string }[] = [
    { value: 'all', label: `All (${data.perf.length})` },
    { value: 'winner', label: 'Winners' },
    { value: 'fatigued', label: 'Fatigued' },
    { value: 'hook_weak', label: 'Weak hook' },
    { value: 'body_weak', label: 'Weak body' },
    { value: 'convert_weak', label: 'Low CVR' },
    { value: 'unproven', label: 'Unproven' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creative intelligence"
        title="Creative Lab"
        subtitle="Performance against the data — by format, angle, and funnel stage — with the next test batch to brief."
        actions={
          scopeClients.length > 1 && (
            <div className="flex items-center gap-1.5">
              {scopeClients.slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setClientId(c.id)}
                  className={cn('rounded-full p-0.5 transition-all', c.id === client.id ? 'ring-2 ring-brand' : 'opacity-60 hover:opacity-100')}
                  title={c.name}
                >
                  <Avatar monogram={c.monogram} color={c.accentColor} size={28} />
                </button>
              ))}
            </div>
          )
        }
      />

      {/* summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat icon={<Beaker className="h-4 w-4" />} label="Creatives live" value={data.perf.length} tone="text-ink" />
        <MiniStat icon={<Trophy className="h-4 w-4" />} label="Clear winners" value={data.counts.winner} tone="text-success" />
        <MiniStat icon={<FlaskConical className="h-4 w-4" />} label="Funnel issues" value={data.counts.weak} tone="text-warning" />
        <MiniStat icon={<XCircle className="h-4 w-4" />} label="Fatigued" value={data.counts.fatigued} tone="text-danger" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* cohort comparison */}
        <div className="card p-5 lg:col-span-2">
          <SectionHeader
            title="Cohort performance"
            subtitle="What's working across the cut"
            action={
              <div className="flex items-center gap-2">
                <Segmented<Metric> size="sm" value={metric} onChange={setMetric} options={[{ value: 'cpa', label: 'CPA' }, { value: 'ctr', label: 'CTR' }, { value: 'purchases', label: 'Orders' }]} />
              </div>
            }
          />
          <div className="mt-3">
            <Segmented<Dim>
              size="sm"
              value={dim}
              onChange={setDim}
              options={[{ value: 'angle', label: 'By angle' }, { value: 'format', label: 'By format' }, { value: 'batch', label: 'By batch' }]}
            />
          </div>
          <div className="mt-5">
            {bars.length ? <HBars items={bars} /> : <EmptyState title="Not enough data" />}
          </div>
        </div>

        {/* next batch plan */}
        <div className="card flex flex-col p-5">
          <SectionHeader title="Next test batch" subtitle="What to brief" />
          <div className="mt-4 space-y-4 text-sm">
            <PlanGroup icon={<Trophy className="h-3.5 w-3.5 text-success" />} title="Double down" items={data.plan.doubleDown.map((d) => ({ head: d.label, body: d.reason }))} empty="No standout winner yet." />
            <PlanGroup icon={<XCircle className="h-3.5 w-3.5 text-danger" />} title="Retire" items={data.plan.retire.map((d) => ({ head: d.label, body: d.reason }))} empty="Nothing to retire." />
            {data.plan.testIdeas.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                  <Lightbulb className="h-3.5 w-3.5 text-brand" /> Test ideas
                </div>
                <ul className="space-y-1.5">
                  {data.plan.testIdeas.map((t, i) => (
                    <li key={i} className="flex gap-2 text-xs text-ink-muted">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* gallery */}
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionHeader title="Creative gallery" subtitle={`${gallery.length} creatives`} />
          <div className="flex flex-wrap gap-1.5">
            {DIAG_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setDiag(f.value)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  diag === f.value ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line bg-surface-2 text-ink-muted hover:text-ink',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {gallery.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {gallery.map((p) => (
              <div key={p.creative.id} className="space-y-2">
                <CreativeThumb perf={p} targetCPA={client.targetCPA} />
                <p className="px-0.5 text-2xs leading-relaxed text-ink-subtle line-clamp-2">{p.diagnosisDetail}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No creatives match" />
        )}
      </div>
    </div>
  )
}

function MiniStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-3 text-ink-muted">{icon}</span>
      <div>
        <div className={cn('text-xl font-semibold tabular-nums', tone)}>{value}</div>
        <div className="text-2xs text-ink-muted">{label}</div>
      </div>
    </div>
  )
}

function PlanGroup({ icon, title, items, empty }: { icon: React.ReactNode; title: string; items: { head: string; body: string }[]; empty: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
        {icon} {title}
      </div>
      {items.length ? (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface-2 p-2.5">
              <div className="text-xs font-semibold text-ink">{it.head}</div>
              <div className="mt-0.5 text-2xs leading-relaxed text-ink-muted">{it.body}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-2xs text-ink-subtle">{empty}</div>
      )}
    </div>
  )
}
