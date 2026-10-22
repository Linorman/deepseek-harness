import { simulationTemp } from './temp.ts'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  simulationChangeSchema, simulationRunSelectionSchema, simulationEntityIdSchema, simTimeSchema,
} from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationRelationId, SimulationRunId } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(backend: 'json' | 'sqlite') {
  const root = await simulationTemp('entities')
  const provider = new LocalSimulationProvider({ name: 'local', root, backend, replayPageSize: 2 }, () => {})
  cleanups.push(async () => { await provider.close(); await rm(root, { recursive: true, force: true }) })
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'company', tickUnit: 'minute', origin: '0', maxTime: '99999999999999999999', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000000000000000000000000',
    relationRules: [
      { relation: 'reports-to', subjectKinds: ['person'], objectKinds: ['person'], scopeKinds: ['org'], acyclic: true },
      { relation: 'member-of', subjectKinds: ['person'], objectKinds: ['org'], acyclic: false },
      { relation: 'peer', subjectKinds: ['person'], objectKinds: ['person'], acyclic: false },
    ],
  } })
  const run = await provider.open(selection)
  const change = (command: unknown) => run.change(simulationChangeSchema.parse(command), run.snapshot().revision)
  const entity = (id: string, kind = 'person') => change({ kind: 'entity/create', readiness: 'ready', id, entityKind: kind, cognition: 'none', profile: { name: id } })
  const relation = (id: string, subject: string, object: string, validFrom = '0', validUntil: string | null = null) =>
    change({ kind: 'relation/create', id, subject, object, relation: 'reports-to', validFrom, validUntil })
  return { provider, selection, run, change, entity, relation }
}

