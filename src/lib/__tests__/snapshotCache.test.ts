import { beforeEach, describe, expect, it } from 'vitest'
import { configFingerprint, readSnapshotCache, writeSnapshotCache, type CacheStore } from '../cache/snapshotCache'
import { generateDataset, DATA_TODAY } from '../demo/generate'
import type { Snapshot } from '../provider'

/* The cache exists so a page reload costs ZERO Graph calls. These cover the
   things that would make it dangerous rather than helpful: serving another
   account's data, or presenting stale data as fresh. */

/** In-memory CacheStore — the injectable seam, so these run without an
 *  IndexedDB implementation (and without a test-only dependency for one). */
function memStore(): CacheStore {
  const m = new Map<string, unknown>()
  return {
    async get<T>(k: string) {
      return m.get(k) as T | undefined
    },
    async put(k, v) {
      // structuredClone matches IndexedDB semantics: what comes back out is a
      // copy, so a test can't pass by accidentally sharing object identity.
      m.set(k, structuredClone(v))
    },
    async delete(k) {
      m.delete(k)
    },
  }
}

let store: CacheStore
const ds = generateDataset()
const live = (): Snapshot => ({
  ...generateDataset(),
  periodReachByAd: new Map([['ad_1', { '7d': 1234 }]]),
  mode: 'live',
  generatedAt: '2026-08-17T10:00:00.000Z',
  dataAnchor: DATA_TODAY,
  windowDays: 56,
})

const FP = configFingerprint({ accounts: [{ clientId: 'c_a', adAccountId: 'act_1' }], windowDays: 56 })

beforeEach(() => {
  store = memStore()
})

describe('snapshot cache', () => {
  it('round-trips a live snapshot, rebuilding the indexes', async () => {
    await writeSnapshotCache(live(), FP, store)
    const hit = await readSnapshotCache(FP, store)
    expect(hit).not.toBeNull()
    expect(hit!.snapshot.ads).toHaveLength(ds.ads.length)
    expect(hit!.snapshot.insights).toHaveLength(ds.insights.length)
    // Maps are DERIVED on read, never serialized
    expect(hit!.snapshot.adById.get(ds.ads[0].id)?.name).toBe(ds.ads[0].name)
    expect(hit!.snapshot.periodReachByAd?.get('ad_1')).toEqual({ '7d': 1234 })
  })

  it('preserves the ORIGINAL pull time — a cache read is never restamped fresh', async () => {
    await writeSnapshotCache(live(), FP, store)
    const hit = await readSnapshotCache(FP, store)
    // the UI dates live data by this, so restamping it would silently present
    // hours-old numbers as current
    expect(hit!.snapshot.generatedAt).toBe('2026-08-17T10:00:00.000Z')
    expect(hit!.snapshot.dataAnchor).toBe(DATA_TODAY)
    expect(hit!.snapshot.windowDays).toBe(56)
  })

  it('MISSES when the account mapping changed — never serves another account', async () => {
    await writeSnapshotCache(live(), FP, store)
    const other = configFingerprint({ accounts: [{ clientId: 'c_a', adAccountId: 'act_999' }], windowDays: 56 })
    expect(await readSnapshotCache(other, store)).toBeNull()
  })

  it('MISSES when the window changed (the cache holds fewer days than asked for)', async () => {
    await writeSnapshotCache(live(), FP, store)
    const wider = configFingerprint({ accounts: [{ clientId: 'c_a', adAccountId: 'act_1' }], windowDays: 90 })
    expect(await readSnapshotCache(wider, store)).toBeNull()
  })

  it('is order-insensitive across accounts (same mapping, same cache)', async () => {
    const a = configFingerprint({ accounts: [{ clientId: 'x', adAccountId: 'act_1' }, { clientId: 'y', adAccountId: 'act_2' }], windowDays: 56 })
    const b = configFingerprint({ accounts: [{ clientId: 'y', adAccountId: 'act_2' }, { clientId: 'x', adAccountId: 'act_1' }], windowDays: 56 })
    expect(a).toBe(b)
  })

  it('refuses to cache DEMO — the firewall is structural, not a query filter', async () => {
    await writeSnapshotCache({ ...live(), mode: 'demo' }, FP, store)
    expect(await readSnapshotCache(FP, store)).toBeNull()
  })

  it('returns null rather than throwing when there is nothing cached', async () => {
    expect(await readSnapshotCache(FP, store)).toBeNull()
  })
})
