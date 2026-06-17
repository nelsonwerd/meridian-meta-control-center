import { DemoProvider } from './demoProvider'
import { LiveProvider } from './liveProvider'
import type { DataProvider, ProviderMode } from './types'

export * from './types'

const PROVIDER_MODE_KEY = 'meridian.provider.mode'

export function getProviderMode(): ProviderMode {
  return (localStorage.getItem(PROVIDER_MODE_KEY) as ProviderMode) || 'demo'
}

export function setProviderMode(mode: ProviderMode) {
  localStorage.setItem(PROVIDER_MODE_KEY, mode)
}

/** Resolve the active provider. Demo is the default until the operator configures
 *  live credentials and flips the switch in Settings → Connection. */
export function createProvider(mode: ProviderMode = getProviderMode()): DataProvider {
  return mode === 'live' ? new LiveProvider() : new DemoProvider()
}
