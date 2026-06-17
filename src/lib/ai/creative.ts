import type { Dataset } from '../demo/generate'
import type {
  Creative,
  CreativeCohort,
  CreativePerformance,
  DateRange,
  MetricsBundle,
} from '../types'
import { aggregate, filterByRange } from '../metrics'
import { lastNDays } from '../selectors'
import { THRESHOLDS as T, BENCHMARKS } from './thresholds'

/* ============================================================================
   Creative analysis — performance vs the data, by creative / format / angle,
   with a funnel diagnosis (where does each creative break?) and a next-test-batch
   recommendation. This is the "what's working, what's not, what to test next" lane.
   ========================================================================== */

function adIdsForCreative(ds: Dataset, creativeId: string, clientId: string): string[] {
  return (ds.adsByClient.get(clientId) ?? []).filter((a) => a.creativeId === creativeId).map((a) => a.id)
}

function metricsFor(ds: Dataset, adIds: string[], range: DateRange): MetricsBundle {
  const rows = adIds.flatMap((id) => ds.insightsByAd.get(id) ?? [])
  return aggregate(filterByRange(rows, range))
}

export function creativePerformance(ds: Dataset, clientId: string, range: DateRange): CreativePerformance[] {
  const client = ds.clientById.get(clientId)!
  const creatives = ds.creativesByClient.get(clientId) ?? []
  const rows: CreativePerformance[] = []

  for (const creative of creatives) {
    const adIds = adIdsForCreative(ds, creative.id, clientId)
    if (adIds.length === 0) continue
    const m = metricsFor(ds, adIds, range)
    if (m.impressions === 0) continue
    const m7 = metricsFor(ds, adIds, lastNDays(7))
    const mPrev7 = metricsFor(ds, adIds, lastNDays(7, 7))
    const { diagnosis, detail } = diagnose(creative, m, m7, mPrev7, client.targetCPA)
    rows.push({ creative, metrics: m, adIds, diagnosis, diagnosisDetail: detail, cpaPercentile: 0 })
  }

  // CPA percentile across creatives that have orders
  const withOrders = rows.filter((r) => r.metrics.purchases > 0).sort((a, b) => a.metrics.cpa - b.metrics.cpa)
  withOrders.forEach((r, i) => {
    r.cpaPercentile = withOrders.length > 1 ? i / (withOrders.length - 1) : 0
  })

  return rows.sort((a, b) => b.metrics.spend - a.metrics.spend)
}

function diagnose(
  creative: Creative,
  m: MetricsBundle,
  m7: MetricsBundle,
  mPrev7: MetricsBundle,
  targetCPA: number,
): { diagnosis: CreativePerformance['diagnosis']; detail: string } {
  // not enough signal yet
  if (m.spend < targetCPA * T.minSpendVsCPA || m.impressions < T.minImpressionsToJudge) {
    return { diagnosis: 'unproven', detail: `Only ${Math.round(m.spend)} spent / ${fmtInt(m.impressions)} impressions — needs more signal before judging.` }
  }

  // fatigue: frequency high and CTR fading recently
  const ctrFade = mPrev7.ctr > 0 ? (mPrev7.ctr - m7.ctr) / mPrev7.ctr : 0
  if (m7.frequency > T.fatigueFrequency && ctrFade >= T.fatigueCtrDropWoW && m7.cpa > m.cpa) {
    return { diagnosis: 'fatigued', detail: `Frequency ${m7.frequency.toFixed(1)} and CTR fading ${(ctrFade * 100).toFixed(0)}% WoW — audience saturated. Refresh the ${creative.angle} angle.` }
  }

  // video funnel checks (only meaningful for video)
  if (creative.format === 'video') {
    if (m.hookRate / 100 < T.hookRateFloor) {
      return { diagnosis: 'hook_weak', detail: `Hook rate ${m.hookRate.toFixed(0)}% (3s/impr) is below the ${(T.hookRateFloor * 100).toFixed(0)}% floor — the first 3 seconds aren't stopping the scroll. Re-cut the opener.` }
    }
    if (m.holdRate / 100 < T.holdRateFloor) {
      return { diagnosis: 'body_weak', detail: `Good hook (${m.hookRate.toFixed(0)}%) but only ${m.holdRate.toFixed(0)}% hold to thruplay — the body loses them. Tighten the middle / get to the value faster.` }
    }
  }

  // converts poorly despite engaging
  if (m.ctr >= BENCHMARKS.ctr.ok && m.cvr / 100 < T.cvrFloor) {
    return { diagnosis: 'convert_weak', detail: `Strong CTR (${m.ctr.toFixed(2)}%) but ${m.cvr.toFixed(2)}% CVR — clicks aren't converting. The gap is the landing page / offer, not the ad.` }
  }

  // winner
  if (m.cpa > 0 && m.cpa <= targetCPA * 0.9 && m.purchases >= T.minPurchasesToJudge) {
    return { diagnosis: 'winner', detail: `${money(m.cpa)} CPA vs ${money(targetCPA)} target on ${fmtInt(m.purchases)} orders — a clear winner. Scale spend and spin variations of this ${creative.angle} concept.` }
  }

  return { diagnosis: 'steady', detail: `${money(m.cpa)} CPA, holding near the ${money(targetCPA)} target.` }
}

