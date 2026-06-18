/* ============================================================================
   Meridian domain model
   Mirrors the Meta Marketing API object graph closely enough that the LiveProvider
   can map real Graph responses onto these types with minimal translation:
     BusinessManager → AdAccount → Campaign → AdSet → Ad → AdCreative
   Insight rows are stored at the AD/day grain (additive base facts only); every
   rate (CTR, CPA, ROAS, frequency, hook/hold rate) is DERIVED in metrics.ts so
   aggregation up the tree is always correct.
   ========================================================================== */

export type ISODate = string // 'YYYY-MM-DD'

export type EntityLevel = 'client' | 'account' | 'campaign' | 'adset' | 'ad'

/** A reference to any entity in the graph — used to open the entity-detail drawer
 *  (Wave 2) and to key per-entity history. */
export interface EntityRef {
  level: EntityLevel
  entityId: string
}

// 'agency' = a client living inside our agency's own Business Manager.
// 'partner' = a client on their OWN Business Manager that we access via partner
//             sharing / a system user. Both are first-class in Meridian.
export type BusinessManagerType = 'agency' | 'partner'

export interface BusinessManager {
  id: string
  name: string
  type: BusinessManagerType
  /** Graph: the BM id (business_id). */
  metaBusinessId: string
}

export type ClientStatus = 'active' | 'paused' | 'onboarding'

export interface Client {
  id: string
  name: string
  bmId: string
  vertical: string
  /** hex accent used for the client avatar + brand touches */
  accentColor: string
  monogram: string
  status: ClientStatus
  currency: string
  /** monthly media budget the client is contracted for */
  monthlyBudget: number
  /** the order CPA the buyer is optimizing toward (the north star) */
  targetCPA: number
  /** breakeven-aware ROAS target */
  targetROAS: number
  /** average order value baseline */
  avgOrderValue: number
  /** contribution margin (used to compute breakeven ROAS = 1 / margin) */
  contributionMargin: number
  startDate: ISODate
}

export interface AdAccount {
  id: string // act_<digits>
  clientId: string
  name: string
  currency: string
  timezone: string
  /** Meta's minor-unit multiplier for budgets (100 for USD, 1 for JPY, …). Sourced
   *  per-account from the Graph API in live mode; optional (demo doesn't set it). */
  currency_offset?: number
}

export type CampaignObjective =
  | 'OUTCOME_SALES'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_ENGAGEMENT'

export type BidStrategy =
  | 'LOWEST_COST_WITHOUT_CAP'
  | 'COST_CAP'
  | 'LOWEST_COST_WITH_BID_CAP'
  | 'LOWEST_COST_WITH_MIN_ROAS'

// Meta surfaces delivery state; we fold the learning phase into the same enum
// because buyers reason about "is this learning-limited?" as a status.
export type EntityStatus = 'ACTIVE' | 'PAUSED' | 'LEARNING' | 'LEARNING_LIMITED' | 'ARCHIVED'

export type CampaignKind = 'advantage_plus' | 'prospecting' | 'retargeting' | 'testing'

export interface Campaign {
  id: string
  clientId: string
  accountId: string
  name: string
  objective: CampaignObjective
  status: EntityStatus
  /** CBO (Advantage+ campaign budget) vs ABO (budget at the ad set) */
  budgetType: 'CBO' | 'ABO'
  /** set when CBO; null when ABO (budget lives on ad sets) */
  dailyBudget: number | null
  bidStrategy: BidStrategy
  kind: CampaignKind
  createdAt: ISODate
}

export type AudienceType = 'broad' | 'interest' | 'lookalike' | 'retargeting' | 'advantage'

export interface AudienceSpec {
  type: AudienceType
  label: string
  sizeEstimate: number
}

export type OptimizationGoal =
  | 'OFFSITE_CONVERSIONS'
  | 'VALUE'
  | 'LINK_CLICKS'
  | 'LANDING_PAGE_VIEWS'

export interface AdSet {
  id: string
  campaignId: string
  clientId: string
  name: string
  status: EntityStatus
  optimizationGoal: OptimizationGoal
  billingEvent: 'IMPRESSIONS'
  /** set when the parent campaign is ABO; null under CBO */
  dailyBudget: number | null
  audience: AudienceSpec
  createdAt: ISODate
}

export type CreativeFormat = 'image' | 'video' | 'carousel'

export type CreativeAngle =
  | 'UGC Testimonial'
  | 'Founder Story'
  | 'Problem / Solution'
  | 'Product Demo'
  | 'Offer / Promo'
  | 'Social Proof'
  | 'Unboxing'
  | 'Before / After'
  | 'Educational'
  | 'Lifestyle'

export type CreativeRatio = '1:1' | '4:5' | '9:16'

export interface Creative {
  id: string
  clientId: string
  name: string
  format: CreativeFormat
  angle: CreativeAngle
  /** demo-only: two hex stops used to render a placeholder thumbnail */
  thumbnailGradient: [string, string]
  ratio: CreativeRatio
  /** present for video format */
  durationSec?: number
  headline: string
  primaryText: string
  /** test-batch label so we can group "next batch" recommendations */
  batch: string
  createdAt: ISODate
}

export interface Ad {
  id: string
  adSetId: string
  campaignId: string
  clientId: string
  name: string
  status: EntityStatus
  creativeId: string
  createdAt: ISODate
}

/**
 * One ad's metrics for one day. Stores ADDITIVE base facts only — every rate is
 * computed in metrics.ts. This guarantees correct roll-ups to ad set / campaign
 * / client / portfolio and across any date range.
 */
