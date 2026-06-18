# Lane 5 — Code Correctness, Robustness & Maintainability

Auditor: Lane 5 specialist. Scope: `src/` correctness/soundness beyond the 8 already-fixed
defects in `docs/LEDGER.md`. Pure research — no code edited. Every load-bearing claim below
was verified by reading the code and, where noted, by **running the actual modules through
esbuild+node** (probes reproduced in-text), or by grepping the build output.

Method note on ground truth: I bundled the real generator/engine/metrics/format/report/creative
modules and executed them in node to confirm data shape, edge-case math, and the staleness
mechanism. I grepped `dist/` for the debug surface and ran `tsc --noEmit` (exit 0). 9 of the
13 findings below are code-run-verified; the rest are read-verified (React render semantics).

---

## BLOCKER / HIGH

### H1 (HIGH) — Apply does not invalidate the screen memos; the dashboards go stale after a write

This is the central correctness defect in the app's headline interaction ("one-click apply").

**Mechanism, fully traced:**
- `DemoProvider.applyAction` mutates the snapshot **in place**: `c.dailyBudget = req.proposedBudget`,
  `c.status = status`, `a.status = status` (`src/lib/provider/demoProvider.ts:31, 38, 62-70`). The
  `Snapshot` object reference never changes.
- `store.applySuggestion` reacts by `version: st.version + 1` and adding to `appliedSuggestionIds`
  (`src/app/store.ts:129-136`). It does **not** replace `snapshot` and does **not** touch
  `dismissedSuggestionIds`.
- `useSnapshot()` subscribes to `version` to force a re-render but **returns the same object**
  (`src/app/hooks.ts:6-10`). So after apply: component re-renders, but `snapshot` is referentially
  identical.
- Every screen derives its data inside a `useMemo` whose dep array contains `snapshot` (stable),
  `scope` (stable), `range` (stable) and `dismissed` (unchanged by apply). The memo therefore
  **returns its cached value** — the just-applied change is invisible until the user changes scope,
  range, or dismisses something.

Run-verified: mutating a campaign budget in place leaves `snapshot === snapshot` true; and pausing
an ad drops `analyzeClient` output from 10 → 9 suggestions *only when re-derived* (probe output:
"suggestion count before/after re-derive: 10 -> 9").

**Per-screen impact (read-verified against each dep array):**
- `PortfolioOverview` deps `[snapshot, scope, range, dismissed]` (`src/screens/PortfolioOverview.tsx:54`)
  → KPIs, suggestions, client table all **stale** after apply.
- `ClientDashboard` deps `[snapshot, client, range, dismissed]` (`src/screens/ClientDashboard.tsx:50`)
  → campaign-budget cell, KPIs, "Recommended actions" **stale**.
- `Recommendations` deps `[snapshot, scope, dismissed]` (`src/screens/Recommendations.tsx:32`)
  → list isn't re-derived; the applied card flips to "Applied" only because `SuggestionCard` reads
  `appliedSuggestionIds` directly (`SuggestionCard.tsx:46`), but the card **stays in the list** and
  the Critical/High/Medium count tiles **do not change**.
- `ClientsDirectory` deps `[snapshot, range]` (`ClientsDirectory.tsx:39`) → metrics-only, low impact.

