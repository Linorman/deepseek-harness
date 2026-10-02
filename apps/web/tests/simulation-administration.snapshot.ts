import { simulationRuntimeMetrics } from '@clocky/clocky-simulation'
/** Real browser creation, original retries and explicit scheduling drive production actors without navigation inference. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { templateJSON } from '../../../examples/simulation-company/tests/sdk-product-template.ts'
import type {} from '../../../examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts'

it.each([['json', false], ['sqlite', false], ['json', true], ['sqlite', true]] as const)
('creates and controls original simulations through the real Web carrier (%s, tasks=%s)', async (backend, tasks) => {
  const root = join(process.cwd(), '.tmp-simulation-plan/web-administration', backend, tasks ? 'tasks' : 'cognition')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'run-'))
  const fixture = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/cordis.yml')
  const patches = JSON.parse(await readFile(fixture, 'utf8')) as Array<{ insert?: Array<{ name: string; config?: Record<string, unknown> }> }>
  for (const row of patches[0]!.insert!) {
    if (row.name === '@clocky/clocky-simulation-local') row.config = { ...row.config, root: join(directory, 'world'), backend }
    if (row.name.endsWith('/administration')) {
      const templates = JSON.parse(templateJSON) as Array<{ driver: Record<string, unknown> }>
      if (tasks) templates[0]!.driver.tasks = { version: '1', cognition: 'model', leaseDurationMs: 60000, maxAttempts: 2, retry: 'scene' }
      row.config = { ...row.config, templates }
    }
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
  const creates: Array<{ commandId: string; name: string }> = []
  const queries: Array<{ commandId: string }> = []
  const checks: Array<Record<string, unknown>> = []
  await page.route('**/api/simulation.runs.preflight', async (route) => {
    checks.push((route.request().postDataJSON() as { payload: Record<string, unknown> }).payload)
    await route.continue()
  })
  const createEntered = Promise.withResolvers<undefined>(), createRelease = Promise.withResolvers<undefined>()
  let lostCreate = true
  await page.route('**/api/simulation.runs.create', async (route) => {
    creates.push((route.request().postDataJSON() as { payload: { commandId: string; name: string } }).payload)
    if (lostCreate) {
      lostCreate = false; await route.fetch(); createEntered.resolve(undefined)
      await createRelease.promise; await route.abort('failed'); return
    }
    await route.continue()
  })
  await page.route('**/api/simulation.requests.get', async (route) => {
    queries.push((route.request().postDataJSON() as { payload: { commandId: string } }).payload)
    await route.fetch(); await route.abort('failed')
  })
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('button', { name: '新建仿真', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建仿真', exact: true })
    await dialog.getByRole('radio').check()
    await dialog.getByText('已安装配置', { exact: true }).click()
    await dialog.getByText(tasks ? '自动执行 Team 任务，仅使用受限仿真操作' : '仅认知执行；不支持自动执行 Team 任务', { exact: true }).waitFor()
    if (tasks) {
      await page.screenshot({ path: join(root, '00-task-template-desktop.png'), animations: 'disabled' })
      await page.setViewportSize({ width: 390, height: 844 })
      await dialog.getByText('自动执行 Team 任务，仅使用受限仿真操作', { exact: true }).waitFor()
      await page.screenshot({ path: join(root, '00-task-template-narrow.png'), animations: 'disabled' })
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await dialog.getByText('调整运行额度', { exact: true }).click()
    await dialog.getByLabel('运行名称', { exact: true }).fill('浏览器采购仿真')
    await dialog.getByLabel('采购方名称', { exact: true }).fill('采购团队')
    await dialog.getByLabel('供应方名称', { exact: true }).fill('供应团队')
    await dialog.getByLabel('初始库存', { exact: true }).fill('2')
    await dialog.getByLabel('实体数上限', { exact: true }).fill('1')
    await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
    await expect.poll(async () => await dialog.getByLabel('实体数上限', { exact: true }).getAttribute('aria-invalid')).toBe('true')
    expect(creates).toEqual([]); expect(probe.requests).toEqual([])
    await dialog.getByLabel('实体数上限', { exact: true }).fill('8')
    await dialog.getByLabel('驻留 actor 上限', { exact: true }).fill('2')
    await dialog.getByLabel('每次模型请求的 token 额度', { exact: true }).fill('10000')
    await dialog.getByLabel('每个预算区间的 token 上限', { exact: true }).fill('500000')
    await dialog.getByLabel('最大模拟 tick', { exact: true }).fill('9007199254740993')
    await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
    await expect.poll(async () => await dialog.getByLabel('最大模拟 tick', { exact: true }).getAttribute('aria-invalid')).toBe('true')
    expect(creates).toEqual([]); expect(probe.requests).toEqual([])
    await dialog.getByLabel('最大模拟 tick', { exact: true }).fill('1000')
    await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
    await dialog.getByText('配置检查通过。创建时仍会重新检查当前权限与容量。', { exact: true }).waitFor()
    await page.screenshot({ path: join(root, '00-preflight-desktop.png'), animations: 'disabled' })
    expect(checks.at(-1)).toMatchObject({ limits: { maxTime: '1000', maxEntities: 8, maxResidentActors: 2,
      tokensPerModelRequest: 10000, maxTokensPerInterval: 500000 } })
    expect(checks.every(check => !Object.hasOwn(check, 'commandId'))).toBe(true)
    expect(creates).toEqual([]); expect(probe.requests).toEqual([])
    await dialog.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    const domains = page.getByRole('navigation', { name: '工作区', exact: true })
    await domains.getByRole('button', { name: '团队工作', exact: true }).click()
    await workspace.waitFor({ state: 'hidden' })
    await domains.getByRole('button', { name: '仿真', exact: true }).click()
    await workspace.getByRole('button', { name: '新建仿真', exact: true }).click()
    expect(await dialog.getByLabel('运行名称', { exact: true }).inputValue()).toBe('浏览器采购仿真')
    expect(await dialog.getByLabel('每个预算区间的 token 上限', { exact: true }).inputValue()).toBe('500000')
    const nameInput = dialog.getByLabel('运行名称', { exact: true })
    await nameInput.dispatchEvent('compositionstart')
    await nameInput.press('Enter')
    expect(creates).toHaveLength(0)
    await nameInput.dispatchEvent('compositionend')
    const createButton = dialog.getByRole('button', { name: '创建暂停的运行', exact: true })
    const beforeBusy = await createButton.boundingBox()
    await createButton.click()
    await createEntered.promise
    expect(await createButton.isDisabled()).toBe(true)
    const duringBusy = await createButton.boundingBox()
    expect(duringBusy?.width).toBe(beforeBusy?.width)
    expect(duringBusy?.height).toBe(beforeBusy?.height)
    expect(duringBusy?.y).toBe(beforeBusy?.y)
    await writeFile(join(root, 'busy-geometry.json'), JSON.stringify({ beforeBusy, duringBusy, creationCalls: creates.length }, null, 2) + '\n')
    createRelease.resolve(undefined)
    await dialog.getByText('响应丢失，请查询或重试原操作。', { exact: true }).waitFor()
    await page.screenshot({ path: join(root, '01-lost-creation-desktop.png'), animations: 'disabled' })
    expect(creates).toHaveLength(1)
    await dialog.getByRole('button', { name: '查询原结果', exact: true }).click()
    await expect.poll(() => queries.length).toBe(1)
    await expect.poll(async () => await dialog.getByRole('button', { name: '重试原操作', exact: true }).isEnabled()).toBe(true)
    expect(queries[0]?.commandId).toBe(creates[0]?.commandId)
    await dialog.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    await workspace.getByRole('button', { name: '新建仿真', exact: true }).click()
    await dialog.getByRole('button', { name: '重试原操作', exact: true }).click()
    await dialog.getByRole('button', { name: '打开已登记运行', exact: true }).waitFor()
    expect(creates).toHaveLength(2); expect(creates[1]).toEqual(creates[0])
    expect(probe.requests).toEqual([])
    expect(probe.run?.snapshot()).toMatchObject({ phase: 'paused', time: '0' })
    expect(probe.run?.snapshot().spec).toMatchObject({ maxEntities: 8, maxResidentActors: 2,
      tokensPerModelRequest: 10000, maxTokensPerInterval: 500000, maxTime: '1000' })
    await dialog.getByRole('button', { name: '打开已登记运行', exact: true }).click()
    await expect.poll(async () => await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isEnabled()).toBe(true)
    expect(await workspace.getByRole('region', { name: '仿真任务控制', exact: true }).count()).toBe(tasks ? 1 : 0)
    const before = probe.run!.snapshot()
    await page.reload({ waitUntil: 'load' })
    await workspace.getByRole('heading', { name: '浏览器采购仿真', exact: true }).waitFor()
    expect(probe.run?.snapshot()).toEqual(before)
    expect(probe.requests).toEqual([])
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    const start = page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true })
    await start.getByText('company/scripted', { exact: true }).waitFor()
    await start.getByText('主机共享模型并发上限', { exact: true }).waitFor()
    await page.screenshot({ path: join(root, '02-start-budget-desktop.png'), animations: 'disabled' })
    await start.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await expect.poll(() => probe.entered).toBe(true)
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await workspace.getByText('仍有工作收尾', { exact: true }).waitFor()
    await expect.poll(() => probe.run?.snapshot().phase).toBe('paused')
    const pausedMetrics = simulationRuntimeMetrics(probe.run!.snapshot(), 'this-provider')
    await workspace.getByRole('button', { name: '刷新', exact: true }).click()
    const nativeMetrics = workspace.getByRole('region', { name: '运行预算与待处理工作', exact: true })
    await expect.poll(async () => await nativeMetrics.getByText('Token 预算占用／上限', { exact: true }).evaluate(node =>
      node.nextElementSibling?.textContent)).toBe(`${pausedMetrics.budgets.tokens.charged} / ${pausedMetrics.budgets.tokens.limit}`)
    await nativeMetrics.getByText('主机资源', { exact: true }).click()
    const pool = scaffold.ctx.simulationTeams.modelUsage()
    expect(pool.active).toBe(1)
    await expect.poll(async () => await nativeMetrics.getByText('正在处理的模型请求／上限', { exact: true }).evaluate(node =>
      node.nextElementSibling?.textContent)).toBe(`${pool.active} / ${pool.limit}`)
    const headerStatus = workspace.getByRole('region', { name: '当前仿真状态', exact: true })
    await headerStatus.getByText('已暂停', { exact: true }).waitFor()
    await headerStatus.getByText('仍有工作收尾', { exact: true }).waitFor()
    for (const module of ['实体', '决策', '操作', '检查点', '记录', '概览']) {
      await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: module, exact: true }).click()
      await headerStatus.getByText('仍有工作收尾', { exact: true }).waitFor()
      expect(await workspace.getByRole('button', { name: '暂停调度', exact: true }).count()).toBe(1)
    }
    expect(scaffold.ctx.simulationTeams.modelUsage().active).toBe(1)
    probe.release()
    await expect.poll(async () => await workspace.getByText('仍有工作收尾', { exact: true }).count()).toBe(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-sidebar-collapsed="true"]').waitFor({ state: 'attached' })
    await page.screenshot({ path: join(root, '03-paused-narrow.png'), animations: 'disabled' })
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await start.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await workspace.getByText('此场景已完成。', { exact: true }).waitFor()
    expect(probe.run?.snapshot().resources['stock' as never]?.quantity).toBe('1')
    expect(probe.run?.snapshot().resources['received' as never]?.quantity).toBe('1')
    if (tasks) {
      const executions = Object.values(probe.run!.snapshot().taskExecutions ?? {})
      expect(executions).toHaveLength(1)
      expect(executions[0]?.task?.phase).toBe('completed')
      expect(executions[0]?.decisions?.[0]?.input).toBeDefined()
    }
    expect(probe.requests.length).toBeGreaterThan(0)
    expect(probe.requests.every(value => value.tools.join(',') === 'simulation_observe,simulation_stage,simulation_submit')).toBe(true)
    expect([...new Set(probe.systemPrompts)]).toMatchSnapshot()
    await workspace.getByRole('button', { name: '返回运行列表', exact: true }).click()
    await expect.poll(async () => await workspace.locator('li').count()).toBe(1)
    const calls = probe.requests.length
    await workspace.getByRole('button', { name: '新建仿真', exact: true }).click()
    await dialog.getByLabel('运行名称', { exact: true }).fill('撤权前的私有草稿')
    expect(errors.warnings).toEqual([])
    await scaffold.replaceBrowserAuthentication()
    await expect.poll(async () => await dialog.count()).toBe(0)
    expect(await page.locator('body').innerText()).not.toContain('撤权前的私有草稿')
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    await workspace.getByRole('button', { name: '新建仿真', exact: true }).click()
    expect(await dialog.getByLabel('运行名称', { exact: true }).inputValue()).toBe('')
    await dialog.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    expect(probe.requests).toHaveLength(calls)
    expect(errors.pageErrors).toEqual([])
    expect(errors.warnings.every(value => /^\[web-runtime\] connection lost, retry #\d+$/.test(value))).toBe(true)
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), JSON.stringify({ body: await page.locator('body').innerText(), errors, creates, world: probe.run?.snapshot() }, null, 2))
    throw cause
  } finally { createRelease.resolve(undefined); probe.release(); await page.close(); await browser.close(); await scaffold.close() }
}, 120000)
