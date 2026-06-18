# Lane 1 — AI Engine Soundness & Effectiveness

**Auditor scope:** `src/lib/ai/{engine,creative,report,thresholds,llm}.ts`, `src/lib/{metrics,selectors}.ts`, grounded against `docs/research/adops-kpis-playbook.md` and `docs/research/meta-marketing-api.md`.
**Mode:** pure research, no edits. Two prior rounds fixed 8 defects (see LEDGER); this lane goes deeper on soundness, credibility, and what's missing.

**Bottom line:** The engine is genuinely above-average for a demo. Its rule *set* is faithful to the playbook, the precedence is correct, the minimum-signal gate is real, and the prose is data-backed and specific — a media buyer would recognize it as competent. But it has three classes of real problems that the operator should fix before a team relies on it: (1) **the projected-impact numbers and several confidence scores are fabricated/decorative**, presented with a precision the math does not support; (2) **the "real-time across daily/weekly/monthly" claim is not delivered** — every decision runs off three hard-coded recent windows (3d/7d/14d) anchored to a frozen "today," and never reads the user's selected date range; and (3) **the engine is missing roughly half the plays a real buyer runs daily** — pacing/overspend alerts, anomaly/spike detection, true statistical-significance gating, audience overlap/saturation, dayparting, account-level blended-CPA guardrails, learning-reset awareness on the edits it proposes, and any attribution caveat. The heuristics it *does* implement are sound; the gap is breadth, calibration honesty, and the freshness/window story.

---

## A. Are the optimization heuristics SOUND for "orders at lowest CPA + safe scaling"?

### A.1 The rule set is faithful to the playbook (verified line-by-line)

| Engine rule | Code | Playbook §| Verdict |
|---|---|---|---|
| Min-signal gate | `engine.ts:63-65` | §4.3 | **Sound.** `spend ≥ 1×CPA`, `purchases ≥ 3`, `impr ≥ 2000` mirror the doc exactly. |
| DOA / broken upper funnel | `engine.ts:71-80` | §4.2 Trigger C | **Sound, slightly safer.** Requires impr+spend+CTR floor like the doc, AND adds `purchases ≤ 1` (doc has no purchase clause). The extra clause prevents killing a thin-CTR ad that's somehow converting — a defensible, conservative deviation. |
| Zero-conversion burn | `engine.ts:83-92` | §4.2 Trigger B | **Sound.** `spend ≥ 1.5×CPA & purchases==0`. |
| Hard cut (sustained CPA) | `engine.ts:96-113` | §4.2 Trigger A | **Sound and notably hardened.** Requires BOTH 3d (`>1.3×`) AND 7d (`>1.2×`) over target, plus `m7.purchases ≥ 5`. Requiring two windows + a higher purchase floor than the doc's `MIN_PURCHASES=3` is good defensive design — kills the single-noisy-3-day-blip failure mode. |
| Creative fatigue | `engine.ts:116-134` | §4.4 | **Sound as a composite.** Demands all four legs (freq>3, CTR −8% WoW, CPM +8% / 2wk, CPA rising). True to "fatigue is a trend, not a level." |
| Scale a winner | `engine.ts:141-168` | §4.1 | **Mostly sound.** CPA≤0.8×target, freq<3, ≥25 orders/7d, +20% step, ACTIVE (exited learning). Two real gaps — see A.3. |
| Consolidate | `engine.ts:186-212` | §4.5 | **Partially sound.** Catches sparse/learning-limited sets. Misses the audience-**overlap** clause entirely (see C.4). |
| Reallocate | `engine.ts:215-237` | §4.6 | **Directionally sound but a flag, not a plan** (see A.4). |
| Watch (early winner) | `engine.ts:171-180` | §4.3 confident-keep | **Sound and a nice touch** — explicitly resists premature scaling. |

