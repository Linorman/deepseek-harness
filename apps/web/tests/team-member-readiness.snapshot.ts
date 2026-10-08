/** Real routing, activation, task delivery and reporting distinguish membership from execution readiness. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type WebSocketRoute } from 'playwright'
import { expect, it, vi } from 'vitest'
import type { ParticipantSnapshot, TeamMemberReadinessPage, TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import * as TeamPlacement from '@clocky/clocky-team-placement-default'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { createNativeZoomContext } from './browser-native-zoom.ts'
import { teamAppearance, teamEvidence } from './team-acceptance-support.ts'

it('keeps unrouted members non-executing and runs a configured member through the production scheduler and task reporter', async () => {
  const output = join(process.cwd(), '.tmp/team-member-readiness-browser')
  await mkdir(output, { recursive: true })
  const override = join(output, 'coordinator.json')
  await writeFile(override, JSON.stringify([{ kind: 'hang' }]))
  const child = join(output, 'worker.jsonl')
  const args = JSON.stringify({ task_id: '{{fromRequest:task-[0-9a-f-]{36}}}', attempt_id: '{{fromRequest:attempt-[0-9a-f-]{36}}}',
    outcome: 'completed', summary: 'Configured member completed the real assignment.' })
  const chunks = [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'readiness-report', name: 'team_task_report', argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'readiness-report', name: 'team_task_report', arguments: args } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
  await writeFile(child, [JSON.stringify({ type: 'session', version: 0, id: 'readiness-worker-script', createdAt: 1 }),
    ...chunks.map(chunk => JSON.stringify({ type: 'assistant/chunk', data: { turn: 1, step: 1, chunk } })),
  ].join('\n') + '\n')
  const overlay = join(output, 'routes.yml')
  await writeFile(overlay, `- id: team-placement-default
  config:
    routes:
      - provider: in-process
        roles: [readiness-worker]
        model: test-provider/test-model
        modelProvider: test-provider
        modelId: test-model
        preset: minimal
        cwd: !!js process.cwd()
        maxTokens: 1000
    maxActivationsPerDrive: 1
    maxCursorRetries: 3
`)
  const scaffold = await launchWebScaffold({ tempRoot: output, replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'),
    replayOverride: override, replayChildFixtures: [child], extraOverlayPath: overlay })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const sockets: WebSocketRoute[] = []
  let blockReconnect = false
  await page.routeWebSocket(/\/api\/events\.(mux|host)/, (socket) => {
    if (blockReconnect) { void socket.close({ code: 1001, reason: 'Identity disconnect verification' }); return }
    sockets.push(socket)
    socket.connectToServer()
  })
  const errors = watchConsole(page)
  let teamId: TeamStateSnapshot['team']['id'] | undefined
  let failure: unknown
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${response.result.error.message}`)
    return response.result.value
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    const created = await rpc<TeamStateSnapshot>('team.create', { objective: '检查成员执行状态', cwd: scaffold.workspaceCwd })
    teamId = created.team.id
    const state = async () => await rpc<TeamStateSnapshot>('team.get', { teamId })
    await rpc('team.postInput', { teamId, text: '等待成员执行验证。' })
    await expect.poll(async () => (await state()).activations.some(binding => binding.activation.status === 'running')).toBe(true)
    const invite = async (displayName: string, role: string) => {
      const member = await rpc<ParticipantSnapshot>('team.member.invite', { teamId, expectedCursor: (await state()).team.cursor,
        kind: 'local-agent', displayName, role, capabilities: ['readiness-work'],
        provider: 'in-process', preset: 'minimal', model: 'test-provider/test-model' })
      await rpc('team.member.activate', { teamId, participantId: member.id, expectedCursor: (await state()).team.cursor })
      return member
    }
    const unrouted = await invite('未配置成员', 'unrouted-worker')
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: /^检查成员执行状态 / }).click()
    const panel = page.locator('[data-team-workspace-page]')
    await panel.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '成员', exact: true }).click()
    await panel.getByRole('button', { name: '邀请成员', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '邀请成员', exact: true })
    await dialog.getByLabel('显示名称', { exact: true }).fill('已配置成员')
    await dialog.getByLabel('能力（用逗号分隔）', { exact: true }).fill('readiness-work')
    await dialog.getByRole('radio', { name: /readiness-worker.*in-process/ }).check()
    await expect.poll(() => dialog.getByLabel('角色', { exact: true }).inputValue()).toBe('readiness-worker')
    await page.screenshot({ path: join(output, 'execution-profile-picker.png') })
    await dialog.getByRole('button', { name: '邀请成员', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    const routed = (await state()).participants.find(member => member.displayName === '已配置成员')
    expect(routed).toBeDefined()
    if (routed === undefined) throw new Error('Selected profile did not register a member')
    expect(routed).toMatchObject({ role: 'readiness-worker', provider: 'in-process', preset: 'minimal', model: 'test-provider/test-model' })
    expect((await state()).activations.some(binding => binding.activation.participantId === routed.id)).toBe(false)
    await rpc('team.member.activate', { teamId, participantId: routed.id, expectedCursor: (await state()).team.cursor })
    const before = await state()
    const observed = await rpc<TeamMemberReadinessPage>('team.member.readiness', { teamId, participantIds: [unrouted.id, routed.id] })
    expect(observed.items.map(item => [item.participation, item.state])).toEqual([['active', 'route-unavailable'], ['active', 'ready']])
    expect((await state()).activations).toEqual(before.activations)
    const unroutedRow = panel.getByRole('listitem').filter({ has: page.getByText('未配置成员', { exact: true }) })
    const routedRow = panel.getByRole('listitem').filter({ has: page.getByText('已配置成员', { exact: true }) })
    await expect.poll(() => unroutedRow.textContent()).toContain('执行配置不可用')
    await expect.poll(() => routedRow.textContent()).toContain('配置就绪')
    await page.screenshot({ path: join(output, 'member-readiness.png') })
    const task = await rpc<TeamTaskSnapshot>('team.task.create', { teamId, expectedCursor: (await state()).team.cursor,
      idempotencyKey: 'readiness-task', subject: '执行已配置成员任务', description: 'Report completion with the assigned task and attempt identities.',
      blockedBy: [], requiredCapabilities: ['readiness-work'], placement: { participantIds: [routed.id] },
      priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 })
    let settled: TeamTaskSnapshot | undefined
    await expect.poll(async () => {
      settled = await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: task.id })
      return settled.phase
    }, { timeout: 30_000 }).toBe('completed')
    expect(settled?.attemptCount).toBe(1)
    expect(settled?.attemptHistory[0]).toMatchObject({ participantId: routed.id,
      outcome: { kind: 'completed', result: { summary: 'Configured member completed the real assignment.' } } })
    expect((await state()).activations.some(binding => binding.activation.participantId === unrouted.id)).toBe(false)
    await routedRow.getByRole('button', { name: '查看成员详情', exact: true }).click()
    await page.getByRole('dialog', { name: '成员详情', exact: true }).getByText('team-placement-default.routes', { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(output, 'member-readiness-narrow.png') })
    await page.getByRole('dialog', { name: '成员详情', exact: true }).getByRole('button', { name: '取消', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
    for (let index = (await state()).participants.length; index < 66; index++) {
      await rpc('team.member.invite', { teamId, expectedCursor: (await state()).team.cursor, kind: 'service',
        displayName: `身份分页成员 ${index}`, role: 'service', capabilities: [] })
    }
    await panel.getByRole('button', { name: '刷新成员', exact: true }).click()
    await panel.getByRole('button', { name: '下一页成员', exact: true }).click()
    await expect.poll(() => routedRow.count()).toBe(0)
    await panel.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '任务', exact: true }).click()
    await panel.getByRole('button', { name: '刷新到第一页', exact: true }).click()
    const taskRow = panel.getByRole('row').filter({ has: page.getByRole('button', { name: '执行已配置成员任务', exact: true }) })
    await expect.poll(() => taskRow.getByRole('cell', { name: '已配置成员', exact: true }).count()).toBe(1)
    await page.screenshot({ path: join(output, 'off-page-member-identity.png') })
    await taskRow.getByRole('button', { name: '已配置成员', exact: true }).click()
    const ownerDetail = page.getByRole('dialog', { name: '成员详情', exact: true })
    await ownerDetail.getByText(routed.id, { exact: true }).waitFor()
    await page.context().grantPermissions(['clipboard-write'])
    await ownerDetail.getByRole('button', { name: '复制成员 ID', exact: true }).click()
    await ownerDetail.getByText('成员 ID 已复制', { exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'off-page-member-detail.png') })
    blockReconnect = true
    await sockets[0]!.close({ code: 1001, reason: 'Identity disconnect verification' })
    await panel.getByText('成员名称尚未重新验证，连接恢复后会更新。', { exact: true }).waitFor()
    await expect.poll(() => taskRow.getByRole('button', { name: '已配置成员', exact: true }).count()).toBe(1)
    await ownerDetail.getByText('连接已断开；显示的是上次获准读取的内容。', { exact: true }).waitFor()
    await expect.poll(() => ownerDetail.getByRole('button', { name: '刷新当前页', exact: true }).isDisabled()).toBe(true)
    await ownerDetail.getByText(routed.id, { exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'offline-member-identity.png') })
    await ownerDetail.getByRole('button', { name: '取消', exact: true }).click()
    await taskRow.getByRole('button', { name: '已配置成员', exact: true }).click()
    await ownerDetail.getByText('连接已断开；显示的是上次获准读取的内容。', { exact: true }).waitFor()
    await expect.poll(() => ownerDetail.getByRole('button', { name: '刷新当前页', exact: true }).isDisabled()).toBe(true)
    blockReconnect = false
    await expect.poll(() => panel.getByText('成员名称尚未重新验证，连接恢复后会更新。', { exact: true }).count()).toBe(0)
    await expect.poll(() => ownerDetail.getByRole('button', { name: '刷新当前页', exact: true }).isEnabled()).toBe(true)
    await expect.poll(() => ownerDetail.getByText('连接已断开；显示的是上次获准读取的内容。', { exact: true }).count()).toBe(0)
    await ownerDetail.getByText(routed.id, { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await ownerDetail.getByRole('button', { name: '刷新当前页', exact: true }).click()
    await expect.poll(() => ownerDetail.getByRole('button', { name: '刷新当前页', exact: true }).isEnabled()).toBe(true)
    await page.screenshot({ path: join(output, 'member-detail-narrow.png') })
    await page.keyboard.press('Escape')
    await expect.poll(() => ownerDetail.count()).toBe(0)
    await panel.getByRole('button', { name: '执行已配置成员任务', exact: true }).click()
    const taskSummary = panel.getByRole('complementary', { name: '任务摘要', exact: true })
    const openRecord = taskSummary.getByRole('button', { name: '查看执行记录', exact: true })
    await openRecord.click()
    const record = page.getByRole('region', { name: '执行记录', exact: true })
    await record.getByText('这是只读执行记录；请返回团队处理任务或与协调者沟通。', { exact: true }).waitFor()
    expect(await record.getByRole('textbox').count()).toBe(0)
    await expect.poll(() => record.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
    await page.screenshot({ path: join(output, 'worker-execution-record.png'), animations: 'disabled' })
    await record.getByRole('button', { name: '关闭对话', exact: true }).click()
    await record.waitFor({ state: 'hidden' })
    expect(await openRecord.evaluate(element => element === document.activeElement)).toBe(true)
    expect(await page.title()).toBe('Clocky')
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(errors.pageErrors).toEqual([])
  } catch (error: unknown) {
    failure = error
    await writeFile(join(output, 'failure.txt'), String(error))
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  } finally {
    try {
      await browser.close()
      if (teamId !== undefined) await rpc('team.cancel', { teamId })
    } finally {
      try { await scaffold.close() } catch (cleanupError) {
        if (failure !== undefined) throw new AggregateError([failure, cleanupError], 'Member readiness scenario and cleanup failed')
        throw cleanupError
      }
    }
  }
})

it('refreshes real provider availability while independently retaining exhausted activation capacity without Team WAL changes', async () => {
  const output = join(process.cwd(), '.tmp/team-readiness-capacity-browser')
  await mkdir(output, { recursive: true })
  const overlay = join(output, 'capacity.yml')
  await writeFile(overlay, `- id: team-run
  config:
    maxLiveActivations: 1
- id: team-placement-default
  disabled: true
- id: modules
  config:
    browserConfig:
      '@clocky/clocky-client-ui-team':
        readinessRefreshMs: 100
`)
  const scaffold = await launchWebScaffold({ tempRoot: output, extraOverlayPath: overlay })
  const { context, setNativeZoom } = await createNativeZoomContext(output, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchConsole(page)
  let teamId: TeamStateSnapshot['team']['id'] | undefined
  let failure: unknown
  let placements: Awaited<ReturnType<typeof scaffold.ctx.plugin>> | undefined
  let removeProvider: (() => void) | undefined
  let activations = 0
  let restoreProviderFailure: (() => void) | undefined
  const rpc = async <T>(method: string, payload: unknown): Promise<T> => {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${JSON.stringify(response.result.error)}`)
    return response.result.value
  }
  try {
    const runtime = scaffold.ctx.agentRuntimes.getProvider('in-process')
    if (runtime === undefined) throw new Error('Real in-process runtime is unavailable')
    const provider = { name: 'readiness-capacity-runtime', participantKinds: runtime.participantKinds,
      terminationMode: runtime.terminationMode, activate: async (input: Parameters<typeof runtime.activate>[0]) => {
        activations++
        return await runtime.activate(input)
      } }
    removeProvider = scaffold.ctx.agentRuntimes.registerProvider(provider)
    placements = await scaffold.ctx.plugin(TeamPlacement, { routes: [{ provider: provider.name, roles: ['capacity-observer'],
      model: 'test-provider/test-model', modelProvider: 'test-provider', modelId: 'test-model', preset: 'minimal',
      cwd: scaffold.workspaceCwd, maxTokens: 1000 }], maxActivationsPerDrive: 1, maxCursorRetries: 2 })
    await scaffold.authenticateBrowserPage(page)
    const created = await rpc<TeamStateSnapshot>('team.create', { objective: '独立核对执行配置与容量', cwd: scaffold.workspaceCwd })
    teamId = created.team.id
    const state = () => rpc<TeamStateSnapshot>('team.get', { teamId })
    const member = await rpc<ParticipantSnapshot>('team.member.invite', { teamId, expectedCursor: (await state()).team.cursor,
      kind: 'local-agent', displayName: '等待容量成员', role: 'capacity-observer', capabilities: ['capacity-observer'],
      provider: provider.name, model: 'test-provider/test-model', preset: 'minimal' })
    await rpc('team.member.activate', { teamId, participantId: member.id, expectedCursor: (await state()).team.cursor })
    const before = await state()
    const read = () => rpc<TeamMemberReadinessPage>('team.member.readiness', { teamId, participantIds: [member.id] })
    expect((await read()).items[0]).toMatchObject({ state: 'capacity-wait', reasons: ['activation-capacity'] })
    await page.goto(`${scaffold.baseUrl}?team=${teamId}&view=members`, { waitUntil: 'load' })
    await teamAppearance(page, 'zh', 'light')
    const panel = page.locator('[data-team-workspace-page]')
    const row = panel.getByRole('listitem').filter({ has: page.getByText(member.displayName, { exact: true }) })
    await expect.poll(() => row.textContent()).toContain('等待容量')
    const first = await read()
    removeProvider()
    removeProvider = undefined
    await expect.poll(() => row.textContent()).toContain('执行配置不可用')
    const unavailable = await read()
    expect(unavailable.items[0]).toMatchObject({ state: 'route-unavailable', reasons: ['provider-unavailable', 'activation-capacity'] })
    expect(unavailable.teamCursor).toBe(before.team.cursor)
    expect(unavailable.observationId).not.toBe(first.observationId)
    await row.getByRole('button', { name: '查看成员详情', exact: true }).click()
    const detail = page.getByRole('dialog', { name: '成员详情', exact: true })
    await teamEvidence(page, detail, output, 'provider-unavailable-capacity-independent',
      { locale: 'zh', theme: 'light', data: 'provider-removed-capacity-exhausted', assertion: 'provider and capacity remain distinct; no admission' })
    await page.keyboard.press('Escape')
    removeProvider = scaffold.ctx.agentRuntimes.registerProvider(provider)
    await expect.poll(() => row.textContent()).toContain('等待容量')
    const nativeZoom = await setNativeZoom(page, 2)
    await teamEvidence(page, panel, output, 'capacity-restored-provider-zoom200',
      { locale: 'zh', theme: 'light', nativeZoom, data: 'provider-restored-capacity-exhausted', assertion: 'automatic readiness recheck without WAL or page refresh' })
    expect((await state()).team.cursor).toBe(before.team.cursor)
    expect((await state()).activations).toEqual(before.activations)
    expect(activations).toBe(0)
    await setNativeZoom(page, 1)
    const coordinator = created.participants.find(participant => participant.role === 'coordinator')
    const binding = created.activations.find(item => item.activation.participantId === coordinator?.id)
    if (coordinator === undefined || binding === undefined) throw new Error('Production coordinator binding is unavailable')
    const raw = await runtime.activate({ provider: 'in-process', teamId, participant: coordinator, sessionId: binding.sessionId,
      seed: { kind: 'resume' }, agent: { options: {} }, signal: new AbortController().signal })
    expect(raw.activation.id).toBe(binding.activation.id)
    // Capture the service's own class across the Loader/Vitest module boundary; provider rejection creates no registration.
    let registryFailure: unknown
    try { scaffold.ctx.agentRuntimes.registerProvider({ ...provider, name: '' }) }
    catch (error: unknown) { registryFailure = error }
    if (!(registryFailure instanceof Error)) throw new Error('Actual runtime validation did not return its owned error')
    const RuntimeError = registryFailure.constructor as new (message: string, code: 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED') => Error
    const dispose = vi.spyOn(raw, 'dispose').mockRejectedValue(new RuntimeError('Provider termination proof unavailable', 'AGENT_RUNTIME_TERMINATION_UNCONFIRMED'))
    restoreProviderFailure = () => { dispose.mockRestore() }
    const cancellation = await scaffold.authenticatedRpc('team.cancel', { teamId })
    expect(cancellation.result.ok).toBe(false)
    const recovering = await rpc<TeamMemberReadinessPage>('team.member.readiness', { teamId, participantIds: [coordinator.id] })
    expect(recovering.items[0]?.state).toBe('recovery-required')
    expect(recovering.items[0]?.reasons).toContain('old-writer')
    const coordinatorRow = panel.getByRole('listitem').filter({ has: page.getByText(coordinator.displayName, { exact: true }) })
    await expect.poll(() => coordinatorRow.textContent()).toContain('需要恢复处理')
    expect((await state()).activations.find(item => item.activation.id === binding.activation.id)?.quiescedAt).toBeUndefined()
    await teamEvidence(page, panel, output, 'unconfirmed-coordinator-writer',
      { locale: 'zh', theme: 'light', data: 'termination-unconfirmed', assertion: 'old writer retains recovery responsibility and capacity; no duplicate activation' })
    expect(activations).toBe(0)
    restoreProviderFailure()
    restoreProviderFailure = undefined
    expect(errors.pageErrors).toEqual([])
  } catch (error: unknown) {
    failure = error
    await page.screenshot({ path: join(output, 'failure.png') })
    await writeFile(join(output, 'failure.txt'), String(error))
    throw error
  } finally {
    restoreProviderFailure?.()
    await context.close()
    if (teamId !== undefined) await scaffold.ctx.teamRuns.cancel(teamId)
    await placements?.dispose()
    removeProvider?.()
    try { await scaffold.close() } catch (error: unknown) {
      if (failure !== undefined) throw new AggregateError([failure, error], 'Readiness capacity scenario and cleanup failed')
      throw error
    }
  }
})
