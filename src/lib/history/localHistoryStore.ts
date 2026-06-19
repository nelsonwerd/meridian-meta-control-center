import { getProviderMode } from '../provider'
import type { ProviderMode } from '../provider'
import type { DecisionOutcome, DecisionRecord, HistoryStore } from './types'

/* Browser-local HistoryStore. MODE-SEGREGATED: demo (simulated) and live (real)
   decisions live in SEPARATE localStorage buckets and never mix (firewall). A record
   is filed under ITS OWN stamped mode, so a demo decision can physically never enter
   the live bucket — segregation is structural, not just a query filter. Reads return
   only the CURRENT provider mode's bucket. The async signatures keep the documented
   backend (the `decision_log` table) a drop-in swap later. */

const KEY_PREFIX = 'meridian.history.'
const keyFor = (mode: ProviderMode) => `${KEY_PREFIX}${mode}` // meridian.history.demo / .live

const ALL_MODES: ProviderMode[] = ['demo', 'live']

function genId(): string {
  return 'd_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
}

export function createLocalHistoryStore(): HistoryStore {
  const readBucket = (mode: ProviderMode): DecisionRecord[] => {
    try {
      const raw = localStorage.getItem(keyFor(mode))
      return raw ? (JSON.parse(raw) as DecisionRecord[]) : []
    } catch {
      return []
    }
  }
  const writeBucket = (mode: ProviderMode, rows: DecisionRecord[]) => {
    try {
      localStorage.setItem(keyFor(mode), JSON.stringify(rows))
    } catch {
      /* ignore quota/availability */
    }
  }

  return {
    async record(d) {
      const rec: DecisionRecord = { ...d, id: genId() }
      const rows = readBucket(rec.mode)
      rows.unshift(rec) // newest first
      writeBucket(rec.mode, rows)
      return rec
    },

    async forEntity(entityId) {
      return readBucket(getProviderMode()).filter((r) => r.entityId === entityId)
    },

    async forClient(clientId) {
      return readBucket(getProviderMode()).filter((r) => r.clientId === clientId)
    },

    async all() {
      return readBucket(getProviderMode())
    },

    async attachOutcome(id, outcome: DecisionOutcome | null) {
      // FIREWALL: demo outcomes are strictly null. Even if this is called, an outcome
      // can NEVER be written onto a demo (simulated) record — there is no real elapsed
      // trajectory in demo. Only live records accept an outcome.
      for (const mode of ALL_MODES) {
        const rows = readBucket(mode)
        const i = rows.findIndex((r) => r.id === id)
        if (i === -1) continue
        if (rows[i].mode !== 'live') return // demo record → no-op (outcome stays null)
        rows[i] = { ...rows[i], outcome }
        writeBucket(mode, rows)
        return
      }
    },
  }
}
