import { assertWorldExecutionTimeProjection } from '../src/world-execution-time.ts'
import { writeFile, mkdir, cp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
/** Actual Native/Team owner commands: no simulated requester, Decision or Operation is fabricated. */
import { expect, it, vi } from 'vitest'
import { simulationWorldManagementActionSchema, simulationWorldManagementSubmitRequestSchema, worldManagementCommandIdSchema,
  simulationCheckpointIdSchema, simulationWorldManagementReceiptSchema, inspectWorldManagement,
  WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, simTimeSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import type { SimulationWorldManagementAction, SimulationWorldManagementAuthority } from '@clocky/clocky-simulation'
type ProductPrincipalId = import('@clocky/clocky-simulation').SimulationWorldAuthenticatedUserSource['principalId']
import { WorldExecutionDispatcher } from '../../simulation-world/src/execution.ts'
import { ExistingHireWorldExecution } from '../../simulation-world/src/hire-existing.ts'
import { PersonnelWorldExecution } from '../../simulation-world/src/personnel.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { businessFingerprint } from '../src/business.ts'

const principalId = 'authenticated-test-manager' as ProductPrincipalId
const sourceFingerprint = businessFingerprint(['actual-test-policy-cut', 1])
function authorization(action: SimulationWorldManagementAction, fundingEntity?: string) {
  let generation = 1, active = true
  const authority: SimulationWorldManagementAuthority = { resolve: () => active ? { source: { kind: 'authenticated-user', principalId,
    credentialGeneration: generation, policyRef: 'test-explicit-personnel-manager/1', policyGeneration: '1' },
  actionHash: businessFingerprint(action), sourceFingerprint, sourceComplete: true,
  funding: fundingEntity === undefined ? null : { kind: 'native-controller', entityId: simulationEntityIdSchema.parse(fundingEntity),
    policyRef: 'test-explicit-cash-delegation/1', policyGeneration: '1' } } : undefined }
  return { authority, revoke: () => { active = false }, rotate: () => { generation += 1 } }
}
function action(kind: 'transfer' | 'depart' | 'hire-existing') {
  return simulationWorldManagementActionSchema.parse({ kind, payload: kind === 'hire-existing'
    ? { personId: 'fee-candidate', organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy', description: 'Actual user hire' }
    : { personId: 'fee-candidate', organizationEntityId: 'fee-org', assignmentId: 'management-assignment', assignmentRevision: 1,
      requestedEffectiveAt: null, description: 'Actual user personnel change',
      ...kind === 'transfer' ? { targetPositionId: 'fee-vacancy' } : { retire: false } } })
}
for (const backend of ['json', 'sqlite'] as const) {
  it.each(['transfer', 'depart',
    'hire-existing'] as const)(`accepts and executes an actual user %s through original providers on ${backend}, preserving cold IDs`, async (kind) => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/u07-native',
      installedPins: [WORLD_TRANSFER_PIN, WORLD_DEPART_PIN],
      ...kind === 'hire-existing' ? {} : { candidateAssignment: 'management-old-role',
        extraEntities: [{ id: 'management-old-role', entityKind: 'position' as const }],
        additionalPositions: [{ entityId: 'management-old-role', capacity: 1 }] } })
    const registration = new Set<() => Promise<void>>()
    let failed = false
    try {
      await h.run.drive({ until: simTimeSchema.parse('2') })
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const inputAction = action(kind), auth = authorization(inputAction, kind === 'hire-existing' ? h.requester : undefined)
      const before = h.run.snapshot(), identity = before.entities[h.candidate], open = vi.spyOn(h.ctx.simulations, 'open')
      const previewInput = { action: inputAction, expectedRevision: before.revision }
      const preview = await h.ctx.simulations.previewWorldManagement({ provider: h.selection.provider,
        spec: h.selection.spec }, previewInput, auth.authority)
      expect(preview).toMatchObject({ admission: 'allowed', blockers: [] })
      expect(h.run.snapshot()).toEqual(before)
      expect(open).not.toHaveBeenCalled()
      auth.rotate()
      expect((await h.run.previewWorldManagement(previewInput, auth.authority)).previewHash).toBe(preview!.previewHash)
      const input = simulationWorldManagementSubmitRequestSchema.parse({ ...previewInput, commandId: `human:${kind}`,
        previewHash: preview!.previewHash })
      const accepted = await h.run.submitWorldManagement(input, auth.authority)
      const after = h.run.snapshot(), request = after.world!.requests[accepted.requestId]!, plan = after.world!.plans[accepted.planId]!
      expect(request).toMatchObject({ operationId: null, requesterEntityId: null, notificationOperationId: null,
        source: { kind: 'authenticated-user', commandId: input.commandId, principalId, credentialGeneration: 2 } })
      expect(plan).toMatchObject({ operationId: null, proposal: { kind: 'world/management-apply', supersedes: null } })
      expect(after.decisions).toEqual(before.decisions); expect(after.operations).toEqual(before.operations)
      if (kind === 'depart') {
        expect(after.world!.personnel.fences[accepted.intentId]).toMatchObject({ status: 'active', requestId: accepted.requestId })
        const fencedPreview = await h.run.previewWorldManagement({ action: inputAction, expectedRevision: after.revision }, auth.authority)
        expect(fencedPreview.blockers).toContain('existing-obligations')
        await expect(h.run.submitWorldManagement({ ...input, commandId: worldManagementCommandIdSchema.parse('fence-bypass'),
          expectedRevision: after.revision, previewHash: fencedPreview.previewHash }, auth.authority))
          .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
        expect(h.run.snapshot()).toEqual(after)
      }
      expect(await h.run.submitWorldManagement(input, auth.authority)).toEqual(accepted)
      await expect(h.run.submitWorldManagement({ ...input, previewHash: businessFingerprint('changed') },
        auth.authority)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      const dispatcher = new WorldExecutionDispatcher(h.run)
      const handler = kind === 'hire-existing' ? new ExistingHireWorldExecution(h.run) : new PersonnelWorldExecution(h.run, h.connection,
        { checkpointId: simulationCheckpointIdSchema.parse('original-owner-anchor'), ownerName: 'simulation/company-product',
          maxDrainRounds: 4, maxAttempts: 3 }, h.lifetime.signal, kind)
      registration.add(dispatcher.register(handler))
      expect(dispatcher.readiness(plan)).toBeUndefined()
      expect(await dispatcher.execute(plan)).toBeUndefined()
      const completed = h.run.inspectWorldManagement(input.commandId, principalId)!
      expect(completed.result?.outcome.kind).toBe('committed')
      expect(completed.execution?.phase).toBe('settled')
      expect(simulationWorldManagementReceiptSchema.parse(completed)).toEqual(completed)
      expect(inspectWorldManagement(h.run.snapshot(), input.commandId, principalId)).toEqual(completed)
      expect(h.run.snapshot().entities[h.candidate]?.binding).toEqual(identity?.binding)
      expect(h.run.snapshot().entities[h.candidate]?.profile).toEqual(identity?.profile)
      expect(h.requests).toHaveLength(0)
      const settled = h.run.snapshot()
      expect(await h.run.submitWorldManagement(input, auth.authority)).toEqual(completed)
      expect(h.run.snapshot()).toEqual(settled)
      for (const release of registration) await release()
      registration.clear()
      await h.connection.close(); const closedPrefix = h.run.snapshot(); await h.run.close()
      const cold = await h.ctx.simulations.inspect({ provider: h.selection.provider, spec: h.selection.spec })
      expect(cold?.snapshot).toEqual(closedPrefix)
      expect(inspectWorldManagement(cold!.snapshot, input.commandId, principalId)).toEqual(completed)
      expect(open).not.toHaveBeenCalled()
      const proofSeed = resolve('.local/world-completion/u07-native/cold-seeds', `${backend}-${kind}`)
      await rm(proofSeed, { recursive: true, force: true }); await mkdir(proofSeed, { recursive: true })
      await cp(resolve(h.root, 'simulation'), resolve(proofSeed, 'simulation'), { recursive: true })
      await writeFile(resolve(proofSeed, 'original.json'), JSON.stringify({ backend, kind, selection: h.selection,
        state: closedPrefix, receipt: completed }, null, 2) + '\n')
      open.mockRestore()
    } catch (error) {
      failed = true
      await writeFile(`.local/world-completion/u07-native/failed-${backend}-${kind}.json`,
        JSON.stringify({ error: String(error), state: h.run.snapshot() }, null, 2))
      throw error
    } finally {
      const releases = await Promise.allSettled([...registration].map(release => release()))
      await h.close()
      const errors = releases.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : [])
      if (!failed && errors.length) throw new AggregateError(errors, 'Execution owner cleanup retained responsibilities')
    }
  })

  it(`blocks an impossible same-start personnel boundary on ${backend} before any original or callback is armed`, async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/u07-native',
      installedPins: [WORLD_TRANSFER_PIN, WORLD_DEPART_PIN], candidateAssignment: 'management-old-role',
      extraEntities: [{ id: 'management-old-role', entityKind: 'position' }],
      additionalPositions: [{ entityId: 'management-old-role', capacity: 1 }] })
    try {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const before = h.run.snapshot()
      expect(before.time).toBe('0')
      for (const kind of ['transfer', 'depart'] as const) {
        const inputAction = action(kind), auth = authorization(inputAction)
        const preview = await h.run.previewWorldManagement({ action: inputAction, expectedRevision: before.revision }, auth.authority)
        expect(preview.admission).toBe('blocked')
        expect(preview.blockers).toContain('waiting-effective-time')
        await expect(h.run.submitWorldManagement({ action: inputAction, expectedRevision: before.revision,
          commandId: worldManagementCommandIdSchema.parse(`impossible-${kind}`), previewHash: preview.previewHash }, auth.authority))
          .rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
        expect(h.run.snapshot()).toEqual(before)
      }
      expect(h.run.snapshot().world!.requests).toEqual({})
      expect(h.run.snapshot().world!.executions).toEqual({})
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })

  it(`retains a future user execution clock without fabricating a planning operation on ${backend}`, async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/u07-native',
      installedPins: [WORLD_TRANSFER_PIN, WORLD_DEPART_PIN], candidateAssignment: 'management-old-role',
      extraEntities: [{ id: 'management-old-role', entityKind: 'position' }],
      additionalPositions: [{ entityId: 'management-old-role', capacity: 1 }] })
    try {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const inputAction = simulationWorldManagementActionSchema.parse({ kind: 'transfer',
        payload: { ...action('transfer').payload, requestedEffectiveAt: '5' } })
      const auth = authorization(inputAction), before = h.run.snapshot()
      const preview = await h.run.previewWorldManagement({ action: inputAction, expectedRevision: before.revision }, auth.authority)
      const accepted = await h.run.submitWorldManagement({ action: inputAction, expectedRevision: before.revision,
        commandId: worldManagementCommandIdSchema.parse('future-user-command'), previewHash: preview.previewHash }, auth.authority)
      const state = h.run.snapshot(), event = Object.values(state.scheduledEvents).find(value =>
        value.action.kind === 'world-execution-time' && value.action.intentId === accepted.intentId)
      if (event === undefined) throw new Error('Original user clock is absent')
      expect(event.key).toMatchObject({ time: '5', phase: 'deadline' })
      expect(event.sourceOperationId).toBeUndefined()
      expect(state.operations).toEqual(before.operations); expect(state.decisions).toEqual(before.decisions)
      expect(() => { assertWorldExecutionTimeProjection(state) }).not.toThrow()
      const corrupted = { ...state, scheduledEvents: { ...state.scheduledEvents,
        [event.id]: { ...event, key: { ...event.key, phase: 'decision' as const } } } }
      expect(() => { assertWorldExecutionTimeProjection(corrupted) }).toThrow(/clock boundary/)
      const handler = new PersonnelWorldExecution(h.run, h.connection, {
        checkpointId: simulationCheckpointIdSchema.parse('original-owner-anchor'), ownerName: 'simulation/company-product',
        maxDrainRounds: 4, maxAttempts: 3 }, h.lifetime.signal, 'transfer')
      expect(handler.readiness(state.world!.plans[accepted.planId]!)).toBe('waiting-effective-time')
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })

  it(`reconciles the same retained user funding promise after a failed callback on ${backend} without a second payment`, async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/u07-native' })
    let release: (() => Promise<void>) | undefined
    try {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const inputAction = action('hire-existing'), auth = authorization(inputAction, h.requester)
      const preview = await h.run.previewWorldManagement({ action: inputAction, expectedRevision: h.run.snapshot().revision },
        auth.authority)
      const input = simulationWorldManagementSubmitRequestSchema.parse({ commandId: 'recover-original-funding', action: inputAction,
        expectedRevision: preview.snapshotRevision, previewHash: preview.previewHash })
      const accepted = await h.run.submitWorldManagement(input, auth.authority)
      const plan = h.run.snapshot().world!.plans[accepted.planId]!
      const dispatcher = new WorldExecutionDispatcher(h.run), handler = new ExistingHireWorldExecution(h.run)
      release = dispatcher.register(handler)
      const commit = vi.spyOn(h.run, 'commitWorldMutation').mockRejectedValueOnce(new Error('Lost callback before original local commit'))
      await expect(dispatcher.execute(plan)).rejects.toThrow('Lost callback before original local commit')
      commit.mockRestore()
      const unknown = h.run.inspectWorldManagement(input.commandId, principalId)!
      expect(unknown.execution?.phase).toBe('outcome-unknown'); expect(unknown.result).toBeUndefined()
      expect(Object.values(h.run.snapshot().resourceReservations)).toHaveLength(1)
      expect(Object.values(h.run.snapshot().resourceReservations)[0]?.phase).toBe('active')
      await dispatcher.reconcile(plan)
      const completed = h.run.inspectWorldManagement(input.commandId, principalId)!
      expect(completed.result?.outcome.kind).toBe('committed'); expect(completed.execution?.phase).toBe('settled')
      expect(Object.values(h.run.snapshot().resourceReservations)).toHaveLength(1)
      expect(Object.values(h.run.snapshot().world!.mutations)).toHaveLength(1)
      expect(Object.values(h.run.snapshot().world!.results)).toHaveLength(1)
      expect(Object.values(h.run.snapshot().resources).map(value => value.quantity)).toEqual(['4', '6'])
      const beforeRetry = h.run.snapshot()
      expect(await h.run.submitWorldManagement(input, auth.authority)).toEqual(completed)
      expect(h.run.snapshot()).toEqual(beforeRetry)
      expect(h.requests).toHaveLength(0)
    } finally { await release?.(); await h.close() }
  })

  it(`rejects revoked, stale and unconfirmed user admissions on ${backend} without hiding an armed original`, async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/u07-native' })
    try {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const inputAction = action('hire-existing'), auth = authorization(inputAction, h.requester), before = h.run.snapshot()
      const preview = await h.run.previewWorldManagement({ action: inputAction, expectedRevision: before.revision }, auth.authority)
      const input = simulationWorldManagementSubmitRequestSchema.parse({ commandId: 'original', action: inputAction,
        expectedRevision: before.revision, previewHash: preview.previewHash })
      const revoked = authorization(inputAction, h.requester); revoked.revoke()
      await expect(h.run.submitWorldManagement(input, revoked.authority)).rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
      const unfunded = authorization(inputAction)
      expect((await h.run.previewWorldManagement({ action: inputAction, expectedRevision: before.revision },
        unfunded.authority)).blockers).toContain('authority-missing')
      expect(h.run.snapshot()).toEqual(before)
      let checks = 0
      const lateRevoked: SimulationWorldManagementAuthority = { resolve: () => ++checks === 5 ? undefined : auth.authority.resolve() }
      await expect(h.run.submitWorldManagement(input, lateRevoked)).rejects.toMatchObject({ code: 'SIM_WORLD_AUTHORITY' })
      expect(checks).toBe(5)
      expect(h.run.snapshot()).toEqual(before)
      const oversized = simulationWorldManagementActionSchema.parse({ ...inputAction,
        payload: { ...inputAction.payload, description: '界'.repeat(65536) } })
      await expect(h.run.previewWorldManagement({ action: oversized, expectedRevision: before.revision },
        authorization(oversized, h.requester).authority)).rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT' })
      expect(h.run.snapshot()).toEqual(before)
      const original = await h.run.submitWorldManagement(input, auth.authority)
      await h.run.recordWorldExecution({ planId: original.planId, phase: 'armed', mode: 'execute', reason: null, expectedSequence: null })
      const armed = h.run.snapshot()
      const deniedCancel = vi.fn(() => { throw new Error('Revoked in Native queue') })
      const cancelled = h.run.cancelWorldCase({ id: 'denied-cancel' as never, requestId: original.requestId }, deniedCancel)
      expect(deniedCancel).not.toHaveBeenCalled()
      await expect(cancelled).rejects.toThrow('Revoked in Native queue')
      expect(deniedCancel).toHaveBeenCalledOnce()
      expect(h.run.snapshot()).toEqual(armed)
      const newPreview = await h.run.previewWorldManagement({ action: inputAction, expectedRevision: armed.revision }, auth.authority)
      expect(newPreview.blockers).toContain('outcome-unknown')
      await expect(h.run.submitWorldManagement({ ...input, commandId: worldManagementCommandIdSchema.parse('bypass'),
        expectedRevision: armed.revision, previewHash: newPreview.previewHash },
      auth.authority)).rejects.toMatchObject({ code: 'SIM_WORLD_CONFLICT' })
      expect(h.run.snapshot()).toEqual(armed)
      expect(await h.run.submitWorldManagement(input, auth.authority)).toMatchObject({ planId: original.planId })
    } finally { await h.close() }
  })
}

