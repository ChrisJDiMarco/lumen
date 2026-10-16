export type LocalDiagnosticKind =
  | 'react.boundary'
  | 'runtime.error'
  | 'runtime.unhandledrejection'
  | 'service-worker.registration'

export interface LocalDiagnosticEntry {
  readonly kind: LocalDiagnosticKind
  readonly timestamp: string
  readonly message: string
  readonly context: Readonly<Record<string, string | number | boolean>>
}

export interface LocalDiagnosticsReport {
  readonly product: 'Lumen'
  readonly generatedAt: string
  readonly page: string
  readonly userAgent: string
  readonly entries: readonly LocalDiagnosticEntry[]
}

interface DiagnosticsEnvironment {
  readonly href: string
  readonly userAgent: string
}

const MAX_ENTRIES = 50
const MAX_MESSAGE_LENGTH = 600
const MAX_CONTEXT_LENGTH = 2_000
const entries: LocalDiagnosticEntry[] = []

function oneLine(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function safePageUrl(value: string): string {
  try {
    const parsed = new URL(value, globalThis.location?.href)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function safeSource(value: string): string {
  try {
    const parsed = new URL(value, globalThis.location?.href)
    return parsed.pathname
  } catch {
    return ''
  }
}

function normalizeContext(
  context: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean>> {
  const normalized: Record<string, string | number | boolean> = {}
  Object.entries(context).forEach(([key, value]) => {
    if (value === undefined || value === null) return
    if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value
      return
    }
    const serialized = typeof value === 'string' ? value : String(value)
    if (key.toLowerCase().includes('source') || key.toLowerCase().includes('url')) {
      normalized[key] = safeSource(serialized)
      return
    }
    normalized[key] = serialized.trim().slice(0, MAX_CONTEXT_LENGTH)
  })
  return normalized
}

function reasonMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  try {
    return JSON.stringify(reason)
  } catch {
    return 'Unknown rejected promise'
  }
}

export function recordLocalDiagnostic(
  kind: LocalDiagnosticKind,
  message: string,
  context: Readonly<Record<string, unknown>> = {},
): void {
  entries.push({
    kind,
    timestamp: new Date().toISOString(),
    message: oneLine(message || 'Unknown error', MAX_MESSAGE_LENGTH),
    context: normalizeContext(context),
  })
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
}

export function getLocalDiagnostics(): readonly LocalDiagnosticEntry[] {
  return entries.map((entry) => ({ ...entry, context: { ...entry.context } }))
}

export function clearLocalDiagnostics(): void {
  entries.length = 0
}

export function installLocalDiagnosticsCapture(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const onError = (event: Event) => {
    const errorEvent = event as ErrorEvent
    recordLocalDiagnostic('runtime.error', errorEvent.message || 'Uncaught runtime error', {
      source: errorEvent.filename,
      line: errorEvent.lineno,
      column: errorEvent.colno,
    })
  }
  const onUnhandledRejection = (event: Event) => {
    const rejectionEvent = event as PromiseRejectionEvent
    recordLocalDiagnostic(
      'runtime.unhandledrejection',
      reasonMessage(rejectionEvent.reason),
    )
  }

  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onUnhandledRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}

export function buildLocalDiagnosticsReport(
  environment: DiagnosticsEnvironment = {
    href: globalThis.location?.href ?? '',
    userAgent: globalThis.navigator?.userAgent ?? '',
  },
): LocalDiagnosticsReport {
  return {
    product: 'Lumen',
    generatedAt: new Date().toISOString(),
    page: safePageUrl(environment.href),
    userAgent: oneLine(environment.userAgent, MAX_CONTEXT_LENGTH),
    entries: getLocalDiagnostics(),
  }
}

export function downloadLocalDiagnostics(): void {
  const report = buildLocalDiagnosticsReport()
  const payload = JSON.stringify(report, null, 2)
  const blob = new Blob([payload], { type: 'application/json' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `lumen-diagnostics-${report.generatedAt.replace(/[:.]/g, '-')}.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
