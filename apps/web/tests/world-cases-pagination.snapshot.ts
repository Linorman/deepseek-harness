import { simulationWorldHireCommittedResultPayloadSchema } from '@clocky/clocky-simulation'
/** Browser paginates two real World cases with revision-bound HTTP reads and separately withheld private bodies. */
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
  'pages $backend $scenario cases through real World UI', async ({ backend, scenario }) => {
    const parent = resolve('.local/world-director-mvp/browser', `${backend}-${scenario}-case-pages`)
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
    let owned: SimulationRun | undefined
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => { owned = await open(...args); return owned }
    const beforeCalls = countRequests()
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    const errors = watchConsole(page), createCommands: SimulationProductCommandId[] = [], caseQueries: Record<string, unknown>[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/api/simulation.world.cases.list')) {
        caseQueries.push((request.postDataJSON() as { payload: Record<string, unknown> }).payload)
      }
      if (request.url().endsWith('/api/simulation.world.create')) {
        createCommands.push((request.postDataJSON() as { payload: { commandId: SimulationProductCommandId } }).payload.commandId)
      }
    })
    try {
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
      parsed.positions[0]!.capacity = 4
      parsed.initialEvents.push({ ...parsed.initialEvents[0]!, applicationId: 'second-paginated-application' })
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
      await start.getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      await expect.poll(() => Object.values(owned?.snapshot().world?.results ?? {}).length, { timeout: 30000 }).toBe(2)
      await expect.poll(() => countRequests() - beforeCalls, { timeout: 30000 }).toBe(36)
      await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
      await expect.poll(() => owned?.snapshot().phase).toBe('paused')
      const state = owned!.snapshot(), world = state.world!, original = Object.values(world.requests)[0]!
      const result = Object.values(world.results)[0]!
      expect(result.outcome.kind).toBe('committed')
      if (result.outcome.kind !== 'committed') throw new Error('Browser World did not commit original employment')
      const newcomer = state.entities[simulationWorldHireCommittedResultPayloadSchema.parse(result.payload).entityId]!
      expect(newcomer.readiness).toBe('ready')
      if (original.requesterEntityId === null) throw new Error('Original actor hiring case lost its real requester')
      expect(newcomer.binding?.sessionId).not.toBe(state.entities[original.requesterEntityId]?.binding?.sessionId)
      expect(scaffold.ctx.worldDriverProbe.requests.some(call => call.purpose === 'first-action'
        && call.entityId === newcomer.id)).toBe(true)
      await workspace.getByRole('button', { name: '事项', exact: true }).first().click()
      await workspace.getByRole('button', { name: original.id, exact: true }).waitFor()
      const second = Object.values(world.requests).sort((a, b) => a.sequence - b.sequence)[1]!
      await workspace.getByRole('button', { name: '下一页', exact: true }).click()
      await workspace.getByRole('button', { name: second.id, exact: true }).waitFor()
      await expect.poll(() => workspace.getByRole('button', { name: original.id, exact: true }).count()).toBe(0)
      expect(caseQueries.some(query => query.cursor !== undefined
        && query.expectedRevision === state.revision && query.limit === 1)).toBe(true)
      expect(countRequests() - beforeCalls).toBe(36)
      expect(owned!.snapshot().revision).toBe(state.revision)
      await page.screenshot({ path: join(root, '01-case-page-two.png'), animations: 'disabled' })
      await workspace.getByRole('button', { name: '返回首页', exact: true }).click()
      await workspace.getByRole('button', { name: original.id, exact: true }).click()
      const inspector = workspace.getByRole('complementary')
      await inspector.getByText('申请正文', { exact: true }).waitFor()
      await inspector.getByText('此内容需要单独的披露授权。', { exact: true }).waitFor()
      await inspector.getByRole('tab', { name: '计划', exact: true }).click()
      await inspector.getByText('接受计划仅表示待执行，不代表新人已经入职。', { exact: true }).waitFor()
      expect(await inspector.textContent()).not.toContain('Director-private rationale')
      await inspector.getByRole('tab', { name: '执行', exact: true }).click()
      await inspector.getByText('身份就绪，任职已提交', { exact: true }).waitFor()
      await inspector.getByRole('tab', { name: '通知', exact: true }).click()
      await inspector.getByText('新人首次行动', { exact: true }).waitFor()
      await page.screenshot({ path: join(root, '01-notification.png'), animations: 'disabled' })
      const calls = countRequests()
      await page.reload({ waitUntil: 'load' })
      await workspace.getByRole('complementary').getByText('新人首次行动', { exact: true }).waitFor()
      expect(countRequests()).toBe(calls)
      await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 390, height: 844 })
      await expect.poll(async () => (await workspace.boundingBox())?.width ?? 0).toBeGreaterThan(300)
      await inspector.getByRole('tab', { name: '申请', exact: true }).waitFor()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: join(root, '02-narrow.png'), animations: 'disabled' })
      expect(errors.pageErrors).toEqual([])
      await writeFile(join(root, 'proof.json'), JSON.stringify({ scenario, backend, originalCreate: createCommands[0],
        originalRequest: original.id, cases: 2, pageSize: 1, caseQueries, modelCalls: calls - beforeCalls, phase: owned!.snapshot().phase,
        result: Object.values(owned!.snapshot().world!.results)[0], transport: 'real HTTP and WebSocket',
        model: 'scripted external LlmAdapter through real Agent tools' }, null, 2))
    } finally { await browser.close(); await scaffold.close() }
  })
