import type {
  Ad,
  AdAccount,
  AdSet,
  AudienceSpec,
  AudienceType,
  Campaign,
  CampaignKind,
  Client,
  Creative,
  CreativeAngle,
  CreativeFormat,
  Insight,
  ISODate,
  OptimizationGoal,
} from '../types'
import {
  ANGLE_GRADIENTS,
  AUDIENCE_LABELS,
  BUSINESS_MANAGERS,
  CLIENTS,
  CREATIVE_ANGLES,
  HEADLINE_POOL,
} from './catalog'
import { chance, clamp, intRange, jitter, pick, poisson, range, rngFor, sample } from '../rng'

/** Data anchor — the demo's "today". Keeps the 90-day story stable regardless of
 *  the real wall-clock. Date helpers treat this as now. */
export const DATA_TODAY: ISODate = '2026-06-17'
export const WINDOW_DAYS = 90

function addDays(iso: ISODate, days: number): ISODate {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Build the ascending list of ISO dates in the demo window (oldest → today). */
export function windowDates(): ISODate[] {
  const out: ISODate[] = []
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) out.push(addDays(DATA_TODAY, -i))
  return out
}

/* ---- hidden generative profiles (engine never reads these; only the data) ---- */

type AdArchetype = 'star' | 'solid' | 'fatiguing' | 'loser' | 'doa' | 'sleeper' | 'volatile' | 'new'

interface CreativeProfile {
  ctrQuality: number // multiplier on base link CTR
  cvrQuality: number // multiplier on base CVR
  hookQuality: number // 3s/impr base (video)
  holdQuality: number // thruplay/3s base (video)
}

interface AdPlan {
  ad: Ad
  archetype: AdArchetype
  creative: Creative
  profile: CreativeProfile
  baseDailySpend: number
  freq0: number
  freqSlope: number
  activeFrom: number // day index
  activeTo: number // day index inclusive
  volatility: number
}

export interface Dataset {
  businessManagers: typeof BUSINESS_MANAGERS
  clients: Client[]
  accounts: AdAccount[]
  campaigns: Campaign[]
  adSets: AdSet[]
  ads: Ad[]
  creatives: Creative[]
  insights: Insight[]
  // indexes
  clientById: Map<string, Client>
  accountByClient: Map<string, AdAccount>
  campaignsByClient: Map<string, Campaign[]>
  adSetsByCampaign: Map<string, AdSet[]>
  adsByAdSet: Map<string, Ad[]>
  adsByClient: Map<string, Ad[]>
  adById: Map<string, Ad>
  adSetById: Map<string, AdSet>
  campaignById: Map<string, Campaign>
  creativeById: Map<string, Creative>
  creativesByClient: Map<string, Creative[]>
  insightsByAd: Map<string, Insight[]>
}

const ANGLE_QUALITY_BIAS: Partial<Record<CreativeAngle, number>> = {
  'UGC Testimonial': 1.18,
  'Social Proof': 1.08,
  'Problem / Solution': 1.05,
  'Before / After': 1.06,
  'Offer / Promo': 1.02,
  Lifestyle: 0.96,
  Educational: 0.95,
  Unboxing: 0.92,
}

