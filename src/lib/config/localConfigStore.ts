import type { ClientConfig, ConfigStore } from './types'

/* Browser-local ConfigStore. Mode-agnostic (per-client targets are real intent in
   both demo and live). The async signatures keep the backend swap a drop-in. */
const KEY = 'meridian.config'

export function createLocalConfigStore(): ConfigStore {
  const read = (): Record<string, ClientConfig> => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as Record<string, ClientConfig>) : {}
    } catch {
      return {}
    }
  }
  const write = (all: Record<string, ClientConfig>) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
      /* ignore quota/availability */
    }
  }
  return {
    async load() {
      return read()
    },
    async save(cfg) {
      const all = read()
      all[cfg.clientId] = cfg
      write(all)
    },
    async reset(clientId) {
      const all = read()
      delete all[clientId]
      write(all)
    },
  }
}
