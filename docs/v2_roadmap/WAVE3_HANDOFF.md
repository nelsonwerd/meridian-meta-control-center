# Meridian v2 — Wave 3 Handoff (paste into a fresh chat to build Wave 3)

> Self-contained resume brief for **Wave 3 — Accountability: the Decision & Outcome
> Ledger**. Read the "Read first" files, then build from "Next step". Wave 1 + Wave 2
> are shipped; this is the last Wave-2-era piece. Theme #3 from the user's feedback
> ("can the system learn from what we actually do / keep a running analytical history").

---

## Who / what
Meridian is an internal **AI Meta-ads command center** (React 18 + TS + Vite +
Tailwind + Zustand + Recharts) for an agency running Meta ads across many Business
Managers/clients. Demo-mode now (seeded deterministic dataset, frozen "today"
`DATA_TODAY=2026-06-17`); a scaffolded live path exists but `LiveProvider.loadSnapshot`
throws at the documented structure-mapping last-mile (out of scope). User runs a perf
agency; tone: blunt, honest, **never oversell** (esp. "self-learning").

## Where we are
- **Branch:** `feat/v2-wave1` (pushed to `origin`; built on `hardening/prelive-backlog`). Do Wave 3 here or on a fresh `feat/v2-wave3` off it.
- **Shipped:** Wave 1 (entity clarity + level filter; per-client config seam `src/lib/config/`; per-client targets editor; breakeven ROAS) and Wave 2 (per-client threshold overrides + presets threaded through engine & `creative.ts`; the entity-detail drawer + click-through; an ad-set `EXPAND_AUDIENCE` rule). **44 Vitest tests green; lint/tsc/build green.**
- **Read FIRST (the contract):**
  1. `docs/v2_roadmap/02_VALIDATED_ARCHITECTURE.md` — §3c (HistoryStore interface + DecisionRecord schema), §5 (the honesty firewall), corrections **A4** (additive recording), **A5** (mode-segregation), **B2** (demo outcome strictly null), **A6** (backend schema doc). **Authoritative.**
  2. `docs/v2_roadmap/03_PROMPT_PACK.md` — W3.1 (ledger) + W3.2 (calibration design + backend schema docs).
  3. `docs/v2_roadmap/CONCEPT_BRIEF.md` — theme #3 + the 3-tier framing.
  4. Code: `src/lib/config/{types,localConfigStore,index}.ts` (the seam pattern to MIRROR), `src/app/store.ts` (recording hooks + session Sets), `src/components/shell/EntityDrawer.tsx` (the history STUB to wire), `src/screens/Recommendations.tsx` (the existing "Activity" panel), `src/lib/selectors.ts` (`metricsForEntity`), `src/lib/types.ts` (`EntityRef`).

## Wave 3 scope
- **W3.1 — Decision & Outcome Ledger (Tier 1):** a persisted `HistoryStore`; record every applied/dismissed/acknowledged decision (with a pre-action metric snapshot); show history in the drawer + an Activity/History view.
- **W3.2 — Tier 2 calibration DESIGN DOC ONLY + backend schema docs:** write `docs/v2_roadmap/CALIBRATION_DESIGN.md` and document the backend API/DB in `docs/META_INTEGRATION.md`. **No calibration code this round.**

## Architecture (mirror the ConfigStore seam — already in the repo)
```ts
// src/lib/history/types.ts
export type DecisionAction = 'applied' | 'dismissed' | 'acknowledged'
export interface DecisionRecord {
  id: string
  mode: 'demo' | 'live'                 // segregate demo (simulated) from live (real)
  clientId: string
  entityId: string
  level: EntityLevel
  suggestionType: SuggestionType
  severity: Severity
  action: DecisionAction
  confidence: number
  preMetrics: { cpa: number; spend: number; roas: number; purchases: number } // snapshot at decision time
  projected?: { metric: string; note?: string }
  decidedAt: string                     // pass an ISO timestamp in (Date.now allowed in app code)
  // Outcome is captured later, on LIVE data over elapsed time. STRICTLY null in demo.
  outcome?: { capturedAt: string; cpa: number; spend: number; roas: number; verdict: 'improved' | 'flat' | 'worsened' | 'inconclusive' } | null
}
export interface HistoryStore {
  record(d: Omit<DecisionRecord, 'id'>): Promise<DecisionRecord>
  forEntity(entityId: string): Promise<DecisionRecord[]>
  forClient(clientId: string): Promise<DecisionRecord[]>
  all(): Promise<DecisionRecord[]>
  attachOutcome(id: string, outcome: DecisionRecord['outcome']): Promise<void>
}
// src/lib/history/localHistoryStore.ts — localStorage, MODE-SEGREGATED keys
//   meridian.history.demo  /  meridian.history.live   (never mix; A5)
// src/lib/history/index.ts — createHistoryStore() (mirrors createConfigStore)
```
**Wiring (per 02 corrections):**
- `store.ts`: instantiate `const historyStore = createHistoryStore()` (module-level, like `configStore`). Record **additively, fire-and-forget** inside `applySuggestion` (on `res.ok`) and `dismissSuggestion` — `void historyStore.record({...})`. **Do NOT replace** `appliedSuggestionIds` / `dismissedSuggestionIds` (store.ts ~48-49) — they remain the in-session feed-dedup source the Recommendations feed depends on. Compute `preMetrics` at decision time via `metricsForEntity(snapshot, s.level, s.entityId, makeRange('7d'))` (the engine scores on the last 7 days). Stamp `mode: get().providerMode` and `decidedAt: new Date().toISOString()`.
- **Async at the seam, NOT in the sync selector path:** history reads (`forEntity`/`forClient`) load in a `useEffect` + Promise (the drawer, the Activity view) — never inside a sync `useMemo`/the engine.
- **Drawer:** in `EntityDrawer.tsx`, replace the "No recorded decisions yet" STUB with a `useEffect` that calls `historyStore.forEntity(entityRef.entityId)` (and consider subtree for higher levels) and renders each record: action + `decidedAt` + the pre-metrics, and the outcome as **"Outcome: pending — measured on live data over elapsed time"** when `outcome == null`.
- **Activity view:** extend the existing Recommendations right-rail "Activity" panel (currently shows `store.applied`) to read the persisted ledger, OR add a small History view. Keep it honest: show applied + dismissed.

