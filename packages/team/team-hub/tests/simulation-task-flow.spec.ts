/** Native Simulation task execution retains one exact startup, lease and result. */
import { expect, it } from 'vitest'
import { activationIdSchema, activationReservationIdSchema, taskAttemptIdSchema,
  teamSystemTaskControlScopeSchema } from '@clocky/clocky-team'
import type { TeamSystemActivationProof, TeamSystemActivationScope, TeamSystemTaskControlProof,
  TeamSystemTaskControlScope } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, teamId, teamPhase } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('assigns, starts and settles a native Simulation attempt under one reserved writer (%s)', async (backend) => {
  const now = Date.now() - 1000
  const runId = 'native-flow'
  const operationId = 'native-task-create'
  const lifecycleOwner = 'simulation/native-flow'
  const member = participant({ id: 'native-flow-worker', role: 'worker' })
  const original = task({ id: 'native-flow-task', createdAt: now + 6,
    createCommand: { creator: { kind: 'simulation', teamId, participantId: member.id, runId, operationId },
      idempotencyKey: JSON.stringify(['simulation-task', runId, operationId]) } })
  const rows = [createdTeam({ createdAt: now, rules: { simulationRunId: runId, activationLifecycleOwner: lifecycleOwner } }),
    teamPhase({ createdAt: now + 1 }),
    ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
      participantChanged({ participant: { ...member, phase }, createdAt: now + index + 2 })),
    taskChanged({ task: original, createdAt: now + 6 })]
  const ctx = await recover(backend, rows)
  const activationScopes = new Map<TeamSystemActivationProof, TeamSystemActivationScope>()
  ctx.teams.registerSystemActivationProofSource({ name: 'team-activation-controller',
    resolveActivationProof: proof => activationScopes.get(proof) })
  const reservationId = activationReservationIdSchema.parse('native-flow-reservation')
  const sessionId = SessionId('native-flow-session')
  const activationId = activationIdSchema.parse('native-flow-activation')
  const attemptId = taskAttemptIdSchema.parse('native-flow-attempt')
  const reservationInput = { teamId, participantId: member.id, reservationId, sessionId,
    provider: 'in-process', expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor }
  const reservationProof = Object.freeze({}) as TeamSystemActivationProof
  activationScopes.set(reservationProof, { kind: 'activation-controller-reserve', ...reservationInput })
  await ctx.teams.reserveActivation({ ...reservationInput, actor: reservationProof })
  const binding = { activation: { id: activationId, teamId, participantId: member.id, status: 'idle' as const },
    sessionId, provider: 'in-process', reservationId }
  const bindInput = { expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, binding }
  const bindProof = Object.freeze({}) as TeamSystemActivationProof
  activationScopes.set(bindProof, { kind: 'activation-controller-bind', ...bindInput })
  await ctx.teams.bindActivation({ ...bindInput, actor: bindProof })

  const taskScopes = new Map<TeamSystemTaskControlProof, TeamSystemTaskControlScope>()
  ctx.teams.registerSystemTaskControlProofSource({ name: 'simulation-team',
    resolveTaskControlProof: proof => taskScopes.get(proof) })
  const identity = { creatorId: member.id, ordinal: 1, runId, operationId,
    entityId: 'native-entity', epoch: '1', lifecycleOwner, sessionId, reservationId }
  const run = async <T>(scope: Record<string, unknown>, operation: (actor: TeamSystemTaskControlProof) => Promise<T>): Promise<T> => {
    const actor = Object.freeze({}) as TeamSystemTaskControlProof
    taskScopes.set(actor, teamSystemTaskControlScopeSchema.parse(scope))
    try { return await operation(actor) }
    finally { taskScopes.delete(actor) }
  }
  const assignInput = { teamId, taskId: original.id, expectedRevision: original.revision,
    participantId: member.id, activationId, attemptId, leaseDurationMs: 60000 }
  const assigned = await run({ kind: 'simulation-task-assign', ...identity, input: assignInput },
    actor => ctx.teams.assignSimulationTask({ ...assignInput, actor }))
  expect(assigned).toMatchObject({ phase: 'assigned', lease: { attemptId, participantId: member.id } })
  const startInput = { teamId, taskId: original.id, attemptId, expectedRevision: assigned.revision }
  const running = await run({ kind: 'simulation-task-start', ...identity,
    decisionId: 'native-decision', inputId: 'native-input', input: startInput },
  actor => ctx.teams.startSimulationTaskAttempt({ ...startInput, actor }))
  expect(running).toMatchObject({ phase: 'running', lease: { attemptId } })
  const runningInput = { ...startInput, expectedRevision: running.revision }
  expect(await run({ kind: 'simulation-task-start', ...identity,
    decisionId: 'native-decision', inputId: 'native-input', input: runningInput },
  actor => ctx.teams.startSimulationTaskAttempt({ ...runningInput, actor }))).toEqual(running)
  const settleInput = { teamId, taskId: original.id, attemptId, expectedRevision: running.revision,
    outcome: { kind: 'completed' as const, result: { summary: 'Native result retained.' } } }
  const completed = await run({ kind: 'simulation-task-settle', ...identity, input: settleInput },
    actor => ctx.teams.settleSimulationTaskAttempt({ ...settleInput, actor }))
  expect(completed).toMatchObject({ phase: 'completed', attemptHistory: [{ id: attemptId,
    outcome: settleInput.outcome }] })
  expect(await run({ kind: 'simulation-task-settle', ...identity, input: settleInput },
    actor => ctx.teams.settleSimulationTaskAttempt({ ...settleInput, actor }))).toEqual(completed)
  expect(await ctx.teams.getTask({ teamId, taskId: original.id })).toEqual(completed)
})
