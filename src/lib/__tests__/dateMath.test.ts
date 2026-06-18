import { describe, it, expect } from 'vitest'
import { addDays, daysBetween, enumerateDates, makeRange, previousRange } from '../metrics'

/* Cheap insurance for the P3 #17 addDays/daysBetween extraction into date.ts —
   the new module is verified by a green diff here, not just a typecheck. */
describe('date math (UTC-anchored)', () => {
  it('addDays crosses month and year UTC boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('daysBetween is integer and symmetric in magnitude', () => {
    expect(daysBetween('2026-06-01', '2026-06-10')).toBe(9)
    expect(daysBetween('2026-06-10', '2026-06-01')).toBe(-9)
    expect(Number.isInteger(daysBetween('2026-01-01', '2026-12-31'))).toBe(true)
  })

  it('enumerateDates is inclusive (length = daysBetween + 1)', () => {
    const dates = enumerateDates('2026-06-01', '2026-06-07')
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-06-01')
    expect(dates[6]).toBe('2026-06-07')
  })

  it('makeRange single-day presets have start === end', () => {
    const today = makeRange('today')
    expect(today.start).toBe(today.end)
    const yesterday = makeRange('yesterday')
    expect(yesterday.start).toBe(yesterday.end)
    expect(daysBetween(yesterday.end, today.end)).toBe(1)
  })

  it('previousRange is equal-length, immediately preceding, and non-overlapping', () => {
    const range = makeRange('7d')
    const prev = previousRange(range)
    const len = daysBetween(range.start, range.end) + 1
    const prevLen = daysBetween(prev.start, prev.end) + 1
    expect(prevLen).toBe(len)
    expect(addDays(prev.end, 1)).toBe(range.start) // immediately precedes
    expect(prev.end < range.start).toBe(true) // no overlap
  })
})
