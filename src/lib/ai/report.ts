import type { Dataset } from '../demo/generate'
import type { DateRange, ISODate, KpiDelta, MetricsBundle, WeeklyReport } from '../types'
import { addDays, kpiDelta, today } from '../metrics'
import { adIdsForClient, computePacing, metricsForAdIds } from '../selectors'
import { analyzeClient } from './engine'
import { creativePerformance } from './creative'
import { fmtCurrency, fmtDeltaPct, fmtRoas } from '../format'

/* ============================================================================
   Weekly "Monday report" per client: last completed Mon–Sun week vs the prior
   week, top movers, creative leaderboard, recommended changes, pacing. The
   narrative here is templated (heuristic); ai/llm.ts can enrich it with an LLM.
   ========================================================================== */

/** Most recent completed Mon–Sun week relative to the data anchor. */
export function lastCompletedWeek(anchor: ISODate = today()): { start: ISODate; end: ISODate } {
  const dow = new Date(anchor + 'T00:00:00Z').getUTCDay() // 0=Sun
  const sinceMonday = (dow + 6) % 7
  const thisMonday = addDays(anchor, -sinceMonday)
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) }
}

function weekRange(start: ISODate, end: ISODate, label: string): DateRange {
  return { preset: 'custom', start, end, label }
}

export function buildWeeklyReport(ds: Dataset, clientId: string, weekOverride?: { start: ISODate; end: ISODate }): WeeklyReport {
  const client = ds.clientById.get(clientId)!
  const week = weekOverride ?? lastCompletedWeek()
  const prev = { start: addDays(week.start, -7), end: addDays(week.end, -7) }
  const adIds = adIdsForClient(ds, clientId)

  const current = metricsForAdIds(ds, adIds, weekRange(week.start, week.end, 'This week'))
  const previous = metricsForAdIds(ds, adIds, weekRange(prev.start, prev.end, 'Prior week'))

  const kpiKeys: (keyof MetricsBundle)[] = ['spend', 'purchases', 'cpa', 'roas', 'ctr', 'cpm', 'aov', 'frequency']
  const kpis: Record<string, KpiDelta> = {}
  for (const k of kpiKeys) kpis[k] = kpiDelta(k, current[k], previous[k])

  // ----- top movers across ad sets (need enough spend to be meaningful) -----
  const movers: WeeklyReport['topMovers'] = []
  const setStats = (ds.campaignsByClient.get(clientId) ?? [])
    .flatMap((c) => ds.adSetsByCampaign.get(c.id) ?? [])
    .map((s) => {
      const ids = (ds.adsByAdSet.get(s.id) ?? []).map((a) => a.id)
      const cur = metricsForAdIds(ds, ids, weekRange(week.start, week.end, ''))
      const pre = metricsForAdIds(ds, ids, weekRange(prev.start, prev.end, ''))
      return { s, cur, pre }
    })
    .filter((x) => x.cur.spend > client.targetCPA * 3 && x.pre.cpa > 0 && x.cur.cpa > 0)
  const cpaMoves = setStats
    .map((x) => ({ ...x, change: (x.cur.cpa - x.pre.cpa) / x.pre.cpa }))
    .sort((a, b) => a.change - b.change)
  const bestMove = cpaMoves[0]
  const worstMove = cpaMoves[cpaMoves.length - 1]
  if (bestMove && bestMove.change < -0.05) {
    movers.push({ direction: 'up', label: bestMove.s.name, detail: `CPA improved ${fmtDeltaPct(Math.abs(bestMove.change))} to ${fmtCurrency(bestMove.cur.cpa, { decimals: 2 })}` })
  }
  if (worstMove && worstMove.change > 0.05 && worstMove !== bestMove) {
    movers.push({ direction: 'down', label: worstMove.s.name, detail: `CPA worsened ${fmtDeltaPct(worstMove.change)} to ${fmtCurrency(worstMove.cur.cpa, { decimals: 2 })}` })
  }
  const spendMove = [...setStats].sort((a, b) => b.cur.spend - a.cur.spend)[0]
  if (spendMove) {
    movers.push({ direction: spendMove.cur.cpa <= client.targetCPA ? 'up' : 'down', label: spendMove.s.name, detail: `Top spender at ${fmtCurrency(spendMove.cur.spend, { compact: true })}, ${fmtCurrency(spendMove.cur.cpa, { decimals: 2 })} CPA` })
  }

  // ----- creative leaderboard -----
  const creativeLeaderboard = creativePerformance(ds, clientId, weekRange(week.start, week.end, ''))
    .filter((c) => c.metrics.purchases > 0)
    .sort((a, b) => a.metrics.cpa - b.metrics.cpa)
    .slice(0, 5)

  // ----- recommendations -----
  const recommendations = analyzeClient(ds, clientId).slice(0, 5)

  // ----- pacing (MTD vs monthly budget) -----
  const { spent, projection, pace } = computePacing(ds, clientId)

  const { headline, summary, direction } = composeNarrative(client.name, kpis, pace, movers)

  return {
    clientId,
    weekStart: week.start,
    weekEnd: week.end,
    headline,
    direction,
    summary,
    current,
    previous,
    kpis,
    topMovers: movers,
    creativeLeaderboard,
    recommendations,
    pacing: { spent, budget: client.monthlyBudget, pace, projection },
  }
}

