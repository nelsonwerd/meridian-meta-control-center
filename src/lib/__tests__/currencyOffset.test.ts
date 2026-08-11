import { describe, it, expect } from 'vitest'
import { currencyOffset } from '../provider/liveProvider'

/* The minor-unit offset map, corrected 2026-08-11 against Meta's own currencies
   reference (developers.facebook.com/docs/marketing-api/currencies):

   - Offset 1 for EXACTLY: CLP, COP, CRC, HUF, ISK, IDR, JPY, KRW, PYG, TWD, VND.
   - Offset 100 for every other supported ad currency.
   - Meta bills ads in no offset-1000 currency (KWD/BHD/JOD/OMR/TND are not
     billable ad currencies), so the former three-decimal bucket was removed.

   NB the two traps this map guards against:
   1. HUF and TWD are offset 1 at Meta DESPITE being 2-decimal in ISO-4217 —
      an "ISO decimals" assumption would POST budgets 100x too LARGE.
   2. currency_offset is NOT a field on the AdAccount node — it cannot be
      fetched per account; this static map (from Meta's currencies page) is the
      source of truth, keyed by the account's `currency` field.
   (A previous revision of this suite asserted HUF/TWD → 100 based on an
   unverified reading; that was wrong against the primary source.) */
describe('currencyOffset (Meta minor-unit map)', () => {
  it('standard two-decimal ad currencies → 100', () => {
    for (const c of ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'BRL', 'MXN', 'SEK', 'PLN', 'INR']) {
      expect(currencyOffset(c)).toBe(100)
    }
  })

  it("Meta's offset-1 set → 1 (the exact list from the currencies page)", () => {
    for (const c of ['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']) {
      expect(currencyOffset(c)).toBe(1)
    }
  })

  it('currencies NOT in the offset-1 set stay 100 (incl. UGX, which the old map mis-bucketed)', () => {
    expect(currencyOffset('UGX')).toBe(100)
  })

  it('non-billable three-decimal ISO currencies default to 100 (Meta does not bill ads in them)', () => {
    for (const c of ['KWD', 'BHD', 'JOD', 'OMR', 'TND']) {
      expect(currencyOffset(c)).toBe(100)
    }
  })

  it('unknown currency defaults to 100', () => {
    expect(currencyOffset('XYZ')).toBe(100)
  })

  it('is case-insensitive', () => {
    expect(currencyOffset('jpy')).toBe(1)
    expect(currencyOffset('twd')).toBe(1)
    expect(currencyOffset('usd')).toBe(100)
  })

  it('a $50.00 budget converts to 5000 minor units in USD and 50 in JPY-style currencies', () => {
    expect(Math.round(50 * currencyOffset('USD'))).toBe(5000)
    expect(Math.round(50 * currencyOffset('JPY'))).toBe(50)
    // The HUF trap: 50 HUF budget must POST as 50, not 5000.
    expect(Math.round(50 * currencyOffset('HUF'))).toBe(50)
  })
})
