import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveProvider, type LiveConfig } from '../provider/liveProvider'
import { setDataContext } from '../metrics'
import { DATA_TODAY, WINDOW_DAYS } from '../demo/generate'

/* P8 coverage-gap closures: pagination, multi-account loads, NotConfigured,
   checkConnection, structure-pull failure, and the browser-side throttle
   semantics (retry ONLY on 429 — a successful response is never discarded). */

type Handler = (url: URL, init?: RequestInit) => { status?: number; headers?: Record<string, string>; body: unknown }

function stubGraph(handler: Handler) {
  const calls: Array<{ method: string; path: string; after: string | null; business: string | null; spanDays?: number; isDaily?: boolean }> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    // width of a time_range, so tests can assert which windows were requested
    let spanDays: number | undefined
    const tr = url.searchParams.get('time_range')
    if (tr) {
      const { since, until } = JSON.parse(tr) as { since: string; until: string }
      spanDays = Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000) + 1
    }
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      after: url.searchParams.get('after'),
      business: (init?.headers as Record<string, string> | undefined)?.['X-Meta-Business-Id'] ?? null,
      spanDays,
      isDaily: url.searchParams.get('time_increment') === '1',
    })
    const out = handler(url, init)
    return new Response(JSON.stringify(out.body), {
      status: out.status ?? 200,
      headers: { 'content-type': 'application/json', ...(out.headers ?? {}) },
    })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  setDataContext(DATA_TODAY, WINDOW_DAYS)
})

const ACCOUNT_NODE = { id: 'act_1', name: 'A', currency: 'USD', timezone_name: 'UTC' }
const cfg = (accounts: LiveConfig['accounts']): LiveConfig => ({ accounts, clients: [], windowDays: 56 })
const ONE = cfg([{ clientId: 'c_a', adAccountId: 'act_1', businessId: 'b1' }])

describe('graphGet pagination (P8 #15)', () => {
  it('follows cursors across pages and accumulates every row', async () => {
    const calls = stubGraph((url) => {
      if (/\/act_1$/.test(url.pathname)) return { body: ACCOUNT_NODE }
      if (url.pathname.endsWith('/campaigns')) {
        const after = url.searchParams.get('after')
        if (!after) {
          return { body: { data: [{ id: '1', name: 'One', effective_status: 'ACTIVE' }], paging: { cursors: { after: 'cursor2' }, next: 'https://next' } } }
        }
        if (after === 'cursor2') {
          return { body: { data: [{ id: '2', name: 'Two', effective_status: 'ACTIVE' }], paging: { cursors: { after: 'cursor3' }, next: 'https://next' } } }
        }
        return { body: { data: [{ id: '3', name: 'Three', effective_status: 'ACTIVE' }] } } // no next → stop
      }
      return { body: { data: [] } }
    })
    const snap = await new LiveProvider(ONE).loadSnapshot()
    expect(snap.campaigns.map((c) => c.id).sort()).toEqual(['1', '2', '3'])
    expect(calls.filter((c) => c.path.endsWith('/campaigns'))).toHaveLength(3)
  })
})

describe('multi-account loadSnapshot (P8 #17)', () => {
  it('loads two accounts, routes each business id, and namespaces entities per client', async () => {
    const calls = stubGraph((url) => {
      if (/\/act_1$/.test(url.pathname)) return { body: { id: 'act_1', name: 'US', currency: 'USD', timezone_name: 'UTC' } }
      if (/\/act_2$/.test(url.pathname)) return { body: { id: 'act_2', name: 'JP', currency: 'JPY', timezone_name: 'Asia/Tokyo' } }
      if (url.pathname.includes('/act_1/campaigns')) return { body: { data: [{ id: 'c1', name: 'US Campaign', effective_status: 'ACTIVE', daily_budget: '5000' }] } }
      if (url.pathname.includes('/act_2/campaigns')) return { body: { data: [{ id: 'c2', name: 'JP Campaign', effective_status: 'ACTIVE', daily_budget: '5000' }] } }
      return { body: { data: [] } }
    })
    const snap = await new LiveProvider(
      cfg([
        { clientId: 'c_us', adAccountId: 'act_1', businessId: 'b_us' },
        { clientId: 'c_jp', adAccountId: 'act_2', businessId: 'b_jp' },
      ]),
    ).loadSnapshot()
    expect(snap.accounts).toHaveLength(2)
    expect(snap.clients.map((c) => c.id).sort()).toEqual(['c_jp', 'c_us'])
    expect(snap.campaignById.get('c1')?.clientId).toBe('c_us')
    expect(snap.campaignById.get('c2')?.clientId).toBe('c_jp')
    // minor units divided by the OWNING account's offset: USD /100, JPY /1
    expect(snap.campaignById.get('c1')?.dailyBudget).toBe(50)
    expect(snap.campaignById.get('c2')?.dailyBudget).toBe(5000)
    // each account's calls carried ITS business id
    expect(calls.filter((c) => c.path.includes('act_1')).every((c) => c.business === 'b_us')).toBe(true)
    expect(calls.filter((c) => c.path.includes('act_2')).every((c) => c.business === 'b_jp')).toBe(true)
    expect(snap.businessManagers.map((b) => b.id).sort()).toEqual(['b_jp', 'b_us'])
  })
})

