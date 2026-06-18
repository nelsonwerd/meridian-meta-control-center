# Meridian v2 — Wave 2 Handoff (paste into a fresh chat to continue)

> Self-contained resume brief. If a chat hits limits mid-Wave-2, paste this into a
> new chat and continue. Read the listed files FIRST, then proceed from "Next step".

## Who / what
Meridian is an internal **AI Meta-ads command center** (React 18 + TS + Vite +
Tailwind + Zustand + Recharts) for an agency running Meta ads across multiple
Business Managers/clients. Demo-mode now (seeded deterministic dataset, anchor
`DATA_TODAY=2026-06-17`); a scaffolded live Meta path exists but `loadSnapshot`
throws at the documented structure-mapping last-mile (out of scope). The user runs
a performance agency; tone: blunt, honest, no overselling.

## Where we are
- **Branch:** `feat/v2-wave1` (pushed to `origin`). It is built on top of
  `hardening/prelive-backlog` (a prior hardening pass: Vitest+CI+ESLint, strict TS,
  engine/metrics correctness, a11y — also pushed, not yet merged to `main`).
- **Shipped & verified (Wave 1):** entity clarity on the rec feed (level chip +
  unique name + parent path; level filter), a **per-client config seam**
  (`src/lib/config/`) whose overrides apply ONTO the snapshot's `Client` objects,
  a **per-client targets editor** in Settings, and breakeven ROAS. 37 Vitest tests
  green; lint/tsc/build green.
- **Read these FIRST (the contract):**
  1. `docs/v2_roadmap/02_VALIDATED_ARCHITECTURE.md` — the build contract (locked
     decisions, the 4 corrections, §6 non-negotiables). **Authoritative.**
  2. `docs/v2_roadmap/03_PROMPT_PACK.md` — Wave 2 prompts (W2.1–W2.4).
  3. `docs/v2_roadmap/CONCEPT_BRIEF.md` — the why (4 themes, honesty firewall).
  4. `src/lib/ai/engine.ts`, `src/lib/ai/thresholds.ts`, `src/lib/ai/creative.ts`,
     `src/app/store.ts`, `src/lib/config/index.ts`, `src/components/blocks/SuggestionCard.tsx`,
     `src/screens/SettingsScreen.tsx`, `src/lib/selectors.ts`.

## Wave 2 scope (build to "the best it can be")
- ✅ **W2.1 — per-client threshold overrides threaded through engine + creative.** DONE (commit `4d5346c`): `effectiveThresholds`/`setActiveClientThresholds`/presets in `thresholds.ts`; engine + creative thread `t`; store wired; 42 tests green.
- ✅ **W2.2 — threshold-overrides + presets UI in Settings.** DONE (commit `8d06645`): per-client preset selector + expandable advanced overrides panel; verified live.
- ✅ **W2.3 — the entity-detail drawer (slide-over) + click-through.** DONE: accessible right slide-over (`EntityDrawer.tsx`, focus-trap/ESC/scroll-lock/`role=dialog`) opened from a store `drawer` field; opens from `SuggestionCard` (title + card body) and `Campaigns` rows (campaign/adset/ad name buttons). Verified live.
- ✅ **W2.4 — new higher-level engine rule.** DONE: `analyzeAudienceExpansion` (ad-set EXPAND_AUDIENCE — saturating narrow audience at in-target CPA); surfaces in the demo; 2 tests. The feed now shows recs across ad/adset/campaign/account levels.

## ✅ WAVE 2 COMPLETE
All four sub-phases shipped + verified (44 tests, lint/tsc/build green, live-checked). Branch `feat/v2-wave1` (pushed). **Next: Wave 3** (Decision & Outcome Ledger Tier 1 + Tier 2 design) per `03_PROMPT_PACK.md` — the drawer's history section is already a stub ready to wire.

## The threading approach (IMPORTANT — decided, may differ from a literal reading of 02)
The validated arch suggested an "optional trailing `t = T` arg." The chosen
implementation (cleaner, zero screen/test churn, consistent with how the GLOBAL
`THRESHOLDS` is already a store-mutated module global):
- `thresholds.ts` holds a module-level `activeClientThresholds` map + exports
  `setActiveClientThresholds(map)` (the store calls it in `init`/`applyProviderMode`/
  `setClientConfig`/`resetClientConfig`) and `effectiveThresholds(clientId)` =
  **live `THRESHOLDS` → preset delta → explicit `thresholdOverrides`** (most specific
  wins; reads LIVE THRESHOLDS so global sliders still move the base).
