import { useStore } from './store'
import type { Snapshot } from '../lib/provider'

/** Snapshot accessor that also re-renders when the snapshot is mutated (applied
 *  actions bump `version`). */
export function useSnapshot(): Snapshot | null {
  const snapshot = useStore((s) => s.snapshot)
  // Intentional belt-and-suspenders: bumpSnapshot also swaps the snapshot ref, so
  // the line above already re-renders. This explicit `version` subscription guards
  // any future mutation path that bumps version WITHOUT cloning. Keep it.
  useStore((s) => s.version)
  return snapshot
}

export function useScope() {
  return useStore((s) => s.scope)
}

export function useRange() {
  return useStore((s) => s.range)
}
