import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, Globe, Briefcase } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useClickOutside } from '../../lib/useClickOutside'
import { useStore } from '../../app/store'
import { useSnapshot } from '../../app/hooks'
import { Avatar } from '../ui/primitives'
import { metricsForScope } from '../../lib/selectors'
import { fmtCurrency } from '../../lib/format'
import type { Scope } from '../../lib/types'

export function ScopeSwitcher() {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false))
  const snapshot = useSnapshot()
  const scope = useStore((s) => s.scope)
  const setScope = useStore((s) => s.setScope)
  const range = useStore((s) => s.range)
  const navigate = useNavigate()
  if (!snapshot) return null

  const current = describeScope(snapshot, scope)

  const choose = (s: Scope, go = true) => {
    setScope(s)
    setOpen(false)
    if (go) navigate('/')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch client or business manager"
        className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 py-1.5 pl-2 pr-2.5 text-left transition-colors hover:border-line-strong hover:bg-surface-3 focus-ring"
      >
        {current.avatar}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight text-ink">{current.title}</span>
          <span className="block truncate text-2xs leading-tight text-ink-subtle">{current.subtitle}</span>
        </span>
        <ChevronDown className={cn('ml-1 h-4 w-4 shrink-0 text-ink-subtle transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-[min(340px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-pop animate-fade-in">
          <div className="max-h-[70vh] overflow-y-auto p-1.5">
            <button
              onClick={() => choose({ kind: 'portfolio' })}
              className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-3', scope.kind === 'portfolio' && 'bg-surface-3')}
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/15 text-brand">
                <Globe className="h-4 w-4" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium text-ink">All clients</span>
                <span className="block text-2xs text-ink-subtle">Portfolio overview · {snapshot.clients.length} clients</span>
              </span>
              {scope.kind === 'portfolio' && <Check className="h-4 w-4 text-brand" />}
            </button>

            {snapshot.businessManagers.map((bm) => {
              const clients = snapshot.clients.filter((c) => c.bmId === bm.id)
              if (!clients.length) return null
              return (
                <div key={bm.id} className="mt-1">
                  <button
                    onClick={() => choose({ kind: 'bm', bmId: bm.id })}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                  >
                    <Briefcase className="h-3 w-3 text-ink-subtle" />
                    <span className="label-eyebrow flex-1 normal-case tracking-normal">{bm.name}</span>
                    <span className={cn('rounded-full px-1.5 py-0.5 text-2xs font-medium', bm.type === 'agency' ? 'bg-brand/10 text-brand' : 'bg-info/10 text-info')}>
                      {bm.type === 'agency' ? 'Agency BM' : 'Partner BM'}
                    </span>
                  </button>
                  {clients.map((c) => {
                    const m = metricsForScope(snapshot, { kind: 'client', clientId: c.id }, range)
                    const onTarget = m.cpa > 0 && m.cpa <= c.targetCPA
                    return (
                      <button
                        key={c.id}
                        onClick={() => choose({ kind: 'client', clientId: c.id })}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-3',
                          scope.kind === 'client' && scope.clientId === c.id && 'bg-surface-3',
                        )}
                      >
                        <Avatar monogram={c.monogram} color={c.accentColor} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                          <span className="block truncate text-2xs text-ink-subtle">{c.vertical}</span>
                        </span>
                        <span className={cn('text-2xs font-semibold tabular-nums', onTarget ? 'text-success' : 'text-warning')}>
                          {m.cpa > 0 ? fmtCurrency(m.cpa, { decimals: 0 }) : '—'}
                        </span>
                        {scope.kind === 'client' && scope.clientId === c.id && <Check className="h-4 w-4 text-brand" />}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function describeScope(snapshot: ReturnType<typeof useSnapshot> & object, scope: Scope) {
  if (scope.kind === 'client') {
    const c = snapshot!.clients.find((x) => x.id === scope.clientId)
    if (c) return { title: c.name, subtitle: c.vertical, avatar: <Avatar monogram={c.monogram} color={c.accentColor} size={34} /> }
  }
  if (scope.kind === 'bm') {
    const bm = snapshot!.businessManagers.find((x) => x.id === scope.bmId)
    if (bm)
      return {
        title: bm.name,
        subtitle: bm.type === 'agency' ? 'Agency business manager' : 'Partner business manager',
        avatar: (
          <span className="grid h-[34px] w-[34px] place-items-center rounded-lg bg-info/15 text-info">
            <Briefcase className="h-4 w-4" />
          </span>
        ),
      }
  }
  return {
    title: 'All clients',
    subtitle: 'Portfolio overview',
    avatar: (
      <span className="grid h-[34px] w-[34px] place-items-center rounded-lg bg-brand-gradient text-white shadow-glow">
        <Globe className="h-4 w-4" />
      </span>
    ),
  }
}
