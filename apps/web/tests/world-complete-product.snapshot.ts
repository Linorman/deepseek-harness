/** Real product creation and scheduling execute the authored scenarios; browsing and cold explicit recovery preserve their originals. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import { simulationWorldHireCommittedResultPayloadSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot } from '@clocky/clocky-simulation'
import { simulationProductRequestResultSchema, simulationProductControlSchema, simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import { definition, deployment } from '../../../examples/simulation-company/tests/fixtures/complete-world/source.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

// Matches the complete-world fixture: the plain lane replays company; scenario sweeps select the others.
const scene = process.env.WORLD_SCENARIO ?? 'company'
if (scene !== 'company' && scene !== 'laboratory' && scene !== 'association') throw new Error('An explicit authored scene is required')

it.each(['json', 'sqlite'] as const)('completes the actual %s product and cold paused recovery', async (backend) => {
  const parent = resolve('.local/world-completion/u14-product/browser')
  await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, `${backend}-${scene}-`))
  const overlay = join(root, 'overlay.json'), label = `完整 ${scene} 剧本`
  await writeFile(overlay, JSON.stringify([{ insert: [
    { name: '@clocky/clocky-simulation' },
    { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
    { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
      maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
    { name: '@clocky/clocky-simulation-world/providers' }, { name: '@clocky/clocky-tool-simulation' },
    { name: resolve('examples/simulation-company/tests/fixtures/complete-world/model.ts') },
    { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'complete-product-directory', imports: [] } },
    { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'complete-product-commands', templates: [],
      world: { provider: 'local', catalog: deployment, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 },
        authoringTemplates: [{ id: 'complete-product', version: '1', name: label, definition }] },
      driverIntervalMs: 5, driverRetryMs: 10 } },
    { name: '@clocky/clocky-client-ui-simulation' },
  ] }, { id: 'storage-log', config: { backend } }, { id: 'modules', config: { browserConfig: {
    '@clocky/clocky-client-ui-simulation': { pageSize: 32, controlRefreshMs: 50 },
  } } }]))
  const options = { disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
    productPrincipalId: 'complete-product-reader', retainedWorld: { workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions') },
    agentPresets: { default: 'simulation', roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' as const }] } }
  // Observe the actual Loader module; the source fixture's class has a different module identity.
  const loaded: unknown = await import(pathToFileURL(resolve('packages/simulation/simulation-world/lib/index.js')).href)
  const actual = z.object({ SimulationWorldDriver: z.custom<typeof SimulationWorldDriver>(value => typeof value === 'function') }).parse(loaded)
  const driverErrors: string[] = []
  // oxlint-disable-next-line typescript/unbound-method -- The observer calls this original with the actual driver through apply().
  const advance = actual.SimulationWorldDriver.prototype.advance
  const observer = vi.spyOn(actual.SimulationWorldDriver.prototype, 'advance').mockImplementation(function (this: SimulationWorldDriver, ...args) {
    return advance.apply(this, args).catch((cause: unknown) => {
      driverErrors.push(cause instanceof Error ? cause.stack ?? cause.message : String(cause)); throw cause
    })
  })
  let scaffold = await launchWebScaffold(options), owned: SimulationRun | undefined, opens = 0
  const modelRequests: unknown[] = [], creates: unknown[] = [], checkpoints: string[] = [], restores: string[] = []
  const instrument = () => {
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => { owned = await open(...args); opens++; return owned }
    scaffold.ctx.on('llm/stream', (request, next) => {
      if (request.provider !== 'complete-world-scripted') throw new Error('The keyless product attempted an unconfigured model route')
      modelRequests.push({ provider: request.provider, model: request.model, messages: structuredClone(request.messages) })
      return next()
    })
  }
  instrument()
  const run = () => { if (owned === undefined) throw new Error('The actual product Native owner is absent'); return owned }
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.on('dialog', (dialog) => { void dialog.accept() })
  page.setDefaultTimeout(10000)
  const errors = watchConsole(page), consoleErrors: string[] = [], consoleWarnings: string[] = []
  const controlResponses: unknown[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); else if (message.type() === 'warning') consoleWarnings.push(message.text()) })
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/simulation.runs.control') && controlResponses.length < 8) {
      const body: unknown = await response.json()
      controlResponses.push({ url: response.url(), status: response.status(), body })
    }
  })
  page.on('request', (request) => {
    const url = request.url()
    if (url.endsWith('/api/simulation.world.create')) creates.push(request.postDataJSON())
    if (url.endsWith('/api/simulation.checkpoints.create') || url.endsWith('/api/simulation.runs.restore')) {
      const body: unknown = request.postDataJSON()
      if (body === null || typeof body !== 'object') throw new Error('Maintenance carrier has no real input')
      const input: unknown = Reflect.get(body, 'payload')
      const id: unknown = input !== null && typeof input === 'object' ? Reflect.get(input, 'commandId') : undefined
      if (typeof id !== 'string') throw new Error('Maintenance carrier lost the original command')
      if (url.endsWith('/api/simulation.checkpoints.create')) checkpoints.push(id); else restores.push(id)
    }
  })
  const workspace = page.locator('[data-simulation-workspace-page]')
  const publicControl = async (runId: string) => {
    const reply = await scaffold.authenticatedRpc('simulation.runs.control', { runId })
    if (!reply.result.ok) throw new Error(JSON.stringify(reply.result.error))
    return simulationProductControlSchema.parse(reply.result.value)
  }
  const completed = async (commandId: string) => {
    const reply = await scaffold.authenticatedRpc('simulation.requests.get', { commandId })
    if (!reply.result.ok) throw new Error(JSON.stringify(reply.result.error))
    return simulationProductRequestResultSchema.parse(reply.result.value)
  }
  const refresh = () => workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
  try {
    await scaffold.authenticateBrowserPage(page); await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    expect(await page.title()).not.toBe('')
    expect(new URL(page.url()).origin).toBe(new URL(scaffold.baseUrl).origin)
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    await workspace.locator('header').getByRole('button', { name: '新建世界', exact: true }).first().click()
    await page.getByRole('dialog', { name: '新建世界', exact: true }).getByRole('button', { name: label, exact: false }).click()
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    await expect.poll(() => workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).click()
    const create = page.getByRole('dialog', { name: '创建暂停运行', exact: true })
    await create.getByLabel('运行名', { exact: true }).fill(`Product ${scene} ${backend}`)
    await create.getByRole('button', { name: '创建暂停运行', exact: true }).click()
    await workspace.getByRole('button', { name: '打开运行', exact: true }).click()
    await expect.poll(() => run().snapshot().latestCheckpointId !== undefined, { timeout: 10000 }).toBe(true)
    await refresh()
    const runId = simulationProductRunIdSchema.parse(new URL(page.url()).searchParams.get('simulation'))
    expect(creates).toHaveLength(1); expect(modelRequests).toHaveLength(0); expect(run().snapshot().phase).toBe('paused')
    await expect.poll(() => workspace.getByRole('button', { name: '开始调度', exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: '开始调度', exact: true }).click()
    await page.getByRole('dialog', { name: '开始调度', exact: true }).getByRole('button', { name: '开始调度', exact: true }).click()
    await expect.poll(async () => {
      const control = await publicControl(runId), state = run().snapshot(), world = state.world
      if (control.driver === 'failed') throw new Error(`Actual product driver failed: ${driverErrors.join('\n')}`)
      if (world === undefined || control.inFlight || control.stop !== 'idle') return false
      return scene === 'association' ? Object.keys(world.external.adjudications).length === 2
        : Object.values(world.results).some(value => world.requests[value.requestId]?.pin.operation === 'depart' && value.outcome.kind === 'committed')
    // The complete authored workflow issues well over a hundred scripted turns; allow for slower hosts.
    }, { timeout: 360000 }).toBe(true)
    const finished = run().snapshot(), world = finished.world!
    expect(modelRequests.length).toBeGreaterThan(0)
    for (const proposal of Object.values(world.governance.proposals)) {
      const votes = Object.values(world.governance.votes).filter(value => value.proposalId === proposal.id)
      expect(new Set(votes.map(value => value.source.binding.sessionId)).size).toBe(2)
      expect(Object.values(world.governance.resolutions).filter(value => value.proposalId === proposal.id)).toHaveLength(1)
    }
    const appointment = Object.values(world.results).find(value => value.outcome.kind === 'committed'
      && ['generate-and-hire', 'hire-existing'].includes(world.requests[value.requestId]!.pin.operation))!
    const identity = simulationWorldHireCommittedResultPayloadSchema.parse(appointment.payload)
    const person = finished.entities[identity.entityId]!
    if (scene === 'association') {
      expect(person.id).toBe('candidate'); expect(Object.keys(world.governance.votes)).toHaveLength(2)
      expect(finished.resources).toEqual({}); expect(Object.values(world.external.adjudications).every(value => value.proposal.outcome.kind === 'failure')).toBe(true)
    } else {
      expect(Object.values(world.norms.versions).flat()).toHaveLength(1)
      expect(Object.values(finished.resources).map(value => value.quantity)).toEqual(['7', '3'])
      expect(Object.values(world.personnel.reservations).filter(value => value.status === 'committed')).toHaveLength(2)
      expect(Object.values(world.external.representatives).filter(value => value.status === 'committed')).toHaveLength(1)
      const original = Object.values(finished.interactions).find(value => value.id === 'handoff-original')!
      const replacement = Object.values(finished.interactions).find(value => value.id === 'handoff-replacement')!
      expect(original.execution).toBe('cancelled'); expect(finished.commitments[replacement.commitmentId!]!.phase).toBe('fulfilled')
      expect(original.assignee).toBe(person.id); expect(replacement.assignee).not.toBe(person.id)
      expect(Object.values(finished.relations).filter(value => value.relation === 'assignment' && value.subject === person.id && value.validUntil === null)).toHaveLength(0)
    }
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await expect.poll(() => run().snapshot().phase).toBe('paused')
    // The pause request records its completion one revision after the phase change; take the baseline once settled.
    await expect.poll(async () => {
      const revision = run().snapshot().revision
      await new Promise(resolveWait => setTimeout(resolveWait, 300))
      return run().snapshot().revision === revision
    }).toBe(true)
    const stable = run().snapshot(), calls = modelRequests.length, beforeOpens = opens
    await workspace.getByRole('button', { name: '制度', exact: true }).first().click()
    await workspace.getByRole('table').locator('tbody tr').first().click()
    const inspector = workspace.getByRole('complementary')
    await inspector.getByRole('tab', { name: '投票与来源', exact: true }).click()
    await expect.poll(() => inspector.locator('li[data-vote="for"]').count()).toBeGreaterThanOrEqual(2)
    await page.screenshot({ path: join(root, 'governance.png'), fullPage: true })
    await workspace.getByRole('button', { name: '组织', exact: true }).first().click()
    await workspace.getByRole('radio', { name: '人员', exact: true }).click()
    await workspace.locator(`tr[data-row="${person.id}"]`).click()
    await inspector.getByRole('tab', { name: '任职', exact: true }).click()
    await inspector.getByText(`#${identity.relationId} · r`, { exact: false }).waitFor()
    await page.screenshot({ path: join(root, 'person-tenures.png'), fullPage: true })
    await workspace.getByRole('button', { name: '外部世界', exact: true }).first().click()
    await workspace.getByRole('table').locator('tbody tr').first().click()
    await inspector.getByRole('tab', { name: '交互', exact: true }).click()
    await page.screenshot({ path: join(root, 'external-history.png'), fullPage: true })
    expect(run().snapshot()).toEqual(stable); expect(modelRequests).toHaveLength(calls); expect(opens).toBe(beforeOpens)
    await workspace.locator('[data-simulation-maintenance] summary').click()
    await workspace.getByRole('button', { name: '创建完整检查点', exact: true }).click()
    await page.getByRole('dialog', { name: '创建完整检查点', exact: true }).getByRole('button', { name: '创建完整检查点', exact: true }).click()
    await expect.poll(() => checkpoints.length).toBe(1)
    await expect.poll(async () => { const receipt = await completed(checkpoints[0]!); return receipt.status === 'found' && receipt.request.status === 'completed' }, { timeout: 10000 }).toBe(true)
    await page.getByRole('dialog', { name: '创建完整检查点', exact: true }).getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    const checkpointed = run().snapshot(), route = new URL(page.url()).search
    await writeFile(join(root, 'warm.json'), JSON.stringify({ scene, backend, definition, initial: creates, finished, checkpointed, modelRequests }, null, 2))
    await page.goto('about:blank'); await scaffold.close(); owned = undefined
    const priorModels = modelRequests.length, priorOpens = opens
    scaffold = await launchWebScaffold(options); instrument()
    controlResponses.length = 0
    await scaffold.authenticateBrowserPage(page); await page.goto(`${scaffold.baseUrl}/${route}`, { waitUntil: 'load' })
    expect(new URL(page.url()).origin).toBe(new URL(scaffold.baseUrl).origin)
    await workspace.getByRole('heading', { name: `Product ${scene} ${backend}`, exact: true }).waitFor()
    const cold = await publicControl(runId)
    expect(cold.owner).toBe('not-held'); expect(cold.phase).toBe('paused')
    expect(modelRequests).toHaveLength(priorModels); expect(opens).toBe(priorOpens)
    const coldReadOpens = opens - priorOpens
    await refresh()
    await workspace.getByRole('button', { name: '概览', exact: true }).click()
    await workspace.locator('[data-simulation-maintenance] summary').click()
    await workspace.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    const restore = page.getByRole('dialog', { name: '验证并恢复运行', exact: true })
    await expect.poll(() => restore.getByRole('button', { name: '验证并恢复运行', exact: true }).isEnabled()).toBe(true)
    await restore.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    await expect.poll(() => restores.length).toBe(1)
    await expect.poll(async () => { const receipt = await completed(restores[0]!); return receipt.status === 'found' && receipt.request.status === 'completed' }, { timeout: 10000 }).toBe(true)
    const restored: SimulationSnapshot = run().snapshot()
    expect(restored.phase).toBe('paused'); expect(restored.world).toEqual(checkpointed.world)
    expect(restored.relations).toEqual(checkpointed.relations); expect(restored.resources).toEqual(checkpointed.resources)
    expect(restored.entities[person.id]?.binding).toEqual(person.binding)
    expect(restored.entities[person.id]?.profile).toEqual(person.profile)
    expect(modelRequests).toHaveLength(priorModels); expect(creates).toHaveLength(1)
    await page.screenshot({ path: join(root, 'restored-paused.png'), fullPage: true })
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(errors.pageErrors).toEqual([]); expect(consoleErrors).toEqual([])
    await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, scene, runId, finished, checkpointed, restored,
      modelCalls: priorModels, coldModelCalls: modelRequests.length - priorModels, coldReadOpens,
      nativeVersion: 96, actualProductStart: true, actualBrowserRecovery: true, sourceMode: 'Vitest fixture with Loader built Host/Client',
      creates, checkpoints, restores, consoleErrors, consoleWarnings, pageErrors: errors.pageErrors,
      pageTitle: await page.title(), url: page.url() }, null, 2))
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText())
    await writeFile(join(root, 'failure-state.json'), JSON.stringify({ error: String(cause), driverErrors, controlResponses, url: page.url(),
      state: owned?.snapshot(), modelRequests, creates, checkpoints, restores }, null, 2))
    throw cause
  } finally { await browser.close(); await scaffold.close(); observer.mockRestore() }
}, 600_000)
