/** Participant grant containment and parent-charge ownership in stored Team projections. @module */

import { describe, expect, it } from 'vitest'
import { participantSnapshotSchema, teamTaskSnapshotSchema } from '@clocky/clocky-team'
import { teamProjectionFromData } from '../src/fold.ts'
import { teamProjectionDataSchema } from '../src/schema.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, teamId, teamPhase } from './fixtures.ts'

function scopedParticipant() {
  const grant = { operations: ['invite', 'usage'], workspaceModes: ['shared'],
    readScopes: ['packages/team'], writeScopes: ['packages/team'], budgets: { maxTurns: 10 } }
  const member = participant({ authorityGrant: { ...grant, operations: ['usage'],
    readScopes: ['packages/team/review'], writeScopes: ['packages/team/output'], budgets: { maxTurns: 5 } } })
  const prefix = [createdTeam({ authorityGrant: grant }), teamPhase()]
  const record = participantChanged({ participant: member, createdAt: 12 })
  const records = [...prefix, record]
  return { prefix, record, records, member, checkpoint: checkpointFor(records) }
}

function childCharge(createdAt = 20) {
  const charge = { id: 'leaf-team:sample-a', sourceTeamId: 'child-team', parentTaskId: 'charge-task', originTeamId: 'leaf-team', sourceSampleId: 'sample-a',
    participantId: 'leaf-worker', sessionId: 'leaf-session', provider: 'mock', model: 'model',
    turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 3 }, costUnits: 1, observedAt: createdAt }
  const usage = { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0,
    turns: 1, costUnits: 1, updatedAt: createdAt }
  return { type: 'usage/child-charged', charge, usage, createdAt }
}


