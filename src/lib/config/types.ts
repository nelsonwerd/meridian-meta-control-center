import type { THRESHOLDS } from '../ai/thresholds'

/* ============================================================================
   Per-client configuration (targets + — Wave 2 — engine-threshold overrides).
   This is the SINGLE home for per-client overrides. It is a PERSISTENCE layer
   only: on load, overrides are applied ONTO the snapshot's Client objects (the
   one read source the engine + screens already use), exactly like loadThresholds()
   mutates the global THRESHOLDS before the first analysis pass. Async at the seam
   (backend-swappable); the engine never awaits — config is hydrated once into the
   store and the merged Client is what everything reads.
   ========================================================================== */

export type ThresholdKey = keyof typeof THRESHOLDS

export interface ClientConfig {
  clientId: string
  /** target overrides — undefined means "use the seeded/base value" */
  targetCPA?: number
  targetROAS?: number
  monthlyBudget?: number
  avgOrderValue?: number
  contributionMargin?: number
  /** Wave 2: per-client engine-threshold overrides + aggressiveness preset */
  thresholdOverrides?: Partial<Record<ThresholdKey, number>>
  preset?: 'conservative' | 'balanced' | 'aggressive'
  updatedAt: string
}

/** Persistence seam — mirrors the DataProvider demo/live pattern. Local impl now;
 *  the documented backend (GET/PUT /api/config/clients) is a drop-in later. */
export interface ConfigStore {
  load(): Promise<Record<string, ClientConfig>>
  save(cfg: ClientConfig): Promise<void>
  reset(clientId: string): Promise<void>
}