describe('failure paths (P8 #18, #19, #22)', () => {
  it('loadSnapshot throws NotConfigured with no config / empty accounts', async () => {
    await expect(new LiveProvider(null).loadSnapshot()).rejects.toThrow(/not configured/i)
    await expect(new LiveProvider(cfg([])).loadSnapshot()).rejects.toThrow(/not configured/i)
  })

  it('a failed structure pull REJECTS the whole load — no partial snapshot ever ships', async () => {
    stubGraph((url) => {
      if (/\/act_1$/.test(url.pathname)) return { body: ACCOUNT_NODE }
      if (url.pathname.endsWith('/adsets')) return { status: 500, body: { error: { message: 'boom' } } }
      return { body: { data: [] } }
    })
    await expect(new LiveProvider(ONE).loadSnapshot()).rejects.toThrow(/Graph 500/)
  })

  it('checkConnection: ok with a named account, clear failure otherwise', async () => {
    stubGraph((url) => (/\/act_1$/.test(url.pathname) ? { body: { id: 'act_1', name: 'Forge Main', currency: 'USD' } } : { body: {} }))
    const ok = await new LiveProvider(ONE).checkConnection()
    expect(ok.ok).toBe(true)
    expect(ok.detail).toContain('Forge Main')

    vi.unstubAllGlobals()
    stubGraph(() => ({ status: 401, body: { error: { message: 'Invalid OAuth access token' } } }))
    const bad = await new LiveProvider(ONE).checkConnection()
    expect(bad.ok).toBe(false)
    expect(bad.detail).toContain('Connection failed')
    expect(await new LiveProvider(cfg([])).checkConnection()).toEqual({ ok: false, detail: 'No accounts configured.' })
  })
})