The precedence in `analyzeAd` (DOA → zero-burn → hard-cut → fatigue → scale → watch) and the cross-level ordering (`analyzeClient` runs ad rules, then ad-set consolidation, then client reallocation) **matches the playbook's §7 precedence list** (gate → hard cut → fatigue → consolidate → scale → reallocate). This is correct and was clearly built from the doc.

### A.2 The creative funnel diagnosis (hook → hold → convert) is sound and correctly ordered

`creative.ts:53-92` walks the exact §5.1 decision table in the right order: unproven gate → fatigue → hook_weak (video) → body_weak (video) → convert_weak (CTR ok but CVR low ⇒ "fix the page, not the ad") → winner → steady. The one-line heuristic from the doc ("low hook = bad first 3s; good hook + low hold = weak body; good CTR + low CVR = LP/offer") is implemented verbatim in branch logic. **Unit handling is correct** (verified): `metrics.ts` stores `hookRate`, `holdRate`, `cvr` as *percentages*; the diagnosis divides by 100 before comparing to the fractional floors (`m.hookRate/100 < 0.25`, `m.cvr/100 < 0.012`) — consistent, no off-by-100 bug.

**One real ordering gap:** the §5.1 table has a **"good hold, low link CTR → CTA/desire"** rung between body and convert. The engine has no `cta_weak` diagnosis — a creative that hooks and holds but has a weak CTA/offer-on-screen falls through to `convert_weak` (blaming the landing page) or `steady`. For a buyer this is a meaningful misdiagnosis: it sends them to fix the LP when the ad's CTA is the problem. **Medium.**

### A.3 SCALE has two soundness gaps the buyer will feel

1. **No cooldown enforcement (known, ledgered).** `scaleCooldownDays=3` exists in thresholds but is never read — there's no `lastScaledAt` in the model. The engine can re-surface the same +20% scale every day. The LEDGER is honest about this, but the *consequence* is under-stated: in a live loop, repeatedly applying +20% daily **is exactly the relearn-triggering behavior the playbook warns against** (§4.1 "never exceed +20% per edit" assumes spacing). The cooldown is not a nicety; without it the scale rule is unsafe to automate. **High** (for live mode), low for demo.

2. **Scale fires on a single ad's metrics but raises the whole budget holder.** `analyzeAd` judges *one ad* (`m3.cpa`, `m7.purchases` for `[ad.id]`), then `budgetHolder()` raises the **campaign (CBO)** or ad-set budget (`engine.ts:153-167`). Under CBO, one strong ad's 25 orders justify a +20% bump to a campaign that may contain several mediocre ads — Meta will not necessarily route the new budget to the winner. The dedup-by-id (`engine.ts:254-255`) hides this: multiple ads in a CBO campaign collapse to one SCALE card keyed on the *first* ad in iteration order, so the surfaced rationale ("3-day CPA $X on N orders/7d") describes **one ad**, not the budget holder being scaled. The number shown is not the number being acted on. **Medium-High** — the rationale is honest about the ad but misleading about what the budget change will do.

3. **`m3.cpa` thresholds on 3 days of one ad's data are noisy.** Scale requires `m7.purchases ≥ 25` (good) but gates the *decision* on `m3.cpa ≤ 0.8×target`. A single ad's 3-day CPA is a high-variance estimate; pairing the volume bar (7d) with the efficiency bar (3d) is reasonable, but the doc's "cpa_trend flat-or-improving" guard (§4.1) is **not implemented** — the engine never checks that 3d CPA isn't deteriorating vs 7d. It can scale an ad whose CPA is spiking up but still momentarily under 0.8×. **Medium.**

### A.4 REALLOCATE is a flag, not the actionable plan the doc describes

