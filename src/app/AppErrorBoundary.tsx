import { Component, type ErrorInfo, type ReactNode } from 'react'

import { downloadLocalDiagnostics, recordLocalDiagnostic } from '../platform/localDiagnostics'
import './crash-shell.css'

interface AppErrorBoundaryProps {
  readonly children: ReactNode
  readonly onExport?: () => void
  readonly onReload?: () => void
}

interface AppErrorBoundaryState {
  readonly hasError: boolean
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    recordLocalDiagnostic('react.boundary', error.message, {
      componentStack: info.componentStack ?? '',
    })
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    const handleExport = this.props.onExport ?? downloadLocalDiagnostics
    const handleReload = this.props.onReload ?? (() => window.location.reload())

    return (
      <main className="crash-shell" aria-labelledby="crash-shell-title">
        <section className="crash-card">
          <div className="crash-mark" aria-hidden="true"><span /></div>
          <p className="crash-eyebrow">Lumen · local recovery</p>
          <h1 id="crash-shell-title">The forest needs a moment.</h1>
          <p>
            Lumen hit an unexpected problem. Your preferences, completed journeys,
            and latest safe checkpoint stay on this device.
          </p>
          <div className="crash-actions">
            <button type="button" className="crash-primary" onClick={handleReload}>
              Reload Lumen
            </button>
            <button type="button" className="crash-secondary" onClick={handleExport}>
              Save diagnostic file
            </button>
          </div>
          <p className="crash-privacy">
            The diagnostic is created only when you save it. Nothing is sent anywhere.
          </p>
        </section>
      </main>
    )
  }
}
