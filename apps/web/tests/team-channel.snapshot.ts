import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import type { ChannelId, ChannelAdmissionSnapshot, ChannelHumanAdmissionSnapshot, ChannelHumanInvitationSnapshot, ChannelReadPageResult, TeamStateSnapshot, TeamEnvelope } from '@clocky/clocky-team'
import { launchWebScaffold, watchConsole, recordFixture } from './scaffold.ts'

it('accepts human channel invitations, observes other-client WAL updates and cancels pending opening through the real browser', async () => {
  const output = join(process.cwd(), '.tmp/team-channel-browser-evidence')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'client-build-inputs.json'), await readFile(join(process.cwd(), '.clocky-build/client-build-environment.json')))
  const override = join(output, 'replay.json')
  await writeFile(override, JSON.stringify([{ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '通道消息已经收到。' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '通道消息已经收到。' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }]))
  const pagingOverlay = join(output, 'paging.overlay.yml')
  await writeFile(pagingOverlay, '- id: team-hub\n  config:\n    recoveryPageSize: 1\n')
  const scaffold = await launchWebScaffold({ replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'),
    replayOverride: override, extraOverlayPath: pagingOverlay, replayInputModalities: ['text', 'image'] })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const socketRoutes: WebSocketRoute[] = []
  let blockSocketReconnects = false
  await page.routeWebSocket(/\/api\/events\.(mux|host)/, (socket) => {
    if (blockSocketReconnects) { void socket.close({ code: 1001, reason: 'browser reconnect evidence hold' }); return }
    socketRoutes.push(socket)
    socket.connectToServer()
  })
  const errors = watchConsole(page)
  const failures: unknown[] = []
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) throw new Error(`${method}: ${response.result.error.message}`)
    return response.result.value
  }
  async function readChannelEvidence(channelId: ChannelId): Promise<ChannelReadPageResult> {
    let page = await rpc<ChannelReadPageResult>('team.channel.read', { channelId, afterCursor: -1, limit: 128 })
    const throughCursor = page.channel.cursor
    const records = [...page.records]
    let afterCursor = page.nextCursor
    while (afterCursor !== undefined && afterCursor < throughCursor) {
      page = await rpc<ChannelReadPageResult>('team.channel.read', { channelId, afterCursor, limit: 128 })
      if (page.nextCursor !== undefined && page.nextCursor <= afterCursor) throw new Error('Channel evidence returned a non-advancing cursor')
      records.push(...page.records.filter(record => (record.type === 'channel/envelope' ? record.envelope.sequence : record.sequence) <= throughCursor))
      afterCursor = page.nextCursor
    }
    return { ...page, records }
  }
  let created: TeamStateSnapshot | undefined
  try {
    const modelImageCapability = (await scaffold.ctx.llm.resolveModelInfo('test-provider', 'test-model')).inputModalities?.includes('image') === true
    expect(modelImageCapability).toBe(true)
    await scaffold.authenticateBrowserPage(page)
    created = await rpc<TeamStateSnapshot>('team.create', { objective: '验证通道邀请与实时记录', cwd: scaffold.workspaceCwd })
    const teamId = created.team.id
    const coordinator = created.participants.find(participant => participant.role === 'coordinator')
    if (coordinator === undefined) throw new Error('Created Team has no coordinator')
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '验证通道邀请与实时记录 进行中' }).click()
    await page.getByRole('button', { name: '打开任务详情' }).click()
    const panel = page.locator('[data-team-detail-panel]')
    const channels = panel.getByRole('region', { name: '通道', exact: true })
    let channelListContinuations = 0
    async function openPending(): Promise<ChannelId> {
      const before = await rpc<TeamStateSnapshot>('team.get', { teamId })
      await channels.getByRole('button', { name: '新建通道', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '新建通道' })
      await dialog.getByRole('radio', { name: '直接消息 v4', exact: true }).check()
      await dialog.getByRole('radio', { name: 'summarized-window v1', exact: true }).check()
      await dialog.getByRole('button', { name: '新建通道', exact: true }).click()
      await expect.poll(() => dialog.count()).toBe(0)
      const after = await rpc<TeamStateSnapshot>('team.get', { teamId })
      const id = after.channelIds.find(id => !before.channelIds.includes(id))
      if (id === undefined) throw new Error('UI did not attach a new channel')
      const channelButton = panel.locator(`[data-channel-id="${id}"]`)
      for (let index = 0; index < after.channelIds.length && await channelButton.count() === 0; index++) {
        const more = channels.getByRole('button', { name: '加载更多通道', exact: true })
        if (await more.count() === 0) await channels.getByRole('button', { name: '刷新通道列表', exact: true }).click()
        await more.waitFor()
        const beforeCount = await channels.locator('[data-channel-id]').count()
        await more.click()
        channelListContinuations += 1
        await expect.poll(() => channels.locator('[data-channel-id]').count()).toBeGreaterThan(beforeCount)
      }
      await channelButton.click()
      await channels.getByRole('button', { name: '接受通道邀请' }).waitFor()
      const metadata = channels.getByRole('region', { name: '参与者确认状态', exact: true })
      await metadata.waitFor()
      const admission = await rpc<ChannelAdmissionSnapshot>('team.channel.admission', { teamId, channelId: id })
      expect(admission.invitations).toHaveLength(2)
      expect(await metadata.locator('time').count()).toBe(2)
      for (const invitation of admission.invitations) {
        const participant = after.participants.find(candidate => candidate.id === invitation.participantId)
        if (participant === undefined) throw new Error('Invitation participant is absent from the Team')
        await metadata.getByText(new RegExp(`\\b${participant.role}\\b`)).waitFor()
        expect(await metadata.innerText()).not.toContain(invitation.manifestFingerprint)
      }
      expect((await rpc<ChannelHumanInvitationSnapshot>('team.channel.invitation', { channelId: id })).invitation.status).toBe('pending')
      return id
    }
    const active = await openPending()
    const pending = await rpc<ChannelHumanInvitationSnapshot>('team.channel.invitation', { channelId: active })
    const staleAcknowledgement = await scaffold.authenticatedRpc<ChannelHumanInvitationSnapshot>('team.channel.invitation.acknowledge', {
      channelId: active, revision: pending.invitation.revision + 1, manifestFingerprint: pending.invitation.manifestFingerprint,
      idempotencyKey: 'browser-stale-invitation',
    })
    expect(staleAcknowledgement.result.ok).toBe(false)
    if (staleAcknowledgement.result.ok) throw new Error('A stale invitation revision was accepted')
    const staleAcknowledgementError = staleAcknowledgement.result.error.code
    expect(staleAcknowledgementError).toBe('team-channel-cursor-conflict')
    expect((await rpc<ChannelHumanInvitationSnapshot>('team.channel.invitation', { channelId: active })).invitation.status).toBe('pending')
    const consent = channels.getByRole('button', { name: '接受通道邀请' }).locator('..')
    await consent.scrollIntoViewIfNeeded()
    await consent.screenshot({ path: join(output, '01-invitation.png') })
    await channels.getByRole('button', { name: '接受通道邀请' }).click()
    await expect.poll(async () => (await rpc<ChannelHumanInvitationSnapshot>('team.channel.invitation', { channelId: active })).channel.phase).toBe('active')
    const accepted = await rpc<ChannelHumanInvitationSnapshot>('team.channel.invitation', { channelId: active })
    await channels.getByRole('button', { name: '发送消息', exact: true }).waitFor()
    await expect.poll(() => socketRoutes.length).toBeGreaterThanOrEqual(2)
    const beforeReconnect = await rpc<ChannelReadPageResult>('team.channel.read', { channelId: active, afterCursor: -1, limit: 128 })
    blockSocketReconnects = true
    await socketRoutes[0]!.close({ code: 1001, reason: 'browser reconnect evidence' })
    await channels.getByText('连接已中断；保留当前记录，重连后继续更新。', { exact: true }).waitFor()
    const reconnectEnvelope = await rpc<TeamEnvelope>('team.channel.post', { channelId: active, expectedCursor: beforeReconnect.channel.cursor,
      audience: [coordinator.id], kind: 'message', payload: { content: [{ type: 'text', text: 'RECONNECT_CONTEXT' }] },
      delivery: 'context', idempotencyKey: 'browser-reconnect-context' })
    const reconnectRead = await rpc<ChannelReadPageResult>('team.channel.read', { channelId: active, afterCursor: beforeReconnect.channel.cursor, limit: 128 })
    await writeFile(join(output, 'reconnect.json'), JSON.stringify(reconnectRead, null, 2))
    expect(reconnectRead.records.some(record => record.type === 'channel/envelope' && JSON.stringify(record.envelope.payload).includes('RECONNECT_CONTEXT'))).toBe(true)
    blockSocketReconnects = false
    await channels.getByText('通道有新记录；加载后续记录或刷新以查看。', { exact: true }).waitFor()
    for (let index = 0; index < 16 && await channels.getByText('RECONNECT_CONTEXT', { exact: true }).count() === 0; index++) {
      const reconnectCount = await channels.locator('[data-channel-record]').count()
      await channels.getByRole('button', { name: '加载更多', exact: true }).click()
      await expect.poll(() => channels.locator('[data-channel-record]').count()).toBeGreaterThan(reconnectCount)
    }
    await channels.getByText('RECONNECT_CONTEXT', { exact: true }).waitFor()
    expect(reconnectEnvelope.sequence).toBeGreaterThan(beforeReconnect.channel.cursor)
    await page.screenshot({ path: join(output, '04-reconnect.png') })
    const cancelled = await openPending()
    await channels.getByRole('button', { name: '取消开通', exact: true }).click()
    const cancelDialog = page.getByRole('dialog', { name: '取消开通' })
    await cancelDialog.getByRole('button', { name: '取消开通', exact: true }).click()
    await expect.poll(() => cancelDialog.count()).toBe(0)
    const cancellation = await rpc<ChannelHumanInvitationSnapshot>('team.channel.invitation', { channelId: cancelled })
    expect(cancellation.channel.phase).toBe('closed')
    expect(cancellation.invitation.status).toBe('cancelled')
    await page.screenshot({ path: join(output, '02-pending-cancelled.png') })
    await panel.locator(`[data-channel-id="${active}"]`).click()
    await channels.getByRole('button', { name: '发送消息', exact: true }).waitFor()
    const before = await rpc<ChannelReadPageResult>('team.channel.read', { channelId: active, afterCursor: -1 })
    const envelopeCount = await channels.locator('[data-channel-message]').count()
    const contextEnvelope = await rpc<TeamEnvelope>('team.channel.post', { channelId: active, expectedCursor: before.channel.cursor,
      audience: [coordinator.id], kind: 'message', payload: { content: [{ type: 'text', text: 'OTHER_CLIENT_CONTEXT' }] },
      delivery: 'context', idempotencyKey: 'browser-other-client-context' })
    await channels.getByText('通道有新记录；加载后续记录或刷新以查看。', { exact: true }).waitFor()
    const backgroundHistoryStable = await channels.locator('[data-channel-message]').count() === envelopeCount
    expect(backgroundHistoryStable).toBe(true)
    const contextRecord = channels.locator('[data-channel-message]').filter({ hasText: 'OTHER_CLIENT_CONTEXT' })
    while (await contextRecord.count() === 0) {
      const count = await channels.locator('[data-channel-record]').count()
      await channels.getByRole('button', { name: '加载更多', exact: true }).click()
      await expect.poll(() => channels.locator('[data-channel-record]').count()).toBeGreaterThan(count)
    }
    await contextRecord.getByText('OTHER_CLIENT_CONTEXT', { exact: true }).waitFor()
    await page.screenshot({ path: join(output, '03-watched-record.png') })
    await channels.getByRole('button', { name: '生成通道摘要', exact: true }).click()
    const summaryDialog = page.getByRole('dialog', { name: '生成通道摘要', exact: true })
    await summaryDialog.getByLabel('起始记录序号', { exact: true }).fill(String(contextEnvelope.sequence))
    await summaryDialog.getByLabel('结束记录序号', { exact: true }).fill(String(contextEnvelope.sequence))
    await summaryDialog.getByRole('button', { name: '生成通道摘要', exact: true }).click()
    await expect.poll(() => summaryDialog.count()).toBe(0)
    await channels.getByRole('region', { name: '已保存的通道摘要', exact: true }).getByText(/OTHER_CLIENT_CONTEXT/).waitFor()
    await page.screenshot({ path: join(output, '07-durable-summary.png') })
    const settled = scaffold.whenTurnSettled(60_000).then(sessionId => ({ ok: true as const, sessionId }), error => ({ ok: false as const, error }))
    await channels.getByRole('button', { name: '发送消息', exact: true }).click()
    const message = page.getByRole('dialog', { name: '发送消息' })
    await message.getByLabel('消息内容').fill('请确认收到此通道消息。')
    await message.getByRole('radio', { name: '广播给通道中的其他成员', exact: true }).check()
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
    await message.locator('input[type=file]').setInputFiles({ name: 'channel.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await message.getByAltText('channel.png', { exact: true }).waitFor()
    await message.getByRole('button', { name: '添加文字', exact: true }).click()
    await message.getByLabel('文字内容 3', { exact: true }).fill('图片之后的说明。')
    await message.getByRole('button', { name: '上移内容项 2', exact: true }).click()
    await message.getByRole('button', { name: '下移内容项 1', exact: true }).click()
    await page.screenshot({ path: join(output, '05-ordered-draft.png') })
    await message.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect.poll(() => message.count()).toBe(0)
    const turn = await settled
    if (!turn.ok) throw turn.error
    await recordFixture(scaffold, turn.sessionId, join(output, 'coordinator-session.jsonl'))
    await page.getByText('通道消息已经收到。', { exact: true }).first().waitFor()
    const activeRecords = await readChannelEvidence(active)
    const savedSummary = activeRecords.records.find(record => record.type === 'channel/summary' && record.sourceEnvelopeIds.includes(contextEnvelope.id))
    if (savedSummary?.type !== 'channel/summary') throw new Error('The selected source summary is absent from the WAL')
    const posted = activeRecords.records.find(record => record.type === 'channel/envelope'
      && record.envelope.audience === null && JSON.stringify(record.envelope.payload).includes('channel.png'))
    if (posted?.type !== 'channel/envelope' || !Array.isArray(posted.envelope.payload.content)) throw new Error('Broadcast image message is absent from the WAL')
    const orderedContentTypes = posted.envelope.payload.content.map(part => typeof part === 'object' && part !== null && !Array.isArray(part) ? part.type : undefined)
    expect(orderedContentTypes).toEqual(['text', 'image', 'text'])
    expect(posted.envelope.payload.content[1]).toMatchObject({ type: 'image', attachment: { mediaType: 'image/png', width: 1, height: 1, name: 'channel.png' } })
    expect(posted.envelope.payload.content[1]).not.toHaveProperty('data')
    const imageMessage = channels.locator(`[data-channel-message="${posted.envelope.id}"]`)
    while (await imageMessage.count() === 0) {
      const count = await channels.locator('[data-channel-record]').count()
      await channels.getByRole('button', { name: '加载更多', exact: true }).click()
      await expect.poll(() => channels.locator('[data-channel-record]').count()).toBeGreaterThan(count)
    }
    const image = imageMessage.getByAltText('channel.png', { exact: true })
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth === 1)).toBe(true)
    const imagePreviewLoaded = (await image.getAttribute('src'))?.startsWith('data:image/png;base64,') === true
    await imageMessage.getByRole('button', { name: '查看原图：channel.png', exact: true }).click()
    await page.getByRole('dialog', { name: '查看原图', exact: true }).waitFor()
    await page.screenshot({ path: join(output, '06-saved-image-preview.png') })
    await page.getByRole('button', { name: '关闭原图', exact: true }).click()
    await writeFile(join(output, 'active-channel.json'), JSON.stringify(activeRecords, null, 2))
    await writeFile(join(output, 'cancelled-channel.json'), JSON.stringify(cancellation, null, 2))
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: join(output, '04-narrow.png') })
    expect(errors.pageErrors).toEqual([])
    const actual = `${JSON.stringify({ adapter: accepted.channel.manifest.adapter, invitation: accepted.invitation.status,
      metadataEndpoints: (await rpc<ChannelAdmissionSnapshot>('team.channel.admission', { teamId, channelId: active })).invitations.length,
      channelListContinuations,
      staleAcknowledgementError,
      cancelledChannel: cancellation.channel.phase, cancelledInvitation: cancellation.invitation.status,
      observedContext: activeRecords.records.some(record => record.type === 'channel/envelope'
        && JSON.stringify(record.envelope.payload).includes('OTHER_CLIENT_CONTEXT')),
      broadcast: posted.envelope.audience === null, orderedContentTypes, imagePreviewLoaded, modelImageCapability,
      selectedViewPolicy: accepted.channel.manifest.viewPolicy,
      summaryCoversSelectedMessage: savedSummary.coveredSequenceRange.from === contextEnvelope.sequence && savedSummary.coveredSequenceRange.to === contextEnvelope.sequence,
      summaryRetainsContext: savedSummary.text.includes('OTHER_CLIENT_CONTEXT'),
      backgroundHistoryStable, modelText: await page.getByText('通道消息已经收到。', { exact: true }).first().textContent(),
      pageErrors: errors.pageErrors }, null, 2)}\n`
    const golden = join(import.meta.dirname, 'snapshots/team-channel/flow.expected.json')
    if (process.env.CLOCKY_SNAPSHOT === 'refresh') await writeFile(golden, actual)
    else expect(actual).toBe(await readFile(golden, 'utf8'))
  } catch (error: unknown) {
    failures.push(error)
    const evidence = await Promise.allSettled([
      writeFile(join(output, 'failure.txt'), error instanceof Error ? error.stack ?? error.message : String(error)),
      (async () => { await writeFile(join(output, 'dom.txt'), await page.locator('body').innerText()) })(),
      page.screenshot({ path: join(output, 'failure.png') }),
    ])
    failures.push(...evidence.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []))
  } finally {
    try { if (created !== undefined) await rpc('team.cancel', { teamId: created.team.id }) } catch (error: unknown) { failures.push(error) }
    try { await browser.close() } catch (error: unknown) { failures.push(error) }
    try { await scaffold.close() } catch (error: unknown) { failures.push(error) }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Channel scenario and cleanup failures')
}, 120_000)

