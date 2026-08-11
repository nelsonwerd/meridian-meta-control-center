import type { Dataset } from './demo/generate'
import type { DateRange, EntityLevel, Insight, MetricsBundle, Scope } from './types'
import { addDays, aggregate, canonicalPeriodKey, daysBetween, filterByRange, today } from './metrics'

/* Pure resolution helpers: entity → its ad ids → insight rows → metrics. Used by
   both the screens and the AI engine so they always agree on the numbers. */

export function adIdsForEntity(ds: Dataset, level: EntityLevel, id: string): string[] {
  switch (level) {
    case 'ad':
      return [id]
    case 'adset':
      return (ds.adsByAdSet.get(id) ?? []).map((a) => a.id)
    case 'campaign':
      return (ds.adSetsByCampaign.get(id) ?? []).flatMap((s) => (ds.adsByAdSet.get(s.id) ?? []).map((a) => a.id))
    case 'account':
      return (ds.adsByClient.get(accountClientId(ds, id) ?? '') ?? []).map((a) => a.id)
    case 'client':
      return adIdsForClient(ds, id)
  }
}

function accountClientId(ds: Dataset, accountId: string): string | undefined {
  return ds.accounts.find((a) => a.id === accountId)?.clientId
}

export function adIdsForClient(ds: Dataset, clientId: string): string[] {
  return (ds.adsByClient.get(clientId) ?? []).map((a) => a.id)
}

export function adIdsForScope(ds: Dataset, scope: Scope): string[] {
  if (scope.kind === 'portfolio') return ds.ads.map((a) => a.id)
  if (scope.kind === 'bm') {
    const clientIds = new Set(ds.clients.filter((c) => c.bmId === scope.bmId).map((c) => c.id))
    return ds.ads.filter((a) => clientIds.has(a.clientId)).map((a) => a.id)
  }
  return adIdsForClient(ds, scope.clientId)
}

export function clientsForScope(ds: Dataset, scope: Scope) {
  if (scope.kind === 'portfolio') return ds.clients
  if (scope.kind === 'bm') return ds.clients.filter((c) => c.bmId === scope.bmId)
  return ds.clients.filter((c) => c.id === scope.clientId)
}

export function insightsForAdIds(ds: Dataset, adIds: string[]): Insight[] {
  const out: Insight[] = []
  for (const id of adIds) {
    const rows = ds.insightsByAd.get(id)
    if (rows) out.push(...rows)
  }
  return out
}

export function metricsForAdIds(ds: Dataset, adIds: string[], range: DateRange): MetricsBundle {
  const rows = filterByRange(insightsForAdIds(ds, adIds), range)
  const bundle = aggregate(rows)

  // LIVE reach correction: summing DAILY reach re-counts the same person every
  // day, collapsing period frequency toward ~1.0 — which would blind the
  // engine's fatigue gate and green-light the scale gate falsely. When the
  // snapshot carries true de-duplicated period reach (live pulls it per
  // canonical window) substitute it. Applied only when EVERY ad that delivered
  // in-range has an entry, so mixed additive/true sums never blend. Reach
  // summed ACROSS ads still over-counts cross-ad overlap — the same
  // approximation Meta itself makes below account level; labelled in LEDGER.md.
  if (ds.periodReachByAd && bundle.reach > 0) {
    const key = canonicalPeriodKey(range)
    if (key) {
      let trueReach = 0
      let allCovered = true
      const delivered = new Set<string>()
      for (const r of rows) delivered.add(r.adId)
      for (const adId of delivered) {
        const entry = ds.periodReachByAd.get(adId)?.[key]
        if (entry == null) {
          allCovered = false
          break
        }
        trueReach += entry
      }
      if (allCovered && trueReach > 0) {
        bundle.reach = trueReach
        bundle.frequency = bundle.impressions / trueReach
      }
    }
  }
  return bundle
}

export function metricsForEntity(ds: Dataset, level: EntityLevel, id: string, range: DateRange): MetricsBundle {
  return metricsForAdIds(ds, adIdsForEntity(ds, level, id), range)
}

export function metricsForScope(ds: Dataset, scope: Scope, range: DateRange): MetricsBundle {
  return metricsForAdIds(ds, adIdsForScope(ds, scope), range)
}

export interface Pacing {
  spent: number
  projection: number
  pace: number
  dayOfMonth: number
  daysInMonth: number
}

/** Month-to-date spend vs the client's monthly budget, with a run-rate projection.
 *  Single source of truth for both the engine's pacing alert and the weekly report
 *  (guards day-of-month against divide-by-zero). */
export function computePacing(ds: Dataset, clientId: string): Pacing {
  const client = ds.clientById.get(clientId)
  const monthStart = today().slice(0, 8) + '01'
  const spent = aggregate(filterByRange(insightsForAdIds(ds, adIdsForClient(ds, clientId)), rangeOf(monthStart, today()))).spend
  const dayOfMonth = daysBetween(monthStart, today()) + 1
  const daysInMonth = new Date(Date.UTC(Number(today().slice(0, 4)), Number(today().slice(5, 7)), 0)).getUTCDate()
  const projection = (spent / Math.max(1, dayOfMonth)) * daysInMonth
  const monthlyBudget = client?.monthlyBudget ?? 0
  const pace = monthlyBudget > 0 ? projection / monthlyBudget : 1
  return { spent, projection, pace, dayOfMonth, daysInMonth }
}

/* ----- ad-hoc windows for trend detection (anchored to DATA_TODAY) ----- */

export function lastNDays(n: number, endOffset = 0): DateRange {
  const end = addDays(today(), -endOffset)
  return { preset: 'custom', start: addDays(end, -(n - 1)), end, label: `Last ${n}d` }
}

export function rangeOf(start: string, end: string): DateRange {
  return { preset: 'custom', start, end, label: 'custom' }
}

/** Human-readable parent path for an entity (ad → "Ad set › Campaign", adset →
 *  "Campaign"). Disambiguates non-unique entity names on suggestion cards + the
 *  drawer header — ad names recur across ad sets, so the name alone isn't specific. */
export function parentPath(ds: Dataset, level: EntityLevel, entityId: string): string {
  if (level === 'ad') {
    const ad = ds.adById.get(entityId)
    if (!ad) return ''
    const set = ds.adSetById.get(ad.adSetId)
    const cmp = ds.campaignById.get(ad.campaignId)
    return [set?.name, cmp?.name].filter(Boolean).join(' › ')
  }
  if (level === 'adset') {
    const set = ds.adSetById.get(entityId)
    return set ? (ds.campaignById.get(set.campaignId)?.name ?? '') : ''
  }
  return '' // campaign name IS the entity name; client/account have no in-feed parent
}

/** Display name for any entity, resolved from the live snapshot at render time. The
 *  decision ledger stores only ids (no denormalized name), so the Activity panel
 *  resolves names here. Returns '' if the id no longer resolves in the current mode. */
export function entityName(ds: Dataset, level: EntityLevel, entityId: string): string {
  switch (level) {
    case 'ad':
      return ds.adById.get(entityId)?.name ?? ''
    case 'adset':
      return ds.adSetById.get(entityId)?.name ?? ''
    case 'campaign':
      return ds.campaignById.get(entityId)?.name ?? ''
    case 'account':
      return ds.accounts.find((a) => a.id === entityId)?.name ?? ds.clientById.get(entityId)?.name ?? ''
    case 'client':
      return ds.clientById.get(entityId)?.name ?? ''
  }
}
