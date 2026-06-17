import { Activity } from 'lucide-react'
import { ScopeSwitcher } from './ScopeSwitcher'
import { DateRangeMenu } from './DateRangeMenu'
import { useSnapshot } from '../../app/hooks'
import { fmtFull } from '../../lib/metrics'

export function TopBar() {
  const snapshot = useSnapshot()
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/80 px-5 backdrop-blur-xl">
      <ScopeSwitcher />
      <div className="flex-1" />
      <div className="hidden items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-2xs text-ink-muted md:flex">
        <Activity className="h-3.5 w-3.5 text-success" />
        <span>Data current as of {snapshot ? fmtFull(snapshot.generatedAt) : '—'}</span>
      </div>
      <DateRangeMenu />
    </header>
  )
}
