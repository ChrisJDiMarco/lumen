import { recordLocalDiagnostic } from './localDiagnostics'

interface ServiceWorkerLocation {
  readonly protocol: string
}

interface ServiceWorkerRegistrar {
  register(scriptURL: string, options?: RegistrationOptions): Promise<unknown>
}

interface RegisterLumenServiceWorkerOptions {
  readonly enabled?: boolean
  readonly location?: ServiceWorkerLocation
  readonly serviceWorker?: ServiceWorkerRegistrar
}

export function supportsLumenServiceWorker(
  protocol: string,
  enabled: boolean,
  hasServiceWorker: boolean,
): boolean {
  return enabled && hasServiceWorker && (protocol === 'http:' || protocol === 'https:')
}

export async function registerLumenServiceWorker(
  options: RegisterLumenServiceWorkerOptions = {},
): Promise<void> {
  const enabled = options.enabled ?? import.meta.env.PROD
  const pageLocation = options.location ?? globalThis.location
  const serviceWorker = options.serviceWorker ?? globalThis.navigator?.serviceWorker

  if (!supportsLumenServiceWorker(pageLocation.protocol, enabled, Boolean(serviceWorker))) return

  try {
    await serviceWorker?.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
  } catch (error) {
    recordLocalDiagnostic(
      'service-worker.registration',
      error instanceof Error ? error.message : 'Service worker registration failed',
    )
  }
}
