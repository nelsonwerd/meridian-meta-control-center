import type { Dataset } from '../demo/generate'
import type {
  Ad,
  Client,
  EntityLevel,
  MetricsBundle,
  Scope,
  Severity,
  Suggestion,
  SuggestionType,
} from '../types'
import { today } from '../metrics'
import { clamp } from '../rng'
import { adIdsForClient, clientsForScope, lastNDays, metricsForAdIds } from '../selectors'
import { THRESHOLDS as T } from './thresholds'

/* ============================================================================
   Heuristic optimization engine — the "AI analytical backbone".
   Encodes the deep-dive playbook thresholds (docs/research/adops-kpis-playbook).
   Reads ONLY the generated insights (never the hidden archetypes), so it truly
   rediscovers the patterns from data. Honest bound: these calls are a SIGNAL a
   buyer weighs, not a backtested edge. An LLM layer (ai/llm.ts) can enrich the
   narrative; the numeric judgement lives here.
   ========================================================================== */

interface BudgetHolder {
  level: EntityLevel
  id: string
  name: string
  currentBudget: number | null
}

function budgetHolder(ds: Dataset, ad: Ad): BudgetHolder {
  const campaign = ds.campaignById.get(ad.campaignId)!
  if (campaign.budgetType === 'CBO') {
    return { level: 'campaign', id: campaign.id, name: campaign.name, currentBudget: campaign.dailyBudget }
  }
  const adSet = ds.adSetById.get(ad.adSetId)!
  return { level: 'adset', id: adSet.id, name: adSet.name, currentBudget: adSet.dailyBudget }
}

const severityRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

function mkId(type: SuggestionType, entityId: string) {
  return `sg_${type}_${entityId}`
}

