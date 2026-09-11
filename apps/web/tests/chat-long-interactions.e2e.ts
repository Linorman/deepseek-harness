// Long-history Chat behavior contract that stays valid under a virtualized
// renderer: wheel input only navigates to the semantic target; assertions pin
// content identity and interaction routing rather than scroll geometry or
// mounted row counts.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId, type SessionEvent } from '@clocky/clocky-session'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { conversationContextKey, newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SESSION_ID = 'chat-long-interactions-e2e'
const FIXTURE_TURNS = 88
const TOOL_TURN = FIXTURE_TURNS
const BRANCH_TURN = 80
const TARGET_CALL_1 = 'chat-scroll-088-1'
const TARGET_CALL_2 = 'chat-scroll-088-2'
const FIXTURE = createChatScrollFixture({
  markerPrefix: 'INTERACTION',
  title: 'CHAT_INTERACTION long semantic identity session',
  turns: FIXTURE_TURNS,
})

function carries(event: SessionEvent, marker: string): boolean {
  return JSON.stringify(event).includes(marker)
}

function textContent(content: readonly unknown[]): string {
  return content.flatMap((block) => {
    if (typeof block !== 'object' || block === null) return []
    const candidate = block as { type?: unknown; text?: unknown }
    return candidate.type === 'text' && typeof candidate.text === 'string'
      ? [candidate.text]
      : []
  }).join('')
}

async function nextPaint(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(() => { resolve() })
    }))
  })
}

async function openSeed(page: Page): Promise<void> {
  // The compact layout dropped group session counts; the seeded baseline is
  // the Ungrouped bucket once cold summaries load.
  await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
  // Search collapsed into a header action; expand it before filling.
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await results.first().waitFor({ timeout: 60_000 })
  const resultCount = await results.count()
  if (resultCount !== 1) throw new Error(`expected one seeded search result, received ${String(resultCount)}`)
  await results.click()
  await results.click()
  await page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false })
    .last().waitFor({ timeout: 30_000 })
  await nextPaint(page)
}

async function wheelUntilMounted(page: Page, selector: string, deltaY: number): Promise<void> {
  const scrollport = page.locator('[data-conversation-scroll]')
  const box = await scrollport.boundingBox()
  if (box === null) throw new Error('conversation scrollport has no layout box')
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(140, box.height / 3))
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await page.locator(selector).count() > 0) return
    await page.mouse.wheel(0, deltaY)
    await nextPaint(page)
  }
  throw new Error(`semantic Chat target did not mount: ${selector}`)
}

function requiredEvent<T extends SessionEvent['type']>(
  events: readonly SessionEvent[],
  type: T,
  marker: string,
): Extract<SessionEvent, { type: T }> {
  const event = events.find((candidate): candidate is Extract<SessionEvent, { type: T }> => (
    candidate.type === type && carries(candidate, marker)
  ))
  if (event === undefined) throw new Error(`${type} carrying ${marker} is absent`)
  return event
}

function messageKey(event: SessionEvent<'user/message'>): string {
  return conversationContextKey('input-message', String(event.data.id))
}

function assistantKey(event: SessionEvent<'assistant/message'>): string {
  return conversationContextKey('assistant-step', `${event.data.turn}:${event.data.step}`)
}

