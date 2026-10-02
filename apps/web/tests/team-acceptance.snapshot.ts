/** Final Team acceptance uses the shipped Loader, authenticated Host and rendered browser controls. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { createNativeZoomContext } from './browser-native-zoom.ts'
import { teamAppearance, teamEvidence, teamModalKeyboard } from './team-acceptance-support.ts'

it('keeps Team modules, conflict drafts and errors usable in both languages, themes, short and narrow windows', async () => {
  const output = join(process.cwd(), '.tmp/team-acceptance-browser')
  await mkdir(output, { recursive: true })
  const overlay = join(output, 'active-draft.yml')
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
  const scaffold = await launchWebScaffold({ tempRoot: output, extraOverlayPath: overlay })
  const { context, setNativeZoom } = await createNativeZoomContext(output, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchConsole(page)
  let team: TeamStateSnapshot | undefined
  let failure: unknown
  const rpc = async <T>(method: string, payload: unknown): Promise<T> => {
    const reply = await scaffold.authenticatedRpc<T>(method, payload)
    if (!reply.result.ok) throw new Error(`${method}: ${JSON.stringify(reply.result.error)}`)
    return reply.result.value
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    team = await rpc<TeamStateSnapshot>('team.create', { objective: `验收团队：${'长名称与目标保留可读性。'.repeat(8)}`, cwd: scaffold.workspaceCwd })
    const teamId = team.team.id
    const task = await rpc<TeamTaskSnapshot>('team.task.create', { teamId, expectedCursor: team.team.cursor,
      idempotencyKey: 'team-acceptance-task', subject: '验收任务', description: '保留功能验收输入。', blockedBy: [],
      requiredCapabilities: ['acceptance-manual-only'], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 })
    await page.goto(`${scaffold.baseUrl}?team=${teamId}&view=overview`, { waitUntil: 'load' })
    const panel = page.locator('[data-team-workspace-page]')
    await panel.getByRole('heading', { level: 1 }).waitFor()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const locale of ['zh', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await teamAppearance(page, locale, theme)
      for (const [view, label] of [['overview', locale === 'zh' ? '概览' : 'Overview'],
        ['tasks', locale === 'zh' ? '任务' : 'Tasks'], ['members', locale === 'zh' ? '成员' : 'Members'],
        ['channels', locale === 'zh' ? '频道' : 'Channels'], ['artifacts', locale === 'zh' ? '产物' : 'Artifacts']] as const) {
        const nav = panel.getByRole('navigation', { name: locale === 'zh' ? '团队模块' : 'Team modules' })
        const button = nav.getByRole('button', { name: label, exact: true })
        if (await button.count() > 0) await button.click()
        else {
          await nav.locator('button[aria-expanded]').click()
          await page.getByRole('menuitem', { name: label, exact: true }).click()
        }
        await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe(view)
        await expect.poll(() => panel.getByText(locale === 'zh' ? '加载中…' : 'Loading…', { exact: true }).count()).toBe(0)
        await teamEvidence(page, panel, output, `${locale}-${theme}-${view}-desktop`,
          { locale, theme, data: view === 'tasks' ? 'single' : view === 'artifacts' ? 'empty' : 'loaded', assertion: 'module frame and rendered text contrast' })
        const nativeZoom = await setNativeZoom(page, 2)
        await teamEvidence(page, panel, output, `${locale}-${theme}-${view}-zoom200`,
          { locale, theme, nativeZoom, data: view === 'tasks' ? 'single' : view === 'artifacts' ? 'empty' : 'loaded',
            assertion: 'native 200% browser zoom; module controls remain accessible' })
        await setNativeZoom(page, 1)
      }
      const nav = panel.getByRole('navigation', { name: locale === 'zh' ? '团队模块' : 'Team modules' })
      await nav.getByRole('button', { name: locale === 'zh' ? '任务' : 'Tasks', exact: true }).click()
      const create = panel.getByRole('button', { name: locale === 'zh' ? '新建任务' : 'Create task', exact: true })
      const createDialog = page.getByRole('dialog', { name: locale === 'zh' ? '新建任务' : 'Create task', exact: true })
      await teamModalKeyboard(page, createDialog, create)
      await create.click()
      await createDialog.getByRole('radio', { name: locale === 'zh' ? '共享目录' : 'Shared directory', exact: true }).waitFor()
      await createDialog.getByText(locale === 'zh' ? '高级执行选项' : 'Advanced execution options', { exact: true }).click()
      for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['short', { width: 1280, height: 480 }],
        ['narrow', { width: 390, height: 844 }], ['zoom200', { width: 1440, height: 1000 }]] as const) {
        await page.setViewportSize(viewport)
        const nativeZoom = await setNativeZoom(page, size === 'zoom200' ? 2 : 1)
        await teamEvidence(page, createDialog, output, `${locale}-${theme}-default-capabilities-${size}`,
          { locale, theme, nativeZoom, data: 'default-human-grant', assertion: 'only granted modes/scopes can be edited; unavailable reasons readable' })
      }
      await setNativeZoom(page, 1)
      await page.keyboard.press('Escape')
      await createDialog.waitFor({ state: 'hidden' })
      await page.setViewportSize({ width: 1440, height: 1000 })
      await panel.getByRole('button', { name: task.subject, exact: true }).click()
      const inspector = panel.getByRole('complementary', { name: locale === 'zh' ? '任务摘要' : 'Task summary' })
      await inspector.getByRole('heading', { name: task.subject, exact: true }).waitFor()
      await inspector.getByRole('button', { name: locale === 'zh' ? '更多操作' : 'More actions', exact: true }).click()
      await page.getByRole('menuitem', { name: locale === 'zh' ? '编辑任务' : 'Edit task', exact: true }).click()
      const edit = page.getByRole('dialog', { name: locale === 'zh' ? '编辑任务' : 'Edit task', exact: true })
      const description = edit.getByLabel(locale === 'zh' ? '任务说明' : 'Instructions', { exact: true })
      await description.fill(`本地草稿 ${locale}/${theme} ${'长文本输入。'.repeat(30)}`)
      const current = await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: task.id })
      await rpc('team.task.update', { teamId, taskId: task.id, commandId: `team-acceptance-conflict-${locale}-${theme}`,
        expectedRevision: current.revision, description: `其他编辑者 ${locale}/${theme}` })
      await edit.getByRole('button', { name: locale === 'zh' ? '刷新详情' : 'Refresh details', exact: true }).click()
      await edit.getByRole('table', { name: locale === 'zh' ? '当前任务与待提交字段' : 'Current task and proposed fields', exact: true }).waitFor()
      expect(await edit.getByRole('button', { name: locale === 'zh' ? '编辑任务' : 'Edit task', exact: true }).isDisabled()).toBe(true)
      for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['short', { width: 1280, height: 480 }],
        ['narrow', { width: 390, height: 844 }], ['zoom200', { width: 1440, height: 1000 }]] as const) {
        await page.setViewportSize(viewport)
        const nativeZoom = await setNativeZoom(page, size === 'zoom200' ? 2 : 1)
        await teamEvidence(page, edit, output, `${locale}-${theme}-conflict-${size}`,
          { locale, theme, nativeZoom, data: 'conflict-long-input', assertion: 'draft retained; comparison and confirmation remain reachable' })
        await edit.getByRole('button', { name: locale === 'zh' ? '已核对，使用最新版本' : 'Use the reviewed latest version', exact: true }).scrollIntoViewIfNeeded()
      }
      await setNativeZoom(page, 1)
      const largeError = `${locale === 'zh' ? '读取暂时失败，请保留草稿并重试。' : 'Reading failed temporarily; keep the draft and retry. '} ${'diagnostic-'.repeat(120)}`
      await page.route('**/api/team.task.inspect', async (route) => {
        const response = await route.fetch()
        const reply = await response.json() as Record<string, unknown>
        await route.fulfill({ response, json: { ...reply, result: { ok: false, error: { code: 'internal', message: largeError, details: {} } } } })
      })
      const beforeError = await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: task.id })
      await rpc('team.task.update', { teamId, taskId: task.id, commandId: `team-acceptance-error-${locale}-${theme}`,
        expectedRevision: beforeError.revision, description: `读取失败前的当前版本 ${locale}/${theme}` })
      await edit.getByRole('button', { name: locale === 'zh' ? '刷新详情' : 'Refresh details', exact: true }).click()
      await edit.getByRole('alert').filter({ hasText: largeError }).first().waitFor()
      expect(await description.inputValue()).toContain(`本地草稿 ${locale}/${theme}`)
      await page.setViewportSize({ width: 1280, height: 480 })
      await edit.getByRole('alert').filter({ hasText: largeError }).first().evaluate((element) =>{  element.scrollIntoView({ block: 'start' }) })
      await teamEvidence(page, edit, output, `${locale}-${theme}-large-read-error-short`,
        { locale, theme, data: 'large-read-error-retained-draft', assertion: 'read failure remains distinct from empty; retained input and close controls accessible' })
      await page.setViewportSize({ width: 390, height: 844 })
      await edit.getByRole('alert').filter({ hasText: largeError }).first().evaluate((element) =>{  element.scrollIntoView({ block: 'start' }) })
      await teamEvidence(page, edit, output, `${locale}-${theme}-large-read-error-narrow`,
        { locale, theme, data: 'large-read-error-retained-draft', assertion: 'long error wraps without clipping form actions' })
      await page.unroute('**/api/team.task.inspect')
      await edit.getByRole('button', { name: locale === 'zh' ? '刷新详情' : 'Refresh details', exact: true }).click()
      await expect.poll(() => edit.getByRole('alert').filter({ hasText: largeError }).count()).toBe(0)
      await edit.getByRole('button', { name: locale === 'zh' ? '关闭并保留草稿' : 'Close and keep draft', exact: true }).click()
      await page.setViewportSize({ width: 1440, height: 1000 })
      const summary = panel.getByRole('complementary', { name: locale === 'zh' ? '任务摘要' : 'Task summary' })
      const close = summary.getByRole('button', { name: locale === 'zh' ? '关闭任务摘要' : 'Close task summary', exact: true })
      await panel.getByRole('textbox', { name: locale === 'zh' ? '搜索整个团队的任务' : 'Search all tasks in this Team', exact: true }).focus()
      expect(await summary.evaluate(element => !element.contains(document.activeElement))).toBe(true)
      await close.click()
    }
    await teamAppearance(page, 'zh', 'light')
    await panel.getByRole('button', { name: task.subject, exact: true }).click()
    const inspector = panel.getByRole('complementary', { name: '任务摘要' })
    await inspector.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑任务', exact: true }).click()
    const edit = page.getByRole('dialog', { name: '编辑任务' })
    await edit.getByLabel('任务说明', { exact: true }).fill('撤权后必须清除的私有草稿。')
    const before = await rpc<TeamStateSnapshot>('team.get', { teamId })
    const human = before.participants.find(member => member.kind === 'human' && member.phase === 'active')
    if (human === undefined) throw new Error('No current human membership for grant withdrawal')
    await rpc('team.member.remove', { teamId, participantId: human.id, expectedCursor: before.team.cursor })
    await edit.waitFor({ state: 'hidden' })
    expect(await page.getByText('撤权后必须清除的私有草稿。', { exact: true }).count()).toBe(0)
    for (const method of ['team.task.update.result', 'team.attention.read', 'team.task.inspect', 'team.capabilities']) {
      const reply = await scaffold.authenticatedRpc(method, method === 'team.task.update.result'
        ? { teamId, taskId: task.id, commandId: 'team-acceptance-conflict-zh-light' }
        : method === 'team.task.inspect' ? { teamId, taskId: task.id, section: 'record' }
          : method === 'team.capabilities' ? { teamId, integration: false, readScopes: [], writeScopes: [] } : { teamId })
      expect(reply.result, method).toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' } })
    }
    await page.screenshot({ path: join(output, 'durable-grant-withdrawal.png') })
    expect(errors.pageErrors).toEqual([])
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
  } catch (error: unknown) {
    failure = error
    await writeFile(join(output, 'failure.txt'), String(error))
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  } finally {
    await context.close()
    try { await scaffold.close() } catch (error: unknown) {
      if (failure !== undefined) throw new AggregateError([failure, error], 'Team acceptance and cleanup failed')
      throw error
    }
  }
})