describe.each(['json', 'sqlite'] as const)('%s entity and organization history', (backend) => {
  it('normalizes an explicitly absent scope-kind policy before durable configuration comparison', async () => {
    const { provider, selection } = await setup(backend)
    const request = simulationRunSelectionSchema.parse({ ...selection, spec: { ...selection.spec, runId: 'optional-scope',
      relationRules: selection.spec.relationRules.map(rule => ({ ...rule, scopeKinds: rule.scopeKinds })),
    } })
    const run = await provider.open(request)
    const snapshot = run.snapshot()
    await run.close()
    const reopened = await provider.open({ ...request, mode: 'open' })
    expect(reopened.snapshot()).toEqual(snapshot)
  })

  it('isolates temporal cycles and queries by organization scope across replay and revisioned moves', async () => {
    const { run, change, entity, provider, selection } = await setup(backend)
    await entity('alice'); await entity('bob'); await entity('east', 'org'); await entity('west', 'org')
    const east = simulationEntityIdSchema.parse('east'), west = simulationEntityIdSchema.parse('west')
    const edge = { kind: 'relation/create', id: 'east-manager', subject: 'alice', object: 'bob', relation: 'reports-to',
      scope: east, validFrom: '0', validUntil: '10' }
    await change(edge)
    await change({ ...edge, id: 'west-manager', subject: 'bob', object: 'alice', scope: west })
    await change({ ...edge, id: 'unscoped-manager', subject: 'bob', object: 'alice', scope: undefined })
    expect(run.relationsAt(simTimeSchema.parse('0')).map(value => value.id))
      .toEqual(['east-manager', 'unscoped-manager', 'west-manager'])
    expect(run.relationsAt(simTimeSchema.parse('0'), east).map(value => value.id)).toEqual(['east-manager'])
    expect(run.relationsAt(simTimeSchema.parse('0'), west).map(value => value.id)).toEqual(['west-manager'])
    expect(run.relationsAt(simTimeSchema.parse('0'), null).map(value => value.id)).toEqual(['unscoped-manager'])
    const before = run.snapshot()
    await expect(change({ ...edge, kind: 'relation/update', relationRevision: 1, scope: west })).rejects.toThrow(/cycle/)
    await expect(change({ ...edge, kind: 'relation/update', relationRevision: 2, scope: east })).rejects.toThrow(/revision conflict/)
    expect(run.snapshot()).toEqual(before)
    await change({ ...edge, kind: 'relation/update', relationRevision: 1, scope: west, validFrom: '10', validUntil: null })
    expect(run.relationsAt(simTimeSchema.parse('10'), east)).toEqual([])
    expect(run.relationsAt(simTimeSchema.parse('10'), west)).toMatchObject([{ id: edge.id, scope: west, revision: 2 }])
    const detached = run.relationsAt(simTimeSchema.parse('10'), west)
    Reflect.set(detached[0]!, 'scope', east)
    expect(run.relationsAt(simTimeSchema.parse('10'), west)[0]?.scope).toBe(west)
    const expected = run.snapshot()
    await run.close()
    const reopened = await provider.open({ ...selection, mode: 'open' })
    expect(reopened.snapshot()).toEqual(expected)
    expect(reopened.relationsAt(simTimeSchema.parse('10'), west)[0]?.scope).toBe(west)
  })

  it('rejects absent or disallowed scope identities without changing the durable projection', async () => {
    const { run, change, entity } = await setup(backend)
    await entity('alice'); await entity('bob'); await entity('company', 'org')
    const command = { kind: 'relation/create', id: 'manager', subject: 'alice', object: 'bob', relation: 'reports-to',
      scope: 'company', validFrom: '0', validUntil: null }
    const before = run.snapshot()
    for (const scope of ['missing', 'constructor']) await expect(change({ ...command, scope })).rejects.toThrow(/does not exist/)
    await expect(change({ ...command, scope: 'alice' })).rejects.toThrow(/scope kind is not permitted/)
    await expect(change({ ...command, relation: 'peer' })).rejects.toThrow(/scope kind is not permitted/)
    expect(run.snapshot()).toEqual(before)
    await entity('constructor', 'org')
    await change({ ...command, scope: 'constructor' })
    expect(run.relationsAt(simTimeSchema.parse('0'), simulationEntityIdSchema.parse('constructor'))).toHaveLength(1)
  })

  it('keeps published entities and journal unchanged when a prepared batch cannot append', async () => {
    const { run, entity, provider, selection } = await setup(backend)
    await entity('alice')
    const before = run.snapshot()
    const changes = [1, 2].map(entityRevision => simulationChangeSchema.parse({ kind: 'entity/profile', id: 'alice',
      entityRevision, profile: { version: entityRevision } }))
    const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
    const append = vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('Batch append unavailable'))
    await expect(run.changeMany(changes, before.revision)).rejects.toThrow('Batch append unavailable')
    expect(run.snapshot()).toEqual(before)
    expect(stream.tailSequence).toBe(before.revision)
    append.mockRestore()
    const after = await run.changeMany(changes, before.revision)
    const id = simulationEntityIdSchema.parse('alice')
    expect(after.entities[id]).toMatchObject({ revision: 3, profile: { version: 2 } })
    expect(before.entities[id]).toMatchObject({ revision: 1, profile: { name: 'alice' } })
    await run.close()
    const reopened = await provider.open({ ...selection, mode: 'open' })
    expect(reopened.snapshot()).toEqual(after)
  })

  it('returns an entity observation tied to the global revision and preserves it across later changes', async () => {
    const { run, entity, change, provider, selection } = await setup(backend)
    await entity('alice'); await entity('bob')
    const id = simulationEntityIdSchema.parse('alice')
    const observed = run.inspectEntity(id)
    expect(observed).toEqual({ runId: selection.spec.runId, revision: run.snapshot().revision, entity: run.snapshot().entities[id] })
    await change({ kind: 'entity/profile', id: 'bob', entityRevision: 1, profile: { name: 'Bob' } })
    await expect(run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id, entityRevision: 1, profile: { name: 'Alice' } }),
      observed.revision)).rejects.toThrow(/revision conflict/)
    await change({ kind: 'entity/profile', id, entityRevision: 1, profile: { name: 'Alice' } })
    expect(observed.entity?.profile).toEqual({ name: 'alice' })
    const current = run.inspectEntity(id)
    expect(current.entity?.profile).toEqual({ name: 'Alice' })
    const detached = run.inspectEntity(id)
    detached.entity!.profile['name'] = 'caller-only'
    expect(run.inspectEntity(id).entity?.profile).toEqual({ name: 'Alice' })
    expect(run.inspectEntity(simulationEntityIdSchema.parse('missing'))).toEqual({ runId: selection.spec.runId, revision: current.revision })
    expect(run.inspectEntity(simulationEntityIdSchema.parse('toString')).entity).toBeUndefined()
    await run.close()
    const reopened = await provider.open({ ...selection, mode: 'open' })
    expect(reopened.inspectEntity(id)).toEqual(current)
  })

  it('persists profile revisions, irreversible termination and cognition-free entities without Sessions', async () => {
    const { provider, selection, run, change, entity } = await setup(backend)
    await entity('alice')
    await change({ kind: 'entity/profile', id: 'alice', entityRevision: 1, profile: { name: 'Alice', attributes: { title: 'buyer' } } })
    await change({ kind: 'entity/phase', id: 'alice', entityRevision: 2, phase: 'inactive' })
    await change({ kind: 'entity/phase', id: 'alice', entityRevision: 3, phase: 'active' })
    await change({ kind: 'entity/phase', id: 'alice', entityRevision: 4, phase: 'terminated' })
    expect(Object.values(run.snapshot().entities)).toEqual([{
      id: 'alice', kind: 'person', cognition: 'none', revision: 5, profileRevision: 2,
      phase: 'terminated', readiness: 'ready', profile: { name: 'Alice', attributes: { title: 'buyer' } },
    }])
    for (const command of [
      { kind: 'entity/phase', id: 'alice', entityRevision: 5, phase: 'active' },
      { kind: 'entity/profile', id: 'alice', entityRevision: 5, profile: {} },
    ]) await expect(change(command)).rejects.toThrow(/Terminated/)
    await expect(entity('alice')).rejects.toThrow(/already exists/)
    await expect(change({ kind: 'entity/profile', id: 'alice', entityRevision: 3, profile: {} })).rejects.toThrow(/revision conflict/)
    await expect(change({ kind: 'entity/profile', id: 'missing', entityRevision: 1, profile: {} })).rejects.toThrow(/does not exist/)
    const snapshot = run.snapshot()
    await run.close()
    const reopened = await provider.open({ ...selection, mode: 'open' })
    expect(reopened.snapshot()).toEqual(snapshot)
  })

  it('keeps overlapping and historical manager relationships distinct, including large numeric times', async () => {
    const { run, entity, relation, change, provider, selection } = await setup(backend)
    await entity('alice'); await entity('bob'); await entity('carol'); await entity('warehouse', 'org')
    await relation('10', 'alice', 'bob', '2', '10')
    await relation('2', 'bob', 'alice', '10', '20')
    await expect(relation('cycle', 'bob', 'alice', '9', '10')).rejects.toThrow(/cycle/)
    await change({ kind: 'relation/update', id: '10', subject: 'alice', object: 'carol', relation: 'reports-to',
      relationRevision: 1, validFrom: '2', validUntil: '10' })
    await change({ kind: 'relation/create', id: 'membership', subject: 'alice', object: 'warehouse', relation: 'member-of',
      validFrom: '9007199254740993', validUntil: null })
    await relation('past', 'alice', 'bob', '0', '1')
    expect(run.relationsAt(simTimeSchema.parse('2')).map(value => [value.id, value.object, value.revision])).toEqual([['10', 'carol', 2]])
    expect(run.relationsAt(simTimeSchema.parse('10')).map(value => value.id)).toEqual(['2'])
    expect(run.relationsAt(simTimeSchema.parse('9007199254740992'))).toEqual([])
    expect(run.relationsAt(simTimeSchema.parse('9007199254740993')).map(value => value.id)).toEqual(['membership'])
    expect(() => run.relationsAt(simTimeSchema.parse('100000000000000000000'))).toThrow(/maximum/)
    const snapshot = run.snapshot()
    await run.close()
    const reopened = await provider.open({ ...selection, mode: 'open' })
    expect(reopened.snapshot()).toEqual(snapshot)
  })

  it('rejects dangling, wrongly typed, unconfigured and invalid-interval relations without changing the tail', async () => {
    const { run, entity, relation, change } = await setup(backend)
    await entity('alice'); await entity('bob'); await entity('warehouse', 'org')
    await relation('manager', 'alice', 'bob')
    const snapshot = run.snapshot()
    await expect(relation('manager', 'alice', 'bob')).rejects.toThrow(/already exists/)
    await expect(relation('missing', 'ghost', 'bob')).rejects.toThrow(/does not exist/)
    await expect(relation('kinds', 'alice', 'warehouse')).rejects.toThrow(/endpoint kinds/)
    await expect(relation('self', 'alice', 'alice')).rejects.toThrow(/cycle/)
    await expect(relation('past', 'alice', 'bob', '5', '4')).rejects.toThrow(/interval/)
    await expect(relation('empty', 'alice', 'bob', '5', '5')).rejects.toThrow(/interval/)
    await expect(relation('large', 'alice', 'bob', '100000000000000000000')).rejects.toThrow(/maximum/)
    await expect(relation('large-end', 'alice', 'bob', '0', '100000000000000000000')).rejects.toThrow(/maximum/)
    await expect(change({ kind: 'relation/create', id: 'unknown', subject: 'alice', object: 'bob', relation: 'unknown',
      validFrom: '0', validUntil: null })).rejects.toThrow(/configured rule/)
    await expect(change({ kind: 'relation/update', id: 'manager', subject: 'alice', object: 'bob', relation: 'reports-to',
      relationRevision: 2, validFrom: '0', validUntil: null })).rejects.toThrow(/revision conflict/)
    await expect(change({ kind: 'relation/update', id: 'missing', subject: 'alice', object: 'bob', relation: 'reports-to',
      relationRevision: 1, validFrom: '0', validUntil: null })).rejects.toThrow(/revision conflict/)
    expect(run.snapshot()).toEqual(snapshot)
  })
})

