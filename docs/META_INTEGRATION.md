# Turning the lights on — Meta API integration guide

This is the playbook for moving Meridian from **demo data** to **live Meta data +
write actions**. The app is built around clean seams so this is a *wiring*
exercise, not a rewrite. Everything below is grounded in the deep-dive research
(`docs/research/meta-marketing-api.md`) — re-verify version-specific details
against developers.facebook.com before go-live.

---

## The seams you plug into

| Seam | File | Demo today | Live target |
|---|---|---|---|
| Data source | `src/lib/provider/` | `DemoProvider` (seeded) | `LiveProvider` (Graph API) |
| Snapshot load | `LiveProvider.loadSnapshot()` | n/a | page Graph structure + insights |
| Write actions | `LiveProvider.applyAction()` | simulated in `DemoProvider` | POST to Graph |
| AI judgement | `src/lib/ai/engine.ts` | **works as-is, no keys** | unchanged |
| AI narrative | `src/lib/ai/llm.ts` | heuristic prose | LLM via backend proxy |

Flip the active provider in **Settings → Connection** (persists to `localStorage`,
key `meridian.provider.mode`). `createProvider()` in `src/lib/provider/index.ts`
selects the implementation.

---

## 1. Meta app + access (the multi-BM model)

Meridian's whole premise is one agency seeing many clients across **multiple
Business Managers**. The access model that makes this work without per-client
OAuth:

1. **Create a Meta app** in the agency's Business Manager. Request scopes:
   `ads_management`, `ads_read`, `business_management`, `read_insights`,
   `pages_read_engagement`, `pages_show_list`. All are **Advanced Access** →
   require **App Review + Business Verification**.
2. **Create a System User** in the agency BM and generate a long-lived
   (or non-expiring) token: `POST /{system-user-id}/access_tokens`.
3. For clients **inside the agency BM**: assign the system user to their ad
   accounts directly.
4. For clients on their **own Business Managers**: the client adds the agency BM
   as a **Partner** and shares the ad account / Page / pixel. The agency then
   assigns its system user to those shared assets. **One token now fans out
   across every client** — agency-owned and partner alike.

Store the token(s) **server-side** (a secret store / backend env), never in the
browser. The `LiveAccountConfig` shape in `liveProvider.ts` carries a per-account
token so partner BMs with their own tokens are supported; most setups use the one
agency system-user token as `defaultAccessToken`.

> ⚠️ The browser SPA must not hold the token in production. Put a thin backend
> proxy in front of the Graph API (see §5) — the `LiveProvider` `fetch` calls
> then target your proxy, which injects the token server-side.

## 2. Map clients → ad accounts

In **Settings → Ad account mapping**, each client maps to a Meta ad account
(`act_<id>`) under a business manager. Persist a `LiveConfig`
(`saveLiveConfig()` in `liveProvider.ts`):

```ts
{
  defaultAccessToken: '<agency system-user token, server-side>',
  accounts: [
    { clientId: 'c_lumiere', adAccountId: 'act_123…', businessId: '228…', accessToken: '' },
    …
  ],
  clients: [ /* targets, AOV, margin — data the API doesn't carry */ ],
  windowDays: 90,
}
```

Targets (CPA/ROAS), AOV, and contribution margin are **business inputs**, not API
fields — they live in this config (seeded today from `catalog.ts`).

## 3. Pull structure + insights

`LiveProvider.loadSnapshot()` already implements the **insights pull** (the hard
part) and leaves the **structure→type mapping** as the marked last-mile. Per
account:

- **Structure**: `GET /{act_id}/campaigns`, `/adsets`, `/ads`, `/adcreatives`
  with cursor pagination (`graphGet` handles paging). Map onto `Campaign` /
  `AdSet` / `Ad` / `Creative`. Internal-vs-UI naming trap:
  `ad-campaign-group`=Campaign, `ad-campaign`=Ad Set, `adgroup`=Ad.
- **Insights**: `GET /{act_id}/insights` with `level=ad`, `time_increment=1`,
  `time_range={since,until}`, and `INSIGHT_FIELDS`. **There is no scalar
  purchases/revenue** — orders/revenue/CPA/ROAS are pulled from the nested
  `actions` / `action_values` / `purchase_roas` arrays by `action_type`. Meridian
  standardizes on **`omni_purchase`** (fallback `offsite_conversion.fct.purchase`).
  `actionVal()` already does this extraction.

Use **async insight report jobs** for large historical pulls and watch the
`X-Business-Use-Case-Usage` response header to back off before rate limits.

> ⚠️ **Attribution** (as of 2026-01-12): `7d_view` / `28d_view` windows were
> removed from the Insights API. Default is 7d-click + 1d-view; `28d_click`
> survives. Set `action_attribution_windows` explicitly if you need non-default.

## 4. Write actions

`LiveProvider.applyAction()` is implemented for the common writes:

- **Pause / activate**: `POST /{entity_id}` with `status=PAUSED|ACTIVE`.
- **Budget change**: `POST /{entity_id}` with `daily_budget` (or `lifetime_budget`).
- **Bid**: `bid_amount` (+ `bid_strategy`).

> ⚠️ Budgets/bids POST in **minor currency units**, but the multiplier is the
> account's **`currency_offset`** (100 for USD/EUR, **1** for JPY/KRW). Read
> `currency_offset` from the ad account; don't hard-code ÷100 (there's a `TODO`
> at that line). Objectives are immutable; creatives are effectively immutable.

Every Meridian suggestion already carries a typed `SuggestedAction` with the
target entity, level, and proposed budget — `applyAction` consumes it directly.

## 5. Backend proxy (recommended shape)

A ~100-line server (Express/Fastify/Next route handlers) that:
- holds the system-user token(s) in env,
- exposes `GET /api/meta/*` → forwards to `graph.facebook.com/v25.0/*` with the
  token injected, parses `X-Business-Use-Case-Usage` for throttling,
- exposes `POST /api/meta/{id}` for writes,
- exposes `POST /api/ai/narrate` for the LLM layer (§6).

Then point `GRAPH_BASE` in `liveProvider.ts` at your proxy instead of
`graph.facebook.com`, and drop the in-browser token entirely.

## 6. AI narrative (optional enrichment)

The **numeric judgement engine works with zero keys** — scale/cut/fatigue/
consolidate all run on heuristics (`src/lib/ai/engine.ts`). The LLM layer
(`src/lib/ai/llm.ts`) only *enriches the prose*. To enable:

1. Stand up `POST /api/ai/narrate` that forwards `{system, messages, model}` to
   the Anthropic API (server-side key) and returns `{ text }`.
   Models: `claude-sonnet-4-6` (narrative), `claude-opus-4-8` (weekly strategy).
2. Set `USE_LLM = true` in `llm.ts`. `buildNarrativePrompt()` already constructs
   a grounded, numbers-first prompt from the engine's findings.

## Go-live checklist

- [ ] App created, 6 scopes approved via App Review + Business Verification
- [ ] System user + long-lived token, stored server-side
- [ ] Partner access accepted for client-owned BMs; assets shared
- [ ] Backend proxy live; `GRAPH_BASE` repointed; browser token removed
- [ ] `LiveProvider.loadSnapshot()` structure mapping completed (last-mile)
- [ ] `currency_offset` sourced per account for budget writes
- [ ] Conversion event confirmed per account (`omni_purchase` vs custom)
- [ ] Attribution windows set intentionally
- [ ] Pin & re-verify Graph API version (currently `v25.0`)
- [ ] (Optional) `/api/ai/narrate` proxy live, `USE_LLM = true`
