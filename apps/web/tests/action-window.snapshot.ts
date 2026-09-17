/** Actual question tool and authenticated inbox remain usable without a global action-body cache. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { TeamStateSnapshot, TeamHumanInboxPage } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

it('loads a durable question into the current inbox page and submits its answer', async () => {
  const output = join(process.cwd(), '.tmp/native-multi-agent-closure/action-window-browser')
  await mkdir(output, { recursive: true })
  const replay = join(output, 'replay.json')
  const args = JSON.stringify({ questions: [{ id: 'format', header: 'Format', question: 'Which output format?',
    options: [{ label: 'Text', description: 'A plain text answer.' }, { label: 'Table', description: 'A structured table.' }] }] })
  await writeFile(replay, JSON.stringify([
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'ask-format', name: 'ask_user_question', argumentsDelta: args },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'ask-format', name: 'ask_user_question', arguments: args } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] },
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Answer received.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Answer received.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
  ]))
  const retentionOverlay = join(output, 'retention.overlay.yml')
  await writeFile(retentionOverlay, '- id: team-human-client\n  config:\n    storagePageSize: 32\n    maxPageSize: 32\n    maxDeliveryBytes: 262144\n    maxPendingOperations: 128\n    watchTimeoutMs: 30000\n    pollIntervalMs: 50\n    retention:\n      tailRecords: 1\n      maxStreamsPerDrive: 64\n      maxRecordsPerDrive: 8\n      maxBytesPerDrive: 1048576\n')
  const scaffold = await launchWebScaffold({
    replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'), replayOverride: replay, extraOverlayPath: retentionOverlay,
  })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const consoleState = watchConsole(page)
  let failure: unknown
  try {
    await scaffold.authenticateBrowserPage(page)
    const created = await scaffold.authenticatedRpc<TeamStateSnapshot>('team.create', { objective: 'Inbox page question', cwd: scaffold.workspaceCwd })
    if (!created.result.ok) throw new Error(created.result.error.message)
    const teamId = created.result.value.team.id
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    const settled = scaffold.whenTurnSettled(30000)
    const input = await scaffold.authenticatedRpc('team.postInput', { teamId, text: 'Ask for the output format.' })
    if (!input.result.ok) throw new Error(input.result.error.message)
    await expect.poll(async () => {
      const inbox = await scaffold.authenticatedRpc<TeamHumanInboxPage>('team.inbox.read', {})
      return inbox.result.ok && inbox.result.value.items.some(item => item.kind === 'action' && item.action.phase === 'pending')
    }).toBe(true)
    await page.getByRole('button', { name: '收件箱', exact: true }).click()
    const inbox = page.getByRole('dialog', { name: '收件箱', exact: true })
    await inbox.getByText('Which output format?', { exact: true }).waitFor()
    await inbox.getByRole('button', { name: '核对当前请求', exact: true }).click()
    await inbox.getByRole('button', { name: '提交答复', exact: true }).waitFor()
    await inbox.getByLabel('其他答复').fill('Use plain text and retain the answer.')
    await page.screenshot({ path: join(output, 'question-draft.png'), animations: 'disabled' })
    const response = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/team.inbox.respond')
    await inbox.getByRole('button', { name: '提交答复', exact: true }).click()
    const answered = await (await response).json() as { result: { ok: boolean; value: { kind: string } } }
    expect(answered.result).toMatchObject({ ok: true, value: { kind: 'accepted' } })
    await settled
    expect(consoleState.pageErrors).toEqual([])
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    await page.screenshot({ path: join(output, 'question-answered.png'), animations: 'disabled' })
    const acknowledgement = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/team.inbox.acknowledge')
    await inbox.getByRole('button', { name: '将已加载消息标为已读', exact: true }).click()
    const acknowledged = await (await acknowledgement).json() as { result: { ok: boolean; value: { displayCursor: number } } }
    expect(acknowledged.result.ok).toBe(true)
    let firstCursor: number | undefined
    await expect.poll(async () => {
      const result = await scaffold.authenticatedRpc<TeamHumanInboxPage>('team.inbox.read', { afterCursor: -1 })
      if (result.result.ok || result.result.error.code !== 'team-inbox-compacted') return false
      firstCursor = result.result.error.details.firstCursor
      return firstCursor !== undefined
    }).toBe(true)
    if (firstCursor === undefined) throw new Error('Retention did not publish its first cursor')
    const history = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/team.inbox.read')
    await inbox.getByRole('button', { name: '查看历史', exact: true }).click()
    expect(await (await history).json()).toMatchObject({ result: { ok: false,
      error: { code: 'team-inbox-compacted', details: { firstCursor } } } })
    await inbox.getByRole('button', { name: '查看保留的历史', exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'retained-boundary.png'), animations: 'disabled' })
    const recovery = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/team.inbox.read')
    await inbox.getByRole('button', { name: '查看保留的历史', exact: true }).click()
    const recovered = await recovery
    expect(recovered.request().postDataJSON()).toMatchObject({ payload: { afterCursor: firstCursor - 1 } })
    expect(await recovered.json()).toMatchObject({ result: { ok: true } })
    await expect.poll(() => inbox.getByRole('button', { name: '查看保留的历史', exact: true }).count()).toBe(0)
    await page.screenshot({ path: join(output, 'retained-history.png'), animations: 'disabled' })

  } catch (error: unknown) { failure = error; throw error }
  finally {
    await browser.close()
    try { await scaffold.close() } catch (error: unknown) { if (failure === undefined) throw error }
  }
}, 90000)