it('uses own entity keys and stable id ordering even for object-prototype names', async () => {
  const { entity, relation, run, change } = await setup('sqlite')
  await expect(relation('bad', 'toString', 'constructor')).rejects.toThrow(/does not exist/)
  await entity('__proto__'); await entity('constructor'); await entity('toString')
  await relation('2', '__proto__', 'constructor')
  await relation('10', '__proto__', 'toString')
  await change({ kind: 'relation/create', id: '__proto__', subject: 'constructor', object: 'constructor',
    relation: 'peer', validFrom: '0', validUntil: null })
  expect(run.relationsAt(simTimeSchema.parse('0')).map(value => value.id)).toEqual(['10', '2', '__proto__'])
  expect(Object.keys(run.snapshot().entities)).toEqual(['__proto__', 'constructor', 'toString'])
})

it('rejects non-JSON metadata, extra Session fields, duplicate rules and noncanonical times at parsing', () => {
  const entity = { kind: 'entity/create', readiness: 'ready', id: 'test', entityKind: 'person', cognition: 'none', profile: {} }
  for (const profile of [{ x: undefined }, { x: 1n }, { x: NaN }, { x: new Date() }]) {
    expect(() => simulationChangeSchema.parse({ ...entity, profile })).toThrow()
  }
  expect(() => simulationChangeSchema.parse({ ...entity, sessionId: 'unauthorized' })).toThrow()
  expectTypeOf<SimulationEntityId>().not.toEqualTypeOf<SimulationRunId>()
  expectTypeOf<SimulationEntityId>().not.toEqualTypeOf<SimulationRelationId>()
  const rule = { relation: 'manager', subjectKinds: ['person'], objectKinds: ['person'], acyclic: true }
  expect(() => simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'bad', tickUnit: 'minute', origin: '0', maxTime: '100', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000000000000000000000000', relationRules: [rule, rule],
  } })).toThrow(/distinct/)
  expect(() => simulationChangeSchema.parse({ kind: 'relation/create', id: 'bad', subject: 'a', object: 'b',
    relation: 'manager', validFrom: '01', validUntil: null })).toThrow()
})