- `analyzeClient(ds, clientId)` (signature UNCHANGED) resolves `const t =
  effectiveThresholds(clientId)` once and passes `t` to the helpers via an optional
  trailing arg: `analyzeAd(ds, ad, client, t = T)`, `analyzeAdSets(ds, client, t = T)`,
  `analyzeReallocation(ds, client, t = T)`. Inside those, every `T.` becomes `t.`.
- `creative.ts`: `creativePerformance`/`nextBatchPlan` resolve `effectiveThresholds(clientId)`
  internally and pass `t` to `diagnose()`; the hardcoded `0.9` winner ratio
  (`creative.ts`) stays fixed (documented). This MUST be done or Creative Lab
  contradicts the Recommendations feed for a tuned client.
- Net: engine/creative public signatures + all screen call sites + the 37 tests
  stay byte-identical (no config set → `effectiveThresholds` returns base `THRESHOLDS`).

## Locked non-negotiables (from 02 §6 — do not violate)
1. ONE config home: `ConfigStore` persists; overrides apply onto `snapshot.clientById` Clients in place. (Done in W1.)
2. Async at the seam, sync in the selector path (engine never awaits).
3. `effectiveThresholds` reads the LIVE `THRESHOLDS`. Precedence: global → preset → explicit overrides.
4. `creative.ts` gets the same resolved thresholds as the engine; `creative.ts` `0.9` hardcode stays fixed.
5. Entity name disambiguates by parent path (done); drawer levels = ad/adset/campaign/client (NO `account` — no `accountById` index).
6. Drawer is **store state, not URL**; composes with the `?entity=` deep-link (Recommendations) — does not replace it.
7. Recording (Wave 3) is additive; **demo outcomes strictly `null`**. (Wave 3, not 2.)
8. The P0 suite (currently 37 tests) is the guard. Add "identical with no overrides" + "re-scores with overrides" for the engine AND creative.ts BEFORE/with the editor.
9. **Match the existing premium dark cockpit.** The drawer is the one major new surface — build accessible slide-over chrome (focus-trap, ESC, `role="dialog"`, scroll-lock) from scratch; reuse existing primitives (KpiTile, charts, SuggestionCard).
10. KILL CRITERION for W2.1: if threading can't keep the suite green / behavior drifts → ship per-client TARGETS only (already shipped in W1), defer overrides.

## Drawer contract (W2.3)
- Store: `drawer: EntityRef | null` + `openDrawer(ref)`/`closeDrawer()`. (`EntityRef`
  already exists in `types.ts`.)
- `EntityDrawer` right slide-over. Contents (bounded — no scope creep): header
  (level chip + entity name + `parentPath` + status) · KPI strip vs the client's
  targets · efficiency trend (timeseries over the entity's adIds via
  `adIdsForEntity`/`metricsForEntity`) · creative panel (ad → its one
  `CreativePerformance`; adset/campaign → cohort filtered to the subtree; client →
  omit or top creatives) · all recommendations for the entity (reuse `SuggestionCard`,
  via `analyzeClient` filtered to `entityId`/subtree) · a history section that is a
  STUB returning `[]` → "No recorded decisions yet." (Wave 3 wires real history.)
- Open from: `SuggestionCard` (its entity), Campaigns rows (campaign/adset/ad),
  Portfolio + Clients rows. Keep the existing `?entity=` deep-link working.

## Verification (after every sub-phase)
`npm run lint` + `npx tsc --noEmit` + `npm run test:run` (37+ green) + a live demo
preview (preview_start "dev"): 7 routes render, no console errors, apply/undo works,
editing a per-client threshold re-scores BOTH Recommendations and Creative Lab,
drawer opens from a rec + an entity row + is keyboard-navigable (focus trap, ESC).

## Commit convention
Branch `feat/v2-wave1` (or a fresh `feat/v2-wave2`). Phase-by-phase commits,
`area: subject`, trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
Commit only when the user confirms (the user has favored phase-by-phase commit+push).

## Next step
Begin (or resume) **W2.1**: add `effectiveThresholds`/`setActiveClientThresholds`/
presets to `thresholds.ts`; thread `t` through `engine.ts` (analyzeClient resolves;
analyzeAd/analyzeAdSets/analyzeReallocation take `t = T`, `T.`→`t.` inside) and
`creative.ts`; wire `setActiveClientThresholds(clientConfig)` into the store
(`init`, `applyProviderMode`, `setClientConfig`, `resetClientConfig`); add the
engine + creative "identical with no overrides / re-scores with overrides" tests.
Then W2.2 (UI), W2.3 (drawer), W2.4 (rules). Verify + (on user OK) commit each.
