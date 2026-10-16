// Installs Pixi's static CSP fallbacks; despite the package name, this does not enable eval.
import 'pixi.js/unsafe-eval'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { installLocalDiagnosticsCapture } from './platform/localDiagnostics'
import { registerLumenServiceWorker } from './platform/serviceWorker'

installLocalDiagnosticsCapture()
void registerLumenServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
