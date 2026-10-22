/** Real Host commits must reach an already open browser without manual refresh or another writer. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { simulationChangeSchema, simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it('updates a visible entity list after native commits without reloading the document', async () => {
  const root = join(process.cwd(), '.tmp/simulation-live-refresh')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'run-'))
  const overlay = JSON.parse(await readFile('examples/headless-agent/tests/fixtures/simulation/simulation-web/cordis.yml', 'utf8')) as {
    insert: { name: string; config?: Record<string, unknown> }[] }[]
  const entries = overlay[0]!.insert
  const local = entries.find(entry => entry.name === '@clocky/clocky-simulation-local')!
  local.config = { ...local.config, root: join(directory, 'world'), backend: 'sqlite' }
  const product = entries.find(entry => entry.name === '@clocky/clocky-simulation-product')!
  const imported = (product.config!.imports as { id: string; spec: unknown }[])[0]!
  const spec = simulationRunSpecSchema.parse(imported.spec)
  const configured = join(directory, 'overlay.json')
  await writeFile(configured, JSON.stringify(overlay))
  const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: configured,
    tempRoot: directory, productPrincipalId: 'simulation-browser-user' })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  let run: SimulationRun | undefined, documents = 0
  page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++ })
  try {
    run = await scaffold.ctx.simulations.open(scaffold.ctx.simulations.resolve({ provider: 'local', spec, mode: 'create' }))
    const create = async (id: string) => {
      await run!.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id, entityKind: 'org',
        cognition: 'none', profile: { name: id } }), run!.snapshot().revision)
    }
    await create('before-live-update')
    await scaffold.authenticateBrowserPage(page)
    const observation = page.waitForResponse(response => new URL(response.url()).pathname === '/api/simulation.changes.watch' && response.ok())
    await page.goto(`${scaffold.baseUrl}/?workspace=simulation&simulation=${imported.id}&simulationModule=entities`)
    const workspace = page.locator('[data-simulation-workspace-page]')
    const table = workspace.getByRole('table')
    await expect.poll(() => table.innerText()).toContain('before-live-update')
    expect(new URL(page.url()).searchParams.get('simulation')).toBe(imported.id)
    expect(await page.title()).toContain('Clocky')
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    await observation
    const navigations = documents
    await create('arrived-without-refresh')
    const committed = run.snapshot()
    await expect.poll(() => table.innerText(), { timeout: 30000 }).toContain('arrived-without-refresh')
    expect(documents).toBe(navigations)
    expect(run.snapshot()).toEqual(committed)
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(root, 'live-entities.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await create('aaa-mobile-live-update')
    await expect.poll(() => table.innerText(), { timeout: 30000 }).toContain('aaa-mobile-live-update')
    await page.screenshot({ path: join(root, 'live-entities-mobile.png') })
    expect(documents).toBe(navigations)
    expect(errors.pageErrors).toEqual([])
    expect(errors.warnings).toEqual([])
  } finally { await browser.close(); await run?.close(); await scaffold.close() }
})
