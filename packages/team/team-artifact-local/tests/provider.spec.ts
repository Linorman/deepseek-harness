import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import TeamArtifactStore from '@clocky/clocky-team-artifact'
import { TeamArtifactError } from '@clocky/clocky-team-artifact'
import type { TeamRuntime, TeamStateSnapshot } from '@clocky/clocky-team'
import { apply, LocalTeamArtifactRetention } from '../src/index.ts'

const teamId = 'team-artifact-test' as never
const attemptId = 'attempt-artifact-test' as never

/** Allocate one isolated artifact store under the project's scratch directory. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  return await mkdtemp(join(parent, 'clocky-team-artifact-'))
}

describe('local Team artifact provider', () => {
  it('stores, reuses, verifies, and reads content-addressed bytes', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(TeamArtifactStore)
    await apply(ctx, { root, maxBytes: 64, maxArtifactsPerAttempt: 2 })
    const provider = ctx.teamArtifacts.getProvider('local')
    if (provider === undefined) throw new Error('local artifact provider was not registered')

    const request = {
      teamId,
      sourceAttemptId: attemptId,
      kind: 'report' as const,
      visibility: 'team' as const,
      data: 'durable report',
    }
    const first = await provider.save(request)
    const second = await provider.save(request)
    expect(second).toEqual(first)
    expect(new TextDecoder().decode(await provider.read({ reference: first }))).toBe('durable report')
    expect(first.provider).toBe('local')
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/)
    const files = await stat(join(root, first.contentHash!.slice(0, 2), first.contentHash!.slice(2)))
    expect(files.isFile()).toBe(true)
    expect(await readFile(join(root, first.contentHash!.slice(0, 2), first.contentHash!.slice(2)), 'utf8')).toBe('durable report')

    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('rejects oversized objects and mismatched provider references', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(TeamArtifactStore)
    await apply(ctx, { root, maxBytes: 4 })
    const provider = ctx.teamArtifacts.getProvider('local')
    if (provider === undefined) throw new Error('local artifact provider was not registered')

    await expect(provider.save({
      teamId,
      kind: 'log',
      visibility: 'private',
      data: 'too large',
    })).rejects.toMatchObject({ code: 'TEAM_ARTIFACT_TOO_LARGE' })
    await expect(provider.read({ reference: {
      id: 'other:0000000000000000000000000000000000000000000000000000000000000000',
      kind: 'log',
      uri: 'artifact-local://other/0000000000000000000000000000000000000000000000000000000000000000',
      visibility: 'private',
    } })).rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
    await expect(provider.read({ reference: {
      id: 'local:0000000000000000000000000000000000000000000000000000000000000000',
      provider: 'other',
      kind: 'log',
      uri: 'artifact-local://local/0000000000000000000000000000000000000000000000000000000000000000',
      visibility: 'private',
    } })).rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
    expect(TeamArtifactError).toBeDefined()

    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('sweeps only approved unreachable objects and supports bounded cursors', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(TeamArtifactStore)
    await apply(ctx, { root, maxBytes: 64 })
    const provider = ctx.teamArtifacts.getProvider('local')
    if (provider === undefined || provider.collect === undefined) throw new Error('local artifact provider was not registered')

    const keep = await provider.save({ teamId, kind: 'report', visibility: 'team', data: 'keep' })
    const remove = await provider.save({ teamId, kind: 'report', visibility: 'team', data: 'remove' })
    const first = await provider.collect({ reachable: [keep], reclaimableIds: [remove.id], limit: 1 })
    expect(first.scanned).toBe(1)
    expect(first.nextCursor).toBeDefined()
    const second = await provider.collect({
      reachable: [keep],
      reclaimableIds: [remove.id],
      afterCursor: first.nextCursor,
      limit: 2,
    })
    expect(second.deleted).toContain(remove.id)
    await expect(provider.read({ reference: keep })).resolves.toBeInstanceOf(Uint8Array)
    await expect(provider.read({ reference: remove })).rejects.toMatchObject({ code: 'TEAM_ARTIFACT_NOT_FOUND' })

    const pending = await provider.save({ teamId, kind: 'report', visibility: 'team', data: 'pending' })
    const uriReference = { ...keep, id: 'foreign:reference' }
    await expect(provider.read({ reference: uriReference })).resolves.toBeInstanceOf(Uint8Array)
    const pendingPage = await provider.collect({
      reachable: [uriReference, {
        id: 'remote:reference',
        kind: 'report',
        uri: 'remote://reference',
        visibility: 'team',
      }],
      reclaimableIds: [],
      limit: 16,
    })
    expect(pendingPage.unreachable).toContain(pending.id)
    expect(pendingPage.deleted).not.toContain(pending.id)
    await provider.delete?.({ reference: pending })
    await expect(provider.read({ reference: pending })).resolves.toBeInstanceOf(Uint8Array)

    const malformedDirectoryDigest = 'a'.repeat(64)
    await mkdir(join(root, malformedDirectoryDigest.slice(0, 2)), { recursive: true })
    await mkdir(join(root, malformedDirectoryDigest.slice(0, 2), malformedDirectoryDigest.slice(2)))
    const malformedPage = await provider.collect({ reachable: [], reclaimableIds: [], limit: 16 })
    expect(malformedPage.failures).toContainEqual({
      id: `local:${malformedDirectoryDigest}`,
      message: 'artifact object is not a regular file',
    })

    await expect(provider.collect({ reachable: [], reclaimableIds: [], afterCursor: 'invalid', limit: 1 }))
      .rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
    await expect(provider.collect({ reachable: [], reclaimableIds: ['local:invalid'], limit: 1 }))
      .rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
    await expect(provider.collect({ reachable: [], reclaimableIds: [], limit: 0 }))
      .rejects.toThrow(/collection limit/u)
    const controller = new AbortController()
    controller.abort()
    await expect(provider.collect({ reachable: [], reclaimableIds: [], limit: 1, signal: controller.signal }))
      .rejects.toThrow()

    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('traces visible Team task results and enforces a restart-safe grace period', async () => {
    const root = await freshRoot()
    const keepState = { tasks: [], workspaceAllocations: [] } as unknown as TeamStateSnapshot
    let state = keepState
    const fakeTeams = {
      listTeamsPage: async ({ afterCursor }: { readonly afterCursor: number }) => afterCursor === -1
        ? { items: [{ id: teamId }], nextCursor: 1 }
        : { items: [] },
      getTeam: async () => state,
    } as unknown as TeamRuntime
    const ctx = new Context()
    ctx.provide('teams', fakeTeams)
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(TeamArtifactStore)
    await apply(ctx, {
      root,
      retention: { graceMs: 100, maxObjectsPerDrive: 16, disposalTimeoutMs: 1_000 },
    })
    const provider = ctx.teamArtifacts.getProvider('local')
    if (provider === undefined) throw new Error('local artifact provider was not registered')
    const retention = getRetention(ctx)
    if (retention === undefined) throw new Error('retention owner was not registered')

    const keep = await provider.save({ teamId, kind: 'report', visibility: 'team', data: 'reachable' })
    const proposalKeep = await provider.save({ teamId, kind: 'patch', visibility: 'team', data: 'proposal' })
    const integrationKeep = await provider.save({ teamId, kind: 'report', visibility: 'human', data: 'integration' })
    const orphan = await provider.save({ teamId, kind: 'report', visibility: 'team', data: 'orphan' })
    state = {
      ...keepState,
      tasks: [{
        attemptHistory: [{ outcome: { kind: 'completed', result: {
          artifacts: [keep],
          integration: {
            target: 'main',
            status: 'proposed',
            proposalArtifact: proposalKeep,
            artifacts: [integrationKeep],
          },
        } } }],
      }],
    } as unknown as TeamStateSnapshot

    const observed = await retention.drive(1_000)
    expect(observed.teamsScanned).toBe(1)
    expect(observed.reachableArtifacts).toBe(3)
    expect(observed.unreachable).toContain(orphan.id)
    await expect(provider.read({ reference: orphan })).resolves.toBeInstanceOf(Uint8Array)
    await expect(provider.read({ reference: proposalKeep })).resolves.toBeInstanceOf(Uint8Array)
    await expect(provider.read({ reference: integrationKeep })).resolves.toBeInstanceOf(Uint8Array)

    await ctx.fiber.dispose()

    const restarted = new Context()
    restarted.provide('teams', fakeTeams)
    await restarted.plugin(InvariantRegistry)
    await restarted.plugin(TeamArtifactStore)
    await apply(restarted, {
      root,
      retention: { graceMs: 100, maxObjectsPerDrive: 16, disposalTimeoutMs: 1_000 },
    })
    const restartedProvider = restarted.teamArtifacts.getProvider('local')
    if (restartedProvider === undefined) throw new Error('restarted artifact provider was not registered')
    const restartedRetention = getRetention(restarted)
    if (restartedRetention === undefined) throw new Error('restarted retention owner was not registered')
    const afterRestart = await restartedRetention.drive(10_000)
    expect(afterRestart.deleted).not.toContain(orphan.id)
    await expect(restartedProvider.read({ reference: orphan })).resolves.toBeInstanceOf(Uint8Array)
    const collected = await restartedRetention.drive(10_100)
    expect(collected.deleted).toContain(orphan.id)
    await expect(restartedProvider.read({ reference: orphan })).rejects.toMatchObject({ code: 'TEAM_ARTIFACT_NOT_FOUND' })

    const later = await restartedProvider.save({ teamId, kind: 'report', visibility: 'team', data: 'later' })
    state = {
      ...state,
      tasks: [{
        attemptHistory: [{ outcome: { kind: 'completed', result: { artifacts: [later] } } }],
      }],
    } as unknown as TeamStateSnapshot
    await restartedRetention.drive(20_000)
    await expect(restartedProvider.read({ reference: later })).resolves.toBeInstanceOf(Uint8Array)

    await restarted.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('fails a retention drive loudly when the Team runtime is unavailable', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(TeamArtifactStore)
    await apply(ctx, {
      root,
      retention: { graceMs: 1, maxObjectsPerDrive: 1, disposalTimeoutMs: 1_000 },
    })
    const retention = getRetention(ctx)
    if (retention === undefined) throw new Error('retention owner was not registered')
    await expect(retention.drive(1_000)).rejects.toThrow(/requires the teams service/u)
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('runs an optional pulse and rejects drives after retention closes', async () => {
    vi.useFakeTimers()
    const root = await freshRoot()
    const listTeamsPage = vi.fn(async () => ({ items: [] }))
    const fakeTeams = {
      listTeamsPage,
      getTeam: vi.fn(async () => ({ tasks: [] })),
    } as unknown as TeamRuntime
    const ctx = new Context()
    ctx.provide('teams', fakeTeams)
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      await apply(ctx, {
        root,
        retention: { graceMs: 0, maxObjectsPerDrive: 1, pulseIntervalMs: 10, disposalTimeoutMs: 1_000 },
      })
      const retention = getRetention(ctx)
      if (retention === undefined) throw new Error('retention owner was not registered')
      retention.start()
      await vi.advanceTimersByTimeAsync(10)
      expect(listTeamsPage).toHaveBeenCalled()
      await expect(retention.drive(-1)).rejects.toThrow(/retention clock/u)
      await ctx.fiber.dispose()
      await expect(retention.drive(1_000)).rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
    } finally {
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed on a repeated Team-list cursor during retention', async () => {
    const root = await freshRoot()
    const listTeamsPage = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: teamId }], nextCursor: 0 })
      .mockResolvedValueOnce({ items: [{ id: teamId }], nextCursor: 0 })
    const fakeTeams = {
      listTeamsPage,
      getTeam: vi.fn(async () => ({ workspaceAllocations: [], tasks: [] })),
    } as unknown as TeamRuntime
    const ctx = new Context()
    ctx.provide('teams', fakeTeams)
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      await apply(ctx, {
        root,
        retention: { graceMs: 0, maxObjectsPerDrive: 1, disposalTimeoutMs: 1_000 },
      })
      const retention = getRetention(ctx)
      if (retention === undefined) throw new Error('retention owner was not registered')
      await expect(retention.drive(1_000)).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
      expect(listTeamsPage).toHaveBeenCalledTimes(2)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

function getRetention(ctx: Context): LocalTeamArtifactRetention | undefined {
  const value: unknown = ctx.get('teamArtifactRetention')
  return value instanceof LocalTeamArtifactRetention ? value : undefined
}
