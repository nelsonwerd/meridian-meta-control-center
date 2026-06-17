# Lane 3 — Product / Feature Completeness & Effectiveness

Auditor lane: does Meridian cover everything the operator asked for, plus the
highest-value things he didn't name? Pure research; no code edited. Every
load-bearing claim is cited to `file:line` and was verified by reading the code,
not inferred. Prior rounds' 8 defects are not re-surfaced; this goes deeper on
soundness, effectiveness, and gaps.

Source of asks: `docs/CONCEPT_BRIEF.md`, `docs/00_KICKOFF.md`.

---

## A. Original-ask coverage map

Legend: **Present** = built and wired; **Partial** = exists but materially
incomplete or not what the words promise; **Absent** = not built.

| # | Operator ask | Status | Evidence |
|---|---|---|---|
| 1 | Multi-client / multi-BM cockpit | **Present** | `ScopeSwitcher.tsx:62-103` groups clients under each BM (agency vs partner); `store.ts:73` defaults to portfolio scope; `types.ts:362-366` Scope = portfolio \| bm \| client. Every screen reads `useStore(s=>s.scope)`. |
| 2 | KPI dashboards down to the creative | **Present** | Portfolio (`PortfolioOverview.tsx`), client (`ClientDashboard.tsx`), campaign→adset→ad drill (`Campaigns.tsx:99-167`), creative gallery + per-creative funnel (`CreativeLab.tsx`, `CreativeThumb.tsx`). Full DTC KPI set incl. hook/hold rate derived in metrics (`types.ts:203-227`). |
| 3 | One-click AI suggestions: spend / structure / creative | **Present (math) / Partial (creative depth)** | 7 live suggestion types in `engine.ts` (scale/cut/pause/fatigue/consolidate/reallocate/watch) each with one-click `apply` (`SuggestionCard.tsx:110`, `store.ts:113-144`). BUT `NEW_CREATIVE_ANGLE`, `FIX_LANDING_OFFER`, `EXPAND_AUDIENCE` are declared types (`types.ts:256-258`) the engine never emits — creative/audience advice only surfaces in Creative Lab prose, not as actionable recommendation cards. |
| 4 | Real-time analysis daily / weekly / monthly | **Partial** | Daily/weekly windows exist (`DateRangeMenu.tsx:9-16`: today/7d/14d/28d/MTD). The engine reasons on 3d/7d/14d windows (`engine.ts:54-57`). **Monthly is missing as a selectable lens** despite 90 days of seeded data (`generate.ts:30 WINDOW_DAYS=90`); max preset is 28d, so a buyer cannot view a 30/60/90-day trend or a calendar-month comparison. "Real-time/continuous" is on-demand only (no background measurement — see B1). |
| 5 | Weekly Monday report per client | **Present** | `report.ts:buildWeeklyReport` (WoW deltas, movers, creative leaderboard, recs, pacing, narrative) rendered in `WeeklyReportScreen.tsx` as a Monday digest + full per-client report. |
| 6 | Push changes back to Meta | **Present (scaffold) / honest** | `applyAction` path wired demo→provider (`store.ts:113-144`); LiveProvider write POSTs implemented but not executed; labelled "simulated in demo." Correct per non-goals. |
| 7 | Demo-seeded + API-ready | **Present** | DataProvider seam (`provider/index.ts`, `demoProvider.ts`, `liveProvider.ts`); mode toggle in Settings (`SettingsScreen.tsx:42-59`). |
| 8 | Lowest-CPA focus | **Present** | CPA is the north star across every table (color-coded vs `targetCPA`), the scale/cut/reallocate rules, creative diagnosis, and report. `engine.ts` is CPA-centric throughout. |
| 9 | Award-winning design | **Present (objective) / residual taste gate** | Dark cockpit, gradient brand, tabular nums, sparklines, motion — consistent with the kickoff direction. Honest residual: designer sign-off is the operator's, per ledger. (Lane 5's call, not mine.) |
| 10 | Command palette (named P0 in CONCEPT_BRIEF) | **Absent** | `CONCEPT_BRIEF.md:70` lists "command palette" as P0 app-shell scope. Grep finds it nowhere in `src/` — no cmd-k handler, no component. Sidebar (`Sidebar.tsx`) and TopBar (`TopBar.tsx`) have no palette. This is a promised-but-missing P0 item, not a stretch gap. |

