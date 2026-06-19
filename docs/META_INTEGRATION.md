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

## 7. Persistence backend — `client_config` + `decision_log`

Two browser-local seams persist agency intent and the accountability ledger today, both
behind **async interfaces** so the backend is a drop-in swap (no UI/engine change):

| Seam | File | Local (today) | Backend (target) |
|---|---|---|---|
| Per-client config | `src/lib/config/` (`ConfigStore`) | `localStorage` `meridian.config` | `client_config` table |
| Decision ledger | `src/lib/history/` (`HistoryStore`) | `localStorage` `meridian.history.{demo,live}` | `decision_log` table |

The async signatures already match REST shapes — `ConfigStore.{load,save,reset}` and
`HistoryStore.{record,forEntity,forClient,all,attachOutcome}`. Wiring is a fetch swap.

### 7.1 Tenancy (applies to both tables)
The local impl is single-tenant (one browser). The backend is multi-tenant: every row
carries **`workspace_id`** (the agency tenant). Scope **all** reads/writes by
`workspace_id` (Postgres RLS recommended). The local impl ignores tenancy.

### 7.2 `client_config`
Per-client business inputs the Graph API does not carry (targets, AOV, margin) plus
engine tuning (overrides/preset) and — later — the Tier-2 calibration layer.

```sql
CREATE TABLE client_config (
  workspace_id        uuid        NOT NULL,
  client_id           text        NOT NULL,
  target_cpa          numeric,
  target_roas         numeric,
  monthly_budget      numeric,
  avg_order_value     numeric,
  contribution_margin numeric,
  threshold_overrides jsonb       NOT NULL DEFAULT '{}',  -- Partial<Record<ThresholdKey, number>>
  preset              text        CHECK (preset IN ('conservative','balanced','aggressive')),
  calibration         jsonb       NOT NULL DEFAULT '{}',  -- Partial<Record<ThresholdKey,CalibrationEntry>>; see CALIBRATION_DESIGN.md
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, client_id)                   -- server-side unique key (A6)
);
```

- The `calibration` column is **machine-written** (a projection of `decision_log`, §7.4)
  and **separately clearable** from the human-set columns — see `CALIBRATION_DESIGN.md`.
  It is design-only; no producer ships this round. `ClientConfig` gains a matching
  `calibration?: Partial<Record<ThresholdKey, CalibrationEntry>>` field the same round, so
  the TS and SQL stay in lockstep.
- API: `GET /api/config/clients` → `Record<clientId, ClientConfig>` (the `load()` shape);
  `PUT /api/config/clients/{clientId}` (upsert, the `save()` shape);
  `DELETE /api/config/clients/{clientId}` (the `reset()` shape).
- `LiveConfig.clients` (`liveProvider.ts:72`) becomes a **derived projection** of this
  table at provider-build time (per architecture A2 — one config home).

### 7.3 `decision_log`
The Decision & Outcome Ledger. Stores nested metric snapshots as JSONB, distinguishes
**surfaced** from **decided**, and carries an audit timestamp on the outcome update.

```sql
CREATE TYPE decision_event AS ENUM ('surfaced','applied','dismissed','acknowledged');

CREATE TABLE decision_log (
  id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid           NOT NULL,
  mode                text           NOT NULL CHECK (mode IN ('demo','live')),  -- segregation parity
  client_id           text           NOT NULL,
  entity_id           text           NOT NULL,
  level               text           NOT NULL,   -- EntityLevel: ad|adset|campaign|client|account
  suggestion_type     text           NOT NULL,
  severity            text           NOT NULL,
  event               decision_event NOT NULL,   -- surfaced vs applied vs dismissed (A6)
  confidence          numeric        NOT NULL,
  pre_metrics         jsonb          NOT NULL,    -- { cpa, spend, roas, purchases } at decision time
  projected           jsonb,                      -- { metric, note? }
  outcome             jsonb,                      -- { capturedAt, cpa, spend, roas, verdict } | NULL
  created_at          timestamptz    NOT NULL DEFAULT now(),  -- := body.decidedAt (app-stamped); now() only a fallback
  outcome_captured_at timestamptz                             -- audit: when outcome was attached (A6)
);
CREATE INDEX ON decision_log (workspace_id, mode, client_id, created_at DESC);
CREATE INDEX ON decision_log (workspace_id, mode, entity_id);
```

