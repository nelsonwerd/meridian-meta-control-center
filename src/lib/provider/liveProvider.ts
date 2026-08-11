import type {
  Ad,
  AdAccount,
  AdSet,
  Campaign,
  Client,
  Creative,
  Insight,
} from '../types'
import type { ActionRequest, ActionResult, DataProvider, Snapshot } from './types'
import { assembleDataset } from '../dataset/assemble'
import {
  addDaysIso,
  ensureClientCosmetics,
  mapAd,
  mapAdSet,
  mapCampaign,
  mapCreative,
  mapInsightRow,
  periodBoundsFor,
  placeholderCreative,
  synthesizeBusinessManagers,
  PERIOD_KEY_LIST,
  PURCHASE_ACTION,
  UNMAPPED_BM_ID,
  type RawAd,
  type RawAdSet,
  type RawCampaign,
  type RawCreative,
} from './liveMap'
import type { PeriodKey } from '../types'

// Re-exported for existing importers (Settings, tests).
export { PURCHASE_ACTION, PURCHASE_ACTION_FALLBACK, actionVal } from './liveMap'

/* ============================================================================
   LiveProvider — Meta (Facebook) Marketing API client (Graph v26, via the
   backend token proxy).

   Implemented end-to-end (2026-08-11): structure pull → domain mapping →
   daily + true-period-reach insights → shared assembly, plus guarded writes.
   Without a saved config it throws NotConfigured (Demo stays the default);
   with one, everything routes through server/proxy.mjs — the browser never
   holds a token. Machine-verified against a faked Graph in tests; the real-
   credential checks are 🚪 human gates (docs/LEDGER.md, META_INTEGRATION.md).
   ========================================================================== */

/** All Graph traffic goes through the backend token proxy (server/proxy.mjs) —
 *  the browser NEVER holds a Meta token. Default is the same-origin proxy mount;
 *  override via VITE_GRAPH_BASE only for tests/unusual deployments. */
const GRAPH_BASE: string = (import.meta.env?.VITE_GRAPH_BASE as string | undefined) ?? '/api/meta'
// v26.0 GA 2026-07-29. Verified 2026-08-11: the v26 changes (Commerce endpoint
// blocks, IG Explore placement, Messenger Stories strip) do not touch Meridian's
// surface (campaign/adset/ad/adcreative reads, /insights, status/budget writes).
// Marketing API versions live ~12 months — v25.0 would sunset ~Feb 2027.
export const API_VERSION = 'v26.0'

/** Resolve GRAPH_BASE to an absolute URL base (relative proxy mounts resolve
 *  against the page origin; node test env falls back to localhost). */
function apiBase(): string {
  if (GRAPH_BASE.startsWith('http')) return GRAPH_BASE
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  return origin + GRAPH_BASE
}

/** The Insights fields required to derive every Meridian KPI. NB: there is no
 *  scalar purchases/revenue field — orders, revenue, CPA & ROAS are all pulled
 *  out of the nested actions/action_values/purchase_roas arrays by action_type. */
export const INSIGHT_FIELDS = [
  'date_start',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'inline_link_clicks',
  'actions', // purchase, add_to_cart, landing_page_view live here
  'action_values', // purchase value → revenue
  'video_play_actions',
  'video_3_sec_watched_actions',
  'video_thruplay_watched_actions',
  // NB deliberately NOT requested (mapInsightRow never reads them; insights CPU
  // is billed per field): frequency, outbound_clicks, purchase_roas,
  // cost_per_action_type. Rates are derived app-side from additive facts.
].join(',')

/** Per-client account mapping + the token that can read/write it. An agency BM's
 *  clients share one system-user token; client-owned BMs (partner access) each
 *  carry their own. */
