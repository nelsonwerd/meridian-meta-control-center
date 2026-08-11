import type {
  Ad,
  AdSet,
  AudienceSpec,
  AudienceType,
  BidStrategy,
  BusinessManager,
  Campaign,
  CampaignKind,
  CampaignObjective,
  Client,
  Creative,
  CreativeAngle,
  CreativeFormat,
  EntityStatus,
  Insight,
  ISODate,
  OptimizationGoal,
  PeriodKey,
} from '../types'
import { ANGLE_GRADIENTS } from '../demo/catalog'
import type { LiveAccountConfig } from './liveProvider'

/* ============================================================================
   liveMap — pure Graph→domain mapping for the live provider (P2's last-mile).

   Every function here is deterministic and unit-tested against realistic Graph
   fixtures. Where Meridian's domain model carries a concept Meta doesn't
   (campaign kind, audience type, creative angle/batch, thumbnail gradients),
   the mapping is an HONEST inference or synthesis — labelled here and in
   docs/LEDGER.md — chosen so the AI engine's gates read sane inputs rather
   than degenerate constants.
   ========================================================================== */

/* ------------------------------- raw shapes ------------------------------ */

export interface RawCampaign {
  id: string
  name?: string
  objective?: string
  effective_status?: string
  status?: string
  daily_budget?: string
  lifetime_budget?: string
  bid_strategy?: string
  smart_promotion_type?: string
  created_time?: string
}

export interface RawLearningStage {
  status?: string // LEARNING | SUCCESS | FAIL
}

export interface RawTargeting {
  age_min?: number
  age_max?: number
  genders?: number[]
  geo_locations?: { countries?: string[]; cities?: Array<{ name?: string }>; regions?: Array<{ name?: string }> }
  custom_audiences?: Array<{ id: string; name?: string }>
  interests?: Array<{ id: string; name?: string }>
  behaviors?: Array<{ id: string; name?: string }>
  flexible_spec?: Array<Record<string, Array<{ id: string; name?: string }>>>
  targeting_automation?: { advantage_audience?: number }
}

export interface RawAdSet {
  id: string
  name?: string
  campaign_id?: string
  effective_status?: string
  status?: string
  optimization_goal?: string
  billing_event?: string
  daily_budget?: string
  lifetime_budget?: string
  targeting?: RawTargeting
  learning_stage_info?: RawLearningStage
  created_time?: string
}

export interface RawAd {
  id: string
  name?: string
  adset_id?: string
  campaign_id?: string
  effective_status?: string
  status?: string
  creative?: { id?: string }
  created_time?: string
}

export interface RawCreative {
  id: string
  name?: string
  object_story_spec?: {
    link_data?: { name?: string; message?: string; child_attachments?: unknown[] }
    video_data?: { title?: string; message?: string; video_id?: string }
    photo_data?: { caption?: string }
    template_data?: Record<string, unknown>
  }
  asset_feed_spec?: {
    ad_formats?: string[]
    videos?: unknown[]
    titles?: Array<{ text?: string }>
    bodies?: Array<{ text?: string }>
  }
  object_story_id?: string
}

/* ------------------------------ status map ------------------------------- */

/** Meta effective_status → Meridian's 5-value EntityStatus.

    Lossy by design (the UI/engine reason in 5 states); chosen so the engine
    stays SAFE: anything not actually delivering normally maps to PAUSED or
    LEARNING, which the scale gate (requires ACTIVE) treats as do-not-scale.
    - PAUSED / CAMPAIGN_PAUSED / ADSET_PAUSED → PAUSED (inherited pauses count)
    - WITH_ISSUES / DISAPPROVED             → PAUSED (not delivering normally)
    - IN_PROCESS / PENDING_REVIEW / PREAPPROVED / PENDING_BILLING_INFO
                                            → LEARNING (not yet delivering)
    - ARCHIVED / DELETED                    → ARCHIVED (terminal)
    - ACTIVE                                → ACTIVE (learning refines below) */
