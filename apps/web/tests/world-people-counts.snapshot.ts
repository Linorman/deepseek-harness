/** Browser personnel counts come from actual paused World and canonical Team history, never the reserved overview DTO. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { z } from 'zod'
import { expect, it, vi } from 'vitest'
import { scenarioCatalogSchema } from '@clocky/clocky-simulation-scenario'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import type {} from '../../../examples/simulation-company/tests/world-driver-model.ts'

it.each(['json', 'sqlite'] as const)('%s shows independent actual personnel counts through the real product/browser flow', async (backend) => {
  const parent = resolve('.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c13-people-browser-raw', backend)
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'world-'))
  const metadata: unknown = await import(pathToFileURL(resolve('packages/simulation/simulation-scenario/tests/fixtures.ts')).href)
  const factory = z.object({ catalog: z.custom<() => unknown>(value => typeof value === 'function') }).parse(metadata)
  const installed = scenarioCatalogSchema.parse(factory.catalog())
  installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
  const overlay = join(root, 'overlay.json')
  await writeFile(overlay, JSON.stringify([{ insert: [
    { name: '@clocky/clocky-simulation' },
    { name: '@clocky/clocky-simulation-local', config: { name: 'local', root: join(root, 'world'), backend, replayPageSize: 1 } },
    { name: '@clocky/clocky-simulation-team', config: { maxContextBytes: 65536, deliveryPageSize: 32,
      maxCoordinationRounds: 16, maxConcurrentModels: 2, maxQueuedModels: 16 } },
    { name: '@clocky/clocky-tool-simulation' }, { name: resolve('examples/simulation-company/tests/world-driver-model.ts') },
    { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'world-people-directory', imports: [] } },
    { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'world-people-commands', templates: [],
      world: { provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } },
      driverIntervalMs: 5, driverRetryMs: 10 } }, { name: '@clocky/clocky-client-ui-simulation' },
  ] }, { id: 'modules', config: { browserConfig: { '@clocky/clocky-client-ui-simulation': { pageSize: 2, controlRefreshMs: 50 } } } }]))
  const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: overlay, tempRoot: root,
    productPrincipalId: 'world-people-user', agentPresets: { default: 'simulation',
      roots: [{ path: resolve('examples/simulation-company/presets'), trust: 'system' }] } })
  let owned: SimulationRun | undefined
  const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
  scaffold.ctx.simulations.open = async (...args) => { owned = await open(...args); return owned }
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  const consoleErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  try {
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '仿真', exact: true }).click()
    const workspace = page.locator('[data-simulation-workspace-page]')
    await workspace.getByRole('button', { name: '导入 World JSON', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导入 World JSON', exact: true })
    await dialog.getByLabel('运行名称', { exact: true }).fill('Observed personnel')
    await dialog.getByLabel('可移植场景 JSON', { exact: true }).fill(await readFile(resolve('examples/simulation-company/scenarios/world-company.json'), 'utf8'))
    await dialog.getByRole('button', { name: '检查配置', exact: true }).click()
    await dialog.getByRole('region', { name: 'World 创建预览', exact: true }).waitFor()
    await dialog.getByRole('button', { name: '创建暂停的运行', exact: true }).click()
    await expect.poll(() => owned?.snapshot().phase).toBe('paused')
    await dialog.getByRole('button', { name: '打开已登记运行', exact: true }).click()
    const people = workspace.getByRole('region', { name: '人员', exact: true })
    await expect.poll(() => Object.values(owned!.snapshot().checkpoints ?? {}).some(checkpoint => checkpoint.status === 'completed')).toBe(true)
    await people.getByRole('button', { name: '刷新', exact: true }).click()
    // Technical bindings (resident seats, writers, history) live under Run management, apart from the social figures.
    await workspace.locator('[data-world-management] > summary').click()
    const technical = workspace.locator('[data-people-technical]')
    const technicalLabels = new Set(['驻留 / 上限', '未释放 writer', '历史 Participant', '历史 Activation'])
    const figure = async (label: string) => (technicalLabels.has(label) ? technical : people).locator('dl > div, div')
      .filter({ has: page.getByText(label, { exact: true }) }).locator('dd, [role=img]').first().innerText()
    await expect.poll(() => figure('在职')).toBe('1')
    expect(await figure('非终止人物')).toBe('3')
    expect(await figure('驻留 / 上限')).toBe('0/2')
    expect(await figure('未释放 writer')).toBe('0')
    const original = owned!.snapshot(), team = await scaffold.ctx.teams.getTeam({ teamId: original.teamReservation!.teamId })
    expect(await figure('历史 Participant')).toBe(String(team.participants.length))
    expect(await figure('历史 Activation')).toBe(String(team.activations.length))
    expect(scaffold.ctx.worldDriverProbe.requests).toHaveLength(0)
    await people.getByRole('button', { name: '刷新', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => figure('在职')).toBe('1')
    expect(owned!.snapshot()).toEqual(original)
    expect((await scaffold.ctx.teams.getTeam({ teamId: team.team.id })).team.cursor).toBe(team.team.cursor)
    await page.screenshot({ path: join(root, 'people-observed.png'), animations: 'disabled' })
    const teamRead = vi.spyOn(scaffold.ctx.teams, 'getTeam').mockRejectedValue(new Error('Private Team read failure'))
    try {
      await people.getByRole('button', { name: '刷新', exact: true }).click()
      await technical.getByText('完整 Team 历史不可用，历史计数未知。', { exact: true }).waitFor()
      expect(await figure('历史 Participant')).not.toBe('0')
      expect(await figure('历史 Activation')).not.toBe('0')
      expect(await figure('在职')).toBe('1')
    } finally { teamRead.mockRestore() }
    await people.getByRole('button', { name: '刷新', exact: true }).click()
    await expect.poll(() => figure('历史 Participant')).toBe(String(team.participants.length))
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(theme === 'dark')
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await people.scrollIntoViewIfNeeded()
        expect(await people.getByRole('button', { name: '刷新', exact: true }).isVisible()).toBe(true)
        await page.screenshot({ path: join(root, `people-${theme}-${width}.png`), animations: 'disabled' })
      }
    }
    await page.reload({ waitUntil: 'load' })
    await expect.poll(() => figure('在职')).toBe('1')
    expect(owned!.snapshot()).toEqual(original)
    expect(scaffold.ctx.worldDriverProbe.requests).toHaveLength(0)
    expect(errors.pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
    await writeFile(join(root, 'proof.json'), JSON.stringify({ backend, phase: original.phase, nativeRevision: original.revision,
      originalTeamCursor: team.team.cursor, employed: 1, nonTerminalPersons: 3, resident: 0, unreleasedWriters: 0,
      historyParticipants: team.participants.length, historyActivations: team.activations.length,
      preservedAfterKeyboardRefreshReload: true, historyFailureNotZero: true, modelCalls: 0,
      browserPlugin: 'not available; project Playwright lane', pageErrors: errors.pageErrors, consoleErrors }, null, 2) + '\n')
  } finally { await browser.close(); await scaffold.close() }
})