**Verdict:** 7 of 10 asks fully present, 2 partial (monthly lens; creative/audience
*actionable* recs), 1 promised-but-absent (command palette). The spine the
operator described is genuinely there and internally consistent.

---

## B. Highest-value gaps (impact vs effort)

Ordered by impact-to-effort. "Effort" is rough dev-days for a competent engineer
given the existing seam; the data model already supports most of these.

### B1. No alerting / anomaly surface — the "constantly measuring" promise is unmet [HIGH impact / MED effort]
The kickoff and brief sell continuous measurement ("an AI analytical layer that
continuously reads the data," CONCEPT_BRIEF one-liner; "constantly measuring").
In practice analysis runs **only when a screen renders and recomputes**
(`analyzeScope` called inside `useMemo` on each route). There is:
- no notification center, no badge of "new since you last looked,"
- no anomaly callout on the home screen beyond the same suggestions list,
- no "X clients breached target CPA today" digest.

The home "Priority actions" list (`PortfolioOverview.tsx:156-171`) shows the top 5
suggestions but does not distinguish *new/worsening* from standing advice, and
critically **does not surface day-over-day anomalies** (sudden CPA spike, spend
runaway, a campaign that fell out of learning). For an agency the single most
valuable daily artifact is "what changed and what's on fire" — that triage layer
is the thinnest part of the product relative to how it's pitched. The engine and
`kpiDelta` machinery already exist; an "anomaly feed" is mostly new
presentation + a per-entity day-over-day delta scan.

### B2. Budget pacing exists per-client but not across the portfolio [HIGH / LOW-MED]
Pacing is computed and shown per client (`ClientDashboard.tsx:102-126`,
`report.ts:76-99`). There is **no portfolio-wide pacing view** — no "which clients
are pacing >110% / under-pacing with 8 days left," no roll-up of projected vs
contracted spend across the book. `monthlyBudget` lives on every client
(`types.ts:43`), so a portfolio pacing table is a roll-up of an existing
calculation. For an account lead this is a top-3 Monday question and currently
requires opening each client one at a time.

### B3. Settings thresholds are display-only, not editable [HIGH trust / LOW effort]
The Settings screen states the thresholds are "tunable per account"
(`SettingsScreen.tsx:170`) and the kickoff says "Tune them in Settings"
(LEDGER honest-residual #3). But the `Rule` tiles render static values with no
`onChange`, no input, no persistence (`SettingsScreen.tsx:171-178, 199-206`).
`THRESHOLDS` is a frozen `as const` object (`thresholds.ts:9`). The product tells
the buyer to tune the engine and then gives them no control to do so — a direct
promise/feature mismatch that also blunts trust in the recommendations (the kill
criterion is precisely "suggestions they don't trust"). Wiring even global (not
per-account) sliders backed by a store slice is low effort and high trust payoff.

### B4. Creative previews are gradient placeholders [HIGH for the creative pitch / MED effort, gated on live]
`CreativeThumb.tsx:11` comment: "placeholder thumbnail (no real asset in demo)."
Every creative renders a 2-stop gradient + format glyph (`CreativeThumb.tsx:35-55`).
Job #3 of the brief is "make creative learning a system" — but a buyer cannot
*see* the creative they're being told to scale or kill. In demo this is
unavoidable (no assets), yet there is no `thumbnailUrl`/`previewUrl` field on the
`Creative` type (`types.ts:140-156`) and no `image_url`/`thumbnail_url` pull noted
in the LiveProvider mapping — so even at go-live the asset would not appear
without a model + fetch addition. Adding a `previewUrl?` to the type now (used by
LiveProvider) and a graceful fallback keeps the gradient for demo while unlocking
real thumbnails at go-live. This is the difference between a creative *table* and
a creative *war room*.

### B5. No period-comparison view (vs the prior period / a chosen baseline) [MED-HIGH / MED]
KPI cards show current vs *implicit* previous period (`previousRange` in
`metrics.ts:160-166`) and the report shows WoW deltas, but there is no UI to
**pick two arbitrary periods and compare** (e.g. this month vs last month,
launch-week vs now), and no month-over-month anywhere. The brief explicitly wants
"daily/weekly/monthly" analysis; only a fixed implicit comparison is offered. The
delta engine exists; this is a date-picker-pair + a comparison layout.

### B6. No bulk actions [MED / MED]
Every action is one card at a time (`SuggestionCard.tsx`). There is no
"apply all critical," no multi-select on the campaigns table, no "pause all DOA
creatives for this client." For a buyer triaging dozens of recommendations across
7 clients each morning, single-apply is a throughput ceiling. The apply path
(`store.ts:applySuggestion`) is per-suggestion; a batch wrapper + checkbox column
is the work.

### B7. No audience / placement breakdowns [MED / MED-HIGH]
`AudienceSpec` exists on ad sets (`types.ts:96-122`) and is shown as a label in
the drill-down (`Campaigns.tsx:133`), but there is **no breakdown analysis by
audience type or by placement** — and Insights carry no placement dimension
(`Insight`, `types.ts:174-198`, has no `publisher_platform`/`platform_position`).
Meta's breakdowns (placement, age/gender, platform) are core to where buyers find
waste. This is the largest *new* capability (needs a breakdown dimension on
insights + seeded data + a screen), hence MED-HIGH effort — but it is a genuine
analytical surface competitors have.

### B8. No persisted audit log of applied changes [MED / LOW]
The Activity panel (`Recommendations.tsx:107-136`) logs applied actions, but only
to in-memory store state (`store.ts:applied`, capped at 50, lost on reload —
`store.ts:135`). There is no durable, filterable audit trail of "who changed what,
when, with what projected vs realized impact." For an internal multi-buyer tool
this is both an accountability and a learning artifact (did the scale actually
work?). The data is already captured transiently; persistence + a dedicated view
is the gap.

### B9. No monthly report and no scheduled/automated delivery [MED / MED]
Only the weekly Monday report exists (`report.ts`, `WeeklyReportScreen.tsx`). The
brief asks for monthly analysis; a month-end client report (MoM, pacing close-out,
creative cohort retrospective) is absent. Separately, "Export" only toasts
"(simulated)" (`WeeklyReportScreen.tsx:32, 118-120`) — there is no file/PDF
generation and no scheduled email delivery (explicitly out of scope this run per
ledger, but it's the natural completion of the "kill the reporting chore" job:
a report you must remember to open and manually send is half a chore-killer).

### B10. No command palette / global search / saved views [MED / MED]
Beyond the missing P0 palette (A10): there is no global entity search ("jump to
client X / campaign Y"), and no saved views/filters (e.g. "my fatigued-creative
triage across all clients"). The campaigns search is local to that table only
(`Campaigns.tsx:71-74`). For a 7-client, ~26-campaign book this is tolerable; at
real agency scale (dozens of clients, hundreds of campaigns) navigation becomes
the bottleneck. Palette + saved views are the highest-leverage navigation
investments.

### B11. No annotations / notes on entities or time [LOW-MED / LOW]
No way to annotate "raised budget here," "new creative launched," "client paused
spend for a sale" against an entity or a date on a chart. Agencies live on this
context; without it the trend lines have no narrative and the next buyer
re-derives why CPA jumped. Low effort (a note attached to entityId/date) for
outsized day-to-day usefulness.

### B12. No role/seat awareness [LOW for now / out-of-scope]
No users/roles (explicit non-goal, CONCEPT_BRIEF "Explicit non-goals"). Fine for a
first internal draft, but worth flagging that the audit log (B8), annotations
(B11), and "new since you looked" (B1) all become much more valuable once "who"
exists. Not a gap to fix now; a sequencing note.

---

## C. Soundness / effectiveness observations (deeper than feature presence)

- **C1 — Suggestion staleness vs the global time range.** The recommendation
  engine ignores the global `range`; it always reasons on fixed 3d/7d/14d windows
  (`engine.ts:54-57`, `analyzeScope` takes no range). Meanwhile the dashboards a
  buyer is staring at respect the global range. So a buyer viewing "Last 28 days"
  sees suggestions computed on a different (7d-ish) window than the table beside
  them. This is defensible (you *should* judge fatigue on recent windows) but it
  is **never surfaced** — the cards don't say "based on last 7 days," so the
  numbers in the rationale won't reconcile with the numbers in the table the buyer
  is reading. A one-line "window" badge on each card would close a real
  trust/confusion gap. (Effectiveness, not a bug.)

- **C2 — Projected impact is a static heuristic, never reconciled.** Every
  suggestion ships a `projectedImpact` (e.g. "+~N orders/mo," `engine.ts:157`) but
  nothing ever checks the *realized* result after applying. The product makes a
  forecast and never grades itself. Closing this loop (B8 audit log + a
  realized-vs-projected column) is what would turn "a signal a buyer weighs" into
  "a track record a buyer trusts" — directly addressing the kill criterion.

- **C3 — `WATCH`/`unproven` is the only "do nothing" state; no positive
  confirmation surface.** When a client is healthy the home shows "All clear"
  (`PortfolioOverview.tsx:167-169`). Good, but there's no "here's what's working
  and why keep doing it" — the product is almost entirely a problem-finder.
  Buyers also need defensible "hold course" evidence for client calls.

- **C4 — Reallocation/consolidation actions are "plan" stubs, not executable.**
  `REALLOCATE_SPEND` and `CONSOLIDATE_ADSETS` map to action kind `consolidate`
  with labels like "Open reallocation"/"Plan consolidation"
  (`engine.ts:206, 235`) — there is no flow that actually opens a reallocation
  workspace; applying them just logs/toasts. So two of the seven recommendation
  types are advisory-only even in the demo's own terms. Honest, but worth naming:
  the "one-click action" promise is fully real for scale/cut/pause/fatigue, and
  partial for structure-level recs.

- **C5 — Strong, genuinely valuable pieces (credit where due).** The creative
  funnel diagnosis (`creative.ts:diagnose` — hook/body/convert/fatigue separation)
  and next-batch planner (`nextBatchPlan`) are the most differentiated, hardest-to-
  fake parts and directly serve job #3. The multi-BM model (agency vs partner) is
  correctly first-class. The additive-base-facts metric design (`types.ts:174-198`)
  is the right architecture for correct roll-ups. These are real strengths, not
  scaffolding.

---

## D. Prioritized recommendation (what to do before the team tests)

Do-first (high impact, low effort, closes promise/trust gaps):
1. **B3** make thresholds actually editable (the screen already claims they are).
2. **B2** portfolio pacing roll-up (pure aggregation of existing per-client calc).
3. **C1** stamp each suggestion card with its analysis window.
4. **B1 (lite)** an anomaly/"what changed today" strip on the home screen.

Next (high impact, medium effort):
5. **B1 (full)** a notification/anomaly feed — delivers the headline promise.
6. **A4/B5/B9** a monthly lens + month-over-month comparison + a monthly report.
7. **B6** bulk apply / multi-select.
8. **A10/B10** command palette (a named P0) + global search.

Later / go-live-gated:
9. **B4** creative `previewUrl` on the type now; real thumbnails at live.
10. **B7** audience/placement breakdowns (largest new surface).
11. **B8/B11/C2** durable audit log + annotations + realized-vs-projected loop.

---

## E. Honest confidence

High confidence (8/10) on the coverage map and the gap inventory — all load-
bearing claims were read in source, not inferred. The one place I could be wrong
is severity-weighting B7 vs B1 for *this specific agency*; that's a judgment call
the operator should make. Ground truth: ~14 of ~16 load-bearing conclusions were
verified by directly reading the cited code; the remaining two (design quality;
which gap matters most to this operator) are explicitly out of my lane / require
the human.