it('keeps the original update and draft readable after the real scheduler stalls a Team while withholding all writes', async () => {
  const output = join(process.cwd(), '.tmp/team-stalled-draft-browser')
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
    stallAfterUnassignableDrives: 10
    pulseIntervalMs: 1000
    disposalTimeoutMs: 5000
`)
  const scaffold = await launchWebScaffold({ tempRoot: output, extraOverlayPath: overlay })
  const { context, setNativeZoom } = await createNativeZoomContext(output, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchConsole(page)
  let teamId: TeamStateSnapshot['team']['id'] | undefined
  let failure: unknown
  const rpc = async <T>(method: string, payload: unknown): Promise<T> => {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${JSON.stringify(response.result.error)}`)
    return response.result.value
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    const created = await rpc<TeamStateSnapshot>('team.create', { objective: '卡住后保留原更新草稿', cwd: scaffold.workspaceCwd })
    teamId = created.team.id
    const task = await rpc<TeamTaskSnapshot>('team.task.create', { teamId, expectedCursor: created.team.cursor,
      idempotencyKey: 'stalled-draft', subject: '原更新仍需确认', description: '原说明', blockedBy: [],
      requiredCapabilities: ['stalled-draft-no-owner'], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 })
    await page.goto(`${scaffold.baseUrl}?team=${teamId}&view=tasks&task=${task.id}`, { waitUntil: 'load' })
    const panel = page.locator('[data-team-workspace-page]')
    const inspector = panel.getByRole('complementary', { name: '任务摘要', exact: true })
    await inspector.getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '编辑任务', exact: true }).click()
    const edit = page.getByRole('dialog', { name: '编辑任务', exact: true })
    await edit.getByLabel('任务说明', { exact: true }).fill('团队卡住后仍应保留的原提交内容。')
    const commands: unknown[] = []
    await page.route('**/api/team.task.update', async (route) => {
      commands.push((route.request().postDataJSON() as { payload: unknown }).payload)
      await route.abort('failed')
    })
    await edit.getByRole('button', { name: '编辑任务', exact: true }).click()
    await edit.getByText('上次更新结果尚未确认，请先查询或重试原请求。', { exact: true }).waitFor()
    await expect.poll(async () => (await rpc<TeamStateSnapshot>('team.get', { teamId })).team.phase, { timeout: 20_000 }).toBe('stalled')
    await edit.getByText('当前团队状态或权限不支持修改。输入保留，仍可查询原更新结果。', { exact: true }).waitFor()
    expect(await edit.getByRole('button', { name: '重试原更新请求', exact: true }).isDisabled()).toBe(true)
    expect(await edit.getByRole('button', { name: '编辑任务', exact: true }).isDisabled()).toBe(true)
    expect(await edit.getByLabel('任务说明', { exact: true }).inputValue()).toBe('团队卡住后仍应保留的原提交内容。')
    await edit.getByRole('button', { name: '查询原更新结果', exact: true }).click()
    await edit.getByText('尚未找到原回执，不能据此认定更新失败。可重试同一原请求。', { exact: true }).waitFor()
    const nativeZoom = await setNativeZoom(page, 2)
    await teamEvidence(page, edit, output, 'stalled-original-result-zoom200',
      { locale: 'zh', theme: 'light', nativeZoom, data: 'stalled-unknown-original-update', assertion: 'retained original lookup remains available; phase-bound writes disabled' })
    await setNativeZoom(page, 1)
    await edit.getByRole('button', { name: '关闭并保留草稿', exact: true }).click()
    expect(await panel.getByRole('button', { name: '新建任务', exact: true }).count()).toBe(0)
    await inspector.getByRole('button', { name: '打开编辑草稿', exact: true }).click()
    await edit.getByRole('button', { name: '查询原更新结果', exact: true }).waitFor()
    expect(commands).toHaveLength(1)
    expect((await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: task.id })).revision).toBe(task.revision)
    expect(errors.pageErrors).toEqual([])
  } catch (error: unknown) {
    failure = error
    await page.screenshot({ path: join(output, 'failure.png') })
    await writeFile(join(output, 'failure.txt'), String(error))
    throw error
  } finally {
    await context.close()
    if (teamId !== undefined) await scaffold.ctx.teamRuns.cancel(teamId)
    try { await scaffold.close() } catch (error: unknown) {
      if (failure !== undefined) throw new AggregateError([failure, error], 'Stalled draft scenario and cleanup failed')
      throw error
    }
  }
})
