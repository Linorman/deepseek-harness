/** Browser plugin not available: maintained Playwright drives the actual Web/Loader/product and both persistence backends. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { z } from 'zod'
import { expect, it } from 'vitest'
import { worldScenarioV1Schema, scenarioV1CatalogSchema, decodeScenarioInput, serializeScenarioDefinition } from '@clocky/clocky-simulation-scenario'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product/types'
import { forbiddenPayload } from '../../../examples/simulation-company/tests/world-external-boundary-cases.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it.each(['json', 'sqlite'] as const)('authors, previews and creates one paused v1 original through the real %s browser', async (backend) => {
  const parent = resolve('.local/world-completion/c32-v1-authoring', backend)
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'browser-'))
  const metadata: unknown = await import(pathToFileURL(resolve('examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts')).href)
  const installed = z.object({ worldV1Catalog: scenarioV1CatalogSchema, worldV1Definition: worldScenarioV1Schema }).parse(metadata)
  const model: unknown = await import(pathToFileURL(resolve('examples/simulation-company/tests/world-external-mediated-model.ts')).href)
  const calls = z.object({ mediatedModelRequests: z.custom<unknown[]>(Array.isArray) }).parse(model).mediatedModelRequests
  const definition = structuredClone(installed.worldV1Definition)
  const advisoryBody = 'PRIVATE-C32-ADVISORY-BODY-CANARY'
  definition.governance.norms.push({ id: 'advisory-authored-norm', scopeId: definition.organization.rootId,
    body: advisoryBody, effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' },
    enforcement: { kind: 'advisory' } })
  const original = JSON.stringify(definition), before = calls.length
  const overlays = [{ insert: [
    { name: '@clocky/clocky-simulation' },
    { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
    { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
      maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
    { name: '@clocky/clocky-tool-simulation' },
    { name: resolve('examples/simulation-company/tests/world-external-mediated-model.ts') },
    { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'v1-author-directory', imports: [] } },
    { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'v1-author-commands', templates: [],
      world: { provider: 'local', catalog: installed.worldV1Catalog, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 },
        authoringTemplates: [{ id: 'complete-v1', version: '1', name: '完整 v1 世界模板', definition }] },
      driverIntervalMs: 5, driverRetryMs: 10 } },
    { name: '@clocky/clocky-client-ui-simulation' },
  ] }, { id: 'modules', config: { browserConfig: {
    '@clocky/clocky-client-ui-simulation': { pageSize: 2, controlRefreshMs: 50, maxWorldDrafts: 4 },
  } } }]
  const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify(overlays))
  const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
    retainedWorld: { workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions') },
    productPrincipalId: 'v1-author-user', agentPresets: { default: 'simulation',
      roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' }] } })
  let owned: SimulationRun | undefined
  const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
  scaffold.ctx.simulations.open = async (...args) => { owned = await open(...args); return owned }
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const consoleErrors: string[] = [], consoleWarnings: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); else if (message.type() === 'warning') consoleWarnings.push(message.text()) })
  page.setDefaultTimeout(10000)
  page.on('dialog', (dialog) => { void dialog.accept() })
  const errors = watchConsole(page), creates: SimulationProductWorldCreateInput[] = []
  const boundaryReplies: unknown[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/simulation.world.create')) {
      creates.push((request.postDataJSON() as { payload: SimulationProductWorldCreateInput }).payload)
    }
  })
  const workspace = page.locator('[data-simulation-workspace-page]')
  const source = () => workspace.getByRole('textbox', { name: /^定义源码/ })
  const formView = () => workspace.getByRole('radio', { name: '表单', exact: true }).click()
  const sourceView = () => workspace.getByRole('radio', { name: '源码', exact: true }).click()
  const edit = async (table: string, row: number, column: number, text: string) => {
    const cell = workspace.locator(`[data-table="${table}"] [data-cell="${row}:${column}"]`)
    await cell.click(); await page.keyboard.press('Enter')
    const input = cell.locator('input,textarea,select').first()
    await input.fill(text); await input.press('Enter')
  }
  const readDraft = async () => {
    await sourceView()
    const decoded = decodeScenarioInput(await source().inputValue(), await workspace.getByRole('radio', { name: 'YAML', exact: true })
      .getAttribute('aria-checked') === 'true' ? 'yaml' : 'json')
    if (!decoded.ok) throw new Error(JSON.stringify(decoded.diagnostics))
    await formView()
    return decoded.value
  }
  const choose = async () => {
    await workspace.locator('header').getByRole('button', { name: '新建世界', exact: true }).focus(); await page.keyboard.press('Enter')
    return page.getByRole('dialog', { name: '新建世界', exact: true })
  }
  const leave = () => workspace.getByRole('button', { name: '← 目录', exact: true }).click()
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    expect(new URL(page.url()).origin).toBe(scaffold.baseUrl)
    expect(await page.title()).not.toBe('')
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    for (const family of ['url', 'network-adapter', 'email', 'payment', 'credential'] as const) {
      const attack = { ...definition, externalWorld: { ...definition.externalWorld,
        ...forbiddenPayload(`request-${family}`, {}) } }
      const reply = await scaffold.authenticatedRpc('simulation.world.preflight', { definition: attack })
      expect(reply.result).toMatchObject({ ok: false, error: { code: 'bad-request' } })
      boundaryReplies.push({ family, result: reply.result })
    }
    const sourcePreview = await scaffold.authenticatedRpc('simulation.world.preflight', { definition })
    expect(sourcePreview.result).toMatchObject({ ok: true, value: { status: 'ready',
      preview: { source: 'simulated-only' }, scope: { source: 'simulated-only' } } })
    expect(calls.length).toBe(before); expect(owned).toBeUndefined(); expect(creates).toEqual([])
    const chooser = await choose()
    await chooser.getByRole('button', { name: /完整 v1 世界模板/ }).waitFor()
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab')
      expect(await chooser.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    await chooser.getByRole('button', { name: /完整 v1 世界模板/ }).click()
    expect(await workspace.locator('[data-section]').count()).toBe(11)
    expect(await workspace.getByRole('columnheader', { name: '行操作', exact: true }).count()).toBeGreaterThan(0)
    expect(await workspace.getByText('已预留：当前安装的编译器尚不接受此分节', { exact: true }).count()).toBe(0)
    expect(await readDraft()).toEqual(definition)
    // Non-cognitive authoring entities retain graph layout without personnel commands.
    const graphObjects = [
      { id: 'graph-object', name: 'Graph object', description: 'Display object', kind: 'object', cognition: 'none' },
      { id: 'graph-environment', name: 'Graph environment', description: 'Supply', kind: 'environment', cognition: 'none',
        environment: { model: 'supply-seasonal/1', generation: 1, inventory: 10, committed: 4, capacity: 20,
          sourceLimit: 3, sinkLimit: 5, step: 1, lastTime: null } },
      { id: 'graph-person-state', name: 'Graph experience', description: 'Experience', kind: 'person-state', cognition: 'none',
        evolution: { personId: 'ceo', audience: ['ceo'], period: 10, versions: [] } },
    ]
    await leave()
    const graphChooser = await choose()
    await graphChooser.getByRole('button', { name: '从空白开始', exact: true }).click()
    await sourceView()
    await source().fill(JSON.stringify({ ...definition, entities: [...definition.entities, ...graphObjects] }))
    await workspace.getByRole('radio', { name: '组织图', exact: true }).click()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const object of graphObjects) {
        const node = workspace.locator(`[data-proxy-id="${object.id}"]`)
        expect(await node.getAttribute('aria-label')).toBe(`${object.name} · 对象`)
        await workspace.getByRole('button', { name: `${object.name} · ${object.id}`, exact: true }).click()
        await workspace.getByLabel('上级单位或目标岗位 ID', { exact: true }).fill(definition.organization.positions[0]!.id)
        await workspace.getByLabel('新对象或任职 ID', { exact: true }).fill('forbidden-graph-assignment')
        expect(await workspace.getByRole('button', { name: '移动或任职选中对象', exact: true }).isDisabled()).toBe(true)
      }
      await page.screenshot({ path: join(root, `generic-object-graph-${width}.png`), animations: 'disabled' })
    }
    await sourceView()
    await page.setViewportSize({ width: 1440, height: 1000 })
    const graphDraft = decodeScenarioInput(await source().inputValue(), 'json')
    expect(graphDraft).toMatchObject({ ok: true, value: { organization: { assignments: definition.organization.assignments } } })
    await workspace.getByRole('button', { name: '丢弃草稿', exact: true }).click()
    await page.getByRole('dialog', { name: '丢弃草稿', exact: true }).getByRole('button', { name: '丢弃草稿', exact: true }).click()
    const graphReturn = await choose()
    await graphReturn.getByRole('listitem').filter({ hasText: '完整 v1 世界模板' })
      .getByRole('button', { name: '继续编辑', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
    const templateSlot = new URL(page.url()).searchParams.get('simulationAuthor')!
    await leave()
    for (const format of ['json', 'yaml'] as const) {
      const dialog = await choose()
      await dialog.getByLabel('选择 JSON 或 YAML 文件', { exact: true }).setInputFiles({ name: `import-${format}.world.${format}`,
        mimeType: format === 'json' ? 'application/json' : 'application/yaml',
        buffer: Buffer.from(serializeScenarioDefinition(definition, format)) })
      expect(await readDraft()).toEqual(definition)
      expect(await source().count()).toBe(0)
      await leave()
    }
    const blank = await choose()
    const blankCard = blank.getByRole('button', { name: '从空白开始', exact: true })
    await blankCard.focus(); await page.keyboard.press('Enter')
    await sourceView()
    expect(z.object({ apiVersion: z.string() }).parse(JSON.parse(await source().inputValue())).apiVersion).toBe('clocky.world/v1')
    await source().fill(original)
    await formView()
    expect(await readDraft()).toEqual(definition)
    await workspace.getByRole('button', { name: '丢弃草稿', exact: true }).click()
    await page.getByRole('dialog', { name: '丢弃草稿', exact: true }).getByRole('button', { name: '丢弃草稿', exact: true }).click()
    const resume = await choose()
    await resume.getByRole('listitem').filter({ hasText: '完整 v1 世界模板' }).getByRole('button', { name: '继续编辑', exact: true }).click()
    expect(new URL(page.url()).searchParams.get('simulationAuthor')).toBe(templateSlot)
    const choice = workspace.locator('[data-table="identities"] [data-cell="0:3"]')
    await choice.focus(); await page.keyboard.press('F2')
    const choices = workspace.getByRole('combobox', { name: '表示方式 · 1', exact: true })
    await expect.poll(() => choices.evaluate(element => element === document.activeElement)).toBe(true)
    const currentChoice = definition.externalWorld.identities[0]!.representation
    expect(await choices.inputValue()).toBe(currentChoice)
    await page.keyboard.press('Enter')
    await expect.poll(() => choice.evaluate(element => element === document.activeElement)).toBe(true)
    expect(await readDraft()).toEqual(definition)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await choice.scrollIntoViewIfNeeded(); await choice.focus(); await page.keyboard.press('F2')
      const popup = page.getByRole('listbox', { name: '表示方式 · 1', exact: true })
      await popup.waitFor()
      const fits = await popup.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return rect.left >= 11 && rect.top >= 11 && rect.right <= innerWidth - 11 && rect.bottom <= innerHeight - 11
          && hit !== null && element.contains(hit)
      })
      expect(fits).toBe(true)
      await page.screenshot({ path: join(root, `choice-popup-${width}.png`), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await expect.poll(() => choice.evaluate(element => element === document.activeElement)).toBe(true)
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await sourceView(); await source().focus()
    expect(await source().evaluate(element => getComputedStyle(element).resize)).toBe('none')
    expect(await source().evaluate(element => getComputedStyle(element.parentElement!.parentElement!).outlineStyle)).toBe('solid')
    await page.keyboard.press('Escape'); await page.keyboard.press('Tab')
    expect(await source().evaluate(element => element === document.activeElement)).toBe(false)
    await formView()
    expect(await readDraft()).toEqual(definition)
    // Compound edits keep incomplete text in the shared model while switching to source and back.
    await edit('committees', 0, 4, '[{"id":')
    await sourceView()
    expect(z.object({ governance: z.object({ committees: z.array(z.object({ members: z.string() })) }) })
      .parse(JSON.parse(await source().inputValue())).governance.committees[0]!.members).toBe('[{"id":')
    await formView()
    await edit('committees', 0, 4, JSON.stringify(definition.governance.committees[0]!.members))
    // A real bad reference is diagnosed by the public compiler and locates its exact compound target cell.
    await edit('initialGoals', 0, 2, JSON.stringify({ kind: 'person', personId: 'missing-person' }))
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    const diagnostic = workspace.getByRole('button', { name: /定位.*ordinary-stock-goal/ }).first()
    expect(await diagnostic.innerText()).toContain('behavior.initialGoals.0.target.personId')
    await diagnostic.click()
    const target = workspace.locator('[data-table="initialGoals"] [data-cell="0:2"]')
    await expect.poll(() => target.evaluate(element => element === document.activeElement)).toBe(true)
    await page.screenshot({ path: join(root, '00-located-reference.png'), animations: 'disabled' })
    await edit('initialGoals', 0, 2, JSON.stringify(definition.behavior.initialGoals[0]!.target))
    await edit('committees', 0, 1, 'Authored committee')
    await edit('norms', 0, 2, 'Authored hiring institution')
    await edit('norms', 0, 4, '')
    await edit('resources', 0, 4, '8')
    await edit('identities', 0, 1, 'authored-vendor')
    await edit('initialGoals', 0, 3, 'Authored stock goal')
    const expected = structuredClone(definition)
    expected.governance.committees[0]!.name = 'Authored committee'
    expected.governance.norms[0]!.body = 'Authored hiring institution'
    expected.governance.norms[0]!.effectiveUntil = null
    expected.resources[0]!.quantity = worldScenarioV1Schema.shape.resources.element.shape.quantity.parse('8')
    expected.externalWorld.identities[0]!.externalKey = 'authored-vendor'
    expected.behavior.initialGoals[0]!.body = 'Authored stock goal'
    expect(await readDraft()).toEqual(expected)
    await sourceView(); await workspace.getByRole('radio', { name: 'YAML', exact: true }).click()
    const yaml = await source().inputValue(), decoded = decodeScenarioInput(yaml, 'yaml')
    expect(decoded.ok && decoded.value).toEqual(expected)
    await formView()
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    const preview = workspace.getByRole('region', { name: '预览', exact: true })
    await preview.locator('[data-world-simulated-only]').getByText('外部世界全部为模拟：不访问真实网络、付款或邮件。', { exact: true }).waitFor()
    expect(await preview.locator('[data-world-simulated-only]').evaluate(element => element.closest('details'))).toBeNull()
    await preview.getByText('Authored committee', { exact: true }).waitFor()
    await preview.getByText('clocky.organization.hiring-approval/1 · original-committee', { exact: true }).waitFor()
    await preview.getByText('validated', { exact: true }).waitFor()
    await preview.getByText('advisory', { exact: true }).waitFor()
    expect(await preview.innerText()).not.toContain(advisoryBody)
    await preview.getByText('world-external-mediated-scripted/scripted@1', { exact: true }).first().waitFor()
    await preview.locator('summary').filter({ hasText: '外部来源' }).click()
    await preview.getByText('全部为模拟，不访问真实网络、付款或邮件。', { exact: true }).waitFor()
    await preview.locator('summary').filter({ hasText: '额度' }).click()
    expect(await preview.innerText()).toContain('native.maxQueuedDecisions')
    expect(creates).toEqual([]); expect(calls.length).toBe(before)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      const drawer = workspace.getByRole('button', { name: /^检查结果 ·/ })
      if (width === 390) await drawer.click()
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(theme === 'dark')
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const quota = preview.locator('dt').filter({ hasText: 'native.maxQueuedDecisions' }).locator('..').locator('dd > span').first()
        expect(await quota.evaluate((element) => {
          const range = document.createRange(); range.selectNodeContents(element)
          return range.getClientRects().length
        })).toBe(1)
        expect(await workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isVisible()).toBe(true)
        await expect.poll(() => workspace.evaluate(element => element.getAnimations({ subtree: true })
          .filter(animation => animation.playState === 'running').length)).toBe(0)
        await page.screenshot({ path: join(root, `01-preview-${theme}-${width}.png`), animations: 'disabled' })
      }
      if (width === 390) await drawer.click()
    }
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ colorScheme: 'light' })
    await workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: '创建暂停运行', exact: true })
    await confirmation.getByLabel('运行名', { exact: true }).fill('Authored v1 browser')
    await confirmation.getByRole('button', { name: '创建暂停运行', exact: true }).dblclick()
    await workspace.getByRole('button', { name: '打开运行', exact: true }).waitFor()
    expect(creates).toHaveLength(1); expect(creates[0]!.definition).toEqual(expected)
    expect(calls.length).toBe(before)
    await expect.poll(() => owned?.snapshot().phase).toBe('paused')
    await expect.poll(() => owned?.snapshot().latestCheckpointId !== undefined).toBe(true)
    const state = owned!.snapshot(), revision = state.revision
    expect(state.latestCheckpointId).toBeDefined()
    expect(state.teamReservation?.confirmed).toBe(true)
    const team = await scaffold.ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
    const bindings = Object.values(state.entities).flatMap(entity => entity.binding === undefined ? [] : [entity.binding])
    expect(bindings).toHaveLength(definition.entities.filter(value => value.cognition === 'agent').length)
    for (const binding of bindings) {
      expect(team.participants.some(value => value.id === binding.participantId && value.kind === 'local-agent')).toBe(true)
      expect(await scaffold.ctx.sessionPersistence.isUnmaterialized(binding.sessionId)).toBe(true)
      expect(scaffold.ctx.agents.get(binding.sessionId)).toBeUndefined()
    }
    expect(await scaffold.ctx.sessionPersistence.list()).toEqual([])
    expect(state.decisions).toEqual({}); expect(state.operations).toEqual({})
    await workspace.getByRole('button', { name: '打开运行', exact: true }).click()
    await workspace.getByRole('heading', { name: 'Authored v1 browser', exact: true }).waitFor()
    await workspace.locator('[data-world-simulated-only]').waitFor()
    const exportDefinition = async (format: 'json' | 'yaml') => {
      await workspace.getByRole('button', { name: '导出定义', exact: true }).click()
      const download = page.waitForEvent('download')
      await page.getByRole('menuitem', { name: format === 'json' ? 'JSON' : '规范 YAML', exact: true }).click()
      const result = await download, file = join(root, `original-export.${format}`)
      await result.saveAs(file)
      const parsed = decodeScenarioInput(await readFile(file, 'utf8'), format)
      expect(parsed.ok && parsed.value).toEqual(expected)
    }
    await exportDefinition('json'); await exportDefinition('yaml')
    await page.reload({ waitUntil: 'load' })
    await workspace.getByRole('heading', { name: 'Authored v1 browser', exact: true }).waitFor()
    await workspace.locator('[data-world-simulated-only]').waitFor()
    await exportDefinition('json')
    expect(owned!.snapshot().revision).toBe(revision)
    expect(creates).toHaveLength(1); expect(calls.length).toBe(before)
    await page.screenshot({ path: join(root, '02-paused-original-reopened.png'), animations: 'disabled' })
    await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, browser: 'Playwright: Browser plugin not available',
      origin: scaffold.baseUrl, transport: 'actual HTTP/WebSocket and Loader', entryPaths: ['template', 'JSON file', 'YAML file', 'blank/source'],
      completeDefinition: expected, originalCommand: creates[0], incompleteCompoundRetained: true, exactDiagnosticFocus: true,
      themeWidths: ['light/1440', 'dark/1440', 'light/390', 'dark/390'], reducedMotion: true,
      modelCalls: calls.length - before, teamId: team.team.id, bindings, latestCheckpointId: state.latestCheckpointId,
      paused: true, exports: ['json', 'yaml'], reopenedUnchanged: true,
      keyboard: { currentChoiceRetained: true, focusRestored: true, popupInViewportAndHitTestable: [1440, 390], sourceEscapeTabExit: true },
      consoleErrors, consoleWarnings, pageTitle: await page.title(), url: page.url(),
      simulatedOnlyNotice: { preview: 'always-visible', run: 'persistent-after-reopen' }, pageErrors: errors.pageErrors }, null, 2))
    await writeFile(join(root, 'simulated-only-api-proof.json'), JSON.stringify({ backend, boundaryReplies,
      sourcePreview, allAttacksRefusedBeforeAllocation: true, modelCalls: calls.length - before }, null, 2))
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(errors.pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  } catch (error) {
    await page.screenshot({ path: join(root, 'failure.png'), animations: 'disabled' })
    await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText())
    throw error
  } finally { await browser.close(); await scaffold.close() }
})
