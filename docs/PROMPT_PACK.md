# PROMPT_PACK — Meridian build sequence

*Phase 3 output. The validated/gated scope sequenced into self-contained,
independently-shippable units. Each unit lists its acceptance gate. This is the
plan `build-loop` drove; it also doubles as the resume map for a fresh session.*

## Ordering principle

Bottom-up: data truth → compute → seam → shell → screens → verify. Every unit is
shippable and verifiable on its own; later units consume earlier files, never the
reverse.

| # | Unit | Files | Acceptance gate | Status |
|---|---|---|---|---|
| P0 | Design system + toolchain | `tailwind.config`, `index.css`, tokens | green render, theme tokens resolve | ✅ |
| P1 | Domain model | `lib/types.ts` | typechecks; mirrors Graph hierarchy | ✅ |
| P2 | Demo-data engine | `lib/rng.ts`, `lib/demo/*` | CPA clusters near targets; 90d × ~250 ads | ✅ verified via `__meridian.summary()` |
| P3 | Metrics + selectors | `lib/metrics.ts`, `lib/selectors.ts` | roll-ups correct at every level | ✅ |
| P4 | Provider seam | `lib/provider/*` | demo loads; live scaffolded + guarded | ✅ (live structure-map = last-mile) |
| P5 | AI engine | `lib/ai/*` | all 7 suggestion types surface; cuts curated | ✅ verified via `__meridian.suggestionMix()` |
| P6 | App shell | `app/*`, `components/shell/*` | nav + scope switch + date range + theme | ✅ |
| P7 | Portfolio + client overview | `screens/Overview*`, blocks | KPIs, trend, donut, clients, actions render | ✅ |
| P8 | Recommendations | `screens/Recommendations` | filter + one-click apply + activity log | ✅ apply verified live |
| P9 | Campaigns explorer | `screens/Campaigns` | campaign→adset→ad drill, AI flags | ✅ |
| P10 | Creative Lab | `screens/CreativeLab` | cohorts, funnel diagnosis, next-batch | ✅ |
| P11 | Weekly report | `screens/WeeklyReportScreen` | digest + full designed report | ✅ |
| P12 | Clients + Settings | `screens/ClientsDirectory`, `SettingsScreen` | BM grouping; connection panel | ✅ |
| P13 | Verify + design loop + ledger | preview, agents, `LEDGER.md` | independent verifier passes; honest ledger | ⏳ in progress |

## Gates that are human/real-world (emitted, never faked)

- **P4 live data**: needs the operator's Meta system-user token + App Review. The
  insights pull + writes are wired; the structure→type map is the marked
  last-mile. → `META_INTEGRATION.md`.
- **P5 LLM narrative**: needs a backend proxy + Anthropic key. Heuristic engine
  ships working without it. → `lib/ai/llm.ts`.
- **Design taste sign-off**: the visual loop drives hard toward the bar, but a
  human designer's sign-off is the residual. → `LEDGER.md`.

## Resume

A fresh session reads `00_KICKOFF.md` → `CONCEPT_BRIEF.md` → this file →
`LEDGER.md`, then `npm install && npm run dev`. Files are the durable memory.
