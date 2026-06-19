import { create } from 'zustand'
import {
  createProvider,
  getProviderMode,
  setProviderMode as persistMode,
  type ActionRequest,
  type DataProvider,
  type ProviderMode,
  type Snapshot,
} from '../lib/provider'
import { makeRange } from '../lib/metrics'
import { loadThresholds, resetThresholds as applyResetThresholds, setActiveClientThresholds, setThreshold as applyThreshold } from '../lib/ai/thresholds'
import { createConfigStore, type ClientConfig, type ClientTargets } from '../lib/config'
import { createHistoryStore, type DecisionAction } from '../lib/history'
import { metricsForEntity } from '../lib/selectors'
import type { DateRange, EntityRef, ISODate, RangePreset, Scope, Suggestion } from '../lib/types'

export interface Toast {
  id: string
  kind: 'success' | 'info' | 'error'
  message: string
  /** optional inline action (e.g. Undo) */
  action?: { label: string; onClick: () => void }
}

export interface AppliedAction {
  id: string
  message: string
  ts: number
  suggestionId?: string
  title: string
}

type Theme = 'dark' | 'light'

interface MeridianState {
  provider: DataProvider
  snapshot: Snapshot | null
  loading: boolean
  error: string | null
  /** bumped whenever the in-memory snapshot is mutated (applied actions) */
  version: number

  scope: Scope
  range: DateRange
  theme: Theme
  providerMode: ProviderMode

  toasts: Toast[]
  applied: AppliedAction[]
  appliedSuggestionIds: Set<string>
  dismissedSuggestionIds: Set<string>
  /** per-client target (+ Wave 2 threshold) overrides, applied onto snapshot Clients */
  clientConfig: Record<string, ClientConfig>
  /** entity-detail drawer target (null = closed) — ephemeral UI state, not the URL */
  drawer: EntityRef | null

  init: () => Promise<void>
  /** Swap demo/live provider in place + reload the snapshot — no full-page reload,
   *  so scope / range / theme survive. */
  applyProviderMode: (mode: ProviderMode) => Promise<void>
  setScope: (s: Scope) => void
  setRangePreset: (p: RangePreset, custom?: { start: ISODate; end: ISODate }) => void
  setRange: (r: DateRange) => void
  toggleTheme: () => void
  applySuggestion: (s: Suggestion) => Promise<void>
  dismissSuggestion: (s: Suggestion) => void
  pushToast: (kind: Toast['kind'], message: string, action?: Toast['action']) => void
  removeToast: (id: string) => void
  /** tune an engine threshold and re-derive every screen */
  setThreshold: (key: string, value: number) => void
  resetThresholds: () => void
  /** set/clear a client's target overrides; re-applies onto the snapshot + re-derives */
  setClientConfig: (cfg: ClientConfig) => void
  resetClientConfig: (clientId: string) => void
  openDrawer: (ref: EntityRef) => void
  closeDrawer: () => void
}

const genId = () => Math.random().toString(36).slice(2, 10)

const configStore = createConfigStore()

/** The Decision & Outcome Ledger (Wave 3). One mode-segregated instance shared by the
 *  recording hooks (here) and the async readers (the drawer + Recommendations Activity
 *  panel). Local impl now; the documented `decision_log` backend is a drop-in later. */
export const historyStore = createHistoryStore()

/** Record an applied/dismissed decision ADDITIVELY and fire-and-forget — it never
 *  blocks or fails the apply/dismiss UI, and it never touches the in-session dedup
 *  Sets the live feed depends on. `preMetrics` is the entity's last-7-day snapshot at
 *  decision time (the engine scores on the last 7 days). `outcome` is strictly null:
 *  it is captured later on LIVE data over elapsed time, and can never move in demo. */
function recordDecision(snapshot: Snapshot, mode: ProviderMode, s: Suggestion, action: DecisionAction) {
  const m = metricsForEntity(snapshot, s.level, s.entityId, makeRange('7d'))
  void historyStore.record({
    mode,
    clientId: s.clientId,
    entityId: s.entityId,
    level: s.level,
    suggestionType: s.type,
    severity: s.severity,
    action,
    confidence: s.confidence,
    preMetrics: { cpa: m.cpa, spend: m.spend, roas: m.roas, purchases: m.purchases },
    projected: { metric: s.projectedImpact.metric, note: s.projectedImpact.note },
    decidedAt: new Date().toISOString(),
    outcome: null, // captured later on LIVE data over elapsed time; strictly null in demo
  })
}

/** Pristine seeded targets, captured ONCE (they are constant within a session), so
 *  config edits/resets re-derive from a clean base rather than an already-applied
 *  snapshot. Mirrors how thresholds.ts captures DEFAULTS at module load. */
let baseClientTargets: Record<string, ClientTargets> | null = null

