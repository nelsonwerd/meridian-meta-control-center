import { useEffect, useState } from 'react'
import { CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useStore, type Toast } from '../../app/store'

const ICON = { success: CheckCircle2, info: Info, error: XCircle }
const TONE = {
  success: 'text-success',
  info: 'text-info',
  error: 'text-danger',
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const remove = useStore((s) => s.removeToast)
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} remove={remove} />
      ))}
    </div>
  )
}

function ToastItem({ t, remove }: { t: Toast; remove: (id: string) => void }) {
  const [paused, setPaused] = useState(false)
  const Icon = ICON[t.kind]
  // Action toasts (with Undo) linger longer. WCAG 2.2.1: pause on hover/focus so the
  // user can read/act; the timer is tied to lifecycle and cleared on unmount.
  const duration = t.action ? 7000 : 4200
  useEffect(() => {
    if (paused) return
    const h = setTimeout(() => remove(t.id), duration)
    return () => clearTimeout(h)
  }, [paused, duration, remove, t.id])

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface-3/95 p-3 shadow-pop backdrop-blur animate-fade-in"
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE[t.kind])} />
      <span className="flex-1 text-sm text-ink">{t.message}</span>
      {t.action && (
        <button
          onClick={() => {
            t.action!.onClick()
            remove(t.id)
          }}
          className="shrink-0 rounded-md bg-surface px-2 py-0.5 text-xs font-semibold text-brand ring-1 ring-inset ring-brand/30 hover:bg-brand/10"
        >
          {t.action.label}
        </button>
      )}
      <button aria-label="Dismiss notification" onClick={() => remove(t.id)} className="text-ink-subtle hover:text-ink">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
