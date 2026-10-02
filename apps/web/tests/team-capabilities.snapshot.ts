/** Default Web grants, provider modes and read failures drive the real task form. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { Route } from 'playwright'
import { expect, it } from 'vitest'
import type { TeamStateSnapshot } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it('creates a shared task through the default profile and retains its draft across a failed capability observation', async () => {
  const output = join(process.cwd(), '.tmp/team-capabilities-browser')
  await mkdir(output, { recursive: true })
  const replay = join(output, 'replay.json')
  await writeFile(replay, JSON.stringify([{ kind: 'hang' }]))
  const scaffold = await launchWebScaffold({
    replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'), replayOverride: replay,
  })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  let teamId: TeamStateSnapshot['team']['id'] | undefined
  let primaryFailure: unknown
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${response.result.error.message}`)
    return response.result.value
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    const created = await rpc<TeamStateSnapshot>('team.create', { objective: '验证执行选项', cwd: scaffold.workspaceCwd })
    teamId = created.team.id
    await rpc('team.postInput', { teamId, text: '准备检查配置。' })
    await expect.poll(async () => (await rpc<TeamStateSnapshot>('team.get', { teamId })).activations
      .some(binding => binding.activation.status === 'running')).toBe(true)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: /^验证执行选项 / }).click()
    const panel = page.locator('[data-team-workspace-page]')
    await panel.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '任务', exact: true }).click()
    await panel.getByRole('button', { name: '新建任务', exact: true }).click()
    const form = page.getByRole('dialog', { name: '新建任务', exact: true })
    await form.getByRole('radio', { name: '共享目录', exact: true }).waitFor()
    await form.getByLabel('任务名称', { exact: true }).fill('保留的任务草稿')
    await form.getByLabel('任务说明', { exact: true }).fill('验证默认授权与执行选项。')
    await form.getByText('高级执行选项', { exact: true }).click()
    expect(await form.getByRole('radio', { name: /独立 Git worktree/ }).isDisabled()).toBe(true)
    expect(await form.getByLabel('可读取路径（每行一个）', { exact: true }).isDisabled()).toBe(true)
    expect(await form.getByLabel('可写入路径（每行一个）', { exact: true }).isDisabled()).toBe(true)
    await form.getByLabel('能力（用逗号分隔）', { exact: true }).fill('unmatched-capability-observation')
    await page.screenshot({ path: join(output, 'authorized-options.png') })
    const pattern = '**/api/team.capabilities'
    const fail = async (route: Route) => {
      const response = await route.fetch()
      const body = await response.json() as Record<string, unknown>
      await route.fulfill({ response, json: { ...body,
        result: { ok: false, error: { code: 'internal', message: '执行选项读取暂不可用', details: {} } } } })
    }
    await page.route(pattern, fail)
    await form.getByRole('button', { name: '重新检查执行选项', exact: true }).click()
    await form.getByText('执行选项读取暂不可用', { exact: true }).waitFor()
    expect(await form.getByRole('button', { name: '新建任务', exact: true }).isDisabled()).toBe(true)
    expect(await form.getByLabel('任务名称', { exact: true }).inputValue()).toBe('保留的任务草稿')
    await page.screenshot({ path: join(output, 'read-failure.png') })
    await page.unroute(pattern, fail)
    await form.getByRole('button', { name: '重新检查执行选项', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(output, 'narrow-options.png') })
    await form.getByRole('button', { name: '新建任务', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    const state = await rpc<TeamStateSnapshot>('team.get', { teamId })
    expect(state.tasks.find(task => task.subject === '保留的任务草稿'))
      .toMatchObject({ workspaceMode: 'shared', readScopes: [], writeScopes: [], requiredCapabilities: ['unmatched-capability-observation'] })
    expect(await page.title()).toBe('Clocky')
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(output, 'created-task.png') })
  } catch (error: unknown) {
    primaryFailure = error
    await page.screenshot({ path: join(output, 'failure.png') })
    await writeFile(join(output, 'failure.txt'), String(error))
    throw error
  } finally {
    try {
      await browser.close()
      if (teamId !== undefined) await rpc('team.cancel', { teamId })
    } finally {
      try { await scaffold.close() } catch (cleanupError) {
        if (primaryFailure !== undefined) throw new AggregateError([primaryFailure, cleanupError], 'Capability scenario and cleanup failed')
        throw cleanupError
      }
    }
  }
})