function chargePrefix(nested = false, parentCount?: number, childCount?: number) {
  const grant = { operations: ['register', 'usage'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {} }
  const owner = participant({ id: 'charge-owner', kind: 'human', role: 'human', owner: { kind: 'system' }, authorityGrant: grant })
  const initial = teamTaskSnapshotSchema.parse({ id: 'charge-task', teamId, revision: 1,
    execution: { kind: 'child-team', templateId: 'fixture', templateVersion: 1, authorityGrant: grant, budget: {} },
    createCommand: { creator: { teamId, participantId: owner.id }, idempotencyKey: 'charge-task-create' },
    subject: 'Child work', description: 'Charge this child', phase: 'pending', blockedBy: [], requiredCapabilities: [], priority: 0,
    readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, reviewHistory: [],
    maxAttempts: 1, attemptCount: 0, attemptHistory: [],
    delegation: { id: 'charge-delegation', phase: 'requested', requestedAt: 15, updatedAt: 15 } })
  const reserved = teamTaskSnapshotSchema.parse({ ...initial, revision: 2, phase: 'running', attemptCount: 1,
    delegation: { ...initial.delegation, phase: 'creating', startedAt: 16, updatedAt: 16, childTeamId: 'child-team',
      creation: { parentTeamId: teamId, parentTaskId: initial.id, delegationId: initial.delegation!.id,
        goal: { objective: 'Child work', budgets: {} }, rules: {},
        budgets: childCount === undefined ? {} : { maxChildTeams: childCount }, authorityGrant: grant } } })
  const root = createdTeam({
    ...(nested ? { parentTeamId: 'root-team', parentTaskId: 'root-task', depth: 1, maxTeamDepth: 2 } : { maxTeamDepth: 2 }),
    ...parentCount === undefined ? {} : { budgets: { maxChildTeams: parentCount } },
  })
  return [root, teamPhase(),
    ...['invited', 'provisioning', 'active'].map((phase, index) => ({ type: 'participant/changed', participant: { ...owner, phase }, createdAt: 12 + index })),
    { type: 'task/changed', task: initial, createdAt: 15 }, { type: 'task/changed', task: reserved, createdAt: 16 }]
}

describe('durable descendant count reservations', () => {
  it('rejects a checkpoint that narrows the Team ceiling below its retained subtree', () => {
    const valid = checkpointFor(chargePrefix(false, 2, 1))
    expect(() => teamProjectionFromData(valid)).not.toThrow()
    expect(() => teamProjectionFromData({ ...valid, budgets: { maxChildTeams: 1 } })).toThrow(/descendant reservations/)
    expect(() => teamProjectionFromData({ ...valid, budgets: { maxChildTeams: -1 } })).toThrow(/descendant count ceiling/)
  })

  it.each(['json', 'sqlite'] as const)('rejects omitted or oversubscribed descendant ceilings in %s journals', async (backend) => {
    for (const childCount of [undefined, 1]) {
      const ctx = await recover(backend, chargePrefix(false, 1, childCount))
      await expect(ctx.teams.getTeam({ teamId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
    }
  })
})

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable child relations (${backend})`, () => {
    it('retains participant read and write scopes beneath complete Team path segments', async () => {
      const f = scopedParticipant()
      const ctx = await recover(backend, f.records, { ...f.checkpoint, rules: { ...f.checkpoint.rules, narrowedGrant: true } })
      const state = await ctx.teams.getTeam({ teamId })
      expect(state.participants[0]?.authorityGrant).toEqual(f.member.authorityGrant)
      expect(state.rules).toHaveProperty('narrowedGrant', true)
    })

    for (const field of ['readScopes', 'writeScopes'] as const) {
      it(`rejects a journal participant whose ${field} share text but not the granted path segment`, async () => {
        const f = scopedParticipant()
        const damaged = { ...f.member, authorityGrant: { ...f.member.authorityGrant, [field]: ['packages/teammate'] } }
        expect(participantSnapshotSchema.safeParse(JSON.parse(JSON.stringify(damaged))).success).toBe(true)
        const ctx = await recover(backend, [...f.prefix, { ...f.record, participant: damaged }])
        await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow(`widens authority ${field === 'readScopes' ? 'read' : 'write'} scopes`)
      })

      it(`restores the journal grant when checkpoint ${field} escape the Team grant`, async () => {
        const f = scopedParticipant()
        const damaged = { ...f.member, authorityGrant: { ...f.member.authorityGrant, [field]: ['packages/teammate'] } }
        const ctx = await recover(backend, f.records, { ...f.checkpoint, participants: [damaged] })
        expect((await ctx.teams.getTeam({ teamId })).participants[0]?.authorityGrant).toEqual(f.member.authorityGrant)
      })
    }

    it.each([
      { field: 'operations', change: { operations: ['dispatch'] } },
      { field: 'workspaceModes', change: { workspaceModes: ['worktree'] } },
      { field: 'budgets', change: { budgets: { maxTurns: 11 } } },
    ])('restores the journal after checkpoint grant dimension $field widens', async ({ change }) => {
      const f = scopedParticipant()
      const damaged = { ...f.member, authorityGrant: { ...f.member.authorityGrant, ...change } }
      expect(participantSnapshotSchema.safeParse(JSON.parse(JSON.stringify(damaged))).success).toBe(true)
      const ctx = await recover(backend, f.records, { ...f.checkpoint, participants: [damaged] })
      expect((await ctx.teams.getTeam({ teamId })).participants[0]?.authorityGrant).toEqual(f.member.authorityGrant)
    })

    it.each(['team', 'participant', 'both'] as const)('retains a serialized checkpoint with an omitted %s grant', async (omitted) => {
      const f = scopedParticipant()
      const member = omitted === 'team' ? f.member : { ...f.member, authorityGrant: undefined }
      const created = omitted === 'participant' ? f.prefix[0] : createdTeam()
      const records = [created, teamPhase(), { ...f.record, participant: member }]
      const checkpoint = checkpointFor(records)
      const ctx = await recover(backend, records, { ...checkpoint, rules: { ...checkpoint.rules, optionalGrant: true } })
      const state = await ctx.teams.getTeam({ teamId })
      expect(state.team.authorityGrant).toEqual(checkpoint.team.authorityGrant)
      expect(state.participants[0]?.authorityGrant).toEqual(member.authorityGrant)
      expect(state.rules).toHaveProperty('optionalGrant', true)
    })

    it('accepts a root child charge while rejecting any earlier outbound parent-charge record', async () => {
      const prefix = chargePrefix()
      const charged = childCharge()
      const records = [...prefix, charged]
      const checkpoint = checkpointFor(records)
      expect(checkpoint.pendingParentCharges).toEqual([])
      const valid = await recover(backend, records, { ...checkpoint, rules: { ...checkpoint.rules, rootCharge: true } })
      const state = await valid.teams.getTeam({ teamId })
      expect(state.usage).toEqual(charged.usage)
      expect(state.rules).toHaveProperty('rootCharge', true)
      const pending = { type: 'usage/parent-charge-pending', charge: { ...charged.charge, sourceTeamId: teamId }, createdAt: 20 }
      const invalid = await recover(backend, [...prefix, pending, childCharge(21)])
      await expect(invalid.teams.getTeam({ teamId })).rejects.toThrow(`Team '${teamId}' cannot retain a parent usage charge without a parent Team`)
    })

    it('rejects a root pending ledger before accepting its child-charge checkpoint', async () => {
      const charged = childCharge()
      const records = [...chargePrefix(), charged]
      const checkpoint = checkpointFor(records)
      const damaged = { ...checkpoint, pendingParentCharges: [{ ...charged.charge, sourceTeamId: teamId }],
        rules: { ...checkpoint.rules, rootCharge: true } }
      const parsed = teamProjectionDataSchema.parse(JSON.parse(JSON.stringify(damaged)))
      expect(() => teamProjectionFromData(parsed)).toThrow(`Team checkpoint '${teamId}' has a pending parent charge without a parent Team`)
      const ctx = await recover(backend, records, damaged)
      const state = await ctx.teams.getTeam({ teamId })
      expect(state.usage).toEqual(charged.usage)
      expect(state.rules).not.toHaveProperty('rootCharge')
    })

    it('retains a nested Team charge for its next parent hop', async () => {
      const charged = childCharge()
      const records = [...chargePrefix(true), charged]
      const checkpoint = checkpointFor(records)
      expect(checkpoint.pendingParentCharges).toEqual([{ ...charged.charge, sourceTeamId: teamId, parentTaskId: 'root-task' }])
      const ctx = await recover(backend, records, { ...checkpoint, rules: { ...checkpoint.rules, nextHop: true } })
      const state = await ctx.teams.getTeam({ teamId })
      expect(state.team.parentTeamId).toBe('root-team')
      expect(state.usage).toEqual(charged.usage)
      expect(state.rules).toHaveProperty('nextHop', true)
    })
  })
}
