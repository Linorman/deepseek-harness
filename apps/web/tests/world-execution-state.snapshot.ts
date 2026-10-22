/** Browser reads actual armed/blocked/committed cases through the real service and scripted Agent flow. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { z } from 'zod'
import { expect, it } from 'vitest'
import { scenarioCatalogSchema, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import type {} from '../../../examples/simulation-company/tests/world-driver-model.ts'

const modes = (process.env.WORLD_EXECUTION_UI_MODES ?? 'unknown,blocked,committed-unknown').split(',')
it.each(['json', 'sqlite'].flatMap(backend => modes.map(mode => ({ backend, mode }))))(
  'renders $backend actual $mode execution independently of business and navigation', async ({ backend, mode }) => {
    const parent = resolve('.local/world-completion/u04-execution-ui/browser')
    await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, `${backend}-${mode}-`))
    const metadata: unknown = await import(pathToFileURL(resolve('packages/simulation/simulation-scenario/tests/fixtures.ts')).href)
    const factory = z.object({ catalog: z.custom<() => unknown>(value => typeof value === 'function') }).parse(metadata)
    const installed = scenarioCatalogSchema.parse(factory.catalog())
    installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
    const overlay = join(root, 'overlay.json')
    await writeFile(overlay, JSON.stringify([{ insert: [
      { name: '@clocky/clocky-simulation' },
      { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
      { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
        maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
      { name: '@clocky/clocky-simulation-world/providers' },
      { name: '@clocky/clocky-tool-simulation' },
      { name: resolve('examples/simulation-company/tests/world-driver-model.ts') },
      { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'execution-ui-directory', imports: [] } },
      { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'execution-ui-commands', templates: [],
        world: { provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } },
        driverIntervalMs: 5, driverRetryMs: 10 } },
      { name: '@clocky/clocky-client-ui-simulation' },
    ] }, { id: 'modules', config: { browserConfig: {
      '@clocky/clocky-client-ui-simulation': { pageSize: 8, controlRefreshMs: 50 },
    } } }]))
    const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
      productPrincipalId: 'execution-ui-reader', agentPresets: { default: 'simulation',
        roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' }] } })
    expect(scaffold.ctx.get('simulationWorldExecutions')).toBeDefined()
    let owned: SimulationRun | undefined
    const held = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => {
      const run = await open(...args); owned = run
      const record = run.recordWorldExecution.bind(run), commit = run.commitWorldHire.bind(run)
      run.recordWorldExecution = async (...input) => {
        const value = await record(...input)
        if (mode === 'unknown' && value.phase === 'armed' && value.mode === 'execute') {
          held.resolve(undefined); await release.promise
        }
        return value
      }
      run.commitWorldHire = async (...input) => {
        const value = await commit(...input)
        if (mode === 'committed-unknown') { held.resolve(undefined); await release.promise }
        return value
      }
      return run
    }
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    const errors = watchConsole(page)
    const consoleErrors: string[] = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    try {
      await scaffold.authenticateBrowserPage(page)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '仿真', exact: true }).click()
      const workspace = page.locator('[data-simulation-workspace-page]')
      await workspace.getByRole('button', { name: '导入 World JSON', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '导入 World JSON', exact: true })
      const definition = worldScenarioSchema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8')))
      if (mode === 'blocked') definition.positions[0]!.capacity = 1
      await dialog.getByLabel('运行名称', { exact: true }).fill(`Execution ${mode}`)
      await dialog.getByLabel('可移植场景 JSON', { exact: true }).fill(JSON.stringify(definition))
      await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
      await dialog.getByRole('region', { name: 'World 创建预览', exact: true }).waitFor()
      await dialog.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
      await expect.poll(() => owned?.snapshot().phase).toBe('paused')
      await dialog.getByRole('button', { name: '打开已登记运行', exact: true }).click()
      await expect.poll(() => workspace.getByRole('button', { name: /^(开始|继续)调度$/ }).isEnabled()).toBe(true)
      await workspace.getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      await page.getByRole('dialog', { name: /^(开始|继续)调度$/ }).getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      if (mode === 'blocked') await expect.poll(() => Object.values(owned?.snapshot().world?.executions ?? {})[0]?.phase,
        { timeout: 30000 }).toBe('blocked')
      else await held.promise
      const state = owned!.snapshot(), request = Object.values(state.world!.requests)[0]!
      const calls = scaffold.ctx.worldDriverProbe.requests.length
      await workspace.getByRole('button', { name: '事项', exact: true }).first().click()
      await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
      await workspace.getByRole('button', { name: request.id, exact: true }).click()
      const inspector = workspace.getByRole('complementary')
      await inspector.getByRole('tab', { name: '执行', exact: true }).click()
      await inspector.getByText(mode === 'blocked' ? '执行受阻' : '执行结果未知', { exact: true }).waitFor()
      if (mode === 'committed-unknown') await inspector.getByText('结果已记录', { exact: true }).waitFor()
      else await inspector.getByText('尚无业务终态结果。', { exact: true }).waitFor()
      if (mode === 'blocked') await inspector.getByText('岗位容量已占满', { exact: true }).waitFor()
      else await inspector.getByText('原执行回调尚无确认结果', { exact: true }).waitFor()
      const viewPlan = inspector.getByRole('button', { name: '查看原计划', exact: true })
      await viewPlan.focus(); await page.keyboard.press('Enter')
      await inspector.getByText('已接受计划', { exact: false }).first().waitFor()
      await inspector.getByRole('tab', { name: '执行', exact: true }).click()
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const theme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
          await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(theme === 'dark')
          await inspector.getByRole('heading', { name: '执行确认' }).scrollIntoViewIfNeeded()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: join(root, `${theme}-${width}.png`), animations: 'disabled' })
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      await inspector.getByRole('tab', { name: '来源', exact: true }).click()
      for (const [kind, module] of [['decision', 'decisions'], ['checkpoint', 'checkpoints']] as const) {
        await inspector.locator(`[data-ref-kind="${kind}"]`).first().click()
        await expect.poll(() => new URL(page.url()).searchParams.get('simulationModule')).toBe(module)
        await page.goBack()
        await inspector.locator(`[data-ref-kind="${kind}"]`).first().waitFor()
      }
      const receipt = request.notificationOperationId === null ? undefined
        : state.operations[request.notificationOperationId]?.outbox?.receipt
      expect(receipt).toBeDefined()
      const channelBefore = await scaffold.ctx.teams.getChannel({ channelId: receipt!.channelId })
      await inspector.locator('[data-ref-kind="envelope"]').filter({ hasText: receipt!.envelopeId }).first().click()
      await expect.poll(() => new URL(page.url()).searchParams.get('envelope')).toBe(receipt!.envelopeId)
      const target = new URL(page.url()).searchParams
      expect(target.get('team')).toBe(receipt!.teamId)
      expect(target.get('channel')).toBe(receipt!.channelId)
      expect(target.get('envelopeSequence')).toBe(String(receipt!.sequence))
      await page.goBack()
      expect(await scaffold.ctx.teams.getChannel({ channelId: receipt!.channelId })).toEqual(channelBefore)
      await inspector.getByRole('tab', { name: '执行', exact: true }).click()
      await inspector.getByRole('button', { name: '查看恢复选项', exact: true }).click()
      await expect.poll(() => inspector.isVisible()).toBe(false)
      expect(scaffold.ctx.worldDriverProbe.requests).toHaveLength(calls)
      expect(owned!.snapshot()).toEqual(state)
      expect(errors.pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, mode, baseUrl: scaffold.baseUrl,
        browser: 'Browser plugin not available; project Playwright', calls, state, keyboard: true,
        themes: ['light', 'dark'], widths: [1440, 390], readOnlyNavigation: true, exactEnvelope: receipt }, null, 2))
      if (owned!.snapshot().phase === 'running') {
        await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
        await expect.poll(() => owned!.snapshot().phase).toBe('paused')
      }
    } catch (error) {
      await page.screenshot({ path: join(root, 'failure.png'), animations: 'disabled' })
      await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText()); throw error
    } finally { release.resolve(undefined); await browser.close(); await scaffold.close() }
  })
