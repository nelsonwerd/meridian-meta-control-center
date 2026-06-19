# Tier 2 — Calibration design (DESIGN ONLY, no code this round)

> **Status:** design doc for **Wave 3.2**. Nothing here is built yet. Tier 1 (the
> Decision & Outcome Ledger) shipped in Wave 3.1; calibration is the *next* tier and
> is gated on **live outcomes existing**, which they do not in demo. This document
> defines the layer precisely enough to build later without re-litigating the honesty
> firewall.
>
> **Read alongside:** `02_VALIDATED_ARCHITECTURE.md` §3b (engine threading), §5 (the
> firewall), correction **A7** (this layer); `src/lib/ai/thresholds.ts`
> (`effectiveThresholds`, the precedence this extends); `src/lib/history/` (the ledger
> that feeds it); `META_INTEGRATION.md` §7 (the `decision_log` table it reads from).

---

## 1. The three tiers (where this sits)

| Tier | What it is | Status |
|---|---|---|
| **Tier 1 — Ledger** | Record what we actually did + a pre-action snapshot; measure the realized outcome on live data. | **Shipped (Wave 3.1).** |
| **Tier 2 — Calibration** | A bounded, disclosed, reversible nudge to a client's engine thresholds, derived from that client's *own measured outcomes*. Transparent arithmetic — not a model. | **This doc. No code yet.** |
| **Tier 3 — Learned model** | A trained/black-box predictor. | **OUT. Not built, not implied.** Calibration is deliberately *not* a step toward this. |