- **`event` enum (surfaced vs decided).** `DecisionAction` (history/types.ts) is
  `'applied' | 'dismissed' | 'acknowledged'` — three values; `event` carries all three.
  Today only `applied`/`dismissed` are emitted (`acknowledged` is reserved — no UI path
  records it yet; if one ships, it persists as `event='acknowledged'`). Success-metric #4
  also wants the *surfaced* funnel — every suggestion shown — so the backend adds a
  `surfaced` event (emitted on render) for "shown → decided" conversion analysis;
  `surfaced` is backend-only and the local impl ignores it. **Calibration sample:** only
  `applied` decisions' outcomes count toward the §5 hit-rate — `dismissed`/`acknowledged`/
  `surfaced` are excluded (no action was taken to measure).
- **Mode-segregation.** Demo decisions **never leave the browser** — the backend stores
  live decisions only, so `mode` is effectively always `'live'` server-side. The column
  is kept for parity and as a hard guard (reject `mode='demo'` inserts). This preserves
  the firewall: a simulated decision can never enter the real ledger.
- **`outcome` is NULL until measured on live data** (firewall — strictly null in demo;
  a live outcome-capture job back-fills it and stamps `outcome_captured_at`). The verdict
  is **correlational**, never a causal savings claim.
- API mirroring the seam (each preserves the exact async contract so the `localStorage`→
  fetch swap is a drop-in):
  - `POST /api/history` — body is `Omit<DecisionRecord,'id'>` (server assigns `id`),
    **returns the created `DecisionRecord`** (201 + body) to satisfy `record()`'s
    `Promise<DecisionRecord>`.
  - `GET /api/history?entity=…|client=…|all` → **`DecisionRecord[]`**, filtered to the
    active `mode` AND `workspace_id` (matching `HistoryStore`'s "current mode only"
    contract — not workspace alone). Maps 1:1 to `forEntity`/`forClient`/`all`.
  - `PATCH /api/history/{id}/outcome` (`attachOutcome()`) — sets `outcome` +
    `outcome_captured_at`; a `null` body **clears** `outcome` (and nulls
    `outcome_captured_at`). Must **reject loudly** (409/422, not a silent 200) when the
    row's `mode='demo'` or the id is unknown — so a rejected outcome write is observable
    (the shipped local store no-ops here, which is firewall-safe but silent).

### 7.4 Live outcome capture (prerequisite for Tier 2)
A scheduled job is what makes outcomes (and therefore calibration) real:
- For each `decision_log` row with `outcome IS NULL` and `created_at` older than the
  measurement window (e.g. 7–14d), pull the entity's post-decision insights from the
  Graph API, compute `{ cpa, spend, roas, verdict }`, and `PATCH …/outcome`.
- The **calibration projection** (`CALIBRATION_DESIGN.md` §3/§5) reads these populated
  outcomes, grouped by `(client_id, suggestion_type → threshold key)`, and writes
  `client_config.calibration`. Deterministic, bounded, disclosed — **not** Tier-3 ML.

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
- [ ] `client_config` + `decision_log` tables provisioned with `workspace_id` tenancy (RLS)
- [ ] Config + history API endpoints live; `ConfigStore`/`HistoryStore` repointed from `localStorage` to fetch
- [ ] Live outcome-capture job scheduled (back-fills `decision_log.outcome` + `outcome_captured_at`)
- [ ] (Tier 2, later) calibration projection enabled per `CALIBRATION_DESIGN.md` — backtested first
