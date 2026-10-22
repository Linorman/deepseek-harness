/**
 * Visual baseline for the Web UI redesign: a fixed state matrix captured in
 * light and dark at 1440×900 and 390×844 through the real Host.
 *
 * Images and a SHA-256 manifest land in `.artifacts/ui-baseline/<label>/`
 * (`$CLOCKY_UI_BASELINE_LABEL`, default `current`). The suite asserts that every
 * state renders and that capturing the same state twice yields identical
 * pixels. With `$CLOCKY_UI_BASELINE_COMPARE=<label>`, each capture is also
 * compared with that label's image; more than {@link NOISE_PIXELS} pixels whose
 * channel delta exceeds {@link NOISE_DELTA} fail, which proves run-to-run
 * determinism. Comparing across a redesign PR is a review step instead,
 * because those PRs change pixels on purpose.
 * @see ../../../.agents/plans/2026-10-02-web-ui-redesign/development-plan.md
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { simulationChangeSchema, simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { TeamStateSnapshot } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

const LABEL = process.env.CLOCKY_UI_BASELINE_LABEL ?? 'current'
const OUTPUT = join(REPO_ROOT, '.artifacts/ui-baseline', LABEL)
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  narrow: { width: 390, height: 844 },
} as const
const THEMES = ['light', 'dark'] as const
const COMPARE = process.env.CLOCKY_UI_BASELINE_COMPARE
/** Font anti-aliasing differs by a few pixels between otherwise identical runs. */
const NOISE_PIXELS = 64
const NOISE_DELTA = 48

interface ManifestEntry { state: string; theme: string; viewport: string; file: string; sha256: string }

/** Wait for fonts and every finite animation so a capture reflects settled layout. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)))
  })
}

/** Relative times and clocks change between runs; mask them in every capture. */
function volatile(page: Page): Locator[] {
  return [page.locator('time, [data-relative-time], [data-volatile]')]
}

async function shot(page: Page, mask: readonly Locator[]): Promise<Buffer> {
  await settle(page)
  return await page.screenshot({ animations: 'disabled', caret: 'hide', mask: [...volatile(page), ...mask] })
}

/**
 * Count pixels whose largest channel delta exceeds {@link NOISE_DELTA}, decoding
 * both PNGs in the page so the suite needs no image dependency.
 * @param page - Any open page; the comparison runs in an isolated canvas.
 * @param left - First PNG.
 * @param right - Second PNG.
 * @returns differing pixel count, or the full area when sizes differ.
 */
async function differingPixels(page: Page, left: Buffer, right: Buffer): Promise<number> {
  return await page.evaluate(async ({ a, b, delta }) => {
    async function pixels(base64: string) {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      return context.getImageData(0, 0, bitmap.width, bitmap.height)
    }
    const [x, y] = await Promise.all([pixels(a), pixels(b)])
    if (x.width !== y.width || x.height !== y.height) return Math.max(x.width * x.height, y.width * y.height)
    let count = 0
    for (let i = 0; i < x.data.length; i += 4) {
      let d = 0
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((x.data[i + c] ?? 0) - (y.data[i + c] ?? 0)))
      if (d > delta) count++
    }
    return count
  }, { a: left.toString('base64'), b: right.toString('base64'), delta: NOISE_DELTA })
}

/**
 * Capture until two consecutive frames match, so async reads and polling
 * settle before the image is recorded.
 * @param page - Page showing the state.
 * @param name - State label for the failure message.
 * @param mask - Extra regions to mask.
 * @returns the settled frame.
 */
async function stableShot(page: Page, name: string, mask: readonly Locator[]): Promise<Buffer> {
  let previous = await shot(page, mask)
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(150)
    const next = await shot(page, mask)
    if (next.equals(previous)) return next
    previous = next
  }
  throw new Error(`${name} never repainted identically in 20 attempts`)
}

/**
 * Capture one state in every theme and viewport, asserting a stable repaint.
 * @param page - Page already showing the state.
 * @param state - Stable state name used for file names.
 * @param manifest - Accumulating manifest.
 * @param viewports - Viewports to capture; dialogs with fixed geometry may skip narrow.
 * @param mask - Extra regions whose content is not deterministic for this state.
 */
