# LEDGER — honest status

> Read this before trusting any single claim about Meridian. It is the kill-ledger
> the autopilot run is contractually required to keep. Three buckets: ✅ verified
> working, 🟡 scaffolded for your API (real code, not executed), ⚪️ simulated in
> demo. Plus what's explicitly **not** built and what only a human can finish.

## ✅ Verified working (checked in a live preview server)

| Capability | How it was verified |
|---|---|
| Production build + typecheck | `npm run build` → tsc clean, 2420 modules bundled |
| Deterministic demo dataset | `__meridian.summary()` / `.clientCPAs()` — 7 clients, 3 BMs, ~26 campaigns, ~250 ads, ~13.5k daily insight rows; per-client CPA clusters around each target |
| Metric roll-ups | selectors aggregate ad→adset→campaign→client→portfolio over any range; verified against debug surface |
| AI engine coverage | `__meridian.suggestionMix()` — all 7 suggestion types surface (scale/cut/pause/fatigue/consolidate/reallocate/watch) with sane severities |
| Creative funnel diagnosis | `__meridian.creative()` — winner/hook-weak/body-weak/convert-weak/fatigued classification + next-batch plan |
| Weekly report builder | `__meridian.report()` — WoW deltas, movers, leaderboard, recs, pacing, narrative |
| Portfolio overview (`/`) | screenshot: KPIs, trend, spend donut, clients table, priority actions |
| Single-client dashboard | screenshot: KPIs vs targets, secondary stats, efficiency trend, pacing ring, campaigns, suggestions, top creatives |
| Recommendations (`/recommendations`) | screenshot + **live one-click apply test**: applying a suggestion mutated the snapshot, fired a toast, incremented the applied count, logged to Activity |
| Campaigns drill-down (`/campaigns`) | screenshot: campaign→adset→ad expansion, AI flags, inline metrics |
| Creative Lab (`/creatives`) | screenshot: cohort bars, funnel diagnoses, next-batch plan, gallery with diagnosis filters |
| Weekly Report (`/report`) | screenshot: Monday digest + full designed client report |
| Clients directory (`/clients`) | screenshot: BM-grouped cards with sparklines |
| Settings (`/settings`) | screenshot: connection toggle, ad-account mapping, AI models, thresholds |
| Global controls | scope switcher (portfolio/BM/client), date range incl. single-day edge case (no crash), dark+light theme toggle |

## 🟡 Scaffolded for your API — real code, NOT executed (no credentials)

| Thing | State | Where |
|---|---|---|
| `LiveProvider` insights pull | wired (correct endpoints/fields, pagination, `omni_purchase` extraction) — **not run** | `src/lib/provider/liveProvider.ts` |
| `LiveProvider` structure→type mapping | **the remaining last-mile** — campaigns/adsets/ads/creatives mapping is stubbed; `loadSnapshot` throws a clear message there | same |
| Write actions (pause/budget/bid POST) | implemented; `currency_offset` multiplier marked TODO | same |
| Multi-BM auth (system user + partner) | modeled in `LiveConfig`; documented, not exercised | `liveProvider.ts`, `META_INTEGRATION.md` |
| LLM narrative enrichment | prompt + request shape ready; `USE_LLM=false`, needs backend proxy | `src/lib/ai/llm.ts` |
| Connection test / Settings save | calls real `checkConnection()`; fails gracefully without creds | `SettingsScreen.tsx` |

## ⚪️ Simulated in demo (works, but not real-world)

- **All data is synthetic** — a seeded generator, not real ad accounts. Numbers
  are believable and internally consistent, but invented.
- **Apply actions mutate the in-memory snapshot only** and toast "(simulated)."
  No Meta call is made in demo mode.
- **AI suggestions are heuristic**, not LLM-authored — encoded ad-ops thresholds
  (the LLM layer would *enrich the prose*, not change the math).
