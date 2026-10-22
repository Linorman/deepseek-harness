/** Browser plugin unavailable: Playwright reads real composite-governance records through authenticated HTTP. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { z } from 'zod'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import '@clocky/clocky-simulation-product'
import { simulationRunSpecSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import { simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldDomainResultSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it.each(['json', 'sqlite'] as const)('previews %s actual composite institution impact with independent disclosure and source provenance', async (backend) => {
  const parent = resolve('.local/world-post-mvp/a19-browser')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, `${backend}-`)), seed = join(root, 'seed')
  await mkdir(seed)
  const launch = resolveExampleLaunch({ mode: 'src', srcBin: resolve('examples/simulation-company/tests/world-post-mvp-governance-browser-seed.ts'),
    tsconfigPath: resolve('tsconfig.base.json'), configArgs: [resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: seed, SIMULATION_COMPANY_BACKEND: backend, TMPDIR: resolve('.tmp/world-post-mvp') } })
  const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const exited = once(child, 'exit'); let stderr = ''
  child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000)
  try {
    const message = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(stderr) })])
    expect(message[0]).toBe('ready')
  } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited; await writeFile(join(root, 'seed.stderr.log'), stderr) }
  const proof = z.object({ spec: simulationRunSpecSchema, proposalId: z.string(), proposer: z.string(), scopeId: z.string(),
    requestId: z.string(), revision: z.number(), routeId: z.string(), source: z.object({ decisionId: z.string() }) }).parse(JSON.parse(await readFile(join(seed, 'browser-proof.json'), 'utf8')))
  await cp(join(seed, 'simulation'), join(root, 'simulation'), { recursive: true })
  const overlay = join(root, 'overlay.json'), principal = 'governance-browser-reader'
  await writeFile(overlay, JSON.stringify([{ insert: [
    { name: '@clocky/clocky-simulation' },
    { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'simulation'), backend, replayPageSize: 8 } },
    { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'a19-governance', imports: [{
      id: 'governance', name: '实际组合审批', provider: 'local', spec: proof.spec, ownerPrincipalId: principal }] } },
    { name: '@clocky/clocky-client-ui-simulation' },
  ] }, { id: 'modules', config: { browserConfig: { '@clocky/clocky-client-ui-simulation': { pageSize: 20 } } } }]))
  const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
    productPrincipalId: principal, retainedWorld: { workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions') } })
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(10000)
  const errors = watchConsole(page), responses: unknown[] = [], consoleErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  let opens = 0, models = 0
  const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
  scaffold.ctx.simulations.open = (...args) => { opens++; return open(...args) }
  const stopModels = scaffold.ctx.on('llm/stream', () => { models++; throw new Error('Read-only impact attempted inference') })
  const runId = simulationProductRunIdSchema.parse('governance'), principalId = productPrincipalId(principal)
  let revokeContext: (() => void) | undefined, revokeCase: (() => void) | undefined
  page.on('response', async (response) => {
    if (!response.url().endsWith('/api/simulation.world.domain.read')) return
    try {
      const parsed = z.object({ result: z.object({ ok: z.literal(true), value: simulationProductWorldDomainResultSchema }) })
        .safeParse(await response.json())
      if (parsed.success) responses.push(parsed.data.result.value)
    } catch { /* Browser shutdown cancels in-flight read responses; only complete parsed receipts are evidence. */ }
  })
  const impact = () => responses.flatMap((raw) => {
    const result = simulationProductWorldDomainResultSchema.parse(raw)
    return result.kind === 'proposal' && result.value?.normImpact !== undefined ? [result.value] : []
  }).at(-1)
  const workspace = page.locator('[data-simulation-workspace-page]'), inspector = workspace.getByRole('complementary')
  try {
    await scaffold.authenticateBrowserPage(page)
    const url = new URL(scaffold.baseUrl)
    for (const [key, value] of Object.entries({ workspace: 'simulation', simulation: 'governance', simulationModule: 'governance',
      simulationObject: proof.proposalId, simulationWorldSection: 'record' })) url.searchParams.set(key, value)
    await page.goto(url.href, { waitUntil: 'load' })
    await inspector.getByRole('button', { name: '预览制度影响', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('simulationWorldSection')).toBe('impact')
    await inspector.getByRole('status').filter({ hasText: '无权查看此内容' }).first().waitFor()
    await page.screenshot({ path: join(root, '00-withheld.png') })
    revokeContext = scaffold.ctx.simulationProducts.contextReaderRegistrar()([{ principalId, runId,
      entityIds: [simulationEntityIdSchema.parse(proof.proposer)], content: ['context'] }, { principalId, runId, entityIds: [simulationEntityIdSchema.parse(proof.scopeId)], content: ['knowledge'] }])
    await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
    await inspector.getByLabel('生效模拟时间', { exact: true }).waitFor()
    await inspector.getByRole('status').filter({ hasText: '无权查看此内容' }).first().waitFor()
    expect(await inspector.getByText(proof.requestId, { exact: false }).count()).toBe(0)
    expect(impact()).toMatchObject({ normImpact: { state: 'withheld' }, normImpactInput: { state: 'allowed' } })
    await page.screenshot({ path: join(root, '01-case-withheld.png') })
    revokeCase = scaffold.ctx.simulationProducts.caseReaderRegistrar()([{ principalId, runId, content: ['case'] }])
    await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
    await inspector.getByText(`world-case · ${proof.requestId}`, { exact: true }).waitFor()
    await inspector.locator('[data-ref-kind="decision"]').first().waitFor()
    expect(impact()).toMatchObject({ normImpact: { state: 'allowed' } })
    await page.screenshot({ path: join(root, '02-authorized-impact.png') })
    revokeCase(); revokeCase = undefined
    await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
    await expect.poll(() => inspector.getByText(`world-case · ${proof.requestId}`, { exact: true }).count()).toBe(0)
    await inspector.locator('[data-ref-kind="decision"]').first().click()
    await expect.poll(() => new URL(page.url()).searchParams.get('simulationObject')).toBe(proof.source.decisionId)
    await expect.poll(() => new URL(page.url()).searchParams.get('simulationModule')).toBe('decisions')
    await page.screenshot({ path: join(root, '03-original-decision.png') })
    const inspected = await scaffold.ctx.simulations.inspect({ provider: 'local', spec: proof.spec })
    expect(inspected?.snapshot.revision).toBe(proof.revision)
    expect(opens).toBe(0); expect(models).toBe(0)
    expect(errors.pageErrors).toEqual([]); expect(errors.warnings).toEqual([]); expect(consoleErrors).toEqual([])
    await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, seed: proof, responses, opens, models, errors, consoleErrors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText()); throw error
  }
  finally { revokeContext?.(); revokeCase?.(); stopModels(); await browser.close(); await scaffold.close() }
}, 90000)
