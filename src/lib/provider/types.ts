import type { Dataset } from '../demo/generate'
import type { ActionKind, EntityLevel } from '../types'

/* ============================================================================
   The DataProvider seam.
   The entire app reads through this interface. Demo + Live implement it so that
   "turning the lights on" = swapping the provider + dropping in credentials,
   never a UI rewrite.

   Model: the app loads ONE snapshot (all entities + the window's insights) into
   memory, then slices it client-side for instant interaction — exactly how a
   real agency tool pulls once and dices locally. The Live provider assembles the
   same snapshot by paging the Meta Insights API (see docs/META_INTEGRATION.md).
   ========================================================================== */

export type ProviderMode = 'demo' | 'live'

export interface Snapshot extends Dataset {
  mode: ProviderMode
  generatedAt: string
  /** The date the whole app treats as "now" (metrics.setDataContext). Demo pins
   *  the seeded anchor; live carries the real load date so every window —
   *  presets, engine scoring, pacing, weekly report — slices real data. */
  dataAnchor: string
  /** Days of insight history in this snapshot (demo 90; live per LiveConfig). */
  windowDays: number
}

export interface ActionRequest {
  kind: ActionKind
  level: EntityLevel
  entityId: string
  /** budget actions */
  proposedBudget?: number
  /** free-form notes (e.g. creative brief) */
  note?: string
}

export interface ActionResult {
  ok: boolean
  message: string
  /** the entity field(s) that changed, for optimistic UI */
  patch?: Record<string, unknown>
}

export interface DataProvider {
  readonly mode: ProviderMode
  /** Load the full in-memory snapshot the app slices from. */
  loadSnapshot(): Promise<Snapshot>
  /** Apply a write action (pause, budget change, …). Demo simulates; Live POSTs. */
  applyAction(req: ActionRequest, snapshot: Snapshot): Promise<ActionResult>
  /** Health/credential probe — used by the Settings "connection" panel. */
  checkConnection(): Promise<{ ok: boolean; detail: string }>
}
