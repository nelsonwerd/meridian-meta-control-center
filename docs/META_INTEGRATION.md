# Turning the lights on — Meta API integration guide

The playbook for pointing Meridian at **your real Meta ad accounts**. The live
integration is built; this is the wiring.

**Two paths, and they differ a lot** — §1 splits them:

- **Solo / in-house**, connecting ad accounts your own business owns → **no App
  Review, no Business Verification.** You can be live today.
- **Agency**, connecting clients' accounts shared to you → partner setup, and
  plan on App Review + Business Verification for throughput.

> **Audited 2026-08-11** against developers.facebook.com (access tiers, scopes,
> system users, asset sharing, rate limits, 2026 breaking changes). Claims that
> Meta's public docs leave ambiguous are marked with a confidence note rather
> than smoothed over. Meta changes things — re-verify before go-live. Deeper API
> reference: [`research/meta-marketing-api.md`](research/meta-marketing-api.md).

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

## 1. Meta app + access

> Verified against developers.facebook.com on **2026-08-11**. Meta moves; re-check
> before go-live. Confidence is marked where their own docs are ambiguous.

**There are two very different setups, and only one of them needs App Review.**
Read the path that matches you.

### Path A — Solo / in-house: your own ad accounts (no App Review)

If every ad account you'll connect is owned or administered by **your own**
Business Manager, you do **not** need App Review and you do **not** need Business
Verification. Meta's own words: *"If your app is only managing your ad account,
standard access to the `ads_read` and `ads_management` permissions are
sufficient"*, and App Review / Business Verification are not required for apps
used only by people with a role on the app itself.

1. **Create a Meta app** (Business type) and request just two scopes:
   **`ads_management`** and **`ads_read`**. That's the whole surface Meridian
   uses — reads and the `status`/`daily_budget` writes.
2. **Create a System User** in Business settings → Users → System users, and
   generate a token scoped to those two permissions (UI, or
   `POST /{system-user-id}/access_tokens`). Use a **regular** system user, not
   an admin one — Meta advises keeping admin system users for provisioning only.
3. Assign that system user to each ad account with the task it needs (below).
4. Put the token in the proxy's `META_SYSTEM_TOKEN` (§5). Done — you can run
   Meridian against your real accounts today.

**The catch is throughput, not permission.** Un-reviewed apps sit on the
**Limited** access tier (renamed from *Standard* on 2026-05-04), which is
rate-limited *per ad account per hour* and is explicitly *"for development only,
not for production apps running for live advertisers"*:

| Tier | ads_management calls/hr | ads_insights calls/hr | System users |
|---|---|---|---|
| **Limited** (default, no review) | 300 + 40 × active ads | 600 + 400 × active ads | 1 + 1 admin |
| **Full** (after review) | 100,000 + 40 × active ads | 190,000 + 400 × active ads | 10 + 1 admin |

For one operator watching a handful of accounts on Meridian's on-demand loads,
Limited is usually fine. Apps can be auto-promoted to Full after sustained
healthy usage (as of 2026-05-04: ~500 calls / 15 days with a <15% error rate).

### Path B — Agency: clients' accounts on their own Business Managers

