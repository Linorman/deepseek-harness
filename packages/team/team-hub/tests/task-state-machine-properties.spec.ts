import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  activationBindingSnapshotSchema,
  activationIdSchema,
  channelIdSchema,
  channelManifestSchema,
  channelRecordSchema,
  taskAttemptIdSchema,
  taskLeaseSnapshotSchema,
  teamEnvelopeSchema,
} from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, ChannelRecord, ParticipantId, TeamChannelAdapter, TeamEnvelope, TeamTaskSnapshot, TaskLeaseSnapshot } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import {
  channelProjectionData,
  channelProjectionFromData,
  channelReplayWatermark,
  foldChannelRecord,
  foldTeamRecord,
  teamProjectionData,
  teamProjectionFromData,
} from '../src/fold.ts'
import type { TeamProjection } from '../src/types.ts'
import {
  createdTeam,
  participant,
  participantChanged,
  task,
  taskChanged,
  taskCreatorActivationId,
  taskCreatorId,
  taskCreatorSessionId,
  taskId,
  teamId,
  teamPhase,
} from './fixtures.ts'
import { channelAdmissionPrefix } from './durable-channel-fixtures.ts'

type TerminalOutcome = 'completed' | 'failed' | 'cancelled' | 'released'

interface TaskScenario {
  readonly releaseCount: number
  readonly terminal: TerminalOutcome
  readonly heartbeats: readonly number[]
}

/** Build the creator and owner relations required by durable task provenance. */
function opening(maxAttempts = 1): TeamProjection {
  let projection = foldTeamRecord(undefined, createdTeam(), 0, teamId)
  projection = foldTeamRecord(projection, teamPhase(), 1, teamId)
  projection = foldTeamRecord(projection, participantChanged({
    participant: participant({
      id: taskCreatorId,
      role: 'coordinator',
      displayName: 'Task creator',
    }),
    createdAt: 12,
  }), 2, teamId)
  projection = foldTeamRecord(projection, participantChanged({
    participant: participant({
      id: taskCreatorId,
      role: 'coordinator',
      phase: 'provisioning',
      displayName: 'Task creator',
    }),
    createdAt: 13,
  }), 3, teamId)
  projection = foldTeamRecord(projection, participantChanged({
    participant: participant({
      id: taskCreatorId,
      role: 'coordinator',
      phase: 'active',
      displayName: 'Task creator',
    }),
    createdAt: 14,
  }), 4, teamId)
  projection = foldTeamRecord(projection, participantChanged({
    participant: participant({
      role: 'worker',
      displayName: 'Task owner',
    }),
    createdAt: 15,
  }), 5, teamId)
  projection = foldTeamRecord(projection, participantChanged({
    participant: participant({
      phase: 'provisioning',
      role: 'worker',
      displayName: 'Task owner',
    }),
    createdAt: 16,
  }), 6, teamId)
  projection = foldTeamRecord(projection, participantChanged({
    participant: participant({
      phase: 'active',
      role: 'worker',
      displayName: 'Task owner',
    }),
    createdAt: 17,
  }), 7, teamId)
  projection = foldTeamRecord(projection, {
    type: 'activation/changed',
    binding: creatorBinding(),
    createdAt: 18,
  }, 8, teamId)
  projection = foldTeamRecord(projection, {
    type: 'activation/changed',
    binding: ownerBinding(),
    createdAt: 19,
  }, 9, teamId)
  return foldTeamRecord(projection, taskChanged({
    task: task({ maxAttempts }),
    createdAt: 20,
  }), 10, teamId)
}

/** Build the active coordinator binding retained by the task creation command. */
function creatorBinding(): ActivationBindingSnapshot {
  return activationBindingSnapshotSchema.parse({
    activation: {
      id: taskCreatorActivationId,
      teamId,
      participantId: taskCreatorId,
      status: 'idle',
    },
    sessionId: taskCreatorSessionId,
    provider: 'in-process',
  })
}

