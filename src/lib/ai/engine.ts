import type { Dataset } from '../demo/generate'
import type {
  Ad,
  Client,
  EntityLevel,
  EntityStatus,
  MetricsBundle,
  Scope,
  Severity,
  Suggestion,
  SuggestionType,
} from '../types'
import { today } from '../metrics'
import { clamp } from '../rng'
import { adIdsForClient, clientsForScope, computePacing, lastNDays, metricsForAdIds } from '../selectors'
import { THRESHOLDS as T, effectiveThresholds } from './thresholds'

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

/** Analyze a single ad and return at most one suggestion (precedence-ordered).
 *  Exported for unit tests that exercise a single ad's gating decision directly. */
export function analyzeAd(ds: Dataset, ad: Ad, client: Client, t: typeof T = T): Suggestion | null {
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
  const hasSpendSignal = m7.spend >= target * t.minSpendVsCPA
  const hasConvSignal = m7.purchases >= t.minPurchasesToJudge
  const hasImprSignal = m7.impressions >= t.minImpressionsToJudge

  // ---- (1) DOA: enough impressions AND spend at a sub-floor CTR ----
  //         The playbook's Trigger-C clauses — impressions signal + spend gate +
  //         CTR floor. Purchase count is intentionally NOT gated: per the spec a
  //         sub-0.5% CTR creative is failing to earn the click even if it scraped a
  //         couple of orders (which would otherwise slip the >=5-order hard-cut and
  //         the <=1-order pause). The rationale still reports the actual order count.
  if (hasImprSignal && hasSpendSignal && m7.ctr < t.doaCtrPct) {
    return build('PAUSE_ENTITY', 'critical', 'ad', ad.id, ad.name, client.id, {
      title: `Pause DOA creative — ${m7.ctr.toFixed(2)}% CTR`,
      rationale: `This ad has spent ${money(m7.spend)} over 7 days at a ${m7.ctr.toFixed(2)}% link CTR (below the ${t.doaCtrPct}% floor) and only ${m7.purchases} order(s). The creative isn't earning the click — it's burning budget. Pause and reallocate.`,
      evidence: [`7d CTR ${m7.ctr.toFixed(2)}%`, `${fmtInt(m7.impressions)} impressions`, `${m7.purchases} orders`, `${money(m7.spend)} spent`],
      impact: { metric: 'Stop waste', change: -1, note: `~${money(m7.spend / 7)}/day recovered` },
      // Low CTR can be a tracking artifact, not always a dead creative — so this
      // is a strong signal, not a certainty.
      confidence: 0.76,
      impactScore: m7.spend / 7,
      action: { kind: 'pause', label: 'Pause ad', targetEntityId: ad.id, targetLevel: 'ad' },
    })
  }

  // ---- (2) zero-conversion burn ----
  if (m7.spend >= target * t.zeroConvSpendRatio && m7.purchases === 0) {
    return build('PAUSE_ENTITY', 'critical', 'ad', ad.id, ad.name, client.id, {
      title: `Pause — ${money(m7.spend)} spent, 0 orders`,
      rationale: `Past the give-it-a-chance threshold: ${money(m7.spend)} spent in 7 days (≥ 1.5× the ${money(target)} target CPA) with zero conversions. Cut losses now.`,
      evidence: [`${money(m7.spend)} spent`, `0 orders`, `target CPA ${money(target)}`],
      impact: { metric: 'Stop waste', change: -1, note: `~${money(m7.spend / 7)}/day recovered` },
      // Hedge for attribution lag — view-through/longer-window orders can land
      // outside the 7d-click/1d-view default and read as 0 here.
      confidence: 0.74,
      impactScore: m7.spend / 7,
      action: { kind: 'pause', label: 'Pause ad', targetEntityId: ad.id, targetLevel: 'ad' },
    })
  }

  // ---- (3) hard cut: SUSTAINED CPA over target (3d AND 7d) with real signal.
  //         Requiring both windows keeps a single noisy 3-day blip from cutting. --
  if (
    hasConvSignal &&
    hasSpendSignal &&
    m3.purchases >= t.minPurchasesToJudge &&
    m7.purchases >= 5 &&
    m3.cpa > target * t.cutCpaRatio &&
    m7.cpa > target * 1.2
  ) {
    const over = (m3.cpa / target - 1) * 100
    // The money actually being WASTED per day = spend above what target-CPA would
    // have cost for the same orders. High only when that bleed is material (≥ $50/day);
    // otherwise it's a routine cut → medium. Keeps "High" a genuine minority.
    const wastedPerDay = Math.max(0, m7.spend - m7.purchases * target) / 7
    const cutSeverity: Severity = wastedPerDay >= 90 ? 'high' : 'medium'
    return build('CUT_BUDGET', cutSeverity, 'ad', ad.id, ad.name, client.id, {
      title: `Cut — CPA ${money(m3.cpa)} is ${over.toFixed(0)}% over target`,
      rationale: `3-day CPA of ${money(m3.cpa)} is ${over.toFixed(0)}% above the ${money(target)} target on ${m3.purchases} orders of signal. Pause this ad (or cut its share) and route spend to in-target ads.`,
      evidence: [`3d CPA ${money(m3.cpa)}`, `target ${money(target)}`, `${m7.purchases} orders/7d`, `${money(m7.spend)} spent/7d`],
      impact: { metric: '−CPA drag', change: -0.15, note: `~${money(wastedPerDay)}/day wasted` },
      confidence: clamp(0.6 + Math.min(m7.purchases / 80, 0.3), 0.6, 0.92),
      impactScore: wastedPerDay,
      action: { kind: 'pause', label: 'Pause ad', targetEntityId: ad.id, targetLevel: 'ad' },
    })
  }

  // ---- (4) creative fatigue (a trend, not a level) ----
  const ctrDropWoW = mPrev7.ctr > 0 ? (mPrev7.ctr - m7.ctr) / mPrev7.ctr : 0
  const cpmRise2wk = mPrev14.cpm > 0 ? (m14.cpm - mPrev14.cpm) / mPrev14.cpm : 0
  const cpaRising = m3.cpa > mPrev7.cpa && mPrev7.cpa > 0
  if (
    hasConvSignal &&
    m7.frequency > t.fatigueFrequency &&
    ctrDropWoW >= t.fatigueCtrDropWoW &&
    cpmRise2wk >= t.fatigueCpmRise2wk &&
    cpaRising
  ) {
    return build('CREATIVE_FATIGUE', 'medium', 'ad', ad.id, ad.name, client.id, {
      title: `Fatigue — frequency ${m7.frequency.toFixed(1)}, CTR −${(ctrDropWoW * 100).toFixed(0)}% WoW`,
      rationale: `Classic fatigue signature: frequency at ${m7.frequency.toFixed(1)}, link CTR down ${(ctrDropWoW * 100).toFixed(0)}% week-over-week, CPM up ${(cpmRise2wk * 100).toFixed(0)}% over 2 weeks, and CPA rising. The audience is saturated on ${creative?.angle ?? 'this concept'}. Iterate the winning angle into a fresh batch rather than abandoning it.`,
      evidence: [`Freq ${m7.frequency.toFixed(1)}`, `CTR ${m7.ctr.toFixed(2)}% (was ${mPrev7.ctr.toFixed(2)}%)`, `CPM +${(cpmRise2wk * 100).toFixed(0)}%`, `CPA ${money(m3.cpa)}`],
      impact: { metric: 'Recover CTR', change: 0.12, note: 'refresh same angle, new hook' },
      confidence: 0.72,
      impactScore: (m7.spend / 7) * 0.3,
      action: { kind: 'brief_creative', label: 'Brief refresh', targetEntityId: ad.id, targetLevel: 'ad' },
    })
  }

  // ---- (5) scale a winner ----
  //  Require the ad to have EXITED the learning phase (status ACTIVE, not
  //  LEARNING) per the playbook — don't scale a still-learning ad. (The cooldown
  //  half, days-since-last-scale, isn't modelable without a last-scaled timestamp;
  //  noted in the ledger.)
  if (
    ad.status === 'ACTIVE' &&
    m7.purchases >= t.scaleMinPurchases7d &&
    m3.cpa > 0 &&
    m3.cpa <= target * t.scaleCpaRatio &&
    m7.frequency < t.scaleMaxFrequency &&
    holder.currentBudget != null
  ) {
    const proposed = Math.round((holder.currentBudget * (1 + t.scaleStepPct)) / 5) * 5
    const extraDaily = proposed - holder.currentBudget
    const extraOrdersMo = Math.round((extraDaily / Math.max(m3.cpa, 1)) * 30)
    const under = (1 - m3.cpa / target) * 100
    return build('SCALE_BUDGET', 'medium', holder.level, holder.id, holder.name, client.id, {
      title: `Scale +${(t.scaleStepPct * 100).toFixed(0)}% — CPA ${under.toFixed(0)}% under target`,
      rationale: `Winner with room: 3-day CPA ${money(m3.cpa)} is ${under.toFixed(0)}% under the ${money(target)} target on ${m7.purchases} orders/7d, frequency a healthy ${m7.frequency.toFixed(1)}. Raise the ${holder.level === 'campaign' ? 'campaign (CBO)' : 'ad set (ABO)'} budget ${(t.scaleStepPct * 100).toFixed(0)}% (${money(holder.currentBudget)} → ${money(proposed)}) and hold 2–3 days before the next step.`,
      evidence: [`3d CPA ${money(m3.cpa)}`, `target ${money(target)}`, `${m7.purchases} orders/7d`, `Freq ${m7.frequency.toFixed(1)}`],
      impact: { metric: '+Orders', change: 0.2, note: `~+${fmtInt(extraOrdersMo)} orders/mo at current CPA` },
      confidence: clamp(0.62 + Math.min(m7.purchases / 90, 0.3), 0.62, 0.92),
      impactScore: extraDaily,
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
  if (ad.status === 'LEARNING' && m7.purchases > 0 && m7.purchases < t.scaleMinPurchases7d && m7.cpa <= target) {
    return build('WATCH', 'low', 'ad', ad.id, ad.name, client.id, {
      title: `Watch — early ${money(m7.cpa)} CPA, still learning`,
      rationale: `New ad trending in-target (${money(m7.cpa)} CPA) but only ${m7.purchases} orders so far — below the ${t.scaleMinPurchases7d}-order confidence bar. Let it accrue signal before scaling; don't kill prematurely.`,
      evidence: [`7d CPA ${money(m7.cpa)}`, `${m7.purchases} orders`, `learning`],
      impact: { metric: 'Hold', change: 0, note: 'gather signal' },
      confidence: 0.55,
      action: { kind: 'none', label: 'Keep watching', targetEntityId: ad.id, targetLevel: 'ad' },
    })
  }

  return null
}

/** Ad-set level: consolidation of learning-limited / sparse ad sets. */
function analyzeAdSets(ds: Dataset, client: Client, t: typeof T = T): Suggestion[] {
  const out: Suggestion[] = []
  const campaigns = ds.campaignsByClient.get(client.id) ?? []
  const live = new Set<EntityStatus>(['ACTIVE', 'LEARNING', 'LEARNING_LIMITED'])
  for (const campaign of campaigns) {
    // positive allowlist — never let a PAUSED/ARCHIVED set into a consolidation
    const sets = (ds.adSetsByCampaign.get(campaign.id) ?? []).filter((s) => live.has(s.status))
    const limited = sets
      .map((s) => ({ s, m7: metricsForAdIds(ds, (ds.adsByAdSet.get(s.id) ?? []).map((a) => a.id), lastNDays(7)) }))
      .filter(({ s, m7 }) => s.status === 'LEARNING_LIMITED' || m7.purchases < t.consolidateMinEventsPerWeek)
    if (limited.length >= 2 && campaign.budgetType === 'ABO') {
      const anyLimited = limited.some(({ s }) => s.status === 'LEARNING_LIMITED')
      out.push(
        build('CONSOLIDATE_ADSETS', 'medium', 'campaign', campaign.id, campaign.name, client.id, {
          title: `Consolidate ${limited.length} sparse ad sets`,
          rationale: `${limited.length} ad sets in “${campaign.name}” are below ~${t.consolidateMinEventsPerWeek} conversions/week${anyLimited ? ' and some are stuck in Learning Limited' : ''}. In the Advantage+ era, signal density beats granularity — merge audiences/budgets into fewer ad sets so each can gather enough conversions to exit learning.`,
          // evidence reflects each set's real delivery state, not a blanket "limited"
          evidence: limited.slice(0, 4).map(({ s, m7 }) => `${s.name}: ${s.status === 'LEARNING_LIMITED' ? 'learning limited' : `${m7.purchases}/wk`}`),
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
function analyzeReallocation(ds: Dataset, client: Client, t: typeof T = T): Suggestion | null {
  const allSets = (ds.campaignsByClient.get(client.id) ?? []).flatMap((c) => ds.adSetsByCampaign.get(c.id) ?? [])
  const scored = allSets
    .filter((s) => s.status === 'ACTIVE')
    .map((s) => ({ s, m: metricsForAdIds(ds, (ds.adsByAdSet.get(s.id) ?? []).map((a) => a.id), lastNDays(7)) }))
    .filter((x) => x.m.purchases >= t.minPurchasesToJudge && x.m.spend > 0)
  if (scored.length < 3) return null
  const byCpa = [...scored].sort((a, b) => a.m.cpa - b.m.cpa)
  const best = byCpa[0].m.cpa
  // The "worst" (high-CPA) end must carry enough volume to trust its CPA — else a
  // single thin outlier just over the min-signal gate manufactures a fake spread.
  // Fall back to the raw max only if no set clears the higher bar.
  const worstEntry = [...byCpa].reverse().find((x) => x.m.purchases >= t.minPurchasesToJudge * 2) ?? byCpa[byCpa.length - 1]
  const worst = worstEntry.m.cpa
  if (best <= 0) return null
  const spread = (worst - best) / best
  if (spread < t.reallocateCpaSpread) return null
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

/** Client-level budget pacing alert (over/under run-rate vs the monthly budget). */
function analyzePacing(ds: Dataset, client: Client): Suggestion | null {
  const adIds = adIdsForClient(ds, client.id)
  const { spent, projection, pace, dayOfMonth, daysInMonth } = computePacing(ds, client.id)
  const recent = metricsForAdIds(ds, adIds, lastNDays(7))
  const onTarget = recent.cpa > 0 && recent.cpa <= client.targetCPA
  if (pace >= 1.12) {
    const overDaily = (projection - client.monthlyBudget) / daysInMonth
    return build('PACING_ALERT', 'high', 'client', client.id, client.name, client.id, {
      title: `Pacing ${((pace - 1) * 100).toFixed(0)}% over budget`,
      rationale: `At the current run-rate, ${client.name} is projected to spend ${money(projection)} this month vs the ${money(client.monthlyBudget)} budget — ${((pace - 1) * 100).toFixed(0)}% over. ${onTarget ? 'CPA is in-target, so this may be intentional scaling — confirm the extra budget is approved.' : 'CPA is above target, so the overspend is buying expensive orders — pull daily budgets back.'}`,
      evidence: [`Projected ${money(projection)}`, `Budget ${money(client.monthlyBudget)}`, `MTD ${money(spent)}`, `Day ${dayOfMonth}/${daysInMonth}`],
      impact: { metric: 'Budget control', change: -(pace - 1), note: `~${money(overDaily)}/day over` },
      confidence: 0.8,
      impactScore: Math.abs(overDaily),
      action: { kind: 'none', label: 'Review pacing', targetEntityId: client.id, targetLevel: 'client' },
    })
  }
  if (pace <= 0.85 && onTarget) {
    const underMo = client.monthlyBudget - projection
    return build('PACING_ALERT', 'medium', 'client', client.id, client.name, client.id, {
      title: `Under-pacing ${((1 - pace) * 100).toFixed(0)}% with in-target CPA`,
      rationale: `${client.name} is projected to spend ${money(projection)} vs the ${money(client.monthlyBudget)} budget — leaving ~${money(underMo)} unused — while CPA (${money(recent.cpa)}) is at or below the ${money(client.targetCPA)} target. There's headroom to scale winning campaigns into the unused budget.`,
      evidence: [`Projected ${money(projection)}`, `Budget ${money(client.monthlyBudget)}`, `CPA ${money(recent.cpa)} ≤ ${money(client.targetCPA)}`],
      impact: { metric: '+Growth room', change: 0.1, note: `~${money(underMo)} unused` },
      confidence: 0.7,
      impactScore: Math.abs(underMo / daysInMonth),
      action: { kind: 'none', label: 'Open scaling', targetEntityId: client.id, targetLevel: 'client' },
    })
  }
  return null
}

/** Client-level "what changed overnight" anomalies: tracking break, CPA blowout,
 *  CPM spike — last 3 days vs the prior week. */
function analyzeAnomalies(ds: Dataset, client: Client): Suggestion[] {
  const out: Suggestion[] = []
  const adIds = adIdsForClient(ds, client.id)
  const recent = metricsForAdIds(ds, adIds, lastNDays(3))
  // "prior week" baseline = days 4–10: the 7-day window immediately before the
  // recent 3-day window (lastNDays(7, 3) ends 3 days ago), so the copy's
  // "prior week" is an approximation of this adjacent comparison window.
  const base = metricsForAdIds(ds, adIds, lastNDays(7, 3))
  // tracking break — spend continuing, conversions collapsed to zero
  if (base.purchases >= 20 && recent.spend >= (base.spend / 7) * 2 && recent.purchases === 0) {
    out.push(
      build('ANOMALY', 'critical', 'client', client.id, client.name, client.id, {
        title: `Possible conversion tracking break`,
        rationale: `${client.name} spent ${money(recent.spend)} in the last 3 days but recorded 0 orders, after healthy volume the prior week (${fmtInt(base.purchases)} orders). Spend is flowing while conversions stopped — a classic pixel/CAPI break. Verify the conversion setup before judging any ads.`,
        evidence: [`0 orders/3d`, `${money(recent.spend)} spent/3d`, `prior ${fmtInt(base.purchases)} orders/7d`],
        impact: { metric: 'Data integrity', change: -1, note: 'verify pixel/CAPI' },
        confidence: 0.7,
        impactScore: recent.spend / 3,
        action: { kind: 'none', label: 'Investigate', targetEntityId: client.id, targetLevel: 'client' },
      }),
    )
    return out // a tracking break supersedes the metric anomalies below
  }
  // CPA blowout
  if (recent.purchases >= 5 && base.cpa > 0 && recent.cpa > base.cpa * 1.2) {
    const up = (recent.cpa / base.cpa - 1) * 100
    out.push(
      build('ANOMALY', 'high', 'client', client.id, client.name, client.id, {
        title: `CPA up ${up.toFixed(0)}% in the last 3 days`,
        rationale: `${client.name}'s 3-day CPA (${money(recent.cpa)}) jumped ${up.toFixed(0)}% versus the prior week (${money(base.cpa)}). Something shifted recently — a fatiguing winner, rising auction costs, or a landing/offer change. Drill in before it compounds.`,
        evidence: [`3d CPA ${money(recent.cpa)}`, `prior ${money(base.cpa)}`, `+${up.toFixed(0)}%`],
        impact: { metric: '−Efficiency', change: -(up / 100), note: 'recent regression' },
        confidence: 0.66,
        impactScore: (recent.spend / 3) * 0.3,
        action: { kind: 'none', label: 'Investigate', targetEntityId: client.id, targetLevel: 'client' },
      }),
    )
  } else if (base.cpm > 0 && recent.cpm > base.cpm * 1.25 && recent.impressions > 5000) {
    // CPM spike (only when CPA didn't already fire, to avoid double-alerting)
    const up = (recent.cpm / base.cpm - 1) * 100
    out.push(
      build('ANOMALY', 'medium', 'client', client.id, client.name, client.id, {
        title: `CPM spiked ${up.toFixed(0)}% this week`,
        rationale: `Auction costs for ${client.name} rose sharply — 3-day CPM (${money(recent.cpm)}) is up ${up.toFixed(0)}% vs the prior week (${money(base.cpm)}). Rising CPM at steady CTR inflates CPA; check frequency/saturation and whether new competitors entered the auction.`,
        evidence: [`3d CPM ${money(recent.cpm)}`, `prior ${money(base.cpm)}`, `+${up.toFixed(0)}%`],
        impact: { metric: 'Auction cost', change: -(up / 100), note: 'rising CPM' },
        confidence: 0.6,
        impactScore: (recent.spend / 3) * 0.2,
        action: { kind: 'none', label: 'Investigate', targetEntityId: client.id, targetLevel: 'client' },
      }),
    )
  }
  return out
}

export function analyzeClient(ds: Dataset, clientId: string): Suggestion[] {
  const client = ds.clientById.get(clientId)
  if (!client) return []
  // Per-client effective thresholds (live global → preset → overrides), resolved
  // once and threaded into the helpers (defaults to the global T when unset).
  const t = effectiveThresholds(clientId)
  const out: Suggestion[] = []
  const pacing = analyzePacing(ds, client)
  if (pacing) out.push(pacing)
  out.push(...analyzeAnomalies(ds, client))
  for (const adId of adIdsForClient(ds, clientId)) {
    const ad = ds.adById.get(adId)!
    const s = analyzeAd(ds, ad, client, t)
    if (s) out.push(s)
  }
  out.push(...analyzeAdSets(ds, client, t))
  const realloc = analyzeReallocation(ds, client, t)
  if (realloc) out.push(realloc)
  // Dedup by id, keeping the highest-CONFIDENCE sibling: several ads in one CBO
  // campaign resolve to the same budget-holder and emit the identical SCALE_BUDGET
  // id. impactScore is identical across them (derived from the shared holder), so
  // confidence — which scales with the ad's order volume — is the honest tie-break.
  // (sortSuggestions re-orders afterward, so map insertion order is moot.)
  const byId = new Map<string, Suggestion>()
  for (const s of out) {
    const prev = byId.get(s.id)
    if (!prev || s.confidence > prev.confidence) byId.set(s.id, s)
  }
  return sortSuggestions([...byId.values()])
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
    /** rough $/day at stake — drives the "by impact" sort */
    impactScore?: number
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
    impactScore: rest.impactScore ?? 0,
    ...rest,
    projectedImpact: rest.impact,
  } as Suggestion
}

const money = (v: number) => `$${v.toFixed(v < 100 ? 2 : 0)}`
const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US')

export type { MetricsBundle }