function makeCreatives(client: Client): Array<{ creative: Creative; profile: CreativeProfile }> {
  const rng = rngFor('creatives', client.id)
  const count = client.status === 'onboarding' ? 7 : intRange(rng, 12, 18)
  const batches = ['Q1 Batch A', 'Q1 Batch B', 'Q2 Batch A', 'Q2 Batch B', 'Q2 Batch C']
  const out: Array<{ creative: Creative; profile: CreativeProfile }> = []
  for (let i = 0; i < count; i++) {
    const angle = pick(rng, CREATIVE_ANGLES)
    const format: CreativeFormat = chance(rng, 0.58) ? 'video' : chance(rng, 0.6) ? 'image' : 'carousel'
    const batch = pick(rng, batches.slice(0, client.status === 'onboarding' ? 2 : 5))
    const ratio = format === 'video' ? (chance(rng, 0.6) ? '9:16' : '4:5') : chance(rng, 0.5) ? '1:1' : '4:5'
    // intrinsic quality, biased by angle + a few designated winners/weak ones
    const angleBias = ANGLE_QUALITY_BIAS[angle] ?? 1.0
    let ctrQuality = clamp(range(rng, 0.62, 1.45) * angleBias, 0.4, 1.7)
    let cvrQuality = clamp(range(rng, 0.7, 1.4), 0.45, 1.6)
    let hookQuality = format === 'video' ? range(rng, 0.16, 0.46) : 0
    let holdQuality = format === 'video' ? range(rng, 0.12, 0.42) : 0
    // designate a few clear funnel-failure creatives so diagnosis has signal
    const roll = rng()
    if (roll < 0.16) {
      // hook-weak: bad first 3s
      hookQuality = format === 'video' ? range(rng, 0.08, 0.18) : hookQuality
      ctrQuality = clamp(ctrQuality * 0.7, 0.4, 1.7)
    } else if (roll < 0.3) {
      // body-weak: good hook, drops off
      hookQuality = format === 'video' ? range(rng, 0.34, 0.46) : hookQuality
      holdQuality = format === 'video' ? range(rng, 0.08, 0.16) : holdQuality
    } else if (roll < 0.42) {
      // convert-weak: engages but doesn't close
      ctrQuality = clamp(ctrQuality * 1.2, 0.4, 1.7)
      cvrQuality = clamp(cvrQuality * 0.6, 0.4, 1.6)
    } else if (roll > 0.86) {
      // standout winner
      ctrQuality = clamp(ctrQuality * 1.25, 0.4, 1.8)
      cvrQuality = clamp(cvrQuality * 1.2, 0.4, 1.7)
      hookQuality = format === 'video' ? clamp(hookQuality * 1.2, 0, 0.5) : 0
    }
    const headline = pick(rng, HEADLINE_POOL[angle])
    const createdAt = addDays(DATA_TODAY, -intRange(rng, 8, 120))
    const creative: Creative = {
      id: `cr_${client.id.slice(2)}_${i + 1}`,
      clientId: client.id,
      name: `${angle} — ${format === 'video' ? 'Video' : format === 'carousel' ? 'Carousel' : 'Static'} v${i + 1}`,
      format,
      angle,
      thumbnailGradient: ANGLE_GRADIENTS[angle],
      ratio: ratio as Creative['ratio'],
      durationSec: format === 'video' ? intRange(rng, 12, 45) : undefined,
      headline,
      primaryText: `${headline} — ${client.name}. Free shipping over $50. Shop the bestseller everyone's talking about.`,
      batch,
      createdAt,
    }
    out.push({ creative, profile: { ctrQuality, cvrQuality, hookQuality, holdQuality } })
  }
  return out
}

interface CampaignTemplate {
  kind: CampaignKind
  name: string
  budgetType: 'CBO' | 'ABO'
  adSets: { type: AudienceType; goal: OptimizationGoal; label?: string }[]
}

function campaignTemplates(client: Client): CampaignTemplate[] {
  const base: CampaignTemplate[] = [
    {
      kind: 'advantage_plus',
      name: '[ASC] Advantage+ Shopping',
      budgetType: 'CBO',
      adSets: [{ type: 'advantage', goal: 'OFFSITE_CONVERSIONS' }],
    },
    {
      kind: 'prospecting',
      name: 'Prospecting — Broad + LLA',
      budgetType: 'CBO',
      adSets: [
        { type: 'broad', goal: 'OFFSITE_CONVERSIONS' },
        { type: 'lookalike', goal: 'OFFSITE_CONVERSIONS' },
        { type: 'interest', goal: 'OFFSITE_CONVERSIONS' },
      ],
    },
    {
      kind: 'retargeting',
      name: 'Retargeting — Site + ATC',
      budgetType: 'ABO',
      adSets: [
        { type: 'retargeting', goal: 'OFFSITE_CONVERSIONS', label: 'RT: 30d Site' },
        { type: 'retargeting', goal: 'VALUE', label: 'RT: ATC 14d' },
      ],
    },
    {
      kind: 'testing',
      name: 'Creative Testing — Q2',
      budgetType: 'ABO',
      adSets: [
        { type: 'broad', goal: 'OFFSITE_CONVERSIONS', label: 'Test Cell A' },
        { type: 'broad', goal: 'OFFSITE_CONVERSIONS', label: 'Test Cell B' },
      ],
    },
  ]
  if (client.status === 'onboarding') return base.slice(0, 2)
  return base
}

