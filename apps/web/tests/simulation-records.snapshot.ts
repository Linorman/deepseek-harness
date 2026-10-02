/** Real journal browsing and complete downloads preserve native state and obey independent body permission. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Route as BrowserRoute } from 'playwright'
import { expect, it } from 'vitest'
import { simulationChangeSchema, simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-product'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { simulationReadPresentation } from './simulation-read-presentation.ts'
import { createNativeZoomContext } from './browser-native-zoom.ts'

it.each(['json', 'sqlite'] as const)('browses, filters and exports authorized original journals through the Web (%s)', async (backend) => {
  const root = join(process.cwd(), '.tmp/simulation-records-browser', backend)
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'run-'))
  const config = JSON.parse(await readFile('examples/headless-agent/tests/fixtures/simulation/simulation-web/cordis.yml', 'utf8')) as {
    insert: { name: string; config?: Record<string, unknown> }[] }[]
  const entries = config[0]!.insert
  const local = entries.find(row => row.name === '@clocky/clocky-simulation-local')!
  local.config = { ...local.config, root: join(directory, 'world'), backend }
  const products = entries.find(row => row.name === '@clocky/clocky-simulation-product')!
  products.config = { ...products.config, maxContextPartBytes: 64 }
  const imports = products.config.imports as { spec: unknown }[]
  const spec = simulationRunSpecSchema.parse(imports[0]!.spec)
  const overlay = join(directory, 'overlay.json'); await writeFile(overlay, JSON.stringify(config))
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay, tempRoot: directory, productPrincipalId: 'simulation-browser-user' })
  const { context, setNativeZoom } = await createNativeZoomContext(directory, { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = watchConsole(page)
  let run: SimulationRun | undefined, remove: (() => void) | undefined
  try {
    run = await scaffold.ctx.simulations.open(scaffold.ctx.simulations.resolve({ provider: 'local', spec, mode: 'create' }))
    for (const id of ['one', 'two', 'three']) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id,
      entityKind: 'org', cognition: 'none', profile: { name: id, secret: '原始私有🙂记录' } }), run.snapshot().revision)
    const before = run.snapshot()
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('button').filter({ hasText: '物流仿真' }).click()
    await workspace.getByRole('navigation', { name: '仿真模块' }).getByRole('button', { name: '记录', exact: true }).click()
    const records = workspace.getByRole('region', { name: '记录', exact: true })
    await records.getByRole('table').getByRole('button', { name: /^查看原始记录:/ }).first().waitFor()
    expect(await records.getByRole('table').getByRole('row').count()).toBe(3)
    expect(await records.getByRole('button', { name: '导出筛选后的原文', exact: true }).isDisabled()).toBe(true)
    const metadataDownload = page.waitForEvent('download')
    await records.getByRole('button', { name: '导出筛选后的元数据', exact: true }).click()
    const metadataPath = await (await metadataDownload).path()
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { records: unknown[] }
    expect(metadata.records).toHaveLength(4)
    expect(JSON.stringify(metadata)).not.toContain('原始私有')
    await records.getByRole('button', { name: /^查看原始记录:/ }).first().click()
    const detail = workspace.getByRole('complementary', { name: '查看原始记录', exact: true })
    await detail.getByText('原文需要部署授予独立的整运行历史读取权限，当前仅显示元数据。', { exact: true }).waitFor()
    remove = scaffold.ctx.simulationProducts.recordReaderRegistrar()([{ principalId: 'simulation-browser-user' as never }])
    await detail.locator('pre').first().waitFor()
    await detail.getByRole('button', { name: '返回集合', exact: true }).click()
    expect(await records.locator('[data-record-sequence]:focus').count()).toBe(1)
    await records.getByLabel('记录类型', { exact: true }).fill(' extension/custom ')
    await records.getByRole('button', { name: '搜索', exact: true }).click()
    await records.getByText('没有符合筛选条件的记录。', { exact: true }).waitFor()
    expect(new URL(page.url()).searchParams.get('simulationRecordKind')).toBe(' extension/custom ')
    await records.getByRole('button', { name: '常见记录类型', exact: true }).click()
    await page.getByRole('menuitem', { name: '世界变更 · run/change', exact: true }).click()
    expect(await records.getByLabel('记录类型', { exact: true }).inputValue()).toBe('run/change')
    await expect.poll(() => new URL(page.url()).searchParams.get('simulationRecordKind')).toBe('run/change')
    await expect.poll(() => records.getByRole('button', { name: '导出筛选后的原文', exact: true }).isEnabled()).toBe(true)
    const originalDownload = page.waitForEvent('download')
    await records.getByRole('button', { name: '导出筛选后的原文', exact: true }).click()
    const originalPath = await (await originalDownload).path()
    const original = JSON.parse(await readFile(originalPath, 'utf8')) as { records: { sequence: number; value: unknown }[] }
    expect(original.records.map(row => row.sequence)).toEqual([1, 2, 3])
    expect(JSON.stringify(original)).toContain('原始私有🙂记录')
    const held = Promise.withResolvers<undefined>()
    const intercepted = Promise.withResolvers<undefined>()
    const hold = async (route: BrowserRoute) => {
      const request = route.request().postDataJSON() as { payload: { mode: string; cursor?: string } }
      if (request.payload.mode === 'metadata' && request.payload.cursor !== undefined) {
        intercepted.resolve(undefined); await held.promise; await route.abort('failed')
      } else await route.continue()
    }
    let cancelledDownloads = 0
    const countDownload = () => { cancelledDownloads++ }
    page.on('download', countDownload)
    await page.route('**/api/simulation.records.list', hold)
    try {
      await records.getByRole('button', { name: '导出筛选后的元数据', exact: true }).click()
      await intercepted.promise
      await records.getByRole('button', { name: '取消导出', exact: true }).click()
      held.resolve(undefined)
      await records.getByText(/^导出已取消，未生成文件/).waitFor()
      expect(cancelledDownloads).toBe(0)
    } finally { held.resolve(undefined); await page.unroute('**/api/simulation.records.list', hold); page.off('download', countDownload) }
    let failNext = true
    await page.route('**/api/simulation.records.list', async (route) => {
      const request = route.request().postDataJSON() as { payload: { mode: string; cursor?: string } }
      if (failNext && request.payload.mode === 'metadata' && request.payload.cursor !== undefined) {
        failNext = false; await route.abort('failed')
      } else await route.continue()
    })
    await records.getByRole('button', { name: '下一页', exact: true }).click()
    await records.getByRole('alert').waitFor()
    expect(await records.getByRole('table').getByRole('row').count()).toBe(3)
    await records.getByRole('button', { name: '返回首页', exact: true }).click()
    await expect.poll(() => records.getByRole('alert').count()).toBe(0)
    await records.getByRole('button', { name: '下一页', exact: true }).click()
    await expect.poll(() => records.getByRole('table').getByRole('row').count()).toBe(2)
    await records.getByRole('button', { name: /^查看原始记录:/ }).click()
    await detail.locator('pre').first().waitFor()
    expect(new URL(page.url()).searchParams.get('simulationSequence')).toBe('3')
    await page.reload({ waitUntil: 'load' })
    await detail.locator('pre').first().waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => (await detail.boundingBox())?.width ?? 0, { timeout: 5000 }).toBeGreaterThan(250)
    await detail.getByRole('button', { name: '下一页', exact: true }).click()
    await detail.getByText('正文片段: 3 / 4', { exact: true }).waitFor()
    await page.screenshot({ path: join(root, 'records-narrow.png') })
    await simulationReadPresentation(page, root, `${backend}-records`, setNativeZoom)
    remove?.(); remove = undefined
    // Policy watches may be between their configured two-second retries after reload.
    await expect.poll(() => detail.locator('pre').count(), { timeout: 15000 }).toBe(0)
    await detail.getByText('原文需要部署授予独立的整运行历史读取权限，当前仅显示元数据。', { exact: true }).waitFor()
    await detail.getByRole('button', { name: '返回集合', exact: true }).click()
    expect(await records.getByRole('button', { name: '导出筛选后的原文', exact: true }).isDisabled()).toBe(true)
    expect(run.snapshot()).toEqual(before)
    expect(errors.pageErrors).toEqual([])
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
  } catch (cause: unknown) {
    await page.screenshot({ path: join(root, 'failure.png') }); throw cause
  } finally { remove?.(); await context.close(); await run?.close(); await scaffold.close() }
}, 240000)
