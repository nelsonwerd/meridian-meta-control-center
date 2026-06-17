import { useStore } from './store'
import type { Snapshot } from '../lib/provider'

/** Snapshot accessor that also re-renders when the snapshot is mutated (applied
 *  actions bump `version`). */
export function useSnapshot(): Snapshot | null {
  const snapshot = useStore((s) => s.snapshot)
  useStore((s) => s.version)
  return snapshot
}

export function useScope() {
  return useStore((s) => s.scope)
}

export function useRange() {
  return useStore((s) => s.range)
}
