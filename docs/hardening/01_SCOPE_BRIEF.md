# Pre-Live Hardening — Scope Brief

> The "concept brief" for a hardening release, seeded from the deep-dive's 51
> adversarially-verified findings (`00_FINDINGS.json`). This is a **finish-the-
> last-mile** pass on a mature codebase, **not** a product-discovery run — there is
> no persona, no demand to validate, no concept to kill. The grounding is the code
> itself plus a multi-agent verified backlog.

## Goal

Take Meridian from "polished demo, ~80% craft ceiling, no safety net" to "demo-
hardened with an automated safety net, correctness tail closed, and the live
scaffold prepared as far as is verifiable without credentials" — executing every
backlog item that can be **verified before going live**.

## Success metric (the gate)

A merged branch where:
1. `npm run build` (tsc + vite) is green, and a **CI workflow enforces it on every push**.
2. A real **test suite runs green** (`npm test`) covering the correctness-critical core
   (currency offset, metric roll-ups/`safeDiv`, engine gating rules, RNG determinism).
3. Every **in-scope** finding is closed, each verified by the appropriate check
   (test, typecheck, or live-preview of the demo flow).
4. The demo app still renders all 7 routes with **no console errors** and apply/undo
   still works (no regression from the refactors).
5. `docs/LEDGER.md` is updated to honestly reflect the new state — including what was
   hardened-but-not-live-verified.

## Kill / stop criterion

If any phase's change cannot be verified by a real check (test, typecheck, or
demo-preview), it is **not shipped as done** — it is either dropped or explicitly
ledgered as unverified. We never narrate a passed gate we didn't clear. (The live
structure-mapping last-mile is the canonical example: it can't be verified without
credentials, so it is **deferred**, not faked.)

## Scope

