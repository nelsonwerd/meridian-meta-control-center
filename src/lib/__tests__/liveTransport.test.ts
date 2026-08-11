import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveProvider, type LiveConfig } from '../provider/liveProvider'
import { setDataContext } from '../metrics'
import { DATA_TODAY, WINDOW_DAYS } from '../demo/generate'

/* P8 coverage-gap closures: pagination, multi-account loads, NotConfigured,
   checkConnection, structure-pull failure, and the browser-side throttle
   semantics (retry ONLY on 429 — a successful response is never discarded). */

type Handler = (url: URL, init?: RequestInit) => { status?: number; headers?: Record<string, string>; body: unknown }

function stubGraph(handler: Handler) {
  const calls: Array<{ method: string; path: string; after: string | null; business: string | null }> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      after: url.searchParams.get('after'),
      business: (init?.headers as Record<string, string> | undefined)?.['X-Meta-Business-Id'] ?? null,
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
