import { describe, it, expect } from 'vitest'
import { generateDataset, DATA_TODAY } from '../demo/generate'
import { earliestDate } from '../metrics'
import { analyzeScope } from '../ai/engine'
import type { Insight } from '../types'

/* These assert REPRODUCIBILITY + STRUCTURAL INVARIANTS on the un-memoized
   generateDataset() — never pinned seeded magic numbers, never getDataset()
   (the memoized singleton). This is what survives P3's #32 generator change. */

/** A version-independent projection of the dataset, stable under any code version
 *  (so two runs in the SAME build must match). */
function projection(ds: ReturnType<typeof generateDataset>) {
  const perAd = [...ds.ads]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((ad) => {
      const rows = ds.insightsByAd.get(ad.id) ?? []
      const spend = Math.round(rows.reduce((s, r) => s + r.spend, 0))
      const purchases = rows.reduce((s, r) => s + r.purchases, 0)
      return { id: ad.id, status: ad.status, spend, purchases, rows: rows.length }
    })
  return {
    counts: {
      clients: ds.clients.length,
      campaigns: ds.campaigns.length,
      adSets: ds.adSets.length,
      ads: ds.ads.length,
      creatives: ds.creatives.length,
      insights: ds.insights.length,
    },
    perAd,
  }
}

describe('generateDataset — determinism', () => {
  it('two builds in the same version produce an identical projection', () => {
    expect(JSON.stringify(projection(generateDataset()))).toBe(JSON.stringify(projection(generateDataset())))
  })

  it('produces a non-trivial dataset (7 clients, 3 BMs)', () => {
    const ds = generateDataset()
    expect(ds.clients.length).toBe(7)
    expect(ds.businessManagers.length).toBe(3)
    expect(ds.campaigns.length).toBeGreaterThan(15)
    expect(ds.ads.length).toBeGreaterThan(100)
    expect(ds.insights.length).toBeGreaterThan(5000)
  })
})

describe('generateDataset — structural invariants', () => {
  const ds = generateDataset()

  it('every insight date is within the demo window', () => {
    const lo = earliestDate()
    for (const r of ds.insights) {
      expect(r.date >= lo).toBe(true)
      expect(r.date <= DATA_TODAY).toBe(true)
    }
  })

  it('funnel and base facts are non-negative and correctly ordered', () => {
    const sampleEvery = 37 // sample to keep the loop fast but representative
    ds.insights.forEach((r: Insight, i) => {
      if (i % sampleEvery !== 0) return
      // non-negative additive facts
      for (const v of [r.spend, r.impressions, r.reach, r.clicks, r.linkClicks, r.purchases, r.revenue]) {
        expect(v).toBeGreaterThanOrEqual(0)
      }
      // funnel ordering (robust subset)
      expect(r.impressions).toBeGreaterThanOrEqual(r.linkClicks)
      expect(r.clicks).toBeGreaterThanOrEqual(r.linkClicks)
      expect(r.linkClicks).toBeGreaterThanOrEqual(r.landingPageViews)
      expect(r.addToCart).toBeGreaterThanOrEqual(r.purchases)
      // reach is bounded by impressions and at least 1 (frequency >= 1)
      expect(r.reach).toBeGreaterThanOrEqual(1)
      expect(r.reach).toBeLessThanOrEqual(r.impressions)
    })
  })
})

describe('analyzeScope — suggestion-mix coverage', () => {
  const ds = generateDataset()
  const suggestions = analyzeScope(ds, { kind: 'portfolio' })
  const types = new Set(suggestions.map((s) => s.type))

  it('produces a populated, deduplicated feed (unique ids)', () => {
    expect(suggestions.length).toBeGreaterThan(20)
    expect(new Set(suggestions.map((s) => s.id)).size).toBe(suggestions.length)
  })

  it('surfaces the ensureCoverage-guaranteed types', () => {
    // ensureCoverage() deterministically plants a DOA burner and a sparse testing
    // campaign in every non-onboarding client → these are stable across #32.
    expect(types.has('PAUSE_ENTITY')).toBe(true)
    expect(types.has('CONSOLIDATE_ADSETS')).toBe(true)
  })

  it('surfaces a diverse mix (>= 4 distinct suggestion types)', () => {
    expect(types.size).toBeGreaterThanOrEqual(4)
  })

  it('every suggestion has finite confidence in [0,1] and a non-empty rationale', () => {
    for (const s of suggestions) {
      expect(s.confidence).toBeGreaterThanOrEqual(0)
      expect(s.confidence).toBeLessThanOrEqual(1)
      expect(s.rationale.length).toBeGreaterThan(0)
    }
  })
})
