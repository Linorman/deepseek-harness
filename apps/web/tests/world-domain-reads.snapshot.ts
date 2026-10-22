/** Browser plugin unavailable: actual Web/Product/Native reads render three authored v1 worlds without starting cognition. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { z } from 'zod'
import { expect, it } from 'vitest'
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { simulationProductWorldDomainResultSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import type { SimulationProductWorldDomainInput, SimulationProductWorldDomainResult } from '@clocky/clocky-simulation-product/world-read-types'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

const scenes = (process.env.WORLD_DOMAIN_UI_SCENES ?? 'company,laboratory,association').split(',')
it.each(['json', 'sqlite'].flatMap(backend => scenes.map(scene => ({ backend, scene }))))(
  'reads $backend $scene actual bounded domain windows and source navigation without inference', async ({ backend, scene }) => {
    const parent = resolve('.local/world-completion/u05-domain-ui/browser')
    await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, `${backend}-${scene}-`))
    const priorScene = process.env.WORLD_SCENARIO
    let metadata: unknown
    try {
      process.env.WORLD_SCENARIO = scene
      metadata = await import(`${pathToFileURL(resolve('examples/simulation-company/tests/fixtures/complete-world/source.ts')).href}?browser-scene=${scene}`)
    } finally {
      if (priorScene === undefined) Reflect.deleteProperty(process.env, 'WORLD_SCENARIO')
      else process.env.WORLD_SCENARIO = priorScene
    }
    const { definition, deployment } = z.object({ definition: worldScenarioV1Schema, deployment: scenarioV1CatalogSchema }).parse(metadata)
    const model: unknown = await import(pathToFileURL(resolve('examples/simulation-company/tests/fixtures/complete-world/model.ts')).href)
    const requests = z.object({ requests: z.custom<unknown[]>(Array.isArray) }).parse(model).requests
    const overlay = join(root, 'overlay.json')
    await writeFile(overlay, JSON.stringify([{ insert: [
      { name: '@clocky/clocky-simulation' },
      { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
      { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
        maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
      { name: '@clocky/clocky-simulation-world/providers' }, { name: '@clocky/clocky-tool-simulation' },
      { name: resolve('examples/simulation-company/tests/fixtures/complete-world/model.ts') },
      { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'domain-ui-directory', imports: [] } },
      { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'domain-ui-commands', templates: [],
        world: { provider: 'local', catalog: deployment, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 },
          authoringTemplates: [{ id: 'authored-world', version: '1', name: `实际 ${scene}`, definition }] },
        driverIntervalMs: 5, driverRetryMs: 10 } },
      { name: '@clocky/clocky-client-ui-simulation' },
    ] }, { id: 'modules', config: { browserConfig: { '@clocky/clocky-client-ui-simulation': { pageSize: 1, controlRefreshMs: 50 } } } }]))
    const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
      productPrincipalId: 'domain-ui-owner', retainedWorld: { workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions') },
      agentPresets: { default: 'simulation', roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' }] } })
    let owned: SimulationRun | undefined, opens = 0
    const observations: unknown[] = []
    const inspect = scaffold.ctx.simulations.inspect.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.inspect = async (...args) => {
      const value = await inspect(...args)
      observations.push({ requested: args[0], observed: value === undefined ? null
        : { runId: value.snapshot.spec.runId, revision: value.snapshot.revision, world: value.snapshot.world !== undefined } })
      return value
    }
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => { opens++; owned = await open(...args); return owned }
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    page.setDefaultTimeout(10000)
    const errors = watchConsole(page), consoleErrors: string[] = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    const queries: SimulationProductWorldDomainInput[] = [], replies: SimulationProductWorldDomainResult[] = []
    const rawReplies: unknown[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/api/simulation.world.domain.read')) queries.push((request.postDataJSON() as { payload: SimulationProductWorldDomainInput }).payload)
    })
    page.on('response', async (response) => {
      if (!response.url().endsWith('/api/simulation.world.domain.read')) return
      try {
        const data: unknown = await response.json()
        rawReplies.push(data)
        const parsed = z.object({ result: z.object({ ok: z.literal(true),
          value: simulationProductWorldDomainResultSchema }) }).safeParse(data)
        if (parsed.success) replies.push(parsed.data.result.value)
      } catch { /* Browser teardown can retire the body of a pending read; successful observations remain in the proof. */ }
    })
    try {
      await scaffold.authenticateBrowserPage(page); await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '仿真', exact: true }).click()
      const workspace = page.locator('[data-simulation-workspace-page]')
      await workspace.getByRole('button', { name: '新建世界', exact: true }).first().click()
      await page.getByRole('dialog', { name: '新建世界', exact: true }).getByRole('button', { name: `实际 ${scene}`, exact: false }).click()
      await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
      await expect.poll(() => workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isEnabled()).toBe(true)
      await workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).click()
      const confirmation = page.getByRole('dialog', { name: '创建暂停运行', exact: true })
      await confirmation.getByLabel('运行名', { exact: true }).fill(`Domain ${scene}`)
      await confirmation.getByRole('button', { name: '创建暂停运行', exact: true }).click()
      await workspace.getByRole('button', { name: '打开运行', exact: true }).click()
      await expect.poll(() => owned?.snapshot().phase).toBe('paused')
      await expect.poll(() => owned?.snapshot().latestCheckpointId !== undefined).toBe(true)
      const before = owned!.snapshot(), beforeCalls = requests.length, beforeOpens = opens
      await workspace.getByRole('button', { name: '组织', exact: true }).first().click()
      await workspace.getByTitle('覆盖范围：organization/structure', { exact: true }).first().waitFor()
      const more = workspace.getByRole('button', { name: '加载更多', exact: true })
      await more.click()
      await expect.poll(() => queries.some(input => input.kind === 'organization' && input.cursor !== undefined
        && input.expectedRevision === before.revision && input.readVersion !== undefined)).toBe(true)
      await workspace.getByRole('radio', { name: '人员', exact: true }).click()
      await workspace.getByTitle('覆盖范围：organization/people', { exact: true }).first().waitFor()
      const people = workspace.getByRole('table')
      await people.locator('tbody tr').first().click()
      const inspector = workspace.getByRole('complementary')
      await inspector.getByTitle('覆盖范围：person/identity', { exact: true }).first().waitFor()
      await inspector.locator('[data-ref-kind="entity"]').first().click()
      await expect.poll(() => new URL(page.url()).searchParams.get('simulationModule')).toBe('entities')
      await page.goBack()
      await workspace.getByTitle('覆盖范围：person/identity', { exact: true }).first().waitFor()
      await inspector.getByRole('tab', { name: '义务', exact: true }).click()
      await inspector.getByTitle('覆盖范围：person/obligations', { exact: true }).first().waitFor()
      await expect.poll(() => replies.some(value => value.kind === 'person' && 'section' in value.selection
        && value.selection.section === 'obligations' && value.status === 'found'
        && value.value?.obligations.every(item => item.original !== undefined) === true)).toBe(true)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const theme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
          await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(theme === 'dark')
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: join(root, `people-${theme}-${width}.png`), animations: 'disabled' })
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      await workspace.getByRole('button', { name: '制度', exact: true }).first().click()
      await workspace.getByRole('radio', { name: '现行制度', exact: true }).click()
      await workspace.getByTitle('覆盖范围：governance/norms', { exact: true }).first().waitFor()
      const norms = workspace.getByRole('table')
      if (definition.governance.norms.length > 0) {
        await norms.locator('tbody tr').first().click()
        await inspector.locator('[data-ref-kind="record"]').first().click()
        await expect.poll(() => new URL(page.url()).searchParams.get('simulationModule')).toBe('records')
      }
      await workspace.getByRole('button', { name: '外部世界', exact: true }).first().click()
      await workspace.getByTitle('覆盖范围：external/identities', { exact: true }).first().waitFor()
      const external = workspace.getByRole('table')
      if (definition.externalWorld.identities.length > 0) {
        await external.locator('tbody tr').first().click()
        await inspector.getByTitle('覆盖范围：identity/record', { exact: true }).first().waitFor()
        await inspector.getByRole('tab', { name: '已知事实', exact: true }).click()
        await inspector.getByTitle('覆盖范围：identity/facts', { exact: true }).first().waitFor()
      }
      expect(owned!.snapshot()).toEqual(before); expect(opens).toBe(beforeOpens); expect(requests).toHaveLength(beforeCalls)
      expect(await scaffold.ctx.sessionPersistence.list()).toEqual([])
      expect(errors.pageErrors).toEqual([]); expect(consoleErrors).toEqual([])
      await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, scene, queries, replies, before,
        browser: 'Browser plugin unavailable; project Playwright', noInference: true, noWritableOpen: true,
        entityAndRecordNavigation: true, themes: ['light', 'dark'], widths: [1440, 390] }, null, 2))
    } catch (error) {
      await page.screenshot({ path: join(root, 'failure.png') })
      await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText())
      await writeFile(join(root, 'failure-native.json'), JSON.stringify({ observations, state: owned?.snapshot() }, null, 2))
      await writeFile(join(root, 'failure-reads.json'), JSON.stringify({ queries, replies, rawReplies }, null, 2)); throw error
    } finally { await browser.close(); await scaffold.close() }
  })