async function captureMatrix(
  page: Page,
  state: string,
  manifest: ManifestEntry[],
  viewports: readonly (keyof typeof VIEWPORTS)[] = ['desktop', 'narrow'],
  mask: readonly Locator[] = [],
): Promise<void> {
  for (const viewport of viewports) {
    await page.setViewportSize(VIEWPORTS[viewport])
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')))
        .toBe(theme === 'dark')
      const first = await stableShot(page, `${state}/${theme}/${viewport}`, mask)
      const hash = createHash('sha256').update(first).digest('hex')
      const file = `${state}--${theme}--${viewport}.png`
      await writeFile(join(OUTPUT, file), first)
      if (COMPARE !== undefined) {
        const reference = await readFile(join(REPO_ROOT, '.artifacts/ui-baseline', COMPARE, file))
        expect(await differingPixels(page, reference, first), `${file} matches ${COMPARE}`).toBeLessThanOrEqual(NOISE_PIXELS)
      }
      manifest.push({ state, theme, viewport, file, sha256: hash })
    }
  }
  await page.setViewportSize(VIEWPORTS.desktop)
  await page.emulateMedia({ colorScheme: 'light' })
}

async function rpc<T>(scaffold: WebScaffold, method: string, payload: unknown): Promise<T> {
  const reply = await scaffold.authenticatedRpc<T>(method, payload)
  if (!reply.result.ok) throw new Error(`${method}: ${reply.result.error.message}`)
  return reply.result.value
}