const ARCH_WEIGHTS: Record<AdArchetype, number> = {
  star: 1.7,
  solid: 1.0,
  fatiguing: 0.85,
  loser: 0.5,
  doa: 0.25,
  sleeper: 0.35,
  volatile: 0.8,
  new: 0.6,
}

function pickArchetype(rng: () => number, kind: CampaignKind): AdArchetype {
  // testing campaigns skew toward unproven/new + a mix of weak; prospecting has stars
  const table: [AdArchetype, number][] =
    kind === 'testing'
      ? [
          ['new', 3],
          ['volatile', 2],
          ['loser', 2],
          ['doa', 1.2],
          ['solid', 2],
          ['star', 1],
        ]
      : kind === 'retargeting'
        ? [
            ['star', 2.5],
            ['solid', 3],
            ['fatiguing', 2],
            ['sleeper', 1],
          ]
        : kind === 'advantage_plus'
          ? [
              ['star', 3],
              ['solid', 3],
              ['fatiguing', 1.5],
            ]
          : [
              ['star', 2.2],
              ['solid', 2.6],
              ['fatiguing', 2],
              ['loser', 1.3],
              ['sleeper', 1.2],
              ['volatile', 1.2],
              ['new', 1],
            ]
  const total = table.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  for (const [a, w] of table) {
    if ((r -= w) <= 0) return a
  }
  return 'solid'
}

// archetype trend functions over t in [0,1] → multipliers
function trends(a: AdArchetype) {
  switch (a) {
    case 'star':
      return { ctr: (t: number) => 1 + 0.05 * t, cvr: (t: number) => 1 + 0.02 * t, cpm: (t: number) => 1 + 0.03 * t }
    case 'solid':
      return { ctr: (t: number) => 1 - 0.04 * t, cvr: () => 1, cpm: (t: number) => 1 + 0.05 * t }
    case 'fatiguing':
      // convex: degradation concentrates in the recent weeks (real fatigue curve)
      return { ctr: (t: number) => 1.15 - 0.6 * t * t, cvr: (t: number) => 1 - 0.12 * t, cpm: (t: number) => 0.9 + 0.55 * t * t }
    case 'loser':
      return { ctr: (t: number) => 0.72 - 0.06 * t, cvr: (t: number) => 0.7 - 0.04 * t, cpm: (t: number) => 1.08 + 0.12 * t }
    case 'doa':
      return { ctr: () => 0.22, cvr: () => 0.25, cpm: (t: number) => 1.1 + 0.1 * t }
    case 'sleeper':
      return { ctr: (t: number) => 1.02 - 0.02 * t, cvr: () => 1.04, cpm: () => 1 }
    case 'volatile':
      return { ctr: (t: number) => 1 + 0.18 * Math.sin(t * 9), cvr: (t: number) => 1 + 0.12 * Math.cos(t * 7), cpm: (t: number) => 1 + 0.1 * Math.sin(t * 6) }
    case 'new':
      return { ctr: (t: number) => 1.05 + 0.05 * t, cvr: (t: number) => 1 + 0.03 * t, cpm: (t: number) => 1.05 - 0.03 * t }
  }
}

