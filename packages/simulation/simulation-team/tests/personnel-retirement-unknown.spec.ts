import { worldRolePlanOperationId } from '@clocky/clocky-simulation'
/** Real personnel reservations retain the original revoked writer until its actual Controller/raw handle stop settles. */
import assert from 'node:assert/strict'
import { expect, it, vi } from 'vitest'
import { simulationChangeSchema, simulationEntityIdSchema, simulationDecisionIdSchema, simulationChannelSpecSchema,
  simulationWorldDefinitionSchema, simulationProposalSchema, simulationWorldRequestOperationSchema,
  simulationWorldResolveOperationSchema, simulationMaintenanceRequestSchema, simulationWorldCancelRequestSchema,
  simulationRelationIdSchema, simTimeSchema, WORLD_DEPART_PIN } from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationProposal, SimulationWorldContextRequest } from '@clocky/clocky-simulation'
import type { ActivationHandle } from '@clocky/clocky-agent-runtime'
import type { ActivationSnapshot } from '@clocky/clocky-team'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import { companyFixture, companySettings } from '../../simulation-product/tests/company-driver-fixture.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { decisionInput } from '../src/input.ts'
import SimulationTeams from '../src/index.ts'

const requesterId = simulationEntityIdSchema.parse('buyer'), personId = simulationEntityIdSchema.parse('supplier')
const directorId = simulationEntityIdSchema.parse('retirement-director')
async function fixture(backend: 'json' | 'sqlite') {
  const h = await companyFixture(backend, true, { relationRules: ['assignment', 'can-depart'].map(relation => ({
    relation, subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false })) })
  try {
    for (const [name, kind, cognition] of [['retirement-org', 'organization', 'none'], ['retirement-hr-role', 'position', 'none'],
      ['retirement-old-role', 'position', 'none'], [directorId, 'person', 'agent']]) {
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: name, entityKind: kind,
        cognition, readiness: 'ready', profile: {} }), h.run.snapshot().revision)
    }
    await h.connection.ensureParticipant(directorId, { displayName: 'Retirement director', role: 'director', capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'company/scripted' })
    await h.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'retirement-requester-director', limits: {},
      members: [{ entityId: requesterId, role: 'requester' }, { entityId: directorId, role: 'director' }] }))
    for (const [name, subject, relation, object] of [['retirement-hr-assignment', requesterId, 'assignment', 'retirement-hr-role'],
      ['retirement-person-assignment', personId, 'assignment', 'retirement-old-role'],
      ['retirement-depart-grant', requesterId, 'can-depart', 'retirement-old-role']]) {
      await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: name, subject, object,
        relation, scope: 'retirement-org', validFrom: '0', validUntil: null }), h.run.snapshot().revision)
    }
    await h.run.configureWorld(simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], directorEntityId: directorId,
      organizationEntityId: 'retirement-org', operations: [WORLD_DEPART_PIN], operationGrants: [{ domain: 'organization',
        operation: 'depart',
        version: '1', requesterEntityId: requesterId, scopeEntityId: 'retirement-org', targetEntityId: 'retirement-old-role',
        relationId: 'retirement-depart-grant', relation: 'can-depart' }], authorizations: [],
      positions: [{ entityId: 'retirement-hr-role', capacity: 1 }, { entityId: 'retirement-old-role', capacity: 1 }],
      templates: [{ id: 'finite', version: '1', names: ['Finite'], skills: [], traits: [], goals: [], description: 'Finite' }],
      policyVersion: '1', limits: { maxRequests: 16,
        maxBirthsPerInterval: 16, maxExternalExpansionsPerInterval: 16, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 16,
        maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 } }),
    h.run.snapshot().revision)
    await h.start()
    // Boundary departure closes an assignment strictly after its original start; retirement IO remains on its real wall clock.
    expect((await h.run.drive({ until: simTimeSchema.parse('1') })).reason).toBe('until')
    const placement = (id: SimulationEntityId) => ({ provider: 'in-process',
      seed: { kind: h.run.snapshot().entities[id]?.writer === undefined ? 'fresh' as const : 'resume' as const },
      agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal })
    const submit = async (actorId: SimulationEntityId, name: string, world: SimulationWorldContextRequest,
      proposal: SimulationProposal, wakeId?: import('@clocky/clocky-simulation').SimulationEventId) => {
      const decisionId = simulationDecisionIdSchema.parse(name)
      await h.connection.openDecision(actorId, decisionId, wakeId)
      const prepared = await h.connection.prepareContext(actorId, decisionId, { ...contextRequest(), world })
      if (prepared.status !== 'prepared') throw new Error('Bounded original personnel context was not prepared')
      const actor = h.ctx.agents.get(h.run.snapshot().entities[actorId]!.binding!.sessionId)
      if (actor === undefined) throw new Error('Original personnel decision lost its canonical Agent')
      actor.session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
      actor.session.append('user/message', decisionInput(prepared.view), { surfaceOp: 'append' })
      if (!await h.ctx.sessions.flush(actor.session)) throw new Error('Original personnel input was not flushed')
      await h.ctx.simulationTeams.modelRequest(actor, { kind: 'observe' }, h.lifetime.signal)
      await h.ctx.simulationTeams.modelRequest(actor, { kind: 'stage', proposals: [proposal] }, h.lifetime.signal)
      await h.ctx.simulationTeams.modelRequest(actor, { kind: 'submit' }, h.lifetime.signal)
      return h.run.snapshot().decisions[decisionId]!
    }
    await h.connection.ensureResident(requesterId, { activation: placement(requesterId), evict: [] })
    const payload = { organizationEntityId: 'retirement-org', personId, assignmentId: 'retirement-person-assignment',
      assignmentRevision: 1, requestedEffectiveAt: null, description: 'Original departure for retirement ownership', retire: false }
    const decision = await submit(requesterId, 'retirement-request', { kind: 'goal' }, simulationProposalSchema.parse({ after: [],
      action: simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: 'organization', operation: 'depart',
        version: '1', businessKey: 'original-retirement', expectedTime: null, evidence: [], payload }) }))
    const original = Object.values(h.run.snapshot().world!.requests)[0]!
    await h.run.executeOperation(worldRolePlanOperationId(original))
    await h.run.drive({ until: h.run.snapshot().time })
    assert.ok(original.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    await h.connection.dispatchOperation(original.notificationOperationId, Date.now)
    await h.connection.hibernate(requesterId)
    await h.connection.ensureResident(directorId, { activation: placement(directorId), evict: [] })
    assert.ok(original.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    const wakeId = await h.connection.receiveOperation(original.notificationOperationId)
    assert.ok(original.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    const notification = h.run.snapshot().operations[original.notificationOperationId]!
    if (notification.action.kind !== 'communication/post' || notification.outbox?.receipt === undefined)
      throw new Error('Original personnel notification has no actual canonical Team receipt')
    const receipt = notification.outbox.receipt, director = h.ctx.agents.get(h.run.snapshot().entities[directorId]!.binding!.sessionId)!
    const input = renderDirectV4EnvelopeInput({ id: receipt.envelopeId, teamId: receipt.teamId, channelId: receipt.channelId,
      senderId: h.run.snapshot().entities[requesterId]!.binding!.participantId, delivery: 'context',
      payload: { content: [{ type: 'text', text: notification.action.text }] } })
    if (!director.session.events.some(event => event.type === 'user/message' && event.surfaceOp === 'append'
      && event.data.id === input.id)) {
      director.inbox.remove(input.id)
      director.session.append('user/message', input, { surfaceOp: 'append' })
      if (!await h.ctx.sessions.flush(director.session)) throw new Error('Actual delivered notification did not flush')
    }
    await h.run.drive({ until: h.run.snapshot().time })
    const resolved = await submit(directorId, 'retirement-original-plan', { kind: 'resolve', requestId: original.id },
      simulationProposalSchema.parse({ after: [], action: simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve',
        requestId: original.id, supersedes: null, resolution: { kind: 'apply', payload,
          rationale: 'Original exact departure' } }) }), wakeId)
    await h.run.executeOperation(resolved.operationIds[0]!)
    const plan = Object.values(h.run.snapshot().world!.plans)[0]!
    expect(plan.status).toBe('accepted')
    expect(plan.requestId).toBe(original.id)
    await h.connection.hibernate(directorId)
    const maintenance = simulationMaintenanceRequestSchema.parse({ id: 'original-personnel-retirement', owner: companySettings.ownerName })
    const reservation = await h.run.reservePersonnel({ planId: plan.id, maintenance })
    const provider = h.ctx.agentRuntimes.getProvider('in-process')
    if (provider === undefined) throw new Error('Original in-process runtime provider is unavailable')
    const activate = provider.activate.bind(provider), entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let handle: ActivationHandle | undefined, disposal: Promise<void> | undefined
    const callbacks: Array<(snapshot: ActivationSnapshot) => void> = []
    const wrapped = vi.spyOn(provider, 'activate').mockImplementationOnce(async (...args) => {
      const actual = await activate(...args), dispose = actual.dispose.bind(actual), onStatus = actual.onStatus.bind(actual)
      handle = actual
      actual.onStatus = (listener) => { callbacks.push(listener); return onStatus(listener) }
      actual.dispose = () => disposal ??= (async () => {
        entered.resolve(undefined); await release.promise
        await dispose()
      })()
      return actual
    })
    const active = await h.connection.ensureResident(personId, { activation: placement(personId), evict: [] })
    if (active.status !== 'resident' || handle === undefined) throw new Error('Actual personnel writer was not activated')
    const writer = h.run.snapshot().entities[personId]!.writer!
    expect(h.run.population().chargedActors).toBe(1)
    expect(h.run.snapshot().world!.personnel.reservations[reservation.id]).toEqual(reservation)
    return { ...h, decision, original, plan, reservation, maintenance, active, writer, entered, release,
      handle, callbacks, placement, rawDisposal: () => disposal, unwrap: () => { wrapped.mockRestore() } }
  } catch (error) { vi.restoreAllMocks(); await h.close(); throw error }
}

