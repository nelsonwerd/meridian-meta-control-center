import {
  ArrowRight,
  Check,
  Combine,
  Eye,
  Flame,
  Gauge,
  Lightbulb,
  PauseCircle,
  Scissors,
  Shuffle,
  TrendingUp,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { cn } from '../../lib/cn'
import { useStore } from '../../app/store'
import { useSnapshot } from '../../app/hooks'
import { Avatar, ConfidenceBar, SeverityDot, Tooltip } from '../ui/primitives'
import { parentPath } from '../../lib/selectors'
import type { EntityLevel, Suggestion, SuggestionType } from '../../lib/types'

const META: Record<SuggestionType, { label: string; icon: ComponentType<{ className?: string }>; tone: string }> = {
  SCALE_BUDGET: { label: 'Scale', icon: TrendingUp, tone: 'text-success bg-success/10' },
  CUT_BUDGET: { label: 'Cut', icon: Scissors, tone: 'text-warning bg-warning/10' },
  PAUSE_ENTITY: { label: 'Pause', icon: PauseCircle, tone: 'text-danger bg-danger/10' },
  CREATIVE_FATIGUE: { label: 'Fatigue', icon: Flame, tone: 'text-warning bg-warning/10' },
  CONSOLIDATE_ADSETS: { label: 'Consolidate', icon: Combine, tone: 'text-info bg-info/10' },
  REALLOCATE_SPEND: { label: 'Reallocate', icon: Shuffle, tone: 'text-info bg-info/10' },
  NEW_CREATIVE_ANGLE: { label: 'New angle', icon: Lightbulb, tone: 'text-brand bg-brand/10' },
  FIX_LANDING_OFFER: { label: 'Fix offer', icon: Wrench, tone: 'text-warning bg-warning/10' },
  EXPAND_AUDIENCE: { label: 'Expand', icon: ArrowRight, tone: 'text-info bg-info/10' },
  PACING_ALERT: { label: 'Pacing', icon: Gauge, tone: 'text-info bg-info/10' },
  ANOMALY: { label: 'Anomaly', icon: Zap, tone: 'text-danger bg-danger/10' },
  WATCH: { label: 'Watch', icon: Eye, tone: 'text-ink-muted bg-surface-3' },
}

const SEV_ACCENT: Record<string, string> = {
  critical: 'rgb(248 113 113)',
  high: 'rgb(251 191 36)',
  medium: 'rgb(96 165 250)',
  low: 'rgb(99 107 123)',
}

const LEVEL_LABEL: Record<EntityLevel, string> = {
  ad: 'Ad',
  adset: 'Ad set',
  campaign: 'Campaign',
  client: 'Account',
  account: 'Account',
}

export function SuggestionCard({ s, showClient = true }: { s: Suggestion; showClient?: boolean }) {
  const snapshot = useSnapshot()
  const apply = useStore((st) => st.applySuggestion)
  const dismiss = useStore((st) => st.dismissSuggestion)
  const applied = useStore((st) => st.appliedSuggestionIds.has(s.id))
  const [confirming, setConfirming] = useState(false)
  const meta = META[s.type]
  const Icon = meta.icon
  const client = snapshot?.clients.find((c) => c.id === s.clientId)
  const path = snapshot ? parentPath(snapshot, s.level, s.entityId) : ''

  return (
    <div className="card group relative overflow-hidden p-4 transition-all duration-200 hover:border-line-strong hover:shadow-pop">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: SEV_ACCENT[s.severity] }} />
      <div className="pl-2">
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-2xs font-semibold', meta.tone)}>
            <Icon className="h-3.5 w-3.5" />
            {meta.label}
          </span>
          <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            <SeverityDot severity={s.severity} />
            {s.severity}
          </span>
          <span className="text-2xs font-medium text-ink-subtle">· 7d</span>
          <div className="ml-auto">
            <Tooltip label="Heuristic signal from the last 7 days of delivery (independent of the dashboard date range). A starting point a buyer weighs — not a guarantee. Verify before applying.">
              <ConfidenceBar value={s.confidence} />
            </Tooltip>
          </div>
        </div>

        <h3 className="mt-2.5 text-sm font-semibold leading-snug text-ink">{s.title}</h3>

        {/* Always identify the exact entity + its level + parent path; showClient
            only toggles the client avatar/name (shown in portfolio/BM views). */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
          {showClient && client && (
            <span className="flex items-center gap-1.5">
              <Avatar monogram={client.monogram} color={client.accentColor} size={16} />
              <span className="text-ink-muted">{client.name}</span>
            </span>
          )}
          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium uppercase tracking-wide text-ink-subtle ring-1 ring-inset ring-line">
            {LEVEL_LABEL[s.level]}
          </span>
          <span className="truncate font-medium text-ink-muted">{s.entityName}</span>
          {path && <span className="truncate text-ink-subtle">› {path}</span>}
        </div>

        <p className="mt-2 text-xs leading-relaxed text-ink-muted line-clamp-3">{s.rationale}</p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {s.evidence.slice(0, 4).map((e, i) => (
            <span key={i} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-2xs font-medium tabular-nums text-ink-muted ring-1 ring-inset ring-line">
              {e}
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="flex items-center gap-1.5">
            <span className="text-2xs uppercase tracking-wide text-ink-subtle">Projected</span>
            <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-xs font-semibold text-brand">{s.projectedImpact.metric}</span>
            {s.projectedImpact.note && <span className="text-2xs text-ink-subtle">{s.projectedImpact.note}</span>}
          </div>

          {applied ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
              <Check className="h-3.5 w-3.5" /> Applied
            </span>
          ) : confirming ? (
            // lightweight two-step confirm — the button already states the exact change
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setConfirming(false)}
                className="flex h-8 items-center rounded-lg px-2 text-xs font-medium text-ink-subtle hover:bg-surface-3 hover:text-ink"
              >
                Cancel
              </button>
              <button onClick={() => { apply(s); setConfirming(false) }} className="btn-primary bg-danger py-1.5 text-xs">
                Confirm: {s.action.label}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => dismiss(s.id)}
                aria-label="Dismiss suggestion"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-3 hover:text-ink"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                onClick={() => (s.action.kind === 'none' ? apply(s) : setConfirming(true))}
                className="btn-primary py-1.5 text-xs"
              >
                {s.action.kind === 'none' ? 'Acknowledge' : s.action.label}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
