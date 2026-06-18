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

/* ============================================================================
   LiveProvider — Meta (Facebook) Marketing API client SCAFFOLD.

   This is real, drop-in code: correct Graph endpoints, the Insights field set a
   DTC/orders tool needs, cursor pagination, and write actions. It is GUARDED —
   without credentials it throws a clear, actionable error, so Demo stays the
   default. When the operator pastes a system-user token + maps ad accounts in
   Settings, this lights up. See docs/META_INTEGRATION.md for the full setup
   (system users, partner access for client-owned BMs, app review, rate limits).

   NOT executed in this build (no tokens) → logged as scaffolded in LEDGER.md.
   ========================================================================== */

const GRAPH_BASE = 'https://graph.facebook.com'
// Current GA as of 2026-02-18 (per deep-dive research). Each version lives ~2yr.
export const API_VERSION = 'v25.0'

// The standard conversion event. Configurable per account; pixel-only accounts
// fall back to 'offsite_conversion.fct.purchase'.
export const PURCHASE_ACTION = 'omni_purchase'
export const PURCHASE_ACTION_FALLBACK = 'offsite_conversion.fct.purchase'

/** The Insights fields required to derive every Meridian KPI. NB: there is no
 *  scalar purchases/revenue field — orders, revenue, CPA & ROAS are all pulled
 *  out of the nested actions/action_values/purchase_roas arrays by action_type. */
export const INSIGHT_FIELDS = [
  'date_start',
  'spend',
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'inline_link_clicks',
  'outbound_clicks',
  'actions', // purchase, add_to_cart, landing_page_view live here
  'action_values', // purchase value → revenue
  'purchase_roas',
  'cost_per_action_type',
  'video_play_actions',
  'video_3_sec_watched_actions',
  'video_thruplay_watched_actions',
].join(',')

/** Per-client account mapping + the token that can read/write it. An agency BM's
 *  clients share one system-user token; client-owned BMs (partner access) each
 *  carry their own. */
export interface LiveAccountConfig {
  clientId: string
  adAccountId: string // act_<id>
  businessId: string
  /** Optional: in production the token lives server-side (the proxy injects it),
   *  so a persisted mapping carries NO token. Falls back to defaultAccessToken. */
  accessToken?: string
}

export interface LiveConfig {
  /** default system-user token (agency BM) */
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
    const first = Object.values(JSON.parse(raw) as Record<string, Array<Record<string, number>>>)[0]?.[0]
    if (!first) return null
    return {
      callCount: first.call_count ?? 0,
      totalCpuTime: first.total_cputime ?? 0,
      estimatedTimeToRegainAccess: first.estimated_time_to_regain_access ?? 0,
    }
  } catch {
    return null
  }
}

