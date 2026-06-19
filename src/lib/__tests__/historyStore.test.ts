import { beforeEach, describe, expect, it } from 'vitest'
import { createHistoryStore, type DecisionRecord } from '../history'
import { setProviderMode } from '../provider'

/* Wave 3.1 — the Decision & Outcome Ledger. These tests pin the honesty firewall:
   demo outcomes are strictly null, history is mode-segregated, and recording is purely
   additive (the existing apply flow / session Sets are never replaced).

   The suite runs in vitest's `node` env (no DOM), so we install a tiny in-memory
   localStorage shim — the store layer the round-trip exercises. */

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size
    },
  } as Storage
}

beforeEach(() => {
  globalThis.localStorage = memoryStorage()
  setProviderMode('demo')
})

const baseRecord = (over: Partial<Omit<DecisionRecord, 'id'>> = {}): Omit<DecisionRecord, 'id'> => ({
  mode: 'demo',
  clientId: 'c1',
  entityId: 'ad_1',
  level: 'ad',
  suggestionType: 'PAUSE_ENTITY',
  severity: 'high',
  action: 'applied',
  confidence: 0.82,
  preMetrics: { cpa: 40, spend: 1000, roas: 2.1, purchases: 25 },
  projected: { metric: '+Orders' },
  decidedAt: '2026-06-17T12:00:00.000Z',
  outcome: null,
  ...over,
})

describe('localHistoryStore — Decision & Outcome Ledger (Tier 1)', () => {
  it('round-trips: record → reload (fresh store) → forEntity/forClient/all return it', async () => {
    const store = createHistoryStore()
    const saved = await store.record(baseRecord())
    expect(saved.id).toBeTruthy()

    // "reload" = a brand-new store instance reading the same persisted bucket.
    const reloaded = createHistoryStore()
    const byEntity = await reloaded.forEntity('ad_1')
    const byClient = await reloaded.forClient('c1')
    const everything = await reloaded.all()

    expect(byEntity).toHaveLength(1)
    expect(byEntity[0].id).toBe(saved.id)
    expect(byEntity[0].preMetrics).toEqual({ cpa: 40, spend: 1000, roas: 2.1, purchases: 25 })
    expect(byEntity[0].action).toBe('applied')
    expect(byClient.map((r) => r.id)).toContain(saved.id)
    expect(everything.map((r) => r.id)).toContain(saved.id)
  })

  it('demo outcomes are STRICTLY null — record + attachOutcome can never set one (firewall)', async () => {
    const store = createHistoryStore()
    const saved = await store.record(baseRecord({ mode: 'demo' }))
    expect(saved.outcome).toBeNull()

    // Even an explicit attachOutcome must be a no-op on a demo (simulated) record —
    // there is no real elapsed trajectory in demo, so an outcome can never be written.
    await store.attachOutcome(saved.id, {
      capturedAt: '2026-06-24T00:00:00.000Z',
      cpa: 30,
      spend: 1200,
      roas: 3,
      verdict: 'improved',
    })
    const after = (await createHistoryStore().forEntity('ad_1')).find((r) => r.id === saved.id)
    expect(after?.outcome ?? null).toBeNull()
  })

  it('is mode-segregated — a demo decision never appears in a live-mode query', async () => {
    const store = createHistoryStore()

    setProviderMode('demo')
    const demoRec = await store.record(baseRecord({ mode: 'demo', entityId: 'ad_demo' }))

    // Switch to live: the demo record must be invisible to every live-mode read.
    setProviderMode('live')
    expect(await store.all()).toHaveLength(0)
    expect(await store.forEntity('ad_demo')).toHaveLength(0)
    expect(await store.forClient('c1')).toHaveLength(0)

    // A live record is visible in live; the demo record reappears only in demo.
    const liveRec = await store.record(baseRecord({ mode: 'live', entityId: 'ad_live' }))
    expect((await store.all()).map((r) => r.id)).toEqual([liveRec.id])

    setProviderMode('demo')
    expect((await store.all()).map((r) => r.id)).toEqual([demoRec.id])
  })

  it('live records DO accept an outcome — the firewall blocks demo, not live', async () => {
    setProviderMode('live')
    const store = createHistoryStore()
    const rec = await store.record(baseRecord({ mode: 'live', entityId: 'ad_live' }))
    await store.attachOutcome(rec.id, {
      capturedAt: '2026-06-24T00:00:00.000Z',
      cpa: 30,
      spend: 1200,
      roas: 3,
      verdict: 'improved',
    })
    const after = (await store.forEntity('ad_live')).find((r) => r.id === rec.id)
    expect(after?.outcome?.verdict).toBe('improved')
  })
})

describe('store recording is additive (does not regress the apply flow / session Sets)', () => {
  it('applying still increments appliedSuggestionIds + fires a toast AND records to the ledger', async () => {
    // Import the real store only after the localStorage shim is installed (its initial
    // state reads localStorage at module-eval).
    const { useStore } = await import('../../app/store')
    const { analyzeScope } = await import('../ai/engine')

    // Load the demo snapshot directly (bypassing init(), which touches document).
    const snapshot = await useStore.getState().provider.loadSnapshot()
    useStore.setState({ snapshot })

    const suggestions = analyzeScope(snapshot, { kind: 'portfolio' })
    const s =
      suggestions.find((x) => x.action.kind === 'pause') ??
      suggestions.find((x) => x.action.kind !== 'none')
    expect(s).toBeTruthy()
    if (!s) return

    const before = useStore.getState().appliedSuggestionIds.size
    await useStore.getState().applySuggestion(s)
    const state = useStore.getState()

    // Existing apply flow intact:
    expect(state.appliedSuggestionIds.has(s.id)).toBe(true)
    expect(state.appliedSuggestionIds.size).toBe(before + 1)
    expect(state.toasts.length).toBeGreaterThan(0)
    expect(state.applied.some((a) => a.suggestionId === s.id)).toBe(true)

    // ...and the decision is additively recorded, with a null (pending) demo outcome.
    const ledger = await createHistoryStore().all()
    const rec = ledger.find((r) => r.entityId === s.entityId && r.action === 'applied')
    expect(rec).toBeTruthy()
    expect(rec?.mode).toBe('demo')
    expect(rec?.outcome ?? null).toBeNull()
  })
})
