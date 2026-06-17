import { Fragment, useMemo, useState } from 'react'
import { ChevronRight, Layers3, Search, Sparkles } from 'lucide-react'
import { PageHeader } from '../components/blocks/PageHeader'
import { Avatar, Chip, EmptyState, Segmented, StatusBadge, Tooltip } from '../components/ui/primitives'
import { useSnapshot } from '../app/hooks'
import { useStore } from '../app/store'
import { clientsForScope, metricsForEntity } from '../lib/selectors'
import { analyzeScope } from '../lib/ai/engine'
import { fmtCurrency, fmtNumber, fmtPercent, fmtRoas } from '../lib/format'
import { CAMPAIGN_KIND_LABEL, OPT_GOAL_LABEL } from '../lib/labels'
import { cn } from '../lib/cn'
import type { EntityLevel, EntityStatus, MetricsBundle } from '../lib/types'

type StatusFilter = 'all' | 'ACTIVE' | 'PAUSED' | 'LEARNING_LIMITED'

export function Campaigns() {
  const snapshot = useSnapshot()!
  const scope = useStore((s) => s.scope)
  const range = useStore((s) => s.range)
  const [expandedC, setExpandedC] = useState<Set<string>>(new Set())
  const [expandedA, setExpandedA] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  const clients = clientsForScope(snapshot, scope)
  const showClient = scope.kind !== 'client'

  const suggestionByEntity = useMemo(() => {
    const m = new Map<string, number>()
    analyzeScope(snapshot, scope).forEach((s) => m.set(s.entityId, (m.get(s.entityId) ?? 0) + 1))
    return m
  }, [snapshot, scope])

  const campaignRows = useMemo(() => {
    const clientIds = new Set(clients.map((c) => c.id))
    return snapshot.campaigns
      .filter((c) => clientIds.has(c.clientId))
      .filter((c) => status === 'all' || c.status === status)
      .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()))
      .map((c) => ({ c, m: metricsForEntity(snapshot, 'campaign', c.id, range), client: snapshot.clientById.get(c.clientId)! }))
      .sort((a, b) => b.m.spend - a.m.spend)
  }, [snapshot, clients, range, q, status])

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    next.has(id) ? next.delete(id) : next.add(id)
    setter(next)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Structure"
        title="Campaigns"
        subtitle="Drill from campaign to ad set to ad. Rows flagged by the AI carry a spark."
        actions={
          <Segmented<StatusFilter>
            size="sm"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'LEARNING_LIMITED', label: 'Limited' },
              { value: 'PAUSED', label: 'Paused' },
            ]}
          />
        }
      />

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search campaigns…" className="input pl-9" />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Budget/day</th>
                <th className="px-3 py-2.5 text-right font-medium">Spend</th>
                <th className="px-3 py-2.5 text-right font-medium">Orders</th>
                <th className="px-3 py-2.5 text-right font-medium">CPA</th>
                <th className="px-3 py-2.5 text-right font-medium">ROAS</th>
                <th className="px-3 py-2.5 text-right font-medium">CTR</th>
              </tr>
            </thead>
            <tbody>
              {campaignRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8">
                    <EmptyState icon={<Layers3 className="h-6 w-6" />} title="No campaigns" hint="Adjust filters or scope." />
                  </td>
                </tr>
              )}
              {campaignRows.map(({ c, m, client }) => {
                const open = expandedC.has(c.id)
                return (
                  <Fragment key={c.id}>
                    <Row
                      level="campaign"
                      depth={0}
                      name={c.name}
                      sub={
                        <span className="flex items-center gap-1.5">
                          <Chip className="px-1.5 py-0 text-2xs">{CAMPAIGN_KIND_LABEL[c.kind]}</Chip>
                          <Chip className="px-1.5 py-0 text-2xs">{c.budgetType}</Chip>
                        </span>
                      }
                      client={showClient ? client : undefined}
                      status={c.status}
                      budget={c.dailyBudget}
                      m={m}
                      target={client.targetCPA}
                      flagged={suggestionByEntity.get(c.id)}
                      expandable
                      open={open}
                      onToggle={() => toggle(expandedC, c.id, setExpandedC)}
                    />
                    {open &&
                      (snapshot.adSetsByCampaign.get(c.id) ?? []).map((as) => {
                        const am = metricsForEntity(snapshot, 'adset', as.id, range)
                        const aopen = expandedA.has(as.id)
                        return (
                          <Fragment key={as.id}>
                            <Row
                              level="adset"
                              depth={1}
                              name={as.name}
                              sub={<span className="text-2xs text-ink-subtle">{OPT_GOAL_LABEL[as.optimizationGoal]} · {as.audience.label}</span>}
                              status={as.status}
                              budget={as.dailyBudget}
                              m={am}
                              target={client.targetCPA}
                              flagged={suggestionByEntity.get(as.id)}
                              expandable
                              open={aopen}
                              onToggle={() => toggle(expandedA, as.id, setExpandedA)}
                            />
                            {aopen &&
                              (snapshot.adsByAdSet.get(as.id) ?? []).map((ad) => {
                                const dm = metricsForEntity(snapshot, 'ad', ad.id, range)
                                const cr = snapshot.creativeById.get(ad.creativeId)
                                return (
                                  <Row
                                    key={ad.id}
                                    level="ad"
                                    depth={2}
                                    name={ad.name}
                                    sub={cr ? <span className="text-2xs text-ink-subtle">{cr.format} · {cr.angle}</span> : undefined}
                                    status={ad.status}
                                    budget={null}
                                    m={dm}
                                    target={client.targetCPA}
                                    flagged={suggestionByEntity.get(ad.id)}
                                  />
                                )
                              })}
                          </Fragment>
                        )
                      })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Row({
  depth,
  name,
  sub,
  client,
  status,
  budget,
  m,
  target,
  flagged,
  expandable,
  open,
  onToggle,
}: {
  level: EntityLevel
  depth: number
  name: string
  sub?: React.ReactNode
  client?: { monogram: string; accentColor: string; name: string }
  status: EntityStatus
  budget: number | null
  m: MetricsBundle
  target: number
  flagged?: number
  expandable?: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const onCpa = m.cpa > 0 && m.cpa <= target
  return (
    <tr
      className={cn(
        'border-b border-line/50 transition-colors last:border-0 hover:bg-surface-2',
        depth === 1 && 'bg-surface/40',
        depth === 2 && 'bg-surface/20',
      )}
    >
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2" style={{ paddingLeft: depth * 20 }}>
          {expandable ? (
            <button aria-label={open ? 'Collapse row' : 'Expand row'} onClick={onToggle} className="grid h-5 w-5 place-items-center rounded text-ink-subtle hover:bg-surface-3 hover:text-ink">
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
            </button>
          ) : (
            <span className="w-5" />
          )}
          {client && <Avatar monogram={client.monogram} color={client.accentColor} size={22} />}
          <div className="min-w-0">
            <div className={cn('flex items-center gap-1.5 truncate', depth === 0 ? 'font-medium text-ink' : 'text-ink-muted')}>
              {name}
              {flagged ? (
                <Tooltip label={`${flagged} AI recommendation${flagged > 1 ? 's' : ''}`}>
                  <Sparkles className="h-3.5 w-3.5 text-brand" />
                </Tooltip>
              ) : null}
            </div>
            {sub}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5"><StatusBadge status={status} /></td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{budget != null ? fmtCurrency(budget, { decimals: 0 }) : <span className="text-ink-subtle">—</span>}</td>
      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-ink">{fmtCurrency(m.spend, { compact: true })}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{fmtNumber(m.purchases)}</td>
      <td className={cn('px-3 py-2.5 text-right font-semibold tabular-nums', m.cpa === 0 ? 'text-ink-subtle' : onCpa ? 'text-success' : 'text-warning')}>
        {m.cpa > 0 ? fmtCurrency(m.cpa, { decimals: 2 }) : '—'}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{fmtRoas(m.roas)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{fmtPercent(m.ctr)}</td>
    </tr>
  )
}
