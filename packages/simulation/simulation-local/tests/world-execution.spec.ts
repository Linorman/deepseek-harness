/** Original execution observations are journaled before callbacks, bound to one plan and preserved by cold replay. */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkpointWorldState, simulationCheckpointWorldSchema,
  worldPlanIdSchema, worldExecutionObservationSchema, simulationDecisionIdSchema, simulationProposalSchema } from '@clocky/clocky-simulation'
import { contextRequest } from './context-fixture.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { foldEntry } from '../src/journal.ts'
import { assertWorldExecutionProjection } from '../src/world-execution.ts'
import type { NativeWorldRuntime } from '../src/world-runtime.ts'

const output = '.local/world-completion/p12-execution'

describe.each(['json', 'sqlite'] as const)('%s original execution observation', (backend) => {
  it('retains unknown callback duty, exact CAS and idempotent observations independently of results', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: output })
    try {
      const plan = await h.plan('original-callback'), before = h.run.snapshot()
      const blocked = await h.run.recordWorldExecution({ planId: plan.id, phase: 'blocked', mode: 'execute',
        reason: 'approval-required', expectedSequence: null })
      expect(blocked).toMatchObject({ requestId: plan.requestId, pin: plan.pin, updates: 1 })
      const revision = h.run.snapshot().revision
      expect(await h.run.recordWorldExecution({ planId: plan.id, phase: 'blocked', mode: 'execute',
        reason: 'approval-required', expectedSequence: null })).toEqual(blocked)
      expect(await h.run.recordWorldExecution({ planId: plan.id, phase: 'blocked', mode: 'execute',
        reason: 'approval-required', expectedSequence: blocked.sequence })).toEqual(blocked)
      expect(h.run.snapshot().revision).toBe(revision)
      await expect(h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute',
        reason: null, expectedSequence: null })).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      const armed = await h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute',
        reason: null, expectedSequence: blocked.sequence })
      const unknown = await h.run.recordWorldExecution({ planId: plan.id, phase: 'outcome-unknown', mode: 'execute',
        reason: 'callback-unconfirmed', expectedSequence: armed.sequence })
      await expect(h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute',
        reason: null, expectedSequence: unknown.sequence })).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      const reconciling = await h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'reconcile',
        reason: null, expectedSequence: unknown.sequence })
      const settled = await h.run.recordWorldExecution({ planId: plan.id, phase: 'settled', mode: 'reconcile',
        reason: null, expectedSequence: reconciling.sequence })
      const after = h.run.snapshot()
      expect(after.world!.results).toEqual(before.world!.results)
      expect(after.world!.mutations).toEqual(before.world!.mutations)
      expect(after.world!.requests).toEqual(before.world!.requests)
      expect(after.world!.plans).toEqual(before.world!.plans)
      expect(after.world!.executions[plan.id]).toEqual(settled)
      const checkpoint = checkpointWorldState(after)!
      expect(checkpoint.records.filter(value => value.kind === 'execution')).toEqual([
        expect.objectContaining({ id: plan.id, sequence: settled.sequence }),
      ])
      expect(simulationCheckpointWorldSchema.parse(checkpoint)).toEqual(checkpoint)
      expect(h.requests).toHaveLength(0)
      await mkdir(output, { recursive: true })
      await writeFile(resolve(output, `${backend}-transitions.json`), JSON.stringify({ blocked, armed, unknown, reconciling, settled,
        checkpoint }, null, 2) + '\n')
    } finally { await h.close() }
  })

  it('cold replays armed without inventing failure or a second business effect and permits only exact reconciliation', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: output })
    try {
      const plan = await h.plan('cold-armed')
      const armed = await h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute',
        reason: null, expectedSequence: null })
      await h.connection.close()
      const original = h.run.snapshot()
      await h.run.close()
      const cold = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
      try {
        expect(cold.snapshot()).toEqual(original)
        expect(cold.snapshot().world!.executions[plan.id]).toEqual(armed)
        expect(cold.snapshot().world!.results).toEqual({})
        const reconciling = await cold.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'reconcile',
          reason: null, expectedSequence: armed.sequence })
        await cold.recordWorldExecution({ planId: plan.id, phase: 'settled', mode: 'reconcile',
          reason: null, expectedSequence: reconciling.sequence })
        expect(cold.snapshot().world!.results).toEqual({})
        expect(h.requests).toHaveLength(0)
        await writeFile(resolve(output, `${backend}-cold.json`), JSON.stringify({ original, recovered: cold.snapshot() }, null, 2) + '\n')
      } finally { await cold.close() }
    } finally { await h.close() }
  })

  it('refuses crossed references, impossible transitions and changed pins before publishing any state', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: output })
    try {
      const plan = await h.plan('guarded-callback'), before = h.run.snapshot()
      const runtime = Reflect.get(h.run, 'worldRuntime') as NativeWorldRuntime
      const request = before.world!.requests[plan.requestId]!
      const observation = worldExecutionObservationSchema.parse({ planId: plan.id, requestId: request.id,
        intentId: request.intentId, pin: plan.pin, phase: 'armed', mode: 'execute', reason: null,
        expectedSequence: null, sequence: before.revision + 1, updates: 1, time: before.time })
      const changes = [
        { requestId: 'foreign' }, { intentId: 'foreign' }, { pin: { ...plan.pin, generation: plan.pin.generation + 1 } },
        { sequence: before.revision + 2 }, { expectedSequence: 1 }, { updates: 2 }, { time: '1' },
        { phase: 'settled' }, { phase: 'outcome-unknown', reason: 'callback-unconfirmed' }, { mode: 'reconcile' },
      ]
      for (const change of changes) expect(() => foldEntry(before, { sequence: before.revision + 1,
        value: { kind: 'run/world-execution', runId: before.spec.runId, expectedRevision: before.revision,
          change: { kind: 'world/execution', observation: { ...observation, ...change } } } }, before.spec, backend, runtime)).toThrow()
      const tiny = { ...before, world: { ...before.world!, definition: { ...before.world!.definition,
        limits: { ...before.world!.definition.limits, maxBytesPerPlan: 1 },
      } } }
      let byteFailure: unknown
      try { foldEntry(tiny, { sequence: before.revision + 1,
        value: { kind: 'run/world-execution', runId: before.spec.runId, expectedRevision: before.revision,
          change: { kind: 'world/execution', observation } } }, before.spec, backend, runtime) }
      catch (error) { byteFailure = error }
      expect(byteFailure).toMatchObject({ code: 'SIM_WORLD_LIMIT', failure: { limit: 'bytes' } })
      await expect(h.run.recordWorldExecution({ planId: worldPlanIdSchema.parse('foreign'), phase: 'armed', mode: 'execute',
        reason: null, expectedSequence: null })).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      expect(h.run.snapshot()).toEqual(before)
      const accepted = await h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute',
        reason: null, expectedSequence: null })
      const withExecution = h.run.snapshot()
      expect(() => foldEntry(withExecution, { sequence: withExecution.revision + 1,
        value: { kind: 'run/world-execution', runId: before.spec.runId, expectedRevision: withExecution.revision,
          change: { kind: 'world/execution', observation: { ...accepted, sequence: withExecution.revision + 1,
            expectedSequence: accepted.sequence, updates: 2 } } } }, before.spec, backend, runtime)).toThrow()
      const corrupt = { ...withExecution, world: { ...withExecution.world!, executions: {
        ...withExecution.world!.executions, [plan.id]: { ...accepted, requestId: 'foreign' as typeof accepted.requestId },
      } } }
      expect(() => { assertWorldExecutionProjection(corrupt) }).toThrow()
      expect(h.run.snapshot()).toEqual(withExecution)
    } finally { await h.close() }
  })

  it('keeps active original funding and another pending callback from being erased or bypassed', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: output, capacity: 2 })
    try {
      const first = await h.plan('first-duty'), second = await h.plan('second-duty')
      await h.reserve(first)
      const armed = await h.run.recordWorldExecution({ planId: first.id, phase: 'armed', mode: 'execute',
        reason: null, expectedSequence: null })
      const before = h.run.snapshot()
      await expect(h.run.recordWorldExecution({ planId: first.id, phase: 'settled', mode: 'execute',
        reason: null, expectedSequence: armed.sequence })).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      await expect(h.run.recordWorldExecution({ planId: second.id, phase: 'armed', mode: 'execute',
        reason: null, expectedSequence: null })).rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT', failure: { limit: 'mutations' } })
      expect(h.run.snapshot()).toEqual(before)
      expect(Object.values(before.resourceReservations).some(value => value.phase === 'active' && value.world?.planId === first.id)).toBe(true)
    } finally { await h.close() }
  })

  it('keeps an unconfirmed old callback from creating new planning input or accepting an already prepared successor', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: output })
    try {
      const plan = await h.plan('no-unknown-replan'), source = h.run.snapshot()
      const operation = source.operations[plan.operationId]!, originalDecision = operation.decisionId
      const stagedId = simulationDecisionIdSchema.parse('prepared-before-unknown')
      const successor = { ...plan.proposal, supersedes: plan.id }
      const pauseSubmission = new Error('Test holds the actual staged input before Native submission')
      const originalRequest = h.ctx.simulationTeams.modelRequest.bind(h.ctx.simulationTeams)
      const stop = vi.spyOn(h.ctx.simulationTeams, 'modelRequest').mockImplementation(async (agent, request, signal) => {
        if (request.kind === 'submit') throw pauseSubmission
        return await originalRequest(agent, request, signal)
      })
      try {
        await expect(h.propose(h.director, stagedId, successor, { kind: 'resolve', requestId: plan.requestId }))
          .rejects.toBe(pauseSubmission)
      } finally { stop.mockRestore() }
      expect(h.run.snapshot().decisions[stagedId]?.context?.status).toBe('prepared')
      const armed = await h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute',
        reason: null, expectedSequence: null })
      const unknown = await h.run.recordWorldExecution({ planId: plan.id, phase: 'outcome-unknown', mode: 'execute',
        reason: 'callback-unconfirmed', expectedSequence: armed.sequence })
      const before = h.run.snapshot()
      const originalProposal = simulationProposalSchema.parse({ after: [], action: plan.proposal })
      expect((await h.connection.submitDecision(h.director, originalDecision, [originalProposal])).status).toBe('accepted')
      expect(h.run.snapshot()).toEqual(before)
      const agent = h.ctx.agents.get(source.entities[h.director]!.binding!.sessionId)!
      await expect(h.ctx.simulationTeams.modelRequest(agent, { kind: 'submit' }, h.lifetime.signal))
        .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      // The first submit may retain its real Session consumption; it cannot retain a successor plan or effect.
      const consumed = h.run.snapshot()
      expect(consumed.world).toEqual(before.world)
      const proposals = [simulationProposalSchema.parse({ after: [], action: successor })]
      await expect(h.connection.submitDecision(h.director, stagedId, proposals)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      expect(h.run.snapshot()).toEqual(consumed)
      await h.connection.cancelDecision(h.director, stagedId)
      const newId = simulationDecisionIdSchema.parse('new-after-unknown')
      await h.connection.openDecision(h.director, newId)
      const opened = h.run.snapshot()
      await expect(h.connection.prepareContext(h.director, newId, { ...contextRequest(),
        world: { kind: 'resolve', requestId: plan.requestId } })).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      expect(h.run.snapshot()).toEqual(opened)
      expect(h.run.snapshot().world!.requests[plan.requestId]!.plans).toEqual([plan.id])
      expect(h.run.snapshot().world!.executions[plan.id]).toEqual(unknown)
      expect(h.run.snapshot().world!.results).toEqual({})
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })

  it('reserves a full callback and one reconciliation lifecycle before consuming its finite observation allowance', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: output, operationLimit: 2, planAttempts: 1 })
    try {
      const plan = await h.plan('bounded-callback'), initial = h.run.snapshot()
      const limit = 4 * initial.spec.maxOperationsPerDecision * initial.world!.definition.limits.maxPlansPerRequest
      let prior: number | null = null
      // Readiness observations must leave four records available for the next admitted callback lifecycle.
      for (let index = 0; index < limit - 4; index++) {
        const observed = await h.run.recordWorldExecution({ planId: plan.id, phase: 'blocked', mode: 'execute',
          reason: index % 2 === 0 ? 'approval-required' : 'resource-capacity', expectedSequence: prior })
        prior = observed.sequence
      }
      const full = h.run.snapshot()
      await expect(h.run.recordWorldExecution({ planId: plan.id, phase: 'blocked', mode: 'execute',
        reason: 'authority-missing', expectedSequence: prior }))
        .rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT', failure: { limit: 'commands' } })
      expect(h.run.snapshot()).toEqual(full)
      const original = full.world!.executions[plan.id]!
      expect(await h.run.recordWorldExecution({ planId: plan.id, phase: original.phase, mode: original.mode,
        reason: original.reason, expectedSequence: null } as never)).toEqual(original)
      const armed = await h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute',
        reason: null, expectedSequence: prior })
      const unknown = await h.run.recordWorldExecution({ planId: plan.id, phase: 'outcome-unknown', mode: 'execute',
        reason: 'callback-unconfirmed', expectedSequence: armed.sequence })
      const reconciling = await h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'reconcile',
        reason: null, expectedSequence: unknown.sequence })
      const settled = await h.run.recordWorldExecution({ planId: plan.id, phase: 'settled', mode: 'reconcile',
        reason: null, expectedSequence: reconciling.sequence })
      expect(settled.updates).toBe(limit)
      await expect(h.run.recordWorldExecution({ planId: plan.id, phase: 'armed', mode: 'execute', reason: null,
        expectedSequence: settled.sequence })).rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT', failure: { limit: 'commands' } })
      expect(h.run.snapshot().world!.executions[plan.id]).toEqual(settled)
    } finally { await h.close() }
  })

  it('gives a minimum product of one all four protocol records and retains unknown if its reconciliation also fails', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: output })
    try {
      const plan = await h.plan('minimum-fold'), snapshot = h.run.snapshot()
      // This isolates quota folding over a real accepted prefix; it does not claim this reduced configuration created that prefix.
      const prefix = { ...snapshot, spec: { ...snapshot.spec, maxOperationsPerDecision: 1 },
        world: { ...snapshot.world!, definition: { ...snapshot.world!.definition,
          limits: { ...snapshot.world!.definition.limits, maxPlansPerRequest: 1 },
        } } }
      const transition = (state: typeof prefix, phase: 'armed' | 'settled' | 'outcome-unknown', mode: 'execute' | 'reconcile') => {
        const original = state.world.executions[plan.id], request = state.world.requests[plan.requestId]!
        const observation = worldExecutionObservationSchema.parse({ planId: plan.id, requestId: request.id,
          intentId: request.intentId, pin: plan.pin, phase, mode,
          reason: phase === 'outcome-unknown' ? 'callback-unconfirmed' : null, expectedSequence: original?.sequence ?? null,
          sequence: state.revision + 1, updates: (original?.updates ?? 0) + 1, time: state.time })
        const folded = foldEntry(state, { sequence: state.revision + 1, value: { kind: 'run/world-execution',
          runId: state.spec.runId, expectedRevision: state.revision, change: { kind: 'world/execution', observation } } }, state.spec, backend)
        return { ...folded, world: folded.world! }
      }
      const armed = transition(prefix, 'armed', 'execute')
      const success = transition(armed, 'settled', 'execute')
      expect(success.world.executions[plan.id]?.phase).toBe('settled')
      const unknown = transition(armed, 'outcome-unknown', 'execute')
      const reconciling = transition(unknown, 'armed', 'reconcile')
      expect(transition(reconciling, 'settled', 'reconcile').world.executions[plan.id]?.updates).toBe(4)
      const unresolved = transition(reconciling, 'outcome-unknown', 'reconcile')
      expect(() => transition(unresolved, 'armed', 'reconcile')).toThrow(expect.objectContaining({ code: 'SIM_WORLD_LIMIT' }))
      expect(unresolved.world.executions[plan.id]).toMatchObject({ phase: 'outcome-unknown', updates: 4 })
      expect(unresolved.world.results).toEqual({})
    } finally { await h.close() }
  })
})
