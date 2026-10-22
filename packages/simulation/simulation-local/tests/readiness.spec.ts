import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@clocky/clocky-session'
import { activationReservationIdSchema, participantIdSchema, teamIdSchema } from '@clocky/clocky-team'
import { simulationChangeSchema, simulationEntityIdSchema, simulationWakeRequestSchema, simulationDispatchCandidateSchema,
  simTimeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { foldWriterChange, assertWriterAdmission } from '../src/writers.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const id = simulationEntityIdSchema.parse('newcomer')
const binding = { teamId: teamIdSchema.parse('company'), participantId: participantIdSchema.parse('newcomer'), sessionId: SessionId('newcomer') }
const reservationId = activationReservationIdSchema.parse('newcomer-start')

describe.each(['json', 'sqlite'] as const)('%s execution readiness', (backend) => {
  it('settles a preparing entity wake without inference and refuses direct fair-dispatch nomination', async () => {
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person',
      cognition: 'agent', readiness: 'preparing', profile: {} }), h.run.snapshot().revision)
    await h.run.bindEntity(id, binding, h.run.snapshot().revision)
    const wake = simulationWakeRequestSchema.parse({ id: 'preparing-first-action', entityId: id, time: '0', reason: 'First action' })
    await h.run.scheduleWake(wake, h.run.snapshot().revision)
    expect((await h.run.drive({ until: simTimeSchema.parse('0') })).reason).toBe('until')
    expect(h.run.snapshot().wakes[wake.id]).toMatchObject({ entityId: id, status: 'cancelled', cancellation: 'Entity unavailable' })
    await expect(h.run.queueDecision(simulationDispatchCandidateSchema.parse({ id: 'preparing-decision', entityId: id, priority: 0 })))
      .rejects.toThrow()
    expect(h.run.snapshot().decisions).toEqual({})
    expect(h.run.snapshot().entities[id]?.writer).toBeUndefined()
  })

  it('retains preparation through cold open and refuses writers until an explicit bound preparation outcome', async () => {
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person',
      cognition: 'agent', readiness: 'preparing', profile: { readiness: 'ready', role: 'director' } }), h.run.snapshot().revision)
    const ready = () => simulationChangeSchema.parse({ kind: 'entity/readiness', id,
      entityRevision: h.run.snapshot().entities[id]!.revision, readiness: 'ready' })
    await expect(h.run.change(ready(), h.run.snapshot().revision)).rejects.toThrow(/canonical cognition binding/)
    await h.run.bindEntity(id, binding, h.run.snapshot().revision)
    await expect(h.run.reserveWriter(id, 'local', reservationId, h.run.snapshot().revision)).rejects.toThrow(/ready entity/)
    await h.run.setPhase('running', h.run.snapshot().revision)
    await expect(h.run.change(ready(), h.run.snapshot().revision)).rejects.toThrow(/paused quiescence/)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const before = h.run.snapshot()
    await h.run.close()
    const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
    cleanups.push(() => reopened.close())
    expect(reopened.snapshot()).toEqual(before)
    await expect(reopened.reserveWriter(id, 'local', reservationId, reopened.snapshot().revision)).rejects.toThrow(/ready entity/)
    await reopened.change(ready(), reopened.snapshot().revision)
    const writer = await reopened.reserveWriter(id, 'local', reservationId, reopened.snapshot().revision)
    try { expect(reopened.snapshot().entities[id]?.readiness).toBe('ready') }
    finally { await writer.revoke(); await writer.release() }
  })

  it('makes abandonment terminal even when profile and lifecycle are changed', async () => {
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person',
      cognition: 'agent', readiness: 'preparing', profile: {} }), h.run.snapshot().revision)
    await h.run.bindEntity(id, binding, h.run.snapshot().revision)
    const change = (kind: string, fields: object) => h.run.change(simulationChangeSchema.parse({ kind, id,
      entityRevision: h.run.snapshot().entities[id]!.revision, ...fields }), h.run.snapshot().revision)
    await change('entity/readiness', { readiness: 'abandoned' })
    await change('entity/profile', { profile: { readiness: 'ready' } })
    await change('entity/phase', { phase: 'inactive' })
    await change('entity/phase', { phase: 'active' })
    await expect(change('entity/readiness', { readiness: 'ready' })).rejects.toThrow(/active preparing/)
    await expect(h.run.reserveWriter(id, 'local', reservationId, h.run.snapshot().revision)).rejects.toThrow(/ready entity/)
  })

  it('rejects forged activation and acceptance projections for nonready entities while retirement remains possible', async () => {
    const h = await createBusinessHarness(backend)
    cleanups.push(h.close)
    const { id: actorId, lease } = await h.actor('actor')
    const before = h.run.snapshot().revision
    await h.submit(lease, 'accepted', [])
    const state = h.run.snapshot(), actor = state.entities[actorId]!
    for (const readiness of ['preparing', 'abandoned'] as const) {
      const invalid = { ...state, entities: { ...state.entities, [actorId]: { ...actor, readiness } } }
      expect(() => { assertWriterAdmission(invalid, before) }).toThrow(/active writer interval/)
      expect(() => foldWriterChange(invalid, { kind: 'writer/activated', entityId: actorId, epoch: lease.epoch,
        activation: { ...actor.binding!, activationId: actor.writer!.activationId!, reservationId: actor.writer!.reservationId, provider: 'local' } })).toThrow(/ready entity/)
      expect(foldWriterChange(invalid, { kind: 'writer/revoked', entityId: actorId, epoch: lease.epoch }).entities[actorId]?.writer?.phase).toBe('revoked')
    }
  })
})

it('requires explicit readiness and rejects unknown readiness fields before persistence', () => {
  const create = { kind: 'entity/create', id, entityKind: 'person', cognition: 'agent', profile: {} }
  expect(simulationChangeSchema.safeParse(create).success).toBe(false)
  for (const readiness of ['abandoned', 'active', null]) {
    expect(simulationChangeSchema.safeParse({ ...create, readiness }).success).toBe(false)
  }
  expect(simulationChangeSchema.safeParse({ ...create, readiness: 'preparing', director: true }).success).toBe(false)
})
