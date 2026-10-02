import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import type { TeamStateSnapshot, TeamTaskSnapshot, TeamAttentionPage, TeamActionInspection } from '@clocky/clocky-team'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { CallId } from '@clocky/clocky-llm/brand'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { createNativeZoomContext } from './browser-native-zoom.ts'
import { teamAppearance, teamEvidence } from './team-acceptance-support.ts'

it('refreshes and opens a live child Team, then settles parent cancellation through the real browser', async () => {
  const output = join(process.cwd(), '.tmp/team-child-navigation-browser-evidence-current')
  await mkdir(output, { recursive: true })
  const override = join(output, 'replay.json')
  const channelId = '{{fromRequest:channel-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}}}'
  const response = JSON.stringify({ channel_id: channelId, text: '子任务已创建。', delivery: 'context' })
  await writeFile(override, JSON.stringify([
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'child-delegate', name: 'team_task_delegate', argumentsDelta: JSON.stringify({
        subject: 'Child navigation probe', instructions: 'Run the child navigation probe.', read_scopes: [], write_scopes: [], budget: { maxChildTeams: 0, maxLiveActivations: 3 },
      }) },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'child-delegate', name: 'team_task_delegate', arguments: JSON.stringify({
        subject: 'Child navigation probe', instructions: 'Run the child navigation probe.', read_scopes: [], write_scopes: [], budget: { maxChildTeams: 0, maxLiveActivations: 3 },
      }) } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] },
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'child-message', name: 'team_message', argumentsDelta: response },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'child-message', name: 'team_message', arguments: response } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] },
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '子任务已创建。' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '子任务已创建。' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
  ]))
  const permissions = join(output, 'permission.yml')
  const integration = join(output, 'external-integration.mjs')
  // Mock only the external integration; the model, tool registry, audit/approval owner and Team projection remain real.
  await writeFile(integration, `export const name = 'team-child-external-integration-fixture'
export const inject = ['tools', 'approval', 'agents']
export function apply(ctx) {
  const installed = new Map()
  const install = agent => {
    if (installed.has(agent)) return
    installed.set(agent, agent.ctx.tools.register({ name: 'external_child_approval', description: 'Request approval before the test external integration.',
    parameters: {},
    output: { schema: { type: 'string', enum: ['allowed-once', 'rejected', 'cancelled', 'unavailable'] },
      render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, execution) {
      if (execution.agent === undefined) throw new Error('External integration requires its actual calling agent')
      return await ctx.approval.request({ agent: execution.agent, toolName: 'external_child_approval',
        callId: execution.callId, reason: 'Approve the test child external integration.', signal: execution.signal })
    },
    }))
  }
  for (const agent of ctx.agents.list()) install(agent)
  ctx.on('agent/created', ({ agent }) => install(agent))
  ctx.on('agent/disposed', ({ agent }) => { installed.get(agent)?.(); installed.delete(agent) })
  ctx.effect(() => () => { for (const dispose of installed.values()) dispose(); installed.clear() })
}
`)
  await writeFile(permissions, `- insert:
    - id: team-child-external-integration-fixture
      name: ${JSON.stringify(pathToFileURL(integration).href)}
`)
  const scaffold = await launchWebScaffold({ tempRoot: output, extraOverlayPath: permissions,
    replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'),
    replayOverride: override,
  })
  const { context, setNativeZoom } = await createNativeZoomContext(output, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchConsole(page)
  let created: TeamStateSnapshot | undefined
  let childTeamId: TeamStateSnapshot['team']['id'] | undefined
  let childModelSession: GenerateOptions['sessionId']
  let childModelCalls = 0
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (response.result.ok) return response.result.value
    throw new Error(`${method}: ${response.result.error.message}`)
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    created = await rpc<TeamStateSnapshot>('team.create', { objective: '验证 child Team 浏览器导航', cwd: scaffold.workspaceCwd })
    const coordinator = created.participants.find(member => member.role === 'coordinator')
    const binding = created.activations.find(binding => binding.activation.participantId === coordinator?.id)
    if (binding === undefined) throw new Error('Parent coordinator has no production activation')
    const childRequest = Promise.withResolvers<undefined>()
    async function* childModel(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (options.signal === undefined || options.sessionId === undefined) throw new Error('Child inference has no cancellable Session')
      childModelSession = options.sessionId
      childModelCalls++
      if (childModelCalls > 1) throw new Error('The first external integration call did not establish a pending approval')
      childRequest.resolve(undefined)
      const input = '{}'
      const callId = CallId('child-human-approval')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: callId, name: 'external_child_approval', argumentsDelta: input }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'external_child_approval', arguments: input } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
    scaffold.ctx.on('llm/stream', (options, next) => options.sessionId === binding.sessionId ? next() : childModel(options))
    const settled = scaffold.whenTurnSettled(60_000)
    await rpc('team.postInput', { teamId: created.team.id, text: '请委派一个 child Team 并返回进度。', delivery: 'turn' })
    await settled
    const session = await scaffold.ctx.sessionPersistence.inspect(binding.sessionId)
    await writeFile(join(output, 'tool-results.json'), JSON.stringify(session.events.filter(event => event.type === 'tool/result'), null, 2))
    let childTask: TeamTaskSnapshot | undefined
    await expect.poll(async () => {
      const tasks = await rpc<{ items: readonly TeamTaskSnapshot[] }>('team.task.list', { teamId: created!.team.id, afterCursor: -1, limit: 32 })
      childTask = tasks.items.find(task => task.execution.kind === 'child-team' && task.delegation?.childTeamId !== undefined)
      return childTask !== undefined
    }, { timeout: 30_000 }).toBe(true)
    if (childTask?.delegation?.childTeamId === undefined) throw new Error('child task did not publish its child Team identity')
    childTeamId = childTask.delegation.childTeamId
    await childRequest.promise
    const child = await rpc<TeamStateSnapshot>('team.get', { teamId: childTeamId })
    expect(child.team.phase).toBe('active')
    expect(child.activations.some(activation => activation.sessionId === childModelSession && activation.activation.status === 'running')).toBe(true)
    const denied = await scaffold.authenticatedRpc('team.task.create', { teamId: childTeamId, expectedCursor: child.team.cursor,
      idempotencyKey: 'parent-mutation-isolation', subject: 'Must not be admitted', description: 'Parent inspection is read-only.',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 })
    expect(denied.result).toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_NOT_FOUND' } })
    let pending: TeamAttentionPage | undefined
    await expect.poll(async () => {
      pending = await rpc<TeamAttentionPage>('team.attention.read', { teamId: childTeamId })
      return pending.counts.humanActions
    }).toBe(1)
    const action = pending!.items.find(item => item.kind === 'human-action')
    if (action === undefined) throw new Error('Child model did not publish an exact pending approval')
    const inspectedAction = await rpc<TeamActionInspection>('team.action.inspect', { teamId: childTeamId, actionId: action.id })
    expect(inspectedAction.handling).toMatchObject({ kind: 'waiting', reason: 'parent-inspection' })
    expect((await scaffold.authenticatedRpc('team.inbox.respond', { teamId: childTeamId, actionId: action.id,
      expectedUpdatedAt: inspectedAction.action.updatedAt, idempotencyKey: 'parent-cannot-answer-child',
      answer: { kind: 'approval', outcome: 'allowed-once' } })).result)
      .toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' } })
    await expect(readFile(join(scaffold.workspaceCwd, 'child-approval.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await rpc('team.task.update.result', { teamId: childTeamId, taskId: 'unknown-child-task', commandId: 'original-parent-inspection' }))
      .toMatchObject({ kind: 'not-found' })

    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: /^验证 child Team 浏览器导航 / }).click()
    const panel = page.locator('[data-team-workspace-page]')
    await panel.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '任务', exact: true }).click()
    await panel.getByRole('button', { name: '刷新到第一页', exact: true }).click()
    await panel.getByRole('button', { name: 'Child navigation probe', exact: true }).click()
    await panel.getByRole('button', { name: '打开子任务', exact: true }).waitFor()
    await panel.getByRole('button', { name: '打开子任务', exact: true }).click()
    await panel.getByRole('heading', { name: 'Run the child navigation probe.', exact: true }).waitFor()
    await panel.getByText('通过父团队进行只读检查；运行与修改仍由原团队管理。', { exact: true }).waitFor()
    await expect.poll(() => new URL(page.url()).searchParams.get('team')).toBe(childTeamId)
    await page.reload({ waitUntil: 'load' })
    await panel.getByRole('heading', { name: 'Run the child navigation probe.', exact: true }).waitFor()
    await panel.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '成员', exact: true }).click()
    await panel.getByRole('button', { name: '查看成员详情', exact: true }).first().click()
    await page.getByRole('dialog', { name: '成员详情', exact: true }).waitFor()
    expect(await page.getByRole('dialog').getByRole('alert').count()).toBe(0)
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    expect(await panel.getByRole('button', { name: '邀请成员', exact: true }).count()).toBe(0)
    await page.screenshot({ path: join(output, 'child-read-only-members.png') })
    for (const locale of ['zh', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await teamAppearance(page, locale, theme)
      const nav = panel.getByRole('navigation', { name: locale === 'zh' ? '团队模块' : 'Team modules' })
      await nav.locator('button[aria-expanded]').click()
      await page.getByRole('menuitem', { name: locale === 'zh' ? '需要你处理' : 'Needs your attention', exact: true }).click()
      const list = panel.locator('[data-team-attention="list"]')
      await list.getByRole('button', { name: locale === 'zh' ? '批准' : 'Approval', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: locale === 'zh' ? '人工请求详情' : 'Human request details', exact: true })
      await dialog.getByText('external_child_approval', { exact: true }).waitFor()
      expect(await dialog.getByRole('button', { name: locale === 'zh' ? '仅允许本次' : 'Allow once', exact: true }).count()).toBe(0)
      await dialog.getByText(locale === 'zh' ? '父团队只读检查' : 'Read-only parent inspection', { exact: true }).waitFor()
      await teamEvidence(page, dialog, output, `${locale}-${theme}-canonical-parent-request`,
        { locale, theme, data: 'canonical-parent-waiting-permission', assertion: 'exact source is readable; no child answer authority' })
      for (const viewport of [{ width: 1280, height: 480 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport)
        await teamEvidence(page, dialog, output, `${locale}-${theme}-canonical-parent-${viewport.width}x${viewport.height}`,
          { locale, theme, data: 'canonical-parent-waiting-permission', assertion: 'bounded approval remains readable without answer authority' })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      const nativeZoom = await setNativeZoom(page, 2)
      await teamEvidence(page, dialog, output, `${locale}-${theme}-canonical-parent-request-zoom200`,
        { locale, theme, nativeZoom, data: 'canonical-parent-waiting-permission', assertion: 'native 200% retains child source and permission explanation' })
      await setNativeZoom(page, 1)
      await page.keyboard.press('Escape')
    }
    await teamAppearance(page, 'zh', 'light')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-sidebar-collapsed]').waitFor()
    await expect.poll(() => page.locator('[data-clocky-navigation]').getByText('新建团队工作', { exact: true }).count()).toBe(0)
    await page.locator('[data-sidebar-collapsed]').evaluate(async (element) => {
      await Promise.allSettled(element.getAnimations().map(animation => animation.finished))
    })
    await expect.poll(async () => {
      const box = await panel.boundingBox()
      return box !== null && box.x >= 0 && box.x + box.width <= 390
    }).toBe(true)
    await page.screenshot({ path: join(output, 'child-read-only-narrow.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    expect(childModelCalls).toBe(1)
    await expect.poll(async () => (await rpc<TeamStateSnapshot>('team.get', { teamId: childTeamId })).team.parentTeamId).toBe(created.team.id)
    await rpc('team.cancel', { teamId: created.team.id })
    await expect.poll(async () => (await rpc<TeamStateSnapshot>('team.get', { teamId: created!.team.id })).team.phase).toBe('cancelled')
    await expect.poll(async () => (await rpc<TeamStateSnapshot>('team.get', { teamId: childTeamId })).team.phase).toBe('cancelled')
    await expect(readFile(join(scaffold.workspaceCwd, 'child-approval.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(output, 'child-navigation-cancelled.png') })
  } catch (error: unknown) {
    if (childTeamId !== undefined) await writeFile(join(output, 'child-state-diagnostic.json'),
      JSON.stringify(await rpc<TeamStateSnapshot>('team.get', { teamId: childTeamId }), null, 2))
    if (childModelSession !== undefined) await writeFile(join(output, 'child-history-diagnostic.json'), JSON.stringify({
      childModelCalls, events: scaffold.ctx.sessions.get(childModelSession)?.events,
      persisted: await scaffold.ctx.sessionPersistence.inspect(childModelSession),
    }, null, 2))
    await page.screenshot({ path: join(output, 'child-navigation-diagnostic.png') })
    await writeFile(join(output, 'browser-diagnostic.json'), JSON.stringify({
      failure: error instanceof Error ? error.message : String(error), url: page.url(),
      title: await page.title(), alerts: await page.getByRole('alert').allTextContents(),
      buttons: await page.getByRole('button').allTextContents(), errors: errors.pageErrors,
      ...created === undefined ? {} : { team: await rpc<TeamStateSnapshot>('team.get', { teamId: created.team.id }) },
    }, null, 2) + '\n')
    throw error
  } finally {
    try {
      if (created !== undefined) await rpc('team.cancel', { teamId: created.team.id })
    } catch { /* the scenario already records the first lifecycle failure */ }
    await context.close()
    await scaffold.close()
  }
}, 120_000)
