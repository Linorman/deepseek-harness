/** Browser plugin unavailable: real Agent proposal acceptance supplies an unresolved frozen electorate to the built product. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import { definition as original, deployment } from '../../../examples/simulation-company/tests/fixtures/complete-world/source.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it.each(['json', 'sqlite'] as const)('explains %s actual waiting votes and opens the frozen electorate without a fabricated ballot', async (backend) => {
  const parent = resolve('.local/world-completion/u10-actionable/votes-browser')
  await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, `${backend}-`))
  const definition = worldScenarioV1Schema.parse({ ...original, behavior: {
    initialGoals: original.behavior.initialGoals.filter(value => value.body === 'propose-policy'), calendars: [], directorEvents: [],
  } })
  expect(definition.behavior.initialGoals).toHaveLength(1)
  const overlay = join(root, 'overlay.json')
  await writeFile(overlay, JSON.stringify([{ insert: [
    { name: '@clocky/clocky-simulation' },
    { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
    { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
      maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
    { name: '@clocky/clocky-simulation-world/providers' }, { name: '@clocky/clocky-tool-simulation' },
    { name: resolve('examples/simulation-company/tests/fixtures/complete-world/model.ts') },
    { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'waiting-votes-directory', imports: [] } },
    { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'waiting-votes-commands', templates: [],
      world: { provider: 'local', catalog: deployment, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 },
        authoringTemplates: [{ id: 'waiting-votes', version: '1', name: '等待独立投票', definition }] },
      driverIntervalMs: 5, driverRetryMs: 10 } },
    { name: '@clocky/clocky-client-ui-simulation' },
  ] }]))
  const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
    productPrincipalId: 'waiting-votes-reader', retainedWorld: { workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions') },
    agentPresets: { default: 'simulation', roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' }] } })
  let owned: SimulationRun | undefined, opens = 0, models = 0, held = false
  const release = Promise.withResolvers<undefined>(), open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
  scaffold.ctx.simulations.open = async (...args) => {
    const run = await open(...args); owned = run; opens++
    const commit = run.commitWorldMutation.bind(run)
    run.commitWorldMutation = async (...input) => {
      const result = await commit(...input)
      if (!held && run.snapshot().world?.plans[input[0].planId]?.pin.operation === 'propose-norm') {
        held = true; await release.promise
      }
      return result
    }
    return run
  }
  const modelRequests: unknown[] = []
  scaffold.ctx.on('llm/stream', (options, next) => {
    models++; modelRequests.push(structuredClone(options.messages)); return next()
  })
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(10000)
  const errors = watchConsole(page), consoleErrors: string[] = [], replies: unknown[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('response', async (response) => {
    if (!response.url().endsWith('/api/simulation.world.domain.read')) return
    try { replies.push(await response.json()) }
    catch { /* Teardown may retire an unfinished read; only completed replies enter the proof. */ }
  })
  try {
    await scaffold.authenticateBrowserPage(page); await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('button', { name: '新建世界', exact: true }).first().click()
    await page.getByRole('dialog', { name: '新建世界', exact: true }).getByRole('button', { name: '等待独立投票', exact: false }).click()
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    await expect.poll(() => workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).click()
    const create = page.getByRole('dialog', { name: '创建暂停运行', exact: true })
    await create.getByLabel('运行名', { exact: true }).fill(`Waiting votes ${backend}`)
    await create.getByRole('button', { name: '创建暂停运行', exact: true }).click()
    await workspace.getByRole('button', { name: '打开运行', exact: true }).click()
    await expect.poll(() => owned?.snapshot().latestCheckpointId !== undefined, { timeout: 10000 }).toBe(true)
    await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
    await expect.poll(() => workspace.getByRole('button', { name: '开始调度', exact: true }).isEnabled()).toBe(true)
    expect(models).toBe(0)
    await workspace.getByRole('button', { name: '开始调度', exact: true }).click()
    await page.getByRole('dialog', { name: '开始调度', exact: true }).getByRole('button', { name: '开始调度', exact: true }).click()
    await expect.poll(() => held, { timeout: 10000 }).toBe(true)
    const before = owned!.snapshot(), beforeModels = models, beforeOpens = opens
    const proposal = Object.values(before.world!.governance.proposals)[0]!
    expect(proposal.electorate).toHaveLength(2); expect(Object.values(before.world!.governance.votes)).toHaveLength(0)
    await workspace.getByRole('button', { name: '制度', exact: true }).first().click()
    await workspace.locator(`tr[data-row="${proposal.id}"]`).click()
    const inspector = workspace.getByRole('complementary')
    await inspector.getByText('投票进行中', { exact: true }).waitFor()
    await inspector.getByRole('tab', { name: '冻结选民', exact: true }).focus(); await page.keyboard.press('Enter')
    await expect.poll(() => inspector.locator('[aria-label^="Electorate（"] li[data-vote="pending"]').count()).toBe(2)
    await inspector.getByText('尚未结案', { exact: true }).waitFor()
    await page.screenshot({ path: join(root, 'waiting-votes.png'), fullPage: true, animations: 'disabled' })
    await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
    await expect.poll(() => inspector.locator('[aria-label^="Electorate（"] li[data-vote="pending"]').count()).toBe(2)
    expect(owned!.snapshot()).toEqual(before); expect(models).toBe(beforeModels); expect(opens).toBe(beforeOpens)
    expect(errors.pageErrors).toEqual([]); expect(consoleErrors).toEqual([])
    await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, before, after: owned!.snapshot(),
      proposalId: proposal.id, replies, modelRequests, modelCalls: models, readModelCalls: models - beforeModels,
      writableOpens: opens - beforeOpens, observedPendingSeats: 2, keyboardElectorate: true,
      realAgentProposal: true, noSynthesizedBallots: true }, null, 2))
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText())
    await writeFile(join(root, 'failure-state.json'), JSON.stringify({ state: owned?.snapshot(), modelRequests, replies }, null, 2))
    throw cause
  } finally { release.resolve(undefined); await browser.close(); await scaffold.close() }
})
