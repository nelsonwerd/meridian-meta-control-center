import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LiveProvider, API_VERSION, type LiveConfig } from '../provider/liveProvider'
import type { Snapshot } from '../provider/types'
import { analyzeScope } from '../ai/engine'
import { metricsForAdIds } from '../selectors'
import { aggregate, filterByRange, makeRange, setDataContext } from '../metrics'
import { DATA_TODAY, WINDOW_DAYS } from '../demo/generate'

/* ============================================================================
   LiveProvider.loadSnapshot INTEGRATION test.

   A fake Graph API (stubbed global fetch) serves realistic v26-shaped pages —
   account node, campaigns/adsets/ads/adcreatives edges, daily ad insights —
   and the test asserts the FULL pipeline: pull → map → assemble → a Snapshot
   the UI and the AI engine consume exactly like demo data.

   This is the machine-checkable half of the P2 gate. The half only the
   operator can do (real token, real account, numbers reconciling with Ads
   Manager) is a 🚪 human gate — see docs/META_INTEGRATION.md.
   ========================================================================== */

const WINDOW = 30
/** loadSnapshot floors the pull window at 56 days — the default 28d view's
 *  previous-period delta reaches back to day 56, and a shorter pull would
 *  fabricate deltas / understate frequency and pacing. */
const EFFECTIVE_WINDOW = 56
const DAYS_OF_ROWS = 12

/** Today in UTC — matches the fixture account's timezone_name: 'UTC', so the
 *  snapshot anchor and the generated insight dates line up deterministically. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}
function daysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/* ---- fixture Graph objects ---- */

