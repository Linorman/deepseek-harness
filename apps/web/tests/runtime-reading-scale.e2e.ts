/** Fixed high-cardinality data exercises the existing bounded directory/history readers without inference. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { simulationInstalledCompanyTemplateSchema } from '../../../packages/simulation/simulation-product/src/creation-schema.ts'
import { simulationProductRecordSchema } from '../../../packages/simulation/simulation-product/src/directory.ts'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

it('bounds 100 durable directory records and long history while repeated workspace switches retire their observers', async () => {
  const root = join(REPO_ROOT, '.tmp/web-runtime-20261007')
  await mkdir(root, { recursive: true })
  const scaffold = await launchWebScaffold({ tempRoot: root, legacyWorkspaceSurface: true, productPrincipalId: 'runtime-scale-owner' })
  const templates = scaffold.ctx.simulationAdministration as unknown as { templates: Map<string, unknown> }
  const template = simulationInstalledCompanyTemplateSchema.parse(templates.templates.get('company-procurement-v1'))
  const register = scaffold.ctx.simulationProducts.creationRegistrar()
  for (let index = 0; index < 100; index++) {
    const id = `runtime-scale-${String(index).padStart(3, '0')}`
    await register(simulationProductRecordSchema.parse({ id, name: `Scale run ${String(index).padStart(3, '0')}`,
      provider: template.provider, ownerPrincipalId: 'runtime-scale-owner', registeredAt: index,
      spec: { ...template.spec, runId: id } }))
  }
  const history = createChatScrollFixture({ markerPrefix: 'RUNTIME_SCALE', title: 'RUNTIME_SCALE_LONG_HISTORY', turns: 500 })
  await seedSession(scaffold, history.log, 'runtime-scale-long-session')
  await writeFile(join(root, 'runtime-scale-history.jsonl'), history.log)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'en-US', reducedMotion: 'reduce' })
  const errors = watchConsole(page)
  const reads: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (/simulation\.(runs\.list|changes\.watch|objects\.inspect)|session\.history/.test(path)) reads.push(path)
  })
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl)
    await page.getByRole('button', { name: 'Simulations', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await expect.poll(() => workspace.locator('li').count()).toBe(32)
    const windows: number[] = [32]
    for (let index = 0; index < 3; index++) {
      await workspace.getByRole('button', { name: 'Next page', exact: true }).click()
      const expected = index === 2 ? 4 : 32
      await expect.poll(() => workspace.locator('li').count()).toBe(expected)
      windows.push(expected)
    }
    expect(windows).toEqual([32, 32, 32, 4])
    await page.getByRole('button', { name: 'Team work', exact: true }).click()
    await page.getByText('Ungrouped', { exact: true }).waitFor()
    const search = page.getByRole('button', { name: 'Search sessions', exact: true })
    await search.click()
    await page.getByPlaceholder('Search sessions', { exact: false }).fill(history.markers.user(500))
    const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
    await expect.poll(() => result.count()).toBe(1)
    await result.click()
    await page.getByText(history.markers.assistant(500), { exact: false }).first().waitFor()
    const visibleTurns = await page.evaluate(() => new Set([...document.body.innerText.matchAll(
      /CHAT_SCROLL_RUNTIME_SCALE_(?:USER|ASSISTANT)_(\d+)/g,
    )].map(match => match[1])).size)
    expect(visibleTurns).toBeGreaterThan(0)
    expect(visibleTurns).toBeLessThan(500)
    const watchers = () => (scaffold.ctx.simulationProducts as unknown as { watchers: Set<unknown> }).watchers.size
    await expect.poll(watchers).toBe(0)
    const initial = watchers()
    const client = await page.context().newCDPSession(page)
    await client.send('HeapProfiler.collectGarbage')
    const warm = await client.send('Memory.getDOMCounters')
    for (let index = 0; index < 20; index++) {
      await page.getByRole('button', { name: 'Simulations', exact: true }).click()
      await workspace.waitFor()
      await page.getByRole('button', { name: 'Team work', exact: true }).click()
    }
    await expect.poll(watchers).toBe(initial)
    await client.send('HeapProfiler.collectGarbage')
    const retained = await client.send('Memory.getDOMCounters')
    expect(reads.filter(path => path === '/api/simulation.objects.inspect')).toEqual([])
    expect(errors.pageErrors).toEqual([])
    await writeFile(join(root, 'runtime-reading-scale.json'), JSON.stringify({ records: 100, historyTurns: history.turns,
      directoryWindows: windows, visibleTurns, watchersBefore: initial, watchersAfter: watchers(), warm, retained, reads,
      browser: browser.version(), errors }, null, 2))
    await page.screenshot({ path: join(root, 'runtime-reading-scale.png') })
  } catch (error) {
    await writeFile(join(root, 'runtime-reading-scale-failure.txt'), await page.locator('body').innerText())
    await page.screenshot({ path: join(root, 'runtime-reading-scale-failure.png') })
    throw error
  } finally { await browser.close(); await scaffold.close() }
}, 90_000)
