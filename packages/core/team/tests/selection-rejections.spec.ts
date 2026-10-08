/** Bounded selections refuse foreign collections, ambiguous principal ownership and absent review fences. */
import { expect, it } from 'vitest'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import { projectTeamSelection, projectMemberSession, projectTeamBrowse, findHumanActor, channelViewReviewMatches } from '../src/selection.ts'
import { activationBindingSnapshotSchema, teamSnapshotSchema, teamEnvelopeSchema } from '../src/schema.ts'
import type { ActivationBindingSnapshot, ActivationId, ParticipantSnapshot, ParticipantId, ChannelId,
  TeamTaskSnapshot, TeamTaskId, TeamWorkflowPlanSnapshot, TeamWorkflowPlanId } from '../src/types.ts'
import { goal, participant, task, teamId } from '../../../team/team-hub/tests/fixtures.ts'

function source() {
  return { rules: {}, team: teamSnapshotSchema.parse({ id: teamId, goal: goal(), phase: 'active', depth: 0, maxTeamDepth: 2,
    cursor: 0, createdAt: 0, updatedAt: 0 }), participants: new Map<ParticipantId, ParticipantSnapshot>(),
  activations: new Map<ActivationId, ActivationBindingSnapshot>(), tasks: new Map<TeamTaskId, TeamTaskSnapshot>(),
  channelIds: new Set<ChannelId>(), workflowPlans: new Map<TeamWorkflowPlanId, TeamWorkflowPlanSnapshot>() }
}

it('retains terminal child lineage, workspace identity and closure kind in a bounded selection', () => {
  const value = source()
  value.team = teamSnapshotSchema.parse({ ...value.team, parentTeamId: 'parent', parentTaskId: 'parent-task', depth: 1,
    workspacePath: process.cwd(), archivedAt: 10, phase: 'failed', updatedAt: 10,
    closure: { teamId, kind: 'fail', idempotencyKey: 'closure', actor: { kind: 'system', name: 'owner' }, requestedAt: 1,
      reason: { code: 'failed', message: 'Failed work' } } })
  expect(projectTeamSelection(value, 512, 16384)).toMatchObject({ ok: true, value: { closureKind: 'fail', team: {
    parentTeamId: 'parent', parentTaskId: 'parent-task', workspacePath: process.cwd(), archivedAt: 10,
  } } })
})

it('does not reveal another member’s published Session when the selected member has no binding', () => {
  const value = source()
  const member = participant({ phase: 'active' })
  value.participants.set(member.id, member)
  const foreign = activationBindingSnapshotSchema.parse({ activation: { id: 'foreign', teamId, participantId: 'other', status: 'idle' },
    sessionId: 'foreign-session', provider: 'local' })
  value.activations.set(foreign.activation.id, foreign)
  expect(projectMemberSession(value, member.id, 4096)).toEqual({ ok: false, reason: 'missing-binding' })
})

it('refuses foreign Team selection, foreign rows and unknown collection tags', () => {
  const value = source()
  const request = { teamId, kind: 'tasks' as const, afterCursor: -1, limit: 10 }
  expect(projectTeamBrowse(value, { ...request, teamId: 'other' as typeof teamId }, 512, 16384)).toEqual({ ok: false, reason: 'owner' })
  expect(() => projectTeamBrowse(value, { ...request, kind: 'unknown' as never }, 512, 16384)).toThrow('Unhandled Team browse collection')
  const foreign = task({ teamId: 'other' })
  value.tasks.set(foreign.id, foreign)
  expect(projectTeamBrowse(value, request, 512, 16384)).toEqual({ ok: false, reason: 'owner' })
  expect(projectTeamBrowse(value, { ...request, query: { search: '' } }, 512, 16384)).toEqual({ ok: false, reason: 'owner' })
})

it('bounds structural Team identities before traversing an ordinary collection', () => {
  const value = source()
  expect(projectTeamBrowse(value, { teamId, kind: 'tasks', afterCursor: -1, limit: 1 }, 512, 10))
    .toEqual({ ok: false, reason: 'metadata' })
  const longId = 'x'.repeat(2000)
  value.team = teamSnapshotSchema.parse({ ...value.team, id: longId, goal: { ...value.team.goal, teamId: longId } })
  expect(projectTeamBrowse(value, { teamId: value.team.id, kind: 'tasks', afterCursor: -1, limit: 1 }, 512, 1000))
    .toEqual({ ok: false, reason: 'metadata' })
})

it('keeps reviewer identity on task summaries independently of full task and review histories', () => {
  const value = source()
  const current = task({ reviewPolicy: { kind: 'participant', reviewerId: 'reviewer' },
    workflowPlanId: 'plan', workflowTemplateId: 'template' })
  value.tasks.set(current.id, current)
  expect(projectTeamBrowse(value, { teamId, kind: 'tasks', afterCursor: -1, limit: 1 }, 512, 16384))
    .toMatchObject({ ok: true, value: { items: [{ reviewerId: 'reviewer', workflowPlanId: 'plan' }] } })
})

it('rejects ambiguous active membership for the same authenticated principal', () => {
  const principalId = productPrincipalId('principal')
  const first = participant({ id: 'first', kind: 'human', phase: 'active', owner: { kind: 'product-principal', principalId } })
  const second = participant({ ...first, id: 'second' })
  expect(() => findHumanActor([first, second], { teamId, principalId })).toThrow('multiple active human')
})

it('requires a selected review-request Envelope and all four retained review fences', () => {
  const review = { attemptId: 'attempt' as never, reviewRevision: 1, reviewerId: 'reviewer' as never, initiatorId: 'initiator' as never }
  const envelope = teamEnvelopeSchema.parse({ id: 'envelope', teamId, channelId: 'channel', sequence: 0, senderId: 'initiator',
    kind: 'review-request', audience: null, payload: review, delivery: 'turn', priority: 'normal', createdAt: 0 })
  expect(channelViewReviewMatches(review, envelope)).toBe(true)
  expect(channelViewReviewMatches(undefined, envelope)).toBe(false)
  expect(channelViewReviewMatches(review, { ...envelope, kind: 'message' })).toBe(false)
  for (const patch of [{ attemptId: 'other' as never }, { reviewRevision: 2 }, { reviewerId: 'other' as never }, { initiatorId: 'other' as never }]) {
    expect(channelViewReviewMatches({ ...review, ...patch }, envelope)).toBe(false)
  }
})