export function normalizeStatus(effective: string | undefined, fallback: string | undefined): EntityStatus {
  const s = (effective || fallback || 'PAUSED').toUpperCase()
  switch (s) {
    case 'ACTIVE':
      return 'ACTIVE'
    case 'PAUSED':
    case 'CAMPAIGN_PAUSED':
    case 'ADSET_PAUSED':
    case 'WITH_ISSUES':
    case 'DISAPPROVED':
      return 'PAUSED'
    case 'ARCHIVED':
    case 'DELETED':
      return 'ARCHIVED'
    case 'IN_PROCESS':
    case 'PENDING_REVIEW':
    case 'PREAPPROVED':
    case 'PENDING_BILLING_INFO':
      return 'LEARNING'
    default:
      return 'PAUSED' // unknown → safe: engine will never scale it
  }
}

/** Ad-set learning refinement: Meta's learning phase lives ONLY on the ad set
 *  (learning_stage_info.status: LEARNING | SUCCESS | FAIL). FAIL is the API
 *  signal for "Learning Limited" — exactly the state Meridian's consolidation
 *  rule keys on. */
export function adSetStatus(raw: RawAdSet): EntityStatus {
  const base = normalizeStatus(raw.effective_status, raw.status)
  if (base !== 'ACTIVE') return base
  const learning = raw.learning_stage_info?.status?.toUpperCase()
  if (learning === 'LEARNING') return 'LEARNING'
  if (learning === 'FAIL') return 'LEARNING_LIMITED'
  return 'ACTIVE'
}

/** Ads inherit learning from their parent ad set (Meta has no ad-level learning
 *  field): an ACTIVE ad inside a LEARNING/LEARNING_LIMITED ad set reads as
 *  LEARNING — which keeps the engine's scale gate (status==='ACTIVE') honest. */
export function adStatus(raw: RawAd, parentStatus: EntityStatus | undefined): EntityStatus {
  const base = normalizeStatus(raw.effective_status, raw.status)
  if (base === 'ACTIVE' && (parentStatus === 'LEARNING' || parentStatus === 'LEARNING_LIMITED')) return 'LEARNING'
  return base
}

/* ------------------------------ objective -------------------------------- */

const LEGACY_OBJECTIVE: Record<string, CampaignObjective> = {
  BRAND_AWARENESS: 'OUTCOME_AWARENESS',
  REACH: 'OUTCOME_AWARENESS',
  LOCAL_AWARENESS: 'OUTCOME_AWARENESS',
  VIDEO_VIEWS: 'OUTCOME_ENGAGEMENT',
  POST_ENGAGEMENT: 'OUTCOME_ENGAGEMENT',
  PAGE_LIKES: 'OUTCOME_ENGAGEMENT',
  EVENT_RESPONSES: 'OUTCOME_ENGAGEMENT',
  MESSAGES: 'OUTCOME_ENGAGEMENT',
  LINK_CLICKS: 'OUTCOME_TRAFFIC',
  APP_INSTALLS: 'OUTCOME_APP_PROMOTION',
  LEAD_GENERATION: 'OUTCOME_LEADS',
  CONVERSIONS: 'OUTCOME_SALES',
  PRODUCT_CATALOG_SALES: 'OUTCOME_SALES',
}

const ODAX = new Set<CampaignObjective>([
  'OUTCOME_SALES',
  'OUTCOME_LEADS',
  'OUTCOME_TRAFFIC',
  'OUTCOME_AWARENESS',
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_APP_PROMOTION',
])

/** ODAX objectives pass through; legacy enums (still present on old campaigns)
 *  map per the research doc's table; unknown → OUTCOME_SALES (Meridian is a
 *  DTC orders tool — sales is the least-wrong default and is labelled). */
export function mapObjective(raw: string | undefined): CampaignObjective {
  const v = (raw || '').toUpperCase()
  if (ODAX.has(v as CampaignObjective)) return v as CampaignObjective
  return LEGACY_OBJECTIVE[v] ?? 'OUTCOME_SALES'
}

/* ----------------------------- campaign kind ----------------------------- */

/** Meridian's campaign kind is an agency concept, not a Graph field. Inference:
 *  smart_promotion_type marks Advantage+ shopping; otherwise the name (agency
 *  naming conventions are strong signals); prospecting is the default. */
