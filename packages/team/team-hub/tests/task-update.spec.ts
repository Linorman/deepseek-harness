/** Original task-update identity survives later edits and durable checkpoint recovery. */
import { expect, it, vi } from 'vitest'
import type { Context } from '@clocky/cordis'
import { TeamTaskUpdateRejectedError } from '@clocky/clocky-team'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema, teamTaskDetailsUpdateInputSchema } from '@clocky/clocky-team'
import type { TeamHumanActorProof, TeamHumanActorScope, TeamTaskDetailsUpdateInput } from '@clocky/clocky-team'
import { recover, checkpointFor } from './durable-replay-fixtures.ts'
import { createdTeam, teamPhase, participant, participantChanged, task, taskChanged, teamId } from './fixtures.ts'
import { taskCreatorActivationId, taskCreatorId, taskCreatorSessionId } from './fixtures.ts'
import { teamProjectionFromData } from '../src/fold.ts'
import { teamProjectionDataSchema } from '../src/schema.ts'

/** Current-controller proof lifetime mirrors the native source without persisting authority objects. */
function humanUpdates(ctx: Context, humanId: import('@clocky/clocky-team').ParticipantId) {
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  const release = ctx.teams.registerHumanActorProofSource({ name: 'update-owner', resolveHumanActorProof: actor => scopes.get(actor) })
  const update = async (raw: object) => {
    const input = teamTaskDetailsUpdateInputSchema.parse(raw)
    const actor = Object.freeze({}) as TeamHumanActorProof
    const bound = { teamId, operation: 'task-mutate' as const, fence: { kind: 'revision' as const, revision: input.expectedRevision },
      payload: jsonObjectSchema.parse(input) }
    scopes.set(actor, { teamId, participantId: humanId, operation: bound.operation, fence: bound.fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
    try { return await ctx.teams.updateTaskDetails({ ...input, actor }) }
    finally { scopes.delete(actor) }
  }
  return { update, release }
}

/** Authenticated human and two tasks provide a real dependency-cycle candidate. */
async function humanFixture(backend: 'json' | 'sqlite', config: import('../src/index.ts').Config = {}) {
  const human = participant({ id: 'update-human', kind: 'human', role: 'human', phase: 'active',
    owner: { kind: 'product-principal', principalId: 'update-principal' }, authorityGrant: {
      operations: ['task-mutate'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {},
    } })
  const original = task({ id: 'update-task', createdAt: 20, createCommand: {
    creator: { teamId, participantId: human.id }, idempotencyKey: 'original-task',
  } })
  const dependent = task({ ...original, id: 'update-dependent', createdAt: 21, blockedBy: [original.id],
    createCommand: { ...original.createCommand, idempotencyKey: 'dependent-task' } })
  const records = [createdTeam(), teamPhase(), ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
    participantChanged({ participant: { ...human, phase }, createdAt: 12 + index })),
  taskChanged({ task: original, createdAt: 20 }), taskChanged({ task: dependent, createdAt: 21 })]
  const ctx = await recover(backend, records, undefined, teamId, [], records.length - 1, [], config)
  return { ctx, original, dependent, human, ...humanUpdates(ctx, human.id) }
}

it.each(['json', 'sqlite'] as const)('retains atomic update receipts, refuses identity conflicts and recovers original metadata (%s)', async (backend) => {
  const { ctx, original, update, release } = await humanFixture(backend, { maxTaskUpdateCommandsPerTeam: 2, maxSelectionBytes: 1024 })
  const input = { teamId, taskId: original.id, commandId: 'update-first', expectedRevision: 1, subject: 'Updated title' }
  const first = await update(input)
  expect(first.task.revision).toBe(2)
  expect(first.receipt).toMatchObject({ commandId: input.commandId, expectedRevision: 1, appliedRevision: 2 })
  const afterFirst = await ctx.teams.getTeam({ teamId })
  expect(await update(input)).toEqual(first)
  expect(await ctx.teams.getTeam({ teamId })).toEqual(afterFirst)
  await expect(update({ ...input, subject: 'Different payload' })).rejects.toMatchObject({ code: 'TEAM_TASK_UPDATE_COMMAND_CONFLICT' })
  await expect(update({ ...input, commandId: 'oversized', expectedRevision: 2, description: '😀'.repeat(500) }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  await update({ ...input, commandId: 'update-second', expectedRevision: 2, subject: 'Later title' })
  await expect(update({ ...input, commandId: 'over-capacity', expectedRevision: 3 }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  const retry = await update(input)
  expect(retry.receipt).toEqual(first.receipt)
  expect(retry.task).toMatchObject({ revision: 3, subject: 'Later title' })
  const lookup = { teamId, taskId: original.id, commandId: input.commandId as TeamTaskDetailsUpdateInput['commandId'] }
  expect(await ctx.teams.getTaskUpdateResult(lookup)).toEqual({ kind: 'applied', receipt: first.receipt })
  expect(await ctx.teams.getTaskUpdateResult({ ...lookup, commandId: 'missing' as never })).toEqual({ kind: 'not-found', ...lookup, commandId: 'missing' })
  expect(await ctx.teams.getTaskUpdateResult({ ...lookup, taskId: 'foreign-task' as never }))
    .toEqual({ kind: 'not-found', ...lookup, taskId: 'foreign-task' })
  await expect(ctx.teams.getTaskUpdateResult({ ...lookup, commandId: 'large'.repeat(500) as never }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  const journal = ctx.storageLog.get(`team/${teamId}`)
  if (journal === undefined) throw new Error('Update journal fixture was not retained')
  const rows = await journal.read(-1, 128)
  const recorded = rows.map(row => row.value)
  const updates = recorded.filter(row => (row as { detailsCommand?: unknown }).detailsCommand !== undefined)
  expect(updates).toHaveLength(2)
  const checkpoint = checkpointFor(recorded)
  expect(checkpoint.taskUpdateCommands).toHaveLength(2)
  const reader = await recover(backend, recorded, checkpoint)
  expect(await reader.teams.getTaskUpdateResult(lookup)).toEqual({ kind: 'applied', receipt: first.receipt })
  expect((await reader.teams.getTask({ teamId, taskId: original.id })).subject).toBe('Later title')
  release()
})

it.each(['json', 'sqlite'] as const)('retains terminal graph/stale refusals without task changes, including checkpoint recovery (%s)', async (backend) => {
  const { ctx, original, dependent, human, update, release } = await humanFixture(backend)
  const input = { teamId, taskId: original.id, commandId: 'rejected-cycle', expectedRevision: 1, blockedBy: [dependent.id] }
  const before = await ctx.teams.getTask({ teamId, taskId: original.id })
  await expect(update(input)).rejects.toBeInstanceOf(TeamTaskUpdateRejectedError)
  expect(await ctx.teams.getTask({ teamId, taskId: original.id })).toEqual(before)
  const lookup = { teamId, taskId: original.id, commandId: input.commandId as TeamTaskDetailsUpdateInput['commandId'] }
  const refusal = await ctx.teams.getTaskUpdateResult(lookup)
  expect(refusal).toMatchObject({ kind: 'rejected', rejection: {
    ...lookup, expectedRevision: 1, observedRevision: 1, reason: 'invalid-edit',
  } })
  expect(JSON.stringify(refusal)).not.toContain('blockedBy')
  expect(JSON.stringify(refusal)).not.toContain('message')
  const refusedState = await ctx.teams.getTeam({ teamId })
  await expect(update(input)).rejects.toMatchObject({ code: 'TEAM_TASK_GRAPH_INVALID' })
  expect(await ctx.teams.getTeam({ teamId })).toEqual(refusedState)
  await update({ teamId, taskId: dependent.id, commandId: 'remove-cycle-cause', expectedRevision: 1, blockedBy: [] })
  await expect(update(input)).rejects.toMatchObject({ code: 'TEAM_TASK_GRAPH_INVALID' })
  await expect(update({ ...input, blockedBy: [] })).rejects.toMatchObject({ code: 'TEAM_TASK_UPDATE_COMMAND_CONFLICT' })
  await update({ ...input, commandId: 'new-explicit-update' })
  const stale = { ...input, commandId: 'rejected-stale', blockedBy: [] }
  await expect(update(stale)).rejects.toMatchObject({ code: 'TEAM_TASK_STALE_REVISION' })
  expect(await ctx.teams.getTaskUpdateResult({ ...lookup, commandId: stale.commandId as never }))
    .toMatchObject({ kind: 'rejected', rejection: { reason: 'stale-revision', expectedRevision: 1, observedRevision: 2 } })
  const journal = ctx.storageLog.get(`team/${teamId}`)
  if (journal === undefined) throw new Error('Refusal journal was not retained')
  const records = (await journal.read(-1, 128)).map(row => row.value)
  expect(records.filter(row => (row as { type?: string }).type === 'task/update-rejected')).toHaveLength(2)
  for (const checkpoint of [undefined, checkpointFor(records)]) {
    const reader = await recover(backend, records, checkpoint)
    expect(await reader.teams.getTaskUpdateResult(lookup)).toEqual(refusal)
    const recovered = humanUpdates(reader, human.id)
    await expect(recovered.update(input)).rejects.toMatchObject({ code: 'TEAM_TASK_GRAPH_INVALID' })
    expect((await reader.teams.getTask({ teamId, taskId: original.id })).revision).toBe(2)
    recovered.release()
  }
  release()
})

it.each(['json', 'sqlite'] as const)('withholds definitive refusal until append and preserves it after checkpoint failure (%s)', async (backend) => {
  const { ctx, original, dependent, update, release } = await humanFixture(backend, { checkpointEvery: 1 })
  await ctx.teams.getTeam({ teamId })
  const journal = ctx.storageLog.get(`team/${teamId}`)
  if (journal === undefined) throw new Error('Fault fixture requires the owning journal')
  const input = { teamId, taskId: original.id, commandId: 'refusal-write-fault', expectedRevision: 1, blockedBy: [dependent.id] }
  const lookup = { teamId, taskId: original.id, commandId: input.commandId as never }
  const append = vi.spyOn(journal, 'append').mockRejectedValueOnce(new Error('Backend append unavailable'))
  await expect(update(input)).rejects.toThrow('Backend append unavailable')
  expect(await ctx.teams.getTaskUpdateResult(lookup)).toEqual({ kind: 'not-found', ...lookup })
  append.mockRestore()
  const checkpoint = vi.spyOn(journal, 'writeCheckpoint').mockRejectedValueOnce(new Error('Checkpoint response lost'))
  await expect(update(input)).rejects.toBeInstanceOf(TeamTaskUpdateRejectedError)
  expect(checkpoint).toHaveBeenCalledTimes(1)
  expect(await ctx.teams.getTaskUpdateResult(lookup)).toMatchObject({ kind: 'rejected', rejection: { reason: 'invalid-edit' } })
  checkpoint.mockRestore()
  const cursor = (await ctx.teams.getTeam({ teamId })).team.cursor
  await expect(update(input)).rejects.toBeInstanceOf(TeamTaskUpdateRejectedError)
  expect((await ctx.teams.getTeam({ teamId })).team.cursor).toBe(cursor)
  expect((await ctx.teams.getTask({ teamId, taskId: original.id })).revision).toBe(1)
  release()
})

it('refuses invented rejection records and retains historical refusal after task advancement', () => {
  const f = receiptFixture(false)
  const input = { ...f.detailsCommand.input, commandId: 'future-revision', expectedRevision: 2 }
  const command = { kind: 'rejected', input, creator: f.detailsCommand.creator, observedRevision: 1,
    rejectedAt: 17, reason: 'stale-revision', message: `Team task '${f.original.id}' revision 2 is stale; current revision is 1` }
  const row = { type: 'task/update-rejected', command, createdAt: 17 }
  const checkpoint = checkpointFor([...f.prefix, row, { ...f.row, createdAt: 18,
    detailsCommand: { ...f.detailsCommand, appliedAt: 18 } }])
  expect(teamProjectionFromData(teamProjectionDataSchema.parse(checkpoint)).taskUpdateCommands.get(input.commandId as never))
    .toMatchObject({ kind: 'rejected', observedRevision: 1 })
  for (const invalid of [
    { ...row, command: { ...command, input: { ...input, expectedRevision: 1 }, reason: 'invalid-edit', message: 'Invented refusal' } },
    { ...row, command: { ...command, observedRevision: 3 } },
    { ...row, command: { ...command, creator: { teamId, participantId: 'missing-author' } } },
    { ...row, command: { ...command, message: 'Different diagnostic' } },
    { ...row, createdAt: 18 },
    { ...row, command: { ...command, input: { ...input, taskId: 'missing-target' } } },
  ]) expect(() => checkpointFor([...f.prefix, invalid])).toThrow()
  expect(() => checkpointFor([...f.prefix, row, { ...row, createdAt: 18, command: { ...command, rejectedAt: 18 } }]))
    .toThrow(/fresh original command/)
  expect(() => checkpointFor([...f.prefix, row, { ...f.row, createdAt: 18, detailsCommand: { ...f.detailsCommand,
    input: { ...f.detailsCommand.input, commandId: input.commandId }, appliedAt: 18 } }])).toThrow(/fresh exact task revision/)
})

/** Serialized journal and checkpoint inputs exercise receipt validation at the durable boundary. */
function receiptFixture(coordinator: boolean) {
  const member = participant({ id: taskCreatorId, kind: coordinator ? 'local-agent' : 'human', role: coordinator ? 'coordinator' : 'human' })
  const creator = coordinator ? { teamId, participantId: member.id, activationId: taskCreatorActivationId,
    sessionId: taskCreatorSessionId, provider: 'in-process' } : { teamId, participantId: member.id }
  const original = task({ createdAt: 16, createCommand: { creator, idempotencyKey: 'receipt-source' } })
  const prefix: readonly unknown[] = [createdTeam(), teamPhase(),
    ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
      participantChanged({ participant: { ...member, phase }, createdAt: 12 + index })),
    ...coordinator ? [{ type: 'activation/changed', createdAt: 15, binding: {
      activation: { id: taskCreatorActivationId, teamId, participantId: member.id, status: 'idle' },
      sessionId: taskCreatorSessionId, provider: 'in-process',
    } }] : [], taskChanged({ task: original, createdAt: 16 })]
  const input = { teamId, taskId: original.id, commandId: 'durable-update', expectedRevision: 1,
    subject: 'Updated name', description: 'Complete updated instructions', blockedBy: [] }
  const detailsCommand = { kind: 'applied' as const, input, creator, appliedRevision: 2, appliedAt: 17 }
  const updated = { ...original, revision: 2, subject: input.subject, description: input.description }
  const row = { type: 'task/changed', task: updated, detailsCommand, createdAt: 17 }
  return { prefix, row, member, original, updated, detailsCommand, checkpoint: checkpointFor([...prefix, row]) }
}

it.each([false, true])('retains exact editable updates and historical author attribution (coordinator=%s)', (coordinator) => {
  const f = receiptFixture(coordinator)
  expect(teamProjectionFromData(teamProjectionDataSchema.parse(f.checkpoint)).taskUpdateCommands.size).toBe(1)
  const command = { ...f.detailsCommand, input: { ...f.detailsCommand.input, commandId: 'partial', expectedRevision: 2,
    subject: undefined, description: undefined, blockedBy: [] }, appliedRevision: 3, appliedAt: 18 }
  const partial = checkpointFor([...f.prefix, f.row, { type: 'task/changed',
    task: { ...f.updated, revision: 3 }, detailsCommand: command, createdAt: 18 }])
  expect(partial.taskUpdateCommands).toHaveLength(2)
  const historical = { ...f.checkpoint,
    participants: f.checkpoint.participants.map(member => ({ ...member, phase: 'left' })),
    activations: f.checkpoint.activations.map(binding => ({ ...binding, activation: { ...binding.activation, status: 'offline' } })),
  }
  expect(teamProjectionFromData(teamProjectionDataSchema.parse(historical)).taskUpdateCommands.size).toBe(1)
})

it('refuses fabricated admission identity, time, author and non-editable changes in serialized journals', () => {
  const f = receiptFixture(false)
  const invalidRows = [
    { ...f.row, detailsCommand: { ...f.detailsCommand, input: { ...f.detailsCommand.input, taskId: 'foreign-task' } } },
    { ...f.row, detailsCommand: { ...f.detailsCommand, appliedAt: 18 } },
    { ...f.row, detailsCommand: { ...f.detailsCommand, input: { ...f.detailsCommand.input, expectedRevision: 2 }, appliedRevision: 3 } },
    { ...f.row, task: { ...f.updated, subject: 'Unrecorded replacement' } },
    { ...f.row, detailsCommand: { ...f.detailsCommand, creator: { teamId, participantId: 'missing-author' } } },
    { ...f.row, detailsCommand: { ...f.detailsCommand, input: { ...f.detailsCommand.input, teamId: 'foreign-team' },
      creator: { teamId: 'foreign-team', participantId: f.member.id } } },
  ]
  for (const row of invalidRows) expect(() => checkpointFor([...f.prefix, row])).toThrow()
  expect(() => checkpointFor([...f.prefix.slice(0, -1), { ...f.row, task: f.original }])).toThrow()
  expect(() => checkpointFor([...f.prefix, f.row, { ...f.row, task: { ...f.updated, revision: 3 },
    createdAt: 18, detailsCommand: { ...f.detailsCommand, input: { ...f.detailsCommand.input, expectedRevision: 2 },
      appliedRevision: 3, appliedAt: 18 } }])).toThrow(/fresh exact task revision/)
  expect(() => checkpointFor([...f.prefix, { type: 'participant/changed', createdAt: 17,
    participant: { ...f.member, phase: 'left' } }, { ...f.row, createdAt: 18,
    detailsCommand: { ...f.detailsCommand, appliedAt: 18 } }])).toThrow(/author/)
})

it.each([false, true])('refuses receipts detached from their retained Team/task/author in checkpoints (coordinator=%s)', (coordinator) => {
  const f = receiptFixture(coordinator)
  const command = f.detailsCommand
  const invalidCommands = [
    { ...command, input: { ...command.input, teamId: 'foreign-team' }, creator: { ...command.creator, teamId: 'foreign-team' } },
    { ...command, input: { ...command.input, taskId: 'missing-task' } },
    { ...command, creator: { ...command.creator, participantId: 'missing-author' } },
    { ...command, appliedRevision: 4, input: { ...command.input, expectedRevision: 3 } },
    { ...command, appliedAt: 15 }, { ...command, appliedAt: 18 },
    ...coordinator ? [
      { ...command, creator: { ...command.creator, activationId: 'missing-activation' } },
      { ...command, creator: { ...command.creator, sessionId: 'foreign-session' } },
      { ...command, creator: { ...command.creator, provider: 'foreign-provider' } },
      { ...command, creator: { teamId, participantId: f.member.id } },
    ] : [{ ...command, creator: { ...command.creator, activationId: taskCreatorActivationId,
      sessionId: taskCreatorSessionId, provider: 'in-process' } }],
  ]
  for (const value of invalidCommands) {
    expect(() => teamProjectionFromData(teamProjectionDataSchema.parse({ ...f.checkpoint, taskUpdateCommands: [value] }))).toThrow()
  }
  expect(() => teamProjectionFromData({ ...f.checkpoint, taskUpdateCommands: [...f.checkpoint.taskUpdateCommands,
    ...f.checkpoint.taskUpdateCommands] })).toThrow(/repeats a task update/)
})

it('refuses new coordinator admissions after their activation is offline', () => {
  const f = receiptFixture(true)
  const binding = f.checkpoint.activations[0]
  if (binding === undefined) throw new Error('Coordinator update fixture requires an activation')
  expect(() => checkpointFor([...f.prefix, { type: 'activation/changed', createdAt: 17,
    binding: { ...binding, activation: { ...binding.activation, status: 'offline' } } },
  { ...f.row, createdAt: 18, detailsCommand: { ...f.detailsCommand, appliedAt: 18 } }])).toThrow(/matching coordinator activation/)
})