1. The **client** adds your business as a **Partner** in their Business settings
   (now labelled *business portfolio* in Meta's UI) and shares the ad account,
   entering **your business ID**. The API equivalent (`POST /act_{id}/agencies`)
   has been access-restricted since 2021, so this is a UI step in practice.
2. **You** assign your system user to each shared account —
   `POST /act_{id}/assigned_users` with `user`, `tasks`, `business` — after which
   **one token fans out across every client**, agency-owned and partner alike.
3. Task level needed (from Meta's task definitions; they never map tasks to
   specific fields, so this is inferred — *medium confidence*, start narrow and
   widen if a call 403s):
   - **`ANALYZE`** — read insights (Meridian's dashboards/reports).
   - **`ADVERTISE`** — additionally pause/activate and change budgets.
   - `MANAGE` is **not** required (that's billing and permissions).

> ⚠️ **Agencies should plan on App Review + Business Verification.** Meta's docs
> are genuinely ambiguous on whether a *partner-shared* account managed by your
> own system user counts as "your" account for authorization purposes — one page
> says App Review isn't needed for apps used within a business that claimed the
> app, another says *"if your app is managing other people's ad accounts, you
> need advanced access."* **We could not resolve this from public docs
> (low confidence).** In practice the question is moot: the Limited tier's
> 300 calls/hour/account and **one** system user won't run an agency, and Meta
> disclaims Limited for live advertisers — so you'll want **Full** access, which
> requires the app to be connected to a **Business-Verified** business. Budget
> real calendar time for that; it is separate from App Review.

### Token handling (both paths)

Tokens live **only** in the proxy's environment (§5) — `META_SYSTEM_TOKEN`, plus
`META_TOKENS` if a partner BM issues you its own token. The browser never holds
one, the saved account mapping never contains one, and the proxy rejects any
request that tries to supply one.

> ⚠️ System-user tokens are **non-expiring by default**. If you opt into 60-day
> tokens (`set_token_expires_in_60_days=true` — Meta's security recommendation),
> you must refresh before day 60 or the token is forfeit. Rotate/revoke
> (`GET /oauth/revoke`) when someone leaves the team.

## 2. Map clients → ad accounts

**Settings → Live ad account mapping** is an editable table (add/remove
clients; per-row `act_` id, business id/name/type, optional purchase event;
windowDays). "Save mapping" persists the `LiveConfig` the provider reads —
no tokens in it, ever:

```ts
{
  accounts: [
    {
      clientId: 'c_lumiere',
      adAccountId: 'act_123…',      // real act_ id
      businessId: '228…',           // routes to this BM's token in the proxy
      businessName: 'Lumière Beauty',
      businessType: 'partner',      // 'agency' | 'partner' — groups the directory
      purchaseActionType: '',       // blank = omni_purchase
    },
    …
  ],
  clients: [ /* targets, AOV, margin — data the API doesn't carry */ ],
  windowDays: 90,                   // minimum 56 (see §3)
}
```

**No tokens appear in this config, by design** — the proxy owns them, keyed by
`businessId`. (The `LiveConfig` type still carries deprecated `accessToken` /
`defaultAccessToken` fields so older saved configs keep parsing; nothing reads
them.)

Targets (CPA/ROAS), AOV, and contribution margin are **business inputs**, not API
fields — they live in this config, editable in Settings → Targets & tuning.

## 3. Pull structure + insights — BUILT (2026-08-11, Graph v26.0)

`LiveProvider.loadSnapshot()` is complete: per account it pulls the account
node, `campaigns` / `adsets` / `ads` / `adcreatives` (cursor pagination), maps
them onto the domain model (`src/lib/provider/liveMap.ts` — status
normalization incl. `learning_stage_info` LEARNING/FAIL →
LEARNING/LEARNING_LIMITED, CBO/ABO from budget location, legacy→ODAX
objectives, kind/audience/angle inference), pulls daily ad-grain insights plus
**true de-duplicated period reach** per canonical window, and assembles the
same `Dataset` shape demo uses.

- **Insights**: `level=ad`, `time_increment=1`, `time_range` in the account's
  timezone. There is no scalar purchases/revenue — orders/revenue come from the
  nested `actions`/`action_values` arrays by `action_type`. Default
  **`omni_purchase`** (fallback `offsite_conversion.fct.purchase`);
  per-account override in Settings → mapping → "Purchase event".
- **Async report jobs**: windows longer than 60 days POST the insights query →
  poll the `report_run_id` gated STRICTLY on `async_status === "Job Completed"`
  (the percent field can read 100 while still running) → fetch the rows.
- **Window floor**: the pull is clamped to **≥ 56 days** regardless of the
  configured `windowDays`. The default dashboard view is the 28-day preset, whose
  previous-period comparison reaches back to day 56 — a shorter pull would
  silently fabricate deltas, understate frequency and month pacing, and starve
  the fatigue rule's baseline.
- **Breakdowns**: Meridian requests **none**. (Relevant because since 2026-08-06
  `impression_device`, `hourly_stats_aggregated_by_audience_time_zone` and
  `frequency_value` breakdowns require a per-account opt-in in Ads Manager and
  otherwise return no rows *silently* — Meridian is unaffected.)
- **Attribution**: no custom `action_attribution_windows` are requested — the
  default (7d-click + 1d-view) is Ads-Manager parity, and Meta disregards the
  unified-attribution override params since 2025-06-10. Never request
  `7d_view`/`28d_view` (removed 2026-01-12; they return empty silently).
- Both the proxy and the browser client back off on `X-Business-Use-Case-Usage`.

## 4. Write actions

`LiveProvider.applyAction()` implements exactly two writes — that is the whole
live mutation surface, deliberately:

- **Pause / activate**: `POST /{entity_id}` with `status=PAUSED|ACTIVE`.
- **Budget change**: `POST /{campaign_or_adset_id}` with `daily_budget`, routed
  to the CBO campaign or the ABO ad set depending on where the budget lives.

Everything else a suggestion can propose (duplicate, consolidate, brief a
creative) is refused by `applyAction` with a clear message rather than POSTed —
they aren't single-field writes. Bid changes and `lifetime_budget` are **not**
implemented. Writes require an explicit two-step confirm in the UI that names
live mode and warns there is no undo; nothing is ever auto-applied.

> ⚠️ Budgets/bids POST in **minor currency units**. NB `currency_offset` is
> **not a field on the AdAccount node** (verified 2026-08-11) — Meridian derives
> it from the account's `currency` via Meta's currencies table
> (`currencyOffset()`): offset **1** for exactly CLP, COP, CRC, **HUF**, ISK,
> IDR, JPY, KRW, PYG, **TWD**, VND; 100 for everything else. HUF/TWD are
> offset-1 at Meta despite ISO-4217 — an ISO assumption would post 100× too
> large. Objectives are immutable; creatives are effectively immutable. Writes
> to legacy Advantage+ shopping campaigns may be rejected by Meta (blocked
> since 2026-05-19) — the error is surfaced, not swallowed.

Every Meridian suggestion already carries a typed `SuggestedAction` with the
target entity, level, and proposed budget — `applyAction` consumes it directly.

## 5. Backend proxy — BUILT (`server/proxy.mjs`, zero dependencies)

The proxy is real and tested (18 tests against an in-process mock upstream).
It holds every secret; the browser never sees a token and the proxy **rejects**
any client-supplied `access_token` loudly. It also redacts the token from
upstream bodies (Graph embeds it in `paging.next`).

```bash
# dev: proxy on :8787 + vite on :5173 (vite forwards /api + /healthz)
META_SYSTEM_TOKEN=EAAB... npm run proxy
npm run dev

# production: one process serves the built SPA AND proxies Graph
npm run build
META_SYSTEM_TOKEN=EAAB... SERVE_DIST=1 HOST=0.0.0.0 node server/proxy.mjs
```

| Env var | Purpose |
|---|---|
| `META_SYSTEM_TOKEN` | agency system-user token (default for every call) |
| `META_TOKENS` | optional JSON map `{"<businessId>": "<token>"}` for client-owned BMs — the browser routes each call by `X-Meta-Business-Id` |
| `ANTHROPIC_API_KEY` | enables `POST /api/ai/narrate` (§6) |
| `PORT` / `HOST` | default `8787` / `127.0.0.1` (`0.0.0.0` behind your TLS terminator) |
| `SERVE_DIST=1` | also serve `dist/` (SPA fallback) for single-process production |

Health: `GET /healthz` probes Graph `/me` with the server-side token and
returns `{ ok, name }` — Settings → "Check proxy & token" calls exactly this.

## 6. AI narrative (optional enrichment)

The **numeric judgement engine works with zero keys** — scale/cut/fatigue/
consolidate all run on heuristics (`src/lib/ai/engine.ts`). The LLM layer
(`src/lib/ai/llm.ts`) only *enriches the prose*. To enable:

1. `POST /api/ai/narrate` is built into the proxy — it forwards
   `{model, system, messages, max_tokens}` to the Anthropic Messages API with
   `ANTHROPIC_API_KEY` from env and returns `{ text }`. Without the key it
   returns a clear 503 and the app silently stays heuristic.
   Models (current as of 2026-08-11): `claude-sonnet-5` (narrative),
   `claude-opus-5` (weekly strategy).
2. Toggle **Settings → AI analyst → "LLM enriched"** (persisted locally, off by
   default). The client dashboard then renders the "Strategist read" card;
   every failure degrades silently back to heuristic prose.

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

Machine-done (2026-08-11): ~~backend proxy~~ · ~~browser token removed~~ ·
~~structure mapping~~ · ~~minor-unit currency map~~ · ~~async insights~~ ·
~~attribution stance~~ · ~~API pinned v26.0~~ · ~~narrate route + toggle~~.
Remaining — every box below needs YOU (real credentials / real accounts):

**Everyone**
- [ ] Meta app created; **two** scopes requested: `ads_management`, `ads_read`
- [ ] Regular (non-admin) System User + token, set as `META_SYSTEM_TOKEN` on the proxy
- [ ] System user assigned to each ad account (`ANALYZE` to read, `ADVERTISE` to write)
- [ ] Real `act_`/business ids entered in Settings → Live ad account mapping
- [ ] 🚪 `/healthz` green; "Test Meta connection" green
- [ ] 🚪 Flip to Live: campaigns/ads render; KPIs reconcile with Ads Manager
- [ ] 🚪 A known fatigued / learning-limited entity surfaces correctly
- [ ] 🚪 One real pause + budget change on a SANDBOX or lowest-spend ad
- [ ] Conversion event confirmed per account (`omni_purchase` vs pixel/custom)
- [ ] (Optional) `ANTHROPIC_API_KEY` on the proxy + "LLM enriched" toggled on

**Agencies additionally** (Path B, §1)
- [ ] Each client added your business as a Partner and shared their ad account
- [ ] Per-BM tokens in `META_TOKENS` if a client issues you its own
- [ ] Business Verification completed, and Full access obtained (App Review) —
      the Limited tier's 300 calls/hr/account + 1 system user won't carry an agency

**Solo / in-house (Path A): App Review and Business Verification are _not_
required** for accounts your own business owns — skip those two boxes entirely.
- [ ] `client_config` + `decision_log` tables provisioned with `workspace_id` tenancy (RLS)
- [ ] Config + history API endpoints live; `ConfigStore`/`HistoryStore` repointed from `localStorage` to fetch
- [ ] Live outcome-capture job scheduled (back-fills `decision_log.outcome` + `outcome_captured_at`)
- [ ] (Tier 2, later) calibration projection enabled per `CALIBRATION_DESIGN.md` — backtested first