async function writeManifest(manifest: readonly ManifestEntry[], name: string): Promise<void> {
  await writeFile(join(OUTPUT, `${name}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`)
}

describe('ui baseline', () => {
  it('captures the Team, conversation, and settings states', async () => {
    await mkdir(OUTPUT, { recursive: true })
    const manifest: ManifestEntry[] = []
    const scratch = join(REPO_ROOT, '.tmp/ui-baseline')
    await mkdir(scratch, { recursive: true })
    // A fixed world path keeps the folder name in breadcrumbs identical across runs.
    const world = join(scratch, 'world')
    await rm(world, { recursive: true, force: true })
    const scaffold = await launchWebScaffold({
      tempRoot: scratch,
      retainedWorld: { workspaceCwd: join(world, 'release-workspace'), persistenceRoot: join(world, 'sessions') },
      extraOverlayPath: join(REPO_ROOT, 'examples/headless-agent/tests/fixtures/team-collections-browser.cordis.yml'),
    })
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: VIEWPORTS.desktop, locale: 'zh-CN' })
    const errors = watchConsole(page)
    try {
      await scaffold.authenticateBrowserPage(page)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await captureMatrix(page, '01-empty', manifest)

      const active = await rpc<TeamStateSnapshot>(scaffold, 'team.create', { objective: '发布准备：整理接口迁移、回归测试与发布说明', cwd: scaffold.workspaceCwd })
      for (const subject of ['接口迁移', '回归测试', '发布说明']) {
        const current = await rpc<TeamStateSnapshot>(scaffold, 'team.get', { teamId: active.team.id })
        await rpc(scaffold, 'team.task.create', {
          teamId: active.team.id, expectedCursor: current.team.cursor, idempotencyKey: subject, subject,
          description: `${subject}：保留现有授权检查，并记录验证结果。`, blockedBy: [],
          requiredCapabilities: ['workspace-ui-manual-review'], priority: 0, readScopes: [], writeScopes: [],
          workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
        })
      }

      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: /^发布准备/ }).first().click()
      const workspace = page.locator('[data-team-workspace-page]')
      await workspace.getByText('任务完成', { exact: true }).waitFor()
      await captureMatrix(page, '02-team-active', manifest)

      await workspace.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '任务', exact: true }).click()
      await workspace.getByText('回归测试', { exact: true }).first().waitFor()
      await captureMatrix(page, '03-team-tasks', manifest, ['desktop'])

      await workspace.getByRole('navigation', { name: '团队模块' }).getByRole('button', { name: '概览', exact: true }).click()
      await workspace.getByRole('button', { name: /^(与协调者沟通|查看协调者记录)$/ }).click()
      const inspection = page.locator('[data-conversation-pane]')
      await inspection.waitFor({ state: 'visible' })
      await captureMatrix(page, '04-coordinator-session', manifest)
      await inspection.getByRole('button', { name: '关闭对话', exact: true }).click()
      await inspection.waitFor({ state: 'hidden' })

      // Team discovery is ordered by opaque id, so once a second Team exists the
      // sidebar list order is arbitrary; later states mask the navigation rail.
      const ended = await rpc<TeamStateSnapshot>(scaffold, 'team.create', { objective: '归档旧版文档', cwd: scaffold.workspaceCwd })
      await rpc(scaffold, 'team.cancel', { teamId: ended.team.id })
      const unordered = [page.locator('[data-clocky-navigation]')]

      await page.getByRole('button', { name: /^归档旧版文档/ }).first().click()
      await workspace.getByText('归档旧版文档', { exact: false }).first().waitFor()
      await captureMatrix(page, '05-team-ended', manifest, ['desktop'], unordered)

      const trigger = page.getByRole('button', { name: '设置', exact: true })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: '设置' })
      await dialog.getByRole('button', { name: 'Workspace Write' }).waitFor({ timeout: 10_000 })
      await captureMatrix(page, '07-settings-general', manifest, undefined, unordered)
      await dialog.getByRole('button', { name: '模型' }).click()
      await expect.poll(() => dialog.getByRole('button', { name: '模型' }).getAttribute('aria-current')).toBe('true')
      await captureMatrix(page, '08-settings-models', manifest, ['desktop'], unordered)
      await dialog.getByRole('button', { name: '插件', exact: true }).click()
      await dialog.getByRole('heading', { name: '插件', exact: true }).waitFor({ timeout: 10_000 })
      await captureMatrix(page, '09-settings-plugins', manifest, ['desktop'], unordered)
      await page.keyboard.press('Escape')

      expect(errors.pageErrors).toEqual([])
    } catch (cause) {
      await page.screenshot({ path: join(OUTPUT, 'team-failure.png') }).catch(() => undefined)
      throw cause
    } finally {
      await writeManifest(manifest, 'team')
      await browser.close()
      await scaffold.close()
    }
  }, 600_000)

  it('captures the Simulation directory and run modules', async () => {
    await mkdir(OUTPUT, { recursive: true })
    const manifest: ManifestEntry[] = []
    const root = join(REPO_ROOT, '.tmp/ui-baseline/simulation')
    await mkdir(root, { recursive: true })
    const overlay = join(REPO_ROOT, 'examples/headless-agent/tests/fixtures/simulation/simulation-web/cordis.yml')
    const config = JSON.parse(readFileSync(overlay, 'utf8')) as { insert: { config?: { root?: string; backend?: string; imports?: { spec: unknown }[] } }[] }[]
    const local = config[0]?.insert[1]?.config
    if (local === undefined) throw new Error('Simulation browser fixture has no configured local provider')
    local.backend = 'json'
    local.root = await mkdtemp(join(root, 'world-'))
    const importedSpec = config[0]!.insert[2]!.config!.imports![0]!.spec as { relationRules: unknown[] }
    importedSpec.relationRules = [{ relation: 'supplies', subjectKinds: ['org'], objectKinds: ['org'], scopeKinds: ['org'], acyclic: false }]
    const configuredOverlay = join(local.root, 'overlay.json')
    await writeFile(configuredOverlay, JSON.stringify(config))
    const scaffold = await launchWebScaffold({ disableDefaultSimulation: true, extraOverlayPath: configuredOverlay, tempRoot: root, productPrincipalId: 'simulation-browser-user' })
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: VIEWPORTS.desktop, locale: 'zh-CN' })
    const errors = watchConsole(page)
    let run: SimulationRun | undefined
    try {
      const spec = simulationRunSpecSchema.parse(config[0]?.insert[2]?.config?.imports?.[0]?.spec)
      run = await scaffold.ctx.simulations.open(scaffold.ctx.simulations.resolve({ provider: 'local', spec, mode: 'create' }))
      await run.setPhase('running', 0)
      for (const id of ['仓储中心', '采购人员', '运输组织']) {
        await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id, entityKind: 'org', cognition: 'none',
          profile: { name: `${id}：供应链上下文`, secret: 'private-world-body' } }), run.snapshot().revision)
      }
      await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'source-a', relation: 'supplies', subject: '运输组织', object: '采购人员',
        scope: '仓储中心', validFrom: '0', validUntil: '9007199254740994' }), run.snapshot().revision)
      await run.drive({ until: '1240' as never })

      await scaffold.authenticateBrowserPage(page)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '仿真', exact: true }).click()
      const workspace = page.locator('[data-simulation-workspace-page]')
      await workspace.getByRole('heading', { name: '仿真', exact: true }).waitFor()
      await workspace.getByRole('button').filter({ hasText: '物流仿真' }).first().waitFor()
      await captureMatrix(page, '20-simulation-directory', manifest)

      await workspace.getByRole('button').filter({ hasText: '物流仿真' }).first().click()
      await workspace.getByRole('button', { name: '概览', exact: true }).first().waitFor()
      await captureMatrix(page, '21-simulation-overview', manifest)
      for (const [name, state] of [['实体', '22-simulation-entities'], ['决策', '23-simulation-decisions'],
        ['操作', '24-simulation-operations'], ['检查点', '25-simulation-checkpoints'], ['历史', '26-simulation-journal']] as const) {
        const tab = workspace.getByRole('button', { name, exact: true }).first()
        if (await tab.count() === 0) continue
        await tab.click()
        await settle(page)
        await captureMatrix(page, state, manifest, ['desktop'])
      }
      expect(errors.pageErrors).toEqual([])
    } finally {
      await writeManifest(manifest, 'simulation')
      await run?.close?.()
      await browser.close()
      await scaffold.close()
      await rm(local.root, { recursive: true, force: true })
    }
  }, 600_000)
})
