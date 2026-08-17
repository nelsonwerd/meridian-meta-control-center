import { Activity, RefreshCw } from 'lucide-react'
import { ScopeSwitcher } from './ScopeSwitcher'
import { DateRangeMenu } from './DateRangeMenu'
import { useSnapshot } from '../../app/hooks'
import { useStore } from '../../app/store'
import { fmtFull } from '../../lib/metrics'
import { cn } from '../../lib/cn'

/** Anything older than this is called out rather than presented as current. */
const STALE_AFTER_MIN = 90

function agoLabel(iso: string): { text: string; minutes: number } {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (minutes < 1) return { text: 'just now', minutes }
  if (minutes < 60) return { text: `${minutes}m ago`, minutes }
  const h = Math.round(minutes / 60)
  if (h < 24) return { text: `${h}h ago`, minutes }
  return { text: `${Math.round(h / 24)}d ago`, minutes }
}

export function TopBar() {
  const snapshot = useSnapshot()
  const providerMode = useStore((s) => s.providerMode)
  const refreshing = useStore((s) => s.refreshing)
  const refresh = useStore((s) => s.refreshSnapshot)

  const live = providerMode === 'live'
  // generatedAt survives caching, so it is the true "when did this come from
  // Meta" in both paths — the cache never restamps it as fresh.
  const age = snapshot ? agoLabel(snapshot.generatedAt) : null
  const stale = live && age !== null && age.minutes >= STALE_AFTER_MIN

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/80 px-5 backdrop-blur-xl">
      <ScopeSwitcher />
      <div className="flex-1" />
      <div
        className={cn(
          'hidden items-center gap-2 rounded-full border py-1.5 pl-3 text-2xs md:flex',
          live ? 'pr-1.5' : 'pr-3',
          stale ? 'border-warning/40 bg-warning/10 text-warning' : 'border-line bg-surface-2 text-ink-muted',
        )}
        title={snapshot ? `Pulled ${fmtFull(snapshot.generatedAt)}` : undefined}
      >
        <Activity className={cn('h-3.5 w-3.5', stale ? 'text-warning' : 'text-success')} />
        <span>
          {snapshot ? (
            // Live data is dated by WHEN IT WAS PULLED, because on a rate-limited
            // account it can legitimately be hours old and the operator has to
            // know that before acting on it.
            live ? `Data from ${fmtFull(snapshot.generatedAt)} · ${age!.text}` : `Data current as of ${fmtFull(snapshot.generatedAt)}`
          ) : (
            'Data current as of —'
          )}
        </span>
        {live && (
          <button
            onClick={() => void refresh()}
            disabled={refreshing}
            title="Pull fresh data from Meta (spends rate-limit budget)"
            aria-label="Refresh data from Meta"
            className="ml-0.5 inline-flex items-center gap-1 rounded-full border border-line bg-surface-3 px-2 py-0.5 font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus-ring"
          >
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
      <DateRangeMenu />
    </header>
  )
}
