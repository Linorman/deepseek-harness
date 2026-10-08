/** Compare the shipped group with its explicit disable on one renderer and an empty, model-free installation. */
import { mkdir, writeFile } from 'node:fs/promises'
import { loadavg } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

it('records thirty isolated boots and idle cost for the default Simulation group', async () => {
  const root = join(REPO_ROOT, '.tmp/web-runtime-20261007')
  await mkdir(root, { recursive: true })
  const renderer = process.env.CLOCKY_RUNTIME_RENDERER ?? 'software'
  if (renderer !== 'software' && renderer !== 'metal') throw new Error('Unsupported measurement renderer')
  const browser = await chromium.launch({ args: renderer === 'metal' ? ['--use-gl=angle', '--use-angle=metal'] : [] })
  const summaries: unknown[] = []
  const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
  const environment = { browser: browser.version(), rendererRequested: renderer, hostLoad: loadavg(), hardware: process.arch }
  try {
    for (const disabled of [true, false]) {
      const samples: Array<{ hostMs: number; usableMs: number; encodedBytes: number }> = []
      for (let index = 0; index < 30; index++) {
        const started = performance.now()
        const scaffold = await launchWebScaffold({ tempRoot: root, noModels: true, disableDefaultSimulation: disabled })
        const hostMs = performance.now() - started
        const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
        const errors = watchConsole(page)
        const client = await page.context().newCDPSession(page)
        let encodedBytes = 0
        await client.send('Network.enable')
        await client.send('Network.setCacheDisabled', { cacheDisabled: true })
        client.on('Network.loadingFinished', (event) => { encodedBytes += event.encodedDataLength })
        try {
          await scaffold.authenticateBrowserPage(page)
          const navigation = performance.now()
          await page.goto(scaffold.baseUrl)
          const tile = page.locator('[data-mode-card="team"]')
          await tile.waitFor()
          await expect.poll(() => tile.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
          })).toBe(true)
          samples.push({ hostMs, usableMs: performance.now() - navigation, encodedBytes })
          if (index === 29) {
            await client.send('Performance.enable')
            await page.waitForTimeout(3000)
            await client.send('HeapProfiler.collectGarbage')
            const facts = await page.evaluate(() => {
              const gl = document.createElement('canvas').getContext('webgl')
              const debug = gl?.getExtension('WEBGL_debug_renderer_info')
              return { dpr: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight },
                renderer: gl === null || debug === undefined || debug === null ? 'unavailable'
                  : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
                animations: document.getAnimations().filter(animation => animation.playState === 'running').length }
            })
            const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics
              .map(({ name, value }) => [name, value]))
            const before = await metrics()
            await page.waitForTimeout(30_000)
            const after = await metrics()
            const delta = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration',
              'LayoutCount', 'RecalcStyleCount'].map(name => [name, (after[name] ?? 0) - (before[name] ?? 0)]))
            const heap = await client.send('Memory.getDOMCounters')
            summaries.push({ disabled, samples, hostP95Ms: p95(samples.map(sample => sample.hostMs)),
              usableP95Ms: p95(samples.map(sample => sample.usableMs)), bytesP95: p95(samples.map(sample => sample.encodedBytes)),
              facts, delta, heap, jsHeapUsed: after['JSHeapUsedSize'], hostLoad: loadavg() })
            expect(facts.animations).toBe(0)
            expect(delta['LayoutCount']).toBe(0)
          }
          expect(errors.pageErrors).toEqual([])
        } finally { await page.close(); await scaffold.close() }
      }
    }
    await writeFile(join(root, `runtime-default-${renderer}.json`), JSON.stringify({ environment, summaries }, null, 2))
  } finally { await browser.close() }
}, 600_000)
