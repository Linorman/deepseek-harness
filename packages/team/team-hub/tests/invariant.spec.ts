import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import InvariantRegistry, { InvariantError } from '@clocky/clocky-invariants'
import Storage from '@clocky/clocky-storage'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { channelEventSchema, teamEventSchema } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import * as TeamHubInvariant from '../src/invariant.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Mount the provider after the test invariant host has installed its companion. */
async function setup(): Promise<Context> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-hub-invariant-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(TeamHubInvariant)
  await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend: 'sqlite', routes: {} })
  await ctx.plugin(TeamHub)
  return ctx
}

const violation: unknown = expect.objectContaining<Partial<InvariantError>>({
  code: 'INVARIANT',
  packageName: '@clocky/clocky-team-hub',
})

describe('TeamHub post-commit invariants', () => {
  it('checks workspace notifications against the retained allocation observation', async () => {
    const ctx = await setup()
    try {
      const created = await createTestRootTeam(ctx, {
        goal: { objective: 'Observe the allocated workspace.', budgets: {} }, rules: {}, budgets: {},
      })
      const event = teamEventSchema.parse({ type: 'workspace/observed', cursor: created.team.cursor,
        createdAt: created.team.updatedAt, observation: {
          id: 'observation-1', teamId: created.team.id, allocationId: 'allocation-1', expectedRevision: 1,
          stage: 'baseline', base: null, baselineAvailable: true,
          final: { digest: `sha256:${'a'.repeat(64)}`, complete: true, startedAt: 1,
            finishedAt: created.team.updatedAt, scannedEntries: 0, hashedBytes: 0,
            knownOmittedEntries: 0, incompleteReasons: [] },
          paths: [], omittedPaths: 0, taskId: 'task-1', attemptId: 'attempt-1',
          truncated: false, observedAt: created.team.updatedAt,
        },
      })
      if (event.type !== 'workspace/observed') throw new Error('workspace event fixture changed type')
      const hub = ctx.teams as TeamHub
      expect(() => { ctx.emit('team/changed', event) }).toThrow(violation)
      const snapshot = hub.inspectLoadedTeam(created.team.id)
      if (snapshot === undefined) throw new Error('created Team was not loaded')
      const observed = { ...snapshot, workspaceAllocations: [{ id: event.observation.allocationId,
        observation: event.observation }] } as unknown as typeof snapshot
      const inspect = vi.spyOn(hub, 'inspectLoadedTeam').mockReturnValue(observed)
      try {
        expect(() => { ctx.emit('team/changed', event) }).not.toThrow()
        expect(() => { ctx.emit('team/changed', { ...event, cursor: event.cursor + 1 }) }).toThrow(violation)
        expect(() => { ctx.emit('team/changed', { ...event,
          observation: { ...event.observation, observedAt: event.observation.observedAt + 1 } }) }).toThrow(violation)
      } finally { inspect.mockRestore() }
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects unknown notification kinds at the JSON boundary before typed dispatch', () => {
    const incoming: unknown = JSON.parse('{"type":"team/unknown-fact","teamId":"team-1","cursor":1}')
    expect(() => teamEventSchema.parse(incoming)).toThrow()
  })

  it('rejects a Team event without a loaded authoritative projection', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'team/changed',
      team: {
        id: 'missing-team', depth: 0, maxTeamDepth: 0,
        goal: { teamId: 'missing-team', revision: 1, objective: 'missing', phase: 'active', budgets: {} },
        phase: 'active', cursor: 1, createdAt: 1, updatedAt: 1,
      },
    })) }).toThrow(violation)
    await ctx.fiber.dispose()
  })

  it('rejects an opening record without a loaded channel projection', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('channel/changed', channelEventSchema.parse({
      channelId: 'missing-channel',
      record: {
        type: 'channel/opened',
        sequence: 0,
        createdAt: 1,
        manifest: {
          id: 'missing-channel',
          teamId: 'missing-team',
          adapter: { type: 'direct', version: 1 },
          participants: [],
          limits: {},
        },
      },
    })) }).toThrow(violation)
    await ctx.fiber.dispose()
  })
})
