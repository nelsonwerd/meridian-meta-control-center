# LEDGER — honest status

> Read this before trusting any single claim about Meridian. It is the kill-ledger
> the autopilot run is contractually required to keep. Three buckets: ✅ verified
> working, 🟡 scaffolded for your API (real code, not executed), ⚪️ simulated in
> demo. Plus what's explicitly **not** built and what only a human can finish.

## ✅ Verified working (checked in a live preview server)

| Capability | How it was verified |
|---|---|
| Production build + strict typecheck | `npm run build` → tsc clean (`noUnusedLocals`/`noUnusedParameters` now on), 2422 modules; output code-split into app / react / recharts chunks |
| Automated test suite | `npm run test:run` → **134 Vitest tests green** across 17 suites: the original data/engine suites, demo goldens (byte-identical through the live refactor), Graph→domain mapping fixtures, a full fake-Graph loadSnapshot integration run, async report jobs, period-reach math, transport (pagination/multi-account/failure paths/throttle), write path, and 21 proxy tests vs a mock upstream |
| Lint + CI | `npm run lint` → ESLint (typescript-eslint + react-hooks) clean; GitHub Actions runs lint + build + tests on every push/PR |
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

## 🟡 Built and machine-verified — NOT yet run against real credentials

> The live mile (P1–P7, 2026-08-11) is **implemented end-to-end and verified
> against a faked Graph API in tests** — the throw is gone, the pipeline works.
> "Machine-verified" means: 134 Vitest tests exercise it against realistic
> v26-shaped fixtures and an in-process mock upstream, the AI engine produces
> correct findings from live-shaped data, and a 37-agent adversarial review
> (6 lanes → per-finding skeptics) confirmed 31 defects which were ALL fixed
> in the same run (windowDays floor, timezone window buffers, orphaned-ad
> totals, CSRF guard on the proxy, BUC minutes semantics, and more — see the
> `review:` commit). It does **NOT** mean it has ever touched a real ad
> account. Every row below carries a 🚪 human gate that needs the operator's
> real token + account (see `META_INTEGRATION.md`).

| Thing | State | 🚪 Human gate |
|---|---|---|
| Backend token proxy (`server/proxy.mjs`) | zero-dep Node server: token injection, per-business routing, BUC backoff, token redaction, /healthz, static prod serving; 18 tests vs a mock upstream | set `META_SYSTEM_TOKEN`, confirm `/healthz` returns your identity |
| `LiveProvider.loadSnapshot` (structure + insights) | full pull→map→assemble pipeline; v26; statuses/learning normalized; period-true reach; integration-tested vs a fake Graph | map one real account, flip to Live, see real campaigns render |
| Insights correctness | per-account purchase event, async report jobs (gated on `Job Completed`), Ads-Manager-default attribution | reconcile spend/orders/CPA/ROAS vs Ads Manager for one account+range |
| Reach/frequency engine inputs | true de-duplicated period reach per canonical window; never blended with additive | confirm a known-fatigued entity surfaces in the live feed |
| Write actions (pause/budget POST) | via proxy, minor units from the corrected per-currency map (HUF/TWD=1), success:false detection, live-explicit confirm, **no auto-run ever** | one real pause + one budget change on a SANDBOX/lowest-spend ad |
| LLM narrative enrichment | `/api/ai/narrate` proxy route + client wiring (claude-sonnet-5 / claude-opus-5); opt-in toggle, off by default | set `ANTHROPIC_API_KEY`, enable in Settings, see enriched prose |
| Multi-BM auth (system user + partner) | routed server-side via `META_TOKENS` keyed by business id | a partner-BM client loads with its own token |

Known, deliberate approximations (documented in code): cross-ad reach summation
(same approximation Meta makes below account level); non-canonical/custom date
ranges keep additive reach; one ad account per client; all money rendered in the
primary account currency (mixed-currency portfolios sum numerically — real FX
normalization is future work); creative thumbnails come straight from Meta's CDN
in live mode and fall back to angle-keyed gradients when the signed URL has
expired or the creative exposes no asset (demo is always the gradient); campaign
kind / audience type / creative angle are honest inferences from
names/targeting/copy, not Graph facts.

## ⚪️ Simulated in demo (works, but not real-world)

- **All data is synthetic** — a seeded generator, not real ad accounts. Numbers
  are believable and internally consistent, but invented.
- **Apply actions mutate the in-memory snapshot only** and toast "(simulated)."
  No Meta call is made in demo mode.
- **AI suggestions are heuristic**, not LLM-authored — encoded ad-ops thresholds
  (the LLM layer would *enrich the prose*, not change the math).
