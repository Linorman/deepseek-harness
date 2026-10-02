/** Real source navigation intersects Simulation disclosure and current Team membership without starting inference. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { simulationChangeSchema, simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWriterLease } from '@clocky/clocky-simulation'
import type { TeamEnvelope, TeamStateSnapshot } from '@clocky/clocky-team'
import { contextRequest } from '../../../packages/simulation/simulation-local/tests/context-fixture.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { simulationReadPresentation } from './simulation-read-presentation.ts'
import { createNativeZoomContext } from './browser-native-zoom.ts'
import type {} from '@clocky/clocky-simulation-product'

it.each(['json', 'sqlite'] as const)('reads frozen source links and clears text after independent Team revocation (%s)', async (backend) => {
  const root = join(process.cwd(), '.tmp/simulation-source-ui', backend)
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'run-'))
  const config = JSON.parse(await readFile('examples/headless-agent/tests/fixtures/simulation/simulation-web/cordis.yml', 'utf8')) as {
    insert: { name: string; config?: Record<string, unknown> }[] }[]
  const local = config[0]!.insert.find(row => row.name === '@clocky/clocky-simulation-local')!
  local.config = { ...local.config, root: join(directory, 'world'), backend }
  const product = config[0]!.insert.find(row => row.name === '@clocky/clocky-simulation-product')!
  product.config = { ...product.config, maxContextPartBytes: 8 }
  const imported = (product.config.imports as { id: string; spec: unknown }[])[0]!
  const spec = simulationRunSpecSchema.parse(imported.spec)
  const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(config))
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay, tempRoot: directory, productPrincipalId: 'simulation-browser-user' })
  const { context, setNativeZoom } = await createNativeZoomContext(root, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchConsole(page)
  const rpc = async <T>(method: string, payload: unknown): Promise<T> => {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${response.result.error.message}`)
    return response.result.value
  }
  let run: SimulationRun | undefined
  let lease: SimulationWriterLease | undefined, remove: (() => void) | undefined
  try {
    const team = await rpc<TeamStateSnapshot>('team.create', { objective: '来源权限验证', cwd: scaffold.workspaceCwd })
    const human = team.participants.find(member => member.kind === 'human')!
    const coordinator = team.participants.find(member => member.role === 'coordinator')!
    const binding = team.activations.find(value => value.activation.participantId === coordinator.id)!
    const channelId = team.channelIds[0]!
    let original: TeamEnvelope | undefined
    for (const text of ['无关消息', '授权原文🙂第一段。授权原文第二段。']) original = await rpc<TeamEnvelope>('team.channel.post', {
      channelId, expectedCursor: (await scaffold.ctx.teams.getChannel({ channelId })).cursor,
      audience: [coordinator.id], delivery: 'context', kind: 'message', payload: { content: [{ type: 'text', text }] },
    })
    if (original === undefined) throw new Error('No original message')
    run = await scaffold.ctx.simulations.open(scaffold.ctx.simulations.resolve({ provider: 'local', spec, mode: 'create' }))
    await run.setPhase('running', 0)
    const entityId = 'source-reader' as never
    const decisionId = 'source-decision' as never
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entityId, entityKind: 'person',
      cognition: 'agent', profile: {} }), run.snapshot().revision)
    await run.bindEntity(entityId, { teamId: team.team.id, participantId: coordinator.id,
      sessionId: binding.sessionId }, run.snapshot().revision)
    lease = await run.reserveWriter(entityId, 'in-process', 'source-reservation' as never, run.snapshot().revision)
    lease.bindDecisionAdmission(async () => {})
    await lease.activate({ teamId: team.team.id, participantId: coordinator.id, sessionId: binding.sessionId,
      provider: 'in-process', reservationId: 'source-reservation' as never, activationId: binding.activation.id })
    await lease.openDecision(decisionId, run.snapshot().revision)
    const context = contextRequest()
    context.teamCursor = (await scaffold.ctx.teams.getTeam({ teamId: team.team.id })).team.cursor
    context.sources.push({ kind: 'team-envelope', teamId: team.team.id, channelId, envelopeId: original.id })
    await lease.prepareContext(decisionId, context)
    const before = run.snapshot()
    const turns = () => scaffold.ctx.sessions.get(binding.sessionId)?.events.filter(event => event.type === 'turn/start').length ?? 0
    expect(turns()).toBe(0)
    await scaffold.authenticateBrowserPage(page)
    await page.goto(`${scaffold.baseUrl}/?workspace=simulation&simulation=${imported.id}&simulationModule=decisions&simulationObject=source-decision&simulationSection=context`)
    const workspace = page.locator('[data-simulation-workspace-page]')
    const contextPane = workspace.getByRole('complementary', { name: '查看详情', exact: true })
    for (let round = 0; round < 30; round++) {
      await expect.poll(async () => await contextPane.getByRole('button', { name: original.id, exact: true }).count() > 0
        || await contextPane.getByRole('button', { name: '下一页', exact: true }).isEnabled().catch(() => false)).toBe(true)
      if (await contextPane.getByRole('button', { name: original.id, exact: true }).count() > 0) break
      await contextPane.getByRole('button', { name: '下一页', exact: true }).click()
    }
    await workspace.getByRole('button', { name: original.id, exact: true }).click()
    const source = workspace.getByRole('region', { name: '来源原文', exact: true })
    await source.getByText('当前不能读取原文，需要同时具有仿真来源授权和 Team 读取权限。', { exact: true }).waitFor()
    expect(new URL(page.url()).searchParams.get('simulationSource')).toBe('0')
    remove = scaffold.ctx.simulationProducts.contextReaderRegistrar()([{ principalId: 'simulation-browser-user' as never,
      entityIds: [entityId], content: ['sources'] }])
    const locate = async () => {
      for (let round = 0; round < 30; round++) {
        await expect.poll(async () => await source.locator('pre').count() > 0
          || await source.getByRole('button', { name: '继续定位来源', exact: true }).isEnabled().catch(() => false), { timeout: 15000 }).toBe(true)
        if (await source.locator('pre').count() > 0) return
        await source.getByRole('button', { name: '继续定位来源', exact: true }).click()
      }
      throw new Error('Source lookup did not finish')
    }
    await locate()
    const sourceUrl = page.url()
    const teamWorkspace = page.locator('[data-team-workspace-page]')
    await page.route('**/api/team.selection', route => route.abort('failed'))
    await source.getByRole('link', { name: `查看关联 Team: ${team.team.id}`, exact: true }).click()
    await page.getByText('目标读取失败，请检查连接后重试。', { exact: true }).waitFor()
    expect(await teamWorkspace.count()).toBe(0)
    await page.unroute('**/api/team.selection')
    await page.getByRole('button', { name: '重试读取目标', exact: true }).click()
    await teamWorkspace.getByRole('heading', { name: '来源权限验证', exact: true }).waitFor()
    await teamWorkspace.getByRole('navigation', { name: '来源上下文', exact: true }).getByText('来自仿真运行', { exact: true }).waitFor()
    const origin = teamWorkspace.getByRole('navigation', { name: '来源上下文', exact: true })
    await origin.locator('summary').click()
    await origin.getByText(imported.id, { exact: true }).waitFor()
    await origin.getByText('source-decision', { exact: true }).waitFor()
    await origin.locator('summary').click()
    expect(new URL(page.url()).searchParams.get('team')).toBe(team.team.id)
    expect(new URL(page.url()).searchParams.has('simulation')).toBe(false)
    await page.goBack()
    await locate()
    expect(page.url()).toBe(sourceUrl)
    await expect.poll(() => source.getByRole('link', { name: `查看关联 Team: ${team.team.id}`, exact: true })
      .evaluate(element => element === document.activeElement)).toBe(true)
    await source.getByRole('link', { name: `查看关联 Team 频道: ${channelId}`, exact: true }).click()
    await teamWorkspace.getByRole('heading', { name: '来源权限验证', exact: true }).waitFor()
    await expect.poll(() => new URL(page.url()).searchParams.get('channel')).toBe(channelId)
    await teamWorkspace.getByRole('button', { name: '返回来源', exact: true }).click()
    await locate()
    expect(page.url()).toBe(sourceUrl)
    // Entity Session links preserve the exact binding and use the existing authorized inspection path.
    await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '实体', exact: true }).click()
    await workspace.getByRole('table').getByRole('button', { name: /^查看详情:/ }).click()
    const entityPane = workspace.getByRole('complementary', { name: '查看详情', exact: true })
    const entityUrl = page.url()
    await entityPane.getByRole('link', { name: `查看精确 Team Session: ${binding.sessionId}`, exact: true }).click()
    await page.locator('dialog[data-inspecting][open]').waitFor()
    expect(new URL(page.url()).searchParams.get('session')).toBe(binding.sessionId)
    expect(new URL(page.url()).searchParams.get('participant')).toBe(coordinator.id)
    await page.goBack()
    await entityPane.getByRole('link', { name: `查看精确 Team Session: ${binding.sessionId}`, exact: true }).waitFor()
    expect(page.url()).toBe(entityUrl)
    const historical = new URL(await entityPane.getByRole('link', { name: `查看精确 Team Session: ${binding.sessionId}`, exact: true }).getAttribute('href') ?? '')
    historical.searchParams.set('session', 'historical-binding-mismatch')
    await page.goto(historical.href, { waitUntil: 'load' })
    await page.getByText('此历史会话与所选成员的当前绑定不匹配，未打开其他会话。', { exact: true }).waitFor()
    expect(await page.locator('dialog[data-inspecting][open]').count()).toBe(0)
    await page.screenshot({ path: join(root, 'historical-binding-refused.png') })
    await page.goBack()
    await entityPane.getByRole('link', { name: `查看精确 Team Session: ${binding.sessionId}`, exact: true }).waitFor()
    expect(turns()).toBe(0)
    expect(run.snapshot()).toEqual(before)
    await page.evaluate((url) => { window.history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')) }, sourceUrl)
    await locate()
    await source.getByRole('button', { name: '下一页', exact: true }).click()
    await source.getByText(/^正文片段: 3 /).waitFor()
    const textPage = await source.locator('pre').allTextContents()
    await expect.poll(async () => await source.getByRole('button', { name: '刷新详情', exact: true }).isEnabled()).toBe(true)
    // World advancement must not reset an immutable source page or invalidate its continuation.
    await run.setPhase('paused', run.snapshot().revision)
    await source.getByRole('button', { name: '下一页', exact: true }).click()
    await source.getByText(/^正文片段: 5 /).waitFor()
    expect(await source.locator('pre').allTextContents()).not.toEqual(textPage)
    const afterAdvance = run.snapshot()
    await page.reload({ waitUntil: 'load' })
    await locate()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => (await source.boundingBox())?.width ?? 0, { timeout: 5000 }).toBeGreaterThan(250)
    await expect.poll(async () => (await workspace.boundingBox())?.x ?? 1000, { timeout: 5000 }).toBeLessThan(65)
    await source.locator('pre').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(root, 'source-narrow.png') })
    await simulationReadPresentation(page, root, `${backend}-sources`, setNativeZoom)
    await rpc('team.member.remove', { teamId: team.team.id, participantId: human.id,
      expectedCursor: (await scaffold.ctx.teams.getTeam({ teamId: team.team.id })).team.cursor })
    await expect.poll(() => source.locator('pre').count(), { timeout: 15000 }).toBe(0)
    await source.getByText('当前不能读取原文，需要同时具有仿真来源授权和 Team 读取权限。', { exact: true }).waitFor()
    await source.getByRole('link', { name: `查看关联 Team: ${team.team.id}`, exact: true }).click()
    const deniedTarget = page.locator('[data-team-navigation-error]')
    await deniedTarget.getByText('当前身份无法访问此目标，请核对访问权限或重新连接。', { exact: true }).waitFor()
    expect(await page.locator('[data-team-workspace-page]').count()).toBe(0)
    await deniedTarget.getByRole('button', { name: '返回来源', exact: true }).click()
    await source.getByText('当前不能读取原文，需要同时具有仿真来源授权和 Team 读取权限。', { exact: true }).waitFor()
    expect(await source.locator('pre').count()).toBe(0)

    expect(run.snapshot()).toEqual(afterAdvance)
    expect(before.phase).toBe('running')
    expect(turns()).toBe(0)
    expect(errors.pageErrors).toEqual([])
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), await page.locator('body').innerText())
    throw cause
  } finally { remove?.(); await context.close(); await lease?.revoke(); await lease?.release(); await run?.close(); await scaffold.close() }
}, 240000)