function captureBaseTargets(snapshot: Snapshot) {
  if (baseClientTargets) return
  baseClientTargets = {}
  for (const c of snapshot.clients) {
    baseClientTargets[c.id] = {
      targetCPA: c.targetCPA,
      targetROAS: c.targetROAS,
      monthlyBudget: c.monthlyBudget,
      avgOrderValue: c.avgOrderValue,
      contributionMargin: c.contributionMargin,
    }
  }
}

/** Apply per-client config ONTO the snapshot's Client objects in place: reset each
 *  to its base target, then overlay the override. `clientById` holds the same object
 *  references, so the engine + screens (the single read source) immediately see the
 *  effective targets — exactly like loadThresholds() mutating the global THRESHOLDS. */
function applyConfigInPlace(snapshot: Snapshot, cfgMap: Record<string, ClientConfig>) {
  if (!baseClientTargets) return
  for (const c of snapshot.clients) {
    const base = baseClientTargets[c.id]
    if (!base) continue
    const cfg = cfgMap[c.id]
    c.targetCPA = cfg?.targetCPA ?? base.targetCPA
    c.targetROAS = cfg?.targetROAS ?? base.targetROAS
    c.monthlyBudget = cfg?.monthlyBudget ?? base.monthlyBudget
    c.avgOrderValue = cfg?.avgOrderValue ?? base.avgOrderValue
    c.contributionMargin = cfg?.contributionMargin ?? base.contributionMargin
  }
}

function initialTheme(): Theme {
  const stored = localStorage.getItem('meridian.theme') as Theme | null
  return stored ?? 'dark'
}

