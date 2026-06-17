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
import type { DateRange, ISODate, RangePreset, Scope, Suggestion } from '../lib/types'

export interface Toast {
  id: string
  kind: 'success' | 'info' | 'error'
  message: string
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
  pushToast: (kind: Toast['kind'], message: string) => void
  removeToast: (id: string) => void
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
    try {
      const res = await provider.applyAction(req, snapshot)
      if (res.ok) {
        set((st) => ({
          version: st.version + 1,
          // Clone the snapshot reference so every [snapshot]-keyed useMemo
          // re-derives from the now-mutated entities (dashboards, counts, flags
          // all reflect the change). The index Maps are shared by reference and
          // contain the in-place-mutated entities, so the re-read sees fresh data.
          snapshot: st.snapshot ? { ...st.snapshot } : st.snapshot,
          appliedSuggestionIds: new Set(st.appliedSuggestionIds).add(s.id),
          applied: [
            { id: genId(), title: s.title, message: res.message, ts: Date.now(), suggestionId: s.id },
            ...st.applied,
          ].slice(0, 50),
        }))
        get().pushToast('success', res.message)
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

  pushToast(kind, message) {
    const id = genId()
    set((st) => ({ toasts: [...st.toasts, { id, kind, message }] }))
    setTimeout(() => get().removeToast(id), 4200)
  },

  removeToast(id) {
    set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }))
  },
}))