/** Build the active worker binding retained by generated attempt leases. */
function ownerBinding(): ActivationBindingSnapshot {
  return activationBindingSnapshotSchema.parse({
    activation: {
      id: activationIdSchema.parse('activation-task-owner'),
      teamId,
      participantId: participant().id,
      status: 'idle',
    },
    sessionId: SessionId('session-task-owner'),
    provider: 'in-process',
  })
}

/** Build a schema-valid lease while keeping timestamps controlled by the model. */
function lease(overrides: Partial<TaskLeaseSnapshot>): TaskLeaseSnapshot {
  return taskLeaseSnapshotSchema.parse({
    attemptId: taskAttemptIdSchema.parse('attempt-model-0'),
    assignedRevision: 2,
    ordinal: 1,
    participantId: participant().id,
    activationId: ownerBinding().activation.id,
    assignedAt: 10,
    durationMs: 100,
    renewedAt: 10,
    expiresAt: 110,
    ...overrides,
  })
}

/** Fold one generated task snapshot at the next journal cursor. */
function append(
  projection: TeamProjection,
  current: TeamTaskSnapshot,
  cursor: number,
  createdAt: number,
): { readonly projection: TeamProjection; readonly task: TeamTaskSnapshot; readonly cursor: number } {
  const next = foldTeamRecord(projection, taskChanged({ task: current, createdAt }), cursor, teamId)
  const taskProjection = next.tasks.get(current.id)
  if (taskProjection === undefined) throw new Error(`task '${current.id}' was not retained by the fold`)
  return { projection: next, task: taskProjection, cursor: cursor + 1 }
}

/** Assert that a checkpoint round trip preserves every generated task state. */
function assertCheckpoint(projection: TeamProjection): void {
  const data = teamProjectionData(projection)
  const restored = teamProjectionFromData(data)
  expect(teamProjectionData(restored)).toEqual(data)
}

const taskChannelId = channelIdSchema.parse('channel-task-model-properties')
const taskChannelAdapter: TeamChannelAdapter = {
  type: 'task-model-properties',
  version: 1,
  validateCreate() {},
  initialState() { return {} },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan({ envelope }) {
    return (envelope.audience ?? []).map(participantId => ({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    }))
  },
  projectView() { return {} },
}

const taskChannelManifest = channelManifestSchema.parse({
  id: taskChannelId,
  teamId,
  adapter: { type: taskChannelAdapter.type, version: taskChannelAdapter.version },
  participants: [
    { id: taskCreatorId, role: 'coordinator' },
    { id: participant().id, role: 'worker' },
  ],
  limits: {},
})

/** Fold the channel opening records shared by every generated scenario. */
function channelOpening(): ReturnType<typeof foldChannelRecord> {
  let projection: ReturnType<typeof foldChannelRecord> | undefined
  for (const [cursor, record] of channelAdmissionPrefix(taskChannelManifest, 0, 30).entries()) {
    projection = foldChannelRecord(projection, record, cursor, taskChannelId, taskChannelAdapter)
  }
  if (projection === undefined) throw new Error('task channel admission prefix did not produce a projection')
  return projection
}

/** Append one valid generated record at the caller's next channel cursor. */
function appendChannel(
  projection: ReturnType<typeof foldChannelRecord>,
  record: ChannelRecord,
  cursor: number,
): ReturnType<typeof foldChannelRecord> {
  return foldChannelRecord(projection, record, cursor, taskChannelId, taskChannelAdapter)
}

/** Build a task/channel Envelope from one shared task-attempt identity. */
function taskChannelEnvelope(
  index: number,
  sequence: number,
  senderId: ParticipantId,
  audience: readonly ParticipantId[],
  kind: string,
  attemptId: ReturnType<typeof taskAttemptIdSchema.parse>,
  status: string,
): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: `task-channel-envelope-${String(index)}-${kind}`,
    teamId,
    channelId: taskChannelId,
    sequence,
    senderId,
    audience,
    taskId,
    kind,
    payload: { taskId: String(taskId), attemptId: String(attemptId), status },
    delivery: 'turn',
    priority: 'normal',
    createdAt: sequence,
  })
}

