import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Clock, History, MinusCircle, X } from 'lucide-react'
import { historyStore, useStore } from '../../app/store'
import { useSnapshot } from '../../app/hooks'
import { KpiRow } from '../blocks/KpiRow'
import { PerformanceTrendCard } from '../blocks/PerformanceTrendCard'
import { CreativeThumb } from '../blocks/CreativeThumb'
import { SuggestionCard } from '../blocks/SuggestionCard'
import { Avatar, Chip, EmptyState, SectionHeader, StatusBadge } from '../ui/primitives'
import { adIdsForEntity, insightsForAdIds, metricsForEntity, parentPath } from '../../lib/selectors'
import { previousRange, timeseries } from '../../lib/metrics'
import { analyzeClient } from '../../lib/ai/engine'
import { creativePerformance } from '../../lib/ai/creative'
import { fmtCurrency, fmtDateTime, SUGGESTION_TYPE_LABEL } from '../../lib/format'
import { cn } from '../../lib/cn'
import type { DecisionRecord } from '../../lib/history'
import type { EntityLevel, EntityRef, EntityStatus } from '../../lib/types'
import type { Snapshot } from '../../lib/provider'

const LEVEL_LABEL: Record<EntityLevel, string> = { ad: 'Ad', adset: 'Ad set', campaign: 'Campaign', client: 'Account', account: 'Account' }

/** Right slide-over with the full picture of any entity. Opened from any surface via
 *  the store's `drawer` field; ephemeral UI state (not the URL). Accessible: focus
 *  trap, ESC to close, scroll-lock, role=dialog. */
export function EntityDrawer() {
  const ref = useStore((s) => s.drawer)
  const close = useStore((s) => s.closeDrawer)
  const snapshot = useSnapshot()
  if (!ref || !snapshot) return null
  return <DrawerInner key={`${ref.level}:${ref.entityId}`} entityRef={ref} snapshot={snapshot} onClose={close} />
}

