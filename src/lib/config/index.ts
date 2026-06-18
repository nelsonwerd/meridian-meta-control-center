import type { Client } from '../types'
import type { ClientConfig, ConfigStore } from './types'
import { createLocalConfigStore } from './localConfigStore'

export * from './types'

/** Resolve the active ConfigStore. Local (browser) now; a backend-backed store is
 *  a drop-in later (mirrors createProvider). */
export function createConfigStore(): ConfigStore {
  return createLocalConfigStore()
}

/** The per-client target fields config can override. */
export type ClientTargets = Pick<
  Client,
  'targetCPA' | 'targetROAS' | 'monthlyBudget' | 'avgOrderValue' | 'contributionMargin'
>

/** Pure resolver: a Client with its config overrides applied (undefined config
 *  fields fall through to the client's existing/base value). Returns the same
 *  reference when there is nothing to apply. Used by tests + the store's in-place
 *  apply. */
export function applyClientConfig(client: Client, cfg?: ClientConfig): Client {
  if (!cfg) return client
  const out: Client = { ...client }
  if (cfg.targetCPA !== undefined) out.targetCPA = cfg.targetCPA
  if (cfg.targetROAS !== undefined) out.targetROAS = cfg.targetROAS
  if (cfg.monthlyBudget !== undefined) out.monthlyBudget = cfg.monthlyBudget
  if (cfg.avgOrderValue !== undefined) out.avgOrderValue = cfg.avgOrderValue
  if (cfg.contributionMargin !== undefined) out.contributionMargin = cfg.contributionMargin
  return out
}
