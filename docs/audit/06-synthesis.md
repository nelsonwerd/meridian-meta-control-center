# Meridian Deep-Dive — Synthesis & Oversight (Lane 6)

**Role:** Cross-check every lane's load-bearing claims against the actual source, resolve
contradictions, surface gaps no single lane owned, and give the operator one calibrated verdict.
**Calibration:** Meridian is an explicitly near-finish-line **first-draft, demo-mode** product. A
"blocker" here means *"would mislead the team or break their testing"* — not *"not production-grade
for live Meta data."* Live-data correctness issues are real and catalogued, but they are gated behind
a structure layer that currently throws, so they cannot bite a demo tester today; they are tiered
accordingly.

**Method:** I re-read all five evidence files in full, then independently re-verified the highest-
leverage claims by reading the actual source: `engine.ts`, `store.ts`, `hooks.ts`, `metrics.ts`,
`demoProvider.ts`, `liveProvider.ts`, `Recommendations.tsx`, `SuggestionCard.tsx`, `Sidebar.tsx`,
`thresholds.ts`, `index.css`, `tailwind.config.js`, and ran `tsc --noEmit` (exit 0). Every cross-lane
claim I relied on for tiering, I confirmed at `file:line`.

---

## 1. Plain-English verdict

**Meridian is buttoned-up enough for the team to start testing the *demo* — with two fixes first.**
The spine the operator asked for is genuinely there and internally consistent: a multi-client/multi-BM
cockpit, KPI drill-down to the creative, a faithful CPA-first heuristic engine with correct precedence
and a real minimum-signal gate, a genuinely sendable weekly client report, a Creative Lab that is a
workflow rather than a chart dump, and an honest demo↔live provider seam whose hardest-to-get-right
parts (omni_purchase extraction, cursor pagination, per-account token routing, currency minor-units)
are correct. The design is top-decile on the dark desktop. The honesty infrastructure (LEDGER, header
comments, "confidence is a signal not an edge") is exemplary — the docs are honest even where the UI
over-claims. `tsc` is clean; number formatting, empty/single-day ranges, and the debug-surface strip
are all verified-robust.

**But two things will actively mislead a tester on day one, and must harden before the team starts:**

1. **Apply silently leaves the dashboards stale (correctness blocker).** The headline interaction —
   "one-click apply" — bumps a `version` counter and flips the card to "Applied," but the snapshot
   object reference never changes, so every `[snapshot]`-keyed `useMemo` returns its cached value. The
   tester raises a budget, the card says "Applied," and the campaign still shows the old budget and
   still recommends scaling. This is the exact "I applied it, why didn't anything move?" moment that
   reads as a broken product. (Lane 5 H1, verified end-to-end below.)

2. **The engine silently disagrees with the dashboard it sits next to (trust blocker).** The engine
   ignores the global date picker entirely — it always reasons on fixed last-3/7/14-day windows — and
   never labels the window on the card. A tester on "Last 28 days" sees rationale numbers that won't
   reconcile with the table beside them, with no disclosure. (Lanes 1, 3, 5; verified.)

Everything else is a should-fix, not a stop-ship, *for demo testing*. A handful of UX issues (mobile
collapse, light-theme contrast failing AA, 81%-are-"High" severity inflation, apply-without-confirm)
should harden before any external eyes or live mode. And a distinct, larger body of work — the live
Meta integration — is **not** a config flip: the "last mile" is the entire structure-mapping layer
(which throws today) plus ~5 silent data-correctness mismatches (reach additivity, learning/effective
status, currency offset, video action-key) that would produce *wrong numbers, not errors* once wired.

**What genuinely shines:** the rule *set* faithfulness + precedence; the creative funnel diagnosis;
the weekly report; the provider seam's correct hard parts; the design system on dark desktop; and the
unusually honest self-documentation.

**What must harden first (demo):** apply-invalidation (H1), engine-window disclosure/threading, the
responsive break, light-theme contrast, severity-tier inflation, and apply-confirm/undo before live.

---

