/** Browser plugin not available: Playwright exercises the shipped Web composition with keyless external responses. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import type { SimulationProductCatalog, SimulationProductRequestReceipt, SimulationProductRequestResult,
  SimulationProductControl, SimulationProductWorldPreflightResult, SimulationProductCollectionPage,
  SimulationProductWorldCasesPage } from '@clocky/clocky-simulation-product/types'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { launchSimulationProcessHost, type SimulationProcessHost } from './simulation-process-host.ts'
import { probeFreePort, REPO_ROOT } from './support.ts'
import { showSimulationMaintenance } from './simulation-browser-controls.ts'
import { defaultWorldModel } from './default-world-model.ts'

it('shows the shipped worlds without models and makes the retained draft ready after saving a default', async () => {
  const root = join(REPO_ROOT, '.local/world-default-20261020/browser')
  await mkdir(root, { recursive: true })
  const scaffold = await launchWebScaffold({ tempRoot: root, noModels: true })
  const browser = await chromium.launch(), page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  const errors = watchConsole(page), open = vi.spyOn(scaffold.ctx.simulations, 'open')
  const requests: { stage: string; tools: string[]; goal: string }[] = []
  try {
    const catalog = await scaffold.authenticatedRpc<SimulationProductCatalog>('simulation.catalog', {})
    expect(catalog.result.ok).toBe(true)
    if (!catalog.result.ok) throw new Error('Default catalog unavailable')
    expect(catalog.result.value.worldTemplates).toHaveLength(3)
    const definition = catalog.result.value.worldTemplates![0]!.definition
    const missing = await scaffold.authenticatedRpc<SimulationProductWorldPreflightResult>('simulation.world.preflight', { definition })
    expect(missing.result).toMatchObject({ ok: true, value: { status: 'invalid', diagnostics: [{ code: 'model-unavailable' }] } })
    await scaffold.authenticateBrowserPage(page)
    await page.goto(`${scaffold.baseUrl}/?workspace=simulation`)
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.locator('header').getByRole('button', { name: '新建世界', exact: true }).click()
    const chooser = page.getByRole('dialog', { name: '新建世界', exact: true })
    await chooser.getByRole('button', { name: /软件工作室/ }).click()
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    await workspace.getByText(/Choose a provider and save a default model/).waitFor()
    expect(await workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isDisabled()).toBe(true)
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['default-world-keyless'], defaultWorldModel(requests)))
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'default-world-keyless', model: 'world' })
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    await expect.poll(() => workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isEnabled()).toBe(true)
    for (const template of catalog.result.value.worldTemplates!) {
      const preview = await scaffold.authenticatedRpc<SimulationProductWorldPreflightResult>('simulation.world.preflight', { definition: template.definition })
      expect(preview.result, JSON.stringify(preview.result)).toMatchObject({ ok: true, value: { status: 'ready' } })
    }
    expect(open).not.toHaveBeenCalled()
    expect(requests).toEqual([])
    expect(await page.title()).not.toBe('')
    expect(new URL(page.url()).origin).toBe(scaffold.baseUrl)
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    await page.screenshot({ path: join(root, 'configured-world-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    expect(await workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isVisible()).toBe(true)
    await page.screenshot({ path: join(root, 'configured-world-mobile.png') })
    expect(errors.pageErrors).toEqual([])
  } finally { open.mockRestore(); await browser.close(); await scaffold.close() }
}, 90000)

async function authenticate(page: Page, host: SimulationProcessHost): Promise<void> {
  expect((await page.request.post(`${host.ready.baseUrl}/api/bootstrap`, { data: { credential: host.ready.credential } })).status()).toBe(204)
}
async function rpc<T>(page: Page, host: SimulationProcessHost, method: string, payload: unknown): Promise<T> {
  const response = await page.request.post(`${host.ready.baseUrl}/api/${method}`, {
    data: { type: 'client-request', rpcId: `default-world-${method}`, method, payload },
  })
  const body = await response.json() as { result: { ok: true; value: T } | { ok: false; error: unknown } }
  if (!body.result.ok) throw new Error(`${method}: ${JSON.stringify(body.result.error)}`)
  return body.result.value
}

it('creates from the default browser, hires through real tools and restores the original world in a fresh Host', async () => {
  const parent = join(REPO_ROOT, '.local/world-default-20261020/browser')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'restart-'))
  const settings = { published: true, world: true, workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions'),
    port: await probeFreePort(), model: 'world' }
  const browser = await chromium.launch(), page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  const errors = watchConsole(page)
  let host: SimulationProcessHost | undefined
  try {
    host = await launchSimulationProcessHost(settings)
    await authenticate(page, host)
    await page.goto(`${host.ready.baseUrl}/?workspace=simulation`)
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.locator('header').getByRole('button', { name: '新建世界', exact: true }).click()
    await page.getByRole('dialog', { name: '新建世界', exact: true }).getByRole('button', { name: /软件工作室/ }).click()
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    const create = workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true })
    await expect.poll(() => create.isEnabled()).toBe(true)
    expect(await host.observe()).toMatchObject({ opens: 0, requests: 0 })
    await create.click()
    const confirmation = page.getByRole('dialog', { name: '创建暂停运行', exact: true })
    await confirmation.getByLabel('运行名', { exact: true }).fill('默认世界恢复验证')
    await confirmation.getByRole('button', { name: '创建暂停运行', exact: true }).click()
    await workspace.getByRole('button', { name: '打开运行', exact: true }).click()
    const runId = new URL(page.url()).searchParams.get('simulation')
    expect(runId).toBeTruthy()
    const original = await host.observe()
    expect(original).toMatchObject({ phase: 'paused', requests: 0, entityCount: 9 })
    await workspace.getByRole('button', { name: '开始调度', exact: true }).click()
    const start = page.getByRole('dialog', { name: '开始调度', exact: true })
    await start.getByRole('button', { name: '开始调度', exact: true }).click()
    await expect.poll(async () => (await host!.observe()).entityCount, { timeout: 45000 }).toBe(10)
    await expect.poll(async () => (await host!.observe()).stop, { timeout: 45000 }).toBe('idle')
    expect((await host.observe()).correctedReplies).toBeGreaterThan(0)
    expect((await host.observe()).compactions).toBeGreaterThan(0)
    expect((await host.observe()).postCompactionSubmissions).toBeGreaterThan(0)
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await expect.poll(async () => {
      const control = await rpc<SimulationProductControl>(page, host!, 'simulation.runs.control', { runId })
      return control.phase === 'paused' && !control.inFlight
    }).toBe(true)
    const entities = await rpc<SimulationProductCollectionPage>(page, host, 'simulation.collections.list', {
      runId, collection: 'entities', limit: 32,
    })
    const cases = await rpc<SimulationProductWorldCasesPage>(page, host, 'simulation.world.cases.list', { runId, limit: 32 })
    expect(cases.items).toHaveLength(1)
    expect(cases.items[0]).toMatchObject({ operation: 'generate-and-hire', status: 'committed', origin: { kind: 'decision' } })
    const checkpoint = await rpc<SimulationProductRequestReceipt>(page, host, 'simulation.checkpoints.create', {
      runId, commandId: 'default-world-cold',
    })
    await expect.poll(async () => {
      const value = await rpc<SimulationProductRequestResult>(page, host!, 'simulation.requests.get', { commandId: checkpoint.commandId })
      return value.status === 'found' ? value.request.status : undefined
    }, { timeout: 15000 }).toBe('completed')
    const before = await host.observe(), oldPid = host.ready.pid
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/simulation.runs.inspect'),
      workspace.locator('header').first().getByRole('button', { name: '刷新', exact: true }).click(),
    ])
    await page.screenshot({ path: join(root, 'world-hired-paused.png') })
    await host.kill()
    host = await launchSimulationProcessHost({ ...settings, model: 'changed-default' })
    expect(host.ready.pid).not.toBe(oldPid)
    await authenticate(page, host)
    await page.goto(`${host.ready.baseUrl}/?workspace=simulation&simulation=${runId}`)
    await workspace.waitFor()
    expect(await host.observe()).toMatchObject({ requests: 0, opens: 0 })
    await showSimulationMaintenance(workspace)
    const recover = workspace.getByRole('button', { name: '验证并恢复运行', exact: true })
    await expect.poll(() => recover.isEnabled()).toBe(true)
    await recover.click()
    const restore = page.getByRole('dialog', { name: '验证并恢复运行', exact: true })
    await restore.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    await expect.poll(async () => {
      const query = restore.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await restore.getByText('原结果: 请求已完成', { exact: true }).count()
    }, { timeout: 20000 }).toBe(1)
    const after = await host.observe()
    expect(after).toMatchObject({ requests: 0, phase: 'paused', entityCount: before.entityCount,
      channelCount: before.channelCount, decisionCount: before.decisionCount })
    const recoveredEntities = await rpc<SimulationProductCollectionPage>(page, host, 'simulation.collections.list', {
      runId, collection: 'entities', limit: 32,
    })
    const recoveredCases = await rpc<SimulationProductWorldCasesPage>(page, host, 'simulation.world.cases.list', { runId, limit: 32 })
    expect(recoveredEntities.items.map(value => value.id)).toEqual(entities.items.map(value => value.id))
    expect(recoveredCases.items.map(({ requestId, intentId, status }) => ({ requestId, intentId, status })))
      .toEqual(cases.items.map(({ requestId, intentId, status }) => ({ requestId, intentId, status })))
    const control = await rpc<SimulationProductControl>(page, host, 'simulation.runs.control', { runId })
    expect(control.budget.model).toEqual({ provider: 'published-restart', name: 'world' })
    await page.reload(); await workspace.waitFor()
    expect((await host.observe()).requests).toBe(0)
    expect(errors.pageErrors).toEqual([])
    await writeFile(join(root, 'proof.json'), JSON.stringify({ oldPid, newPid: host.ready.pid, baseUrl: host.ready.baseUrl,
      before, after, control, entityIds: recoveredEntities.items.map(value => value.id), cases: recoveredCases.items }, null, 2) + '\n')
  } finally { await host?.kill(); await browser.close() }
}, 180000)

it('shows the exact overrun and confirms it while staying paused without another model call', async () => {
  const root = join(REPO_ROOT, '.local/simulation-p1-browser')
  await mkdir(root, { recursive: true })
  const scaffold = await launchWebScaffold({ tempRoot: root, noModels: true })
  const browser = await chromium.launch(), page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  const errors = watchConsole(page), requests: { stage: string; tools: string[]; goal: string }[] = []
  try {
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['overrun-keyless'], defaultWorldModel(requests, true)))
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'overrun-keyless', model: 'world' })
    await scaffold.authenticateBrowserPage(page)
    await page.goto(`${scaffold.baseUrl}/?workspace=simulation`)
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.locator('header').getByRole('button', { name: '新建世界', exact: true }).click()
    await page.getByRole('dialog', { name: '新建世界', exact: true }).getByRole('button', { name: /软件工作室/ }).click()
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    const create = workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true })
    await expect.poll(() => create.isEnabled()).toBe(true)
    await create.click()
    const confirmation = page.getByRole('dialog', { name: '创建暂停运行', exact: true })
    await confirmation.getByLabel('运行名', { exact: true }).fill('超额确认验证')
    await confirmation.getByRole('button', { name: '创建暂停运行', exact: true }).click()
    await workspace.getByRole('button', { name: '打开运行', exact: true }).click()
    const runId = new URL(page.url()).searchParams.get('simulation')
    const control = async () => {
      const response = await scaffold.authenticatedRpc<SimulationProductControl>('simulation.runs.control', { runId })
      if (!response.result.ok) throw new Error('Control unavailable')
      return response.result.value
    }
    await workspace.getByRole('button', { name: '开始调度', exact: true }).click()
    await page.getByRole('dialog', { name: '开始调度', exact: true }).getByRole('button', { name: '开始调度', exact: true }).click()
    await expect.poll(async () => (await control()).stop).toBe('token-overrun')
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    const review = workspace.getByRole('button', { name: '核对 token 超额', exact: true })
    await expect.poll(() => review.isEnabled()).toBe(true)
    await review.click()
    const dialog = page.getByRole('dialog', { name: '核对 token 超额', exact: true })
    expect(await dialog.getByText('70,000', { exact: true }).count()).toBe(1)
    await page.screenshot({ path: join(root, 'overrun-review-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(root, 'overrun-review-mobile.png') })
    await dialog.getByRole('button', { name: '确认超额并保持暂停', exact: true }).click()
    await expect.poll(async () => (await control()).tokenRecovery).toBeUndefined()
    expect(await control()).toMatchObject({ phase: 'paused', inFlight: false })
    expect(requests).toHaveLength(1)
    expect(errors.pageErrors).toEqual([])
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
  } finally { await browser.close(); await scaffold.close() }
}, 90000)
