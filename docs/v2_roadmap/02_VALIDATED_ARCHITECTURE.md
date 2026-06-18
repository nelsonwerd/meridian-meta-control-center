# Meridian v2 — Validated Architecture & Build Contract

> Supersedes the architecture sections of `docs/v2_roadmap/CONCEPT_BRIEF.md` where they conflict. The brief's *intent*, scope (IN/OUT), locked decisions L1–L7, and honesty firewall stand. This document is what the prompt-pack is built from. Verified against the working tree (33/33 P0 tests green) on `main`.

---

## 1. Verdict

**The brief architecture is sound and should be built. Overall confidence: 8/10.** The seam pattern is L2-faithful, the data already carries everything the clarity/drawer work needs, the call graph already threads per-client identity end-to-end, and the kill criteria are correctly placed. All four validation lanes independently landed at 8/10. Nothing here invalidates the thesis; the corrections are about *where overrides resolve*, *which files get threaded*, and *one mislabeled risk*.

**The three most important corrections (must internalize before any code):**

1. **There must be exactly ONE per-client config home, resolved at one boundary — not a parallel store the engine/screens can forget to read.** The brief introduces `ConfigStore` as a new home while ~20 engine sites + 8 screens read targets directly off the snapshot's `Client` objects (`engine.ts:60,249,265,267`, `creative.ts:29,40,136`, etc.). The fix: `ConfigStore` is the *persistence layer only*; on load it applies overrides **onto the snapshot's `Client` objects** (the single read source) via one resolver, mirroring how `loadThresholds()` mutates the global `THRESHOLDS` in place before the first pass (`store.ts:94`). Async at the seam, **sync in the selector path via a one-time hydrate** — the engine never awaits (the entire UI reads zustand synchronously: `analyzeScope` runs inside `useMemo`).

2. **Wave 1 is MEDIUM risk, not low — it introduces the config seam AND the first engine read-path change.** Per-client targets are read off `Client` at ~20 sites with no resolution layer today. Shipping them requires the same class of "prove identical engine output with no config" discipline the brief reserved for Wave 2. Reclassify and give Wave 1 W2's test guardrails.

3. **Per-client overrides must reach `creative.ts`, not just `engine.ts` — and `breakevenRoas` is NOT wired.** `creative.ts diagnose()`/`nextBatchPlan()` judge the *same* per-client signals (fatigue, CPA gates, funnel floors) at 9 sites; if overrides skip it, the Creative Lab silently contradicts the Recommendations feed for any tuned client — a visible honesty gap. Separately, `breakevenRoas` has a consumer (`llm.ts:36,54`) but **zero producers** — it is new work, not surfacing.

---

## 2. Corrections applied

