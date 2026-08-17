import type { Dataset } from '../demo/generate'
import type { ActionKind, Creative, EntityLevel } from '../types'

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

/** The renderable asset behind a creative, resolved on demand. */
export interface CreativeAsset {
  /** direct MP4 the browser can play in a <video> element */
  videoUrl?: string
  /** full-resolution still (or the video's poster frame) */
  imageUrl?: string
  /** the ad's post on Facebook — the escape hatch for anything we can't render
   *  inline, e.g. carousels and playables */
  permalinkUrl?: string
}

export interface DataProvider {
  readonly mode: ProviderMode
  /** Load the full in-memory snapshot the app slices from. */
  loadSnapshot(): Promise<Snapshot>
  /** Apply a write action (pause, budget change, …). Demo simulates; Live POSTs. */
  applyAction(req: ActionRequest, snapshot: Snapshot): Promise<ActionResult>
  /** Health/credential probe — used by the Settings "connection" panel. */
  checkConnection(): Promise<{ ok: boolean; detail: string }>
  /** Full-resolution / playable media for ONE creative.
   *
   *  Deliberately not part of loadSnapshot: it is a Graph call per creative, and
   *  doing it for a whole account is precisely the pattern that exhausted the
   *  rate-limit budget before. Called when an operator opens a single ad, so the
   *  cost is one request per thing a human actually looked at.
   *
   *  Optional — demo has no real media and omits it entirely. */
  resolveCreativeAsset?(creative: Creative): Promise<CreativeAsset | null>
}
