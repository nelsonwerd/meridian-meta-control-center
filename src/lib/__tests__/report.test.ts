import { describe, it, expect } from 'vitest'
import { generateDataset } from '../demo/generate'
import { buildWeeklyReport } from '../ai/report'
import { computePacing } from '../selectors'

const ds = generateDataset()

describe('buildWeeklyReport', () => {
  it('every client report carries a sentiment aligned to its headline (#51)', () => {
    for (const c of ds.clients) {
      const r = buildWeeklyReport(ds, c.id)
      expect(['positive', 'caution', 'neutral']).toContain(r.direction)
      // the icon-driving direction must never read "positive" over a caution headline
      if (r.headline.includes('watch rising CPA') || r.headline.startsWith('Soft week')) {
        expect(r.direction).toBe('caution')
      }
      if (r.headline.startsWith('Steady week')) {
        expect(r.direction).toBe('neutral')
      }
    }
  })

  it('report pacing is finite and non-negative (no NaN/Infinity)', () => {
    for (const c of ds.clients) {
      const r = buildWeeklyReport(ds, c.id)
      expect(Number.isFinite(r.pacing.pace)).toBe(true)
      expect(Number.isFinite(r.pacing.projection)).toBe(true)
      expect(r.pacing.pace).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('computePacing (#12 shared helper)', () => {
  it('returns finite, day-of-month-guarded values for every client', () => {
    for (const c of ds.clients) {
      const p = computePacing(ds, c.id)
      expect(p.dayOfMonth).toBeGreaterThanOrEqual(1)
      expect(p.daysInMonth).toBeGreaterThanOrEqual(28)
      expect(Number.isFinite(p.projection)).toBe(true)
      expect(Number.isFinite(p.pace)).toBe(true)
    }
  })
})
