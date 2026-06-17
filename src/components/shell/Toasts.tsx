import { CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useStore } from '../../app/store'

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
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.kind]
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface-3/95 p-3 shadow-pop backdrop-blur animate-fade-in"
          >
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE[t.kind])} />
            <span className="flex-1 text-sm text-ink">{t.message}</span>
            <button onClick={() => remove(t.id)} className="text-ink-subtle hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
