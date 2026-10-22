/** Browser retains the exact original World creation after a real response deadline and never starts it on query or reload. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { scenarioCatalogSchema, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationProductCommandId } from '@clocky/clocky-simulation-product/types'
import type {} from '../../../examples/simulation-company/tests/world-driver-model.ts'

it.each((['json', 'sqlite'] as const).flatMap(backend => (['company', 'laboratory'] as const).map(scenario => ({ backend, scenario }))))(
  'queries $backend $scenario original paused creation after a real timeout', async ({ backend, scenario }) => {
    const parent = resolve('.local/world-director-mvp/browser', `${backend}-${scenario}-create-timeout`)
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(join(parent, 'world-'))
    // Runtime URL imports preserve the real Loader module instance without crossing compiler output layouts.
    const metadata: unknown = await import(pathToFileURL(resolve('packages/simulation/simulation-scenario/tests/fixtures.ts')).href)
    const factory = z.object({ catalog: z.custom<() => unknown>(value => typeof value === 'function') }).parse(metadata)
    const installed = scenarioCatalogSchema.parse(factory.catalog())
    installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
    const overlays = [{ insert: [
      { name: '@clocky/clocky-simulation' },
      { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
      { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
        maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
      { name: '@clocky/clocky-tool-simulation' },
      { name: resolve('examples/simulation-company/tests/world-driver-model.ts') },
      { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'world-browser-directory', imports: [] } },
      { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'world-browser-commands', templates: [],
        world: { provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } },
        driverIntervalMs: 5, driverRetryMs: 10 } },
      { name: '@clocky/clocky-client-ui-simulation' },
    ] }, { id: 'modules', config: { browserConfig: {
      '@clocky/clocky-client-ui-simulation': { pageSize: 1, controlRefreshMs: 50 },
    } } }]
    const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify(overlays))
    const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
      productPrincipalId: 'world-browser-user', agentPresets: { default: 'simulation',
        roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' }] } })
    const countRequests = () => scaffold.ctx.worldDriverProbe.requests.length
    let owned: SimulationRun | undefined, opens = 0
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => { owned = await open(...args); opens++; return owned }
    const beforeCalls = countRequests()
    const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    const page = await context.newPage()
    const errors = watchConsole(page), createCommands: SimulationProductCommandId[] = [], cancelInputs: Record<string, unknown>[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/api/simulation.world.create')) {
        cancelInputs.push((request.postDataJSON() as { payload: Record<string, unknown> }).payload)
      }
      if (request.url().endsWith('/api/simulation.world.create')) {
        createCommands.push((request.postDataJSON() as { payload: { commandId: SimulationProductCommandId } }).payload.commandId)
      }
    })
    try {
      await page.addInitScript(() => {
        const send = globalThis.fetch.bind(globalThis)
        globalThis.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          if (!url.endsWith('/api/simulation.world.create')) return send(input, init)
          const original = init?.signal ?? (input instanceof Request ? input.signal : undefined)
          const deadline = AbortSignal.timeout(250)
          return send(input, { ...init, signal: original === undefined || original === null
            ? deadline : AbortSignal.any([original, deadline]) })
        }
      })
      await page.route('**/api/simulation.world.create', async (route) => {
        const response = await route.fetch()
        const body: unknown = await response.json()
        await writeFile(join(root, 'create-accepted-response.json'), JSON.stringify(body))
        await new Promise(done => setTimeout(done, 400))
        try { await route.fulfill({ response }) }
        catch { /* The browser deadline already retired this accepted response. */ }
      })
      await scaffold.authenticateBrowserPage(page)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '仿真', exact: true }).click()
      const workspace = page.locator('[data-simulation-workspace-page]')
      await workspace.getByRole('button', { name: '导入 World JSON', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '导入 World JSON', exact: true })
      await dialog.getByLabel('运行名称', { exact: true }).fill(`World ${scenario}`)
      await dialog.getByLabel('可移植场景 JSON', { exact: true }).fill('{ invalid')
      await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
      await dialog.getByText('请输入有效的可移植 World JSON 定义。', { exact: true }).waitFor()
      expect(createCommands).toEqual([]); expect(countRequests()).toBe(beforeCalls)
      const parsed = worldScenarioSchema.parse(JSON.parse(await readFile(
        resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
      const definition = JSON.stringify(parsed)
      await dialog.getByLabel('选择 JSON 文件', { exact: true }).setInputFiles({ name: `world-${scenario}.json`,
        mimeType: 'application/json', buffer: Buffer.from(definition) })
      await expect.poll(() => dialog.getByLabel('可移植场景 JSON', { exact: true }).inputValue()).toBe(definition)
      await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
      await dialog.getByRole('region', { name: 'World 创建预览', exact: true }).waitFor()
      await dialog.getByRole('heading', { name: '招聘授权', exact: true }).waitFor()
      expect(createCommands).toEqual([]); expect(countRequests()).toBe(beforeCalls)
      await page.screenshot({ path: join(root, '00-preview.png'), animations: 'disabled' })
      await dialog.getByRole('button', { name: '创建暂停的运行', exact: true }).dblclick()
      const originalCommand = dialog.getByRole('region', { name: '原操作', exact: true })
      await expect.poll(() => originalCommand.getByRole('button', { name: '查询原结果', exact: true }).isEnabled()).toBe(true)
      await expect.poll(() => originalCommand.getAttribute('data-outcome-unknown')).toBe('true')
      expect(await originalCommand.getByRole('button', { name: '重试原操作', exact: true }).count()).toBe(0)
      expect(createCommands).toHaveLength(1)
      await expect.poll(() => owned?.snapshot().latestCheckpointId !== undefined).toBe(true)
      await originalCommand.getByRole('button', { name: '查询原结果', exact: true }).click()
      await dialog.getByRole('button', { name: '打开已登记运行', exact: true }).click()
      await expect.poll(() => owned?.snapshot().phase).toBe('paused')
      const revision = owned!.snapshot().revision, count = opens
      expect(countRequests()).toBe(beforeCalls)
      expect(createCommands).toHaveLength(1)
      expect(cancelInputs).toHaveLength(1)
      const originalInput = cancelInputs[0]!
      expect(originalInput.definition).toEqual(parsed)
      expect(originalInput.commandId).toBe(createCommands[0])
      await page.screenshot({ path: join(root, '01-original-paused-creation.png'), animations: 'disabled' })
      await page.reload({ waitUntil: 'load' })
      await workspace.getByRole('heading', { name: `World ${scenario}`, exact: true }).waitFor()
      const second = await page.context().newPage()
      try {
        await second.goto(page.url(), { waitUntil: 'load' })
        await second.locator('[data-simulation-workspace-page]').getByRole('heading', { name: `World ${scenario}`, exact: true }).waitFor()
      } finally { await second.close() }
      expect(opens).toBe(count)
      expect(countRequests()).toBe(beforeCalls)
      expect(createCommands).toHaveLength(1)
      expect(cancelInputs).toHaveLength(1)
      expect(owned!.snapshot().revision).toBe(revision)
      await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, scenario, originalInput, opens, modelCalls: 0,
        unknownHttpDeadline: true, queriedOriginal: true, paused: true, stableReloadAndSecondTab: true }, null, 2))
      expect(errors.pageErrors).toEqual([])
    } finally { await page.unrouteAll({ behavior: 'wait' }); await browser.close(); await scaffold.close() }
  })