| Ref | Problem | Resolution |
|---|---|---|
| **A1 — config home** *(must)* | `ConfigStore` is a parallel store; engine/screens read targets off snapshot `Client` (`engine.ts:60,249,265,267`; `creative.ts:29,40,136`; ~8 screens). A forgotten merge = stale seeded targets, violating the v1 "screens + engine read the same source" invariant. | `ConfigStore` = persistence only. On `store.init`/`applyProviderMode`, hydrate config and apply it **onto** `snapshot.clientById` Client objects via `applyClientConfig(client, cfg): Client`. All existing readers stay correct with zero edits. Editing in Settings: persist AND re-apply in-memory + `bumpSnapshot` (exactly like `setThreshold`, `store.ts:205-210`). |
| **A2 — two competing homes** *(must)* | `LiveConfig.clients: Client[]` (`liveProvider.ts:72`) is already a per-client target home, and `SettingsScreen.tsx:43` writes `clients: snapshot.clients` into it. The new `ClientConfig` overlaps it → two persisted homes (`meridian.live.config` vs `meridian.config`) that can disagree. | Pick ONE. `ConfigStore` is the single mode-agnostic home. In live mode, derive `LiveConfig.clients` FROM `ConfigStore` at provider-build time; remove/redirect the `clients: snapshot.clients` write at `SettingsScreen.tsx:43`. Document: ConfigStore is the home; `LiveConfig.clients` is a derived projection. |
| **A3 — async vs sync** *(must)* | `ConfigStore.load(): Promise` and `HistoryStore.forEntity(): Promise` collide with synchronous selectors (`useSnapshot`, `useMemo(() => analyzeScope(...))`). You cannot `await` inside `analyzeClient` or a sync `useMemo`. | Keep async interfaces (backend-swap honesty). HYDRATE once into sync zustand state during init/swap; engine reads the already-merged `Client`. History reads (drawer/Activity) go through `useEffect` + Promise (async-tolerant); recording is fire-and-forget. Contract: **"async at the seam, sync in the selector path via a one-time hydrate."** |
| **C1 — creative.ts threading** *(must)* | `creative.ts` reads `T` at 9 sites (`:61,67,73,74,78,84,89,137,138`) and judges the same per-client signals as the engine; called per-client (`CreativeLab.tsx`, `ClientDashboard.tsx`, `report.ts:68`). Overrides reaching engine but not creative = contradictory fatigue/winner calls for the same ad. | Resolve `effectiveThresholds(clientId, config)` at the top of `creativePerformance` (it already has `clientId`, `:28`) and pass into `diagnose()`/`nextBatchPlan()` exactly as the engine does. Scope into Wave 2 alongside the engine change. **Decision:** the hardcoded `0.9` CPA-winner ratio at `creative.ts:89` (mirrors engine `scaleCpaRatio` 0.8) stays **fixed** — it is not in `THRESHOLDS`; document that per-client tuning does NOT reach it. |
| **C2 — interface choice** *(should)* | Brief offers "EngineContext{thresholds}" OR "resolved arg" as equivalent. They differ in blast radius: `analyzeAd(ds, ad, client)` is the exported test surface (`engineBehavior.test.ts:60,69`). A new required positional (object or arg) breaks those calls; per-call-site lookup re-spreads per ad and loses single-resolution. | Resolve ONCE in `analyzeClient`: `const t = effectiveThresholds(clientId, config)`. Pass as an **optional trailing param** defaulting to live global `T`: `analyzeAd(ds, ad, client, t = T)`. Same for `analyzeAdSets/Reallocation/Pacing/Anomalies`. Existing 3-arg test calls stay byte-identical, zero test edits. **This is the locked approach — not a context object.** |
| **C3 — slider coexistence + precedence** *(should)* | Global sliders mutate `THRESHOLDS` by reference (`thresholds.ts:81`); store re-derives via `bumpSnapshot`. If `effectiveThresholds` captures a copy/memoizes, slider edits stop flowing into per-client resolution. Merge precedence unstated. | `effectiveThresholds` reads the **live** `THRESHOLDS` object at call time (resolve fresh inside `analyzeClient` each pass — it already re-runs on `[snapshot]` bump). **Locked precedence:** base = live global `THRESHOLDS` → preset delta → explicit `thresholdOverrides` (most specific wins). A global slider moves the BASE for every client that hasn't overridden that key. Config edits must `bumpSnapshot` to re-derive screens (`store.ts:209`). |
| **B1 — breakevenRoas "already wired"** *(should)* | Brief line 122 says breakeven is "already wired." Verified false: `breakevenRoas` is consumed (`llm.ts:36,54`) but has **zero producers** — nothing computes `1/contributionMargin`. The `narrate`/`NarrativeContext` path has no caller in `src/` either. | Treat as **new Wave 1 work**: add `breakevenRoas(client) = 1 / client.contributionMargin` (guard `margin > 0`), assign it into the `NarrativeContext` builder's call site, and surface it in the targets editor + ROAS-judging KPI strips. Correct brief line 122. |
| **D1 — unique entity name** *(must)* | Ad names are non-unique: `generate.ts:143` builds `${angle} — ...v${i+1}` from the *creative*, sampled across multiple ad sets; adset names (`:343`) collide across campaigns. Card shows only the name. Brief floats a "vN" suffix. | Disambiguate by **parent path**, never a synthetic vN (the name already contains a creative-level `v1`, so a second vN misleads). Build one `parentPath(snapshot, level, entityId)` selector via `adById→adSetById→campaignById` (`generate.ts:80-82`); reuse on card AND drawer header. |
| **D2 — hidden entity in client scope** *(must)* | `SuggestionCard.tsx:79` hides entity name AND level inside the `showClient && client` block — in client-scoped views (`ClientDashboard`, `WeeklyReport`, client-scoped Recommendations) both vanish. No level chip is rendered anywhere today. | Restructure: always render **level chip + entity name + parent path** in its own row, independent of `showClient`. `showClient` controls ONLY the client avatar/name. When `showClient=false`, parent path stops at campaign (never repeat the client — it's the page context). |
| **D3 — drop `account` level** *(should)* | `EntityLevel` includes `'account'` (`types.ts:13`) but no engine rule emits it, and there is **no `accountById` index** (only `accountByClient`, `generate.ts:75`) — the drawer header can't resolve an account name in O(1). | Drop `'account'` from the drawer's supported levels for this initiative. Supported set = **ad / ad set / campaign / client**. Fix success-metric #1 copy. (If account is ever needed: add `accountById` to the snapshot first.) |
| **B2 — outcome: null vs illustrative** *(must)* | Firewall #2 says demo outcome is "illustrative/simulated," but the schema says "null forever," and L5 says "demo-illustrative." A simulated number in demo has no data basis (verified: demo time frozen, `applyAction` writes no insight rows) — that IS the faked "it worked" the firewall forbids. | **Lock ONE:** outcome stays **strictly `null`/absent in demo**; UI renders "Outcome: pending — measured on live data over elapsed time." Drop "illustrative/simulated" for outcomes entirely. Make `outcome === null` in demo a **tested invariant**. |
| **W1 — Wave 1 risk** *(must)* | Brief labels Wave 1 "low risk." It introduces the first persistence seam AND the first engine read-path change (targets at ~20 sites, no resolution layer today). | Reclassify Wave 1 as **MEDIUM**. Give it W2's guardrails: add the "identical engine output with no client config" P0 test BEFORE wiring the editor. Prefer the resolver/merge approach over ad-hoc snapshot mutation. |
| **A4 — HistoryStore vs existing Sets** *(should)* | Recording must not replace `appliedSuggestionIds`/`dismissedSuggestionIds` (`store.ts:48-49`) — session-only Sets the live feed dedup depends on (`Recommendations.tsx:27-28`), reset on provider swap. `applySuggestion` doesn't compute pre-metrics. | Record in `applySuggestion` (`store.ts:137`) and `dismissSuggestion` (`store.ts:189`) as **additive fire-and-forget** `void historyStore.record(...)`. Keep the Sets as the in-session dedup/feed source. Compute `preMetrics` at decision time via `metricsForEntity`/`metricsForAdIds` (snapshot in hand). |
| **A5 — history mode-scoping** *(should)* | Flat key `meridian.history` mixes demo entityIds with live entityIds after a provider flip; demo (simulated) decisions would pollute a live accountability ledger — a firewall concern. | Namespace history by mode (`meridian.history.demo` / `meridian.history.live`) OR stamp each `DecisionRecord` with `mode: 'demo'|'live'` and filter. ConfigStore can stay mode-agnostic (targets are real intent); **history must be mode-segregated.** |
| **D4 — drawer vs `?entity=` deep-link** *(should)* | Brief asks if the drawer replaces the `?entity=` deep-link (`Recommendations.tsx:34,77`; opened from `Campaigns.tsx`). They are different surfaces (URL list-filter vs global overlay). A naive "replace" breaks the shareable URL + Campaigns spark flow. | Keep both, compose them: drawer = ephemeral **store state** (NOT in the URL); `?entity=` = shareable **URL state**. Do NOT move the drawer into the router. Upgrading the Campaigns spark Link to open the drawer is an optional UX choice, not a forced replacement. |
| **D5 — drawer creative per level** *(consider)* | `creativePerformance(ds, clientId, range)` returns ALL of a client's creatives with a client-wide percentile — not keyed by ad. "Show the creative" is ill-defined above ad level. | Specify per-level: **ad** → resolve its one `CreativePerformance` row (match `creative.id`, keep client-wide percentile context); **adset/campaign** → creative cohort/leaderboard filtered to the subtree's adIds (reuse `adIdsForEntity`), or omit the creative panel. Bound this in the locked drawer-contents list. |
| **A6 — backend schema gaps** *(consider, doc-only)* | The TS interfaces under-specify backend essentials: no tenant/workspace scoping; nested `preMetrics`/`outcome` storage form unstated; no `surfaced` vs `decided` event distinction (success-metric #4 wants both); no audit timestamp on outcome update. | In `META_INTEGRATION.md` only: add `workspace_id`/`tenant_id` + server unique key to `client_config`; declare `pre_metrics JSONB`, `projected JSONB`, `outcome JSONB`; add an `event` enum (`surfaced`/`applied`/`dismissed`) or a `surfaced_log`; add `created_at`/`outcome_captured_at`. Local impl ignores tenancy. |
| **A7 — Tier 2 calibration layering** *(should, design-only)* | Brief folds preset/overrides/calibration into one `ClientConfig` — a silent merge where the buyer can't tell their value from the machine's. "Reversible" is undefined. | Design-only (W3 doc): calibration is a **distinct, separately-clearable layer** `config.calibration: { key, delta, basis:{ sampleN, hitRate }, appliedAt }` resolved AFTER manual overrides. Disclosure UI: "engine nudged X by Y because Z (n=N) — revert." Define min-sample N and the bound numerically in the doc. |

---

## 3. Finalized architecture

### (a) Per-client config home + effective-resolution layer

**One home, one resolution boundary.** `ConfigStore` persists; the snapshot's `Client` objects remain the single read source.

```
ConfigStore (persistence)  ──load()──►  store.init / applyProviderMode
                                              │ hydrate → state.clientConfig: Record<string, ClientConfig>
                                              ▼
                          applyClientConfig(client, cfg): Client   ← onto snapshot.clientById
                                              │
                  engine + creative.ts + ~8 screens read client.targetCPA etc. UNCHANGED
```

- **`applyClientConfig(client, cfg): Client`** — pure resolver, applied at snapshot hydration. Targets need **no engine signature change** (`engine.ts:60,249,265,267` keep reading `client.targetCPA`/`monthlyBudget`).
- **Mirror the proven pattern:** identical in shape to `loadThresholds()` mutating global `THRESHOLDS` before the first pass (`store.ts:94`). Edit in Settings → persist via ConfigStore + re-apply + `bumpSnapshot` (like `setThreshold`, `store.ts:205-210`).
- **Unified entry point (Wave 1):** load `ConfigStore` in `store.init()` alongside `loadThresholds()` (`store.ts:94`). Wave 2's `thresholdOverrides` ride the SAME resolved-config object — a pure additive layer, not a second mechanism. Wave 1 stands alone if Wave 2 is dropped (kill criterion stays clean).
- **`breakevenRoas(client) = 1 / client.contributionMargin`** (guard `> 0`) — new Wave 1 helper; feed into `NarrativeContext` (`llm.ts:25-38`) at its assembly site and ROAS-judging KPI strips.

### (b) Engine threading approach

- **Resolve ONCE** in `analyzeClient` (`engine.ts:350`): `const t = effectiveThresholds(clientId, config)`.
- **Pass as optional trailing param**, default = live global `T`:
  - `analyzeAd(ds, ad, client, t: typeof THRESHOLDS = T)` — keeps the 3-arg test calls (`engineBehavior.test.ts:60,69`) byte-identical.
  - Same shape for `analyzeAdSets / analyzeReallocation / analyzePacing / analyzeAnomalies`.
- **`effectiveThresholds(clientId, config) = { ...THRESHOLDS, ...presetDelta, ...thresholdOverrides }`** reading the **live** `THRESHOLDS` object (so global sliders still move the base). Precedence: **live global → preset → explicit overrides**.
- **`creative.ts` is threaded too (Wave 2):** resolve at the top of `creativePerformance` (`creative.ts:28`), pass `t` into `diagnose()` and `nextBatchPlan()`. The `0.9` hardcode at `creative.ts:89` stays fixed (documented).
- **`report.ts` needs no direct change** — it delegates to `analyzeClient` (`report.ts:74`) and `creativePerformance` (`report.ts:68`).
- **This is the single riskiest edit in v2.** Flag it explicitly in the pack.

### (c) Persistence seam interfaces

Keep the brief's `ConfigStore` / `HistoryStore` async interfaces as written (`CONCEPT_BRIEF.md:84-110`), with these locked amendments:

- **`ClientConfig`** is the single per-client home (targets + Wave-2 `thresholdOverrides`/`preset`). `LiveConfig.clients` becomes a derived projection (remove the `SettingsScreen.tsx:43` write).
- **Local impl:** `localStorage`. Keys: `meridian.config` (mode-agnostic). **History namespaced by mode:** `meridian.history.demo` / `meridian.history.live`, OR a `mode` field on each `DecisionRecord` + filter.
- **`DecisionRecord.outcome` is strictly `null` in demo** (B2). Add `mode: 'demo' | 'live'` to the record.
- **Hydrate sync:** `await store.load()` in init → hold `clientConfig` in zustand state. Engine never awaits. History reads via `useEffect` + Promise; recording is fire-and-forget.
- **`EntityRef`:** `export interface EntityRef { level: EntityLevel; entityId: string }` in `types.ts` — net-new, used by the drawer field, `ConfigStore`, and `HistoryStore`.

### (d) Drawer contract

- **`EntityDrawer({ ref: EntityRef | null, onClose })`** — right slide-over, opened from a single store field `drawer: EntityRef | null` + `openDrawer/closeDrawer` actions (beside `scope`/`range`, `store.ts:42-50`). **Ephemeral store state, NOT the URL.**
- **Net-new chrome:** no drawer/dialog/`createPortal`/focus-trap primitive exists. Budget real effort for accessible slide-over (focus-trap, ESC, `role="dialog"`, scroll-lock).
- **Supported levels: ad / ad set / campaign / client** (no `account`, D3).
- **Locked contents (bound against scope-creep):** header (level chip + name + `parentPath` + status) · KPI strip vs client targets · efficiency trend (`metrics.ts` timeseries + `adIdsForEntity`) · creative panel (**per-level per D5**) · all recommendations for this entity (`SuggestionCard`) · decision history (`HistoryStore.forEntity`).
- **Composes with `?entity=`** — does not replace it (D4).

### (e) Entity-clarity approach

- Pure surfacing — `Suggestion` already carries `level`/`entityId`/`entityName`/`clientId` (`types.ts:300-320`).
- One shared **`parentPath(snapshot, level, entityId)`** selector via `adById→adSetById→campaignById→clientById` (`generate.ts:80-82`), reused on `SuggestionCard` AND drawer header.
- Restructure `SuggestionCard` (`SuggestionCard.tsx:79`): always render **level chip + entity name + parent path**; `showClient` controls only the client avatar; client-scoped path stops at campaign.

---

## 4. Finalized waves

### Wave 1 — clarity & control · **MEDIUM risk** (reclassified from "low")

- **Scope:** Entity surfacing (level chip + unique name + parent path on `SuggestionCard`, shown even when `showClient=false`) + level filter on Recommendations · `ConfigStore` (local impl) + per-client targets editor (Settings) via `applyClientConfig` onto snapshot · breakeven ROAS producer (new) · `EntityRef` type defined.
- **Dependency/risk:** Introduces the **first persistence seam AND the first engine read-path change** (targets at ~20 sites, no resolution layer today). This is the seam W2 and W3 both depend on.
- **What proves it:**
  - *Tests:* **(a) IDENTICAL** — `analyzeScope(ds, scope)` with empty config deep-equals current output (id/type/severity/confidence/title). **(b) RE-SCORES** — a target override flips one ad's suggestion. **(c) ISOLATION** — overriding client A leaves client B unchanged. Breakeven helper unit test (guard margin=0).
  - *Demo-preview:* edit a target → see re-scored screens → reload → change persists.
- **Confirm true risk level:** **Yes, MEDIUM.** It stands up the config seam, so destabilizing it cascades. Same guardrails as W2; add test (a) BEFORE wiring the editor.

### Wave 2 — drawer & per-client tuning · **HIGH risk** (the engine refactor)

- **Scope:** Entity-detail drawer + click-through everywhere · per-client threshold overrides + presets, `effectiveThresholds` threaded through engine **AND `creative.ts`** (optional-trailing-arg pattern) · new higher-level engine rules (additive, scoped) · drawer history section behind a `HistoryStore` stub returning `[]`.
- **Dependency/risk:** The threshold threading is the single riskiest edit in v2 — gated by the kill criterion. **Item moved IN:** `creative.ts` threading (C1) — the brief scoped it to engine-only; it must ride alongside or tuned clients see contradictory Creative Lab vs Recommendations calls.
- **What proves it:**
  - *Tests:* identical engine output with no overrides (engine + `creative.ts diagnose()`); correct re-score with overrides; global-slider-still-works-with-no-per-client-override; drawer a11y (focus trap, ESC, keyboard).
  - *Demo-preview:* open drawer from a rec and from an entity row; toggle a threshold override → see re-score in BOTH Recommendations and Creative Lab.
- **Kill criterion:** if the threading can't keep P0 green / behavior drifts → ship per-client *targets* only (Wave 1), defer overrides. Wave 1 must stand alone.

### Wave 3 — accountability · **MEDIUM risk (architectural)**

- **Scope:** `HistoryStore` (local impl, **mode-namespaced**) + Decision & Outcome Ledger Tier 1 (record at `applySuggestion`/`dismissSuggestion`, additive fire-and-forget; capture `preMetrics`) · history in drawer + Activity/History view · Tier 2 calibration **design doc only** (separate calibration layer, A7) · backend schema documented in `META_INTEGRATION.md` (A6).
- **Dependency/risk:** Must NOT replace the session dedup Sets (`store.ts:48-49`) the feed depends on. **Item clarified:** W2 ships the drawer history section behind a stub returning `[]` ("no recorded decisions yet"), so W3 is a pure data wire-up, not a drawer refactor.
- **What proves it:**
  - *Tests:* ledger round-trip (record → reload → present); **`outcome === null` in demo is a tested invariant**; mode-segregation (demo decision never appears in live ledger).
  - *Demo-preview:* apply/dismiss → reload → decision appears in drawer + Activity view, outcome shows "pending."

---

## 5. The honesty firewall (final — locked)

1. **Attribution is correlational, not causal.** The ledger surfaces the realized trajectory ("after this pause, the client's 7d CPA moved X→Y") as a *signal*, explicitly labeled correlational — never a causal savings claim. Consistent with the shipped posture (`engine.ts:22-24`; `SuggestionCard.tsx:71` tooltip).
2. **Demo cannot demonstrate outcomes — outcome is strictly `null` in demo.** Verified: demo time is frozen (`metrics.ts:111-112` → `DATA_TODAY`), the dataset is memoized once per session (`dataset.ts:6-9`), and `demoProvider.applyAction` mutates only `status`/`dailyBudget` and writes **no insight rows** (`demoProvider.ts`). So a realized post-action trajectory genuinely cannot move in demo. **Locked: no simulated/illustrative outcome number.** UI shows "Outcome: pending — measured on live data over elapsed time." `outcome === null` in demo is a tested invariant. "Illustrative" is reserved for non-numeric explanatory copy only.
3. **Calibration must not overfit thin data** (Tier 2, design-only). A distinct, separately-clearable layer (`config.calibration`) resolved AFTER manual overrides, gated by a numeric min-sample N, a numeric bound, always disclosed ("engine nudged X by Y because Z (n=N) — revert") and reversible (drop the calibration layer without touching the buyer's hand-set values).

---

## 6. Locked non-negotiables for the build

1. **One config home.** `ConfigStore` persists; overrides apply onto `snapshot.clientById` `Client` objects. No parallel read source. Remove the `SettingsScreen.tsx:43` `clients: snapshot.clients` write.
2. **Async at the seam, sync in the selector path.** Hydrate config into zustand state in `init`/`applyProviderMode`; the engine never awaits.
3. **Engine threading = optional trailing `t = T` arg, resolved once in `analyzeClient`.** No `EngineContext` object. No new required positional. The 3-arg `analyzeAd` test signature stays untouched.
4. **`effectiveThresholds` reads the LIVE `THRESHOLDS`.** Precedence: live global → preset → explicit overrides. No captured copy / memoized snapshot.
5. **`creative.ts` gets the same resolved thresholds as the engine** (Wave 2). The `creative.ts:89` `0.9` hardcode stays fixed and documented.
6. **`breakevenRoas` is new work** — add the producer; correct the brief's "already wired."
7. **Entity name disambiguates by parent path, never a synthetic vN.** One `parentPath` selector, reused on card + drawer. Always show level chip + name + path; `showClient` controls only the client avatar.
8. **Drop `account` from drawer levels** (ad/adset/campaign/client only) unless an `accountById` index is added first.
9. **Drawer is store state, not URL.** It composes with `?entity=`; it does not replace it.
10. **Recording is additive** at `applySuggestion`/`dismissSuggestion`; the session dedup Sets stay as the live-feed source. **History is mode-segregated;** demo outcomes are `null`.
11. **The P0 suite (33 tests, currently green) is the guard.** Add the "identical with no config/overrides" test in Wave 1 (targets) and Wave 2 (thresholds + `creative.ts`) BEFORE wiring editors.
12. **Match-the-bar (L7).** The drawer is the one major new surface; net-new accessible slide-over chrome (focus-trap, ESC, `role="dialog"`, scroll-lock) must be built from scratch and feel native.

---

**Key file references:** engine `src/lib/ai/engine.ts` (T reads :64-248, `analyzeAd` :51, `analyzeClient` :350) · `src/lib/ai/creative.ts` (T reads :61-138, `0.9` :89, `creativePerformance` :28) · `src/lib/ai/thresholds.ts` (:74 `loadThresholds`, :81 `setThreshold`) · `src/lib/ai/llm.ts` (`NarrativeContext`/breakeven :34-55, no producer) · `src/app/store.ts` (:94 init, :137 applySuggestion, :189 dismiss, :205 setThreshold, :229 bumpSnapshot, :48-49 dedup Sets) · `src/lib/types.ts` (:13 EntityLevel, :43-49 Client targets, :300-320 Suggestion) · `src/lib/demo/generate.ts` (:74-82 indexes, no `accountById`; :143/:343 names) · `src/lib/provider/demoProvider.ts` (applyAction) · `src/lib/provider/liveProvider.ts` (:72 `LiveConfig.clients`) · `src/screens/SettingsScreen.tsx:43` (duplicate write) · `src/components/blocks/SuggestionCard.tsx:79` (hidden entity) · `src/screens/Recommendations.tsx:27-34,77` (Sets + `?entity=`) · tests `src/lib/__tests__/engineBehavior.test.ts:60,69` (3-arg `analyzeAd`).