**Why it *looks* like it works in the smoke test:** the LEDGER's "apply increments Applied 0→1 and
flips the card to Applied" is true and is driven by `appliedSuggestionIds` (a fresh `Set`), not by
re-derivation. So the *acknowledgement* is live while the *numbers* are stale — exactly the kind of
gap a buyer hits on day one ("I raised the budget, why does the campaign still show $2,310/day and
still recommend scaling?").

**Inconsistency that masks the bug in one place:** `Campaigns` calls `clientsForScope(snapshot, scope)`
**unmemoized on every render** (`Campaigns.tsx:25`) and feeds that fresh array into the `campaignRows`
memo dep list (`:42`). Because the array identity changes every render, that memo recomputes every
render, so the Campaigns grid *does* reflect a budget/status change — but its `suggestionByEntity`
memo (deps `[snapshot, scope]`, `:32`) does **not**, so the AI "sparkle" flags go stale on the same
screen. So the app is internally inconsistent about whether apply is reflected.

**Recommendation:** add `version` (from `useStore(s => s.version)`) to the dependency array of every
derivation memo that reads snapshot-mutable state — or, cleaner, have `useSnapshot()` return a value
that changes identity on bump (e.g. `useStore(s => (s.version, s.snapshot))` won't change identity;
instead store a shallow clone on apply, or expose `useSnapshotVersion()` and include it in deps).
The simplest correct fix: in `applyAction` success, `set({ snapshot: { ...snapshot } })` so the
reference changes and all `[snapshot]`-keyed memos invalidate uniformly. That also fixes the
`Campaigns`/everyone-else inconsistency in one move.

### H2 (HIGH) — No React error boundary: one throwing screen white-screens the app's chrome

Grep confirms **zero** error boundaries in `src/` (`ErrorBoundary|errorElement|componentDidCatch|
getDerivedStateFromError` → no matches). The router (`src/app/router.tsx:11-28`) defines **no
`errorElement`** on the layout route or any child. `AppShell` renders `<Outlet/>` bare
(`AppShell.tsx:32`).

Consequence: a render-time throw in any screen is caught by React-Router's *default* fallback, which
replaces the **entire** matched tree — including the Sidebar/TopBar chrome — with RR's bare
"Unexpected Application Error" page. For an internal cockpit the operator's team runs their day from,
a single bad selector or a malformed live row would blank the whole tool rather than degrading one
panel. The codebase is full of non-null assertions on map lookups that assume the demo's internal
consistency (`ds.campaignById.get(ad.campaignId)!` in `engine.ts:35`; `ds.clientById.get(...)!` in
`creative.ts:29`, `report.ts:28`; `clientById.get(c.clientId)!` in `Campaigns.tsx:40`). In demo these
are safe, but they are exactly the lines that throw first on real/partial live data — and there is no
boundary to contain them.

**Recommendation:** add an `errorElement` to the layout route (keeps Sidebar/TopBar mounted) **and**
wrap `<Outlet/>` in a class `ErrorBoundary` with a "this panel failed — reload / return to demo"
fallback. Cheap, high-leverage for a tool about to be handed to testers.

---

## MEDIUM

### M1 (MEDIUM) — `fmtMetric('frequency', NaN)` renders the literal string "NaN"

`src/lib/format.ts:68-69`: the `frequency` branch returns `v.toFixed(2)` with **no `isFinite`
guard**, unlike every other branch (`fmtCurrency`/`fmtNumber`/`fmtPercent`/`fmtRoas` all guard at
their top). Run-verified: `fmtMetric('frequency', NaN)` → `"NaN"` (probe output), whereas
`fmtCurrency(NaN)`, `fmtRoas(NaN)`, etc. correctly return `"—"`.

In demo, `aggregate` derives `frequency = safeDiv(impressions, reach)` which can't be NaN (safeDiv
returns 0 when reach=0). So this is latent, **not** currently visible in demo. But: (a) the live
provider sets `frequency` from Meta's raw `frequency` field path indirectly and reach can legitimately
be 0 on zero-delivery days; (b) `KpiRow`/`ClientDashboard` render frequency via this exact path
(`ClientDashboard.tsx:92`, `KpiRow` → `fmtMetric`). A single NaN leaks a raw "NaN" into the cockpit.

**Recommendation:** add `if (!isFinite(v)) return '—'` to the top of `fmtMetric`, or guard the
`frequency`/`default` branches. One line.

### M2 (MEDIUM) — Applied scale/budget suggestions are never retired and can re-recommend themselves

Suggestion ids are deterministic by `type + entityId` (`engine.ts:45-47`), e.g.
`sg_SCALE_BUDGET_cmp_forge_1` (run-verified). Apply adds the id to `appliedSuggestionIds` but **not**
`dismissedSuggestionIds`, and the engine reads live budget via `budgetHolder` (`engine.ts:34-41`).
So after a re-derive (which *will* happen the moment scope/range changes — see H1), the engine
recomputes the SCALE rule against the **new, raised** budget and **re-emits the same id** if the ad
still clears the CPA bar. The card un-flips from "Applied" (because the filter is on `dismissed`, not
`applied`) and offers to scale again — an infinite "scale +20%" loop with no cooldown.

Note the LEDGER already concedes the SCALE *cooldown* (days-since-last-scale) is unmodelled. This is
the UI-side consequence: nothing records "you already acted on this entity," so the recommendation
resurfaces. A media buyer would reasonably double-apply.

