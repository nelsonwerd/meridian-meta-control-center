import { assembleDataset } from '../dataset/assemble'
import type { Snapshot } from '../provider'
import type { PeriodKey } from '../types'

/* ============================================================================
   Live snapshot cache.

   The problem this exists for: a Meta ad account is rate-limited on BOTH call
   count and CPU time, and a cold snapshot load costs a large slice of both.
   Without a cache, every page reload — every accidental refresh, every restart
   — spends that budget again to fetch data that has not changed. On a Limited
   access tier that is the difference between a tool you can use and a tool that
   locks you out of your own ad account.

   So: a live snapshot is written here after each successful load, and read back
   on start WITHOUT touching Graph. Refreshing is an explicit act (see
   store.refreshSnapshot) rather than something a page load does silently. The
   age is always shown in the UI — stale data the operator can see is safe;
   stale data pretending to be current is not.

   Demo is deliberately NOT cached: it regenerates deterministically in
   milliseconds and costs nothing, and keeping it out preserves the demo/live
   firewall structurally rather than by convention.

   IndexedDB rather than localStorage because a real account's insight rows run
   to megabytes, well past the ~5MB localStorage quota.
   ========================================================================= */

const DB_NAME = 'meridian'
const STORE = 'snapshots'
const KEY = 'live'
const DB_VERSION = 1

/** What we actually persist: the RAW rows, not the assembled Dataset. The index
 *  Maps are derived, so re-deriving them on read is both cheaper than
 *  serializing them and immune to the index shape drifting between versions. */
interface CachedPayload {
  savedAt: string
  generatedAt: string
  dataAnchor: string
  windowDays: number
  /** Invalidates the cache when the account mapping changes — otherwise editing
   *  Settings would leave you looking at the previous account's numbers. */
  fingerprint: string
  input: Parameters<typeof assembleDataset>[0]
  periodReach: Array<[string, Partial<Record<PeriodKey, number>>]>
}

/** The bit of a key-value store this needs. Injectable so the cache logic can be
 *  tested without an IndexedDB implementation in the test environment — the same
 *  seam idea as DataProvider, one layer down. */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

/** Default store: IndexedDB, because a real account's insight rows run to
 *  megabytes — well past the ~5MB localStorage quota. */
export function idbCacheStore(): CacheStore {
  return {
    get: <T,>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
    put: (key, value) => tx('readwrite', (s) => s.put(value, key)).then(() => undefined),
    delete: (key) => tx('readwrite', (s) => s.delete(key)).then(() => undefined),
  }
}

/** Identifies the account mapping a cached snapshot was built from. */
export function configFingerprint(cfg: { accounts: Array<{ clientId: string; adAccountId: string }>; windowDays: number } | null): string {
  if (!cfg) return 'none'
  return `${cfg.windowDays}:${cfg.accounts.map((a) => `${a.clientId}@${a.adAccountId}`).sort().join(',')}`
}

export async function writeSnapshotCache(snap: Snapshot, fingerprint: string, store: CacheStore = idbCacheStore()): Promise<void> {
  if (snap.mode !== 'live') return // demo is free to regenerate; never cache it
  const payload: CachedPayload = {
    savedAt: new Date().toISOString(),
    generatedAt: snap.generatedAt,
    dataAnchor: snap.dataAnchor,
    windowDays: snap.windowDays,
    fingerprint,
    input: {
      businessManagers: snap.businessManagers,
      clients: snap.clients,
      accounts: snap.accounts,
      campaigns: snap.campaigns,
      adSets: snap.adSets,
      ads: snap.ads,
      creatives: snap.creatives,
      insights: snap.insights,
    },
    periodReach: [...(snap.periodReachByAd ?? new Map())],
  }
  try {
    await store.put(KEY, payload)
  } catch (e) {
    // A cache write failing (quota, private browsing) must never break a load
    // that already succeeded — the data is on screen either way.
    console.warn('[meridian] could not cache the snapshot:', e)
  }
}

export interface CachedSnapshot {
  snapshot: Snapshot
  savedAt: string
}

/** Returns the cached live snapshot, or null when absent/unreadable/for a
 *  different account mapping. Never throws. */
export async function readSnapshotCache(fingerprint: string, store: CacheStore = idbCacheStore()): Promise<CachedSnapshot | null> {
  try {
    const p = (await store.get<CachedPayload>(KEY)) ?? null
    if (!p || p.fingerprint !== fingerprint) return null
    // deriveStatuses stays OFF, exactly as the live load does it: live carries
    // Meta's real effective_status and must not have it re-derived from volume.
    const ds = assembleDataset(p.input)
    const snapshot: Snapshot = {
      ...ds,
      periodReachByAd: new Map(p.periodReach),
      mode: 'live',
      generatedAt: p.generatedAt,
      dataAnchor: p.dataAnchor,
      windowDays: p.windowDays,
    }
    return { snapshot, savedAt: p.savedAt }
  } catch (e) {
    console.warn('[meridian] could not read the snapshot cache:', e)
    return null
  }
}

export async function clearSnapshotCache(store: CacheStore = idbCacheStore()): Promise<void> {
  try {
    await store.delete(KEY)
  } catch {
    /* nothing to do — a cache we cannot clear is a cache we cannot read either */
  }
}
