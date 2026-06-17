/* ============================================================================
   Ad-ops decision thresholds encoded from the deep-dive research
   (docs/research/adops-kpis-playbook.md). These are the knobs the heuristic AI
   engine reasons with. They are deliberately centralized so a buyer could tune
   them per-account later. All "directional" per the research — a signal a human
   weighs, never a backtested edge (see kickoff honest-bounds #3).
   ========================================================================== */

export const THRESHOLDS = {
  /** Minimum-signal gate: don't judge CPA until there's enough data. */
  minSpendVsCPA: 1.0, // spend >= 1x target CPA
  minPurchasesToJudge: 3,
  minImpressionsToJudge: 2000,
  /** confident keep/scale wants this much volume */
  confidentPurchases: 30,

  /** SCALE a winner */
  scaleCpaRatio: 0.8, // CPA <= target * 0.8
  scaleMaxFrequency: 3.0,
  scaleMinPurchases7d: 25, // slightly under research's 30 to surface more in demo
  scaleStepPct: 0.2, // raise budget <= 20% per edit
  scaleCooldownDays: 3,

  /** CUT / PAUSE */
  cutCpaRatio: 1.3, // CPA > target * 1.3 with signal
  zeroConvSpendRatio: 1.5, // spend >= 1.5x target CPA, 0 purchases → pause
  doaCtrPct: 0.5, // >=2000 impressions at < 0.5% CTR → DOA creative

  /** CREATIVE FATIGUE (a trend, not a level — all must lean true). CTR/CPM use
   *  the low end of the research's 10–25% band to catch fatigue earlier. */
  fatigueFrequency: 3.0,
  fatigueCtrDropWoW: 0.08, // link CTR down >= 8% week-over-week
  fatigueCpmRise2wk: 0.08, // CPM up >= 8% over 2 weeks
  fatigueCpaRising: true,

  /** CONSOLIDATE */
  consolidateMinEventsPerWeek: 18, // below this per ad set → too sparse to exit learning
  consolidateLearningDays: 7,

  /** CREATIVE FUNNEL DIAGNOSIS (video) */
  hookRateFloor: 0.25, // < 25% 3s/impr → weak first 3 seconds
  holdRateFloor: 0.3, // good hook but < 30% thruplay/3s → weak body
  /** conversion diagnosis */
  cvrFloor: 0.012, // < 1.2% purchases/link-click w/ good engagement → LP/offer

  /** REALLOCATE: spread of CPA across an account's ad sets worth rebalancing */
  reallocateCpaSpread: 0.35,
} as const

/** Healthy directional benchmark ranges (ecommerce Meta), for context badges. */
export const BENCHMARKS = {
  ctr: { poor: 0.7, ok: 1.0, good: 1.8 }, // link CTR %
  cpm: { good: 12, ok: 20, poor: 32 }, // $ (lower better)
  frequency: { ok: 2.0, watch: 3.0, high: 4.0 },
  hookRate: { poor: 0.2, ok: 0.28, good: 0.4 },
  holdRate: { poor: 0.15, ok: 0.25, good: 0.35 },
} as const
