# DTC Meta Ads — KPIs, Benchmarks & Optimization Playbook

> **Purpose.** Reference spec for the AI engine inside an AI-driven Meta ads command center serving a DTC/ecommerce agency. Most campaigns optimize for **ORDERS at the lowest possible CPA**. This document defines the metrics, healthy ranges, account-structure playbooks, and—most importantly—the **threshold-based decision rules** the engine should encode directly as code.
>
> **How to read this doc.** Anything tagged **[DIRECTIONAL]** is a community/practitioner heuristic that varies by vertical, AOV, geo, and season—treat as a starting prior, not ground truth. Anything tagged **[CONTESTED]** is actively debated among practitioners. Anything tagged **[HARD RULE]** is a platform mechanic (Meta-enforced) and is reliable.
>
> _Last grounded against 2024–2025 practitioner sources (see "Sources" at end). Date of authoring: 2026-06-17._

---

## 0. Quick mental model

The DTC Meta funnel has three diagnostic layers. Almost every optimization decision maps to one of them:

1. **Did the ad get attention?** → impression-level metrics (CPM, hook rate, CTR).
2. **Did it earn the click and engagement?** → engagement metrics (hold/thruplay rate, link CTR, CPC).
3. **Did it produce a profitable order?** → outcome metrics (CVR, CPA/CPP, AOV, ROAS, contribution margin).

The engine's job is to (a) **measure** each layer, (b) **localize** where a creative or ad set is failing, and (c) **act**—scale, cut, consolidate, or flag a creative-refresh.

---

## 1. Core KPIs & Exact Definitions

All formulas below are the standard Meta/DTC definitions. Where Meta's UI uses a specific column name, it's noted.

### 1.1 Spend / delivery metrics

| Metric | Formula | Notes |
|---|---|---|
| **Impressions** | count | Times the ad was rendered (not unique). |
| **Reach** | unique users | Unique people who saw the ad ≥1×. |
| **Frequency** | `Impressions ÷ Reach` | Avg times each person saw the ad over the date range. **Window-dependent**—always cite the window (e.g. "7-day frequency"). |
| **CPM** (cost per mille) | `(Spend ÷ Impressions) × 1000` | Cost to show the ad 1,000 times. Proxy for auction competitiveness + creative quality (relevance lowers effective CPM). |
| **CPC (all)** | `Spend ÷ Clicks (all)` | Includes all clicks (reactions, profile, expand, etc.). Vanity-ish. |
| **CPC (link)** | `Spend ÷ Link Clicks` | Cost per click that could load a destination. **Use this one** for traffic efficiency. |

### 1.2 Click / engagement metrics

| Metric | Formula | Notes |
|---|---|---|
| **CTR (all)** | `(Clicks (all) ÷ Impressions) × 100` | Inflated by non-destination clicks. |
| **CTR (link)** | `(Link Clicks ÷ Impressions) × 100` | Standard engagement metric. |
| **Outbound CTR** | `(Outbound Clicks ÷ Impressions) × 100` | Clicks that *leave* Meta (truest "they went to the site"). Slightly lower than link CTR. **Preferred for off-platform DTC.** |
| **Hook rate** (a.k.a. thumbstop rate) | `(3-sec video plays ÷ Impressions) × 100` | Did the first 3 seconds stop the scroll? Diagnoses the **opening**. |
| **Hold rate** | `(15-sec* video plays ÷ 3-sec video plays) × 100` | Of those who stopped, how many stayed into the body? Diagnoses the **middle**. _*Some stacks use ThruPlay (15s OR completion) or 75% completion as the numerator—define this once and be consistent. **[DIRECTIONAL]** on which threshold._ |
| **ThruPlay rate** | `(ThruPlays ÷ Impressions) × 100` | ThruPlay = watched ≥15s or to completion if shorter. Meta's native "did they actually watch" video metric. |
| **Avg watch time / completion %** | platform-reported | Secondary body-strength signals. |

### 1.3 Outcome / economic metrics

