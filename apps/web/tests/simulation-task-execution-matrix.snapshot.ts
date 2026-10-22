/** Actual report execution, canonical review and recoverable browser failures across supported languages and display states. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createNativeZoomContext } from './browser-native-zoom.ts'
import { teamAppearance, teamEvidence, teamModalKeyboard } from './team-acceptance-support.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { templateJSON } from '../../../examples/simulation-company/tests/sdk-product-template.ts'
import { executionTemplateJSON } from '../../../examples/simulation-company/tests/sdk-execution-template.ts'
import type { SimulationProductTaskReviewPage, SimulationProductTasksPage } from '@clocky/clocky-simulation-product/types'
import type {} from '../../../examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts'

const en = {
  title: 'Simulations', createTitle: 'Create simulation', name: 'Run name', buyerName: 'Buyer name',
  supplierName: 'Supplier name', initialStock: 'Initial stock', openCreatedRun: 'Open registered run', start: 'Start scheduling',
  'reviews.title': 'Simulation task reviews', 'reviews.empty': 'No task reviews in this window.',
  'reviews.refresh': 'Refresh review targets', 'reviews.open': 'Review Simulation task', 'reviews.reason': 'Review reason',
  'reviews.approve': 'Approve task result', closeKeepDraft: 'Close and keep input', next: 'Next page',
  queryOriginal: 'Query original result', commandUnknown: 'The result is unknown. Query the original operation first; no new identity has been allocated.',
  'controlReason.scenario-completed': 'This scenario has completed.',
}
const zh: Record<keyof typeof en, string> = {
  title: '仿真', createTitle: '新建仿真', name: '运行名称', buyerName: '采购方名称', supplierName: '供应方名称',
  initialStock: '初始库存', openCreatedRun: '打开已登记运行', start: '开始调度', 'reviews.title': '仿真任务审核',
  'reviews.empty': '本页暂无任务审核。', 'reviews.refresh': '刷新审核目标', 'reviews.open': '审核仿真任务',
  'reviews.reason': '审核原因', 'reviews.approve': '通过任务结果', closeKeepDraft: '关闭并保留输入', next: '下一页',
  queryOriginal: '查询原结果', commandUnknown: '结果尚不确定，请先查询原操作；未分配新身份。',
  'controlReason.scenario-completed': '此场景已完成。',
}

it.each(['json', 'sqlite'] as const)('keeps genuine three-actor task reviews usable across language/theme/keyboard/zoom and unknown results (%s)', async (backend) => {
  const output = join(process.cwd(), '.tmp/e08-browser-matrix', backend)
  await mkdir(output, { recursive: true })
  const directory = await mkdtemp(join(output, 'run-'))
  const templates = JSON.parse(templateJSON) as Array<{ driver: Record<string, unknown>; spec: Record<string, unknown> }>
  templates[0]!.spec.maxTokensPerInterval = 0
  templates[0]!.driver.scenario = { kind: 'task-workflow', version: '1',
    topology: { actors: [{ id: 'auditor', name: 'Independent auditor 独立审核员' }], channels: [{ key: 'audit', members: [
      { entityId: 'buyer', role: 'author' }, { entityId: 'auditor', role: 'receiver' },
    ] }] }, steps: [
      { id: 'audit', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'auditor', channelKey: 'audit',
        reviewerEntityId: 'auditor', subject: 'Audit report', description: 'Publish the installed audit report', text: 'Original audit report',
        cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 3, retry: 'before-effects' },
      { id: 'response', sourceEntityId: 'buyer', entityId: 'supplier', recipientEntityId: 'buyer', channelKey: 'purchase',
        reviewerEntityId: 'auditor', subject: 'Supplier response', description: 'Publish the installed response', text: 'Supplier response',
        cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 3, retry: 'before-effects' },
    ] }
  const source = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/cordis.yml')
  const patches = JSON.parse(await readFile(source, 'utf8')) as Array<{
    id?: string
    config?: Record<string, unknown>
    insert?: Array<{ name: string; config?: Record<string, unknown> }> }>
  for (const row of patches[0]!.insert!) {
    if (row.name === '@clocky/clocky-simulation-local') row.config = { ...row.config, root: join(directory, 'world'), backend }
    if (row.name.endsWith('/administration')) row.config = { ...row.config, templates }
    if (row.name === './model.ts') row.name = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts')
  }
  patches.find(row => row.id === 'modules')!.config = { browserConfig: {
    '@clocky/clocky-client-ui-simulation': { pageSize: 1, controlRefreshMs: 50 },
  } }
  const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(patches))
  const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: directory, productPrincipalId: 'execution-matrix-owner',
    agentPresets: { default: 'simulation', roots: [{ path: join(process.cwd(), 'examples/simulation-company/presets'), trust: 'system' }] } })
  const { context, setNativeZoom } = await createNativeZoomContext(output, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage(), errors = watchConsole(page), probe = scaffold.ctx.simulationBrowserProbe
  let loseReview = true, failPage = true
  const writes: unknown[] = []
  await page.route('**/api/simulation.tasks.review.resolve', async (route) => {
    writes.push((route.request().postDataJSON() as { payload: unknown }).payload)
    if (loseReview) { loseReview = false; await route.fetch(); await route.abort('failed') }
    else await route.continue()
  })
  await page.route('**/api/simulation.tasks.review.list', async (route) => {
    const input = route.request().postDataJSON() as { payload: { cursor?: string } }
    if (input.payload.cursor !== undefined && failPage) { failPage = false; await route.abort('failed') }
    else await route.continue()
  })
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: zh.title, exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.locator('header').getByRole('button', { name: zh.createTitle, exact: true }).focus(); await page.keyboard.press('Enter')
    const creation = page.getByRole('dialog', { name: zh.createTitle, exact: true })
    await creation.getByRole('radio').focus(); await page.keyboard.press('Space')
    for (const [label, text] of [[zh.name, '多角色任务验证 · '.repeat(12)], [zh.buyerName, '发布者'],
      [zh.supplierName, '供应者'], [zh.initialStock, '2']] as const) await creation.getByLabel(label, { exact: true }).fill(text)
    await creation.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    await creation.getByRole('button', { name: zh.openCreatedRun, exact: true }).click()
    const reviews = workspace.getByRole('region', { name: zh['reviews.title'], exact: true })
    await reviews.getByText(zh['reviews.empty'], { exact: true }).waitFor()
    expect(probe.requests).toEqual([])
    probe.release()
    await workspace.getByRole('button', { name: zh.start, exact: true }).click()
    await page.getByRole('dialog', { name: zh.start, exact: true }).getByRole('button', { name: zh.start, exact: true }).click()
    const runId = await expect.poll(() => probe.run?.snapshot().spec.runId).toBeDefined().then(() => probe.run!.snapshot().spec.runId)
    await expect.poll(async () => {
      const value = await scaffold.authenticatedRpc<{ items: Array<{ phase: string }> }>('simulation.tasks.review.list', { runId })
      return value.result.ok && value.result.value.items.some(item => item.phase === 'review')
    }).toBe(true)
    const draft = '审核长说明：'.repeat(150)
    const forms = [
      { name: 'desktop', viewport: { width: 1440, height: 1000 }, zoom: 1 },
      { name: 'short', viewport: { width: 1280, height: 480 }, zoom: 1 },
      { name: 'narrow', viewport: { width: 390, height: 844 }, zoom: 1 },
      { name: 'native200', viewport: { width: 1440, height: 1000 }, zoom: 2 },
    ] as const
    for (const locale of ['zh', 'en'] as const) for (const theme of ['light', 'dark'] as const) for (const form of forms) {
      const t = locale === 'zh' ? zh : en
      await page.setViewportSize(form.viewport); await page.emulateMedia({ reducedMotion: 'reduce' })
      await teamAppearance(page, locale, theme)
      const region = workspace.getByRole('region', { name: t['reviews.title'], exact: true })
      await region.getByRole('button', { name: t['reviews.refresh'], exact: true }).click()
      const opener = region.getByRole('button', { name: t['reviews.open'], exact: true }).first()
      const dialog = page.getByRole('dialog', { name: t['reviews.open'], exact: true })
      await expect.poll(() => opener.isEnabled()).toBe(true)
      await teamModalKeyboard(page, dialog, opener)
      await opener.focus(); await page.keyboard.press('Enter'); await dialog.waitFor()
      const reason = dialog.getByLabel(t['reviews.reason'], { exact: true })
      await reason.fill(draft)
      await reason.dispatchEvent('compositionstart'); await page.keyboard.press('Enter'); await reason.dispatchEvent('compositionend')
      expect(writes).toHaveLength(0)
      await reason.fill(draft)
      const zoom = await setNativeZoom(page, form.zoom)
      await teamEvidence(page, dialog, output, `${locale}-${theme}-${form.name}-review`, { locale, theme, data: 'actual review with long private draft',
        assertion: 'canonical report delivered; keyboard focus, readable controls, unchanged unsubmitted draft', nativeZoom: zoom })
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
      await setNativeZoom(page, 1)
      expect(probe.requests).toEqual([])
    }
    await teamAppearance(page, 'zh', 'light'); await page.setViewportSize({ width: 1440, height: 1000 })
    await workspace.getByRole('region', { name: zh['reviews.title'], exact: true }).getByRole('button', { name: zh['reviews.open'], exact: true }).first().click()
    let review = page.getByRole('dialog', { name: zh['reviews.open'], exact: true })
    expect(await review.getByLabel(zh['reviews.reason'], { exact: true }).inputValue()).toBe(draft)
    await review.getByLabel(zh['reviews.reason'], { exact: true }).fill('Approve the exact delivered report')
    await review.getByRole('button', { name: zh['reviews.approve'], exact: true }).last().click()
    await review.getByText(zh.commandUnknown, { exact: true }).waitFor()
    await review.getByLabel(zh['reviews.reason'], { exact: true }).fill('Later draft stays separate from the accepted original')
    await review.getByRole('button', { name: zh.queryOriginal, exact: true }).click()
    await review.getByRole('button', { name: zh.closeKeepDraft, exact: true }).click()
    expect(writes).toHaveLength(1)
    const region = workspace.getByRole('region', { name: zh['reviews.title'], exact: true })
    await expect.poll(async () => {
      await region.getByRole('button', { name: zh['reviews.refresh'], exact: true }).click()
      return await region.getByRole('button', { name: zh.next, exact: true }).count()
    }).toBe(1)
    const firstRows = await region.locator('li').innerText()
    await region.getByRole('button', { name: zh.next, exact: true }).click()
    await region.getByRole('alert').waitFor(); expect(await region.locator('li').innerText()).toBe(firstRows)
    await teamEvidence(page, region, output, 'pagination-failure', { locale: 'zh', theme: 'light', data: 'retained first review page',
      assertion: 'failed continuation is visible and keeps original rows; no execution or repeated approval' })
    await region.getByRole('button', { name: zh['reviews.refresh'], exact: true }).click()
    await expect.poll(async () => {
      // A commit between the first page and its continuation expires the cursor; the reviewer refreshes and continues.
      if (await region.getByRole('alert').count() > 0) await region.getByRole('button', { name: zh['reviews.refresh'], exact: true }).click()
      const next = region.getByRole('button', { name: zh.next, exact: true })
      if (await next.count() > 0 && await next.isEnabled()) await next.click()
      // The second of two single-row pages is the last: it has one row, no continuation and no failure notice.
      return await next.count() === 0 && await region.locator('li').count() === 1 && await region.getByRole('alert').count() === 0
    }, { timeout: 15000 }).toBe(true)
    await region.getByRole('button', { name: zh['reviews.open'], exact: true }).first().click()
    review = page.getByRole('dialog', { name: zh['reviews.open'], exact: true })
    await review.getByLabel(zh['reviews.reason'], { exact: true }).fill('Approve supplier response')
    await review.getByRole('button', { name: zh['reviews.approve'], exact: true }).last().click()
    await expect.poll(async () => {
      const query = review.getByRole('button', { name: zh.queryOriginal, exact: true })
      if (await query.count() > 0 && await query.isEnabled()) await query.click()
      return await review.isVisible()
    }, { timeout: 10000 }).toBe(false)
    await review.waitFor({ state: 'hidden' })
    await workspace.getByText(zh['controlReason.scenario-completed'], { exact: true }).waitFor()
    expect(probe.requests).toEqual([])
    const state = probe.run!.snapshot()
    expect(Object.values(state.operations).filter(value => value.action.kind === 'communication/post')).toHaveLength(2)
    expect(state.resources['stock' as never]?.quantity).toBe('2')
    expect(errors.pageErrors).toEqual([])
  } catch (cause: unknown) {
    await page.screenshot({ path: join(output, 'failure.png') })
    await writeFile(join(output, 'failure.txt'), String(cause) + '\n' + await page.locator('body').innerText())
    throw cause
  } finally { probe.release(); await context.close(); await scaffold.close() }
}, 120000)