it.each(['json',
  'sqlite'] as const)('%s holds the real original stop after revocation and retains personnel capacity until actual disposal confirms', async (backend) => {
  const h = await fixture(backend)
  let work: ReturnType<typeof h.connection.quiesceForMaintenance> | undefined
  try {
    work = h.connection.quiesceForMaintenance(h.maintenance, 4, 3)
    const result = work.then(value => ({ value }), (error: unknown) => ({ error }))
    await h.entered.promise
    expect(h.run.snapshot().entities[personId]!.writer).toMatchObject({ epoch: h.writer.epoch,
      activationId: h.writer.activationId, phase: 'revoked' })
    expect(h.run.population().chargedActors).toBe(1)
    expect(h.run.snapshot().maintenance?.[h.maintenance.id]?.status).toBe('draining')
    expect(h.run.snapshot().world!.personnel.reservations[h.reservation.id]!.status).toBe('fenced')
    const before = h.run.snapshot()
    await expect(h.connection.activate(personId, h.placement(personId))).rejects.toThrow()
    expect(h.run.snapshot()).toEqual(before)
    expect(h.run.population().chargedActors).toBe(1)
    const team = await h.ctx.teams.getTeam({ teamId: h.active.lease.binding.activation.teamId })
    expect(team.activations.find(value => value.activation.id === h.active.lease.binding.activation.id)?.quiescedAt).toBeUndefined()
    const command = simulationWorldCancelRequestSchema.parse({ id: 'original-personnel-unknown-cancel', requestId: h.original.id })
    const pending = await h.connection.cancelWorldCase(command)
    expect(pending.status).toBe('cancel-requested')
    const held = h.run.snapshot(), originalAssignment = held.relations[simulationRelationIdSchema.parse('retirement-person-assignment')]!
    const originalIdentity = held.entities[personId]!
    expect(held.world!.requests[h.original.id]!.status).toBe('cancel-requested')
    expect(held.world!.personnel.reservations[h.reservation.id]).toMatchObject({ id: h.reservation.id,
      request: h.reservation.request, targetPositionId: h.reservation.targetPositionId, status: 'cancel-requested' })
    expect(held.world!.personnel.fences[h.reservation.id]!.status).toBe('active')
    expect(h.run.population().chargedActors).toBe(1)
    await expect(h.run.settlePersonnelCancellation(h.reservation.id)).rejects.toThrow(/quiescent|unknown|stopped|maintenance/)
    expect(h.run.snapshot()).toEqual(held)
    h.release.resolve(undefined)
    const terminal = await result
    if ('error' in terminal) throw terminal.error
    expect(terminal.value.status).toBe('quiescent')
    await h.rawDisposal()
    expect(h.run.population().chargedActors).toBe(0)
    expect(h.run.snapshot().entities[personId]!.writer!.phase).toBe('released')
    const revision = h.run.snapshot().revision
    expect(await h.connection.quiesceForMaintenance(h.maintenance, 4, 3)).toEqual(terminal.value)
    expect(h.run.snapshot().revision).toBe(revision)
    const cancelled = await h.connection.cancelWorldCase(command)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.request).toEqual(command)
    const finished = h.run.snapshot()
    expect(finished.world!.personnel.reservations[h.reservation.id]!.status).toBe('cancelled')
    expect(finished.world!.personnel.fences[h.reservation.id]!.status).toBe('cancelled')
    expect(finished.relations[originalAssignment.id]).toEqual(originalAssignment)
    expect(finished.entities[personId]).toMatchObject({ binding: originalIdentity.binding, profile: originalIdentity.profile,
      profileRevision: originalIdentity.profileRevision, phase: originalIdentity.phase })
    expect(await h.connection.cancelWorldCase(command)).toEqual(cancelled)
    expect(h.run.snapshot()).toEqual(finished)
    expect(h.requests).toHaveLength(0)
  } finally {
    h.release.resolve(undefined)
    await work?.catch((retirementFailure: unknown) => {
      void retirementFailure // The primary assertion reports failures; cleanup still drains the accepted original stop.
    })
    h.unwrap(); vi.restoreAllMocks(); await h.close()
  }
})

