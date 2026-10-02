/** Original update identity is distinct from normalized semantic fields and current task state. */
import { expect, it } from 'vitest'
import { normalizeTaskDetailsUpdate, taskUpdateReceipt, taskUpdateRejection, TeamTaskUpdateRejectedError } from '../src/task-update.ts'
import { teamTaskDetailsUpdateInputSchema, teamTaskUpdateCommandReceiptSchema, teamTaskUpdateCommandRejectionSchema,
  teamTaskUpdateReceiptSchema, teamTaskDetailsUpdateResultSchema, teamTaskUpdateLookupSchema } from '../src/schema.ts'

it('normalizes all supplied replacements without changing command identity or omitted fields', () => {
  const identity = { teamId: 'team', taskId: 'task', commandId: 'update', expectedRevision: 1 }
  for (const patch of [{ subject: 'Name' }, { description: 'Instructions' }, { blockedBy: [] }]) {
    expect(normalizeTaskDetailsUpdate(teamTaskDetailsUpdateInputSchema.parse({ ...identity, ...patch }))).toEqual({ ...identity, ...patch })
  }
  const input = teamTaskDetailsUpdateInputSchema.parse({ ...identity, subject: '  New name  ',
    description: '  Full instructions\nSecond line  ', blockedBy: ['dependency'] })
  const result = normalizeTaskDetailsUpdate(input)
  expect(result).toEqual({ ...identity, subject: 'New name', description: 'Full instructions\nSecond line', blockedBy: ['dependency'] })
  expect(result.blockedBy).not.toBe(input.blockedBy)
})

it.each(['stale-revision', 'workflow-owned', 'active-execution', 'invalid-edit'] as const)('exposes only terminal refusal metadata (%s)', (reason) => {
  const command = teamTaskUpdateCommandRejectionSchema.parse({ kind: 'rejected',
    input: { teamId: 'team', taskId: 'task', commandId: 'rejected', expectedRevision: 1, subject: 'Preserved original input' },
    creator: { teamId: 'team', participantId: 'human' }, observedRevision: reason === 'stale-revision' ? 2 : 1,
    rejectedAt: 20, reason, message: 'Private provider diagnostic',
  })
  const metadata = taskUpdateRejection(command)
  const error = new TeamTaskUpdateRejectedError(command)
  expect(error.rejection).toEqual(metadata)
  expect(Object.isFrozen(error.rejection)).toBe(true)
  expect(teamTaskUpdateLookupSchema.parse({ kind: 'rejected', rejection: metadata })).toEqual({ kind: 'rejected', rejection: metadata })
  expect(JSON.stringify(metadata)).not.toContain('Preserved original input')
  expect(JSON.stringify(metadata)).not.toContain('Private provider diagnostic')
  for (const patch of [{ creator: { teamId: 'foreign', participantId: 'human' } },
    { input: { ...command.input, subject: ' Unnormalized ' } }, { observedRevision: reason === 'stale-revision' ? 1 : 2 }]) {
    expect(teamTaskUpdateCommandRejectionSchema.safeParse({ ...command, ...patch }).success).toBe(false)
  }
})

it('exposes exact admission metadata and refuses malformed receipt, result and lookup envelopes', () => {
  const receipt = teamTaskUpdateCommandReceiptSchema.parse({ kind: 'applied',
    input: { teamId: 'team', taskId: 'task', commandId: 'update', expectedRevision: 1, subject: 'New name' },
    creator: { teamId: 'team', participantId: 'human' }, appliedRevision: 2, appliedAt: 20,
  })
  const metadata = taskUpdateReceipt(receipt)
  expect(metadata).toEqual({ teamId: 'team', taskId: 'task', commandId: 'update', expectedRevision: 1, appliedRevision: 2, appliedAt: 20 })
  expect(teamTaskUpdateReceiptSchema.safeParse({ ...metadata, appliedRevision: 3 }).success).toBe(false)
  for (const input of [{ ...receipt, creator: { ...receipt.creator, teamId: 'foreign' } },
    { ...receipt, input: { ...receipt.input, subject: ' Unnormalized ' } },
    { ...receipt, input: { ...receipt.input, description: ' Unnormalized ' } },
    { ...receipt, appliedRevision: 3 }]) {
    expect(teamTaskUpdateCommandReceiptSchema.safeParse(input).success).toBe(false)
  }
  expect(teamTaskUpdateLookupSchema.parse({ kind: 'not-found', teamId: 'team', taskId: 'task', commandId: 'update' }))
    .toEqual({ kind: 'not-found', teamId: 'team', taskId: 'task', commandId: 'update' })
  expect(teamTaskUpdateLookupSchema.parse({ kind: 'applied', receipt: metadata })).toEqual({ kind: 'applied', receipt: metadata })
  expect(teamTaskUpdateLookupSchema.safeParse({ kind: 'not-found', receipt: metadata }).success).toBe(false)
  expect(teamTaskDetailsUpdateResultSchema.safeParse({ receipt: metadata, task: {} }).success).toBe(false)
})
