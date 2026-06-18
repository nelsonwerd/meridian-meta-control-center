import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '../components/shell/Sidebar'
import { TopBar } from '../components/shell/TopBar'
import { Toasts } from '../components/shell/Toasts'
import { useStore } from './store'
import { BootScreen } from '../components/shell/BootScreen'
import { ErrorBoundary } from '../components/shell/ErrorBoundary'
import { EntityDrawer } from '../components/shell/EntityDrawer'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  // Below lg the sidebar is forced to its icon rail so content isn't squeezed.
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024)
  const init = useStore((s) => s.init)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)
  const snapshot = useStore((s) => s.snapshot)
  const location = useLocation()

  useEffect(() => {
    if (!snapshot) void init()
  }, [init, snapshot])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const onChange = () => setIsNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  if (loading || (!snapshot && !error)) return <BootScreen />
  if (error) return <BootScreen error={error} />

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar collapsed={isNarrow || collapsed} onToggle={() => setCollapsed((v) => !v)} hideToggle={isNarrow} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main key={location.pathname} className="route-fade flex-1 px-5 py-6 lg:px-7">
          <div className="mx-auto w-full max-w-[1400px]">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <Toasts />
      <EntityDrawer />
    </div>
  )
}
