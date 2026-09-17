import { projectTeamSelection, projectMemberSession } from '@clocky/clocky-team/selection'
/** Selection bytes stay bounded independently of retained Team history. */
import { describe, expect, it } from 'vitest'
import { teamSelectionRequestSchema, teamSelectionSnapshotSchema } from '@clocky/clocky-team/schema'
import { activationIdSchema, activationReservationIdSchema, teamClosureIdempotencyKeySchema } from '@clocky/clocky-team'
import { teamProjectionFromData } from '../src/fold.ts'
import { teamSelection } from '../src/selection.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, goal, participant, participantChanged, task, taskCreatorSessionId, teamId } from './fixtures.ts'

function projection() {
  return teamProjectionFromData(checkpointFor([createdTeam({
    goal: goal({ objective: '甲😀乙'.repeat(10000) }), rules: { payload: 'r'.repeat(10000) },
  })]))
}

describe('bounded Team selection', () => {
  it('keeps Unicode prefixes whole, marks truncation, and excludes history and configuration', () => {
    const state = projection()
    const member = participant({ role: 'coordinator', phase: 'active', displayName: '😀协调员' })
    state.participants.set(member.id, member)
    for (let index = 0; index < 1000; index++) {
      const item = task({ id: `selection-task-${index}` })
      state.tasks.set(item.id, item)
    }
    const id = activationIdSchema.parse('selection-epoch')
    state.activations.set(id, { activation: { id, teamId, participantId: member.id, status: 'offline' },
      sessionId: taskCreatorSessionId, provider: 'in-process' })
    const selected = teamSelection(state, 7, 2048)
    expect(selected.goal.objective).toEqual({ text: '甲😀', truncated: true })
    expect(selected.coordinator).toMatchObject({ kind: 'bound', name: { text: '😀协', truncated: true },
      binding: { sessionId: taskCreatorSessionId, activation: { id, status: 'offline' } } })
    expect(selected.counts.tasks.pending).toBe(1000)
    expect(selected).not.toHaveProperty('tasks')
    expect(selected).not.toHaveProperty('participants')
    expect(selected).not.toHaveProperty('rules')
    expect(Buffer.byteLength(JSON.stringify(selected))).toBeLessThanOrEqual(2048)
    expect(teamSelectionSnapshotSchema.parse(selected)).toEqual(selected)
    if (selected.coordinator.kind !== 'bound') throw new Error('Coordinator binding missing')
    expect(teamSelectionSnapshotSchema.safeParse({ ...selected, coordinator: { ...selected.coordinator,
      binding: { ...selected.coordinator.binding, activation: { ...selected.coordinator.binding.activation, teamId: 'foreign' } },
    } }).success).toBe(false)
    expect(teamSelectionSnapshotSchema.safeParse({ ...selected, tasks: [] }).success).toBe(false)
    expect(teamSelection(state, 0, 2048).goal.objective).toEqual({ text: '', truncated: true })
  })

  it('includes detached scalar metadata only when requested and within the total byte allowance', () => {
    expect(teamSelectionRequestSchema.safeParse({ teamId, includeMetadata: 'true' }).success).toBe(false)
    expect(teamSelectionRequestSchema.safeParse({ teamId, includeMetadata: true, limit: 9 }).success).toBe(false)
    const state = teamProjectionFromData(checkpointFor([createdTeam({ goal: goal({ objective: 'Inspect this goal' }) })]))
    expect(teamSelection(state, 512, 16384)).not.toHaveProperty('metadata')
    const selected = teamSelection(state, 512, 16384, true)
    expect(selected.metadata).toEqual({ kind: 'available', goal: state.team.goal, budgets: state.budgets, usage: state.usage })
    expect(selected.metadata).not.toHaveProperty('tasks')
    expect(selected.metadata?.kind === 'available' && selected.metadata.goal === state.team.goal).toBe(false)
    expect(teamSelectionSnapshotSchema.parse(selected)).toEqual(selected)
    if (selected.metadata?.kind !== 'available') throw new Error('Expected scalar metadata')
    for (const goal of [{ ...selected.metadata.goal, teamId: 'foreign' }, { ...selected.metadata.goal, revision: 9 },
      { ...selected.metadata.goal, phase: 'completed' }, { ...selected.metadata.goal, objective: 'Another goal' }]) {
      expect(teamSelectionSnapshotSchema.safeParse({ ...selected, metadata: { ...selected.metadata, goal } }).success).toBe(false)
    }
    const truncated = teamSelection(state, 4, 16384, true)
    expect(teamSelectionSnapshotSchema.parse(truncated)).toEqual(truncated)
    expect(teamSelectionSnapshotSchema.safeParse({ ...truncated, goal: { ...truncated.goal,
      objective: { text: 'wrong', truncated: true } } }).success).toBe(false)
    const huge = teamSelection(projection(), 512, 2048, true)
    expect(huge.metadata).toEqual({ kind: 'unavailable', reason: 'too-large' })
    expect(huge.goal.objective.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(huge))).toBeLessThanOrEqual(2048)
    expect(() => teamSelection(state, 1, 1, true)).toThrow(/maxSelectionBytes/)
    const { budgets: _budgets, usage: _usage, ...withoutMetadata } = state
    expect(projectTeamSelection(withoutMetadata, 512, 16384, true)).toMatchObject({ ok: true,
      value: { metadata: { kind: 'unavailable', reason: 'not-provided' } } })
    const { humanActions: _humanActions, ...withoutActions } = withoutMetadata
    expect(projectTeamSelection(withoutActions, 512, 16384)).not.toHaveProperty('value.pendingHumanActionCount')
    const withActions = { ...withoutMetadata, budgets: {}, humanActions: new Map([
      ['pending', { phase: 'pending' as const }], ['answered', { phase: 'resolved' as const }],
    ]) }
    expect(projectTeamSelection(withActions, 512, 16384, true)).toMatchObject({ ok: true,
      value: { pendingHumanActionCount: 1, metadata: { kind: 'available', budgets: {} } } })
    const result = projectTeamSelection(withActions, 512, 16384, true)
    expect(result).not.toHaveProperty('value.metadata.usage')
    const baseline = teamSelection(state, 1, 16384)
    const exact = Buffer.byteLength(JSON.stringify(baseline))
    expect(() => teamSelection(state, 1, exact, true)).toThrow(/metadata/)

  })

  it('retains a bounded cancellation explanation while pending work winds down', () => {
    const state = projection()
    const cancelling = { ...state, team: { ...state.team, cancellation: {
      teamId, idempotencyKey: teamClosureIdempotencyKeySchema.parse('cancel-selection'),
      actor: { kind: 'system' as const, name: 'test' }, requestedAt: 20,
      reason: { code: 'cancelled', message: '取消😀'.repeat(1000) },
    } } }
    const selected = teamSelection(cancelling, 6, 2048)
    expect(selected.cancellation).toEqual({ reason: { text: '取消', truncated: true } })
    expect(teamSelectionSnapshotSchema.parse(selected)).toEqual(selected)
  })

  it('rejects impossible byte budgets and oversized structural identities instead of truncating routing data', () => {
    const state = projection()
    expect(() => teamSelection(state, 7, 1)).toThrow(/maxSelectionBytes/)
    const large = { ...state, team: { ...state.team, workspacePath: 'x'.repeat(3000) } }
    expect(() => teamSelection(large, 7, 2048)).toThrow(/identity/)
    expect(() => teamSelection({ ...state, team: { ...state.team, workspacePath: '甲'.repeat(800) } }, 7, 2048)).toThrow(/metadata/)
  })

  it('distinguishes missing, non-agent, ambiguous, and pending coordinator bindings', () => {
    const state = projection()
    expect(teamSelection(state, 10, 2048).coordinator).toEqual({ kind: 'unavailable', reason: 'missing-participant' })
    const member = participant({ role: 'coordinator', phase: 'active' })
    state.participants.set(member.id, member)
    expect(teamSelection(state, 10, 2048).coordinator).toEqual({ kind: 'unavailable', reason: 'missing-binding' })
    state.participants.set(member.id, participant({ ...member, kind: 'human' }))
    expect(teamSelection(state, 10, 2048).coordinator).toEqual({ kind: 'unavailable', reason: 'not-agent' })
    state.participants.set(member.id, member)
    const second = participant({ id: 'second-coordinator', role: 'coordinator', phase: 'active' })
    state.participants.set(second.id, second)
    expect(teamSelection(state, 10, 2048).coordinator).toEqual({ kind: 'unavailable', reason: 'ambiguous-participant' })
    state.participants.delete(second.id)
    const id = activationIdSchema.parse('old-epoch')
    state.activations.set(id, { activation: { id, teamId, participantId: member.id, status: 'offline' },
      sessionId: taskCreatorSessionId, provider: 'in-process' })
    state.participants.set(member.id, { ...member, activationReservation: { id: activationReservationIdSchema.parse('pending'),
      sessionId: taskCreatorSessionId, provider: 'in-process', reservedAt: 20 } })
    expect(teamSelection(state, 10, 2048).coordinator).toEqual({ kind: 'unavailable', reason: 'starting' })
  })

  it('selects the sole active coordinator over historical participants and preserves a published startup epoch', () => {
    const state = projection()
    const historical = participant({ id: 'old-coordinator', role: 'coordinator', phase: 'left' })
    state.participants.set(historical.id, historical)
    const member = participant({ role: 'coordinator', phase: 'active', displayName: 'Ready',
      activationReservation: { id: 'published', sessionId: taskCreatorSessionId, provider: 'in-process', reservedAt: 20 } })
    state.participants.set(member.id, member)
    const id = activationIdSchema.parse('published-epoch')
    state.activations.set(id, { activation: { id, teamId, participantId: member.id, status: 'idle' },
      sessionId: taskCreatorSessionId, provider: 'in-process', reservationId: activationReservationIdSchema.parse('published') })
    expect(teamSelection(state, 10, 2048).coordinator).toMatchObject({ kind: 'bound', name: { text: 'Ready', truncated: false } })
    state.participants.delete(member.id)
    expect(teamSelection(state, 10, 2048).coordinator).toEqual({ kind: 'unavailable', reason: 'missing-binding' })
  })

  it('resolves only the named member, returns the latest published epoch, and caps structural bytes', () => {
    const state = projection()
    const member = participant({ role: 'worker', phase: 'active' })
    expect(projectMemberSession(state, member.id, 2048)).toEqual({ ok: false, reason: 'missing-participant' })
    state.participants.set(member.id, member)
    expect(projectMemberSession(state, member.id, 2048)).toEqual({ ok: false, reason: 'missing-binding' })
    const first = activationIdSchema.parse('first')
    const second = activationIdSchema.parse('second')
    const binding = { activation: { id: first, teamId, participantId: member.id, status: 'offline' as const },
      sessionId: taskCreatorSessionId, provider: 'in-process' }
    state.activations.set(first, binding)
    state.activations.set(second, { ...binding, activation: { ...binding.activation, id: second } })
    expect(projectMemberSession(state, member.id, 2048)).toMatchObject({ ok: true, value: {
      activation: { id: second, status: 'offline' }, sessionId: taskCreatorSessionId,
    } })
    expect(projectMemberSession(state, member.id, 1)).toEqual({ ok: false, reason: 'too-large' })
    state.activations.set(second, { ...binding, provider: '甲'.repeat(1000) })
    expect(projectMemberSession(state, member.id, 2048)).toEqual({ ok: false, reason: 'too-large' })
  })

  it.each(['json', 'sqlite'] as const)('reads a member Session from durable history without an Agent provider (%s)', async (backend) => {
    const member = participant({ phase: 'active' })
    const id = activationIdSchema.parse('durable-member-epoch')
    const binding = { activation: { id, teamId, participantId: member.id, status: 'offline' },
      sessionId: taskCreatorSessionId, provider: 'in-process' }
    const ctx = await recover(backend, [createdTeam(),
      ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
        participantChanged({ participant: { ...member, phase }, createdAt: 12 + index })),
      { type: 'activation/changed', binding: { ...binding, activation: { ...binding.activation, status: 'idle' } }, createdAt: 15 },
      { type: 'activation/changed', binding, createdAt: 16 },
    ])
    expect(await ctx.teams.getMemberSession({ teamId, participantId: member.id })).toEqual(binding)
    await expect(ctx.teams.getMemberSession({ teamId, participantId: participant({ id: 'foreign' }).id }))
      .rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
  })

  it.each(['json', 'sqlite'] as const)('reads a durable Team without an Agent provider (%s)', async (backend) => {
    const ctx = await recover(backend, [createdTeam({ goal: goal({ objective: '🙂'.repeat(10000) }) })])
    const result = await ctx.teams.getTeamSelection({ teamId })
    expect(result.coordinator).toEqual({ kind: 'unavailable', reason: 'missing-participant' })
    expect(Buffer.byteLength(result.goal.objective.text)).toBe(512)
    expect(result.goal.objective.truncated).toBe(true)
    expect(Object.isFrozen(result)).toBe(true)
    expect((await ctx.teams.getTeam({ teamId })).team.cursor).toBe(result.team.cursor)
  })
})
