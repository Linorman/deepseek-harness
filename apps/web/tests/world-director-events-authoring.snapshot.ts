/** Browser plugin not available: actual rule-scene authoring and explicit scheduling share native case projections. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { z } from 'zod'
import { expect, it } from 'vitest'
import { worldScenarioV1Schema, scenarioV1CatalogSchema, decodeScenarioInput } from '@clocky/clocky-simulation-scenario'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationProductControl, SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product/types'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it.each([['json', 'normal'], ['sqlite', 'normal'], ['json', 'pause-race'], ['sqlite', 'pause-race']] as const)(
  'authors an independent director budget and reads actual scenario case facts over %s HTTP (%s)', async (backend, mode) => {
    const parent = resolve('.local/c36-director-events-sdk', mode, backend)
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(join(parent, 'browser-'))
    const metadata: unknown = await import(pathToFileURL(resolve('examples/simulation-company/tests/fixtures/world-director-events/source.ts')).href)
    const scene = z.object({ directorDefinition: worldScenarioV1Schema, directorCatalog: scenarioV1CatalogSchema }).parse(metadata)
    const requests: unknown[] = [], driverErrors: unknown[] = []
    let advancesStarted = 0, advancesCompleted = 0
    let race: {
      request: Parameters<SimulationRun['openWindow']>[0]
      revision: number
      snapshot: ReturnType<SimulationRun['snapshot']>
      modelCalls: number
    } | undefined
    let releaseRace: (() => void) | undefined
    const beforeCalls = 0, expected = structuredClone(scene.directorDefinition)
    expected.behavior.directorEvents[0]!.maxRequests = 1
    const patches = [{ insert: [
      { name: '@clocky/clocky-simulation' },
      { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
      { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
        maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
      { name: '@clocky/clocky-simulation-world/providers' },
      { name: '@clocky/clocky-tool-simulation' },
      { name: resolve('examples/simulation-company/tests/fixtures/world-director-events/model.ts') },
      { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'director-ui-directory', imports: [] } },
      { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'director-ui-commands', templates: [],
        driverIntervalMs: 5, driverRetryMs: 10, world: { provider: 'local', catalog: scene.directorCatalog,
          checkpoint: { maxDrainRounds: 4, maxAttempts: 3 }, authoringTemplates: [
            { id: 'director-rule', version: '1', name: '有限环境事件', definition: scene.directorDefinition }] } } },
      { name: '@clocky/clocky-client-ui-simulation' },
    ] }, { id: 'modules', config: { browserConfig: { '@clocky/clocky-client-ui-simulation': { pageSize: 8, controlRefreshMs: 50 } } } }]
    const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify(patches))
    const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
      retainedWorld: { workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions') },
      productPrincipalId: 'director-browser-reader', agentPresets: { default: 'simulation',
        roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' }] } })
    // Loader owns the actual adapter instance; Vitest's transformed fixture module can have a separate observation array.
    scaffold.ctx.on('llm/stream', (options, next) => {
      requests.push({ provider: options.provider, model: options.model, messages: structuredClone(options.messages) })
      return next()
    })
    let owned: SimulationRun | undefined
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => { owned = await open(...args); return owned }
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    page.setDefaultTimeout(15000); page.on('dialog', (dialog) => { void dialog.accept() })
    const errors = watchConsole(page), creates: SimulationProductWorldCreateInput[] = [], caseResponses: unknown[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/api/simulation.world.create')) {
        creates.push((request.postDataJSON() as { payload: SimulationProductWorldCreateInput }).payload)
      }
    })
    page.on('response', async (response) => {
      if (response.url().endsWith('/api/simulation.world.cases.inspect')) {
        const body: unknown = await response.json()
        caseResponses.push(body)
      }
    })
    const workspace = page.locator('[data-simulation-workspace-page]')
    try {
      await scaffold.authenticateBrowserPage(page); await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '仿真', exact: true }).click()
      await workspace.getByRole('button', { name: '新建世界', exact: true }).first().click()
      await page.getByRole('dialog', { name: '新建世界', exact: true }).getByRole('button', { name: /有限环境事件/ }).click()
      const cell = workspace.locator('[data-table="directorEvents"] [data-cell="0:2"]')
      await cell.click(); await page.keyboard.press('Enter')
      await cell.getByRole('textbox', { name: '事件请求上限 · 1', exact: true }).fill('1')
      await page.keyboard.press('Enter')
      await workspace.getByRole('radio', { name: '源码', exact: true }).click()
      const source = workspace.getByRole('textbox', { name: '定义源码（JSON）', exact: true })
      const parsed = decodeScenarioInput(await source.inputValue(), 'json')
      expect(parsed.ok && parsed.value).toEqual(expected)
      await workspace.getByRole('radio', { name: '表单', exact: true }).click()
      await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
      const create = workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true })
      await expect.poll(() => create.isEnabled()).toBe(true)
      await page.screenshot({ path: join(root, '00-independent-budget-preview.png'), animations: 'disabled' })
      expect(requests.length).toBe(beforeCalls); expect(creates).toEqual([])
      await create.click()
      const confirmation = page.getByRole('dialog', { name: '创建暂停运行', exact: true })
      await confirmation.getByLabel('运行名', { exact: true }).fill('Finite director case')
      await confirmation.getByRole('button', { name: '创建暂停运行', exact: true }).click()
      await workspace.getByRole('button', { name: '打开运行', exact: true }).waitFor()
      await expect.poll(() => owned?.snapshot().latestCheckpointId !== undefined, { timeout: 30000 }).toBe(true)
      expect(owned!.snapshot().phase).toBe('paused'); expect(requests.length).toBe(beforeCalls)
      expect(creates).toHaveLength(1); expect(creates[0]!.definition).toEqual(expected)
      const paused = structuredClone(owned!.snapshot())
      if (mode === 'pause-race') {
        const run = owned!, originalWindow = run.openWindow.bind(run)
        run.openWindow = async (request, revision) => {
          const snapshot = run.snapshot()
          if (race === undefined && snapshot.phase === 'running' && Object.values(snapshot.world?.requests ?? {})
            .some(value => value.source.kind === 'decision' && value.source.trigger !== undefined && value.status === 'committed')) {
            race = { request: structuredClone(request), revision, snapshot: structuredClone(snapshot), modelCalls: requests.length }
            await new Promise<void>((resolveRace) => { releaseRace = resolveRace })
          }
          return originalWindow(request, revision)
        }
      }
      // Reflect the actual Loader-held object: imported prototypes can belong to a separate Vitest module instance.
      const held: unknown = Reflect.get(scaffold.ctx.simulationAdministration, 'held')
      if (!(held instanceof Map)) throw new Error('Actual administration held Map is unavailable')
      const lives: unknown[] = [...held.values()]
      const live = lives.find(value => value !== null && typeof value === 'object' && Reflect.get(value, 'run') === owned)
      if (live === null || typeof live !== 'object') throw new Error('Actual created owner is unavailable')
      const owner: unknown = Reflect.get(live, 'owner')
      if (owner === null || typeof owner !== 'object') throw new Error('Actual World owner is unavailable')
      const attach: unknown = Reflect.get(owner, 'attach')
      if (typeof attach !== 'function') throw new Error('Actual owner attach is unavailable')
      Reflect.set(owner, 'attach', async (...args: unknown[]) => {
        const result: unknown = await Reflect.apply(attach, owner, args)
        const driver: unknown = Reflect.get(owner, 'driver')
        if (driver === null || typeof driver !== 'object') throw new Error('Actual attached driver is unavailable')
        const advance: unknown = Reflect.get(driver, 'advance')
        if (typeof advance !== 'function') throw new Error('Actual driver advance is unavailable')
        Reflect.set(driver, 'advance', async (...advanceArgs: unknown[]) => {
          advancesStarted++
          try { const advanceResult: unknown = await Reflect.apply(advance, driver, advanceArgs); return advanceResult }
          catch (error) {
            driverErrors.push(error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { error })
            throw error
          }
          finally { advancesCompleted++ }
        })
        return result
      })
      await workspace.getByRole('button', { name: '打开运行', exact: true }).click()
      await workspace.getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      await page.getByRole('dialog', { name: /^(开始|继续)调度$/ }).getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      await expect.poll(() => Object.values(owned?.snapshot().world?.requests ?? {})
        .filter(value => value.source.kind === 'decision' && value.source.trigger !== undefined && value.status === 'committed').length, { timeout: 30000 }).toBe(1)
      if (mode === 'pause-race') await expect.poll(() => race !== undefined, { timeout: 30000 }).toBe(true)
      await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
      await expect.poll(() => owned?.snapshot().phase).toBe('paused')
      const admitted = advancesStarted
      if (mode === 'pause-race') releaseRace!()
      await expect.poll(() => advancesCompleted >= admitted, { timeout: 30000 }).toBe(true)
      if (mode === 'pause-race') {
        expect(requests.length).toBe(race!.modelCalls)
        const decision = race!.request.decisions[0]!
        expect(owned!.snapshot().decisionDispatch?.tickets[decision.id]).toEqual(race!.snapshot.decisionDispatch?.tickets[decision.id])
        expect(decision.wakeId).toBeDefined()
        expect(owned!.snapshot().wakes[decision.wakeId!]).toEqual(race!.snapshot.wakes[decision.wakeId!])
      }
      const state = structuredClone(owned!.snapshot()), scenario = Object.values(state.world!.requests)
        .find(value => value.source.kind === 'decision' && value.source.trigger !== undefined)!
      expect(scenario.notificationOperationId).toBeNull()
      expect(Object.values(state.world!.requests).filter(value => value.source.kind === 'decision' && value.source.trigger !== undefined)).toHaveLength(1)
      await workspace.getByRole('button', { name: '事项', exact: true }).click()
      await workspace.getByRole('button', { name: scenario.id, exact: true }).click()
      const inspector = workspace.getByRole('complementary')
      await inspector.getByRole('tab', { name: '计划', exact: true }).click()
      await inspector.getByText('没有生成 Persona。', { exact: true }).waitFor()
      await inspector.getByRole('tab', { name: '执行', exact: true }).click()
      await inspector.getByText('结果已记录', { exact: true }).waitFor()
      expect(await inspector.getByText('身份就绪，任职已提交', { exact: true }).count()).toBe(0)
      await inspector.getByRole('tab', { name: '通知', exact: true }).click()
      await inspector.getByText('该场景事项没有 Channel 申请通知。', { exact: true }).waitFor()
      await inspector.getByText('业务提交、发布、持久收件和 wake 完成是分别记录的事实；wake 完成不证明对方理解。', { exact: true }).waitFor()
      await inspector.getByText('案件已有终态，不能在此撤销已提交的业务结果。', { exact: true }).waitFor()
      await page.screenshot({ path: join(root, '01-native-scenario-no-channel.png'), animations: 'disabled' })
      expect(requests.length).toBeGreaterThan(beforeCalls)
      expect(creates).toHaveLength(1); expect(errors.pageErrors).toEqual([])
      const inspected = z.object({ result: z.object({ ok: z.literal(true), value: z.object({ runId: z.string() }) }) })
        .parse(caseResponses.at(-1))
      const finalControl = await scaffold.authenticatedRpc<SimulationProductControl>('simulation.runs.control', { runId: inspected.result.value.runId })
      expect(finalControl.result.ok).toBe(true)
      await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, mode, origin: scaffold.baseUrl,
        transport: 'actual HTTP/WebSocket and Loader; built frontend', browser: 'Playwright: Browser plugin not available',
        definition: expected, originalCommand: creates[0], pausedCreation: paused, pausedCreationModelCalls: 0,
        explicitStartModelCalls: requests.length - beforeCalls, modelRequests: requests, scenario, finalSnapshot: state, caseResponses,
        noHiringPersonaOrReservation: true, noRequestChannelPost: true, independentBudgetUnchangedWorldLimits: true,
        pauseRace: race, advancesStarted, advancesCompleted, driverErrors, finalControl, pageErrors: errors.pageErrors }, null, 2))
      expect(driverErrors).toEqual([])
      expect(finalControl.result.ok && finalControl.result.value.phase).toBe('paused')
      expect(finalControl.result.ok && finalControl.result.value.versions?.scenario).toMatchObject({
        status: 'observed', templateId: { text: 'clocky.world/v1/company' },
      })
      expect(finalControl.result.ok && finalControl.result.value.driver).not.toBe('failed')
      expect(await workspace.getByText('调度失败', { exact: true }).count()).toBe(0)
    } catch (error) {
      await page.screenshot({ path: join(root, 'failure.png'), animations: 'disabled' })
      await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText())
      throw error
    } finally {
      releaseRace?.()
      await writeFile(join(root, 'driver-errors.json'), JSON.stringify(driverErrors, null, 2))
      await browser.close(); await scaffold.close()
    }
  })
