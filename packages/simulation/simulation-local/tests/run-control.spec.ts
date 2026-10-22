/** Durable stop facts constrain direct scheduler replay and survive complete owner replacement. */
import { expect, it } from 'vitest'
import { simulationRunControlCommandSchema, simulationDecisionIdSchema, simTimeSchema, simulationWakeRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimTime } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { foldSchedulerRecord } from '../src/scheduler.ts'

function command(id: string, boundary = '5', mode: 'at-boundary' | 'drain-admitted' = 'at-boundary') {
  return simulationRunControlCommandSchema.parse({ commandId: id, target: { targetId: id, clock: { kind: 'native' },
    boundary, mode, checkpointPolicy: 'request', drainBudget: { maxSteps: 10, maxTokens: 1000, maxWallTimeMs: 10000 } } })
}
for (const backend of ['json', 'sqlite'] as const) {
  it(`${backend}: stops exactly at its durable Native target, preserves commands and requires explicit clearing before restart`, async () => {
    const h = await createBusinessHarness(backend)
    let recovered: typeof h.run | undefined
    try {
      const actor = await h.actor('stopped-actor'), request = command('stop-five')
      const future = simulationWakeRequestSchema.parse({ id: 'retained-future', entityId: actor.id, time: '9', reason: 'Existing future responsibility' })
      await h.run.scheduleWake(future, h.run.snapshot().revision)
      const receipt = await h.run.updateRunControl(request, h.run.snapshot().revision)
      expect(receipt.activation).toBe('effective')
      const original = h.run.snapshot()
      expect(await h.run.updateRunControl(request, 0)).toEqual(receipt)
      expect(h.run.snapshot()).toEqual(original)
      await expect(h.run.updateRunControl({ ...request, target: { ...request.target!, boundary: simTimeSchema.parse('6') } }, original.revision))
        .rejects.toThrow(/identity changed/)
      expect(() => foldSchedulerRecord(original, { kind: 'clock/advanced', time: simTimeSchema.parse('6') }, original.revision + 1))
        .toThrow(/stop target/)
      await h.run.drive({ until: simTimeSchema.parse('10') })
      const reached = h.run.snapshot()
      expect(reached.time).toBe('5')
      expect(reached.phase).toBe('paused')
      expect(reached.runControl?.current).toMatchObject({ state: 'paused', reason: 'target-reached', checkpoint: 'pending',
        cut: { nativeTime: '5', clockValue: '5' } })
      await expect(h.run.setPhase('running', reached.revision)).rejects.toThrow(/stop target/)
      await expect(h.run.scheduleWake({ ...future, id: 'new-future' as typeof future.id }, reached.revision)).rejects.toThrow(/stop target/)
      expect(await h.run.scheduleWake(future, 0)).toEqual(reached)
      expect(reached.scheduledEvents[future.id]?.status).toBe('pending')
      await expect(actor.lease.openDecision(simulationDecisionIdSchema.parse('bypass'), reached.revision)).rejects.toThrow(/stop target/)
      await actor.lease.revoke(); await actor.lease.release(); h.leases.splice(0)
      await h.run.close()
      recovered = await h.provider.open({ ...h.selection, mode: 'open' })
      expect(recovered.snapshot().runControl).toEqual(reached.runControl)
      await expect(recovered.setPhase('running', recovered.snapshot().revision)).rejects.toThrow(/stop target/)
      await recovered.updateRunControl({ commandId: 'clear', target: null }, recovered.snapshot().revision)
      expect(recovered.snapshot().phase).toBe('paused')
      await recovered.setPhase('running', recovered.snapshot().revision)
      await recovered.drive({ until: simTimeSchema.parse('6') })
      expect(recovered.snapshot().time).toBe('6')
    } finally { await recovered?.close(); await h.close() }
  })
  it(`${backend}: rejects earlier targets, records immediate equality and treats an empty drain as paused`, async () => {
    const h = await createBusinessHarness(backend)
    try {
      await h.run.drive({ until: simTimeSchema.parse('3') })
      await expect(h.run.updateRunControl(command('past', '2'), h.run.snapshot().revision)).rejects.toThrow(/earlier than/)
      expect(h.run.snapshot().runControl).toBeUndefined()
      await h.run.updateRunControl(command('equal', '3', 'drain-admitted'), h.run.snapshot().revision)
      expect(h.run.snapshot().runControl?.current).toMatchObject({ state: 'paused', cut: { clockValue: '3' } })
      expect(h.run.snapshot().phase).toBe('paused')
    } finally { await h.close() }
  })
}

