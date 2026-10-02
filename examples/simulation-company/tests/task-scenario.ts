/** Real Team task completion recovered independently from Simulation fulfillment. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import type { SimulationRun, SimulationEntityId } from '@clocky/clocky-simulation'
import { simulationDecisionIdSchema, simulationInteractionIdSchema, simulationProposalSchema } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import { assignTestTask, seedTeamPhase } from '../../../packages/team/team-hub/tests/fixtures.ts'

/**
 * Exercise real task execution and a crash before the coordinator observes completion.
 * @param ctx - Loader-owned Team services.
 * @param run - Durable Simulation run.
 * @param connection - Canonical Team coordinator.
 * @param requester - Coordinator Entity requesting the work.
 * @param assignee - Worker Entity executing the Team task.
 * @param hold - Process-kill checkpoint hook.
 * @returns independent execution/fulfillment outcomes for the snapshot.
 */
export async function taskScenario(ctx: Context, run: SimulationRun, connection: SimulationTeamConnection,
  requester: SimulationEntityId, assignee: SimulationEntityId, hold: (stage: string) => Promise<void>) {
  const outcomes: Record<string, { task: string; commitment: string; source: { creation: string; executor: string; attempt: string } }> = {}
  for (const kind of ['explicit', 'task-completed'] as const) {
    const id = simulationInteractionIdSchema.parse(`task-${kind}`)
    const apply = async (actor: SimulationEntityId, label: string, action: unknown) => {
      const decisionId = simulationDecisionIdSchema.parse(`${id}/${label}`)
      if (run.snapshot().decisions[decisionId] !== undefined) return
      await connection.openDecision(actor, decisionId)
      const decision = await connection.submitDecision(actor, decisionId, [simulationProposalSchema.parse({ after: [], action })])
      assert.equal((await run.executeOperation(decision.operationIds[0]!)).status, 'applied')
    }
    await apply(requester, 'request', { kind: 'interaction/request', id, assignee, description: 'Prepare delivery',
      replyBy: null, completeBy: null, fulfillment: { kind } })
    await apply(assignee, 'accept', { kind: 'interaction/accept', id, expectedRevision: 1 })
    let interaction = run.snapshot().interactions[id]!
    const teamId = run.snapshot().entities[requester]!.binding!.teamId
    const team = await ctx.teams.getTeam({ teamId })
    const worker = team.activations.find(value => value.activation.id === run.snapshot().entities[assignee]!.writer!.activationId)
    assert.ok(worker)
    const issuer = ctx.teams.openActivationActorProofIssuer()
    const createId = simulationDecisionIdSchema.parse(`${id}/create`)
    let creation = run.snapshot().decisions[createId]
    if (creation === undefined) {
      await connection.openDecision(requester, createId)
      creation = await connection.submitDecision(requester, createId, [simulationProposalSchema.parse({ after: [], action: {
        kind: 'task/create', deliverAt: run.snapshot().time, task: {
          subject: 'Prepare delivery', description: 'Task completion is execution evidence', blockedBy: [], requiredCapabilities: [],
          priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 2,
        },
      } })])
    }
    const operationId = creation.operationIds[0]!
    if (run.snapshot().operations[operationId]!.outbox?.taskReceipt === undefined) {
      await run.drive({ until: run.snapshot().time })
      const create = ctx.teams.createSimulationTask.bind(ctx.teams)
      ctx.teams.createSimulationTask = async (request) => {
        const result = await create(request)
        if (kind === 'task-completed') await hold('task-created')
        return result
      }
      try {
        const result = await connection.dispatchOperation(operationId, Date.now)
        assert.equal(result.status, 'settled')
      } finally { ctx.teams.createSimulationTask = create }
    }
    const receipt = run.snapshot().operations[operationId]!.outbox!.taskReceipt!
    let task = await ctx.teams.getTask({ teamId, taskId: receipt.taskId })
    if (interaction.task === undefined) interaction = await connection.reconcileTask(id, interaction.revision, task.id)
    if (task.phase !== 'completed') {
      task = await assignTestTask(ctx, { teamId, taskId: task.id, expectedRevision: task.revision,
        participantId: worker.activation.participantId, activationId: worker.activation.id, leaseDurationMs: 60000 })
      const actor = issuer.issue(worker).proof
      task = await ctx.teams.startTaskAttempt({ actor, taskId: task.id, attemptId: task.lease!.attemptId, expectedRevision: task.revision })
      task = await ctx.teams.settleTaskAttempt({ actor, taskId: task.id, attemptId: task.lease!.attemptId,
        expectedRevision: task.revision, outcome: { kind: 'completed', result: { summary: 'Prepared delivery' } } })
    }
    if (kind === 'task-completed') await hold('task-completed')
    interaction = await connection.reconcileTask(id, interaction.revision, task.id)
    const commitment = run.snapshot().commitments[interaction.commitmentId!]!
    assert.equal(commitment.phase, kind === 'explicit' ? 'open' : 'fulfilled')
    assert.equal(interaction.task?.revision, task.revision)
    assert.equal(interaction.task.operationId, operationId)
    assert.equal(interaction.task.executor?.participantId, worker.activation.participantId)
    assert.equal(interaction.task.executor?.outcome, 'completed')
    assert.equal(interaction.task.executor?.attemptId, task.attemptHistory.at(-1)!.id)
    outcomes[kind] = { task: interaction.task.phase, commitment: commitment.phase,
      source: { creation: 'accepted', executor: 'assignee', attempt: interaction.task.executor.outcome } }
  }
  const page = await ctx.teams.listTasksPage({ teamId: run.snapshot().entities[requester]!.binding!.teamId, afterCursor: -1, limit: 10 })
  assert.equal(page.items.length, 2)
  assert.equal(page.nextCursor, undefined)
  const teamId = run.snapshot().entities[requester]!.binding!.teamId
  const decisionId = simulationDecisionIdSchema.parse('quiescing-task-admission')
  await connection.openDecision(requester, decisionId)
  const proposal = simulationProposalSchema.parse({ after: [], action: {
    kind: 'task/create', deliverAt: run.snapshot().time, task: {
      subject: 'Retain accepted responsibility', description: 'Reconcile after Team admission closes',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1,
    },
  } })
  const decision = await connection.submitDecision(requester, decisionId, [proposal, { ...proposal, after: [0] }])
  const [committed, blocked] = decision.operationIds
  assert.ok(committed && blocked)
  await run.drive({ until: run.snapshot().time })
  const create = ctx.teams.createSimulationTask.bind(ctx.teams)
  ctx.teams.createSimulationTask = async (request) => {
    await create(request)
    throw new Error('Task response lost after commit')
  }
  try {
    assert.deepEqual(await connection.dispatchOperation(committed, () => 100), { status: 'retry', nextAttemptAt: 110 })
  } finally { ctx.teams.createSimulationTask = create }
  await seedTeamPhase(ctx, teamId, 'quiescing')
  const reconciled = await connection.dispatchOperation(committed, () => 110)
  assert.equal(reconciled.status, 'settled')
  assert.equal(run.snapshot().operations[committed]!.result!.status, 'applied')
  await run.drive({ until: run.snapshot().time })
  const rejected = await connection.dispatchOperation(blocked, () => 120)
  assert.equal(rejected.status, 'settled')
  assert.equal(run.snapshot().operations[blocked]!.result!.status, 'blocked-authority')
  assert.equal(run.snapshot().operations[blocked]!.result!.code, 'TEAM_POLICY_DENIED')
  assert.equal(run.snapshot().operations[blocked]!.outbox!.taskReceipt, undefined)
  assert.equal((await ctx.teams.getTeam({ teamId })).tasks.length, 3)
  return { ...outcomes, quiescing: { reconciled: 'applied', rejected: 'blocked-authority', taskCount: 3 } }
}