const CAMPAIGNS = {
  data: [
    { id: '9001', name: '[ASC] Advantage+ Shopping', objective: 'OUTCOME_SALES', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '150000', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', smart_promotion_type: 'AUTOMATED_SHOPPING_ADS', created_time: '2026-02-01T08:00:00+0000' },
    { id: '9002', name: 'Retargeting — Site 30d', objective: 'CONVERSIONS', status: 'ACTIVE', effective_status: 'ACTIVE', bid_strategy: 'COST_CAP', created_time: '2026-03-10T08:00:00+0000' },
  ],
}

const ADSETS = {
  data: [
    { id: '8001', name: 'Advantage+ audience', campaign_id: '9001', status: 'ACTIVE', effective_status: 'ACTIVE', optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS', targeting: { targeting_automation: { advantage_audience: 1 } }, learning_stage_info: { status: 'SUCCESS' }, created_time: '2026-02-01T08:00:00+0000' },
    { id: '8002', name: 'RT: Site visitors', campaign_id: '9002', status: 'ACTIVE', effective_status: 'ACTIVE', optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS', daily_budget: '4000', targeting: { custom_audiences: [{ id: 'ca1', name: 'Site visitors 30d' }] }, learning_stage_info: { status: 'FAIL' }, created_time: '2026-03-10T08:00:00+0000' },
    { id: '8003', name: 'RT: ATC 14d', campaign_id: '9002', status: 'ACTIVE', effective_status: 'ADSET_PAUSED', optimization_goal: 'VALUE', billing_event: 'IMPRESSIONS', daily_budget: '2500', targeting: { custom_audiences: [{ id: 'ca2', name: 'ATC 14d' }] }, created_time: '2026-03-10T08:00:00+0000' },
  ],
}

/** Creatives arrive EXPANDED INLINE on each ad (`creative{id,name,...}`) —
 *  there is no separate /adcreatives request. Ad 7004 carries only a bare
 *  creative id, the degenerate case a real account produces. */
const ADS = {
  data: [
    {
      id: '7001', name: 'UGC testimonial video', adset_id: '8001', campaign_id: '9001', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-04-02T08:00:00+0000',
      creative: { id: '6001', name: 'UGC — real customer review', object_story_spec: { video_data: { title: 'Real results', message: 'This customer review says it all', video_id: 'v1' } } },
    },
    {
      id: '7002', name: '20% off promo static', adset_id: '8001', campaign_id: '9001', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-06-20T08:00:00+0000',
      creative: { id: '6002', name: 'Summer promo', object_story_spec: { link_data: { name: '20% off everything', message: 'Summer sale ends soon' } } },
    },
    {
      id: '7003', name: 'Retargeting carousel', adset_id: '8002', campaign_id: '9002', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-05-15T08:00:00+0000',
      creative: { id: '6003', name: 'Bestsellers carousel', object_story_spec: { link_data: { child_attachments: [{}, {}, {}, {}] } } },
    },
    {
      id: '7004', name: 'Legacy ad, creative detail unavailable', adset_id: '8003', campaign_id: '9002', status: 'ACTIVE', effective_status: 'ADSET_PAUSED', created_time: '2026-03-15T08:00:00+0000',
      creative: { id: '6999' },
    },
  ],
}

/** Daily rows: ad 7001 is a healthy performer; 7002 is a DOA burner (real spend,
 *  terrible CTR, zero purchases) the engine should catch; 7003 modest. */
function insightRows() {
  const rows: unknown[] = []
  for (let i = DAYS_OF_ROWS - 1; i >= 0; i--) {
    const date = daysAgo(i)
    rows.push({
      ad_id: '7001', date_start: date, spend: '180.00', impressions: '11000', reach: '6000', clicks: '260', inline_link_clicks: '190',
      actions: [{ action_type: 'omni_purchase', value: '9' }, { action_type: 'add_to_cart', value: '30' }, { action_type: 'landing_page_view', value: '150' }],
      action_values: [{ action_type: 'omni_purchase', value: '585.00' }],
      video_play_actions: [{ action_type: 'video_view', value: '9500' }],
      video_3_sec_watched_actions: [{ action_type: 'video_view', value: '3400' }],
      video_thruplay_watched_actions: [{ action_type: 'video_view', value: '1250' }],
    })
    rows.push({
      ad_id: '7002', date_start: date, spend: '95.00', impressions: '9000', reach: '5200', clicks: '18', inline_link_clicks: '11',
      actions: [{ action_type: 'add_to_cart', value: '1' }], action_values: [],
    })
    rows.push({
      ad_id: '7003', date_start: date, spend: '40.00', impressions: '2600', reach: '1500', clicks: '48', inline_link_clicks: '36',
      actions: [{ action_type: 'omni_purchase', value: '2' }], action_values: [{ action_type: 'omni_purchase', value: '130.00' }],
    })
  }
  return { data: rows }
}

const CFG: LiveConfig = {
  accounts: [{ clientId: 'c_forge', adAccountId: 'act_777', businessId: 'biz_agency', businessName: 'Northbeam Collective', businessType: 'agency' }],
  clients: [
    { id: 'c_forge', name: 'Forge Athletics', bmId: '', vertical: 'Activewear', accentColor: '', monogram: '', status: 'active', currency: 'USD', monthlyBudget: 90000, targetCPA: 55, targetROAS: 1.8, avgOrderValue: 95, contributionMargin: 0.4, startDate: '2025-01-01' },
  ],
  windowDays: WINDOW,
}

/** TRUE de-duplicated period reach per ad (what a summary insights query —
 *  no time_increment — returns). Deliberately much smaller than the additive
 *  daily sum so the P4 override is observable: ad 7001's daily reach sums to
 *  6000×7=42,000 over 7d while its true 7d reach is 18,000. */
const PERIOD_REACH: Record<string, number> = { '7001': 18000, '7002': 15000, '7003': 4200 }

function summaryReachRows() {
  return { data: Object.entries(PERIOD_REACH).map(([ad_id, reach]) => ({ ad_id, reach: String(reach) })) }
}

function graphResponse(url: URL): unknown {
  const pathname = url.pathname
  if (pathname.endsWith('/act_777')) return { id: 'act_777', name: 'Forge Athletics — Main', currency: 'USD', timezone_name: 'UTC' }
  if (pathname.endsWith('/act_777/campaigns')) return CAMPAIGNS
  if (pathname.endsWith('/act_777/adsets')) return ADSETS
  if (pathname.endsWith('/act_777/ads')) return ADS
  if (pathname.endsWith('/act_777/insights')) {
    // daily pull carries time_increment=1; period-reach pulls are summary
    return url.searchParams.get('time_increment') === '1' ? insightRows() : summaryReachRows()
  }
  return { error: { message: `unexpected path ${pathname}` } }
}

const seenRequests: Array<{ path: string; businessHeader: string | null; hasToken: boolean }> = []
/** Every /insights request's window, for the P8 #16 time_range assertions. */
const insightRequests: Array<{ since: string; until: string; timeIncrement: string | null }> = []

describe('LiveProvider.loadSnapshot — full pipeline against a fake Graph', () => {
  let snapshot: Snapshot

  beforeAll(async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      seenRequests.push({
        path: url.pathname,
        businessHeader: (init?.headers as Record<string, string> | undefined)?.['X-Meta-Business-Id'] ?? null,
        hasToken: url.searchParams.has('access_token'),
      })
      if (url.pathname.endsWith('/insights') && url.searchParams.has('time_range')) {
        const tr = JSON.parse(url.searchParams.get('time_range')!) as { since: string; until: string }
        insightRequests.push({ since: tr.since, until: tr.until, timeIncrement: url.searchParams.get('time_increment') })
      }
      return new Response(JSON.stringify(graphResponse(url)), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    snapshot = await new LiveProvider(CFG).loadSnapshot()
    // Mirror what the store does on load: anchor all windows to this snapshot.
    setDataContext(snapshot.dataAnchor, snapshot.windowDays)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    setDataContext(DATA_TODAY, WINDOW_DAYS) // restore the demo anchor for other suites
  })

  it('produces a fully-indexed Snapshot (no throw, all 12 index Maps live)', () => {
    expect(snapshot.mode).toBe('live')
    expect(snapshot.campaigns).toHaveLength(2)
    expect(snapshot.adSets).toHaveLength(3)
    expect(snapshot.ads).toHaveLength(4)
    expect(snapshot.creatives).toHaveLength(4) // 3 real + 1 placeholder
    expect(snapshot.insights).toHaveLength(DAYS_OF_ROWS * 3)
    expect(snapshot.campaignById.get('9001')?.kind).toBe('advantage_plus')
    expect(snapshot.adSetsByCampaign.get('9002')).toHaveLength(2)
    expect(snapshot.adsByAdSet.get('8001')).toHaveLength(2)
    expect(snapshot.clientById.get('c_forge')?.name).toBe('Forge Athletics')
    expect(snapshot.insightsByAd.get('7001')).toHaveLength(DAYS_OF_ROWS)
  })

  it('anchors to the account timezone today + floors the window at 56 days', () => {
    expect(snapshot.dataAnchor).toBe(utcToday())
    expect(snapshot.windowDays).toBe(EFFECTIVE_WINDOW) // 30 configured → floored
  })

  it('requests anchor-frame insight windows: daily pull widened ±1 day, period pulls exact (P8 #16)', () => {
    const daily = insightRequests.find((r) => r.timeIncrement === '1')!
    expect(daily, 'daily ad-grain pull must exist').toBeDefined()
    // widened one day each edge so tz-shifted accounts still cover every app date
    expect(daily.since).toBe(daysAgo(EFFECTIVE_WINDOW))
    expect(daily.until).toBe(daysAgo(-1))
    // the 7d period-reach pull is exact — [anchor-6, anchor]
    const p7 = insightRequests.find((r) => !r.timeIncrement && r.since === daysAgo(6))
    expect(p7, 'a 7d summary reach pull must exist').toBeDefined()
    expect(p7!.until).toBe(daysAgo(0))
    // The 'full' window reach pull is deliberately NOT made: ad-level unique
    // counts over the whole history are the query Meta refuses on real
    // accounts (error code 1), and no date preset requests that range.
    const fullReach = insightRequests.find((r) => !r.timeIncrement && r.since === daysAgo(EFFECTIVE_WINDOW - 1))
    expect(fullReach, 'the full-window reach pull must NOT be requested').toBeUndefined()
    // …and no summary reach pull spans more than 28 days
    const widestReach = Math.max(
      ...insightRequests
        .filter((r) => !r.timeIncrement)
        .map((r) => Math.round((Date.parse(r.until) - Date.parse(r.since)) / 86_400_000) + 1),
    )
    expect(widestReach).toBeLessThanOrEqual(28)
  })

  it('never sends a token from the browser; routes the business id header', () => {
    expect(seenRequests.length).toBeGreaterThan(0)
    for (const r of seenRequests) {
      expect(r.hasToken).toBe(false)
      expect(r.businessHeader).toBe('biz_agency')
      expect(r.path).toContain(`/${API_VERSION}/`)
    }
  })

  it('maps statuses into the 5-value enum (StatusBadge can render every row)', () => {
    const valid = new Set(['ACTIVE', 'PAUSED', 'LEARNING', 'LEARNING_LIMITED', 'ARCHIVED'])
    for (const e of [...snapshot.campaigns, ...snapshot.adSets, ...snapshot.ads]) {
      expect(valid.has(e.status)).toBe(true)
    }
    expect(snapshot.adSetById.get('8002')?.status).toBe('LEARNING_LIMITED') // learning FAIL
    expect(snapshot.adSetById.get('8003')?.status).toBe('PAUSED') // ADSET_PAUSED
    expect(snapshot.adById.get('7004')?.status).toBe('PAUSED')
  })

  it('every ad resolves a creative from the inline expansion (no /adcreatives call)', () => {
    for (const ad of snapshot.ads) {
      expect(snapshot.creativeById.get(ad.creativeId)).toBeDefined()
      expect(snapshot.creativeById.get(ad.creativeId)!.thumbnailGradient).toHaveLength(2)
    }
    expect(snapshot.creativeById.get('6003')?.format).toBe('carousel')
  })

  it('clients carry cosmetics + BM binding (directory/scope switcher render)', () => {
    const c = snapshot.clientById.get('c_forge')!
    expect(c.bmId).toBe('biz_agency')
    expect(c.monogram).toBeTruthy()
    expect(c.accentColor).toMatch(/^#/)
    expect(snapshot.businessManagers).toEqual([{ id: 'biz_agency', name: 'Northbeam Collective', type: 'agency', metaBusinessId: 'biz_agency' }])
  })

  it('KPIs aggregate from mapped insights (7d window vs the live anchor)', () => {
    const rows = filterByRange(snapshot.insights, makeRange('7d'))
    const agg = aggregate(rows)
    expect(agg.spend).toBeCloseTo((180 + 95 + 40) * 7, 0)
    expect(agg.purchases).toBe((9 + 0 + 2) * 7)
    expect(agg.roas).toBeGreaterThan(0)
  })

  it('period frequency uses TRUE de-duplicated reach, not the daily-sum collapse (P4)', () => {
    const m7 = metricsForAdIds(snapshot, ['7001'], makeRange('7d'))
    // additive daily sum would be 6000×7 = 42,000 → freq ≈ 1.83; true period
    // reach is 18,000 → freq = 77,000/18,000 ≈ 4.28
    expect(m7.reach).toBe(18000)
    expect(m7.frequency).toBeCloseTo((11000 * 7) / 18000, 2)
    // non-canonical ranges keep the labelled additive approximation
    const custom = metricsForAdIds(snapshot, ['7001'], { preset: 'custom', start: daysAgo(5), end: daysAgo(1), label: 'x' })
    expect(custom.reach).toBe(6000 * 5)
  })

  it('the AI engine runs on the live snapshot and catches the seeded DOA burner', () => {
    const suggestions = analyzeScope(snapshot, { kind: 'portfolio' })
    expect(suggestions.length).toBeGreaterThan(0)
    const doa = suggestions.find((s) => s.entityId === '7002' && (s.type === 'PAUSE_ENTITY' || s.type === 'CUT_BUDGET'))
    expect(doa, 'engine should flag the 0-order burner ad 7002').toBeDefined()
    // and it must NOT propose scaling the paused/learning-limited ad set
    const badScale = suggestions.find((s) => s.type === 'SCALE_BUDGET' && (s.entityId === '8003' || s.entityId === '7004'))
    expect(badScale).toBeUndefined()
  })
})
