import { describe, it, expect } from 'vitest'
import { currencyOffset } from '../provider/liveProvider'

/* The static currency_offset map is a stable contract (Meta minor-unit factors).
   Per-account sourcing of currency_offset (#03) is live-only and ledgered, not
   unit-tested here. */
describe('currencyOffset (static fallback map)', () => {
  it('two-decimal currencies → 100', () => {
    for (const c of ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'BRL', 'MXN']) {
      expect(currencyOffset(c)).toBe(100)
    }
  })

  it('zero-decimal currencies → 1', () => {
    for (const c of ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX']) {
      expect(currencyOffset(c)).toBe(1)
    }
  })

  it('three-decimal currencies → 1000', () => {
    for (const c of ['KWD', 'BHD', 'JOD', 'OMR', 'TND']) {
      expect(currencyOffset(c)).toBe(1000)
    }
  })

  it('unknown currency defaults to 100', () => {
    expect(currencyOffset('XYZ')).toBe(100)
  })

  it('is case-insensitive', () => {
    expect(currencyOffset('jpy')).toBe(1)
    expect(currencyOffset('usd')).toBe(100)
  })

  // HUF and TWD are two-decimal in Meta's currency_offset; the map previously
  // mis-bucketed them as zero-decimal (a budget POST would have been 100x too
  // small). Fixed in P5 — these now assert the correct value.
  it('HUF is two-decimal (100)', () => {
    expect(currencyOffset('HUF')).toBe(100)
  })
  it('TWD is two-decimal (100)', () => {
    expect(currencyOffset('TWD')).toBe(100)
  })
})
