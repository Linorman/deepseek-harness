/** Default production composition survives lost acceptance responses and requires explicit cold recovery. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import type { SimulationProductCatalog, SimulationProductRequestResult, SimulationProductControl,
  SimulationProductRequestReceipt } from '@clocky/clocky-simulation-product/types'
import { launchSimulationProcessHost, type SimulationProcessHost } from './simulation-process-host.ts'
import { probeFreePort, REPO_ROOT } from './support.ts'
import { showSimulationMaintenance } from './simulation-browser-controls.ts'

async function authenticate(page: Page, host: SimulationProcessHost): Promise<void> {
  const response = await page.request.post(`${host.ready.baseUrl}/api/bootstrap`, { data: { credential: host.ready.credential } })
  expect(response.status()).toBe(204)
}
async function rpc<T>(page: Page, host: SimulationProcessHost, method: string, payload: unknown): Promise<T> {
  const response = await page.request.post(`${host.ready.baseUrl}/api/${method}`, {
    data: { type: 'client-request', rpcId: `default-restart-${method}`, method, payload },
  })
  const body = await response.json() as { result: { ok: true; value: T } | { ok: false; error: { code: string } } }
  if (!body.result.ok) throw new Error(`${method}: ${body.result.error.code}`)
  return body.result.value
}

it('retains the accepted model and identity through fresh Host processes and resumes only after recovery and Start', async () => {
  const parent = join(REPO_ROOT, '.tmp/web-runtime-20261007')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'default-restart-'))
  const settings = { published: true, workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions'),
    port: await probeFreePort() }
  const browser = await chromium.launch()
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
  let host: SimulationProcessHost | undefined
  const evidence: unknown[] = []
  try {
    host = await launchSimulationProcessHost(settings)
    await authenticate(page, host)
    const catalog = await rpc<SimulationProductCatalog>(page, host, 'simulation.catalog', {})
    const template = catalog.items[0]!
    if (template.readiness.status !== 'ready') throw new Error('Default replay not ready')
    const input = { commandId: 'lost-default-response', templateId: template.id, templateVersion: template.version,
      expectedModel: template.readiness.model, name: '默认采购重启',
      parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } }
    await host.arm('accepted-create')
    const lost = rpc<SimulationProductRequestReceipt>(page, host, 'simulation.runs.create', input).catch(() => undefined)
    const accepted = await host.held()
    evidence.push({ stage: 'accepted-before-response', ...(await host.observe()) })
    expect(await host.observe()).toMatchObject({ requests: 0, opens: 0 })
    const firstPid = host.ready.pid
    await host.kill(); await lost
    host = await launchSimulationProcessHost({ ...settings, model: 'changed-after-acceptance' })
    expect(host.ready.pid).not.toBe(firstPid)
    const stale = await page.request.post(`${host.ready.baseUrl}/api/simulation.requests.get`, {
      data: { rpcId: 'retired', payload: { commandId: input.commandId } },
    })
    expect(stale.status()).toBe(401)
    await authenticate(page, host)
    expect(await host.observe()).toMatchObject({ requests: 0, opens: 0 })
    expect(await rpc<SimulationProductRequestResult>(page, host, 'simulation.requests.get', { commandId: input.commandId }))
      .toMatchObject({ status: 'found', request: { runId: accepted.runId, status: 'accepted' } })
    const retried = await rpc<SimulationProductRequestReceipt>(page, host, 'simulation.runs.create', input)
    expect(retried.runId).toBe(accepted.runId)
    await expect.poll(async () => {
      const result = await rpc<SimulationProductRequestResult>(page, host!, 'simulation.requests.get', { commandId: input.commandId })
      return result.status === 'found' ? result.request.status : undefined
    }).toBe('completed')
    const checkpoints = await rpc<{ items: Array<{ status: string }> }>(page, host, 'simulation.collections.list', {
      runId: accepted.runId, collection: 'checkpoints', limit: 32,
    })
    expect(checkpoints.items).toHaveLength(1)
    expect(checkpoints.items[0]?.status).toBe('completed')
    const control = await rpc<SimulationProductControl>(page, host, 'simulation.runs.control', { runId: accepted.runId })
    expect(control.budget.model).toEqual(input.expectedModel)
    expect(control.phase).toBe('paused')
    expect((await rpc<{ items: unknown[] }>(page, host, 'simulation.runs.list', {})).items).toHaveLength(1)
    await page.goto(`${host.ready.baseUrl}/?workspace=simulation&simulation=${accepted.runId}`)
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('button', { name: '开始调度', exact: true }).click()
    const start = page.getByRole('dialog', { name: '开始调度', exact: true })
    expect(await start.innerText()).toContain('published-restart/procurement')
    expect((await host.observe()).requests).toBe(0)
    await start.getByRole('button', { name: '开始调度', exact: true }).click()
    await expect.poll(async () => (await host!.observe()).requests).toBeGreaterThan(0)
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await expect.poll(async () => {
      const current = await rpc<SimulationProductControl>(page, host!, 'simulation.runs.control', { runId: accepted.runId })
      return current.phase === 'paused' && !current.inFlight
    }).toBe(true)
    const checkpoint = await rpc<SimulationProductRequestReceipt>(page, host, 'simulation.checkpoints.create', {
      runId: accepted.runId, commandId: 'default-cold-anchor',
    })
    await expect.poll(async () => {
      const result = await rpc<SimulationProductRequestResult>(page, host!, 'simulation.requests.get', { commandId: checkpoint.commandId })
      return result.status === 'found' ? result.request.status : undefined
    }).toBe('completed')
    evidence.push({ stage: 'paused-checkpoint', ...(await host.observe()) })
    const priorPid = host.ready.pid
    await host.kill()
    host = await launchSimulationProcessHost({ ...settings, model: 'new-default-again' })
    expect(host.ready.pid).not.toBe(priorPid)
    await authenticate(page, host)
    await page.goto(`${host.ready.baseUrl}/?workspace=simulation&simulation=${accepted.runId}`)
    expect(await host.observe()).toMatchObject({ requests: 0, opens: 0 })
    await showSimulationMaintenance(workspace)
    const recover = workspace.getByRole('button', { name: '验证并恢复运行', exact: true })
    await expect.poll(() => recover.isEnabled()).toBe(true)
    await recover.click()
    const confirmation = page.getByRole('dialog', { name: '验证并恢复运行', exact: true })
    const verify = confirmation.getByRole('button', { name: '验证并恢复运行', exact: true })
    await expect.poll(() => verify.isEnabled()).toBe(true)
    await verify.click()
    await expect.poll(async () => {
      const query = confirmation.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() > 0 && await query.isEnabled()) await query.click()
      return await confirmation.getByText('原结果: 请求已完成', { exact: true }).count()
    }, { timeout: 20000 }).toBe(1)
    await confirmation.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    expect(await host.observe()).toMatchObject({ requests: 0, phase: 'paused' })
    await page.reload(); await workspace.waitFor()
    expect(await host.observe()).toMatchObject({ requests: 0, phase: 'paused' })
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    const finalStart = page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true })
    expect(await finalStart.innerText()).toContain('published-restart/procurement')
    await finalStart.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await expect.poll(async () => {
      const current = await host!.observe()
      await writeFile(join(parent, 'default-restart-after-start.json'), JSON.stringify(current, null, 2))
      return current.requests
    }).toBeGreaterThan(0)
    evidence.push({ stage: 'explicit-restart', ...(await host.observe()) })
    await page.screenshot({ path: join(parent, 'default-simulation-restored.png') })
    await writeFile(join(parent, 'default-restart.json'), JSON.stringify(evidence, null, 2))
  } catch (cause: unknown) {
    await writeFile(join(parent, 'default-restart-failure.json'), JSON.stringify({ evidence, observation: await host?.observe(),
      page: await page.locator('body').innerText() }, null, 2))
    await page.screenshot({ path: join(parent, 'default-restart-failure.png') })
    throw cause
  } finally { await host?.kill(); await browser.close(); await rm(root, { recursive: true, force: true }) }
}, 120_000)
