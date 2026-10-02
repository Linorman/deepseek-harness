/** Explicit task/interaction responsibility is accepted atomically and retained across retries. */
import { describe, expect, it } from 'vitest'
import { activationIdSchema, activationReservationIdSchema, taskAttemptIdSchema } from '@clocky/clocky-team'
import { simulationTaskExecutionRequestSchema, simulationTaskEvidenceSchema, taskInteractionExecutable } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { createTaskReceipt } from './task-evidence-fixture.ts'
import { assertTaskExecutions } from '../src/task-execution.ts'

async function fixture(backend: 'json' | 'sqlite', kind: 'explicit' | 'transfer' | 'task-completed' = 'task-completed', accept = true) {
  const h = await createBusinessHarness(backend)
  const requester = await h.actor('a'), assignee = await h.actor('b')
  await h.account('stock', assignee.id, '2'); await h.account('received', requester.id, '0')
  await h.apply(requester.lease, 'request', { kind: 'interaction/request', id: 'order', assignee: assignee.id,
    description: 'Deliver goods', replyBy: null, completeBy: null,
    fulfillment: kind === 'transfer' ? { kind, from: 'stock', to: 'received', quantity: '1' } : { kind } })
  if (accept) await h.apply(assignee.lease, 'accept', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })
  const operationId = await createTaskReceipt(h, requester.lease, 'task-order')
  const state = h.run.snapshot(), entity = state.entities[assignee.id]!, interaction = Object.values(state.interactions)[0]!
  const request = simulationTaskExecutionRequestSchema.parse({ ...entity.binding!, runId: state.spec.runId,
    operationId, attemptId: 'attempt', taskId: 'task-order', taskRevision: 1, ordinal: 1, entityId: assignee.id,
    epoch: assignee.lease.epoch, activationId: entity.writer!.activationId,
    reservationId: entity.writer!.reservationId, leaseDurationMs: 1000,
    interaction: { interactionId: interaction.id, expectedRevision: interaction.revision, execution: 'obligation',
      task: { operationId, teamId: 'company', taskId: 'task-order', revision: 1, phase: 'pending' } },
  })
  return { ...h, requester, assignee, request, interaction }
}

async function replaceAssigneeWriter(h: Awaited<ReturnType<typeof fixture>>) {
  const task = simulationTaskEvidenceSchema.parse({ ...h.request.interaction!.task, revision: 2,
    executor: { participantId: h.request.participantId, activationId: h.request.activationId,
      attemptId: h.request.attemptId, ordinal: 1, outcome: 'failed' } })
  await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task })
  await h.assignee.lease.revoke(); await h.assignee.lease.release()
  h.leases.splice(h.leases.indexOf(h.assignee.lease), 1)
  const reservationId = activationReservationIdSchema.parse('retry-reservation')
  const writer = await h.run.reserveWriter(h.assignee.id, 'local', reservationId, h.run.snapshot().revision)
  h.leases.push(writer)
  const binding = h.run.snapshot().entities[h.assignee.id]!.binding!
  await writer.activate({ ...binding, reservationId, activationId: activationIdSchema.parse('retry-activation'), provider: 'local' })
  return simulationTaskExecutionRequestSchema.parse({ ...h.request, attemptId: 'retry', ordinal: 2,
    taskRevision: 2, epoch: writer.epoch, reservationId, activationId: 'retry-activation',
    interaction: { ...h.request.interaction, task, expectedRevision: h.run.snapshot().interactions[h.interaction.id]!.revision } })
}