export interface LiveAccountConfig {
  clientId: string
  adAccountId: string // act_<id>
  /** Routed to the proxy via X-Meta-Business-Id so partner BMs with their own
   *  tokens (META_TOKENS) resolve server-side. */
  businessId: string
  /** Display name + type for the synthesized BusinessManager row (the client
   *  directory and scope switcher group by BM). */
  businessName?: string
  businessType?: 'agency' | 'partner'
  /** The purchase action_type this account attributes orders to. Default
   *  omni_purchase (web+app+offline de-duplicated — matches Ads Manager most
   *  often); pixel-only accounts may use offsite_conversion.fct.purchase. */
  purchaseActionType?: string
  /** @deprecated tokens live ONLY server-side (proxy env). Never read; kept so
   *  older persisted configs still parse. */
  accessToken?: string
}

export interface LiveConfig {
  /** @deprecated tokens live ONLY server-side (proxy env). Never read; kept so
   *  older persisted configs still parse. */
  defaultAccessToken?: string
  accounts: LiveAccountConfig[]
  /** clients metadata (targets etc.) the API doesn't carry — set in Settings */
  clients: Client[]
  windowDays: number
}

const LIVE_CONFIG_KEY = 'meridian.live.config'

export function loadLiveConfig(): LiveConfig | null {
  try {
    const raw = localStorage.getItem(LIVE_CONFIG_KEY)
    return raw ? (JSON.parse(raw) as LiveConfig) : null
  } catch {
    return null
  }
}

export function saveLiveConfig(cfg: LiveConfig) {
  localStorage.setItem(LIVE_CONFIG_KEY, JSON.stringify(cfg))
}

class NotConfiguredError extends Error {
  constructor() {
    super('Live mode is not configured. Map ad accounts in Settings and supply a Meta system-user token (server-side).')
    this.name = 'NotConfiguredError'
  }
}

interface GraphPage<T> {
  data: T[]
  paging?: { cursors?: { after?: string }; next?: string }
}

// Safety ceiling well above any realistic page count. Critically, if the cursor
// is still valid at the ceiling we THROW rather than silently returning a partial
// array — a silent truncation would understate summed KPIs (spend/orders/revenue).
const MAX_PAGES = 1000

/** Meta's X-Business-Use-Case-Usage rate-limit telemetry (the fields we act on). */
interface BucUsage {
  callCount: number
  totalCpuTime: number
  estimatedTimeToRegainAccess: number
}

function parseBuc(res: Response): BucUsage | null {
  const raw = res.headers.get('x-business-use-case-usage')
  if (!raw) return null
  try {
    // Scan EVERY bucket (ads_management and ads_insights throttle separately) —
    // reading only the first entry would miss the insights bucket entirely.
    const entries = Object.values(JSON.parse(raw) as Record<string, Array<Record<string, number>>>).flat()
    if (entries.length === 0) return null
    const out: BucUsage = { callCount: 0, totalCpuTime: 0, estimatedTimeToRegainAccess: 0 }
    for (const e of entries) {
      out.callCount = Math.max(out.callCount, e.call_count ?? 0)
      out.totalCpuTime = Math.max(out.totalCpuTime, e.total_cputime ?? 0, e.total_time ?? 0)
      out.estimatedTimeToRegainAccess = Math.max(out.estimatedTimeToRegainAccess, e.estimated_time_to_regain_access ?? 0)
    }
    return out
  } catch {
    return null
  }
}

function buildUrl(path: string, params: Record<string, string>, extra: Record<string, string> = {}): string {
  // NO access_token here — the proxy injects it server-side. A token in this
  // query string would be a security regression (and the proxy rejects it).
  const url = new URL(`${apiBase()}/${API_VERSION}/${path}`)
  Object.entries({ ...params, ...extra }).forEach(([k, v]) => url.searchParams.set(k, v))
  return url.toString()
}

/** Per-request headers: business-id routing (the proxy maps it → its token
 *  via META_TOKENS) + the CSRF guard header the proxy requires on /api/*
 *  (a custom header forces a CORS preflight, blocking drive-by cross-origin
 *  requests at localhost). */
