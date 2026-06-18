import { describe, it, expect } from 'vitest'
import { analyzeAd } from '../ai/engine'
import { DATA_TODAY } from '../demo/generate'
import { addDays } from '../metrics'
import type { Dataset } from '../demo/generate'
import type { Ad, AdSet, Campaign, Client, Insight } from '../types'

/* #22 — the DOA rule must NOT gate on purchase count. A sub-0.5% CTR creative with
   a couple of orders previously slipped every rule (DOA needed <=1 order, the hard
   cut needs >=5). These tests build a minimal dataset and exercise analyzeAd directly. */

const client: Client = {
  id: 'c_t', name: 'Test Co', bmId: 'bm', vertical: 'DTC', accentColor: '#fff', monogram: 'T',
  status: 'active', currency: 'USD', monthlyBudget: 30_000, targetCPA: 50, targetROAS: 2,
  avgOrderValue: 80, contributionMargin: 0.5, startDate: '2026-01-01',
}
const campaign: Campaign = {
  id: 'cmp', clientId: 'c_t', accountId: 'act', name: 'Prospecting', objective: 'OUTCOME_SALES',
  status: 'ACTIVE', budgetType: 'ABO', dailyBudget: null, bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
  kind: 'prospecting', createdAt: '2026-01-01',
}
const adSet: AdSet = {
  id: 'as', campaignId: 'cmp', clientId: 'c_t', name: 'Broad', status: 'ACTIVE',
  optimizationGoal: 'OFFSITE_CONVERSIONS', billingEvent: 'IMPRESSIONS', dailyBudget: 80,
  audience: { type: 'broad', label: 'Broad', sizeEstimate: 1_000_000 }, createdAt: '2026-01-01',
}
const ad: Ad = {
  id: 'ad', adSetId: 'as', campaignId: 'cmp', clientId: 'c_t', name: 'Ad', status: 'ACTIVE',
  creativeId: 'cr', createdAt: '2026-01-01',
}

/** 7 daily rows ending today, each identical except a per-day purchase count. */
function buildInsights(opts: { impressions: number; linkClicks: number; spend: number; dailyPurchases: number[] }): Insight[] {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(DATA_TODAY, -(6 - i)))
  return dates.map((date, i) => ({
    adId: 'ad', clientId: 'c_t', date,
    spend: opts.spend, impressions: opts.impressions, reach: Math.round(opts.impressions / 1.4),
    clicks: opts.linkClicks + 3, linkClicks: opts.linkClicks,
    purchases: opts.dailyPurchases[i] ?? 0, revenue: (opts.dailyPurchases[i] ?? 0) * 80,
    addToCart: 4, landingPageViews: Math.max(0, opts.linkClicks - 2),
    videoPlays: 0, video3s: 0, videoThruplays: 0,
  }))
}

function miniDataset(insights: Insight[]): Dataset {
  return {
    campaignById: new Map([[campaign.id, campaign]]),
    adSetById: new Map([[adSet.id, adSet]]),
    adById: new Map([[ad.id, ad]]),
    creativeById: new Map(),
    insightsByAd: new Map([[ad.id, insights]]),
  } as unknown as Dataset
}

describe('analyzeAd — DOA gating (#22)', () => {
  it('flags a sub-0.5% CTR creative with 2–4 orders as DOA (no longer slips every rule)', () => {
    // 4000 impr/day, 12 link clicks/day → 0.30% CTR; $30/day spend (≥ target CPA);
    // 3 orders across the week (in the 2–4 band that used to escape).
    const ds = miniDataset(buildInsights({ impressions: 4000, linkClicks: 12, spend: 30, dailyPurchases: [1, 0, 1, 0, 1, 0, 0] }))
    const s = analyzeAd(ds, ad, client)
    expect(s).not.toBeNull()
    expect(s!.type).toBe('PAUSE_ENTITY')
    expect(s!.title).toContain('DOA')
  })

  it('does NOT flag a healthy-CTR ad with the same low order count', () => {
    // 4000 impr/day, 60 link clicks/day → 1.5% CTR (above the 0.5% floor).
    const ds = miniDataset(buildInsights({ impressions: 4000, linkClicks: 60, spend: 30, dailyPurchases: [1, 0, 1, 0, 1, 0, 0] }))
    const s = analyzeAd(ds, ad, client)
    expect(s?.type).not.toBe('PAUSE_ENTITY')
  })
})