it.each(['json', 'sqlite'] as const)('%s rejects stopped management through preview, direct submit and raw Native replay', async (backend) => {
  const { simulationRunControlCommandSchema } = await import('@clocky/clocky-simulation')
  const { previewWorldManagement, prepareWorldManagement } = await import('../src/world-management.ts')
  const { foldEntry } = await import('../src/journal.ts')
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.tmp/w1/management-cuts' })
  try {
    await h.run.updateRunControl(simulationRunControlCommandSchema.parse({ commandId: 'stop-management', target: {
      targetId: 'stop-management', clock: { kind: 'native' }, boundary: '0', mode: 'at-boundary', checkpointPolicy: 'none',
      drainBudget: { maxSteps: 10, maxTokens: 1000, maxWallTimeMs: 10000 },
    } }), h.run.snapshot().revision)
    const stopped = h.run.snapshot(), inputAction = action('hire-existing'), auth = authorization(inputAction, h.requester)
    const previewInput = { action: inputAction, expectedRevision: stopped.revision }
    await expect(h.run.previewWorldManagement(previewInput, auth.authority)).rejects.toThrow(/stop target/)
    const runtime = Reflect.get(h.run, 'worldRuntime') as import('../src/world-runtime.ts').NativeWorldRuntime
    // Derive otherwise valid Host inputs without the fence; final Native admission must still reject the actual stopped prefix.
    const { runControl: _originalControl, ...shadow } = stopped
    const preview = previewWorldManagement(shadow, previewInput, auth.authority, runtime)
    const input = simulationWorldManagementSubmitRequestSchema.parse({ ...previewInput, commandId: 'cannot-bypass-stop', previewHash: preview.previewHash })
    const record = prepareWorldManagement(shadow, input, auth.authority, runtime)
    await expect(h.run.submitWorldManagement(input, auth.authority)).rejects.toThrow(/stop target/)
    expect(() => foldEntry(stopped, { sequence: stopped.revision + 1, value: { kind: 'run/world', runId: stopped.spec.runId,
      expectedRevision: stopped.revision, change: record } }, stopped.spec, backend, runtime)).toThrow(/stop target/)
    expect(h.run.snapshot()).toEqual(stopped)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})
