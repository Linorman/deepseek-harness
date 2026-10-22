import { afterEach, describe, expect, it, vi } from 'vitest'
import { activationReservationIdSchema, envelopeIdSchema } from '@clocky/clocky-team'
import { simulationDecisionIdSchema, simulationMaintenanceRequestSchema, simulationWindowRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'
import { assertMaintenanceProjection, foldMaintenance } from '../src/maintenance.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const request = (id = 'hire') => simulationMaintenanceRequestSchema.parse({ id, owner: 'world-owner' })

describe.each(['json', 'sqlite'] as const)('%s durable structural maintenance', (backend) => {
  it('closes new decisions and scheduling while allowing the existing decision to settle, then retires before completion', async () => {
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    const { id, lease } = await h.actor('requester')
    const decision = simulationDecisionIdSchema.parse('already-open')
    await lease.openDecision(decision, h.run.snapshot().revision)
    const started = await h.run.beginMaintenance(request())
    expect(started.status).toBe('draining')
    const revision = h.run.snapshot().revision
    expect(await h.run.beginMaintenance(request())).toEqual(started)
    expect(h.run.snapshot().revision).toBe(revision)
    await expect(h.run.beginMaintenance({ ...request(), owner: 'forged-owner' })).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_CONFLICT' })
    await expect(h.run.beginMaintenance(request('other'))).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_CONFLICT' })
    await expect(h.run.reserveWriter(id, 'local', activationReservationIdSchema.parse('new'), h.run.snapshot().revision))
      .rejects.toMatchObject({ code: 'SIM_MAINTENANCE_ACTIVE' })
    await expect(h.run.drive({ until: simTimeSchema.parse('20') })).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_ACTIVE' })
    expect(h.run.snapshot().time).toBe('0')
    expect((await lease.submitDecision(decision, [])).status).toBe('accepted')
    await expect(lease.openDecision(simulationDecisionIdSchema.parse('new'), h.run.snapshot().revision))
      .rejects.toMatchObject({ code: 'SIM_MAINTENANCE_ACTIVE' })
    await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_ACTIVE' })
    await expect(h.run.quiesceMaintenance(request())).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_NOT_QUIESCENT' })
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await lease.revoke()
    await expect(h.run.quiesceMaintenance(request())).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_NOT_QUIESCENT' })
    expect(h.run.population().chargedActors).toBe(1)
    await lease.release()
    const quiescent = await h.run.quiesceMaintenance(request())
    expect(quiescent.status).toBe('quiescent')
    expect(await h.run.quiesceMaintenance(request())).toEqual(quiescent)
    await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_ACTIVE' })
    const completed = await h.run.finishMaintenance(request())
    expect(completed.status).toBe('completed')
    expect(h.run.snapshot().phase).toBe('paused')
    await h.run.beginMaintenance(request('next'))
    expect(await h.run.finishMaintenance(request())).toEqual(completed)
    await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_ACTIVE' })
  })

  it('allows a submitted window to finish while rejecting the next window at Native admission', async () => {
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    const { id, lease } = await h.actor('requester')
    const window = simulationWindowRequestSchema.parse({ id: 'before-maintenance', decisions: [
      { id: 'plan', entityId: id, context: contextRequest() },
    ] })
    await h.run.openWindow(window, h.run.snapshot().revision)
    await h.run.beginMaintenance(request())
    expect((await lease.submitDecision(simulationDecisionIdSchema.parse('plan'), [])).status).toBe('submitted')
    expect((await h.run.commitWindow(window.id)).status).toBe('closed')
    expect(h.run.snapshot().decisions[simulationDecisionIdSchema.parse('plan')]?.status).toBe('accepted')
    await expect(h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'next', decisions: [
      { id: 'next-plan', entityId: id, context: contextRequest() },
    ] }), h.run.snapshot().revision)).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_ACTIVE' })
  })

  it('retains one owner across replay and rejects skipping quiescence, including failed append retries', async () => {
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    const stream = (h.run as unknown as { stream: LogStream }).stream
    const before = h.run.snapshot()
    const fail = vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('maintenance append interrupted'))
    await expect(h.run.beginMaintenance(request())).rejects.toThrow('maintenance append interrupted')
    fail.mockRestore()
    expect(h.run.snapshot()).toEqual(before)
    const started = await h.run.beginMaintenance(request())
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await h.run.close()
    const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
    cleanups.push(() => reopened.close())
    expect(await reopened.beginMaintenance(request())).toEqual(started)
    await expect(reopened.finishMaintenance(request())).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_CONFLICT' })
    const resume = await reopened.managePhase({ id: (await import('@clocky/clocky-simulation')).simulationManagementIdSchema.parse('resume'), phase: 'running' })
    expect(resume).toMatchObject({ status: 'failed', error: 'Simulation maintenance blocks new execution' })
    await reopened.quiesceMaintenance(request())
    await reopened.finishMaintenance(request())
    expect(reopened.snapshot().phase).toBe('paused')
    await reopened.setPhase('running', reopened.snapshot().revision)
    expect(reopened.snapshot().phase).toBe('running')
  })

  it('rechecks late writer activation and preserves its occupied slot until retirement is confirmed', async () => {
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    const { id, lease } = await h.actor('requester')
    await lease.revoke(); await lease.release()
    h.leases.splice(0)
    const actor = h.run.snapshot().entities[id]!
    const reservationId = activationReservationIdSchema.parse('late-start')
    const pending = await h.run.reserveWriter(id, 'local', reservationId, h.run.snapshot().revision)
    h.leases.push(pending)
    await h.run.beginMaintenance(request())
    await expect(pending.activate({ ...actor.binding!, provider: 'local', reservationId,
      activationId: actor.writer!.activationId! })).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_ACTIVE' })
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await pending.revoke()
    await expect(h.run.quiesceMaintenance(request())).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_NOT_QUIESCENT' })
    await pending.release()
    expect((await h.run.quiesceMaintenance(request())).status).toBe('quiescent')
  })

  it('admits draining outside publication IO and refuses to claim quiescence before the accepted reply settles', async () => {
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    const sender = await h.actor('sender'), recipient = await h.actor('recipient')
    const decision = await h.submit(sender.lease, 'post', [{ after: [], action: {
      kind: 'communication/post', recipient: recipient.id, channelId: 'private', text: 'Original accepted message', deliverAt: '0',
    } }])
    await h.run.drive({ until: simTimeSchema.parse('0') })
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const work = h.run.dispatchOperation(decision.operationIds[0]!, { post: async (message) => {
      entered.resolve(undefined); await release.promise
      return { status: 'applied', receipt: { runId: message.runId, operationId: message.operationId,
        fingerprint: message.fingerprint, teamId: message.sender.teamId, recipientId: message.recipient.participantId,
        channelId: message.channelId, envelopeId: envelopeIdSchema.parse('accepted-envelope'), sequence: 1 } }
    } }, () => 100)
    try {
      await entered.promise
      await h.run.beginMaintenance(request())
      await h.run.setPhase('paused', h.run.snapshot().revision)
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await expect(h.run.quiesceMaintenance(request())).rejects.toMatchObject({ code: 'SIM_MAINTENANCE_NOT_QUIESCENT' })
    } finally { release.resolve(undefined) }
    expect((await work).status).toBe('settled')
    expect((await h.run.quiesceMaintenance(request())).status).toBe('quiescent')
    expect(h.run.snapshot().operations[decision.operationIds[0]!]!.result?.status).toBe('applied')
  })

  it('rejects corrupted owner histories and quiescent observations that contradict execution state', async () => {
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    await h.run.beginMaintenance(request())
    const state = h.run.snapshot()
    expect(() => foldMaintenance(state, { request: request(), status: 'quiescent' }, state.revision + 1))
      .toThrow(/paused scheduling/)
    expect(() => { assertMaintenanceProjection({ ...state, maintenance: { [request().id]: {
      request: request(), startedSequence: state.revision, quiescentSequence: state.revision, status: 'quiescent',
    } } }) }).toThrow(/transition order/)
    expect(() => { assertMaintenanceProjection({ ...state, maintenance: { ...state.maintenance,
      [request('other').id]: { request: request('other'), status: 'draining', startedSequence: state.revision },
    } }) }).toThrow(/more than one/)
  })
})

it('requires one strict branded maintenance identity and owner request', () => {
  for (const value of [{ id: '', owner: 'world' }, { id: 'hire', owner: '' }, { id: 'hire', owner: 'world', resume: true }]) {
    expect(simulationMaintenanceRequestSchema.safeParse(value).success).toBe(false)
  }
})