function buildUrl(path: string, params: Record<string, string>, token: string, extra: Record<string, string> = {}): string {
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}/${path}`)
  Object.entries({ ...params, access_token: token, ...extra }).forEach(([k, v]) => url.searchParams.set(k, v))
  return url.toString()
}

// Single fetch with minimal throttle backoff. GROUNDWORK ONLY — real rate-limit
// handling and async insight report jobs for large pulls belong in the backend
// proxy that holds the token (docs/META_INTEGRATION.md §3). Backs off on a 429 or
// when BUC usage crosses ~95%, up to 3 attempts.
async function graphFetch(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url)
  const buc = parseBuc(res)
  const throttled = res.status === 429 || (buc != null && (buc.callCount >= 95 || buc.totalCpuTime >= 95))
  if (throttled && attempt < 3) {
    const waitMs = buc?.estimatedTimeToRegainAccess ? buc.estimatedTimeToRegainAccess * 1000 : Math.min(2 ** attempt * 1000, 8000)
    await new Promise((r) => setTimeout(r, waitMs))
    return graphFetch(url, attempt + 1)
  }
  return res
}

/** Paginated EDGE read (returns the full data[] across pages). */
async function graphGet<T>(path: string, params: Record<string, string>, token: string): Promise<T[]> {
  const out: T[] = []
  let after: string | undefined
  let pages = 0
  do {
    const res = await graphFetch(buildUrl(path, params, token, { limit: '200', ...(after ? { after } : {}) }))
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
async function graphGetNode<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const res = await graphFetch(buildUrl(path, params, token))
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

/** Pull the additive action/value out of Meta's nested actions array. */
function actionVal(arr: { action_type: string; value: string }[] | undefined, type: string): number {
  return Number(arr?.find((a) => a.action_type === type)?.value ?? 0)
}

export class LiveProvider implements DataProvider {
  readonly mode = 'live' as const
  constructor(private cfg: LiveConfig | null = loadLiveConfig()) {}

  async checkConnection() {
    if (!this.cfg || this.cfg.accounts.length === 0) return { ok: false, detail: 'No accounts configured.' }
    const first = this.cfg.accounts[0]
    const token = first.accessToken || this.cfg.defaultAccessToken || ''
    try {
      // A node GET (not the edge-shaped graphGet, which would parse data[] off a
      // node response and report a false success). Assert we actually got the account.
      const node = await graphGetNode<{ name?: string; account_status?: number }>(
        first.adAccountId,
        { fields: 'name,currency,account_status' },
        token,
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
    const accounts: AdAccount[] = []
    const campaigns: Campaign[] = []
    const adSets: AdSet[] = []
    const ads: Ad[] = []
    const creatives: Creative[] = []
    const insights: Insight[] = []

    for (const acct of cfg.accounts) {
      const token = acct.accessToken || cfg.defaultAccessToken || ''
      // Node read (not the edge-shaped graphGet) so we actually get the account
      // object, and can source the real currency_offset + the account timezone.
      const acctNode = await graphGetNode<{ name?: string; currency?: string; timezone_name?: string; currency_offset?: number }>(
        acct.adAccountId,
        { fields: 'name,currency,timezone_name,currency_offset' },
        token,
      )
      const timezone = acctNode.timezone_name ?? 'America/New_York'
      accounts.push({
        id: acct.adAccountId,
        clientId: acct.clientId,
        name: acctNode.name ?? acct.adAccountId,
        currency: acctNode.currency ?? 'USD',
        timezone,
        currency_offset: acctNode.currency_offset,
      })

      // Insights window in the ACCOUNT's timezone — Meta reports daily rows on the
      // account tz, so a UTC window would shift totals vs Ads Manager.
      const since = isoDaysAgoInTz(timezone, cfg.windowDays)
      const until = isoDaysAgoInTz(timezone, 0)

      // structure
      const rawCampaigns = await graphGet<any>(`${acct.adAccountId}/campaigns`, { fields: 'name,objective,status,daily_budget,bid_strategy' }, token)
      // … map rawCampaigns → Campaign[], rawAdSets → AdSet[], etc.
      // Each /insights call uses level + time_increment=1 to get the daily ad rows.
      const adRows = await graphGet<any>(
        `${acct.adAccountId}/insights`,
        { level: 'ad', time_increment: '1', fields: `ad_id,${INSIGHT_FIELDS}`, time_range: JSON.stringify({ since, until }) },
        token,
      )
      for (const r of adRows) {
        insights.push({
          adId: r.ad_id,
          clientId: acct.clientId,
          date: r.date_start,
          spend: Number(r.spend ?? 0),
          impressions: Number(r.impressions ?? 0),
          reach: Number(r.reach ?? 0),
          clicks: Number(r.clicks ?? 0),
          linkClicks: Number(r.inline_link_clicks ?? 0),
          purchases: actionVal(r.actions, PURCHASE_ACTION) || actionVal(r.actions, PURCHASE_ACTION_FALLBACK),
          revenue: actionVal(r.action_values, PURCHASE_ACTION) || actionVal(r.action_values, PURCHASE_ACTION_FALLBACK),
          addToCart: actionVal(r.actions, 'add_to_cart'),
          landingPageViews: actionVal(r.actions, 'landing_page_view'),
          videoPlays: actionVal(r.video_play_actions, 'video_view'),
          video3s: actionVal(r.video_3_sec_watched_actions, 'video_view'),
          videoThruplays: actionVal(r.video_thruplay_watched_actions, 'video_view'),
        })
      }
      void rawCampaigns // mapping omitted in scaffold — structure pull follows the same pattern
    }

    // These four arrays are the RESERVED accumulators for the deferred structure→
    // type mapping (#02): once that last-mile lands they hold the mapped
    // campaigns/adsets/ads/creatives and feed the shared index builder. Referenced
    // via void so the scaffold stays strict-clean (noUnusedLocals) without deleting
    // the reserved home or faking usage. (See docs/PROMPT_PACK_live_integration.md.)
    void campaigns
    void adSets
    void ads
    void creatives

    // Indexes are rebuilt by buildIndexes() — shared with demo. (Scaffold: when
    // structure mapping above is completed, call the same index builder.)
    throw new Error(
      'LiveProvider.loadSnapshot is a wired scaffold: insights pull + action POSTs are implemented; the structure→type mapping (campaigns/adsets/ads/creatives) is the remaining last-mile. See docs/META_INTEGRATION.md.',
    )
    return {} as Snapshot
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
    if (!acct) return { ok: false, message: `No account/token mapped for entity ${req.entityId}.` }
    const token = acct.accessToken || this.cfg.defaultAccessToken || ''
    const body = new URLSearchParams({ access_token: token })
    if (req.kind === 'pause') body.set('status', 'PAUSED')
    if (req.kind === 'activate') body.set('status', 'ACTIVE')
    if ((req.kind === 'increase_budget' || req.kind === 'decrease_budget') && req.proposedBudget != null) {
      // Budgets POST in MINOR units. Prefer the account's REAL currency_offset
      // (sourced from the Graph API); fall back to the static map only if absent.
      const account = snapshot.accountByClient.get(acct.clientId)
      const offset = account?.currency_offset ?? currencyOffset(account?.currency ?? 'USD')
      body.set('daily_budget', String(Math.round(req.proposedBudget * offset)))
    }
    const res = await fetch(`${GRAPH_BASE}/${API_VERSION}/${req.entityId}`, { method: 'POST', body })
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

// Meta currency_offset by ISO code. Most are 100 (two-decimal); zero-decimal and
// three-decimal currencies differ. Always prefer the per-account value from the
// Graph API (set on AdAccount.currency_offset); this static map is only the
// fallback. NB: HUF and TWD are TWO-decimal in Meta's currency_offset — they are
// deliberately NOT in this zero-decimal set (a mis-bucket would POST 100x too small).
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX'])
const THREE_DECIMAL = new Set(['KWD', 'BHD', 'JOD', 'OMR', 'TND'])
export function currencyOffset(currency: string): number {
  const c = currency.toUpperCase()
  if (ZERO_DECIMAL.has(c)) return 1
  if (THREE_DECIMAL.has(c)) return 1000
  return 100
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
