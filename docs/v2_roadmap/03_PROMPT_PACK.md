# Meridian v2 — Prompt Pack

> Self-contained, dependency-ordered build prompts for the v2 initiative. **Build
> contract:** [`02_VALIDATED_ARCHITECTURE.md`](02_VALIDATED_ARCHITECTURE.md) (read
> it — these prompts reference its locked decisions rather than repeat them).
> Concept + scope: [`CONCEPT_BRIEF.md`](CONCEPT_BRIEF.md). Branch off the current
> hardening branch (or main once merged). One prompt per fresh chat; verify; commit.

## RULES (inherited)
- **Read first:** the validated architecture doc + the files each prompt lists; verify file:line against current code before editing.
- **Do NOT commit** unless the user says so. Commit format `area: subject` + trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **No regression:** `npm run lint` + `npm run typecheck` + `npm run test:run` (33+ green) + demo preview (7 routes, no console errors, apply/undo) after every prompt.
- **Match the cockpit** (dark premium); reuse existing primitives. No emojis in source.

## LOCKED NON-NEGOTIABLES (from the validated architecture §6)
1. ONE config home: `ConfigStore` persists; overrides apply **onto `snapshot.clientById` Client objects**. Remove the `SettingsScreen.tsx:43` `clients: snapshot.clients` write.
2. Async at the seam, **sync in the selector path** — hydrate config into zustand in `init`/`applyProviderMode`; the engine never awaits.
3. Engine threading = optional trailing `t = T` arg, resolved once in `analyzeClient`. No EngineContext object; no new required positional. 3-arg `analyzeAd` test signature untouched.
4. `effectiveThresholds` reads the **live** `THRESHOLDS`. Precedence: **live global → preset → explicit overrides**.
5. `creative.ts` gets the same resolved thresholds (Wave 2). The `creative.ts:89` `0.9` hardcode stays fixed + documented.
6. `breakevenRoas` is NEW work (consumer exists in `llm.ts`, no producer).
7. Entity name disambiguates by **parent path**, never a synthetic vN. One `parentPath(snapshot, level, entityId)` selector reused on card + drawer. Always show level chip + name + path; `showClient` controls only the client avatar.
8. Drawer levels = **ad / adset / campaign / client** (no `account` — no `accountById` index exists).
9. Drawer is **store state, not URL**; composes with the `?entity=` deep-link, doesn't replace it.
10. Recording is **additive** at `applySuggestion`/`dismissSuggestion`; session dedup Sets stay the live-feed source. **History is mode-segregated; demo outcomes are `null`.**
11. The P0 suite (33 tests) is the guard. Add "identical with no config/overrides" tests BEFORE wiring editors.
12. The drawer is the one major new surface — build accessible slide-over chrome (focus-trap, ESC, `role="dialog"`, scroll-lock) from scratch.

---

## WAVE 1 — clarity & control (MEDIUM risk: stands up the config seam)

### W1.1 — Config seam + resolution layer (foundation)
**Read:** `02_VALIDATED_ARCHITECTURE.md` §3a/§3c, `src/app/store.ts` (`init` :94, `setThreshold` :205, `bumpSnapshot` :229), `src/lib/ai/thresholds.ts` (`loadThresholds`), `src/lib/types.ts` (Client), `src/lib/provider/index.ts` (seam pattern).
**Tasks:**
- Add `EntityRef { level: EntityLevel; entityId: string }` to `types.ts`.
- `src/lib/config/types.ts`: `ClientConfig` (targets + `thresholdOverrides?`/`preset?` for W2) + `ConfigStore` async interface.
- `src/lib/config/localConfigStore.ts`: localStorage impl (`meridian.config`), async signatures.
- `applyClientConfig(client, cfg): Client` — pure resolver (overrides defined fields only).
- Store: hydrate config in `init`/`applyProviderMode` into `clientConfig` state; apply onto `snapshot.clientById` Clients before first render; add `setClientConfig(cfg)`/`resetClientConfig(id)` actions that persist + re-apply + `bumpSnapshot` (mirror `setThreshold`).
**Test FIRST:** `analyzeScope(ds, scope)` with empty config deep-equals current output (id/type/severity/confidence/title); override one client's targetCPA → that client re-scores, others unchanged.
**Gate:** tests green, no behavior change with empty config, demo preview clean.

### W1.2 — Per-client targets editor + breakeven ROAS
**Read:** `src/screens/SettingsScreen.tsx` (incl. the :43 `clients` write to redirect), `src/lib/ai/llm.ts` (`NarrativeContext` breakeven consumer), W1.1 output.
**Tasks:**
- Settings: a per-client targets table/editor (CPA / ROAS / monthly budget / AOV / margin) writing through `setClientConfig`; live re-score.
- `breakevenRoas(client) = client.contributionMargin > 0 ? 1 / client.contributionMargin : undefined`; feed into the `NarrativeContext` assembly + show in the editor + ROAS KPI context.
- Redirect/remove the `SettingsScreen.tsx:43` `clients: snapshot.clients` write so `ConfigStore` is the single home (live `LiveConfig.clients` derived from it).
**Gate:** edit a target → screens re-score → reload → persists; breakeven unit test (guard margin 0); lint/types/tests/preview green.

