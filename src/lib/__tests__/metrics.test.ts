import { describe, it, expect } from 'vitest'
import { aggregate, EMPTY_BUNDLE, kpiDelta } from '../metrics'
import type { Insight } from '../types'

function row(over: Partial<Insight>): Insight {
  return {
    adId: 'ad_x', clientId: 'c_x', date: '2026-06-01',
    spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, purchases: 0, revenue: 0,
    addToCart: 0, landingPageViews: 0, videoPlays: 0, video3s: 0, videoThruplays: 0,
    ...over,
  }
}

describe('aggregate — additive roll-up + derived rates', () => {
  it('returns the EMPTY_BUNDLE shape (all zero) for no rows', () => {
    expect(aggregate([])).toEqual(EMPTY_BUNDLE)
  })

  it('sums additive base facts across rows', () => {
    const b = aggregate([
      row({ spend: 100, impressions: 10_000, reach: 5_000, linkClicks: 200, purchases: 10, revenue: 500 }),
      row({ spend: 50, impressions: 5_000, reach: 2_500, linkClicks: 100, purchases: 5, revenue: 250 }),
    ])
    expect(b.spend).toBe(150)
    expect(b.impressions).toBe(15_000)
    expect(b.purchases).toBe(15)
    expect(b.revenue).toBe(750)
  })

  it('derives rates from the summed facts (not averaged from rows)', () => {
    const b = aggregate([row({ spend: 100, impressions: 10_000, reach: 5_000, linkClicks: 200, purchases: 10, revenue: 500 })])
    expect(b.ctr).toBeCloseTo(2.0) // 200/10000 * 100
    expect(b.cpm).toBeCloseTo(10.0) // 100/10000 * 1000
    expect(b.cpa).toBeCloseTo(10.0) // 100/10
    expect(b.roas).toBeCloseTo(5.0) // 500/100
    expect(b.frequency).toBeCloseTo(2.0) // 10000/5000
    expect(b.cvr).toBeCloseTo(5.0) // 10/200 * 100
  })

  it('guards every divide-by-zero (no NaN/Infinity leaks)', () => {
    const b = aggregate([row({ spend: 100 })]) // impressions/reach/clicks/purchases all 0
    for (const v of Object.values(b)) {
      expect(Number.isFinite(v)).toBe(true)
    }
    expect(b.cpa).toBe(0)
    expect(b.roas).toBe(0)
    expect(b.ctr).toBe(0)
    expect(b.frequency).toBe(0)
  })
})

describe('kpiDelta', () => {
  it('computes signed delta and percent vs previous', () => {
    const d = kpiDelta('cpa', 12, 10)
    expect(d.delta).toBe(2)
    expect(d.deltaPct).toBeCloseTo(0.2)
    expect(d.higherIsBetter).toBe(false) // CPA up is bad
  })

  it('marks volume metrics neutral', () => {
    expect(kpiDelta('spend', 100, 80).neutral).toBe(true)
    expect(kpiDelta('purchases', 10, 8).neutral).toBe(false)
  })

  it('flags isNew when prev is 0 (so the UI shows "new", not a fabricated +100%)', () => {
    const d = kpiDelta('purchases', 5, 0)
    expect(d.isNew).toBe(true)
    expect(Number.isFinite(d.deltaPct)).toBe(true)
  })

  it('does not flag isNew when there is a real baseline (or no change at all)', () => {
    expect(kpiDelta('purchases', 5, 4).isNew).toBe(false)
    expect(kpiDelta('purchases', 0, 0).isNew).toBe(false)
  })
})