describe.each(['json', 'sqlite'] as const)('%s task interaction association', (backend) => {
  it.each(['explicit', 'transfer', 'task-completed'] as const)('atomically links the original %s responsibility and retains it through cold replay', async (kind) => {
    const h = await fixture(backend, kind)
    try {
      const before = h.run.snapshot()
      const execution = await h.run.reserveTaskExecution(h.request, before.revision)
      const state = h.run.snapshot()
      expect(state.revision).toBe(before.revision + 1)
      expect(execution.request.interaction).toEqual(h.request.interaction)
      expect(state.interactions[h.interaction.id]?.task).toEqual(h.request.interaction!.task)
      expect(state.interactions[h.interaction.id]?.revision).toBe(h.interaction.revision + 1)
      expect(state.commitments[h.interaction.commitmentId!]!.phase).toBe('open')
      expect(taskInteractionExecutable(state, h.request)).toBe(true)
      expect(await h.run.reserveTaskExecution(h.request, 0)).toEqual(execution)
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      h.leases.splice(0)
      await h.run.close()
      const cold = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(cold.snapshot().taskExecutions?.[h.request.attemptId]).toEqual(execution)
        expect(cold.snapshot().interactions[h.interaction.id]?.task).toEqual(h.request.interaction!.task)
        expect(await cold.reserveTaskExecution(h.request, 0)).toEqual(execution)
      } finally { await cold.close() }
    } finally { await h.close() }
  })

  it('rejects pending replies, wrong assignees and changed source facts without a partial linkage', async () => {
    const h = await fixture(backend, 'task-completed', false)
    try {
      const before = h.run.snapshot()
      await expect(h.run.reserveTaskExecution(h.request, before.revision)).rejects.toThrow(/accepted open commitment and assignee/)
      expect(h.run.snapshot()).toEqual(before)
      await h.apply(h.assignee.lease, 'accept', { kind: 'interaction/accept', id: h.interaction.id, expectedRevision: 1 })
      const state = h.run.snapshot(), interaction = state.interactions[h.interaction.id]!
      const request = { ...h.request, interaction: { ...h.request.interaction!, expectedRevision: interaction.revision } }
      const requester = state.entities[h.requester.id]!
      await expect(h.run.reserveTaskExecution({ ...request, entityId: h.requester.id, ...requester.binding!,
        activationId: requester.writer!.activationId!, reservationId: requester.writer!.reservationId,
        epoch: requester.writer!.epoch }, state.revision))
        .rejects.toThrow(/accepted open commitment and assignee/)
      for (const patch of [{ revision: 2 }, { taskId: 'another' }, { operationId: 'another' }]) {
        const changed = simulationTaskExecutionRequestSchema.parse({ ...request,
          interaction: { ...request.interaction, task: { ...request.interaction.task, ...patch } } })
        await expect(h.run.reserveTaskExecution(changed, state.revision)).rejects.toThrow(/original pending task/)
      }
      expect(h.run.snapshot()).toEqual(state)
    } finally { await h.close() }
  })

  it('preserves cancelled responsibility and rejects reassociation when a later attempt is selected', async () => {
    const h = await fixture(backend)
    try {
      await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
      const linked = h.run.snapshot().interactions[h.interaction.id]!
      await h.apply(h.requester.lease, 'cancel', { kind: 'interaction/cancel', id: linked.id,
        expectedRevision: linked.revision, reason: 'Withdraw responsibility' })
      expect(taskInteractionExecutable(h.run.snapshot(), h.request)).toBe(false)
      expect(await h.run.reserveTaskExecution(h.request, 0)).toMatchObject({ request: h.request })
      const request = await replaceAssigneeWriter(h)
      for (const interaction of [undefined, { ...request.interaction!, interactionId: 'another' }]) {
        const { interaction: _original, ...selection } = request
        const changed = simulationTaskExecutionRequestSchema.parse({ ...selection, ...interaction === undefined ? {} : { interaction } })
        await expect(h.run.reserveTaskExecution(changed, h.run.snapshot().revision)).rejects.toThrow(/original interaction association/)
      }
      await expect(h.run.reserveTaskExecution(request, h.run.snapshot().revision)).rejects.toThrow(/accepted open commitment/)
      const state = h.run.snapshot(), execution = state.taskExecutions![h.request.attemptId]!
      expect(() => { assertTaskExecutions({ ...state, interactions: {} }) }).toThrow(/retained interaction source/)
      const { interaction: _association, ...unlinked } = execution.request
      expect(() => { assertTaskExecutions({ ...state, taskExecutions: { ...state.taskExecutions,
        [taskAttemptIdSchema.parse('another')]: { ...execution, request: unlinked },
      } }) }).toThrow(/original interaction association/)
    } finally { await h.close() }
  })
})

