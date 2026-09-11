// Web e2e scenario: the plan-review takeover. The shipped composition mounts
// plan mode and its client seat, so `/plan <task>` enters plan mode for real
// and the recorded turn ends on exit_plan_mode blocking against the live
// userInteraction seam. The composer is then occupied by the plan decision
// card — not the generic question flow — and approving it through the card
// completes the turn with the approval in the log.
// Replay is deterministic: the plan content arrives from replayed chunks, the
// review wait is real, and the approve click is the test's own gesture (the
// turn cannot complete without it, in record and replay alike).
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@clocky/clocky-session'
import { SessionId } from '@clocky/clocky-session'
import type { TeamStateSnapshot } from '@clocky/clocky-team'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/plan-review', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
// The waiting golden owns the decision card; the approved golden owns the
// transcript the approval leaves behind — the state the card cannot see.
const REVIEW_EXPECTED = join(SNAPSHOT_DIR, 'review.expected.md')
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
const APPROVED_EXPECTED = join(SNAPSHOT_DIR, 'approved.expected.md')
const MODE = webSnapshotMode()

// The task is deliberately self-contained (nothing to explore in a fresh
// workspace) so the recorded turn is a plan and its review, and the approved
// continuation is one word. Setup seeds plan mode on the Team-owned
// coordinator, so the first model-visible prompt remains exactly TASK.
const TASK = 'Plan a small change: add a --greeting flag to a CLI. Do not read or write any files. '
  + 'Call exit_plan_mode with a short plan of at most five bullet points. '
  + 'Once the plan is approved, reply with the single word DONE and stop.'
const OBJECTIVE = 'Open the plan review task.'

describe('web e2e: plan review takeover round trip', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15 })
    const created = await scaffold.authenticatedRpc<TeamStateSnapshot>('team.create', {
      objective: OBJECTIVE,
      cwd: scaffold.workspaceCwd,
      agentPreset: 'standard',
    })
    if (!created.result.ok) throw new Error(`team.create failed: ${created.result.error.message}`)
    const coordinator = created.result.value.participants.find(participant => participant.role === 'coordinator')
    const activation = coordinator === undefined
      ? undefined
      : created.result.value.activations.find(binding => binding.activation.participantId === coordinator.id)
    if (activation === undefined) throw new Error('plan-review Team has no coordinator activation')
    const session = scaffold.ctx.sessions.get(SessionId(activation.sessionId))
    if (session === undefined) throw new Error('plan-review coordinator Session was not published')
    session.append('plan/mode', { active: true })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    // English page: the decision copy is the surface under test, and the
    // golden pins one language.
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByText(OBJECTIVE, { exact: true }).waitFor({ timeout: 15_000 })
    await page.getByText(OBJECTIVE, { exact: true }).click()
    await page.locator('section[aria-label="Tasks"] [aria-current="page"]').waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('reviews the plan on a decision card and approves through it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plan-review'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([TASK])
    }
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled(MODE === 'record' ? 180_000 : 30_000)
    await input.fill(TASK)
    await input.press('Enter')

    // The card takes over the input area while exit_plan_mode blocks. Its
    // presence is a STABLE waiting state (it stays until answered), so a plain
    // waitFor is race-free.
    const card = page.locator('[data-plan-review-key]')
    await card.waitFor({ timeout: MODE === 'record' ? 120_000 : 30_000 })
    // The plan-review request must NOT land on the generic question flow.
    expect(await page.locator('[data-question-key]').count()).toBe(0)
    await expect.poll(() => card.getByText('Plan review').count(), { timeout: 10_000 }).toBeGreaterThan(0)

    const selectedTask = page.locator('section[aria-label="Tasks"] [aria-current="page"]')
    await expect.poll(() => selectedTask.count(), { timeout: 10_000 }).toBe(1)

    if (MODE !== 'record') {
      const snapshot = await captureStableAria(page, '[data-plan-review-key]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(REVIEW_EXPECTED, snapshot, MODE)
      const sidebar = await captureStableAria(page, 'section[aria-label="Tasks"] [aria-current="page"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(SIDEBAR_EXPECTED, sidebar, MODE)
    }

    await card.getByRole('button', { name: 'Approve' }).click()

    const sessionId = await settled
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
      return
    }
    // World state: the approval reached the tool, and plan mode is left behind.
    const results = sessionEvents.filter(e => e.type === 'tool/result')
    expect(JSON.stringify(results.at(-1))).toContain('Plan approved')
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    // Card gone; regular input restored.
    expect(await page.locator('[data-plan-review-key]').count()).toBe(0)
    expect(await selectedTask.count()).toBe(1)
    await expect.poll(() => page.locator('textarea').first().isEnabled(), { timeout: 10_000 }).toBe(true)
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(APPROVED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 200_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.jsonl', 'review.expected.md', 'sidebar.expected.md', 'approved.expected.md',
    ])
  })
})