- **Export / share** on the weekly report toasts; it doesn't generate a file.
- **"Today" anchor** is fixed to 2026-06-17 so the 90-day demo window is coherent
  regardless of wall-clock.

## ❌ Not built (out of scope this run)

Auth / users / roles · real OAuth + token storage · billing · alerting/email
delivery of reports · mobile-native · automated scheduled syncs · a backend (the
running artifact is the frontend + demo; the backend proxy is documented, not
built). Bundle is a single ~225 KB-gzip chunk — fine for internal use; route-level
code-splitting is a known, easy optimization, not done.

## What only a human / the market can finish (the honest residual)

1. **~80% craft ceiling.** A correctness/polish tail remains — most concretely the
   `LiveProvider` structure-mapping last-mile and per-account conversion/attribution/
   currency config.
2. **Design taste sign-off.** The build-loop visual pass + a separate design-critic
   agent drove the UI hard toward an award-winning bar (dark cockpit, premium feel).
   "Looks excellent to two models" ≠ "a designer signed off." That spot-check is yours.
3. **The AI's judgement is a signal, not proof.** The scale/cut/creative calls
   encode best-practice thresholds; they are not a backtested edge for *your*
   accounts. Tune them in Settings; weigh them, don't obey them.
4. **Market/real-use validation is the handoff.** "Works + looks good + well-judged"
   ≠ "your buyers run their day from it." That's the real test, on real data.

## Nothing faked as real

No screen shows a "passed" gate that wasn't. Demo data is labelled demo; simulated
actions say simulated; the live path is labelled scaffolded and throws where the
last-mile is unfinished rather than pretending to succeed.

## Independent verification

Two rounds of independent, adversarial verification were run — findings were
confirmed by separate agents that re-derived them from the code/data, not taken
on faith.

### Round 1 — 5-lane audit workflow (14 agents)
Lanes: functional-preview · ai-engine · meta-scaffold · data-integrity ·
quality-sweep. 22 raw findings → adversarially verified → **8 confirmed real, 1
refuted**. Lane verdicts: all 7 routes render with real data and no NaN; data
engine deterministic and well-calibrated; no NaN/Infinity leaks; tsc clean.

**All 8 confirmed findings were fixed and re-verified:**

| Sev | Finding | Fix |
|---|---|---|
| med | Duplicate React keys → SCALE cards rendered 2–3× (84 cards / 80 unique) | dedup suggestions by id in `analyzeClient` — now 79 = 79 = 79 (count = unique = rendered), verified live |
| med | DOA pause fired without the spend gate (could flag a kill on thin data) | rule now requires `hasImprSignal && hasSpendSignal` (matches playbook Trigger-C) |
| med | `graphGet` silently truncated at ~50 pages | throws past `MAX_PAGES=1000` with a clear message instead of dropping data |
| med | `applyAction` always used `accounts[0]`'s token (wrong for multi-BM writes) | `resolveAccount()` maps entity→owning account via snapshot indexes |
| med | Budget writes hard-coded ÷100 (breaks JPY/KRW) | `currencyOffset(currency)` map (zero/two/three-decimal) |
| low | SCALE could recommend scaling a still-LEARNING ad | scale branch now requires `ad.status === 'ACTIVE'` |
| low | Consolidation copy mislabeled ACTIVE sets as "Learning Limited" | positive status allowlist + state-accurate evidence (`<n>/wk` vs "learning limited") |
| low | Icon-only buttons had no accessible name | `aria-label` on toast-dismiss / row-expand / report-back; avatar monogram `aria-hidden` |

**Refuted (correctly NOT changed):** "demoProvider no-ops ad-level budget" — the
engine never emits an ad-level budget action (budgets resolve to campaign/adset),
so the path is unreachable. Left as-is.

**Known limitation (honest):** the SCALE rule's *cooldown* half
(days-since-last-scale) is **not enforced** — the demo data model has no
"last scaled" timestamp. The exited-learning half is enforced; cooldown is a
documented gap to add when wiring live (a `scaleCooldownDays` threshold exists,
unused, as the placeholder).

