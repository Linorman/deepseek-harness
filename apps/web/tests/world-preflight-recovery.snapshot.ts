/** Real World pre-acceptance refusal keeps the editable draft recoverable without creating or starting a run. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { z } from 'zod'
import { expect, it, vi } from 'vitest'
import { scenarioCatalogSchema, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { simulationProductWorldCreateInputSchema, simulationProductWorldPreflightResultSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationProductWorldCreateInput } from '@clocky/clocky-simulation-product/types'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type {} from '../../../examples/simulation-company/tests/world-driver-model.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it.each((['json', 'sqlite'] as const).flatMap(backend => [1440, 390].map(width => ({ backend, width }))))(
  'recovers a refused $backend World preview at $width px before one paused creation', async ({ backend, width }) => {
    const parent = resolve('.local/world-audit-20261011/browser', `${backend}-${width}-preflight-recovery`)
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(join(parent, 'world-'))
    const metadata: unknown = await import(pathToFileURL(resolve('packages/simulation/simulation-scenario/tests/fixtures.ts')).href)
    const factory = z.object({ catalog: z.custom<() => unknown>(value => typeof value === 'function') }).parse(metadata)
    const installed = scenarioCatalogSchema.parse(factory.catalog())
    installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
    const overlays = [{ insert: [
      { name: '@clocky/clocky-simulation' },
      { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
      { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
        maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
      { name: '@clocky/clocky-tool-simulation' },
      { name: resolve('examples/simulation-company/tests/world-driver-model.ts') },
      { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'world-browser-directory', imports: [] } },
      { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'world-browser-commands', templates: [],
        world: { provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } },
        driverIntervalMs: 5, driverRetryMs: 10 } },
      { name: '@clocky/clocky-client-ui-simulation' },
    ] }, { id: 'modules', config: { browserConfig: {
      '@clocky/clocky-client-ui-simulation': { pageSize: 1, controlRefreshMs: 50 },
    } } }]
    const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify(overlays))
    const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
      productPrincipalId: 'world-browser-user', agentPresets: { default: 'simulation',
        roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' }] } })
    const callsBefore = scaffold.ctx.worldDriverProbe.requests.length
    const originalOpen = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    const open = vi.spyOn(scaffold.ctx.simulations, 'open'), createTeam = vi.spyOn(scaffold.ctx.teams, 'createTeam')
    const actualLimits = scaffold.ctx.teams.getCreationLimits()
    let owned: SimulationRun | undefined
    open.mockImplementation(async (...args) => { owned = await originalOpen(...args); return owned })
    const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width, height: 1000 }, locale: 'zh-CN' })
    const errors = watchConsole(page), consoleErrors: string[] = [], creates: SimulationProductWorldCreateInput[] = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('request', (request) => {
      if (request.url().endsWith('/api/simulation.world.create')) {
        const envelope = z.object({ payload: simulationProductWorldCreateInputSchema }).parse(request.postDataJSON())
        creates.push(envelope.payload)
      }
    })
    const countCommands = async () => {
      const stream = scaffold.ctx.storageLog.get('world-browser-commands')
      const entries = await stream?.read(-1, 100) ?? []
      return entries.filter(entry => z.object({ kind: z.string() }).parse(entry.value).kind === 'command/accepted').length
    }
    try {
      await scaffold.authenticateBrowserPage(page)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      expect(new URL(page.url()).origin).toBe(scaffold.baseUrl)
      expect(await page.title()).not.toBe('')
      await page.getByRole('button', { name: '仿真', exact: true }).click()
      const workspace = page.locator('[data-simulation-workspace-page]')
      await workspace.getByRole('button', { name: '导入 World JSON', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '导入 World JSON', exact: true })
      const json = await readFile(resolve('examples/simulation-company/scenarios/world-company.json'), 'utf8')
      const definition = worldScenarioSchema.parse(JSON.parse(json))
      const name = '重新预检的 World'
      await dialog.getByLabel('运行名称', { exact: true }).fill(name)
      await dialog.getByLabel('可移植场景 JSON', { exact: true }).fill(JSON.stringify({ ...definition,
        metadata: { ...definition.metadata, description: '   ' } }))
      await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
      await dialog.getByText('metadata.description: invalid-shape · Scenario description must contain non-whitespace text', { exact: true }).waitFor()
      expect(creates).toHaveLength(0)
      expect(open).not.toHaveBeenCalled(); expect(createTeam).not.toHaveBeenCalled(); expect(await countCommands()).toBe(0)
      await dialog.getByLabel('可移植场景 JSON', { exact: true }).fill(json)
      const previewResponse = page.waitForResponse(response => response.url().endsWith('/api/simulation.world.preflight'))
      await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
      const firstPreview = z.object({ result: z.object({ ok: z.literal(true), value: simulationProductWorldPreflightResultSchema }) })
        .parse(await (await previewResponse).json()).result.value
      if (firstPreview.status !== 'ready') throw new Error('Expected an executable initial World preview')
      await dialog.getByRole('region', { name: 'World 创建预览', exact: true }).waitFor()
      expect(open).not.toHaveBeenCalled(); expect(createTeam).not.toHaveBeenCalled(); expect(await countCommands()).toBe(0)
      await page.screenshot({ path: join(root, '00-original-preview.png'), animations: 'disabled' })

      // The deterministic deployment change is confined to metadata. Loader, compiler, authenticated HTTP,
      // command journal, Native preparation and Team identity allocation retain their real implementations.
      const changedLimits = { ...actualLimits, maxParticipants: firstPreview.limits.team.maxParticipants - 1 }
      expect(changedLimits.maxParticipants).toBeGreaterThan(definition.actors.length)
      vi.spyOn(scaffold.ctx.teams, 'getCreationLimits').mockReturnValue(changedLimits)
      const refusalResponse = page.waitForResponse(response => response.url().endsWith('/api/simulation.world.create'))
      await dialog.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
      const refusal: unknown = await (await refusalResponse).json()
      expect(z.object({ result: z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }) })
        .parse(refusal).result.error.code).toBe('simulation-product-preflight-changed')
      await dialog.getByText('受理前场景配置已变化。请重新检查配置并确认；没有创建运行。', { exact: true }).waitFor()
      const original = dialog.getByRole('region', { name: '原操作', exact: true })
      expect(await original.getAttribute('data-outcome-unknown')).toBeNull()
      expect(await original.getByRole('button', { name: '重试原操作', exact: true }).count()).toBe(0)
      expect(open).not.toHaveBeenCalled(); expect(createTeam).not.toHaveBeenCalled(); expect(await countCommands()).toBe(0)
      expect(scaffold.ctx.worldDriverProbe.requests).toHaveLength(callsBefore)
      expect(creates).toHaveLength(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await dialog.getByRole('button', { name: '发起新的原申请', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(root, '01-refused-recoverable.png'), animations: 'disabled' })
      await writeFile(join(root, 'refusal.json'), JSON.stringify(refusal, null, 2))

      await dialog.getByRole('button', { name: '发起新的原申请', exact: true }).focus()
      await page.keyboard.press('Enter')
      expect(await dialog.getByLabel('运行名称', { exact: true }).inputValue()).toBe(name)
      expect(await dialog.getByLabel('可移植场景 JSON', { exact: true }).inputValue()).toBe(json)
      expect(await dialog.getByRole('button', { name: '创建暂停的运行', exact: true }).isDisabled()).toBe(true)
      const refreshedResponse = page.waitForResponse(response => response.url().endsWith('/api/simulation.world.preflight'))
      await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
      const refreshed = z.object({ result: z.object({ ok: z.literal(true), value: simulationProductWorldPreflightResultSchema }) })
        .parse(await (await refreshedResponse).json()).result.value
      if (refreshed.status !== 'ready') throw new Error('Expected a refreshed executable preview')
      expect(refreshed.preview.hash).not.toBe(firstPreview.preview.hash)
      expect(refreshed.limits.team.maxParticipants).toBe(changedLimits.maxParticipants)
      await expect.poll(() => dialog.getByRole('button', { name: '创建暂停的运行', exact: true }).isEnabled()).toBe(true)
      await dialog.getByRole('button', { name: '创建暂停的运行', exact: true }).dblclick()
      await expect.poll(() => owned?.snapshot().latestCheckpointId !== undefined, { timeout: 30000 }).toBe(true)
      await dialog.getByRole('button', { name: '打开已登记运行', exact: true }).click()
      await workspace.getByRole('heading', { name, exact: true }).waitFor()
      expect(creates).toHaveLength(2)
      expect(creates[1]!.commandId).not.toBe(creates[0]!.commandId)
      expect(creates[1]!.definition).toEqual(creates[0]!.definition)
      expect(creates[1]!.preflight.hash).toBe(refreshed.preview.hash)
      expect(open).toHaveBeenCalledOnce(); expect(createTeam).toHaveBeenCalledOnce(); expect(await countCommands()).toBe(1)
      expect(owned!.snapshot().phase).toBe('paused')
      expect(scaffold.ctx.worldDriverProbe.requests).toHaveLength(callsBefore)
      const revision = owned!.snapshot().revision
      await page.reload({ waitUntil: 'load' })
      await workspace.getByRole('heading', { name, exact: true }).waitFor()
      expect(open).toHaveBeenCalledOnce(); expect(createTeam).toHaveBeenCalledOnce()
      expect(owned!.snapshot().revision).toBe(revision)
      expect(scaffold.ctx.worldDriverProbe.requests).toHaveLength(callsBefore)
      expect(await page.locator('vite-error-overlay').count()).toBe(0)
      expect(errors.pageErrors).toEqual([]); expect(errors.warnings).toEqual([]); expect(consoleErrors).toEqual([])
      await page.screenshot({ path: join(root, '02-one-paused-run.png'), animations: 'disabled' })
      await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, viewport: { width, height: 1000 },
        browser: 'Playwright Chromium; Browser plugin not available', firstPreview: firstPreview.preview,
        changedMaxParticipants: changedLimits.maxParticipants, refreshedPreview: refreshed.preview,
        originalCommand: creates[0]!.commandId, acceptedCommand: creates[1]!.commandId,
        refusedBeforeAcceptance: true, originalDraftRetained: true, originalCommandsAccepted: await countCommands(),
        nativeOpens: open.mock.calls.length, teamCreations: createTeam.mock.calls.length,
        modelCalls: scaffold.ctx.worldDriverProbe.requests.length - callsBefore, phase: owned!.snapshot().phase,
        stableReload: true, consoleErrors, pageErrors: errors.pageErrors }, null, 2))
    } catch (cause: unknown) {
      await page.screenshot({ path: join(root, 'failure.png'), animations: 'disabled' })
      await writeFile(join(root, 'failure-dom.txt'), await page.locator('body').innerText())
      throw cause
    } finally { vi.restoreAllMocks(); await browser.close(); await scaffold.close() }
  })
