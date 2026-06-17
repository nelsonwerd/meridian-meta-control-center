# CONCEPT_BRIEF — Meridian

*Phase 1 output (`ideate`). The locked concept + phased roadmap the rest of the
pipeline builds against. Driven in-character as the agency operator.*

## One-line concept

**Meridian** is an internal command-and-control center that unifies every
client's Meta advertising — across multiple Business Managers — into one cockpit,
with an AI analytical layer that continuously reads the data and proposes
**one-click, data-backed optimizations** to spend, structure, and creative.

## Who it's for

The agency's **media buyers / strategists** (daily optimization) and
**account leads** (weekly client reviews). Internal only. No external/billing/
multi-tenant-SaaS concerns.

## The job it does (in priority order)

1. **See everything in one place.** Portfolio overview across all clients/BMs →
   drill into client → campaign → ad set → ad → creative, with the KPIs that
   matter for order-driving DTC: **CPA, Orders, ROAS, CTR, CPM, CPC, Spend,
   AOV, Frequency**, plus video creative metrics (hook rate, hold rate).
2. **Tell buyers what to do, with evidence.** A recommendations engine that
   flags winners to scale, losers to cut/pause, fatiguing creative, learning-
   limited / over-fragmented ad sets, and budget reallocations — each with a
   rationale, a projected impact, a confidence, and a **one-click action**.
3. **Make creative learning a system, not tribal knowledge.** Compare creatives
   by format (static / video / carousel), angle/hook, and funnel stage; diagnose
   *where* a creative fails (hook vs hold vs convert); recommend the **next test
   batch**.
4. **Kill the weekly reporting chore.** A designed **Monday report** per client:
   last week vs prior, top movers, creative leaderboard, pacing, and recommended
   spend/creative changes — ready to read or send.
5. **Act on Meta from here.** Pause/activate, change budgets, adjust bids — from
   the cockpit (simulated in demo; scaffolded for the live API).

## Success metric & kill criterion

(See `00_KICKOFF.md`.) Success = buyers run daily optimization + weekly reviews
*from Meridian*. Kill = its read/suggestions aren't trusted and buyers stay in
Ads Manager.

## What makes it good (design + UX bets — feel is load-bearing)

- **One cockpit, zero context-switching.** Global client/BM switcher + global
  time range (Today / 7d / 28d / MTD / custom) that every screen respects.
- **Decisions, not just dashboards.** Every metric anomaly is one hop from a
  recommended action. The home screen is a *triage surface*, not a vanity wall.
- **Premium, legible, fast.** Dark cockpit, tabular metrics, sparklines in
  tables, tasteful motion, instant drill-downs. (Design direction in kickoff.)

## Architecture decision (so "turn the lights on" actually works)

A clean **DataProvider** seam: the entire UI reads through one async interface.
Two implementations behind it:
- `DemoProvider` — deterministic seeded data (ships now, so the operator can poke
  around before any API exists).
- `LiveProvider` — Meta Marketing API client (scaffolded against the real graph
  hierarchy + Insights fields from the deep-dive; the operator drops in tokens).
Same seam for the **AIEngine** (heuristic analyzers now; LLM-narrative scaffold)
and the **ActionExecutor** (simulated mutations now; real Graph POSTs later).
Flipping demo→live is a config + credentials change, not a rewrite.

## Phased roadmap

- **P0 — Foundation (this run).** Design system, domain model, deterministic
  demo-data engine, DataProvider seam, app shell (nav + switchers + time range +
  theme + command palette).
- **P1 — Visibility (this run).** Portfolio home, client dashboard, campaign /
  ad-set / ad drill-downs, creative gallery + per-creative analytics, with
  charts, KPI cards, trend lines, sparkline tables.
- **P2 — Intelligence (this run).** Heuristic AI engine → typed recommendations
  with projected impact + confidence + one-click action; creative analysis
  (format/angle/funnel diagnosis + next-test-batch); recommendations center.
- **P3 — Reporting (this run).** Designed weekly Monday report per client +
  portfolio. Time-frame-aware analysis (daily/weekly/monthly).
- **P4 — Live integration (operator handoff).** Wire `LiveProvider` to the Meta
  Marketing API, the real LLM narrative endpoint, and real write actions. The
  seams + `META_INTEGRATION.md` make this drop-in. **This is the honest edge.**

## Explicit non-goals (this run)

- Real Meta API calls / real token storage / OAuth (scaffolded, not wired).
- Real LLM calls (heuristic engine is genuinely useful; LLM enriches narrative —
  scaffolded).
- Auth/users/permissions, billing, mobile-native. Desktop-web cockpit first.

## Load-bearing claims to validate in deep-dive (Phase 2)

1. The Meta object hierarchy + the exact Insights fields needed for CPA/ROAS/
   orders/creative metrics (so `LiveProvider` + types are correct).
2. The multi-Business-Manager access model (agency BM + clients on separate BMs).
3. The ad-ops thresholds the heuristic engine encodes (scale/cut/fatigue/
   consolidate) — directionally sound, not made up.
