import { simulationWorldHireCommittedResultPayloadSchema, simulationWorldFactRequestSchema } from '@clocky/clocky-simulation'
/** Real World context bodies require independent authenticated disclosure and cannot return after a late revoked reply. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { scenarioCatalogSchema, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { simulationProductRequestResultSchema, simulationProductInspectInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { ProductPrincipalId } from '@clocky/clocky-product-principal/types'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationProductCommandId } from '@clocky/clocky-simulation-product/types'
import type {} from '../../../examples/simulation-company/tests/world-driver-model.ts'

it.each((['json', 'sqlite'] as const).flatMap(backend => (['company', 'laboratory'] as const).map(scenario => ({ backend, scenario }))))(
  'retires $backend $scenario private World context across revocation and late replies', async ({ backend, scenario }) => {
    const parent = resolve('.local/world-completion/thread-01a1336a-norm-user-projection/browser', `${backend}-${scenario}-context-privacy`)
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
      '@clocky/clocky-client-ui-simulation': { pageSize: 32, controlRefreshMs: 50 },
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
    const responses: unknown[] = []
    page.on('response', async (response) => {
      if (!response.url().includes('/api/simulation.')) return
      let body: unknown
      try { body = await response.json() }
      catch { return /* Browser teardown can retire a pending metadata response before its body is available. */ }
      responses.push({ path: new URL(response.url()).pathname, body })
    })
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
      await expect.poll(async () => {
        const response = await scaffold.authenticatedRpc<unknown>('simulation.requests.get', { commandId: createCommands[0] })
        if (!response.result.ok) throw new Error(response.result.error.message)
        const current = simulationProductRequestResultSchema.parse(response.result.value)
        return current.status === 'found' ? current.request.status : current.status
      }).toBe('completed')
      await expect.poll(() => owned?.snapshot().phase).toBe('paused')
      await dialog.getByRole('button', { name: '打开已登记运行', exact: true }).click()
      expect(createCommands).toHaveLength(1); expect(countRequests()).toBe(beforeCalls)
      await expect.poll(() => owned?.snapshot().world?.definition.directorEntityId).toBeDefined()
      await owned!.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: 'director-only-context', version: '1',
        schemaRef: 'clocky.world-fact/text/1', subject: owned!.snapshot().world!.definition.organizationEntityId,
        scope: owned!.snapshot().world!.definition.organizationEntityId, payload: { body: 'PRIVATE-WORLD-CONTEXT-USER-CANARY' },
        effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'actors',
          entityIds: [owned!.snapshot().world!.definition.directorEntityId] }, supersedes: null,
        sources: [{ kind: 'run-event', runId: owned!.snapshot().spec.runId, sequence: owned!.snapshot().world!.sequence }] }))
      await workspace.getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      const start = page.getByRole('dialog', { name: /^(开始|继续)调度$/ })
      await start.getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      await expect.poll(() => Object.values(owned?.snapshot().world?.results ?? {}).length, { timeout: 30000 }).toBe(2)
      await expect.poll(() => countRequests() - beforeCalls, { timeout: 30000 }).toBe(36)
      await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
      await expect.poll(async () => {
        const response = await scaffold.authenticatedRpc<unknown>('simulation.requests.get', { commandId: createCommands[0] })
        if (!response.result.ok) throw new Error(response.result.error.message)
        const current = simulationProductRequestResultSchema.parse(response.result.value)
        return current.status === 'found' ? current.request.status : current.status
      }).toBe('completed')
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
      const canary = 'PRIVATE-WORLD-CONTEXT-USER-CANARY'
      const decision = Object.values(state.decisions).find(value => value.context?.status === 'prepared'
        && value.context.world?.kind === 'resolve' && JSON.stringify(value.context.view).includes(canary))
      expect(decision).toBeDefined()
      if (decision === undefined || decision.context?.status !== 'prepared') throw new Error('Missing real director World context')
      const originalInputId = decision.context.view.inputId
      const stored = await scaffold.ctx.sessionPersistence.readFrom(state.entities[decision.entityId]!.binding!.sessionId, 0)
      expect(stored.events.some(event => event.type === 'simulation/context-view'
        && event.data.inputId === originalInputId)).toBe(true)
      const calls = countRequests(), before = owned!.snapshot()
      const detail = new URL(page.url())
      detail.searchParams.set('simulationModule', 'decisions'); detail.searchParams.set('simulationObject', decision.id)
      detail.searchParams.set('simulationSection', 'context')
      await page.evaluate((url) => { window.history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')) }, detail.href)
      const inspector = workspace.getByRole('complementary', { name: '查看详情' })
      const withheld = '上下文正文未公开；读取需要部署显式授予此实体的正文权限。'
      await inspector.getByText(withheld, { exact: true }).first().waitFor()
      expect((await inspector.textContent())?.includes(canary)).toBe(false)
      const removeWrong = scaffold.ctx.simulationProducts.contextReaderRegistrar()([{ principalId: 'world-browser-user' as ProductPrincipalId,
        runId, entityIds: [original.requesterEntityId], content: ['context'] }])
      await inspector.getByRole('button', { name: '刷新详情', exact: true }).click()
      await inspector.getByText(withheld, { exact: true }).first().waitFor(); removeWrong()
      const remove = scaffold.ctx.simulationProducts.contextReaderRegistrar()([{ principalId: 'world-browser-user' as ProductPrincipalId,
        runId, entityIds: [decision.entityId], content: ['context'] }])
      const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      const settled = Promise.withResolvers<undefined>()
      let revoked = false, hold = false
      try {
        // Reopening adopts the new body policy without retaining an older inspector generation.
        await page.reload({ waitUntil: 'load' })
        await expect.poll(async () => (await inspector.textContent())?.includes(canary) ?? false).toBe(true)
        await page.screenshot({ path: join(root, '01-authorized-context.png'), animations: 'disabled' })
        await page.route('**/api/simulation.objects.inspect', async (route) => {
          if (!hold) { await route.continue(); return }
          hold = false
          const response = await route.fetch(), body: unknown = await response.json()
          expect(JSON.stringify(body)).toContain(canary)
          await writeFile(join(root, 'authorized-pending-response.json'), JSON.stringify(body))
          entered.resolve(undefined); await release.promise
          try { await route.fulfill({ response }) }
          catch { /* Revocation cancels the original in-flight browser request before this obsolete body returns. */ }
          finally { settled.resolve(undefined) }
        })
        hold = true
        await inspector.getByRole('button', { name: '刷新详情', exact: true }).click(); await entered.promise
        remove(); revoked = true
        await inspector.getByText(withheld, { exact: true }).first().waitFor()
        expect((await inspector.textContent())?.includes(canary)).toBe(false)
        release.resolve(undefined); await settled.promise; await page.unrouteAll({ behavior: 'wait' })
        expect(await inspector.locator('pre').count()).toBe(0)
        expect((await inspector.textContent())?.includes(canary)).toBe(false)
        await page.screenshot({ path: join(root, '02-revoked-late-context.png'), animations: 'disabled' })
        await page.reload({ waitUntil: 'load' })
        await inspector.getByText(withheld, { exact: true }).first().waitFor()
        expect((await inspector.textContent())?.includes(canary)).toBe(false)
        expect(owned!.snapshot()).toEqual(before); expect(countRequests()).toBe(calls)
        expect(errors.pageErrors).toEqual([])
        await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, scenario, runId, decisionId: decision.id,
          modelCalls: calls - beforeCalls, currentPrincipal: 'world-browser-user', body: canary,
          ownerAloneWithheld: true, wrongEntityWithheld: true, exactGrantAllowed: true, revokedCleared: true,
          lateResponseRetired: true, reloadWithheld: true, nativeUnchanged: true, noReadInference: true,
          url: page.url(), title: await page.title(), errors }, null, 2))
        await writeFile(join(root, 'native.json'), JSON.stringify(before))
        await writeFile(join(root, 'director-session.json'), JSON.stringify(stored.events))
      } finally { if (!revoked) remove(); release.resolve(undefined); await page.unrouteAll({ behavior: 'wait' }) }
    } catch (error) {
      await writeFile(join(root, 'failure.json'), JSON.stringify({ error: String(error), text: await page.locator('body').innerText(), responses }, null, 2))
      await page.screenshot({ path: join(root, 'failure.png'), animations: 'disabled' })
      throw error
    } finally { await browser.close(); await scaffold.close() }
  })