**The thesis being tested (theme #3):** "can the system learn from what we actually
do?" Tier 2's honest answer is *a little, transparently, on live data only* — across a
meaningful sample of a client's own measured outcomes, applied decisions on borderline
entities may have **correlated** more with improvement than with regression; calibration
can then nudge that gate's sensitivity within a tight bound in the direction the hit-rate
favors, always disclosing it did so and always one click from undo. It is a bounded,
**correlational** nudge — not a prediction, not a causal claim, and not "the system
learned." It cannot, and must not, claim more.

---

## 2. Non-negotiables (inherited firewall — A7 + §5)

1. **Distinct, separately-clearable layer.** Calibration is its OWN field
   (`config.calibration`), never folded into the buyer's hand-set values. The buyer
   can always tell *their* number from *the machine's*.
2. **Human overrides are immune.** A threshold key the buyer has explicitly hand-set
   (`thresholdOverrides[key]`) is **never** touched by calibration. Calibration only
   acts on keys the buyer has left at base/preset. (See §4 for how this reconciles
   with "resolved after manual overrides.")
3. **Gated by a numeric min-sample N** — below N measured outcomes for that
   `(client, key)`, the delta is **0**. No nudging on thin data.
4. **Bounded by a numeric cap** — calibration can move a threshold by at most a fixed
   fraction of its base. It tunes sensitivity; it cannot redefine the buyer's risk
   posture.
5. **Always disclosed** — "engine nudged X by Y because Z (n=N) — revert." Never silent.
6. **Reversible** — clearing calibration restores `base + preset + overrides` exactly,
   byte-for-byte. Dropping the layer touches none of the buyer's hand-set values.
7. **Live-only / demo no-op.** Calibration reads `decision_log.outcome`. Demo outcomes
   are strictly null (Tier-1 firewall), so the sample is always empty in demo →
   calibration is a structural **no-op in demo**. There is no simulated learning.
8. **Not Tier 3.** The delta is deterministic, inspectable arithmetic from an aggregate
   hit-rate. No training, no weights, no opacity.

---

## 3. Data shape (design)

A separate map on `ClientConfig`, keyed by threshold key. Mirrors A7's
`{ key, delta, basis:{ sampleN, hitRate }, appliedAt }`.

```ts
// DESIGN ONLY — not implemented this round. Lives in src/lib/config/types.ts later,
// alongside thresholdOverrides/preset, but resolved as its OWN layer (never merged in).
export interface CalibrationEntry {
  key: ThresholdKey          // which engine threshold this nudges
  delta: number              // signed nudge ADDED to the resolved base, in ABSOLUTE
                             // threshold units (a fraction of base, capped per §5). This
                             // is ALSO carry-forward state: each recompute steps it
                             // toward a new target by at most MAX_STEP·base (§5.2).
  basis: {
    sampleN: number          // # of outcome-LABELLED decisions for this (client, key)
    hitRate: number          // improved / (improved + worsened) over the sample, 0..1
    window: string           // sample LOOKBACK, e.g. "90d of outcome-captured decisions"
  }
  appliedAt: string          // ISO; when this calibration was last (re)computed
}

// On the SINGLE config home, beside thresholdOverrides/preset — a future-round field on
// ClientConfig. A FLAT map so `config.calibration[key]` resolves directly; the clientId
// is already the ClientConfig key, so there is no wrapper object:
//
//   calibration?: Partial<Record<ThresholdKey, CalibrationEntry>>
//
// Separately clearable: resetCalibration(clientId) drops ONLY this map and nothing else.
```

**Source of truth:** computed (server-side; see `META_INTEGRATION.md` §7) from
`decision_log` rows where `outcome IS NOT NULL`, grouped by `(client_id, suggestion_type
→ threshold key)`. It is a **projection of the ledger plus a bounded step from its own
prior value** (§5.2) — recomputed on a schedule, never hand-authored. (The step requires
reading the previous `CalibrationEntry.delta`; it is not a purely stateless projection.)

---

## 4. Resolution & precedence (the one subtle part)

Today (`thresholds.ts:147`):

```ts
effectiveThresholds(clientId) = { ...THRESHOLDS, ...presetDelta, ...thresholdOverrides }
//                                 live global       preset          explicit (human)
```

Tier 2 adds calibration as a layer that is **applied after preset but masked by any
explicit human override**:

```ts
// Shipped signature is 1-arg `effectiveThresholds(clientId)` (thresholds.ts:143), reading
// module-level activeClientThresholds — DO NOT re-introduce a config arg. NOTE: despite
// the code's local name `presetDelta`, PRESET_DELTAS holds ABSOLUTE REPLACEMENT values
// (e.g. scaleCpaRatio 0.8 → 0.7), spread OVER the base — not additive offsets.
//
// The masked omit is a FIREWALL GUARD, not an optimization — never remove it (see §9 test).
const masked = omitKeys(calibration, Object.keys(thresholdOverrides))  // drop any pinned key
effectiveThresholds(clientId) = {
  ...THRESHOLDS,        // 1. live global base (global sliders still move this)
  ...presetReplacement, // 2. preset (absolute replacement, not a delta)
  ...thresholdOverrides,// 3. explicit human overrides — ALWAYS WIN
  ...masked,            // 4. calibration — only keys NOT in (3); bounded; gated by N
}
```

**Reconciling "resolved AFTER manual overrides" (A7) with "human values immune" (§5):**
calibration *is* the last layer in the spread (literally "after"), but it is **masked**
so it can never contain a key the human has explicitly set. Both invariants hold at
once: calibration is resolved last, yet a hand-set value is never overwritten. The two
phrasings — "calibration before overrides" vs "calibration after, but masked" — produce
**identical** results; we adopt the masked form because it matches A7's wording and
makes the immunity explicit at the merge site.

**Precedence summary (most-specific wins per key):**

| Priority | Layer | Set by | Calibratable? |
|---|---|---|---|
| 1 (lowest) | `THRESHOLDS` live global | global sliders | — (base) |
| 2 | preset (absolute replacement) | buyer (preset choice) | yes (calibration may nudge on top) |
| 3 (highest) | explicit `thresholdOverrides` | buyer (hand-set) | **no — immune (masked out)** |
| 4 (applied last, masked) | calibration delta | machine (from outcomes) | this layer |

Global sliders still move the base for every un-pinned, un-calibrated key (the existing
"effectiveThresholds reads the LIVE THRESHOLDS" contract, §6.4, is preserved).

---

## 5. The numbers (defined, as A7 requires)

These are **starting values**, to be tuned against a backtest before enabling. They are
deliberately conservative — the cost of an over-eager nudge (eroded trust) far exceeds
the benefit of a faster one. **Every limit is a fraction OF BASE** (the resolved
threshold value, §5.2), so units never drift between keys.

### 5.1 Constants & the sample ramp
| Name | Value | Meaning |
|---|---|---|
| `N_MIN` | **12** | min outcome-labelled decisions for `(client, key)` before any nudge |
| `N_FULL` | **30** | sample at which the full bound unlocks |
| `MAX_BOUND` | **0.15** | hard ceiling: `|finalDelta| ≤ 0.15 · base`, always |
| `MAX_STEP` | **0.05** | max move per recompute: `≤ 0.05 · base` toward the target |

`ramp(N) = clamp((N - N_MIN) / (N_FULL - N_MIN), 0, 1)` → 0 at N≤12, 1 at N≥30.
`effectiveBound(N) = MAX_BOUND · ramp(N)` — the per-sample cap actually clamped against.
The ramp attenuates the magnitude **exactly once** (in §5.4's `capped` step); it is not
also folded into the delta magnitude.

*Rationale:* 12 separates a directional hit-rate from coin-flip noise on a binary "did it
improve?" signal, yet is reachable within a quarter for an active client; 30 gives a
stable rate before the full ±15% unlocks. Re-derive against real data.

### 5.2 Resolved base
`base` is the value the engine would use for this client **before** calibration — the
shipped `effectiveThresholds(clientId)[key]` =
`thresholdOverrides[key] ?? presetReplacement[key] ?? THRESHOLDS[key]`. Calibration only
touches un-pinned keys (§4 mask), so in practice `base = presetReplacement[key] ?? THRESHOLDS[key]`.
**Never sum `THRESHOLDS + preset`** — presets are absolute replacement values
(scaleCpaRatio base 0.8, conservative 0.7 → base is **0.7**, not 1.5).

### 5.3 Direction & strength (hit-rate → signed delta)
`hitRate H = improved / (improved + worsened)` over the sample (verdicts from
`decision_log.outcome.verdict`; `flat` / `inconclusive` are **excluded** from the
denominator — act only on clear signals). From H:
- **H ≥ 0.65** → `sign = +1`; **H ≤ 0.35** → `sign = -1`;
- **0.35 < H < 0.65** → `sign = 0` → `delta = 0`. The middle band is "no signal," not a
  weak nudge — so reaching `N_MIN` does **not** guarantee a nudge (many clients sit here).

`directionStrength = clamp((|H - 0.5| - 0.15) / 0.35, 0, 1)` → 0 at the band edges
(0.35 / 0.65), 1 at H = 0 or 1; continuous, so a marginal signal yields a marginal nudge.
Whether a higher threshold value loosens or tightens *this* gate is key-specific, defined
per key at build time via a `KEY_DIRECTION` table. Calibration adjusts **sensitivity
toward the observed hit-rate** — never "fires earlier" as a forward-looking claim
(firewall §1: correlational only).

### 5.4 The recompute pipeline (one pass, explicit order)
Per `(client, key)`, reading the prior `CalibrationEntry.delta` as `prev` (0 if none):
```
target  = sign * directionStrength * MAX_BOUND * base            // intent, |·| ≤ MAX_BOUND·base
capped  = clamp(target, -effectiveBound(N)*base, +effectiveBound(N)*base)  // N-ramp acts HERE, once
stepped = prev + clamp(capped - prev, -MAX_STEP*base, +MAX_STEP*base)      // ≤ 5%·base move / recompute
final   = clamp(stepped, -MAX_BOUND*base, +MAX_BOUND*base)        // cumulative ceiling — can't ratchet past ±15%
value   = clamp(base + final, sliderMin, sliderMax)              // keep within the human band (§5.5)
```
`final` is stored back as the entry's `delta` (the carry-forward state). Deterministic;
recomputed on a schedule (e.g. nightly). Because `target` uses the full `MAX_BOUND` and
only `capped` applies the ramp, the two limiters never compound.

*Worked example* — scaleCpaRatio, conservative client (base 0.7), n=21 (ramp≈0.5 →
effectiveBound≈0.075), H=0.78 (directionStrength≈(0.28−0.15)/0.35≈0.37, sign +1, prev 0):
`target` = +0.37·0.15·0.7 ≈ **+0.0389**; `capped` to ±0.0525 → +0.0389; `step` cap
±0.035 → `stepped` = 0+0.035 = **0.035** (step-limited this cycle); `final` 0.035 →
`value` **0.735**. Subsequent recomputes step further toward the target, never past
+0.105 (±15% of 0.7).

### 5.5 Slider-band clamp
For keys in `EDITABLE_THRESHOLDS` (thresholds.ts:52), also clamp `value` to that key's
`{min, max}` — the machine must never produce a value the buyer could not hand-set. Keys
NOT in `EDITABLE_THRESHOLDS` have no slider bound; the ±`MAX_BOUND` cap alone governs
them. Recommended: restrict calibration to keys with a defined `KEY_DIRECTION` (a subset
of `ThresholdKey`), decided at build time.

---

## 6. Disclosure & reversibility (UX contract)

- **Where:** the Settings per-client threshold panel (beside the existing override
  controls) and the entity drawer where a calibrated threshold affected a recommendation.
- **Copy (leads with the correlational basis, never a prediction):** *"On **{N}** measured
  decisions for this client, similar {entities} that were {acted on} more often improved
  than worsened (hit-rate **{H}%**). On that basis the engine has nudged **{KEY_LABEL}** by
  **{+Y%}** — not a prediction. [Revert]"* The number is always "based on what happened,"
  never "this will improve performance."
- **Revert:** one click clears `config.calibration[key]` (or `resetCalibration(clientId)`
  for all). Because calibration is a separate layer, revert restores
  `base + preset + overrides` exactly — the buyer's hand-set values are never involved.
- **Visual distinction:** a calibrated value renders with a distinct "auto" badge and the
  base value shown struck-through/aside, so the buyer always sees *their* number and *the
  machine's* number side by side (directly addressing A7's "can't tell which is which").
- **Off by default.** Calibration is opt-in per workspace (and per client). Shipping it
  dark-by-default would violate "never oversell."

---

## 7. Why demo can't show this (and that's correct)

Calibration's only input is `decision_log.outcome`. Per the Tier-1 firewall, demo
outcomes are strictly null (frozen "today", memoized dataset, `applyAction` writes no
insight rows). So in demo the sample is always 0 < `N_MIN` → every `delta = 0` →
calibration is a guaranteed no-op. **We do not simulate a calibration in demo.** The
Settings panel may show the calibration *controls* with an honest empty state
("Calibration can apply only on live data, and only if {N_MIN}+ measured decisions show a
clear directional signal — many clients stay on their hand-set values, which is
expected"), but no nudged numbers. The copy must not promise activation: reaching the
sample floor does not guarantee a nudge (the 0.35–0.65 band yields zero — §5.3). This is
the same posture as Tier-1's "Outcome: pending."

---

## 8. Open questions / risks (flag before building)

- **Attribution is correlational, not causal** (firewall §1). The hit-rate measures
  *association* between an action and a subsequent trajectory, not proof the action
  caused it. The disclosure copy must stay correlational; calibration is "the gate has
  been firing well/poorly here lately," never "this gate earns $Z."
- **Key→outcome mapping is not 1:1.** A `suggestion_type` maps to one or more threshold
  keys; the build must define the exact `suggestion_type → key(s)` table and how a
  multi-key suggestion attributes its outcome. Under-specified today.
- **Seasonality / regime change.** A 90-day window can lag a step-change in a client's
  funnel. `MAX_STEP` damps this; consider a recency weight at build time.
- **Two distinct windows (don't conflate).** §5's sample **lookback** (how far back we
  gather already-measured decisions, ~90d) is separate from `META_INTEGRATION.md` §7.4's
  per-decision **measurement horizon** (how long after a decision we wait before scoring
  its outcome, ~7–14d).
- **Sparse clients never calibrate** — and that's fine (they stay on base/preset/manual).
  Calibration is an assist for high-volume clients, not a universal feature.
- **Backtest first.** Do not enable for a real client until `N_MIN`/`N_FULL`/`MAX_BOUND`
  are validated against historical `decision_log` outcomes (would the nudge have helped?).

---

## 9. Build checklist (when Tier 2 is greenlit — NOT this round)

- [ ] `decision_log.outcome` populated on live data (requires the live outcome-capture
      job; see `META_INTEGRATION.md` §7).
- [ ] Server-side calibration computation (the projection in §3/§5), exposed via the
      config API.
- [ ] `config.calibration` flat field (`Partial<Record<ThresholdKey, CalibrationEntry>>`)
      + `applyClientConfig`/`effectiveThresholds` extended with the masked-last layer (§4),
      using the shipped 1-arg `effectiveThresholds(clientId)`. The 3-arg `analyzeAd`
      signature stays untouched.
- [ ] `setCalibration`/`resetCalibration` store actions (separately clearable).
- [ ] Disclosure UI (§6) + "auto" badge + per-workspace opt-in.
- [ ] Tests (firewall + math): **override-immunity AT THE MERGE** — even a calibration map
      that contains a pinned key cannot change that key's resolved value (the §4 `omitKeys`
      mask is a firewall guard, never an optimization to remove); `delta = 0` below `N_MIN`
      and in the 0.35–0.65 band; **cumulative bound** — repeated recomputes never exceed
      ±`MAX_BOUND`·base; per-recompute move ≤ `MAX_STEP`·base; result clamped to the slider
      band for editable keys; revert restores base+preset+overrides exactly; **demo is a
      structural no-op** (empty outcome sample → every `delta = 0`).
