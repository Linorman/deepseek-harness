/** Child endpoint and independent result admission integrity in parsed journals. @module */
import { describe, expect, it } from 'vitest'
import { foldTeamRecord, teamProjectionData, teamProjectionFromData } from '../src/fold.ts'
import { teamJournalRecordSchema, teamProjectionDataSchema } from '../src/schema.ts'
import type { TeamProjection } from '../src/types.ts'
import { retainedChildFinalFixture } from './durable-child-final-fixtures.ts'
import { retainedFinalFixture } from './durable-final-fixtures.ts'
import { createdTeam, participant, participantChanged, taskCreatorId, taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'

/** Fold only parsed durable records, retaining the exact stream selected by creation. */
function replay(records: readonly unknown[]): TeamProjection {
  let projection: TeamProjection | undefined
  for (const [cursor, input] of records.entries()) {
    const record = teamJournalRecordSchema.parse(input)
    projection = foldTeamRecord(projection, record, cursor, projection?.team.id ?? (record.type === 'team/created' ? record.teamId : teamId))
  }
  if (projection === undefined) throw new Error('Missing fixture creation')
  return projection
}

/** Child roster and channel binding independently supported by a parent reservation/result. */
function fixture() {
  const final = retainedChildFinalFixture(taskCreatorId, taskCreatorSessionId)
  const member = participant({ id: taskCreatorId, role: 'coordinator' })
  const prefix = [createdTeam({ parentTeamId: final.parentTeam.id, parentTaskId: 'parent-task', depth: 1, maxTeamDepth: 2 }), teamPhase(),
    ...['invited', 'provisioning', 'active'].map((phase, index) => participantChanged({ participant: { ...member, phase }, createdAt: 12 + index })),
    ...final.memberRecords, final.attachment]
  const bound = [...prefix, final.bindingRecord]
  replay([...bound, final.admission])
  return { final, prefix, bound }
}

describe('Child replay identity and admission', () => {
  it('refuses duplicate endpoint binding and binding outside active creation', () => {
    const f = fixture()
    expect(() => replay([...f.bound, f.final.bindingRecord])).toThrow('must be bound once during active creation')
    const stalled = { type: 'team/phase', phase: 'stalled', createdAt: 26, reason: { code: 'stalled', message: 'Owner unavailable' } }
    expect(() => replay([...f.prefix, stalled, f.final.bindingRecord])).toThrow('must be bound once during active creation')
  })

  it.each(['parentTaskId', 'parentServiceId', 'coordinatorId', 'channelId'])('requires the retained child %s', (field) => {
    const f = fixture()
    if (f.final.bindingRecord.type !== 'team/child-run-bound') throw new Error('Missing fixture binding')
    const record = f.final.bindingRecord
    expect(() => replay([...f.prefix, { ...record, binding: { ...record.binding, [field]: 'other' } }]))
      .toThrow('does not match its lineage, endpoints or attached result channel')
  })

  it('rejects late or repeated child result admissions', () => {
    const f = fixture()
    expect(() => replay([...f.bound, { ...f.final.admission, createdAt: 32 }])).toThrow('journal timestamp must equal its admission timestamp')
    expect(() => replay([...f.bound, f.final.admission, f.final.admission])).toThrow('must be unique')
  })

  it('requires matching child binding before accepting a parent result', () => {
    const f = fixture()
    expect(() => replay([...f.prefix, f.final.admission])).toThrow('differs from its lineage, bound endpoints or parent result')
    if (f.final.admission.type !== 'team/child-result-admitted') throw new Error('Missing fixture child admission')
    const admission = f.final.admission.admission
    const altered = { ...admission, parent: { ...admission.parent, binding: { ...admission.parent.binding, channelId: 'other' } } }
    expect(() => replay([...f.bound, { ...f.final.admission, admission: altered }])).toThrow('differs from its lineage')
  })

  it('refuses a human sink admission on a child Team', () => {
    const f = fixture()
    const human = retainedFinalFixture({ channelId: 'human-final', senderId: taskCreatorId,
      memberAt: 14, createdAt: 26, admittedAt: 31, receiptAt: 32 })
    expect(() => replay([...f.bound, human.admission])).toThrow('a child Team cannot accept a human final result')
  })

  it('refuses endpoint binding after a closure intent', () => {
    const f = fixture()
    const closure = { type: 'team/closure', createdAt: 26, closure: { teamId, kind: 'fail', idempotencyKey: 'fail',
      actor: { kind: 'system', name: 'owner' }, reason: { code: 'failed', message: 'Failed' }, requestedAt: 26 } }
    expect(() => replay([...f.prefix, closure, f.final.bindingRecord])).toThrow('business records after its closure intent')
    expect(() => replay([...f.bound, closure, f.final.admission])).toThrow('cannot replace human or cancelled work')
  })

  it('requires parent admission cursor and task revision to match the exact accepting record', () => {
    const f = fixture()
    const rows = f.final.parentTeam.records
    const last = teamJournalRecordSchema.parse(rows.at(-1))
    if (last.type !== 'task/changed' || last.task.delegation?.result === undefined) throw new Error('Missing parent admission fixture')
    const task = last.task
    const delegation = task.delegation!
    const result = delegation.result!
    for (const patch of [{ parentCursor: result.parentCursor + 1 }, { parentTaskRevision: result.parentTaskRevision - 1 }]) {
      expect(() => replay([...rows.slice(0, -1), { ...last,
        task: { ...task, delegation: { ...delegation, result: { ...result, ...patch } } } }])).toThrow('invalid parent result admission')
    }
    const checkpoint = teamProjectionData(replay(rows))
    const damaged = teamProjectionDataSchema.parse({ ...checkpoint, tasks: [{ ...task,
      delegation: { ...delegation, result: { ...result, parentCursor: checkpoint.team.cursor + 1 } } }] })
    expect(() => teamProjectionFromData(damaged)).toThrow('result admission exceeds its journal cursor')
  })

  it('keeps an accepted child result immutable on later parent revisions', () => {
    const f = fixture()
    const rows = f.final.parentTeam.records
    const last = teamJournalRecordSchema.parse(rows.at(-1))
    if (last.type !== 'task/changed' || last.task.delegation?.result === undefined) throw new Error('Missing parent admission fixture')
    const prior = last.task
    const delegation = prior.delegation!
    const next = { ...prior, revision: prior.revision + 1, phase: 'completed',
      delegation: { ...delegation, phase: 'completed', updatedAt: 32, result: { ...delegation.result, text: 'Changed result' } } }
    expect(() => replay([...rows, { type: 'task/changed', task: next, createdAt: 32 }])).toThrow('changed its exact delegation identity')
  })
})

it('requires parent-service acceptance even when a child checkpoint claims completion', () => {
  const f = fixture()
  const data = teamProjectionData(replay(f.bound))
  const parsed = teamProjectionDataSchema.parse({ ...data, team: { ...data.team, phase: 'completed' } })
  expect(() => teamProjectionFromData(parsed)).toThrow('completed child Team has no parent-service result admission')
})

it('requires a stalled child delegation to resume before accepting its result', () => {
  const f = fixture()
  const rows = f.final.parentTeam.records
  const last = teamJournalRecordSchema.parse(rows.at(-1))
  if (last.type !== 'task/changed' || last.task.delegation?.result === undefined) throw new Error('Missing parent admission fixture')
  const parent = replay(rows.slice(0, -1))
  const current = parent.tasks.get(last.task.id)!
  const stalled = { ...current, revision: current.revision + 1, delegation: { ...current.delegation, phase: 'stalled', updatedAt: 30 } }
  const prior = [...rows.slice(0, -1), { type: 'task/changed', task: stalled, createdAt: 30 }]
  replay(prior)
  const delegation = last.task.delegation
  const task = { ...last.task, revision: last.task.revision + 1, delegation: { ...delegation,
    result: { ...delegation.result, parentTaskRevision: last.task.revision + 1, parentCursor: prior.length } } }
  expect(() => replay([...prior, { ...last, task }])).toThrow('invalid parent result admission')
})
