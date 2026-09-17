import type { TeamBrowsePage } from '@clocky/clocky-team'
/** Bounded Team collections retain visible rows and updates across failed real-carrier reads. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { Route } from 'playwright'
import { expect, it } from 'vitest'
import type { TeamStateSnapshot, TeamWorkflowPlanSnapshot } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it('retains bounded task and member pages after failed continuation reads and offers a current refresh', async () => {
  const output = join(process.cwd(), '.tmp/gap-collections-2026-09-10')
  await mkdir(output, { recursive: true })
  const planInput = { version: 1, name: '分页工作流',
    tasks: ['prepare', 'report'].map((id, index) => ({ id, subject: index === 0 ? '准备数据' : '生成报告',
      description: '工作流任务详情。', blockedBy: index === 0 ? [] : ['prepare'], requiredCapabilities: ['team-default-worker'],
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 })),
    bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 },
    channel: { participantRoles: ['coordinator', 'worker'], viewPolicy: { type: 'recent-window', version: 1 },
      graph: { initial: { kind: 'participant', role: 'coordinator' },
        transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
    result: { kind: 'task-results', taskTemplateIds: ['prepare', 'report'] } }
  const toolStep = (id: string, name: string, args: unknown) => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] })
  const replay = join(output, 'workflow-replay.json')
  await writeFile(replay, JSON.stringify([
    toolStep('invalid-workflow-policy', 'team_workflow_start', { plan: { ...planInput, name: '缺少策略的工作流',
      channel: { ...planInput.channel, viewPolicy: undefined } } }),
    toolStep('collection-workflow', 'team_workflow_start', { plan: planInput }),
    toolStep('collection-workflow-message', 'team_message', {
      channel_id: '{{fromRequest:进度通道=(channel-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})}}',
      text: '工作流已创建。', delivery: 'context',
    }),
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '工作流已创建。' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
  ]))
  const scaffold = await launchWebScaffold({
    extraOverlayPath: join(process.cwd(), 'examples/headless-agent/tests/fixtures/team-collections-browser.cordis.yml'),
    replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'), replayOverride: replay,
  })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  let created: TeamStateSnapshot | undefined
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${response.result.error.message}`)
    return response.result.value
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    const objective = '验证分页内容保留'
    created = await rpc<TeamStateSnapshot>('team.create', { objective, cwd: scaffold.workspaceCwd })
    const teamId = created.team.id
    const state = () => rpc<TeamStateSnapshot>('team.get', { teamId })
    const createTask = async (subject: string) => await rpc('team.task.create', {
      teamId, expectedCursor: (await state()).team.cursor, idempotencyKey: subject,
      subject, description: subject, blockedBy: [], requiredCapabilities: ['unmatched-pagination-capability'],
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    }).catch(async (error: unknown) => {
      const latest = await state()
      throw new Error(`${subject}: ${latest.team.phase} ${JSON.stringify(latest.team.stallReason)}`, { cause: error })
    })
    const invite = async (displayName: string) => await rpc('team.member.invite', {
      teamId, expectedCursor: (await state()).team.cursor, kind: 'local-agent', role: 'worker', displayName, capabilities: [],
    })
    for (let index = 0; index < 65; index++) await createTask(`分页任务 ${String(index).padStart(2, '0')}`)
    for (let index = created.participants.length; index < 65; index++) await invite(`分页成员 ${String(index).padStart(2, '0')}`)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: `${objective} 进行中`, exact: true }).click()
    const panel = page.locator('[data-team-workspace-page]')
    const navigation = panel.getByRole('navigation', { name: '团队模块' })
    const showWorkflows = async () => {
      await navigation.locator('button[aria-expanded]').click()
      await page.getByRole('menuitem', { name: '工作流', exact: true }).click()
    }
    await navigation.getByRole('button', { name: '任务', exact: true }).click()
    const tasks = panel.getByRole('region', { name: '执行任务', exact: true })
    const firstTaskPage = await rpc<TeamBrowsePage>('team.browse', { teamId, kind: 'tasks', afterCursor: -1, limit: 64 })
    if (firstTaskPage.kind !== 'tasks' || firstTaskPage.nextCursor === undefined) throw new Error('Expected task summary continuation')
    const secondTaskPage = await rpc<TeamBrowsePage>('team.browse', { teamId, kind: 'tasks', afterCursor: firstTaskPage.nextCursor, limit: 64 })
    const firstTaskCount = firstTaskPage.items.length
    const secondTaskCount = secondTaskPage.items.length
    expect(firstTaskCount).toBeGreaterThan(0)
    expect(firstTaskCount).toBeLessThanOrEqual(64)
    expect(Buffer.byteLength(JSON.stringify(firstTaskPage))).toBeLessThanOrEqual(16384)

    const members = panel.getByRole('region', { name: '参与者', exact: true })
    await expect.poll(() => tasks.locator('tbody tr').count()).toBe(firstTaskCount)
    const taskSearch = tasks.getByRole('textbox', { name: '仅搜索已加载任务' })
    await taskSearch.fill('分页任务')
    await tasks.getByRole('button', { name: '分页任务 00', exact: true }).click()
    const selectedTask = panel.getByRole('complementary', { name: '任务摘要' })
    await selectedTask.waitFor()
    await tasks.getByRole('button', { name: '下一页任务', exact: true }).click()
    await expect.poll(() => tasks.locator('tbody tr').count()).toBe(secondTaskCount)
    expect(await taskSearch.inputValue()).toBe('分页任务')
    await selectedTask.getByRole('heading', { name: '分页任务 00', exact: true }).waitFor()
    await tasks.getByRole('button', { name: '刷新任务', exact: true }).click()
    await expect.poll(() => tasks.locator('tbody tr').count()).toBe(secondTaskCount)
    await page.screenshot({ path: join(output, 'collections-current-window.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-sidebar-collapsed]').waitFor()
    await page.locator('[data-sidebar-collapsed]').evaluate(async (element) => {
      await Promise.allSettled(element.getAnimations().map(animation => animation.finished))
    })
    await expect.poll(async () => (await page.locator('[data-clocky-navigation]').boundingBox())?.width ?? Infinity)
      .toBeLessThanOrEqual(56)
    await expect.poll(async () => {
      const box = await tasks.getByRole('button', { name: '返回首页', exact: true }).boundingBox()
      return box !== null && box.x >= 0 && box.x + box.width <= 390
    }).toBe(true)
    await page.screenshot({ path: join(output, 'collections-current-window-narrow.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })

    await tasks.getByRole('button', { name: '返回首页', exact: true }).click()
    await expect.poll(() => tasks.locator('tbody tr').count()).toBe(firstTaskCount)
    await selectedTask.getByRole('heading', { name: '分页任务 00', exact: true }).waitFor()
    expect(await taskSearch.inputValue()).toBe('分页任务')

    await navigation.getByRole('button', { name: '成员', exact: true }).click()
    await expect.poll(() => members.locator('li').count()).toBe(64)
    await page.screenshot({ path: join(output, 'collections-initial.png') })

    for (const collection of ['task', 'member'] as const) {
      await navigation.getByRole('button', { name: collection === 'task' ? '任务' : '成员', exact: true }).click()
      if (collection === 'member') {
        await members.getByRole('button', { name: '刷新成员', exact: true }).click()
        await expect.poll(() => members.getByRole('button', { name: '刷新成员', exact: true }).isEnabled()).toBe(true)
      }
      const reached = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const routePattern = '**/api/team.browse'
      let intercepted = false
      const fail = async (route: Route) => {
        const request = route.request().postDataJSON() as { payload: { kind: string } }
        if (intercepted || request.payload.kind !== (collection === 'task' ? 'tasks' : 'members')) {
          await route.continue(); return
        }
        intercepted = true
        const response = await route.fetch()
        const body = await response.json() as Record<string, unknown>
        await writeFile(join(output, `response-${collection}-keys.json`), JSON.stringify({ keys: Object.keys(body), type: body.type }) + '\n')
        reached.resolve(undefined)
        await release.promise
        await route.fulfill({ response, json: { ...body,
          result: { ok: false, error: { code: 'internal', message: '分页读取暂不可用', details: {} } } } })
      }
      await page.route(routePattern, fail)
      const section = collection === 'task' ? tasks : members
      const moreButton = section.getByRole('button', { name: collection === 'task' ? '下一页任务' : '下一页成员', exact: true })
      await moreButton.focus()
      await moreButton.press('Enter')
      await reached.promise
      await invite(`${collection} 读取期间的新成员`)
      if (collection === 'member') await members.getByRole('button', { name: '刷新成员', exact: true }).waitFor()
      release.resolve(undefined)
      await section.getByRole('alert').getByText('分页读取暂不可用', { exact: true }).waitFor({ timeout: 5_000 })
      await page.unroute(routePattern, fail)
      await page.screenshot({ path: join(output, `collections-${collection}-failure.png`) })
      expect(await section.locator(collection === 'task' ? 'tbody tr' : 'li').count()).toBe(collection === 'task' ? firstTaskCount : 64)
      if (collection === 'member') await members.getByRole('button', { name: '刷新成员', exact: true }).waitFor()
      await section.getByRole('button', { name: collection === 'task' ? '下一页任务' : '下一页成员', exact: true }).click()
      await expect.poll(() => section.locator(collection === 'task' ? 'tbody tr' : 'li').count()).toBe(collection === 'task' ? secondTaskCount : 3)
      expect(await section.getByRole('alert').count()).toBe(0)
      await section.getByRole('button', { name: '返回首页', exact: true }).click()
      await expect.poll(() => section.locator(collection === 'task' ? 'tbody tr' : 'li').count()).toBe(collection === 'task' ? firstTaskCount : 64)
    }
    expect(await page.locator(`[data-team-id="${teamId}"]`).count()).toBeGreaterThan(0)
    const settled = scaffold.whenTurnSettled(30_000)
    await rpc('team.postInput', { teamId, text: `创建包含依赖关系的工作流。进度通道=${created.channelIds[0]}` })
    await settled
    const plans = await rpc<{ items: TeamWorkflowPlanSnapshot[] }>('team.workflow.plan.list', { teamId, limit: 64 })
    expect(plans.items).toHaveLength(1)
    const plan = plans.items[0]
    if (plan === undefined) throw new Error('The actual workflow tool did not admit a plan')
    const coordinatorId = created.participants.find(member => member.role === 'coordinator')?.id
    const coordinatorBinding = created.activations.find(candidate => candidate.activation.participantId === coordinatorId)
    if (coordinatorBinding === undefined) throw new Error('The coordinator binding is missing')
    const stored = await scaffold.ctx.sessionPersistence.inspect(coordinatorBinding.sessionId)
    const invalidResult = stored.events.find(event => event.type === 'tool/result' && event.data.message.source.callId === 'invalid-workflow-policy')
    expect(invalidResult).toMatchObject({ data: { message: { content: [{ isError: true, content: [{ type: 'text',
      text: 'Error: invalid arguments: missing required property "plan.channel.viewPolicy"' }] }] } } })
    await writeFile(join(output, 'workflow-tool-results.json'), JSON.stringify({ plan,
      results: stored.events.filter(event => event.type === 'tool/result').map(event => event.data) }, null, 2) + '\n')
    expect(plan.phase).toBe('ready')
    await showWorkflows()
    const workflows = panel.getByRole('region', { name: '工作流计划', exact: true })
    if (await workflows.getByText('分页工作流', { exact: true }).count() === 0) {
      await workflows.getByRole('button', { name: '刷新工作流', exact: true }).click()
    }
    await workflows.getByText('分页工作流', { exact: true }).waitFor({ timeout: 5_000 })
    await workflows.getByText('已就绪', { exact: true }).waitFor()
    const inspectionReply = page.waitForResponse(response => new URL(response.url()).pathname === '/api/team.workflow.plan.inspect')
    await workflows.getByRole('button', { name: '分页工作流', exact: true }).click()
    const inspected = await (await inspectionReply).json() as { result: { ok: boolean
      value: { record: Record<string, unknown>; items: unknown[] } } }
    expect(inspected.result.ok).toBe(true)
    expect(inspected.result.value.record).not.toHaveProperty('plan')
    expect(inspected.result.value.record).not.toHaveProperty('result')
    expect(inspected.result.value.items).toHaveLength(2)
    await expect.poll(() => new URL(page.url()).searchParams.get('plan')).toBe(plan.id)
    await workflows.getByText('依赖: 准备数据', { exact: true }).waitFor()
    await workflows.screenshot({ path: join(output, 'workflow-ready.png') })
    await page.reload({ waitUntil: 'load' })
    await workflows.getByText('依赖: 准备数据', { exact: true }).waitFor()
    expect(new URL(page.url()).searchParams.get('plan')).toBe(plan.id)
    const reportId = plan.taskBindings.find(item => item.templateId === 'report')?.taskId
    if (reportId === undefined) throw new Error('The workflow report task was not bound')
    const reportRow = panel.locator(`[id="team-task-${reportId}"]`)
    expect(await reportRow.count()).toBe(0)
    await page.screenshot({ path: join(output, 'workflow-before-task-navigation.png') })
    expect(await workflows.getByRole('link', { name: '生成报告', exact: true }).count()).toBe(1)
    const reportLink = workflows.getByRole('link', { name: '生成报告', exact: true })
    await reportLink.focus()
    await reportLink.press('Enter')
    await page.screenshot({ path: join(output, 'workflow-task-navigation.png') })
    expect(await reportRow.count()).toBe(0)
    await panel.getByRole('complementary', { name: '任务摘要' }).getByRole('heading', { name: '生成报告', exact: true }).waitFor()
    expect(await panel.getByRole('button', { name: '关闭任务摘要', exact: true }).evaluate(element => element === document.activeElement)).toBe(true)
    await showWorkflows()
    await workflows.getByText('依赖: 准备数据', { exact: true }).getByRole('link', { name: '准备数据' }).click()
    await expect.poll(() => reportRow.count()).toBe(0)
    await rpc('team.cancel', { teamId })
    await showWorkflows()
    await workflows.getByText('已取消', { exact: true }).waitFor()
    expect(await page.title()).toBe('Clocky')
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(output, 'collections-recovered.png') })
    await panel.screenshot({ path: join(output, 'workflow-recovered-panel.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-sidebar-collapsed]').waitFor()
    await page.locator('[data-sidebar-collapsed]').evaluate(async (element) => { await Promise.all(element.getAnimations().map(animation => animation.finished)) })
    await expect.poll(async () => {
      const box = await panel.boundingBox()
      return box !== null && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844
    }).toBe(true)
    await page.screenshot({ path: join(output, 'collections-narrow.png') })
  } catch (error: unknown) {
    await page.screenshot({ path: join(output, 'collections-diagnostic.png') })
    await writeFile(join(output, 'browser-diagnostic.json'), JSON.stringify({
      failure: error instanceof Error ? error.message : String(error),
      url: page.url(), title: await page.title(), alerts: await page.getByRole('alert').allTextContents(),
      warnings: errors.warnings, errors: errors.pageErrors,
    }, null, 2) + '\n')
    throw error
  } finally {
    try {
      await browser.close()
      if (created !== undefined) {
        const current = await rpc<TeamStateSnapshot>('team.get', { teamId: created.team.id })
        if (!['completed', 'failed', 'cancelled'].includes(current.team.phase)) await rpc('team.cancel', { teamId: created.team.id })
      }
    } finally { await scaffold.close() }
  }
}, 180_000)
