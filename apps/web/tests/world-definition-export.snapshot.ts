/** Browser plugin not available: actual product exports feed the file chooser without transferring runtime ownership. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { z } from 'zod'
import { expect, it } from 'vitest'
import { decodeScenarioInput, worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationProductWorldPreflightResult } from '@clocky/clocky-simulation-product/types'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it.each(['json', 'sqlite'] as const)('exports original definitions and reimports them through the real %s browser', async (backend) => {
  const parent = resolve('.local/world-completion/c34-world-export', backend)
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'browser-'))
  const metadata: unknown = await import(pathToFileURL(resolve('examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts')).href)
  const installed = z.object({ worldV1Catalog: scenarioV1CatalogSchema, worldV1Definition: worldScenarioV1Schema }).parse(metadata)
  const model: unknown = await import(pathToFileURL(resolve('examples/simulation-company/tests/world-external-mediated-model.ts')).href)
  const calls = z.object({ mediatedModelRequests: z.custom<unknown[]>(Array.isArray) }).parse(model).mediatedModelRequests
  const definition = installed.worldV1Definition, beforeCalls = calls.length
  const overlays = [{ insert: [
    { name: '@clocky/clocky-simulation' },
    { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
    { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
      maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
    { name: '@clocky/clocky-tool-simulation' },
    { name: resolve('examples/simulation-company/tests/world-external-mediated-model.ts') },
    { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'export-directory', imports: [] } },
    { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'export-commands', templates: [],
      world: { provider: 'local', catalog: installed.worldV1Catalog, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 },
        authoringTemplates: [{ id: 'export-v1', version: '1', name: '可移植定义', definition }] } } },
    { name: '@clocky/clocky-client-ui-simulation' },
  ] }, { id: 'modules', config: { browserConfig: {
    '@clocky/clocky-client-ui-simulation': { maxWorldDrafts: 8, controlRefreshMs: 50 },
  } } }]
  const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify(overlays))
  const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
    retainedWorld: { workspaceCwd: join(root, 'workspace'), persistenceRoot: join(root, 'sessions') },
    productPrincipalId: 'world-export-user', agentPresets: { default: 'simulation',
      roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' }] } })
  let owned: SimulationRun | undefined
  const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
  scaffold.ctx.simulations.open = async (...args) => { owned = await open(...args); return owned }
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(10000); page.on('dialog', (dialog) => { void dialog.accept() })
  const errors = watchConsole(page), createRequests: unknown[] = [], restoreRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/simulation.world.create')) createRequests.push(request.postDataJSON())
    if (/\/api\/simulation\.[^/]*restore/.test(request.url())) restoreRequests.push(request.url())
  })
  const workspace = page.locator('[data-simulation-workspace-page]')
  const notice = '原始场景定义，用于创建新世界；不含运行进度、会话、凭证或宿主路径，不是运行备份。'
  const downloads: { owner: 'author' | 'run'; format: 'json' | 'yaml'; path: string; sha256: string }[] = []
  const exportFile = async (owner: 'author' | 'run', format: 'json' | 'yaml') => {
    await workspace.getByRole('button', { name: '导出定义', exact: true }).click()
    await page.getByText(notice, { exact: true }).waitFor()
    await page.screenshot({ path: join(root, `${owner}-export-purpose.png`), animations: 'disabled' })
    const pending = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: format === 'json' ? 'JSON' : owner === 'author' ? 'YAML' : '规范 YAML', exact: true }).click()
    const download = await pending, path = join(root, `${owner}.world.${format}`)
    await download.saveAs(path)
    const text = await readFile(path, 'utf8'), parsed = decodeScenarioInput(text, format)
    expect(parsed.ok && parsed.value).toEqual(definition)
    downloads.push({ owner, format, path, sha256: createHash('sha256').update(text).digest('hex') })
  }
  const preflight = async () => {
    const response = await scaffold.authenticatedRpc<SimulationProductWorldPreflightResult>('simulation.world.preflight', { definition })
    if (!response.result.ok || response.result.value.status !== 'ready') throw new Error(JSON.stringify(response.result))
    return response.result.value.preview
  }
  try {
    await scaffold.authenticateBrowserPage(page); await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    await workspace.getByRole('button', { name: '新建世界', exact: true }).first().click()
    const initialChooser = page.getByRole('dialog', { name: '新建世界', exact: true })
    await initialChooser.getByRole('button', { name: /可移植定义/ }).click()
    await exportFile('author', 'json'); await exportFile('author', 'yaml')
    expect(owned).toBeUndefined(); expect(createRequests).toEqual([]); expect(calls.length).toBe(beforeCalls)
    const baselinePreview = await preflight()
    await workspace.getByRole('button', { name: '检查定义', exact: true }).click()
    await expect.poll(() => workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).isEnabled()).toBe(true)
    await workspace.getByRole('button', { name: '创建暂停运行 ▸', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: '创建暂停运行', exact: true })
    await confirmation.getByLabel('运行名', { exact: true }).fill('Export original v1')
    await confirmation.getByRole('button', { name: '创建暂停运行', exact: true }).click()
    await workspace.getByRole('button', { name: '打开运行', exact: true }).waitFor()
    await expect.poll(() => owned?.snapshot().latestCheckpointId !== undefined).toBe(true)
    const state = structuredClone(owned!.snapshot()), revision = state.revision
    const bindings = Object.values(state.entities).flatMap(entity => entity.binding === undefined ? [] : [entity.binding])
    const bindingIds = bindings.flatMap(value => [value.participantId, value.sessionId])
    const actualIds = [state.spec.runId, state.teamReservation!.teamId, ...bindingIds]
    await workspace.getByRole('button', { name: '打开运行', exact: true }).click()
    await workspace.getByRole('heading', { name: 'Export original v1', exact: true }).waitFor()
    await exportFile('run', 'json'); await exportFile('run', 'yaml')
    await workspace.getByRole('button', { name: '返回运行列表', exact: true }).click()
    const recompiled: unknown[] = []
    for (const file of downloads) {
      const raw = await readFile(file.path, 'utf8')
      for (const id of actualIds) expect(raw).not.toContain(id)
      for (const path of [scaffold.workspaceCwd, scaffold.persistenceRoot, root, resolve('.')]) expect(raw).not.toContain(path)
      await workspace.getByRole('button', { name: '新建世界', exact: true }).first().click()
      const chooser = page.getByRole('dialog', { name: '新建世界', exact: true })
      await chooser.getByLabel('选择 JSON 或 YAML 文件', { exact: true }).setInputFiles(file.path)
      await expect.poll(() => workspace.locator('[data-section]').count()).toBe(11)
      await workspace.getByRole('radio', { name: '源码', exact: true }).click()
      const source = workspace.getByRole('textbox', { name: /^定义源码/ })
      const parsed = decodeScenarioInput(await source.inputValue(), file.format)
      expect(parsed.ok && parsed.value).toEqual(definition)
      const retainedSchema = z.object({ governance: z.object({ norms: z.array(z.object({ effectiveUntil: z.nullable(z.string()) })) }),
        facts: z.array(z.object({ effectiveUntil: z.nullable(z.string()), body: z.string() })) })
      const retained = retainedSchema.parse(parsed.ok ? parsed.value : undefined)
      expect(retained).toMatchObject({ facts: [{ effectiveUntil: null, body: definition.facts[0]!.body }] })
      // The actual Host compiler/preflight compares commitments, rather than treating syntax decoding as compilation.
      const input = parsed.ok ? parsed.value : undefined
      const response = await scaffold.authenticatedRpc<SimulationProductWorldPreflightResult>('simulation.world.preflight', { definition: input })
      if (!response.result.ok || response.result.value.status !== 'ready') throw new Error(JSON.stringify(response.result))
      expect(response.result.value.preview.hash).toBe(baselinePreview.hash)
      expect(response.result.value.preview.catalogGeneration).toBe(baselinePreview.catalogGeneration)
      recompiled.push({ owner: file.owner, format: file.format, preview: response.result.value.preview })
      await workspace.getByRole('radio', { name: '表单', exact: true }).click()
      expect(await workspace.locator('[data-table="facts"]').innerText()).toContain(definition.facts[0]!.body)
      await page.screenshot({ path: join(root, `${file.owner}-reimport-${file.format}.png`), animations: 'disabled' })
      await workspace.getByRole('button', { name: '← 目录', exact: true }).click()
    }
    expect(createRequests).toHaveLength(1); expect(restoreRequests).toEqual([])
    expect(calls.length).toBe(beforeCalls); expect(owned!.snapshot().revision).toBe(revision)
    expect(owned!.snapshot()).toEqual(state); expect(state.phase).toBe('paused')
    expect(await scaffold.ctx.sessionPersistence.list()).toEqual([])
    expect(errors.pageErrors).toEqual([])
    await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, origin: scaffold.baseUrl,
      browser: 'Playwright: Browser plugin not available', transport: 'actual HTTP/WebSocket and Loader; built frontend',
      definition, downloads, baselinePreview, recompiled, originalCommand: createRequests[0], runtimeIdsExcluded: actualIds,
      originalRevision: revision, originalSnapshot: state, modelCalls: calls.length - beforeCalls, restoreRequests,
      authoredPrivateFactsPreserved: true, allFieldsAndNullsPreserved: true, snapshotUnchanged: true,
      pageErrors: errors.pageErrors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(root, 'failure.png'), animations: 'disabled' })
    await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText())
    throw error
  } finally { await browser.close(); await scaffold.close() }
})