it.each(['json',
  'sqlite'] as const)('%s expires only the actual default Controller close deadline and retains the original stop until its late disposal', async (backend) => {
  const h = await fixture(backend)
  let maintenance: ReturnType<typeof h.connection.quiesceForMaintenance> | undefined
  try {
    maintenance = h.connection.quiesceForMaintenance(h.maintenance, 4, 3)
    const observed = maintenance.then(value => ({ value }), (error: unknown) => ({ error }))
    await h.entered.promise
    expect(h.run.snapshot().entities[personId]!.writer!.phase).toBe('revoked')
    // stopOwnedActivation itself has no deadline. This advances only the real Controller.close timeout at its unchanged default.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const closing = h.ctx.teamActivations.close()
    const expired = expect(closing).rejects.toThrow('Team activation controller disposal exceeded 5000ms')
    await vi.advanceTimersByTimeAsync(4999)
    expect(h.run.population().chargedActors).toBe(1)
    const before = h.run.snapshot()
    await vi.advanceTimersByTimeAsync(1)
    await expired
    vi.useRealTimers()
    expect(h.run.snapshot()).toEqual(before)
    expect(h.run.snapshot().maintenance?.[h.maintenance.id]?.status).toBe('draining')
    expect(h.run.snapshot().world!.personnel.reservations[h.reservation.id]!.status).toBe('fenced')
    const team = await h.ctx.teams.getTeam({ teamId: h.active.lease.binding.activation.teamId })
    expect(team.activations.find(value => value.activation.id === h.writer.activationId)?.quiescedAt).toBeUndefined()
    await expect(h.ctx.teamActivations.stopOwnedActivation({ teamId: team.team.id,
      participantId: h.active.lease.binding.activation.participantId, activationId: h.active.lease.binding.activation.id }))
      .rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    expect(h.run.population().chargedActors).toBe(1)
    h.release.resolve(undefined)
    const terminal = await observed
    if ('error' in terminal) throw terminal.error
    expect(terminal.value.status).toBe('quiescent')
    await h.rawDisposal()
    expect(h.run.snapshot().entities[personId]!.writer!.phase).toBe('released')
    expect(h.run.population().chargedActors).toBe(0)
    expect(await h.connection.quiesceForMaintenance(h.maintenance, 4, 3)).toEqual(terminal.value)
    await h.ctx.teamActivations.close()
    expect(h.requests).toHaveLength(0)
  } finally {
    vi.useRealTimers(); h.release.resolve(undefined)
    await maintenance?.catch((failure: unknown) => {
      void failure /* Drain the original accepted stop; primary assertions retain diagnostics. */
    })
    h.unwrap(); vi.restoreAllMocks(); await h.close()
  }
})