it.each(['json', 'sqlite'] as const)('retains exact public cancellation after genuine report effects and changed task revision (%s)', async (backend) => {
  const output = join(process.cwd(), '.tmp/e08-browser-cancel', backend)
  await mkdir(output, { recursive: true })
  const directory = await mkdtemp(join(output, 'run-'))
  const patches = JSON.parse(await readFile('examples/headless-agent/tests/fixtures/simulation/simulation-administration/cordis.yml', 'utf8')) as
    Array<{ insert?: Array<{ name: string; config?: Record<string, unknown> }> }>
  for (const row of patches[0]!.insert!) {
    if (row.name === '@clocky/clocky-simulation-local') row.config = { ...row.config, root: join(directory, 'world'), backend }
    if (row.name.endsWith('/administration')) row.config = { ...row.config, templates: JSON.parse(executionTemplateJSON) as unknown[] }
    if (row.name === './model.ts') row.name = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts')
  }
  const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(patches))
  const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: directory, productPrincipalId: 'cancel-matrix-owner',
    agentPresets: { default: 'simulation', roots: [{ path: join(process.cwd(), 'examples/simulation-company/presets'), trust: 'system' }] } })
  const { context, setNativeZoom } = await createNativeZoomContext(output, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage(), errors = watchConsole(page), probe = scaffold.ctx.simulationBrowserProbe
  const writes: Array<Record<string, unknown>> = []
  let loseCancel = true, loseQuery = true
  await page.route('**/api/simulation.tasks.cancel', async (route) => {
    writes.push((route.request().postDataJSON() as { payload: Record<string, unknown> }).payload)
    if (loseCancel) { loseCancel = false; await route.fetch(); await route.abort('failed') }
    else await route.continue()
  })
  await page.route('**/api/simulation.requests.get', async (route) => {
    const input = (route.request().postDataJSON() as { payload: { commandId: string } }).payload
    if (loseQuery && input.commandId === writes[0]?.commandId) { loseQuery = false; await route.abort('failed') }
    else await route.continue()
  })
  try {
    await scaffold.authenticateBrowserPage(page); await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.locator('header').getByRole('button', { name: '新建仿真', exact: true }).click()
    const creation = page.getByRole('dialog', { name: '新建仿真', exact: true })
    await creation.getByRole('radio').check()
    for (const [label, value] of [['运行名称', '原报告保留与取消'], ['采购方名称', '发布者'], ['供应方名称', '供应者'], ['初始库存', '2']]) {
      await creation.getByLabel(label!, { exact: true }).fill(value!)
    }
    await creation.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    await creation.getByRole('button', { name: '打开已登记运行', exact: true }).click()
    probe.release()
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await expect.poll(() => probe.run?.snapshot().spec.runId).toBeDefined()
    const runId = probe.run!.snapshot().spec.runId
    const reviewTarget = async () => {
      const value = await scaffold.authenticatedRpc<SimulationProductTaskReviewPage>('simulation.tasks.review.list', { runId })
      if (!value.result.ok) throw new Error('Canonical review read failed')
      return value.result.value.items.find(item => item.action.allowed)
    }
    await expect.poll(async () => (await reviewTarget())?.attemptCount).toBe(1)
    const original = await reviewTarget(); if (original === undefined) throw new Error('Original report is not reviewed')
    const controlRegion = () => workspace.getByRole('region', { name: /^(仿真任务控制|Simulation task controls)$/, exact: true })
    const openCancel = async () => {
      const region = controlRegion()
      await region.getByRole('button', { name: /^(核对当前任务|Check current tasks)$/, exact: true }).click()
      const opener = region.getByRole('button', { name: /^(取消仿真任务|Cancel Simulation task)$/, exact: true }).first()
      await expect.poll(() => opener.isEnabled()).toBe(true)
      const dialog = page.getByRole('dialog', { name: /^(取消仿真任务|Cancel Simulation task)$/, exact: true })
      await teamModalKeyboard(page, dialog, opener)
      await opener.click()
      return dialog
    }
    const draft = '取消输入应保留，已送达原报告不回滚。'.repeat(100)
    for (const locale of ['zh', 'en'] as const) for (const theme of ['light', 'dark'] as const) for (const form of [
      { name: 'desktop', viewport: { width: 1440, height: 1000 }, zoom: 1 },
      { name: 'short', viewport: { width: 1280, height: 480 }, zoom: 1 },
      { name: 'narrow', viewport: { width: 390, height: 844 }, zoom: 1 },
      { name: 'native200', viewport: { width: 1440, height: 1000 }, zoom: 2 },
    ] as const) {
      await page.setViewportSize(form.viewport); await page.emulateMedia({ reducedMotion: 'reduce' })
      await teamAppearance(page, locale, theme)
      const dialog = await openCancel()
      const reason = dialog.getByLabel(locale === 'zh' ? '取消原因' : 'Cancellation reason', { exact: true })
      await reason.fill(draft)
      await reason.dispatchEvent('compositionstart')
      await dialog.getByRole('button', { name: locale === 'zh' ? '确认取消任务' : 'Confirm task cancellation', exact: true }).click()
      await reason.dispatchEvent('compositionend'); expect(writes).toHaveLength(0)
      const zoom = await setNativeZoom(page, form.zoom)
      await teamEvidence(page, dialog, output, `${locale}-${theme}-${form.name}-cancel`, { locale, theme,
        data: 'genuine delivered report awaiting independent review; retained private cancellation draft',
        assertion: 'IME prevents mutation; exact task and attempt remain visible; cancellation does not undo world effects', nativeZoom: zoom })
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await setNativeZoom(page, 1)
    }
    await teamAppearance(page, 'zh', 'light'); await page.setViewportSize({ width: 1440, height: 1000 })
    const rework = await scaffold.authenticatedRpc('simulation.tasks.review.resolve', { runId, commandId: 'cancel-fence-rework',
      operationId: original.operationId, attemptId: original.attemptId, expectedRevision: original.taskRevision,
      nextPhase: 'pending', reason: 'Require a new independently reviewed report before cancellation' })
    expect(rework.result.ok).toBe(true)
    await expect.poll(async () => (await reviewTarget())?.attemptCount, { timeout: 10000 }).toBe(2)
    const updated = await reviewTarget(); expect(updated?.attemptId).not.toBe(original.attemptId)
    const dialog = await openCancel()
    const reason = dialog.getByLabel('取消原因', { exact: true })
    expect(await reason.inputValue()).toBe(draft)
    const confirm = dialog.getByRole('button', { name: '确认取消任务', exact: true })
    expect(await confirm.isDisabled()).toBe(true)
    await dialog.getByRole('button', { name: '确认此任务的当前版本与尝试', exact: true }).click()
    await reason.fill('Cancel the exact second reviewed attempt; keep recorded reports')
    await confirm.click(); await dialog.getByText(zh.commandUnknown, { exact: true }).waitFor()
    await reason.fill('Later unsubmitted cancellation draft')
    await dialog.getByRole('button', { name: zh.queryOriginal, exact: true }).click()
    await expect.poll(() => loseQuery).toBe(false)
    // Lookup first: a lost query proves nothing, so retry stays withheld and the original is queried again.
    const retry = dialog.getByRole('button', { name: '重试原操作', exact: true })
    expect(await retry.count() === 0 || await retry.isDisabled()).toBe(true)
    await expect.poll(async () => {
      const query = dialog.getByRole('button', { name: zh.queryOriginal, exact: true })
      if (await query.count() > 0 && await query.isEnabled()) await query.click()
      return await dialog.getByText('原结果: 请求已完成', { exact: true }).count()
    }, { timeout: 10000 }).toBe(1)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.expectedRevision).toBe(updated?.taskRevision); expect(writes[0]?.expectedAttemptId).toBe(null)
    expect(await reason.inputValue()).toBe('Later unsubmitted cancellation draft')
    await teamEvidence(page, dialog, output, 'cancel-original-completed', { locale: 'zh', theme: 'light',
      data: 'original exact cancellation terminal; separate later draft', assertion: 'query loss withholds retry; a repeated query reads the original under its revision fence' })
    await dialog.getByRole('button', { name: zh.closeKeepDraft, exact: true }).click()
    const current = await scaffold.authenticatedRpc<SimulationProductTasksPage>('simulation.tasks.list', { runId })
    expect(current.result.ok && current.result.value.items[0]?.phase).toBe('cancelled')
    const state = probe.run!.snapshot()
    expect(Object.values(state.operations).filter(value => value.action.kind === 'communication/post')).toHaveLength(2)
    expect(state.resources['stock' as never]?.quantity).toBe('2'); expect(probe.requests).toEqual([])
    await controlRegion().getByRole('button', { name: /打开任务取消输入/, exact: false }).click()
    const retained = page.getByRole('dialog', { name: '取消仿真任务', exact: true })
    expect(await retained.getByLabel('取消原因', { exact: true }).inputValue()).toBe('Later unsubmitted cancellation draft')
    await scaffold.replaceBrowserAuthentication()
    const retiredRead = await page.request.post(`${scaffold.baseUrl}/api/simulation.tasks.list`, { data: {
      type: 'client-request', rpcId: 'retired-task-controls', method: 'simulation.tasks.list', payload: { runId },
    } })
    expect(retiredRead.status()).toBe(401)
    await expect.poll(async () => await page.getByLabel('取消原因', { exact: true }).count() === 0
      || await page.getByLabel('取消原因', { exact: true }).inputValue() !== 'Later unsubmitted cancellation draft').toBe(true)
    expect(await controlRegion().getByRole('button', { name: /打开任务取消输入/ }).count()).toBe(0)
    expect(writes).toHaveLength(1)
    await scaffold.authenticateBrowserPage(page)
    await page.reload({ waitUntil: 'load' })
    await controlRegion().getByRole('button', { name: '核对当前任务', exact: true }).click()
    await expect.poll(() => controlRegion().getByRole('alert').count()).toBe(0)
    const currentDialog = await openCancel()
    expect(await currentDialog.getByLabel('取消原因', { exact: true }).inputValue()).toBe('')
    expect(writes).toHaveLength(1)
    await teamEvidence(page, currentDialog, output, 'cancel-current-auth-restored', { locale: 'zh', theme: 'light',
      data: 'new authenticated read of original cancelled task; retired private draft cleared',
      assertion: 'retired cookie rejects and clears private input; current authentication restores reads without replaying cancellation' })
    expect(errors.pageErrors).toEqual([])
  } catch (cause: unknown) {
    await page.screenshot({ path: join(output, 'failure.png') })
    await writeFile(join(output, 'failure.txt'), String(cause) + '\n' + await page.locator('body').innerText())
    throw cause
  } finally { probe.release(); await context.close(); await scaffold.close() }
}, 120000)
