import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('opens the research disclosure and first-run setup', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /notice more/i })).toBeVisible()
  await page.getByRole('button', { name: /read the research/i }).click()
  await expect(page.getByRole('dialog', { name: /research behind lumen/i })).toContainText('preliminary')
  await page.getByRole('button', { name: /i understand/i }).click()
  await page.getByRole('button', { name: /play a journey/i }).click()
  await expect(page.getByRole('heading', { name: /make lumen comfortable/i })).toBeVisible()
})

test('completes four practice trials and a 24-trial adaptive journey', async ({ page }) => {
  test.setTimeout(45_000)
  await page.goto('/')
  await page.getByRole('button', { name: /play a journey/i }).click()
  await page.getByRole('button', { name: /begin practice/i }).click()

  for (let index = 0; index < 4; index += 1) {
    await page.locator('.glyph-choices button').first().click()
    await page.getByRole('button', { name: 'North', exact: true }).click()
    await page.getByRole('button', { name: index === 3 ? /begin full journey/i : /next practice/i }).click()
  }

  for (let index = 0; index < 24; index += 1) {
    await page.locator('.glyph-choices button').first().click()
    await page.getByRole('button', { name: 'North', exact: true }).click()
    await page.getByRole('button', { name: index === 23 ? /see results/i : /next glimpse/i }).click()
  }

  await expect(page.getByRole('heading', { name: /journey complete/i })).toBeVisible()
  await expect(page.getByText(/not a medical assessment/i)).toBeVisible()
})

test('persists the complete settings surface after reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /settings/i }).click()
  await page.getByLabel(/reduced motion/i).check()
  await page.getByLabel(/graphics quality/i).selectOption('low')
  await page.getByRole('slider', { name: /master/i }).fill('55')
  await page.reload()
  await page.getByRole('button', { name: /settings/i }).click()
  await expect(page.getByLabel(/reduced motion/i)).toBeChecked()
  await expect(page.getByLabel(/graphics quality/i)).toHaveValue('low')
  await expect(page.getByRole('slider', { name: /master/i })).toHaveValue('55')
})

test('keeps utility views available but gates scored play on a small display', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 650 })
  await page.goto('/')
  await page.getByRole('button', { name: /play a journey/i }).click()
  await page.getByRole('button', { name: /begin practice/i }).click()
  await expect(page.getByRole('heading', { name: /open lumen on a larger display/i })).toBeVisible()
  await page.getByRole('button', { name: /settings/i }).click()
  await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible()
})

test('has no automatically detectable WCAG A or AA violations on core shell views', async ({ page }) => {
  await page.goto('/')
  const landing = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(landing.violations).toEqual([])
  await page.getByRole('button', { name: /settings/i }).click()
  const settings = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(settings.violations).toEqual([])
})

test('plays the main game with arrow keys and Space', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /play a journey/i }).click()
  await page.getByRole('button', { name: /begin practice/i }).click()

  await expect(page.locator('.game-frame')).toHaveAttribute('data-phase', 'identify')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.glyph-choices button').nth(1)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /^resume$/i })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.locator('.game-frame')).toHaveAttribute('data-phase', 'identify')
  await expect(page.locator('.glyph-choices button').nth(1)).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.locator('.game-frame')).toHaveAttribute('data-phase', 'locate')
  const gameplay = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(gameplay.violations).toEqual([])
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  await expect(page.getByText(/response recorded/i)).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.locator('.game-frame')).toHaveAttribute('data-phase', 'stimulus')
})

test('continues with vector scenery when generated images fail', async ({ page }) => {
  await page.route('**/assets/generated/*', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /play a journey/i }).click()
  await expect(page.getByRole('status')).toContainText('simplified vector scenery')
  await expect(page.getByRole('button', { name: /begin practice/i })).toBeEnabled()
  await page.getByRole('button', { name: /begin practice/i }).click()
  await expect(page.locator('.game-frame')).toHaveAttribute('data-phase', 'identify')
  await expect(page.locator('.app')).toHaveClass(/asset-degraded/)
})