| Metric | Formula | Notes |
|---|---|---|
| **Conversions / Purchases** | count of purchase events | The optimization event for order campaigns. |
| **CVR (conversion rate)** | `(Purchases ÷ Link Clicks) × 100` | Landing-page-to-order efficiency. _Some define CVR as Purchases ÷ Sessions; be explicit. **[DIRECTIONAL]** on denominator._ |
| **Cost per Add-to-Cart** | `Spend ÷ Adds-to-Cart` | Mid-funnel cost signal; rising ATC cost with flat purchase cost = checkout/offer problem. |
| **ATC→Purchase rate** | `(Purchases ÷ Adds-to-Cart) × 100` | Isolates checkout/offer friction from upper funnel. |
| **CPA / CPP** (cost per acquisition / cost per purchase) | `Spend ÷ Purchases` | **The North-Star cost metric for order campaigns.** "CPA" and "CPP" are used interchangeably here. |
| **AOV** (average order value) | `Purchase Revenue ÷ Purchases` | Revenue per order. Drives how high CPA can go. |
| **ROAS** | `Purchase Revenue ÷ Spend` | Platform-reported revenue efficiency. **Attribution-dependent** (see §1.4). |
| **Conversion Value / Revenue** | Σ purchase values | Numerator of ROAS. |

### 1.4 The relationships that matter (the algebra the engine should know)

```
ROAS              = AOV ÷ CPA                       (so a CPA target ⇔ a ROAS target given AOV)
CPA               = CPM ÷ (CTR_link × CVR × 10)     (cost stacks multiplicatively down the funnel)
                    # derivation: CPA = CPM/1000 ÷ (CTR_link/100 × CVR/100)
CPC_link          = CPM ÷ (CTR_link × 10)
Purchases         = Impressions × CTR_link × CVR    (as fractions)
Breakeven ROAS    = 1 ÷ Contribution Margin %       (decimal margin)
Max profitable CPA= AOV × Contribution Margin %     (first-order; ignores LTV)
```

**Key implication for the engine:** a bad CPA is always traceable to one of three multiplicands—**CPM (too expensive to reach)**, **CTR (creative doesn't earn the click)**, or **CVR (page/offer doesn't close)**. Decompose before acting.

### 1.5 Blended vs platform metrics **[DIRECTIONAL but increasingly standard]**

Post-iOS14, platform-reported ROAS over-counts. Sophisticated DTC teams steer on:

- **MER** (Marketing Efficiency Ratio) = `Total Store Revenue ÷ Total Ad Spend` (all channels). The "is the whole machine working" number.
- **Blended ROAS** = same idea, sometimes scoped to paid revenue.
- **aMER / new-customer MER (nc-CAC)** = revenue or new-customer revenue ÷ spend; isolates acquisition.
- **cmROAS (contribution-margin ROAS)** = `Contribution-margin dollars ÷ Spend`. Optimizing to cmROAS targets *profit*; optimizing to blended ROAS targets *revenue*. The engine should let the agency pick which objective a campaign serves.

> The command center should display **both** platform CPA/ROAS (for in-platform optimization) **and** blended MER (for the "are we actually growing profitably" client conversation).

---

## 2. Healthy Benchmark Ranges (Ecommerce / DTC) — **ALL [DIRECTIONAL]**

> ⚠️ **These vary heavily by vertical, AOV, offer, geo, and season.** A "good" number for a $25 supplement is a disaster for a $400 sofa. Use as priors; calibrate per-account from the account's own trailing baseline. BFCM/peak periods inflate CPM/CPC ~15–20%.

### 2.1 Delivery & click benchmarks (Meta, ecommerce)

