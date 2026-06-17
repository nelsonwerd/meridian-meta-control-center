import { NavLink } from 'react-router-dom'
import {
  ChevronsLeft,
  Images,
  LayoutDashboard,
  Layers3,
  FileBarChart,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { useStore } from '../../app/store'

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/recommendations', label: 'Recommendations', icon: Sparkles },
  { to: '/campaigns', label: 'Campaigns', icon: Layers3 },
  { to: '/creatives', label: 'Creative Lab', icon: Images },
  { to: '/report', label: 'Weekly Report', icon: FileBarChart },
  { to: '/clients', label: 'Clients', icon: Users },
]

export function Sidebar({ collapsed, onToggle, hideToggle }: { collapsed: boolean; onToggle: () => void; hideToggle?: boolean }) {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const mode = useStore((s) => s.providerMode)

  return (
    <aside
      className={cn(
        'sticky top-0 z-30 flex h-screen flex-col border-r border-line bg-surface/70 backdrop-blur-xl transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-[244px]',
      )}
    >
      {/* brand */}
      <div className={cn('flex h-16 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-gradient shadow-glow">
          <MeridianGlyph />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight text-ink">Meridian</div>
            <div className="text-2xs text-ink-subtle">Meta Command Center</div>
          </div>
        )}
      </div>

      {/* nav */}
      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-ring',
                collapsed && 'justify-center px-0',
                isActive ? 'bg-brand/12 text-ink' : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
              )
            }
            title={collapsed ? item.label : undefined}
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-brand' : 'text-ink-subtle group-hover:text-ink')} strokeWidth={2} />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* footer */}
      <div className="space-y-1 border-t border-line px-3 py-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-ring',
              collapsed && 'justify-center px-0',
              isActive ? 'bg-brand/12 text-ink' : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
            )
          }
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings className="h-[18px] w-[18px] shrink-0 text-ink-subtle" strokeWidth={2} />
          {!collapsed && <span>Settings</span>}
        </NavLink>

        <div className={cn('flex items-center gap-1', collapsed ? 'flex-col' : 'justify-between px-1 pt-1')}>
          <button
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-3 hover:text-ink focus-ring"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {!collapsed && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset',
                mode === 'live' ? 'text-success bg-success/10 ring-success/20' : 'text-teal bg-teal/10 ring-teal/20',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', mode === 'live' ? 'bg-success' : 'bg-teal animate-pulse-soft')} />
              {mode === 'live' ? 'Live' : 'Demo data'}
            </span>
          )}
          {!hideToggle && (
            <button
              onClick={onToggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn('flex h-8 w-8 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-3 hover:text-ink focus-ring', collapsed && 'rotate-180')}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

function MeridianGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M4 16C7 16 7 9 12 9C17 9 17 16 20 16" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="9" r="1.8" fill="white" />
    </svg>
  )
}
