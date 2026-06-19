import type { EntityLevel, Severity, SuggestionType } from '../types'
import type { ProviderMode } from '../provider'

/* ============================================================================
   Decision & Outcome Ledger (Wave 3, Tier 1) — the accountability layer.

   Every applied/dismissed decision is recorded ADDITIVELY (fire-and-forget) with a
   pre-action metric snapshot, so the system keeps an honest running history of what
   the buyer actually did. This is a PERSISTENCE seam only (mirrors ConfigStore): the
   async signatures keep the documented backend (the `decision_log` table) a drop-in.

   HONESTY FIREWALL (locked — Wave 3's credibility rides on it):
   - `outcome` is captured LATER, on LIVE data over elapsed time. It is STRICTLY null
     in demo: demo "today" is frozen and applyAction writes no insight rows, so a
     realized post-action trajectory genuinely cannot move. No simulated outcomes.
   - Any realized trajectory is a CORRELATIONAL signal ("after this pause, 7d CPA moved
     X→Y") — never a causal savings claim.
   - History is MODE-SEGREGATED: a demo (simulated) decision must never appear in a
     live (real) ledger. The local store files each record under its own mode bucket.
   ========================================================================== */

export type DecisionAction = 'applied' | 'dismissed' | 'acknowledged'

/** Realized post-action trajectory — captured only on LIVE data over elapsed time.
 *  Strictly absent/null in demo (firewall). The verdict is correlational, not causal. */
export interface DecisionOutcome {
  capturedAt: string
  cpa: number
  spend: number
  roas: number
  verdict: 'improved' | 'flat' | 'worsened' | 'inconclusive'
}

export interface DecisionRecord {
  id: string
  /** segregate demo (simulated) from live (real) — never mix */
  mode: ProviderMode
  clientId: string
  entityId: string
  level: EntityLevel
  suggestionType: SuggestionType
  severity: Severity
  action: DecisionAction
  confidence: number
  /** metric snapshot at decision time (the engine scores on the last 7 days) */
  preMetrics: { cpa: number; spend: number; roas: number; purchases: number }
  /** the suggestion's projected impact label, carried for context (not a promise) */
  projected?: { metric: string; note?: string }
  /** ISO timestamp at decision time (Date.now allowed in app code) */
  decidedAt: string
  /** Captured later, on LIVE data over elapsed time. STRICTLY null in demo. */
  outcome?: DecisionOutcome | null
}

/** Persistence seam — mirrors ConfigStore / the DataProvider demo/live pattern. Local
 *  impl now; the documented backend (`decision_log`, see META_INTEGRATION.md) is a
 *  drop-in later. Reads return only the CURRENT provider mode's records. */
export interface HistoryStore {
  record(d: Omit<DecisionRecord, 'id'>): Promise<DecisionRecord>
  forEntity(entityId: string): Promise<DecisionRecord[]>
  forClient(clientId: string): Promise<DecisionRecord[]>
  all(): Promise<DecisionRecord[]>
  attachOutcome(id: string, outcome: DecisionOutcome | null): Promise<void>
}
