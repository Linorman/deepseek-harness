/** Durable reference collection uses owner cursors, not guessed stream metadata. @module */
import { describe, expect, it, vi } from 'vitest'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, teamId, teamPhase } from './fixtures.ts'

for (const backend of ['json', 'sqlite'] as const) {
  describe(`${backend} persistence references`, () => {
    it('preserves Simulation history protection after terminal-state replay and checkpoint hydration', async () => {
      const rows = [createdTeam({ rules: { simulationRunId: 'protected', activationLifecycleOwner: 'simulation/protected' } }),
        teamPhase(), { type: 'team/closure', closure: { teamId, kind: 'fail', idempotencyKey: 'retention-terminal',
          actor: { kind: 'system', name: 'team-run' }, reason: { code: 'FAILED', message: 'Stop fixture' }, requestedAt: 12 }, createdAt: 12 },
        teamPhase({ phase: 'quiescing', createdAt: 13 }), teamPhase({ phase: 'failed', createdAt: 14 })]
      for (const checkpoint of [undefined, checkpointFor(rows)]) {
        const ctx = await recover(backend, rows, checkpoint)
        const state = await ctx.teams.getTeam({ teamId })
        const input = { teamId, expectedCursor: state.team.cursor, throughSequence: 0 }
        const proof = {} as import('@clocky/clocky-team').TeamSystemMaintenanceProof
        const remove = ctx.teams.registerSystemMaintenanceProofSource({ name: 'team-scheduler-dag',
          resolveMaintenanceProof: value => value === proof ? { kind: 'scheduler-team-journal-compaction', ...input } : undefined })
        try {
          const before = await ctx.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: state.team.cursor })
          expect(before.retention).toBe('full')
          await expect(ctx.teams.compactTeam({ ...input, actor: proof })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
          expect(await ctx.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: state.team.cursor })).toEqual(before)
        } finally { remove() }
      }
    })

    it('refuses a reference when the durable tail advances without the owning projection', async () => {
      const ctx = await recover(backend, [createdTeam(), teamPhase()])
      const open = ctx.storageLog.open.bind(ctx.storageLog)
      let journal: import('@clocky/clocky-storage').LogStream | undefined
      const observe = vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name === `team/${teamId}`) journal = stream
        return stream
      })
      try {
        const state = await ctx.teams.getTeam({ teamId })
        if (journal === undefined) throw new Error('Fixture Team journal was not opened')
        const { jsonValueSchema } = await import('@clocky/clocky-team')
        await journal.append(journal.tailSequence, [jsonValueSchema.parse(teamPhase({ phase: 'quiescing', createdAt: 12 }))])
        await expect(ctx.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: state.team.cursor }))
          .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
        await expect(ctx.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: state.team.cursor, prefixCursor: 0 }))
          .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
      } finally { observe.mockRestore() }
    })

    it('reconstructs an old prefix after a retained suffix and rejects a cursor beyond the tail', async () => {
      const prefix = await recover(backend, [createdTeam()])
      const original = await prefix.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: 0 })
      const current = await recover(backend, [createdTeam(), teamPhase()])
      expect(await current.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: 1, prefixCursor: 0 })).toEqual(original)
      await expect(current.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: 1, prefixCursor: 2 }))
        .rejects.toThrow(/not retained/)
      await expect(current.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: 0, prefixCursor: 0 }))
        .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    })

    it('retains the same full-projection fingerprint after journal or checkpoint reconstruction', async () => {
      const rows = [createdTeam(), teamPhase()]
      const live = await recover(backend, rows)
      const state = await live.teams.getTeam({ teamId })
      const reference = await live.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: state.team.cursor })
      expect(reference.owner).toEqual({ kind: 'team', teamId })
      expect(reference.retention).toBe('compactable')
      expect(reference.cursor).toBe(state.team.cursor)
      expect(reference.firstSequence).toBe(0)
      expect(reference.stream.name).toContain(teamId)
      expect(reference.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
      const restored = await recover(backend, rows, checkpointFor(rows))
      expect(await restored.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: state.team.cursor })).toEqual(reference)
      await expect(live.teams.getPersistenceReference({ kind: 'team', teamId, expectedCursor: state.team.cursor - 1 }))
        .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    })
  })
}

it.each(['json', 'sqlite'] as const)('%s prefix reads reject incomplete, gapped and oversized storage pages', async (backend) => {
  const ctx = await recover(backend, [createdTeam(), teamPhase()])
  const { TEAM_JOURNAL_FORMAT_VERSION } = await import('../src/types.ts')
  const { readPersistencePrefix } = await import('../src/persistence-prefix.ts')
  const stream = await ctx.storageLog.open({ name: `team/${teamId}`, version: TEAM_JOURNAL_FORMAT_VERSION })
  try {
    const fold = (_previous: number | undefined, entry: import('@clocky/clocky-storage').LogEntry) => entry.sequence
    const read = vi.spyOn(stream, 'read')
    read.mockResolvedValueOnce([])
    await expect(readPersistencePrefix(stream, 1, 1, fold)).rejects.toThrow(/incomplete/)
    read.mockResolvedValueOnce([{ sequence: 1, value: {} }])
    await expect(readPersistencePrefix(stream, 1, 1, fold)).rejects.toThrow(/cursor gap/)
    read.mockResolvedValueOnce([{ sequence: 0, value: {} }, { sequence: 1, value: {} }])
    await expect(readPersistencePrefix(stream, 0, 1, fold)).rejects.toThrow(/cursor gap/)
    read.mockRestore()
    await expect(readPersistencePrefix(stream, -1, 1, fold)).rejects.toThrow(/empty/)
    expect(await readPersistencePrefix(stream, 1, 1, fold)).toBe(1)
  } finally { await stream.close() }
})