describe.each(['json', 'sqlite'] as const)('%s associated task retries', (backend) => {
  it('preserves one interaction while retrying its physically stopped original assignee', async () => {
    const h = await fixture(backend)
    try {
      await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
      const request = await replaceAssigneeWriter(h)
      for (const executor of [
        { ...request.interaction!.task.executor!, outcome: undefined },
        { ...request.interaction!.task.executor!, participantId: 'foreign' },
      ]) {
        const changed = simulationTaskExecutionRequestSchema.parse({ ...request,
          interaction: { ...request.interaction, task: { ...request.interaction!.task, executor } } })
        await expect(h.run.reserveTaskExecution(changed, h.run.snapshot().revision)).rejects.toThrow(/original pending task/)
      }
      const execution = await h.run.reserveTaskExecution(request, h.run.snapshot().revision)
      expect(execution.request.interaction?.interactionId).toBe(h.interaction.id)
      expect(h.run.snapshot().interactions[h.interaction.id]?.task).toEqual(request.interaction!.task)
    } finally { await h.close() }
  })

  it('reserves another independent task without inheriting an existing task association', async () => {
    const h = await fixture(backend)
    try {
      await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
      const operationId = await createTaskReceipt(h, h.requester.lease, 'independent')
      const { interaction: _linked, ...original } = h.request
      const request = simulationTaskExecutionRequestSchema.parse({ ...original, operationId,
        taskId: 'independent', attemptId: 'independent-attempt' })
      expect((await h.run.reserveTaskExecution(request, h.run.snapshot().revision)).request.interaction).toBeUndefined()
      expect(Object.keys(h.run.snapshot().taskExecutions!)).toHaveLength(2)
    } finally { await h.close() }
  })
})

describe.each(['json', 'sqlite'] as const)('%s task interaction context', (backend) => {
  it.each([false, true])('records exact interaction identity with original source supplied=%s', async (supplied) => {
    const h = await fixture(backend)
    const { simulationTaskDecisionRequestSchema, simulationDecisionIdSchema } = await import('@clocky/clocky-simulation')
    const { contextRequest } = await import('./context-fixture.ts')
    const { assertContextProjection } = await import('../src/context.ts')
    try {
      const execution = await h.run.reserveTaskExecution(h.request, h.run.snapshot().revision)
      await h.run.observeTaskExecution({ attemptId: h.request.attemptId, task: simulationTaskEvidenceSchema.parse({
        ...h.request.interaction!.task, revision: 2, phase: 'assigned', executor: { participantId: h.request.participantId,
          activationId: h.request.activationId, attemptId: h.request.attemptId, ordinal: 1 },
      }) })
      const decisionId = simulationDecisionIdSchema.parse('associated-context')
      const association = await h.run.associateTaskDecision(simulationTaskDecisionRequestSchema.parse({ attemptId: h.request.attemptId,
        decisionId, predecessor: null, reason: 'Perform this order',
        task: { revision: 2, subject: 'Prepare goods', description: 'Fulfill the accepted order' } }))
      await h.assignee.lease.openDecision(decisionId, h.run.snapshot().revision)
      const context = contextRequest()
      if (supplied) context.sources.push(
        { kind: 'run-event', runId: h.selection.spec.runId, sequence: execution.reservedSequence },
        { kind: 'run-event', runId: h.selection.spec.runId, sequence: association.sequence },
      )
      const prepared = await h.assignee.lease.prepareContext(decisionId, context)
      if (prepared.status !== 'prepared') throw new Error('Fixture requires prepared input')
      const text = prepared.view.content.find(section => section.kind === 'input')!.blocks.at(-1)!
      if (text.type !== 'text') throw new Error('Fixture requires a recorded task block')
      expect(JSON.parse(text.text)).toMatchObject({ interactionId: h.interaction.id, interactionRevision: h.interaction.revision })
      expect(prepared.view.sources.some(source => source.kind === 'run-event' && source.sequence === execution.reservedSequence)).toBe(true)
      const state = h.run.snapshot(), decision = state.decisions[decisionId]!
      expect(() => { assertContextProjection(state, { ...decision, context: { ...prepared, view: { ...prepared.view,
        sources: prepared.view.sources.filter(source => source.kind !== 'run-event' || source.sequence !== execution.reservedSequence),
      } } }) }).toThrow(/recorded source or instructions/)
    } finally { await h.close() }
  })
})
