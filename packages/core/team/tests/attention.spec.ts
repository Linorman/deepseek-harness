/** Pending summaries remain complete across off-page sources and bounded across each response. */
import { expect, it } from 'vitest'
import { projectTeamAttention, teamAttentionCounts } from '../src/attention.ts'
import { humanActionHandling } from '../src/attention.ts'
import { teamActionInspectionSchema, teamActionInspectInputSchema } from '../src/schema.ts'
import { teamAttentionPageSchema, teamAttentionReadInputSchema } from '../src/schema.ts'
import type { TeamAttentionSource } from '../src/attention.ts'
import type { ActivationBindingSnapshot, TeamAttentionReadInput, TeamHumanActionSnapshot, TeamSnapshot } from '../src/types.ts'
import { createdTeam, participant, settledAttempt, task, teamId } from '../../../team/team-hub/tests/fixtures.ts'

const human = participant({ id: 'reader', kind: 'human', phase: 'active', authorityGrant: {
  operations: ['activate', 'human-action', 'task-mutate'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {},
} })

function source() {
  const created = createdTeam()
  if (created.type !== 'team/created') throw new Error('Expected Team creation')
  const team: TeamSnapshot = { id: teamId, goal: created.goal, depth: 0, maxTeamDepth: 2, phase: 'active',
    cursor: 50, createdAt: 10, updatedAt: 100 }
  const actions = [action('b', 30), action('a', 30), action('done', 20, 'resolved')]
  const review = task({ id: 'review', createdAt: 12, phase: 'review', attemptCount: 1,
    reviewPolicy: { kind: 'participant', reviewerId: human.id },
    attemptHistory: [settledAttempt({ taskId: 'review', outcome: { kind: 'completed', result: { summary: 'Private result' } } })] })
  return { team, tasks: new Map([[review.id, review]]), humanActions: new Map(actions.map(value => [value.id, value])),
    activations: new Map<ActivationBindingSnapshot['activation']['id'], ActivationBindingSnapshot>(), rules: {} } satisfies TeamAttentionSource
}

function action(id: string, createdAt: number, phase: TeamHumanActionSnapshot['phase'] = 'pending'): TeamHumanActionSnapshot {
  return { id: id as never, teamId, sourceId: id as never, kind: 'approval', phase,
    sessionId: 'action-session' as never, participantId: 'requester' as never,
    details: { secret: 'Private prompt' }, createdAt, updatedAt: createdAt }
}

function read(value: TeamAttentionSource, input: TeamAttentionReadInput = { teamId }, limit = 64, bytes = 10000,
  actor = human, parent = false) {
  return projectTeamAttention(value, input, { limit, textBytes: 7, bytes }, actor, parent)
}

it('counts every pending source and orders by priority, creation time and stable ID', () => {
  const value = source()
  value.team = { ...value.team, phase: 'stalled', stallReason: { code: 'unknown', message: '需要恢复🙂' } }
  const page = read(value)
  expect(page.counts).toEqual({ recovery: 1, humanActions: 2, reviews: 1, total: 4 })
  expect(page.items.map(item => [item.kind, item.id])).toEqual([
    ['team-recovery', teamId], ['human-action', 'a'], ['human-action', 'b'], ['task-review', 'review'],
  ])
  expect(page.items[0]).toMatchObject({ reason: { message: { text: '需要', truncated: true } } })
  expect(JSON.stringify(page)).not.toMatch(/Private prompt|Private result|authorityGrant|attemptHistory/)
  expect(teamAttentionPageSchema.parse(page)).toEqual(page)
  expect(teamAttentionCounts({ ...value, humanActions: undefined })).toBeUndefined()
})

it('returns consistent counts on each bounded page and refuses foreign, moved or invented positions', () => {
  const value = source()
  const first = read(value, { teamId }, 1)
  expect(first.items.map(item => item.id)).toEqual(['a'])
  const second = read(value, { teamId, cursor: first.nextCursor }, 1)
  expect(second.items.map(item => item.id)).toEqual(['b'])
  expect(second.counts).toEqual(first.counts)
  const last = read(value, { teamId, cursor: second.nextCursor }, 1)
  expect(last.items.map(item => item.id)).toEqual(['review'])
  expect(last.nextCursor).toBeUndefined()
  expect(() => read(value, { teamId: 'other' as never })).toThrow('another Team')
  for (const cursor of [{ ...first.nextCursor!, teamId: 'other' as typeof teamId },
    { ...first.nextCursor!, teamCursor: 49 }]) expect(() => read(value, { teamId, cursor })).toThrow('changed')
  expect(() => read(value, { teamId, cursor: { ...first.nextCursor!, position: { kind: 'human-action', id: 'absent' as never, createdAt: 30 } } }))
    .toThrow('retained item')
  expect(() => teamAttentionReadInputSchema.parse({ teamId, actor: {}, limit: 1 })).toThrow()
})

it('includes full wrappers and continuations in the UTF-8 allowance and retains the first unread row', () => {
  const value = source()
  const first = read(value, { teamId }, 1)
  const bytes = Buffer.byteLength(JSON.stringify(first))
  expect(read(value, { teamId }, 64, bytes)).toEqual(first)
  expect(() => read(value, { teamId }, 64, bytes - 1)).toThrow('item exceeds')
  const empty = { ...value, tasks: new Map(), humanActions: new Map() }
  const page = read(empty)
  expect(page.counts.total).toBe(0)
  expect(read(empty, { teamId }, 1, Buffer.byteLength(JSON.stringify(page)))).toEqual(page)
  expect(() => read(empty, { teamId }, 1, 1)).toThrow('page exceeds')
})

it('keeps readable responsibilities while explaining current handling permissions and lifecycle', () => {
  const value = source()
  expect(read(value).items.every(item => item.handling.kind === 'actionable')).toBe(true)
  expect(read(value, { teamId }, 64, 10000, human, true).items.every(item => item.handling.kind === 'waiting'
    && item.handling.reason === 'parent-inspection')).toBe(true)
  const denied = { ...human, authorityGrant: { ...human.authorityGrant!, operations: [] } }
  expect(read(value, { teamId }, 64, 10000, denied).items.every(item => item.handling.kind === 'waiting'
    && item.handling.reason === 'not-authorized')).toBe(true)
  const other = { ...human, id: 'other-reviewer' as typeof human.id }
  expect(read(value, { teamId }, 64, 10000, other).items.at(-1)).toMatchObject({ handling: { reason: 'reviewer-required' } })
  for (const [changed, reason] of [
    [{ ...value, rules: { simulationRunId: 'run' } }, 'simulation-managed'],
    [{ ...value, team: { ...value.team, phase: 'completed' as const } }, 'team-inactive'],
    [{ ...value, team: { ...value.team, phase: 'quiescing' as const, closure: { teamId, kind: 'cancel' as const,
      idempotencyKey: 'closure' as never, actor: { kind: 'system' as const, name: 'fixture' },
      reason: { code: 'cancelled', message: 'Cancellation requested' }, requestedAt: 99 } } }, 'closure-in-progress'],
    [{ ...value, team: { ...value.team, cancellation: { teamId, idempotencyKey: 'cancel' as never,
      actor: { kind: 'system' as const, name: 'fixture' }, reason: { code: 'cancelled', message: 'Cancellation requested' }, requestedAt: 99 } } }, 'closure-in-progress'],
  ] as const) expect(read(changed).items.every(item => item.handling.kind === 'waiting' && item.handling.reason === reason)).toBe(true)
})

it('retains stalled delegations and accepted or obsolete human requests without implying completion', () => {
  const value = source()
  const child = task({ id: 'delegate', maxAttempts: 1, execution: { kind: 'child-team', templateId: 'fixture', templateVersion: 1,
    authorityGrant: { operations: [], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {} }, budget: {} },
  delegation: { id: 'delegation', phase: 'stalled', requestedAt: 13, updatedAt: 14 },
  })
  value.tasks.set(child.id, child)
  const plain = task({ id: 'plain' })
  const deleted = task({ id: 'deleted', phase: 'deleted' })
  value.tasks.set(plain.id, plain); value.tasks.set(deleted.id, deleted)
  const accepted = { ...action('accepted', 32), response: { expectedUpdatedAt: 32, idempotencyKey: 'answer' as never,
    answer: { kind: 'approval' as const, outcome: 'allowed-once' as const }, respondedBy: human.id, acceptedAt: 33 } }
  value.humanActions.set(accepted.id, accepted)
  const obsolete = { ...action('obsolete', 34), taskId: plain.id, attemptId: 'retired' as never }
  value.humanActions.set(obsolete.id, obsolete)
  expect(read(value).items.find(item => item.kind === 'task-recovery')).toMatchObject({ handling: { reason: 'recovery-owner-required' } })
  expect(read(value).items.find(item => item.id === accepted.id)).toMatchObject({ handling: { reason: 'response-accepted' } })
  expect(read(value).items.find(item => item.id === obsolete.id)).toMatchObject({ handling: { reason: 'source-changed' } })
  expect(read(value).counts).toEqual({ recovery: 1, humanActions: 4, reviews: 1, total: 6 })
  const full = { ...child, delegation: { ...child.delegation!, childTeamId: 'child' as typeof teamId,
    failure: { code: 'unknown', message: '需要对账🙂' } } }
  value.tasks.set(child.id, full)
  expect(read(value).items[0]).toMatchObject({ childTeamId: 'child', reason: { code: 'unknown' } })
  expect(read(value, { teamId }, 64, 10000, human, true).items[0]).toMatchObject({ handling: { reason: 'parent-inspection' } })
})

it('checks the exact task attempt, participant and Session when presenting pending answers', () => {
  const value = source()
  const leased = task({ id: 'leased', phase: 'assigned', revision: 2, attemptCount: 1, lease: {
    attemptId: 'current', assignedRevision: 2, ordinal: 1, participantId: 'requester', activationId: 'epoch',
    assignedAt: 14, durationMs: 10, renewedAt: 14, expiresAt: 24,
  } })
  value.tasks.set(leased.id, leased)
  const binding = { activation: { id: 'epoch' as never, teamId, participantId: 'requester' as never, status: 'idle' as const },
    sessionId: 'action-session' as never, provider: 'fixture' }
  value.activations.set(binding.activation.id, binding)
  const pending = { ...action('live', 40), taskId: leased.id, attemptId: leased.lease!.attemptId }
  value.humanActions.set(pending.id, pending)
  expect(read(value).items.find(item => item.id === pending.id)).toMatchObject({ handling: { kind: 'actionable' } })
  for (const patch of [{ attemptId: 'other' as never }, { participantId: 'other' as never }, { sessionId: 'other' as never }]) {
    value.humanActions.set(pending.id, { ...pending, ...patch })
    expect(read(value).items.find(item => item.id === pending.id)).toMatchObject({ handling: { reason: 'source-changed' } })
  }
  value.humanActions.set(pending.id, pending)
  value.activations.clear()
  expect(read(value).items.find(item => item.id === pending.id)).toMatchObject({ handling: { reason: 'source-changed' } })
})

it('rejects wire pages with repeated, unsorted, cross-Team or inconsistent continuation data', () => {
  const page = read(source(), { teamId }, 1)
  for (const changed of [
    { ...page, counts: { ...page.counts, total: 1 } },
    { ...page, items: [page.items[0], page.items[0]] },
    { ...page, items: [] },
    { ...page, nextCursor: { ...page.nextCursor, teamId: 'other' } },
    { ...page, nextCursor: { ...page.nextCursor, teamCursor: 1 } },
  ]) expect(teamAttentionPageSchema.safeParse(changed).success).toBe(false)
  const full = read(source())
  expect(teamAttentionPageSchema.safeParse({ ...full, items: [...full.items].reverse() }).success).toBe(false)
})

it('retains processed request inspection while refusing invented identities or actionable processed bodies', () => {
  const value = source()
  const resolved = { ...action('resolved', 40, 'resolved'), outcome: { kind: 'answered' } }
  expect(humanActionHandling(value, resolved, human, false)).toEqual({ kind: 'waiting', reason: 'already-processed' })
  const inspected = { teamId, teamCursor: 50, action: resolved, handling: humanActionHandling(value, resolved, human, false) }
  expect(teamActionInspectionSchema.parse(inspected)).toEqual(inspected)
  expect(teamActionInspectionSchema.safeParse({ ...inspected, teamId: 'other' }).success).toBe(false)
  expect(teamActionInspectionSchema.safeParse({ ...inspected, handling: { kind: 'actionable' } }).success).toBe(false)
  expect(teamActionInspectInputSchema.safeParse({ teamId, actionId: resolved.id, handling: { kind: 'actionable' } }).success).toBe(false)
})