function generateForClient(client: Client): {
  account: AdAccount
  campaigns: Campaign[]
  adSets: AdSet[]
  ads: Ad[]
  creatives: Creative[]
  plans: AdPlan[]
} {
  const rng = rngFor('struct', client.id)
  const account: AdAccount = {
    id: `act_${100000000 + Math.floor(rngFor('acct', client.id)() * 800000000)}`,
    clientId: client.id,
    name: `${client.name} — Ad Account`,
    currency: client.currency,
    timezone: 'America/New_York',
  }
  const creativePairs = makeCreatives(client)
  const creatives = creativePairs.map((p) => p.creative)
  const profileByCreative = new Map(creativePairs.map((p) => [p.creative.id, p.profile]))

  const campaigns: Campaign[] = []
  const adSets: AdSet[] = []
  const ads: Ad[] = []
  const plans: AdPlan[] = []

  const templates = campaignTemplates(client)
  let cIdx = 0
  for (const tpl of templates) {
    cIdx++
    const dailyTotalForClient = client.monthlyBudget / 30
    const campaignBudget = tpl.budgetType === 'CBO' ? Math.round((dailyTotalForClient * range(rng, 0.18, 0.42)) / 10) * 10 : null
    const campaign: Campaign = {
      id: `cmp_${client.id.slice(2)}_${cIdx}`,
      clientId: client.id,
      accountId: account.id,
      name: tpl.name,
      objective: 'OUTCOME_SALES',
      status: 'ACTIVE',
      budgetType: tpl.budgetType,
      dailyBudget: campaignBudget,
      bidStrategy: tpl.kind === 'advantage_plus' ? 'LOWEST_COST_WITHOUT_CAP' : pick(rng, ['LOWEST_COST_WITHOUT_CAP', 'COST_CAP']),
      kind: tpl.kind,
      createdAt: addDays(DATA_TODAY, -intRange(rng, 60, 200)),
    }
    campaigns.push(campaign)

    let sIdx = 0
    for (const as of tpl.adSets) {
      sIdx++
      const label = as.label ?? pick(rng, AUDIENCE_LABELS[as.type] as unknown as string[])
      const audience: AudienceSpec = {
        type: as.type,
        label,
        sizeEstimate: intRange(rng, 800_000, 18_000_000),
      }
      const adSetDaily = tpl.budgetType === 'ABO' ? Math.round((dailyTotalForClient * range(rng, 0.04, 0.13)) / 5) * 5 : null
      const adSet: AdSet = {
        id: `as_${client.id.slice(2)}_${cIdx}_${sIdx}`,
        campaignId: campaign.id,
        clientId: client.id,
        name: `${campaign.kind === 'testing' ? 'Test' : audience.type === 'advantage' ? 'Advantage+' : audience.type[0].toUpperCase() + audience.type.slice(1)} — ${label}`,
        status: 'ACTIVE',
        optimizationGoal: as.goal,
        billingEvent: 'IMPRESSIONS',
        dailyBudget: adSetDaily,
        audience,
        createdAt: campaign.createdAt,
      }
      adSets.push(adSet)

      const nAds = tpl.kind === 'testing' ? intRange(rng, 2, 4) : intRange(rng, 2, 4)
      const chosenCreatives = sample(rng, creatives, nAds)
      for (let a = 0; a < nAds; a++) {
        const archetype = pickArchetype(rng, tpl.kind)
        const creative = chosenCreatives[a] ?? pick(rng, creatives)
        const profile = profileByCreative.get(creative.id)!
        // spend share: distribute the ad set / campaign budget across ads by archetype weight
        const parentDaily = adSetDaily ?? (campaignBudget ? campaignBudget / Math.max(1, tpl.adSets.length) : dailyTotalForClient * 0.08)
        const baseDailySpend = clamp(
          (parentDaily / nAds) * ARCH_WEIGHTS[archetype] * range(rng, 0.7, 1.3),
          6,
          parentDaily,
        )
        const activeFrom = archetype === 'new' ? WINDOW_DAYS - intRange(rng, 9, 18) : intRange(rng, 0, 6)
        // some losers/doas get paused partway through
        const pausedEarly = (archetype === 'loser' || archetype === 'doa') && chance(rng, 0.45)
        const activeTo = pausedEarly ? WINDOW_DAYS - intRange(rng, 2, 20) : WINDOW_DAYS - 1
        const status: Ad['status'] = pausedEarly ? 'PAUSED' : archetype === 'new' ? 'LEARNING' : 'ACTIVE'
        const ad: Ad = {
          id: `ad_${client.id.slice(2)}_${cIdx}_${sIdx}_${a + 1}`,
          adSetId: adSet.id,
          campaignId: campaign.id,
          clientId: client.id,
          name: `${creative.angle} · ${creative.format} · ${creative.batch}`,
          status,
          creativeId: creative.id,
          createdAt: addDays(DATA_TODAY, -(WINDOW_DAYS - activeFrom) + 1),
        }
        ads.push(ad)
        plans.push({
          ad,
          archetype,
          creative,
          profile,
          baseDailySpend,
          freq0: range(rng, 1.15, 1.8),
          freqSlope: archetype === 'fatiguing' ? range(rng, 2.4, 3.2) : archetype === 'loser' ? range(rng, 1.2, 2) : range(rng, 0.5, 1.4),
          activeFrom,
          activeTo,
          volatility: archetype === 'volatile' ? 0.32 : 0.14,
        })
      }
    }
  }

  ensureCoverage(client, campaigns, adSets, plans)
  return { account, campaigns, adSets, ads, creatives, plans }
}

