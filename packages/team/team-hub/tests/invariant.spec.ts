import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
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
