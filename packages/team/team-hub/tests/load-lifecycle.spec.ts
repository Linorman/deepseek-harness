import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import Storage from '@clocky/clocky-storage'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import type { ParticipantSnapshot, TeamChannelAdapter } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { postActor } from './fixtures.ts'

const roots: string[] = []
const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of [...contexts]) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const adapter: TeamChannelAdapter = {
  type: 'load-lifecycle', version: 1, validateCreate() {}, initialState() { return {} }, validateSend() {},
  fold(state) { return state }, afterAccept() { return [] }, expectedNext() { return { kind: 'none' } },
  deliveryPlan({ envelope }) {
    return (envelope.audience ?? []).map(participantId => ({ participantId, envelopeId: envelope.id, delivery: envelope.delivery }))
  },
  projectView() { return {} },
}

async function setup(): Promise<Context> {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'team-hub-load-lifecycle-'))
  roots.push(root)
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend: 'sqlite', routes: {} })
  await ctx.plugin(TeamHub, { recoveryPageSize: 32, checkpointEvery: 32 })
  ctx.teams.registerAdapter(adapter)
  return ctx
}

async function activeParticipant(ctx: Context, teamId: ParticipantSnapshot['teamId'], displayName: string): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: state.team.cursor, kind: 'local-agent', displayName, role: displayName, capabilities: [] })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, { teamId, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'provisioning' })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, { teamId, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'active' })
}

describe('Team Hub lifecycle reference sample', () => {
  it('records startup-to-first-page, enumeration, RSS, and shutdown metrics after real channel ACK', async () => {
    const startupAt = performance.now()
    const ctx = await setup()
    const startupMs = performance.now() - startupAt
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Lifecycle reference.', budgets: {} }, rules: {}, budgets: {} })
    const sender = await activeParticipant(ctx, team.team.id, 'lifecycle-sender')
    const recipient = await activeParticipant(ctx, team.team.id, 'lifecycle-recipient')
    const state = await ctx.teams.getTeam({ teamId: team.team.id })
    const pending = await openTestChannel(ctx, {
      teamId: team.team.id, expectedCursor: state.team.cursor, adapter: { type: adapter.type, version: adapter.version },
      participants: [{ id: sender.id, role: sender.role }, { id: recipient.id, role: recipient.role }], limits: {},
    })
    const actor = await postActor(ctx, team.team.id, sender.id)
    await postActor(ctx, team.team.id, recipient.id)
    const opened = await acknowledgeTestChannelActivations(ctx, pending.manifest.id)
    let cursor = opened.cursor
    const first32At = performance.now()
    for (let index = 0; index < 32; index += 1) {
      const envelope = await ctx.teams.postChannelEnvelope({ actor, expectedCursor: cursor, draft: {
        channelId: opened.manifest.id, audience: [recipient.id], kind: 'message', payload: { index }, delivery: 'context',
      } })
      cursor = envelope.sequence
    }
    const first32Ms = performance.now() - first32At
    const enumerationAt = performance.now()
    let afterCursor = -1
    let records = 0
    let pages = 0
    while (true) {
      const page = await ctx.teams.readChannelPage({ channelId: opened.manifest.id, afterCursor, limit: 32 })
      pages += 1
      records += page.records.length
      if (page.nextCursor === undefined) break
      expect(page.nextCursor).toBeGreaterThan(afterCursor)
      afterCursor = page.nextCursor
    }
    const enumerationMs = performance.now() - enumerationAt
    const rssBytes = process.memoryUsage().rss
    const shutdownAt = performance.now()
    await ctx.fiber.dispose()
    contexts.delete(ctx)
    const shutdownMs = performance.now() - shutdownAt
    const metrics = { startupMs, first32Ms, enumerationMs, shutdownMs, rssBytes, pages, records }
    console.log(`CLOCKY_TEAM_HUB_LIFECYCLE_METRICS ${JSON.stringify(metrics)}`)
    expect(metrics.pages).toBeGreaterThan(0)
    expect(metrics.records).toBeGreaterThanOrEqual(32)
    expect(metrics.rssBytes).toBeGreaterThan(0)
    expect(metrics.shutdownMs).toBeGreaterThanOrEqual(0)
  }, 30_000)

  it('cancels an idle channel watch before clean shutdown', async () => {
    const ctx = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Lifecycle cancellation.', budgets: {} }, rules: {}, budgets: {} })
    const sender = await activeParticipant(ctx, team.team.id, 'cancel-sender')
    const recipient = await activeParticipant(ctx, team.team.id, 'cancel-recipient')
    const state = await ctx.teams.getTeam({ teamId: team.team.id })
    const pending = await openTestChannel(ctx, {
      teamId: team.team.id, expectedCursor: state.team.cursor, adapter: { type: adapter.type, version: adapter.version },
      participants: [{ id: sender.id, role: sender.role }, { id: recipient.id, role: recipient.role }], limits: {},
    })
    await postActor(ctx, team.team.id, sender.id)
    await postActor(ctx, team.team.id, recipient.id)
    const opened = await acknowledgeTestChannelActivations(ctx, pending.manifest.id)
    const controller = new AbortController()
    const watching = ctx.teams.watchChannel({ channelId: opened.manifest.id, afterCursor: opened.cursor, signal: controller.signal })
    controller.abort(new Error('lifecycle watch cancelled'))
    await expect(watching).rejects.toThrow('lifecycle watch cancelled')

    const shutdownAt = performance.now()
    await ctx.fiber.dispose()
    contexts.delete(ctx)
    expect(performance.now() - shutdownAt).toBeGreaterThanOrEqual(0)
  }, 30_000)
})
