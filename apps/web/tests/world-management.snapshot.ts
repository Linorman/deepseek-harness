/** Browser plugin unavailable: real Web/Loader/Product/Native user management with project Playwright and no model calls. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import { worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import { simulationProductWorldManagementPreviewSchema, simulationProductWorldManagementSubmitInputSchema } from '@clocky/clocky-simulation-product/world-management-schema'
import { definition as originalDefinition, deployment } from '../../../examples/simulation-company/tests/fixtures/complete-world/source.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

const member = originalDefinition.entities.find(value => value.kind === 'person' && value.cognition === 'agent' && value.id === 'hr')
if (member?.kind !== 'person' || member.cognition !== 'agent') throw new Error('Original installed personnel template is absent')
const definition = worldScenarioV1Schema.parse({ ...originalDefinition,
  domains: [...originalDefinition.domains, { domain: 'organization', operation: 'hire-existing', version: '1' }],
  entities: [...originalDefinition.entities, { ...member, id: 'management-person',
    description: 'An independent initial member with no resource control or committee duties.' }],
  organization: { ...originalDefinition.organization,
    positions: [...originalDefinition.organization.positions, { id: 'management-position', name: 'Independent role',
      description: 'An initial role without inherited operation permissions.', unitId: originalDefinition.organization.rootId,
      capacity: 1, permissions: [] }],
    assignments: [...originalDefinition.organization.assignments, { id: 'management-assignment', personId: 'management-person',
      positionId: 'management-position', validFrom: '0', validUntil: null }],
    grants: [...originalDefinition.organization.grants, { id: 'management-eligibility', personId: 'management-person',
      domain: 'organization', operation: 'hire-existing', version: '1', scopeId: originalDefinition.organization.rootId,
      targetId: originalDefinition.organization.rootId, relation: 'eligible-for-hire', validFrom: '0', validUntil: null }],
  }, behavior: { initialGoals: [], calendars: [], directorEvents: [] } })
const scenarios = ['json', 'sqlite'].flatMap(backend => [
  ...(['transfer', 'depart', 'hire-existing'] as const).map(action => ({ backend, action, fault: 'none' as const })),
  { backend, action: 'transfer' as const, fault: 'lost-ack' as const },
  { backend, action: 'hire-existing' as const, fault: 'missing-execution' as const },
  { backend, action: 'transfer' as const, fault: 'handoff' as const },
  { backend, action: 'depart' as const, fault: 'retirement' as const },
])
it.each(scenarios)(
  'confirms one actual authenticated $backend $action through the original three-step form ($fault)', async ({ backend, action, fault }) => {
    const parent = resolve(fault === 'none' ? '.local/world-completion/u07-product/browser'
      : fault === 'lost-ack' ? '.local/world-completion/u08-originals/browser' : '.local/world-completion/u10-actionable/browser')
    await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, `${backend}-${action}-`))
    const overlay = join(root, 'overlay.json')
    let authored = action !== 'hire-existing' ? definition : worldScenarioV1Schema.parse({ ...definition,
      organization: { ...definition.organization,
        assignments: definition.organization.assignments.filter(value => value.personId !== 'management-person') } })
    if (fault === 'handoff') authored = worldScenarioV1Schema.parse({ ...authored, resources: [...authored.resources,
      { id: 'independent-management-resource', owner: authored.organization.rootId, kind: 'money', unit: 'credit',
        quantity: '10', controllers: ['management-person'] }] })
    await writeFile(overlay, JSON.stringify([{ insert: [
      { name: '@clocky/clocky-simulation' },
      { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
      { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
        maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
      ...fault === 'missing-execution' ? [] : [{ name: '@clocky/clocky-simulation-world/providers' }],
      { name: '@clocky/clocky-tool-simulation' },
      { name: resolve('examples/simulation-company/tests/fixtures/complete-world/model.ts') },
      { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'management-browser-directory', imports: [] } },
      { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'management-browser-commands', templates: [],
        world: { provider: 'local', catalog: deployment, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 },
          authoringTemplates: [{ id: 'management-world', version: '1', name: '人员管理', definition: authored }] },
        driverIntervalMs: 5, driverRetryMs: 10 } },
      { name: '@clocky/clocky-client-ui-simulation' },
    ] }, { id: 'storage-log', config: { backend } },
    { id: 'modules', config: { browserConfig: { '@clocky/clocky-client-ui-simulation': { pageSize: 32, controlRefreshMs: 50 } } } }]))
    const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
      productPrincipalId: 'management-browser-user', retainedWorld: { workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions') },
      agentPresets: { default: 'simulation', roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' }] } })
    let owned: SimulationRun | undefined, opens = 0, models = 0, providerCalls = 0, retirementStopping = false
    const enteredProvider = Promise.withResolvers<undefined>(), releaseProvider = Promise.withResolvers<undefined>()
    if (fault === 'lost-ack') {
      const attach = scaffold.ctx.simulationTeams.attach.bind(scaffold.ctx.simulationTeams)
      scaffold.ctx.simulationTeams.attach = async (...args) => {
        const connection = await attach(...args), commit = connection.commitPersonnel.bind(connection)
        connection.commitPersonnel = async (...input) => {
          providerCalls++; enteredProvider.resolve(undefined); await releaseProvider.promise
          return await commit(...input)
        }
        return connection
      }
    }
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => { opens++; owned = await open(...args); return owned }
    const removeModel = scaffold.ctx.on('llm/stream', () => { models++; throw new Error('User management attempted inference') })
    const previewManagement = scaffold.ctx.simulationAdministration.previewWorldManagement.bind(scaffold.ctx.simulationAdministration)
    scaffold.ctx.simulationAdministration.previewWorldManagement = async (...args) => {
      try { return await previewManagement(...args) }
      catch (cause: unknown) {
        await writeFile(join(root, 'preview-error.txt'), String(cause instanceof Error ? cause.stack : cause) + '\n')
        throw cause
      }
    }
    const submitManagement = scaffold.ctx.simulationAdministration.submitWorldManagement.bind(scaffold.ctx.simulationAdministration)
    const ownerInputs: unknown[] = []
    scaffold.ctx.simulationAdministration.submitWorldManagement = async (...args) => {
      ownerInputs.push(args[0])
      try { return await submitManagement(...args) }
      catch (cause: unknown) {
        await writeFile(join(root, 'submit-error.txt'), String(cause instanceof Error ? cause.stack : cause) + '\n')
        throw cause
      }
    }
    const browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    const page = await context.newPage()
    const caught: unknown[] = []
    if (process.env.WORLD_MANAGEMENT_DIAGNOSTICS === 'true') {
      const debug = await page.context().newCDPSession(page)
      await debug.send('Debugger.enable'); await debug.send('Debugger.setPauseOnExceptions', { state: 'all' })
      debug.on('Debugger.paused', (event) => {
        void (async () => {
          caught.push({ reason: event.reason, data: event.data,
            frames: event.callFrames.map(frame => ({ functionName: frame.functionName, url: frame.url, location: frame.location })) })
          try { await debug.send('Debugger.resume') }
          catch { /* Teardown can close a paused diagnostic session after its exception was retained. */ }
        })()
      })
    }
    page.setDefaultTimeout(10000)
    const errors = watchConsole(page), consoleErrors: string[] = [], previews: unknown[] = []
    const submissions: unknown[] = [], retries: unknown[] = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.context().on('request', (request) => {
      if (request.url().endsWith('/api/simulation.world.management.submit')) submissions.push(request.postDataJSON())
      if (request.url().endsWith('/api/simulation.requests.retry')) retries.push(request.postDataJSON())
    })
    page.on('response', async (response) => {
      if (response.url().endsWith('/api/simulation.world.management.submit')) {
        try { await writeFile(join(root, 'submit-response.json'), await response.text()) }
        catch { /* Browser teardown may close a pending response; confirmed receipts are retained in the final proof. */ }
      }
      if (!response.url().endsWith('/api/simulation.world.management.preview')) return
      try { previews.push(await response.json()) }
      catch { /* Browser teardown can retire a pending response; final proof uses only strict admitted quotes. */ }
    })
    try {
      if (fault === 'lost-ack') {
        await page.addInitScript(() => {
          const send = globalThis.fetch.bind(globalThis)
          let delayed = false
          globalThis.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
            if (delayed || !url.endsWith('/api/simulation.world.management.submit')) return send(input, init)
            delayed = true
            const original = init?.signal ?? (input instanceof Request ? input.signal : undefined)
            const deadline = AbortSignal.timeout(500)
            return send(input, { ...init, signal: original == null ? deadline : AbortSignal.any([original, deadline]) })
          }
        })
        await page.route('**/api/simulation.world.management.submit', async (route) => {
          const response = await route.fetch()
          await writeFile(join(root, 'accepted-lost-response.json'), await response.text())
          await new Promise(done => setTimeout(done, 750))
          try { await route.fulfill({ response }) }
          catch { /* The real browser deadline retired this original response; Native admission remains owned. */ }
        })
      }
      await scaffold.authenticateBrowserPage(page); await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '仿真', exact: true }).click()
      const workspace = page.locator('[data-simulation-workspace-page]')
      await workspace.locator('header').getByRole('button', { name: '新建世界', exact: true }).first().click()
      await page.getByRole('dialog', { name: '新建世界', exact: true }).getByRole('button', { name: '人员管理', exact: false }).click()
      await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
      await expect.poll(() => workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isEnabled()).toBe(true)
      await workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).click()
      const create = page.getByRole('dialog', { name: '创建暂停运行', exact: true })
      await create.getByLabel('运行名', { exact: true }).fill(`Management ${backend} ${action}`)
      await create.getByRole('button', { name: '创建暂停运行', exact: true }).click()
      await workspace.getByRole('button', { name: '打开运行', exact: true }).click()
      await expect.poll(() => owned?.snapshot().latestCheckpointId !== undefined, { timeout: 10000 }).toBe(true)
      const run = owned!
      if (fault === 'missing-execution') {
        const original = run.snapshot(), originalOpens = opens
        expect(scaffold.ctx.get('simulationWorldExecutions')).toBeUndefined()
        await workspace.getByText('原执行 provider 或模型路由不可用。请在部署中恢复声明的版本，再刷新调度状态。', { exact: true }).waitFor()
        expect(await workspace.getByRole('button', { name: '开始调度', exact: true }).isDisabled()).toBe(true)
        await page.screenshot({ path: join(root, 'missing-provider.png'), fullPage: true })
        await scaffold.ctx.loader.create({ name: '@clocky/clocky-simulation-world/providers' })
        await scaffold.ctx.loader.await()
        try { scaffold.ctx.simulationWorldExecutions.retain(run.snapshot(), scaffold.ctx.simulations.domains('local'))() }
        catch (cause: unknown) {
          await writeFile(join(root, 'provider-install-error.txt'), String(cause instanceof Error ? cause.stack : cause))
          throw cause
        }
        await workspace.locator('[data-simulation-maintenance] summary').click()
        await workspace.getByRole('button', { name: '刷新控制状态', exact: true }).click()
        await expect.poll(() => workspace.getByRole('button', { name: '开始调度', exact: true }).isEnabled()).toBe(true)
        expect(run.snapshot()).toEqual(original); expect(opens).toBe(originalOpens); expect(models).toBe(0)
        await writeFile(join(root, 'provider-recovery-proof.json'), JSON.stringify({ backend,
          original, after: run.snapshot(), newOpens: opens - originalOpens, models,
          originalVersionReinstalled: true, startDisabledBefore: true, startEnabledAfter: true }, null, 2))
      }
      // Explicit trusted fixture clock only: the empty behavior contains no goals/calendars or model work.
      await run.setPhase('running', run.snapshot().revision)
      expect((await run.drive({ until: simTimeSchema.parse('2') })).reason).toBe('until')
      await run.setPhase('paused', run.snapshot().revision)
      if (fault === 'retirement') {
        const source = run.snapshot(), resident = Object.values(source.entities).find(value => value.id === 'management-person')!
        const binding = resident.binding
        if (binding === undefined) throw new Error('Original managed person has no canonical binding')
        const runtime = scaffold.ctx.agentRuntimes.getProvider('in-process')
        if (runtime === undefined) throw new Error('Original in-process runtime is absent')
        const activate = runtime.activate.bind(runtime)
        runtime.activate = async (...input) => {
          const handle = await activate(...input), dispose = handle.dispose.bind(handle)
          let stopping: Promise<void> | undefined
          handle.dispose = (...args) => stopping ??= (async () => {
            retirementStopping = true; enteredProvider.resolve(undefined); await releaseProvider.promise; await dispose(...args)
          })()
          return handle
        }
        // Instrument the actual product owner's sole connection; a second attach would correctly refuse ownership.
        const held: unknown = Reflect.get(scaffold.ctx.simulationAdministration, 'held')
        if (!(held instanceof Map)) throw new Error('Original administration ownership map is absent')
        const live: unknown = [...held.values()].find(value => value !== null && typeof value === 'object' && Reflect.get(value, 'run') === run)
        const owner: unknown = live !== null && typeof live === 'object' ? Reflect.get(live, 'owner') : undefined
        if (owner === null || typeof owner !== 'object') throw new Error('Original World owner is absent')
        const attach: unknown = Reflect.get(owner, 'attach')
        if (typeof attach !== 'function') throw new Error('Original owner cannot attach')
        await Reflect.apply(attach, owner, [])
        const connection = z.custom<SimulationTeamConnection>(value => value !== null && typeof value === 'object'
          && typeof Reflect.get(value, 'ensureResident') === 'function').parse(Reflect.get(owner, 'connection'))
        const active = await connection.ensureResident(resident.id, { activation: { provider: 'in-process',
          seed: { kind: 'fresh' }, agent: { preset: 'simulation', options: { provider: 'complete-world-scripted', model: 'world' } },
          signal: new AbortController().signal }, evict: [] })
        expect(active.status).toBe('resident'); expect(run.population().chargedActors).toBe(1); expect(models).toBe(0)
      }
      const before = run.snapshot(), beforeOpens = opens
      const assignment = Object.values(before.relations).find(value => value.relation === 'assignment' && value.subject === 'management-person')
      const person = Object.values(before.entities).find(value => value.id === 'management-person')
      if (person === undefined) throw new Error('Original authored management person is absent from Native')
      const name = action === 'transfer' ? '调岗' : action === 'depart' ? '离职' : '录用已有人物'
      await workspace.getByRole('button', { name: '组织', exact: true }).first().click()
      await workspace.getByRole('radio', { name: '人员', exact: true }).click()
      await workspace.locator(`tr[data-row="${person.id}"]`).click()
      const inspector = workspace.getByRole('complementary')
      await inspector.getByRole('tab', { name: '操作', exact: true }).click()
      await inspector.getByRole('button', { name, exact: true }).click()
      const dialog = page.getByRole('dialog', { name, exact: true })
      if (action !== 'hire-existing') {
        expect(assignment).toBeDefined()
        await dialog.locator(`input[type="radio"][value="${assignment!.id}"]`).check()
        await dialog.getByRole('radio', { name: '下一安全边界', exact: true }).check()
      }
      if (action !== 'depart') await dialog.locator('input[type="radio"][value="followup-position"]').check()
      else await dialog.getByRole('radio', { name: fault === 'retirement' ? '确认责任结清后退休' : '保留独立活动', exact: true }).check()
      await dialog.getByLabel('原因', { exact: false }).fill('真实用户通过界面确认的原人员管理意图')
      await dialog.getByRole('button', { name: '预览影响', exact: true }).click()
      if (fault === 'handoff') {
        await dialog.getByText('需先清偿原职责，再离职', { exact: true }).waitFor()
        await dialog.getByRole('button', { name: '查看原义务', exact: true }).click()
        await inspector.getByRole('tab', { name: '义务', exact: true }).waitFor()
        expect(await inspector.getByRole('tab', { name: '义务', exact: true }).getAttribute('aria-selected')).toBe('true')
        const reference = inspector.locator('details').filter({ hasText: 'independent-management-resource' })
        await reference.locator('summary').click(); await reference.locator('pre').waitFor()
        expect(run.snapshot()).toEqual(before); expect(submissions).toEqual([]); expect(opens).toBe(beforeOpens); expect(models).toBe(0)
        expect(errors.pageErrors).toEqual([]); expect(consoleErrors).toEqual([])
        await page.screenshot({ path: join(root, 'handoff-obligations.png'), fullPage: true })
        await writeFile(join(root, 'handoff-proof.json'), JSON.stringify({ backend, before, after: run.snapshot(),
          quotes: previews, nativeResourceId: 'independent-management-resource', originalObligationsOpened: true,
          submissions, modelCalls: models, newOpens: opens - beforeOpens }, null, 2))
        return
      }
      await dialog.getByText('这是已认证用户的干预。保留原身份与 Session 历史；调度保持暂停，过程不调用模型。', { exact: true }).waitFor()
      await expect.poll(() => dialog.getByRole('button', { name: '提交原命令', exact: true }).isEnabled()).toBe(true)
      expect(run.snapshot()).toEqual(before); expect(submissions).toEqual([]); expect(models).toBe(0)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.emulateMedia({ colorScheme: width === 390 ? 'dark' : 'light', reducedMotion: 'reduce' })
        await page.screenshot({ path: join(root, `preview-${width}.png`), fullPage: true })
      }
      if (fault === 'lost-ack') {
        await dialog.getByRole('button', { name: '返回', exact: true }).click()
        expect(await dialog.getByLabel('原因', { exact: false }).inputValue()).toBe('真实用户通过界面确认的原人员管理意图')
        await dialog.getByRole('button', { name: '预览影响', exact: true }).click()
        await expect.poll(() => dialog.getByRole('button', { name: '提交原命令', exact: true }).isEnabled()).toBe(true)
        expect(run.snapshot()).toEqual(before); expect(submissions).toEqual([])
        await dialog.getByRole('button', { name: '提交原命令', exact: true }).dblclick()
        await enteredProvider.promise
        const original = dialog.getByRole('region', { name: '原操作', exact: true })
        await expect.poll(() => original.getAttribute('data-outcome-unknown')).toBe('true')
        expect(await original.getByRole('button', { name: '重试原操作', exact: true }).count()).toBe(0)
        const submitted = z.object({ payload: simulationProductWorldManagementSubmitInputSchema }).parse(submissions[0]).payload
        const pending = run.snapshot()
        expect(submissions).toHaveLength(1); expect(Object.keys(pending.world!.requests)).toHaveLength(1)
        expect(Object.keys(pending.world!.results)).toHaveLength(0); expect(providerCalls).toBe(1)
        await page.screenshot({ path: join(root, 'unknown-before-reload.png'), fullPage: true })
        await context.setOffline(true)
        await original.getByText(submitted.commandId, { exact: true }).waitFor()
        expect(await original.getAttribute('data-outcome-unknown')).toBe('true')
        expect(run.snapshot()).toEqual(pending); expect(submissions).toHaveLength(1)
        await page.screenshot({ path: join(root, 'unknown-offline-retained.png'), fullPage: true })
        await context.setOffline(false)
        await page.reload({ waitUntil: 'load' })
        await workspace.getByRole('heading', { name: `Management ${backend} ${action}`, exact: true }).waitFor()
        await workspace.getByRole('button', { name: '仿真模块: 组织', exact: true }).click()
        await page.getByRole('menuitem', { name: '请求记录', exact: true }).click()
        const row = workspace.locator(`li[data-simulation-request="${submitted.commandId}"]`)
        await row.getByRole('button', { name: '查询持久原请求', exact: true }).click()
        await row.getByRole('button', { name: '检查原事项', exact: true }).waitFor()
        await row.getByRole('button', { name: '重试原操作', exact: true }).dblclick()
        await expect.poll(() => retries.length).toBe(1)
        await row.getByRole('button', { name: '查询原结果', exact: true }).click()
        await row.getByRole('button', { name: '检查原事项', exact: true }).click()
        await workspace.getByRole('complementary').waitFor()
        await page.goBack({ waitUntil: 'load' })
        await row.waitFor()
        const second = await page.context().newPage(), secondErrors = watchConsole(second)
        try {
          await second.goto(page.url(), { waitUntil: 'load' })
          const otherRow = second.locator(`li[data-simulation-request="${submitted.commandId}"]`)
          await otherRow.getByRole('button', { name: '查询持久原请求', exact: true }).click()
          await otherRow.getByRole('button', { name: '重试原操作', exact: true }).dblclick()
          await expect.poll(() => retries.length).toBe(2)
          expect(secondErrors.pageErrors).toEqual([])
        } finally { await second.close() }
        expect(run.snapshot()).toEqual(pending); expect(providerCalls).toBe(1); expect(ownerInputs).toHaveLength(3)
        expect(ownerInputs.every(value => JSON.stringify(value) === JSON.stringify(submitted))).toBe(true)
        releaseProvider.resolve(undefined)
        await expect.poll(() => Object.keys(run.snapshot().world!.results).length, { timeout: 10000 }).toBe(1)
        const after = run.snapshot()
        await row.getByRole('button', { name: '查询原结果', exact: true }).click()
        await row.getByRole('button', { name: '检查原事项', exact: true }).click()
        const detail = workspace.getByRole('complementary')
        await detail.getByRole('heading', { name: '业务结果', exact: true }).scrollIntoViewIfNeeded()
        await detail.getByText('结果已记录', { exact: true }).waitFor()
        expect(run.snapshot()).toEqual(after); expect(after.phase).toBe('paused')
        expect(after.decisions).toEqual(before.decisions); expect(after.operations).toEqual(before.operations)
        expect(after.entities[person.id]?.binding).toEqual(person.binding)
        expect(after.entities[person.id]?.profile).toEqual(person.profile)
        expect(submissions).toHaveLength(1); expect(opens).toBe(beforeOpens); expect(models).toBe(0)
        expect(errors.pageErrors).toEqual([])
        expect(consoleErrors.filter(value => value !== 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED')).toEqual([])
        await page.screenshot({ path: join(root, 'original-after-recovery.png'), fullPage: true })
        await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, action, fault, before, pending, after, submitted,
          submissions, retries, ownerInputs, providerCalls, models, opens: opens - beforeOpens, consoleErrors,
          offlineOriginalRetained: true, unknownReload: true, queryBeforeRetry: true, browserBack: true, secondTab: true }, null, 2))
        return
      }
      await dialog.getByRole('button', { name: '提交原命令', exact: true }).click()
      if (fault === 'retirement') {
        await expect.poll(() => retirementStopping, { timeout: 10000 }).toBe(true)
        await expect.poll(() => run.snapshot().entities[person.id]?.writer?.phase).toBe('revoked')
        const held = run.snapshot()
        expect(run.population().chargedActors).toBe(1); expect(Object.values(held.world!.results)).toHaveLength(0)
        await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
        await inspector.getByRole('tab', { name: '身份', exact: true }).click()
        await inspector.getByText('退休未确认，容量仍占用', { exact: true }).first().waitFor()
        await inspector.getByRole('button', { name: '查看原义务', exact: true }).click()
        expect(await inspector.getByRole('tab', { name: '义务', exact: true }).getAttribute('aria-selected')).toBe('true')
        expect(run.snapshot()).toEqual(held); expect(run.population().chargedActors).toBe(1)
        expect(models).toBe(0); expect(opens).toBe(beforeOpens)
        expect(errors.pageErrors).toEqual([]); expect(consoleErrors).toEqual([])
        await page.screenshot({ path: join(root, 'retirement-unconfirmed.png'), fullPage: true })
        await writeFile(join(root, 'retirement-proof.json'), JSON.stringify({ backend, before, held, after: run.snapshot(),
          chargedActors: run.population().chargedActors, modelCalls: models, newOpens: opens - beforeOpens,
          rawControllerStopHeld: true, originalWriterRetained: true, obligationsOpened: true }, null, 2))
        return
      }
      await expect.poll(() => Object.keys(run.snapshot().world!.results).length).toBe(1)
      await dialog.getByText('原命令已保留。关闭弹窗不会丢失，可在请求历史中随时找回。', { exact: true }).waitFor()
      await dialog.getByRole('button', { name: '查询原结果', exact: true }).click()
      await dialog.getByRole('button', { name: '检查原事项', exact: true }).waitFor()
      const after = run.snapshot(), command = Object.values(after.world!.requests)[0]!
      expect(command).toMatchObject({ operationId: null, requesterEntityId: null,
        source: { kind: 'authenticated-user', principalId: 'management-browser-user' } })
      expect(after.entities[person.id]?.binding).toEqual(person.binding); expect(after.entities[person.id]?.profile).toEqual(person.profile)
      expect(after.decisions).toEqual(before.decisions); expect(after.operations).toEqual(before.operations)
      expect(after.phase).toBe('paused'); expect(opens).toBe(beforeOpens); expect(models).toBe(0)
      expect(await scaffold.ctx.sessionPersistence.list()).toEqual([])
      expect(submissions).toHaveLength(1)
      const submitted = z.object({ payload: simulationProductWorldManagementSubmitInputSchema }).parse(submissions[0]).payload
      expect(command.source).toMatchObject({ commandId: submitted.commandId })
      const quotes = previews.flatMap((raw) => {
        const parsed = z.object({ result: z.object({ ok: z.literal(true), value: simulationProductWorldManagementPreviewSchema }) })
          .safeParse(raw)
        return parsed.success ? [parsed.data.result.value] : []
      })
      expect(quotes).toHaveLength(1); expect(quotes[0]!.previewHash).toBe(submitted.previewHash)
      await page.screenshot({ path: join(root, 'original.png'), fullPage: true })
      await dialog.getByRole('button', { name: '检查原事项', exact: true }).click()
      await expect.poll(() => dialog.count()).toBe(0)
      const detail = workspace.getByRole('complementary')
      // The inspector leads with the business title; the original ID is the compact copy control's full title.
      await detail.getByTitle(command.id, { exact: true }).first().waitFor()
      await detail.getByRole('heading', { name: '执行确认', exact: true }).waitFor()
      await page.screenshot({ path: join(root, 'original-case.png'), fullPage: true })
      await detail.getByRole('heading', { name: '业务结果', exact: true }).scrollIntoViewIfNeeded()
      await detail.getByText('结果已记录', { exact: true }).waitFor()
      await page.screenshot({ path: join(root, 'business-result.png'), fullPage: true })
      expect(run.snapshot()).toEqual(after); expect(opens).toBe(beforeOpens); expect(models).toBe(0)
      expect(errors.pageErrors).toEqual([]); expect(consoleErrors).toEqual([])
      await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, action, before, after, quotes, submitted,
        opens: opens - beforeOpens, models, browser: 'Browser plugin unavailable; project Playwright',
        fixtureClock: 'Explicit trusted empty-behavior advance to time 2 before all management reads' }, null, 2))
    } catch (cause: unknown) {
      await page.screenshot({ path: join(root, 'failure.png') })
      await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText())
      await writeFile(join(root, 'failure.json'), JSON.stringify({ error: String(cause), state: owned?.snapshot(), previews, submissions,
        caught }, null, 2))
      throw cause
    } finally {
      releaseProvider.resolve(undefined); removeModel()
      await page.unrouteAll({ behavior: 'wait' }); await browser.close(); await scaffold.close()
    }
  })
