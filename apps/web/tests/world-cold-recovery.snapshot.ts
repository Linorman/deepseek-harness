import { simulationWorldHireCommittedResultPayloadSchema } from '@clocky/clocky-simulation'
/** Browser pause, checkpoint and cold restoration use retained real Web/Agent/persistence roots. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { arch, cpus, platform, totalmem } from 'node:os'
import { isSurfaceEvent, SessionId } from '@clocky/clocky-session'
import { z } from 'zod'
import { scenarioCatalogSchema, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationProductCommandId } from '@clocky/clocky-simulation-product/types'
import type {} from '../../../examples/simulation-company/tests/world-driver-model.ts'

it.each((['json', 'sqlite'] as const).flatMap(backend => (['company', 'laboratory'] as const).map(scenario => ({ backend, scenario }))))(
  'restores $backend $scenario original World through the browser without redispatch', async ({ backend, scenario }) => {
    const parent = resolve('.local/world-director-mvp/browser', `${backend}-${scenario}-cold-browser`)
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
      '@clocky/clocky-client-ui-simulation': { pageSize: 2, controlRefreshMs: 50 },
    } } }]
    const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify(overlays))
    const options = { disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
      retainedWorld: { workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions') },
      productPrincipalId: 'world-browser-user', agentPresets: { default: 'simulation',
        roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' as const }] } }
    let scaffold = await launchWebScaffold(options), closed = false
    const countRequests = () => scaffold.ctx.worldDriverProbe.requests.length
    let owned: SimulationRun | undefined
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => { owned = await open(...args); return owned }
    const beforeCalls = countRequests()
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    page.setDefaultTimeout(10000)
    const errors = watchConsole(page), createCommands: SimulationProductCommandId[] = []
    const completion = scaffold.ctx.worldDriverProbe.holdNextCompletion()
    page.on('request', (request) => {
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
      const definition = await readFile(resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')
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
      await completion.entered
      const controlledWaitStart = performance.now()
      await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
      await expect.poll(() => owned?.snapshot().phase).toBe('paused')
      completion.finish()
      const controlledProviderWaitMs = performance.now() - controlledWaitStart
      await expect.poll(() => Object.values(owned!.snapshot().decisions)
        .filter(value => value.cancellation === 'paused').length, { timeout: 10000 }).toBe(1)
      expect(countRequests() - beforeCalls).toBe(1)
      expect(Object.values(owned!.snapshot().world!.requests)).toHaveLength(0)
      await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
      expect(await workspace.textContent()).not.toContain('调度器需要恢复。')
      await workspace.getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      await page.getByRole('dialog', { name: /^(开始|继续)调度$/ })
        .getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      await expect.poll(() => Object.values(owned?.snapshot().world?.results ?? {}).length, { timeout: 30000 }).toBe(1)
      // Explicit continuation retains the original Session's completed observe round for this wake.
      await expect.poll(() => countRequests() - beforeCalls, { timeout: 30000 }).toBe(18)
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
      const facts = structuredClone(owned!.snapshot().world)
      const native = owned!.snapshot()
      const sessionIds = Object.values(native.entities).flatMap(entity => entity.binding === undefined ? []
        : [SessionId(entity.binding.sessionId)])
      const sessions = await Promise.all(sessionIds.map(async (id) => {
        const unmaterialized = await scaffold.ctx.sessionPersistence.isUnmaterialized(id)
        return { id, unmaterialized, events: unmaterialized ? [] : (await scaffold.ctx.sessionPersistence.readFrom(id, 0)).events }
      }))
      const history = { entities: Object.keys(native.entities).length, channels: Object.keys(native.channelReservations ?? {}).length,
        decisions: Object.keys(native.decisions).length, operations: Object.keys(native.operations).length,
        boundSessions: sessions.length, sessionCount: sessions.filter(value => !value.unmaterialized).length,
        unmaterializedSessions: sessions.filter(value => value.unmaterialized).length,
        sessionEvents: sessions.reduce((total, session) => total + session.events.length, 0),
        surfaceEvents: sessions.reduce((total, session) => total + session.events.filter(isSurfaceEvent).length, 0),
        publishedPosts: Object.values(native.operations).filter(value => value.action.kind === 'communication/post'
          && value.status === 'applied').length, population: owned!.population(), tokenUsage: owned!.budgetUsage() }
      expect(history.sessionCount).toBe(3)
      expect(history.publishedPosts).toBe(3)
      const checkpointStart = performance.now()
      await workspace.locator('[data-simulation-maintenance] > summary').click()
      await workspace.getByRole('button', { name: '创建完整检查点', exact: true }).click()
      const checkpoint = page.getByRole('dialog', { name: '创建完整检查点', exact: true })
      await checkpoint.getByRole('button', { name: '创建完整检查点', exact: true }).click()
      const checkpointCommand = checkpoint.getByRole('region', { name: '原操作', exact: true })
      await expect.poll(async () => {
        const query = checkpointCommand.getByRole('button', { name: '查询原结果', exact: true })
        if (await query.count() && await query.isEnabled()) await query.click()
        return await checkpointCommand.getByText('原结果: 请求已完成', { exact: true }).isVisible()
      }, { timeout: 30000, interval: 1000 }).toBe(true)
      expect(countRequests()).toBe(calls)
      expect(owned!.snapshot().phase).toBe('paused')
      expect(owned!.snapshot().world).toEqual(facts)
      const checkpointMs = performance.now() - checkpointStart
      const route = new URL(page.url()), initialCount = calls - beforeCalls
      await scaffold.close(); closed = true
      const coldLoadStart = performance.now()
      scaffold = await launchWebScaffold(options); closed = false
      const coldLoaderMs = performance.now() - coldLoadStart
      // The fixture module retains its observation array across Loader instances in this test process.
      const coldBeforeCalls = countRequests()
      owned = undefined
      let coldOpens = 0
      const coldOpen = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
      scaffold.ctx.simulations.open = async (...args) => { coldOpens++; owned = await coldOpen(...args); return owned }
      await scaffold.authenticateBrowserPage(page)
      const next = new URL(scaffold.baseUrl); next.search = route.search
      const coldBrowseStart = performance.now()
      await page.goto(next.href, { waitUntil: 'load' })
      await workspace.getByRole('complementary').getByText('新人首次行动', { exact: true }).waitFor()
      await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
      expect(countRequests()).toBe(coldBeforeCalls)
      expect(coldOpens).toBe(0)
      const coldBrowseMs = performance.now() - coldBrowseStart
      await workspace.getByRole('button', { name: '概览', exact: true }).click()
      await workspace.getByRole('button', { name: '导出定义', exact: true }).click()
      const [download] = await Promise.all([page.waitForEvent('download'),
        page.getByRole('menuitem', { name: 'JSON', exact: true }).click()])
      const exportedPath = join(root, 'cold-export-world.json')
      await download.saveAs(exportedPath)
      const exported: unknown = JSON.parse(await readFile(exportedPath, 'utf8'))
      expect(worldScenarioSchema.parse(exported)).toEqual(worldScenarioSchema.parse(JSON.parse(definition)))
      expect(JSON.stringify(exported)).not.toContain(newcomer.binding!.sessionId)
      expect(countRequests()).toBe(coldBeforeCalls); expect(coldOpens).toBe(0)
      await workspace.locator('[data-simulation-maintenance] > summary').click()
      await workspace.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
      const restore = page.getByRole('dialog', { name: '验证并恢复运行', exact: true })
      await expect.poll(() => restore.getByRole('button', { name: '验证并恢复运行', exact: true }).isEnabled(), { timeout: 10000 }).toBe(true)
      expect(countRequests()).toBe(coldBeforeCalls); expect(coldOpens).toBe(0)
      const coldRestoreStart = performance.now()
      await restore.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
      await expect.poll(() => owned?.snapshot().phase, { timeout: 30000 }).toBe('paused')
      const restoreCommand = restore.getByRole('region', { name: '原操作', exact: true })
      await expect.poll(async () => {
        const query = restoreCommand.getByRole('button', { name: '查询原结果', exact: true })
        if (await query.count() && await query.isEnabled()) await query.click()
        return await restoreCommand.getByText('原结果: 请求已完成', { exact: true }).isVisible()
      }, { timeout: 30000, interval: 1000 }).toBe(true)
      expect(countRequests()).toBe(coldBeforeCalls); expect(coldOpens).toBe(1)
      expect(owned!.snapshot().world).toEqual(facts)
      const coldRestoreMs = performance.now() - coldRestoreStart
      const journalStream = (await owned!.getPersistenceReference(owned!.snapshot().revision)).stream.version
      await writeFile(join(root, 'measurements.json'), JSON.stringify({ backend, scenario, journalStream,
        clock: 'performance.now monotonic milliseconds', keylessModel: 'world-driver-scripted/1', modelCalls: initialCount,
        controlledProviderWaitMs, checkpointMs, coldLoaderMs, coldBrowseMs, coldRestoreMs, history,
        afterRestorePopulation: owned!.population(), coldCalls: countRequests() - coldBeforeCalls,
        host: { platform: platform(), arch: arch(), node: process.version, cpu: cpus()[0]?.model,
          logicalCpuCount: cpus().length, systemMemoryBytes: totalmem(), testHostMemory: process.memoryUsage() },
        boundaries: 'One small application. Loader time includes Web composition; browse includes browser render; restore includes UI query. RSS is test Host process, not actor memory. Provider wait is artificial. No scale SLO.' }, null, 2))
      await page.screenshot({ path: join(root, '02-cold-restored.png'), animations: 'disabled' })
      expect(errors.pageErrors).toEqual([])
      await writeFile(join(root, 'proof.json'), JSON.stringify({ scenario, backend, originalCreate: createCommands[0],
        originalRequest: original.id, modelCalls: initialCount, coldCalls: countRequests() - coldBeforeCalls,
        coldOpens, originalWorldRetained: true, coldReadAndExportWithoutOwner: true, streamedPauseAndExplicitContinue: true,
        phase: owned!.snapshot().phase,
        result: Object.values(owned!.snapshot().world!.results)[0], transport: 'real HTTP and WebSocket',
        model: 'scripted external LlmAdapter through real Agent tools' }, null, 2))
    } catch (error) {
      await page.screenshot({ path: join(root, 'failure.png'), animations: 'disabled' })
      await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText())
      throw error
    } finally { completion.finish(); await browser.close(); if (!closed) await scaffold.close() }
  })
