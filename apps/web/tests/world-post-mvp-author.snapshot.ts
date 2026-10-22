/** Browser plugin not available: maintained Playwright drives the actual Web/Loader/product and both persistence backends. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { z } from 'zod'
import { expect, it } from 'vitest'
import { WORLD_HIRING_MARKET_PIN } from '@clocky/clocky-simulation'
import { simulationProductWorldDomainResultSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import { worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { launchWebScaffold, watchConsole, acknowledgeReloadConnectionLoss } from './scaffold.ts'

it.each(['json', 'sqlite'] as const)('saves, conflicts and edits graph drafts through the actual %s authoring service', async (backend) => {
  const parent = resolve('.local/world-post-mvp/a1-browser', backend)
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'browser-'))
  const metadata: unknown = await import(pathToFileURL(resolve('examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts')).href)
  const installed = z.object({ worldV1Catalog: scenarioV1CatalogSchema, worldV1Definition: worldScenarioV1Schema }).parse(metadata)
  const model: unknown = await import(pathToFileURL(resolve('examples/simulation-company/tests/world-external-mediated-model.ts')).href)
  const calls = z.object({ mediatedModelRequests: z.custom<unknown[]>(Array.isArray) }).parse(model).mediatedModelRequests
  const definition = structuredClone(installed.worldV1Definition)
  installed.worldV1Catalog.domains.push({ pin: WORLD_HIRING_MARKET_PIN, available: true })
  definition.domains.push({ domain: WORLD_HIRING_MARKET_PIN.domain, operation: WORLD_HIRING_MARKET_PIN.operation,
    version: WORLD_HIRING_MARKET_PIN.version })
  const advisoryBody = 'PRIVATE-C32-ADVISORY-BODY-CANARY'
  definition.governance.norms.push({ id: 'advisory-authored-norm', scopeId: definition.organization.rootId,
    body: advisoryBody, effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' },
    enforcement: { kind: 'advisory' } })
  const before = calls.length
  const overlays = [{ insert: [
    { name: '@clocky/clocky-simulation' },
    { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
    { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
      maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
    { name: '@clocky/clocky-simulation-world/providers' },
    { name: '@clocky/clocky-tool-simulation' },
    { name: resolve('examples/simulation-company/tests/world-external-mediated-model.ts') },
    { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'v1-author-directory', imports: [],
      caseReaders: [{ principalId: 'v1-author-user', content: ['case', 'persona'] }],
      contextReaders: [{ principalId: 'v1-author-user', entityIds: ['director'], content: ['context'] }] } },
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
  const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage(), errors = watchConsole(page)
  const frames = resolve('.playwright-mcp', `gif-frames-post-mvp-${backend}`)
  await mkdir(frames, { recursive: true })
  const workspace = page.locator('[data-simulation-workspace-page]')
  const choose = async (target: typeof page) => {
    await scaffold.authenticateBrowserPage(target)
    await target.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await target.getByRole('button', { name: '仿真', exact: true }).click()
    await target.locator('[data-simulation-workspace-page] header').getByRole('button', { name: '新建世界', exact: true }).first().click()
    await target.getByRole('dialog', { name: '新建世界', exact: true }).getByRole('button', { name: /完整 v1 世界模板/ }).click()
  }
  try {
    await choose(page)
    const draftId = new URL(page.url()).searchParams.get('simulationAuthor')!
    await workspace.getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect.poll(() => workspace.getByText(/^已保存版本 0/).count()).toBe(1)
    await page.screenshot({ path: join(frames, '00-saved.png') })
    const graphChoice = workspace.getByRole('radio', { name: '组织图', exact: true })
    await graphChoice.focus()
    await page.keyboard.press('Space')
    expect(await graphChoice.isChecked()).toBe(true)
    await workspace.getByLabel('上级单位或目标岗位 ID', { exact: true }).fill(definition.organization.rootId)
    await workspace.getByLabel('新对象或任职 ID', { exact: true }).fill('research-unit')
    await workspace.getByLabel('名称与描述', { exact: true }).fill('研究部门')
    await workspace.getByRole('button', { name: '创建单位', exact: true }).click()
    await workspace.getByRole('button', { name: '研究部门 · research-unit', exact: true }).waitFor()
    const researchUnit = workspace.getByRole('button', { name: '研究部门 · research-unit', exact: true })
    await researchUnit.focus()
    await page.keyboard.press('Enter')
    await workspace.getByLabel('X', { exact: true }).fill('321')
    const yInput = workspace.getByLabel('Y', { exact: true })
    const unfocusedBorder = await yInput.evaluate(element => getComputedStyle(element.parentElement!).borderColor)
    await page.keyboard.press('Tab')
    expect(await yInput.evaluate(element => element === document.activeElement && element.matches(':focus-visible'))).toBe(true)
    await expect.poll(() => yInput.evaluate(element => getComputedStyle(element.parentElement!).borderColor)).not.toBe(unfocusedBorder)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText('-123')
    await page.keyboard.press('Tab')
    const applyLayout = workspace.getByRole('button', { name: '设置节点位置', exact: true })
    expect(await applyLayout.evaluate(element => element === document.activeElement)).toBe(true)
    await page.keyboard.press('Enter')
    await expect.poll(() => workspace.locator('[data-node-id="research-unit"]').getAttribute('transform')).toBe('translate(321 -123)')
    await workspace.getByLabel('搜索草稿对象', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(frames, '01-graph.png') })
    await workspace.getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect.poll(() => workspace.getByText(/^已保存版本 1/).count()).toBe(1)
    const second = await context.newPage()
    await choose(second)
    const other = second.locator('[data-simulation-workspace-page]')
    await other.getByLabel('已保存草稿 ID', { exact: true }).fill(draftId)
    await other.getByRole('button', { name: '打开已保存草稿', exact: true }).click()
    await expect.poll(() => other.getByText(/^已保存版本 1/).count()).toBe(1)
    await other.getByRole('radio', { name: '组织图', exact: true }).click()
    await expect.poll(() => other.locator('[data-node-id="research-unit"]').getAttribute('transform')).toBe('translate(321 -123)')
    await other.getByLabel('草稿名', { exact: true }).fill('另一个标签页的版本')
    await other.getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect.poll(() => other.getByText(/^已保存版本 2/).count()).toBe(1)
    await workspace.getByRole('button', { name: '保存草稿', exact: true }).click()
    await workspace.getByRole('heading', { name: '此草稿已有更新的保存版本', exact: true }).waitFor()
    await workspace.getByRole('table', { name: '变更字段', exact: true }).waitFor()
    await page.screenshot({ path: join(frames, '02-conflict.png') })
    await workspace.getByRole('button', { name: '载入已保存版本', exact: true }).click()
    await expect.poll(() => workspace.getByText(/^已保存版本 2/).count()).toBe(1)
    await page.screenshot({ path: join(frames, '03-resolved.png') })
    await workspace.getByRole('radio', { name: '组织图', exact: true }).click()
    const presentationProof: unknown[] = []
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport)
      const backgrounds: string[] = []
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme })
        await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(theme === 'dark')
        await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-clocky-theme-switching'))).toBe(false)
        const inspector = workspace.locator('aside')
        const proof = await inspector.evaluate(element => ({
          scheme: getComputedStyle(document.documentElement).colorScheme,
          background: getComputedStyle(document.body).backgroundColor,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          transition: getComputedStyle(element).transitionDuration,
          overflow: document.documentElement.scrollWidth - innerWidth,
        }))
        expect(proof.scheme).toBe(theme)
        expect(proof.reducedMotion).toBe(true)
        expect(proof.transition.split(',').every(value => Number.parseFloat(value) === 0)).toBe(true)
        expect(proof.overflow).toBeLessThanOrEqual(1)
        await expect.poll(() => workspace.evaluate(element => element.getAnimations({ subtree: true })
          .filter(animation => animation.playState === 'running').length)).toBe(0)
        backgrounds.push(proof.background)
        await page.screenshot({ path: join(root, `author-${viewport.width}-${theme}.png`) })
        if (viewport.width === 390) {
          await researchUnit.scrollIntoViewIfNeeded()
          await researchUnit.focus()
          await page.keyboard.press('Enter')
          expect(await researchUnit.evaluate(element => element === document.activeElement)).toBe(true)
          expect(await workspace.getByLabel('X', { exact: true }).inputValue()).toBe('321')
          await page.screenshot({ path: join(root, `author-narrow-list-${theme}.png`) })
          await graphChoice.scrollIntoViewIfNeeded()
        }
        presentationProof.push({ viewport, theme, ...proof })
      }
      expect(backgrounds[0]).not.toBe(backgrounds[1])
    }
    await writeFile(join(root, 'presentation-proof.json'), JSON.stringify({
      keyboard: ['Space selects graph', 'Enter selects equivalent list node', 'Tab reaches visible focus on Y', 'Tab then Enter applies original layout'],
      presentations: presentationProof,
    }, null, 2))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    await expect.poll(() => workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isEnabled()).toBe(true)
    await workspace.getByText('可移植模板包', { exact: true }).click()
    await workspace.getByLabel('模板包 ID', { exact: true }).fill('private-research')
    await workspace.getByLabel('模板包版本', { exact: true }).fill('1')
    await workspace.getByLabel('许可证标识', { exact: true }).fill('LicenseRef-Private')
    await workspace.getByLabel('许可证正文／声明', { exact: true }).fill('Private author distribution')
    const downloading = page.waitForEvent('download')
    await workspace.getByRole('button', { name: '导出模板包', exact: true }).click()
    const artifact = join(root, 'template-package.json')
    await (await downloading).saveAs(artifact)
    const exported = z.object({ apiVersion: z.literal('clocky.world-template/v1'), manifest: z.object({
      license: z.object({ identifier: z.literal('LicenseRef-Private') }), dependencies: z.object({ domains: z.array(z.unknown()).min(1) }) }) })
      .parse(JSON.parse(await readFile(artifact, 'utf8')))
    expect(exported.manifest.dependencies.domains.length).toBeGreaterThan(0)
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    await expect.poll(() => workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '创建暂停运行', exact: true })
    await confirm.getByLabel('运行名', { exact: true }).fill('Post MVP calendar')
    await confirm.getByRole('button', { name: '创建暂停运行', exact: true }).click()
    await workspace.getByRole('button', { name: '打开运行', exact: true }).click()
    // The future calendar lives with the other low-frequency tools behind the run management disclosure.
    await workspace.locator('[data-world-management] > summary').click()
    const calendar = workspace.getByRole('region', { name: '修改未来日历', exact: true })
    const rule = calendar.getByRole('button', { name: 'finite-stock-calendar · 1', exact: true })
    for (let window = 0; window < 8 && await rule.count() === 0; window++) {
      const response = page.waitForResponse((value) => {
        if (!value.url().endsWith('/api/simulation.world.domain.read')) return false
        const query = z.object({ payload: z.object({ cursor: z.string().optional() }) }).safeParse(value.request().postDataJSON())
        return query.success && query.data.payload.cursor !== undefined
      })
      await workspace.getByRole('button', { name: '加载更多', exact: true }).click()
      const body = z.object({ result: z.object({ ok: z.literal(true), value: z.object({ value:
        z.object({ calendars: z.array(z.object({ id: z.string() })).optional() }) }) }) }).parse(await (await response).json())
      if (body.result.value.value.calendars?.some(item => item.id === 'finite-stock-calendar')) { await rule.waitFor(); break }
    }
    if (!await rule.isEnabled()) {
      const recovered = page.waitForResponse(value => value.url().endsWith('/api/simulation.world.calendar.command'))
      await calendar.getByRole('button', { name: '恢复原日历命令', exact: true }).click()
      await writeFile(join(root, 'initial-calendar-recovery.json'), JSON.stringify(await (await recovered).json(), null, 2))
      await expect.poll(() => rule.isEnabled()).toBe(true)
    }
    await rule.click()
    await calendar.getByLabel('班次偏移（逗号分隔）', { exact: true }).fill('1')
    await calendar.getByRole('button', { name: '预览排班变更', exact: true }).click()
    const calendarAttempts: unknown[] = []
    await page.route('**/api/simulation.world.calendar.submit', async (route) => {
      calendarAttempts.push(z.object({ payload: z.unknown() }).parse(route.request().postDataJSON()).payload)
      if (calendarAttempts.length === 1) await route.abort('failed')
      else await route.continue()
    })
    await calendar.getByRole('button', { name: '确认排班变更', exact: true }).click()
    await calendar.getByText('结果未知。请重试原变更，不要创建另一命令。', { exact: true }).waitFor()
    const warningStart = errors.warnings.length
    await page.reload({ waitUntil: 'load' })
    await workspace.locator('[data-world-management] > summary').click()
    await calendar.getByRole('button', { name: '重试原排班变更', exact: true }).waitFor()
    acknowledgeReloadConnectionLoss(errors, warningStart)
    await calendar.getByRole('button', { name: '重试原排班变更', exact: true }).click()
    await expect.poll(() => calendarAttempts.length).toBe(2)
    expect(calendarAttempts[1]).toEqual(calendarAttempts[0])
    await writeFile(join(root, 'calendar-refresh-proof.json'), JSON.stringify({ calendarAttempts,
      claim: 'Original quote retained by Native before a lost execution request; refresh recovers the same original payload.' }, null, 2))
    await calendar.getByText('日历版本 2 已提交。', { exact: true }).waitFor()
    await page.screenshot({ path: join(root, 'calendar-completed.png') })
    await page.screenshot({ path: join(frames, '04-calendar.png') })
    await workspace.getByRole('button', { name: '组织', exact: true }).first().click()
    const market = workspace.getByRole('region', { name: '人物与录用邀约', exact: true })
    const marketToggle = market.getByRole('button', { name: '人物与录用邀约', exact: true })
    await marketToggle.click()
    await market.locator(`input[type="radio"][value="${definition.organization.positions[0]!.id}"]`).check()
    await market.getByRole('button', { name: '创建人物草稿', exact: true }).click()
    const personaDialog = page.getByRole('dialog', { name: '审核人物草稿', exact: true })
    await personaDialog.getByRole('button', { name: '创建人物草稿', exact: true }).click()
    await personaDialog.getByRole('radio', { name: 'Lin', exact: true }).check()
    await personaDialog.getByRole('checkbox', { name: 'engineering', exact: true }).check()
    const runId = new URL(page.url()).searchParams.get('simulation')!
    const committedPersona = async (status: string, revision: number) => {
      const response = await scaffold.authenticatedRpc<unknown>('simulation.world.domain.read', {
        runId, kind: 'hiring-market', family: 'persona-draft', limit: 32 })
      if (!response.result.ok) return false
      const read = simulationProductWorldDomainResultSchema.parse(response.result.value)
      return read.kind === 'hiring-market' && read.value?.rows.some(row => row.current && row.status === status && row.revision === revision)
    }
    const submitPersona = async (status: string, revision: number) => {
      await personaDialog.getByRole('button', { name: '预览影响', exact: true }).click()
      await expect.poll(() => personaDialog.getByRole('button', { name: '提交原命令', exact: true }).isEnabled()).toBe(true)
      await personaDialog.getByRole('button', { name: '提交原命令', exact: true }).click()
      await expect.poll(() => committedPersona(status, revision), { timeout: 15000 }).toBe(true)
      await personaDialog.getByRole('button', { name: '关闭', exact: true }).last().click()
      await marketToggle.click()
      const reread = page.waitForResponse(value => value.url().endsWith('/api/simulation.world.domain.read'))
      await marketToggle.click(); await reread
    }
    const findMarketAction = async (name: string) => {
      const action = market.getByRole('button', { name, exact: true })
      for (let window = 0; window < 8; window++) {
        const more = market.getByRole('button', { name: '加载更多', exact: true })
        await expect.poll(async () => await action.count() > 0 || await more.count() > 0).toBe(true)
        if (await action.count() > 0) break
        const nextPage = page.waitForResponse(value => value.url().endsWith('/api/simulation.world.domain.read'))
        await more.click(); await nextPage
      }
      await action.waitFor()
      return action
    }
    await submitPersona('draft', 1)
    await market.getByLabel('审核理由', { exact: true }).fill('有限字段已核对')
    await (await findMarketAction('标记已审核')).click()
    await submitPersona('reviewed', 1)
    await market.getByLabel('审核理由', { exact: true }).fill('请重新选择目标与姓名')
    await (await findMarketAction('退回人物设定')).click()
    await submitPersona('rejected', 1)
    await (await findMarketAction('修改／重新生成')).click()
    await personaDialog.getByRole('button', { name: '重新生成有限设定', exact: true }).click()
    await submitPersona('draft', 2)
    await (await findMarketAction('修改／重新生成')).waitFor()
    await market.getByRole('checkbox', { name: '对比版本 · r1', exact: true }).check()
    await market.getByRole('checkbox', { name: '对比版本 · r2', exact: true }).check()
    const comparison = market.getByRole('region', { name: '对比版本', exact: true })
    await comparison.getByRole('cell', { name: '"Lin"', exact: true }).waitFor()
    await comparison.getByRole('cell', { name: '"Director"', exact: true }).waitFor()
    await comparison.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(frames, '05-persona.png') })
    expect(calls.length).toBe(before)
    expect(errors).toEqual({ warnings: [], pageErrors: [] })
    await writeFile(join(root, 'provenance.json'), JSON.stringify({ backend, origin: scaffold.baseUrl,
      browser: 'Playwright; Browser plugin unavailable', transport: 'actual authenticated HTTP', modelCalls: 0,
      claim: 'Authoring never runs a model', draftId, frames }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText())
    const runId = new URL(page.url()).searchParams.get('simulation')
    if (runId !== null) await writeFile(join(root, 'failure-overview.json'), JSON.stringify(await scaffold.authenticatedRpc(
      'simulation.world.domain.read', { runId, kind: 'overview', limit: 32 }), null, 2))
    throw error
  } finally { await browser.close(); await scaffold.close() }
})