function routingHeaders(businessId?: string): Record<string, string> {
  return { 'X-Meridian-Client': '1', ...(businessId ? { 'X-Meta-Business-Id': businessId } : {}) }
}

// Single fetch with throttle handling. The proxy owns the real BUC backoff;
// this browser-side pass is a second seatbelt. Retries ONLY on 429 — a 200
// whose BUC usage is high is still a good response and must never be
// discarded and refetched (that would amplify call volume exactly when Meta
// asks for less). High-usage 200s instead pace the NEXT call.
let pacePauseMs = 0
async function graphFetch(url: string, businessId?: string, attempt = 0): Promise<Response> {
  if (pacePauseMs > 0) {
    const wait = pacePauseMs
    pacePauseMs = 0
    await new Promise((r) => setTimeout(r, wait))
  }
  const res = await fetch(url, { headers: routingHeaders(businessId) })
  const buc = parseBuc(res)
  if (res.status === 429 && attempt < 3) {
    // regain hint is in MINUTES per Meta's rate-limit docs; cap the wait
    const waitMs = buc?.estimatedTimeToRegainAccess ? Math.min(buc.estimatedTimeToRegainAccess * 60_000, 8000) : Math.min(2 ** attempt * 1000, 8000)
    await new Promise((r) => setTimeout(r, waitMs))
    return graphFetch(url, businessId, attempt + 1)
  }
  if (res.ok && buc != null && (buc.callCount >= 95 || buc.totalCpuTime >= 95)) {
    pacePauseMs = 2000 // slow the next call; keep THIS response
  }
  return res
}

/** Paginated EDGE read (returns the full data[] across pages). */
async function graphGet<T>(path: string, params: Record<string, string>, businessId?: string): Promise<T[]> {
  const out: T[] = []
  let after: string | undefined
  let pages = 0
  do {
    const res = await graphFetch(buildUrl(path, params, { limit: '200', ...(after ? { after } : {}) }), businessId)
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Graph ${res.status}: ${body.slice(0, 300)}`)
    }
    const page = (await res.json()) as GraphPage<T>
    out.push(...(page.data ?? []))
    after = page.paging?.cursors?.after && page.paging?.next ? page.paging.cursors.after : undefined
    if (after && ++pages >= MAX_PAGES) {
      throw new Error(
        `graphGet exceeded ${MAX_PAGES} pages for ${path}; more data remained — narrow the time_range or use async insight report jobs (see docs/META_INTEGRATION.md §3).`,
      )
    }
  } while (after)
  return out
}

/** Single NODE read (an object, not an edge — no pagination). Throws if the node
 *  is missing/errored so callers can't read a false success from an empty edge. */
async function graphGetNode<T>(path: string, params: Record<string, string>, businessId?: string): Promise<T> {
  const res = await graphFetch(buildUrl(path, params), businessId)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Graph ${res.status}: ${body.slice(0, 300)}`)
  }
  const node = (await res.json()) as T & { error?: unknown }
  if (!node || typeof node !== 'object' || node.error) {
    throw new Error(`Graph node ${path} returned no object.`)
  }
  return node
}

/* ---------------------------------------------------------------------------
   Async insight report jobs — for pulls a synchronous GET would time out on
   (long windows × many ads). Flow per Meta's best-practices doc (verified
   2026-08-11):
     POST /act_{id}/insights (same params)      → { report_run_id }
     GET  /{report_run_id}                      → poll async_status
     GET  /{report_run_id}/insights             → the rows (paginated)
   CRITICAL: gate on async_status === 'Job Completed' — NOT on
   async_percent_completion, which can read 100 while the job is still
   'Job Running'. 'Job Failed'/'Job Skipped' → throw with guidance (narrow the
   window and retry). report_run_id expires after ~30 days — never persisted.
   ------------------------------------------------------------------------- */

/** Sync pulls comfortably handle a ~2-month window at daily ad grain; beyond
 *  that we submit an async report job instead. (windowDays is floored at 56,
 *  so the floor stays on the sync path and the 90-day default goes async.) */