it('runs a consult request and response through the shipped browser and Host', async () => {
  const output = join(process.cwd(), '.tmp/team-consult-browser-evidence')
  await mkdir(output, { recursive: true })
  const override = join(output, 'replay.json')
  const channelIdFromRequest = '{{fromRequest:channel-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}}}'
  const responseArgs = JSON.stringify({ channel_id: channelIdFromRequest, text: '咨询响应已经记录。', delivery: 'turn' })
  await writeFile(override, JSON.stringify([
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'consult-response', name: 'team_message', argumentsDelta: responseArgs },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'consult-response', name: 'team_message', arguments: responseArgs } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] },
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '咨询响应已经记录。' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '咨询响应已经记录。' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
  ]))
  const scaffold = await launchWebScaffold({ replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'), replayOverride: override })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  let created: TeamStateSnapshot | undefined
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const result = (await scaffold.authenticatedRpc<T>(method, payload)).result
    if (result.ok) return result.value
    throw new Error(`${method}: ${result.error.message}`)
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    created = await rpc<TeamStateSnapshot>('team.create', { objective: '验证一问一答浏览器流程', cwd: scaffold.workspaceCwd })
    const teamId = created.team.id
    const human = created.participants.find(participant => participant.role === 'human')
    const coordinator = created.participants.find(participant => participant.role === 'coordinator')
    if (human === undefined || coordinator === undefined) throw new Error('Created Team lacks human or coordinator participant')
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '验证一问一答浏览器流程 进行中' }).click()
    await page.getByRole('button', { name: '打开任务详情' }).click()
    const panel = page.locator('[data-team-detail-panel]')
    const channels = panel.getByRole('region', { name: '通道', exact: true })
    const before = await rpc<TeamStateSnapshot>('team.get', { teamId })
    await channels.getByRole('button', { name: '新建通道', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建通道' })
    await dialog.getByRole('radio', { name: '一问一答 v1', exact: true }).check()
    await dialog.getByRole('radio', { name: 'recent-window v1', exact: true }).check()
    const initiator = dialog.locator('fieldset').filter({ hasText: '发起者' }).getByRole('radio', { name: human.displayName, exact: true })
    const respondent = dialog.locator('fieldset').filter({ hasText: '回应者' }).getByRole('radio', { name: coordinator.displayName, exact: true })
    await initiator.check()
    await respondent.check()
    await dialog.getByRole('button', { name: '新建通道', exact: true }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    const after = await rpc<TeamStateSnapshot>('team.get', { teamId })
    const channelId = after.channelIds.find(id => !before.channelIds.includes(id))
    if (channelId === undefined) throw new Error('Consult channel was not attached to the Team')
    await panel.locator(`[data-channel-id="${channelId}"]`).click()
    await channels.getByRole('button', { name: '接受通道邀请' }).waitFor()
    await channels.getByRole('button', { name: '接受通道邀请' }).click()
    await expect.poll(async () => (await rpc<ChannelHumanInvitationSnapshot>('team.channel.invitation', { channelId })).channel.phase).toBe('active')
    const admission = await rpc<ChannelHumanAdmissionSnapshot>('team.channel.admission', { teamId, channelId })
    expect(admission.channel.manifest.adapter).toEqual({ type: 'consult', version: 1 })
    expect(admission.expectedNext).toMatchObject({ kind: 'participant', participantId: human.id })
    await channels.getByRole('button', { name: '发送消息', exact: true }).click()
    const message = page.getByRole('dialog', { name: '发送消息' })
    const settled = scaffold.whenTurnSettled(60_000).then(
      sessionId => ({ ok: true as const, sessionId }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await message.getByLabel('消息内容').fill('请给出一条咨询回应。')
    await message.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect.poll(() => message.count()).toBe(0)
    const turn = await settled
    if (!turn.ok) throw turn.error
    await page.getByText('咨询响应已经记录。', { exact: true }).first().waitFor()
    const pageResult = await rpc<ChannelReadPageResult>('team.channel.read', { channelId, afterCursor: -1, limit: 128 })
    const envelopes = pageResult.records.filter(record => record.type === 'channel/envelope').map(record => record.envelope.kind)
    expect(envelopes).toContain('request')
    expect(envelopes).toContain('response')
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(output, 'consult-response.png') })
  } finally {
    try { if (created !== undefined) await rpc('team.cancel', { teamId: created.team.id }) } finally {
      await browser.close()
      await scaffold.close()
    }
  }
}, 120_000)