/** Deterministically guarantee each (non-onboarding) client surfaces the full
 *  diagnostic mix — a clear DOA burner, a fatiguing winner, and a sparse testing
 *  campaign whose ad sets fall into Learning Limited (→ consolidation). Without
 *  this, probabilistic archetypes leave some suggestion types unrepresented. */
function ensureCoverage(client: Client, campaigns: Campaign[], adSets: AdSet[], plans: AdPlan[]) {
  if (client.status === 'onboarding') return
  const crng = rngFor('coverage', client.id)
  const cmpById = new Map(campaigns.map((c) => [c.id, c]))
  const kindOf = (p: AdPlan) => cmpById.get(p.ad.campaignId)?.kind
  const active = plans.filter((p) => p.ad.status === 'ACTIVE')

  // 1) DOA burner in a prospecting/advantage campaign — high spend, ~0 clicks.
  const doaTarget = active.find((p) => kindOf(p) === 'prospecting' || kindOf(p) === 'advantage_plus')
  if (doaTarget) {
    doaTarget.archetype = 'doa'
    doaTarget.baseDailySpend = Math.max(doaTarget.baseDailySpend, 48)
    doaTarget.activeFrom = 0
    doaTarget.activeTo = WINDOW_DAYS - 1
    doaTarget.freqSlope = 1.4
    doaTarget.volatility = 0.14
  }

  // 2) Fatiguing winner in prospecting/retargeting — healthy spend, rising freq.
  const fatigueTarget = active.find(
    (p) => p !== doaTarget && (kindOf(p) === 'prospecting' || kindOf(p) === 'retargeting'),
  )
  if (fatigueTarget) {
    fatigueTarget.archetype = 'fatiguing'
    fatigueTarget.baseDailySpend = Math.max(fatigueTarget.baseDailySpend, 32)
    fatigueTarget.activeFrom = 0
    fatigueTarget.activeTo = WINDOW_DAYS - 1
    fatigueTarget.freq0 = 1.7
    fatigueTarget.freqSlope = 3.0
    fatigueTarget.volatility = 0.12
  }

  // 3) Sparse testing campaign → its ad sets fall into Learning Limited.
  const testCampaign = campaigns.find((c) => c.kind === 'testing')
  if (testCampaign) {
    const testSetIds = new Set(adSets.filter((s) => s.campaignId === testCampaign.id).map((s) => s.id))
    for (const s of adSets) if (testSetIds.has(s.id)) s.dailyBudget = Math.round(range(crng, 22, 38) / 2) * 2
    for (const p of plans) {
      if (testSetIds.has(p.ad.adSetId) && p.ad.status === 'ACTIVE') {
        p.baseDailySpend = Math.min(p.baseDailySpend, range(crng, 6, 9))
        if (p.archetype !== 'new') p.archetype = 'sleeper'
      }
    }
  }
}