it.each(['json',
  'sqlite'] as const)('%s connection close waits for accepted raw disposal and a new connection reconciles the exact original maintenance', async (backend) => {
  const h = await fixture(backend)
  let maintenance: ReturnType<typeof h.connection.quiesceForMaintenance> | undefined
  let closing: Promise<void> | undefined
  let replacement: typeof h.connection | undefined
  try {
    maintenance = h.connection.quiesceForMaintenance(h.maintenance, 4, 3)
    const observed = maintenance.then(value => ({ value }), (error: unknown) => ({ error }))
    await h.entered.promise
    const command = simulationWorldCancelRequestSchema.parse({ id: 'close-unknown-original', requestId: h.original.id })
    expect((await h.connection.cancelWorldCase(command)).status).toBe('cancel-requested')
    let closed = false
    closing = h.connection.close().then(() => { closed = true })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(closed).toBe(false)
    expect(h.run.population().chargedActors).toBe(1)
    expect(h.run.snapshot().entities[personId]!.writer!.phase).toBe('revoked')
    expect(h.run.snapshot().maintenance?.[h.maintenance.id]?.status).toBe('draining')
    const team = await h.ctx.teams.getTeam({ teamId: h.active.lease.binding.activation.teamId })
    expect(team.activations.find(value => value.activation.id === h.writer.activationId)?.quiescedAt).toBeUndefined()
    h.release.resolve(undefined)
    const interrupted = await observed
    expect('error' in interrupted).toBe(true)
    await closing
    await h.rawDisposal()
    expect(closed).toBe(true)
    expect(h.run.population().chargedActors).toBe(0)
    expect(h.run.snapshot().maintenance?.[h.maintenance.id]?.status).toBe('draining')
    replacement = await h.ctx.simulationTeams.attach(h.run, team.team.id, companySettings.ownerName)
    expect((await replacement.quiesceForMaintenance(h.maintenance, 4, 3)).status).toBe('quiescent')
    const cancelled = await replacement.cancelWorldCase(command)
    expect(cancelled.status).toBe('cancelled')
    const final = h.run.snapshot()
    expect(await replacement.cancelWorldCase(command)).toEqual(cancelled)
    expect(h.run.snapshot()).toEqual(final)
    expect(h.requests).toHaveLength(0)
  } finally {
    h.release.resolve(undefined)
    await maintenance?.catch((failure: unknown) => { void failure /* Original interruption is asserted; cleanup drains its IO. */ })
    await closing; await replacement?.close()
    h.unwrap(); vi.restoreAllMocks(); await h.close()
  }
})

