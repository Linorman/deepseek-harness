import { showSimulationMaintenance } from './simulation-browser-controls.ts'
/** Real Web review binds original attempts; paused approval and cold recovery never replay inventory transfer. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { templateJSON } from '../../../examples/simulation-company/tests/sdk-product-template.ts'
import type {} from '../../../examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts'

it.each(['json', 'sqlite'])('reviews and reworks original Simulation task attempts through the real browser (%s)', async (backend) => {
  const root = join(process.cwd(), '.tmp-simulation-plan/web-task-review', backend)
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'run-'))
  const templates = JSON.parse(templateJSON) as Array<{
    id: string
    name: string
    spec: Record<string, unknown>
    driver: Record<string, unknown>
  }>
  const template = templates[0]!
  template.id = 'reviewed-company'; template.name = 'Reviewed procurement'
  template.spec.maxResidentActors = 2
  template.driver.tasks = { version: '1', cognition: 'model', review: 'buyer', maxAttempts: 2, retry: 'scene', leaseDurationMs: 60000 }
  const fixture = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/cordis.yml')
  const patches = JSON.parse(await readFile(fixture, 'utf8')) as Array<{ insert?: Array<{ name: string; config?: Record<string, unknown> }> }>
  for (const row of patches[0]!.insert!) {
    if (row.name === '@clocky/clocky-simulation-local') row.config = { ...row.config, root: join(directory, 'world'), backend }
    if (row.name.endsWith('/administration')) row.config = { ...row.config, templates }
    if (row.name === './model.ts') row.name = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts')
  }
  const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(patches))
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay, tempRoot: directory,
    productPrincipalId: 'simulation-browser-user', agentPresets: { default: 'simulation',
      roots: [{ path: join(process.cwd(), 'examples/simulation-company/presets'), trust: 'system' }] } })
  const probe = scaffold.ctx.simulationBrowserProbe
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  const writes: unknown[] = []
  let loseResponse = true
  await page.route('**/api/simulation.tasks.review.resolve', async (route) => {
    writes.push(route.request().postDataJSON())
    if (loseResponse) { loseResponse = false; await route.fetch(); await route.abort('failed') }
    else await route.continue()
  })
  let loseReviewQuery = true
  await page.route('**/api/simulation.requests.get', async (route) => {
    const original = writes[0] as { payload?: { commandId?: string } } | undefined
    const request = route.request().postDataJSON() as { payload: { commandId: string } }
    if (loseReviewQuery && original?.payload?.commandId === request.payload.commandId) {
      loseReviewQuery = false; await route.fetch(); await route.abort('failed')
    } else await route.continue()
  })
  const task = async () => {
    const reservation = probe.run?.snapshot().teamReservation
    if (reservation === undefined) return undefined
    return (await scaffold.ctx.teams.getTeam({ teamId: reservation.teamId })).tasks[0]
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('button', { name: '新建仿真', exact: true }).click()
    const creation = page.getByRole('dialog', { name: '新建仿真', exact: true })
    await creation.getByRole('radio').check()
    await creation.getByText('已安装配置', { exact: true }).click()
    await creation.getByText('场景 buyer 审核', { exact: true }).waitFor()
    await creation.getByLabel('运行名称', { exact: true }).fill('待审核采购')
    await creation.getByLabel('采购方名称', { exact: true }).fill('采购方')
    await creation.getByLabel('供应方名称', { exact: true }).fill('供应方')
    await creation.getByLabel('初始库存', { exact: true }).fill('2')
    await creation.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    await creation.getByRole('button', { name: '打开已登记运行', exact: true }).click()
    await expect.poll(() => probe.run?.snapshot().phase).toBe('paused')
    expect(probe.requests).toEqual([])
    probe.release()
    await expect.poll(async () => await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await expect.poll(async () => (await task())?.phase, { timeout: 20000 }).toBe('review')
    const firstAttempt = (await task())!.attemptHistory[0]!.id
    await workspace.getByRole('button', { name: '刷新审核目标', exact: true }).click()
    const reviews = workspace.getByRole('region', { name: '仿真任务审核', exact: true })
    await reviews.getByRole('button', { name: '审核仿真任务', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '审核仿真任务', exact: true })
    await dialog.getByRole('button', { name: '请求返工', exact: true }).click()
    await dialog.getByLabel('审核原因', { exact: true }).fill('请补充报告批次编号')
    await dialog.getByRole('button', { name: '请求返工', exact: true }).last().click()
    await dialog.getByText('响应丢失，请查询或重试原操作。', { exact: true }).waitFor()
    await dialog.getByLabel('审核原因', { exact: true }).fill('后来编辑的审核原因')
    await dialog.getByRole('button', { name: '关闭并保留输入', exact: true }).click()
    await workspace.getByRole('button', { name: '实体', exact: true }).click()
    await workspace.getByRole('button', { name: '概览', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await reviews.getByRole('button', { name: `打开审核草稿 · ${firstAttempt}`, exact: true }).click()
    dialog = page.getByRole('dialog', { name: '审核仿真任务', exact: true })
    expect(await dialog.getByLabel('审核原因', { exact: true }).inputValue()).toBe('后来编辑的审核原因')
    await page.screenshot({ path: join(root, 'review-draft-narrow.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: '查询原结果', exact: true }).click()
    await expect.poll(() => loseReviewQuery).toBe(false)
    expect(await dialog.getByRole('button', { name: '重试原操作', exact: true }).count()).toBe(0)
    await expect.poll(async () => {
      const query = dialog.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await dialog.getByText('原结果: 请求已完成', { exact: true }).count()
    }).toBe(1)
    expect(writes).toHaveLength(1)
    expect(await dialog.getByLabel('审核原因', { exact: true }).inputValue()).toBe('后来编辑的审核原因')
    await dialog.getByRole('button', { name: '关闭并保留输入', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect.poll(async () => ({ phase: (await task())?.phase, attempts: (await task())?.attemptCount }), { timeout: 20000 }).toEqual({ phase: 'review', attempts: 2 })
    expect(Object.values(probe.run!.snapshot().operations).filter(value => value.action.kind === 'resource/transfer')).toHaveLength(1)
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await expect.poll(() => probe.run!.snapshot().phase).toBe('paused')
    const beforeApproval = probe.requests.length
    await reviews.getByRole('button', { name: '刷新审核目标', exact: true }).click()
    await reviews.getByRole('button', { name: '审核仿真任务', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '审核仿真任务', exact: true })
    await dialog.getByLabel('审核原因', { exact: true }).fill('报告与库存变更已核对')
    await dialog.getByRole('button', { name: '通过任务结果', exact: true }).last().click()
    await expect.poll(async () => (await task())?.phase).toBe('completed')
    await expect.poll(async () => {
      const query = dialog.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await dialog.count()
    }).toBe(0)
    expect(probe.run!.snapshot().phase).toBe('paused')
    expect(probe.requests).toHaveLength(beforeApproval)
    await page.screenshot({ path: join(root, 'reviewed-paused.png'), animations: 'disabled' })
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '创建完整检查点', exact: true }).click()
    const checkpoint = page.getByRole('dialog', { name: '创建完整检查点', exact: true })
    await checkpoint.getByRole('button', { name: '创建完整检查点', exact: true }).click()
    await expect.poll(async () => {
      const query = checkpoint.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await checkpoint.getByText('原结果: 请求已完成', { exact: true }).count()
    }).toBe(1)
    await checkpoint.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    const entry = [...scaffold.ctx.loader.entries()].find(entry => entry.options.name === '@clocky/clocky-simulation-product/administration')
    if (entry === undefined) throw new Error('Administrative Loader entry unavailable')
    await entry.update({ disabled: true }); await entry.update({ disabled: false }); await scaffold.ctx.loader.await()
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '刷新控制状态', exact: true }).click()
    await showSimulationMaintenance(workspace)
    await expect.poll(async () => await workspace.getByRole('button', { name: '验证并恢复运行', exact: true }).isEnabled()).toBe(true)
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    const recovery = page.getByRole('dialog', { name: '验证并恢复运行', exact: true })
    await expect.poll(async () => await recovery.getByRole('button', { name: '验证并恢复运行', exact: true }).isEnabled()).toBe(true)
    await recovery.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    await expect.poll(async () => {
      const query = recovery.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await recovery.getByText('原结果: 请求已完成', { exact: true }).count()
    }).toBe(1)
    await recovery.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    expect(probe.run!.snapshot().phase).toBe('paused')
    expect(probe.requests).toHaveLength(beforeApproval)
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await workspace.getByText('此场景已完成。', { exact: true }).waitFor()
    const state = probe.run!.snapshot()
    expect(state.resources['received' as never]?.quantity).toBe('1')
    expect(state.resources['stock' as never]?.quantity).toBe('1')
    expect(Object.values(state.taskExecutions ?? {})).toHaveLength(2)
    expect(Object.values(state.operations).filter(value => value.action.kind === 'resource/transfer')).toHaveLength(1)
    expect(errors.pageErrors).toEqual([])
    expect(errors.warnings).toEqual([])
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), await page.locator('body').innerText())
    throw cause
  } finally { probe.release(); await browser.close(); await scaffold.close() }
})