it('checks simultaneous reachability through reconverging paths with different interval bounds', async () => {
  const { entity, relation, run } = await setup('sqlite')
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j']) await entity(name)
  await relation('bc', 'b', 'c', '5', '10')
  await relation('bd', 'b', 'd', '0', '15')
  await relation('bf', 'b', 'f', '8', null)
  await relation('bg', 'b', 'g', '1', '9')
  await relation('bh', 'b', 'h', '6', '12')
  await relation('bj', 'b', 'j', '16', null)
  await relation('ce', 'c', 'e', '0', '20')
  await relation('de', 'd', 'e', '0', null)
  await relation('fe', 'f', 'e', '0', null)
  await relation('ge', 'g', 'e', '0', null)
  await relation('he', 'h', 'e', '0', null)
  await relation('je', 'j', 'e', '0', null)
  await relation('ab', 'a', 'b', '2', null)
  const snapshot = run.snapshot()
  await expect(relation('ea', 'e', 'a', '11', '12')).rejects.toThrow(/cycle/)
  expect(run.snapshot()).toEqual(snapshot)
  await relation('ea-before', 'e', 'a', '0', '1')
})

it('permits pairwise-overlapping relationships when the full cycle has no common time', async () => {
  const { entity, relation, run, change } = await setup('sqlite')
  for (const id of ['a', 'b', 'c']) await entity(id)
  await relation('ab', 'a', 'b', '0', '10')
  await relation('bc', 'b', 'c', '5', '15')
  await relation('ca', 'c', 'a', '10', '20')
  const state = run.snapshot()
  await expect(change({ kind: 'relation/update', id: 'ca', subject: 'c', object: 'a', relation: 'reports-to',
    validFrom: '9', validUntil: '20', relationRevision: 1 })).rejects.toThrow(/cycle/)
  expect(run.snapshot()).toEqual(state)
})
