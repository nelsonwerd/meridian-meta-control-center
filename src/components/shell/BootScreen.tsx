import { AlertTriangle } from 'lucide-react'
import { setProviderMode } from '../../lib/provider'

export function BootScreen({ error }: { error?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-5">
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-brand-gradient shadow-glow" />
          <div className="absolute inset-0 animate-ping rounded-2xl bg-brand/20" style={{ animationDuration: '2.4s' }} />
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold tracking-tight text-ink">Meridian</div>
          {error ? (
            <div className="mt-2 max-w-sm">
              <div className="flex items-center justify-center gap-1.5 text-sm text-danger">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="text-left">{error}</span>
              </div>
              <button
                onClick={() => {
                  setProviderMode('demo')
                  location.reload()
                }}
                className="btn-outline mx-auto mt-4 py-1.5 text-xs"
              >
                Return to demo mode
              </button>
            </div>
          ) : (
            <div className="mt-1 text-sm text-ink-muted">Assembling your command center…</div>
          )}
        </div>
        {!error && (
          <div className="h-1 w-40 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full w-1/2 animate-shimmer rounded-full bg-brand-gradient" />
          </div>
        )}
      </div>
    </div>
  )
}