function DrawerInner({ entityRef, snapshot, onClose }: { entityRef: EntityRef; snapshot: Snapshot; onClose: () => void }) {
  const range = useStore((s) => s.range)
  const dismissed = useStore((s) => s.dismissedSuggestionIds)
  const applied = useStore((s) => s.appliedSuggestionIds)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // ESC + focus trap + scroll lock + restore focus on close
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const els = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
      )
      if (els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prevFocused?.focus?.()
    }
  }, [onClose])

  // Decision history — async at the seam (never the sync engine path). Reads the
  // persisted, mode-segregated ledger for this entity (ad → itself; client → the
  // client; ad set / campaign → the whole subtree). Re-runs on apply/dismiss.
  const [history, setHistory] = useState<DecisionRecord[] | null>(null)
  useEffect(() => {
    let active = true
    const load = async () => {
      const { level, entityId } = entityRef
      let recs: DecisionRecord[]
      if (level === 'ad') {
        recs = await historyStore.forEntity(entityId)
      } else if (level === 'client' || level === 'account') {
        const resolved = resolveEntity(snapshot, entityRef)
        recs = resolved ? await historyStore.forClient(resolved.clientId) : []
      } else {
        const ids = subtreeIds(snapshot, entityRef)
        const everything = await historyStore.all()
        recs = ids ? everything.filter((r) => ids.has(r.entityId)) : everything
      }
      if (active) setHistory(recs)
    }
    void load()
    return () => {
      active = false
    }
  }, [entityRef, snapshot, applied, dismissed])

  const data = useMemo(() => {
    const { level, entityId } = entityRef
    const resolved = resolveEntity(snapshot, entityRef)
    if (!resolved) return null
    const client = snapshot.clientById.get(resolved.clientId)
    const adIds = adIdsForEntity(snapshot, level, entityId)
    const current = metricsForEntity(snapshot, level, entityId, range)
    const previous = metricsForEntity(snapshot, level, entityId, previousRange(range))
    const series = timeseries(insightsForAdIds(snapshot, adIds), range)

    const scope = subtreeIds(snapshot, entityRef)
    const recs = analyzeClient(snapshot, resolved.clientId).filter(
      (s) => !dismissed.has(s.id) && !applied.has(s.id) && (scope === null || scope.has(s.entityId)),
    )

    // creatives in scope (ad → its one creative; higher levels → top by CPA)
    const adSet = new Set(adIds)
    const creatives = creativePerformance(snapshot, resolved.clientId, range)
      .filter((p) => p.adIds.some((id) => adSet.has(id)) && p.metrics.purchases > 0)
      .sort((a, b) => a.metrics.cpa - b.metrics.cpa)
      .slice(0, level === 'ad' ? 1 : 4)

    return { ...resolved, client, current, previous, series, recs, creatives }
  }, [entityRef, snapshot, range, dismissed, applied])

  if (!data) return null
  const onCpa = data.current.cpa > 0 && data.client && data.current.cpa <= data.client.targetCPA
  const path = parentPath(snapshot, entityRef.level, entityRef.entityId)

  return (
    <div className="fixed inset-0 z-[120] flex justify-end" role="dialog" aria-modal="true" aria-label={`${LEVEL_LABEL[entityRef.level]} detail — ${data.name}`}>
      <button aria-label="Close detail" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" />
      <div
        ref={panelRef}
        className="animate-slide-in-right relative flex h-full w-full max-w-[560px] flex-col overflow-hidden border-l border-line bg-canvas shadow-pop"
      >
        {/* header */}
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          {data.client && <Avatar monogram={data.client.monogram} color={data.client.accentColor} size={34} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-ink-subtle ring-1 ring-inset ring-line">
                {LEVEL_LABEL[entityRef.level]}
              </span>
              {entityRef.level === 'client' ? (
                <Chip tone="default" className="px-1.5 py-0 text-2xs">{data.statusLabel}</Chip>
              ) : (
                <StatusBadge status={data.status as EntityStatus} />
              )}
            </div>
            <h2 className="mt-1 truncate text-base font-semibold text-ink">{data.name}</h2>
            {path && <p className="truncate text-2xs text-ink-subtle">{path}</p>}
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-3 hover:text-ink focus-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <KpiRow
            current={data.current}
            previous={data.previous}
            series={data.series}
            keys={['spend', 'purchases', 'cpa', 'roas']}
            targets={data.client ? { cpa: data.client.targetCPA, roas: data.client.targetROAS } : undefined}
            columns="grid-cols-2"
          />
          <div className="text-2xs text-ink-subtle">
            {onCpa ? 'In-target CPA for this window.' : 'CPA above target for this window.'} {fmtCurrency(data.current.spend, { compact: true })} spent over {range.label.toLowerCase()}.
          </div>

          <PerformanceTrendCard series={data.series} defaultView="efficiency" subtitle={`${data.name} · ${range.label}`} height={200} />

          {data.creatives.length > 0 && data.client && (
            <div>
              <SectionHeader title={entityRef.level === 'ad' ? 'Creative' : 'Top creatives'} subtitle="Best CPA in scope" />
              <div className={cn('mt-3 grid gap-3', entityRef.level === 'ad' ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
                {data.creatives.map((p) => (
                  <CreativeThumb key={p.creative.id} perf={p} targetCPA={data.client!.targetCPA} />
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionHeader title="Recommendations" subtitle={`${data.recs.length} for this ${LEVEL_LABEL[entityRef.level].toLowerCase()}`} />
            <div className="mt-3 space-y-3">
              {data.recs.length ? (
                data.recs.map((s) => <SuggestionCard key={s.id} s={s} showClient={false} />)
              ) : (
                <EmptyState title="No open recommendations" hint="Nothing flagged for this entity in the last 7 days." />
              )}
            </div>
          </div>

          {/* Decision history — the persisted, mode-segregated Decision & Outcome
              Ledger (Wave 3). Demo outcomes are strictly pending (no real trajectory). */}
          <div>
            <SectionHeader title="Decision history" subtitle="Applied / dismissed actions + outcomes" />
            <div className="mt-3 space-y-2">
              {history === null ? (
                <div className="rounded-xl border border-dashed border-line bg-surface/40 px-4 py-5 text-center text-2xs text-ink-subtle">
                  Loading history…
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface/40 px-6 py-8 text-center">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-3 text-ink-subtle">
                    <History className="h-4 w-4" />
                  </span>
                  <div className="text-xs font-medium text-ink-muted">No recorded decisions yet</div>
                  <div className="max-w-xs text-2xs leading-relaxed text-ink-subtle">
                    Every applied or dismissed action for this {LEVEL_LABEL[entityRef.level].toLowerCase()} is logged here, with its measured outcome once live data accrues.
                  </div>
                </div>
              ) : (
                history.map((r) => <DecisionRow key={r.id} rec={r} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** One ledger entry: the action, when, the pre-action 7d snapshot, and the outcome.
 *  In demo the outcome is always pending — no realized trajectory exists (firewall).
 *  A realized outcome (live only) is shown as a correlational signal, never causal. */
function DecisionRow({ rec }: { rec: DecisionRecord }) {
  const applied = rec.action === 'applied'
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-2.5">
      <div className="flex items-center gap-2">
        {applied ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
        ) : (
          <MinusCircle className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
        )}
        <span className="text-xs font-medium capitalize text-ink">{rec.action}</span>
        <span className="truncate text-2xs text-ink-subtle">{SUGGESTION_TYPE_LABEL[rec.suggestionType]}</span>
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-ink-subtle">{fmtDateTime(rec.decidedAt)}</span>
      </div>
      <div className="mt-1.5 text-2xs tabular-nums text-ink-subtle">
        At decision · CPA {fmtCurrency(rec.preMetrics.cpa, { decimals: 2 })} · spend {fmtCurrency(rec.preMetrics.spend, { compact: true })} · ROAS {rec.preMetrics.roas.toFixed(2)}×
      </div>
      <div className="mt-1 text-2xs">
        {rec.outcome == null ? (
          <span className="inline-flex items-center gap-1 italic text-ink-subtle">
            <Clock className="h-3 w-3 shrink-0" />
            Outcome: pending — measured on live data over elapsed time
          </span>
        ) : (
          <span className="text-ink-muted">
            Outcome ({rec.outcome.verdict}): CPA {fmtCurrency(rec.outcome.cpa, { decimals: 2 })} · ROAS {rec.outcome.roas.toFixed(2)}× — correlational, not causal
          </span>
        )}
      </div>
    </div>
  )
}

function resolveEntity(
  snapshot: Snapshot,
  ref: EntityRef,
): { clientId: string; name: string; status?: EntityStatus; statusLabel?: string } | null {
  if (ref.level === 'ad') {
    const ad = snapshot.adById.get(ref.entityId)
    return ad ? { clientId: ad.clientId, name: ad.name, status: ad.status } : null
  }
  if (ref.level === 'adset') {
    const s = snapshot.adSetById.get(ref.entityId)
    return s ? { clientId: s.clientId, name: s.name, status: s.status } : null
  }
  if (ref.level === 'campaign') {
    const c = snapshot.campaignById.get(ref.entityId)
    return c ? { clientId: c.clientId, name: c.name, status: c.status } : null
  }
  // client / account → key off the client
  const c = snapshot.clientById.get(ref.entityId)
  return c ? { clientId: c.id, name: c.name, statusLabel: c.status } : null
}

/** Ids whose recommendations belong to this entity's subtree (null = the whole
 *  client, i.e. show everything). */
function subtreeIds(snapshot: Snapshot, ref: EntityRef): Set<string> | null {
  if (ref.level === 'client' || ref.level === 'account') return null
  if (ref.level === 'ad') return new Set([ref.entityId])
  if (ref.level === 'adset') {
    const ads = (snapshot.adsByAdSet.get(ref.entityId) ?? []).map((a) => a.id)
    return new Set([ref.entityId, ...ads])
  }
  // campaign → itself + its ad sets + their ads
  const sets = snapshot.adSetsByCampaign.get(ref.entityId) ?? []
  const ids = new Set<string>([ref.entityId])
  for (const s of sets) {
    ids.add(s.id)
    for (const a of snapshot.adsByAdSet.get(s.id) ?? []) ids.add(a.id)
  }
  return ids
}