- **Export / share** on the weekly report toasts; it doesn't generate a file.
- **"Today" anchor** is provider-owned: demo pins 2026-06-17 so the seeded
  90-day story is stable; live anchors to the real today in the primary ad
  account's timezone (every window — presets, engine scoring, pacing, weekly
  report — follows the active snapshot's anchor).

## ❌ Not built (out of scope this run)

Auth / users / roles · OAuth UI (the system-user token is created out-of-band
and lives in the proxy's env) · billing · alerting/email delivery of reports ·
mobile-native · automated scheduled syncs (loadSnapshot is on-demand) · the
`client_config`/`decision_log` database backend (still localStorage seams) ·
FX normalization for mixed-currency portfolios. The bundle is **code-split**
into vendor chunks (app / react / recharts) — per-route `React.lazy` splitting
remains an available further optimization, not done.

## What only a human / the market can finish (the honest residual)

1. **The 🚪 human gates above.** The live mile is built and machine-verified,
   but only your real token, real accounts, and an Ads-Manager reconciliation
   can prove the numbers. Until then, treat live mode as "wired, unproven."
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
actions say simulated; live writes require an explicit "Confirm live" step that
says there is no undo; and everything the machine could not verify without real
credentials is listed above as a 🚪 human gate rather than claimed as working.

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
`docs/audit/`) rated the build **8/10** ("faithful, honest first
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

---

## Round 4 — pre-live hardening pass (deep-dive backlog → 6-phase build)

A second deep-dive mapped the whole codebase and adversarially verified a 51-item
backlog (evidence: `docs/hardening/`). A validation deep-dive then pressure-tested
the fix plan (catching a no-op dedup, an incomplete delta fix, a token-in-browser
contradiction, an ordering dependency) before a 6-phase build executed it, each
phase verified to its gate (tsc + tests, and a live demo preview for the UI phase).

**Landed (verified):**
- **Safety net (new):** Vitest + 33 tests + a GitHub Actions CI gate + a real
  ESLint config (`lint` is no longer just `tsc`); `noUnusedLocals`/`Parameters` on.
- **Engine/metrics correctness:** DOA rule now matches the playbook (no purchase
  gate — sub-0.5% CTR ads with 2–4 orders no longer slip every rule); SCALE dedup
  keeps the highest-confidence sibling (was a silent first-seen); REALLOCATE spread
  ignores thin outliers; pacing math shared by engine + report (one guarded helper);
  KPI delta shows "new" instead of a fabricated +100% with no baseline; the
  "Frequency" KPI is honestly relabeled "Avg daily frequency" (label only — the
  fatigue threshold is calibrated to that value and unchanged); two dead thresholds
  removed; weekly-report icon now derives from a `direction` field so it can't
  disagree with the headline; LLM prompt now carries the breakeven ROAS it judges.
- **UX / a11y:** clickable table rows are real keyboard-focusable controls; charts
  expose `role="img"` summaries and decorative sparklines are `aria-hidden`; the
  tooltip is keyboard/touch reachable; toasts pause on hover/focus and their timer
  is lifecycle-cancelled; Settings swaps provider **in place** (no full reload);
  Creative Lab shows all clients (was capped at 6); sparkline handles single-point
  ranges; misc.
- **Live scaffold hardened (code only — still NOT executed):** per-account
  `currency_offset` (with **HUF/TWD un-mis-bucketed** — a latent 100x budget bug);
  node-vs-edge `graphGet` (no false-success connection test); writes parse the
  response (2xx ≠ success) and unsupported multi-step kinds return a clear error;
  insights window computed in the account timezone; rate-limit (BUC) backoff
  groundwork; the account **mapping** persists to `LiveConfig` (the Graph token is
  deliberately NOT stored from the browser). Undo is gated to demo mode (a
  client-side restore can't reverse a committed live write).

**Deliberately NOT reached this pass (honest residual):**
- **Live structure→type mapping (#02)** — the campaigns/adsets/ads/creatives
  mapping + shared index builder is the documented live last-mile. Its reserved
  accumulators remain in `liveProvider.ts` (annotated, not deleted); `loadSnapshot`
  still throws there. Deferred to `docs/PROMPT_PACK_live_integration.md` — writing
  it blind (no credentials to verify against) would risk plausible-but-wrong code.
- **All P5 live fixes are typecheck/review-verified only, not run against the API.**
- **Two perf nits deferred** (constant-factor at demo scale, working code): the
  3-screen dashboard memo dedup and the ScopeSwitcher per-render metric memo —
  revisit at real multi-BM book size, not worth the regression risk now.