export function inferCampaignKind(name: string | undefined, smartPromotionType: string | undefined): CampaignKind {
  if (smartPromotionType && /SMART_SHOPPING|AUTOMATED_SHOPPING/i.test(smartPromotionType)) return 'advantage_plus'
  const n = name ?? ''
  if (/\basc\b|advantage\+|advantage\s*plus|advantage\s*shopping/i.test(n)) return 'advantage_plus'
  if (/retarget|remarket|\brtg\b|\brmk\b|\bdpa\b|\bdaba\b|\brt\b[:\s—-]/i.test(n)) return 'retargeting'
  if (/\btest|creative\s*test|\bcbo\s*test|\babo\s*test/i.test(n)) return 'testing'
  return 'prospecting'
}

const BID_STRATEGIES = new Set<BidStrategy>([
  'LOWEST_COST_WITHOUT_CAP',
  'COST_CAP',
  'LOWEST_COST_WITH_BID_CAP',
  'LOWEST_COST_WITH_MIN_ROAS',
])

export function mapBidStrategy(raw: string | undefined): BidStrategy {
  const v = (raw || '').toUpperCase() as BidStrategy
  return BID_STRATEGIES.has(v) ? v : 'LOWEST_COST_WITHOUT_CAP'
}

/* ------------------------------- audience -------------------------------- */

/** Infer Meridian's AudienceSpec from the raw targeting spec. This gates the
 *  EXPAND_AUDIENCE rule (only interest/lookalike/retargeting qualify), so the
 *  inference is deliberately conservative: Advantage+ audience wins over any
 *  literal read of manual constraints (per Meta's own guidance). */
export function inferAudience(t: RawTargeting | undefined): AudienceSpec {
  if (!t) return { type: 'broad', label: 'Broad', sizeEstimate: 0 }
  if (t.targeting_automation?.advantage_audience === 1) {
    return { type: 'advantage', label: 'Advantage+ audience', sizeEstimate: 0 }
  }
  const cas = t.custom_audiences ?? []
  if (cas.length > 0) {
    const names = cas.map((c) => c.name ?? '').join(' ')
    const type: AudienceType = /\blal\b|lookalike|\blla\b/i.test(names) ? 'lookalike' : 'retargeting'
    return { type, label: cas[0].name ?? `${cas.length} custom audience(s)`, sizeEstimate: 0 }
  }
  const flexInterests = (t.flexible_spec ?? []).flatMap((b) => Object.values(b).flat())
  const interests = [...(t.interests ?? []), ...(t.behaviors ?? []), ...flexInterests]
  if (interests.length > 0) {
    const first = interests[0]?.name ?? 'Interests'
    const label = interests.length > 1 ? `${first} +${interests.length - 1}` : first
    return { type: 'interest', label, sizeEstimate: 0 }
  }
  const geo = (t.geo_locations?.countries ?? []).join(', ')
  const age = t.age_min || t.age_max ? ` · ${t.age_min ?? 18}–${t.age_max ?? 65}` : ''
  return { type: 'broad', label: geo ? `Broad — ${geo}${age}` : 'Broad', sizeEstimate: 0 }
}

/* ------------------------------- creatives ------------------------------- */

/** Format detection per the research doc: object_story_spec carries exactly one
 *  media block; asset_feed_spec (Advantage+/flexible) declares ad_formats. */
export function inferCreativeFormat(raw: RawCreative): CreativeFormat {
  const spec = raw.object_story_spec
  if (spec?.video_data) return 'video'
  if (spec?.link_data) {
    return (spec.link_data.child_attachments?.length ?? 0) >= 2 ? 'carousel' : 'image'
  }
  if (spec?.photo_data) return 'image'
  const afs = raw.asset_feed_spec
  if (afs) {
    if ((afs.ad_formats ?? []).some((f) => /CAROUSEL/i.test(f))) return 'carousel'
    if ((afs.videos?.length ?? 0) > 0) return 'video'
  }
  return 'image'
}

const ANGLE_PATTERNS: Array<[RegExp, CreativeAngle]> = [
  [/\bugc\b|testimonial|customer\s*review/i, 'UGC Testimonial'],
  [/founder|our\s*story|why\s*(i|we)\s*(started|made)/i, 'Founder Story'],
  [/problem|solution|struggling|tired\s*of|say\s*goodbye/i, 'Problem / Solution'],
  [/demo|how\s*it\s*works|in\s*action|tutorial/i, 'Product Demo'],
  [/\d+%\s*off|sale|promo|discount|offer|bogo|free\s*shipping|last\s*chance|deal/i, 'Offer / Promo'],
  [/\b\d+[\s,]*(five|5)[- ]star|reviews?\b|rated|loved\s*by|social\s*proof|press/i, 'Social Proof'],
  [/unbox/i, 'Unboxing'],
  [/before.{0,10}after|transformation|results\s*in/i, 'Before / After'],
  [/how\s*to|why\s*you|tips|guide|learn|myth|science|explained/i, 'Educational'],
]

