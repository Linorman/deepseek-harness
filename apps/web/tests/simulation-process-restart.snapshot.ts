/** Real Node process death retains durable creation, checkpoint and review identities across fresh browser authentication. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { Page, Locator } from 'playwright'
import { expect, it } from 'vitest'
import { templateJSON } from '../../../examples/simulation-company/tests/sdk-product-template.ts'
import { launchSimulationProcessHost } from './simulation-process-host.ts'
import type { SimulationProcessHost } from './simulation-process-host.ts'
import { probeFreePort, REPO_ROOT } from './support.ts'
import { showSimulationMaintenance, showSimulationRequests } from './simulation-browser-controls.ts'

async function authenticate(page: Page, host: SimulationProcessHost): Promise<void> {
  const response = await page.request.post(`${host.ready.baseUrl}/api/bootstrap`, { data: { credential: host.ready.credential } })
  expect(response.status()).toBe(204)
}
async function originalRow(workspace: Locator, commandId: string): Promise<Locator> {
  await showSimulationRequests(workspace)
  const requests = workspace.getByRole('region', { name: '持久原请求', exact: true })
  await requests.getByRole('button', { name: '刷新原请求', exact: true }).click()
  for (let page = 0; page < 12; page++) {
    await expect.poll(async () => await requests.getByRole('button', { name: '刷新原请求', exact: true }).isEnabled()).toBe(true)
    const row = requests.locator('[data-simulation-request]').filter({ hasText: commandId })
    if (await row.count() > 0) return row
    const next = requests.getByRole('button', { name: '下一页', exact: true })
    if (await next.count() === 0) break
    await next.click()
  }
  throw new Error('Browser did not discover the original persisted request')
}
async function retryOriginal(workspace: Locator, commandId: string): Promise<void> {
  let row = await originalRow(workspace, commandId)
  await row.getByRole('button', { name: /^(重试持久原请求|重试原操作)$/, exact: true }).click()
  await expect.poll(async () => {
    row = await originalRow(workspace, commandId)
    const query = row.getByRole('button', { name: /^(查询持久原请求|查询原结果)$/, exact: true })
    if (!await query.isEnabled()) return false
    if (await row.getByText('原结果: 请求已完成', { exact: true }).count() === 1) return true
    await query.click()
    return false
  }, { timeout: 20000 }).toBe(true)
  await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '概览', exact: true }).click()
}
async function closeDialog(page: Page): Promise<void> {
  const close = page.getByRole('dialog').getByRole('button', { name: '关闭并保留输入', exact: true })
  if (await close.count() > 0) await close.last().click()
}

it.each(['json', 'sqlite'])('recovers durable browser requests after independent Host SIGKILL (%s)', async (backend) => {
  const parentRoot = join(REPO_ROOT, '.tmp-simulation-plan/web-process-restart', backend)
  await mkdir(parentRoot, { recursive: true })
  const root = await mkdtemp(join(parentRoot, 'run-')), port = await probeFreePort()
  const templates = JSON.parse(templateJSON) as Array<{ driver: Record<string, unknown>; spec: Record<string, unknown> }>
  templates[0]!.spec.maxTokensPerInterval = 0
  templates[0]!.spec.maxTime = '9007199254741000'
  templates[0]!.driver.scenario = { kind: 'task-workflow', version: '1',
    topology: { actors: [{ id: 'auditor', name: '独立审核员' }], channels: [{ key: 'audit',
      members: [{ entityId: 'buyer', role: 'author' }, { entityId: 'auditor', role: 'reviewer' }] }] },
    steps: [
      { id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'auditor', channelKey: 'audit',
        reviewerEntityId: 'auditor', subject: 'Restart-safe forecast', description: 'Publish the authorized forecast',
        text: 'Recorded forecast', cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' },
    ] }
  const fixture = join(REPO_ROOT, 'examples/headless-agent/tests/fixtures/simulation/simulation-administration')
  const patches = JSON.parse(await readFile(join(fixture, 'cordis.yml'), 'utf8')) as Array<{
    insert?: Array<{ name: string; config?: Record<string, unknown> }>
    id?: string
    config?: Record<string, unknown> }>
  for (const row of patches[0]!.insert!) {
    if (row.name === '@clocky/clocky-simulation-local') row.config = { ...row.config, root: join(root, 'world'), backend }
    if (row.name.endsWith('/administration')) row.config = { ...row.config, templates }
    if (row.name === './model.ts') row.name = join(fixture, 'model.ts')
  }
  const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify(patches))
  const settings = { workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions'), overlay, port }
  let host: SimulationProcessHost | undefined
  const browser = await chromium.launch(), page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  const retryWrites: Array<{ runId: string; commandId: string }> = []
  const ingressWrites: Array<{ runId: string; ingressId: string; entityId: string; text: string; availableAt: string }> = []
  await page.route('**/api/simulation.ingress.create', async (route) => {
    ingressWrites.push((route.request().postDataJSON() as { payload: typeof ingressWrites[number] }).payload)
    if (ingressWrites.length === 2) { await route.fetch(); await route.abort('failed') }
    else await route.continue()
  })
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/simulation.requests.retry') {
      retryWrites.push((request.postDataJSON() as { payload: { runId: string; commandId: string } }).payload)
    }
  })
  let selectedRun = ''
  const restart = async () => {
    const previous = host!
    await previous.kill()
    host = await launchSimulationProcessHost(settings)
    expect(host.ready.pid).not.toBe(previous.ready.pid)
    expect(host.ready.pid).not.toBe(process.pid)
    expect(host.ready.baseUrl).toBe(previous.ready.baseUrl)
    const oldCookie = await page.request.post(`${host.ready.baseUrl}/api/simulation.requests.list`, {
      data: { rpcId: 'retired-cookie', payload: { runId: selectedRun, limit: 2 } },
    })
    expect(oldCookie.status()).toBe(401)
    await authenticate(page, host)
    await page.goto(`${host.ready.baseUrl}/?workspace=simulation&simulation=${encodeURIComponent(selectedRun)}`, { waitUntil: 'load' })
    expect((await host.observe()).requests).toBe(0)
  }
  try {
    host = await launchSimulationProcessHost(settings)
    expect(host.ready.pid).not.toBe(process.pid)
    await authenticate(page, host)
    await page.goto(`${host.ready.baseUrl}/?workspace=simulation`, { waitUntil: 'load' })
    const workspace = page.locator('[data-simulation-workspace-page]')
    await host.arm('accepted-create')
    await workspace.locator('header').getByRole('button', { name: '新建仿真', exact: true }).click()
    const create = page.getByRole('dialog', { name: '新建仿真', exact: true })
    await create.getByRole('radio').check()
    await create.getByLabel('运行名称', { exact: true }).fill('进程重启报告')
    await create.getByLabel('采购方名称', { exact: true }).fill('发布方')
    await create.getByLabel('供应方名称', { exact: true }).fill('审核方')
    await create.getByLabel('初始库存', { exact: true }).fill('2')
    await create.getByRole('button', { name: '检查配置', exact: true }).click()
    await create.getByText('配置检查通过。创建时仍会重新检查当前权限与容量。', { exact: true }).waitFor()
    await create.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    const creation = await host.held(); selectedRun = creation.runId
    expect((await host.observe()).reports).toBe(0)
    await restart()
    const cold = await originalRow(workspace, creation.commandId)
    await cold.getByRole('button', { name: /^(查询持久原请求|查询原结果)$/, exact: true }).click()
    expect((await host.observe()).tasks).toBe(0)
    await retryOriginal(workspace, creation.commandId)
    await expect.poll(async () => (await host!.observe()).phase).toBe('paused')
    expect(await host.observe()).toMatchObject({ requests: 0, entityCount: 3, channelCount: 2 })
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '刷新控制状态', exact: true }).click()
    await expect.poll(async () => workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    // Model delayed browser interaction without depending on the installed animation style.
    await page.waitForTimeout(300)
    const reviews = workspace.getByRole('region', { name: '仿真任务审核', exact: true })
    await expect.poll(async () => {
      await reviews.getByRole('button', { name: '刷新审核目标', exact: true }).click()
      return await reviews.getByText('此尝试可以审核。', { exact: true }).count()
    }, { timeout: 20000 }).toBe(1)
    await page.waitForTimeout(300)
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await expect.poll(async () => (await host!.observe()).phase).toBe('paused')
    // Cross three ordinary scheduler pulses while the native run is paused.
    await page.waitForTimeout(3500)
    const report = await host.observe()
    expect({ phase: report.teamPhase, stallCode: report.teamStallCode }).toEqual({ phase: 'active', stallCode: undefined })
    expect(report).toMatchObject({ tasks: 1, reports: 1, transfers: 0, stock: '2', received: '0', requests: 0, entityCount: 3, channelCount: 2 })
    await host.arm('completed-checkpoint')
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '创建完整检查点', exact: true }).click()
    await page.getByRole('dialog', { name: '创建完整检查点', exact: true }).getByRole('button', { name: '创建完整检查点', exact: true }).click()
    const checkpoint = await host.held()
    expect(checkpoint.checkpointId).toBeDefined()
    expect((await host.observe()).completedCheckpoints).toBe(2)
    await restart()
    await retryOriginal(workspace, checkpoint.commandId)
    expect(await host.observe()).toMatchObject({ phase: 'paused', teamPhase: 'active', tasks: 1, reports: 1, transfers: 0, requests: 0, completedCheckpoints: 2, entityCount: 3, channelCount: 2 })
    await host.arm('completed-review')
    await expect.poll(async () => {
      await reviews.getByRole('button', { name: '刷新审核目标', exact: true }).click()
      return await reviews.getByText('此尝试可以审核。', { exact: true }).count()
    }, { timeout: 20000 }).toBe(1)
    await reviews.getByRole('button', { name: '审核仿真任务', exact: true }).click()
    const review = page.getByRole('dialog', { name: '审核仿真任务', exact: true })
    await review.getByLabel('审核原因', { exact: true }).fill('报告已核对')
    await review.getByRole('button', { name: '通过任务结果', exact: true }).last().click()
    const approval = await host.held()
    await restart()
    await originalRow(workspace, approval.commandId)
    await showSimulationMaintenance(workspace)
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '刷新控制状态', exact: true }).click()
    await expect.poll(async () => workspace.getByRole('button', { name: '验证并恢复运行', exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    const recovery = page.getByRole('dialog', { name: '验证并恢复运行', exact: true })
    await expect.poll(async () => recovery.getByRole('button', { name: '验证并恢复运行', exact: true }).isEnabled()).toBe(true)
    await recovery.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    await expect.poll(async () => {
      const query = recovery.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() > 0 && await query.isEnabled()) await query.click()
      return await recovery.getByText('原结果: 请求已完成', { exact: true }).count()
    }, { timeout: 20000 }).toBe(1)
    await closeDialog(page)
    await retryOriginal(workspace, approval.commandId)
    const restored = await host.observe()
    expect(restored).toMatchObject({ phase: 'paused', tasks: 1, reports: 1, transfers: 0, requests: 0, completedCheckpoints: 2,
      stock: '2', received: '0', entityCount: 3, channelCount: 2 })
    expect(retryWrites).toEqual([creation, checkpoint, approval].map(value => ({ runId: selectedRun, commandId: value.commandId })))
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '刷新控制状态', exact: true }).click()
    await expect.poll(async () => workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await workspace.getByText('此场景已完成。', { exact: true }).waitFor()
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await expect.poll(async () => (await host!.observe()).phase).toBe('paused')
    const completed = await host.observe(), availableAt = '9007199254740993'
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '输入事件', exact: true }).click()
    const input = page.getByRole('dialog', { name: '输入事件', exact: true })
    await input.getByRole('radio', { name: /auditor/ }).check()
    await input.getByLabel('授权输入正文', { exact: true }).fill('完成后延迟审计通知：保留报告与原任务。')
    await input.getByLabel('最早可用模拟 tick', { exact: true }).fill(availableAt)
    await input.getByRole('button', { name: '输入事件', exact: true }).click()
    await input.getByText('原结果: 输入待消费', { exact: true }).waitFor()
    expect(ingressWrites).toHaveLength(1)
    expect(ingressWrites[0]).toMatchObject({ runId: selectedRun, entityId: 'auditor', availableAt })
    const pending = await host.observe()
    expect(pending).toMatchObject({ phase: 'paused', time: completed.time, decisionCount: completed.decisionCount,
      ingressCount: 1, reports: 1, tasks: 1, requests: 0 })
    await closeDialog(page)
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '刷新控制状态', exact: true }).click()
    await expect.poll(async () => workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await expect.poll(async () => (await host!.observe()).time, { timeout: 20000 }).toBe(availableAt)
    await workspace.getByText('此场景已完成。', { exact: true }).waitFor()
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await expect.poll(async () => {
      const current = await host!.observe()
      return { phase: current.phase, inFlight: current.inFlight }
    }).toEqual({ phase: 'paused', inFlight: false })
    const consumed = await host.observe()
    expect(consumed).toMatchObject({ time: availableAt, decisionCount: completed.decisionCount + 1,
      ingressCount: 1, reports: 1, tasks: 1, transfers: 0, stock: '2', received: '0', requests: 0,
      entityCount: 3, channelCount: 2, inFlight: false })
    await workspace.getByRole('button', { name: '刷新', exact: true }).click()
    await workspace.getByTitle(`${availableAt} minute`, { exact: true }).waitFor()
    await workspace.getByRole('button', { name: '继续保留输入', exact: true }).click()
    await input.getByRole('button', { name: '重试原操作', exact: true }).click()
    await input.getByText('响应丢失，请查询或重试原操作。', { exact: true }).waitFor()
    expect(ingressWrites).toHaveLength(2)
    expect(ingressWrites[1]).toEqual(ingressWrites[0])
    await input.getByRole('button', { name: '查询原结果', exact: true }).click()
    await input.getByText('原结果: 输入已消费', { exact: true }).waitFor()
    await input.getByText(/消费决策:/).waitFor()
    expect(await host.observe()).toEqual(consumed)
    await closeDialog(page)
    await reviews.getByRole('button', { name: '刷新审核目标', exact: true }).click()
    await expect.poll(async () => reviews.getByRole('button', { name: '刷新审核目标', exact: true }).isEnabled()).toBe(true)
    await page.screenshot({ path: join(parentRoot, 'recovered-paused.png'), animations: 'disabled' })
  } catch (cause: unknown) {
    await page.screenshot({ path: join(parentRoot, 'failure.png') }).catch(() => {})
    throw cause
  } finally { await host?.kill(); await browser.close(); await rm(root, { recursive: true, force: true }) }
}, 120000)