`analyzeReallocation` (`engine.ts:215-237`) detects a wide CPA spread across active ad sets and emits one client-level card. But §4.6 asks for a *ranked, bounded reallocation* (shift ≤20% toward CPA<0.8×target, starve 30% from CPA>1.3×, never move >20%/day). The engine produces no per-ad-set move list, no amounts, and the action is `kind: 'consolidate'` → "Open reallocation," i.e. a navigation, not a proposed change. The projected impact `−0.1 blended CPA` is invented (see B). For a buyer this is a "you have spread" banner, not a reallocation tool. **Medium** — directionally right, operationally thin.

### A.5 Creative-iteration bias: present in spirit, inconsistent in the engine

The LLM system prompt (`llm.ts:42`) and fatigue rationale ("iterate the winning angle rather than abandoning it," `engine.ts:128`) correctly bias toward creative. The `nextBatchPlan` (`creative.ts:133-172`) leans into iterate-winners. **But the engine emits no `NEW_CREATIVE_ANGLE`, `FIX_LANDING_OFFER`, or `EXPAND_AUDIENCE` suggestions** even though those `SuggestionType`s exist (`types.ts:249-259`). The richest creative judgments live in `creative.ts` and never become suggestions on `/recommendations`. So the convert_weak "fix the LP" insight, the hook_weak "re-cut opener" insight — the highest-leverage creative plays — are visible in the Creative Lab but absent from the action feed where a buyer triages. The bias is stated but under-delivered as *actions*. **Medium.**

---

## B. Are thresholds, precedence, projected-impact, and confidence CREDIBLE / USEFUL — or noisy/over-confident?

### B.1 Thresholds: credible, well-sourced, tunable — minor calibration notes

`thresholds.ts` is the strongest file in the lane. Every constant traces to the playbook, deviations are commented with rationale (e.g. fatigue CTR/CPM use the **low end** of the 10-25% band "to catch fatigue earlier"; `scaleMinPurchases7d=25` is "slightly under research's 30 to surface more in demo"). That last one is an honest demo-tuning admission but worth flagging: **25 vs the doc's 30 (and Meta's ~50 events/week learning bar) means the engine will green-light scaling at sub-significance volume.** For real accounts the operator should raise this back toward 30-50. **Low/Note.**

`reallocateCpaSpread=0.35`, `consolidateMinEventsPerWeek=18`, fatigue legs — all defensible directional priors. The `BENCHMARKS` block is used only for context badges and the `convert_weak` CTR gate; fine.

### B.2 Projected-impact math is NOT defensible — it is mostly decorative

This is the most important credibility problem. The `ProjectedImpact.change` field is rendered to users as a signed number, but most values are **hard-coded constants with no derivation**:

- Hard cut: `change: -0.15` (`engine.ts:109`) — a flat "−15% CPA drag," same for every cut regardless of how far over target.
- Fatigue: `change: 0.12` "Recover CTR" (`:130`) — invented.
- Consolidate: `change: -0.08` (`:204`) — invented.
- Reallocate: `change: -0.1` "−Blended CPA" (`:233`) — invented.
- Scale: `change: 0.2` (`:157`) — this one literally equals `scaleStepPct`; it's the *budget* step mislabeled as a +Orders impact.

Only **one** projected number is actually computed from data: the scale card's `extraOrdersMo = round((extraDaily / m3.cpa) * 30)` (`engine.ts:151`). That math is first-order defensible (extra budget ÷ current CPA × 30 days) **but rests on the assumption that marginal CPA equals average CPA at +20% spend** — which contradicts the engine's own scaling caveats (CPA rises as you scale; that's why the step is capped). So even the one real number is optimistic by construction and presented without that caveat. The "DOA recovers ~$spend/7 per day" notes (`:76,:88`) are arithmetically fine (they're just `spend/7`) but framed as "recovered," implying that budget converts to savings rather than being re-spent elsewhere.

**Net:** a media buyer who trusts the projected-impact column is being misled. These should either be removed, labeled "illustrative," or replaced with honest ranges. **High** — this is the single most over-confident surface in the engine.

### B.3 Confidence scores: half are dynamic and reasonable, half are magic constants

