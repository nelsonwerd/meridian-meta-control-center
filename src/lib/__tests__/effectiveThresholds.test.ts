import { describe, it, expect, afterEach } from 'vitest'
import { generateDataset } from '../demo/generate'
import { analyzeClient } from '../ai/engine'
import { creativePerformance } from '../ai/creative'
import { effectiveThresholds, setActiveClientThresholds, THRESHOLDS } from '../ai/thresholds'
import { makeRange } from '../metrics'

// reset the module-level active config between tests so state can't leak
afterEach(() => setActiveClientThresholds({}))

describe('effectiveThresholds — resolution & precedence', () => {
  it('returns the base THRESHOLDS (same ref) when the client has no preset/overrides', () => {
    setActiveClientThresholds({})
    expect(effectiveThresholds('c_x')).toBe(THRESHOLDS)
  })

  it('applies explicit overrides over the base; untouched keys fall through', () => {
    setActiveClientThresholds({ c_x: { thresholdOverrides: { scaleCpaRatio: 0.5 } } })
    expect(effectiveThresholds('c_x').scaleCpaRatio).toBe(0.5)
    expect(effectiveThresholds('c_x').cutCpaRatio).toBe(THRESHOLDS.cutCpaRatio)
  })

  it('applies a preset bundle, and an explicit override beats the preset', () => {
    setActiveClientThresholds({ c_x: { preset: 'aggressive' } })
    expect(effectiveThresholds('c_x').scaleCpaRatio).toBe(0.9)
    setActiveClientThresholds({ c_x: { preset: 'aggressive', thresholdOverrides: { scaleCpaRatio: 0.6 } } })
    expect(effectiveThresholds('c_x').scaleCpaRatio).toBe(0.6)
  })
})

describe('per-client threshold overrides re-score the engine + creative, isolated', () => {
  const recIds = (ds: ReturnType<typeof generateDataset>, clientId: string) =>
    analyzeClient(ds, clientId).map((s) => `${s.id}|${s.severity}`).sort()

  it('a strict override changes that client only (engine)', () => {
    const ds = generateDataset()
    const a = ds.clients[0].id
    const b = ds.clients[1].id
    const aBefore = recIds(ds, a)
    const bBefore = recIds(ds, b)
    setActiveClientThresholds({ [a]: { thresholdOverrides: { cutCpaRatio: 1.0, scaleMinPurchases7d: 5 } } })
    expect(recIds(ds, a)).not.toEqual(aBefore) // client A re-scored
    expect(recIds(ds, b)).toEqual(bBefore) // client B isolated
  })

  it('the same override flows into creative.ts diagnosis (no Recommendations/Creative-Lab divergence)', () => {
    const ds = generateDataset()
    const a = ds.clients[0].id
    const range = makeRange('28d')
    const diag = () => creativePerformance(ds, a, range).map((p) => `${p.creative.id}:${p.diagnosis}`).sort()
    const before = diag()
    // make fatigue trivially easy to trip → diagnoses shift
    setActiveClientThresholds({ [a]: { thresholdOverrides: { fatigueFrequency: 0, fatigueCtrDropWoW: -1 } } })
    expect(diag()).not.toEqual(before)
  })
})