describe('large-account resilience (found by real live use, 2026-08-14)', () => {
  /** Meta's "reduce the amount of data" refusal on an oversized sync query. */
  const TOO_MUCH = { status: 500, body: { error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" } } }

  it('a refused period-reach pull DEGRADES to additive — it never kills the snapshot', async () => {
    stubGraph((url) => {
      if (/\/act_1$/.test(url.pathname)) return { body: ACCOUNT_NODE }
      if (url.pathname.endsWith('/campaigns')) return { body: { data: [{ id: 'c1', name: 'C', effective_status: 'ACTIVE' }] } }
      if (url.pathname.endsWith('/insights')) {
        // daily pull fine; every unique-reach (summary) pull refused
        return url.searchParams.get('time_increment') === '1'
          ? { body: { data: [{ ad_id: 'a1', date_start: '2026-08-01', spend: '10', impressions: '100', reach: '50' }] } }
          : TOO_MUCH
      }
      return { body: { data: [] } }
    })
    const snap = await new LiveProvider(ONE).loadSnapshot()
    // The snapshot still loads with real data — reach just isn't corrected.
    expect(snap.campaigns).toHaveLength(1)
    expect(snap.insights.length).toBeGreaterThan(0)
    expect(snap.periodReachByAd?.size ?? 0).toBe(0)
  })

  it('a refused SYNC insights pull escalates to an async report job', async () => {
    let syncTried = false
    let asyncUsed = false
    stubGraph((url, init) => {
      if (/\/act_1$/.test(url.pathname)) return { body: ACCOUNT_NODE }
      if (url.pathname.endsWith('/act_1/insights')) {
        if (init?.method === 'POST') {
          asyncUsed = true
          return { body: { report_run_id: 'rr_esc' } }
        }
        if (url.searchParams.get('time_increment') === '1') {
          syncTried = true
          return TOO_MUCH // Meta refuses the sync daily pull
        }
        return { body: { data: [] } } // reach pulls
      }
      if (url.pathname.endsWith('/rr_esc')) return { body: { async_status: 'Job Completed' } }
      if (url.pathname.endsWith('/rr_esc/insights')) return { body: { data: [{ ad_id: 'a1', date_start: '2026-08-01', spend: '5' }] } }
      return { body: { data: [] } }
    })
    // windowDays 56 sits UNDER the async threshold, so it starts on the sync path
    const snap = await new LiveProvider(cfg([{ clientId: 'c_a', adAccountId: 'act_1', businessId: 'b1' }]), { baseDelayMs: 1, maxPolls: 5 }).loadSnapshot()
    expect(syncTried).toBe(true)
    expect(asyncUsed).toBe(true)
    expect(snap.insights).toHaveLength(1) // recovered via the async job
  })

  it('a refused adcreatives pull degrades to placeholders — dashboard still loads', async () => {
    stubGraph((url) => {
      if (/\/act_1$/.test(url.pathname)) return { body: ACCOUNT_NODE }
      if (url.pathname.endsWith('/adcreatives')) return TOO_MUCH // the heaviest structure pull
      if (url.pathname.endsWith('/campaigns')) return { body: { data: [{ id: 'c1', name: 'C', effective_status: 'ACTIVE' }] } }
      if (url.pathname.endsWith('/ads')) return { body: { data: [{ id: 'a1', name: 'Ad One', adset_id: 's1', campaign_id: 'c1', effective_status: 'ACTIVE', creative: { id: 'cr1' } }] } }
      return { body: { data: [] } }
    })
    const snap = await new LiveProvider(ONE).loadSnapshot()
    expect(snap.campaigns).toHaveLength(1)
    expect(snap.ads).toHaveLength(1)
    // every ad still resolves a creative, so CreativeThumb/cohorts never crash
    const cr = snap.creativeById.get(snap.ads[0].creativeId)
    expect(cr).toBeDefined()
    expect(cr!.thumbnailGradient).toHaveLength(2)
  })

  it('a deprecated insights field is dropped and retried, not fatal', async () => {
    // Meta removed video_3_sec_watched_actions on 2026-06-15; simulate ANY
    // future deprecation the same way — one stale name rejects the whole call.
    const DEPRECATED = 'video_continuous_2_sec_watched_actions'
    const fieldsSeen: string[] = []
    stubGraph((url) => {
      if (/\/act_1$/.test(url.pathname)) return { body: ACCOUNT_NODE }
      if (url.pathname.endsWith('/act_1/insights')) {
        const fields = url.searchParams.get('fields') ?? ''
        if (url.searchParams.get('time_increment') === '1') {
          fieldsSeen.push(fields)
          if (fields.includes(DEPRECATED)) {
            return {
              status: 400,
              body: { error: { code: 100, type: 'OAuthException', message: `(#100) ${DEPRECATED} is not valid for fields param. please check ...` } },
            }
          }
          return { body: { data: [{ ad_id: 'a1', date_start: '2026-08-01', spend: '12', impressions: '100' }] } }
        }
        return { body: { data: [] } }
      }
      return { body: { data: [] } }
    })

    const snap = await new LiveProvider(ONE).loadSnapshot()
    expect(fieldsSeen.length).toBe(2) // first rejected, retry without the field
    expect(fieldsSeen[0]).toContain(DEPRECATED)
    expect(fieldsSeen[1]).not.toContain(DEPRECATED)
    expect(fieldsSeen[1]).toContain('spend') // the rest of the field list survives
    expect(snap.insights).toHaveLength(1) // and the data actually loads
  })

  it('Graph errors name the failing endpoint (so an operator can act on them)', async () => {
    stubGraph((url) => {
      if (/\/act_1$/.test(url.pathname)) return { body: ACCOUNT_NODE }
      if (url.pathname.endsWith('/adsets')) return TOO_MUCH
      return { body: { data: [] } }
    })
    await expect(new LiveProvider(ONE).loadSnapshot()).rejects.toThrow(/adsets/)
  })

  it("does NOT request the 'full' window reach (the query Meta refuses)", async () => {
    const calls = stubGraph((url) => {
      if (/\/act_1$/.test(url.pathname)) return { body: ACCOUNT_NODE }
      return { body: { data: [] } }
    })
    await new LiveProvider(ONE).loadSnapshot()
    // reach pulls only — the daily pull legitimately spans the whole window
    const reachWindows = calls
      .filter((c) => c.path.endsWith('/act_1/insights') && c.method === 'GET' && !c.isDaily)
      .map((c) => c.spanDays)
      .filter((d): d is number => d != null)
    expect(reachWindows.length).toBeGreaterThan(0)
    expect(Math.max(...reachWindows)).toBeLessThanOrEqual(28) // 28d is the widest; never the 56d full window
  })
})

describe('browser throttle semantics (P8 #4, #20)', () => {
  it('retries on 429 then succeeds; NEVER discards/refetches a successful response on high BUC', async () => {
    let campaignCalls = 0
    stubGraph((url) => {
      if (/\/act_1$/.test(url.pathname)) return { body: ACCOUNT_NODE }
      if (url.pathname.endsWith('/campaigns')) {
        campaignCalls++
        if (campaignCalls === 1) return { status: 429, body: { error: { code: 613 } } }
        // success WITH high BUC usage — must be returned, not refetched
        return {
          headers: { 'x-business-use-case-usage': JSON.stringify({ b1: [{ type: 'ads_insights', call_count: 97, estimated_time_to_regain_access: 0 }] }) },
          body: { data: [{ id: 'c1', name: 'One', effective_status: 'ACTIVE' }] },
        }
      }
      return { body: { data: [] } }
    })
    const snap = await new LiveProvider(ONE).loadSnapshot()
    expect(snap.campaignById.get('c1')).toBeDefined()
    expect(campaignCalls).toBe(2) // one 429 retry, and exactly ONE successful fetch
  }, 15000)
})
