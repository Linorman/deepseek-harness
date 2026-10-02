/** Real assignments and reports create off-page reviews consumed by the Team pending workspace. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { ParticipantSnapshot, TeamStateSnapshot, TeamTaskSnapshot, TeamAttentionPage } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { createNativeZoomContext } from './browser-native-zoom.ts'
import { teamAppearance, teamEvidence } from './team-acceptance-support.ts'

it('keeps Team pending navigation through preview failure, exact paging, reload and narrow inspection', async () => {
  const output = join(process.cwd(), '.tmp/team-attention-browser')
  await mkdir(output, { recursive: true })
  const override = join(output, 'coordinator.json')
  await writeFile(override, JSON.stringify([{ kind: 'hang' }]))
  const child = join(output, 'worker.jsonl')
  const args = JSON.stringify({ task_id: '{{fromRequest:task-[0-9a-f-]{36}}}', attempt_id: '{{fromRequest:attempt-[0-9a-f-]{36}}}',
    outcome: 'completed', summary: 'Pending review from a real worker report.' })
  const chunks = [
    { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
    { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 0, id: 'pending-report', name: 'team_task_report', argumentsDelta: args } },
    { turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'pending-report', name: 'team_task_report', arguments: args } } },
    { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
    { turn: 1, step: 2, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { turn: 1, step: 2, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'Waiting for review.' } } },
    { turn: 1, step: 2, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ]
  await writeFile(child, [JSON.stringify({ type: 'session', version: 0, id: 'pending-worker', createdAt: 1 }),
    ...chunks.map(data => JSON.stringify({ type: 'assistant/chunk', data })),
  ].join('\n') + '\n')
  const overlay = join(output, 'routes.yml')
  await writeFile(overlay, `- id: team-placement-default
  config:
    routes:
      - provider: in-process
        roles: [pending-worker]
        model: test-provider/test-model
        modelProvider: test-provider
        modelId: test-model
        preset: minimal
        cwd: !!js process.cwd()
        maxTokens: 1000
    maxActivationsPerDrive: 2
    maxCursorRetries: 3
- id: modules
  config:
    browserConfig:
      '@clocky/clocky-client-ui-team':
        attentionPreviewLimit: 1
        attentionPageLimit: 1
        attentionRefreshMs: 60000
`)
  const scaffold = await launchWebScaffold({ tempRoot: output, replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'),
    replayOverride: override, replayChildFixtures: [child, child], extraOverlayPath: overlay })
  const { context, setNativeZoom } = await createNativeZoomContext(output, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchConsole(page)
  let teamId: TeamStateSnapshot['team']['id'] | undefined
  let failure: unknown
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${JSON.stringify(response.result.error)}`)
    return response.result.value
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    const created = await rpc<TeamStateSnapshot>('team.create', { objective: '检查团队待处理', cwd: scaffold.workspaceCwd })
    teamId = created.team.id
    const state = async () => await rpc<TeamStateSnapshot>('team.get', { teamId })
    const human = created.participants.find(member => member.kind === 'human')!
    const tasks: TeamTaskSnapshot[] = []
    const members: ParticipantSnapshot[] = []
    for (let index = 0; index < 2; index++) {
      const member = await rpc<ParticipantSnapshot>('team.member.invite', { teamId, expectedCursor: (await state()).team.cursor,
        kind: 'local-agent', role: 'pending-worker', displayName: `审核执行成员 ${index}`, capabilities: [`pending-${index}`],
        provider: 'in-process', preset: 'minimal', model: 'test-provider/test-model' })
      await rpc('team.member.activate', { teamId, participantId: member.id, expectedCursor: (await state()).team.cursor })
      members.push(member)
    }
    await rpc('team.postInput', { teamId, text: '等待任务审核验证。' })
    await expect.poll(async () => (await state()).activations.some(binding => binding.activation.status === 'running')).toBe(true)
    for (const [index, member] of members.entries()) {
      const create = async (expectedCursor: number) => await scaffold.authenticatedRpc<TeamTaskSnapshot>('team.task.create', { teamId, expectedCursor,
        idempotencyKey: `pending-task-${index}`, subject: `待审核任务 ${index}`, description: 'Report completion with assigned identities.',
        blockedBy: [], requiredCapabilities: [`pending-${index}`], placement: { participantIds: [member.id] }, priority: 0,
        readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'participant', reviewerId: human.id }, maxAttempts: 1 })
      let response = await create((await state()).team.cursor)
      for (let attempt = 0; attempt < 3 && !response.result.ok && response.result.error.code === 'team-cursor-conflict'; attempt++) {
        response = await create((await state()).team.cursor)
      }
      if (!response.result.ok) throw new Error(`Task creation refused: ${JSON.stringify(response.result.error)}`)
      const task = response.result.value
      tasks.push(task)
      await expect.poll(async () => (await rpc<TeamTaskSnapshot>('team.task.get', { teamId, taskId: task.id })).phase,
        { timeout: 30_000 }).toBe('review')
    }
    expect((await state()).tasks.every(task => task.attemptHistory[0]?.outcome.kind === 'completed')).toBe(true)
    const pending = await rpc<TeamAttentionPage>('team.attention.read', { teamId, limit: 1 })
    expect(pending.counts.reviews).toBe(2)
    expect((await state()).team.phase).toBe('active')
    let failPreview = true
    await page.route('**/api/team.attention.read', async (route) => {
      if (failPreview) await route.abort('failed')
      else await route.continue()
    })
    await page.goto(`${scaffold.baseUrl}?team=${teamId}&view=overview`, { waitUntil: 'load' })
    const panel = page.locator('[data-team-workspace-page]')
    const preview = panel.locator('[data-team-attention="preview"]')
    await preview.getByRole('alert').waitFor()
    await preview.getByRole('button', { name: '查看全部待处理', exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'preview-failure.png') })
    failPreview = false
    await preview.getByRole('button', { name: '查看全部待处理', exact: true }).click()
    const list = panel.locator('[data-team-attention="list"]')
    await list.getByRole('button', { name: '待审核任务 0', exact: true }).waitFor()
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('attention')
    await list.getByRole('button', { name: '下一页待处理', exact: true }).click()
    await list.getByRole('button', { name: '待审核任务 1', exact: true }).waitFor()
    expect(await list.getByRole('button', { name: '下一页待处理', exact: true }).isDisabled()).toBe(true)
    await page.reload({ waitUntil: 'load' })
    await list.getByRole('button', { name: '待审核任务 0', exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'pending-list.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-sidebar-collapsed]').waitFor()
    await expect.poll(async () => (await page.locator('[data-clocky-navigation]').boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(56)
    await list.getByRole('button', { name: '下一页待处理', exact: true }).click()
    await list.getByRole('button', { name: '待审核任务 1', exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'pending-list-narrow.png') })
    await list.getByRole('button', { name: '待审核任务 1', exact: true }).click()
    await panel.getByRole('complementary', { name: '任务摘要' }).getByRole('heading', { name: '待审核任务 1', exact: true }).waitFor()
    expect(new URL(page.url()).searchParams.get('task')).toBe(tasks[1]?.id)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置', exact: true })
    await settings.getByRole('button', { name: '深色', exact: true }).click()
    await settings.getByRole('button', { name: '中文', exact: true }).click()
    await page.getByRole('menuitem', { name: 'English', exact: true }).click()
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    const nav = panel.getByRole('navigation', { name: 'Team modules' })
    await nav.locator('button[aria-expanded]').click()
    await page.getByRole('menuitem', { name: 'Needs your attention', exact: true }).click()
    await list.getByRole('button', { name: 'Refresh from first page', exact: true }).waitFor()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await list.getByRole('button', { name: 'Refresh from first page', exact: true }).focus()
    await page.keyboard.press('Enter')
    await list.getByRole('button', { name: '待审核任务 0', exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'pending-dark-english.png') })
    for (const locale of ['zh', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await teamAppearance(page, locale, theme)
      for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['short', { width: 1280, height: 480 }],
        ['narrow', { width: 390, height: 844 }], ['zoom200', { width: 1440, height: 1000 }]] as const) {
        await page.setViewportSize(viewport)
        const nativeZoom = await setNativeZoom(page, size === 'zoom200' ? 2 : 1)
        await teamEvidence(page, list, output, `${locale}-${theme}-pending-${size}`,
          { locale, theme, nativeZoom, data: 'two-reviews-one-item-page', assertion: 'Team-specific total, exact row and continuation remain accessible' })
        await list.getByRole('button', { name: locale === 'zh' ? '下一页待处理' : 'Next pending page', exact: true }).scrollIntoViewIfNeeded()
      }
      await setNativeZoom(page, 1)
    }

    expect(await page.title()).toBe('Clocky')
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(errors.pageErrors).toEqual([])
  } catch (error: unknown) {
    failure = error
    await writeFile(join(output, 'failure.txt'), String(error))
    if (teamId !== undefined) {
      const current = await rpc<TeamStateSnapshot>('team.get', { teamId })
      await writeFile(join(output, 'task-state.json'), JSON.stringify({ team: current.team, tasks: current.tasks }))
      for (const binding of current.activations) {
        const history = await rpc('session.history', { sessionId: binding.sessionId })
        await writeFile(join(output, `history-${binding.activation.participantId}.json`), JSON.stringify(history))
      }
    }
    await page.screenshot({ path: join(output, 'failure.png') })
    throw error
  } finally {
    try { await context.close(); if (teamId !== undefined) await rpc('team.cancel', { teamId }) }
    finally {
      try { await scaffold.close() }
      catch (error: unknown) { if (failure !== undefined) throw new AggregateError([failure, error], 'Pending scenario and cleanup failed'); throw error }
    }
  }
})
