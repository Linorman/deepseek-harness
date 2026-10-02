import { foldRequestHeader } from '@clocky/clocky-session'
/** Real persisted target response loss requires an original bounded grant and explicit scheduling, with no sender replay. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { showSimulationMaintenance } from './simulation-browser-controls.ts'
import { templateJSON } from '../../../examples/simulation-company/tests/sdk-product-template.ts'
import type {} from '../../../examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts'
import type {} from '../../../examples/headless-agent/tests/fixtures/simulation/operation-retry-fault.ts'

it.each(['json', 'sqlite'])('grants an exact unknown operation retry without republishing its original target or inference (%s)', async (backend) => {
  const root = join(process.cwd(), '.tmp-simulation-plan/web-operation-retry', backend)
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'run-'))
  const templates = JSON.parse(templateJSON) as Array<{ spec: Record<string, unknown> }>
  templates[0]!.spec.outboxMaxAttempts = 1
  const fixture = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/cordis.yml')
  const patches = JSON.parse(await readFile(fixture, 'utf8')) as Array<{ insert?: Array<{ name: string; config?: Record<string, unknown> }> }>
  for (const row of patches[0]!.insert!) {
    if (row.name === '@clocky/clocky-simulation-local') row.config = { ...row.config, root: join(directory, 'world'), backend }
    if (row.name.endsWith('/administration')) row.config = { ...row.config, templates }
    if (row.name === './model.ts') row.name = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts')
  }
  patches[0]!.insert!.push({ name: join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/operation-retry-fault.ts') })
  const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(patches))
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay, tempRoot: directory,
    productPrincipalId: 'simulation-browser-user', agentPresets: { default: 'simulation',
      roots: [{ path: join(process.cwd(), 'examples/simulation-company/presets'), trust: 'system' }] } })
  const probe = scaffold.ctx.simulationBrowserProbe, fault = scaffold.ctx.simulationRetryFaultProbe
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  const grants: Array<{ commandId: string; operationId: string; expectedAttemptCount: number; reason: string }> = []
  let dropGrant = true
  await page.route('**/api/simulation.operation.retry', async (route) => {
    grants.push((route.request().postDataJSON() as { payload: typeof grants[number] }).payload)
    if (dropGrant) { dropGrant = false; await route.fetch(); await route.abort('failed') }
    else await route.continue()
  })
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('button', { name: '新建仿真', exact: true }).click()
    const creation = page.getByRole('dialog', { name: '新建仿真', exact: true })
    await creation.getByRole('radio').check()
    await creation.getByLabel('运行名称', { exact: true }).fill('原操作受限重试')
    await creation.getByLabel('采购方名称', { exact: true }).fill('采购方')
    await creation.getByLabel('供应方名称', { exact: true }).fill('供应方')
    await creation.getByLabel('初始库存', { exact: true }).fill('2')
    await creation.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    await creation.getByRole('button', { name: '打开已登记运行', exact: true }).click()
    expect(probe.requests).toEqual([])
    probe.release()
    await expect.poll(async () => await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await expect.poll(() => fault.target !== undefined).toBe(true)
    const target = fault.target!
    await expect.poll(() => probe.run!.snapshot().operations[target.operationId]?.status).toBe('outcome-unknown')
    const beforeGrant = probe.run!.snapshot(), requestCount = probe.requests.length
    const senderDecision = beforeGrant.decisions[target.decisionId]!
    if (senderDecision.context?.status !== 'prepared') throw new Error('Sender decision has no recorded prepared context')
    const senderInputId = senderDecision.context.view.inputId
    const senderRequests = Object.values(beforeGrant.tokenReservations ?? {}).filter(value => value.decisionId === target.decisionId)
    expect(senderRequests.length).toBeGreaterThan(0)
    for (const request of senderRequests) {
      expect(request.entityId).toBe(senderDecision.entityId); expect(request.epoch).toBe(senderDecision.epoch)
      const stored = await scaffold.ctx.sessionPersistence.readFrom(request.sessionId, 0)
      const prefix = stored.events.filter(event => event.seq <= request.request.sessionSequence)
      expect(prefix.some(event => event.type === 'simulation/context-view' && event.data.inputId === senderInputId)).toBe(true)
      const header = foldRequestHeader(prefix)
      expect(header?.config.provider).toBe(request.request.provider)
      expect(header?.config.model).toBe(request.request.model)
    }
    await workspace.getByRole('button', { name: '刷新', exact: true }).click()
    await workspace.getByRole('button', { name: `检查原操作 · ${target.operationId}`, exact: true }).click()
    await workspace.getByRole('button', { name: '授权操作重试', exact: true }).click()
    const retry = page.getByRole('dialog', { name: '授权操作重试', exact: true })
    await retry.getByLabel('授权原因', { exact: true }).fill('已核对原目标的持久回执，允许对账')
    await expect.poll(async () => await retry.getByRole('button', { name: '登记受限重试额度', exact: true }).isEnabled()).toBe(true)
    await retry.getByRole('button', { name: '登记受限重试额度', exact: true }).click()
    await retry.getByText('响应丢失，请查询或重试原操作。', { exact: true }).waitFor()
    await retry.getByLabel('授权原因', { exact: true }).fill('后来编辑的授权原因')
    await retry.getByRole('button', { name: '关闭并保留输入', exact: true }).click()
    await workspace.getByRole('button', { name: '概览', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await workspace.getByRole('button', { name: `打开操作重试草稿 · ${target.operationId}`, exact: true }).click()
    expect(await retry.getByLabel('授权原因', { exact: true }).inputValue()).toBe('后来编辑的授权原因')
    expect(await retry.getByRole('button', { name: '重试原操作', exact: true }).count()).toBe(0)
    await retry.getByRole('button', { name: '查询原结果', exact: true }).click()
    await expect.poll(async () => {
      const query = retry.getByRole('button', { name: '查询原结果', exact: true })
      if (await query.count() && await query.isEnabled()) await query.click()
      return await retry.getByText('原结果: 请求已完成', { exact: true }).count()
    }).toBe(1)
    expect(grants).toHaveLength(1)
    expect(probe.requests).toHaveLength(requestCount)
    expect(probe.run!.snapshot().phase).toBe(beforeGrant.phase)
    expect(probe.run!.snapshot().operations[target.operationId]?.result).toBeUndefined()
    expect(probe.run!.snapshot().operations[target.operationId]?.status).toBe('pending')
    expect(await retry.getByText('额度已登记，此命令没有执行目标；仍需明确继续调度。', { exact: true }).count()).toBe(1)
    expect(fault.calls.filter(call => call.operationId === target.operationId)).toHaveLength(1)
    await retry.getByText('额度已登记，此命令没有执行目标；仍需明确继续调度。', { exact: true }).waitFor()
    await page.screenshot({ path: join(root, 'grant-unknown-original-narrow.png'), animations: 'disabled' })
    await retry.getByRole('button', { name: '关闭并保留输入', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await workspace.getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await page.getByRole('dialog', { name: /^(开始|继续)调度$/, exact: true }).getByRole('button', { name: /^(开始|继续)调度$/, exact: true }).click()
    await workspace.getByText('此场景已完成。', { exact: true }).waitFor()
    expect(probe.run!.snapshot().decisions[target.decisionId]).toEqual(senderDecision)
    const calls = fault.calls.filter(call => call.operationId === target.operationId)
    expect(calls.length).toBeGreaterThan(1)
    expect(new Set(calls.map(call => call.envelopeId))).toEqual(new Set([target.envelopeId]))
    const records = await scaffold.ctx.teams.readChannelPage({ channelId: target.channelId, afterCursor: -1, limit: 32 })
    expect(records.records.filter(record => record.type === 'channel/envelope' && record.envelope.id === target.envelopeId)).toHaveLength(1)
    const retainedSenderRequests = Object.values(probe.run!.snapshot().tokenReservations ?? {})
      .filter(value => value.decisionId === target.decisionId)
    expect(retainedSenderRequests).toEqual(senderRequests)
    expect(probe.run!.snapshot().decisions[target.decisionId]?.inference).toEqual(senderDecision.inference)
    expect(probe.run!.snapshot().resources['received' as never]?.quantity).toBe('1')
    await showSimulationMaintenance(workspace)
    const checkpoint = page.getByRole('dialog', { name: '创建完整检查点', exact: true })
    const checkpointRequest = async () => {
      await workspace.getByRole('button', { name: '创建完整检查点', exact: true }).click()
      await checkpoint.getByRole('button', { name: '创建完整检查点', exact: true }).click()
      await expect.poll(async () => {
        const query = checkpoint.getByRole('button', { name: '查询原结果', exact: true })
        if (await query.count() && await query.isEnabled()) await query.click()
        return await checkpoint.getByText(/原结果: (请求已完成|请求失败)/).count()
      }).toBe(1)
    }
    await checkpointRequest()
    await checkpoint.getByRole('button', { name: '关闭并保留输入', exact: true }).last().click()
    fault.failCheckpointRead = true
    await checkpointRequest()
    await checkpoint.getByRole('region', { name: '检查点／恢复诊断', exact: true }).getByText('采集检查点 · 准确来源当前不可用。', { exact: true }).waitFor()
    const link = checkpoint.getByRole('link', { name: /^查看精确 Team Session:/ })
    await link.waitFor()
    const failedReply = Object.values(probe.run!.snapshot().checkpoints ?? {}).find(value => value.status === 'failed')
    expect(failedReply).toBeDefined()
    expect(await checkpoint.innerText()).not.toContain('PRIVATE_CHECKPOINT_STORAGE_ROOT')
    fault.failCheckpointRead = false
    const administrative = [...scaffold.ctx.loader.entries()].find(entry => entry.options.name === '@clocky/clocky-simulation-product/administration')
    if (administrative === undefined) throw new Error('Administrative owner unavailable for cold original lookup')
    const priorDiagnostic = await checkpoint.getByRole('region', { name: '检查点／恢复诊断', exact: true }).innerText()
    await administrative.update({ disabled: true }); await administrative.update({ disabled: false }); await scaffold.ctx.loader.await()
    await checkpoint.getByRole('button', { name: '查询原结果', exact: true }).click()
    await checkpoint.getByRole('region', { name: '检查点／恢复诊断', exact: true }).waitFor()
    expect(await checkpoint.innerText()).not.toContain('secret-read-error')
    expect(await checkpoint.getByRole('region', { name: '检查点／恢复诊断', exact: true }).innerText()).toBe(priorDiagnostic)
    expect(errors.pageErrors).toEqual([])
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), await page.locator('body').innerText())
    throw cause
  } finally { fault.failCheckpointRead = false; probe.release(); await browser.close(); await scaffold.close() }
})