/** Analyze a single ad and return at most one suggestion (precedence-ordered). */
function analyzeAd(ds: Dataset, ad: Ad, client: Client): Suggestion | null {
  if (ad.status === 'PAUSED' || ad.status === 'ARCHIVED') return null
  const ids = [ad.id]
  const m3 = metricsForAdIds(ds, ids, lastNDays(3))
  const m7 = metricsForAdIds(ds, ids, lastNDays(7))
  const mPrev7 = metricsForAdIds(ds, ids, lastNDays(7, 7))
  const m14 = metricsForAdIds(ds, ids, lastNDays(14))
  const mPrev14 = metricsForAdIds(ds, ids, lastNDays(14, 14))
  const creative = ds.creativeById.get(ad.creativeId)
  const target = client.targetCPA
  const holder = budgetHolder(ds, ad)

  // ---- minimum-signal gate ----
  const hasSpendSignal = m7.spend >= target * T.minSpendVsCPA
  const hasConvSignal = m7.purchases >= T.minPurchasesToJudge
  const hasImprSignal = m7.impressions >= T.minImpressionsToJudge

  // ---- (1) DOA: lots of impressions, no clicks, near-zero orders ----
  if (m7.impressions >= T.minImpressionsToJudge && m7.ctr < T.doaCtrPct && m7.purchases <= 1) {
    return build('PAUSE_ENTITY', 'critical', 'ad', ad.id, ad.name, client.id, {
      title: `Pause DOA creative — ${m7.ctr.toFixed(2)}% CTR`,
      rationale: `This ad has spent ${money(m7.spend)} over 7 days at a ${m7.ctr.toFixed(2)}% link CTR (below the ${T.doaCtrPct}% floor) and only ${m7.purchases} order(s). The creative isn't earning the click — it's burning budget. Pause and reallocate.`,
      evidence: [`7d CTR ${m7.ctr.toFixed(2)}%`, `${fmtInt(m7.impressions)} impressions`, `${m7.purchases} orders`, `${money(m7.spend)} spent`],
      impact: { metric: 'Stop waste', change: -1, note: `~${money(m7.spend / 7)}/day recovered` },
      confidence: 0.9,
      action: { kind: 'pause', label: 'Pause ad', targetEntityId: ad.id, targetLevel: 'ad' },
    })
  }

  // ---- (2) zero-conversion burn ----
  if (m7.spend >= target * T.zeroConvSpendRatio && m7.purchases === 0) {
    return build('PAUSE_ENTITY', 'critical', 'ad', ad.id, ad.name, client.id, {
      title: `Pause — ${money(m7.spend)} spent, 0 orders`,
      rationale: `Past the give-it-a-chance threshold: ${money(m7.spend)} spent in 7 days (≥ 1.5× the ${money(target)} target CPA) with zero conversions. Cut losses now.`,
      evidence: [`${money(m7.spend)} spent`, `0 orders`, `target CPA ${money(target)}`],
      impact: { metric: 'Stop waste', change: -1, note: `~${money(m7.spend / 7)}/day recovered` },
      confidence: 0.85,
      action: { kind: 'pause', label: 'Pause ad', targetEntityId: ad.id, targetLevel: 'ad' },
    })
  }

  // ---- (3) hard cut: SUSTAINED CPA over target (3d AND 7d) with real signal.
  //         Requiring both windows keeps a single noisy 3-day blip from cutting. --
  if (
    hasConvSignal &&
    hasSpendSignal &&
    m3.purchases >= T.minPurchasesToJudge &&
    m7.purchases >= 5 &&
    m3.cpa > target * T.cutCpaRatio &&
    m7.cpa > target * 1.2
  ) {
    const over = (m3.cpa / target - 1) * 100
    return build('CUT_BUDGET', 'high', 'ad', ad.id, ad.name, client.id, {
      title: `Cut — CPA ${money(m3.cpa)} is ${over.toFixed(0)}% over target`,
      rationale: `3-day CPA of ${money(m3.cpa)} is ${over.toFixed(0)}% above the ${money(target)} target on ${m3.purchases} orders of signal. Pause this ad (or cut its share) and route spend to in-target ads.`,
      evidence: [`3d CPA ${money(m3.cpa)}`, `target ${money(target)}`, `${m7.purchases} orders/7d`, `${money(m7.spend)} spent/7d`],
      impact: { metric: '−CPA drag', change: -0.15, note: `frees ${money(m7.spend / 7)}/day` },
      confidence: clamp(0.6 + Math.min(m7.purchases / 80, 0.3), 0.6, 0.92),
      action: { kind: 'pause', label: 'Pause ad', targetEntityId: ad.id, targetLevel: 'ad' },
    })
  }

  // ---- (4) creative fatigue (a trend, not a level) ----
  const ctrDropWoW = mPrev7.ctr > 0 ? (mPrev7.ctr - m7.ctr) / mPrev7.ctr : 0
  const cpmRise2wk = mPrev14.cpm > 0 ? (m14.cpm - mPrev14.cpm) / mPrev14.cpm : 0
  const cpaRising = m3.cpa > mPrev7.cpa && mPrev7.cpa > 0
  if (
    hasConvSignal &&
    m7.frequency > T.fatigueFrequency &&
    ctrDropWoW >= T.fatigueCtrDropWoW &&
    cpmRise2wk >= T.fatigueCpmRise2wk &&
    cpaRising
  ) {
    return build('CREATIVE_FATIGUE', 'high', 'ad', ad.id, ad.name, client.id, {
      title: `Fatigue — frequency ${m7.frequency.toFixed(1)}, CTR −${(ctrDropWoW * 100).toFixed(0)}% WoW`,
      rationale: `Classic fatigue signature: frequency at ${m7.frequency.toFixed(1)}, link CTR down ${(ctrDropWoW * 100).toFixed(0)}% week-over-week, CPM up ${(cpmRise2wk * 100).toFixed(0)}% over 2 weeks, and CPA rising. The audience is saturated on ${creative?.angle ?? 'this concept'}. Iterate the winning angle into a fresh batch rather than abandoning it.`,
      evidence: [`Freq ${m7.frequency.toFixed(1)}`, `CTR ${m7.ctr.toFixed(2)}% (was ${mPrev7.ctr.toFixed(2)}%)`, `CPM +${(cpmRise2wk * 100).toFixed(0)}%`, `CPA ${money(m3.cpa)}`],
      impact: { metric: 'Recover CTR', change: 0.12, note: 'refresh same angle, new hook' },
      confidence: 0.78,
      action: { kind: 'brief_creative', label: 'Brief refresh', targetEntityId: ad.id, targetLevel: 'ad' },
    })
  }

  // ---- (5) scale a winner ----
  if (
    m7.purchases >= T.scaleMinPurchases7d &&
    m3.cpa > 0 &&
    m3.cpa <= target * T.scaleCpaRatio &&
    m7.frequency < T.scaleMaxFrequency &&
    holder.currentBudget != null
  ) {
    const proposed = Math.round((holder.currentBudget * (1 + T.scaleStepPct)) / 5) * 5
    const extraDaily = proposed - holder.currentBudget
    const extraOrdersMo = Math.round((extraDaily / Math.max(m3.cpa, 1)) * 30)
    const under = (1 - m3.cpa / target) * 100
    return build('SCALE_BUDGET', 'high', holder.level, holder.id, holder.name, client.id, {
      title: `Scale +${(T.scaleStepPct * 100).toFixed(0)}% — CPA ${under.toFixed(0)}% under target`,
      rationale: `Winner with room: 3-day CPA ${money(m3.cpa)} is ${under.toFixed(0)}% under the ${money(target)} target on ${m7.purchases} orders/7d, frequency a healthy ${m7.frequency.toFixed(1)}. Raise the ${holder.level === 'campaign' ? 'campaign (CBO)' : 'ad set (ABO)'} budget ${(T.scaleStepPct * 100).toFixed(0)}% (${money(holder.currentBudget)} → ${money(proposed)}) and hold 2–3 days before the next step.`,
      evidence: [`3d CPA ${money(m3.cpa)}`, `target ${money(target)}`, `${m7.purchases} orders/7d`, `Freq ${m7.frequency.toFixed(1)}`],
      impact: { metric: '+Orders', change: 0.2, note: `~+${fmtInt(extraOrdersMo)} orders/mo at current CPA` },
      confidence: clamp(0.62 + Math.min(m7.purchases / 90, 0.3), 0.62, 0.95),
      action: {
        kind: 'increase_budget',
        label: `Raise to ${money(proposed)}/day`,
        targetEntityId: holder.id,
        targetLevel: holder.level,
        currentBudget: holder.currentBudget,
        proposedBudget: proposed,
      },
    })
  }

  // ---- watch: promising-but-unproven (new) ----
  if (ad.status === 'LEARNING' && m7.purchases > 0 && m7.purchases < T.scaleMinPurchases7d && m7.cpa <= target) {
    return build('WATCH', 'low', 'ad', ad.id, ad.name, client.id, {
      title: `Watch — early ${money(m7.cpa)} CPA, still learning`,
      rationale: `New ad trending in-target (${money(m7.cpa)} CPA) but only ${m7.purchases} orders so far — below the ${T.scaleMinPurchases7d}-order confidence bar. Let it accrue signal before scaling; don't kill prematurely.`,
      evidence: [`7d CPA ${money(m7.cpa)}`, `${m7.purchases} orders`, `learning`],
      impact: { metric: 'Hold', change: 0, note: 'gather signal' },
      confidence: 0.55,
      action: { kind: 'none', label: 'Keep watching', targetEntityId: ad.id, targetLevel: 'ad' },
    })
  }

  return null
}

