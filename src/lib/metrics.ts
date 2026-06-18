import type { DateRange, Insight, ISODate, KpiDelta, MetricsBundle, RangePreset, TimeseriesPoint } from './types'
import { DATA_TODAY, WINDOW_DAYS } from './demo/generate'
import { addDays, daysBetween } from './date'

// addDays/daysBetween live in ./date (dependency-free); re-exported here so the
// many existing importers of these from './metrics' keep working unchanged.
export { addDays, daysBetween }

/* ============================================================================
   Metrics + date math. All rate KPIs are derived here from additive base facts
   so any roll-up (ad → ad set → campaign → client → portfolio) over any window
   is correct. The data anchor (DATA_TODAY) is treated as "now".
   ========================================================================== */

export const EMPTY_BUNDLE: MetricsBundle = {
  spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, purchases: 0, revenue: 0,
  addToCart: 0, landingPageViews: 0, videoPlays: 0, video3s: 0, videoThruplays: 0,
  ctr: 0, cpc: 0, cpm: 0, cpa: 0, roas: 0, aov: 0, frequency: 0, cvr: 0, hookRate: 0, holdRate: 0,
}

const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0)

/** Sum additive facts and derive all rates. */
export function aggregate(rows: Insight[]): MetricsBundle {
  const b: MetricsBundle = { ...EMPTY_BUNDLE }
  for (const r of rows) {
    b.spend += r.spend
    b.impressions += r.impressions
    b.reach += r.reach
    b.clicks += r.clicks
    b.linkClicks += r.linkClicks
    b.purchases += r.purchases
    b.revenue += r.revenue
    b.addToCart += r.addToCart
    b.landingPageViews += r.landingPageViews
    b.videoPlays += r.videoPlays
    b.video3s += r.video3s
    b.videoThruplays += r.videoThruplays
  }
  b.ctr = safeDiv(b.linkClicks, b.impressions) * 100
  b.cpc = safeDiv(b.spend, b.linkClicks)
  b.cpm = safeDiv(b.spend, b.impressions) * 1000
  b.cpa = safeDiv(b.spend, b.purchases)
  b.roas = safeDiv(b.revenue, b.spend)
  b.aov = safeDiv(b.revenue, b.purchases)
  b.frequency = safeDiv(b.impressions, b.reach)
  b.cvr = safeDiv(b.purchases, b.linkClicks) * 100
  b.hookRate = safeDiv(b.video3s, b.impressions) * 100
  b.holdRate = safeDiv(b.videoThruplays, b.video3s) * 100
  return b
}

/** Build a daily timeseries (one bundle per date in range, ascending). */
export function timeseries(rows: Insight[], range: DateRange): TimeseriesPoint[] {
  const byDate = new Map<ISODate, Insight[]>()
  for (const r of rows) {
    if (r.date < range.start || r.date > range.end) continue
    const arr = byDate.get(r.date)
    if (arr) arr.push(r)
    else byDate.set(r.date, [r])
  }
  const out: TimeseriesPoint[] = []
  for (const d of enumerateDates(range.start, range.end)) {
    out.push({ date: d, ...aggregate(byDate.get(d) ?? []) })
  }
  return out
}

export function filterByRange(rows: Insight[], range: DateRange): Insight[] {
  return rows.filter((r) => r.date >= range.start && r.date <= range.end)
}

/* ----- KPI delta vs the immediately-preceding equal-length window ----- */

const HIGHER_IS_BETTER: Record<string, boolean> = {
  purchases: true, revenue: true, ctr: true, roas: true, aov: true,
  cvr: true, hookRate: true, holdRate: true,
  cpa: false, cpc: false, cpm: false, frequency: false,
}

// Volume / context metrics where a change has no inherent good-or-bad colour —
// shown as an informational neutral delta, never green/red.
const NEUTRAL_KEYS = new Set([
  'spend', 'impressions', 'reach', 'clicks', 'linkClicks',
  'addToCart', 'landingPageViews', 'videoPlays', 'video3s', 'videoThruplays',
])

export function kpiDelta(key: keyof MetricsBundle, current: number, prev: number): KpiDelta {
  const neutral = NEUTRAL_KEYS.has(key as string)
  const higherIsBetter = HIGHER_IS_BETTER[key] ?? true
  const delta = current - prev
  // No prior-period baseline → there is no honest percentage; flag isNew so the UI
  // renders "new" instead of a fabricated +100%.
  const isNew = prev === 0 && current !== 0
  const deltaPct = prev !== 0 ? delta / Math.abs(prev) : current !== 0 ? 1 : 0
  return { value: current, prevValue: prev, delta, deltaPct, higherIsBetter, neutral, isNew }
}

/** Whether a delta should read as "good" (green) given the KPI's direction.
 *  Returns null when neutral (no colour) or when the change is negligible. */
export function deltaIsGood(d: KpiDelta): boolean | null {
  if (d.neutral || Math.abs(d.deltaPct) < 0.005) return null
  const up = d.delta > 0
  return d.higherIsBetter ? up : !up
}

/* ============================================================================
   Date helpers — DATA_TODAY is "now".
   ========================================================================== */

export function today(): ISODate {
  return DATA_TODAY
}

export function enumerateDates(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = []
  let cur = start
  let guard = 0
  while (cur <= end && guard++ < 800) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

export function startOfMonth(iso: ISODate): ISODate {
  return iso.slice(0, 8) + '01'
}

/** Breakeven ROAS = the ROAS that exactly covers cost, derived from contribution
 *  margin (1 / margin). The honest bar to judge ROAS against, not a global 3x. */
export function breakevenRoas(contributionMargin: number): number {
  return contributionMargin > 0 ? 1 / contributionMargin : 0
}

/** Build a DateRange from a preset (anchored to DATA_TODAY). */
export function makeRange(preset: RangePreset, custom?: { start: ISODate; end: ISODate }): DateRange {
  const end = today()
  switch (preset) {
    case 'today':
      return { preset, start: end, end, label: 'Today' }
    case 'yesterday': {
      const y = addDays(end, -1)
      return { preset, start: y, end: y, label: 'Yesterday' }
    }
    case '7d':
      return { preset, start: addDays(end, -6), end, label: 'Last 7 days' }
    case '14d':
      return { preset, start: addDays(end, -13), end, label: 'Last 14 days' }
    case '28d':
      return { preset, start: addDays(end, -27), end, label: 'Last 28 days' }
    case 'mtd':
      return { preset, start: startOfMonth(end), end, label: 'Month to date' }
    case 'custom':
      return {
        preset,
        start: custom?.start ?? addDays(end, -27),
        end: custom?.end ?? end,
        label: custom ? `${fmtShort(custom.start)} – ${fmtShort(custom.end)}` : 'Custom',
      }
  }
}

/** The equal-length window immediately preceding `range`, for deltas. */
export function previousRange(range: DateRange): DateRange {
  const len = daysBetween(range.start, range.end) + 1
  const prevEnd = addDays(range.start, -1)
  const prevStart = addDays(prevEnd, -(len - 1))
  return { preset: 'custom', start: prevStart, end: prevEnd, label: 'Previous period' }
}

export const earliestDate = (): ISODate => addDays(DATA_TODAY, -(WINDOW_DAYS - 1))

/* ----- formatting ----- */

export function fmtShort(iso: ISODate): string {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function fmtFull(iso: ISODate): string {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
