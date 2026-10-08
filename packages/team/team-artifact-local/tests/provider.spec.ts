import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import TeamArtifactStore from '@clocky/clocky-team-artifact'
import { TeamArtifactError } from '@clocky/clocky-team-artifact'
import type { TeamArtifactReference, TeamRuntime, TeamStateSnapshot } from '@clocky/clocky-team'
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
    const binary = new Uint8Array([0, 255, 8])
    const binaryReference = await provider.save({ ...request, data: binary })
    expect(await provider.read({ reference: binaryReference })).toEqual(binary)
    expect(await provider.read({ reference: { ...first, id: 'local:invalid' } })).toEqual(new TextEncoder().encode('durable report'))
    await expect(provider.read({ reference: { ...first, id: 'foreign:invalid', uri: 'artifact-local://local/invalid' } }))
      .rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
    expect(first.provider).toBe('local')
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/)
    const files = await stat(join(root, first.contentHash!.slice(0, 2), first.contentHash!.slice(2)))
    expect(files.isFile()).toBe(true)
    expect(await readFile(join(root, first.contentHash!.slice(0, 2), first.contentHash!.slice(2)), 'utf8')).toBe('durable report')

    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('bounds distinct objects per attempt and rejects altered or linked content-addressed objects', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      await apply(ctx, { root, maxBytes: 64, maxArtifactsPerAttempt: 2 })
      const provider = ctx.teamArtifacts.getProvider('local')
      if (provider === undefined) throw new Error('local artifact provider was not registered')
      const request = { teamId, sourceAttemptId: attemptId, kind: 'log' as const,
        visibility: 'team' as const, data: 'first' }
      const first = await provider.save(request)
      const second = await provider.save({ ...request, data: 'second' })
      expect(await provider.save(request)).toEqual(first)
      await expect(provider.save({ ...request, data: 'third' }))
        .rejects.toMatchObject({ code: 'TEAM_ARTIFACT_TOO_LARGE' })
      await expect(provider.read({ reference: { ...second, contentHash: '0'.repeat(64) } }))
        .rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
      await writeFile(join(root, first.contentHash!.slice(0, 2), first.contentHash!.slice(2)), 'corrupted')
      await expect(provider.read({ reference: first })).rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })

      const altered = 'altered-content', alteredDigest = createHash('sha256').update(altered).digest('hex')
      const alteredPath = join(root, alteredDigest.slice(0, 2), alteredDigest.slice(2))
      await mkdir(join(root, alteredDigest.slice(0, 2)), { recursive: true })
      await writeFile(alteredPath, 'different bytes')
      await expect(provider.save({ teamId, kind: 'log', visibility: 'team', data: altered }))
        .rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })

      const linked = 'linked-content', linkedDigest = createHash('sha256').update(linked).digest('hex')
      const linkedPath = join(root, linkedDigest.slice(0, 2), linkedDigest.slice(2))
      await mkdir(join(root, linkedDigest.slice(0, 2)), { recursive: true })
      await symlink(alteredPath, linkedPath)
      await expect(provider.save({ teamId, kind: 'log', visibility: 'team', data: linked }))
        .rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
      await expect(provider.read({ reference: { id: `local:${linkedDigest}`, provider: 'local', kind: 'log',
        uri: `artifact-local://local/${linkedDigest}`, visibility: 'team' } }))
        .rejects.toMatchObject({ code: 'TEAM_ARTIFACT_NOT_FOUND' })
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it('refuses a symlinked content-addressed bucket before writing any object', async () => {
    const root = await freshRoot(), outside = await freshRoot()
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      await apply(ctx, { root })
      const provider = ctx.teamArtifacts.getProvider('local')
      if (provider === undefined) throw new Error('local artifact provider was not registered')
      const data = 'linked-bucket', digest = createHash('sha256').update(data).digest('hex')
      await symlink(outside, join(root, digest.slice(0, 2)), 'dir')
      await expect(provider.save({ teamId, kind: 'log', visibility: 'team', data }))
        .rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
      await expect(readFile(join(outside, digest.slice(2)))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects unsafe provider roots, names, limits and retention bounds at load', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      const fileRoot = join(root, 'not-a-directory')
      await writeFile(fileRoot, 'file')
      for (const [config, message] of [
        [{ root: 'relative-root' }, /absolute path/],
        [{ root: fileRoot }, /cannot be prepared/],
        [{ root, providerName: ' local ' }, /providerName/],
        [{ root, maxBytes: 0 }, /maxBytes/],
        [{ root, maxArtifactsPerAttempt: 0 }, /maxArtifactsPerAttempt/],
        [{ root, retention: { graceMs: -1, maxObjectsPerDrive: 1, disposalTimeoutMs: 100 } }, /retention.graceMs/],
        [{ root, retention: { graceMs: 0, maxObjectsPerDrive: 0, disposalTimeoutMs: 100 } }, /retention.maxObjectsPerDrive/],
        [{ root, retention: { graceMs: 0, maxObjectsPerDrive: 1, disposalTimeoutMs: 0 } }, /retention.disposalTimeoutMs/],
        [{ root, retention: { graceMs: 0, maxObjectsPerDrive: 1,
          disposalTimeoutMs: 100, pulseIntervalMs: 0 } }, /retention.pulseIntervalMs/],
      ] as const) {
        await expect(apply(ctx, config)).rejects.toThrow(message)
      }
      expect(ctx.teamArtifacts.getProvider('local')).toBeUndefined()
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
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
    const foreignReclaim = await provider.collect({ reachable: [], reclaimableIds: [`foreign:${pending.contentHash!}`], limit: 16 })
    expect(foreignReclaim.deleted).not.toContain(pending.id)
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

  it('paginates two objects in the same digest bucket in stable digest order', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      await apply(ctx, { root })
      const provider = ctx.teamArtifacts.getProvider('local')
      if (provider?.collect === undefined) throw new Error('local artifact collector was not registered')
      const firstData = 'bucket-collision-0'
      const prefix = createHash('sha256').update(firstData).digest('hex').slice(0, 2)
      let secondData = ''
      for (let index = 1; index < 10_000; index += 1) {
        const candidate = `bucket-collision-${index}`
        if (createHash('sha256').update(candidate).digest('hex').startsWith(prefix)) {
          secondData = candidate
          break
        }
      }
      if (secondData.length === 0) throw new Error('test could not find two objects in one bucket')
      const first = await provider.save({ teamId, kind: 'log', visibility: 'team', data: firstData })
      const second = await provider.save({ teamId, kind: 'log', visibility: 'team', data: secondData })
      const pageOne = await provider.collect({ reachable: [], reclaimableIds: [], limit: 1 })
      if (pageOne.nextCursor === undefined) throw new Error('first bucket page did not retain a cursor')
      const pageTwo = await provider.collect({ reachable: [], reclaimableIds: [], afterCursor: pageOne.nextCursor, limit: 1 })
      expect([...pageOne.unreachable, ...pageTwo.unreachable]).toEqual([first.id, second.id].sort())
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
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
    const lossKeep = await provider.save({ teamId, kind: 'log', visibility: 'team', data: 'workspace loss' })
    const remoteLoss = { id: 'remote:retained-loss', kind: 'log', uri: 'artifact-remote://retained-loss',
      visibility: 'team' }
    const orphan = await provider.save({ teamId, kind: 'report', visibility: 'team', data: 'orphan' })
    state = {
      ...keepState,
      workspaceAllocations: [{ loss: { artifacts: [lossKeep, remoteLoss] } }, { lifecycle: 'active' }],
      tasks: [{
        attemptHistory: [{ outcome: { kind: 'failed', failure: { code: 'RETRY', message: 'Retry later' } } },
          { outcome: { kind: 'completed', result: { summary: 'No attachments' } } },
          { outcome: { kind: 'completed', result: {
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
    expect(observed.reachableArtifacts).toBe(5)
    expect(observed.unreachable).toContain(orphan.id)
    await expect(provider.read({ reference: orphan })).resolves.toBeInstanceOf(Uint8Array)
    await expect(provider.read({ reference: proposalKeep })).resolves.toBeInstanceOf(Uint8Array)
    await expect(provider.read({ reference: integrationKeep })).resolves.toBeInstanceOf(Uint8Array)
    await expect(provider.read({ reference: lossKeep })).resolves.toBeInstanceOf(Uint8Array)

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

  it('paces retention across object cursors and begins grace only after each object is observed', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    ctx.provide('teams', { listTeamsPage: vi.fn(async () => ({ items: [] })) } as unknown as TeamRuntime)
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      await apply(ctx, { root, retention: { graceMs: 100, maxObjectsPerDrive: 1, disposalTimeoutMs: 1_000 } })
      const provider = ctx.teamArtifacts.getProvider('local')
      const retention = getRetention(ctx)
      if (provider === undefined || retention === undefined) throw new Error('artifact provider or retention owner is missing')
      const references = [
        await provider.save({ teamId, kind: 'log', visibility: 'team', data: 'unreachable-one' }),
        await provider.save({ teamId, kind: 'log', visibility: 'team', data: 'unreachable-two' }),
      ]
      const first = await retention.drive(1_000)
      expect(first.nextCursor).toBeDefined()
      expect(first.unreachable).toHaveLength(1)
      const second = await retention.drive(1_001)
      expect(second.unreachable).toHaveLength(1)
      expect(second.unreachable[0]).not.toBe(first.unreachable[0])
      const reclaimed = await retention.drive(1_200)
      expect(reclaimed.deleted).toEqual(first.unreachable)
      await expect(provider.read({ reference: references.find(value => value.id === second.unreachable[0])! }))
        .resolves.toBeInstanceOf(Uint8Array)
      const newlyTracked = await retention.drive(1_201)
      expect(newlyTracked.deleted).toEqual([])
      const afterGrace = await retention.drive(1_302)
      expect(afterGrace.deleted).toEqual(second.unreachable)
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it('keeps a Team-reachable artifact when a collector page mislabels it as unreachable', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    let keep!: TeamArtifactReference
    const teams = { listTeamsPage: vi.fn(async () => ({ items: [{ id: teamId }] })),
      getTeam: vi.fn(async () => ({ workspaceAllocations: [], tasks: [{ attemptHistory: [{
        outcome: { kind: 'completed', result: { artifacts: [keep] } },
      }] }] })) } as unknown as TeamRuntime
    ctx.provide('teams', teams)
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      await apply(ctx, { root, retention: { graceMs: 0, maxObjectsPerDrive: 1, disposalTimeoutMs: 1_000 } })
      const provider = ctx.teamArtifacts.getProvider('local'), retention = getRetention(ctx)
      if (provider === undefined || retention === undefined) throw new Error('artifact provider or retention owner is missing')
      keep = await provider.save({ teamId, kind: 'log', visibility: 'team', data: 'protected-by-Team' })
      vi.spyOn(ctx.teamArtifacts, 'collect').mockResolvedValueOnce({ scanned: 1, retained: 0,
        unreachable: [keep.id], deleted: [], failures: [] })
      expect((await retention.drive(1_000)).reachableArtifacts).toBe(1)
      expect((await retention.drive(2_000)).deleted).toEqual([])
      await expect(provider.read({ reference: keep })).resolves.toBeInstanceOf(Uint8Array)
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
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

  it('reports a failed retention pulse and partial object cleanup without hiding either failure', async () => {
    vi.useFakeTimers()
    const root = await freshRoot()
    const ctx = new Context()
    let failScan = true
    const teams = { listTeamsPage: vi.fn(async () => {
      if (failScan) throw new Error('Team listing unavailable')
      return { items: [] }
    }) } as unknown as TeamRuntime
    ctx.provide('teams', teams)
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      await apply(ctx, { root,
        retention: { graceMs: 0, maxObjectsPerDrive: 1, pulseIntervalMs: 10, disposalTimeoutMs: 1_000 } })
      const retention = getRetention(ctx)
      if (retention === undefined) throw new Error('retention owner was not registered')
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      retention.start()
      await vi.advanceTimersByTimeAsync(10)
      expect(warn.mock.calls.some(([message]) => String(message).includes('Team listing unavailable'))).toBe(true)
      failScan = false
      vi.spyOn(ctx.teamArtifacts, 'collect').mockResolvedValueOnce({ scanned: 1, retained: 1, unreachable: [],
        deleted: [], failures: [{ id: 'local:failed', message: 'Object was retained' }] })
      await vi.advanceTimersByTimeAsync(10)
      expect(warn.mock.calls.some(([message]) => String(message).includes('1 cleanup failure'))).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('waits for admitted retention work and reports its failure during disposal', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    const page = Promise.withResolvers<{ items: [] }>()
    const listTeamsPage = vi.fn(() => page.promise)
    const teams = { listTeamsPage } as unknown as TeamRuntime
    ctx.provide('teams', teams)
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      await apply(ctx, { root, retention: { graceMs: 0, maxObjectsPerDrive: 1, disposalTimeoutMs: 1_000 } })
      const retention = getRetention(ctx)
      if (retention === undefined) throw new Error('retention owner was not registered')
      const driving = retention.drive(1_000)
      await vi.waitFor(() => { expect(listTeamsPage).toHaveBeenCalledOnce() })
      const drivingFailure = expect(driving).rejects.toThrow('Team listing failed')
      const closing = retention.close()
      page.reject(new Error('Team listing failed'))
      await drivingFailure
      await expect(closing).rejects.toThrow('Team artifact retention disposal failed')
      await expect(retention.drive(1_001)).rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it('bounds disposal when an admitted Team listing remains stalled', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    const page = Promise.withResolvers<{ items: [] }>()
    const listTeamsPage = vi.fn(() => page.promise)
    const teams = { listTeamsPage } as unknown as TeamRuntime
    ctx.provide('teams', teams)
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(TeamArtifactStore)
      await apply(ctx, { root, retention: { graceMs: 0, maxObjectsPerDrive: 1, disposalTimeoutMs: 20 } })
      const retention = getRetention(ctx)
      if (retention === undefined) throw new Error('retention owner was not registered')
      const driving = retention.drive(1_000)
      await vi.waitFor(() => { expect(listTeamsPage).toHaveBeenCalledOnce() })
      await expect(retention.close()).rejects.toThrow('retention disposal exceeded 20ms')
      page.resolve({ items: [] })
      await expect(driving).resolves.toMatchObject({ teamsScanned: 0 })
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
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
