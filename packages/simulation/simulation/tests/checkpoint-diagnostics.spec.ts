/** Checkpoint diagnostics expose one bounded canonical owner reference. */
import { expect, it } from 'vitest'
import { simulationCheckpointDiagnosticSchema } from '../src/checkpoint-diagnostics-schema.ts'

it.each([
  { kind: 'run' },
  { kind: 'checkpoint', checkpointId: 'checkpoint' },
  { kind: 'team', teamId: 'team' },
  { kind: 'channel', teamId: 'team', channelId: 'channel' },
  { kind: 'session', sessionId: 'session', teamId: 'team', participantId: 'participant' },
  { kind: 'entity', entityId: 'entity' },
] as const)('retains the exact $kind checkpoint subject without private fields', (subject) => {
  const input = { stage: 'collect', code: 'source-unavailable', subject }
  expect(simulationCheckpointDiagnosticSchema.parse(input)).toEqual(input)
  expect(simulationCheckpointDiagnosticSchema.safeParse({ ...input, subject: { ...subject, privatePath: '/secret' } }).success)
    .toBe(false)
})
