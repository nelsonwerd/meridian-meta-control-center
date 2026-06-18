# Lane 7 — Red-Team Adversarial Review

**Role:** Break the synthesis. Re-read the actual source (not the lane prose) for every load-bearing
claim that drives a tier-0/tier-1 action; find claims that weren't really verified, severities that
are over- or under-stated, blind spots all five lanes shared, and any false assumption in the
demo-vs-live framing.
**Calibration target (held throughout):** *first-draft DEMO tool for internal team testing* — not a
production live system. A "blocker" must mean "would mislead or break a demo tester on day one," not
"not production-grade."
**Method:** Independently re-read `store.ts`, `hooks.ts`, `demoProvider.ts`, `Recommendations.tsx`,
`ClientDashboard.tsx`, `PortfolioOverview.tsx`, `SuggestionCard.tsx`, `engine.ts`, `metrics.ts`,
`format.ts`, `liveProvider.ts`, `provider/index.ts`, `Campaigns.tsx`, `Sidebar.tsx`, `index.css`,
`HBars.tsx`, `types.ts`, and re-ran `tsc --noEmit` (exit 0). Every correction below cites the line I
read, not the lane that reported it.

---

## Bottom line

The synthesis is **mostly right and unusually well-grounded** — the central blocker is real, the
contradiction-resolution is sound, and the demo-vs-live tiering is defensible. But it carries **one
materially overstated HIGH finding** built on a misread of what the UI renders, and it **under-weights
one demo-visible trust problem** by burying it. The headline verdict ("two fixes before the team tests
the demo") survives red-teaming; the *list of what those fixes are* needs one substitution.

The single most important red-team catch: **the "projected-impact column is decorative constants shown
with false precision" HIGH finding is wrong as stated.** The numeric `change` constants it indicts are
**never rendered to the user anywhere.** That finding should be downgraded, and the credibility budget
it was spending should move to the **confidence-score** surface, which *is* shown ("90%") and *is* a
magic constant.

---

## 1. Claims that were NOT actually verified against what renders (the big catch)

### 1.1 OVERSTATED — "Projected-impact column is decorative constants shown with false precision" (HIGH → downgrade to LOW/note)

The finding (and Lane 1 B.2, and the tier-1 action #9) rests on: *"`ProjectedImpact.change` is rendered
to users as a signed number … a buyer who trusts this column is misled."*

**That is false. `projectedImpact.change` is never rendered.** I grepped every usage:
- `grep -rn projectedImpact src/` → the only component read is `SuggestionCard.tsx:93-94`, which renders
  `s.projectedImpact.metric` and `s.projectedImpact.note`. **It never reads `.change`.**
- `grep -rn '\.change' src/` → the only `.change` references are in `report.ts:53-60`, an unrelated
  local `change` (a CPA delta for the movers list), not `projectedImpact.change`.

So the hard-coded `-0.15 / +0.12 / -0.08 / -0.1 / +0.2` constants are **dead/internal** — they exist in
the type and the engine but reach no pixel. What the buyer actually sees on the card is:
- `metric` — a **qualitative label**: `"Stop waste"`, `"−CPA drag"`, `"Recover CTR"`, `"Exit learning"`,
  `"−Blended CPA"`, `"+Orders"` (engine.ts:76,109,130,204,233,157). None of these is a precise signed
  number.
- `note` — sometimes qualitative (`"refresh same angle, new hook"`, `"no new spend required"`),
  sometimes a **computed** value (`~$X/day recovered` = `spend/7`; `~+N orders/mo` = a real division).
  The computed ones are first-order-defensible arithmetic, not fabricated constants.

The "scale +0.2 mislabeled as +Orders" sub-claim is likewise not user-visible: the card shows
`metric:"+Orders"` and a computed orders-per-month note, never the `0.2`. Lane 1's illustrative example
`metric: "−14% CPA"` **does not exist in the engine** — it was invented to dramatize the finding.

**Correct, smaller finding:** the engine carries dead `change` constants (code smell / future-trap if
someone ever surfaces them), and the *computed* notes (`+N orders/mo`) assume marginal CPA = average CPA
at +20% spend, which is optimistic. Worth a one-line "directional" caveat and deleting the dead field —
but this is **LOW**, not "the single most over-confident surface in the engine." Reallocating the HIGH:
the **confidence score IS shown** ("Confidence 90%" via `ConfidenceBar`, SuggestionCard.tsx:65) and DOA's
`0.9` is a hard-coded vibe (engine.ts:77). *That* is the real "shown-as-calibrated-but-isn't" surface,
currently rated only MEDIUM. The HIGH credibility concern belongs there, not on the impact column.

### 1.2 PARTLY OVERSTATED — "the card flips to 'Applied' ONLY because it reads appliedSuggestionIds; the numbers are stale" 

The mechanism is right but the framing undersells what *does* update, which matters for judging how
"broken" it looks. After apply, three things on the Recommendations screen **do** update live, because
they read store slices directly (not the snapshot memo):
- the card's button → "Applied" (`SuggestionCard.tsx:46`, fresh selector),
- the **"Applied this session" tile** count (`Recommendations.tsx:63`, `appliedIds.size`),
- the **Activity sidebar** audit row (`Recommendations.tsx:114`, `applied[]`).

What stays stale: the suggestion **list itself**, the **Critical/High/Medium counts** (`counts` memo
keyed on `all`, which is keyed on `[snapshot,scope,dismissed]`, line 32/38), and every dashboard KPI.
So the day-one tester experience is more specifically: *"I clicked Apply, it says Applied and logged it
to my activity feed and bumped 'Applied this session' to 1 — but the card is still sitting in the list
offering to scale, the counts didn't drop, and the budget cell didn't move."* Still a blocker, still the
same one-line fix — but the bug reads as "the card half-updated," which is arguably *more* confusing than
"nothing happened," not less. The synthesis's "why didn't anything move?" is slightly off; "why did only
half of it move?" is the real tell. Confirms the blocker; sharpens the symptom.

---

## 2. A severity the synthesis UNDER-weighted (a demo-visible issue tiered too low)

### 2.1 UPGRADE the Campaigns sparkle-staleness from "consequence of H1" to a named demo-visible defect

The synthesis folds the `Campaigns` inconsistency into the H1 fix ("fixes it in one move"). True — but it
buries a demo-visible symptom that is *worse* than the generic staleness because it is **self-contradicting
on a single screen**. Verified at source: `clientsForScope` is unmemoized (Campaigns.tsx:25) so
`campaignRows` (deps include the fresh `clients` array, line 42) **recomputes every render and DOES show
the new budget/status** — while `suggestionByEntity` (deps `[snapshot,scope]`, line 32) **does not**, so
the AI sparkle flag persists on a row whose budget already changed. A tester on the Campaigns screen sees
the budget update *and* the stale "needs scaling" sparkle simultaneously. That on-screen contradiction is
a sharper "this is broken" signal than a quietly-cached KPI elsewhere. It's the same fix, but it deserves
to be called out as a top demo symptom, not a parenthetical. (Net severity: still blocker-class, via H1.)

### 2.2 The "looks like it works" illusion has a fourth face the lanes didn't connect: dismiss also doesn't retire counts cleanly

Minor, but: `dismissSuggestion` adds to `dismissedSuggestionIds` (store.ts:147), which *is* in the memo
dep arrays, so dismiss correctly re-derives and removes the card. So dismiss works and apply doesn't —
which means the codebase already contains the exact pattern (a dep-array-tracked Set) that would fix
apply. The fix isn't just "clone the snapshot"; an equally valid one-liner is to mirror dismiss and add a
`version`-or-`appliedSuggestionIds` entry into the memo deps. The synthesis offers only the clone fix;
noting the dismiss-parity fix de-risks it (clone has a subtle gotcha — see §4).

---

## 3. Where the synthesis is RIGHT (re-verified, so the operator weights it)

These I re-read at the cited lines and they hold exactly:
- **H1 blocker** — `applySuggestion` bumps `version` + `appliedSuggestionIds`, never replaces `snapshot`,
  never adds `dismissedSuggestionIds` (store.ts:129-136); `useSnapshot` returns the same object
  (hooks.ts:6-10); demo mutates in place (demoProvider.ts:28,32,63-69); all three screen memos keyed on
  stable `[snapshot,…]` (PortfolioOverview.tsx:54, ClientDashboard.tsx:50, Recommendations.tsx:32). **Real.**
- **Engine ignores date range / no DateRange param** — `analyzeAd` hard-codes `lastNDays(3/7/14)`
  (engine.ts:53-57); `analyzeClient`/`analyzeScope` take no `DateRange` (engine.ts:239,259). **Real, HIGH.**
- **No error boundary** — confirmed zero in `src/`; router has no `errorElement`. BUT see §5: the live-load
  throw is caught by `init()`'s try/catch (store.ts:86-91), so that path degrades gracefully; the finding
  is correctly about *render-time* throws in screens. **Real, HIGH, framing accurate.**
- **Reach additive → frequency wrong live** — `aggregate` sums reach (metrics.ts:23), `frequency =
  safeDiv(impressions, reach)` (metrics.ts:41); frequency gates fatigue (engine.ts:121) and scale
  (engine.ts:146). **Real, HIGH for live.**
- **LiveProvider structure stub** — `void rawCampaigns` (liveProvider.ts:209), `buildIndexes()` exists
  ONLY in the comment (grep: 1 hit, line 212, no function), throws (line 214). **Real, HIGH for live.**
- **LEARNING/effective_status can't come from Graph status** — type folds learning into the enum
  (types.ts:74-76); no `effectiveStatus` field anywhere. **Real, HIGH for live.**
- **currency_offset TWD/HUF mis-bucketed** — `ZERO_DECIMAL` literally contains `'HUF','TWD'`
  (liveProvider.ts:259) and is the only multiplier on budget writes (line 236). **Real, MEDIUM (live, non-USD).**
- **`fmtMetric('frequency', NaN)` → "NaN"** — line 68-69, no `isFinite` guard unlike sibling formatters.
  **Real, but see §6: even more latent than rated.**
- **`today()` frozen** (metrics.ts:104), **`enumerateDates` silent 800-truncate** (metrics.ts:121),
  **light `--ink-subtle` 134/142/156** (index.css:45), **Sidebar width keyed only on `collapsed`**
  (Sidebar.tsx:35), **Recommendations has filters but no sort** (grep: zero sort affordance),
  **HBars width = value/max regardless of direction** (HBars.tsx:30), **Settings says "tunable" but only
  mode+token inputs exist** (SettingsScreen.tsx:170 vs only inputs at :45,:66). **All real.**
- **`tsc --noEmit` exit 0** — re-ran independently. **Holds.**

The contradiction-resolution section is sound: I found no place where two lanes actually conflict; the
merges (apply-staleness ≡ scale-loop; reach demo-mask ≡ reach live-bug) are correct single-root-cause
calls, not double-counts.

---

## 4. A gotcha in the synthesis's own recommended fix (the fix can be wrong too)

The tier-0 fix is `set({ snapshot: { ...snapshot } })`. Red-team concern: **a shallow spread clones the
top-level object but the 13 index Maps and all entity arrays remain the same references**, and the demo
mutates entities *inside* those Maps in place (`c.dailyBudget = …`, demoProvider.ts:28). A shallow clone
*does* change the `snapshot` identity, so `[snapshot]`-keyed memos will re-run and re-read the mutated
entity — so it **works** here. But it's fragile: it relies on every consumer re-deriving from the Maps on
every snapshot-identity change, and it silently defeats any future `React.memo`/structural-sharing
optimization (every apply invalidates *everything*, re-running `analyzeScope` over ~13.5k rows for all
clients — the O(insights) cost Lane 5 M5 flagged, now triggered on every single apply). The
**dismiss-parity fix** (add `appliedSuggestionIds`/`version` to the memo dep arrays, mirroring how
`dismissed` already threads) is more surgical and already proven in-codebase. The synthesis should
present both and prefer the targeted one, or at least note the shallow-clone-invalidates-everything cost.
**Not a blocker on the finding — a caveat on the prescription.**

---

## 5. Demo-vs-live framing: one assumption to tighten (mostly holds)

The synthesis asserts live-data findings "cannot bite a demo tester today" because the structure layer
throws. **Verified true for data-correctness** (the throw is before any wrong number is produced). And I
confirmed the throw is **caught gracefully**: live mode is reachable (Settings flips
`localStorage` → `createProvider('live')`, provider/index.ts:20), `loadSnapshot()` throws, but `init()`
wraps it in try/catch and sets `error` (store.ts:86-91), which `BootScreen` renders with a "return to
demo" recovery (per Lane 4). So a tester who flips to live gets a clean dead-end, not a white-screen — the
demo-vs-live wall is real and safe. **The framing holds.**

The one tightening: the synthesis (and Lane 2) call the live structure layer "unbuilt." More precisely,
it's **partially built and then deliberately throws** — the insights pull, action POSTs, token routing,
pagination, and currency math ARE implemented and correct; only the structure→type mapping + index
assembly is stubbed. "Unbuilt" understates how much *is* right and overstates the remaining surface in
the other direction from the ledger. The honest framing is Lane 2's "correct scaffold, last-mile is
bigger than the ledger says but smaller than a rewrite." The synthesis mostly carries this but the
top-finding wording ("live structure layer is unbuilt") swings too far toward "nothing's there." Minor.

---

## 6. Blind spots ALL five lanes shared (same-model common errors)

These are things no lane caught because they all reasoned the same way (read the engine/store, trust the
type comments, didn't trace the render path for the impact column; treated demo invariants as a backstop):

1. **Nobody traced the impact-column render path.** All of Lane 1 (B.2), Lane 4 (implicitly), and the
   synthesis assumed `projectedImpact.change` reaches the screen. It doesn't (§1.1). A single grep would
   have caught it. This is the textbook shared-model error: the type field is *named* like it's shown, the
   doc-comment says "signed fractional change," so every lane assumed it renders. **Correction above.**

2. **The frozen `today()` is ALSO a silent demo correctness issue, not only a live trap.** Every lane
   filed `today()`-frozen under "demo→live." But `DATA_TODAY = 2026-06-17` is **in the past relative to the
   app's real run date** (today is 2026-06-17 per the harness, so it currently aligns — but the moment the
   team tests this demo *after* mid-June 2026, the "Today"/"Yesterday" presets and the weekly report's
   "last completed week" silently drift relative to wall-clock expectations *within the demo itself*). The
   demo's data is fixed, so the numbers stay self-consistent — but a tester glancing at "Today" expecting
   *their* today gets June 17 2026 data with no "data as of" label. No lane flagged the missing **"data as
   of <date>" stamp** as a demo-testing clarity issue (it's only ever framed as a live trap). Low, but it's
   a shared miss: the anchor is a *demo-presentation* gap too.

3. **NaN-frequency is reachable in the DEMO, not just live — via a zero-reach single-day window.** Lane 5
   rated M1 "latent, not visible in demo" because `safeDiv` guards reach=0 → frequency 0 (not NaN). I
   re-checked: in `aggregate`, frequency uses `safeDiv` so it's 0, never NaN — **so the demo path truly is
   safe** and Lane 5 is right that `fmtMetric('frequency',NaN)` needs an upstream NaN to fire. BUT no lane
   checked whether **any selector hands a raw (non-aggregated) frequency** to `fmtMetric`. If a future code
   path or a single live row with reach=0 passes Meta's raw `frequency` (which can be `null`/absent) the
   guard is missing. The shared blind spot: all lanes reasoned "demo can't produce NaN" and stopped, none
   asked "is there a non-`aggregate` caller." (There isn't today — so it stays LOW — but the reasoning was
   incomplete across the board.)

4. **No lane verified the empty/all-dismissed Recommendations COUNT path against the stale-memo bug.** With
   H1, if a tester dismisses every card, `dismissed` IS in deps so the list empties correctly — but if they
   *apply* every card, the counts never zero out (counts memo keyed on `all`, which doesn't see applied).
   So the summary tiles can read "Critical 3 / High 61" while every card shows "Applied." That specific
   contradiction (full board of Applied cards above non-zero severity counts) is the most jarring single
   demo artifact and no lane named it. It's a *symptom* of H1, but a uniquely bad-looking one.

5. **Shared over-trust in "verified live" for the 81%/severity numbers.** Only Lane 4 saw the live counts
   (Critical 3 / High 61 / Medium 9); every downstream artifact (synthesis, this concern) inherits those
   exact numbers without re-derivation. I sanity-checked the *mechanism*: SCALE is hard-coded `'high'`
   (engine.ts:153) and is the most common emitter for a healthy book, so a High-dominated distribution is
   structurally expected — the claim is plausible and mechanistically sound. But the precise "61" is a
   single-lane single-observation number the whole chain leans on. Not wrong; just thinner ground-truth
   than the "verified" label implies.

---

## 7. Overstated findings to discount (summary)

- **Projected-impact column "decorative constants shown with false precision" (HIGH).** Downgrade to LOW.
  The `change` constants never render; the buyer sees qualitative labels + computed notes. Move the HIGH
  credibility weight to the **confidence score** (which IS shown and IS a magic constant for DOA/fatigue/etc).
- **"Live structure layer is UNBUILT" (top-finding wording).** Overstated direction. It's a correct,
  partially-implemented scaffold that throws at the structure mapping; insights/writes/routing/pagination/
  currency are done. Keep HIGH-for-live, fix the wording to "structure mapping + index assembly is the
  remaining slice."
- **"I applied it, why didn't ANYTHING change?" (blocker symptom framing).** Half-overstated: the card,
  the "Applied this session" tile, and the activity log DO update. The real symptom is "only half updated /
  Applied cards sit above non-zero counts." Same blocker, more accurate (and more damning) symptom.

Everything else in the synthesis's top findings I re-verified and would NOT discount.

---

## 8. Honest ship verdict (calibrated to "first-draft demo for internal testing")

**Safe for the team to start testing the demo as a first draft — after the ONE true blocker (H1) is
fixed.** I'd reduce the synthesis's "two fixes before testing" to **one hard blocker + one strong
should**:

- **True blocker (fix before testers touch it): H1 apply-staleness.** It's the headline interaction, it's
  self-contradicting on screen (Applied cards above unchanged counts; budget moves but sparkle persists),
  and it's a one-liner. This genuinely reads as "the product is broken." Non-negotiable.
- **Strong should (fix early, not a hard gate): engine window disclosure.** Re-reading it as a *demo
  tester*: this is a silent inconsistency a buyer might not even notice unless they cross-check rationale
  numbers against the table on a non-default range. It's a real trust gap and worth fixing, but it does not
  scream "broken" the way H1 does. I'd call it the top "should," not a co-blocker — the synthesis's
  "two blockers" slightly over-rates it for *demo testing* (it's correctly HIGH; it's not stop-ship).

Everything else — error boundary, responsive collapse, light-theme AA, severity inflation, confirm/undo —
is real and should harden before external eyes or live, but none of it blocks an *internal* team from
starting to test the demo today. The live-integration findings are correctly out of scope for demo testing
(the wall throws safely). And the projected-impact "blocker to credibility" is, on inspection, not the
problem it was framed as.

**Net:** ship the demo to internal testers after fixing H1. Fix the engine-window disclosure in the same
sitting (it's cheap). Treat the rest as the (accurate, well-prioritized) hardening backlog the synthesis
already laid out — with the projected-impact item downgraded and the confidence-score item promoted.

---

## Confidence

**Red-team confidence: 8/10.** Every correction above is read directly off the cited source lines (store/
hooks/demoProvider/engine/metrics/format/liveProvider/SuggestionCard/Recommendations/Campaigns/index.css/
HBars/types) plus an independent `tsc` (exit 0) and targeted greps (`projectedImpact`, `.change`,
`buildIndexes`, sort affordance). The impact-column overstatement is certain (grep-proven: zero render
path for `.change`). The H1 blocker is certain (dep arrays + store logic read end-to-end). The cap at 8:
I did **not** run the app live in this pass (I traced React render semantics statically, as the synthesis
did), so the "what visibly updates vs stays stale after apply" symptom map (§1.2, §6.4) is reasoned from
selector/dep-array reads, not observed in a browser — as close to certain as static analysis gets, but not
re-executed. The live-Meta semantics I did not and could not test against a real token; I accept Lane 2's
judgment there unchanged.
