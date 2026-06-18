/* DEV-only diagnostics surface. Attaches helpers to window so we can validate the
   demo dataset + AI engine from the live preview without building throwaway UI. */
import { getDataset } from './demo/dataset'
import { aggregate, makeRange, filterByRange } from './metrics'
import { analyzeScope, analyzeClient } from './ai/engine'
import { creativePerformance, nextBatchPlan } from './ai/creative'
import { buildWeeklyReport } from './ai/report'

declare global {
  interface Window {
    __meridian?: Record<string, unknown>
  }
}

const ds = getDataset()

window.__meridian = {
  ds,
  aggregate,
  makeRange,
  filterByRange,
  // quick portfolio summary over a window
  summary(preset: any = '28d') {
    const range = makeRange(preset)
    const rows = filterByRange(ds.insights, range)
    const agg = aggregate(rows)
    return {
      range: range.label,
      clients: ds.clients.length,
      campaigns: ds.campaigns.length,
      adSets: ds.adSets.length,
      ads: ds.ads.length,
      creatives: ds.creatives.length,
      insightRows: ds.insights.length,
      spend: Math.round(agg.spend),
      orders: agg.purchases,
      cpa: +agg.cpa.toFixed(2),
      roas: +agg.roas.toFixed(2),
      ctr: +agg.ctr.toFixed(2),
    }
  },
  // per-client CPA vs target over 28d
  clientCPAs(preset: any = '28d') {
    const range = makeRange(preset)
    return ds.clients.map((c) => {
      const rows = filterByRange(ds.adsByClient.get(c.id)!.flatMap((a) => ds.insightsByAd.get(a.id) ?? []), range)
      const agg = aggregate(rows)
      return {
        client: c.name,
        bm: ds.businessManagers.find((b) => b.id === c.bmId)?.type,
        targetCPA: c.targetCPA,
        cpa: +agg.cpa.toFixed(2),
        roas: +agg.roas.toFixed(2),
        spend: Math.round(agg.spend),
        orders: agg.purchases,
      }
    })
  },
  // AI engine: suggestion mix across the portfolio
  suggestionMix() {
    const all = analyzeScope(ds, { kind: 'portfolio' })
    const byType: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    for (const s of all) {
      byType[s.type] = (byType[s.type] ?? 0) + 1
      bySeverity[s.severity] = (bySeverity[s.severity] ?? 0) + 1
    }
    return { total: all.length, byType, bySeverity, sample: all.slice(0, 3).map((s) => s.title) }
  },
  clientSuggestions(clientId = 'c_atlas') {
    return analyzeClient(ds, clientId).map((s) => ({ sev: s.severity, type: s.type, title: s.title, conf: s.confidence }))
  },
  creative(clientId = 'c_lumiere') {
    const perf = creativePerformance(ds, clientId, makeRange('28d'))
    const diag: Record<string, number> = {}
    for (const p of perf) diag[p.diagnosis] = (diag[p.diagnosis] ?? 0) + 1
    return { creatives: perf.length, diagnoses: diag, plan: nextBatchPlan(ds, clientId, makeRange('28d')) }
  },
  report(clientId = 'c_forge') {
    const r = buildWeeklyReport(ds, clientId)
    return { week: `${r.weekStart}–${r.weekEnd}`, headline: r.headline, summary: r.summary, movers: r.topMovers.length, leaders: r.creativeLeaderboard.length, recs: r.recommendations.length }
  },
  // count how many ads meet each raw trigger condition (diagnose engine coverage)
  triggerCoverage() {
    const last7 = makeRange('7d')
    const prev7 = { preset: 'custom', start: '2026-06-04', end: '2026-06-10', label: 'p7' } as any
    let doa = 0, zeroConv = 0, fatigue = 0, activeAds = 0, learningLimitedSets = 0, aboSets = 0
    for (const ad of ds.ads) {
      if (ad.status === 'PAUSED' || ad.status === 'ARCHIVED') continue
      activeAds++
      const rows = ds.insightsByAd.get(ad.id) ?? []
      const m7 = aggregate(filterByRange(rows, last7))
      const mP7 = aggregate(filterByRange(rows, prev7))
      const client = ds.clientById.get(ad.clientId)!
      if (m7.impressions >= 2000 && m7.ctr < 0.5 && m7.purchases <= 1) doa++
      if (m7.spend >= client.targetCPA * 1.5 && m7.purchases === 0) zeroConv++
      const drop = mP7.ctr > 0 ? (mP7.ctr - m7.ctr) / mP7.ctr : 0
      if (m7.frequency > 3 && drop >= 0.08 && m7.purchases >= 3) fatigue++
    }
    for (const s of ds.adSets) {
      const camp = ds.campaignById.get(s.campaignId)!
      if (camp.budgetType === 'ABO') aboSets++
      if (s.status === 'LEARNING_LIMITED') learningLimitedSets++
    }
    return { activeAds, doa, zeroConv, fatigueCandidates: fatigue, aboSets, learningLimitedSets }
  },
}

console.log('[meridian] debug surface ready — window.__meridian.summary()')