- **Dynamic, defensible:** hard-cut `clamp(0.6 + min(orders/80, 0.3), …)` and scale `clamp(0.62 + min(orders/90, 0.3), …)` — confidence rises with volume. The *shape* is sound (more orders → more confidence). But the constants (80, 90, the 0.6/0.62 floors, the 0.3 ceiling) are arbitrary; there is no calibration that "0.85 confidence" means anything like an 85% hit rate. It's a monotone proxy, not a probability.
- **Hard-coded:** DOA 0.9, zero-burn 0.85, fatigue 0.78, consolidate 0.7, reallocate 0.66, watch 0.55. These are vibes. DOA at **0.90** is the highest-confidence call in the system, yet a genuinely-low-CTR creative *can* still be a measurement artifact (tracking gap, broken pixel, view-through orders not attributed within window). 0.90 over-states certainty.

The honest framing exists in the LEDGER and the engine header comment ("a SIGNAL a buyer weighs, not a backtested edge"), which is exactly right — but **that disclaimer lives in docs, not on the card.** A buyer sees "Confidence 90%" with no asterisk. **Medium** — the scores are useful as a *relative ranking* (sort order in `sortSuggestions` uses them sensibly) but should not be shown as if calibrated.

### B.4 Precedence: correct, with one dedup honesty caveat

`sortSuggestions` (`engine.ts:264-267`) sorts by severity then confidence — correct. The per-ad precedence is correct. The one caveat (B.A.3 above): CBO dedup keeps the first ad's card, so the displayed entity rationale can describe a different ad than the one whose budget moves. Worth a code comment at minimum; ideally the scale rationale should aggregate the budget holder's metrics, not one ad's.

---

## C. High-value plays a real buyer wants that the engine MISSES

This is where the engine is thinnest relative to "run your day from it."

### C.1 Budget pacing / overspend alerts — computed but never an alert (HIGH)
`report.ts:76-83` computes MTD spend, a linear projection, and `pace = projection/monthlyBudget` — good. But it's **buried in the weekly report**, runs only at client level, only for the *current* month, and **never generates a suggestion**. There is no "Client X is pacing 140% — pull back" or "underspending, you'll miss the contract" card on `/recommendations`. Pacing is one of the top-three things an agency buyer checks daily; here it's a number in a digest, not a guardrail. Also the projection is naive linear (no day-of-week weighting, no remaining-budget redistribution).

### C.2 Anomaly / spike detection — absent (HIGH)
Nothing detects a sudden CPM spike, a CPA blowout day, a spend spike, or a conversion-tracking dropout (purchases → 0 across many ads = a pixel break, not a performance problem). The `volatile` archetype exists in the data generator (`generate.ts:278`) but no rule flags volatility. A buyer's morning question — "what broke overnight?" — has no answer here. The fixed-window aggregates would actively *mask* a one-day spike inside a 7-day average.

### C.3 Statistical-significance gating — proxied, not real (MEDIUM)
The "gate" is a count threshold (`purchases ≥ 3/5/25`). That is the *practitioner proxy* the doc itself flags as rough (§4.3: "signal quality/consistency matters as much as count"). There is no confidence-interval test, no two-proportion test for A/B creative comparison, no minimum-detectable-effect logic. `cpaPercentile` (`creative.ts:45-48`) ranks creatives by CPA with **zero significance weighting** — a creative with 4 orders can outrank one with 120 on the leaderboard. For a tool whose headline is "AI analysis," genuine significance gating (even a simple Wilson interval on CVR) would be a real differentiator and prevent the cardinal sin the doc warns about.

### C.4 Audience overlap / saturation — absent (MEDIUM)
§4.5 explicitly lists "multiple ad sets share near-identical audiences (overlap) competing in auction" as a consolidation trigger. The engine's consolidation only counts sparse/learning-limited sets — it never compares `AudienceSpec`s for overlap (the data has `audience.type` and `label`, `types.ts:96-102`, so a heuristic — e.g. two `lookalike`/`interest` sets in one campaign — is feasible). Auction overlap (self-competition) is a classic spend-waster the buyer expects flagged.