## 2. Cross-lane verification & contradiction resolution

I found **no hard contradictions** across the five lanes — they are mutually consistent, and several
of the strongest findings were independently discovered by two lanes from different angles. The
important work was *de-duplicating* and *correctly attributing* shared root causes.

**Resolved overlaps (same root cause, two lenses — merged, not double-counted):**

- **Apply-staleness (Lane 5 H1) ≡ scale-loop re-recommend (Lane 1 A.3 / Lane 5 M2).** Both trace to
  one fact: `applySuggestion` (`store.ts:129-136`) bumps `version` + adds to `appliedSuggestionIds`
  but **never** clones the snapshot and **never** adds to `dismissedSuggestionIds`. Verified: the
  Recommendations list memo (`Recommendations.tsx:32`) is keyed `[snapshot, scope, dismissed]` — none
  change on apply — and the card flips to "Applied" only via `SuggestionCard.tsx:46` reading
  `appliedSuggestionIds.has(s.id)` directly. So the acknowledgement is live while the numbers are
  stale, *and* the applied suggestion is never retired, so it can re-emit. One fix
  (`set({ snapshot: { ...snapshot } })` on apply success + filter applied ids from lists) closes both.

- **Frozen-window (Lanes 1 D1/D2, 3 C1, 5 M3) is TWO distinct issues that compound, not one.**
  Verified both: (a) the engine hard-codes `lastNDays(3/7/14)` and `analyzeScope`/`analyzeClient` take
  no `DateRange` (`engine.ts:53-57, 259-262`) — so changing the picker never changes suggestions; and
  (b) `today()` returns the frozen `DATA_TODAY` unconditionally (`metrics.ts:104`) while LiveProvider
  pulls against `new Date()` — a demo→live trap. (a) is a demo-visible trust gap (fix now); (b) is a
  live-only trap (fix before live). Not a contradiction — they stack.

- **Reach/frequency (Lane 1 D4 ≡ Lane 2 B1).** Verified: `aggregate()` sums `reach` additively
  (`metrics.ts:23`) then derives `frequency = Σimpr/Σreach` (`metrics.ts:41`). Lane 1 emphasizes the
  *demo-masked* consequence (under-flags fatigue, over-permits scaling); Lane 2 emphasizes the *live*
  consequence (Meta reach is de-duplicated/non-additive, so rolled-up frequency collapses toward ~1.0
  and the frequency-gated rules misfire). Same root cause, two consequences, both correct. Combined,
  this is the single highest-leverage live-correctness item because `frequency` gates both the fatigue
  rule (`engine.ts:121`) and the scale rule (`engine.ts:146`).

**Apparent tension, resolved as consistent:** Lane 4 calls the daily loop "1-click where surfaced"
while Lane 5 says apply leaves dashboards stale. Not contradictory: the click *works* and the card
acknowledges; what's stale is the *surrounding numbers*. Both true.

**Independently re-verified at source (spot-check of load-bearing claims):**