export interface Insight {
  adId: string
  clientId: string
  date: ISODate
  spend: number
  impressions: number
  /** approximate unique reach (additive approximation for demo aggregation) */
  reach: number
  clicks: number
  linkClicks: number
  /** orders (Graph: actions[action_type=purchase]) */
  purchases: number
  /** purchase conversion value (Graph: action_values[purchase]) */
  revenue: number
  /** add-to-cart events, for funnel diagnosis */
  addToCart: number
  /** landing page views, for funnel diagnosis */
  landingPageViews: number
  // ---- video-only (0 for image/carousel) ----
  videoPlays: number
  /** 3-second video plays → hook rate numerator */
  video3s: number
  /** thruplays (15s or complete) → hold rate numerator */
  videoThruplays: number
}

/* ----- Derived / computed shapes (produced by metrics.ts, not stored) ----- */

/** A fully-derived KPI bundle for any entity over any window. */
export interface MetricsBundle {
  spend: number
  impressions: number
  reach: number
  clicks: number
  linkClicks: number
  purchases: number
  revenue: number
  addToCart: number
  landingPageViews: number
  videoPlays: number
  video3s: number
  videoThruplays: number
  // derived rates
  ctr: number // link CTR %
  cpc: number
  cpm: number
  cpa: number // cost per purchase
  roas: number
  aov: number
  frequency: number
  cvr: number // purchases / linkClicks %
  hookRate: number // video3s / impressions %
  holdRate: number // thruplays / video3s %
}

export interface TimeseriesPoint extends MetricsBundle {
  date: ISODate
}

/** A KPI value plus its period-over-period delta. */
export interface KpiDelta {
  value: number
  prevValue: number
  /** absolute change */
  delta: number
  /** percent change (0.12 = +12%) */
  deltaPct: number
  /** whether an increase is good for this KPI (CPA up is bad) */
  higherIsBetter: boolean
  /** volume/context metric where a change has no inherent good/bad (e.g. spend) */
  neutral: boolean
  /** no prior-period baseline (prev === 0, current !== 0) — render "new", not +100% */
  isNew: boolean
}

/* ----- AI engine output shapes ----- */

export type SuggestionType =
  | 'SCALE_BUDGET'
  | 'CUT_BUDGET'
  | 'PAUSE_ENTITY'
  | 'CREATIVE_FATIGUE'
  | 'CONSOLIDATE_ADSETS'
  | 'REALLOCATE_SPEND'
  | 'NEW_CREATIVE_ANGLE'
  | 'FIX_LANDING_OFFER'
  | 'EXPAND_AUDIENCE'
  | 'PACING_ALERT'
  | 'ANOMALY'
  | 'WATCH'

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export type ActionKind =
  | 'increase_budget'
  | 'decrease_budget'
  | 'pause'
  | 'activate'
  | 'duplicate'
  | 'consolidate'
  | 'brief_creative'
  | 'none'

export interface SuggestedAction {
  kind: ActionKind
  label: string
  /** for budget actions: the proposed new daily budget */
  targetEntityId: string
  targetLevel: EntityLevel
  currentBudget?: number
  proposedBudget?: number
}

export interface ProjectedImpact {
  /** human label e.g. "+Orders" */
  metric: string
  /** INTERNAL directional magnitude, not rendered to users (the card shows
   *  `metric` + `note`). Kept for sorting/ranking heuristics only. */
  change: number
  /** optional secondary, e.g. estimated extra orders / month */
  note?: string
}

export interface Suggestion {
  id: string
  clientId: string
  type: SuggestionType
  severity: Severity
  level: EntityLevel
  entityId: string
  entityName: string
  title: string
  /** plain-English, data-backed rationale */
  rationale: string
  /** the specific numbers that triggered it */
  evidence: string[]
  projectedImpact: ProjectedImpact
  /** 0..1 */
  confidence: number
  /** rough $/day at stake — used for the "by impact" sort on the feed */
  impactScore: number
  action: SuggestedAction
  createdAt: ISODate
}

/* ----- Creative analysis ----- */

export interface CreativePerformance {
  creative: Creative
  metrics: MetricsBundle
  /** which adIds use this creative */
  adIds: string[]
  /** funnel diagnosis label */
  diagnosis: 'winner' | 'hook_weak' | 'body_weak' | 'convert_weak' | 'fatigued' | 'unproven' | 'steady'
  diagnosisDetail: string
  /** percentile of CPA vs the client's other creatives (0 best) */
  cpaPercentile: number
}

export interface CreativeCohort {
  key: string
  label: string
  count: number
  metrics: MetricsBundle
}

/* ----- Weekly report ----- */

export interface WeeklyReport {
  clientId: string
  weekStart: ISODate
  weekEnd: ISODate
  headline: string
  /** overall sentiment of the week, aligned to the headline — drives the digest
   *  icon so it can never disagree with the prose. */
  direction: 'positive' | 'caution' | 'neutral'
  summary: string
  current: MetricsBundle
  previous: MetricsBundle
  kpis: Record<string, KpiDelta>
  topMovers: { label: string; detail: string; direction: 'up' | 'down' }[]
  creativeLeaderboard: CreativePerformance[]
  recommendations: Suggestion[]
  pacing: { spent: number; budget: number; pace: number; projection: number }
}

/* ----- Date range ----- */

export type RangePreset = 'today' | 'yesterday' | '7d' | '14d' | '28d' | 'mtd' | 'custom'

export interface DateRange {
  preset: RangePreset
  start: ISODate
  end: ISODate
  label: string
}

/** A selectable scope: the whole portfolio, a BM, or a single client. */
export type Scope =
  | { kind: 'portfolio' }
  | { kind: 'bm'; bmId: string }
  | { kind: 'client'; clientId: string }
