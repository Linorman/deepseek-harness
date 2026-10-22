import { worldRolePlanOperationId } from '@clocky/clocky-simulation'
/** A paid business outcome remains unique across technical retries, fresh decisions and cold Native replay. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationProposalSchema, simulationResourceIdSchema,
  simulationWorldDomainRequestSchema, simulationWorldHireExistingMutationPayloadSchema } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { contextRequest } from './context-fixture.ts'
import { worldContext } from '../src/world.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return (value as unknown[]).map(reorder)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]))
}
async function records(stream: LogStream) {
  const result = []; let after = -1
  while (after < stream.tailSequence) {
    const page = await stream.read(after, 128)
    if (!page.length) throw new Error('Original Native journal prefix is incomplete')
    result.push(...page); after = page.at(-1)!.sequence
  }
  return result
}

describe.each(['json', 'sqlite'] as const)('%s paid World idempotency', (backend) => {
  it.each(['goal', 'request'] as const)('%s context reuses one paid result for reordered original commands and later decisions while rejecting changed intent', async (purpose) => {
    const evidence = resolve('.local/world-completion/thread-01a1336a-idempotency/runs')
    await mkdir(evidence, { recursive: true })
    const output = await mkdtemp(resolve(evidence, `${backend}-${purpose}-`))
    const h = await hiringResourceHarness(backend, 'hire-existing', { actorRequests: 1 })
    try {
      const plan = await h.plan('paid-business'), accepted = h.run.snapshot()
      const request = accepted.world!.requests[plan.requestId]!, intent = accepted.world!.intents[request.intentId]!
      const decisionId = accepted.operations[worldRolePlanOperationId(request)]!.decisionId
      const decision = accepted.decisions[decisionId]!
      expect(request.proposal.payload).toMatchObject({ personId: h.candidate })
      await h.reserve(plan)
      if (plan.proposal.resolution.kind !== 'apply') throw new Error('Expected original hiring apply plan')
      const mutation = { planId: plan.id, payload: plan.proposal.resolution.payload }
      const result = await h.run.commitWorldMutation(mutation), committed = h.run.snapshot()
      expect(result.outcome.kind).toBe('committed')
      expect(Object.values(committed.world!.results)).toEqual([result])
      const amounts = () => ['fee-cash', 'fee-payee'].map(id => h.run.snapshot().resources[simulationResourceIdSchema.parse(id)]!.quantity)
      expect(amounts()).toEqual(['4', '6'])
      const reorderedRequest = simulationWorldDomainRequestSchema.parse(reorder(request.proposal))
      const reorderedMutation = { ...mutation, payload: simulationWorldHireExistingMutationPayloadSchema.parse(reorder(mutation.payload)) }
      const exact = [simulationProposalSchema.parse({ after: [], action: reorderedRequest })]
      expect(await h.connection.submitDecision(h.requester, decisionId, exact)).toEqual(decision)
      expect(await h.run.commitWorldMutation(reorderedMutation)).toEqual(result)
      expect(await h.run.openWorldIntent(h.requester, reorderedRequest)).toEqual(committed.world!.intents[intent.id])
      expect(h.run.snapshot()).toEqual(committed)
      const altered = { ...request.proposal, payload: { ...request.proposal.payload as object, description: 'Changed original terms' } }
      await expect(h.connection.submitDecision(h.requester, decisionId,
        [simulationProposalSchema.parse({ after: [], action: altered })])).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      await expect(h.run.openWorldIntent(h.requester, altered)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      await expect(h.run.commitWorldMutation({ ...mutation, payload: altered.payload })).rejects.toThrow()
      expect(h.run.snapshot()).toEqual(committed)
      await writeFile(resolve(output, 'committed.json'), JSON.stringify({ state: committed, result,
        journal: await records(Reflect.get(h.run, 'stream') as LogStream) }, null, 2) + '\n')

      const laterId = simulationDecisionIdSchema.parse('new-decision-same-paid-business')
      await h.propose(h.requester, laterId, reorder(request.proposal), purpose === 'goal' ? { kind: 'goal' } : { kind: 'request', intentId: intent.id })
      const later = h.run.snapshot(), originalPost = accepted.operations[request.notificationOperationId!]!
      expect(later.decisions[laterId]!.operationIds).toHaveLength(1)
      expect(later.world).toEqual(committed.world)
      expect(later.resources).toEqual(committed.resources)
      expect(later.resourceReservations).toEqual(committed.resourceReservations)
      expect(later.entities).toEqual(committed.entities)
      expect(later.relations).toEqual(committed.relations)
      expect(Object.values(later.operations).filter(value => value.action.kind === 'communication/post')).toHaveLength(1)
      expect(later.operations[originalPost.id]).toEqual(committed.operations[originalPost.id])
      if (purpose === 'request') {
        const context = later.decisions[laterId]!.context
        if (context?.status !== 'prepared') throw new Error('Expected original receipt view')
        expect(context.world).toMatchObject({ kind: 'request', intentId: intent.id, reads: [] })
        expect(context.view.sources).toContainEqual({ kind: 'run-event', runId: later.spec.runId, sequence: request.sequence })
        expect(JSON.stringify(context.view)).not.toContain('The original finite financial and personnel selection')
        const alteredState = { ...later, world: { ...later.world!, requests: { ...later.world!.requests,
          [request.id]: { ...later.world!.requests[request.id]!, payloadHash: 'sha256:' + '0'.repeat(64) } } } }
        expect(() => worldContext(alteredState, later.decisions[laterId]!, { kind: 'request', intentId: intent.id }))
          .toThrow(/receipt lost its original/)
      }
      const foreignId = simulationDecisionIdSchema.parse('foreign-original-receipt')
      await h.connection.openDecision(h.director, foreignId)
      await expect(h.connection.prepareContext(h.director, foreignId, { ...contextRequest(),
        world: { kind: 'request', intentId: intent.id } })).rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
      await h.connection.cancelDecision(h.director, foreignId)
      expect(h.run.snapshot().world).toEqual(committed.world)
      expect(h.requests).toHaveLength(0)
      await h.connection.close(); await h.run.close()
      const cold = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
      try {
        const before = cold.snapshot()
        expect(before.world).toEqual(committed.world)
        expect(before.resources).toEqual(committed.resources)
        expect(await cold.commitWorldMutation(mutation)).toEqual(result)
        expect(await cold.openWorldIntent(h.requester, reorderedRequest)).toEqual(before.world!.intents[intent.id])
        await expect(cold.commitWorldMutation({ ...mutation, payload: altered.payload })).rejects.toThrow()
        expect(cold.snapshot()).toEqual(before)
        expect(h.requests).toHaveLength(0)
        await writeFile(resolve(output, 'reopened.json'), JSON.stringify({ state: before, result,
          journal: await records(Reflect.get(cold, 'stream') as LogStream) }, null, 2) + '\n')
      } finally { await cold.close() }
    } finally { await h.close() }
  })
})