describe('web e2e: long Chat interaction contract', () => {
  let browser: Browser
  let page: Page
  let scaffold: WebScaffold
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ legacyWorkspaceSurface: true })
    await seedSession(scaffold, FIXTURE.log, SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 900)
    tripwire = watchConsole(page)
    await scaffold.authenticateBrowserPage(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeed(page)
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'long Chat interaction cleanup failed')
  })

  it.skipIf(MODE === 'record')('keeps heterogeneous rows and their actions bound to exact semantic identities', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-chat-long-interactions'))
    const source = scaffold.ctx.agents.get(SessionId(SESSION_ID))
    if (source === undefined) throw new Error('seeded long-history agent is not attached')

    const toolUserMarker = FIXTURE.markers.user(TOOL_TURN)
    const toolAssistantMarker = FIXTURE.markers.assistant(TOOL_TURN)
    const toolMarker1 = FIXTURE.markers.tool(TOOL_TURN, 1)
    const toolMarker2 = FIXTURE.markers.tool(TOOL_TURN, 2)
    const toolUserEvent = requiredEvent(source.session.events, 'user/message', toolUserMarker)
    const toolAssistantEvent = requiredEvent(source.session.events, 'assistant/message', toolAssistantMarker)
    const branchUserMarker = FIXTURE.markers.user(BRANCH_TURN)
    const branchAssistantMarker = FIXTURE.markers.assistant(BRANCH_TURN)
    const branchUserEvent = requiredEvent(source.session.events, 'user/message', branchUserMarker)
    const branchAssistantEvent = requiredEvent(source.session.events, 'assistant/message', branchAssistantMarker)
    const expectedUserText = textContent(branchUserEvent.data.content)

    await wheelUntilMounted(page, `[data-chat-call-id="${TARGET_CALL_2}"]`, -1_100)
    const toolUserKey = messageKey(toolUserEvent)
    const toolAssistantKey = assistantKey(toolAssistantEvent)
    const toolUserRow = page.locator(`[data-chat-anchor-key="${toolUserKey}"]`)
    const toolAssistantRow = page.locator(`[data-chat-anchor-key="${toolAssistantKey}"]`)
    const call1 = page.locator(`[data-chat-call-id="${TARGET_CALL_1}"]`)
    const call2 = page.locator(`[data-chat-call-id="${TARGET_CALL_2}"]`)

    await expect.poll(() => toolUserRow.count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => toolAssistantRow.count(), { timeout: 10_000 }).toBe(1)
    expect(await call1.count()).toBe(1)
    expect(await call2.count()).toBe(1)
    expect(await toolUserRow.getAttribute('data-chat-flow-kind')).toBe('user')
    expect(await toolAssistantRow.getAttribute('data-chat-flow-kind')).toBe('assistant-step')
    expect(await toolUserRow.textContent()).toContain(toolUserMarker)
    expect(await toolAssistantRow.textContent()).toContain(toolAssistantMarker)
    expect(await call1.textContent()).toContain(toolMarker1)
    expect(await call2.textContent()).toContain(toolMarker2)

    const expectedOrder = [
      toolUserKey,
      conversationContextKey('tool-call', TARGET_CALL_1),
      conversationContextKey('tool-call', TARGET_CALL_2),
      toolAssistantKey,
    ]
    const actualOrder = await page.locator('[data-chat-anchor-key]').evaluateAll((rows, keys) => (
      rows.map(row => (row as HTMLElement).dataset.chatAnchorKey)
        .filter((key): key is string => key !== undefined && keys.includes(key))
    ), expectedOrder)
    expect(actualOrder).toEqual(expectedOrder)
    const toolKinds = await Promise.all([call1, call2].map(row => row.evaluate(element => (
      element.closest<HTMLElement>('[data-chat-flow-kind]')?.dataset.chatFlowKind ?? null
    ))))
    expect(toolKinds).toEqual(['tool-call', 'tool-call'])

    const summary1 = call1.locator('[data-sample="bash"]')
    const summary2 = call2.locator('[data-sample="bash"]')
    expect(await summary1.getAttribute('aria-expanded')).toBe('false')
    expect(await summary2.getAttribute('aria-expanded')).toBe('false')
    await summary2.focus()
    await summary2.press('Enter')
    await expect.poll(() => summary2.getAttribute('aria-expanded'), { timeout: 10_000 }).toBe('true')
    expect(await summary1.getAttribute('aria-expanded')).toBe('false')
    await call2.getByText(`${toolMarker2} output line 12`, { exact: true }).waitFor({ timeout: 10_000 })

    const branchUserKey = messageKey(branchUserEvent)
    const branchAssistantKey = assistantKey(branchAssistantEvent)
    await wheelUntilMounted(page, `[data-chat-anchor-key="${branchUserKey}"]`, -1_100)
    const userRow = page.locator(`[data-chat-anchor-key="${branchUserKey}"]`)
    const assistantRow = page.locator(`[data-chat-anchor-key="${branchAssistantKey}"]`)
    expect(await userRow.textContent()).toContain(branchUserMarker)
    expect(await assistantRow.textContent()).toContain(branchAssistantMarker)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await userRow.hover()
    await userRow.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
      .toBe(expectedUserText)

    expect(await page.getByRole('button', { name: 'Branch into a new conversation' }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 180_000)
})
