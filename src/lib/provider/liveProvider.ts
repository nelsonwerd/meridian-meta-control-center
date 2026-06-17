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
  accessToken: string
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
    super('Live mode is not configured. Add a Meta system-user token and map ad accounts in Settings → Connection.')
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

async function graphGet<T>(path: string, params: Record<string, string>, token: string): Promise<T[]> {
  const out: T[] = []
  let after: string | undefined
  let pages = 0
  do {
    const url = new URL(`${GRAPH_BASE}/${API_VERSION}/${path}`)
    Object.entries({ ...params, access_token: token, limit: '200', ...(after ? { after } : {}) }).forEach(([k, v]) =>
      url.searchParams.set(k, v),
    )
    const res = await fetch(url.toString())
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
      await graphGet(`${first.adAccountId}`, { fields: 'name,currency,account_status' }, token)
      return { ok: true, detail: `Connected. ${this.cfg.accounts.length} ad account(s) mapped.` }
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

    const since = isoDaysAgo(cfg.windowDays)
    const until = isoDaysAgo(0)

    for (const acct of cfg.accounts) {
      const token = acct.accessToken || cfg.defaultAccessToken || ''
      const acctNode = (await graphGet<{ name: string; currency: string; timezone_name: string }>(
        acct.adAccountId,
        { fields: 'name,currency,timezone_name' },
        token,
      ))[0] as any
      accounts.push({
        id: acct.adAccountId,
        clientId: acct.clientId,
        name: acctNode?.name ?? acct.adAccountId,
        currency: acctNode?.currency ?? 'USD',
        timezone: acctNode?.timezone_name ?? 'America/New_York',
      })

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

    // Indexes are rebuilt by buildIndexes() — shared with demo. (Scaffold: when
    // structure mapping above is completed, call the same index builder.)
    throw new Error(
      'LiveProvider.loadSnapshot is a wired scaffold: insights pull + action POSTs are implemented; the structure→type mapping (campaigns/adsets/ads/creatives) is the remaining last-mile. See docs/META_INTEGRATION.md.',
    )
    // eslint-disable-next-line no-unreachable
    return {} as Snapshot
  }

  async applyAction(req: ActionRequest, snapshot: Snapshot): Promise<ActionResult> {
    if (!this.cfg) throw new NotConfiguredError()
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
      // Budgets POST in MINOR units; the multiplier is the account's currency
      // offset (100 for USD/EUR, 1 for zero-decimal JPY/KRW, 1000 for KWD/BHD).
      const currency = snapshot.accountByClient.get(acct.clientId)?.currency ?? 'USD'
      body.set('daily_budget', String(Math.round(req.proposedBudget * currencyOffset(currency))))
    }
    const res = await fetch(`${GRAPH_BASE}/${API_VERSION}/${req.entityId}`, { method: 'POST', body })
    if (!res.ok) return { ok: false, message: `Graph ${res.status}: ${(await res.text()).slice(0, 200)}` }
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
// three-decimal currencies differ. Source from the account in production; this map
// is the documented fallback.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD', 'UGX'])
const THREE_DECIMAL = new Set(['KWD', 'BHD', 'JOD', 'OMR', 'TND'])
export function currencyOffset(currency: string): number {
  const c = currency.toUpperCase()
  if (ZERO_DECIMAL.has(c)) return 1
  if (THREE_DECIMAL.has(c)) return 1000
  return 100
}

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
