/** Real Host task forms retain bounded input and original creation identity across browser navigation. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import type { TeamsApi, SessionsApi } from '@clocky/clocky-host-apiproxy/api'
type TaskCreateCommand = Parameters<TeamsApi['taskCreate']>[0]['payload']
type SessionHistory = Extract<Awaited<ReturnType<SessionsApi['history']>>['result'], { ok: true }>['value']
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it('retains task drafts across closing, modules, Teams and history, with exact creation retries and current revision confirmation', async () => {
  const output = join(process.cwd(), '.tmp/team-task-draft-browser')
  await mkdir(output, { recursive: true })
  const overlay = join(output, 'scheduler.yml')
  await writeFile(overlay, `- id: team-scheduler-dag
  config:
    leaseDurationMs: 3600000
    maxAssignmentsPerDrive: 8
    maxExpirationsPerDrive: 1
    maxWakeDispatchesPerDrive: 8
    maxConflictsPerDrive: 4
    maxActiveAttemptsPerParticipant: 1
    permittedWorkspaceModes: [shared]
    stallAfterUnassignableDrives: 4096
    disposalTimeoutMs: 5000
`)
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  const sockets: WebSocketRoute[] = []
  await page.routeWebSocket(/\/api\/events\.(mux|host)/, (socket) => { sockets.push(socket); socket.connectToServer() })
  const teams: TeamStateSnapshot['team']['id'][] = []
  const creates: TaskCreateCommand[] = []
  let failure: unknown
  let dropCreateResponse = true
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${JSON.stringify(response.result.error)}`)
    return response.result.value
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    const first = await rpc<TeamStateSnapshot>('team.create', { objective: '任务草稿团队甲', cwd: scaffold.workspaceCwd })
    const second = await rpc<TeamStateSnapshot>('team.create', { objective: '任务草稿团队乙', cwd: scaffold.workspaceCwd })
    teams.push(first.team.id, second.team.id)
    const teamId = first.team.id
    const state = () => rpc<TeamStateSnapshot>('team.get', { teamId })
    const create = async (subject: string, blockedBy: TeamTaskSnapshot['blockedBy']) => await rpc<TeamTaskSnapshot>('team.task.create', {
      teamId, expectedCursor: (await state()).team.cursor, idempotencyKey: subject, subject,
      description: '原任务说明', blockedBy, requiredCapabilities: ['draft-only-capability'], priority: 0, readScopes: [], writeScopes: [],
      workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    })
    const dependency = await create('草稿依赖任务', [])
    const editable = await create('保留编辑任务', [dependency.id])
    await page.goto(`${scaffold.baseUrl}?team=${teamId}&view=tasks&task=${editable.id}`, { waitUntil: 'load' })
    const panel = page.locator('[data-team-workspace-page]')
    const inspector = panel.getByRole('complementary', { name: '任务摘要' })
    const openEdit = async () => {
      await inspector.getByRole('button', { name: '更多操作', exact: true }).click()
      await page.getByRole('menuitem', { name: '编辑任务', exact: true }).click()
    }
    await openEdit()
    const edit = page.getByRole('dialog', { name: '编辑任务', exact: true })
    await edit.getByLabel('任务名称', { exact: true }).fill('保留编辑任务（我的名称）')
    await edit.getByLabel('任务说明', { exact: true }).fill('切换页面后仍需保留的编辑说明。')
    await edit.getByRole('checkbox', { name: '草稿依赖任务', exact: true }).uncheck()
    await expect.poll(() => new URL(page.url()).searchParams.get('form')).toBe('taskUpdate')
    await page.screenshot({ path: join(output, 'edit-draft.png') })
    await edit.getByRole('button', { name: '关闭并保留草稿', exact: true }).click()
    await panel.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '产物', exact: true }).click()
    await page.goBack({ waitUntil: 'load' })
    await inspector.getByRole('heading', { name: editable.subject, exact: true }).waitFor()
    await page.goBack({ waitUntil: 'load' })
    await edit.getByLabel('任务说明', { exact: true }).waitFor()
    expect(await edit.getByLabel('任务说明', { exact: true }).inputValue()).toBe('切换页面后仍需保留的编辑说明。')
    expect(await edit.getByText('尚未选择依赖。', { exact: true }).count()).toBe(1)
    await edit.getByRole('button', { name: '关闭并保留草稿', exact: true }).click()
    await page.getByRole('button', { name: '任务草稿团队乙 进行中', exact: true }).click()
    await panel.getByRole('heading', { name: '任务草稿团队乙', exact: true }).waitFor()
    await page.getByRole('button', { name: '任务草稿团队甲 进行中', exact: true }).click()
    await inspector.getByRole('heading', { name: editable.subject, exact: true }).waitFor()
    await openEdit()
    expect(await edit.getByLabel('任务说明', { exact: true }).inputValue()).toBe('切换页面后仍需保留的编辑说明。')
    await rpc('team.task.update', {  commandId: 'team-task-draft.snapshot-update-1',teamId, taskId: editable.id, expectedRevision: editable.revision, subject: '另一个编辑者的名称', description: '另一个编辑者写入的说明', blockedBy: [dependency.id] })
    await edit.getByText('任务已被更新。请核对最新内容，再保留当前输入提交。', { exact: true }).waitFor()
    expect(await edit.getByRole('button', { name: '编辑任务', exact: true }).isDisabled()).toBe(true)
    await edit.getByRole('button', { name: '刷新详情', exact: true }).click()
    const comparison = edit.getByRole('table', { name: '当前任务与待提交字段', exact: true })
    await comparison.getByText('另一个编辑者的名称', { exact: true }).waitFor()
    await comparison.getByText('保留编辑任务（我的名称）', { exact: true }).waitFor()
    await comparison.getByText('另一个编辑者写入的说明', { exact: true }).waitFor()
    await comparison.getByText(`草稿依赖任务 (${dependency.id})`, { exact: true }).waitFor()
    expect(await comparison.getByText('将覆盖此字段', { exact: true }).count()).toBe(3)
    await page.screenshot({ path: join(output, 'task-conflict-fields.png') })
    await edit.getByRole('button', { name: '已核对，使用最新版本', exact: true }).click()
    let droppedUpdate: { commandId: string; expectedRevision: number } | undefined
    await page.route('**/api/team.task.update', async (route) => {
      if (droppedUpdate === undefined) {
        droppedUpdate = (route.request().postDataJSON() as { payload: { commandId: string; expectedRevision: number } }).payload
        await route.fetch(); await route.abort('failed')
      } else await route.continue()
    })
    await edit.getByRole('button', { name: '编辑任务', exact: true }).click()
    await edit.getByText('上次更新结果尚未确认，请先查询或重试原请求。', { exact: true }).waitFor()
    expect(await edit.getByRole('button', { name: '编辑任务', exact: true }).isDisabled()).toBe(true)
    await page.screenshot({ path: join(output, 'task-update-unknown-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(output, 'task-update-unknown-narrow.png') })
    expect(await edit.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await edit.getByRole('button', { name: '查询原更新结果', exact: true }).isEnabled()).toBe(true)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await edit.getByRole('button', { name: '关闭并保留草稿', exact: true }).click()
    await inspector.getByRole('button', { name: '刷新详情', exact: true }).click()
    await inspector.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑任务', exact: true }).click()
    await edit.getByRole('button', { name: '查询原更新结果', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })
    if (droppedUpdate === undefined) throw new Error('Expected an admitted update whose response was dropped')
    const originalOutcome = await rpc<{ kind: string; receipt: { commandId: string; appliedRevision: number } }>('team.task.update.result', {
      teamId, taskId: editable.id, commandId: droppedUpdate.commandId,
    })
    expect(originalOutcome).toMatchObject({ kind: 'applied', receipt: { commandId: droppedUpdate.commandId, appliedRevision: droppedUpdate.expectedRevision + 1 } })
    const saved = await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: editable.id })
    expect(saved.description).toBe('切换页面后仍需保留的编辑说明。')
    expect(saved.blockedBy).toEqual([])

    const cycle = await create('形成循环的依赖候选', [editable.id])
    await inspector.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑任务', exact: true }).click()
    await edit.getByRole('button', { name: '刷新并返回首批', exact: true }).click()
    await edit.getByRole('checkbox', { name: cycle.subject, exact: true }).check()
    await edit.getByLabel('任务说明', { exact: true }).fill('拒绝后仍保留的编辑说明。')
    let rejectedUpdate: { commandId: string; expectedRevision: number } | undefined
    await page.route('**/api/team.task.update', async (route) => {
      if (rejectedUpdate === undefined) {
        rejectedUpdate = (route.request().postDataJSON() as { payload: { commandId: string; expectedRevision: number } }).payload
        const response = await route.fetch()
        expect(await response.json()).toMatchObject({ result: { ok: false, error: { code: 'team-task-update-rejected' } } })
        await route.abort('failed')
      } else await route.continue()
    })
    await edit.getByRole('button', { name: '编辑任务', exact: true }).click()
    await edit.getByText('上次更新结果尚未确认，请先查询或重试原请求。', { exact: true }).waitFor()
    await edit.getByRole('button', { name: '查询原更新结果', exact: true }).click()
    await edit.getByText('原更新被拒绝。请修正已选依赖等编辑内容，输入仍保留。', { exact: true }).waitFor()
    expect(await edit.getByLabel('任务说明', { exact: true }).inputValue()).toBe('拒绝后仍保留的编辑说明。')
    expect(await edit.getByRole('button', { name: '编辑任务', exact: true }).isDisabled()).toBe(true)
    expect((await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: editable.id })).revision).toBe(saved.revision)
    await page.screenshot({ path: join(output, 'task-update-rejected-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(output, 'task-update-rejected-narrow.png') })
    expect(await edit.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await edit.getByRole('button', { name: '关闭并保留草稿', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await inspector.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑任务', exact: true }).click()
    await edit.getByRole('checkbox', { name: cycle.subject, exact: true }).click()
    await edit.getByRole('button', { name: '编辑任务', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })
    const corrected = await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: editable.id })
    expect(corrected).toMatchObject({ revision: saved.revision + 1, description: '拒绝后仍保留的编辑说明。', blockedBy: [] })
    if (rejectedUpdate === undefined) throw new Error('Expected a persisted refusal whose response was dropped')
    expect(await rpc('team.task.update.result', { teamId, taskId: editable.id, commandId: rejectedUpdate.commandId }))
      .toMatchObject({ kind: 'rejected', rejection: { reason: 'invalid-edit', observedRevision: saved.revision } })

    await inspector.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑任务', exact: true }).click()
    await edit.getByLabel('任务说明', { exact: true }).fill('原请求尚未送达时保留的说明。')
    const retriedUpdates: { commandId: string; expectedRevision: number; description: string }[] = []
    await page.route('**/api/team.task.update', async (route) => {
      const input = (route.request().postDataJSON() as { payload: (typeof retriedUpdates)[number] }).payload
      retriedUpdates.push(input)
      if (retriedUpdates.length === 1) await route.abort('failed')
      else await route.continue()
    })
    await edit.getByRole('button', { name: '编辑任务', exact: true }).click()
    await edit.getByText('上次更新结果尚未确认，请先查询或重试原请求。', { exact: true }).waitFor()
    await edit.getByRole('button', { name: '查询原更新结果', exact: true }).click()
    await edit.getByText('尚未找到原回执，不能据此认定更新失败。可重试同一原请求。', { exact: true }).waitFor()
    expect((await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: editable.id })).revision).toBe(corrected.revision)
    await edit.getByLabel('任务说明', { exact: true }).fill('确认原操作后再提交的新说明。')
    expect(await edit.getByRole('button', { name: '编辑任务', exact: true }).isDisabled()).toBe(true)
    await edit.getByRole('button', { name: '重试原更新请求', exact: true }).click()
    await edit.getByText('原更新已确认。新改动仍保留，请核对当前任务版本后再提交。', { exact: true }).waitFor()
    expect(retriedUpdates[1]).toEqual(retriedUpdates[0])
    expect((await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: editable.id })).description)
      .toBe('原请求尚未送达时保留的说明。')
    await edit.getByRole('button', { name: '已核对，使用最新版本', exact: true }).click()
    await edit.getByRole('button', { name: '编辑任务', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })
    expect(retriedUpdates).toHaveLength(3)
    expect(retriedUpdates[2]?.commandId).not.toBe(retriedUpdates[0]?.commandId)
    expect(await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: editable.id }))
      .toMatchObject({ revision: corrected.revision + 2, description: '确认原操作后再提交的新说明。' })

    const retiring = await create('删除后仍可查询原更新的任务', [])
    await panel.getByRole('button', { name: '刷新到第一页', exact: true }).click()
    await panel.getByRole('button', { name: retiring.subject, exact: true }).click()
    await inspector.getByRole('heading', { name: retiring.subject, exact: true }).waitFor()
    await openEdit()
    await edit.getByLabel('任务说明', { exact: true }).fill('任务删除后仍需确认的原更新说明。')
    const retiringCommands: { taskId: string; commandId: string }[] = []
    await page.route('**/api/team.task.update', async (route) => {
      const input = (route.request().postDataJSON() as { payload: (typeof retiringCommands)[number] }).payload
      if (input.taskId === retiring.id && retiringCommands.length === 0) {
        retiringCommands.push(input)
        await route.fetch(); await route.abort('failed')
      } else await route.continue()
    })
    await edit.getByRole('button', { name: '编辑任务', exact: true }).click()
    await edit.getByText('上次更新结果尚未确认，请先查询或重试原请求。', { exact: true }).waitFor()
    await edit.getByRole('button', { name: '关闭并保留草稿', exact: true }).click()
    const acceptedBeforeDelete = await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: retiring.id })
    await rpc('team.task.delete', { teamId, taskId: retiring.id, expectedRevision: acceptedBeforeDelete.revision })
    await inspector.getByRole('button', { name: '刷新详情', exact: true }).click()
    await inspector.getByText('此任务已删除。', { exact: true }).waitFor()
    await inspector.getByRole('button', { name: '打开编辑草稿', exact: true }).click()
    await edit.getByText('当前任务阶段不可提交新编辑。草稿仍保留，原更新结果可以独立查询。', { exact: true }).waitFor()
    expect(await edit.getByLabel('任务说明', { exact: true }).inputValue()).toBe('任务删除后仍需确认的原更新说明。')
    expect(await edit.getByRole('button', { name: '编辑任务', exact: true }).isDisabled()).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(output, 'task-draft-deleted-recovery.png') })
    expect(await edit.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await edit.getByRole('button', { name: '查询原更新结果', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })
    expect(retiringCommands).toHaveLength(1)
    expect(await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: retiring.id }))
      .toMatchObject({ phase: 'deleted', revision: acceptedBeforeDelete.revision + 1, description: '任务删除后仍需确认的原更新说明。' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await panel.getByRole('button', { name: corrected.subject, exact: true }).click()
    await inspector.getByRole('heading', { name: corrected.subject, exact: true }).waitFor()

    const doomed = await create('将被删除的候选依赖', [])
    await inspector.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑任务', exact: true }).click()
    await edit.getByRole('button', { name: '刷新并返回首批', exact: true }).click()
    await edit.getByRole('checkbox', { name: doomed.subject, exact: true }).check()
    await rpc('team.task.delete', { teamId, taskId: doomed.id, expectedRevision: doomed.revision })
    await edit.getByRole('button', { name: '核对依赖状态', exact: true }).click()
    const deletedRow = edit.getByRole('checkbox', { name: `已删除的依赖：${doomed.id}`, exact: true })
    await deletedRow.waitFor()
    expect(await deletedRow.isChecked()).toBe(true)
    expect(await edit.getByRole('button', { name: '编辑任务', exact: true }).isDisabled()).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(output, 'deleted-dependency-narrow.png') })
    await deletedRow.click()
    await deletedRow.waitFor({ state: 'detached' })
    await edit.getByRole('button', { name: '编辑任务', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })
    expect((await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: editable.id })).blockedBy).toEqual([])
    await page.setViewportSize({ width: 1440, height: 1000 })

    await panel.getByRole('button', { name: '新建任务', exact: true }).click()
    const form = page.getByRole('dialog', { name: '新建任务', exact: true })
    await form.getByRole('group', { name: '工作区类型', exact: true }).scrollIntoViewIfNeeded()
    await form.getByRole('radio', { name: '共享目录', exact: true }).waitFor()
    await form.getByLabel('任务名称', { exact: true }).fill('响应丢失的创建草稿')
    await form.getByLabel('任务说明', { exact: true }).fill('保留参数和原创建身份。')
    await form.getByText('高级执行选项', { exact: true }).click()
    await form.getByLabel('能力（用逗号分隔）', { exact: true }).fill('draft-only-capability')
    await form.getByLabel('Token 总预算（可选）', { exact: true }).fill('12345')
    for (const socket of sockets.splice(0)) await socket.close({ code: 1001, reason: 'Task draft reconnect evidence' })
    await expect.poll(() => form.getByRole('button', { name: '新建任务', exact: true }).isEnabled()).toBe(true)
    await page.route('**/api/team.task.create', async (route) => {
      creates.push((route.request().postDataJSON() as { payload: TaskCreateCommand }).payload)
      if (dropCreateResponse) { dropCreateResponse = false; await route.fetch(); await route.abort('failed') }
      else await route.continue()
    })
    await form.getByRole('button', { name: '新建任务', exact: true }).click()
    await form.getByRole('alert').waitFor()
    expect((await state()).tasks.filter(task => task.subject === '响应丢失的创建草稿')).toHaveLength(1)
    await form.getByRole('button', { name: '关闭并保留草稿', exact: true }).click()
    await panel.getByRole('button', { name: '新建任务', exact: true }).click()
    expect(await form.getByLabel('任务说明', { exact: true }).inputValue()).toBe('保留参数和原创建身份。')
    await form.getByText('高级执行选项', { exact: true }).click()
    expect(await form.getByLabel('Token 总预算（可选）', { exact: true }).inputValue()).toBe('12345')
    await form.getByRole('button', { name: '新建任务', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    expect(creates).toHaveLength(2)
    const { expectedCursor: _firstCursor, ...firstCommand } = creates[0]!
    const { expectedCursor: _secondCursor, ...secondCommand } = creates[1]!
    expect(secondCommand).toEqual(firstCommand)
    expect((await state()).tasks.filter(task => task.subject === '响应丢失的创建草稿')).toHaveLength(1)

    await panel.getByRole('button', { name: '新建任务', exact: true }).click()
    await form.getByLabel('任务名称', { exact: true }).fill('不应跨凭据保留的草稿')
    await form.getByRole('button', { name: '关闭并保留草稿', exact: true }).waitFor()
    await form.getByLabel('任务名称', { exact: true }).click()
    const departure = page.waitForEvent('dialog')
    const leave = page.reload({ waitUntil: 'commit', timeout: 2000 }).catch((error: unknown) => String(error))
    const warning = await departure
    expect(warning.type()).toBe('beforeunload')
    await warning.dismiss(); await leave
    expect(page.isClosed()).toBe(false)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(output, 'task-draft-narrow.png') })
    expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await scaffold.replaceBrowserAuthentication()
    await form.waitFor({ state: 'hidden' })
    await scaffold.authenticateBrowserPage(page)
    await page.getByRole('button', { name: '重新检查访问', exact: true }).click()
    await form.getByLabel('任务名称', { exact: true }).waitFor()
    expect(await form.getByLabel('任务名称', { exact: true }).inputValue()).toBe('')
    await form.locator('[data-task-dialog-cancel]').click()
    const current = await state()
    expect(current.tasks.every(task => task.attemptCount === 0)).toBe(true)
    for (const binding of current.activations) {
      const history = await rpc<SessionHistory>('session.history', { sessionId: binding.sessionId })
      expect(history.events.some(entry => entry.event.type === 'request/header')).toBe(false)
    }
    expect(errors.pageErrors).toEqual([])
  } catch (error: unknown) {
    failure = error
    await writeFile(join(output, 'failure.txt'), String(error))
    if (!page.isClosed()) {
      await writeFile(join(output, 'failure-dom.json'), JSON.stringify({ url: page.url(), dialogs: await page.getByRole('dialog').allTextContents() }))
      await page.screenshot({ path: join(output, 'failure.png') })
    }
    throw error
  } finally {
    try { await browser.close(); for (const teamId of teams) await rpc('team.cancel', { teamId }) }
    finally {
      try { await scaffold.close() }
      catch (error: unknown) { if (failure !== undefined) throw new AggregateError([failure, error], 'Task draft scenario and cleanup failed'); throw error }
    }
  }
})