### IN — execute and verify (demo + tooling + correctness + small live hardening)
Tooling/safety net (#01, #05, #29, #40), engine/metrics correctness (#03 currency,
#07, #11, #12, #16, #17, #18, #22, #23, #24, #35, #47, #51), data/generator
(#32, #33, determinism-aware), UX/a11y/perf (#04, #08, #13, #14, #25, #26, #27,
#28, #30, #37, #38, #42, #49), and the **small latent-correctness live fixes**
(#06 rate-limit groundwork, #09 no-op write kinds, #10 LiveConfig persistence,
#19 node-vs-edge graphGet, #20 2xx≠success + Undo gating, #21 UTC/timezone).
Doc/comment-only clarifications (#15, #41, #45, #46, #50) folded into the phases
that touch those files.

### DEFER — to `docs/PROMPT_PACK_live_integration.md` (cannot verify pre-credentials)
- **#02 — the live structure→type mapping + `buildIndexes` last-mile.** This is the
  documented live mile; writing it blind risks plausible-but-wrong code that no check
  can catch. We will, however, make the *small* live fixes around it correct so the
  mapping is the only remaining gap (already its reserved home).

### SKIP — adversarial review found the fix wrong or there is nothing to do
- **#44** poisson clamped-gaussian — standard; the proposed floor would be *wrong*.
- Items already correct/gated where only a clarifying comment is warranted are handled
  as comments, not behavior changes (#34 debug.ts DEV-gate, #43 enumerateDates guard,
  #48 CreativeLab dep-memo).

## Acceptance criteria (per category)
- **Tests:** Vitest configured; `test` + `test:run` scripts; ≥ the four core suites green.
- **CI:** GitHub Actions runs `npm ci && npm run build && npm test` on push/PR; Node pinned
  from `.nvmrc` (reconcile `.nvmrc`=20 vs `engines.node>=18`).
- **Engine/metrics:** behavior changes covered by a test asserting the new behavior;
  no change to a heuristic's *intent* unless the finding says the intent was wrong.
- **A11y:** interactive elements are real controls (button/link) with accessible names;
  charts have text alternatives; toasts/tooltips are keyboard-reachable.
- **Live hardening:** typecheck-clean, code-reviewed, and **ledgered as not-live-executed**.
- **No regression:** demo preview shows all routes + apply/undo working after each phase.

## Draft phased roadmap (to be validated by the deep-dive before prompts)

Ordering is dependency-driven. Each phase is independently shippable.

- **P0 — Safety net first.** Vitest + scripts + the 4 core test suites; CI workflow;
  reconcile Node version. *Rationale: nothing else should be refactored without a net,
  and the most correctness-critical code is the most subtle.*
- **P1 — Tooling hygiene.** Remove dead imports/`Rule` component (#36); fix `.gitignore`/
  `.env.example` (#40); flip `noUnusedLocals`/`noUnusedParameters` true; resolve the `lint`
  alias — add a lightweight ESLint flat config or make the alias honest (#29).
  *Hazard: dead-code removal MUST precede the `noUnused*` flip or the build breaks.*
- **P2 — Engine + metrics correctness.** DOA clause (#22), SCALE dedup strongest-sibling
  (#23), REALLOCATE robustness (#24), `computePacing` extraction shared by engine+report
  (#12), dead/unused thresholds (#11), frequency label rename — *label only, not the math*
  (#16), `deltaPct` `isNew` (#18), LLM prompt breakeven gap (#47), weekly-report icon (#51),
  anomaly base-window comment (#46), holdRate band comment (#50). *Comes AFTER P0 so every
  change is test-covered.*
- **P3 — Data/domain shared utils.** Extract `src/lib/date.ts` for `addDays` (#17) —
  *new module, NOT "home it in metrics.ts" (that would create a circular import:
  metrics already imports from generate)*. Creative `nextBatchPlan` label fix (#35);
  creative format weighting (#32) + `sample()` underfill (#33). *Determinism hazard:
  #32/#33 reorder `rng()` draws → the entire seeded dataset shifts. P0's determinism test
  must assert reproducibility + structural invariants, NOT pinned magic numbers, so it
  survives this — or it is regenerated here.*
- **P4 — UX / a11y / perf.** Clickable rows → real button/Link + ARIA + chart alt text
  (#04); hover-only Tooltip keyboard/touch (#13); per-client recompute (#25) + dashboard
  memo dedup (#30) + ScopeSwitcher memo (#42); Sparkline edge cases (#26); Settings
  apply-in-place (#27, use the imported `persistMode`); CreativeLab avatar overflow (#28);
  date-input color-scheme (#08); toast pause-on-hover (#49); `maxHeight`→`max-h-[60vh]`
  (#37); "Applied this session" → `<div>` (#38).
- **P5 — Live-provider hardening (small; defer mapping).** Per-account `currency_offset`
  + drop HUF/TWD from ZERO_DECIMAL (#03, #07); node-vs-edge `graphGet` for checkConnection/
  account fields (#19); no-op write kinds return `ok:false` (#09); 2xx≠success + gate Undo
  to demo mode (#20); UTC→account timezone (#21); `LiveConfig` persistence wiring (#10);
  rate-limit/backoff groundwork (#06). *All typecheck/review-verified, ledgered not-live-run.*
- **P6 — Build perf + docs honesty.** `manualChunks` code-splitting (#14); store/hooks
  clarifying comments (#15, #41); refresh `docs/LEDGER.md` stale figures + the full new
  state (#39); confirm `META_INTEGRATION.md` still accurate.

## Non-negotiables for whoever executes
1. **Determinism is a feature** — any change to the order/count of `rng()` draws in
   `generate.ts` shifts the whole demo dataset; tests must not pin exact magic numbers.
2. **The store's shallow clone is intentional** — do not "fix" it into a deep clone.
3. **Frequency rename is label-only** — the engine's fatigue threshold is calibrated to
   the current daily-average value; do not change the computation.
4. **Live code is ledgered, never claimed-as-run.**

## Next step
A validation deep-dive (`02_*`) pressure-tests this ordering and every per-finding fix
for correctness, type-safety, determinism, and phase independence — then the prompt-pack
(`03_*`) sequences the validated scope, and build-loop executes.
