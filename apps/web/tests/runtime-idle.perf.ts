/** Observational idle/retention benchmark; renderer provenance accompanies every sample. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

it('records idle work and retained listeners after repeated settings lifetimes', async () => {
  const root = join(REPO_ROOT, '.tmp/web-runtime-20261007')
  await mkdir(root, { recursive: true })
  const scaffold = await launchWebScaffold({ tempRoot: root })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', reducedMotion: 'no-preference' })
  const errors = watchConsole(page)
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl)
    await page.locator('[data-mode-card="team"]').waitFor()
    const welcome = page.locator('[class*="onboardingOverlay"]')
    if (await welcome.count() > 0) await welcome.getByRole('button').click()
    const client = await page.context().newCDPSession(page)
    await client.send('Performance.enable')
    await page.waitForTimeout(3000)
    const facts = await page.evaluate(() => {
      const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl')
      const debug = gl?.getExtension('WEBGL_debug_renderer_info')
      return { viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
        renderer: gl === null || debug === null || debug === undefined ? 'unavailable' : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) }
    })
    const metrics = async () => {
      const result = await client.send('Performance.getMetrics')
      return Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]))
    }
    const animations = async () => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running')
      .map(animation => ({ name: 'animationName' in animation ? String(animation.animationName) : 'WAAPI',
        iterations: animation.effect?.getTiming().iterations })))
    const before = await metrics(), idleAnimationsBefore = await animations()
    await page.waitForTimeout(30_000)
    const after = await metrics(), idleAnimationsAfter = await animations()
    const delta = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount']
      .map(name => [name, (after[name] ?? 0) - (before[name] ?? 0)]))
    const trigger = page.getByRole('button', { name: '设置', exact: true })
    const cycle = async () => {
      await trigger.click()
      await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
    }
    await cycle()
    await client.send('HeapProfiler.collectGarbage')
    const warm = await client.send('Memory.getDOMCounters')
    for (let index = 0; index < 100; index++) await cycle()
    await client.send('HeapProfiler.collectGarbage')
    const retained = await client.send('Memory.getDOMCounters')
    const result = { browser: browser.version(), ...facts, idleSeconds: 30, delta, idleAnimationsBefore, idleAnimationsAfter,
      warm, retained, finalMetrics: await metrics(), errors }
    const phase = process.env.CLOCKY_RUNTIME_SAMPLE_PHASE ?? 'current'
    if (!/^[a-z-]+$/.test(phase)) throw new Error('Invalid runtime sample phase')
    await writeFile(join(root, `idle-${phase}.json`), JSON.stringify(result, null, 2))
    expect(errors.pageErrors).toEqual([])
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 180_000)