it('runs a round-robin discussion through the shipped browser and Host', async () => {
  const output = join(process.cwd(), '.tmp/team-discussion-browser-evidence')
  await mkdir(output, { recursive: true })
  const override = join(output, 'replay.json')
  const channelIdFromRequest = '{{fromRequest:channel-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}}}'
  const responseArgs = JSON.stringify({ channel_id: channelIdFromRequest, text: '讨论回应已经记录。', delivery: 'turn' })
  await writeFile(override, JSON.stringify([
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'discussion-response', name: 'team_message', argumentsDelta: responseArgs },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'discussion-response', name: 'team_message', arguments: responseArgs } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] },
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '讨论回应已经记录。' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '讨论回应已经记录。' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
  ]))
  const scaffold = await launchWebScaffold({ replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'), replayOverride: override })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  let created: TeamStateSnapshot | undefined
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (response.result.ok) return response.result.value
    const message = response.result.error.message
    throw new Error(`${method}: ${message}`)
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    created = await rpc<TeamStateSnapshot>('team.create', { objective: '验证讨论轮流发言浏览器流程', cwd: scaffold.workspaceCwd })
    const teamId = created.team.id
    const human = created.participants.find(participant => participant.role === 'human')
    const coordinator = created.participants.find(participant => participant.role === 'coordinator')
    if (human === undefined || coordinator === undefined) throw new Error('Created Team lacks human or coordinator participant')
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '验证讨论轮流发言浏览器流程 进行中' }).click()
    await page.getByRole('button', { name: '打开任务详情' }).click()
    const panel = page.locator('[data-team-detail-panel]')
    const channels = panel.getByRole('region', { name: '通道', exact: true })
    const before = await rpc<TeamStateSnapshot>('team.get', { teamId })
    await channels.getByRole('button', { name: '新建通道', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建通道' })
    await dialog.getByRole('radio', { name: '讨论 v1', exact: true }).check()
    await dialog.getByRole('radio', { name: 'recent-window v1', exact: true }).check()
    await dialog.getByLabel('最大发言次数').fill('3')
    await dialog.getByRole('radio', { name: '按成员顺序轮流发言', exact: true }).check()
    await dialog.getByRole('checkbox', { name: `${human.displayName} · ${human.role}`, exact: true }).check()
    await dialog.getByRole('checkbox', { name: `${coordinator.displayName} · ${coordinator.role}`, exact: true }).check()
    await dialog.getByRole('button', { name: '新建通道', exact: true }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    const after = await rpc<TeamStateSnapshot>('team.get', { teamId })
    const channelId = after.channelIds.find(id => !before.channelIds.includes(id))
    if (channelId === undefined) throw new Error('Discussion channel was not attached to the Team')
    await panel.locator(`[data-channel-id="${channelId}"]`).click()
    await channels.getByRole('button', { name: '接受通道邀请' }).waitFor()
    await channels.getByRole('button', { name: '接受通道邀请' }).click()
    await expect.poll(async () => (await rpc<ChannelHumanInvitationSnapshot>('team.channel.invitation', { channelId })).channel.phase).toBe('active')
    const admission = await rpc<ChannelHumanAdmissionSnapshot>('team.channel.admission', { teamId, channelId })
    expect(admission.channel.manifest.adapter).toEqual({ type: 'discussion', version: 1 })
    expect(admission.protocolStatus).toMatchObject({ kind: 'discussion', turnCount: 0, maxTurns: 3, speakerPolicy: 'round-robin' })
    expect(admission.expectedNext).toMatchObject({ kind: 'participant', participantId: human.id })
    await channels.getByRole('button', { name: '发送消息', exact: true }).click()
    const message = page.getByRole('dialog', { name: '发送消息' })
    const settled = scaffold.whenTurnSettled(60_000).then(
      sessionId => ({ ok: true as const, sessionId }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await message.getByLabel('消息内容').fill('讨论第一轮发言。')
    await message.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect.poll(() => message.count()).toBe(0)
    const turn = await settled
    if (!turn.ok) throw turn.error
    await page.getByText('讨论回应已经记录。', { exact: true }).first().waitFor()
    const pageResult = await rpc<ChannelReadPageResult>('team.channel.read', { channelId, afterCursor: -1, limit: 128 })
    const envelopes = pageResult.records.filter(record => record.type === 'channel/envelope').map(record => record.envelope)
    expect(envelopes).toHaveLength(2)
    expect(envelopes.map(envelope => envelope.senderId)).toEqual([human.id, coordinator.id])
    const finalAdmission = await rpc<ChannelHumanAdmissionSnapshot>('team.channel.admission', { teamId, channelId })
    expect(finalAdmission.protocolStatus).toMatchObject({ kind: 'discussion', turnCount: 2, maxTurns: 3, speakerPolicy: 'round-robin' })
    expect(finalAdmission.expectedNext).toMatchObject({ kind: 'participant', participantId: human.id })
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(output, 'discussion-response.png') })
  } finally {
    try { if (created !== undefined) await rpc('team.cancel', { teamId: created.team.id }) } finally {
      await browser.close()
      await scaffold.close()
    }
  }
}, 120_000)

