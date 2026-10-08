/** Real Loader/Host reads retain one writer across handshake, reconnect and product remount. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type WebSocketRoute } from 'playwright'
import { expect, it, vi } from 'vitest'
import { simulationChangeSchema, simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it.each(['json', 'sqlite'] as const)('waits for the deep-link handshake, discards old reads and reconnects without another owner (%s)', async (backend) => {
  const root = join(process.cwd(), '.tmp/simulation-read-lifecycle', backend)
  await mkdir(root, { recursive: true })
  const step = async (name: string) => { await writeFile(join(root, 'stage.txt'), name + '\n') }
  const probe = async (promise: Promise<undefined>, name: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([promise, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`Timed out waiting for ${name}`)) }, 15000)
      })])
    } finally { clearTimeout(timer) }
  }
  await step('preparing overlay')
  const directory = await mkdtemp(join(root, 'run-'))
  const overlay = JSON.parse(await readFile('examples/headless-agent/tests/fixtures/simulation/simulation-web/cordis.yml', 'utf8')) as {
    insert: { name: string; config?: Record<string, unknown> }[] }[]
  const entries = overlay[0]!.insert
  const local = entries.find(entry => entry.name === '@clocky/clocky-simulation-local')!
  local.config = { ...local.config, root: join(directory, 'world'), backend }
  const product = entries.find(entry => entry.name === '@clocky/clocky-simulation-product')!
  const imported = (product.config!.imports as { id: string; spec: unknown }[])[0]!
  const spec = simulationRunSpecSchema.parse(imported.spec)
  const configured = join(directory, 'overlay.json')
  await writeFile(configured, JSON.stringify(overlay))
  await step('booting real scaffold')
  const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: configured, tempRoot: directory, productPrincipalId: 'simulation-browser-user' })
  await step('launching Chromium')
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  let run: SimulationRun | undefined
  const sockets: WebSocketRoute[] = []
  let blockReconnect = false
  await page.routeWebSocket(/\/api\/events\.(mux|host)/, (socket) => {
    if (blockReconnect) { void socket.close({ code: 1001, reason: 'Simulation read reconnect verification' }); return }
    sockets.push(socket); socket.connectToServer()
  })
  const requests: string[] = []
  page.on('request', (request) => { requests.push(new URL(request.url()).pathname) })
  const queries: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/simulation.')) queries.push(request.url()) })
  let releaseOldRead = () => {}
  let retiring = false
  const describeEntered = Promise.withResolvers<undefined>(), describeRelease = Promise.withResolvers<undefined>()
  const describeSettled = Promise.withResolvers<undefined>()
  await page.route('**/api/host.describe', async (route) => {
    describeEntered.resolve(undefined); await describeRelease.promise
    try { await route.continue() }
    catch (cause: unknown) { if (!retiring) throw cause }
    finally { describeSettled.resolve(undefined) }
  })
  try {
    await step('opening native writer')
    run = await scaffold.ctx.simulations.open(scaffold.ctx.simulations.resolve({ provider: 'local', spec, mode: 'create' }))
    await step('creating native fixture entity')
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'original-entity', entityKind: 'org', cognition: 'none',
      profile: { name: '原始实体', private: 'never disclose this body' } }), run.snapshot().revision)
    const before = run.snapshot()
    const open = vi.spyOn(scaffold.ctx.simulations, 'open')
    await step('authenticating browser')
    await scaffold.authenticateBrowserPage(page)
    const handshakeRequest = page.waitForRequest('**/api/host.describe', { timeout: 30000 })
    await step('committing deep link')
    await page.goto(`${scaffold.baseUrl}/?workspace=simulation&simulation=${imported.id}&simulationModule=entities`, { waitUntil: 'commit' })
    await step('waiting for describe request')
    await handshakeRequest
    await describeEntered.promise
    const workspace = page.locator('[data-simulation-workspace-page]')
    // Client assembly also awaits the handshake; commit lets us observe that
    // barrier without waiting for a document load that depends on its release.
    expect(queries).toEqual([])
    expect(run.snapshot()).toEqual(before)
    expect(open).not.toHaveBeenCalled()
    expect(new URL(page.url()).searchParams.get('simulation')).toBe(imported.id)
    await step('releasing handshake')
    describeRelease.resolve(undefined); await describeSettled.promise
    await page.unroute('**/api/host.describe')
    await step('waiting for initial entity table')
    await workspace.getByRole('table').getByText('原始实体', { exact: true }).waitFor({ timeout: 30000 })
    const oldEntered = Promise.withResolvers<undefined>(), oldRelease = Promise.withResolvers<undefined>()
    const oldSettled = Promise.withResolvers<undefined>()
    releaseOldRead = () => { oldRelease.resolve(undefined) }
    let intercept = true
    await page.route('**/api/simulation.collections.list', async (route) => {
      const input = route.request().postDataJSON() as { payload: { collection: string } }
      if (!intercept || input.payload.collection !== 'entities') { await route.continue(); return }
      intercept = false
      const response = await route.fetch()
      oldEntered.resolve(undefined); await oldRelease.promise
      try { await route.fulfill({ response }) }
      catch { /* The displaced browser fetch may already be cancelled; its old body cannot reach the view. */ }
      finally { oldSettled.resolve(undefined) }
    })
    await workspace.getByRole('button', { name: '刷新', exact: true }).click()
    await step('waiting for captured original entities response')
    await probe(oldEntered.promise, 'captured original entities response')
    await workspace.getByRole('navigation', { name: '仿真模块', exact: true }).getByRole('button', { name: '决策', exact: true }).click()
    await workspace.getByText('此集合暂无记录', { exact: true }).waitFor()
    oldRelease.resolve(undefined); await probe(oldSettled.promise, 'retired original entities response')
    expect(await workspace.getByText('原始实体', { exact: true }).count()).toBe(0)
    expect(new URL(page.url()).searchParams.get('simulationModule')).toBe('decisions')
    await page.unroute('**/api/simulation.collections.list')
    await workspace.getByRole('navigation', { name: '仿真模块', exact: true }).getByRole('button', { name: '实体', exact: true }).click()
    await workspace.getByRole('table').getByText('原始实体', { exact: true }).waitFor()
    await step('disconnecting real WebSocket')
    blockReconnect = true
    await Promise.all(sockets.splice(0).map(socket => socket.close({ code: 1001, reason: 'Simulation read reconnect verification' })))
    await workspace.getByText('连接已断开，保留最后一次可读观察。', { exact: true }).waitFor()
    expect(await workspace.getByRole('table').getByText('原始实体', { exact: true }).count()).toBe(1)
    expect(await workspace.getByRole('button', { name: '刷新', exact: true }).isDisabled()).toBe(true)
    blockReconnect = false
    await expect.poll(() => workspace.getByText('连接已断开，保留最后一次可读观察。', { exact: true }).count(), { timeout: 15000 }).toBe(0)
    await expect.poll(() => workspace.getByRole('button', { name: '刷新', exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('table').getByText('原始实体', { exact: true }).waitFor()
    await step('disabling real Loader product entry')
    const entry = [...scaffold.ctx.loader.entries()].find(value => value.options.name === '@clocky/clocky-simulation-product')
    if (entry === undefined) throw new Error('Real Loader has no Simulation product entry')
    await entry.update({ disabled: true }); await scaffold.ctx.loader.await()
    await page.reload({ waitUntil: 'load' })
    await page.getByText('此主机未提供仿真查看。', { exact: true }).waitFor()
    expect(await page.getByRole('button', { name: '仿真', exact: true }).count()).toBe(0)
    await step('remounting real Loader product entry')
    await entry.update({ disabled: false }); await scaffold.ctx.loader.await()
    await page.reload({ waitUntil: 'load' })
    await workspace.getByRole('table').getByText('原始实体', { exact: true }).waitFor()
    expect(await workspace.count()).toBe(1)
    expect(await workspace.getByRole('navigation', { name: '仿真模块', exact: true }).count()).toBe(1)
    expect(run.snapshot()).toEqual(before)
    expect(open).not.toHaveBeenCalled()
    expect(await workspace.textContent()).not.toContain('never disclose this body')
    expect(errors.pageErrors).toEqual([])
    expect(errors.warnings.filter(value => !value.includes('connection lost, retry'))).toEqual([])
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    await writeFile(join(root, 'lifecycle-evidence.json'), JSON.stringify({ backend, url: page.url(), before, after: run.snapshot(),
      openCalls: open.mock.calls.length, requests, queries, errors, assertions: ['no read before handshake', 'old response does not replace selection',
        'retained stale read during disconnect', 'real Loader disable and remount', 'no second owner', 'no model catalog stream permitted'] }, null, 2) + '\n')
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), JSON.stringify({ body: await page.locator('body').innerText(), errors, requests }, null, 2))
    throw cause
  } finally {
    retiring = true; releaseOldRead(); describeRelease.resolve(undefined)
    await browser.close(); await run?.close(); await scaffold.close()
  }
}, 120000)
