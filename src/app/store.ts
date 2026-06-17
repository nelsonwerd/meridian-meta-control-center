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
import { loadThresholds, resetThresholds as applyResetThresholds, setThreshold as applyThreshold } from '../lib/ai/thresholds'
import type { DateRange, ISODate, RangePreset, Scope, Suggestion } from '../lib/types'

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

  init: () => Promise<void>
  setScope: (s: Scope) => void
  setRangePreset: (p: RangePreset, custom?: { start: ISODate; end: ISODate }) => void
  setRange: (r: DateRange) => void
  toggleTheme: () => void
  applySuggestion: (s: Suggestion) => Promise<void>
  dismissSuggestion: (id: string) => void
  pushToast: (kind: Toast['kind'], message: string, action?: Toast['action']) => void
  removeToast: (id: string) => void
  /** tune an engine threshold and re-derive every screen */
  setThreshold: (key: string, value: number) => void
  resetThresholds: () => void
}

const genId = () => Math.random().toString(36).slice(2, 10)

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

  async init() {
    set({ loading: true, error: null })
    loadThresholds() // apply any persisted engine-threshold overrides
    document.documentElement.setAttribute('data-theme', get().theme)
    try {
      const snapshot = await get().provider.loadSnapshot()
      set({ snapshot, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
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
      get().dismissSuggestion(s.id)
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
        const undo = restore
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

  dismissSuggestion(id) {
    set((st) => ({ dismissedSuggestionIds: new Set(st.dismissedSuggestionIds).add(id) }))
  },

  pushToast(kind, message, action) {
    const id = genId()
    set((st) => ({ toasts: [...st.toasts, { id, kind, message, action }] }))
    setTimeout(() => get().removeToast(id), action ? 7000 : 4200)
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
}))

type SetState = (partial: (st: MeridianState) => Partial<MeridianState>) => void

/** Bump version + clone the snapshot reference (so [snapshot]-keyed memos
 *  re-derive), merging any extra state fields. */
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
