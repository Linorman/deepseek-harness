import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import Storage from '@clocky/clocky-storage'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import type { TeamChannelAdapter, ParticipantSnapshot, TeamEnvelope } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { postActor } from './fixtures.ts'

const roots: string[] = []
const contexts = new Set<Context>()
const largeLoadFlag = process.env.CLOCKY_TEAM_HUB_LARGE_LOAD
if (largeLoadFlag !== undefined && largeLoadFlag !== '1') {
  throw new Error(`CLOCKY_TEAM_HUB_LARGE_LOAD must be '1' when set, got ${JSON.stringify(largeLoadFlag)}`)
}
const largeLoad = largeLoadFlag === '1'
const loadCount = largeLoad ? 16_384 : 4_096
const loadLimit = largeLoad ? 32_768 : 8_192

afterEach(async () => {
  const failures: unknown[] = []
  for (const ctx of [...contexts]) {
    try {
      await ctx.fiber.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  contexts.clear()
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Team Hub load fixture cleanup failed')
})

const loadAdapter: TeamChannelAdapter = {
  type: 'load-direct',
  version: 1,
  validateCreate() {},
  initialState() { return {} },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan({ envelope }) {
    return (envelope.audience ?? []).map(participantId => ({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    }))
  },
  projectView() { return {} },
}

/** Compose one SQLite-backed Hub for the default or opt-in large load. */
async function setup(root?: string): Promise<{ readonly ctx: Context; readonly root: string }> {
  const durableRoot = root ?? await mkdtemp(join(process.cwd(), '.tmp', 'team-hub-load-'))
  if (root === undefined) roots.push(durableRoot)
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(durableRoot, 'hub.db') })
  await ctx.plugin(StorageLog, { backend: 'sqlite', routes: {} })
  await ctx.plugin(TeamHub, {
    recoveryPageSize: 32,
    checkpointEvery: 32,
    maxPendingDeliveriesPerChannel: loadLimit,
    maxPendingDeliveriesPerParticipant: loadLimit,
    maxInboxItemsPerParticipant: loadLimit,
    maxRatePerParticipantPerMinute: loadLimit,
  })
  ctx.teams.registerAdapter(loadAdapter)
  return { ctx, root: durableRoot }
}

/** Invite and activate one local participant without creating an Agent residency. */
async function activeParticipant(ctx: Context, teamId: ParticipantSnapshot['teamId']): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName: 'load participant',
    role: 'load',
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
}

describe('Team Hub bounded WAL load and checkpoint recovery', () => {
  it('replays a large channel suffix through bounded pages and preserves pending order after Hub handoff', async () => {
    const first = await setup()
    const created = await createTestRootTeam(first.ctx, { goal: { objective: 'WAL load', budgets: {} }, rules: {}, budgets: {} })
    const sender = await activeParticipant(first.ctx, created.team.id)
    const recipient = await activeParticipant(first.ctx, created.team.id)
    const state = await first.ctx.teams.getTeam({ teamId: created.team.id })
    const openedBeforeConsent = await openTestChannel(first.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: loadAdapter.type, version: loadAdapter.version },
      participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
      limits: {},
    })
    const actor = await postActor(first.ctx, created.team.id, sender.id)
    await postActor(first.ctx, created.team.id, recipient.id)
    const opened = await acknowledgeTestChannelActivations(first.ctx, openedBeforeConsent.manifest.id)

    let expectedCursor = opened.cursor
    const count = loadCount
    for (let index = 0; index < count; index += 1) {
      const envelope = await first.ctx.teams.postChannelEnvelope({
        actor,
        expectedCursor,
        draft: {
          channelId: opened.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { index, text: `load-${String(index)}` },
          delivery: 'context',
        },
      })
      expectedCursor = envelope.sequence
    }
    const before = await first.ctx.teams.getChannel({ channelId: opened.manifest.id })
    expect(before.cursor).toBeGreaterThanOrEqual(count)
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await setup(first.root)
    const open = vi.spyOn(second.ctx.storageLog, 'open')
    const discovery = await second.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 32 })
    expect(discovery.items.map(team => team.id)).toEqual([created.team.id])
    expect(discovery.scanned).toBeLessThanOrEqual(32)
    expect(open).not.toHaveBeenCalled()
    expect((second.ctx.teams as TeamHub).inspectLoadedTeam(created.team.id)).toBeUndefined()
    open.mockRestore()
    const envelopes: TeamEnvelope[] = []
    const pageSizes: number[] = []
    let afterCursor = -1
    let lastSequence = -1
    while (true) {
      const page = await second.ctx.teams.readChannelPage({
        channelId: opened.manifest.id,
        afterCursor,
        limit: 32,
      })
      pageSizes.push(page.records.length)
      for (const record of page.records) {
        const sequence = record.type === 'channel/envelope' ? record.envelope.sequence : record.sequence
        expect(sequence).toBe(lastSequence + 1)
        lastSequence = sequence
        if (record.type === 'channel/envelope') envelopes.push(record.envelope)
      }
      if (page.nextCursor === undefined) break
      expect(page.nextCursor).toBeGreaterThan(afterCursor)
      afterCursor = page.nextCursor
    }
    expect(Math.max(...pageSizes)).toBeLessThanOrEqual(32)
    expect(lastSequence).toBe(before.cursor)
    expect(envelopes).toHaveLength(count)
    expect(envelopes[0]?.payload).toMatchObject({ index: 0 })
    expect(envelopes.at(-1)?.payload).toMatchObject({ index: count - 1 })
    const pending = await second.ctx.teams.listChannelPendingDeliveries({
      channelId: opened.manifest.id,
      participantId: recipient.id,
      afterCursor: -1,
      limit: 32,
    })
    expect(pending.deliveries).toHaveLength(32)
    expect(pending.deliveries[0]?.envelope.payload).toMatchObject({ index: 0 })
  }, largeLoad ? 180_000 : 30_000)
})
