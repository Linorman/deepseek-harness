/** Published configuration executes only after the real Start confirmation and keeps paused history on refresh. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { LlmAdapter, type GenerateOptions, type LlmModelInfo } from '@clocky/clocky-llm'
import { companyModel } from '../../../packages/simulation/simulation-product/tests/company-model.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'
import type { SimulationProductCatalog, SimulationProductRequestReceipt } from '@clocky/clocky-simulation-product/types'

it('creates paused default work, confirms Start, records native events, pauses and refreshes without restarting inference', async () => {
  const root = join(REPO_ROOT, '.tmp/web-runtime-20261007')
  await mkdir(root, { recursive: true })
  const scaffold = await launchWebScaffold({ tempRoot: root })
  let world: SimulationRun | undefined
  const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
  scaffold.ctx.simulations.open = async (...args) => { const run = await open(...args); world = run; return run }
  const calls: Array<{ stage: string; tools: string[]; goal: string }> = []
  let script: ReturnType<typeof companyModel> | undefined
  const registration = scaffold.ctx.llm.registerAdapter(['default-replay'], new class extends LlmAdapter {
    override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
      return Promise.resolve([{ provider, id: 'procurement', name: 'Procurement replay' }])
    }
    override stream(options: GenerateOptions) {
      if (world === undefined) throw new Error('Start has no accepted default world')
      script ??= companyModel(world, calls)
      return script.stream(options)
    }
  }())
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  try {
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'default-replay', model: 'procurement' })
    const catalog = await scaffold.authenticatedRpc<SimulationProductCatalog>('simulation.catalog', {})
    if (!catalog.result.ok) throw new Error('Catalog unavailable')
    const template = catalog.result.value.items[0]!
    if (template.readiness.status !== 'ready') throw new Error('Replay route unavailable')
    const created = await scaffold.authenticatedRpc<SimulationProductRequestReceipt>('simulation.runs.create', {
      commandId: 'default-lifecycle', templateId: template.id, templateVersion: template.version, expectedModel: template.readiness.model,
      name: '生产采购回放', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' },
    })
    if (!created.result.ok) throw new Error('Default creation refused')
    const runId = created.result.value.runId
    await expect.poll(async () => {
      const result = await scaffold.authenticatedRpc<{ status: string; request?: SimulationProductRequestReceipt }>(
        'simulation.requests.get', { commandId: 'default-lifecycle' })
      return result.result.ok ? result.result.value.request?.status : undefined
    }).toBe('completed')
    expect(calls).toEqual([])
    const initialRevision = world?.snapshot().revision ?? 0
    await scaffold.authenticateBrowserPage(page)
    await page.goto(`${scaffold.baseUrl}/?workspace=simulation&simulation=${runId}`)
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('button', { name: '开始调度', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '开始调度', exact: true })
    await confirm.waitFor()
    expect(await confirm.innerText()).toContain('default-replay/procurement')
    expect(calls).toEqual([])
    await confirm.getByRole('button', { name: '开始调度', exact: true }).click()
    await expect.poll(() => calls.length, { timeout: 20000 }).toBeGreaterThan(0)
    expect(world?.snapshot().revision).toBeGreaterThan(initialRevision)
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await expect.poll(() => world?.snapshot().phase).toBe('paused')
    const requests = calls.length
    await page.reload()
    await workspace.waitFor()
    await page.waitForTimeout(1000)
    expect(world?.snapshot().phase).toBe('paused')
    expect(calls.length).toBe(requests)
    await page.screenshot({ path: join(root, 'default-simulation-paused.png') })
    expect(errors.pageErrors).toEqual([])
  } finally { registration(); await browser.close(); await scaffold.close() }
}, 90_000)