### W1.3 — Entity clarity on the recommendation feed
**Read:** `src/components/blocks/SuggestionCard.tsx` (:79 hidden-entity block), `src/screens/Recommendations.tsx` (filters), `src/lib/selectors.ts`, `src/lib/demo/generate.ts` (:80-82 indexes, :143/:343 names).
**Tasks:**
- `parentPath(snapshot, level, entityId): string` selector (ad → "AdSet · Campaign"; adset → "Campaign"; campaign/client → as apt).
- Restructure `SuggestionCard`: always render **level chip + entity name + parentPath** in its own row; `showClient` controls only the client avatar; client-scoped path stops at campaign.
- Add a **level filter** (Ad / Ad set / Campaign / Account) to Recommendations beside the existing group/severity filters.
**Gate:** every card shows level + specific entity in ALL scopes (portfolio, bm, client dashboard, weekly report); level filter works; preview clean.

---

## WAVE 2 — drawer & per-client tuning (HIGH risk: the engine refactor)

### W2.1 — effectiveThresholds + engine/creative threading (the riskiest edit)
**Read:** `02_VALIDATED_ARCHITECTURE.md` §3b, `src/lib/ai/engine.ts` (T reads, `analyzeAd` :51, `analyzeClient` :350), `src/lib/ai/creative.ts` (T reads :61-138, `creativePerformance` :28, the `0.9` :89), `src/lib/ai/thresholds.ts`.
**Tasks:**
- `effectiveThresholds(clientId, config) = { ...THRESHOLDS(live), ...presetDelta, ...thresholdOverrides }` (precedence locked).
- Thread as optional trailing `t = T` arg: resolve once in `analyzeClient`, pass to `analyzeAd/AdSets/Reallocation/Pacing/Anomalies`. Resolve at top of `creativePerformance`, pass to `diagnose()`/`nextBatchPlan()`. `creative.ts:89` `0.9` stays fixed (comment it).
**Tests:** identical engine + `creative.ts` output with no overrides; correct re-score with overrides; global slider still moves the base for un-overridden clients; client isolation.
**Gate (kill criterion):** if P0 can't stay green / behavior drifts → STOP, ship per-client targets only, defer overrides. Else lint/types/tests/preview green.

### W2.2 — Threshold overrides + presets UI
**Tasks:** per-client threshold override controls + conservative/balanced/aggressive presets in Settings (writing `thresholdOverrides`/`preset` via `setClientConfig`); disclosure of base-vs-override; reset.
**Gate:** override re-scores BOTH Recommendations and Creative Lab; preset shifts the bundle; reload persists.

### W2.3 — Entity-detail drawer + click-through
**Read:** `02_VALIDATED_ARCHITECTURE.md` §3d, `src/lib/selectors.ts` (`adIdsForEntity`/`metricsForEntity`), `SuggestionCard.tsx`, `Campaigns.tsx`, `src/app/store.ts`.
**Tasks:**
- Store: `drawer: EntityRef | null` + `openDrawer/closeDrawer`.
- `EntityDrawer` slide-over: accessible chrome (focus-trap, ESC, `role="dialog"`, scroll-lock). Contents (bounded): header (level chip + name + parentPath + status) · KPI strip vs client targets · efficiency trend · creative panel (per-level per §D5) · all recs for the entity (`SuggestionCard`) · history section (stub returning `[]` → "no recorded decisions yet").
- Wire open from `SuggestionCard`, Campaigns rows (campaign/adset/ad), Portfolio/Clients rows. Composes with `?entity=` (don't move drawer to URL).
**Gate:** open from a rec and an entity row at each level; a11y (keyboard, focus trap, ESC); preview clean.

### W2.4 — New higher-level engine rules (scoped, additive)
**Tasks:** add campaign-level (structure/scaling) and ad-set-level (audience-expansion) rules as additive functions like `analyzeAdSets`/`analyzeReallocation`; each ships its own test + the suggestion-mix invariant updated.
**Gate:** new types surface with sane severity; existing tests green.

---

## WAVE 3 — accountability (MEDIUM risk, architectural)

### W3.1 — Decision & Outcome Ledger (Tier 1)
**Read:** `02_VALIDATED_ARCHITECTURE.md` §3c/§5, `src/app/store.ts` (`applySuggestion` :137, `dismissSuggestion` :189, dedup Sets :48-49), `src/lib/selectors.ts`.
**Tasks:**
- `src/lib/history/{types,localHistoryStore}.ts`: `HistoryStore` async; localStorage **mode-segregated** (`meridian.history.demo`/`.live`) or a `mode` field + filter. `DecisionRecord` per the schema; `outcome` strictly `null` in demo.
- Record additively (fire-and-forget) in `applySuggestion`/`dismissSuggestion`; compute `preMetrics` via `metricsForEntity`. Keep the session dedup Sets as the feed source.
- Drawer history section reads `HistoryStore.forEntity` (useEffect + Promise); add an Activity/History view (or extend the existing Recommendations Activity panel).
**Tests:** record → reload → present; **`outcome === null` in demo is a tested invariant**; demo decision never appears in a live ledger.
**Gate:** apply/dismiss → reload → appears in drawer + Activity with "Outcome: pending"; preview clean.

### W3.2 — Tier 2 calibration design + backend schema docs (DESIGN ONLY)
**Tasks:** write `docs/v2_roadmap/CALIBRATION_DESIGN.md` — the separate, separately-clearable `config.calibration` layer (resolved AFTER manual overrides), numeric min-sample N + bound, disclosure + reversibility. Document the backend API/DB schema (`client_config`, `decision_log` + `event`/tenancy gaps from §A6) in `META_INTEGRATION.md`. **No calibration code this round.**
**Gate:** docs only; no behavior change.

---

## Combined verification (after each wave)
Lint + typecheck + `test:run` (incl. new identical-with-no-config / outcome-null invariants) green; CI green; demo preview: 7 routes, no console errors, apply/undo, edit-a-target re-scores, drawer opens + is keyboard-navigable; `LiveProvider.loadSnapshot` still throws (deferred #02 intact).