### C.5 Dayparting — absent (MEDIUM/LOW)
No hour-of-day or day-of-week analysis. The API doc calls out `hourly_stats_aggregated_by_advertiser_time_zone` (`meta-marketing-api.md:458`) as the dayparting breakdown, and the generator even bakes in weekly seasonality (`generate.ts:471-472`), but nothing surfaces "you're burning budget 1-5am at 2× CPA." Lower priority than pacing/anomaly but a known lever.

### C.6 Account-level blended-CPA / MER guardrails — absent (HIGH for the client conversation)
The playbook is emphatic (§1.5, §6.2): steer on **blended MER / cmROAS**, judge ROAS vs **breakeven**, lead the client conversation with the blended number. The `Client` type carries `contributionMargin` and `targetROAS` (`types.ts:46-49`) — so breakeven ROAS (`1/margin`) is computable — but **nothing in the engine computes or enforces breakeven ROAS**, and there is no blended/MER concept anywhere (the tool only sees Meta-platform data, which the doc says over-counts post-iOS14). No account-level guardrail like "blended CPA across all this client's campaigns is above target even though individual ad sets look fine." The engine optimizes per-entity and never rolls a profitability guardrail up to the account. This is the gap between "in-platform optimizer" and "is the client growing profitably" — the doc's central distinction.

### C.7 Learning-phase reset awareness on the engine's OWN edits — absent (HIGH)
The engine proposes +20% scales and pauses, but **never warns that its own action resets/disturbs the learning phase.** The playbook (§4.1) is explicit: >20% jumps reset learning (~50 events / 48-72h of 35-60% inflated CPA). The scale step is capped at 20% (good) but (a) the cooldown isn't enforced (A.3), and (b) consolidation and reallocation proposals (merging ad sets, shifting budget) are *major* learning-disrupting edits with no "expect a 48-72h relearn dip" caveat in the rationale. A buyer who applies a consolidation expecting immediate improvement will see CPA worsen first and distrust the tool. The awareness exists in the docs but never reaches the recommendation.

### C.8 Attribution caveats — absent from every number (MEDIUM)
The API doc is emphatic that platform purchases **undercount** post-ATT, that the window is 7d-click+1d-view, and that you must reconcile to first-party data (`meta-marketing-api.md:500,764`). The engine treats `purchases`/`revenue`/`cpa`/`roas` as ground truth in every rationale ("0 orders," "$X CPA") with **no attribution-window note anywhere** in `engine.ts`, `creative.ts`, or `report.ts`. The zero-conversion PAUSE (`engine.ts:83`) is the riskiest: an ad with view-through or longer-window conversions that don't land in the attribution window reads as "0 orders → kill," which can pause a genuinely-working ad. At minimum the rationale should say "0 attributed orders (7d-click/1d-view)."

### C.9 Cost decomposition (CPM × CTR × CVR) — computed nowhere as a diagnosis (MEDIUM)
The doc's repeated instruction (§1.4, §7: "decompose a bad CPA into CPM × CTR × CVR before acting") is implemented for *creatives* (the funnel diagnosis) but **not for ad-set/campaign CPA problems.** When the hard-cut or reallocate rule fires, the rationale says "CPA is X% over target" but never tells the buyer *which multiplicand* is the culprit (expensive reach? weak click? weak close?). That decomposition is the single most useful thing the doc asks for and it's missing from the spend-side rules.

---

## D. Is "real-time analysis across daily / weekly / monthly" genuinely delivered?

**No — and this is the biggest expectation gap.** Three concrete findings:

### D.1 Every engine decision uses FIXED recent windows, not the user's selected range (HIGH)
`analyzeAd` hard-codes `lastNDays(3)`, `lastNDays(7)`, `lastNDays(7,7)`, `lastNDays(14)`, `lastNDays(14,14)` (`engine.ts:53-57`). `analyzeClient`/`analyzeScope` take **no `DateRange` parameter.** So when the operator changes the global date picker (the app's headline control — `metrics.ts:133` `makeRange` supports today/7d/14d/28d/mtd/custom), **the suggestions do not change.** The dashboards re-aggregate to the selected range, but the AI recommendations are frozen on the last-3/7/14-day view. A buyer inspecting "last 28 days" or a custom range sees recommendations computed from a different window than the numbers on screen — a silent inconsistency that will read as a bug.

### D.2 "Real-time" is anchored to a frozen DATA_TODAY (expected in demo, must change for live)
`lastNDays` is anchored to `today()` = `DATA_TODAY` = `'2026-06-17'` (`generate.ts:29`, `metrics.ts:103-105`). Fine and honest for the demo. But there is **no incremental-sync / freshness concept** anywhere — no "data as of," no partial-day handling, no staleness flag. The LEDGER admits "automated scheduled syncs" are not built. So "real-time" today means "recomputed on every render from a static seed," not streaming or even scheduled-refresh. The word "real-time" in the product framing over-promises against what's built.

### D.3 Daily / weekly / monthly are not three coherent lenses
- **Daily:** only implicit via the 3-day window; there's no single-day anomaly view for the engine (the dashboard has a single-day edge case, but the engine doesn't reason daily).
- **Weekly:** genuinely delivered — `report.ts` builds a real last-completed-Mon-Sun vs prior-week report with WoW deltas, movers, leaderboard, pacing, narrative. This is the strongest "temporal" surface.
- **Monthly:** only pacing (MTD projection). No month-over-month trend, no monthly creative-fatigue curve, no seasonality read despite the generator modeling it.

So of the three cadences claimed, **one (weekly) is real, one (monthly) is a single pacing number, and one (daily) is effectively absent** from the engine's reasoning. The marketing claim "real-time analysis across daily/weekly/monthly" is materially ahead of the implementation.

### D.4 Window methodology caveat: "frequency" is averaged, not true-period (MEDIUM)
`metrics.ts:41` computes `frequency = Σimpressions / Σreach`, but `reach` is summed additively across days (`types.ts:180` calls it an "additive approximation"; aggregate sums it `metrics.ts:23`). Because daily reach summed over 7 days **exceeds** true 7-day unique reach, the computed 7-day frequency ≈ the *average daily* frequency, which **understates true rolling 7-day frequency.** The fatigue rule (`freq>3`) and scale gate (`freq<3`) both hinge on this. In live data this will systematically *under-flag* fatigue and *over-permit* scaling on frequency grounds. The playbook explicitly warns frequency is "window-dependent — always cite the window" (§1.1); the engine cites "7d frequency" but the number isn't a true 7-day frequency. This is a real methodology bug for the live path, masked in demo because the generator constructs reach from a per-day frequency so the average happens to look plausible.

---

## E. Smaller but real findings