it.each(['json',
  'sqlite'] as const)('%s late original status and stop callbacks cannot release or replace the resumed Person epoch', async (backend) => {
  const h = await fixture(backend)
  let maintenance: ReturnType<typeof h.connection.quiesceForMaintenance> | undefined
  try {
    maintenance = h.connection.quiesceForMaintenance(h.maintenance, 4, 3)
    const observed = maintenance.then(value => ({ value }), (error: unknown) => ({ error }))
    await h.entered.promise
    const command = simulationWorldCancelRequestSchema.parse({ id: 'new-epoch-original-cancel', requestId: h.original.id })
    expect((await h.connection.cancelWorldCase(command)).status).toBe('cancel-requested')
    h.release.resolve(undefined)
    const terminal = await observed
    if ('error' in terminal) throw terminal.error
    await h.rawDisposal()
    expect((await h.connection.cancelWorldCase(command)).status).toBe('cancelled')
    await h.run.finishMaintenance(h.maintenance)
    const oldBinding = h.active.lease.binding, oldSnapshot = await h.handle.health()
    expect(oldSnapshot.id).toBe(oldBinding.activation.id)
    expect(oldSnapshot.status).toBe('offline')
    const { seed: _seed, ...placement } = h.placement(personId)
    const resumed = await h.connection.resume(personId, placement)
    expect(resumed.binding.sessionId).toBe(oldBinding.sessionId)
    expect(resumed.binding.activation.participantId).toBe(oldBinding.activation.participantId)
    expect(resumed.binding.activation.id).not.toBe(oldBinding.activation.id)
    const before = h.run.snapshot(), current = before.entities[personId]!.writer!
    const originalTeam = await h.ctx.teams.getTeam({ teamId: resumed.binding.activation.teamId })
    const newBinding = originalTeam.activations.find(value => value.activation.id === resumed.binding.activation.id)
    expect(newBinding).toBeDefined()
    expect(BigInt(current.epoch)).toBe(BigInt(h.writer.epoch) + 1n)
    expect(current.phase).toBe('active')
    expect(h.callbacks.length).toBeGreaterThan(0)
    for (const callback of h.callbacks) callback(oldSnapshot)
    await h.active.lease.dispose()
    await expect(h.ctx.teamActivations.stopOwnedActivation({ teamId: oldBinding.activation.teamId,
      participantId: oldBinding.activation.participantId, activationId: oldBinding.activation.id }))
      .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    const team = await h.ctx.teams.getTeam({ teamId: resumed.binding.activation.teamId })
    expect(team.activations.find(value => value.activation.id === resumed.binding.activation.id)).toEqual(newBinding)
    expect(team.activations.find(value => value.activation.id === resumed.binding.activation.id)?.quiescedAt).toBeUndefined()
    expect(h.ctx.agents.get(resumed.binding.sessionId)).toBe(resumed.localAgent)
    expect(h.run.snapshot()).toEqual(before)
    expect(h.run.snapshot().entities[personId]!.writer).toEqual(current)
    expect(h.run.population().chargedActors).toBe(1)
    expect(h.requests).toHaveLength(0)
  } finally {
    h.release.resolve(undefined)
    await maintenance?.catch((failure: unknown) => { void failure /* Preserve the primary assertion and drain accepted IO. */ })
    h.unwrap(); vi.restoreAllMocks(); await h.close()
  }
})

