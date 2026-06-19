import type { HistoryStore } from './types'
import { createLocalHistoryStore } from './localHistoryStore'

export * from './types'

/** Resolve the active HistoryStore. Local (browser) now; the backend-backed store
 *  (the documented `decision_log` table) is a drop-in later — mirrors createConfigStore
 *  / createProvider. */
export function createHistoryStore(): HistoryStore {
  return createLocalHistoryStore()
}