| Metric | Weak | Typical / median | Strong | Source signal |
|---|---|---|---|---|
| **CTR (link)** | <1.0% | 1.4%–2.2% (cross-industry median ~2.2%) | >2.5% | Multiple 2025 benchmark sets |
| **CPM** | >$25 | ~$13–$15 median (rose ~+20% YoY into 2025; BFCM '24 peaked ~$20) | <$10 | Triple Whale / WordStream 2025 |
| **CPC (link)** | >$1.50 | ~$0.70–$1.00 | <$0.50 | 2025 cross-industry |
| **CVR (click→purchase)** | <1.0% | ~1.5%–2.5% | >3% | Median ~1.57% cross-industry |
| **CPA / CPP** | — | cross-industry median ~$38 (meaningless without AOV) | — | Set per-account vs. breakeven, not vs. global median |

### 2.2 Video creative benchmarks **[DIRECTIONAL]**

| Metric | Needs work | Average | Strong |
|---|---|---|---|
| **Hook rate** (3s ÷ impr.) | <20–25% | 25–30% | >30% (top performers 30–45%) |
| **Hold rate** (15s ÷ 3s) | <30% | 40–50% | >60% |
| **Hold @ 15s on cold traffic (abs.)** | — | 15–25% | — |

### 2.3 ROAS: "good" vs breakeven **[DIRECTIONAL]**

- A common rule of thumb is **3:1–4:1 ROAS = healthy** for ecommerce, **but this is only meaningful relative to breakeven.**
- **Breakeven ROAS = 1 ÷ contribution margin.** Examples: 20% margin → BE-ROAS 5.0; 40% margin → 2.5; 60% margin → ~1.67.
- **Rule the engine should enforce:** judge ROAS against the *account's* breakeven, never a global "3x." A 2.0 ROAS at 60% margin is profitable; a 3.0 ROAS at 20% margin loses money.

### 2.4 Frequency / fatigue thresholds **[DIRECTIONAL]**

| Audience | Comfortable | Watch zone | Fatigue likely |
|---|---|---|---|
| **Prospecting / broad** (7-day freq.) | <2.0 | 2.5–3.0 | >3.0–4.0 (perf falls off a cliff past ~4) |
| **Retargeting** (7-day freq.) | <4 | 4–6 | >7–8 |

Frequency alone is not a kill signal—pair it with **rising CPA + falling CTR** (see §4.4).

---

## 3. Account Structure Playbooks

### 3.1 ABO vs CBO vs ASC — decision matrix

| | **ABO** (Ad Set Budget) | **CBO / Advantage+ Campaign Budget** | **ASC / Advantage+ Shopping** |
|---|---|---|---|
| Budget lives at | Ad set | Campaign (Meta allocates across ad sets) | Campaign (fully automated) |
| Control | High (guarantee each variant spends) | Medium | Low (Meta runs targeting/placements/budget) |
| **Use when** | Early-stage **testing**; clean per-variant data; small budget; new pixel with thin events | You know your top audiences/creatives and want to **scale**; pixel sees ≥~50 conv/wk | Catalog ecommerce, defined geo, ≥~$5k/mo per market, mature pixel |
| Primary role in our system | **Testing campaigns** | **Scaling campaigns** | **Core evergreen scaling / acquisition workhorse** |
| Risk | Manual reallocation overhead | Budget can starve a good ad set | Black-box; hard to read per-segment |

**2024–2025 reality [DIRECTIONAL]:** Meta merged ASC into the standard **Sales objective** and now defaults most ecommerce advertisers into Advantage+ flows; Advantage+ adoption reportedly passed ~80% of ecommerce advertisers by mid-2025. Meta's own analysis claimed ~32% lower cost per incremental conversion when ASC ran alongside manual campaigns. **[CONTESTED]**—incrementality and self-reported lift are debated; the engine should not treat vendor lift claims as ground truth.

### 3.2 Testing vs Scaling campaign separation (recommended default architecture)

- **Testing campaign(s):** ABO (or low-budget CBO), broad-ish audience, the job is to generate **clean creative read** at minimum viable spend. New creatives enter here.
- **Scaling campaign(s):** CBO / ASC, holds **proven winners** graduated from testing. This is where budget concentrates.
- **Graduation rule:** a creative moves test→scale once it clears the "judge an ad" minimums (§4.3) AND beats target CPA. Losers are cut at the test stage—cheaply.

### 3.3 Targeting trends 2024–2025 **[DIRECTIONAL]**

- The clear shift is **toward broad + Advantage+ Audience** (suggestion, not constraint) and **away from granular interest/LAL stacking.** With strong creative + pixel signal, Meta's algorithm out-targets manual interest selection in most DTC accounts.
- Lookalikes still have a role but are increasingly used as an *Advantage+ audience suggestion* rather than a hard segment.
- **Implication for the engine:** "audience" is becoming less of a lever and **creative is the primary variable.** Bias the system's recommendations toward creative iteration over audience micro-segmentation.

---

## 4. Optimization Decision Rules (the part to encode as code)

> Design notes for implementation:
> - All rules below operate on a per-ad-set or per-ad basis over a **rolling window** (default 3-day and 7-day).
> - Every rule has a **guard**: do not act until the entity clears a **minimum-signal gate** (§4.3). Acting on thin data is the #1 way an automated system destroys accounts.
> - Thresholds are **parameterized** (`TARGET_CPA`, `MIN_PURCHASES`, etc.) so the agency can tune per client. Defaults given are **[DIRECTIONAL]**.
> - Prefer **flag-for-review** over fully-autonomous spend changes until the system has earned trust; expose every rule as "auto" vs "suggest."

### 4.0 Parameters (defaults — tune per account)

```yaml
TARGET_CPA:            # set per account = AOV × contribution_margin (or client-set)
BREAKEVEN_ROAS:        1 / contribution_margin
MIN_PURCHASES_JUDGE:   3          # minimum purchases before any cut on CPA  [DIRECTIONAL]
SIG_PURCHASES:         30         # "statistically meaningful" purchase count [DIRECTIONAL]
LEARNING_EVENTS_WK:    50         # Meta learning-phase exit target           [HARD RULE]
MIN_SPEND_JUDGE:       1.0 × TARGET_CPA  # "give it a chance" floor; 1.5–2× for video tests [DIRECTIONAL]
SCALE_WINDOW_DAYS:     3
CUT_WINDOW_DAYS:       3
SCALE_STEP_PCT:        20         # max budget increase per edit              [HARD-ish: >20% risks relearn]
SCALE_COOLDOWN_DAYS:   3          # wait between scale steps (2–3 typical)
FREQ_FATIGUE_PROSPECT: 3.0
```

### 4.1 SCALE a winner — when & how

**Trigger (all must hold):**
```
ad_set.purchases_7d        >= SIG_PURCHASES (or >= LEARNING_EVENTS_WK if available)
AND ad_set.cpa_3d          <= TARGET_CPA × 0.80        # beating target by ≥20%
AND ad_set.cpa_trend_3d    is flat or improving        # not deteriorating
AND ad_set.frequency_7d    <  FREQ_FATIGUE_PROSPECT
AND ad_set exited learning phase (Active, not "Learning Limited")
AND days_since_last_scale  >= SCALE_COOLDOWN_DAYS
```
**Action (vertical scaling):**
```
new_budget = current_budget × (1 + SCALE_STEP_PCT/100)   # ≤ +20%
then HOLD for SCALE_COOLDOWN_DAYS before re-evaluating
```
**Guardrails:**
- **Never exceed +20% per edit** — larger jumps reset learning (~50 events / 48–72h of unstable, 35–60% inflated CPA). **[HARD-ish RULE]**
- If `CPA` is **within 10% of target** (not comfortably under), **slow or pause scaling** — there's no margin to absorb a relearn. **[DIRECTIONAL]**
- Prefer **vertical** (budget bump on the winner) over horizontal early; **horizontal scaling** (duplicate winner into new audiences/ASC) is for when vertical headroom is exhausted.

### 4.2 CUT / PAUSE a loser — when

**Trigger A — proven loser (has data):**
```
ad.purchases       >= MIN_PURCHASES_JUDGE
AND ad.cpa_3d      >  TARGET_CPA × 1.30        # ≥30% over target, 3-day
→ PAUSE (or, at ad-set level, reduce budget 30% and re-check in 3d)
```
**Trigger B — "spent its chance," no conversions:**
```
ad.spend           >= MIN_SPEND_JUDGE × 1.5     # ~1.5–2× target CPA
AND ad.purchases   == 0
→ PAUSE
```
**Trigger C — broken upper funnel (cut early, cheaply):**
```
ad.impressions     >= 2000
AND ad.ctr_link    <  0.5%                       # creative can't earn the click
AND ad.spend       >= MIN_SPEND_JUDGE
→ PAUSE (creative DOA; don't wait for purchases)
```
> Meta's own Automated Rules pattern, for reference: *"if CPA > target × 1.4 for 3 days → reduce budget 30% + alert."* Our defaults are slightly tighter (×1.3) and pair with the minimum-signal gate.

### 4.3 Minimum-signal gate — **DO NOT judge before this** **[DIRECTIONAL]**

An ad/ad set is **"not yet judgeable on CPA"** until it clears:
```
spend     >= MIN_SPEND_JUDGE        (≥ ~1× target CPA; 1.5–2× for video)
AND (purchases >= MIN_PURCHASES_JUDGE  OR  impressions >= 2000)
```
- For a **confident** keep/scale decision, wait for `purchases >= SIG_PURCHASES (~30)` — practitioner proxy for statistical reliability. Note this is a **rough** proxy; signal **quality/consistency** matters as much as count (a clean, concentrated signal can stabilize below 30; a noisy one won't at 50).
- **The cardinal sin the engine must avoid:** killing a creative on 1–2 purchases or sub-$20 spend. Variance at that volume is enormous. The only early kills allowed are **Trigger C** (broken CTR/hook at decent impressions) and **Trigger B** (real spend, zero conversions).

### 4.4 Creative fatigue detection — composite signal **[DIRECTIONAL]**

Fatigue is a **trend over time on the same creative**, not a level. Flag a creative-refresh when, week-over-week with unchanged targeting/budget:
```
frequency_7d      rising AND > FREQ_FATIGUE_PROSPECT (≈3.0 prospecting)
AND ctr_link      down ≥ 10–15% WoW
AND cpm           up   ≥ 15–25% over 2 weeks
AND cpa           rising
```
Optional **composite fatigue score** (single number, higher = healthier):
```
score = 0.30·CTR_health + 0.20·CPM_health + 0.30·CVR_health + 0.20·CPA_health
        # each sub-component normalized vs the creative's own 14-day baseline
> 0.85  healthy
0.70–0.85  early fatigue  → prep replacement
0.55–0.70  moderate       → swap replacement in soon
< 0.55  severe            → pause now
```
**Action on fatigue:** trigger a refresh ticket, promote the next variant from the creative library, re-evaluate in ~72h. Fatigue ≠ "creative was bad" — it was good and wore out; **iterate the winning angle**, don't abandon it.

### 4.5 Consolidation signals (too fragmented / learning-limited)

Flag for consolidation when:
```
campaign has > N ad sets each < (LEARNING_EVENTS_WK / 4) weekly events   # starved
OR ad_set.delivery_status == "Learning Limited" for ≥ 7 days
OR multiple ad sets share near-identical audiences (overlap) competing in auction
```
**Action:** merge similar ad sets, move budget under one CBO/ASC, and let Meta allocate. Fragmentation splits signal below the ~50-events/week density needed to exit learning. **Signal density beats granularity** in the current (Advantage+/GEM) era. **[DIRECTIONAL]**

### 4.6 Budget reallocation logic (across ad sets / campaigns)

Run on the scaling layer, daily, after the minimum-signal gate:
```
1. Rank judgeable ad sets by CPA (asc) within an objective.
2. SHIFT budget toward CPA < TARGET_CPA × 0.8 (winners) in ≤20% steps.
3. STARVE/REDUCE 30% on CPA > TARGET_CPA × 1.3 (losers).
4. NEVER move so much that a healthy ad set's % change > 20% in a day (relearn guard).
5. If using CBO/ASC, prefer fixing the *creative/exclusion* inputs over fighting Meta's internal allocation.
6. Respect per-account floors: conversion ad sets need ≥ ~$50/day to gather usable signal. [DIRECTIONAL]
```

---

## 5. Creative Analysis Framework

The engine should be able to **slice every creative three ways** and produce a "what's working / what's not / what to test next" read.

### 5.1 The funnel-stage diagnosis table (core logic)

| Symptom | Diagnosis | Where it broke | Recommended next test |
|---|---|---|---|
| **Low hook rate** (<25%) | First 3s don't stop the scroll | Opening frame / hook | New hooks: pattern interrupt, motion, bold claim, problem-first, different first frame |
| **Good hook, low hold rate** (<30%) | Body loses them after the stop | Middle / story arc | Tighten pacing, faster payoff, add proof/demo, restructure the middle |
| **Good hold, low link CTR** | Engaged but not motivated to click | CTA / desire | Stronger CTA, clearer offer, urgency, benefit framing on-screen |
| **Good CTR, low CVR** | Click intent high, page/offer fails | **Landing page / offer** (not the ad) | LP message-match, page speed, offer, checkout friction — *fix the page, not the creative* |
| **Good CVR, high CPM/CPA** | Creative converts but auction-expensive | Reach efficiency / relevance | Improve relevance/engagement; broaden audience; test cheaper-reaching formats |
| **Everything decent, CPA still high, rising freq** | Fatigue | Time | Refresh winning angle (§4.4) |

> **One-line heuristic the engine should print:** *"Low hook = bad first 3s. Good hook + low hold = weak body. Good engagement + low CVR = landing page/offer, not the ad."*

### 5.2 Slice by FORMAT

Compare **static image / video / carousel / UGC** at equal spend. Track per-format: hook rate (video), CTR, CVR, CPA, ROAS, and **share of spend vs share of purchases** (a format over-indexing on purchases deserves more budget). Don't compare a video's hook rate to a static's (statics have no 3s metric) — compare on CTR/CPA across formats.

### 5.3 Slice by ANGLE / hook / messaging

Tag every creative with metadata: **angle** (e.g. problem-solution, social proof, founder story, offer-led, comparison), **hook type** (question, stat, bold claim, UGC testimonial open), **format**, **funnel stage** (prospecting vs retargeting). Then roll up CPA/CTR/hook-rate **by tag** to find *winning patterns*, not just winning individual ads. The output the strategist wants: *"UGC + problem-first hooks are our lowest CPA pattern; founder-story angles fatigue fastest."*

### 5.4 Slice by FUNNEL STAGE

- **Prospecting/cold:** weight hook rate, CTR, CPA, new-customer CPA. Broad reach creative.
- **Retargeting/warm:** tolerate higher frequency; weight CVR, ROAS, offer strength. Different creative job (close, don't introduce).

### 5.5 "What to test next" recommendation (the deliverable)

For each test batch the engine should emit:
1. **What's working** — winning *patterns* (angle/format/hook tags beating target CPA at significance), with the evidence.
2. **What's not** — clear losers + the *funnel stage* that failed (so the next iteration fixes the right thing).
3. **What to test next** — 3–5 concrete, prioritized new concepts: *iterate winners* (new hooks on a winning body; new format of a winning angle) before chasing net-new angles. Each with a hypothesis and the metric that will judge it.

> Cadence reality check **[DIRECTIONAL]:** strong DTC creative teams ship ~10–20 new concepts/client/month and brief from *live performance data*, not quarterly strategy decks. The system should make this volume manageable, not generate untested noise.

---

## 6. Weekly DTC Client Performance Review

A sharp weekly review answers four questions: *Are we pacing? What moved? Which creative is winning? What are we doing about it?* Recommended structure:

### 6.1 Sections

1. **Headline scorecard — period-over-period (WoW, plus vs prior-4wk avg):**
   | Metric | This wk | Last wk | Δ% | vs target |
   |---|---|---|---|---|
   | Spend | | | | pacing vs budget |
   | Purchases / Orders | | | | |
   | CPA / CPP | | | | vs TARGET_CPA |
   | AOV | | | | |
   | ROAS (platform) | | | | vs breakeven |
   | **MER / blended ROAS** | | | | the "real" number |
   | New-customer CAC | | | | |
   | CTR (link), CPM, CVR | | | | trend flags |

2. **Pacing vs budget** — spend-to-date vs monthly plan; projected end-of-month spend & orders; flag over/under-pacing with the lever to pull.

3. **Top movers** — biggest WoW swings (good and bad) at campaign/ad-set/ad level, each with a *cause* (fatigue, new winner, CPM spike, seasonality) — not just the number.

4. **Creative leaderboard** — top + bottom creatives by CPA/ROAS at significance, tagged by format/angle/hook, with hook & hold rates. Call out winning **patterns**, fatiguing winners, and DOA tests.

5. **Tests run / results** — what entered testing, what graduated to scaling, what was cut, with the read.

6. **3–5 recommended actions for next week** — concrete and owned, e.g.:
   - *"Scale Ad Set B +20% (CPA 22% under target, freq 1.8, exited learning)."*
   - *"Pause Creatives 7 & 11 (zero purchases at 1.8× target spend)."*
   - *"Refresh the 'founder story' winner — freq 3.4, CTR −18% WoW, CPA +25% (fatigue)."*
   - *"Consolidate the 3 interest ad sets into one CBO (all learning-limited)."*
   - *"Test 4 new UGC problem-first hooks on the winning body (our lowest-CPA pattern)."*

### 6.2 Principles

- **Lead with the blended/MER picture** (client cares about total profitable growth), then drill into platform mechanics.
- **Every number gets a "so what."** A report without a recommended action is a dashboard, not a review.
- **Decisions trace to the rules in §4** — consistency between the weekly narrative and what the automation actually did builds client trust.

---

## 7. Implementation summary — rule precedence for the engine

When multiple rules fire on one entity, apply in this order:

1. **Minimum-signal gate** (§4.3) — if not cleared, *only* Trigger B/C early-kills are allowed; everything else = "gather more data."
2. **Hard cut** (§4.2) — proven loser or broken upper funnel → pause.
3. **Fatigue** (§4.4) — refresh ticket + promote variant.
4. **Consolidation** (§4.5) — if fragmented/learning-limited.
5. **Scale** (§4.1) — only confirmed winners, ≤20%/step, cooldown respected.
6. **Reallocate** (§4.6) — daily smoothing within guardrails.

Always: **decompose a bad CPA into CPM × CTR × CVR before acting** (§1.4), and **bias recommendations toward creative iteration over audience tinkering** (§3.3).

---

## Sources (2024–2025 practitioner & benchmark references)

**Benchmarks (CTR/CPM/CPC/ROAS/CVR):**
- [Facebook Ad Benchmarks by Industry — Triple Whale](https://www.triplewhale.com/blog/facebook-ads-benchmarks)
- [Facebook Ads Benchmarks 2025 — WordStream](https://www.wordstream.com/blog/facebook-ads-benchmarks-2025)
- [Facebook Ads Benchmarks by Industry 2025 — Two Minute Reports](https://twominutereports.com/blog/facebook-ads-benchmarks)
- [Meta Ads Conversion Rate Benchmarks by Industry — AdAmigo](https://www.adamigo.ai/blog/meta-ads-conversion-rate-benchmarks-industry-2026)

**Hook / hold / video creative metrics:**
- [Key Creative Performance Metrics — Motion](https://motionapp.com/blog/key-creative-performance-metrics)
- [What Is a Good Hook Rate — AdManage](https://admanage.ai/blog/what-is-a-good-hook-rate-for-facebook-ads)
- [Hold Rate Benchmarks — adlibrary.com](https://adlibrary.com/posts/hold-rate)
- [Hold Rate for DTC Video Ads — MHI Growth Engine](https://mhigrowthengine.com/blog/hold-rate-video-ads-dtc/)
- [UGC Ad Benchmarks — Influee](https://influee.co/blog/creative-benchmarks-for-your-ugc-ads)

**Account structure (ABO/CBO/ASC) & targeting:**
- [ABO vs CBO vs Advantage+ Shopping — Michael Diaz Consulting](https://michaeldconsulting.com/how-to-pick-the-right-budget-strategy-in-meta-ads-abo-cbo-or-advantage-shopping/)
- [Advantage+ Shopping Campaign Guide — Coinis](https://coinis.com/glossary/advantage-shopping-campaign-asc)
- [Are Advantage+ Shopping Campaigns Worth It — BMG360](https://www.bmg360.com/blog/post/are-advantage-shopping-campaigns-worth-it)

**Scaling / learning phase / kill rules:**
- [Exit the Learning Phase & Scale — Modern Marketing Institute](https://www.modernmarketinginstitute.com/blog/how-to-exit-the-meta-ads-learning-phase-fast-and-start-scaling-profitably-in-2026)
- [Budget Scaling Rules — RocketShip HQ](https://www.rocketshiphq.com/meta-budget-scaling-rules-app-campaigns/)
- [How to Scale Meta Ads — TheOptimizer](https://theoptimizer.io/blog/how-to-scale-meta-ads-without-killing-performance)
- [Meta Ads Budget Allocation Mistakes — adlibrary.com](https://adlibrary.com/posts/meta-ads-budget-allocation-mistakes)
- [Signal Density & Scale — Silverback Strategies](https://www.silverbackstrategies.com/blog/the-simplified-meta-ads-funnel-why-signal-density-is-the-key-to-unlocking-scale-in-the-gem-era/)

**Creative fatigue:**
- [Creative Fatigue Framework — Triple Whale](https://www.triplewhale.com/blog/creative-fatigue)
- [Creative Fatigue Detection — Finsi](https://www.finsi.ai/blog/creative-fatigue-detection-ads/)
- [Ad Fatigue: Diagnose, Cap, Refresh — adlibrary.com](https://adlibrary.com/posts/ad-fatigue)

**ROAS / breakeven / contribution margin:**
- [Break-Even ROAS Calculator — Eightx](https://eightx.co/tools/break-even-roas-calculator)
- [Contribution Margin ROAS (cmROAS) — Prooflytics](https://prooflytics.io/blog/contribution-margin-roas-dtc-shopify)
- [Ecommerce Contribution Margin — Saras Analytics](https://www.sarasanalytics.com/blog/ecommerce-contribution-margin)
- [Breakeven ROAS Guide — Cometly](https://www.cometly.com/post/breakeven-roas-calculator)

**Reporting / creative strategy cadence:**
- [Best DTC Creative Strategy — Motion](https://motionapp.com/library/talk/the-best-dtc-creative-strategy-for-2024/)
- [Motion — Creative Analytics Platform](https://motionapp.com/)
