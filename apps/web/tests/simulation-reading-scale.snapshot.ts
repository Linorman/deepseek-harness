/** Real bounded reads keep collection DOM and request fan-out independent of total entity count. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { simulationChangeSchema, simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it('keeps a tenfold larger world bounded to one page with no per-row inspect reads', async () => {
  const root = join(process.cwd(), '.tmp-webui-improvement/reading-scale')
  await mkdir(root, { recursive: true })
  const evidence: { total: number; rows: number; nodes: number; collections: number; inspect: number; elapsedMs: number }[] = []
  for (const total of [20, 200]) {
    const directory = await mkdtemp(join(root, `world-${total}-`))
    const config = JSON.parse(await readFile('examples/headless-agent/tests/fixtures/simulation/simulation-web/cordis.yml', 'utf8')) as {
      id?: string
      config?: Record<string, unknown>
      insert?: { name: string; config?: Record<string, unknown> }[] }[]
    const entries = config[0]!.insert!
    const local = entries.find(entry => entry.name === '@clocky/clocky-simulation-local')!
    local.config = { ...local.config, root: join(directory, 'world'), backend: 'sqlite' }
    const product = entries.find(entry => entry.name === '@clocky/clocky-simulation-product')!
    product.config = { ...product.config, maxPageSize: 16 }
    const imported = (product.config.imports as { id: string; spec: unknown }[])[0]!
    const spec = simulationRunSpecSchema.parse(imported.spec)
    const ui = entries.find(entry => entry.name === '@clocky/clocky-client-ui-simulation')!
    ui.config = { ...ui.config, pageSize: 16 }
    config.find(entry => entry.id === 'modules')!.config = { browserConfig: {
      '@clocky/clocky-client-ui-simulation': { pageSize: 16 },
    } }
    const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(config))
    const scaffold = await launchWebScaffold({ tempRoot: directory, disableDefaultSimulation: true, extraOverlayPath: overlay, productPrincipalId: 'simulation-browser-user' })
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    const errors = watchConsole(page)
    let run: SimulationRun | undefined, collections = 0, inspect = 0
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path === '/api/simulation.collections.list') collections++
      if (path === '/api/simulation.objects.inspect') inspect++
    })
    try {
      run = await scaffold.ctx.simulations.open(scaffold.ctx.simulations.resolve({ provider: 'local', spec, mode: 'create' }))
      for (let index = 0; index < total; index++) {
        await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: `entity-${String(index).padStart(3, '0')}`,
          entityKind: 'org', cognition: 'none', profile: { name: `Entity ${String(index).padStart(3, '0')}` } }), run.snapshot().revision)
      }
      const before = run.snapshot()
      await scaffold.authenticateBrowserPage(page)
      const started = performance.now()
      await page.goto(`${scaffold.baseUrl}/?workspace=simulation&simulation=${imported.id}&simulationModule=entities`)
      const workspace = page.locator('[data-simulation-workspace-page]'), table = workspace.getByRole('table')
      await expect.poll(() => table.locator('tbody tr').count()).toBe(16)
      const size = await table.evaluate(element => ({ rows: element.querySelectorAll('tbody tr').length, nodes: element.querySelectorAll('*').length }))
      evidence.push({ total, ...size, collections, inspect, elapsedMs: Math.round(performance.now() - started) })
      expect(collections).toBe(1); expect(inspect).toBe(0)
      const first = await table.innerText()
      await workspace.getByRole('button', { name: '下一页', exact: true }).click()
      await expect.poll(() => table.innerText()).not.toBe(first)
      expect(await table.locator('tbody tr').count()).toBe(Math.min(16, total - 16))
      expect(collections).toBe(2); expect(inspect).toBe(0)
      for (let cycle = 0; cycle < 3; cycle++) {
        const navigation = workspace.getByRole('navigation', { name: '仿真模块' })
        await navigation.getByRole('button', { name: '概览', exact: true }).click()
        await navigation.getByRole('button', { name: '实体', exact: true }).click()
        await expect.poll(() => table.locator('tbody tr').count()).toBe(16)
      }
      expect(collections).toBe(5); expect(inspect).toBe(0)
      expect(run.snapshot()).toEqual(before)
      expect(errors.pageErrors).toEqual([])
      await page.screenshot({ path: join(root, `entities-${total}.png`) })
    } finally { await browser.close(); await run?.close(); await scaffold.close() }
  }
  expect(evidence[1]!.nodes).toBe(evidence[0]!.nodes)
  await writeFile(join(root, 'measurements.json'), JSON.stringify({ pageSize: 16, inference: false,
    evidence, conclusion: 'Tenfold world size keeps the same rendered page and one list read per navigation, without row inspect requests.' }, null, 2) + '\n')
}, 180000)
