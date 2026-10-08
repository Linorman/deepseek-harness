/** Real administrative admission, failure recovery and modal accessibility share the same immutable run identity. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { createNativeZoomContext } from './browser-native-zoom.ts'
import { showSimulationMaintenance, showSimulationRequests } from './simulation-browser-controls.ts'
import { simulationReadPresentation } from './simulation-read-presentation.ts'
import { adminDialogMatrix } from './simulation-admin-acceptance.ts'
import { teamAppearance, teamEvidence } from './team-acceptance-support.ts'
import { templateJSON } from '../../../examples/simulation-company/tests/sdk-product-template.ts'
import type {} from '../../../examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts'

it.each(['json', 'sqlite'] as const)('keeps initial-checkpoint and maintenance admission fenced with readable original outcomes (%s)', async (backend) => {
  const root = join(process.cwd(), '.tmp-simulation-plan/ae/admin-browser', backend)
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'run-'))
  const patches = JSON.parse(await readFile('examples/headless-agent/tests/fixtures/simulation/simulation-administration/cordis.yml', 'utf8')) as
    Array<{ insert?: Array<{ name: string; config?: Record<string, unknown> }> }>
  for (const entry of patches[0]!.insert!) {
    if (entry.name === '@clocky/clocky-simulation-local') entry.config = { ...entry.config, root: join(directory, 'world'), backend }
    if (entry.name.endsWith('/administration')) entry.config = { ...entry.config, templates: JSON.parse(templateJSON) as unknown[] }
    if (entry.name === './model.ts') entry.name = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts')
  }
  const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(patches))
  const scaffold = await launchWebScaffold({ tempRoot: directory, disableDefaultSimulation: true, extraOverlayPath: overlay, productPrincipalId: 'simulation-browser-user',
    agentPresets: { default: 'simulation', roots: [{ path: join(process.cwd(), 'examples/simulation-company/presets'), trust: 'system' }] } })
  const { context, setNativeZoom } = await createNativeZoomContext(root, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage(), errors = watchConsole(page), probe = scaffold.ctx.simulationBrowserProbe
  let creates = 0, inputs = 0
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path === '/api/simulation.runs.create') creates++
    if (path === '/api/simulation.ingress.create') inputs++
  })
  const initialEntered = Promise.withResolvers<undefined>(), initialRelease = Promise.withResolvers<undefined>()
  const collecting = Promise.withResolvers<undefined>(), collectRelease = Promise.withResolvers<undefined>()
  const nativeAttach = scaffold.ctx.simulationTeams.attach.bind(scaffold.ctx.simulationTeams)
  let gateInitial = true, gateCollection = false
  const attach = vi.spyOn(scaffold.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
    const connection: SimulationTeamConnection = await nativeAttach(...args)
    const checkpoint = connection.checkpoint.bind(connection)
    vi.spyOn(connection, 'checkpoint').mockImplementation(async (request) => {
      if (gateInitial && String(request.id).startsWith('product-initial/')) {
        gateInitial = false; initialEntered.resolve(undefined); await initialRelease.promise
      }
      if (gateCollection) { gateCollection = false; collecting.resolve(undefined); await collectRelease.promise }
      return checkpoint(request)
    })
    return connection
  })
  const workspace = page.locator('[data-simulation-workspace-page]')
  const refresh = async () => { await showSimulationMaintenance(workspace); await workspace.getByRole('button', { name: /^(刷新控制状态|Refresh controls)$/, exact: true }).click() }
  const openMaintenance = async (label: RegExp) => {
    await showSimulationMaintenance(workspace)
    await workspace.getByRole('button', { name: label, exact: true }).click()
    return page.getByRole('dialog', { name: label, exact: true })
  }
  let runId = ''
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    await workspace.locator('header').getByRole('button', { name: '新建仿真', exact: true }).click()
    let creation = page.getByRole('dialog', { name: '新建仿真', exact: true })
    await creation.getByRole('radio').check()
    await creation.getByLabel('运行名称', { exact: true }).fill('完整行政验收')
    await creation.getByLabel('采购方名称', { exact: true }).fill('采购方')
    await creation.getByLabel('供应方名称', { exact: true }).fill('供应方')
    await creation.getByLabel('初始库存', { exact: true }).fill('2')
    const composedName = creation.getByLabel('运行名称', { exact: true })
    await composedName.dispatchEvent('compositionstart'); await page.keyboard.press('Enter')
    expect(creates).toBe(0)
    await composedName.dispatchEvent('compositionend')
    await page.keyboard.press('Escape')
    await adminDialogMatrix(page, root, 'creation-draft', async () => {
      await workspace.locator('header').getByRole('button', { name: /^(新建仿真|Create simulation)$/, exact: true }).click()
      return page.getByRole('dialog', { name: /^(新建仿真|Create simulation)$/, exact: true })
    }, setNativeZoom)
    await workspace.locator('header').getByRole('button', { name: '新建仿真', exact: true }).click()
    creation = page.getByRole('dialog', { name: '新建仿真', exact: true })
    expect(await creation.getByLabel('运行名称', { exact: true }).inputValue()).toBe('完整行政验收')
    await creation.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    await initialEntered.promise
    await creation.getByRole('button', { name: '打开已登记运行', exact: true }).click()
    runId = new URL(page.url()).searchParams.get('simulation')!
    await refresh()
    expect(await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isDisabled()).toBe(true)
    expect(probe.systemPrompts).toEqual([])
    expect(probe.run?.snapshot().latestCheckpointId).toBeUndefined()
    const bypass = await page.request.post(`${scaffold.baseUrl}/api/simulation.runs.manage`, { data: {
      type: 'client-request', method: 'simulation.runs.manage',
      rpcId: 'before-initial-cut', payload: { runId, managementId: 'before-initial-cut', phase: 'running' },
    } })
    expect(await bypass.json()).toMatchObject({ result: { ok: false, error: { code: 'simulation-product-unavailable' } } })
    initialRelease.resolve(undefined)
    await expect.poll(async () => { await refresh(); return await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isEnabled() }).toBe(true)
    expect(probe.run?.snapshot().phase).toBe('paused')
    expect(probe.systemPrompts).toEqual([])
    await adminDialogMatrix(page, root, 'start-budget-confirmation', async () => {
      await workspace.getByRole('button', { name: /^(开始调度|继续调度|Start scheduling|Resume scheduling)$/, exact: true }).click()
      return page.getByRole('dialog', { name: /^(开始调度|继续调度|Start scheduling|Resume scheduling)$/, exact: true })
    }, setNativeZoom)
    await adminDialogMatrix(page, root, 'entity-input-draft', () => openMaintenance(/^(输入事件|Input event)$/), setNativeZoom)
    const composedInput = await openMaintenance(/^输入事件$/)
    await composedInput.getByRole('radio').first().check()
    await composedInput.getByLabel('授权输入正文', { exact: true }).fill('中文组合输入')
    const tick = composedInput.getByLabel('最早可用模拟 tick', { exact: true })
    await tick.fill('0'); await tick.focus(); await tick.dispatchEvent('compositionstart')
    await page.keyboard.press('Enter')
    await composedInput.getByRole('button', { name: '输入事件', exact: true }).click()
    expect(inputs).toBe(0)
    expect(Object.keys(probe.run!.snapshot().ingresses ?? {})).toHaveLength(0)
    await tick.dispatchEvent('compositionend')
    await composedInput.getByRole('button', { name: '输入事件', exact: true }).click()
    await expect.poll(() => inputs).toBe(1)
    await expect.poll(() => Object.keys(probe.run!.snapshot().ingresses ?? {}).length).toBe(1)
    await page.keyboard.press('Escape')
    await adminDialogMatrix(page, root, 'checkpoint-confirmation', () => openMaintenance(/^(创建完整检查点|Create full checkpoint)$/), setNativeZoom)
    await adminDialogMatrix(page, root, 'restore-current-history', () => openMaintenance(/^(验证并恢复运行|Verify and recover run)$/), setNativeZoom)
    const latest = probe.run!.snapshot().latestCheckpointId
    gateCollection = true
    const checkpoint = await openMaintenance(/^创建完整检查点$/)
    await checkpoint.getByRole('button', { name: '创建完整检查点', exact: true }).click()
    await collecting.promise
    await page.keyboard.press('Escape'); await refresh(); await showSimulationMaintenance(workspace)
    await expect.poll(async () => await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isDisabled()).toBe(true)
    await expect.poll(async () => await workspace.getByRole('button', { name: '输入事件', exact: true }).isDisabled()).toBe(true)
    const input = await page.request.post(`${scaffold.baseUrl}/api/simulation.ingress.create`, { data: {
      type: 'client-request', method: 'simulation.ingress.create',
      rpcId: 'during-cut', payload: { runId, ingressId: 'during-cut', entityId: 'buyer', text: 'Refused input', availableAt: '0' },
    } })
    expect(await input.json()).toMatchObject({ result: { ok: false, error: { code: 'simulation-product-unavailable' } } })
    expect(Object.keys(probe.run!.snapshot().ingresses ?? {})).toHaveLength(1)
    expect(probe.run!.snapshot().latestCheckpointId).toBe(latest)
    collectRelease.resolve(undefined)
    await expect.poll(() => probe.run!.snapshot().latestCheckpointId).not.toBe(latest)
    const completedCutId = probe.run!.snapshot().latestCheckpointId!
    const originalId = String(completedCutId).slice('product-checkpoint/'.length)
    await showSimulationRequests(workspace)
    const retained = workspace.getByRole('region', { name: '持久原请求', exact: true })
    const original = retained.getByRole('region', { name: '原操作', exact: true }).filter({ hasText: originalId })
    await expect.poll(async () => {
      const query = original.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await original.getByText('原结果: 请求已完成', { exact: true }).count()
    }).toBe(1)
    await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '概览', exact: true }).click()
    await refresh()
    const binding = probe.run!.snapshot().entities['buyer' as never]!.binding!
    const goodCut = probe.run!.snapshot().latestCheckpointId
    const reference = scaffold.ctx.sessionPersistence.isUnmaterialized.bind(scaffold.ctx.sessionPersistence)
    let failed = false
    const fault = vi.spyOn(scaffold.ctx.sessionPersistence, 'isUnmaterialized').mockImplementation(async (...args) => {
      if (!failed && args[0] === binding.sessionId) { failed = true; throw new Error('Private provider secret /not-public/key') }
      return reference(...args)
    })
    const failure = await openMaintenance(/^创建完整检查点$/)
    await failure.getByRole('button', { name: '创建完整检查点', exact: true }).click()
    await expect.poll(async () => {
      const query = failure.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await failure.getByText('原结果: 请求失败', { exact: true }).count()
    }).toBe(1)
    fault.mockRestore()
    expect(probe.run!.snapshot().latestCheckpointId).toBe(goodCut)
    expect(await page.locator('body').textContent()).not.toContain('/not-public/key')
    await failure.getByRole('region', { name: '检查点／恢复诊断', exact: true }).waitFor()
    await page.screenshot({ path: join(root, 'failed-source-diagnosis.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    const nativeRestore = scaffold.ctx.simulationTeams.restore.bind(scaffold.ctx.simulationTeams)
    const interruptedCleanup = vi.spyOn(scaffold.ctx.simulationTeams, 'restore').mockImplementationOnce(async (...args) => {
      const restored = await nativeRestore(...args)
      vi.spyOn(restored.connection, 'close').mockRejectedValueOnce(new Error('Private cleanup proof /not-public/key'))
      return restored
    })
    await refresh()
    const recovery = await openMaintenance(/^验证并恢复运行$/)
    await recovery.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    await expect.poll(async () => {
      const query = recovery.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await recovery.getByText('原结果: 请求失败', { exact: true }).count()
    }).toBe(1)
    await recovery.getByText('清理尚未确认，不能据此认定旧执行已停止。', { exact: true }).waitFor()
    expect(await page.locator('body').textContent()).not.toContain('/not-public/key')
    const state = probe.run!.snapshot()
    expect((await scaffold.ctx.simulations.inspect(scaffold.ctx.simulations.resolveInspection({ provider: 'local', spec: state.spec })))?.owner)
      .toBe('this-provider')
    await teamEvidence(page, recovery, root, 'recovery-cleanup-unconfirmed', { locale: 'zh', theme: 'light', data: 'real restored handle retained',
      assertion: 'canonical cleanup failure retains Native ownership and publishes structured safe diagnosis' })
    await page.keyboard.press('Escape'); await refresh()
    expect(await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isDisabled()).toBe(true)
    interruptedCleanup.mockRestore()
    const confirmed = await openMaintenance(/^验证并恢复运行$/)
    await confirmed.getByRole('button', { name: '验证并恢复运行', exact: true }).click()
    await expect.poll(async () => {
      const query = confirmed.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await confirmed.getByText('原结果: 请求已完成', { exact: true }).count()
    }).toBe(1)
    await page.keyboard.press('Escape')
    const canonicalTeamId = probe.run!.snapshot().teamReservation!.teamId
    const canonicalTeam = await scaffold.ctx.teams.getTeam({ teamId: canonicalTeamId })
    const ownerName = canonicalTeam.rules['activationLifecycleOwner']
    if (typeof ownerName !== 'string') throw new Error('Canonical Simulation Team has no activation owner')
    const incompatible = await nativeAttach(probe.run!, canonicalTeamId, ownerName)
    const foreignId = 'browser-foreign-implementation' as never
    expect(await incompatible.checkpoint({ id: foreignId, implementationVersion: 'foreign/2', maxDrainRounds: 4, maxAttempts: 3 }))
      .toMatchObject({ status: 'completed' })
    await incompatible.close()
    const beforeRefusal = probe.run!.snapshot(), noRetirement = vi.spyOn(probe.run!, 'close')
    await refresh()
    await showSimulationMaintenance(workspace)
    await expect.poll(async () => await workspace.getByRole('button', { name: '验证并恢复运行', exact: true }).isDisabled()).toBe(true)
    const versionCommand = 'browser-version-refused'
    const bypassVersion = await page.request.post(`${scaffold.baseUrl}/api/simulation.runs.restore`, { data: {
      type: 'client-request', method: 'simulation.runs.restore', rpcId: versionCommand,
      payload: { runId, commandId: versionCommand, checkpointId: foreignId },
    } })
    expect(await bypassVersion.json()).toMatchObject({ result: { ok: true } })
    await showSimulationRequests(workspace)
    const requests = workspace.getByRole('region', { name: '持久原请求', exact: true })
    await requests.getByRole('button', { name: '刷新原请求', exact: true }).click()
    await expect.poll(async () => await requests.getByRole('button', { name: '刷新原请求', exact: true }).isEnabled()).toBe(true)
    const version = requests.locator(`[data-simulation-request="${versionCommand}"]`)
    // Requests sort by original acceptance time; discover the last command
    // through actual bounded continuation rather than expanding the page.
    while (await version.count() === 0) {
      const next = requests.getByRole('button', { name: '下一页', exact: true })
      await next.waitFor(); await next.click()
      await expect.poll(async () => await requests.getByRole('button', { name: '刷新原请求', exact: true }).isEnabled()).toBe(true)
    }
    await version.getByRole('button', { name: '查询持久原请求', exact: true }).click()
    // Cold query refreshes the bounded request list back to its first page;
    // the retained exact original remains independently readable.
    const refusedOriginal = retained.getByRole('region', { name: '原操作', exact: true }).filter({ hasText: versionCommand })
    await refusedOriginal.getByText('原结果: 请求失败', { exact: true }).waitFor()
    await refusedOriginal.getByRole('region', { name: '检查点／恢复诊断', exact: true }).getByText(/所需版本不兼容/).waitFor()
    expect(noRetirement).not.toHaveBeenCalled()
    expect(probe.run!.snapshot()).toEqual(beforeRefusal)
    expect(probe.systemPrompts).toEqual([])
    noRetirement.mockRestore()
    await page.keyboard.press('Escape')
    await scaffold.replaceBrowserAuthentication()
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    const retired = await page.request.post(`${scaffold.baseUrl}/api/simulation.requests.list`, { data: {
      type: 'client-request', method: 'simulation.requests.list',
      rpcId: 'retired-administration-reader', payload: { runId, limit: 1 },
    } })
    expect(retired.status()).toBe(401)
    await scaffold.authenticateBrowserPage(page)
    await page.goto(`${scaffold.baseUrl}/?workspace=simulation&simulation=${runId}&simulationModule=requests`, { waitUntil: 'load' })
    await workspace.getByRole('region', { name: '持久原请求', exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    const modulePicker = workspace.getByRole('button', { name: '仿真模块: 请求记录', exact: true })
    await modulePicker.waitFor()
    await expect.poll(async () => (await modulePicker.boundingBox())?.y ?? 1000).toBeLessThan(240)
    await simulationReadPresentation(page, root, `${backend}-requests`, setNativeZoom)
    expect(probe.systemPrompts).toEqual([])
    expect(errors.pageErrors).toEqual([])
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    await writeFile(join(root, 'administration-evidence.json'), JSON.stringify({ backend, runId,
      initialCheckpoint: latest, latestSuccessfulCut: goodCut, currentSuccessfulCut: probe.run!.snapshot().latestCheckpointId,
      modelEntries: probe.systemPrompts.length, errors }, null, 2) + '\n')
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), String(cause) + '\n' + await page.locator('body').innerText())
    throw cause
  } finally {
    initialRelease.resolve(undefined); collectRelease.resolve(undefined); attach.mockRestore(); vi.restoreAllMocks()
    probe.release(); await context.close(); await scaffold.close()
  }
}, 360000)

it.each(['json', 'sqlite'] as const)('shows real paused deadlines, unconfirmed model cleanup and exhausted interval allowance (%s)', async (backend) => {
  const root = join(process.cwd(), '.tmp-simulation-plan/ae/admin-budget-browser', backend)
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'run-'))
  const templates = JSON.parse(templateJSON) as Array<{ spec: Record<string, unknown> }>
  templates[0]!.spec.maxTokensPerInterval = 10000
  templates[0]!.spec.decisionTimeoutMs = 5000
  const patches = JSON.parse(await readFile('examples/headless-agent/tests/fixtures/simulation/simulation-administration/cordis.yml', 'utf8')) as
    Array<{ insert?: Array<{ name: string; config?: Record<string, unknown> }> }>
  for (const entry of patches[0]!.insert!) {
    if (entry.name === '@clocky/clocky-simulation-local') entry.config = { ...entry.config, root: join(directory, 'world'), backend }
    if (entry.name.endsWith('/administration')) entry.config = { ...entry.config, templates }
    if (entry.name === './model.ts') entry.name = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts')
  }
  const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(patches))
  const scaffold = await launchWebScaffold({ tempRoot: directory, disableDefaultSimulation: true, extraOverlayPath: overlay, productPrincipalId: 'budget-browser-user',
    agentPresets: { default: 'simulation', roots: [{ path: join(process.cwd(), 'examples/simulation-company/presets'), trust: 'system' }] } })
  const { context, setNativeZoom } = await createNativeZoomContext(root, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage(), errors = watchConsole(page), probe = scaffold.ctx.simulationBrowserProbe
  const cleanup = Promise.withResolvers<undefined>()
  let entered = 0, aborted = 0
  const stream = vi.spyOn(probe.adapter, 'stream').mockImplementation(async function* (options) {
    const signal = options.signal
    if (signal === undefined) throw new Error('Actual model stream has no cancellation lifetime')
    entered++
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } }
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
    aborted++; await cleanup.promise; signal.throwIfAborted()
  })
  const workspace = page.locator('[data-simulation-workspace-page]')
  try {
    await scaffold.authenticateBrowserPage(page); await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    await workspace.locator('header').getByRole('button', { name: '新建仿真', exact: true }).click()
    const creation = page.getByRole('dialog', { name: '新建仿真', exact: true })
    await creation.getByRole('radio').check()
    for (const [label, text] of [['运行名称', '暂停后的真实时限'], ['采购方名称', '采购方'], ['供应方名称', '供应方'], ['初始库存', '2']] as const) {
      await creation.getByLabel(label, { exact: true }).fill(text)
    }
    await creation.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    await creation.getByRole('button', { name: '打开已登记运行', exact: true }).click()
    const refresh = async () => { await showSimulationMaintenance(workspace); await workspace.getByRole('button', { name: /^(刷新控制状态|Refresh controls)$/, exact: true }).click() }
    const refreshWorld = () => workspace.getByRole('button', { name: /^(刷新|Refresh)$/, exact: true }).click()
    await expect.poll(async () => { await refresh(); return await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isEnabled() }).toBe(true)
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await expect.poll(() => entered).toBe(1)
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await expect.poll(() => probe.run!.snapshot().phase).toBe('paused')
    const time = probe.run!.snapshot().time
    await expect.poll(() => aborted, { timeout: 10000 }).toBe(1)
    expect(probe.run!.snapshot().time).toBe(time)
    expect(scaffold.ctx.simulationTeams.modelUsage()).toMatchObject({ active: 1, queued: 0, limit: 1 })
    expect(Object.values(probe.run!.snapshot().tokenReservations ?? {})).toMatchObject([{ status: 'reserved', reserved: 10000 }])
    await refresh(); await refreshWorld()
    const metrics = workspace.getByRole('region', { name: '运行预算与待处理工作', exact: true })
    await expect.poll(async () => await metrics.innerText()).toContain('10000 / 10000')
    await metrics.getByText('主机资源', { exact: true }).click()
    expect(await metrics.getByRole('region', { name: 'Host 共享模型池', exact: true }).innerText()).toContain('1 / 1')
    await teamEvidence(page, metrics, root, 'paused-cleanup-held', { locale: 'zh', theme: 'light', data: 'timeout reached; cleanup blocked; partial usage 7/2',
      assertion: 'physical permit remains occupied and reserved 10000 is not exact known consumption' })
    cleanup.resolve(undefined)
    await expect.poll(() => scaffold.ctx.simulationTeams.modelUsage().active).toBe(0)
    await expect.poll(() => Object.values(probe.run!.snapshot().tokenReservations ?? {})[0]?.status).toBe('unknown')
    const reservation = Object.values(probe.run!.snapshot().tokenReservations ?? {})[0]!
    expect(reservation).toMatchObject({ observedUsage: { inputTokens: 7, outputTokens: 2 }, reserved: 10000 })
    const decision = Object.values(probe.run!.snapshot().decisions)[0]!
    expect(decision.cancellation).toBe('timeout')
    expect(decision.inference!.expiredAt).toBeGreaterThanOrEqual(decision.inference!.deadline)
    for (const locale of ['zh', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1440, height: 1000 }); await setNativeZoom(page, 1)
      await teamAppearance(page, locale, theme)
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 480 }, { width: 390, height: 844 }] as const) {
        await page.setViewportSize(viewport); await refresh(); await refreshWorld()
        const current = workspace.getByRole('region', { name: locale === 'zh' ? '运行预算与待处理工作' : 'Run budget and pending work', exact: true })
        await expect.poll(async () => await current.innerText()).toContain('10000 / 10000')
        const unknown = current.getByText(locale === 'zh' ? '用量未知的模型尝试' : 'Model attempts with unknown usage', { exact: true }).locator('..')
        await expect.poll(async () => await unknown.locator('dd').textContent()).toBe('1')
        await teamEvidence(page, current, root, `unknown-${locale}-${theme}-${viewport.width}`, { locale, theme, data: 'original run; one partial unknown charge',
          assertion: 'independent interval allowance, no exact zero/9 accounting, confirmed cleanup releases permit' })
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      const nativeZoom = await setNativeZoom(page, 2)
      await teamEvidence(page, workspace, root, `unknown-${locale}-${theme}-zoom200`, { locale, theme, nativeZoom, data: 'same paused world and unknown charge',
        assertion: 'budget metrics remain readable with native browser zoom' })
    }
    await setNativeZoom(page, 1); await page.setViewportSize({ width: 1440, height: 1000 }); await teamAppearance(page, 'zh', 'light')
    expect(probe.run!.snapshot().time).toBe(time)
    await refresh(); await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await expect.poll(() => probe.run!.snapshot().stall?.code).toBe('SIM_BUDGET_LIMIT')
    expect(entered).toBe(1)
    await refresh()
    await expect.poll(async () => await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isDisabled()).toBe(true)
    expect(BigInt(probe.run!.snapshot().time) / BigInt(probe.run!.snapshot().spec.budgetInterval))
      .toBe(BigInt(time) / BigInt(probe.run!.snapshot().spec.budgetInterval))
    expect(errors.pageErrors).toEqual([])
    await writeFile(join(root, 'deadline-budget-evidence.json'), JSON.stringify({ backend, time, entered, aborted, reservation, inference: decision.inference,
      pool: scaffold.ctx.simulationTeams.modelUsage(), stall: probe.run!.snapshot().stall }, null, 2) + '\n')
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), String(cause) + '\n' + await page.locator('body').innerText())
    throw cause
  } finally { cleanup.resolve(undefined); probe.release(); stream.mockRestore(); await context.close(); await scaffold.close() }
}, 180000)