/** Read a generated textual task fact without relying on Object stringification. */
function payloadText(envelope: TeamEnvelope, key: string): string {
  const value = envelope.payload[key]
  if (typeof value !== 'string') throw new Error(`task/channel payload '${key}' is not textual`)
  return value
}

interface TaskChannelScenario {
  readonly attempts: number
  readonly heartbeats: readonly number[]
  readonly assignmentReceipts: readonly boolean[]
  readonly reportReceipts: readonly boolean[]
  readonly terminal: TerminalOutcome
}

describe('Team task lifecycle state-machine properties', () => {
  it('folds arbitrary retry, heartbeat, and terminal paths like the task model', () => {
    fc.assert(fc.property(
      fc.record({
        releaseCount: fc.integer({ min: 0, max: 3 }),
        terminal: fc.constantFrom<TerminalOutcome>('completed', 'failed', 'cancelled', 'released'),
        heartbeats: fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 4 }),
      }),
      (scenario: TaskScenario) => {
        const totalAttempts = scenario.releaseCount + 1
        const heartbeatCounts = Array.from({ length: totalAttempts }, (_, index) => scenario.heartbeats[index] ?? 0)
        let projection = opening(totalAttempts)
        let current = projection.tasks.get(taskId)
        if (current === undefined) throw new Error(`task '${taskId}' was not opened`)
        let cursor = 11
        let createdAt = 30

        for (let index = 0; index < totalAttempts; index += 1) {
          const attemptId = taskAttemptIdSchema.parse(`attempt-model-${String(index)}`)
          const assigned = lease({
            attemptId,
            assignedRevision: current.revision + 1,
            ordinal: index + 1,
            assignedAt: createdAt,
            renewedAt: createdAt,
            expiresAt: createdAt + 100,
          })
          current = task({
            ...current,
            revision: current.revision + 1,
            phase: 'assigned',
            attemptCount: index + 1,
            lease: assigned,
          })
          ;({ projection, task: current, cursor } = append(projection, current, cursor, createdAt))
          createdAt += 1

          let running = lease({ ...assigned, startedAt: createdAt })
          current = task({ ...current, revision: current.revision + 1, phase: 'running', lease: running })
          ;({ projection, task: current, cursor } = append(projection, current, cursor, createdAt))
          createdAt += 1

          for (let heartbeat = 0; heartbeat < heartbeatCounts[index]!; heartbeat += 1) {
            running = lease({
              ...running,
              renewedAt: createdAt,
              expiresAt: createdAt + running.durationMs,
            })
            current = task({ ...current, revision: current.revision + 1, lease: running })
            ;({ projection, task: current, cursor } = append(projection, current, cursor, createdAt))
            createdAt += 1
          }

          const isLast = index === totalAttempts - 1
          const outcome: TeamTaskSnapshot['attemptHistory'][number]['outcome'] = isLast
            ? scenario.terminal === 'completed'
              ? { kind: 'completed', result: { summary: 'model completed the task' } }
              : scenario.terminal === 'failed'
                ? { kind: 'failed', failure: { code: 'MODEL_FAILURE', message: 'model failure' } }
                : scenario.terminal === 'cancelled'
                  ? { kind: 'cancelled' }
                  : { kind: 'released' }
            : { kind: 'released' }
          const nextPhase: TeamTaskSnapshot['phase'] = !isLast
            ? 'pending'
            : scenario.terminal === 'completed'
              ? 'completed'
              : scenario.terminal === 'cancelled'
                ? 'cancelled'
                : 'failed'
          const settledAt = createdAt
          const attempt = {
            id: attemptId,
            teamId,
            taskId,
            ordinal: running.ordinal,
            participantId: running.participantId,
            activationId: running.activationId,
            wakeChannelId: running.wakeChannelId,
            assignedAt: running.assignedAt,
            startedAt: running.startedAt,
            leaseExpiresAt: running.expiresAt,
            settledAt,
            outcome,
          }
          current = task({
            ...current,
            revision: current.revision + 1,
            phase: nextPhase,
            lease: undefined,
            attemptHistory: [...current.attemptHistory, attempt],
          })
          ;({ projection, task: current, cursor } = append(projection, current, cursor, settledAt))
          createdAt += 1
        }

        expect(current.phase).toBe(scenario.terminal === 'completed' ? 'completed' : scenario.terminal === 'cancelled' ? 'cancelled' : 'failed')
        expect(current.lease).toBeUndefined()
        expect(current.attemptHistory).toHaveLength(totalAttempts)
        expect(current.attemptCount).toBe(totalAttempts)
        expect(projection.tasks.get(taskId)).toEqual(current)
        assertCheckpoint(projection)
      },
    ), { numRuns: 60 })
  })

  it('keeps task attempts, assignment/report Envelopes, receipts, and checkpoints aligned', () => {
    fc.assert(fc.property(
      fc.record({
        attempts: fc.integer({ min: 1, max: 4 }),
        heartbeats: fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 4 }),
        assignmentReceipts: fc.array(fc.boolean(), { maxLength: 4 }),
        reportReceipts: fc.array(fc.boolean(), { maxLength: 4 }),
        terminal: fc.constantFrom<TerminalOutcome>('completed', 'failed', 'cancelled', 'released'),
      }),
      (scenario: TaskChannelScenario) => {
        let taskProjection = opening(scenario.attempts)
        let current = taskProjection.tasks.get(taskId)
        if (current === undefined) throw new Error(`task '${taskId}' was not opened`)
        let taskCursor = 11
        let channelProjection = channelOpening()
        let channelCursor = channelProjection.cursor + 1
        const assignmentSequences = new Map<string, number>()
        const reportSequences = new Map<string, number>()
        const envelopes: TeamEnvelope[] = []
        const expectedPending = new Set<string>()
        const taskAttempts: string[] = []

        for (let index = 0; index < scenario.attempts; index += 1) {
          const attemptId = taskAttemptIdSchema.parse(`attempt-model-channel-${String(index)}`)
          taskAttempts.push(String(attemptId))
          const assignedAt = 30 + index * 10
          const assignedLease = lease({
            attemptId,
            assignedRevision: current.revision + 1,
            ordinal: index + 1,
            assignedAt,
            renewedAt: assignedAt,
            expiresAt: assignedAt + 100,
          })
          current = task({ ...current, revision: current.revision + 1, phase: 'assigned', attemptCount: index + 1, lease: assignedLease })
          ;({ projection: taskProjection, task: current, cursor: taskCursor } = append(taskProjection, current, taskCursor, assignedAt))

          const assignment = taskChannelEnvelope(index, channelCursor, taskCreatorId, [participant().id], 'assignment', attemptId, 'assigned')
          envelopes.push(assignment)
          assignmentSequences.set(String(attemptId), assignment.sequence)
          channelProjection = appendChannel(channelProjection, channelRecordSchema.parse({
            type: 'channel/envelope', envelope: assignment,
            deliveryIntents: [{ participantId: participant().id, envelopeId: assignment.id, delivery: assignment.delivery }],
          }), channelCursor)
          channelCursor += 1
          if (!(scenario.assignmentReceipts[index] ?? false)) expectedPending.add(String(assignment.id))
          else {
            channelProjection = appendChannel(channelProjection, channelRecordSchema.parse({
              type: 'channel/receipt', sequence: channelCursor, createdAt: channelCursor,
              participantId: participant().id, envelopeId: assignment.id, cursor: assignment.sequence,
            }), channelCursor)
            channelCursor += 1
          }

          const startedAt = assignedAt + 1
          const runningLease = lease({ ...assignedLease, startedAt })
          current = task({ ...current, revision: current.revision + 1, phase: 'running', lease: runningLease })
          ;({ projection: taskProjection, task: current, cursor: taskCursor } = append(taskProjection, current, taskCursor, startedAt))
          let running = runningLease
          const heartbeatCount = scenario.heartbeats[index] ?? 0
          for (let heartbeat = 0; heartbeat < heartbeatCount; heartbeat += 1) {
            const renewedAt = startedAt + heartbeat + 1
            running = lease({ ...running, renewedAt, expiresAt: renewedAt + running.durationMs })
            current = task({ ...current, revision: current.revision + 1, lease: running })
            ;({ projection: taskProjection, task: current, cursor: taskCursor } = append(taskProjection, current, taskCursor, renewedAt))
          }

          const isLast = index === scenario.attempts - 1
          const outcome: TeamTaskSnapshot['attemptHistory'][number]['outcome'] = isLast
            ? scenario.terminal === 'completed'
              ? { kind: 'completed', result: { summary: 'model completed the task' } }
              : scenario.terminal === 'failed'
                ? { kind: 'failed', failure: { code: 'MODEL_FAILURE', message: 'model failure' } }
                : scenario.terminal === 'cancelled'
                  ? { kind: 'cancelled' }
                  : { kind: 'released' }
            : { kind: 'released' }
          const nextPhase: TeamTaskSnapshot['phase'] = !isLast
            ? 'pending'
            : scenario.terminal === 'completed'
              ? 'completed'
              : scenario.terminal === 'cancelled'
                ? 'cancelled'
                : 'failed'
          const settledAt = startedAt + heartbeatCount + 1
          const settledAttempt = {
            id: attemptId, teamId, taskId, ordinal: running.ordinal,
            participantId: running.participantId, activationId: running.activationId,
            wakeChannelId: running.wakeChannelId, assignedAt: running.assignedAt,
            startedAt: running.startedAt, leaseExpiresAt: running.expiresAt, settledAt, outcome,
          }
          current = task({
            ...current,
            revision: current.revision + 1,
            phase: nextPhase,
            lease: undefined,
            attemptHistory: [...current.attemptHistory, settledAttempt],
          })
          ;({ projection: taskProjection, task: current, cursor: taskCursor } = append(taskProjection, current, taskCursor, settledAt))

          const report = taskChannelEnvelope(index, channelCursor, participant().id, [taskCreatorId], 'report', attemptId, outcome.kind)
          envelopes.push(report)
          reportSequences.set(String(attemptId), report.sequence)
          channelProjection = appendChannel(channelProjection, channelRecordSchema.parse({
            type: 'channel/envelope', envelope: report,
            deliveryIntents: [{ participantId: taskCreatorId, envelopeId: report.id, delivery: report.delivery }],
          }), channelCursor)
          channelCursor += 1
          if (!(scenario.reportReceipts[index] ?? false)) expectedPending.add(String(report.id))
          else {
            channelProjection = appendChannel(channelProjection, channelRecordSchema.parse({
              type: 'channel/receipt', sequence: channelCursor, createdAt: channelCursor,
              participantId: taskCreatorId, envelopeId: report.id, cursor: report.sequence,
            }), channelCursor)
            channelCursor += 1
          }

          const checkpoint = channelProjectionData(channelProjection)
          expect(channelProjectionFromData(checkpoint)).toEqual(channelProjection)
          assertCheckpoint(taskProjection)
        }

        expect(envelopes).toHaveLength(scenario.attempts * 2)
        expect(new Set(envelopes.map(envelope => String(envelope.taskId)))).toEqual(new Set([String(taskId)]))
        expect(new Set(envelopes.map(envelope => payloadText(envelope, 'attemptId')))).toEqual(new Set(taskAttempts))
        for (const envelope of envelopes) {
          const attemptId = payloadText(envelope, 'attemptId')
          expect(assignmentSequences.get(attemptId)).toBeDefined()
          expect(reportSequences.get(attemptId)).toBeDefined()
        }
        const pending = [...channelProjection.pendingDeliveries.values()].flatMap(deliveries => [...deliveries.values()])
        expect(new Set(pending.map(delivery => String(delivery.envelopeId)))).toEqual(expectedPending)
        const expectedWatermark = pending.length === 0
          ? channelProjection.cursor
          : Math.min(...pending.map(delivery => delivery.envelopeSequence)) - 1
        expect(channelReplayWatermark(channelProjection)).toBe(expectedWatermark)
        expect(current.attemptHistory.map(attempt => String(attempt.id))).toEqual(taskAttempts)
        expect(current.lease).toBeUndefined()
      },
    ), { numRuns: 50 })
  })
})
