import { showSimulationMaintenance, showSimulationRequests } from './simulation-browser-controls.ts'
/** Real browser creation, original retries and explicit scheduling drive production actors without navigation inference. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { simulationKnowledgeRequestSchema } from '@clocky/clocky-simulation'
import { templateJSON } from '../../../examples/simulation-company/tests/sdk-product-template.ts'
import type {} from '../../../examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts'
import type { Context } from '@clocky/cordis'
import { inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../packages/core/team/tests/bootstrap-topology-authority.ts'

it.each(['json', 'sqlite'])('inputs, checkpoints and cold-recovers original simulations through the real Web carrier (%s)', async (backend) => {
  const root = join(process.cwd(), '.tmp-simulation-plan/web-maintenance', backend)
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'run-'))
  const fixture = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/cordis.yml')
  const patches = JSON.parse(await readFile(fixture, 'utf8')) as Array<{ insert?: Array<{ name: string; config?: Record<string, unknown> }> }>
  for (const row of patches[0]!.insert!) {
    if (row.name === '@clocky/clocky-simulation-local') row.config = { ...row.config, root: join(directory, 'world'), backend }
    if (row.name === '@clocky/clocky-simulation-product') row.config = { ...row.config,
      maxContextPartBytes: 256 }
    if (row.name.endsWith('/administration')) row.config = { ...row.config, templates: JSON.parse(templateJSON) as unknown[] }
    if (row.name === './model.ts') row.name = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts')
  }
  patches[0]!.insert!.push({ name: '@clocky/clocky-simulation-product/context-readers',
    config: { readers: [{ principalId: 'simulation-browser-user', entityIds: ['buyer'], content: ['context', 'knowledge', 'sources'] }] } })
  const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(patches))
  const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: directory,
    productPrincipalId: 'simulation-browser-user', agentPresets: { default: 'simulation',
      roots: [{ path: join(process.cwd(), 'examples/simulation-company/presets'), trust: 'system' }] } })
  const probe = scaffold.ctx.simulationBrowserProbe
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  const preparationWrites: unknown[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/simulation.runs.prepare') preparationWrites.push(request.postDataJSON())
  })
  const readEvidence: unknown[] = []
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (!['/api/simulation.objects.inspect', '/api/simulation.changes.watch', '/api/simulation.runs.inspect'].includes(path)) return
    void response.json().then((value: unknown) => {
      readEvidence.push({ path, value }); if (readEvidence.length > 32) readEvidence.shift()
    }, () => { /* Cancelled view responses carry no consumed observation. */ })
  })
  let dropInput = true
  let dropCheckpoint = true
  await page.route('**/api/simulation.ingress.create', async (route) => {
    if (dropInput) { dropInput = false; await route.fetch(); await route.abort('failed') }
    else await route.continue()
  })
  await page.route('**/api/simulation.checkpoints.create', async (route) => {
    if (dropCheckpoint) { dropCheckpoint = false; await route.fetch(); await route.abort('failed') }
    else await route.continue()
  })
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.locator('header').getByRole('button', { name: '新建仿真', exact: true }).click()
    const creation = page.getByRole('dialog', { name: '新建仿真', exact: true })
    await creation.getByRole('radio').check()
    await creation.getByLabel('运行名称', { exact: true }).fill('维护中的采购仿真')
    await creation.getByLabel('采购方名称', { exact: true }).fill('采购方')
    await creation.getByLabel('供应方名称', { exact: true }).fill('供应方')
    await creation.getByLabel('初始库存', { exact: true }).fill('2')
    await creation.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    await creation.getByRole('button', { name: '打开已登记运行', exact: true }).click()
    await showSimulationMaintenance(workspace)
    await expect.poll(async () => await workspace.getByRole('button', { name: '输入事件', exact: true }).isEnabled()).toBe(true)
    expect(probe.requests).toEqual([])
    // Explicit trusted fixture enrollment supplies independent Team reading; run ownership itself grants none.
    const teamId = probe.run!.snapshot().teamReservation!.teamId
    await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '实体', exact: true }).click()
    await workspace.getByRole('table').getByRole('button', { name: /^查看详情:/ }).first().click()
    await workspace.getByRole('link', { name: `查看关联 Team: ${teamId}`, exact: true }).click()
    await page.getByRole('alert').first().waitFor()
    expect(new URL(page.url()).searchParams.get('team')).toBe(teamId)
    expect(probe.requests).toEqual([])
    await page.goBack()
    await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '概览', exact: true }).click()
    const teamRunEntry = [...scaffold.ctx.loader.entries()].find(entry => entry.options.name === '@clocky/clocky-team-run')
    if (teamRunEntry === undefined) throw new Error('Browser composition has no TeamRun entry')
    await teamRunEntry.update({ disabled: true })
    const reader = await scaffold.ctx.plugin({ name: 'simulation-browser-reader', inject: ['teams'], async apply(fixture: Context) {
      let state = await fixture.teams.getTeam({ teamId })
      const human = await inviteBootstrapParticipant(fixture, { teamId, expectedCursor: state.team.cursor, kind: 'human',
        displayName: '仿真查看者', role: 'owner', capabilities: [], owner: { kind: 'product-principal', principalId: 'simulation-browser-user' as never },
        authorityGrant: { operations: ['activate', 'close', 'task-mutate', 'goal-mutate', 'invite', 'channel-open'],
          workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {} } })
      for (const phase of ['provisioning', 'active'] as const) {
        state = await fixture.teams.getTeam({ teamId })
        await transitionBootstrapParticipant(fixture, { teamId, participantId: human.id, expectedCursor: state.team.cursor, phase })
      }
    } })
    await reader.dispose()
    await teamRunEntry.update({ disabled: false })
    await scaffold.ctx.loader.await()
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '对账并完成准备', exact: true }).click()
    const preparation = page.getByRole('dialog', { name: '对账并完成准备', exact: true })
    await preparation.getByRole('button', { name: '对账并完成准备', exact: true }).click()
    await expect.poll(async () => {
      const query = preparation.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() > 0 && await query.isEnabled()) await query.click()
      return await preparation.getByText('原结果: 请求已完成', { exact: true }).count()
    }).toBe(1)
    const originalPreparationId = await preparation.getByRole('region', { name: '原操作', exact: true }).locator('code').first().innerText()
    const originalRunId = new URL(page.url()).searchParams.get('simulation')
    await preparation.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    await workspace.getByRole('button', { name: '返回运行列表', exact: true }).click()
    const retainedOriginals = workspace.locator('details').filter({ has: page.getByText(/^保留操作/) }).first()
    await retainedOriginals.locator('summary').first().click()
    await retainedOriginals.getByText(originalPreparationId, { exact: true }).waitFor({ state: 'visible' })
    await retainedOriginals.getByRole('button', { name: '检查原操作', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('simulation'), { timeout: 3000 }).toBe(originalRunId)
    const reopenedPreparation = page.getByRole('dialog', { name: '对账并完成准备', exact: true })
    await reopenedPreparation.waitFor()
    expect(new URL(page.url()).searchParams.get('simulation')).toBe(originalRunId)
    await reopenedPreparation.getByRole('region', { name: '原操作', exact: true })
      .getByText(originalPreparationId, { exact: true }).waitFor({ state: 'visible' })
    expect(preparationWrites).toHaveLength(1)
    await reopenedPreparation.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    expect(Object.keys(probe.run!.snapshot().checkpoints ?? {})).toHaveLength(2)
    expect(probe.requests).toEqual([])
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '输入事件', exact: true }).click()
    const input = page.getByRole('dialog', { name: '输入事件', exact: true })
    await input.getByRole('radio').first().check()
    await input.getByLabel('授权输入正文', { exact: true }).fill('原始授权输入')
    await input.getByLabel('最早可用模拟 tick', { exact: true }).fill('7')
    await input.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    await workspace.getByRole('button', { name: '实体', exact: true }).click()
    await workspace.getByRole('button', { name: '概览', exact: true }).click()
    await workspace.getByRole('button', { name: '继续保留输入', exact: true }).click()
    expect(await input.getByLabel('授权输入正文', { exact: true }).inputValue()).toBe('原始授权输入')
    await input.getByRole('button', { name: '输入事件', exact: true }).click()
    await input.getByText('响应丢失，请查询或重试原操作。', { exact: true }).waitFor()
    await input.getByLabel('授权输入正文', { exact: true }).fill('后来编辑的授权输入')
    await input.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    await workspace.getByRole('button', { name: '继续保留输入', exact: true }).click()
    await input.getByRole('button', { name: '查询原结果', exact: true }).click()
    await input.getByText('原结果: 输入待消费', { exact: true }).waitFor()
    expect(Object.keys(probe.run!.snapshot().ingresses ?? {})).toHaveLength(1)
    expect(probe.requests).toEqual([])
    await page.screenshot({ path: join(root, '01-assigned-input-desktop.png'), animations: 'disabled' })
    await input.getByRole('button', { name: '关闭并保留回执', exact: true }).click()
    probe.release()
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await workspace.getByText('此场景已完成。', { exact: true }).waitFor()
    const originalId = Object.keys(probe.run!.snapshot().ingresses ?? {})[0]!
    await showSimulationRequests(workspace)
    const retained = workspace.getByRole('region', { name: '持久原请求', exact: true })
    const originalInput = retained.getByRole('region', { name: '原操作' }).filter({ hasText: originalId })
    await originalInput.getByRole('button', { name: '查询原结果', exact: true }).click()
    await originalInput.getByText('原结果: 输入已消费', { exact: true }).waitFor()
    await originalInput.getByText(/消费决策:/).waitFor()
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '创建完整检查点', exact: true }).click()
    const checkpoint = page.getByRole('dialog', { name: '创建完整检查点', exact: true })
    await checkpoint.getByRole('button', { name: '创建完整检查点', exact: true }).click()
    await checkpoint.getByText('响应丢失，请查询或重试原操作。', { exact: true }).waitFor()
    await checkpoint.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    await retained.getByRole('button', { name: '检查原操作', exact: true }).last().click()
    await checkpoint.getByRole('button', { name: '查询原结果', exact: true }).click()
    await expect.poll(async () => {
      const query = checkpoint.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() > 0 && await query.isEnabled()) await query.click()
      return await checkpoint.getByText('原结果: 请求已完成', { exact: true }).count()
    }).toBe(1)
    expect(probe.run!.snapshot().phase).toBe('paused')
    const reportSource = Object.values(probe.run!.snapshot().operations).find(operation => operation.action.kind === 'communication/post'
      && operation.action.recipient === 'buyer' && operation.delivery?.receipt !== undefined)
    if (reportSource?.action.kind !== 'communication/post') throw new Error('Production procurement has no delivered buyer report')
    await probe.run!.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'browser-report', owner: 'buyer', expectedRevision: 0,
      statement: reportSource.action.text, source: { kind: 'report', operationId: reportSource.id },
      observedAt: probe.run!.snapshot().time, availableAt: probe.run!.snapshot().time, validFrom: '0', validUntil: null, readers: [] }))
    const before = probe.run!.snapshot()
    const inferenceCount = probe.requests.length
    await checkpoint.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '实体', exact: true }).click()
    await workspace.getByRole('table').getByRole('button', { name: /^查看详情:/ }).first().click()
    const entityInspector = workspace.getByRole('complementary', { name: '查看详情', exact: true })
    const entityUrl = page.url()
    await entityInspector.getByRole('link', { name: /^查看精确 Team Session:/ }).click()
    const sessionInspector = page.locator('[data-conversation-pane]')
    await sessionInspector.getByText('此会话由仿真管理执行，仅供查看记录。请在仿真运行页输入事件或控制调度。', { exact: true }).waitFor()
    expect(await sessionInspector.locator('textarea').count()).toBe(0)
    const linkedPage = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
    try {
      await scaffold.authenticateBrowserPage(linkedPage)
      await linkedPage.goto(page.url(), { waitUntil: 'load' })
      const linkedSession = linkedPage.locator('[data-conversation-pane]')
      await linkedSession.getByText('此会话由仿真管理执行，仅供查看记录。请在仿真运行页输入事件或控制调度。', { exact: true }).waitFor()
      expect(await linkedSession.locator('textarea').count()).toBe(0)
      expect(new URL(linkedPage.url()).searchParams.get('session')).toBe(new URL(page.url()).searchParams.get('session'))
      await linkedPage.screenshot({ path: join(root, '08-linked-session-narrow.png'), animations: 'disabled' })
    } catch (cause: unknown) {
      await linkedPage.screenshot({ path: join(root, 'linked-failure.png') })
      await writeFile(join(root, 'linked-failure.txt'), await linkedPage.locator('body').innerText())
      throw cause
    } finally { await linkedPage.close() }
    const teamWorkspace = page.locator('[data-team-workspace-page]')
    await sessionInspector.getByRole('button', { name: '关闭对话', exact: true }).click()
    await teamWorkspace.getByText('由仿真管理执行。此处仅供检查；请在仿真页面进行调度、恢复和输入事件。', { exact: true }).waitFor()
    expect(await teamWorkspace.getByRole('button', { name: '邀请成员', exact: true }).count()).toBe(0)
    expect(await teamWorkspace.getByRole('button', { name: '恢复', exact: true }).count()).toBe(0)
    await page.goBack()
    // Closing a Session is another view-history entry; return to the original entity selection.
    if (new URL(page.url()).searchParams.get('workspace') !== 'simulation') await page.goBack()
    await entityInspector.getByRole('link', { name: /^查看精确 Team Session:/ }).waitFor()
    expect(page.url()).toBe(entityUrl)
    expect(probe.run!.snapshot()).toEqual(before)
    expect(probe.requests.length).toBe(inferenceCount)
    const publication = Object.values(before.operations).find(operation => operation.entityId === 'buyer' && (operation.outbox?.attempts.length ?? 0) > 0)
    if (publication === undefined) throw new Error('Production scenario has no recorded publication attempt')
    const detailUrl = new URL(page.url())
    detailUrl.searchParams.set('simulationModule', 'operations')
    detailUrl.searchParams.set('simulationObject', publication.id)
    detailUrl.searchParams.set('simulationSection', 'attempts')
    await page.evaluate((url) => {
      window.history.pushState(null, '', url)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, detailUrl.href)
    const inspector = workspace.getByRole('complementary', { name: '查看详情' })
    await inspector.getByText(`匹配记录: ${publication.outbox!.attempts.length}`, { exact: true }).waitFor()
    await page.route('**/api/simulation.objects.inspect', async (route) => { await route.abort('failed') }, { times: 1 })
    await inspector.getByRole('button', { name: '刷新详情', exact: true }).click()
    await inspector.getByText('读取失败，已保留可读内容；连接恢复后可重试。', { exact: true }).waitFor()
    await inspector.getByText(`匹配记录: ${publication.outbox!.attempts.length}`, { exact: true }).waitFor()
    expect(await inspector.getByRole('button', { name: '下一页', exact: true }).isEnabled()).toBe(false)
    await inspector.getByRole('button', { name: '刷新详情', exact: true }).click()
    await expect.poll(async () => await inspector.getByRole('alert').count()).toBe(0)
    await inspector.getByRole('button', { name: '执行', exact: true }).click()
    await inspector.getByRole('button', { name: publication.decisionId, exact: true }).click()
    await inspector.getByText('冻结世界版本', { exact: true }).waitFor()
    await inspector.getByRole('button', { name: '本次仿真上下文', exact: true }).click()
    const frozenDecision = before.decisions[publication.decisionId]!
    if (frozenDecision.context?.status !== 'prepared') throw new Error('Production decision has no frozen context')
    await inspector.getByText('实际模型请求还可能包含 Session 历史、系统提示和工具定义。', { exact: false }).waitFor()
    const access = frozenDecision.entityId === 'buyer' ? '当前查看主体获准读取此实体已记录的上下文正文。'
      : '上下文正文未公开；读取需要部署显式授予此实体的正文权限。'
    await inspector.getByText(access, { exact: true }).first().waitFor()
    const frozenText = frozenDecision.context.view.content[0]!.blocks[0]!
    if (frozenText.type !== 'text') throw new Error('Production context has no approved first text block')
    const visibleText = await inspector.locator('pre').first().textContent()
    expect(visibleText !== null && frozenText.text.startsWith(visibleText)).toBe(true)
    await page.screenshot({ path: join(root, '04-frozen-context-desktop.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
    await inspector.locator('pre').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(root, '05-frozen-context-narrow.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    const firstContext = await inspector.locator('li').allTextContents()
    await inspector.getByRole('button', { name: '下一页', exact: true }).click()
    await expect.poll(async () => await inspector.locator('li').allTextContents()).not.toEqual(firstContext)
    await inspector.getByRole('button', { name: '返回首页', exact: true }).click()
    await expect.poll(async () => await inspector.locator('li').allTextContents()).toEqual(firstContext)
    const policyEntry = [...scaffold.ctx.loader.entries()].find(entry => entry.options.name === '@clocky/clocky-simulation-product/context-readers')
    if (policyEntry === undefined) throw new Error('No independently owned context policy')
    const oldReadEntered = Promise.withResolvers<undefined>(), oldReadRelease = Promise.withResolvers<undefined>()
    const oldReadSettled = Promise.withResolvers<undefined>()
    let holdNextContext = true, policyRetired = false
    const holdContext = async (route: import('playwright').Route) => {
      if (!holdNextContext) { await route.continue(); return }
      holdNextContext = false
      const response = await route.fetch()
      oldReadEntered.resolve(undefined)
      await oldReadRelease.promise
      try { await route.fulfill({ response }) }
      catch (cause: unknown) { if (!policyRetired) throw cause }
      finally { oldReadSettled.resolve(undefined) }
    }
    await page.route('**/api/simulation.objects.inspect', holdContext)
    try {
      const refreshDetail = inspector.getByRole('button', { name: '刷新详情', exact: true })
      await refreshDetail.click()
      await oldReadEntered.promise
      await inspector.getByText('读取中…', { exact: true }).waitFor()
      expect(await refreshDetail.isDisabled()).toBe(true)
      await policyEntry.update({ disabled: true })
      policyRetired = true
      await inspector.getByText('上下文正文未公开；读取需要部署显式授予此实体的正文权限。', { exact: true }).first().waitFor()
      await expect.poll(async () => await refreshDetail.isEnabled()).toBe(true)
      expect(await inspector.getByText('读取中…', { exact: true }).count()).toBe(0)
      oldReadRelease.resolve(undefined)
      await oldReadSettled.promise
      expect(await inspector.locator('pre').count()).toBe(0)
      await page.screenshot({ path: join(root, '06a-watch-retired-pending-context.png'), animations: 'disabled' })
    } finally { oldReadRelease.resolve(undefined); await page.unroute('**/api/simulation.objects.inspect', holdContext) }
    await inspector.getByText('上下文正文未公开；读取需要部署显式授予此实体的正文权限。', { exact: true }).first().waitFor()
    expect(await inspector.locator('pre').count()).toBe(0)
    expect(probe.run!.snapshot()).toEqual(before)
    expect(probe.requests).toHaveLength(inferenceCount)
    await page.screenshot({ path: join(root, '06-policy-revoked.png'), animations: 'disabled' })
    await policyEntry.update({ disabled: false })
    await inspector.getByText('当前查看主体获准读取此实体已记录的上下文正文。', { exact: true }).waitFor()
    await inspector.locator('pre').first().waitFor()
    const knowledgeUrl = new URL(page.url())
    knowledgeUrl.searchParams.set('simulationModule', 'entities'); knowledgeUrl.searchParams.set('simulationObject', 'buyer')
    knowledgeUrl.searchParams.set('simulationSection', 'knowledge')
    await page.evaluate((url) => { window.history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')) }, knowledgeUrl.href)
    await inspector.getByText('原始已送达报告正文', { exact: true }).waitFor()
    await expect.poll(async () => await inspector.locator('pre').allTextContents()).toEqual([reportSource.action.text, reportSource.action.text])
    await policyEntry.update({ config: { readers: [{ principalId: 'simulation-browser-user', entityIds: ['buyer'], content: ['context', 'knowledge'] }] } })
    await inspector.getByText('读取来源原文需要独立来源公开权限。', { exact: true }).waitFor()
    expect(await inspector.locator('pre').allTextContents()).toEqual([reportSource.action.text])
    await page.screenshot({ path: join(root, '07-knowledge-report-source.png'), animations: 'disabled' })
    await policyEntry.update({ disabled: true })
    await inspector.getByText('当前查看主体没有此实体的当前知识公开权限。', { exact: true }).waitFor()
    expect(await inspector.locator('pre').count()).toBe(0)
    await policyEntry.update({ disabled: false })
    await inspector.getByText('读取来源原文需要独立来源公开权限。', { exact: true }).waitFor()
    const originalDecisionUrl = new URL(page.url())
    originalDecisionUrl.searchParams.set('simulationModule', 'decisions'); originalDecisionUrl.searchParams.set('simulationObject', publication.decisionId)
    originalDecisionUrl.searchParams.delete('simulationSection')
    await page.evaluate((url) => { window.history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')) }, originalDecisionUrl.href)

    await inspector.getByRole('button', { name: '执行', exact: true }).click()
    await inspector.getByRole('button', { name: '查看决策操作', exact: true }).click()
    await workspace.getByText(`决策: ${publication.decisionId}`, { exact: true }).waitFor()
    expect(new URL(page.url()).searchParams.get('simulationDecision')).toBe(publication.decisionId)
    await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '检查点', exact: true }).click()
    await workspace.getByRole('table').getByRole('button', { name: /^查看详情:/ }).first().click()
    await expect.poll(async () => await inspector.getByRole('button', { name: '下一页', exact: true }).isEnabled()).toBe(true)
    const firstReferences = await inspector.locator('dd code').allTextContents()
    await inspector.getByRole('button', { name: '下一页', exact: true }).click()
    await expect.poll(async () => await inspector.locator('dd code').allTextContents()).not.toEqual(firstReferences)
    await inspector.getByRole('button', { name: '返回首页', exact: true }).click()
    await expect.poll(async () => await inspector.locator('dd code').allTextContents()).toEqual(firstReferences)
    await page.setViewportSize({ width: 390, height: 844 })
    await inspector.getByRole('button', { name: '下一页', exact: true }).scrollIntoViewIfNeeded()
    for (const name of ['返回集合', '刷新详情', '返回首页', '下一页']) {
      const control = inspector.getByRole('button', { name, exact: true })
      await control.scrollIntoViewIfNeeded()
      const box = await control.boundingBox()
      expect(box !== null && box.x >= 0 && box.x + box.width <= 390).toBe(true)
    }
    await page.screenshot({ path: join(root, '03-reference-pagination-narrow.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '概览', exact: true }).click()
    expect(probe.run!.snapshot()).toEqual(before)
    expect(probe.requests).toHaveLength(inferenceCount)
    const administrativeEntry = [...scaffold.ctx.loader.entries()].find(entry => entry.options.name === '@clocky/clocky-simulation-product/administration')
    if (administrativeEntry === undefined) throw new Error('No Loader-owned administrative entry')
    await administrativeEntry.update({ disabled: true })
    await administrativeEntry.update({ disabled: false })
    await scaffold.ctx.loader.await()
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '刷新控制状态', exact: true }).click()
    await showSimulationMaintenance(workspace)
    await expect.poll(async () => await workspace.getByRole('button', { name: '验证并恢复运行', exact: true }).isEnabled()).toBe(true)
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    const recovery = page.getByRole('dialog', { name: '验证并恢复运行', exact: true })
    await recovery.getByText('检查点发布时间（真实时间）', { exact: true }).waitFor()
    await recovery.getByText(/不回滚历史/).waitFor()
    // Cold owner retirement can advance the world after the first source read.
    await recovery.getByRole('button', { name: '返回首页', exact: true }).click()
    await expect.poll(async () => {
      const refreshSources = recovery.getByRole('button', { name: '返回首页', exact: true })
      if (await recovery.getByText('观察已变化，请刷新首页。', { exact: true }).first().isVisible() && await refreshSources.isEnabled()) {
        await refreshSources.click()
      }
      return await recovery.getByRole('button', { name: '验证并恢复运行', exact: true }).isEnabled()
    }).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(root, '02-cold-recovery-narrow.png'), animations: 'disabled' })
    await recovery.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    await expect.poll(async () => {
      const query = recovery.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() > 0 && await query.isEnabled()) await query.click()
      return await recovery.getByText('原结果: 请求已完成', { exact: true }).count()
    }).toBe(1)
    const after = probe.run!.snapshot()
    expect(after.phase).toBe('paused')
    expect(after.resources).toEqual(before.resources)
    expect(after.time).toBe(before.time)
    expect(after.decisions).toEqual(before.decisions)
    expect(probe.requests).toHaveLength(inferenceCount)
    expect(Object.keys(after.ingresses ?? {})).toEqual([originalId])
    await recovery.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    await workspace.getByRole('button', { name: '继续保留输入', exact: true }).click()
    expect(await input.getByLabel('授权输入正文', { exact: true }).inputValue()).toBe('后来编辑的授权输入')
    await input.getByLabel('最早可用模拟 tick', { exact: true }).fill('100')
    await input.getByRole('button', { name: '输入事件', exact: true }).click()
    await input.getByText('原结果: 输入待消费', { exact: true }).waitFor()
    expect(Object.keys(probe.run!.snapshot().ingresses ?? {})).toHaveLength(2)
    expect(probe.requests).toHaveLength(inferenceCount)
    expect(errors.pageErrors).toEqual([])
    expect(errors.warnings).toEqual([])
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), JSON.stringify({ url: page.url(), body: await page.locator('body').innerText(), errors, readEvidence, world: probe.run?.snapshot() }, null, 2))
    throw cause
  } finally { probe.release(); await page.close(); await browser.close(); await scaffold.close() }
}, 120000)