- **`report.ts` pacing day-count off-by-context.** `dayOfMonth = daysBetween(monthStart, today()) + 1` (`:80`) and `projection = (spent/dayOfMonth) * daysInMonth`. On the 1st of a month this divides by 1 day of (likely partial) data and extrapolates to the full month — wildly volatile early-month projections with no smoothing or "insufficient data" guard. **Low.**
- **Movers need `spend > 3×targetCPA`** (`report.ts:50`) to qualify — a reasonable significance floor, but it's a *spend* gate not a *conversion* gate, so a high-spend zero-converter can still be named a "mover" by CPA delta math on tiny denominators. **Low.**
- **Creative leaderboard / `cpaPercentile` ignore volume** (`creative.ts:45-48`) — ranks by raw CPA with no significance weighting, so a 4-order creative can top a 120-order one. Misleads "what's our best creative." **Medium** (overlaps C.3).
- **`nextBatchPlan` "static cutdown vs video cut" suggestion** (`creative.ts:153`) keys off `bestFormat?.label === 'Video'` string equality after `cohortLabel` capitalizes it — fragile but currently correct. **Note.**
- **No retargeting-vs-prospecting frequency split.** Fatigue uses a single `freq>3` bar; the doc (§2.4) says retargeting tolerates freq 4-8. The data has `audience.type==='retargeting'`, so the engine *could* relax the bar for RT sets but doesn't — it will over-flag retargeting ads as fatigued. **Medium.**
- **LLM layer is honest and well-shaped** (`llm.ts`) — correct models, graceful `null` fallback, good system prompt (breakeven-aware, creative-bias, cite-the-number). It's a scaffold (`USE_LLM=false`) and labeled as such. No issue; noting it does the right things.

---

## F. What the engine gets RIGHT (so the operator weights this fairly)

- Faithful, well-sourced rule set with correct precedence and a real minimum-signal gate — the hardest part to get right, and it's right.
- Reads only generated insights, never the hidden archetypes (`generate.ts:45` "engine never reads these") — so it genuinely rediscovers patterns; not a rigged demo.
- Defensive hardening beyond the doc (two-window hard cut, ACTIVE-only scale, `purchases≤1` on DOA, positive status allowlist on consolidation) shows the author understood the failure modes.
- Funnel diagnosis is the doc's table, in order, with correct units.
- Weekly report is a genuinely useful artifact.
- The honesty infrastructure (LEDGER, header comments, `confidence` framed as a signal) is exemplary — the *docs* are honest even where the *UI* over-claims.

---

## G. Prioritized recommendations for the operator (before the team tests)

1. **(HIGH) Fix or label projected-impact.** Replace the hard-coded `change` constants with computed estimates where possible, or relabel the column "illustrative / directional" and drop the false precision. The scale `+0.2` mislabel (budget step shown as orders impact) should be corrected outright.
2. **(HIGH) Thread the selected `DateRange` into `analyzeClient/analyzeScope`,** or pin the recommendation window visibly ("Recommendations based on last 7/14 days") so the engine and the on-screen numbers don't silently disagree.
3. **(HIGH) Add pacing/overspend and anomaly/tracking-break suggestions** to `/recommendations` — these are daily must-haves and pacing is already 80% computed in `report.ts`.
4. **(HIGH) Enforce scale cooldown and add a learning-reset caveat** to every budget/consolidation/reallocation rationale before any of this can run in auto mode.
5. **(MEDIUM) Add account-level blended/breakeven-ROAS guardrail** (breakeven is computable from `contributionMargin`) and surface attribution-window caveats on order/CPA claims, especially the zero-conversion pause.
6. **(MEDIUM) Add the missing creative rungs** (cta_weak), promote `convert_weak`/`hook_weak` into actionable suggestions, and weight `cpaPercentile`/leaderboard by volume.
7. **(MEDIUM) Fix the windowed-frequency methodology** before live, or it will under-flag fatigue and over-permit scaling.
8. **(MEDIUM) Add audience-overlap consolidation and CPM×CTR×CVR decomposition** to the spend-side rationales — both are explicit doc asks.

---

### Confidence & ground-truth

Confidence in this lane: **8/10.** Every load-bearing claim was verified by reading the actual source (engine/creative/report/thresholds/llm/metrics/selectors/types/generate) and cross-referencing the two research docs line-by-line. The unit-consistency, precedence, fixed-window, hard-coded-impact, dedup-keying, and frozen-anchor findings are read directly off the code. The frequency-averaging finding is a derivation from the aggregation code + generator and is the one claim resting on reasoning rather than execution (I did not run the data to measure the magnitude of the under-count — flagged as such). I did not execute the app or the engine; all conclusions are static-analysis + doc-grounding.
