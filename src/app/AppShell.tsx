import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '../components/shell/Sidebar'
import { TopBar } from '../components/shell/TopBar'
import { Toasts } from '../components/shell/Toasts'
import { useStore } from './store'
import { BootScreen } from '../components/shell/BootScreen'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const init = useStore((s) => s.init)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)
  const snapshot = useStore((s) => s.snapshot)
  const location = useLocation()

  useEffect(() => {
    if (!snapshot) void init()
  }, [init, snapshot])

  if (loading || (!snapshot && !error)) return <BootScreen />
  if (error) return <BootScreen error={error} />

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main key={location.pathname} className="route-fade flex-1 px-5 py-6 lg:px-7">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
      <Toasts />
    </div>
  )
}
