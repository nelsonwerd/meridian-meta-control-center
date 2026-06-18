# Meridian Deep-Dive — Executive Briefing

*Plain-English verdict from a 5-lane audit (AI-engine soundness, Meta-integration realism,
completeness/effectiveness, UX/IA, code correctness) → synthesis → adversarial red-team. Every
tier-0/1 item was re-verified at file:line against the actual source. Evidence: `01`–`07` in this folder.*

## TL;DR verdict

**Meridian is a faithful, honest, well-built first draft — safe for your team to start testing the
demo after ONE blocker is fixed, with one strong "fix-in-the-same-sitting" right behind it.** The spine
you asked for is genuinely there and internally consistent: multi-client/multi-BM cockpit, KPI
drill-down to the creative, a CPA-first engine with correct precedence + a real minimum-signal gate, a
genuinely sendable weekly report, a Creative Lab that's a workflow not a chart-dump, and an honest
demo↔live seam whose *hardest* parts (omni_purchase extraction, pagination, per-account token routing,
currency minor-units) are correct. Design is top-decile on dark desktop. `tsc` clean.

**Combined confidence: 8/10** (55 of ~65 load-bearing conclusions externally verified by reading
source / running `tsc` / driving the live preview; the ~10 unverified are all live-Meta semantics that
can't be tested without real tokens). Capped at 8 because nothing was exercised under live tokens.

## The 1 blocker + 1 strong-should (fix before the team pokes around)

1. **🔴 BLOCKER — "Apply" leaves the screen half-frozen.** The headline interaction bumps a counter
   and the card flips to "Applied" + logs to the Activity feed — but the suggestion **list**, the
   **severity counts**, and every **dashboard number** stay stale (the snapshot object reference never
   changes, so `[snapshot]`-keyed memos return cached values). Net day-one symptom: *Applied cards sit
   above unchanged counts; a budget moves on the Campaigns screen while its "needs scaling" AI-flag
   persists.* That self-contradiction reads as "broken." One-area fix in `store.ts` (clone the snapshot
   on apply) + filter applied ids out of the lists (mirror the existing `dismissed` filter, which
   already works correctly). `store.ts:129-136`, `hooks.ts:6-10`.
2. **🟠 STRONG-SHOULD — the engine silently disagrees with the dashboard next to it.** The AI always
   reasons on fixed last-3/7/14-day windows and **ignores the global date picker**, and never labels
   the window on the card. On "Last 28 days" the rationale numbers won't reconcile with the table
   beside them. Fix: thread the selected range into the engine **or** stamp each card "based on last 7
   days." `engine.ts:53-57, 239-259`.

*(Red-team correction: the synthesis's second "blocker" — a "projected-impact column shows fabricated
precise numbers" — was **overstated**. Those constants are never rendered; the card shows qualitative
labels + computed notes. Downgraded to LOW. The real "shown-as-calibrated-but-isn't" surface is the
**confidence score** ("90%"), which is a hand-picked constant for several rules — promoted.)*

## Harden before external eyes / live mode (real, not stop-ship for internal demo)

- **No React error boundary** — one screen throwing white-screens the whole cockpit. Add a boundary +
  router `errorElement`. (HIGH)
- **Apply fires with no confirm / no undo** — fine in demo, dangerous the moment live is flipped on.
- **Severity tiers are non-functional** — ~81% of cards are Critical/High, so "priority" is noise.
  Re-tier + add an impact ("$/day recovered") sort.
- **Responsive break below `lg`** (sidebar/KPIs overflow ~300px on tablet/mobile) and **light-theme
  tertiary text fails WCAG AA** (`index.css` `--ink-subtle`).
- **Confidence honesty** — surface the "signal, not proof" disclaimer on the card; soften the
  hand-picked confidence constants (DOA 0.90 overstates).

## The biggest *missing capability* (to actually deliver the pitch)

**"Continuously measuring / what changed overnight" has no engine.** Analysis runs only on render;
there's no pacing/overspend alert and no anomaly ("CPM spiked, conversions dropped portfolio-wide =
tracking break") surface — yet that's the #1 *daily* question for an agency. ~80% of the pacing math is
already computed in `report.ts`; this is mostly wiring it into the home screen + the recommendations
feed. High value, medium effort.

Other high-value gaps: editable thresholds (Settings claims tunable, it's display-only), deep-link the
Campaigns AI-flag → Recommendations (close the scan→act loop), monthly / 30-60-90-day lens + period
comparison, and promoting the creative funnel diagnoses (`hook_weak`/`convert_weak`) into actionable
cards.

## The live-integration reality (important expectation-setting)

Flipping to live is **a focused engineering pass, not a config toggle.** The insights pull, write
POSTs, token routing, pagination, and currency math are implemented and correct — but the
**structure→type mapping layer is stubbed and deliberately throws** (so it can't feed wrong numbers to
a demo tester — the wall is safe). Plus ~5 *silent* live-data mismatches that would produce wrong
numbers, not errors, once wired: **reach is summed additively** (Meta reach is de-duplicated → rolled-up
frequency collapses → the fatigue & scale rules misfire), **learning/effective status can't come from
Graph `status`**, currency-offset has TWD/HUF mis-bucketed, and the sync 90-day loop will time out on
big accounts (needs async report jobs). These belong in a dedicated "go-live" build, best handed off as
a prompt-pack.

## Prioritized action list (build-loop executable)

**Tier 0 — before the team tests the demo:** (1) clone snapshot on apply + filter applied from lists;
(2) React error boundary + router errorElement.
**Tier 1 — before external eyes / live:** (3) engine window disclosure; (4) apply confirm + undo;
(5) re-tier severity + impact sort; (6) responsive fix < lg; (7) light-theme AA; (8) confidence
disclaimer + soften constants; (9) downgrade/relabel projected-impact, delete dead `change`.
**Tier 2 — to deliver the pitch:** (10) pacing/anomaly home surface; (11) editable thresholds;
(12) deep-link scan→act; (13) monthly lens + comparison; (14) promote creative diagnoses to cards;
(15) scale cooldown + holder-level rationale.
**Tier 3 — hygiene & live-readiness:** `fmtMetric` isFinite guard; `text-amber`→`text-warning`;
backwards CPA bars; flat-week neutral; gate onboarding-client history by `startDate`; a11y (aria-live
toasts, skip link, route focus, menu ARIA); **then** the live-integration engineering slice (prompt-pack).

## Should you proceed?

**Yes — fix the 1 blocker (+ the window disclosure in the same sitting), then let the team test the
demo.** Work the Tier-1/2 hardening before any external eyes or live mode. Hand the live-integration
slice off as a sequenced prompt-pack when you have tokens. The foundation is sound and unusually honest;
this is hardening a good first draft, not rescuing a bad one.
