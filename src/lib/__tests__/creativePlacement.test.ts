import { describe, expect, it } from 'vitest'
import { creativePlacement } from '../selectors'
import { generateDataset, DATA_TODAY } from '../demo/generate'
import type { DateRange } from '../types'

/* A creative card is only actionable if it says WHICH ad carries it. These cover
   the resolution behind that line — and the drill-in target it hands the drawer. */

const ds = generateDataset()
const range: DateRange = { start: '2026-01-01', end: DATA_TODAY, label: 'All', preset: 'custom' }

describe('creativePlacement', () => {
  it('names the ad when exactly one carries the creative, with its parent path', () => {
    const ad = ds.ads[0]
    const p = creativePlacement(ds, [ad.id], range)
    expect(p.label).toBe(ad.name)
    expect(p.primaryAdId).toBe(ad.id)
    expect(p.sub).toContain(ds.campaignById.get(ad.campaignId)!.name) // › the campaign
  })

  it('counts instead of naming one when several ads share the creative', () => {
    const ads = ds.ads.slice(0, 3)
    const p = creativePlacement(ds, ads.map((a) => a.id), range)
    expect(p.label).toBe('3 ads') // never passes one ad off as the whole story
    expect(ads.map((a) => a.id)).toContain(p.primaryAdId)
  })

  it('drills into the HIGHEST-SPEND ad, not simply the first', () => {
    // spend across the full window, so the expectation matches what a user sees
    const spendOf = (id: string) => (ds.insightsByAd.get(id) ?? []).reduce((s, r) => s + r.spend, 0)
    const ids = ds.ads.slice(0, 12).map((a) => a.id)
    const p = creativePlacement(ds, ids, range)
    const top = [...ids].sort((a, b) => spendOf(b) - spendOf(a))[0]
    expect(p.primaryAdId).toBe(top)
    expect(spendOf(p.primaryAdId!)).toBeGreaterThan(0) // an arbitrary pick could be a $0 dupe
  })

  it('degrades honestly when no ad resolves — and offers nothing to click', () => {
    const p = creativePlacement(ds, ['ad_that_does_not_exist'], range)
    expect(p.label).toMatch(/no live ad/i)
    expect(p.primaryAdId).toBeUndefined()
  })

  it('summarises by campaign count when the ads span more than one campaign', () => {
    const byCampaign = new Map<string, string[]>()
    for (const a of ds.ads) byCampaign.set(a.campaignId, [...(byCampaign.get(a.campaignId) ?? []), a.id])
    const twoCampaigns = [...byCampaign.values()].slice(0, 2)
    const p = creativePlacement(ds, [twoCampaigns[0][0], twoCampaigns[1][0]], range)
    expect(p.sub).toBe('2 campaigns')
  })
})