**Recommendation:** filter out `appliedSuggestionIds` from rendered lists the same way `dismissed`
is filtered, OR have apply also add to a per-entity "recently acted" set the engine respects for a
cooldown window. At minimum, exclude applied ids from `analyzeScope` results in the screens.

### M3 (MEDIUM) — "Today" is hard-anchored to `DATA_TODAY`; live mode would compute every window against a frozen 2026-06-17

`today()` returns the constant `DATA_TODAY` unconditionally (`metrics.ts:103-105`, importing the
hardcoded `'2026-06-17'` from `generate.ts:29`). The **entire** windowing layer is built on this:
`makeRange`, `previousRange`, `lastNDays`, `earliestDate`, and the AI engine's `lastNDays(3/7/14)`
gates (`engine.ts:54-57`), plus the weekly report's `lastCompletedWeek`/pacing (`report.ts:16-21,
77-82`). Meanwhile `LiveProvider.loadSnapshot` pulls insights against the **real** wall-clock via
`isoDaysAgo(new Date())` (`liveProvider.ts:163-164, 268-272`).

So if live mode ever loads, the data window would be "real last 90 days" but every analysis/range
selector would slice it relative to a **frozen June 2026 anchor** — silently misaligned (e.g. "Last
7 days" would resolve to a window that may be entirely outside the fetched data after mid-2026,
yielding all-zero KPIs and zero suggestions with no error). This is a demo→live boundary leak baked
into the metrics core, not just the demo seed. `loadSnapshot` currently throws at the structure
last-mile so it isn't reachable today, but it's a trap for whoever finishes the live wiring.

**Recommendation:** make the anchor provider-aware — `today()` should return `DATA_TODAY` in demo
mode and `new Date()` (the snapshot's `generatedAt`) in live. Thread the snapshot's `generatedAt`
into the metrics layer rather than importing a demo constant. Document this prominently next to the
LiveProvider last-mile note.

### M4 (MEDIUM) — `enumerateDates` 800-iteration guard silently truncates long custom ranges; `timeseries` does not

`enumerateDates` caps at `guard < 800` (`metrics.ts:117-126`). The demo window is only 90 days so
this never bites in demo, and the custom-range picker clamps to `earliestDate()`..`today()` (90 days)
(`DateRangeMenu.tsx:68-80`). But: (a) the guard **silently** stops rather than erroring, so a future
widening of the window or a live range > 800 days would drop trailing dates from charts with no
signal; (b) `timeseries` enumerates over the same range (`metrics.ts:58`) and would render a chart
that's missing its most recent points — a silent correctness hole exactly like the `graphGet`
truncation that Round 1 fixed by *throwing*. The fix pattern is already established in this codebase.

**Recommendation:** mirror the `graphGet` fix — throw (or at least surface) past the guard instead of
truncating, and/or raise the cap and tie it to the actual window length.

### M5 (MEDIUM) — Maintainability: derivation logic re-runs fully on every render; the memos provide little protection

Because of H1's identity-stability, on the renders where memos *don't* fire they correctly skip work —
but several hot paths bypass memoization entirely. `clientsForScope` is called unmemoized on every
render in `Campaigns` (`:25`), `CreativeLab` (`:25`), `WeeklyReportScreen` (`:20`), and its fresh
array forces dependent memos to recompute every render anyway (e.g. `Campaigns.campaignRows` re-runs
`metricsForEntity` over every campaign each render). `ScopeSwitcher` runs `metricsForScope` for
**every client** on every render while the dropdown is open (`:78`). `PortfolioOverview` recomputes a
full `timeseries` per client plus two `metricsForScope` per client inside one memo (`:40-47`). These
are O(insights) scans (≈13.5k rows) repeated per client. In demo it's tolerable; on a real book with
more clients/longer windows it will visibly jank the scope dropdown and the portfolio table. The
mixed memoized/unmemoized strategy also makes the staleness behavior (H1) screen-dependent and hard
to reason about — a maintainability liability.

**Recommendation:** memoize `clientsForScope` results (it's pure on `[snapshot, scope]`), and treat
`analyzeScope`/`timeseries` as the heavy calls they are. Fixing H1 via a snapshot-clone-on-apply also
makes `[snapshot]` a sound single cache key and removes the need to thread fresh arrays through deps.

---

## LOW

### L1 (LOW) — Weekly digest "up" indicator reads zero-change weeks as growth

`WeeklyReportScreen.tsx:53`: `const up = r.kpis.purchases.delta >= 0 && r.kpis.cpa.delta <= 0`. When
a client has identical (or zero) orders week-over-week, both deltas are 0, so `up` is `true` and the
card shows a green ↑ "growth" chip and the narrative path picks "Efficient growth." Run-verified that
`kpiDelta` returns `delta:0, deltaPct:0` for equal inputs. Misleading rather than crashing, but for a
report the operator forwards to clients it overstates a flat week as a win. (For Bloom & Branch the
demo happens to produce a "Soft week" headline, so it's not visible there, but the logic is wrong at
the boundary.)

**Recommendation:** treat `|delta|` below a small epsilon as "flat" (neutral), matching the existing
`deltaIsGood` epsilon convention (`metrics.ts:94`).

### L2 (LOW) — "Onboarding" client has a full 90-day, full-volume history that contradicts its label

`Bloom & Branch` (`c_bloom`, status `onboarding`, startDate `2025-05-05`) is run-verified to have 2
campaigns, 4 ad sets, 12 ads, 7 creatives, **973 insight rows**, and **$49,387 spend / 1,425 orders
over 28 days** — i.e. indistinguishable in volume from a mature account. `ensureCoverage` returns
early for onboarding (`generate.ts:409`) so it lacks the guaranteed testing-campaign/consolidation
mix, but the daily insight generator still fills the **entire** window for it
(`generateInsights` ignores `client.startDate`, `generate.ts:454-522`). A reviewer who clicks the one
"onboarding" client expecting a thin/ramping account sees a fully-loaded one — an internal-consistency
gap in the demo narrative (the screens render fine; this is a believability defect, not a crash).

**Recommendation:** gate insight generation by `startDate` (or a shorter `activeFrom`) for onboarding
clients so the demo's "onboarding" label matches a visibly ramping data shape.

### L3 (LOW) — `useClickOutside` listens on `mousedown` but doc-level handlers can race menu toggles

`useClickOutside` binds `mousedown` (`useClickOutside.ts:13`); the trigger buttons toggle on `click`.
On the same pointer interaction, `mousedown` (outside-check, menu already open) fires before the
button's `click`, which can immediately re-close/re-open in edge cases (double-toggle). Not observed
as broken in the smoke test, but it's a known footgun with this pattern. Low severity; flagged for
maintainability.

**Recommendation:** either ignore the trigger element in the outside-check or switch the trigger to
`onMouseDown`/use `pointerdown` consistently.

---

## NOTES (verified non-issues — do NOT "fix")

- **Debug surface is correctly stripped from production.** `window.__meridian` is loaded only via
  `if (import.meta.env.DEV) void import('./lib/debug')` (`main.tsx:8-10`); grep of `dist/` confirms
  **no** `__meridian` token in the built bundle. The demo→live debug leak the prompt worried about
  does not exist in production. (Ground-truth: grep on `dist/assets/index-*.js`.)
- **Number formatting is robust on extremes except M1.** Run-verified: `fmtCurrency(NaN|Infinity)`,
  `fmtNumber(NaN)`, `fmtPercent(NaN)`, `fmtDeltaPct(NaN|Infinity)`, `fmtRoas(NaN)` all return `'—'`.
  Zero inputs render sanely (`$0.00`, `0.0%`, ROAS `—`). Only `fmtMetric('frequency', NaN)` slips
  (M1).
- **Single-day & empty ranges don't crash.** Run-verified: `makeRange('today')` →
  `2026-06-17..2026-06-17`, `timeseries` returns exactly 1 point; `previousRange` of a single day is
  the prior single day; an all-future/empty range aggregates to zeros (no NaN). `Sparkline` handles
  length-0 (returns empty `<svg>`, `Sparkline.tsx:20`) and length-1 (valid single-point path,
  `:25`). `AllocationDonut` guards `total || 1` (`:55`).
- **No empty-suggestion client in demo, but the empty path is wired.** Run-verified every client
  (incl. onboarding) yields ≥7 suggestions; `EmptyState` fallbacks exist on every list
  (`PortfolioOverview.tsx:167`, `ClientDashboard.tsx:184`, `Recommendations.tsx:101`) so a
  filtered/dismissed-to-empty state renders cleanly.
- **Suggestion dedup holds at the portfolio level.** Run-verified 79 total = 79 unique ids, 0 dups
  (matches LEDGER). The Round-1 dedup (`engine.ts:254-256`) is sound.
- **`tsc --noEmit` exits 0.** Re-verified.