## Honesty firewall (LOCKED — Wave 3's whole credibility rides on this)
1. **Demo outcomes are STRICTLY `null`.** Verified facts: demo "today" is frozen (`DATA_TODAY`), the dataset is memoized once (`dataset.ts`), and `demoProvider.applyAction` mutates only status/budget — it writes **no insight rows**. So a realized post-action trajectory genuinely cannot move in demo. **Do not synthesize/simulate an outcome number.** UI shows "pending — measured on live data." Make `outcome === null` in demo a **tested invariant**.
2. **Attribution is correlational, never causal.** When live outcomes land, the ledger shows the realized trajectory ("after this pause, 7d CPA moved X→Y") as a labeled *signal* — never "this action saved $Z."
3. **History is mode-segregated** (A5): a demo (simulated) decision must never appear in a live (real) ledger. Separate keys or filter by `mode`.
4. **Tier 3 ML is OUT.** Do not build or imply a trained model. Tier 2 (calibration) is **design-doc only** this round.

## Tier 2 calibration — design doc only (W3.2)
Write `docs/v2_roadmap/CALIBRATION_DESIGN.md`: a SEPARATE, separately-clearable layer
`config.calibration` (resolved AFTER manual overrides in `effectiveThresholds`),
gated by a numeric **min-sample N** and a numeric **bound**, always **disclosed**
("engine nudged X by Y because Z, n=N — revert") and **reversible** (drop the
calibration layer without touching the buyer's hand-set values). Also document the
backend API/DB in `META_INTEGRATION.md`: `client_config` + `decision_log` tables
(JSONB `pre_metrics`/`projected`/`outcome`, an `event` enum surfaced/applied/dismissed,
`workspace_id`/tenant scoping, `created_at`/`outcome_captured_at`). **No code.**

## Tests (add to the Vitest suite — currently 44 green)
- Ledger round-trip: `record(...)` → reload → `forEntity`/`forClient`/`all` return it.
- **`outcome === null` in demo is a tested invariant.**
- Mode-segregation: a `mode:'demo'` record never appears in a live-mode query.
- Recording is additive: applying still increments `appliedSuggestionIds` and fires the toast (don't regress the existing apply flow / 44 tests).

## Verification (after each sub-phase)
`npm run lint` + `npx tsc --noEmit` + `npm run test:run` (44+ green) + live demo preview
(`preview_start "dev"`): apply/dismiss a recommendation → reload → it appears in the
drawer's history + the Activity view with "Outcome: pending"; 7 routes render, no
console errors; `LiveProvider.loadSnapshot` still throws (deferred #02 intact).

## Locked non-negotiables (carry from prior waves)
- ONE config home (`ConfigStore` applies onto snapshot Clients); async-at-seam/sync-in-engine; `effectiveThresholds` reads LIVE `THRESHOLDS`; the store's shallow clone is intentional; match the premium dark cockpit; reuse existing primitives (`SuggestionCard`, `KpiRow`, `EntityDrawer`).
- Commit phase-by-phase, `area: subject`, trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; commit only when the user confirms; never commit to `main`.

## Next step
Build **W3.1**: create `src/lib/history/{types,localHistoryStore,index}.ts` (mirror
`src/lib/config/`); wire fire-and-forget `historyStore.record(...)` into
`store.applySuggestion` + `store.dismissSuggestion` with `preMetrics` + `mode` +
`decidedAt`; wire the `EntityDrawer` history section (useEffect → `forEntity`) and the
Recommendations Activity panel to the ledger; add the four tests (incl. the
`outcome===null`-in-demo invariant). Then **W3.2** the calibration + backend docs.
Verify + (on user OK) commit each. Acknowledge this brief + summarize your understanding
+ ask one clarifying question before you start.