it.each(['json',
  'sqlite'] as const)('%s the actual Simulation Team plugin fiber retains charged personnel responsibility until original disposal settles', async (backend) => {
  const h = await fixture(backend)
  let maintenance: ReturnType<typeof h.connection.quiesceForMaintenance> | undefined
  let unloading: Promise<void> | undefined
  try {
    const runtime = h.ctx.registry.get(SimulationTeams)
    const serviceFiber = runtime === undefined ? undefined : [...runtime.fibers][0]
    if (serviceFiber === undefined) throw new Error('Actual harness Simulation Team plugin fiber is unavailable')
    maintenance = h.connection.quiesceForMaintenance(h.maintenance, 4, 3)
    const observed = maintenance.then(value => ({ value }), (error: unknown) => ({ error }))
    await h.entered.promise
    const command = simulationWorldCancelRequestSchema.parse({ id: 'plugin-original-unknown-cancel', requestId: h.original.id })
    expect((await h.connection.cancelWorldCase(command)).status).toBe('cancel-requested')
    let unloaded = false
    unloading = serviceFiber.dispose().then(() => { unloaded = true })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(unloaded).toBe(false)
    expect(h.run.population().chargedActors).toBe(1)
    expect(h.run.snapshot().entities[personId]!.writer!.phase).toBe('revoked')
    expect(h.run.snapshot().maintenance?.[h.maintenance.id]?.status).toBe('draining')
    expect(h.run.snapshot().world!.personnel.reservations[h.reservation.id]!.status).toBe('cancel-requested')
    const team = await h.ctx.teams.getTeam({ teamId: h.active.lease.binding.activation.teamId })
    expect(team.activations.find(value => value.activation.id === h.writer.activationId)?.quiescedAt).toBeUndefined()
    h.release.resolve(undefined)
    const interrupted = await observed
    expect('error' in interrupted).toBe(true)
    await unloading
    await h.rawDisposal()
    expect(unloaded).toBe(true)
    expect(h.run.population().chargedActors).toBe(0)
    expect(h.run.snapshot().entities[personId]!.writer!.phase).toBe('released')
    const confirmed = await h.ctx.teams.getTeam({ teamId: team.team.id })
    expect(confirmed.activations.find(value => value.activation.id === h.writer.activationId)?.quiescedAt).toBeTypeOf('number')
    // The Native provider remains alive; exact original maintenance/cancellation reconciliation uses confirmed release, never a fake proof.
    expect((await h.run.beginMaintenance(h.maintenance)).status).toBe('draining')
    expect((await h.run.quiesceMaintenance(h.maintenance)).status).toBe('quiescent')
    await h.run.settlePersonnelCancellation(h.reservation.id)
    const cancelled = await h.run.cancelWorldCase(command)
    expect(cancelled.status).toBe('cancelled')
    const final = h.run.snapshot()
    expect(await h.run.cancelWorldCase(command)).toEqual(cancelled)
    expect(h.run.snapshot()).toEqual(final)
    expect(h.requests).toHaveLength(0)
  } finally {
    h.release.resolve(undefined)
    await maintenance?.catch((failure: unknown) => {
      void failure /* Plugin admission interruption is asserted; drain original accepted stop. */
    })
    await unloading
    h.unwrap(); vi.restoreAllMocks(); await h.close()
  }
})
