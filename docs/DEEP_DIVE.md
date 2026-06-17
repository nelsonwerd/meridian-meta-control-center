# DEEP_DIVE — validation of the load-bearing claims

*Phase 2 output. Two specialist research agents validated the technical claims the
build rests on; full references in `docs/research/`. This is the synthesis +
honest confidence, folded back into the concept.*

## What was validated

### 1. Meta Marketing API reality → drives the type model + LiveProvider
**Confidence: 9/10** (official-docs-grounded; version specifics drift).
Full reference: [`research/meta-marketing-api.md`](research/meta-marketing-api.md).

Verified and **baked into the code**:
- Hierarchy **Business → Ad Account → Campaign → Ad Set → Ad → Ad Creative** —
  mirrored 1:1 in `src/lib/types.ts`. Only the ad account is `act_`-prefixed.
- **No scalar purchases/revenue field** — orders/revenue/CPA/ROAS come out of the
  nested `actions` / `action_values` / `purchase_roas` arrays by `action_type`
  (`omni_purchase`). `LiveProvider.actionVal()` extracts exactly this.
- **Multi-BM access = System User + Partner sharing**, one token fanning across
  clients. Modeled in `LiveConfig`; documented in `META_INTEGRATION.md`.
- **Writes** are single-field POSTs (`status`, `daily_budget`, `bid_amount`).
- **Current GA `v25.0`**; budgets in **minor units gated by `currency_offset`**;
  `7d_view`/`28d_view` attribution **removed 2026-01-12**. All three corrected the
  scaffold (it originally guessed v23 and a blind ÷100).

> The single biggest build risk this retired: assuming `purchases` is a field.
> It isn't — the whole insights mapping would have been wrong. Now correct.

### 2. Ad-ops KPIs + optimization playbook → drives the AI engine
**Confidence: 7/10** (directional best-practice, not a backtested edge — and
that's the honest framing the product uses).
Full reference: [`research/adops-kpis-playbook.md`](research/adops-kpis-playbook.md).

Verified and **encoded in `src/lib/ai/thresholds.ts` + `engine.ts`**:
- **Minimum-signal gate** before judging CPA (spend ≥ 1× target CPA, ≥3 orders).
- **Scale** at CPA ≤ 80% of target with ≥~25 orders/7d and frequency < 3, in
  ≤20% steps. **Cut** at sustained CPA > 130% of target. **Pause** DOA (<0.5% CTR)
  and zero-conversion burners.
- **Fatigue = a trend** (frequency > 3 **and** CTR ↓ WoW **and** CPM ↑ 2-wk **and**
  CPA rising) — not a single level.
- **Consolidate** learning-limited / sparse ad sets; **reallocate** on wide CPA
  spread.
- **Creative funnel diagnosis**: hook (3s/impr) → hold (thruplay/3s) → CVR, with
  the one-line localization (bad first 3s vs weak body vs LP/offer).
- **Precedence**: signal-gate → cut → fatigue → consolidate → scale → reallocate.

The demo data generator was tuned so CPA *emerges* from CPM × CTR × CVR (not
hardcoded), which means the engine **re-discovers** these patterns from the data
rather than reading labels — the diagnosis is honest by construction.

## Red-team / what's still a bet

- **The thresholds are directional.** They match agency best practice; they are
  **not** proven to maximize this agency's outcomes. The product says so (Settings
  footnote + every suggestion is "a signal a buyer weighs"). **Non-gating.**
- **The structure→type mapping in `LiveProvider` is the last live-mile** — the
  insights pull + writes are wired; campaign/adset/ad mapping is the remaining
  stub. Logged in the ledger, flagged in `META_INTEGRATION.md`.
- **Attribution / conversion-event config is account-specific.** `omni_purchase`
  is the right default but must be confirmed per account.

## Verdict

The load-bearing **technical** claims are validated strongly enough to build
correct scaffolding (9/10). The **optimization-logic** claims are validated as
sound best-practice (7/10) and are *framed as a signal, not a guarantee* — which
is the only honest way to ship encoded heuristics. **Proceed to build.**
