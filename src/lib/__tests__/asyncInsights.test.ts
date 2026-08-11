import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAsyncInsightsJob, LiveProvider, type LiveConfig } from '../provider/liveProvider'
import { setDataContext } from '../metrics'
import { DATA_TODAY, WINDOW_DAYS } from '../demo/generate'

/* Async insight report jobs (P3): POST → poll → fetch, gated STRICTLY on
   async_status === 'Job Completed'. Meta's documented trap: the percent field
   can read 100 while the job is still 'Job Running' — a percent-gated client
   would fetch a partial/empty report. */

type Handler = (url: URL, init?: RequestInit) => { status?: number; body: unknown }

function stubGraph(handler: Handler) {
  const calls: Array<{ method: string; path: string }> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ method: init?.method ?? 'GET', path: url.pathname })
    const out = handler(url, init)
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } })
  })
  return calls
}

const FAST = { baseDelayMs: 1, maxPolls: 8 }

afterEach(() => {
  vi.unstubAllGlobals()
  setDataContext(DATA_TODAY, WINDOW_DAYS)
})

describe('runAsyncInsightsJob', () => {
  it('POSTs the job, keeps polling past percent=100 while Job Running, fetches on Job Completed', async () => {
    let runPolls = 0
    const calls = stubGraph((url, init) => {
      if (url.pathname.endsWith('/act_1/insights') && init?.method === 'POST') return { body: { report_run_id: 'rr_42' } }
      if (url.pathname.endsWith('/rr_42')) {
        runPolls++
        // the TRAP: 100% but still running — must NOT fetch yet
        if (runPolls < 3) return { body: { async_status: 'Job Running', async_percent_completion: 100 } }
        return { body: { async_status: 'Job Completed', async_percent_completion: 100 } }
      }
      if (url.pathname.endsWith('/rr_42/insights')) return { body: { data: [{ ad_id: '1', spend: '10' }, { ad_id: '2', spend: '20' }] } }
      return { status: 404, body: { error: 'nope' } }
    })

    const rows = await runAsyncInsightsJob<{ ad_id: string }>('act_1', { level: 'ad' }, 'biz_1', FAST)
    expect(rows).toHaveLength(2)
    expect(runPolls).toBe(3) // polled through the fake-100% states
    expect(calls[0].method).toBe('POST')
    expect(calls.filter((c) => c.path.endsWith('/rr_42/insights'))).toHaveLength(1)
  })

  it('throws with narrow-the-window guidance on Job Failed', async () => {
    stubGraph((url, init) => {
      if (init?.method === 'POST') return { body: { report_run_id: 'rr_f' } }
      if (url.pathname.endsWith('/rr_f')) return { body: { async_status: 'Job Failed' } }
      return { status: 404, body: {} }
    })
    await expect(runAsyncInsightsJob('act_1', {}, undefined, FAST)).rejects.toThrow(/narrow the time_range/i)
  })

  it('throws when the job never completes within maxPolls', async () => {
    stubGraph((url, init) => {
      if (init?.method === 'POST') return { body: { report_run_id: 'rr_s' } }
      if (url.pathname.endsWith('/rr_s')) return { body: { async_status: 'Job Running', async_percent_completion: 99 } }
      return { status: 404, body: {} }
    })
    await expect(runAsyncInsightsJob('act_1', {}, undefined, { baseDelayMs: 1, maxPolls: 3 })).rejects.toThrow(/did not complete/i)
  })

  it('throws when no report_run_id comes back', async () => {
    stubGraph(() => ({ body: {} }))
    await expect(runAsyncInsightsJob('act_1', {}, undefined, FAST)).rejects.toThrow(/no report_run_id/i)
  })
})

describe('loadSnapshot picks sync vs async by window size', () => {
  const structure = (url: URL): { status?: number; body: unknown } | null => {
    const p = url.pathname
    if (p.endsWith('/act_9')) return { body: { name: 'A', currency: 'USD', timezone_name: 'UTC' } }
    if (p.endsWith('/campaigns') || p.endsWith('/adsets') || p.endsWith('/ads') || p.endsWith('/adcreatives')) return { body: { data: [] } }
    return null
  }
  const cfg = (windowDays: number): LiveConfig => ({
    accounts: [{ clientId: 'c_a', adAccountId: 'act_9', businessId: 'b' }],
    clients: [],
    windowDays,
  })

  it('windowDays=90 → async job path (POST /insights)', async () => {
    const calls = stubGraph((url, init) => {
      const s = structure(url)
      if (s) return s
      if (url.pathname.endsWith('/act_9/insights') && init?.method === 'POST') return { body: { report_run_id: 'rr_1' } }
      if (url.pathname.endsWith('/rr_1')) return { body: { async_status: 'Job Completed' } }
      if (url.pathname.endsWith('/rr_1/insights')) return { body: { data: [] } }
      return { status: 404, body: {} }
    })
    const provider = new LiveProvider(cfg(90), { baseDelayMs: 1, maxPolls: 8 })
    await provider.loadSnapshot()
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/act_9/insights'))).toBe(true)
    expect(calls.some((c) => c.path.endsWith('/rr_1/insights'))).toBe(true)
  })

  it('windowDays=28 → sync GET path (no POST)', async () => {
    const calls = stubGraph((url, init) => {
      const s = structure(url)
      if (s) return s
      if (url.pathname.endsWith('/act_9/insights') && init?.method !== 'POST') return { body: { data: [] } }
      return { status: 404, body: {} }
    })
    await new LiveProvider(cfg(28)).loadSnapshot()
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/act_9/insights'))).toBe(false)
    expect(calls.some((c) => c.method === 'GET' && c.path.endsWith('/act_9/insights'))).toBe(true)
  })
})
