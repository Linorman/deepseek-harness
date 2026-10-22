import { simulationWorldHireCommittedResultPayloadSchema, simulationWorldHirePlanPayloadSchema } from '@clocky/clocky-simulation'
/** Browser revocation retires private World case replies before late HTTP results or an offline window can reveal them. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { scenarioCatalogSchema, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { simulationProductInspectInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { ProductPrincipalId } from '@clocky/clocky-product-principal/types'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationProductCommandId } from '@clocky/clocky-simulation-product/types'
import type {} from '../../../examples/simulation-company/tests/world-driver-model.ts'

it.each((['json', 'sqlite'] as const).flatMap(backend => (['company', 'laboratory'] as const).map(scenario => ({ backend, scenario }))))(
  'retires $backend $scenario private case content across revocation and offline replies', async ({ backend, scenario }) => {
    const parent = resolve('.local/world-director-mvp/browser', `${backend}-${scenario}-case-privacy`)
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
      const { runId } = simulationProductInspectInputSchema.parse({ runId: state.spec.runId })
      const plan = Object.values(world.plans).find(value => value.requestId === original.id)!
      if (plan.proposal.resolution.kind !== 'apply') throw new Error('Privacy fixture requires its actual generated Persona')
      const rationale = plan.proposal.resolution.rationale
      const name = simulationWorldHirePlanPayloadSchema.parse(plan.proposal.resolution.payload).persona.name
      const grant = scaffold.ctx.simulationProducts.caseReaderRegistrar()([{ principalId: 'world-browser-user' as ProductPrincipalId, runId,
        requestIds: [original.id], content: ['case', 'persona'] }])
      let revoked = false
      const captured = Promise.withResolvers<undefined>(), releaseResponse = Promise.withResolvers<undefined>()
      let late = false
      await page.route('**/api/simulation.world.cases.inspect', async (route) => {
        const input = (route.request().postDataJSON() as { payload: { section: string } }).payload
        if (!late || input.section !== 'plans') { await route.continue(); return }
        late = false
        const response = await route.fetch()
        const body: unknown = await response.json()
        await writeFile(join(root, 'original-allowed-late-response.json'), JSON.stringify(body))
        if (!JSON.stringify(body).includes(rationale)) throw new Error('Late reply did not contain the actual authorized body')
        captured.resolve(undefined)
        await releaseResponse.promise
        try { await route.fulfill({ response }) }
        catch { /* A retired read deliberately aborts this already assembled old-authority reply. */ }
      })
      try {
        await workspace.getByRole('button', { name: '事项', exact: true }).first().click()
        await workspace.getByRole('button', { name: original.id, exact: true }).click()
        const inspector = workspace.getByRole('complementary')
        await inspector.getByRole('tab', { name: '计划', exact: true }).click()
        await inspector.getByText(rationale, { exact: true }).waitFor()
        await inspector.getByText(name, { exact: true }).waitFor()
        const session = await scaffold.authenticatedRpc('session.history', { sessionId: newcomer.binding!.sessionId })
        expect(session.result).toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' } })
        const calls = countRequests(), revision = owned!.snapshot().revision
        await page.screenshot({ path: join(root, '01-authorized-content.png'), animations: 'disabled' })
        late = true
        await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
        await captured.promise
        grant(); revoked = true
        // The real metadata observer paces its next watch by the configured two-second retry interval.
        await expect.poll(async () => (await inspector.textContent())?.includes(rationale) ?? false, { timeout: 10000 }).toBe(false)
        await expect.poll(async () => (await inspector.textContent())?.includes(name) ?? false, { timeout: 10000 }).toBe(false)
        releaseResponse.resolve(undefined)
        await page.unrouteAll({ behavior: 'wait' })
        await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
        await inspector.getByText('此内容需要单独的披露授权。', { exact: true }).first().waitFor()
        expect((await inspector.textContent())?.includes(rationale)).toBe(false)
        expect((await inspector.textContent())?.includes(name)).toBe(false)
        await page.screenshot({ path: join(root, '02-revoked-late-reply.png'), animations: 'disabled' })
        await page.context().setOffline(true)
        await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
        await workspace.getByText('读取失败，已保留可读内容；连接恢复后可重试。', { exact: true }).first().waitFor()
        await workspace.getByText('当前状态未知', { exact: true }).first().waitFor()
        // Rows show the business title and keep the original request ID as their accessible name.
        expect(await workspace.getByRole('button', { name: original.id, exact: true }).count()).toBeGreaterThan(0)
        expect((await inspector.textContent())?.includes(rationale)).toBe(false)
        expect((await inspector.textContent())?.includes(name)).toBe(false)
        expect(countRequests()).toBe(calls)
        expect(owned!.snapshot().revision).toBe(revision)
        await page.screenshot({ path: join(root, '03-offline-retained-metadata.png'), animations: 'disabled' })
        await page.context().setOffline(false)
        await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
        await inspector.getByText('此内容需要单独的披露授权。', { exact: true }).first().waitFor()
        expect((await inspector.textContent())?.includes(rationale)).toBe(false)
        expect((await inspector.textContent())?.includes(name)).toBe(false)
        expect(countRequests()).toBe(calls)
        await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, scenario, originalRequest: original.id,
          modelCalls: calls - beforeCalls, originalAuthorized: true, revokedCleared: true, lateReplyRetired: true,
          offlineMetadataRetained: true, noReinference: true }, null, 2))
        expect(errors.pageErrors).toEqual([])
      } finally { if (!revoked) grant(); releaseResponse.resolve(undefined); await page.unrouteAll({ behavior: 'wait' }) }
    } finally { await browser.close(); await scaffold.close() }
  })
