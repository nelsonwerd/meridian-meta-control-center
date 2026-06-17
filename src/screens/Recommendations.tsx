import { useMemo, useState } from 'react'
import { CheckCircle2, History, Sparkles } from 'lucide-react'
import { PageHeader } from '../components/blocks/PageHeader'
import { SuggestionCard } from '../components/blocks/SuggestionCard'
import { EmptyState, Segmented, SectionHeader } from '../components/ui/primitives'
import { useSnapshot } from '../app/hooks'
import { useStore } from '../app/store'
import { analyzeScope } from '../lib/ai/engine'
import { cn } from '../lib/cn'
import type { Severity, SuggestionType } from '../lib/types'

type SevFilter = 'all' | Severity
type GroupFilter = 'all' | 'scale' | 'cut' | 'creative' | 'structure'

const GROUP_TYPES: Record<GroupFilter, SuggestionType[] | null> = {
  all: null,
  scale: ['SCALE_BUDGET'],
  cut: ['CUT_BUDGET', 'PAUSE_ENTITY'],
  creative: ['CREATIVE_FATIGUE', 'NEW_CREATIVE_ANGLE', 'FIX_LANDING_OFFER'],
  structure: ['CONSOLIDATE_ADSETS', 'REALLOCATE_SPEND', 'EXPAND_AUDIENCE'],
}

export function Recommendations() {
  const snapshot = useSnapshot()!
  const scope = useStore((s) => s.scope)
  const dismissed = useStore((s) => s.dismissedSuggestionIds)
  const appliedIds = useStore((s) => s.appliedSuggestionIds)
  const applied = useStore((s) => s.applied)
  const [sev, setSev] = useState<SevFilter>('all')
  const [group, setGroup] = useState<GroupFilter>('all')

  // Retire applied + dismissed suggestions from the live feed (they move to the
  // Activity log) so the list and the severity counts stay honest after Apply.
  const all = useMemo(
    () => analyzeScope(snapshot, scope).filter((s) => !dismissed.has(s.id) && !appliedIds.has(s.id)),
    [snapshot, scope, dismissed, appliedIds],
  )

  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 }
    all.forEach((s) => (c[s.severity] += 1))
    return c
  }, [all])

  const filtered = useMemo(() => {
    const types = GROUP_TYPES[group]
    return all.filter((s) => (sev === 'all' || s.severity === sev) && (!types || types.includes(s.type)))
  }, [all, sev, group])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI analyst"
        title="Recommendations"
        subtitle="Continuously scored from the data. One click applies the change — simulated in demo, live via the Meta API."
        actions={
          <span className="chip">
            <Sparkles className="h-3.5 w-3.5 text-brand" /> {all.length} open
          </span>
        }
      />

      {/* summary tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Critical" value={counts.critical} tone="text-danger" dot="bg-danger" active={sev === 'critical'} onClick={() => setSev(sev === 'critical' ? 'all' : 'critical')} />
        <SummaryTile label="High priority" value={counts.high} tone="text-warning" dot="bg-warning" active={sev === 'high'} onClick={() => setSev(sev === 'high' ? 'all' : 'high')} />
        <SummaryTile label="Medium" value={counts.medium} tone="text-info" dot="bg-info" active={sev === 'medium'} onClick={() => setSev(sev === 'medium' ? 'all' : 'medium')} />
        <SummaryTile label="Applied this session" value={appliedIds.size} tone="text-success" dot="bg-success" />
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<GroupFilter>
          value={group}
          onChange={setGroup}
          options={[
            { value: 'all', label: 'All' },
            { value: 'scale', label: 'Scale' },
            { value: 'cut', label: 'Cut / Pause' },
            { value: 'creative', label: 'Creative' },
            { value: 'structure', label: 'Structure' },
          ]}
        />
        <Segmented<SevFilter>
          size="sm"
          value={sev}
          onChange={setSev}
          options={[
            { value: 'all', label: 'All severities' },
            { value: 'critical', label: 'Critical' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          {filtered.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((s) => (
                <SuggestionCard key={s.id} s={s} showClient={scope.kind !== 'client'} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<CheckCircle2 className="h-7 w-7" />} title="Nothing matches" hint="Adjust the filters or widen the date range." />
          )}
        </div>

        {/* applied activity */}
        <aside className="space-y-3">
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <History className="h-4 w-4 text-ink-subtle" />
              <SectionHeader title="Activity" />
            </div>
            <div className="max-h-[60vh] min-h-[280px] space-y-2 overflow-y-auto p-3">
              {applied.length ? (
                applied.map((a) => (
                  <div key={a.id} className="rounded-lg border border-line bg-surface-2 p-2.5">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-ink">{a.title}</div>
                        <div className="mt-0.5 text-2xs text-ink-subtle">{a.message}</div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-3 text-ink-subtle">
                    <History className="h-5 w-5" />
                  </span>
                  <div className="text-xs font-medium text-ink-muted">No actions yet</div>
                  <div className="text-2xs leading-relaxed text-ink-subtle">Apply a recommendation to start your audit trail. Each change is logged here.</div>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  tone,
  dot,
  active,
  onClick,
}: {
  label: string
  value: number
  tone: string
  dot: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'card flex items-center gap-3 p-4 text-left transition-all',
        onClick && 'hover:border-line-strong',
        active && 'ring-2 ring-brand/50',
      )}
    >
      <span className={cn('h-2.5 w-2.5 rounded-full', dot)} />
      <div>
        <div className={cn('text-2xl font-semibold tabular-nums', tone)}>{value}</div>
        <div className="text-2xs text-ink-muted">{label}</div>
      </div>
    </button>
  )
}
