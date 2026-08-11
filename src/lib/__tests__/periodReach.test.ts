import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalPeriodKey, makeRange, periodBounds, setDataContext } from '../metrics'
import { periodBoundsFor } from '../provider/liveMap'
import { lastNDays, metricsForAdIds } from '../selectors'
import { DATA_TODAY, WINDOW_DAYS, type Dataset } from '../demo/generate'
import type { Insight, PeriodKey } from '../types'

/* P4 — period reach/frequency correctness. The engine's fatigue gate
   (m7.frequency > threshold) and scale gate (m7.frequency < threshold) read
   7-day frequency; summing daily reach collapses it toward ~1.0 and breaks
   both. These tests pin the canonical-window matching and the override rules. */

const ANCHOR = '2026-08-11'

beforeAll(() => setDataContext(ANCHOR, 30))
afterAll(() => setDataContext(DATA_TODAY, WINDOW_DAYS))

describe('canonicalPeriodKey ↔ periodBoundsFor parity', () => {
  it('every canonical key round-trips through both implementations', () => {
    const keys: PeriodKey[] = ['3d', '7d', '14d', '28d', 'prev7', 'prev14', 'full']
    for (const key of keys) {
      const app = periodBounds(key) // anchored via setDataContext
      const live = periodBoundsFor(key, ANCHOR, 30) // anchored explicitly
      expect(live, `bounds mismatch for ${key}`).toEqual(app)
      expect(canonicalPeriodKey({ preset: 'custom', ...app, label: key })).toBe(key)
    }
  })

  it('matches the engine lastNDays windows exactly', () => {
    expect(canonicalPeriodKey(lastNDays(7))).toBe('7d')
    expect(canonicalPeriodKey(lastNDays(3))).toBe('3d')
    expect(canonicalPeriodKey(lastNDays(7, 7))).toBe('prev7')
    expect(canonicalPeriodKey(lastNDays(14, 14))).toBe('prev14')
    expect(canonicalPeriodKey(makeRange('28d'))).toBe('28d')
  })

  it('non-canonical ranges return null (custom/mtd keep additive)', () => {
    expect(canonicalPeriodKey({ preset: 'custom', start: '2026-08-01', end: '2026-08-09', label: 'x' })).toBeNull()
    expect(canonicalPeriodKey(makeRange('mtd'))).toBeNull()
  })
})

/** Minimal hand-built dataset: 14 daily rows for two ads. */
function makeDs(periodReachByAd?: Dataset['periodReachByAd']): Dataset {
  const insights: Insight[] = []
  const mk = (adId: string, date: string, impressions: number, reach: number): Insight => ({
    adId, clientId: 'c', date, spend: 100, impressions, reach, clicks: 50, linkClicks: 40,
    purchases: 3, revenue: 180, addToCart: 8, landingPageViews: 30, videoPlays: 0, video3s: 0, videoThruplays: 0,
  })
  for (let i = 0; i < 14; i++) {
    const d = new Date(ANCHOR + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - i)
    const date = d.toISOString().slice(0, 10)
    insights.push(mk('ad_a', date, 10000, 5500))
    insights.push(mk('ad_b', date, 4000, 2500))
  }
  const byAd = new Map<string, Insight[]>()
  for (const i of insights) byAd.set(i.adId, [...(byAd.get(i.adId) ?? []), i])
  // only the fields metricsForAdIds touches
  return { insights, insightsByAd: byAd, periodReachByAd } as unknown as Dataset
}

describe('metricsForAdIds period-reach override', () => {
  it('demo (no map) keeps the additive approximation untouched', () => {
    const m = metricsForAdIds(makeDs(undefined), ['ad_a'], lastNDays(7))
    expect(m.reach).toBe(5500 * 7)
    expect(m.frequency).toBeCloseTo(10000 / 5500, 3) // ≈1.8 collapsed — labelled demo behaviour
  })

  it('live map overrides reach + frequency for canonical windows', () => {
    const ds = makeDs(new Map([
      ['ad_a', { '7d': 16000 }],
      ['ad_b', { '7d': 7000 }],
    ]))
    const m = metricsForAdIds(ds, ['ad_a', 'ad_b'], lastNDays(7))
    expect(m.reach).toBe(23000)
    expect(m.frequency).toBeCloseTo(((10000 + 4000) * 7) / 23000, 3) // ≈4.26 — fatigue-gate territory
  })

  it('falls back additively when ANY delivering ad lacks an entry (never blends)', () => {
    const ds = makeDs(new Map([['ad_a', { '7d': 16000 }]])) // ad_b missing
    const m = metricsForAdIds(ds, ['ad_a', 'ad_b'], lastNDays(7))
    expect(m.reach).toBe((5500 + 2500) * 7)
  })

  it('falls back additively for non-canonical ranges', () => {
    const ds = makeDs(new Map([['ad_a', { '7d': 16000 }]]))
    const m = metricsForAdIds(ds, ['ad_a'], { preset: 'custom', start: '2026-08-03', end: '2026-08-08', label: 'x' })
    expect(m.reach).toBe(5500 * 6)
  })

  it('ads with no in-range delivery never block the override', () => {
    const ds = makeDs(new Map([['ad_a', { '7d': 16000 }]]))
    // ad_zzz has no rows at all — must not force the fallback
    const m = metricsForAdIds(ds, ['ad_a', 'ad_zzz'], lastNDays(7))
    expect(m.reach).toBe(16000)
  })
})
