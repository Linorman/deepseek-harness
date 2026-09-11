// Web e2e scenario for Team-first steering: the browser starts a durable Team,
// a real Team `steer` Envelope waits behind the model's question, and the
// queue mirror exposes its retained delivery intent before the step resumes.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { parseSessionLog } from '@clocky/clocky-llm-replay'
import type { SessionEvent } from '@clocky/clocky-session'
import type { TeamId, TeamStateSnapshot } from '@clocky/clocky-team'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/steering', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const MID_EXPECTED = join(SNAPSHOT_DIR, 'mid-steer.expected.md')
const SETTLED_EXPECTED = join(SNAPSHOT_DIR, 'settled.expected.md')
const MODE = webSnapshotMode()
const REPLAY_PACE_MS = 50

const PROMPT = 'Use the ask_user_question tool to ask me exactly one question with id "checkpoint", question "Ready to continue?", header "Checkpoint", and options labeled "Yes" and "No". After I answer, reply with one short sentence acknowledging my answer and stop.'
const STEER = 'Interjection: include the word BANANA in your final reply.'

/** Concatenated assistant text deltas — the model-visible reply body. */
function assistantText(events: SessionEvent[]): string {
  return events
    .filter(e => e.type === 'assistant/chunk')
    .map((e) => {
      const chunk = (e as SessionEvent & { data: { chunk: { type: string; text?: string } } }).data.chunk
      return chunk.type === 'text-delta' ? chunk.text ?? '' : ''
    })
    .join('')
}

/** Claimed user messages whose payload contains the exact scenario text. */
function claimedMessages(events: readonly SessionEvent[], text: string): SessionEvent<'user/message'>[] {
  return events.filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message' && JSON.stringify(event.data.content).includes(text))
}

/** Read the Team created by the browser's first Team-draft submission. */
async function currentTeamId(scaffold: WebScaffold): Promise<TeamId> {
  const response = await scaffold.authenticatedRpc<{ items: readonly { readonly id: TeamId }[] }>('team.list', {})
  if (!response.result.ok) throw new Error(`team.list failed: ${response.result.error.message}`)
  const team = response.result.value.items.at(-1)
  if (team === undefined) throw new Error('the browser did not create a Team')
  return team.id
}

describe('web e2e: Team-first steering lands durably and visibly', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'record'
      ? {}
      : { replayFixture: FIXTURE, paceMs: REPLAY_PACE_MS })
    scaffold.ctx.on('session/event', (_session, event) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps a Team steer pending until the question is answered, then records and renders it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-steering'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT, STEER])
    }
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled(MODE === 'record' ? 180_000 : 30_000)
    await input.fill(PROMPT)
    await input.press('Enter')

    const composer = page.locator('[data-question-key]')
    await composer.waitFor({ timeout: MODE === 'record' ? 120_000 : 30_000 })
    const teamId = await currentTeamId(scaffold)
    const posted = await scaffold.authenticatedRpc('team.postInput', { teamId, text: STEER, delivery: 'steer' })
    if (!posted.result.ok) throw new Error(`team.postInput failed: ${posted.result.error.message}`)
    const state = await scaffold.authenticatedRpc<TeamStateSnapshot>('team.get', { teamId })
    if (!state.result.ok) throw new Error(`team.get failed: ${state.result.error.message}`)
    const channelId = state.result.value.channelIds[0]
    if (channelId === undefined) throw new Error('Team steering fixture has no default channel')
    const channel = await scaffold.ctx.teams.readChannel({ channelId, afterCursor: -1 })
    const steerRecord = channel.records.find(record => record.type === 'channel/envelope'
      && record.envelope.payload.content !== undefined
      && JSON.stringify(record.envelope.payload.content).includes(STEER))
    if (steerRecord === undefined) throw new Error(`Team steering Envelope was not persisted: ${JSON.stringify(channel.records)}`)
    const coordinator = state.result.value.participants.find(participant => participant.role === 'coordinator')
    const activation = coordinator === undefined
      ? undefined
      : state.result.value.activations.find(item => item.activation.participantId === coordinator.id)
    if (activation === undefined) throw new Error('Team steering fixture has no coordinator activation')
    const coordinatorAgent = scaffold.ctx.agents.get(activation.sessionId)
    if (coordinatorAgent === undefined) throw new Error('Team steering fixture has no live coordinator Agent')
    await expect.poll(() => {
      const messages = [...coordinatorAgent.inbox.nextStep, ...coordinatorAgent.inbox.nextTurn]
      if (messages.some(message => message.source.kind === 'team-envelope'
        && message.source.delivery === 'steer' && JSON.stringify(message.content).includes(STEER))) return true
      return JSON.stringify({
        status: coordinatorAgent.status,
        nextStep: coordinatorAgent.inbox.nextStep.map(message => ({ id: message.id, source: message.source, content: message.content })),
        nextTurn: coordinatorAgent.inbox.nextTurn.map(message => ({ id: message.id, source: message.source, content: message.content })),
      })
    }, { timeout: 10_000 }).toBe(true)

    const pendingSteering = page.locator('[data-pending-steering]').filter({ hasText: STEER })
    await pendingSteering.waitFor({ timeout: 10_000 })
    if (MODE !== 'record') {
      expect(await pendingSteering.count()).toBe(1)
      const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(MID_EXPECTED, snapshot, MODE)
    }

    await composer.getByRole('radio', { name: 'Yes' }).click()
    await composer.getByRole('radio', { name: 'Yes' }).press('Enter')
    const sessionId = await settled

    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
      const recorded = parseSessionLog(await readFile(FIXTURE, 'utf8'))
      expect(claimedMessages(recorded, STEER)).toHaveLength(1)
      expect(assistantText(recorded)).toContain('BANANA')
      return
    }

    const steerEvents = claimedMessages(sessionEvents, STEER)
    expect(steerEvents).toHaveLength(1)
    expect(steerEvents[0]?.data.source).toMatchObject({ kind: 'team-envelope', delivery: 'steer' })
    expect(JSON.stringify(steerEvents[0])).toContain('BANANA')
    const turnEnds = sessionEvents.filter(e => e.type === 'turn/end')
    expect(turnEnds).toHaveLength(1)
    expect((turnEnds[0] as SessionEvent & { data: { reason: { kind: string } } }).data.reason.kind).toBe('completed')
    expect(await pendingSteering.count()).toBe(0)
    const deliveredSteer = page.locator('[data-chat-flow-kind="steering"]').filter({ hasText: STEER })
    await expect.poll(() => deliveredSteer.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    await expect.poll(() => page.getByText('BANANA', { exact: false }).count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
    expect(await page.locator('[data-question-key]').count()).toBe(0)
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SETTLED_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 200_000)

  it.skipIf(MODE === 'record')('keeps the Team steering fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'mid-steer.expected.md', 'settled.expected.md'])
  })
})