/** Best-effort angle classification from creative name + copy. The angle feeds
 *  the Creative Lab cohorts and next-batch plan; a keyword miss lands in
 *  'Lifestyle' (the neutral bucket) rather than fabricating a signal. */
export function classifyAngle(text: string): CreativeAngle {
  for (const [re, angle] of ANGLE_PATTERNS) if (re.test(text)) return angle
  return 'Lifestyle'
}

/** Stable quarter label from a created date — the honest live analogue of the
 *  demo's test-batch labels, so batch cohorts group by production quarter. */
export function batchFromDate(iso: ISODate | undefined, fallback: ISODate): string {
  const d = (iso ?? fallback).slice(0, 10)
  const year = d.slice(0, 4)
  const q = Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1
  return `Q${q} ${year}`
}

/* ------------------------------ cosmetics -------------------------------- */

const ACCENTS = ['#f0abcb', '#5eead4', '#fbbf24', '#93c5fd', '#a78bfa', '#fb923c', '#4ade80', '#f87171', '#67e8f9', '#fde047']

/** Deterministic accent from an id — stable across reloads. */
export function accentFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

export function monogramFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const mono = (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '??').slice(0, 2)).toUpperCase()
  return mono
}

/** Fill the cosmetic/business fields every Avatar + screen dereferences, without
 *  overwriting anything the operator set in the live config. */
export function ensureClientCosmetics(c: Partial<Client> & { id: string; name: string }, anchor: ISODate, windowDays: number, currency: string): Client {
  return {
    id: c.id,
    name: c.name,
    bmId: c.bmId ?? '',
    // `||` (not `??`) for the cosmetic strings: operator configs commonly carry
    // empty strings from form inputs, which must synthesize, not render blank.
    vertical: c.vertical || 'DTC',
    accentColor: c.accentColor || accentFor(c.id),
    monogram: c.monogram || monogramFor(c.name),
    status: c.status ?? 'active',
    currency: c.currency || currency,
    monthlyBudget: c.monthlyBudget ?? 0,
    targetCPA: c.targetCPA ?? 50,
    targetROAS: c.targetROAS ?? 2,
    avgOrderValue: c.avgOrderValue ?? 60,
    contributionMargin: c.contributionMargin ?? 0.35,
    startDate: c.startDate ?? addDaysIso(anchor, -(windowDays - 1)),
  }
}

/** Pure UTC date arithmetic on ISO 'YYYY-MM-DD'. Exported: the live provider
 *  builds anchor-frame insight windows with it. */
