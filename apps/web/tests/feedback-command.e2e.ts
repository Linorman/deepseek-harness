// Keyless assembled-browser coverage for the /feedback command over an
// explicit legacy/custom Web composition and the real host wire. The command plane settles
// without a model turn: the host appends the log-only command/run +
// feedback/record + command/done lifecycle, and the transcript renders the
// acknowledgement — the recorded session id plus the session-sharing
// disclosure — as a persistent command row. The scaffold explicitly mounts
// the optional telemetry backend in FULL mode against a local dead endpoint
// (no record leaves the process), so the golden pins the default sentence
// `Session sharing is enabled.`; the per-status sentences are pinned by the
// package and OTel unit tests.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const ACK_EXPECTED = join(SNAPSHOT_DIR, 'ack.expected.md')
const MODE = webSnapshotMode()
// Discard port: loopback listener never binds, so FULL telemetry discloses
// the default policy without any record reaching a collector.
const TELEMETRY_URL = 'http://127.0.0.1:9/v1/logs'

const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe('web e2e: /feedback command acknowledgement', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ legacyWorkspaceSurface: true, telemetryUrl: TELEMETRY_URL })
    const fixture = await readFile(FIXTURE, 'utf8')
    expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
    await seedSession(scaffold, fixture, 'feedback-command-web-e2e')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens the recorded ordinary Session before dispatching feedback', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-drive'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
  }, 60_000)

  it('records feedback and renders the acknowledgement with session id and sharing status', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-command'))
    // The opening test selected the recorded turn: the transcript is active (a
    // command row does not render while a fresh session is still blank) and
    // the replayed reply is on screen.
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    const input = page.locator('textarea').first()
    await input.fill('/feedback the diff view is unreadable')
    await input.press('Enter')
    // The command plane settles without a model turn: the ack row names the
    // recorded session and the mounted FULL backend's disclosure.
    await page.getByText(/Feedback recorded for session/).waitFor({ timeout: 10_000 })
    expect(await page.getByText(/Session sharing is enabled/).count()).toBe(1)
    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split('feedback-command-web-e2e').join('{{feedbackSessionId}}')
    await compareOrRefreshGolden(ACK_EXPECTED, snapshot, MODE)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'ack.expected.md'])
  })
})