export const ASYNC_INSIGHTS_THRESHOLD_DAYS = 60

export interface AsyncJobOpts {
  /** initial poll delay; grows ×1.5 capped at 12× base (tests use ~1ms) */
  baseDelayMs?: number
  maxPolls?: number
}

interface ReportRun {
  async_status?: string
  async_percent_completion?: number
}

/** POST via the proxy (form-encoded, no token — the proxy injects it). */
async function graphPost<T>(path: string, form: Record<string, string>, businessId?: string): Promise<T> {
  const res = await fetch(`${apiBase()}/${API_VERSION}/${path}`, {
    method: 'POST',
    body: new URLSearchParams(form),
    headers: routingHeaders(businessId),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Graph POST ${path} ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as T
}

export async function runAsyncInsightsJob<T>(
  actId: string,
  params: Record<string, string>,
  businessId?: string,
  opts: AsyncJobOpts = {},
): Promise<T[]> {
  const baseDelay = opts.baseDelayMs ?? 5000
  const maxPolls = opts.maxPolls ?? 60
  const { report_run_id } = await graphPost<{ report_run_id?: string }>(`${actId}/insights`, params, businessId)
  if (!report_run_id) throw new Error('Async insights job returned no report_run_id.')

  let delay = baseDelay
  for (let poll = 0; poll < maxPolls; poll++) {
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(delay * 1.5, baseDelay * 12)
    const run = await graphGetNode<ReportRun>(report_run_id, { fields: 'async_status,async_percent_completion' }, businessId)
    const status = run.async_status ?? ''
    if (status === 'Job Completed') {
      return graphGet<T>(`${report_run_id}/insights`, {}, businessId)
    }
    if (status === 'Job Failed' || status === 'Job Skipped') {
      throw new Error(
        `Async insights job ${status.toLowerCase()} for ${actId} — narrow the time_range (or split by date) and retry.`,
      )
    }
    // 'Job Not Started' | 'Job Started' | 'Job Running' → keep polling.
    // NB: async_percent_completion can read 100 while still 'Job Running' —
    // completion is ONLY the status string.
  }
  throw new Error(`Async insights job for ${actId} did not complete after ${maxPolls} polls — try a narrower window.`)
}

export class LiveProvider implements DataProvider {
  readonly mode = 'live' as const
  constructor(
    private cfg: LiveConfig | null = loadLiveConfig(),
    /** poll pacing for async insight jobs — injectable so tests run in ms */
    private asyncOpts: AsyncJobOpts = {},
  ) {}

  async checkConnection() {
    if (!this.cfg || this.cfg.accounts.length === 0) return { ok: false, detail: 'No accounts configured.' }
    const first = this.cfg.accounts[0]
    try {
      // A node GET (not the edge-shaped graphGet, which would parse data[] off a
      // node response and report a false success). Assert we actually got the account.
      const node = await graphGetNode<{ name?: string; account_status?: number }>(
        first.adAccountId,
        { fields: 'name,currency,account_status' },
        first.businessId,
      )
      if (!node.name) throw new Error('account node returned no name — the token may lack access to this ad account')
      return { ok: true, detail: `Connected to ${node.name}. ${this.cfg.accounts.length} ad account(s) mapped.` }
    } catch (e) {
      return { ok: false, detail: `Connection failed: ${(e as Error).message}` }
    }
  }

  async loadSnapshot(): Promise<Snapshot> {
    if (!this.cfg || this.cfg.accounts.length === 0) throw new NotConfiguredError()
    const cfg = this.cfg
    // Floor the history window at 56 days: the app's DEFAULT view is the 28d
    // preset, and its previous-period delta window reaches back to day 56. A
    // shorter pull would silently understate frequency (28d true reach over
    // fewer days of impressions), fabricate +1300%-style deltas against a
    // 2-day previous window, understate month pacing (false under-pacing
    // suggestions), and starve the fatigue rule's prev-14d baseline.
    const windowDays = Math.max(56, cfg.windowDays)
    const accounts: AdAccount[] = []
    const campaigns: Campaign[] = []
    const adSets: AdSet[] = []
    const ads: Ad[] = []
    const creatives: Creative[] = []
    const insights: Insight[] = []

    // The app's "now": today in the FIRST account's timezone (the primary
    // account anchors the whole snapshot; per-account insights windows still
    // use each account's own tz below).
    let anchor: string | null = null
    const periodReachByAd = new Map<string, Partial<Record<PeriodKey, number>>>()

    for (const acct of cfg.accounts) {
      // Node read (not the edge-shaped graphGet) so we actually get the account
      // object + the account timezone. NB: currency_offset is NOT a field on the
      // AdAccount node (verified 2026-08-11 vs the ad-account reference) — the
      // minor-unit offset is derived from `currency` via currencyOffset() (the
      // per-currency rule from developers.facebook.com/docs/marketing-api/currencies).
      const acctNode = await graphGetNode<{ name?: string; currency?: string; timezone_name?: string }>(
        acct.adAccountId,
        { fields: 'name,currency,timezone_name' },
        acct.businessId,
      )
      const timezone = acctNode.timezone_name ?? 'America/New_York'
      const currency = acctNode.currency ?? 'USD'
      const offset = currencyOffset(currency)
      accounts.push({
        id: acct.adAccountId,
        clientId: acct.clientId,
        name: acctNode.name ?? acct.adAccountId,
        currency,
        timezone,
        currency_offset: offset,
      })
      if (!anchor) anchor = isoDaysAgoInTz(timezone, 0)
      const ctx = { clientId: acct.clientId, accountId: acct.adAccountId, anchor, currencyOffset: offset }

      // ---- structure: campaigns → ad sets → ads → creatives ----
      // effective_status (not bare status) is what tells the truth about
      // delivery — bare status can read ACTIVE inside a paused campaign.
      const rawCampaigns = await graphGet<RawCampaign>(
        `${acct.adAccountId}/campaigns`,
        { fields: 'name,objective,status,effective_status,daily_budget,lifetime_budget,bid_strategy,smart_promotion_type,created_time' },
        acct.businessId,
      )
      const rawAdSets = await graphGet<RawAdSet>(
        `${acct.adAccountId}/adsets`,
        { fields: 'name,campaign_id,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,targeting,learning_stage_info,created_time' },
        acct.businessId,
      )
      const rawAds = await graphGet<RawAd>(
        `${acct.adAccountId}/ads`,
        { fields: 'name,adset_id,campaign_id,status,effective_status,creative{id},created_time' },
        acct.businessId,
      )
      const rawCreatives = await graphGet<RawCreative>(
        `${acct.adAccountId}/adcreatives`,
        { fields: 'name,object_story_spec,asset_feed_spec,object_story_id' },
        acct.businessId,
      )

      const mappedCampaigns = rawCampaigns.map((r) => mapCampaign(r, ctx))
      const mappedAdSets = rawAdSets.map((r) => mapAdSet(r, ctx))
      const adSetStatusById = new Map(mappedAdSets.map((s) => [s.id, s.status]))
      const mappedAds = rawAds.map((r) => mapAd(r, adSetStatusById.get(r.adset_id ?? ''), ctx))

      // Referential integrity for PARENTS: an ad can reference a campaign/ad
      // set outside the pulled set (list-edge filtering asymmetries). Every
      // screen and the engine deref campaignById/adSetById on these ids —
      // synthesize an ARCHIVED shell rather than shipping a dangling ref.
      const campaignIds = new Set(mappedCampaigns.map((c) => c.id))
      const adSetIds = new Set(mappedAdSets.map((s) => s.id))
      for (const ad of mappedAds) {
        if (ad.campaignId && !campaignIds.has(ad.campaignId)) {
          campaignIds.add(ad.campaignId)
          mappedCampaigns.push(mapCampaign({ id: ad.campaignId, name: '(campaign outside pulled set)', effective_status: 'ARCHIVED' }, ctx))
        }
        if (ad.adSetId && !adSetIds.has(ad.adSetId)) {
          adSetIds.add(ad.adSetId)
          mappedAdSets.push(mapAdSet({ id: ad.adSetId, campaign_id: ad.campaignId, name: '(ad set outside pulled set)', effective_status: 'ARCHIVED' }, ctx))
        }
      }

      // Earliest referencing-ad date per creative — /adcreatives has no created
      // date, and a real date is what keeps the batch cohorts meaningful.
      const earliestAdByCreative = new Map<string, string>()
      for (const ad of mappedAds) {
        if (!ad.creativeId) continue
        const prev = earliestAdByCreative.get(ad.creativeId)
        if (!prev || ad.createdAt < prev) earliestAdByCreative.set(ad.creativeId, ad.createdAt)
      }
      const mappedCreatives = rawCreatives.map((r) => mapCreative(r, ctx, earliestAdByCreative.get(r.id)))
      const creativeIds = new Set(mappedCreatives.map((c) => c.id))
      // Ads can reference creatives the /adcreatives page didn't return —
      // synthesize placeholders so CreativeThumb/cohort lookups never crash.
      for (const ad of mappedAds) {
        if (ad.creativeId && !creativeIds.has(ad.creativeId)) {
          creativeIds.add(ad.creativeId)
          mappedCreatives.push(placeholderCreative(ad.creativeId, ad.name, ctx))
        }
      }

      campaigns.push(...mappedCampaigns)
      adSets.push(...mappedAdSets)
      ads.push(...mappedAds)
      creatives.push(...mappedCreatives)

      // ---- insights: daily ad-grain rows over the configured window ----
      // Window in the ANCHOR's date frame (first account's tz), widened one day
      // on each edge. Meta interprets time_range dates in each ACCOUNT's tz, so
      // for a tz-shifted account the anchor-frame dates land one local day off —
      // the buffer guarantees every date the app can request
      // ([anchor-(windowDays-1), anchor]) has rows regardless of the account's
      // timezone, and app-side filterByRange trims the extra edge days.
      const since = addDaysIso(anchor, -windowDays) // windowDays-1 back, +1 buffer
      const until = addDaysIso(anchor, 1) // anchor, +1 buffer (future dates return no rows)
      const purchaseAction = acct.purchaseActionType || PURCHASE_ACTION
      // Attribution: we request NO custom action_attribution_windows — the
      // default (7d-click + 1d-view) is what Ads Manager reports, and since
      // 2025-06-10 Meta disregards the unified-attribution override params
      // anyway. (7d_view/28d_view were removed 2026-01-12 and would return
      // empty silently — never request them.)
      const insightParams = {
        level: 'ad',
        time_increment: '1',
        fields: `ad_id,${INSIGHT_FIELDS}`,
        time_range: JSON.stringify({ since, until }),
      }
      // Long windows go through an async report job (a sync GET would time
      // out); short pulls stay on the paginated sync path.
      const adRows =
        windowDays > ASYNC_INSIGHTS_THRESHOLD_DAYS
          ? await runAsyncInsightsJob<any>(acct.adAccountId, insightParams, acct.businessId, this.asyncOpts)
          : await graphGet<any>(`${acct.adAccountId}/insights`, insightParams, acct.businessId)
      for (const r of adRows) {
        insights.push(mapInsightRow(r, acct.clientId, purchaseAction))
      }

      // Ads DELETED mid-window still have insight rows, but the /ads list edge
      // excludes them by default — orphaned rows would be silently dropped by
      // the ad-id join and every roll-up would understate spend/orders vs Ads
      // Manager. Synthesize an ARCHIVED shell ad per orphan so client/portfolio
      // totals stay truthful (they carry no campaign/ad-set parent — campaign
      // drill-downs, like Meta's own campaign view, exclude removed ads).
      const knownAdIds = new Set(mappedAds.map((a) => a.id))
      const orphanIds = new Set<string>()
      for (const r of adRows) {
        if (r.ad_id && !knownAdIds.has(r.ad_id)) orphanIds.add(r.ad_id)
      }
      for (const id of orphanIds) {
        const shellCreativeId = `cr_removed_${id}`
        ads.push({
          id,
          adSetId: '',
          campaignId: '',
          clientId: acct.clientId,
          name: `Removed ad ${id}`,
          status: 'ARCHIVED',
          creativeId: shellCreativeId,
          createdAt: anchor,
        })
        creatives.push(placeholderCreative(shellCreativeId, 'Removed ad', ctx))
      }

      // ---- TRUE period reach per ad (P4) ----
      // A summary query (NO time_increment) returns ONE row per ad whose reach
      // is de-duplicated over the whole time_range — the only correct way to
      // get period frequency (daily reach must never be summed). One small
      // pull per canonical window; unique metrics belong in separate calls per
      // Meta's own best practice. Windows are anchored to the snapshot anchor
      // so they match the ranges the UI/engine will request.
      for (const key of PERIOD_KEY_LIST) {
        const b = periodBoundsFor(key, anchor, windowDays)
        const reachRows = await graphGet<{ ad_id: string; reach?: string }>(
          `${acct.adAccountId}/insights`,
          { level: 'ad', fields: 'ad_id,reach', time_range: JSON.stringify({ since: b.start, until: b.end }) },
          acct.businessId,
        )
        for (const r of reachRows) {
          if (!r.ad_id) continue
          let entry = periodReachByAd.get(r.ad_id)
          if (!entry) {
            entry = {}
            periodReachByAd.set(r.ad_id, entry)
          }
          entry[key] = Number(r.reach ?? 0)
        }
      }
    }

    // ---- clients + business managers (config-sourced, cosmetics ensured) ----
    const primaryCurrency = accounts[0]?.currency ?? 'USD'
    const acctByClient = new Map(cfg.accounts.map((a) => [a.clientId, a]))
    const clients: Client[] = cfg.accounts.map((a) => {
      const configured = cfg.clients.find((c) => c.id === a.clientId)
      const account = accounts.find((x) => x.clientId === a.clientId)
      const base = ensureClientCosmetics(
        configured ?? { id: a.clientId, name: account?.name ?? a.clientId },
        anchor ?? isoTodayInTz('UTC'),
        windowDays,
        account?.currency ?? primaryCurrency,
      )
      // The directory + scope switcher group clients by bmId — bind it to the
      // account's business id so every live client is visible under its BM.
      // '' → the synthesized "Unmapped" BM: a client must never be invisible
      // in the directory/scope switcher because its business id is blank.
      return { ...base, bmId: acctByClient.get(a.clientId)?.businessId || UNMAPPED_BM_ID }
    })
    const businessManagers = synthesizeBusinessManagers(cfg.accounts)

    const ds = assembleDataset({ businessManagers, clients, accounts, campaigns, adSets, ads, creatives, insights })
    const dataAnchor = anchor ?? isoTodayInTz('UTC')
    return { ...ds, periodReachByAd, mode: 'live', generatedAt: new Date().toISOString(), dataAnchor, windowDays }
  }

  async applyAction(req: ActionRequest, snapshot: Snapshot): Promise<ActionResult> {
    if (!this.cfg) throw new NotConfiguredError()
    // duplicate / consolidate / brief_creative aren't single Graph writes, and
    // none = a no-op "watch". Don't POST a mutation-less body and report success.
    if (req.kind === 'duplicate' || req.kind === 'consolidate' || req.kind === 'brief_creative' || req.kind === 'none') {
      return { ok: false, message: `"${req.kind}" is a multi-step action — not supported as a single live write yet; handle it in the app/workflow.` }
    }
    // Resolve the entity's OWNING account so we use the right token + currency.
    // A multi-BM agency holds a token per client-owned BM — using accounts[0]
    // blindly would POST with the wrong token and fail (or hit the wrong account).
    const acct = this.resolveAccount(req, snapshot)
    if (!acct) return { ok: false, message: `No account mapped for entity ${req.entityId}.` }
    // NO access_token in the body — the proxy injects it server-side (and
    // rejects any client-supplied token as a misconfiguration).
    const body = new URLSearchParams()
    if (req.kind === 'pause') body.set('status', 'PAUSED')
    if (req.kind === 'activate') body.set('status', 'ACTIVE')
    if ((req.kind === 'increase_budget' || req.kind === 'decrease_budget') && req.proposedBudget != null) {
      // Budgets POST in MINOR units. Prefer the account's REAL currency_offset
      // (sourced from the Graph API); fall back to the static map only if absent.
      const account = snapshot.accountByClient.get(acct.clientId)
      const offset = account?.currency_offset ?? currencyOffset(account?.currency ?? 'USD')
      body.set('daily_budget', String(Math.round(req.proposedBudget * offset)))
    }
    const res = await fetch(`${apiBase()}/${API_VERSION}/${req.entityId}`, { method: 'POST', body, headers: routingHeaders(acct.businessId) })
    const text = await res.text()
    if (!res.ok) return { ok: false, message: `Graph ${res.status}: ${text.slice(0, 200)}` }
    // 2xx is necessary but not sufficient — Graph can return { success:false } or an
    // error object inside a 200. Require it to not be an explicit failure.
    try {
      const payload = text ? JSON.parse(text) : {}
      if (payload && (payload.success === false || payload.error)) {
        return { ok: false, message: `Meta did not apply the change: ${JSON.stringify(payload).slice(0, 160)}` }
      }
    } catch {
      /* non-JSON 2xx body — treat as applied */
    }
    return { ok: true, message: 'Applied via Meta Marketing API.' }
  }

  /** Map a write request's entity → the LiveAccountConfig that owns it. */
  private resolveAccount(req: ActionRequest, snapshot: Snapshot): LiveAccountConfig | undefined {
    if (!this.cfg) return undefined
    let clientId: string | undefined
    if (req.level === 'campaign') clientId = snapshot.campaignById.get(req.entityId)?.clientId
    else if (req.level === 'adset') clientId = snapshot.adSetById.get(req.entityId)?.clientId
    else if (req.level === 'ad') clientId = snapshot.adById.get(req.entityId)?.clientId
    else if (req.level === 'account') clientId = snapshot.accounts.find((a) => a.id === req.entityId)?.clientId
    else if (req.level === 'client') clientId = req.entityId
    return clientId ? this.cfg.accounts.find((a) => a.clientId === clientId) : undefined
  }
}

// Meta minor-unit offset by ISO code, per Meta's own currencies reference
// (developers.facebook.com/docs/marketing-api/currencies, verified 2026-08-11):
// offset 1 for exactly this set, offset 100 for every other supported ad
// currency. NB: HUF and TWD ARE in Meta's offset-1 set even though ISO-4217
// gives them 2 decimals — Meta diverges from ISO here, so a "two-decimal"
// assumption would POST budgets 100x too large. Meta supports no offset-1000
// ad currencies (KWD/BHD/etc. are not billable ad currencies).
const OFFSET_ONE = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND'])
export function currencyOffset(currency: string): number {
  return OFFSET_ONE.has(currency.toUpperCase()) ? 1 : 100
}

/** Today's date (YYYY-MM-DD) in a given IANA timezone; falls back to UTC. */
function isoTodayInTz(tz: string): string {
  try {
    // en-CA renders as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/** N days before "today in tz", as YYYY-MM-DD (UTC-safe arithmetic on the date). */
function isoDaysAgoInTz(tz: string, n: number): string {
  const d = new Date(isoTodayInTz(tz) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
