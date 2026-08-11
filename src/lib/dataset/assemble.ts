import type { Ad, AdAccount, AdSet, BusinessManager, Campaign, Client, Creative, Insight, ISODate } from '../types'
import type { Dataset } from '../demo/generate'

/* ============================================================================
   assembleDataset — the ONE builder of the Dataset shape (entities + the 12
   index Maps + optional derived statuses), shared by demo and live so both
   providers produce identical-shape snapshots and the entire UI/engine reads
   one contract.

   Extracted verbatim from generateDataset()'s bottom section (live-integration
   P2) — the demo goldens in __tests__/demoGoldens.test.ts prove the move
   changed nothing.

   Status derivation is OPT-IN: the demo derives ad-set/campaign statuses from
   recent volume (it has no delivery telemetry), while live supplies REAL
   effective_status + learning_stage_info and must not have them overwritten.
   ========================================================================== */

export interface DatasetInput {
  businessManagers: BusinessManager[]
  clients: Client[]
  accounts: AdAccount[]
  campaigns: Campaign[]
  adSets: AdSet[]
  ads: Ad[]
  creatives: Creative[]
  insights: Insight[]
}

export interface AssembleOptions {
  /** When set, ad-set + campaign statuses are DERIVED from recent volume (the
   *  demo's approximation): an ad set with no active ads → PAUSED, with < 13
   *  purchases over `recentDates` → LEARNING_LIMITED, else ACTIVE; a campaign
   *  is ACTIVE iff any ad set is ACTIVE/LEARNING_LIMITED. Live omits this —
   *  its statuses come from Meta's effective_status + learning_stage_info. */
  deriveStatuses?: { recentDates: ISODate[] }
}

export function assembleDataset(input: DatasetInput, opts: AssembleOptions = {}): Dataset {
  const { businessManagers, clients, accounts, campaigns, adSets, ads, creatives, insights } = input

  // ---- indexes ----
  const clientById = new Map(clients.map((c) => [c.id, c]))
  const accountByClient = new Map(accounts.map((a) => [a.clientId, a]))
  const adById = new Map(ads.map((a) => [a.id, a]))
  const adSetById = new Map(adSets.map((a) => [a.id, a]))
  const campaignById = new Map(campaigns.map((c) => [c.id, c]))
  const creativeById = new Map(creatives.map((c) => [c.id, c]))

  const group = <T, K>(items: T[], key: (t: T) => K) => {
    const m = new Map<K, T[]>()
    for (const it of items) {
      const k = key(it)
      const arr = m.get(k)
      if (arr) arr.push(it)
      else m.set(k, [it])
    }
    return m
  }
  const campaignsByClient = group(campaigns, (c) => c.clientId)
  const adSetsByCampaign = group(adSets, (a) => a.campaignId)
  const adsByAdSet = group(ads, (a) => a.adSetId)
  const adsByClient = group(ads, (a) => a.clientId)
  const creativesByClient = group(creatives, (c) => c.clientId)
  const insightsByAd = group(insights, (i) => i.adId)

  // ---- derived statuses for ad sets / campaigns from recent volume (opt-in) ----
  if (opts.deriveStatuses) {
    const recent = new Set(opts.deriveStatuses.recentDates)
    for (const adSet of adSets) {
      if (adSet.status === 'PAUSED') continue
      const adsIn = adsByAdSet.get(adSet.id) ?? []
      let purchases7 = 0
      let anyActive = false
      for (const ad of adsIn) {
        if (ad.status === 'ACTIVE' || ad.status === 'LEARNING') anyActive = true
        for (const ins of insightsByAd.get(ad.id) ?? []) {
          if (recent.has(ins.date)) purchases7 += ins.purchases
        }
      }
      if (!anyActive) adSet.status = 'PAUSED'
      else if (purchases7 < 13) adSet.status = 'LEARNING_LIMITED'
      else adSet.status = 'ACTIVE'
    }
    for (const campaign of campaigns) {
      const sets = adSetsByCampaign.get(campaign.id) ?? []
      campaign.status = sets.some((s) => s.status === 'ACTIVE' || s.status === 'LEARNING_LIMITED') ? 'ACTIVE' : 'PAUSED'
    }
  }

  return {
    businessManagers,
    clients,
    accounts,
    campaigns,
    adSets,
    ads,
    creatives,
    insights,
    clientById,
    accountByClient,
    campaignsByClient,
    adSetsByCampaign,
    adsByAdSet,
    adsByClient,
    adById,
    adSetById,
    campaignById,
    creativeById,
    creativesByClient,
    insightsByAd,
  }
}