function composeNarrative(
  name: string,
  kpis: Record<string, KpiDelta>,
  pace: number,
  movers: WeeklyReport['topMovers'],
): { headline: string; summary: string; direction: WeeklyReport['direction'] } {
  const orders = kpis.purchases
  const cpa = kpis.cpa
  const roas = kpis.roas
  const ordersDir = orders.delta >= 0 ? 'up' : 'down'
  const cpaDir = cpa.delta <= 0 ? 'lower' : 'higher'
  // a "flat" week — neither orders nor CPA moved meaningfully — reads as steady,
  // not "growth" (the deep-dive flagged a flat week mislabeled "Efficient growth").
  const flat = Math.abs(orders.deltaPct) < 0.03 && Math.abs(cpa.deltaPct) < 0.03

  const headline = flat
    ? `Steady week — holding course`
    : cpa.delta <= 0 && orders.delta >= 0
      ? `Efficient growth — more orders at a lower CPA`
      : cpa.delta > 0 && orders.delta < 0
        ? `Soft week — orders and efficiency both slipped`
        : cpa.delta <= 0
          ? `Efficiency improved week-over-week`
          : `Volume held, watch rising CPA`

  // sentiment aligned to the headline branches — drives the digest icon so it can
  // never disagree with the prose (efficiency leads, so it keys off CPA direction).
  const direction: WeeklyReport['direction'] = flat ? 'neutral' : cpa.delta <= 0 ? 'positive' : 'caution'

  const absPct = (frac: number) => `${Math.round(Math.abs(frac) * 100)}%`
  // No prior-week baseline → state the level, not a fabricated +100% / WoW move.
  const ordersClause = orders.isNew
    ? `drove ${Math.round(orders.value)} orders (new this week — no prior-week baseline)`
    : `drove ${fmtDeltaPct(orders.deltaPct)} orders week-over-week (${ordersDir})`
  const cpaClause = cpa.isNew
    ? `at a ${fmtCurrency(cpa.value, { decimals: 2 })} CPA`
    : `at a ${absPct(cpa.deltaPct)} ${cpaDir} CPA of ${fmtCurrency(cpa.value, { decimals: 2 })}`
  const roasClause = roas.isNew
    ? `ROAS came in at ${fmtRoas(roas.value)} (first week of data). `
    : `ROAS came in at ${fmtRoas(roas.value)} (${fmtDeltaPct(roas.deltaPct)} WoW). `
  const summary =
    `${name} ${ordersClause} ${cpaClause}. ` +
    roasClause +
    `Spend is pacing ${pace >= 1 ? `${fmtDeltaPct(pace - 1)} ahead of` : `${fmtDeltaPct(1 - pace)} under`} the monthly budget. ` +
    (movers[0] ? `Biggest mover: ${movers[0].label} — ${movers[0].detail}.` : '')

  return { headline, summary, direction }
}
