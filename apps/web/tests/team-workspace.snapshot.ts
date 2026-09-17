/** Team workspace navigation and in-page Session inspection through the real authenticated Host. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { TeamStateSnapshot, TeamTaskInspection } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it('opens the Team overview, inspects a task and Session, and returns to retained task filters', async () => {
  const output = join(process.cwd(), '.tmp/team-workspace-implementation/browser')
  await mkdir(output, { recursive: true })
  const replay = join(output, 'replay.json')
  const response = '已整理接口迁移的检查清单。'
  await writeFile(replay, JSON.stringify([{ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: response },
    { type: 'block-end', index: 0, block: { type: 'text', text: response } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }]))
  const scaffold = await launchWebScaffold({
    replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'),
    replayOverride: replay,
    extraOverlayPath: join(process.cwd(), 'examples/headless-agent/tests/fixtures/team-collections-browser.cordis.yml'),
  })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  const taskReads: Promise<{ result: { ok: boolean; value?: TeamTaskInspection } }>[] = []
  let fullTaskLists = 0
  let fullTeamReads = 0
  let fullMemberReads = 0
  let fullWorkflowReads = 0
  let selectionReads = 0
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/team.task.inspect') taskReads.push(response.json() as Promise<{ result: { ok: boolean; value?: TeamTaskInspection } }>)
  })
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path === '/api/team.task.list') fullTaskLists++
    if (path === '/api/team.get') fullTeamReads++
    if (path === '/api/team.member.list') fullMemberReads++
    if (path === '/api/team.workflow.plan.list') fullWorkflowReads++
    if (path === '/api/team.selection') selectionReads++
  })

  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const reply = await scaffold.authenticatedRpc<T>(method, payload)
    if (!reply.result.ok) throw new Error(`${method}: ${reply.result.error.message}`)
    return reply.result.value
  }
  let primaryFailure: unknown
  try {
    await scaffold.authenticateBrowserPage(page)
    const created = await rpc<TeamStateSnapshot>('team.create', { objective: '发布准备', cwd: scaffold.workspaceCwd })
    const teamId = created.team.id
    for (const subject of ['接口迁移', '回归测试', '发布说明']) {
      const current = await rpc<TeamStateSnapshot>('team.get', { teamId })
      await rpc('team.task.create', {
        teamId, expectedCursor: current.team.cursor, idempotencyKey: subject, subject,
        description: `${subject}：保留现有授权检查，并记录验证结果。`, blockedBy: [],
        requiredCapabilities: ['workspace-ui-manual-review'], priority: 0, readScopes: [], writeScopes: [],
        workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
      })
    }
    const memberCursor = (await rpc<TeamStateSnapshot>('team.get', { teamId })).team.cursor
    await rpc('team.member.invite', { teamId, expectedCursor: memberCursor, kind: 'local-agent',
      role: 'research', displayName: 'Capability detail member', capabilities: Array.from({ length: 260 }, (_, index) => `capability-${index}`) })
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: /^发布准备 / }).click()
    const workspace = page.locator('[data-team-workspace-page]')
    await workspace.getByText('任务完成', { exact: true }).waitFor()
    expect(await page.getByRole('dialog', { name: '执行记录', exact: true }).count()).toBe(0)
    await workspace.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations({ subtree: true })
          .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map(animation => animation.finished),
      )
    })
    await page.screenshot({ path: join(output, '01-overview.png') })
    await workspace.getByRole('region', { name: '团队成员', exact: true }).waitFor()
    await workspace.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '成员', exact: true }).click()
    const memberDetailReply = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/team.member.inspect')
    await workspace.getByRole('listitem').filter({ hasText: 'Capability detail member' })
      .getByRole('button', { name: '查看成员详情', exact: true }).click()
    const memberDetail = page.getByRole('dialog', { name: '成员详情', exact: true })
    const memberResponse = await (await memberDetailReply).json() as { result: { ok: boolean; value: { record: { teamId: string } } } }
    expect(memberResponse.result).toMatchObject({ ok: true, value: { record: { teamId } } })
    await memberDetail.getByRole('heading', { level: 3 }).waitFor()
    const firstCapabilities = await memberDetail.getByRole('listitem').allTextContents()
    expect(firstCapabilities.length).toBeGreaterThan(0)
    expect(firstCapabilities.length).toBeLessThan(260)
    expect(firstCapabilities[0]).toBe('capability-0')
    await memberDetail.getByRole('button', { name: '下一页能力', exact: true }).click()
    await expect.poll(async () => (await memberDetail.getByRole('listitem').allTextContents())[0])
      .toBe(`capability-${firstCapabilities.length}`)
    expect(await memberDetail.getByRole('listitem').count()).toBeLessThanOrEqual(firstCapabilities.length)
    await memberDetail.getByRole('button', { name: '返回首页', exact: true }).click()
    await expect.poll(async () => (await memberDetail.getByRole('listitem').allTextContents())[0]).toBe('capability-0')

    await expect.poll(async () => {
      const box = await memberDetail.getByRole('button', { name: '取消', exact: true }).boundingBox()
      return box !== null && box.y >= 0 && box.y + box.height <= 1000
    }).toBe(true)
    await page.screenshot({ path: join(output, 'member-detail.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => {
      const box = await memberDetail.getByRole('button', { name: '下一页能力', exact: true }).boundingBox()
      return box !== null && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844
    }).toBe(true)
    await page.screenshot({ path: join(output, 'member-detail-narrow.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })

    await memberDetail.getByRole('button', { name: '取消', exact: true }).click()
    await memberDetail.waitFor({ state: 'hidden' })
    await workspace.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '概览', exact: true }).click()

    const memberBindingReply = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/team.member.session')
    await workspace.getByRole('region', { name: '团队成员', exact: true }).getByRole('button')
      .filter({ hasText: '打开 Session' }).first().click()
    const bindingReply = await (await memberBindingReply).json() as {
      result: { ok: boolean; value: { activation: { teamId: string; participantId: string }; sessionId: string } }
    }
    expect(bindingReply.result.ok).toBe(true)
    expect(bindingReply.result.value.activation.teamId).toBe(teamId)
    expect(bindingReply.result.value.activation.participantId).toBe(created.participants.find(member => member.role === 'coordinator')?.id)
    const memberInspection = page.getByRole('dialog', { name: '执行记录', exact: true })
    await memberInspection.waitFor()
    await memberInspection.evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true })
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished))
    })
    await page.screenshot({ path: join(output, '00-member-session.png') })
    await memberInspection.getByRole('button', { name: '返回团队', exact: true }).click()
    await memberInspection.waitFor({ state: 'hidden' })
    await workspace.getByRole('region', { name: '最近动态', exact: true }).waitFor()
    await workspace.getByRole('region', { name: '产物预览', exact: true }).waitFor()
    await workspace.getByRole('region', { name: '任务执行', exact: true }).getByRole('button', { name: '接口迁移', exact: true }).click()
    const filter = workspace.getByRole('textbox', { name: '仅搜索已加载任务' })
    await filter.fill('接口')
    await workspace.getByRole('button', { name: '接口迁移', exact: true }).click()
    await workspace.getByRole('complementary', { name: '任务摘要' }).waitFor()
    await workspace.getByRole('complementary', { name: '任务摘要' }).evaluate(async (element) => {
      await Promise.all(element.getAnimations().map(animation => animation.finished))
    })
    const taskInspector = workspace.getByRole('complementary', { name: '任务摘要' })
    await taskInspector.getByText('接口迁移：保留现有授权检查，并记录验证结果。', { exact: true }).first().waitFor()
    const replies = await Promise.all(taskReads)
    const record = replies.find(reply => reply.result.ok && reply.result.value?.section === 'record')?.result.value
    if (record?.section !== 'record') throw new Error('Task inspector never read current task fields')
    expect(record.task).not.toHaveProperty('attemptHistory')
    expect(record.task).not.toHaveProperty('reviewHistory')
    expect(fullTaskLists).toBe(0)
    expect(fullTeamReads).toBe(0)
    expect(fullMemberReads).toBe(0)
    expect(fullWorkflowReads).toBe(0)
    expect(selectionReads).toBeGreaterThan(0)
    await workspace.getByRole('button', { name: '状态', exact: true }).click()
    await page.getByRole('menuitem', { name: '全部状态', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: join(output, '02-task-summary.png') })
    await rpc('team.task.update', { teamId, taskId: record.taskId, expectedRevision: record.revision, subject: '接口迁移（更新）' })
    await taskInspector.getByText('任务已更新，请刷新详情后继续操作。', { exact: true }).waitFor()
    await taskInspector.getByRole('heading', { name: '接口迁移', exact: true }).waitFor()
    let failRead = true
    await page.route('**/api/team.task.inspect', async (route) => {
      const request = route.request().postDataJSON() as { payload: { section: string } }
      if (failRead && request.payload.section === 'record') { failRead = false; await route.abort('failed') }
      else await route.continue()
    })
    await taskInspector.getByRole('button', { name: '刷新详情', exact: true }).click()
    await taskInspector.getByRole('alert').waitFor()
    await taskInspector.getByRole('heading', { name: '接口迁移', exact: true }).waitFor()
    await taskInspector.getByRole('button', { name: '刷新详情', exact: true }).click()
    await taskInspector.getByRole('heading', { name: '接口迁移（更新）', exact: true }).waitFor()
    await page.screenshot({ path: join(output, '02-task-refreshed.png') })
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('接口')
    await workspace.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '频道', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('channels')
    await page.goBack()
    await filter.waitFor()
    expect(await filter.inputValue()).toBe('接口')
    await workspace.getByRole('complementary', { name: '任务摘要' }).waitFor()
    await workspace.getByRole('button', { name: '打开协调会话' }).click()
    const session = page.getByRole('dialog', { name: '执行记录', exact: true })
    await session.waitFor()
    const settled = scaffold.whenTurnSettled(30_000)
    const posted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/team.postInput')
    await session.locator('textarea:visible').last().fill('检查接口迁移的计划。')
    await session.getByRole('button', { name: '发送消息', exact: true }).click()
    const inputRequest = (await posted).postDataJSON() as { payload: { teamId: string } }
    expect(inputRequest.payload.teamId).toBe(teamId)
    await settled
    await session.getByText(response, { exact: true }).waitFor()
    await expect.poll(() => new URL(page.url()).searchParams.has('session')).toBe(true)
    await page.goBack()
    await session.waitFor({ state: 'hidden' })
    expect(await filter.inputValue()).toBe('接口')
    await page.goForward()
    await session.waitFor()
    await session.getByText(response, { exact: true }).waitFor()
    const composer = session.locator('textarea:visible').last()
    await composer.fill('保留这段未发送的说明。')
    await session.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map(animation => animation.finished))
    })
    await page.screenshot({ path: join(output, '03-session.png') })
    await session.getByRole('button', { name: '返回团队', exact: true }).click()
    await session.waitFor({ state: 'hidden' })
    await workspace.getByRole('button', { name: '打开协调会话' }).click()
    await session.waitFor()
    expect(await session.locator('textarea:visible').last().inputValue()).toBe('保留这段未发送的说明。')
    await session.getByRole('button', { name: '返回团队', exact: true }).click()
    await session.waitFor({ state: 'hidden' })
    expect(await filter.inputValue()).toBe('接口')
    await workspace.getByRole('complementary', { name: '任务摘要' }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    const collapsed = page.locator('[data-sidebar-collapsed]')
    await collapsed.waitFor()
    await collapsed.evaluate(async (element) => { await Promise.all(element.getAnimations().map(animation => animation.finished)) })
    const summaryBox = await workspace.getByRole('complementary', { name: '任务摘要' }).boundingBox()
    expect(summaryBox).not.toBeNull()
    expect(summaryBox!.x + summaryBox!.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: join(output, '04-narrow-summary.png') })
    await workspace.getByRole('button', { name: '关闭任务摘要' }).click()
    await filter.waitFor()
    expect(await filter.inputValue()).toBe('接口')
    await page.reload({ waitUntil: 'load' })
    await filter.waitFor()
    expect(await filter.inputValue()).toBe('接口')
    expect(new URL(page.url()).searchParams.get('view')).toBe('tasks')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.getByRole('button', { name: '深色', exact: true }).click()
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).not.toBeNull()
    await settings.getByRole('button', { name: '中文', exact: true }).click()
    await page.getByRole('menuitem', { name: 'English', exact: true }).click()
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await workspace.getByRole('navigation', { name: 'Team modules' }).getByRole('button', { name: 'Overview', exact: true }).click()
    await workspace.getByRole('region', { name: 'Recent activity' }).waitFor()
    await workspace.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations({ subtree: true })
          .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map(animation => animation.finished),
      )
    })
    await page.screenshot({ path: join(output, '05-dark-english.png') })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await workspace.getByRole('navigation', { name: 'Team modules' }).getByRole('button', { name: 'Tasks', exact: true }).click()
    await workspace.getByRole('button', { name: '接口迁移（更新）', exact: true }).click()
    expect(await workspace.getByRole('complementary', { name: 'Task summary' }).evaluate(element => getComputedStyle(element).animationName)).toBe('none')
    const zoomPage = await browser.newPage({ viewport: { width: 720, height: 500 }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-US' })
    try {
      await scaffold.authenticateBrowserPage(zoomPage)
      await zoomPage.goto(page.url(), { waitUntil: 'load' })
      await zoomPage.getByRole('complementary', { name: 'Task summary' }).waitFor()
      expect(await zoomPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const closeSummary = zoomPage.getByRole('button', { name: 'Close task summary', exact: true })
      expect((await closeSummary.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await closeSummary.click()
      await zoomPage.getByRole('textbox', { name: 'Search loaded tasks only' }).waitFor()
      await zoomPage.screenshot({ path: join(output, '06-zoom-equivalent.png') })
    } finally { await zoomPage.close() }
    const longObjective = `长目标验证：${'检查任务进度、协作记录和交付结果。'.repeat(12)}`
    const longTeam = await rpc<TeamStateSnapshot>('team.create', { objective: longObjective, cwd: scaffold.workspaceCwd })
    const longUrl = new URL(page.url())
    for (const key of ['task', 'channel', 'session', 'q', 'status']) longUrl.searchParams.delete(key)
    longUrl.searchParams.set('team', longTeam.team.id)
    longUrl.searchParams.set('view', 'overview')
    await page.goto(longUrl.href, { waitUntil: 'load' })
    const heading = page.getByRole('heading', { name: longObjective, exact: true })
    await page.getByRole('button', { name: 'View full objective', exact: true }).waitFor()
    expect((await heading.boundingBox())!.height).toBeLessThanOrEqual(65)
    await page.getByRole('button', { name: 'View full objective', exact: true }).click()
    expect((await heading.boundingBox())!.height).toBeGreaterThan(65)
    await page.getByRole('button', { name: 'Collapse', exact: true }).click()
    await page.screenshot({ path: join(output, '07-long-objective.png') })
    expect(fullTeamReads).toBe(0)
    expect(fullMemberReads).toBe(0)
    expect(fullWorkflowReads).toBe(0)
    expect(selectionReads).toBeGreaterThan(1)
    expect(errors.pageErrors).toEqual([])
  } catch (error) {
    primaryFailure = error
    await writeFile(join(output, 'failure.txt'), String(error))
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  } finally {
    await browser.close()
    try { await scaffold.close() } catch (cleanupError) {
      if (primaryFailure !== undefined) throw new AggregateError([primaryFailure, cleanupError], 'Workspace scenario and cleanup failed')
      throw cleanupError
    }
  }
})
