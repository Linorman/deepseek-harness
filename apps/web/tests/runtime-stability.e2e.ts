/** Real browser regressions with motion enabled; native View Transitions are observed, never mocked. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT, saveFailureShot } from './support.ts'
import { createNativeZoomContext } from './browser-native-zoom.ts'

const EVIDENCE = join(REPO_ROOT, '.tmp/web-runtime-20261007')
const SECTIONS = ['通用设置', '模型', 'Agent 预设', '插件']

interface TransitionSample {
  started: number
  ready?: number
  finished?: number
  error?: string
}

describe('web runtime stability with native motion', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    await mkdir(EVIDENCE, { recursive: true })
    scaffold = await launchWebScaffold({ tempRoot: EVIDENCE })
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await scaffold?.close()
  })

  async function openPage(): Promise<void> {
    await page?.close()
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', reducedMotion: 'no-preference' })
    tripwire = watchConsole(page)
    await page.addInitScript(() => {
      const samples: TransitionSample[] = []
      Object.assign(window, { clockyTransitionSamples: samples })
      const native = document.startViewTransition.bind(document)
      document.startViewTransition = (update) => {
        const sample: TransitionSample = { started: performance.now() }
        samples.push(sample)
        const transition = native(update)
        void transition.ready.then(() => { sample.ready = performance.now() }, (error: unknown) => { sample.error = String(error) })
        void transition.finished.then(() => { sample.finished = performance.now() }, (error: unknown) => { sample.error = String(error) })
        return transition
      }
    })
    const denials: number[] = []
    page.on('response', (response) => { if (response.status() === 401) denials.push(401) })
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl)
    await page.locator('[data-mode-card="team"]').waitFor()
    const welcome = page.locator('[class*="onboardingOverlay"]')
    if (await welcome.count() > 0) await welcome.getByRole('button').click()
    const renderer = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl')
      const debug = gl?.getExtension('WEBGL_debug_renderer_info')
      return {
        dpr: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight },
        renderer: gl === null || debug === null || debug === undefined ? 'unavailable' : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      }
    })
    await writeFile(join(EVIDENCE, 'browser-environment.json'), JSON.stringify({ browser: browser.version(), authentication: 'isolated product handoff', ...renderer }, null, 2))
    expect(denials).toEqual([])
  }

  it('finishes a Team navigation without waiting for a paused animation frame', async () => {
    await openPage()
    await page.locator('[data-mode-card="team"]').click()
    await expect.poll(async () => page.evaluate(() => {
      const samples = (window as unknown as { clockyTransitionSamples: TransitionSample[] }).clockyTransitionSamples
      return samples.length > 0 && samples.every(sample => sample.finished !== undefined)
    }), { timeout: 6000, interval: 20 }).toBe(true)
    const samples = await page.evaluate(() =>
      (window as unknown as { clockyTransitionSamples: TransitionSample[] }).clockyTransitionSamples)
    await writeFile(join(EVIDENCE, 'navigation.json'), JSON.stringify(samples, null, 2))
    expect(samples.every(sample => sample.error === undefined), JSON.stringify(samples)).toBe(true)
    expect(samples.every(sample => sample.finished! - sample.started <= 400), JSON.stringify(samples)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps 30 alternating workspace clicks and hot settings within their interaction budgets', async () => {
    await openPage()
    const navigation: number[] = [], settings: number[] = []
    await page.evaluate(() => {
      const latencies: number[] = []
      Object.assign(window, { clockyInteractionLatencies: latencies })
      document.addEventListener('click', (event) => {
        if (!event.isTrusted) return
        const started = performance.now()
        Object.assign(window, { clockyTrustedClick: started })
        const button = event.target instanceof Element ? event.target.closest('button') : null
        const label = button?.getAttribute('aria-label')
        const selector = label === '仿真' ? '#simulation-search' : label === '团队任务' ? '[data-mode-card="team"]' : undefined
        if (selector === undefined) return
        const observe = () => {
          const element = document.querySelector(selector)
          const rect = element?.getBoundingClientRect()
          const elapsed = performance.now() - started
          if (element !== null && element !== undefined && rect !== undefined && rect.width > 0 && rect.height > 0
            && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))) latencies.push(elapsed)
          else if (elapsed > 1000) latencies.push(elapsed)
          else requestAnimationFrame(observe)
        }
        requestAnimationFrame(observe)
      }, true)
    })
    for (let index = 0; index < 30; index++) {
      const simulation = index % 2 === 0
      await page.getByRole('button', { name: simulation ? '仿真' : '团队任务', exact: true }).click()
      const target = page.locator(simulation ? '#simulation-search' : '[data-mode-card="team"]')
      await expect.poll(async () => target.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
          && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }), { interval: 5, timeout: 1000 }).toBe(true)
      // Playwright's click completion can wait for visual settling. The browser
      // records the first real hit-test frame, independent of driver round trips.
      await expect.poll(() => page.evaluate(() => (window as unknown as { clockyInteractionLatencies: number[] })
        .clockyInteractionLatencies.length)).toBe(index + 1)
      navigation.push(await page.evaluate(() => (window as unknown as { clockyInteractionLatencies: number[] })
        .clockyInteractionLatencies.at(-1)!))
      await expect.poll(() => page.evaluate(() => (window as unknown as { clockyTransitionSamples: TransitionSample[] })
        .clockyTransitionSamples.every(sample => sample.finished !== undefined)), { interval: 10, timeout: 1000 }).toBe(true)
    }
    for (let index = 0; index < 30; index++) {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const close = page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭', exact: true })
      await expect.poll(() => close.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }), { interval: 5, timeout: 1000 }).toBe(true)
      settings.push(await page.evaluate(() => performance.now()
        - (window as unknown as { clockyTrustedClick: number }).clockyTrustedClick))
      await close.click()
    }
    const transitions = await page.evaluate(() => (window as unknown as {
      clockyTransitionSamples: TransitionSample[]
    }).clockyTransitionSamples)
    const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!
    await writeFile(join(EVIDENCE, 'navigation-settings-budget.json'), JSON.stringify({ navigation, settings, transitions,
      navigationP95: p95(navigation), settingsP95: p95(settings), browser: browser.version() }, null, 2))
    expect(p95(navigation)).toBeLessThanOrEqual(200)
    expect(p95(settings)).toBeLessThanOrEqual(200)
    expect(transitions.every(sample => sample.error === undefined && sample.finished! - sample.started <= 400),
      JSON.stringify(transitions)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('lets the settings categories and close control receive real pointer input', async () => {
    await openPage()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置', exact: true })
    await dialog.waitFor()
    await page.screenshot({ path: join(EVIDENCE, 'settings-current.png') })
    for (const name of SECTIONS) {
      const button = dialog.getByRole('button', { name, exact: true })
      expect(await button.count()).toBe(1)
      const hit = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      })
      if (!hit) await saveFailureShot(page, 'runtime-settings-hit-test')
      expect(hit, `${name} must receive pointer input`).toBe(true)
      await button.click({ timeout: 1500 })
      expect(await button.getAttribute('aria-current')).toBe('true')
    }
    await dialog.getByRole('button', { name: '关闭', exact: true }).click({ timeout: 1500 })
    expect(await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('navigates immediately with reduced motion or no native API and preserves browser history', async () => {
    for (const fallback of ['reduced-motion', 'no-api'] as const) {
      await openPage()
      if (fallback === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' })
      else await page.evaluate(() => { Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true }) })
      const count = await page.evaluate(() => (window as unknown as { clockyTransitionSamples: TransitionSample[] })
        .clockyTransitionSamples.length)
      await page.getByRole('button', { name: '仿真', exact: true }).click()
      await page.locator('[data-simulation-workspace-page]').waitFor()
      await page.getByRole('button', { name: '团队任务', exact: true }).click()
      await page.locator('[data-mode-card="team"]').waitFor()
      await page.goBack()
      await page.locator('[data-simulation-workspace-page]').waitFor()
      await page.goForward()
      await page.locator('[data-mode-card="team"]').waitFor()
      expect(await page.evaluate(() => (window as unknown as { clockyTransitionSamples: TransitionSample[] })
        .clockyTransitionSamples.length)).toBe(count)
      expect(tripwire.pageErrors).toEqual([])
    }
  })

  it('keeps the latest rapid native navigation and settings input operable during capture', async () => {
    await openPage()
    const client = await page.context().newCDPSession(page)
    await page.evaluate(() => {
      Object.assign(window, { clockyRapidClicks: [] })
      document.addEventListener('click', (event) => {
        (window as unknown as { clockyRapidClicks: string[] }).clockyRapidClicks.push(
          (event.target as Element).closest('button')?.getAttribute('aria-label') ?? (event.target as Element).tagName,
        )
      }, true)
    })
    for (const name of ['仿真', '团队任务', '仿真', '设置']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox()
      if (box === null) throw new Error(`Navigation control is not exposed: ${name}`)
      const position = { x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left' as const, clickCount: 1 }
      await client.send('Input.dispatchMouseEvent', { ...position, type: 'mouseMoved', buttons: 0 })
      await client.send('Input.dispatchMouseEvent', { ...position, type: 'mousePressed', buttons: 1 })
      await client.send('Input.dispatchMouseEvent', { ...position, type: 'mouseReleased', buttons: 0 })
    }
    await writeFile(join(EVIDENCE, 'navigation-rapid-clicks.json'), JSON.stringify(await page.evaluate(() => ({
      clicks: (window as unknown as { clockyRapidClicks: string[] }).clockyRapidClicks,
      transitions: (window as unknown as { clockyTransitionSamples: TransitionSample[] }).clockyTransitionSamples,
      body: document.body.innerText,
    })), null, 2))
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.waitFor()
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    await settings.getByRole('button', { name: '关闭', exact: true }).click()
    await page.locator('[data-simulation-workspace-page]').waitFor()
    await expect.poll(() => page.evaluate(() => (window as unknown as { clockyTransitionSamples: TransitionSample[] })
      .clockyTransitionSamples.every(sample => sample.finished !== undefined)), { timeout: 1000 }).toBe(true)
    const samples = await page.evaluate(() => (window as unknown as { clockyTransitionSamples: TransitionSample[] })
      .clockyTransitionSamples)
    expect(samples.some(sample => sample.error?.includes('DOM update'))).toBe(false)
    expect(tripwire.pageErrors).toEqual([])
    await writeFile(join(EVIDENCE, 'navigation-interruption.json'), JSON.stringify(samples, null, 2))
  })

  it('keeps every settings section usable across themes and viewport widths', async () => {
    await openPage()
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 })
        await page.getByRole('button', { name: '设置', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: '设置', exact: true })
        await dialog.waitFor()
        expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true)
        for (const section of SECTIONS) {
          if (width >= 720) await dialog.getByRole('button', { name: section, exact: true }).click()
          else await dialog.getByRole('combobox', { name: '设置', exact: true }).selectOption({ label: section })
          const overflow = await dialog.evaluate(element => element.scrollWidth - element.clientWidth)
          expect(overflow, `${width}px ${colorScheme} ${section} horizontal overflow`).toBeLessThanOrEqual(1)
          const close = dialog.getByRole('button', { name: '关闭', exact: true })
          expect(await close.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
          })).toBe(true)
        }
        await page.screenshot({ path: join(EVIDENCE, `settings-${colorScheme}-${width}.png`) })
        await page.keyboard.press('Escape')
        expect(await dialog.count()).toBe(0)
        expect(await page.getByRole('button', { name: '设置', exact: true }).evaluate(element => element === document.activeElement)).toBe(true)
      }
    }
    expect(tripwire.pageErrors).toEqual([])
  })

  it('contains keyboard focus and lets Escape close only the nested permission menu', async () => {
    await openPage()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置', exact: true })
    await dialog.getByRole('button', { name: 'Workspace Write' }).waitFor()
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let index = 0; index < 24; index++) {
        await page.keyboard.press(key)
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
      }
    }
    await dialog.getByRole('button', { name: 'Workspace Write' }).click()
    await page.getByRole('menuitem', { name: 'Read Only' }).waitFor()
    await page.keyboard.press('Escape')
    expect(await page.getByRole('menuitem', { name: 'Read Only' }).count()).toBe(0)
    expect(await dialog.count()).toBe(1)
    await page.keyboard.press('Escape')
    expect(await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps settings reachable at native 400 percent zoom and short heights', async () => {
    const { context, setNativeZoom } = await createNativeZoomContext(join(EVIDENCE, 'zoom'), {
      locale: 'zh-CN', viewport: { width: 1440, height: 900 },
    })
    const zoomPage = await context.newPage()
    const errors = watchConsole(zoomPage)
    try {
      await scaffold.authenticateBrowserPage(zoomPage)
      await zoomPage.goto(scaffold.baseUrl)
      await zoomPage.getByRole('button', { name: '设置', exact: true }).waitFor()
      const zoom = await setNativeZoom(zoomPage, 4)
      await writeFile(join(EVIDENCE, 'settings-native-zoom.json'), JSON.stringify(zoom, null, 2))
      await zoomPage.getByRole('button', { name: '设置', exact: true }).click()
      const dialog = zoomPage.getByRole('dialog', { name: '设置', exact: true })
      for (const section of SECTIONS) {
        await dialog.getByRole('combobox', { name: '设置', exact: true }).selectOption({ label: section })
        expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        await dialog.getByRole('button', { name: '关闭', exact: true }).click()
        await zoomPage.getByRole('button', { name: '设置', exact: true }).click()
      }
      await zoomPage.screenshot({ path: join(EVIDENCE, 'settings-native-zoom.png') })
      await zoomPage.keyboard.press('Escape')
      expect(errors.pageErrors).toEqual([])
    } finally {
      await context.close()
    }
  })
})
