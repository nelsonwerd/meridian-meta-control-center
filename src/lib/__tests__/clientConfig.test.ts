import { describe, it, expect } from 'vitest'
import { generateDataset } from '../demo/generate'
import { analyzeClient } from '../ai/engine'
import { applyClientConfig } from '../config'

/* W1.1: per-client config resolves onto the Client and the engine re-scores per
   client, isolated. The store applies config IN PLACE onto snapshot Clients; here
   we test the pure resolver + the engine's sensitivity/isolation directly. */

function proj(ds: ReturnType<typeof generateDataset>, clientId: string): string[] {
  return analyzeClient(ds, clientId)
    .map((s) => `${s.id}|${s.severity}|${s.confidence.toFixed(4)}|${s.title}`)
    .sort()
}

describe('applyClientConfig (pure resolver)', () => {
  const ds = generateDataset()
  const client = ds.clients[0]

  it('returns the same reference when there is no config', () => {
    expect(applyClientConfig(client, undefined)).toBe(client)
  })

  it('leaves all targets untouched when the config has no override fields', () => {
    const out = applyClientConfig(client, { clientId: client.id, updatedAt: 'x' })
    expect(out.targetCPA).toBe(client.targetCPA)
    expect(out.targetROAS).toBe(client.targetROAS)
    expect(out.monthlyBudget).toBe(client.monthlyBudget)
  })

  it('overrides only the provided fields, without mutating the original', () => {
    const out = applyClientConfig(client, { clientId: client.id, targetCPA: 999, updatedAt: 'x' })
    expect(out.targetCPA).toBe(999)
    expect(out.targetROAS).toBe(client.targetROAS) // untouched
    expect(client.targetCPA).not.toBe(999) // pure — original object unchanged
  })
})

describe('engine responds to per-client target changes, isolated per client', () => {
  it('tightening one client targetCPA changes only that client suggestions', () => {
    const ds = generateDataset()
    const a = ds.clients[0].id
    const b = ds.clients[1].id
    const aBefore = proj(ds, a)
    const bBefore = proj(ds, b)

    // Simulate what the store does in place: overlay a much stricter targetCPA on
    // client A's Client object (which clientById shares), then restore after.
    const ca = ds.clientById.get(a)!
    const orig = ca.targetCPA
    ca.targetCPA = orig * 0.25
    try {
      expect(proj(ds, a)).not.toEqual(aBefore) // client A re-scored
      expect(proj(ds, b)).toEqual(bBefore) // client B untouched (isolated)
    } finally {
      ca.targetCPA = orig // do not pollute the shared catalog for other tests
    }
  })
})