export const useStore = create<MeridianState>((set, get) => ({
  provider: createProvider(),
  snapshot: null,
  loading: true,
  error: null,
  version: 0,

  scope: { kind: 'portfolio' },
  range: makeRange('28d'),
  theme: initialTheme(),
  providerMode: getProviderMode(),

  toasts: [],
  applied: [],
  appliedSuggestionIds: new Set(),
  dismissedSuggestionIds: new Set(),
  clientConfig: {},
  drawer: null,

  async init() {
    set({ loading: true, error: null })
    loadThresholds() // apply any persisted engine-threshold overrides
    document.documentElement.setAttribute('data-theme', get().theme)
    try {
      const snapshot = await get().provider.loadSnapshot()
      const clientConfig = await configStore.load()
      captureBaseTargets(snapshot) // pristine seeded targets (once)
      applyConfigInPlace(snapshot, clientConfig) // overlay per-client target overrides
      setActiveClientThresholds(clientConfig) // expose per-client threshold overrides to the engine
      set({ snapshot, clientConfig, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  async applyProviderMode(mode) {
    persistMode(mode)
    // Reset the per-session action log/sets (they key off the old dataset) and swap
    // the provider, then re-init to load the new snapshot in place.
    set({
      providerMode: mode,
      provider: createProvider(mode),
      applied: [],
      appliedSuggestionIds: new Set(),
      dismissedSuggestionIds: new Set(),
    })
    await get().init()
  },

  setScope(scope) {
    set({ scope })
  },

  setRangePreset(preset, custom) {
    set({ range: makeRange(preset, custom) })
  },

  setRange(range) {
    set({ range })
  },

  toggleTheme() {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('meridian.theme', theme)
    set({ theme })
  },

  async applySuggestion(s) {
    const { provider, snapshot } = get()
    if (!snapshot) return
    const req: ActionRequest = {
      kind: s.action.kind,
      level: s.action.targetLevel,
      entityId: s.action.targetEntityId,
      proposedBudget: s.action.proposedBudget,
    }
    if (s.action.kind === 'none') {
      get().dismissSuggestion(s)
      return
    }
    // Capture the entity's prior state so the change is reversible.
    const restore = captureRestore(snapshot, req)
    try {
      const res = await provider.applyAction(req, snapshot)
      if (res.ok) {
        bumpSnapshot(set, (st) => ({
          appliedSuggestionIds: new Set(st.appliedSuggestionIds).add(s.id),
          applied: [
            { id: genId(), title: s.title, message: res.message, ts: Date.now(), suggestionId: s.id },
            ...st.applied,
          ].slice(0, 50),
        }))
        // Ledger: record the applied decision additively (fire-and-forget). Independent
        // of the session Sets above — applyAction wrote no insight rows, so preMetrics
        // (the 7d snapshot) reflects the pre-action trajectory.
        recordDecision(snapshot, get().providerMode, s, 'applied')
        // Undo only in demo: the demo restore mutates the in-memory snapshot, which
        // genuinely reverses a simulated change. In live mode the write is already
        // committed at Meta, so a client-side restore would desync UI from reality —
        // offer no Undo rather than a misleading one (a real undo = a compensating POST).
        const undo = restore && get().providerMode === 'demo'
          ? {
              label: 'Undo',
              onClick: () => {
                restore()
                bumpSnapshot(set, (st) => {
                  const ids = new Set(st.appliedSuggestionIds)
                  ids.delete(s.id)
                  return { appliedSuggestionIds: ids, applied: st.applied.filter((a) => a.suggestionId !== s.id) }
                })
                get().pushToast('info', 'Change reverted.')
              },
            }
          : undefined
        get().pushToast('success', res.message, undo)
      } else {
        get().pushToast('error', res.message)
      }
    } catch (e) {
      get().pushToast('error', (e as Error).message)
    }
  },

  dismissSuggestion(s) {
    // Keep the in-session dedup Set as the live-feed source (unchanged), and ALSO
    // record the dismissal additively in the ledger (fire-and-forget).
    set((st) => ({ dismissedSuggestionIds: new Set(st.dismissedSuggestionIds).add(s.id) }))
    const { snapshot } = get()
    if (snapshot) recordDecision(snapshot, get().providerMode, s, 'dismissed')
  },

  pushToast(kind, message, action) {
    const id = genId()
    // Auto-dismiss is owned by the Toasts component (a per-toast timer that pauses
    // on hover/focus and is cancelled on unmount) — not a fire-and-forget setTimeout
    // here, which could never be paused and would fire on an already-removed id.
    set((st) => ({ toasts: [...st.toasts, { id, kind, message, action }] }))
  },

  removeToast(id) {
    set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }))
  },

  setThreshold(key, value) {
    applyThreshold(key as never, value)
    // clone snapshot so every [snapshot]-keyed memo re-runs the engine with the
    // new threshold (also re-renders Settings via useSnapshot's version sub).
    bumpSnapshot(set, () => ({}))
  },

  resetThresholds() {
    applyResetThresholds()
    bumpSnapshot(set, () => ({}))
  },

  setClientConfig(cfg) {
    const next = { ...get().clientConfig, [cfg.clientId]: cfg }
    void configStore.save(cfg)
    const { snapshot } = get()
    if (snapshot) applyConfigInPlace(snapshot, next)
    setActiveClientThresholds(next)
    bumpSnapshot(set, () => ({ clientConfig: next }))
  },

  resetClientConfig(clientId) {
    const next = { ...get().clientConfig }
    delete next[clientId]
    void configStore.reset(clientId)
    const { snapshot } = get()
    if (snapshot) applyConfigInPlace(snapshot, next)
    setActiveClientThresholds(next)
    bumpSnapshot(set, () => ({ clientConfig: next }))
  },

  openDrawer(ref) {
    set({ drawer: ref })
  },

  closeDrawer() {
    set({ drawer: null })
  },
}))

type SetState = (partial: (st: MeridianState) => Partial<MeridianState>) => void

/** Bump version + clone the snapshot reference (so [snapshot]-keyed memos
 *  re-derive), merging any extra state fields.
 *
 *  The clone is INTENTIONALLY shallow: the entity objects and the index Maps inside
 *  the snapshot stay shared by reference, which is what lets the provider's in-place
 *  optimistic write (and the Undo restore) be visible without a deep rebuild. Do NOT
 *  "fix" this into a deep clone. If a future feature needs an immutable before/after,
 *  capture primitive field values in a closure (as captureRestore does) rather than
 *  relying on object identity. */
function bumpSnapshot(set: SetState, updater: (st: MeridianState) => Partial<MeridianState>) {
  set((st) => ({
    version: st.version + 1,
    snapshot: st.snapshot ? { ...st.snapshot } : st.snapshot,
    ...updater(st),
  }))
}

/** Capture an entity's pre-action field(s) and return a closure that restores
 *  them — backs the toast's Undo. Returns null if the entity can't be resolved. */
function captureRestore(snapshot: Snapshot | null, req: ActionRequest): (() => void) | null {
  if (!snapshot) return null
  const getEntity = (): { status?: string; dailyBudget?: number | null } | undefined => {
    if (req.level === 'campaign') return snapshot.campaignById.get(req.entityId)
    if (req.level === 'adset') return snapshot.adSetById.get(req.entityId)
    if (req.level === 'ad') return snapshot.adById.get(req.entityId)
    return undefined
  }
  const e = getEntity()
  if (!e) return null
  const prevStatus = e.status
  const prevBudget = e.dailyBudget
  return () => {
    const x = getEntity() as { status?: string; dailyBudget?: number | null } | undefined
    if (!x) return
    if (req.kind === 'pause' || req.kind === 'activate') x.status = prevStatus
    if (req.kind === 'increase_budget' || req.kind === 'decrease_budget') x.dailyBudget = prevBudget
  }
}
