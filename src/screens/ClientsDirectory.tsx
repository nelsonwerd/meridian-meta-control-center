import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase } from 'lucide-react'
import { PageHeader } from '../components/blocks/PageHeader'
import { Avatar, StatusBadge } from '../components/ui/primitives'
import { Sparkline } from '../components/charts/Sparkline'
import { useSnapshot } from '../app/hooks'
import { useStore } from '../app/store'
import { adIdsForScope, insightsForAdIds, metricsForScope } from '../lib/selectors'
import { previousRange, timeseries } from '../lib/metrics'
import { kpiDelta } from '../lib/metrics'
import { Delta } from '../components/ui/primitives'
import { fmtCurrency, fmtNumber, fmtRoas } from '../lib/format'
import { cn } from '../lib/cn'

export function ClientsDirectory() {
  const snapshot = useSnapshot()!
  const range = useStore((s) => s.range)
  const setScope = useStore((s) => s.setScope)
  const navigate = useNavigate()

  const grouped = useMemo(() => {
    const prev = previousRange(range)
    return snapshot.businessManagers
      .map((bm) => {
        const clients = snapshot.clients
          .filter((c) => c.bmId === bm.id)
          .map((c) => {
            const scope = { kind: 'client', clientId: c.id } as const
            const m = metricsForScope(snapshot, scope, range)
            const mp = metricsForScope(snapshot, scope, prev)
            const spark = timeseries(insightsForAdIds(snapshot, adIdsForScope(snapshot, scope)), range).map((p) => p.spend)
            return { c, m, mp, spark }
          })
          .sort((a, b) => b.m.spend - a.m.spend)
        return { bm, clients }
      })
      .filter((g) => g.clients.length)
  }, [snapshot, range])

  const open = (clientId: string) => {
    setScope({ kind: 'client', clientId })
    navigate('/')
  }

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Book of business" title="Clients" subtitle="Grouped by business manager. Click any client to open its command center." />

      {grouped.map(({ bm, clients }) => (
        <section key={bm.id} className="space-y-3">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-ink-subtle" />
            <h2 className="text-sm font-semibold text-ink">{bm.name}</h2>
            <span className={cn('rounded-full px-2 py-0.5 text-2xs font-medium', bm.type === 'agency' ? 'bg-brand/10 text-brand' : 'bg-info/10 text-info')}>
              {bm.type === 'agency' ? 'Agency BM' : 'Partner BM'}
            </span>
            <span className="text-2xs text-ink-subtle">· {clients.length} clients</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map(({ c, m, mp, spark }) => {
              const onCpa = m.cpa > 0 && m.cpa <= c.targetCPA
              return (
                <button
                  key={c.id}
                  onClick={() => open(c.id)}
                  className="card group p-5 text-left transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar monogram={c.monogram} color={c.accentColor} size={40} />
                      <div>
                        <div className="font-semibold text-ink">{c.name}</div>
                        <div className="text-2xs text-ink-subtle">{c.vertical}</div>
                      </div>
                    </div>
                    <StatusBadge status={c.status === 'onboarding' ? 'LEARNING' : 'ACTIVE'} />
                  </div>

                  <div className="mt-4">
                    <Sparkline data={spark} tone={c.accentColor} width={260} height={36} />
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2 border-t border-line pt-3">
                    <Stat label="Spend" value={fmtCurrency(m.spend, { compact: true })} />
                    <Stat label="Orders" value={fmtNumber(m.purchases)} />
                    <Stat label="CPA" value={m.cpa > 0 ? fmtCurrency(m.cpa, { decimals: 0 }) : '—'} tone={onCpa ? 'text-success' : 'text-warning'} delta={kpiDelta('cpa', m.cpa, mp.cpa)} />
                    <Stat label="ROAS" value={fmtRoas(m.roas)} />
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function Stat({ label, value, tone, delta }: { label: string; value: string; tone?: string; delta?: ReturnType<typeof kpiDelta> }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', tone ?? 'text-ink')}>{value}</div>
      {delta && <Delta d={delta} className="text-2xs" />}
    </div>
  )
}
