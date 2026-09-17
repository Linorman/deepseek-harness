import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

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
  const scaffold = await launchWebScaffold({
    replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'),
    replayOverride: override,
  })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  let created: TeamStateSnapshot | undefined
  let childTeamId: TeamStateSnapshot['team']['id'] | undefined
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (response.result.ok) return response.result.value
    throw new Error(`${method}: ${response.result.error.message}`)
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    created = await rpc<TeamStateSnapshot>('team.create', { objective: '验证 child Team 浏览器导航', cwd: scaffold.workspaceCwd })
    const settled = scaffold.whenTurnSettled(60_000)
    await rpc('team.postInput', { teamId: created.team.id, text: '请委派一个 child Team 并返回进度。', delivery: 'turn' })
    await settled
    const coordinator = created.participants.find(member => member.role === 'coordinator')
    const binding = created.activations.find(binding => binding.activation.participantId === coordinator?.id)
    if (binding !== undefined) {
      const session = await scaffold.ctx.sessionPersistence.inspect(binding.sessionId)
      await writeFile(join(output, 'tool-results.json'), JSON.stringify(session.events.filter(event => event.type === 'tool/result'), null, 2))
    }
    let childTask: TeamTaskSnapshot | undefined
    await expect.poll(async () => {
      const tasks = await rpc<{ items: readonly TeamTaskSnapshot[] }>('team.task.list', { teamId: created!.team.id, afterCursor: -1, limit: 32 })
      childTask = tasks.items.find(task => task.execution.kind === 'child-team' && task.delegation?.childTeamId !== undefined)
      return childTask !== undefined
    }, { timeout: 30_000 }).toBe(true)
    if (childTask?.delegation?.childTeamId === undefined) throw new Error('child task did not publish its child Team identity')
    childTeamId = childTask.delegation.childTeamId

    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '验证 child Team 浏览器导航 进行中' }).click()
    const panel = page.locator('[data-team-workspace-page]')
    await panel.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '任务', exact: true }).click()
    await panel.getByRole('button', { name: '刷新任务', exact: true }).click()
    await panel.getByRole('button', { name: 'Child navigation probe', exact: true }).click()
    await panel.getByRole('button', { name: '打开子任务', exact: true }).waitFor()
    await panel.getByRole('button', { name: '打开子任务', exact: true }).click()
    await expect.poll(async () => (await rpc<TeamStateSnapshot>('team.get', { teamId: childTeamId })).team.parentTeamId).toBe(created.team.id)
    await rpc('team.cancel', { teamId: created.team.id })
    await expect.poll(async () => (await rpc<TeamStateSnapshot>('team.get', { teamId: created!.team.id })).team.phase).toBe('cancelled')
    await expect.poll(async () => (await rpc<TeamStateSnapshot>('team.get', { teamId: childTeamId })).team.phase).toBe('cancelled')
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(output, 'child-navigation-cancelled.png') })
  } finally {
    try {
      if (created !== undefined) await rpc('team.cancel', { teamId: created.team.id })
    } catch { /* the scenario already records the first lifecycle failure */ }
    await browser.close()
    await scaffold.close()
  }
}, 120_000)
