/* Lumen's service worker stores only same-origin, public application files. */
const CACHE_PREFIX = 'lumen-shell-'
const CACHE_NAME = `${CACHE_PREFIX}2026-07-13-1`
const BUILD_MANIFEST = '/vite-manifest.json'
const CORE_FILES = [
  '/assets/generated/forest-background.png',
  '/assets/generated/forest-decor-transparent.png',
  '/lumen-mark.svg',
  '/site.webmanifest',
]

function canCache(response) {
  return response.ok
    && response.type !== 'opaque'
    && !response.headers.get('Cache-Control')?.includes('no-store')
}

async function fetchAndStore(cache, request) {
  const response = await fetch(request)
  if (canCache(response)) await cache.put(request, response.clone())
  return response
}

async function cacheRequiredFile(cache, path) {
  const response = await fetchAndStore(cache, new Request(path))
  if (!canCache(response)) throw new Error(`Unable to prepare ${path}`)
}

async function readBuildFiles(cache) {
  const response = await fetch(BUILD_MANIFEST)
  if (!canCache(response)) throw new Error('Unable to read the Lumen build manifest')
  await cache.put(BUILD_MANIFEST, response.clone())
  const manifest = await response.json()
  return Object.values(manifest).flatMap((entry) => [
    entry.file,
    ...(entry.css ?? []),
    ...(entry.assets ?? []),
  ]).filter(Boolean).map((path) => `/${path}`)
}

async function precacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME)
  const response = await fetch('/index.html', { cache: 'reload' })
  if (!canCache(response)) throw new Error('Unable to prepare the Lumen app shell')

  const markup = await response.clone().text()
  await cache.put('/index.html', response.clone())
  const htmlFiles = [...markup.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => new URL(match[1], self.location.origin))
    .filter((url) => url.origin === self.location.origin)
    .map((url) => `${url.pathname}${url.search}`)
  const buildFiles = await readBuildFiles(cache)
  await Promise.all([...new Set([...CORE_FILES, ...htmlFiles, ...buildFiles])]
    .map((path) => cacheRequiredFile(cache, path)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheApplicationShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

async function serveNavigation(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (canCache(response)) {
      await cache.put('/index.html', response.clone())
      return response
    }
    return (await cache.match('/index.html', { ignoreVary: true })) ?? response
  } catch {
    return (await cache.match('/index.html', { ignoreVary: true })) ?? new Response(
      '<!doctype html><title>Lumen is offline</title><h1>Lumen is offline</h1><p>Reconnect once so Lumen can prepare this device.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

async function serveApplicationFile(event) {
  const cache = await caches.open(CACHE_NAME)
  // Preview/CDN responses commonly vary on Origin. The cached object is still
  // same-origin, so ignoring Vary here avoids a false miss on an offline reload.
  const cached = await cache.match(event.request, { ignoreVary: true })
  const network = fetchAndStore(cache, event.request)

  if (cached) {
    event.waitUntil(network.catch(() => undefined))
    return cached
  }
  return network
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (
    request.method !== 'GET'
    || url.origin !== self.location.origin
    || url.pathname === '/sw.js'
    || request.headers.has('Range')
  ) return

  event.respondWith(
    request.mode === 'navigate'
      ? serveNavigation(request)
      : serveApplicationFile(event),
  )
})