function generateInsights(client: Client, plans: AdPlan[], dates: ISODate[]): Insight[] {
  // calibrate per-client base rates so CPA at "quality 1.0" lands near targetCPA
  const crng = rngFor('calib', client.id)
  const baseCPM = range(crng, 11, 22)
  const baseCTR = range(crng, 0.009, 0.016)
  // CPA = CPM / (1000 * CTR * CVR)  →  CVR = CPM / (1000 * targetCPA * CTR)
  const baseCVR = clamp(baseCPM / (1000 * client.targetCPA * baseCTR), 0.006, 0.075)
  const out: Insight[] = []

  for (const p of plans) {
    const tr = trends(p.archetype)
    const drng = rngFor('daily', p.ad.id)
    for (let i = 0; i < dates.length; i++) {
      if (i < p.activeFrom || i > p.activeTo) continue
      const date = dates[i]
      const t = i / (WINDOW_DAYS - 1)
      // weekly seasonality: weekends slightly cheaper traffic, mid-week stronger
      const dow = new Date(date + 'T00:00:00Z').getUTCDay()
      const season = 1 + (dow === 0 || dow === 6 ? -0.08 : 0.04) + 0.03 * Math.sin(i / 6)
      const jit = (s: number) => jitter(drng, s)

      const cpm = clamp(baseCPM * tr.cpm(t) * season * jit(p.volatility), 4, 60)
      const ctr = clamp(baseCTR * p.profile.ctrQuality * tr.ctr(t) * jit(p.volatility), 0.0018, 0.06)
      const cvr = clamp(baseCVR * p.profile.cvrQuality * tr.cvr(t) * jit(p.volatility * 0.8), 0.003, 0.09)

      const spend = Math.max(0, p.baseDailySpend * season * jit(p.volatility))
      if (spend < 1) continue
      const impressions = Math.round((spend / cpm) * 1000)
      if (impressions <= 0) continue
      const linkClicks = Math.round(impressions * ctr)
      const clicks = Math.round(linkClicks * range(drng, 1.2, 1.5))
      const purchases = poisson(drng, linkClicks * cvr)
      const aovDay = client.avgOrderValue * jit(0.18)
      const revenue = +(purchases * aovDay).toFixed(2)
      const addToCart = Math.round(purchases * range(drng, 2.6, 4.4) + linkClicks * 0.05)
      const landingPageViews = Math.round(linkClicks * range(drng, 0.72, 0.9))
      const frequency = clamp(p.freq0 + p.freqSlope * t + jitter(drng, 0.1) - 1, 1.02, 6.5)
      const reach = Math.max(1, Math.round(impressions / frequency))

      let videoPlays = 0
      let video3s = 0
      let videoThruplays = 0
      if (p.creative.format === 'video') {
        videoPlays = Math.round(impressions * range(drng, 0.88, 0.98))
        video3s = Math.round(impressions * clamp(p.profile.hookQuality * tr.ctr(t) * jit(0.1), 0.04, 0.55))
        videoThruplays = Math.round(video3s * clamp(p.profile.holdQuality * jit(0.1), 0.03, 0.6))
      }

      out.push({
        adId: p.ad.id,
        clientId: client.id,
        date,
        spend: +spend.toFixed(2),
        impressions,
        reach,
        clicks,
        linkClicks,
        purchases,
        revenue,
        addToCart,
        landingPageViews,
        videoPlays,
        video3s,
        videoThruplays,
      })
    }
  }
  return out
}

export function generateDataset(): Dataset {
  const dates = windowDates()
  const clients = CLIENTS
  const accounts: AdAccount[] = []
  const campaigns: Campaign[] = []
  const adSets: AdSet[] = []
  const ads: Ad[] = []
  const creatives: Creative[] = []
  const insights: Insight[] = []

  for (const client of clients) {
    const g = generateForClient(client)
    accounts.push(g.account)
    campaigns.push(...g.campaigns)
    adSets.push(...g.adSets)
    ads.push(...g.ads)
    creatives.push(...g.creatives)
    insights.push(...generateInsights(client, g.plans, dates))
  }

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

  // ---- derived statuses for ad sets / campaigns from recent volume ----
  const recent = new Set(dates.slice(-7))
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

  return {
    businessManagers: BUSINESS_MANAGERS,
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
