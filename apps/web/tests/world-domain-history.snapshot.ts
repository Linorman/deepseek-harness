/** Browser plugin unavailable: completed real workflows supply nonempty votes, representation and contact history to read-only UI. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { z } from 'zod'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import { simulationProductWorldDomainResultSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import { simulationProductRunIdSchema } from '@clocky/clocky-simulation-product/schema'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it.each(['json', 'sqlite'].flatMap(backend => ['company', 'laboratory'].map(scene => ({ backend, scene }))))(
  'inspects $backend $scene completed original votes and simulated contacts without execution ownership', async ({ backend, scene }) => {
    const privacy = process.env.WORLD_DOMAIN_PRIVACY === 'true'
    const parent = resolve(privacy ? '.local/world-completion/u11-domain-privacy/browser' : '.local/world-completion/u05-domain-ui/history-browser')
    await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, `${backend}-${scene}-`))
    let seed = join(root, 'seed')
    const retained = process.env.WORLD_DOMAIN_HISTORY_SEEDS
    if (retained !== undefined) {
      const names = (await readdir(retained)).filter(name => name.startsWith(`src-${backend}-${scene}-`))
      expect(names).toHaveLength(1); seed = join(retained, names[0]!)
    } else {
      await mkdir(seed)
      const launch = resolveExampleLaunch({ mode: 'src', srcBin: resolve('examples/simulation-company/tests/complete-world-scenario.ts'),
        tsconfigPath: resolve('tsconfig.base.json'), configArgs: [resolve('examples/simulation-company/tests/fixtures/complete-world/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: seed, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          WORLD_COMPLETE_ROUND: '0', WORLD_COMPLETE_RECOVER: 'false', CLOCKY_EXAMPLE_MODE: 'src', TMPDIR: resolve('.local/world-completion/tmp') } })
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
      const finished = once(child, 'exit').then((values: unknown[]) => values); let stdout = '', stderr = ''
      child.stdout.on('data', (value: Buffer) => { stdout += value.toString() }); child.stderr.on('data', (value: Buffer) => { stderr += value.toString() })
      const timeout = setTimeout(() => child.kill('SIGKILL'), 120000)
      try { const [code, signal] = await finished; expect(signal).toBe(null); expect(code, stderr).toBe(0) }
      finally {
        clearTimeout(timeout); child.kill('SIGKILL')
        await writeFile(join(root, 'seed-process.json'), JSON.stringify({ command: launch.command, args: launch.args, stdout, stderr, pid: child.pid }))
      }
    }
    const saved: unknown = JSON.parse(await readFile(join(seed, retained === undefined ? 'round-0.json' : 'round-2.json'), 'utf8'))
    const original = z.object({ state: z.object({ spec: simulationRunSpecSchema, world: z.object({ external: z.object({
      contacts: z.record(z.string(), z.object({ identityId: z.string(), id: z.string() })) }) }) }) }).parse(saved).state
    const contact = Object.values(original.world.external.contacts)[0]; expect(contact).toBeDefined()
    const workspaceCwd = join(root, 'workspace'), persistenceRoot = join(root, 'sessions')
    await mkdir(workspaceCwd)
    await cp(join(seed, 'sessions'), persistenceRoot, { recursive: true })
    await cp(join(seed, 'simulation'), join(root, 'simulation'), { recursive: true })
    if (backend === 'json') await cp(join(seed, 'team-json'), join(workspaceCwd, '.clocky-storages'), { recursive: true })
    else await cp(join(seed, 'team.sqlite'), join(workspaceCwd, '.clocky-team-storage.sqlite'))
    const overlay = join(root, 'overlay.json')
    await writeFile(overlay, JSON.stringify([{ insert: [
      { name: '@clocky/clocky-simulation' },
      { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'simulation'), backend, replayPageSize: 4 } },
      { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
        maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
      { name: '@clocky/clocky-simulation-world/providers' },
      { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'history-domain-directory', imports: [{
        id: 'history-world', name: `Completed ${scene}`, provider: 'local', spec: original.spec, ownerPrincipalId: 'history-world-reader' }] } },
      { name: '@clocky/clocky-client-ui-simulation' },
    ] }, { id: 'storage-log', config: { backend } },
    { id: 'modules', config: { browserConfig: { '@clocky/clocky-client-ui-simulation': { pageSize: 1 } } } }]))
    const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
      productPrincipalId: 'history-world-reader', retainedWorld: { workspaceCwd, persistenceRoot, compression: 'none' } })
    let opens = 0, models = 0
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = (...args) => { opens++; return open(...args) }
    const removeModel = scaffold.ctx.on('llm/stream', () => { models++; throw new Error('History navigation attempted model inference') })
    const before = await scaffold.ctx.simulations.inspect({ provider: 'local', spec: original.spec })
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    const errors = watchConsole(page), consoleErrors: string[] = [], responses: unknown[] = []
    let revoke: (() => void) | undefined
    const releaseResponse = Promise.withResolvers<undefined>()
    page.on('console', (value) => { if (value.type() === 'error') consoleErrors.push(value.text()) })
    page.on('response', async (response) => {
      if (!response.url().endsWith('/api/simulation.world.domain.read')) return
      try {
        const raw: unknown = await response.json()
        const result = z.object({ result: z.object({ ok: z.literal(true),
          value: simulationProductWorldDomainResultSchema }) }).safeParse(raw)
        if (result.success) responses.push(result.data.result.value)
      } catch { /* Teardown retires pending HTTP bodies; only strictly admitted responses enter the proof. */ }
    })
    try {
      await scaffold.authenticateBrowserPage(page)
      const url = new URL(scaffold.baseUrl)
      for (const [key, value] of Object.entries({ workspace: 'simulation', simulation: 'history-world', simulationModule: 'external',
        simulationObject: contact!.identityId, simulationWorldSection: 'interactions' })) url.searchParams.set(key, value)
      await page.goto(url.href, { waitUntil: 'load' })
      const workspace = page.locator('[data-simulation-workspace-page]'), inspector = workspace.getByRole('complementary')
      await inspector.getByTitle('覆盖范围：identity/interactions', { exact: true }).first().waitFor()
      // The mediated ruling and subsequent actor contact share an intent. Page both originals instead of substituting one for the other.
      for (let step = 0; step < 8 && await inspector.getByText(/contact:committed/).count() === 0; step++) {
        const prior = await inspector.innerText()
        await inspector.getByRole('button', { name: '加载更多', exact: true }).click()
        await expect.poll(() => inspector.innerText()).not.toBe(prior)
      }
      await inspector.getByText(/contact:committed/).waitFor()
      await inspector.getByText(/reply-post:applied; publication:published; delivery:received/).waitFor()
      await inspector.locator('[data-ref-kind="decision"]').first().waitFor()
      await page.screenshot({ path: join(root, 'actual-contact.png'), animations: 'disabled' })
      await inspector.getByRole('tab', { name: '代表', exact: true }).click()
      await inspector.getByTitle('覆盖范围：identity/representatives', { exact: true }).first().waitFor()
      await inspector.getByText('Participant', { exact: true }).waitFor()
      await inspector.locator('[data-ref-kind="entity"]').first().waitFor()
      await workspace.getByRole('button', { name: '制度', exact: true }).first().click()
      const proposalRow = workspace.getByRole('table').locator('tbody tr').first()
      const proposalId = await proposalRow.getAttribute('data-row')
      await proposalRow.click()
      await inspector.getByRole('tab', { name: '投票与来源', exact: true }).click()
      await inspector.getByTitle('覆盖范围：proposal/votes', { exact: true }).first().waitFor()
      await inspector.locator('[data-ref-kind="decision"]').first().waitFor()
      if (privacy) {
        const proposal = Object.values(before?.snapshot.world?.governance.proposals ?? {}).find(value => value.id === proposalId)
        if (proposal === undefined || proposal.body.length === 0) throw new Error('Actual selected Native proposal has no protected body')
        const openBody = async () => {
          const disclosure = inspector.locator('details').filter({ hasText: '查看正文' })
          if (await disclosure.getAttribute('open') === null) await disclosure.locator('summary').click()
        }
        await openBody()
        await inspector.getByText('无权查看此内容', { exact: true }).waitFor()
        expect((await inspector.textContent())?.includes(proposal.body)).toBe(false)
        revoke = scaffold.ctx.simulationProducts.contextReaderRegistrar()([{ principalId: productPrincipalId('history-world-reader'),
          runId: simulationProductRunIdSchema.parse('history-world'), entityIds: [proposal.proposer], content: ['context'] }])
        await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
        await inspector.getByText(proposal.body, { exact: true }).waitFor({ state: 'attached' })
        await openBody()
        await inspector.getByText(proposal.body, { exact: true }).waitFor()
        const sessionId = before?.snapshot.entities[proposal.proposer]?.binding?.sessionId
        if (sessionId === undefined) throw new Error('Original proposer has no canonical Session binding')
        const session = await scaffold.authenticatedRpc('session.history', { sessionId })
        expect(session.result).toMatchObject({ ok: false, error: { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' } })
        await page.screenshot({ path: join(root, 'private-proposal-authorized.png'), animations: 'disabled' })
        const captured = Promise.withResolvers<undefined>()
        let holdNext = true
        await page.route('**/api/simulation.world.domain.read', async (route) => {
          const input = z.object({ payload: z.object({ kind: z.string() }) }).parse(route.request().postDataJSON()).payload
          if (!holdNext || input.kind !== 'proposal') { await route.continue(); return }
          holdNext = false
          const response = await route.fetch(), body: unknown = await response.json()
          const value = z.object({ result: z.object({ ok: z.literal(true), value: simulationProductWorldDomainResultSchema }) })
            .parse(body).result.value
          if (value.kind !== 'proposal' || value.value?.body.state !== 'allowed' || value.value.body.value.text !== proposal.body)
            throw new Error('Late response lacks its actual independently authorized proposal body')
          await writeFile(join(root, 'authorized-late-response.json'), JSON.stringify(body))
          captured.resolve(undefined); await releaseResponse.promise
          try { await route.fulfill({ response }) }
          catch { /* Revocation retires the browser read before this genuine old-policy body can be delivered. */ }
        })
        await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
        await captured.promise
        revoke(); revoke = undefined
        await expect.poll(async () => (await inspector.textContent())?.includes(proposal.body) ?? false, { timeout: 10000 }).toBe(false)
        releaseResponse.resolve(undefined); await page.unrouteAll({ behavior: 'wait' })
        await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
        await inspector.getByText('无权查看此内容', { exact: true }).waitFor({ state: 'attached' })
        await openBody()
        await inspector.getByText('无权查看此内容', { exact: true }).waitFor()
        expect((await inspector.textContent())?.includes(proposal.body)).toBe(false)
        await page.screenshot({ path: join(root, 'private-proposal-revoked.png'), animations: 'disabled' })
        await page.context().setOffline(true)
        await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
        await workspace.getByText('数据可能已过时 · 刷新', { exact: true }).first().waitFor()
        expect((await workspace.textContent())?.includes(proposal.id)).toBe(true)
        expect((await inspector.textContent())?.includes(proposal.body)).toBe(false)
        await page.screenshot({ path: join(root, 'private-proposal-offline.png'), animations: 'disabled' })
        await page.context().setOffline(false)
        await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
        await inspector.getByText('无权查看此内容', { exact: true }).waitFor({ state: 'attached' })
        await openBody()
        await inspector.getByText('无权查看此内容', { exact: true }).waitFor()
        expect((await inspector.textContent())?.includes(proposal.body)).toBe(false)
        await writeFile(join(root, 'privacy-proof.json'), JSON.stringify({ backend, scene, proposalId: proposal.id,
          bodyHash: proposal.bodyHash, authorizedPaint: true, liveRevocation: true, genuineLateBodyDiscarded: true,
          sessionStillForbidden: true, offlineMetadataRetained: true, staleRefresh: true, noNativeMutation: true }, null, 2))
      }
      expect(await scaffold.ctx.simulations.inspect({ provider: 'local', spec: original.spec })).toEqual(before)
      expect(opens).toBe(0); expect(models).toBe(0)
      expect(errors.pageErrors).toEqual([])
      expect(privacy ? consoleErrors.filter(value => value !== 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED')
        : consoleErrors).toEqual([])
      await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, scene, seed, responses, noWritableOpen: true,
        noInference: true, actualCompletedHistory: true, consoleErrors,
        browser: 'Browser plugin unavailable; project Playwright' }, null, 2))
    } catch (error) {
      await page.screenshot({ path: join(root, 'failure.png') })
      await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText()); throw error
    } finally {
      revoke?.(); releaseResponse.resolve(undefined); removeModel()
      await page.unrouteAll({ behavior: 'wait' }); await browser.close(); await scaffold.close()
    }
  })
