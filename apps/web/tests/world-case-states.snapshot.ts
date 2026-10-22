/** Browser exposes actual rejected, capacity and maintenance World states without hiding employment or notification responsibility. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { scenarioCatalogSchema, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { simulationProposalSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationProductCommandId } from '@clocky/clocky-simulation-product/types'
import type {} from '../../../examples/simulation-company/tests/world-driver-model.ts'

const modes = (['rejected', 'capacity', 'maintenance', 'awaiting-evidence'] as const)
  .filter(mode => process.env.WORLD_CASE_UI_MODES === undefined || process.env.WORLD_CASE_UI_MODES.split(',').includes(mode))
it.each((['json', 'sqlite'] as const).flatMap(backend => (['company', 'laboratory'] as const).flatMap(scenario =>
  modes.map(mode => ({ backend, scenario, mode })))))(
  'shows $backend $scenario actual $mode state', async ({ backend, scenario, mode }) => {
    const parent = resolve('.local/world-director-mvp/browser', `${backend}-${scenario}-${mode}`)
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(join(parent, 'world-'))
    // Runtime URL imports preserve the real Loader module instance without crossing compiler output layouts.
    const metadata: unknown = await import(pathToFileURL(resolve('packages/simulation/simulation-scenario/tests/fixtures.ts')).href)
    const factory = z.object({ catalog: z.custom<() => unknown>(value => typeof value === 'function') }).parse(metadata)
    const installed = scenarioCatalogSchema.parse(factory.catalog())
    installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
    if (mode === 'awaiting-evidence') installed.limits.ceilings.world = {
      ...installed.limits.ceilings.world, maxBytesPerRequest: 32768, maxBytesPerPlan: 32768,
    }
    const overlays = [{ insert: [
      { name: '@clocky/clocky-simulation' },
      { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
      { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
        maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
      { name: '@clocky/clocky-simulation-world/providers' },
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
    const countRequests = () => scaffold.ctx.worldDriverProbe.requests.length
    let owned: SimulationRun | undefined, opens = 0
    const held = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    let holdingEvidence = false
    const modelMessages: unknown[] = []
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => {
      const run = await open(...args)
      owned = run; opens++
      if (mode === 'maintenance') {
        const prepare = run.prepareWorldHire.bind(run)
        run.prepareWorldHire = async (...input) => {
          const result = await prepare(...input)
          held.resolve(undefined); await release.promise
          return result
        }
      }
      return run
    }
    if (mode === 'rejected' || mode === 'awaiting-evidence') {
      const reject = (text: string): string => {
        const parsed = z.strictObject({ proposals: z.array(simulationProposalSchema) }).parse(JSON.parse(text))
        return JSON.stringify({ proposals: parsed.proposals.map(proposal => proposal.action.kind === 'world/resolve'
          ? { ...proposal, action: { ...proposal.action, resolution: mode === 'rejected'
            ? { kind: 'reject', reason: 'insufficient-information', rationale: 'The actual applicant requirement has insufficient information.' }
            : { kind: 'awaiting-evidence', missingFields: ['requirements'], deadline: '10', maxAttempts: 2,
              rationale: 'The original requester must clarify the installed requirements field.' } } } : proposal) })
      }
      scaffold.ctx.on('llm/stream', (request, next) => {
        if (request.provider !== 'world-driver-scripted') return next()
        if (mode === 'awaiting-evidence') modelMessages.push(structuredClone(request.messages))
        if (mode === 'awaiting-evidence' && request.messages.some(message => message.role === 'user'
          && message.content.some(block => block.type === 'text' && /"purpose"\s*:\s*"evidence"/.test(block.text)))) {
          return (async function* () {
            holdingEvidence = true; held.resolve(undefined); await release.promise
            // Teardown retires this held real request; no fabricated model response or answer is supplied.
          })()
        }
        return (async function* () {
          for await (const chunk of next()) {
            if (chunk.type === 'tool-call-delta' && chunk.name === 'simulation_stage') {
              yield { ...chunk, argumentsDelta: reject(chunk.argumentsDelta ?? '') }
            } else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call' && chunk.block.name === 'simulation_stage') {
              yield { ...chunk, block: { ...chunk.block, arguments: reject(chunk.block.arguments) } }
            } else yield chunk
          }
        }())
      })
    }
    const beforeCalls = countRequests()
    const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    const page = await context.newPage()
    const errors = watchConsole(page), createCommands: SimulationProductCommandId[] = [], cancelInputs: Record<string, unknown>[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/api/simulation.world.cases.cancel')) {
        cancelInputs.push((request.postDataJSON() as { payload: Record<string, unknown> }).payload)
      }
      if (request.url().endsWith('/api/simulation.world.create')) {
        createCommands.push((request.postDataJSON() as { payload: { commandId: SimulationProductCommandId } }).payload.commandId)
      }
    })
    try {
      await scaffold.authenticateBrowserPage(page)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '仿真', exact: true }).click()
      const workspace = page.locator('[data-simulation-workspace-page]')
      await workspace.getByRole('button', { name: '导入 World JSON', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '导入 World JSON', exact: true })
      await dialog.getByLabel('运行名称', { exact: true }).fill(`World ${scenario}`)
      await dialog.getByLabel('可移植场景 JSON', { exact: true }).fill('{ invalid')
      await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
      await dialog.getByText('请输入有效的可移植 World JSON 定义。', { exact: true }).waitFor()
      expect(createCommands).toEqual([]); expect(countRequests()).toBe(beforeCalls)
      const parsed = worldScenarioSchema.parse(JSON.parse(await readFile(
        resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
      if (mode === 'capacity') parsed.positions[0]!.capacity = 1
      if (mode === 'awaiting-evidence') parsed.limits = { ...parsed.limits, world: { ...parsed.limits?.world,
        maxBytesPerRequest: 32768, maxBytesPerPlan: 32768 } }
      const definition = JSON.stringify(parsed)
      await dialog.getByLabel('选择 JSON 文件', { exact: true }).setInputFiles({ name: `world-${scenario}.json`,
        mimeType: 'application/json', buffer: Buffer.from(definition) })
      await expect.poll(() => dialog.getByLabel('可移植场景 JSON', { exact: true }).inputValue()).toBe(definition)
      await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
      await dialog.getByRole('region', { name: 'World 创建预览', exact: true }).waitFor()
      await dialog.getByRole('heading', { name: '招聘授权', exact: true }).waitFor()
      expect(createCommands).toEqual([]); expect(countRequests()).toBe(beforeCalls)
      await page.screenshot({ path: join(root, '00-preview.png'), animations: 'disabled' })
      await dialog.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
      await expect.poll(() => owned?.snapshot().phase).toBe('paused')
      await dialog.getByRole('button', { name: '打开已登记运行', exact: true }).click()
      expect(createCommands).toHaveLength(1); expect(countRequests()).toBe(beforeCalls)
      await expect.poll(() => owned?.snapshot().world !== undefined && owned?.snapshot().latestCheckpointId !== undefined).toBe(true)
      await workspace.getByRole('button', { name: '事项', exact: true }).first().click()
      await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
      await workspace.getByText('此窗口暂无匹配案件。初始申请只会在调度运行时处理。', { exact: true }).waitFor()
      await workspace.getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      const start = page.getByRole('dialog', { name: /^(开始|继续)调度$/ })
      await start.getByRole('button', { name: /^(开始|继续)调度$/ }).click()
      if (mode === 'maintenance') await held.promise
      else if (mode === 'awaiting-evidence') await expect.poll(() => holdingEvidence, { timeout: 10000 }).toBe(true)
      else await expect.poll(() => mode === 'rejected'
        ? Object.values(owned!.snapshot().world!.results).some(value => value.outcome.kind === 'rejected')
        : Object.values(owned!.snapshot().world!.plans).length === 1, { timeout: 30000 }).toBe(true)
      const state = owned!.snapshot(), original = Object.values(state.world!.requests)[0]!
      await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
      await workspace.getByRole('button', { name: original.id, exact: true }).click()
      const inspector = workspace.getByRole('complementary')
      if (mode === 'rejected') {
        await expect.poll(() => owned!.snapshot().activeWindowId).toBeUndefined()
        await inspector.getByRole('tab', { name: '执行', exact: true }).click()
        await inspector.getByText('已拒绝', { exact: true }).last().waitFor()
        await inspector.getByText('信息不足；请提交新的申请。', { exact: true }).waitFor()
        expect(Object.keys(owned!.snapshot().world!.reservations)).toHaveLength(0)
        await workspace.getByRole('button', { name: '暂停调度', exact: true }).click()
        await expect.poll(() => owned!.snapshot().phase).toBe('paused')
        await expect.poll(() => owned!.snapshot().activeWindowId, { timeout: 10000 }).toBeUndefined()
        await workspace.getByRole('button', { name: '刷新', exact: true }).first().click()
        expect(await workspace.textContent()).not.toContain('调度器需要恢复。')
      } else if (mode === 'capacity') {
        await workspace.locator('summary').filter({ hasText: '运行详情' }).click()
        await workspace.getByText('岗位容量已占满', { exact: true }).first().waitFor()
        // Continue is never offered while the run is still running; otherwise the Host refusal disables it.
        const resume = workspace.getByRole('button', { name: /^(开始|继续)调度$/ })
        expect(await resume.count() === 0 || await resume.isDisabled()).toBe(true)
        expect(Object.keys(state.world!.reservations)).toHaveLength(0)
      } else if (mode === 'awaiting-evidence') {
        expect(original.status).toBe('awaiting-evidence')
        const challenge = Object.values(state.world!.evidence.challenges).find(value => value.requestId === original.id)!
        expect(challenge.responders).toEqual([original.requesterEntityId])
        await inspector.getByRole('tab', { name: '补证', exact: true }).click()
        await inspector.getByText(/缺少 requirements，.* 在 10 前补充/).waitFor()
        await inspector.getByText('剩 1 次', { exact: true }).waitFor()
        expect(await inspector.textContent()).not.toContain('没有补证要求')
        await inspector.getByRole('tab', { name: '来源', exact: true }).click()
        await inspector.locator('[data-ref-kind="entity"]').first().click()
        await expect.poll(() => new URL(page.url()).searchParams.get('simulationModule')).toBe('entities')
        await page.goBack()
        await workspace.getByRole('complementary').waitFor()
        expect(owned!.snapshot()).toEqual(state)
      } else {
        await inspector.getByRole('tab', { name: '执行', exact: true }).click()
        await inspector.getByText('正在准备身份，尚不能运行', { exact: true }).waitFor()
        expect(owned!.snapshot().phase).toBe('paused')
        expect(Object.values(state.world!.results)).toHaveLength(0)
        expect(Object.values(state.world!.reservations)[0]?.status).toBe('preparing')
      }
      const calls = countRequests()
      await page.screenshot({ path: join(root, '01-actual-state.png'), animations: 'disabled' })
      await page.reload({ waitUntil: 'load' })
      await workspace.getByRole('complementary').waitFor()
      expect(countRequests()).toBe(calls)
      expect(opens).toBe(1)
      expect(createCommands).toHaveLength(1)
      expect(cancelInputs).toHaveLength(0)
      await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, scenario, mode, modelCalls: calls - beforeCalls,
        originalRequest: original.id, originalStates: true, stableReload: true, opens }, null, 2))
      expect(errors.pageErrors).toEqual([])
    } catch (error) {
      await page.screenshot({ path: join(root, 'failure.png'), animations: 'disabled' })
      await writeFile(join(root, 'failure-dom.txt'), await page.locator('[data-simulation-workspace-page]').innerText())
      await writeFile(join(root, 'failure-state.json'), JSON.stringify({ state: owned?.snapshot(), modelMessages }, null, 2))
      throw error
    } finally { release.resolve(undefined); await browser.close(); await scaffold.close() }
  })
