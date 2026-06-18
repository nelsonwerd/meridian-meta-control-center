# Meridian Pre-Live Hardening — Validated, Corrected & Sequenced Plan

**Contract for the prompt-pack build.** Source brief: `/Users/drewnelson/autopilot-meta-control-center/docs/hardening/01_SCOPE_BRIEF.md`. Findings: `/Users/drewnelson/autopilot-meta-control-center/docs/hardening/00_FINDINGS.json`. All claims below re-verified against source on this tree (`tsc --noEmit` green at baseline, exit 0).

---

## 1. Verdict

**The draft plan is sound.** The P0→P6 backbone, the four locked non-negotiables, and the defer boundary (#02 live structure mapping) are all correct and grounded in the code. All four validation lanes independently rated confidence **8/10**; nothing in the plan needs to be scrapped or fundamentally re-architected. The corrections are scope/sequencing refinements, not reversals.

**Overall confidence to proceed: 8/10.**

**The 3 most important corrections (must-fix, would have broken the build or shipped a non-fix):**

1. **P1's `noUnused*` flip is under-scoped 3x and entangled with later phases.** The flip surfaces **12** `TS6133` errors (verified), not the 4 in #36. Eight are un-enumerated, and two clusters are owned by *later/deferred* phases: `store.ts:5 persistMode` is consumed only by P4's #27, and the 4 `liveProvider.ts:157-160` accumulators are the reserved home for **deferred #02** — they can neither be deleted nor left erroring. **Resolution: move the flip to a new final phase P6, after P4 consumes `persistMode` and P5 lands.**

2. **P0 cannot assert corrected behavior whose fix lands later.** The brief told P0 to test "currency offset" and "engine gating" asserting *correct* behavior, but `currencyOffset('HUF')` is fixed in P5 (#03/#07) and the DOA clause in P2 (#22). **Resolution: each behavior-changing finding ships its own behavior test in its own phase; P0 locks only what is NOT changing (plus the HUF/TWD=100 contract written as a deliberate xfail that flips to green in P5).**

3. **Two "complete" fixes are actually no-ops or partial as written.** #23's dedup keyed on `impactScore` is a no-op (it's `extraDaily`, identical across colliding budget-holder siblings — verified) — it **must** key on `confidence`. #18's `isNew` flag on `KpiDelta` alone changes nothing — the fabricated +100% surfaces in **three** render paths (Delta primitive, report prose, report `ordersDir`) that must each branch on it.

---

## 2. Corrections applied

| Ref | Problem | Resolution | Severity |
|---|---|---|---|
| **P1 → P6** `noUnused*` flip | Flip surfaces **12** `TS6133` (verified), not 4. `store.ts:5 persistMode` consumed only by P4/#27; `liveProvider.ts:157-160` accumulators are deferred-#02's reserved home (can't delete, can't leave). | **Move the flip to new final phase P6.** Delete genuinely-dead imports in P1 (#36 set + `report.ts:3 fmtShort`, `CreativeLab.tsx:6 Chip` & `:12 DIAGNOSIS_META`, `ClientDashboard.tsx:10 Sparkline` & `:14 today`, `PortfolioOverview.tsx:9 StatusBadge`, `SettingsScreen.tsx:224 Rule`). Flip in P6 only after P4 uses `persistMode` and P5 lands; annotate the 4 scaffold locals (do NOT delete). Gate: `tsc --noEmit` with flags on. | must-fix |
| **#07 / #03 → P5** (out of P0) | P0 testing `currencyOffset('HUF')` asserting correct value fails — fix is in P5. | P0 asserts only the already-correct contract; **HUF→100, TWD→100 written as xfail/skip-with-comment in P0**, flipped to passing in P5 alongside the `ZERO_DECIMAL` edit. P0 never pins the bug as a passing lock. | must-fix |
| **#22 → P2** (out of P0) | DOA clause `m7.purchases <= 1` fix is in P2; P0 can't assert post-fix gating. | P0 covers stable invariants (suggestion-mix coverage, unchanged scale/fatigue gating). The DOA-clause boundary assertion ships **with #22 in P2**. | must-fix |
| **#23** dedup key | `impactScore = extraDaily = proposed − holder.currentBudget` (engine.ts:163) is identical for every colliding sibling under one CBO/ABO holder → keying the reduce on it is a no-op, silently keeps first-seen again. Verified. | Fold colliding ids into a `Map<id,Suggestion>` keeping **max `confidence`** (engine.ts:171, scales with `m7.purchases`), placed before `sortSuggestions` (engine.ts:365). Do NOT key on `impactScore`. | must-fix |
| **#18** isNew completeness | Flag on `KpiDelta` alone is inert. `+100%` surfaces in 3 paths: Delta primitive (`primitives.tsx`, renders `Math.round(abs(deltaPct)*100)`), report prose (`report.ts:130 fmtDeltaPct(orders.deltaPct)`), report `ordersDir` (`report.ts:112`, from `.delta`). | One phase (P2) covers all three: add `isNew:boolean` to `KpiDelta` (types.ts:234) set in `kpiDelta` (metrics.ts:83) when `prev===0 && current!==0`; branch the Delta primitive to a "new" badge; special-case `isNew` in `composeNarrative`/summary. | must-fix |
| **#10** LiveConfig persistence | Two opposite readings; naive one ("wire `saveLiveConfig` from the token field") contradicts `META_INTEGRATION.md:46-53,126` (browser must never hold the Graph token). | **Persist the non-secret mapping** (`accounts[].clientId/adAccountId/businessId`, `clients[]`, `windowDays`) via `saveLiveConfig` inside `SettingsScreen.apply()`. Do **not** persist `defaultAccessToken` from the browser by default (keep token field dev-only or drop it; GRAPH_BASE repoints at a token-injecting proxy). Reconcile the "Connection" vs "Ad account mapping" strings (`liveProvider.ts:91`) while in-file. | must-fix |
| **#20** Undo gate location | "Gate Undo to demo mode" unplaced. Gating in `liveProvider.applyAction` (can't reach the store's restore closure) would be a silent no-op. | Place the gate in `store.ts applySuggestion` at the undo-construction site: only build the `undo` closure when `get().providerMode === 'demo'`. Keyed on the store's `providerMode` (store.ts:44, the canonical source) — **not** `snapshot.mode`. Demo restore path untouched. | must-fix |
| **P0 engine-gating suite** | `analyzeAd` (engine.ts) is **not exported**; only `analyzeClient`/`analyzeScope`/`sortSuggestions` are. A direct unit test can't reach the gating logic. | **Baseline (b):** test through `analyzeClient` against the seeded dataset asserting the suggestion-MIX invariant (≥1 PAUSE/DOA, ≥1 SCALE_BUDGET, ≥1 consolidation — `ensureCoverage` at generate.ts:400-408 guarantees this). **Plus (a) in P2:** export `analyzeAd` to unit-test the specific #22 DOA boundary the P2 change touches. | must-fix |
| **#12** computePacing extraction | `report.ts:82` has no divide-by-zero guard; `engine.ts:260` uses `Math.max(1, dayOfMonth)`. The two paths also gather MTD rows differently. Mirroring one site loses the guard or a second drift source. | Shared helper must: (a) apply `Math.max(1, dayOfMonth)`, (b) return full `{spent, projection, pace, dayOfMonth, daysInMonth}`, (c) use **one** MTD-row gather for both callers. P0 adds a `dayOfMonth=1` projection test pinning the guard. | should-fix |
| **#22** comment drift | Comment at the DOA block asserts "All three of the playbook's Trigger-C clauses... must hold" while code checks **four** (verified). Dropping the clause silently makes the comment accidentally-correct. | Drop `m7.purchases <= 1` AND rewrite the comment to state the three clauses (impressions + spend gate + CTR floor) and that purchase-count is intentionally NOT gated per Trigger C. | should-fix |
| **#11** thresholds delete scope | Brief says "dead/unused thresholds" broadly. `scaleCooldownDays` is an honest ledgered placeholder (engine.ts comment: "The cooldown half... isn't modelable... noted in the ledger" — verified). | Delete **only** `consolidateLearningDays` and `confidentPurchases` (both unreferenced in engine.ts — verified). **Keep** `scaleCooldownDays`; optionally annotate. Name the exact two in the P2 prompt. | should-fix |
| **#51** weekly-report icon | "Derive icon from the report's sentiment field if one exists" — no such field exists. `composeNarrative` returns only `{headline, summary}` (report.ts:135); `WeeklyReport` has no enum (verified). | Add a `direction: 'positive'\|'caution'\|'neutral'` return to `composeNarrative` aligned to its 5 headline branches; thread onto `WeeklyReport`; drive `WeeklyReportScreen.tsx:53,66-67` off it instead of the bespoke `up` boolean. | should-fix (this elevates the brief's "consider" to should-fix because the field must be created) |
| **#03/#19** sequencing | #03 ("prefer per-account `currency_offset`") is inert unless #19's node-GET fix lands first — both touch the same account-node block (`liveProvider.ts:166-178`), and #03's field would parse from `page.data` (undefined for a node) under the current edge-shaped call. | Within P5: fix #19 (node-GET) **first/fused**, THEN add `currency_offset` to the node fetch and thread it. Add `currency_offset?: number` as an **optional** field to `AdAccount` (types.ts:53-59) so the demo generator/`demoProvider` need no change. `applyAction` prefers `acct.currency_offset`, falls back to `currencyOffset(currency)`. | should-fix |
| **#06** rate-limit scope | Risk of over-building in-browser backoff the proxy architecture makes redundant (`META_INTEGRATION.md:116-126`). | Scope #06 to minimum: parse `X-Business-Use-Case-Usage` in `graphGet` into a typed shape + one backoff helper. Ledger that full throttle handling belongs in the proxy. No async report-job orchestration here. | consider |
| **#16 / #37** ClientDashboard collision | P2 (#16 freq label) and P4 (#37 maxHeight) both edit `ClientDashboard.tsx`. | Not a reorder. Scope #16's edit to the label map only (format.ts:94 / KPI strip — NEVER metrics.ts:41 math, per non-negotiable #3); P4 rebases on P2. | should-fix |
| **#27 / #10 / #20** shared surface | P4's #27 and P5's #10/#20 both edit `SettingsScreen.apply()` and `store.ts`. | Keep P4 before P5. P5 **rebases on P4**: #10 builds on the `apply()` shape P4 leaves; #20's gate reuses (not duplicates) any provider-mode check #27 introduces. | should-fix |
| **#17** date.ts importers | Extraction must update all importers, not just generate.ts. Verified importers of addDays: `selectors.ts:3`, `report.ts:3`; of daysBetween: `report.ts:3`, `engine.ts:13`. | New `src/lib/date.ts` is the home; update all four importers in the same P3 change (or re-export from metrics.ts for back-compat). Ship green. | consider |
| **Determinism model** (non-neg #1) | Brief says rng is "one stream"; it's actually per-entity via `rngFor(domain, id)`: `creatives`/client (gen:105), `struct`/client (gen:293), `acct`/`calib`/client, `daily`/ad.id (gen:469). Verified. | Reframe non-neg #1 (see §5). #32 perturbs only that client's `creatives` stream; `daily` insight math is stable unless the set of ad.ids or their bound creative profiles changes. | should-fix |
| **#33** determinism framing | The `?? pick(rng, creatives)` fallback (generate.ts:355-359) is **dead** (`nAds≤4`, `creatives≥7`) — consumes zero draws today. | Drop #33 from the "determinism hazard" framing. Fix must NOT reintroduce an rng draw — use a non-drawing fallback (`chosenCreatives[a % len]`) or a dev assertion. Determinism-neutral; needs no fixture regeneration. | should-fix |

---

## 3. Finalized phase plan (P0–P6)

> **Change from draft:** the `noUnused*` flip + `lint`/CI-hardening leaves P1 and becomes the new final phase **P6**. The draft's old P6 (manualChunks + LEDGER) merges into it. Net phase count unchanged (P0–P6). Each phase ships with `tsc --noEmit` green; the demo preview (`npm run dev`, 7 routes, apply/undo) is the no-regression gate after every phase.

### P0 — Safety net first
**Closes:** #01 (Vitest + scripts), #05 (CI), #40 partial (`.nvmrc` reconcile), and the *non-changing* half of #03/#07, #22 (lock-only). Establishes the net for everything downstream.
**Tasks (corrected):**
- Add `vitest` devDep; `test` + `test:run` scripts; `environment:'node'` test block in `vite.config.ts` (all P0 suites are pure — no jsdom). Reconcile `.nvmrc`=20 vs `engines.node>=18`.
- GitHub Actions: `npm ci && npm run build && npm test` on push/PR, Node pinned from `.nvmrc`.
- Write the four core suites — **invariant-based, not value-pinned** (see §4).
- **Export `analyzeAd`** from engine.ts (needed for the precise #22 boundary test that lands in P2; harmless additive export now).
**Verification:** `npm test` green; CI green on a push; `tsc --noEmit` green. The currencyOffset HUF/TWD=100 assertions are present as **xfail/skip-with-comment** (flip to pass in P5).
**Hazard:** Do NOT test reproducibility against `getDataset()` (module-memoized singleton — trivially passes). Test against the un-memoized `generateDataset()`. Do NOT pin seeded magic numbers — they break under P3/#32.

### P1 — Tooling hygiene (dead-code removal only)
**Closes:** #36 (dead imports/`Rule`), #40 (`.gitignore`/`.env.example`). **Does NOT flip `noUnused*`** (moved to P6).
**Tasks (corrected):**
- Delete genuinely-dead imports only: the #36 set (`PortfolioOverview.tsx:9 StatusBadge`, `ClientDashboard.tsx:14 today`, `CreativeLab.tsx:12 DIAGNOSIS_META`, `SettingsScreen.tsx:224 Rule`) **plus** `report.ts:3 fmtShort`, `CreativeLab.tsx:6 Chip`, `ClientDashboard.tsx:10 Sparkline`.
- Do NOT touch `store.ts:5 persistMode` (P4 consumes it) or `liveProvider.ts:157-160` accumulators (deferred-#02 home).
- Fix `.gitignore` / `.env.example` (#40).
**Verification:** `tsc --noEmit` green (flags still false). `git grep` confirms each deleted symbol has zero remaining references.
**Hazard:** Removing more than these seven, or flipping `noUnused*` here, breaks the build on the entangled five.

### P2 — Engine + metrics correctness
**Closes:** #22 (DOA clause + comment), #23 (SCALE dedup by confidence), #24 (REALLOCATE robustness), #12 (computePacing extraction), #11 (delete `consolidateLearningDays` + `confidentPurchases` only), #16 (frequency **label only**), #18 (`isNew` across all 3 paths), #47 (LLM breakeven gap), #51 (weekly-report icon via new `direction` field), #46 + #50 (comments).
**Tasks (corrected):** apply the per-fix corrections from §2 for #22, #23, #18, #12, #11, #51. #16: `format.ts:94` KPI_LABELS + surfaced labels (`ClientDashboard.tsx:89,93`, `WeeklyReportScreen.tsx:101`) — **never** `metrics.ts:41` math.
**Verification:** each behavior change ships its own Vitest assertion (DOA boundary via the now-exported `analyzeAd`; SCALE dedup keeps max-confidence sibling; `isNew` renders "new" not +100%; pacing `dayOfMonth=1` guard). `tsc --noEmit` green; demo preview clean.
**Hazard:** #16 is label-only (non-neg #3). P4 rebases on P2 for `ClientDashboard.tsx`.

### P3 — Data/domain shared utils
**Closes:** #17 (`src/lib/date.ts`), #35 (creative `nextBatchPlan` label), #32 (format weighting), #33 (sample underfill — now determinism-neutral).
**Tasks (corrected):**
- Create `src/lib/date.ts` as the home for `addDays`/`daysBetween`; update **all four** importers (`selectors.ts:3`, `report.ts:3`, `engine.ts:13`, `generate.ts:32` local copy) in the same change. Both copies are byte-identical/UTC-anchored.
- #33: non-drawing fallback (`chosenCreatives[a % len]`) — must NOT reintroduce an rng draw.
- #32: format weighting fix in the per-client `creatives` stream (generate.ts:111).
**Verification:** the P0 date-math + determinism suites (asserting reproducibility + structural invariants on `generateDataset()`) must stay green across the extraction and the #32 reorder. `tsc --noEmit` green.
**Hazard:** #32 perturbs only that client's `creatives` stream (and what it feeds). The P0 determinism suite survives because it asserts ranges/relationships, not seeded values.

### P4 — UX / a11y / perf
**Closes:** #04 (clickable rows → button/Link + ARIA + chart alt text), #13 (Tooltip keyboard/touch), #25 + #30 + #42 (memo dedup — constant-factor, no invalidation hazard), #26 (Sparkline edges), #27 (Settings apply-in-place, **use imported `persistMode`** + new in-place provider-swap store action), #28 (CreativeLab overflow), #08 (date-input color-scheme), #49 (toast pause-on-hover), #37 (`maxHeight`→`max-h-[60vh]`), #38 (`<div>`).
**Verification:** demo preview — all 7 routes, no console errors, apply/undo works; interactive elements are real controls with accessible names. `tsc --noEmit` green.
**Hazard:** #27's `apply()` and the new store action are the surface P5 rebases on. Rebase P4 on P2 for `ClientDashboard.tsx`.

### P5 — Live-provider hardening (small; defer #02 mapping)
**Closes:** #19 (node-vs-edge `graphGet`) **then** #03/#07 (per-account `currency_offset` + drop HUF/TWD from `ZERO_DECIMAL`), #09 (no-op write kinds → `ok:false`), #20 (2xx≠success + Undo gated to demo in `store.ts`), #21 (UTC→account timezone), #10 (mapping persistence — NOT token), #06 (rate-limit groundwork only).
**Tasks (corrected):** apply §2 corrections for #19→#03 ordering, #10 (mapping not token), #20 (gate in `store.ts applySuggestion` on `providerMode`), #06 (minimum groundwork). Add `currency_offset?: number` to `AdAccount`. Flip the P0 HUF/TWD=100 xfails to passing.
**Verification:** `tsc --noEmit` green; code review; the currencyOffset unit suite (now incl. HUF/TWD=100) green; demo Undo still works (P0 regression gate). **Everything here is ledgered as not-live-executed** — `loadSnapshot` still throws before any live snapshot (intended, honest).
**Hazard:** Do NOT touch the deferred-#02 scaffold accumulators. Per-account-offset wiring, node graphGet, and UTC→TZ are runtime-unreachable in live mode — typecheck/review-verified only.

### P6 — Strictness flip + build perf + docs honesty
**Closes:** #29 (`lint` alias / `noUnusedLocals`+`noUnusedParameters` true), #14 (`manualChunks`), #15 + #41 (clarifying comments), #39 (LEDGER refresh), confirm `META_INTEGRATION.md`.
**Tasks (corrected):**
- Flip `noUnusedLocals` + `noUnusedParameters` to true. By now `persistMode` is consumed (P4) and P5 has landed; annotate the 4 `liveProvider.ts:157-160` scaffold accumulators (`// @ts-expect-error` scaffold or guard) — **do not delete** (deferred-#02 home).
- Resolve the `lint` alias (lightweight ESLint flat config, or make the `tsc --noEmit` alias honest).
- `manualChunks` code-splitting (#14); refresh `docs/LEDGER.md` to the true new state incl. hardened-but-not-live-verified items.
**Verification:** `tsc --noEmit` **with the flags on** is the acceptance gate (must be exit 0); `npm run build` green; CI green.
**Hazard:** This is the only phase that can break the build via the flip — it is deliberately last so every consumer/owner has landed.

---

## 4. Test strategy (P0)

All four suites are **pure, `environment:'node'`, no jsdom**. Assertions are **reproducibility + structural invariants**, never pinned seeded values — this is what survives P3's #32 generator change.

| Suite | Target | Kind of assertion |
|---|---|---|
| **currencyOffset** (`liveProvider.ts`) | Static-map correctness | **Pinned values** (the map is a stable contract): zero-decimal `{JPY,KRW,VND,CLP,ISK,UGX}`→1; three-decimal `{KWD,BHD,JOD,OMR,TND}`→1000; default→100. **HUF→100, TWD→100 as xfail/skip in P0** (the regression gate that DRIVES the P5 fix), flipped to pass in P5. Per-account-offset (#03) is live-only → ledgered, not unit-tested. |
| **metrics aggregate / safeDiv** (`metrics.ts:16-46`) | Additive roll-up + rate guards | **Invariants:** `safeDiv(x,0)===0`; all derived rates (cpa/roas/ctr/frequency/holdRate) compute correctly from a known row set; `EMPTY_BUNDLE` for the zero-row case. |
| **date math** (`metrics.ts:107-166`) — *added by validation* | `addDays`/`daysBetween`/`previousRange`/`makeRange`/`enumerateDates` | **Invariants:** addDays crosses month/year UTC boundaries; daysBetween symmetric-magnitude & integer; `previousRange` returns equal-length, immediately-preceding, non-overlapping (`len = daysBetween+1`); `makeRange('today'/'yesterday')` → `start===end`; `enumerateDates` length `= daysBetween+1`. **Cheapest insurance for the P3 #17 extraction** — the new `date.ts` is verified by a green diff, not just a typecheck. |
| **engine gating** (`engine.ts` via `analyzeClient`) | Suggestion mix + determinism | **Invariants (option b baseline):** `analyzeClient` on each non-onboarding client yields ≥1 PAUSE/DOA, ≥1 SCALE_BUDGET, ≥1 consolidation (`ensureCoverage` guarantees the mix). **Reproducibility:** call `generateDataset()` twice, deep-compare a stable projection (sorted ad ids, per-ad summed spend/purchases rounded, total counts). **Structural:** every `Insight.date` within `[earliestDate(), DATA_TODAY]`; funnel ordering `impressions≥linkClicks≥landingPageViews≥addToCart≥purchases`; `reach≥1`. The precise #22 DOA-boundary unit test (using the exported `analyzeAd`) ships **in P2**, not P0. |

**Why these survive P3:** #32 perturbs only the per-client `creatives` stream; #33 is determinism-neutral. Range/relationship assertions hold regardless of which seeded value lands; pinned-snapshot assertions would force fixture regeneration and are forbidden.

---

## 5. Locked non-negotiables

1. **Determinism is a feature — per-entity, not one global stream (reframed).** The generator seeds independently via `rngFor(domain, id)`: `creatives`/client (generate.ts:105, where #32 lives), `struct`/client (293), `acct`/`calib`/client, `daily`/ad.id (469). Changing draw order/count within `makeCreatives` (creatives seed) or `generateForClient` (struct seed) shifts **that client's** creative selection and downstream structure; any change to the **set of ad.ids or their bound creative profiles** shifts that ad's `daily` insight stream. Daily insight math itself is stable unless inputs change. **Tests must assert reproducibility + structural invariants on `generateDataset()`, never pinned magic numbers and never `getDataset()` (memoized).**
2. **The store's shallow clone is intentional** — do not "fix" it into a deep clone.
3. **Frequency rename is label-only** — the engine fatigue gate reads `m7.frequency` vs `T.fatigueFrequency` (engine.ts; an EDITABLE_THRESHOLDS slider, 2.5–4.5) calibrated to the generator's daily-average output. Touch only the surfaced UI label (`format.ts:94` KPI_LABELS), never `metrics.ts:41`.
4. **Live code is ledgered, never claimed-as-run.** `loadSnapshot` throws before any live snapshot; all P5 fixes are typecheck/review-verified and ledgered not-live-executed.
5. **(New) The deferred-#02 scaffold is reserved, not dead.** The `liveProvider.ts:157-160` accumulators (`campaigns/adSets/ads/creatives`) and `void rawCampaigns` are the reserved home for the deferred live structure mapping. They are annotated (P6), never deleted.
6. **(New) The browser never holds the Graph token.** Per `META_INTEGRATION.md:46-53,126`. #10 persists the non-secret account mapping only; GRAPH_BASE repoints at a token-injecting proxy.
7. **(New) Each behavior-changing finding ships its own behavior test in its own phase.** P0 locks only what is NOT being changed; corrected-behavior assertions land with their fix (#22→P2, #03/#07→P5), written in P0 as xfail where they serve as the driving regression gate.
8. **(New) No fix may silently no-op.** Verified traps: #23 must key on `confidence` (not `impactScore`); #18 must update all three render paths; #20 must gate in `store.ts` (not `applyAction`); #03 requires #19 first; #33's fallback must not reintroduce an rng draw.

---

**Files cited (all absolute):** `/Users/drewnelson/autopilot-meta-control-center/src/lib/ai/engine.ts`, `/src/lib/metrics.ts`, `/src/lib/ai/report.ts`, `/src/lib/types.ts`, `/src/lib/provider/liveProvider.ts`, `/src/app/store.ts`, `/src/lib/demo/generate.ts`, `/src/lib/selectors.ts`, `/src/lib/ai/thresholds.ts`, `/src/lib/format.ts`, `/src/components/ui/primitives.tsx`, `/src/screens/WeeklyReportScreen.tsx`, `/src/screens/ClientDashboard.tsx`, `/src/screens/SettingsScreen.tsx`, `/tsconfig.json`, `/package.json`, `/docs/META_INTEGRATION.md`, `/docs/LEDGER.md`. This document is the build contract; the prompt-pack (`03_*`) sequences P0–P6 from it.