/** Ad-set level: consolidation of learning-limited / sparse ad sets. */
function analyzeAdSets(ds: Dataset, client: Client): Suggestion[] {
  const out: Suggestion[] = []
  const campaigns = ds.campaignsByClient.get(client.id) ?? []
  for (const campaign of campaigns) {
    const sets = (ds.adSetsByCampaign.get(campaign.id) ?? []).filter((s) => s.status !== 'PAUSED')
    const limited = sets.filter((s) => {
      const m7 = metricsForAdIds(ds, (ds.adsByAdSet.get(s.id) ?? []).map((a) => a.id), lastNDays(7))
      return s.status === 'LEARNING_LIMITED' || m7.purchases < T.consolidateMinEventsPerWeek
    })
    if (limited.length >= 2 && campaign.budgetType === 'ABO') {
      out.push(
        build('CONSOLIDATE_ADSETS', 'medium', 'campaign', campaign.id, campaign.name, client.id, {
          title: `Consolidate ${limited.length} learning-limited ad sets`,
          rationale: `${limited.length} ad sets in “${campaign.name}” are below ~${T.consolidateMinEventsPerWeek} conversions/week and stuck in Learning Limited. In the Advantage+ era, signal density beats granularity — merge audiences/budgets into fewer ad sets so the algorithm can exit learning.`,
          evidence: limited.slice(0, 4).map((s) => `${s.name}: limited`),
          impact: { metric: 'Exit learning', change: -0.08, note: 'denser signal, lower CPA' },
          confidence: 0.7,
          action: { kind: 'consolidate', label: 'Plan consolidation', targetEntityId: campaign.id, targetLevel: 'campaign' },
        }),
      )
    }
  }
  return out
}

