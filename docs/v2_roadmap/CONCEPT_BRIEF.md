# Meridian v2 — Concept Brief & Roadmap

> **⚠️ Architecture superseded:** a validation deep-dive corrected several
> architecture calls below — see [`02_VALIDATED_ARCHITECTURE.md`](02_VALIDATED_ARCHITECTURE.md)
> (the build contract). Key reversals: per-client config applies **onto** the
> snapshot's `Client` objects (one home), not a parallel store; engine threading is
> an optional trailing `t = T` arg resolved once in `analyzeClient` (+ `creative.ts`);
> demo outcomes are strictly `null` (not "illustrative"); Wave 1 is **medium** risk
> (it stands up the config seam); `breakevenRoas` is **new work** (the brief's
> "already wired" was wrong — there's a consumer, no producer). The *intent, scope,
> locked decisions L1–L7, and honesty firewall below still stand.*

> **Mode:** Refinement (evaluating + extending an existing, shipped product).
> **Status:** Direction locked by the user; this brief records the honest verdict,
> the locked decisions, the architecture, and a phased roadmap. Hands off to a
> **validation deep-dive** → **prompt-pack** → build. Does NOT supersede the v1
> brief (`docs/CONCEPT_BRIEF.md`).
> **Validated against:** the post-hardening tree on branch `hardening/prelive-backlog`.

## What v2 is (one line)
Take Meridian from a *polished signal generator* to a **specific, drillable,
per-client-tuned, and self-accountable** command center — every recommendation
names its exact entity and level, opens to a full drill-down, is tuned by
per-client targets/thresholds, and is recorded in a persisted decision+outcome
ledger the engine can learn from.

## Success metric (forced)
v2 is "working" when **all** hold on the running app:
1. **Specific:** every recommendation shows its **level** (ad/ad set/campaign/account) + a **unique entity name + parent path**, and is reachable in client-scoped views (no more hidden entity).
2. **Drillable:** one click on any recommendation **or** any ad/ad-set/campaign row opens an **entity drawer** with that entity's metrics, trend, creative, all its recommendations, and its action history.
3. **Per-client:** a buyer can **edit each client's targets** (CPA/ROAS/budget/AOV/margin) and **override the engine thresholds per client**; the engine re-scores that client immediately and the change persists.
4. **Accountable:** every recommendation surfaced + every applied/dismissed decision is captured in a **persisted, queryable Decision & Outcome Ledger** (survives reload), with the pre-action metric snapshot.
5. **Leading indicator (live, over time):** ≥N weeks of decision+outcome history accumulate per client so calibration has something real to read.

## Kill / de-scope criterion (forced)
- If **per-client effective-thresholds can't be threaded through the engine without destabilizing it** (the P0 test suite can't stay green / behavior drifts unexpectedly) → ship per-client *targets* only, defer per-client *threshold overrides*.
- If the **feedback loop's outcome measurement can't be made honestly non-misleading in demo** (see Honesty Firewall) → ship the *persisted ledger* (real, useful) and **defer outcome-scoring to live data**, rather than fake a demo "it worked."
- Overarching: if the drawer + clarity + per-client config **don't make the tool meaningfully more usable to a real buyer**, the v2 thesis is wrong — stop and rethink, don't keep adding.

## The Aha moment
Clicking a recommendation and landing in a drawer that says, in effect: *"Here's
the exact ad, its trend, why we flagged it — and here's what happened the last time
you acted on something like this for this client."* The instant it feels **specific
and accountable** instead of generic.

## Honest verdict (pressure-test)
Overall: **strong go**, with one piece that must be built honestly.

| Theme | Verdict | Why / the risk |
|---|---|---|
| **#1 Entity clarity + multi-level** | **9/10 — near-pure win** | The data's already there (`level`/`entityId`/`entityName`); this is mostly *surfacing* it (the card hides it in client scope, never shows the level). Low risk. The only *real* work is new higher-level rules — scoped separately. |
| **#2 Drill-down drawer** | **8/10 — high-leverage** | One reusable surface that themes 1/3/4 all hang off. Medium build; the risk is scope-creep on what the drawer shows — bound it. |
| **#4 Per-client targets + tuning** | **8/10 — anticipated by the design** | `Client` already carries targets; `LiveConfig.clients` was literally commented "set in Settings." Targets editor is easy. Per-client threshold overrides is a **real engine refactor** (the engine reads global `THRESHOLDS` by reference everywhere) — the validation deep-dive must pressure-test it; P0 tests guard it. |
| **#3 Self-learning** | **Tier 1: 8/10 infra · Tier 2: 7/10 (overfit risk) · Tier 3: parked** | The persisted ledger is genuinely valuable and buildable. But "self-learning" is the **overselling trap** — see the firewall. Build the ledger honestly; design calibration conservatively; do NOT promise ML. |