it('runs a free-form discussion through the shipped browser and Host', async () => {
  const output = join(process.cwd(), '.tmp/team-discussion-free-form-browser-evidence')
  await mkdir(output, { recursive: true })
  const override = join(output, 'replay.json')
  const channelIdFromRequest = '{{fromRequest:channel-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}}}'
  const responseArgs = JSON.stringify({ channel_id: channelIdFromRequest, text: '自由讨论回应已经记录。', delivery: 'turn' })
  await writeFile(override, JSON.stringify([
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'free-form-response', name: 'team_message', argumentsDelta: responseArgs },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'free-form-response', name: 'team_message', arguments: responseArgs } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ] },
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '自由讨论回应已经记录。' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '自由讨论回应已经记录。' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
  ]))
  const scaffold = await launchWebScaffold({ replayFixture: join(process.cwd(), 'apps/web/tests/snapshots/lifecycle-chrome/session.jsonl'), replayOverride: override })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = watchConsole(page)
  let created: TeamStateSnapshot | undefined
  async function rpc<T>(method: string, payload: unknown): Promise<T> {
    const response = await scaffold.authenticatedRpc<T>(method, payload)
    if (!response.result.ok) {
      const message = response.result.error.message
      throw new Error(`${method}: ${message}`)
    }
    return response.result.value
  }
  try {
    await scaffold.authenticateBrowserPage(page)
    created = await rpc<TeamStateSnapshot>('team.create', { objective: '验证自由讨论浏览器流程', cwd: scaffold.workspaceCwd })
    const teamId = created.team.id
    const human = created.participants.find(participant => participant.role === 'human')
    const coordinator = created.participants.find(participant => participant.role === 'coordinator')
    if (human === undefined || coordinator === undefined) throw new Error('Created Team lacks human or coordinator participant')
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '验证自由讨论浏览器流程 进行中' }).click()
    await page.getByRole('button', { name: '打开任务详情' }).click()
    const panel = page.locator('[data-team-detail-panel]')
    const channels = panel.getByRole('region', { name: '通道', exact: true })
    const before = await rpc<TeamStateSnapshot>('team.get', { teamId })
    await channels.getByRole('button', { name: '新建通道', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建通道' })
    await dialog.getByRole('radio', { name: '讨论 v1', exact: true }).check()
    await dialog.getByRole('radio', { name: 'recent-window v1', exact: true }).check()
    await dialog.getByLabel('最大发言次数').fill('3')
    await dialog.getByRole('radio', { name: '自由发言', exact: true }).check()
    await dialog.getByRole('checkbox', { name: `${human.displayName} · ${human.role}`, exact: true }).check()
    await dialog.getByRole('checkbox', { name: `${coordinator.displayName} · ${coordinator.role}`, exact: true }).check()
    await dialog.getByRole('button', { name: '新建通道', exact: true }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    const after = await rpc<TeamStateSnapshot>('team.get', { teamId })
    const channelId = after.channelIds.find(id => !before.channelIds.includes(id))
    if (channelId === undefined) throw new Error('Free-form discussion channel was not attached to the Team')
    await panel.locator(`[data-channel-id="${channelId}"]`).click()
    await channels.getByRole('button', { name: '接受通道邀请' }).waitFor()
    await channels.getByRole('button', { name: '接受通道邀请' }).click()
    await expect.poll(async () => (await rpc<ChannelHumanInvitationSnapshot>('team.channel.invitation', { channelId })).channel.phase).toBe('active')
    const admission = await rpc<ChannelHumanAdmissionSnapshot>('team.channel.admission', { teamId, channelId })
    expect(admission.protocolStatus).toMatchObject({ kind: 'discussion', turnCount: 0, maxTurns: 3, speakerPolicy: 'free-form' })
    await channels.getByRole('button', { name: '发送消息', exact: true }).click()
    const message = page.getByRole('dialog', { name: '发送消息' })
    const settled = scaffold.whenTurnSettled(60_000).then(
      sessionId => ({ ok: true as const, sessionId }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await message.getByLabel('消息内容').fill('自由讨论第一条消息。')
    await message.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect.poll(() => message.count()).toBe(0)
    const turn = await settled
    if (!turn.ok) throw turn.error
    await page.getByText('自由讨论回应已经记录。', { exact: true }).first().waitFor()
    const pageResult = await rpc<ChannelReadPageResult>('team.channel.read', { channelId, afterCursor: -1, limit: 128 })
    const envelopes = pageResult.records.filter(record => record.type === 'channel/envelope').map(record => record.envelope)
    expect(envelopes).toHaveLength(2)
    const finalAdmission = await rpc<ChannelHumanAdmissionSnapshot>('team.channel.admission', { teamId, channelId })
    expect(finalAdmission.protocolStatus).toMatchObject({ kind: 'discussion', turnCount: 2, maxTurns: 3, speakerPolicy: 'free-form' })
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: join(output, 'free-form-response.png') })
  } finally {
    try { if (created !== undefined) await rpc('team.cancel', { teamId: created.team.id }) } finally {
      await browser.close()
      await scaffold.close()
    }
  }
}, 120_000)