it('checks exact domain-clock effects, holds activation pending across unknown execution, and never rewinds confirmed time', async () => {
  const { z } = await import('zod')
  const { SimulationWorldDomainRegistry, simulationWorldDomainPinSchema, simulationWorldDomainRequestSchema }
    = await import('@clocky/clocky-simulation')
  const { NativeWorldRuntime } = await import('../src/world-runtime.ts')
  const { foldRunControl, assertRunControlRequest } = await import('../src/run-control.ts')
  const h = await createBusinessHarness('json')
  const pin = simulationWorldDomainPinSchema.parse({ domain: 'clock', operation: 'advance', version: '1',
    schemaRef: 'clock/schema/1', implementationRef: 'clock/implementation/1', generation: 1 })
  const schemas = { request: z.strictObject({ day: z.number().int().min(0) }), plan: z.strictObject({}),
    result: z.strictObject({}), mutation: z.strictObject({}) }
  const registry = new SimulationWorldDomainRegistry<import('@clocky/clocky-simulation').NativeWorldDomain>()
  const implementation = { ref: pin.implementationRef, generation: 1, definition: { ...pin, schemas },
    stopClock: { name: 'day', nativeBoundary: (_state: SimulationSnapshot, boundary: SimTime) => boundary,
      observe: () => ({ value: simTimeSchema.parse('11'), revision: 0 }),
      effect: (_state: unknown, request: unknown) => simTimeSchema.parse(String(schemas.request.parse(
        simulationWorldDomainRequestSchema.parse(request).payload).day)) } }
  // Only the pure clock contract is consumed; no domain execution/reducer capability is called by these tests.
  registry.register(implementation.definition, implementation as unknown as import('@clocky/clocky-simulation').NativeWorldDomain)
  const runtime = new NativeWorldRuntime(registry)
  try {
    const base = {
      ...h.run.snapshot(), world: { definition: { operations: [pin] }, executions: {}, requests: {} },
    } as unknown as ReturnType<typeof h.run.snapshot>
    const target = { ...command('day12', '12').target!, clock: { kind: 'domain' as const, pin, name: 'day' } }
    const change = { kind: 'control/update' as const, command: { commandId: 'day12', target }, recordedAt: 10 }
    const state = foldRunControl(base, change, base.revision + 1, runtime)
    const request = (day: number) => simulationWorldDomainRequestSchema.parse({ kind: 'world/request', domain: 'clock', operation: 'advance',
      version: '1', businessKey: 'one', evidence: [], expectedTime: null, payload: { day } })
    expect(() => { assertRunControlRequest(state, request(13), runtime) }).toThrow(/exceeds/)
    expect(() => { assertRunControlRequest(state, request(12), runtime) }).not.toThrow()
    const pendingBase = { ...base, world: { ...base.world!, executions: { unknown: { phase: 'outcome-unknown' } } } } as unknown as typeof base
    const pending = foldRunControl(pendingBase, change, base.revision + 1, runtime)
    expect(pending.runControl?.current.activation).toBe('pending')
    expect(pending.phase).toBe('paused')
    expect(() => { assertRunControlRequest(pending, request(12), runtime) }).toThrow(/reconciliation/)
    const reconciled = foldRunControl({ ...pending, world: base.world! }, { kind: 'control/refresh', recordedAt: 11 }, base.revision + 2, runtime)
    expect(reconciled.runControl?.current.activation).toBe('effective')
    expect(reconciled.phase).toBe('paused')
    expect(() => foldRunControl(base, { ...change, command: { ...change.command,
      target: { ...target, boundary: simTimeSchema.parse('10') } } }, base.revision + 1, runtime)).toThrow(/earlier than/)
  } finally { runtime.close(); await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s drains only its frozen accepted operation then pauses with business facts preserved', async (backend) => {
  const h = await createBusinessHarness(backend)
  try {
    const actor = await h.actor('drainer')
    await h.account('source', actor.id, '2')
    await h.account('destination', actor.id, '0')
    const accepted = await h.submit(actor.lease, 'admitted-before-cut', [{ after: [], action: { kind: 'resource/transfer', grants: [],
      transaction: { commitmentId: null, reads: [{ resourceId: 'source', revision: 1 }, { resourceId: 'destination', revision: 1 }],
        transfers: [{ from: 'source', to: 'destination', quantity: '1' }] } } }])
    await h.run.updateRunControl(command('drain-at-zero', '0', 'drain-admitted'), h.run.snapshot().revision)
    expect(h.run.snapshot().runControl?.current).toMatchObject({ state: 'draining', cut: { operationIds: accepted.operationIds } })
    await expect(actor.lease.openDecision(simulationDecisionIdSchema.parse('new-business'), h.run.snapshot().revision)).rejects.toThrow(/stop target/)
    const operation = accepted.operationIds[0]!
    expect(await h.run.executeOperation(operation)).toMatchObject({ status: 'applied' })
    expect(h.run.snapshot().resources['source' as never]?.quantity).toBe('1')
    expect(h.run.snapshot().resources['destination' as never]?.quantity).toBe('1')
    expect(h.run.snapshot().phase).toBe('paused')
    expect(h.run.snapshot().runControl?.current.state).toBe('paused')
    expect(await h.run.executeOperation(operation)).toMatchObject({ status: 'applied' })
  } finally { await h.close() }
})

it('freezes Native stopping facts with command provenance and preserves already prepared views after a control update', async () => {
  const { contextRequest } = await import('./context-fixture.ts')
  const h = await createBusinessHarness('sqlite')
  try {
    const actor = await h.actor('context-reader')
    const receipt = await h.run.updateRunControl(command('context-stop', '12'), h.run.snapshot().revision)
    const id = simulationDecisionIdSchema.parse('read-stop')
    await actor.lease.openDecision(id, h.run.snapshot().revision)
    const prepared = await actor.lease.prepareContext(id, contextRequest())
    if (prepared.status !== 'prepared') throw new Error('context overflow')
    const blocks = prepared.view.content.find(section => section.kind === 'authority')!.blocks
    const fact = blocks.find(block => JSON.stringify(block).includes('simulation-stopping'))
    expect(fact).toBeDefined()
    expect(JSON.stringify(fact)).toContain('context-stop')
    expect(prepared.view.sources).toContainEqual({ kind: 'run-event', runId: h.run.snapshot().spec.runId, sequence: receipt.revision })
    await h.run.updateRunControl({ commandId: 'context-clear', target: null }, h.run.snapshot().revision)
    expect(await actor.lease.readPreparedContext(id)).toEqual(prepared)
    await actor.lease.cancelDecision(id)
    const freshId = simulationDecisionIdSchema.parse('read-cleared-stop')
    await actor.lease.openDecision(freshId, h.run.snapshot().revision)
    const fake = contextRequest()
    fake.sections.find(section => section.kind === 'authority')!.blocks.push(fact!)
    await expect(actor.lease.prepareContext(freshId, fake)).rejects.toThrow(/reserved/)
    const fresh = await actor.lease.prepareContext(freshId, contextRequest())
    expect(JSON.stringify(fresh)).toContain('cleared the previous stop target')
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s records checkpoint success only from a verified cut and rejects callbacks from an older stopping command', async (backend) => {
  const { simulationCheckpointRequestSchema, simulationCheckpointManifestSchema, checkpointState } = await import('@clocky/clocky-simulation')
  const h = await createBusinessHarness(backend)
  let cut: Awaited<ReturnType<typeof h.run.acquireCheckpointCut>> | undefined
  try {
    await h.run.updateRunControl(command('save-stop', '0'), h.run.snapshot().revision)
    await expect(h.run.recordRunControlCheckpoint('save-stop', 'save-cut', 'completed')).rejects.toThrow(/verified Native cut/)
    const request = simulationCheckpointRequestSchema.parse({ id: 'save-cut', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
    await h.run.beginCheckpoint(request)
    cut = await h.run.acquireCheckpointCut(4)
    const snapshot = cut.snapshot
    const manifest = simulationCheckpointManifestSchema.parse({ version: 8, id: request.id,
      implementationVersion: request.implementationVersion,
      rulesVersion: snapshot.spec.rulesVersion, policyVersion: snapshot.spec.policyVersion, rng: { kind: 'none' }, run: cut.reference,
      team: { owner: { kind: 'team', teamId: 'company' }, stream: { name: 'team/company', version: 35 }, cursor: 0,
        firstSequence: 0, retention: 'full', projectionVersion: 35, fingerprint: `sha256:${'0'.repeat(64)}` },
      channels: [], sessions: [], state: checkpointState(snapshot) })
    await cut.publish(manifest)
    cut.release(); cut = undefined
    const completed = await h.run.recordRunControlCheckpoint('save-stop', 'save-cut', 'completed')
    expect(completed).toMatchObject({ state: 'paused', checkpoint: 'completed', checkpointId: 'save-cut' })
    const revision = h.run.snapshot().revision
    expect(await h.run.recordRunControlCheckpoint('save-stop', 'save-cut', 'completed')).toEqual(completed)
    expect(h.run.snapshot().revision).toBe(revision)
    await h.run.updateRunControl(command('new-save-stop', '0'), revision)
    const current = h.run.snapshot().runControl
    await expect(h.run.recordRunControlCheckpoint('save-stop', 'save-cut', 'completed')).rejects.toThrow(/original paused stopping command/)
    expect(h.run.snapshot().runControl).toEqual(current)
    const failedRequest = { ...request, id: 'failed-save' as typeof request.id }
    await h.run.beginCheckpoint(failedRequest)
    await h.run.failCheckpoint(failedRequest.id, 'fixture storage failure')
    expect(await h.run.recordRunControlCheckpoint('new-save-stop', failedRequest.id, 'failed')).toMatchObject({ state: 'paused', checkpoint: 'failed' })
    const originalCut = h.run.snapshot().runControl?.current.cut
    const retryRequest = simulationCheckpointRequestSchema.parse({ ...request, id: 'physical-save-retry' })
    const retry = await h.run.retryRunControlCheckpoint('new-save-stop', failedRequest.id, retryRequest.id)
    expect(retry).toMatchObject({ checkpoint: 'pending', checkpointId: retryRequest.id,
      checkpointAttempts: [failedRequest.id, retryRequest.id], cut: originalCut })
    expect(await h.run.retryRunControlCheckpoint('new-save-stop', failedRequest.id, retryRequest.id)).toEqual(retry)
    await h.run.beginCheckpoint(retryRequest)
    cut = await h.run.acquireCheckpointCut(4)
    await cut.publish(simulationCheckpointManifestSchema.parse({ ...manifest, id: retryRequest.id,
      run: cut.reference, state: checkpointState(cut.snapshot) }))
    cut.release(); cut = undefined
    expect(await h.run.recordRunControlCheckpoint('new-save-stop', retryRequest.id, 'completed')).toMatchObject({ checkpoint: 'completed',
      checkpointAttempts: [failedRequest.id, retryRequest.id], cut: originalCut })
    expect(h.run.snapshot().checkpoints?.[failedRequest.id]?.status).toBe('failed')
    await expect(h.run.recordRunControlCheckpoint('new-save-stop', failedRequest.id, 'failed')).rejects.toThrow(/save identity/)

  } finally { cut?.release(); await h.close() }
})

it('refuses new business from an already open draining decision and permits its explicit empty completion', async () => {
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const h = await createBusinessHarness('sqlite')
  try {
    const actor = await h.actor('old-open-decision')
    await h.account('old-source', actor.id, '1')
    await h.account('old-destination', actor.id, '0')
    const id = simulationDecisionIdSchema.parse('open-before-target')
    await actor.lease.openDecision(id, h.run.snapshot().revision)
    await h.run.updateRunControl(command('freeze-open', '0', 'drain-admitted'), h.run.snapshot().revision)
    const proposal = simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [],
      transaction: { commitmentId: null, reads: [{ resourceId: 'old-source', revision: 1 }, { resourceId: 'old-destination', revision: 1 }],
        transfers: [{ from: 'old-source', to: 'old-destination', quantity: '1' }] } } })
    const before = h.run.snapshot()
    await expect(actor.lease.submitDecision(id, [proposal])).rejects.toThrow(/only original case resolution/)
    expect(h.run.snapshot()).toEqual(before)
    expect((await actor.lease.submitDecision(id, [])).status).toBe('accepted')
    expect(h.run.snapshot().phase).toBe('paused')
    expect(h.run.snapshot().resources['old-source' as never]?.quantity).toBe('1')
  } finally { await h.close() }
})

it('reserves a final clear command when stopping-command history reaches its frozen allowance', async () => {
  const { foldRunControl, assertRunControlProjection } = await import('../src/run-control.ts')
  const h = await createBusinessHarness('json')
  try {
    const base = { ...h.run.snapshot(), spec: { ...h.run.snapshot().spec, maxQueuedDecisions: 1 } }
    const first = { ...foldRunControl(base, { kind: 'control/update', command: command('only-target'), recordedAt: 1 }, base.revision + 1),
      revision: base.revision + 1 }
    expect(() => foldRunControl(first, { kind: 'control/update', command: command('second-target'), recordedAt: 2 }, first.revision + 1))
      .toThrow(/allowance exhausted/)
    const cleared = { ...foldRunControl(first, { kind: 'control/update', command: { commandId: 'final-clear', target: null },
      recordedAt: 2 }, first.revision + 1), revision: first.revision + 1 }
    expect(cleared.runControl?.current.state).toBe('cleared')
    expect(Object.keys(cleared.runControl!.commands)).toHaveLength(2)
    expect(() => { assertRunControlProjection(cleared) }).not.toThrow()
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s cold-replays the logical save retry identity before a new physical checkpoint starts', async (backend) => {
  const { simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const h = await createBusinessHarness(backend)
  let cold: typeof h.run | undefined
  try {
    await h.run.updateRunControl(command('cold-save-retry', '0'), h.run.snapshot().revision)
    const first = simulationCheckpointRequestSchema.parse({ id: 'first-save', implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
    await h.run.beginCheckpoint(first)
    await h.run.failCheckpoint(first.id, 'Original physical checkpoint failed')
    await h.run.recordRunControlCheckpoint('cold-save-retry', first.id, 'failed')
    const pending = await h.run.retryRunControlCheckpoint('cold-save-retry', first.id, 'pending-second-save')
    await h.run.close()
    cold = await h.provider.open({ ...h.selection, mode: 'open' })
    expect(cold.snapshot().phase).toBe('paused')
    expect(cold.snapshot().runControl?.current).toEqual(pending)
    expect(cold.snapshot().checkpoints?.[first.id]?.status).toBe('failed')
    expect(cold.snapshot().checkpoints?.['pending-second-save' as never]).toBeUndefined()
    await expect(cold.recordRunControlCheckpoint('cold-save-retry', first.id, 'failed')).rejects.toThrow(/save identity/)
    await cold.beginCheckpoint(simulationCheckpointRequestSchema.parse({ ...first, id: pending.checkpointId }))
    expect(cold.snapshot().runControl?.current.checkpointAttempts).toEqual([first.id, 'pending-second-save'])
  } finally { await cold?.close(); await h.close() }
})
