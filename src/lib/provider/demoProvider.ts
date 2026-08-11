import { getDataset } from '../demo/dataset'
import { DATA_TODAY, WINDOW_DAYS } from '../demo/generate'
import type { ActionRequest, ActionResult, DataProvider, Snapshot } from './types'

/** In-memory provider backed by the deterministic demo dataset.
 *  Reads resolve immediately; writes mutate the live snapshot optimistically so
 *  the UI reflects "applied" changes (clearly labelled as simulated). */
export class DemoProvider implements DataProvider {
  readonly mode = 'demo' as const

  async loadSnapshot(): Promise<Snapshot> {
    const ds = getDataset()
    return { ...ds, mode: 'demo', generatedAt: DATA_TODAY, dataAnchor: DATA_TODAY, windowDays: WINDOW_DAYS }
  }

  async checkConnection() {
    return { ok: true, detail: 'Demo mode — seeded data, no Meta API connection required.' }
  }

  async applyAction(req: ActionRequest, snapshot: Snapshot): Promise<ActionResult> {
    switch (req.kind) {
      case 'increase_budget':
      case 'decrease_budget': {
        if (req.proposedBudget == null) return { ok: false, message: 'No target budget provided.' }
        if (req.level === 'campaign') {
          const c = snapshot.campaignById.get(req.entityId)
          if (!c) return { ok: false, message: 'Campaign not found.' }
          c.dailyBudget = req.proposedBudget
        } else if (req.level === 'adset') {
          const a = snapshot.adSetById.get(req.entityId)
          if (!a) return { ok: false, message: 'Ad set not found.' }
          a.dailyBudget = req.proposedBudget
        }
        return {
          ok: true,
          message: `Daily budget set to $${req.proposedBudget.toLocaleString()} (simulated).`,
          patch: { dailyBudget: req.proposedBudget },
        }
      }
      case 'pause': {
        applyStatus(snapshot, req, 'PAUSED')
        return { ok: true, message: 'Entity paused (simulated).', patch: { status: 'PAUSED' } }
      }
      case 'activate': {
        applyStatus(snapshot, req, 'ACTIVE')
        return { ok: true, message: 'Entity activated (simulated).', patch: { status: 'ACTIVE' } }
      }
      case 'duplicate':
        return { ok: true, message: 'Duplicate queued (simulated). Live mode would clone via the Graph API.' }
      case 'consolidate':
        return { ok: true, message: 'Consolidation plan staged (simulated).' }
      case 'brief_creative':
        return { ok: true, message: 'Creative brief added to the next test batch (simulated).' }
      default:
        return { ok: true, message: 'Acknowledged (simulated).' }
    }
  }
}

function applyStatus(snapshot: Snapshot, req: ActionRequest, status: 'PAUSED' | 'ACTIVE') {
  if (req.level === 'campaign') {
    const c = snapshot.campaignById.get(req.entityId)
    if (c) c.status = status
  } else if (req.level === 'adset') {
    const a = snapshot.adSetById.get(req.entityId)
    if (a) a.status = status
  } else if (req.level === 'ad') {
    const a = snapshot.adById.get(req.entityId)
    if (a) a.status = status
  }
}
