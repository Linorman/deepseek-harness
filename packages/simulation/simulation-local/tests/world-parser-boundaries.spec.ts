/** Actual Native owners reject malformed World inputs before append on both durable backends. */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { SimulationWorldDomainError, SimulationWorldError, simulationWorldRequestOperationSchema,
  simulationWorldMutationCommitRequestSchema, simulationDecisionIdSchema } from '@clocky/clocky-simulation'
import type { SimulationWorldJsonValue } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { assertWorldProjection, createWorldIntent, worldExecutionReads, withWorldResult, worldResultIdentity } from '../src/world.ts'
import type { NativeWorldRuntime } from '../src/world-runtime.ts'

function schemaFailure(action: () => unknown): void {
  try { action() } catch (error) {
    if (!(error instanceof SimulationWorldDomainError)) throw error
    expect(error.code).toBe('SIM_WORLD_SCHEMA')
    expect(error.cause).toBeInstanceOf(z.ZodError)
    return
  }
  throw new Error('Expected the actual World boundary to reject malformed input')
}

async function schemaRejection(action: () => Promise<unknown>): Promise<void> {
  try { await action() } catch (error) {
    if (!(error instanceof SimulationWorldDomainError)) throw error
    expect(error.code).toBe('SIM_WORLD_SCHEMA')
    expect(error.cause).toBeInstanceOf(z.ZodError)
    return
  }
  throw new Error('Expected the actual World boundary to reject malformed input')
}

describe.each(['json', 'sqlite'] as const)('%s World schema boundaries', (backend) => {
  it('replays recorded resolution input without adding a schema or changing its original consumption hash', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing')
    try {
      await h.plan('original-context')
      const before = h.run.snapshot()
      const resolution = before.decisions[simulationDecisionIdSchema.parse('original-context/resolve')]!
      expect(resolution.context?.status).toBe('prepared')
      expect(JSON.stringify(resolution.context)).not.toContain('planSchema')
      const observed = await h.ctx.simulations.inspect({ provider: 'local', spec: h.selection.spec })
      expect(observed?.snapshot).toEqual(before)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })

  it('classifies public envelopes and installed request/mutation payloads without appending', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/p01-parser' })
    try {
      const plan = await h.plan('strict-boundaries'), before = h.run.snapshot()
      const request = before.world!.requests[plan.requestId]!
      const malformed = { ...request.proposal,
        payload: { ...request.proposal.payload as Record<string, SimulationWorldJsonValue>, invented: true } }
      schemaFailure(() => h.run.openWorldIntent(h.requester, { ...request.proposal, evidence: [{ kind: 'unknown' }] } as never))
      await schemaRejection(() => h.run.openWorldIntent(h.requester, malformed))
      schemaFailure(() => h.run.commitWorldMutation({ planId: plan.id, payload: {}, requester: 'invented' } as never))
      await schemaRejection(() => h.run.commitWorldMutation({ planId: plan.id, payload: {} }))
      expect(h.run.snapshot()).toEqual(before)
      expect(h.requests).toHaveLength(0)
      const runtime = Reflect.get(h.run, 'worldRuntime') as NativeWorldRuntime
      schemaFailure(() => createWorldIntent(before, h.requester, malformed, plan.pin, before.revision + 1, runtime))
      expect(h.run.snapshot()).toEqual(before)
      expect(simulationWorldRequestOperationSchema.parse(request.proposal)).toEqual(request.proposal)
      expect(simulationWorldMutationCommitRequestSchema.parse({ planId: plan.id, payload: request.proposal.payload })).toBeDefined()
    } finally { await h.close() }
  })

  it('rejects malformed actual three-tool request and plan payloads with the same schema category', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/p01-parser' })
    try {
      await schemaRejection(() => h.propose(h.requester, 'malformed/request', {
        kind: 'world/request', domain: 'organization', operation: 'hire-existing', version: '1', businessKey: 'malformed',
        expectedTime: null, evidence: [], payload: {},
      }, { kind: 'goal' }))
      const denied = h.run.snapshot()
      expect(denied.world!.requests).toEqual({})
      expect(denied.world!.intents).toEqual({})
      expect(denied.world!.plans).toEqual({})
      expect(denied.world!.mutations).toEqual({})
      expect(denied.world!.results).toEqual({})
      expect(denied.decisions[simulationDecisionIdSchema.parse('malformed/request')]?.status).toBe('open')
    } finally { await h.close() }
    const p = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/p01-parser' })
    try {
      await schemaRejection(() => p.plan('malformed-plan', 'hire-existing', {
        kind: 'apply', rationale: 'Actual submitted input', payload: {},
      }))
      const denied = p.run.snapshot()
      expect(Object.keys(denied.world!.requests)).toHaveLength(1)
      expect(denied.world!.plans).toEqual({})
      expect(denied.world!.mutations).toEqual({})
      expect(denied.world!.results).toEqual({})
      expect(denied.decisions[simulationDecisionIdSchema.parse('malformed-plan/resolve')]?.status).toBe('open')
    } finally { await p.close() }
  })

  it('classifies retained intent/result payloads and generated reads while preserving owner failures', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/p01-parser' })
    try {
      const plan = await h.plan('retained-boundaries'), before = h.run.snapshot()
      const runtime = Reflect.get(h.run, 'worldRuntime') as NativeWorldRuntime
      const request = before.world!.requests[plan.requestId]!, intent = before.world!.intents[request.intentId]!
      const corrupt = { ...before, world: { ...before.world!, intents: {
        ...before.world!.intents, [intent.id]: { ...intent, payload: {} },
      } } }
      schemaFailure(() => { assertWorldProjection(corrupt, runtime) })
      schemaFailure(() => withWorldResult(before, { id: worldResultIdentity(intent.id), requestId: request.id, intentId: intent.id,
        source: { kind: 'plan', planId: plan.id }, outcome: { kind: 'committed' }, payload: { invented: true }, time: before.time,
        sequence: before.revision + 1 } as never, runtime))
      const domain = runtime.original(plan.pin)
      const badReads = vi.spyOn(domain, 'executionReads').mockReturnValue([{ kind: 'unknown' }] as never)
      try { schemaFailure(() => worldExecutionReads(before, intent, runtime)) } finally { badReads.mockRestore() }
      for (const failure of [new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Original owner refusal'),
        new Error('Original provider failure'), new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_UNAVAILABLE', 'Original pin')]) {
        const refuses = vi.spyOn(domain, 'admitRequest').mockImplementation(() => { throw failure })
        try { expect(() => createWorldIntent(before, h.requester, { ...request.proposal, businessKey: 'fresh-error-case' }, plan.pin, before.revision + 1, runtime)).toThrow(failure) }
        finally { refuses.mockRestore() }
      }
      expect(h.run.snapshot()).toEqual(before)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })
})
