/** Native Chromium tab zoom in an isolated test-owned profile; CSS zoom and DPR emulation are not used. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { BrowserContext, Page } from 'playwright'

interface ChromeTabs {
  query(query: Record<string, never>): Promise<Array<{ id?: number; url?: string }>>
  setZoom(id: number, factor: number): Promise<void>
  getZoom(id: number): Promise<number>
}
/** Actual browser-reported zoom and the resulting CSS viewport, suitable for durable screenshot provenance. */
export interface NativeZoomEvidence {
  readonly factor: number
  readonly width: number
  readonly height: number
  readonly devicePixelRatio: number
}
/**
 * Launch an isolated Chromium profile with a test-only native tab-zoom extension.
 * @param root - Test-owned artifact directory; profile and extension remain inside the repository.
 * @param options - The same locale and physical viewport used by the caller's real Host workflow.
 * @returns owned browser context and native zoom controller; close context when the caller's scenario finishes.
 */
export async function createNativeZoomContext(root: string, options: {
  locale: string
  viewport: { width: number; height: number }
}): Promise<{ context: BrowserContext; setNativeZoom: (page: Page, factor: 1 | 2 | 4) => Promise<NativeZoomEvidence> }> {
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'native-zoom-'))
  const extension = join(directory, 'extension')
  await mkdir(extension)
  await writeFile(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3,
    name: 'Native browser acceptance zoom', version: '1.0', permissions: ['tabs'], background: { service_worker: 'worker.js' } }))
  await writeFile(join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});\n')
  await writeFile(join(extension, 'controller.html'), '<!doctype html><title>Native zoom controller</title>\n')
  const context = await chromium.launchPersistentContext(join(directory, 'profile'), { ...options, channel: 'chromium',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 })
    // MV3 may stop its worker without removing Playwright's Worker object. A
    // context-owned extension document keeps the tabs API execution realm live.
    const controller = await context.newPage()
    await controller.goto(new URL('controller.html', worker.url()).href)
    return { context, async setNativeZoom(page, factor) {
      const url = page.url()
      const actual = await controller.evaluate(async ({ url, factor }) => {
        const tabs = (globalThis as unknown as { chrome: { tabs: ChromeTabs } }).chrome.tabs
        const selected = (await tabs.query({})).find(tab => tab.url === url)
        if (selected?.id === undefined) throw new Error('Native zoom target is not the selected acceptance page')
        await tabs.setZoom(selected.id, factor)
        return await tabs.getZoom(selected.id)
      }, { url, factor })
      if (Math.abs(actual - factor) > Number.EPSILON * factor) throw new Error(`Chromium zoom: requested ${factor}, observed ${actual}`)
      const viewport = page.viewportSize()
      if (viewport === null) throw new Error('Native zoom acceptance requires a known physical viewport')
      await page.waitForFunction(({ width, factor }) => Math.abs(window.innerWidth - width / factor) <= 1,
        { width: viewport.width, factor })
      return { factor: actual, ...await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio })) }
    } }
  } catch (cause: unknown) { await context.close(); throw cause }
}
