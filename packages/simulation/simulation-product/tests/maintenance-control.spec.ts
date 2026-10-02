/** Administrative hints observe native ownership and durable lifecycle without opening or driving runs. */
import { expect, it } from 'vitest'
import { maintenanceControl } from '../src/maintenance-control.ts'
import type { MaintenanceControlFacts } from '../src/maintenance-control.ts'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { accepted } from './creation-fixture.ts'
import { worldFixture, checkpoints, decision, operation } from './collection-fixtures.ts'

const creation = accepted().command.creation
const facts: MaintenanceControlFacts = { nativeOwner: 'this-provider', held: true, unstarted: true,
  driver: 'other', pending: false, capacity: true, ingressLimit: 2 }
const text = (value: string) => ({ text: value, truncated: false })
const project = (state: SimulationSnapshot | undefined, patch: Partial<MaintenanceControlFacts> = {}) =>
  maintenanceControl(creation, state, { ...facts, ...patch }, text)

it('observes cold/missing preparation, recovery responsibility and incompatible or complete anchors', async () => {
  const h = await worldFixture()
  const state = h.state
  expect(project(undefined, { held: false })).toMatchObject({ actions: {
    checkpoint: { allowed: false, reason: 'recovery-required' }, prepare: { allowed: true },
    restore: { allowed: false, reason: 'checkpoint-required' }, ingress: { allowed: false, reason: 'recovery-required' } } })
  const cuts = checkpoints(state)
  const complete = cuts.complete
  if (complete?.status !== 'completed') throw new Error('Fixture has no complete checkpoint')
  const snapshot = { ...state, checkpoints: cuts, latestCheckpointId: complete.request.id }
  expect(project(snapshot).recovery).toBeUndefined()
  const compatible = { ...snapshot, checkpoints: { ...cuts, complete: { ...complete,
    manifest: { ...complete.manifest, implementationVersion: 'company/1' } } } }
  expect(project(compatible, { held: false, nativeOwner: 'unowned' })).toMatchObject({ actions: { restore: { allowed: true } },
    recovery: { checkpointId: 'complete', publishedAt: 100, time: '9007199254740993', revision: 1,
      references: { runs: 1, teams: 1, channels: 2, sessions: 2 } } })
  expect(project({ ...state, latestCheckpointId: 'missing' as never }).recovery).toBeUndefined()
  expect(project({ ...state, checkpoints: cuts, latestCheckpointId: cuts.failed!.request.id }).recovery).toBeUndefined()
})

it.each(['other-owner', 'unavailable'] as const)('refuses recovery and new preparation while native ownership is %s', async (nativeOwner) => {
  const h = await worldFixture()
  const value = project(h.state, { held: false, nativeOwner })
  expect(value.actions.restore).toEqual({ allowed: false, reason: 'ownership-unavailable' })
  expect(value.actions.prepare).toEqual({ allowed: false, reason: 'ownership-unavailable' })
})

it('distinguishes accepted work, configured command capacity, retirement and checkpoint/management admission', async () => {
  const h = await worldFixture()
  expect(project(h.state, { pending: true }).actions).toMatchObject({ checkpoint: { reason: 'preparation-in-progress' },
    restore: { reason: 'preparation-in-progress' }, prepare: { reason: 'preparation-in-progress' }, ingress: { reason: 'preparation-in-progress' } })
  expect(project(h.state, { capacity: false }).actions).toMatchObject({ checkpoint: { reason: 'request-capacity' },
    restore: { reason: 'request-capacity' }, prepare: { reason: 'request-capacity' } })
  expect(project(h.state, { driver: 'retiring' }).actions).toMatchObject({ checkpoint: { reason: 'retiring' }, ingress: { reason: 'retiring' } })
  expect(project(h.state, { driver: 'checkpointing' }).actions).toMatchObject({ checkpoint: { reason: 'checkpoint-in-progress' },
    ingress: { reason: 'checkpoint-in-progress' } })
  expect(project({ ...h.state, checkpoints: checkpoints(h.state) }).actions.checkpoint.reason).toBe('checkpoint-in-progress')
  const management = { request: { id: 'phase' as never, phase: 'paused' as const }, status: 'in-progress' as const, startedSequence: 1 }
  expect(project({ ...h.state, management: { [management.request.id]: management } }).actions.checkpoint.reason).toBe('management-in-progress')
  expect(project(h.state).actions.checkpoint).toEqual({ allowed: true, reason: 'ready' })
})

it('rejects preparation after execution and observes only active fixed-scenario ingress targets with exact horizon', async () => {
  const h = await worldFixture()
  const buyer = { id: 'buyer' as never, kind: 'person', cognition: 'agent' as const, phase: 'active' as const,
    profile: {}, profileRevision: 1, revision: 1 }
  const state = { ...h.state, phase: 'paused' as const, time: '0' as never, entities: { buyer, supplier: { ...buyer, id: 'supplier' as never } } }
  const value = project(state)
  expect(value.actions.prepare.allowed).toBe(true)
  expect(value.ingress).toEqual({ maxTime: creation.record.spec.maxTime, maxBytes: creation.record.spec.maxIngressBytes,
    targets: [{ id: 'buyer', name: text('Buyer') }, { id: 'supplier', name: text('Supplier') }] })
  expect(value.actions.ingress).toEqual({ allowed: true, reason: 'ready' })
  expect(project(h.state).actions.ingress.reason).toBe('target-unavailable')
  expect(project({ ...state, entities: { ...state.entities, ['supplier' as import('@clocky/clocky-simulation').SimulationEntityId]: { ...state.entities.supplier, phase: 'terminated' } } }).ingress.targets)
    .toHaveLength(1)
  expect(project({ ...state, ingresses: { ['one' as import('@clocky/clocky-simulation').SimulationIngressId]: {} as never,
    ['two' as import('@clocky/clocky-simulation').SimulationIngressId]: {} as never } }).actions.ingress.reason).toBe('ingress-capacity')
  for (const patch of [{ phase: 'running' }, { time: '1' }, { decisions: { decision: decision('decision', '0') } },
    { operations: { operation: operation('operation') } }, { ingresses: { input: {} } },
    { entities: { buyer: { ...buyer, writer: { phase: 'released' } } } }]) {
    expect(project({ ...state, ...patch } as SimulationSnapshot).actions.prepare.reason).toBe('scenario-progressed')
  }
  expect(project(state, { unstarted: false }).actions.prepare.reason).toBe('scenario-progressed')
})
