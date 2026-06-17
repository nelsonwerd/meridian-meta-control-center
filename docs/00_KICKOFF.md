# Autopilot Kickoff — Meridian (Meta Command & Control Center)

> This file locks the frame for the autonomous run. It is durable memory: every
> later phase (and any fresh session) reads it. Honesty contract per the
> autopilot skill — a near-finish-line **first draft**, not a finished product.

## The grounded persona (real pain, not invented demand)

A performance agency runs Meta ads for **many DTC/ecommerce clients** across
**multiple Business Managers** (the agency's own BM + several clients on their
own BMs). The team manages a wide, inconsistent range of campaign structures,
ships new creative constantly, and iterates campaigns daily. The lived pain:

- **Fragmented visibility.** Performance lives in Ads Manager, one account at a
  time. There is no single cockpit across all clients/BMs.
- **Manual analysis doesn't scale.** Spotting winners to scale, losers to cut,
  fatiguing creative, and learning-limited ad sets — by hand, across dozens of
  campaigns — is slow and inconsistent.
- **Creative learning is lossy.** "What's working, what's not, what to test
  next" lives in people's heads, not in a system that reads the data.
- **Reporting is a chore.** Weekly client reviews are rebuilt from scratch.

This grounding is **real** (the operator runs this agency today). Per the
grounding firewall, real data *discovers and seeds* the build; it never
*validates the solution*. This is an **internal tool** — explicitly not for
sale — so market competition is out of scope by the operator's own instruction.

## The forced success metric + kill criterion

- **Success metric:** the agency's media buyers run their daily optimization and
  weekly client reviews **from Meridian instead of raw Ads Manager** — because it
  surfaces the scale/cut/creative decisions faster and more consistently than
  doing it by hand. Concretely: time-to-decision down, more winners scaled / more
  losers cut per week, and lower blended CPA at held-or-rising spend.
- **Kill criterion:** if buyers still pull every real decision out of Ads Manager
  because Meridian's read is wrong, stale, or its suggestions are noise they
  don't trust — it's dead weight. The bar is **trustworthy analysis a buyer
  acts on**, not dashboards they glance at.

## Autonomy contract

Run the full pipeline in-character as the operator. Answer every phase gate a
founder can answer (brain-dump, scope selection, design direction, convergence)
in-character without stopping. **Never fake a human-only gate** — anything that
needs the operator's real Meta tokens, a designer's taste sign-off, or real-world
buyer use is **emitted honestly in the ledger**, never auto-passed.

## Pipeline order (compose, never copy)

1. `ideate` → `docs/CONCEPT_BRIEF.md` — locked concept, metric, kill criterion,
   substantive design direction (feel is load-bearing here), phased roadmap.
2. `deep-dive` → `docs/DEEP_DIVE.md` + `docs/research/*` — validate the
   load-bearing technical claims (Meta Marketing API reality; ad-ops heuristics)
   so the scaffolding and AI engine are *correct*, not plausible.
3. `prompt-pack` → `docs/PROMPT_PACK.md` — sequence the validated scope into
   self-contained, independently-shippable build units.
4. `build-loop` → the app — drive each unit to near-finish-line on two co-equal
   tracks: objective machine facts (builds, runs, flows pass) **and** the
   mandatory multi-pass visual design loop (render → critique → fix → re-render).

## Execute-discipline

Build only the validated/gated scope. The Meta **write path** (pausing ads,
changing budgets) and the **LLM narrative layer** genuinely need the operator's
tokens/keys — those gates are **emitted honestly** (simulated in demo, scaffolded
for live), never rendered as if live.

## Design direction (feel IS load-bearing — operator asked for "award-winning")

A **dark command-cockpit** aesthetic: deep near-black canvas, luminous data,
one confident brand gradient (meridian violet → signal teal), restrained
semantic color (emerald good / rose bad, CPA-aware), tabular-figure metrics,
refined typography (Inter + JetBrains Mono), generous spacing, tasteful motion.
References in spirit: Linear, Vercel, Stripe dashboards, modern fintech cockpits.
Acceptance: looks intentional and premium at a glance; data is instantly legible;
nothing default-Bootstrap; motion is subtle, never decorative noise.
**Residual:** "looks good to the build-loop's vision pass + the operator" ≠ "a
designer signed off." That taste spot-check is the operator's, flagged in the ledger.

## Honest bounds (the 3 eyes-open limits)

1. **~80% craft ceiling + last-mile tail.** Near-finish-line is the *aim*. A
   correctness/polish tail remains for a human.
2. **Grounding firewall.** Demo data seeds the cockpit so it can be exercised; it
   is **not** evidence buyers want it. That's the real-use handoff.
3. **Judgment isn't cleanly measurable.** The AI's go/scale/cut calls are a
   **signal a buyer weighs**, never proof. Encoded heuristics ≠ a backtested edge.

## Context / handoff safety-net

Files are the durable memory: this kickoff, `CONCEPT_BRIEF`, `DEEP_DIVE`,
`PROMPT_PACK`, `LEDGER`, `META_INTEGRATION`, and the codebase. A fresh session
can resume from these with no chat-memory amnesia.
