/** Real Host metadata browsing, deep links and responsive rendering without management or inference. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { simulationChangeSchema, simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { readFileSync } from 'node:fs'
import { simulationReadPresentation } from './simulation-read-presentation.ts'
import { createNativeZoomContext } from './browser-native-zoom.ts'

it.each(['json', 'sqlite'] as const)('browses registered simulations through the opt-in real server and preserves bounded collection state (%s)', async (backend) => {
  const root = join(process.cwd(), '.tmp-simulation-plan/web-browser')
  await mkdir(root, { recursive: true })
  const overlay = join(process.cwd(), 'examples/headless-agent/tests/fixtures/simulation/simulation-web/cordis.yml')
  const config = JSON.parse(readFileSync(overlay, 'utf8')) as { insert: { config?: { root?: string; backend?: string; imports?: { spec: unknown }[] } }[] }[]
  const local = config[0]?.insert[1]?.config
  if (local === undefined) throw new Error('Simulation browser fixture has no configured local provider')
  local.backend = backend
  local.root = await mkdtemp(join(root, `${backend}-world-`))
  const importedSpec = config[0]!.insert[2]!.config!.imports![0]!.spec as { relationRules: unknown[] }
  importedSpec.relationRules = [{ relation: 'supplies', subjectKinds: ['org'], objectKinds: ['org'], scopeKinds: ['org'], acyclic: false }]
  const configuredOverlay = join(local.root, 'overlay.json')
  await writeFile(configuredOverlay, JSON.stringify(config))
  const scaffold = await launchWebScaffold({ extraOverlayPath: configuredOverlay, tempRoot: root, productPrincipalId: 'simulation-browser-user' })
  const { context, setNativeZoom } = await createNativeZoomContext(root, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchConsole(page)
  const statuses: string[][] = []
  let objectReads = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/simulation.objects.inspect') objectReads++
    if (new URL(request.url()).pathname === '/api/simulation.runs.statuses') {
      statuses.push((request.postDataJSON() as { payload: { runIds: string[] } }).payload.runIds)
    }
  })
  const replies: unknown[] = []
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/simulation.')) {
      void response.json().then((value) => { replies.push(value) }, (cause: unknown) => {
        // Diagnostic copies may retire when view reads are cancelled or the page
        // reloads; the runtime still validates every consumed response itself.
        replies.push({ path: new URL(response.url()).pathname, diagnosticBodyUnavailable: String(cause) })
      })
    }
  })
  const spec = simulationRunSpecSchema.parse(config[0]?.insert[2]?.config?.imports?.[0]?.spec)
  let run: SimulationRun | undefined
  try {
    run = await scaffold.ctx.simulations.open(scaffold.ctx.simulations.resolve({ provider: 'local', spec, mode: 'create' }))
    await run.setPhase('running', 0)
    for (const id of ['仓储中心', '采购人员', '运输组织']) {
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'org', cognition: 'none',
        profile: { name: `${id}：${'长名称供应链上下文。'.repeat(16)}`, secret: 'private-world-body' } }), run.snapshot().revision)
    }
    for (const id of ['source-a', 'source-b', 'source-c']) {
      await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id, relation: 'supplies', subject: '运输组织', object: '采购人员',
        scope: '仓储中心', validFrom: '0', validUntil: '9007199254740994' }), run.snapshot().revision)
    }
    await run.drive({ until: '9007199254740993' as never })
    const before = run.snapshot()
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('heading', { name: '仿真', exact: true }).waitFor()
    await workspace.getByRole('button').filter({ hasText: '物流仿真' }).waitFor()
    expect(await workspace.locator('li').count()).toBe(2)
    const row = workspace.locator('li').filter({ hasText: '物流仿真' })
    await row.getByText('9007199254740993 minute', { exact: true }).waitFor()
    await row.getByText('运行详情', { exact: true }).click()
    await row.getByText('规则版本', { exact: true }).waitFor()
    await row.getByText('策略版本', { exact: true }).waitFor()
    await row.getByText('运行详情', { exact: true }).click()
    expect(statuses.length).toBeGreaterThan(0)
    expect(statuses[0]).toHaveLength(2)
    await page.route('**/api/simulation.runs.statuses', route => route.abort('failed'))
    await workspace.getByRole('button', { name: '刷新运行状态', exact: true }).click()
    await workspace.getByText('保留的观察可能已过期，请刷新核对。', { exact: true }).first().waitFor()
    expect(await row.getByText('9007199254740993 minute', { exact: true }).count()).toBe(1)
    await page.unroute('**/api/simulation.runs.statuses')
    await workspace.getByRole('button', { name: '刷新运行状态', exact: true }).click()
    await expect.poll(async () => await workspace.getByText('保留的观察可能已过期，请刷新核对。', { exact: true }).count()).toBe(0)
    await page.screenshot({ path: join(root, '01-runs-desktop.png'), animations: 'disabled' })
    await simulationReadPresentation(page, root, `${backend}-runs`, setNativeZoom)
    await workspace.getByRole('button').filter({ hasText: '物流仿真' }).click()
    await workspace.getByText('9007199254740993 minute', { exact: true }).waitFor()
    await workspace.getByText('当前查看部署未提供运行管理。', { exact: true }).waitFor()
    await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '实体', exact: true }).click()
    await workspace.getByRole('table').getByRole('button', { name: '查看详情' }).first().waitFor()
    expect(objectReads).toBe(0)
    const headerStatus = workspace.getByRole('region', { name: '当前仿真状态', exact: true })
    await headerStatus.getByText('9007199254740993 minute', { exact: true }).waitFor()
    await headerStatus.getByText('浏览器连接', { exact: true }).waitFor()
    expect(await workspace.getByRole('table').getByRole('row').count()).toBe(3)
    await workspace.getByRole('button', { name: '筛选状态', exact: true }).click()
    await page.getByRole('menuitem', { name: '停用', exact: true }).click()
    await workspace.getByText('没有符合筛选条件的记录。', { exact: true }).waitFor()
    expect(new URL(page.url()).searchParams.get('simulationStatus')).toBe('inactive')
    await page.reload({ waitUntil: 'load' })
    await workspace.getByText('没有符合筛选条件的记录。', { exact: true }).waitFor()
    await workspace.getByRole('button', { name: '清除筛选', exact: true }).click()
    await expect.poll(async () => await workspace.getByRole('table').getByRole('row').count()).toBe(3)
    await workspace.getByRole('button', { name: '筛选认知模式', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Agent', exact: true }).click()
    await workspace.getByText('没有符合筛选条件的记录。', { exact: true }).waitFor()
    await workspace.getByRole('button', { name: '清除筛选', exact: true }).click()
    await expect.poll(async () => await workspace.getByRole('table').getByRole('row').count()).toBe(3)
    await workspace.getByRole('button', { name: '下一页', exact: true }).click()
    await expect.poll(async () => await workspace.getByRole('table').getByRole('row').count()).toBe(2)
    await workspace.getByRole('button', { name: /^查看详情:/ }).click()
    await workspace.getByRole('complementary', { name: '查看详情' }).getByRole('button', { name: '复制完整 ID' }).waitFor()
    const relationships = workspace.getByRole('complementary', { name: '查看详情' })
    expect(await relationships.getByRole('heading', { level: 2 }).evaluate(element => element === document.activeElement)).toBe(true)
    await relationships.getByRole('button', { name: '展开名称', exact: true }).click()
    await relationships.getByRole('button', { name: '收起名称', exact: true }).click()
    await relationships.getByRole('button', { name: '关系', exact: true }).click()
    await relationships.getByText('匹配记录: 3', { exact: true }).waitFor()
    await relationships.getByText('9007199254740994', { exact: true }).first().waitFor()
    await relationships.getByRole('button', { name: '下一页', exact: true }).click()
    await expect.poll(async () => await relationships.locator('li').count()).toBe(1)
    await page.reload({ waitUntil: 'load' })
    await relationships.getByText('匹配记录: 3', { exact: true }).waitFor()
    expect(new URL(page.url()).searchParams.get('simulationSection')).toBe('relationships')
    await relationships.getByRole('button', { name: '身份', exact: true }).click()
    const selectedEntity = new URL(page.url()).searchParams.get('simulationObject')
    await workspace.getByRole('complementary', { name: '查看详情' }).getByRole('button', { name: '查看实体决策', exact: true }).click()
    await workspace.getByText('没有符合筛选条件的记录。', { exact: true }).waitFor()
    expect(new URL(page.url()).searchParams.get('simulationEntity')).toBe(selectedEntity)
    await page.goBack()
    await workspace.getByRole('complementary', { name: '查看详情' }).getByRole('button', { name: '复制完整 ID' }).waitFor()
    expect(await workspace.textContent()).not.toContain('private-world-body')
    await page.screenshot({ path: join(root, '02-entity-desktop.png'), animations: 'disabled' })
    await simulationReadPresentation(page, root, `${backend}-entities`, setNativeZoom)
    const entityUrl = page.url()
    const workspaceNavigation = page.getByRole('navigation', { name: '工作区', exact: true })
    await workspaceNavigation.getByRole('button', { name: '团队工作', exact: true }).click()
    await workspace.waitFor({ state: 'hidden' })
    await workspaceNavigation.getByRole('button', { name: '仿真', exact: true }).click()
    await workspace.getByRole('complementary', { name: '查看详情' }).getByRole('button', { name: '复制完整 ID' }).waitFor()
    expect(page.url()).toBe(entityUrl)
    expect(await workspaceNavigation.getByRole('button', { name: '仿真', exact: true }).getAttribute('aria-current')).toBe('page')

    for (const [module, title] of [['overview', '概览'], ['decisions', '决策'], ['operations', '操作'], ['checkpoints', '检查点']] as const) {
      await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: title, exact: true }).click()
      await expect.poll(() => workspace.getByRole('button', { name: '刷新', exact: true }).isEnabled()).toBe(true)
      expect(new URL(page.url()).searchParams.get('simulationModule')).toBe(module === 'overview' ? null : module)
      await simulationReadPresentation(page, root, `${backend}-${module}`, setNativeZoom)
    }
    await page.evaluate((url) => { window.history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')) }, entityUrl)
    await page.reload({ waitUntil: 'load' })
    await workspace.getByRole('complementary', { name: '查看详情' }).getByRole('button', { name: '复制完整 ID' }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => {
      const box = await workspace.getByRole('button', { name: '返回集合', exact: true }).boundingBox()
      return box !== null && box.x >= 0 && box.x + box.width <= 390
    }).toBe(true)
    const modulePicker = workspace.getByRole('button', { name: '仿真模块: 实体', exact: true })
    await expect.poll(async () => {
      const box = await modulePicker.boundingBox()
      return box !== null && box.y + box.height < 300
    }).toBe(true)
    await modulePicker.click()
    await page.getByRole('menuitem', { name: '检查点', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    expect(await modulePicker.evaluate(element => element === document.activeElement)).toBe(true)
    expect(await workspace.getByRole('table').isVisible()).toBe(false)
    await page.screenshot({ path: join(root, '03-entity-narrow.png'), animations: 'disabled' })
    await workspace.getByRole('button', { name: '返回集合', exact: true }).click()
    await workspace.getByRole('table').waitFor()
    expect(await workspace.locator('[data-simulation-object]:focus, [data-simulation-filters] button:focus').count()).toBe(1)
    expect(run.snapshot()).toEqual(before)
    expect(errors.pageErrors).toEqual([])
    expect(errors.warnings).toEqual([])
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') })
    await writeFile(join(root, 'failure.txt'), JSON.stringify({ body: await page.locator('body').innerText(), errors, replies }, null, 2))
    throw cause
  } finally { await run?.close(); await page.close(); await context.close(); await scaffold.close() }
}, 360000)