/** Cohort roll-up by a creative dimension (format / angle / batch). */
export function creativeCohorts(
  ds: Dataset,
  clientId: string,
  range: DateRange,
  dimension: 'format' | 'angle' | 'batch',
): CreativeCohort[] {
  const creatives = ds.creativesByClient.get(clientId) ?? []
  const groups = new Map<string, string[]>() // key → adIds
  const labelOf = (c: Creative) => (dimension === 'format' ? c.format : dimension === 'angle' ? c.angle : c.batch)
  for (const c of creatives) {
    const key = labelOf(c)
    const adIds = adIdsForCreative(ds, c.id, clientId)
    const arr = groups.get(key) ?? []
    arr.push(...adIds)
    groups.set(key, arr)
  }
  const cohorts: CreativeCohort[] = []
  for (const [key, adIds] of groups) {
    const m = metricsFor(ds, adIds, range)
    if (m.impressions === 0) continue
    const count = creatives.filter((c) => labelOf(c) === key).length
    cohorts.push({ key, label: cohortLabel(dimension, key), count, metrics: m })
  }
  return cohorts.sort((a, b) => b.metrics.spend - a.metrics.spend)
}

function cohortLabel(dimension: string, key: string): string {
  if (dimension === 'format') return key.charAt(0).toUpperCase() + key.slice(1)
  return key
}

/** Next-batch recommendation: what's winning to double down on, what to retire. */
export interface NextBatchPlan {
  doubleDown: { label: string; reason: string }[]
  retire: { label: string; reason: string }[]
  testIdeas: string[]
}

export function nextBatchPlan(ds: Dataset, clientId: string, range: DateRange): NextBatchPlan {
  const client = ds.clientById.get(clientId)!
  const byAngle = creativeCohorts(ds, clientId, range, 'angle').filter((c) => c.metrics.purchases >= T.minPurchasesToJudge)
  const byFormat = creativeCohorts(ds, clientId, range, 'format').filter((c) => c.metrics.purchases >= T.minPurchasesToJudge)
  const sortedAngles = [...byAngle].sort((a, b) => a.metrics.cpa - b.metrics.cpa)
  const sortedFormats = [...byFormat].sort((a, b) => a.metrics.cpa - b.metrics.cpa)

  const doubleDown: NextBatchPlan['doubleDown'] = []
  const retire: NextBatchPlan['retire'] = []
  const testIdeas: string[] = []

  const bestAngle = sortedAngles[0]
  const worstAngle = sortedAngles[sortedAngles.length - 1]
  const bestFormat = sortedFormats[0]

  if (bestAngle && bestAngle.metrics.cpa <= client.targetCPA) {
    doubleDown.push({
      label: `${bestAngle.label} (${bestFormat ? bestFormat.label : 'video'})`,
      reason: `${money(bestAngle.metrics.cpa)} CPA, ${bestAngle.metrics.ctr.toFixed(2)}% CTR — your strongest angle. Produce 3–4 fresh variations next batch.`,
    })
    testIdeas.push(`Spin ${bestAngle.label} into a new hook + a ${bestFormat?.label === 'Video' ? 'static cutdown' : 'video cut'}.`)
  }
  if (bestFormat) {
    testIdeas.push(`Lead the next batch with ${bestFormat.label.toLowerCase()} — it's carrying ${money(bestFormat.metrics.cpa)} CPA here.`)
  }
  if (worstAngle && worstAngle.metrics.cpa > client.targetCPA * 1.25 && worstAngle !== bestAngle) {
    retire.push({
      label: worstAngle.label,
      reason: `${money(worstAngle.metrics.cpa)} CPA — ${((worstAngle.metrics.cpa / client.targetCPA - 1) * 100).toFixed(0)}% over target. Stop producing this angle unless reframed.`,
    })
  }
  // funnel-derived ideas from individual diagnoses
  const perf = creativePerformance(ds, clientId, range)
  const hookWeak = perf.filter((p) => p.diagnosis === 'hook_weak').length
  const convertWeak = perf.filter((p) => p.diagnosis === 'convert_weak').length
  if (hookWeak >= 2) testIdeas.push(`${hookWeak} creatives are dying in the first 3s — test pattern-interrupt openers / on-screen hooks.`)
  if (convertWeak >= 2) testIdeas.push(`${convertWeak} creatives engage but don't convert — the bottleneck is the LP/offer, brief a matching landing experience.`)

  return { doubleDown, retire, testIdeas }
}

const money = (v: number) => `$${v.toFixed(v < 100 ? 2 : 0)}`
const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US')
