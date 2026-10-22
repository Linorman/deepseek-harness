/** Browser cancels an accepted World case after a real HTTP timeout and queries the original without duplicate ownership. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { scenarioCatalogSchema, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { simulationProductControlInputSchema } from '@clocky/clocky-simulation-product/schema'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationProductCommandId } from '@clocky/clocky-simulation-product/types'
import type {} from '../../../examples/simulation-company/tests/world-driver-model.ts'

it.each((['json', 'sqlite'] as const).flatMap(backend => (['company', 'laboratory'] as const).map(scenario => ({ backend, scenario }))))(
  'cancels $backend $scenario original case after a real timeout', async ({ backend, scenario }) => {
    const parent = resolve('.local/world-director-mvp/browser', `${backend}-${scenario}-case-cancel`)
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
      { name: '@clocky/clocky-simulation-world/providers' },
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
    const held = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => {
      const run = await open(...args)
      owned = run; opens++
      const reserve = run.reserveWorldHire.bind(run)
      run.reserveWorldHire = async (...input) => { held.resolve(undefined); await release.promise; return await reserve(...input) }
      return run
    }
    const beforeCalls = countRequests()
    const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    const page = await context.newPage()
    const errors = watchConsole(page), createCommands: SimulationProductCommandId[] = [], cancelInputs: Record<string, unknown>[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/api/simulation.world.cases.cancel')) {
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
          if (!url.endsWith('/api/simulation.world.cases.cancel')) return send(input, init)
          const original = init?.signal ?? (input instanceof Request ? input.signal : undefined)
          const deadline = AbortSignal.timeout(250)
          return send(input, { ...init, signal: original === undefined || original === null
            ? deadline : AbortSignal.any([original, deadline]) })
        }
      })
      await page.route('**/api/simulation.world.cases.cancel', async (route) => {
        const response = await route.fetch()
        const body: unknown = await response.json()
        await writeFile(join(root, 'cancel-accepted-response.json'), JSON.stringify(body))
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
      await dialog.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
      await expect.poll(() => owned?.snapshot().phase).toBe('paused')
      await dialog.getByRole('button', { name: '打开已登记运行', exact: true }).click()
      expect(createCommands).toHaveLength(1); expect(countRequests()).toBe(beforeCalls)
      await workspace.getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      const start = page.getByRole('dialog', { name: /^(开始|继续)调度$/ })
      const managing = page.waitForResponse(response => response.url().endsWith('/api/simulation.runs.manage'))
      await start.getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      const management: unknown = await (await managing).json()
      await writeFile(join(root, 'start-response.json'), JSON.stringify(management))
      expect(z.object({ result: z.object({ ok: z.boolean() }) }).parse(management).result.ok, JSON.stringify(management)).toBe(true)
      const selectedRun = simulationProductControlInputSchema.parse({ runId: new URL(page.url()).searchParams.get('simulation') })
      const initialControl = await scaffold.authenticatedRpc('simulation.runs.control', selectedRun)
      await writeFile(join(root, 'control-before-reservation.json'), JSON.stringify(initialControl))
      await held.promise
      expect(countRequests() - beforeCalls).toBe(6)
      await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
      await expect.poll(() => owned?.snapshot().phase).toBe('paused')
      const world = owned!.snapshot().world!, original = Object.values(world.requests)[0]!
      expect(Object.keys(world.plans)).toHaveLength(1)
      expect(Object.keys(world.reservations)).toHaveLength(0)
      await workspace.getByRole('button', { name: '事项', exact: true }).first().click()
      await workspace.getByRole('button', { name: original.id, exact: true }).click()
      const inspector = workspace.getByRole('complementary')
      await inspector.getByRole('button', { name: '取消案件', exact: true }).click()
      await inspector.getByRole('button', { name: '确认取消原案件', exact: true }).dblclick()
      await expect.poll(() => cancelInputs.length).toBe(1)
      const command = inspector.getByRole('region', { name: '原操作', exact: true })
      await expect.poll(() => command.getByRole('button', { name: '查询原结果', exact: true }).isEnabled()).toBe(true)
      await expect.poll(() => command.getAttribute('data-outcome-unknown')).toBe('true')
      expect(await command.getByRole('button', { name: '重试原操作', exact: true }).count()).toBe(0)
      expect(cancelInputs[0]?.requestId).toBe(original.id)
      await expect.poll(() => Object.keys(owned!.snapshot().world!.cancellations).length).toBe(1)
      release.resolve(undefined)
      await expect.poll(() => owned!.snapshot().world!.requests[original.id]?.status).toBe('cancelled')
      await command.getByRole('button', { name: '查询原结果', exact: true }).click()
      await command.getByText('请求已完成', { exact: false }).waitFor()
      expect(cancelInputs).toHaveLength(1)
      expect(countRequests() - beforeCalls).toBe(6)
      const state = owned!.snapshot(), calls = countRequests(), count = opens
      expect(Object.values(state.world!.results)[0]?.outcome.kind).toBe('cancelled')
      expect(Object.keys(state.world!.reservations)).toHaveLength(0)
      expect(Object.keys(state.world!.cancellations)).toHaveLength(1)
      await page.screenshot({ path: join(root, '01-original-cancellation.png'), animations: 'disabled' })
      await page.reload({ waitUntil: 'load' })
      const reloaded = workspace.getByRole('complementary')
      await reloaded.getByRole('button', { name: '取消案件', exact: true }).waitFor()
      expect(await reloaded.getByRole('button', { name: '取消案件', exact: true }).isDisabled()).toBe(true)
      const second = await page.context().newPage()
      try {
        await second.goto(page.url(), { waitUntil: 'load' })
        const copy = second.locator('[data-simulation-workspace-page]').getByRole('complementary')
        await copy.getByRole('button', { name: '取消案件', exact: true }).waitFor()
        expect(await copy.getByRole('button', { name: '取消案件', exact: true }).isDisabled()).toBe(true)
      } finally { await second.close() }
      expect(createCommands).toHaveLength(1)
      expect(cancelInputs).toHaveLength(1)
      expect(opens).toBe(count)
      expect(countRequests()).toBe(calls)
      expect(owned!.snapshot().phase).toBe('paused')
      expect(Object.keys(owned!.snapshot().world!.cancellations)).toHaveLength(1)
      await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, scenario, createCommand: createCommands[0],
        cancel: cancelInputs[0], modelCalls: calls - beforeCalls, opens, originalResult: 'cancelled',
        unknownHttpDeadline: true, queriedOriginal: true, stableReloadAndSecondTab: true }, null, 2))
      expect(errors.pageErrors).toEqual([])
    } finally { release.resolve(undefined); await page.unrouteAll({ behavior: 'wait' }); await browser.close(); await scaffold.close() }
  })