export function addDaysIso(iso: ISODate, days: number): ISODate {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Every screen that lists clients groups them under a BusinessManager row —
 *  a client whose bmId matches nothing is INVISIBLE in the directory and the
 *  scope switcher. An empty businessId therefore lands in this fallback group
 *  instead of vanishing. */
export const UNMAPPED_BM_ID = 'unmapped'

/** Synthesize the BusinessManager rows the directory + scope switcher group by.
 *  LiveConfig carries a business id (+ optional name/type) per account. */
export function synthesizeBusinessManagers(accounts: LiveAccountConfig[]): BusinessManager[] {
  const seen = new Map<string, BusinessManager>()
  for (const a of accounts) {
    const id = a.businessId || UNMAPPED_BM_ID
    if (seen.has(id)) continue
    seen.set(id, {
      id,
      name: a.businessId ? (a.businessName ?? `Business ${a.businessId.slice(-4)}`) : 'Unmapped (set a business id)',
      type: a.businessType ?? 'agency',
      metaBusinessId: a.businessId,
    })
  }
  return [...seen.values()]
}

/* ------------------------------ entity maps ------------------------------ */

export interface MapContext {
  clientId: string
  accountId: string
  anchor: ISODate
  /** Minor-unit divisor for THIS account's currency (currencyOffset). Budgets
   *  come back from Graph in minor units — 5000 is $50.00 in USD but ¥5000 in
   *  JPY; dividing by a hardcoded 100 would inflate JPY-style budgets 100x. */
  currencyOffset: number
}

export function mapCampaign(raw: RawCampaign, ctx: MapContext): Campaign {
  // CBO-vs-ABO detection per the research doc: budget location IS the signal —
  // a campaign-level daily/lifetime budget means Advantage campaign budget
  // (CBO); absence means budgets live on the ad sets (ABO).
  const hasCampaignBudget = raw.daily_budget != null || raw.lifetime_budget != null
  const daily = raw.daily_budget != null ? Number(raw.daily_budget) / ctx.currencyOffset : null
  return {
    id: raw.id,
    clientId: ctx.clientId,
    accountId: ctx.accountId,
    name: raw.name ?? raw.id,
    objective: mapObjective(raw.objective),
    status: normalizeStatus(raw.effective_status, raw.status),
    budgetType: hasCampaignBudget ? 'CBO' : 'ABO',
    dailyBudget: daily,
    bidStrategy: mapBidStrategy(raw.bid_strategy),
    kind: inferCampaignKind(raw.name, raw.smart_promotion_type),
    createdAt: (raw.created_time ?? ctx.anchor).slice(0, 10),
  }
}

const OPT_GOALS = new Set<OptimizationGoal>(['OFFSITE_CONVERSIONS', 'VALUE', 'LINK_CLICKS', 'LANDING_PAGE_VIEWS'])

export function mapAdSet(raw: RawAdSet, ctx: MapContext): AdSet {
  const goal = (raw.optimization_goal || '').toUpperCase() as OptimizationGoal
  return {
    id: raw.id,
    campaignId: raw.campaign_id ?? '',
    clientId: ctx.clientId,
    name: raw.name ?? raw.id,
    status: adSetStatus(raw),
    optimizationGoal: OPT_GOALS.has(goal) ? goal : 'OFFSITE_CONVERSIONS',
    billingEvent: 'IMPRESSIONS',
    dailyBudget: raw.daily_budget != null ? Number(raw.daily_budget) / ctx.currencyOffset : null,
    audience: inferAudience(raw.targeting),
    createdAt: (raw.created_time ?? ctx.anchor).slice(0, 10),
  }
}

export function mapAd(raw: RawAd, parentStatus: EntityStatus | undefined, ctx: MapContext): Ad {
  return {
    id: raw.id,
    adSetId: raw.adset_id ?? '',
    campaignId: raw.campaign_id ?? '',
    clientId: ctx.clientId,
    name: raw.name ?? raw.id,
    status: adStatus(raw, parentStatus),
    creativeId: raw.creative?.id ?? '',
    createdAt: (raw.created_time ?? ctx.anchor).slice(0, 10),
  }
}

/** @param createdAtHint the earliest created_time of any ad referencing this
 *  creative — /adcreatives doesn't expose a creation date, and without a real
 *  date every creative would collapse into one batch cohort. */
export function mapCreative(raw: RawCreative, ctx: MapContext, createdAtHint?: ISODate): Creative {
  const spec = raw.object_story_spec
  const afs = raw.asset_feed_spec
  const format = inferCreativeFormat(raw)
  const headline =
    spec?.link_data?.name ?? spec?.video_data?.title ?? afs?.titles?.[0]?.text ?? raw.name ?? 'Untitled creative'
  const primaryText =
    spec?.link_data?.message ?? spec?.video_data?.message ?? spec?.photo_data?.caption ?? afs?.bodies?.[0]?.text ?? ''
  const angle = classifyAngle(`${raw.name ?? ''} ${headline} ${primaryText}`)
  const createdAt = (createdAtHint ?? ctx.anchor).slice(0, 10)
  return {
    id: raw.id,
    clientId: ctx.clientId,
    name: raw.name ?? headline,
    format,
    angle,
    // Reuse the demo's angle-keyed gradients: live thumbnails aren't fetched
    // (media URLs expire + CSP), so the placeholder visual stays consistent.
    thumbnailGradient: ANGLE_GRADIENTS[angle],
    ratio: format === 'video' ? '4:5' : '1:1',
    durationSec: undefined,
    headline,
    primaryText,
    batch: batchFromDate(createdAt, ctx.anchor),
    createdAt,
  }
}

/* --------------------------- period windows ------------------------------ */

export const PERIOD_KEY_LIST: PeriodKey[] = ['3d', '7d', '14d', '28d', 'prev7', 'prev14', 'full']

/** {since,until} for a canonical period against an explicit anchor — MUST
 *  mirror metrics.periodBounds() (which reads the app-level anchor) so the
 *  live pull's windows match the ranges the UI/engine request. */
export function periodBoundsFor(key: PeriodKey, anchor: ISODate, windowDays: number): { start: ISODate; end: ISODate } {
  const back = (n: number) => addDaysIso(anchor, -n)
  switch (key) {
    case '3d':
      return { start: back(2), end: anchor }
    case '7d':
      return { start: back(6), end: anchor }
    case '14d':
      return { start: back(13), end: anchor }
    case '28d':
      return { start: back(27), end: anchor }
    case 'prev7':
      return { start: back(13), end: back(7) }
    case 'prev14':
      return { start: back(27), end: back(14) }
    case 'full':
      return { start: back(windowDays - 1), end: anchor }
  }
}


/* ------------------------------- insights -------------------------------- */

// The standard conversion event. Configurable per account (LiveAccountConfig.
// purchaseActionType); pixel-only accounts fall back to the fct pixel action.
export const PURCHASE_ACTION = 'omni_purchase'
export const PURCHASE_ACTION_FALLBACK = 'offsite_conversion.fct.purchase'

/** Pull the additive action/value out of Meta's nested actions array. NB Graph
 *  returns numbers as strings; absent action_types are simply missing rows. */
export function actionVal(arr: { action_type: string; value: string }[] | undefined, type: string): number {
  return Number(arr?.find((a) => a.action_type === type)?.value ?? 0)
}

/** Raw daily insights row (level=ad, time_increment=1) → Meridian Insight.
 *  There is NO scalar purchases/revenue field on Graph — orders and revenue are
 *  extracted from the nested actions / action_values arrays by action_type.
 *  `purchaseAction` is per-account configurable; the pixel fallback only fires
 *  when the primary action_type is entirely absent (0), which avoids the
 *  double-count of summing overlapping purchase action_types. */
export function mapInsightRow(r: any, clientId: string, purchaseAction: string): Insight {
  return {
    adId: r.ad_id,
    clientId,
    date: r.date_start,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    reach: Number(r.reach ?? 0),
    clicks: Number(r.clicks ?? 0),
    linkClicks: Number(r.inline_link_clicks ?? 0),
    purchases: actionVal(r.actions, purchaseAction) || actionVal(r.actions, PURCHASE_ACTION_FALLBACK),
    revenue: actionVal(r.action_values, purchaseAction) || actionVal(r.action_values, PURCHASE_ACTION_FALLBACK),
    // omni_add_to_cart is the de-duplicated rollup; web-pixel accounts emit the
    // fct form, not bare 'add_to_cart' — a bare-only lookup reads 0 on live.
    addToCart:
      actionVal(r.actions, 'omni_add_to_cart') ||
      actionVal(r.actions, 'add_to_cart') ||
      actionVal(r.actions, 'offsite_conversion.fct.add_to_cart'),
    landingPageViews: actionVal(r.actions, 'landing_page_view'),
    videoPlays: actionVal(r.video_play_actions, 'video_view'),
    video3s: actionVal(r.video_3_sec_watched_actions, 'video_view'),
    videoThruplays: actionVal(r.video_thruplay_watched_actions, 'video_view'),
  }
}

/** Placeholder for an ad whose creative isn't in the /adcreatives page (rare —
 *  cross-account creatives, deleted-but-referenced). Keeps CreativeThumb and
 *  the cohort views total-safe instead of crashing on a missing lookup. */
export function placeholderCreative(creativeId: string, adName: string, ctx: MapContext): Creative {
  const angle = classifyAngle(adName)
  return {
    id: creativeId,
    clientId: ctx.clientId,
    name: adName || 'Unavailable creative',
    format: 'image',
    angle,
    thumbnailGradient: ANGLE_GRADIENTS[angle],
    ratio: '1:1',
    durationSec: undefined,
    headline: adName || 'Unavailable creative',
    primaryText: '',
    batch: batchFromDate(undefined, ctx.anchor),
    createdAt: ctx.anchor,
  }
}