### Round 2 — focused re-verification of the 8 fixes + smoke test
A separate verifier independently confirmed each fix in the code and re-ran the
live smoke test. **Result: all 8 fixes PASS.**

- Every fix confirmed in source (dedup Set; DOA `hasImprSignal && hasSpendSignal`;
  `graphGet` throws past `MAX_PAGES`; `resolveAccount()` with no `accounts.find(()=>true)`
  remaining; `currencyOffset()` the only budget multiplier; SCALE `ad.status==='ACTIVE'`
  first; consolidation positive allowlist + `<n>/wk` evidence; four aria-labels +
  avatar `aria-hidden`).
- Live smoke test: all 7 routes render real content; **console error-free** (only the
  benign React-Router v7 future-flag warnings); `/recommendations` header "79 open" =
  79 rendered cards, **0 duplicate ids** (two repeated *title strings* belong to
  distinct entities — correct, since dedup is by id); apply increments
  "Applied this session" 0 → 1 and flips the card to Applied.
- `npx tsc --noEmit` → clean (exit 0).

**Verifier's verdict:** *"All 8 fixes are correctly implemented and independently
confirmed; the running app renders every route with no console errors,
recommendation counts are honest, apply works, and the typecheck is clean — the
build is in a trustworthy, ship-as-first-draft state."*

---

## Round 3 — deep-dive audit → build-loop hardening

A full `deep-dive` (5 specialist lanes → synthesis → red-team, evidence in
`research/meridian-audit/`) rated the build **8/10** ("faithful, honest first
draft; safe for internal demo testing after one blocker"). A `build-loop` then
drove the prioritized fixes over **5 iterations**, each re-verified live:

| # | Fixed (verified live) |
|---|---|
| 1 | **Tier-0 blocker:** apply now clones the snapshot → dashboards/counts/Campaigns budget+sparkle all reflect a change (no more stale-after-apply). React error boundary catches a screen throw without white-screening. |
| 2 | Engine window + "signal, not proof" disclosure; two-step confirm + Undo on writes; severity re-tier (Critical+High **81%→23%**, High a genuine 19%); "$/day" impact sort; softened overstated confidence constants. |
| 3 | Responsive: sidebar → icon rail below `lg`, no mobile overflow, single-column KPIs. Light-theme tertiary text **5.22:1** (WCAG AA). |
| 4 | **Watchtower** ("what changed overnight"): pacing + anomaly (CPA-blowout / CPM-spike / tracking-break) engine rules surfaced on the home screen. Scan→act deep-link (Campaigns flag → filtered Recommendations). Hygiene: NaN-safe formatting, flat-week copy, genuinely-onboarding client, a11y. |
| 5 | Optimization thresholds are now **live-editable** sliders in Settings that re-score the engine instantly + persist. |

**Stop condition: PASS** — all acceptance criteria met, `tsc` + production build
green, no open Blocker/High/Medium defect on either track. Red-team's one
overstated finding (projected-impact "false precision") was correctly discounted
(those constants never render); the credibility weight moved to the now-disclosed
confidence signal.

### What the loop deliberately did NOT reach (honest residual)
- **Live Meta integration** (structure→type mapping, reach de-duplication,
  effective/learning status, async report jobs, per-account currency_offset) —
  deferred to a **prompt-pack** (`docs/PROMPT_PACK_live_integration.md`), not faked.
- **SCALE cooldown** (days-since-last-scale) — still unmodelable in demo (no
  last-scaled timestamp); only the exited-learning guard is enforced.
- **Tracking-break anomaly** rule exists but does not fire on the healthy demo
  data — present and ready for live.
- **Human design taste sign-off** remains the residual — the UI cleared the
  deep-dive's UX-lane critic + the build-loop visual passes, not a designer.