### The Honesty Firewall (load-bearing — #3 must respect all three)
1. **Attribution is correlational, not causal.** After you pause an ad, spend reallocates, auctions shift, other changes land. Without a holdout we cannot claim "this action saved $Z." The ledger surfaces the **realized trajectory** ("after this pause, the client's 7d CPA moved X→Y") as a *signal*, explicitly labeled correlational — never a causal savings claim.
2. **Demo cannot truly demonstrate outcomes.** The demo dataset is static seeded history — there is no real "future" to measure against. In demo the ledger is real + persisted, but any outcome score is **illustrative/simulated and labeled as such**. Real outcome measurement happens only on live data over real elapsed time. No faked demo "it worked!"
3. **Calibration must not overfit thin data.** Tier 2 nudges per-client confidence/thresholds by realized hit-rate — but only above a **minimum-sample guard**, with a **bounded adjustment**, always **disclosed and reversible** (never a silent black-box drift). Tier 2 is **designed this round, built later**.

## Locked decisions
- **L1 — Spec all 4 themes now; build Wave 1 immediately after the pack.** (user)
- **L2 — Persistence is designed for a backend now.** Define the API/DB schema + a clean persistence **seam** (mirroring `DataProvider`'s demo/live pattern); ship a local/demo impl this round; the backend stays **documented/scaffolded, not stood up**. (user)
- **L3 — The throughline is a persisted app-state layer + one entity-detail drawer** that all four themes hang off. (user)
- **L4 — Everything slots into the documented backend path** (local/demo now → proxy/DB later), same honesty discipline as the live data path. (user)
- **L5 — `#3` ships as the persisted ledger (Tier 1) only; Tier 2 is design-only; Tier 3 (ML) is OUT.** Outcome attribution is correlational + demo-illustrative (firewall). (converged)
- **L6 — Per-client *targets* are Wave 1 (low risk); per-client *threshold overrides* are Wave 2** (engine refactor, gated by the kill criterion). (converged)
- **L7 — Design is match-the-bar, not a redesign.** Existing premium dark cockpit; the **drawer is the one major new surface** and must match it. (converged)

## Scope
**IN (this initiative):** entity level/name/parent surfacing + level filter; the entity-detail drawer + click-through from recs and entity rows; per-client targets editor; per-client threshold overrides + conservative/balanced/aggressive presets; breakeven-ROAS from contribution margin; the persistence seam (ConfigStore + HistoryStore) with local impl + documented backend schema; the persisted Decision & Outcome Ledger (Tier 1); new higher-level engine rules (campaign/ad-set) as a scoped add.

**OUT (named, deferred):**
- **Tier 3 ML / a trained model** — needs a real backend + data volume; roadmap, not a feature.
- **Standing up the actual backend** (the API/DB is *designed + documented*, the local impl is the running source of truth this round).
- **Tier 2 calibration *implementation*** — designed this round, built when there's real history.
- **Live structure→type mapping (`#02` from v1)** — still the separate live-integration last-mile.

## Architecture (locked — the validation deep-dive will pressure-test these)

### A. Persistence seam — mirror the `DataProvider` pattern
Two new seams, each with a `local` impl now and a documented backend target. They sit beside the existing provider so demo/live + local/backend compose independently.

```ts
// src/lib/config/types.ts
export interface ClientConfig {           // per-client targets (overrides the seeded defaults)
  clientId: string
  targetCPA?: number; targetROAS?: number; monthlyBudget?: number
  avgOrderValue?: number; contributionMargin?: number
  thresholdOverrides?: Partial<Record<keyof typeof THRESHOLDS, number>>  // Wave 2
  preset?: 'conservative' | 'balanced' | 'aggressive'                    // Wave 2
  updatedAt: string
}
export interface ConfigStore {
  load(): Promise<Record<string, ClientConfig>>          // by clientId
  save(cfg: ClientConfig): Promise<void>
  reset(clientId: string): Promise<void>
}

// src/lib/history/types.ts
export type DecisionAction = 'applied' | 'dismissed' | 'acknowledged'
export interface DecisionRecord {
  id: string
  clientId: string; entityId: string; level: EntityLevel
  suggestionType: SuggestionType; severity: Severity
  action: DecisionAction
  confidence: number
  preMetrics: { cpa: number; spend: number; roas: number; purchases: number }  // snapshot at decision time
  projected?: { metric: string; note?: string }
  decidedAt: string
  // outcome captured later (live, over time) — correlational, may be null forever in demo
  outcome?: { capturedAt: string; cpa: number; spend: number; roas: number; verdict: 'improved' | 'flat' | 'worsened' | 'inconclusive' }
}
export interface HistoryStore {
  record(d: Omit<DecisionRecord, 'id'>): Promise<DecisionRecord>
  forEntity(entityId: string): Promise<DecisionRecord[]>
  forClient(clientId: string): Promise<DecisionRecord[]>
  all(): Promise<DecisionRecord[]>
  attachOutcome(id: string, outcome: DecisionRecord['outcome']): Promise<void>
}
```
- **Local impl now:** `localStorage` (keys `meridian.config`, `meridian.history`), async signatures so the backend swap is a drop-in.
- **Backend target (documented, not built):** `GET/PUT /api/config/clients`, `GET/POST /api/history`, `PATCH /api/history/:id/outcome`; DB tables `client_config` and `decision_log` (schema = the interfaces above). Documented in `docs/META_INTEGRATION.md` alongside the existing proxy guidance.

### B. Entity-detail drawer — contract
- `EntityDrawer({ ref: { level, entityId } | null, onClose })` — a right slide-over (match the cockpit; focus-trap, ESC, a11y). Opened from a single store field `drawer: EntityRef | null` so any surface can trigger it.
- Renders: header (level chip + name + parent path + status) · KPI strip vs the client's targets · efficiency trend · the creative (for ads) · **all recommendations for this entity** (reusing `SuggestionCard`) · **decision history** (from `HistoryStore.forEntity`).
- Wired from: every `SuggestionCard` (click → open its entity), Campaigns rows (campaign/adset/ad), Portfolio/Clients rows.

### C. Engine changes
- **Per-client effective thresholds:** introduce `effectiveThresholds(clientId, config)` = base `THRESHOLDS` merged with `config.thresholdOverrides` (and the preset). Thread an `EngineContext { thresholds }` (or a resolved thresholds arg) through `analyzeClient`/`analyzeAd`/etc. instead of importing the global `T` directly. **Behavior must be identical when no overrides exist** (P0 suite is the guard).
- **Breakeven ROAS:** compute `1 / contributionMargin` per client; use it where the engine/report judge ROAS (and feed the LLM context, already wired).
- **Multi-level surfacing:** no engine change needed to *show* the level (it's already on the suggestion) — that's UI. New higher-level *rules* (campaign-level scale/structure, ad-set audience-expansion) are additive functions like the existing `analyzeAdSets`/`analyzeReallocation`.

## Phased roadmap
**Wave 1 — clarity & control (low risk, ship first):**
- Entity surfacing: level chip + unique name + parent path on `SuggestionCard`; show entity even when `showClient=false`; a **level filter** on Recommendations.
- `ConfigStore` (local impl) + **per-client targets editor** (Settings): edit CPA/ROAS/budget/AOV/margin; engine + screens read the effective client (config-overridden) targets; persists.
- **Breakeven ROAS** surfaced (from margin).
- *Verification:* tests for effective-target resolution + the level filter; live preview of editor + re-scored screens.

**Wave 2 — drawer & per-client tuning (medium):**
- The **entity-detail drawer** + click-through everywhere (#2).
- **Per-client threshold overrides** + presets; `effectiveThresholds` threaded through the engine (gated by the kill criterion; P0 suite must stay green + add per-client cases).
- New higher-level engine rules (scoped).
- *Verification:* engine tests proving identical behavior with no overrides + correct re-score with overrides; drawer a11y (focus trap, ESC, keyboard); live preview.

**Wave 3 — accountability (architectural):**
- `HistoryStore` (local impl) + **Decision & Outcome Ledger Tier 1**: record every surfaced rec + decision + pre-metrics; show history in the drawer + an Activity/History view; persist.
- **Tier 2 calibration — design doc only** (the conservative, sample-guarded, disclosed-and-reversible spec; not built).
- Backend API/DB schema **documented** in META_INTEGRATION.
- *Verification:* ledger round-trips (record → reload → present); outcome fields honestly labeled correlational/illustrative in demo.

## Design direction (load-bearing: match-the-bar)
Match the existing premium dark cockpit (the v1 build-loop bar). The **drawer** is the one major new surface — it must feel native: right slide-over, layered surface tokens, the same KPI/trend/creative components, smooth motion, full keyboard/focus a11y. Design acceptance: the drawer reads as part of the same product to a designer's eye; new chips/filters reuse existing primitives. Not a redesign.

## Top risks
1. **Engine per-client refactor** destabilizes scoring → guard with the P0 suite + "identical with no overrides" tests; gate per kill criterion.
2. **Self-learning overselling** → the Honesty Firewall; outcome = correlational signal + demo-illustrative, never causal/faked.
3. **Designing the backend contract wrong** before it exists → keep the seam minimal + outcome-focused; local impl is the source of truth; schema is a documented target, cheap to revise.
4. **Drawer scope-creep** → bound its contents to the locked list.

## Handoff
Concept + architecture locked here. **Next:** a validation deep-dive pressure-tests
the architecture (the engine threading, the seam/schema, the drawer contract, the
feedback-loop honesty) and the wave sequencing → then `prompt-pack` sequences it →
then build **Wave 1**.