| Claim | Lane(s) | Verified at | Holds? |
|---|---|---|---|
| Hard-coded projected-impact constants (−0.15/+0.12/−0.08/−0.1; +0.2 = scaleStepPct) | 1 | `engine.ts:109,130,157,204,233` | ✅ |
| Engine takes no DateRange; fixed `lastNDays(3/7/14)` | 1,3,5 | `engine.ts:53-57,259-262` | ✅ |
| Scale judges one ad's m3/m7 then raises whole CBO budget | 1 | `engine.ts:141-167` | ✅ |
| Apply bumps version only; snapshot ref stable; memos cached | 5 | `store.ts:129-136`, `hooks.ts:6-10`, `Recommendations.tsx:32` | ✅ |
| Apply never dismisses → suggestion re-emits | 1,5 | `store.ts:129-136` (no dismissed add) | ✅ |
| `aggregate` sums reach; frequency=Σimpr/Σreach | 1,2 | `metrics.ts:23,41` | ✅ |
| LiveProvider structure stub `void rawCampaigns`; refs non-existent `buildIndexes()`; throws | 2 | `liveProvider.ts:209,212,214` | ✅ |
| `today()` frozen to DATA_TODAY | 1,5 | `metrics.ts:104` | ✅ |
| `enumerateDates` silently truncates past 800 | 5 | `metrics.ts:117-126` | ✅ |
| Light-theme `--ink-subtle` regressed token | 4 | `index.css:45` (`134 142 156`) | ✅ |
| `text-amber` is a dead class (no amber Tailwind token) | 4 | `SuggestionCard.tsx:26` + `tailwind.config.js` (warning only) | ✅ |
| Sidebar width keyed only on `collapsed`, no breakpoint | 4 | `Sidebar.tsx:33-36` | ✅ |
| `scaleMinPurchases7d=25` (below doc's 30); cooldown unread | 1,3 | `thresholds.ts:20,22` | ✅ |
| Command palette absent (named P0) | 3,4 | grep `src/` = 0 | ✅ |
| `tsc --noEmit` exit 0 | 5 | re-ran | ✅ |

Every tier-0/tier-1 item below rests on a claim I re-verified at source, not on lane judgment alone.

---

## 3. Gaps no single lane fully owned (cross-lane synthesis)

1. **The "looks like it works" illusion is systemic, not local.** Three lanes each found one face of
   it — stale dashboards (5), re-emitting scale loop (1), card-flips-but-numbers-don't (5/4). The
   meta-point: Meridian's demo *acknowledges* every action but *reflects* almost none of them. For a
   tool whose entire pitch is "scan → act → see it move," the see-it-move half is the weakest link,
   and it's one shared fix. No lane framed it as the product's central demo risk; it is.

2. **The frozen-anchor + ignored-range combination is a coherent "temporal story is half-built"
   theme.** Daily reasoning is absent, monthly is one pacing number, only weekly is real (Lane 1);
   no monthly lens/30-60-90-day preset despite 90 days seeded (Lane 3); the engine window is
   undisclosed and disagrees with the picker (Lanes 1/3); and the anchor is frozen for live (Lane 5).
   Individually each is medium; together they mean the "real-time across daily/weekly/monthly" claim
   is the single most over-stated line in the product framing. The operator should either build the
   three lenses or soften the claim — this is a positioning decision no lane owned.

3. **"Continuously measuring" has no engine.** Analysis runs only on render (Lane 3 B1); there is no
   anomaly/"what changed overnight"/pacing-breach surface (Lanes 1 C.1/C.2, 3 B1). The highest-value
   *daily* artifact for an agency — "what's on fire that wasn't yesterday" — is exactly the thinnest
   part relative to the pitch. The `kpiDelta` + pacing machinery already exists; this is mostly
   presentation. This is the biggest *missing capability*, and it spans the AI and product lanes.

4. **The demo's own believability has two seams** that no single lane connected: the "onboarding"
   client has a full mature 90-day history (Lane 5 L2), and the weekly digest can call a flat week
   "Efficient growth" (Lane 5 L1). Both are credibility nicks a reviewer hits while *evaluating the
   demo* — low severity but directly in the path of "team starts testing."

5. **Confidence and projected-impact are shown as calibrated but are not, and nothing grades them.**
   Half the confidence scores are magic constants (DOA 0.90 over-states certainty), the projected-
   impact column is mostly decorative constants, the disclaimer lives only in docs (Lane 1 B.2/B.3),
   and realized-vs-projected is never reconciled (Lane 3 C2). Against the operator's stated kill
   criterion ("suggestions they don't trust"), this credibility surface is the most important thing to
   either honest-up or compute — and closing the realized-vs-projected loop is what would turn a signal
   into a track record.

---

## 4. Honest combined confidence

**Combined confidence: 8/10.** All five lanes self-rated 8/10, and I independently re-verified the
load-bearing claims I relied on for every tier-0/tier-1 item against source (see §2 table) — so the
*structured-analysis* core is solid. The cap at 8 (not higher) is honest because:

- **Nothing was exercised under live Meta tokens.** Every live-data finding (reach de-dup, learning
  status, currency offset, video action-key, async/rate-limits) is reasoned from code + the grounding
  doc, not run against a real account. These are model judgment, correctly flagged by Lane 2.
- **The app/engine were not executed end-to-end by this synthesis pass** — Lane 4 drove the live
  preview and Lane 5 ran the modules in node, but I cross-checked their results by *reading* source,
  not by re-running the app. The H1 staleness mechanism in particular is a React-render-semantics
  argument verified by reading dep arrays; it is as close to certain as static analysis gets, but it
  was not re-observed live in this pass.
- **A few items are explicit judgment, not ground truth:** which gap matters most to *this* agency,
  the "award-winning bar" framing, and the usability claim behind 81%-are-High.

**Ground-truth tally (de-duplicated across lanes):** roughly **55 of 65** distinct load-bearing
conclusions are externally verified via direct source reads, in-page measurement, node execution, or
grep of `dist/`; the remaining ~10 are model judgment (all live-data semantics + a handful of
taste/priority calls). The headline is capped at 8/10 accordingly: high confidence on the demo-state
findings, appropriately hedged on everything that only manifests under live tokens.

---

## 5. Top findings (de-duplicated, ranked)

See the structured object for the full ranked list with file refs. Severity legend below.

- **BLOCKER (fix before the team tests the demo):** apply does not invalidate screen memos →
  dashboards go stale after a write (`store.ts:129-136`, `hooks.ts:6-10`).
- **HIGH:** engine ignores selected date range and doesn't disclose its window
  (`engine.ts:53-57,259-262`); no React error boundary → one throw white-screens the whole cockpit
  (`router.tsx`, `AppShell.tsx:32`); mobile/narrow layout collapses with 300px overflow
  (`Sidebar.tsx:33-36`); light theme fails WCAG AA on all tertiary text (`index.css:45`); severity
  tier non-functional, 81% critical-or-high (`Recommendations.tsx`, `PortfolioOverview.tsx:56`);
  apply fires with no confirm/undo — dangerous in live (`store.ts:113-144`); projected-impact column
  is decorative constants shown with false precision (`engine.ts:109,130,157,204,233`); reach treated
  as additive breaks live frequency → fatigue/scale misfire (`metrics.ts:23,41`); live structure layer
  is unbuilt and throws, references non-existent `buildIndexes()` (`liveProvider.ts:209-214`); learning/
  effective_status can't come from Graph `status` → consolidation goes silent, disapproved ads get
  scaled (`types.ts:74-76`, `engine.ts:142,189-203`).
- **MEDIUM:** scale unsafe to automate (no cooldown, judges one ad/raises whole CBO,
  `engine.ts:141-167`); applied suggestions never retired → re-recommend loop (`store.ts:129-136`);
  Campaigns screen is a daily-loop dead-end (`Campaigns.tsx:226-230`); `fmtMetric('frequency', NaN)`
  leaks "NaN" (`format.ts:68-69`); `today()` frozen for live (`metrics.ts:104`); a11y gaps — no
  aria-live/skip-link/route-focus; CPA bars visually backwards (`HBars.tsx:14,29`); missing pacing/
  anomaly surface; thresholds claimed tunable but display-only (`SettingsScreen.tsx:170`,
  `thresholds.ts`); currency_offset static with TWD/HUF mis-bucketed (`liveProvider.ts:259-266`);
  sync 90-day insights loop will time out / trip rate limits on big accounts (`liveProvider.ts`);
  confidence scores half magic-constant, shown as calibrated.
- **LOW / hygiene:** dead `text-amber` chip (`SuggestionCard.tsx:26`); native date inputs forced dark
  in light theme (`DateRangeMenu.tsx:71,80`); `enumerateDates` silent truncation (`metrics.ts:117-126`);
  flat-week reads as "growth" (`WeeklyReportScreen.tsx:53`); "onboarding" client has mature history
  (`generate.ts:454-522`); creative previews are gradients with no live URL path (`types.ts:140-156`).

---

## 6. Prioritized action list (build-loop executable)

**Tier 0 — Blockers before the team touches the demo (small, high-leverage):**
1. Clone the snapshot on apply success (`set({ snapshot: { ...snapshot } })` in `store.ts`) so all
   `[snapshot]`-keyed memos invalidate uniformly — fixes stale dashboards AND the Campaigns/everyone
   inconsistency in one move.
2. Filter `appliedSuggestionIds` out of rendered suggestion lists (mirror the `dismissed` filter) so
   an applied card retires instead of re-emitting.
3. Add a React error boundary + router `errorElement` on the layout route so one throw degrades a
   panel, not the whole cockpit.

**Tier 1 — Before scaling testing / any external eyes (trust & safety):**
4. Thread the selected `DateRange` into `analyzeClient`/`analyzeScope`, OR stamp each card with its
   analysis window ("based on last 7 days") so engine output and on-screen numbers stop silently
   disagreeing.
5. Gate write actions behind a lightweight confirm (show the exact change) and add Undo to the success
   toast — required before live mode is ever flipped on.
6. Re-tier severity so "High" is a genuine minority, add an impact sort, and default to a "Top N by
   $/day recovered" view.
7. Fix the responsive break below `lg` (icon-rail/drawer sidebar; `grid-cols-1` KPIs under ~420px).
8. Darken light-theme `--ink-subtle` to ≥ `rgb(107 114 128)` (one-token AA fix).
9. Relabel or compute the projected-impact column (drop false precision; fix the scale `+0.2`
   mislabel outright); surface the "signal, not proof" disclaimer on the card.

**Tier 2 — Should, to deliver the pitch (medium effort, high value):**
10. Add a pacing/overspend + anomaly ("what changed overnight") surface on the home screen —
    ~80% of pacing is already computed in `report.ts`.
11. Make Settings thresholds actually editable (global sliders backed by a store slice) — the screen
    already claims they're tunable.
12. Deep-link the Campaigns AI-flag to `/recommendations?entity=<id>` (+ add that filter) to close the
    scan→act loop.
13. Enforce scale cooldown (add `lastScaledAt`) + a CPA-trend guard; make the scale rationale describe
    the budget holder, not one ad.
14. Add monthly/30-60-90-day lens + period comparison; add a portfolio-wide pacing roll-up.
15. Promote `convert_weak`/`hook_weak` into actionable cards; add a `cta_weak` rung; weight the
    creative leaderboard by order volume.

**Tier 3 — Hygiene & live-readiness (before/at go-live):**
16. Guard `fmtMetric` with `isFinite` (one line); make `today()` provider-aware (DATA_TODAY in demo,
    `generatedAt` in live); make `enumerateDates` throw past the guard.
17. Fix the `text-amber` chip → `text-warning`; flip native date-input color-scheme by theme;
    fix backwards CPA bars; treat flat weeks as neutral; gate onboarding-client data by `startDate`.
18. Add a11y: `role="status" aria-live="polite"` on toasts, a skip link, route-focus management, and
    menu ARIA (`aria-haspopup`/`aria-expanded`/`role="menu"`).
19. **Live integration (treat as a focused engineering pass, not a flip):** extract
    `assembleDataset(arrays)→Dataset` from `generate.ts` and build the structure mapper; add
    `effectiveStatus` + derived learning state; pull per-account `currency_offset` and drop TWD/HUF
    from ZERO_DECIMAL; stop summing reach (pull/weight frequency at grain); implement async report
    jobs + rate-limit backoff; make `GRAPH_BASE`/proxy configurable and route `checkConnection`
    through it; add creative asset URLs; verify the video action_type inner key on a live row.

---

*Synthesis complete. The demo is a faithful, honest, well-built first draft whose core demo flow has
one correctness blocker (stale-after-apply) and one trust blocker (silent window disagreement) to fix
before testing; the live integration is a real engineering slice, correctly scaffolded but materially
larger than "plug in a token."*
