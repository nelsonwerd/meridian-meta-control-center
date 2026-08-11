import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveProvider, type LiveConfig } from '../provider/liveProvider'
import type { Snapshot } from '../provider/types'
import type { AdAccount } from '../types'

/* P5 — the write path. applyAction POSTs status/daily_budget to the entity's
   own node THROUGH THE PROXY (no token in the body), resolves the OWNING
   account for business-id routing + minor-unit conversion, and treats Meta's
   {success:false}-inside-a-200 as a failure. Never auto-run against real
   credentials — these tests stub fetch; the real-write check is the operator's
   sandbox gate (docs/META_INTEGRATION.md). */

interface Seen {
  url: string
  body: string
  headers: Record<string, string>
}

function stubFetch(status = 200, payload: unknown = { success: true }) {
  const seen: Seen[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      body: init?.body ? String(init.body) : '',
      headers: (init?.headers as Record<string, string>) ?? {},
    })
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  })
  return seen
}

afterEach(() => vi.unstubAllGlobals())

const CFG: LiveConfig = {
  accounts: [
    { clientId: 'c_us', adAccountId: 'act_1', businessId: 'biz_agency' },
    { clientId: 'c_jp', adAccountId: 'act_2', businessId: 'biz_partner' },
  ],
  clients: [],
  windowDays: 28,
}

/** Snapshot slice with just what applyAction/resolveAccount dereference. */
function snap(): Snapshot {
  const usAccount: AdAccount = { id: 'act_1', clientId: 'c_us', name: 'US', currency: 'USD', timezone: 'UTC', currency_offset: 100 }
  const jpAccount: AdAccount = { id: 'act_2', clientId: 'c_jp', name: 'JP', currency: 'JPY', timezone: 'Asia/Tokyo', currency_offset: 1 }
  return {
    accounts: [usAccount, jpAccount],
    accountByClient: new Map([['c_us', usAccount], ['c_jp', jpAccount]]),
    campaignById: new Map([
      ['cmp_us', { id: 'cmp_us', clientId: 'c_us' }],
      ['cmp_jp', { id: 'cmp_jp', clientId: 'c_jp' }],
    ]),
    adSetById: new Map([['as_us', { id: 'as_us', clientId: 'c_us' }]]),
    adById: new Map([['ad_us', { id: 'ad_us', clientId: 'c_us' }]]),
  } as unknown as Snapshot
}

describe('LiveProvider.applyAction', () => {
  it('pause POSTs status=PAUSED with business routing and NO token', async () => {
    const seen = stubFetch()
    const res = await new LiveProvider(CFG).applyAction({ kind: 'pause', level: 'ad', entityId: 'ad_us' }, snap())
    expect(res.ok).toBe(true)
    expect(seen[0].url).toContain('/ad_us')
    const form = new URLSearchParams(seen[0].body)
    expect(form.get('status')).toBe('PAUSED')
    expect(form.has('access_token')).toBe(false) // proxy injects it
    expect(seen[0].headers['X-Meta-Business-Id']).toBe('biz_agency')
  })

  it('budget change converts to minor units via the OWNING account offset (USD ×100)', async () => {
    const seen = stubFetch()
    await new LiveProvider(CFG).applyAction({ kind: 'increase_budget', level: 'campaign', entityId: 'cmp_us', proposedBudget: 250 }, snap())
    expect(new URLSearchParams(seen[0].body).get('daily_budget')).toBe('25000')
  })

  it('JPY account posts whole units (offset 1) with the partner business header', async () => {
    const seen = stubFetch()
    await new LiveProvider(CFG).applyAction({ kind: 'decrease_budget', level: 'campaign', entityId: 'cmp_jp', proposedBudget: 5000 }, snap())
    expect(new URLSearchParams(seen[0].body).get('daily_budget')).toBe('5000') // ¥5000, not 500000
    expect(seen[0].headers['X-Meta-Business-Id']).toBe('biz_partner')
  })

  it('treats {success:false} inside a 200 as a failure (Graph does this)', async () => {
    stubFetch(200, { success: false })
    const res = await new LiveProvider(CFG).applyAction({ kind: 'pause', level: 'ad', entityId: 'ad_us' }, snap())
    expect(res.ok).toBe(false)
    expect(res.message).toContain('did not apply')
  })

  it('surfaces Graph errors (e.g. the legacy-ASC update block) instead of faking success', async () => {
    stubFetch(400, { error: { message: 'Updates to legacy Advantage+ shopping campaigns are not allowed', code: 100 } })
    const res = await new LiveProvider(CFG).applyAction({ kind: 'pause', level: 'campaign', entityId: 'cmp_us' }, snap())
    expect(res.ok).toBe(false)
    expect(res.message).toContain('Graph 400')
  })

  it('refuses multi-step kinds as single writes and unmapped entities', async () => {
    stubFetch()
    const p = new LiveProvider(CFG)
    expect((await p.applyAction({ kind: 'duplicate', level: 'ad', entityId: 'ad_us' }, snap())).ok).toBe(false)
    expect((await p.applyAction({ kind: 'pause', level: 'ad', entityId: 'ad_unknown' }, snap())).ok).toBe(false)
  })
})
