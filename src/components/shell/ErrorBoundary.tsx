import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Class-based error boundary — a render throw in one screen degrades to this
 *  recoverable panel instead of white-screening the whole cockpit. Reset it by
 *  navigating (AppShell keys it on pathname) or the "Try again" button. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[meridian] panel error boundary caught:', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="card max-w-md p-6 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-danger/10 text-danger">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h2 className="text-base font-semibold text-ink">This panel hit an error</h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            The rest of Meridian is fine — only this view failed to render. The error has been logged.
          </p>
          <pre className="mt-3 max-h-28 overflow-auto rounded-lg border border-line bg-surface-2 p-2 text-left text-2xs text-ink-subtle">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button onClick={this.reset} className="btn-outline py-1.5 text-xs">
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </button>
            <button onClick={() => location.assign(location.origin + '/')} className="btn-primary py-1.5 text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Back to overview
            </button>
          </div>
        </div>
      </div>
    )
  }
}
