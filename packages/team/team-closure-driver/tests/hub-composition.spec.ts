import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import type { TeamCancellationSnapshot, TeamId } from '@clocky/clocky-team'
import TeamHub from '@clocky/clocky-team-hub'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import * as ActivationController from '@clocky/clocky-team-activation-controller'
import { createTestRootTeam } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import TeamClosureDriverHub from '../src/hub.ts'
import { TeamClosureDriveBackendRegistry } from '../src/index.ts'
import * as ClosureDriverPlugin from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Build a real JSON-backed Hub composition for closure-driver recovery. */
async function mountHub(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(ActivationController)
  return ctx
}

/** Seed the accepted cancellation fact without retaining a process-local TeamRun proof. */
async function seedCancellation(ctx: Context, teamId: TeamId): Promise<TeamCancellationSnapshot> {
  const hub = ctx.teams as unknown as {
    readonly teams: ReadonlyMap<TeamId, {
      readonly queue: { run<T>(operation: () => Promise<T>): Promise<T> }
      readonly projection: { readonly team: { readonly updatedAt: number; readonly phase: string } }
    }>
    commitTeamCommand(loaded: unknown, records: readonly unknown[], code: 'TEAM_INVALID_ARGUMENT'): Promise<void>
  }
  const loaded = hub.teams.get(teamId)
  if (loaded === undefined) throw new Error(`Team Hub did not retain '${teamId}'`)
  return await loaded.queue.run(async () => {
    const requestedAt = Math.max(Date.now(), loaded.projection.team.updatedAt + 1)
    const cancellation: TeamCancellationSnapshot = {
      teamId,
      idempotencyKey: `closure-driver-cancel-${teamId}` as TeamCancellationSnapshot['idempotencyKey'],
      actor: { kind: 'system', name: 'team-run' },
      reason: { code: 'TEST_CANCEL', message: 'Recover the durable cancellation.' },
      requestedAt,
    }
    await hub.commitTeamCommand(loaded, [
      { type: 'team/cancellation', cancellation, createdAt: requestedAt },
      { type: 'team/phase', phase: 'quiescing', createdAt: requestedAt },
    ], 'TEAM_INVALID_ARGUMENT')
    return structuredClone(cancellation)
  })
}

describe('Team closure-driver real Hub composition', () => {
  it('reopens an accepted cancellation and reaches terminal settlement through the real Core proof bridge', async () => {
    const parent = join(process.cwd(), '.tmp')
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(join(parent, 'team-closure-driver-composition-'))
    roots.push(root)
    const first = await mountHub(root)
    const created = await createTestRootTeam(first, {
      goal: { objective: 'Recover durable cancellation.', budgets: {} },
      rules: {},
      budgets: {},
    })
    const cancellation = await seedCancellation(first, created.team.id)
    await first.fiber.dispose()

    const recovered = await mountHub(root)
    const registry = await recovered.plugin(TeamClosureDriveBackendRegistry)
    const backend = await recovered.plugin(TeamClosureDriverHub, { backend: 'hub' })
    const driver = await recovered.plugin(ClosureDriverPlugin, {
      backend: 'hub',
      maxTeamsPerDrive: 8,
      pageSize: 4,
      disposalTimeoutMs: 100,
    })
    try {
      await expect(recovered.teams.getTeam({ teamId: created.team.id })).resolves.toMatchObject({
        team: {
          phase: 'cancelled',
          cancellation: {
            idempotencyKey: cancellation.idempotencyKey,
            requestedAt: cancellation.requestedAt,
          },
        },
      })
    } finally {
      await driver.dispose()
      await backend.dispose()
      await registry.dispose()
      await recovered.fiber.dispose()
    }
  })
})
