/** A real model question reaches current Team inspection, retained input and revision-fenced answers. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { TeamStateSnapshot, TeamAttentionPage, TeamActionInspection, TeamHumanActionResponseInput } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { createNativeZoomContext } from './browser-native-zoom.ts'
import { teamAppearance, teamEvidence } from './team-acceptance-support.ts'

it('preserves a real question draft and retry identity, rechecks processed requests and clears revoked content', async () => {
  const output = join(process.cwd(), '.tmp/team-action-browser')
  await mkdir(output, { recursive: true })
  const override = join(output, 'question.json')
  const args = JSON.stringify({ questions: [{ id: 'evidence', question: '需要包含哪些验证证据？', options: [{ label: '真实浏览器流程' }] }] })
  await writeFile(override, JSON.stringify([{ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'pending-question', name: 'ask_user_question', argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'pending-question', name: 'ask_user_question', arguments: args } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] }, { kind: 'hang' }]))
  const scaffold = await launchWebScaffold({ tempRoot: output, replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'), replayOverride: override })
  const { context, setNativeZoom } = await createNativeZoomContext(output, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchConsole(page)
  const sockets: WebSocketRoute[] = []
  await page.routeWebSocket(/\/api\/events\.(mux|host)/, (socket) => { sockets.push(socket); socket.connectToServer() })
  let teamId: TeamStateSnapshot['team']['id'] | undefined
  let failure: unknown
  let grantWithdrawn = false
  const commands: TeamHumanActionResponseInput[] = []
  let answerFailure: 'before' | 'after' | undefined = 'before'
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${JSON.stringify(response.result.error)}`)
    return response.result.value
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    const created = await rpc<TeamStateSnapshot>('team.create', { objective: '核对并答复人工请求', cwd: scaffold.workspaceCwd })
    teamId = created.team.id
    await rpc('team.postInput', { teamId, text: '先向我确认需要的验证证据。' })
    let pending: TeamAttentionPage | undefined
    await expect.poll(async () => {
      pending = await rpc<TeamAttentionPage>('team.attention.read', { teamId })
      return pending.counts.humanActions
    }).toBe(1)
    const request = pending!.items.find(item => item.kind === 'human-action')!
    const initial = await rpc<TeamActionInspection>('team.action.inspect', { teamId, actionId: request.id })
    expect(initial.handling).toEqual({ kind: 'actionable' })
    await page.goto(`${scaffold.baseUrl}?team=${teamId}&view=attention`, { waitUntil: 'load' })
    const panel = page.locator('[data-team-workspace-page]')
    const list = panel.locator('[data-team-attention="list"]')
    await list.getByRole('button', { name: '问题', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '人工请求详情', exact: true })
    await dialog.getByText('需要包含哪些验证证据？', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: '核对当前请求', exact: true }).click()
    await dialog.getByRole('textbox', { name: '其他答复', exact: true }).fill('请保留真实浏览器截图和权限撤销证据。')
    await page.screenshot({ path: join(output, 'question-draft.png') })
    const departure = page.waitForEvent('dialog')
    const reload = page.reload({ waitUntil: 'commit' }).catch((error: unknown) => String(error))
    const warning = await departure
    expect(warning.type()).toBe('beforeunload')
    await warning.dismiss()
    await reload
    expect(await dialog.getByRole('textbox', { name: '其他答复', exact: true }).inputValue()).toBe('请保留真实浏览器截图和权限撤销证据。')
    for (const locale of ['zh', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
      await page.getByRole('dialog').getByRole('button', { name: /^(关闭并保留草稿|Close and keep draft)$/, exact: true }).click()
      await teamAppearance(page, locale, theme)
      await list.getByRole('button', { name: locale === 'zh' ? '问题' : 'Question', exact: true }).click()
      const question = page.getByRole('dialog', { name: locale === 'zh' ? '人工请求详情' : 'Human request details', exact: true })
      await question.getByText('需要包含哪些验证证据？', { exact: true }).waitFor()
      for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['short', { width: 1280, height: 480 }],
        ['narrow', { width: 390, height: 844 }], ['zoom200', { width: 1440, height: 1000 }]] as const) {
        await page.setViewportSize(viewport)
        const nativeZoom = await setNativeZoom(page, size === 'zoom200' ? 2 : 1)
        await teamEvidence(page, question, output, `${locale}-${theme}-question-${size}`,
          { locale, theme, nativeZoom, data: 'pending-question-draft', assertion: 'exact human request and retained answer remain readable' })
      }
      await setNativeZoom(page, 1)
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await page.getByRole('dialog').getByRole('button', { name: 'Close and keep draft', exact: true }).click()
    await teamAppearance(page, 'zh', 'light')
    await list.getByRole('button', { name: '问题', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(output, 'question-draft-narrow.png') })
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await dialog.getByRole('button', { name: '关闭并保留草稿', exact: true }).click()
    await panel.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '任务', exact: true }).click()
    await page.goBack({ waitUntil: 'load' })
    await list.getByRole('button', { name: '问题', exact: true }).waitFor()
    await page.goBack({ waitUntil: 'load' })
    await dialog.getByRole('textbox', { name: '其他答复', exact: true }).waitFor()
    expect(await dialog.getByRole('textbox', { name: '其他答复', exact: true }).inputValue()).toBe('请保留真实浏览器截图和权限撤销证据。')
    for (const socket of sockets.splice(0)) await socket.close({ code: 1001, reason: 'Request draft reconnect evidence' })
    await expect.poll(() => dialog.getByRole('button', { name: '刷新请求详情', exact: true }).isEnabled()).toBe(true)
    await dialog.getByRole('button', { name: '核对当前请求', exact: true }).click()
    await scaffold.replaceBrowserAuthentication()
    await dialog.waitFor({ state: 'hidden' })
    expect(await page.getByText('需要包含哪些验证证据？', { exact: true }).count()).toBe(0)
    await scaffold.authenticateBrowserPage(page)
    await page.getByRole('button', { name: '重新检查访问', exact: true }).click()
    await dialog.getByRole('textbox', { name: '其他答复', exact: true }).waitFor()
    expect(await dialog.getByRole('textbox', { name: '其他答复', exact: true }).inputValue()).toBe('')
    await dialog.getByRole('button', { name: '核对当前请求', exact: true }).click()
    await dialog.getByRole('textbox', { name: '其他答复', exact: true }).fill('请保留真实浏览器截图和权限撤销证据。')
    await page.route('**/api/team.inbox.respond', async (route) => {
      commands.push((route.request().postDataJSON() as { payload: TeamHumanActionResponseInput }).payload)
      if (answerFailure === 'before') { answerFailure = 'after'; await route.abort('failed'); return }
      if (answerFailure === 'after') { answerFailure = undefined; await route.fetch(); await route.abort('failed'); return }
      await route.continue()
    })
    await dialog.getByRole('button', { name: '提交答复', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    await dialog.getByRole('button', { name: '关闭并保留草稿', exact: true }).click()
    await list.getByRole('button', { name: '问题', exact: true }).click()
    await dialog.getByRole('button', { name: '核对当前请求', exact: true }).click()
    expect(await dialog.getByRole('textbox', { name: '其他答复', exact: true }).inputValue()).toBe('请保留真实浏览器截图和权限撤销证据。')
    await dialog.getByRole('button', { name: '提交答复', exact: true }).click()
    await expect.poll(async () => (await rpc<TeamActionInspection>('team.action.inspect', { teamId, actionId: request.id })).action.phase).toBe('resolved')
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    await dialog.getByRole('button', { name: '刷新请求详情', exact: true }).click()
    await dialog.getByText('事项已处理', { exact: true }).waitFor()
    expect(await dialog.getByRole('button', { name: '提交答复', exact: true }).count()).toBe(0)
    await page.screenshot({ path: join(output, 'request-processed.png') })
    const command = commands[0]!
    await rpc('team.inbox.respond', command)
    await expect.poll(async () => (await rpc<TeamAttentionPage>('team.attention.read', { teamId })).counts.humanActions).toBe(0)
    await scaffold.replaceBrowserAuthentication()
    await dialog.waitFor({ state: 'hidden' })
    expect(await page.getByText('需要包含哪些验证证据？', { exact: true }).count()).toBe(0)
    await scaffold.authenticateBrowserPage(page)
    await page.getByRole('button', { name: '重新检查访问', exact: true }).click()
    await dialog.getByText('事项已处理', { exact: true }).waitFor()
    expect(await dialog.getByRole('textbox', { name: '其他答复', exact: true }).isDisabled()).toBe(true)
    const current = await rpc<TeamStateSnapshot>('team.get', { teamId })
    const human = current.participants.find(member => member.kind === 'human' && member.phase === 'active')
    if (human === undefined) throw new Error('No active membership to withdraw')
    await rpc('team.member.remove', { teamId, participantId: human.id, expectedCursor: current.team.cursor })
    grantWithdrawn = true
    await dialog.waitFor({ state: 'hidden' })
    expect(await page.getByText('需要包含哪些验证证据？', { exact: true }).count()).toBe(0)
    for (const method of ['team.attention.read', 'team.action.inspect']) {
      expect((await scaffold.authenticatedRpc(method, { teamId, ...method === 'team.action.inspect' ? { actionId: request.id } : {} })).result)
        .toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' } })
    }
    expect((await scaffold.authenticatedRpc('team.inbox.respond', command)).result)
      .toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' } })
    await page.screenshot({ path: join(output, 'durable-human-grant-withdrawal.png') })
    expect(errors.pageErrors).toEqual([])
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
  } catch (error: unknown) {
    failure = error
    await writeFile(join(output, 'failure.txt'), String(error))
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  } finally {
    try {
      await context.close()
      // Removed membership authorizes no new Team cancellation; the scaffold owns raw resource disposal.
      if (teamId !== undefined && !grantWithdrawn) await rpc('team.cancel', { teamId })
    }
    finally {
      try { await scaffold.close() }
      catch (error: unknown) { if (failure !== undefined) throw new AggregateError([failure, error], 'Request scenario and cleanup failed'); throw error }
    }
  }
})