/** Client level: reallocate spend when CPA spread across ad sets is wide. */
function analyzeReallocation(ds: Dataset, client: Client): Suggestion | null {
  const allSets = (ds.campaignsByClient.get(client.id) ?? []).flatMap((c) => ds.adSetsByCampaign.get(c.id) ?? [])
  const scored = allSets
    .filter((s) => s.status === 'ACTIVE')
    .map((s) => ({ s, m: metricsForAdIds(ds, (ds.adsByAdSet.get(s.id) ?? []).map((a) => a.id), lastNDays(7)) }))
    .filter((x) => x.m.purchases >= T.minPurchasesToJudge && x.m.spend > 0)
  if (scored.length < 3) return null
  const cpas = scored.map((x) => x.m.cpa).sort((a, b) => a - b)
  const best = cpas[0]
  const worst = cpas[cpas.length - 1]
  if (best <= 0) return null
  const spread = (worst - best) / best
  if (spread < T.reallocateCpaSpread) return null
  const winners = scored.filter((x) => x.m.cpa <= client.targetCPA).length
  return build('REALLOCATE_SPEND', 'medium', 'client', client.id, client.name, client.id, {
    title: `Reallocate — ${(spread * 100).toFixed(0)}% CPA spread across ad sets`,
    rationale: `Active ad sets range from ${money(best)} to ${money(worst)} CPA — a ${(spread * 100).toFixed(0)}% spread. Shift budget from the high-CPA tail toward the ${winners} in-target ad set(s) to pull blended CPA down without new creative.`,
    evidence: [`Best ${money(best)}`, `Worst ${money(worst)}`, `${scored.length} ad sets`, `target ${money(client.targetCPA)}`],
    impact: { metric: '−Blended CPA', change: -0.1, note: 'no new spend required' },
    confidence: 0.66,
    action: { kind: 'consolidate', label: 'Open reallocation', targetEntityId: client.id, targetLevel: 'client' },
  })
}

export function analyzeClient(ds: Dataset, clientId: string): Suggestion[] {
  const client = ds.clientById.get(clientId)
  if (!client) return []
  const out: Suggestion[] = []
  for (const adId of adIdsForClient(ds, clientId)) {
    const ad = ds.adById.get(adId)!
    const s = analyzeAd(ds, ad, client)
    if (s) out.push(s)
  }
  out.push(...analyzeAdSets(ds, client))
  const realloc = analyzeReallocation(ds, client)
  if (realloc) out.push(realloc)
  return sortSuggestions(out)
}

export function analyzeScope(ds: Dataset, scope: Scope): Suggestion[] {
  const clients = clientsForScope(ds, scope)
  return sortSuggestions(clients.flatMap((c) => analyzeClient(ds, c.id)))
}

export function sortSuggestions(s: Suggestion[]): Suggestion[] {
  return [...s].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || b.confidence - a.confidence,
  )
}

/* ----- helpers ----- */

function build(
  type: SuggestionType,
  severity: Severity,
  level: EntityLevel,
  entityId: string,
  entityName: string,
  clientId: string,
  rest: {
    title: string
    rationale: string
    evidence: string[]
    impact: Suggestion['projectedImpact']
    confidence: number
    action: Suggestion['action']
  },
): Suggestion {
  return {
    id: mkId(type, entityId),
    clientId,
    type,
    severity,
    level,
    entityId,
    entityName,
    createdAt: today(),
    ...rest,
    projectedImpact: rest.impact,
  } as Suggestion
}

const money = (v: number) => `$${v.toFixed(v < 100 ? 2 : 0)}`
const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US')

export type { MetricsBundle }
