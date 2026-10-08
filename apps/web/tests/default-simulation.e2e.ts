/** The shipped Web profile supplies a real template without enabling overlays or inference. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { SimulationProductCatalog, SimulationProductRequestReceipt } from '@clocky/clocky-simulation-product/types'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

it.each([false, true])('boots the default Simulation template with no enabling overlay (no models: %s)', async (noModels) => {
  const root = join(REPO_ROOT, '.tmp/web-runtime-20261007')
  await mkdir(root, { recursive: true })
  const scaffold = await launchWebScaffold({ tempRoot: root, noModels })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', reducedMotion: 'no-preference' })
  const errors = watchConsole(page)
  const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
  let allocations = 0
  const stream = scaffold.ctx.llm.stream.bind(scaffold.ctx.llm)
  let inference = 0
  scaffold.ctx.simulations.open = async (...args) => { allocations++; return open(...args) }
  scaffold.ctx.llm.stream = (...args) => { inference++; return stream(...args) }
  try {
    if (noModels) expect(scaffold.ctx.llm.listProviders()).toEqual([])
    const catalog = await scaffold.authenticatedRpc<SimulationProductCatalog>('simulation.catalog', {})
    expect(catalog.result.ok).toBe(true)
    if (!catalog.result.ok) throw new Error('Default catalog failed')
    const template = catalog.result.value.items[0]!
    expect(template.id).toBe('company-procurement-v1')
    expect(template.readiness.status).toBe(noModels ? 'needs-model' : 'ready')
    expect(allocations).toBe(0)
    expect(inference).toBe(0)
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl)
    await page.getByRole('button', { name: '仿真', exact: true }).waitFor()
    await page.locator('[data-mode-card="simulation"]').waitFor()
    await page.locator('[data-mode-card="simulation"]').click()
    await page.locator('[data-simulation-workspace-page]').waitFor()
    await page.getByRole('button', { name: '团队任务', exact: true }).click()
    await page.locator('[data-mode-card="team"]').waitFor()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    const palette = page.getByRole('combobox', { name: '命令面板' })
    await palette.fill('打开仿真')
    await page.getByRole('option').filter({ hasText: '打开仿真' }).click()
    await page.locator('[data-simulation-workspace-page]').waitFor()
    expect(allocations).toBe(0)
    expect(inference).toBe(0)
    await page.screenshot({ path: join(root, `default-simulation-${noModels ? 'no-model' : 'configured'}.png`) })
    if (!noModels && template.readiness.status === 'ready') {
      const response = await scaffold.authenticatedRpc<SimulationProductRequestReceipt>('simulation.runs.create', {
        commandId: 'default-paused', templateId: template.id, templateVersion: template.version,
        expectedModel: template.readiness.model, name: 'Default paused company',
        parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' },
      })
      expect(response.result.ok).toBe(true)
      if (!response.result.ok) throw new Error('Default creation failed')
      const runId = response.result.value.runId
      await expect.poll(async () => {
        const queried = await scaffold.authenticatedRpc<{ status: string; request?: SimulationProductRequestReceipt }>(
          'simulation.requests.get', { commandId: 'default-paused' })
        return queried.result.ok ? queried.result.value.request?.status : undefined
      }).toBe('completed')
      const observed = await scaffold.authenticatedRpc<{ world?: { phase: string; entityCount: number } }>('simulation.runs.inspect', { runId })
      expect(observed.result.ok && observed.result.value.world).toMatchObject({ phase: 'paused', entityCount: 2 })
      expect(inference).toBe(0)
    }
    expect(errors.pageErrors).toEqual([])
    await writeFile(join(root, `default-simulation-${noModels ? 'no-model' : 'configured'}.json`),
      JSON.stringify({ noModels, catalog: catalog.result.value, allocations, inference, browser: browser.version(), errors }, null, 2))
  } finally { await browser.close(); await scaffold.close() }
}, 90_000)

it('reports a missing template catalog as deployment configuration instead of an empty run directory', async () => {
  const root = join(REPO_ROOT, '.tmp/web-runtime-20261007')
  const overlay = join(root, 'empty-template-overlay.json')
  await writeFile(overlay, JSON.stringify([{ id: 'web-simulation-administration',
    config: { journalStream: 'web-simulation-commands-v1', templates: [] } }]))
  const scaffold = await launchWebScaffold({ tempRoot: root, noModels: true, extraOverlayPath: overlay })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(`${scaffold.baseUrl}/?workspace=simulation`)
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('alert').getByText('此主机未安装仿真模板，请检查部署配置。', { exact: true }).waitFor()
    expect(await workspace.getByText('还没有仿真运行。新建一个暂停的运行即可开始。', { exact: true }).count()).toBe(0)
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(root, 'default-simulation-missing-templates.png') })
  } finally { await browser.close(); await scaffold.close() }
}, 90_000)

it('keeps Team usable and explains saved Simulation links when the published group is disabled', async () => {
  const root = join(REPO_ROOT, '.tmp/web-runtime-20261007')
  const scaffold = await launchWebScaffold({ tempRoot: root, disableDefaultSimulation: true, noModels: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  try {
    expect(scaffold.ctx.simulationProducts).toBeUndefined()
    await scaffold.authenticateBrowserPage(page)
    await page.goto(`${scaffold.baseUrl}/?workspace=simulation&simulation=saved-run`)
    await page.getByRole('region', { name: '此主机未提供仿真查看。' }).waitFor()
    expect(await page.getByRole('button', { name: '仿真', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: '返回团队', exact: true }).click()
    await page.locator('[data-mode-card="team"]').waitFor()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(root, 'default-simulation-disabled.png') })
  } finally { await browser.close(); await scaffold.close() }
}, 90_000)
