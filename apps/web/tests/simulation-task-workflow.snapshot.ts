import { simulationRuntimeMetrics } from '@clocky/clocky-simulation'
/** Trusted reports complete through exact channel delivery and independent canonical review in the real Web app. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { SimulationProductControl, SimulationProductRunInspection } from '@clocky/clocky-simulation-product/types'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { templateJSON } from '../../../examples/simulation-company/tests/sdk-product-template.ts'
import type {} from '../../../examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts'

it.each([
  { backend: 'json', topology: false }, { backend: 'sqlite', topology: false },
  { backend: 'json', topology: true }, { backend: 'sqlite', topology: true },
])('executes a two-step workflow with exact review and original rework recovery in the browser ($backend, extended=$topology)', async ({ backend, topology }) => {
  const reviewerId = topology ? 'reviewer' : 'supplier'
  const reportChannel = topology ? 'audit' : 'purchase'
  const root = join(process.cwd(), '.tmp-simulation-plan/web-task-workflow', backend, topology ? 'independent-reviewer' : 'supplier-reviewer')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'run-'))
  const templates = JSON.parse(templateJSON) as Array<{
    id: string
    name: string
    objective: string
    spec: Record<string, unknown>
    driver: Record<string, unknown>
  }>
  const template = templates[0]!
  template.id = topology ? 'audit-workflow' : 'forecast-workflow'; template.name = 'Forecast report workflow'; template.objective = 'Publish and review two forecast reports'
  template.spec.maxResidentActors = 2
  template.driver.scenario = { kind: 'task-workflow', version: '1',
    ...topology ? { topology: { actors: [{ id: reviewerId, name: 'Independent forecast auditor' }], channels: [
      { key: reportChannel, members: [{ entityId: 'buyer', role: 'publisher' }, { entityId: reviewerId, role: 'reviewer' }] },
    ] } } : {}, steps: [
      { id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: reviewerId, channelKey: reportChannel,
        reviewerEntityId: reviewerId, subject: 'Publish buyer forecast', description: 'Publish the installed forecast report',
        text: 'Buyer forecast: approved period', cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' },
      { id: 'response', sourceEntityId: 'buyer', entityId: 'supplier', recipientEntityId: 'buyer', channelKey: 'purchase',
        subject: 'Publish supplier response', description: 'Publish the installed supplier response',
        text: 'Supplier response: forecast received', cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 1, retry: 'never' },
    ] }
  const fixture = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/cordis.yml')
  const patches = JSON.parse(await readFile(fixture, 'utf8')) as Array<{ insert?: Array<{ name: string; config?: Record<string, unknown> }> }>
  for (const row of patches[0]!.insert!) {
    if (row.name === '@clocky/clocky-simulation-local') row.config = { ...row.config, root: join(directory, 'world'), backend }
    if (row.name.endsWith('/administration')) row.config = { ...row.config, templates }
    if (row.name === './model.ts') row.name = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts')
  }
  const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(patches))
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay, tempRoot: directory,
    productPrincipalId: 'simulation-browser-user', agentPresets: { default: 'simulation',
      roots: [{ path: join(process.cwd(), 'examples/simulation-company/presets'), trust: 'system' }] } })
  const probe = scaffold.ctx.simulationBrowserProbe
  let connection: SimulationTeamConnection | undefined
  const attach = scaffold.ctx.simulationTeams.attach.bind(scaffold.ctx.simulationTeams)
  const capture = vi.spyOn(scaffold.ctx.simulationTeams, 'attach').mockImplementation(async (...args) => {
    const attached = await attach(...args)
    connection = attached
    return attached
  })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  const writes: Array<{ commandId: string; attemptId: string; reason: string; nextPhase: string }> = []
  const queries: string[] = []
  let loseResponse = true
  await page.route('**/api/simulation.tasks.review.resolve', async (route) => {
    writes.push((route.request().postDataJSON() as { payload: typeof writes[number] }).payload)
    if (loseResponse) { loseResponse = false; await route.fetch(); await route.abort('failed') }
    else await route.continue()
  })
  await page.route('**/api/simulation.requests.get', async (route) => {
    queries.push((route.request().postDataJSON() as { payload: { commandId: string } }).payload.commandId)
    await route.continue()
  })
  const tasks = async () => {
    const reservation = probe.run?.snapshot().teamReservation
    return reservation === undefined ? [] : (await scaffold.ctx.teams.getTeam({ teamId: reservation.teamId })).tasks
  }
  const firstTask = async () => (await tasks()).find(task => task.subject === 'Publish buyer forecast')
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('button', { name: '新建仿真', exact: true }).click()
    const creation = page.getByRole('dialog', { name: '新建仿真', exact: true })
    await creation.getByRole('radio').check()
    await creation.getByText('自动执行 Team 任务，仅使用受限仿真操作', { exact: true }).waitFor()
    await creation.getByLabel('运行名称', { exact: true }).fill('双步骤预测报告')
    await creation.getByLabel('采购方名称', { exact: true }).fill('预测发布方')
    await creation.getByLabel('供应方名称', { exact: true }).fill('预测审核方')
    await creation.getByLabel('初始库存', { exact: true }).fill('2')
    await creation.getByText('调整运行额度', { exact: true }).click()
    await creation.getByLabel('每个预算区间的 token 上限', { exact: true }).fill('0')
    if (topology) {
      await creation.getByLabel('实体数上限', { exact: true }).fill('2')
      await creation.getByRole('button', { name: '检查配置', exact: true }).click()
      await expect.poll(async () => creation.getByLabel('实体数上限', { exact: true }).getAttribute('aria-invalid')).toBe('true')
      expect(probe.run).toBeUndefined(); expect(probe.requests).toEqual([])
      await creation.getByLabel('实体数上限', { exact: true }).fill('3')
    }
    await creation.getByRole('button', { name: '检查配置', exact: true }).click()
    await creation.getByText('配置检查通过。创建时仍会重新检查当前权限与容量。', { exact: true }).waitFor()
    await creation.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    await creation.getByRole('button', { name: '打开已登记运行', exact: true }).click()
    await expect.poll(() => probe.run?.snapshot().phase).toBe('paused')
    probe.release()
    await expect.poll(async () => workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await expect.poll(async () => (await firstTask())?.phase, { timeout: 20000 }).toBe('review')
    const initial = (await firstTask())!
    const observed = probe.run!.snapshot()
    const reviewer = observed.entities[reviewerId as never]!.binding!
    expect(Object.keys(observed.entities)).toHaveLength(topology ? 3 : 2)
    expect(Object.keys(observed.channelReservations ?? {})).toHaveLength(topology ? 2 : 1)
    expect(initial.reviewPolicy).toEqual({ kind: 'participant', reviewerId: reviewer.participantId })
    const report = Object.values(observed.operations).find(value => value.action.kind === 'communication/post' && value.entityId === 'buyer')!
    expect(report).toMatchObject({ action: { kind: 'communication/post', recipient: reviewerId,
      channelId: observed.channelReservations![reportChannel as never]!.channelId } })
    expect(report.outbox?.receipt).toMatchObject({ channelId: observed.channelReservations![reportChannel as never]!.channelId,
      recipientId: reviewer.participantId })
    expect(report.delivery?.receipt).toMatchObject({ participantId: reviewer.participantId,
      envelopeId: report.outbox!.receipt!.envelopeId })
    if (topology) {
      if (connection === undefined) throw new Error('Real workflow owner attachment was not observed')
      for (const denied of ['buyer', 'supplier']) {
        await expect(connection.reviewTask({ commandId: `denied/${denied}`, attemptId: initial.attemptHistory[0]!.id,
          reviewerEntityId: denied as never, expectedRevision: initial.revision, nextPhase: 'completed', reason: 'Forged reviewer' }))
          .rejects.toThrow('exact active reviewer binding')
      }
      expect((await firstTask())!.revision).toBe(initial.revision)
      expect((await firstTask())!.phase).toBe('review')
      const control = await scaffold.authenticatedRpc<SimulationProductControl>('simulation.runs.control', { runId: observed.spec.runId })
      if (!control.result.ok) throw new Error('Prepared workflow control must remain authorized')
      expect(control.result.value.administration.ingress.targets.map(target => target.id)).toContain(reviewerId)
      const inspection = await scaffold.authenticatedRpc<SimulationProductRunInspection>('simulation.runs.inspect', { runId: observed.spec.runId })
      expect(inspection.result).toMatchObject({ ok: true, value: { status: 'observed', world: { entityCount: 3 } } })
    }
    await workspace.getByRole('button', { name: '刷新审核目标', exact: true }).click()
    const reviews = workspace.getByRole('region', { name: '仿真任务审核', exact: true })
    await reviews.getByText(reviewerId, { exact: true }).waitFor()
    await reviews.getByRole('button', { name: '审核仿真任务', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '审核仿真任务', exact: true })
    await dialog.getByRole('button', { name: '请求返工', exact: true }).click()
    await dialog.getByLabel('审核原因', { exact: true }).fill('Add forecast period')
    await dialog.getByRole('button', { name: '请求返工', exact: true }).last().click()
    await dialog.getByText('响应丢失，请查询或重试原操作。', { exact: true }).waitFor()
    expect(writes).toHaveLength(1)
    await dialog.getByRole('button', { name: '查询原结果', exact: true }).click()
    await expect.poll(async () => {
      const query = dialog.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await dialog.count()
    }).toBe(0)
    expect(queries).toContain(writes[0]!.commandId)
    expect(writes).toHaveLength(1)
    await expect.poll(async () => ({ phase: (await firstTask())?.phase, attempts: (await firstTask())?.attemptCount }),
      { timeout: 20000 }).toEqual({ phase: 'review', attempts: 2 })
    const afterRework = probe.run!.snapshot()
    const revised = Object.values(afterRework.taskExecutions ?? {}).find(value => value.request.ordinal === 2)!
    expect(JSON.stringify(afterRework.decisions[revised.decisions![0]!.request.decisionId]?.context)).toContain('Add forecast period')
    expect(await tasks()).toHaveLength(1)
    await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
    await expect.poll(() => probe.run!.snapshot().phase).toBe('paused')
    await reviews.getByRole('button', { name: '刷新审核目标', exact: true }).click()
    await reviews.getByRole('button', { name: '审核仿真任务', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '审核仿真任务', exact: true })
    await dialog.getByLabel('审核原因', { exact: true }).fill(`Forecast checked by ${reviewerId}`)
    await dialog.getByRole('button', { name: '通过任务结果', exact: true }).last().click()
    await expect.poll(async () => {
      const query = dialog.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await dialog.count()
    }).toBe(0)
    expect((await firstTask())!.phase).toBe('completed')
    expect(probe.run!.snapshot().phase).toBe('paused')
    expect(writes).toHaveLength(2)
    expect(writes[1]!.attemptId).not.toBe(writes[0]!.attemptId)
    expect(probe.requests).toEqual([])
    await page.screenshot({ path: join(root, `${reviewerId}-reviewed-paused.png`), animations: 'disabled' })
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await workspace.getByText('此场景已完成。', { exact: true }).waitFor()
    const completed = await tasks(), state = probe.run!.snapshot()
    expect(completed).toHaveLength(2)
    expect(completed.every(task => task.phase === 'completed')).toBe(true)
    expect(Object.values(state.taskExecutions ?? {})).toHaveLength(3)
    expect(Object.values(state.operations).filter(value => value.action.kind === 'task/create')).toHaveLength(2)
    expect(Object.values(state.operations).some(value => value.action.kind === 'resource/transfer')).toBe(false)
    expect(state.resources['stock' as never]?.quantity).toBe('2')
    expect(state.spec.maxTokensPerInterval).toBe(0)
    expect(simulationRuntimeMetrics(state, 'this-provider').budgets.tokens).toMatchObject({ limit: 0, charged: 0, unknownAttempts: 0 })
    expect(Object.values(state.tokenReservations ?? {})).toEqual([])
    expect(probe.requests).toEqual([])
    // Simulation metadata references preserve navigation; independent Team grants still govern the destination.
    const revision = state.revision, teamId = state.teamReservation!.teamId
    await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '实体', exact: true }).click()
    await workspace.getByRole('table').getByRole('button', { name: /^查看详情:/ }).first().click()
    const reference = workspace.getByRole('link', { name: `查看关联 Team: ${teamId}`, exact: true })
    const href = await reference.getAttribute('href')
    expect(new URL(href!).searchParams.get('team')).toBe(teamId)
    expect(new URL(href!).searchParams.has('simulation')).toBe(false)
    await reference.click()
    await page.getByRole('alert').first().waitFor()
    expect(new URL(page.url()).searchParams.get('team')).toBe(teamId)
    expect(await page.locator('[data-team-workspace-page]').getByRole('button', { name: '新建任务', exact: true }).count()).toBe(0)
    expect(probe.run!.snapshot().revision).toBe(revision)
    expect(probe.requests).toEqual([])
    await page.goBack()
    await workspace.getByRole('table').waitFor()
    await page.screenshot({ path: join(root, 'workflow-completed.png'), animations: 'disabled' })
    expect(errors.pageErrors).toEqual([])
    expect(errors.warnings).toEqual([])
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), await page.locator('body').innerText())
    throw cause
  } finally { capture.mockRestore(); probe.release(); await browser.close(); await scaffold.close() }
})