test('resumes the exact journey from a durable inter-trial checkpoint', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /play a journey/i }).click()
  await page.getByRole('button', { name: /begin practice/i }).click()

  for (let index = 0; index < 4; index += 1) {
    await page.locator('.glyph-choices button').first().click()
    await page.getByRole('button', { name: 'North', exact: true }).click()
    await page.getByRole('button', { name: index === 3 ? /begin full journey/i : /next practice/i }).click()
  }

  await page.locator('.glyph-choices button').first().click()
  await page.getByRole('button', { name: 'North', exact: true }).click()
  await expect(page.getByRole('button', { name: /next glimpse/i })).toBeEnabled()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: /resume saved journey/i })).toBeVisible()
  await page.getByRole('button', { name: /resume saved journey/i }).click()
  await expect(page.locator('.game-frame')).toHaveAttribute('data-phase', 'identify')
  await expect(page.locator('.game-hud')).toContainText('02 / 24')
})

test('recreates the renderer from the same safe trial after WebGL context loss', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'WEBGL_lose_context recovery is verified in Chromium')
  await page.goto('/')
  await page.getByRole('button', { name: /play a journey/i }).click()
  await page.getByRole('button', { name: /begin practice/i }).click()
  await expect(page.locator('.game-frame')).toHaveAttribute('data-phase', 'identify')
  const supported = await page.locator('.lumen-canvas canvas').evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2') ?? (canvas as HTMLCanvasElement).getContext('webgl')
    const extension = gl?.getExtension('WEBGL_lose_context')
    extension?.loseContext()
    return Boolean(extension)
  })
  expect(supported).toBe(true)
  await expect(page.getByRole('button', { name: /retry safely/i })).toBeVisible()
  await page.getByRole('button', { name: /retry safely/i }).click()
  await expect(page.locator('.game-frame')).toHaveAttribute('data-phase', 'identify')
  await expect(page.locator('.lumen-canvas')).toHaveAttribute('data-renderer', 'ready')
})

test('reloads the installed web app after the network goes offline', async ({ browserName, context, page }) => {
  test.skip(browserName !== 'chromium', 'Offline emulation is verified in Chromium')

  await page.goto('/')
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable')
    await navigator.serviceWorker.ready
  })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const mainScriptPath = await page.locator('script[type="module"]').getAttribute('src')
  if (!mainScriptPath) throw new Error('The production entry script is missing')
  const buildPaths = await page.evaluate(async () => {
    const response = await fetch('/vite-manifest.json')
    if (!response.ok) throw new Error('The production build manifest is missing')
    const manifest = await response.json() as Record<string, {
      file?: string
      css?: string[]
      assets?: string[]
    }>
    return Object.values(manifest).flatMap((entry) => [
      entry.file,
      ...(entry.css ?? []),
      ...(entry.assets ?? []),
    ]).filter((path): path is string => Boolean(path)).map((path) => `/${path}`)
  })
  const cachedPaths = await page.evaluate(async () => {
    const names = await caches.keys()
    const requests = (await Promise.all(names.map(async (name) => {
      const cache = await caches.open(name)
      return cache.keys()
    }))).flat()
    return requests.map((request) => new URL(request.url).pathname)
  })
  expect(cachedPaths).toEqual(expect.arrayContaining([
    mainScriptPath,
    ...buildPaths,
    '/assets/generated/forest-background.png',
    '/assets/generated/forest-decor-transparent.png',
  ]))

  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /notice more/i })).toBeVisible()
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/site.webmanifest')
    await page.getByRole('button', { name: /play a journey/i }).click()
    await page.getByRole('button', { name: /begin practice/i }).click()
    await expect(page.locator('.game-frame')).toHaveAttribute('data-phase', 'identify')
  } finally {
    await context.setOffline(false)
  }
})
