/** Durable reference collection uses owner cursors, not guessed stream metadata. @module */
import { describe, expect, it, vi } from 'vitest'
import { channelIdSchema, channelManifestSchema, jsonValueSchema } from '@clocky/clocky-team'
import type { TeamChannelAdapter } from '@clocky/clocky-team'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { channelAdmissionPrefix } from './durable-channel-fixtures.ts'
import { createdTeam, participant, participantChanged, teamId, teamPhase } from './fixtures.ts'

const referenceAdapter: TeamChannelAdapter = {
  type: 'reference-test', version: 1,
  validateCreate() {}, initialState() { return null }, validateSend() {}, fold(state) { return state },
  afterAccept() { return [] }, expectedNext() { return { kind: 'none' } },
  deliveryPlan() { return [] }, projectView() { return {} },
}

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

    it('returns a bounded channel prefix and rejects a physical WAL tail that passed its owner cursor', async () => {
      const channelId = channelIdSchema.parse('reference-channel')
      const member = participant({ id: 'reference-member', role: 'member' })
      const rows = [createdTeam(), teamPhase(),
        ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
          participantChanged({ participant: { ...member, phase }, createdAt: 12 + index })),
        { type: 'channel/attached', channelId, createdAt: 15 }]
      const manifest = channelManifestSchema.parse({ id: channelId, teamId,
        adapter: { type: referenceAdapter.type, version: referenceAdapter.version },
        participants: [{ id: member.id, role: 'member' }], limits: {} })
      const wal = channelAdmissionPrefix(manifest, 16, 30)
      const ctx = await recover(backend, rows, undefined, teamId, [{ id: channelId, records: wal }])
      ctx.teams.registerAdapter(referenceAdapter)
      const open = ctx.storageLog.open.bind(ctx.storageLog)
      let stream: import('@clocky/clocky-storage').LogStream | undefined
      const observe = vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const opened = await open(descriptor)
        if (descriptor.name === `channel/${channelId}`) stream = opened
        return opened
      })
      try {
        const current = await ctx.teams.getPersistenceReference({ kind: 'channel', channelId, expectedCursor: wal.length - 1 })
        const prefix = await ctx.teams.getPersistenceReference({ kind: 'channel', channelId,
          expectedCursor: wal.length - 1, prefixCursor: 0 })
        expect(current.owner).toEqual({ kind: 'channel', channelId })
        expect(current.retention).toBe('compactable')
        expect(prefix.cursor).toBe(0)
        expect(prefix.fingerprint).not.toBe(current.fingerprint)
        await expect(ctx.teams.getPersistenceReference({ kind: 'channel', channelId, expectedCursor: 0 }))
          .rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
        if (stream === undefined) throw new Error('Fixture channel stream was not opened')
        const firstRow = (await stream.read(-1, 1))[0]
        if (firstRow === undefined) throw new Error('Fixture channel has no opening row')
        const sourceRead = vi.spyOn(stream, 'read')
        const auditInput = { teamId, channelId, afterCursor: -1, limit: 16 }
        sourceRead.mockResolvedValueOnce([])
        await expect(ctx.teams.readAudit(auditInput)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
        sourceRead.mockResolvedValueOnce([{ ...firstRow, sequence: firstRow.sequence + 1 }])
        await expect(ctx.teams.readAudit(auditInput)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
        sourceRead.mockRestore()
        const audit = ctx.storageLog.get(`audit/${teamId}/channel/${channelId}`)
        if (audit === undefined) throw new Error('Fixture channel audit was not opened')
        const appendAudit = audit.append.bind(audit)
        const wrongTail = vi.spyOn(audit, 'append').mockImplementationOnce(async (cursor, values) => {
          const accepted = await appendAudit(cursor, values)
          return { ...accepted, tailSequence: accepted.tailSequence + 1 }
        })
        try { await expect(ctx.teams.readAudit(auditInput)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' }) }
        finally { wrongTail.mockRestore() }
        expect((await ctx.teams.readAudit(auditInput)).items).toHaveLength(wal.length)
        const ahead = vi.spyOn(audit, 'tailSequence', 'get').mockReturnValue(stream.tailSequence + 1)
        try { await expect(ctx.teams.readAudit(auditInput)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' }) }
        finally { ahead.mockRestore() }
        await stream.append(stream.tailSequence, [jsonValueSchema.parse({ type: 'channel/phase',
          sequence: wal.length, phase: 'closing', createdAt: 31 })])
        await expect(ctx.teams.getPersistenceReference({ kind: 'channel', channelId, expectedCursor: wal.length - 1 }))
          .rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
      } finally { observe.mockRestore() }
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
