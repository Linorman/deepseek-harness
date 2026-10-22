/** Canonical local-mutation request/plan fixture shared by process and in-process verification. */
import { WORLD_LOCAL_OBJECT_PIN, simulationEntityIdSchema, simulationChangeSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { LocalObjectWorldExecution } from '../../simulation-world/src/local-object.ts'
export async function localObjectFixture(backend: 'json' | 'sqlite',
  options: Pick<NonNullable<Parameters<typeof hiringResourceHarness>[2]>, 'loadedContext' | 'evidenceRoot'> = {}) {
  const scopeEntityId = simulationEntityIdSchema.parse('fee-org')
  const targets = ['object-a', 'object-b'].map(value => simulationEntityIdSchema.parse(value))
  const h = await hiringResourceHarness(backend, 'hire-existing', { ...options, installedPins: [WORLD_LOCAL_OBJECT_PIN],
    extraEntities: targets.map(id => ({ id, entityKind: 'object' })),
    positionRolePermissions: [{ positionEntityId: simulationEntityIdSchema.parse('fee-role'), permissions: [{
      domain: 'organization', operation: 'rename-object', version: '1', scopeEntityId, targetEntityId: targets[0]!, relation: 'can-rename' }] }],
    extraOperationGrants: targets.map(targetEntityId => ({ requesterEntityId: simulationEntityIdSchema.parse('buyer'),
      domain: 'organization', operation: 'rename-object', version: '1', scopeEntityId, targetEntityId,
      relationId: `rename:${targetEntityId}` as import('@clocky/clocky-simulation').SimulationRelationId, relation: 'can-rename' })),
  })
  await h.run.setPhase('paused', h.run.snapshot().revision)
  for (const id of targets) await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id,
    entityRevision: h.run.snapshot().entities[id]!.revision, profile: { name: id } }), h.run.snapshot().revision)
  await h.start()
  const payload = (id: (typeof targets)[number]) => ({ scopeEntityId, targetEntityId: id,
    entityRevision: h.run.snapshot().entities[id]!.revision, name: `Renamed ${id}` })
  const request = async (id: (typeof targets)[number]) => {
    const input = payload(id)
    const action = { kind: 'world/request', domain: 'organization', operation: 'rename-object', version: '1',
      businessKey: id, expectedTime: null, evidence: [], payload: input }
    await h.propose(h.requester, `request:${id}`, action, { kind: 'goal' })
    return { input, action, request: Object.values(h.run.snapshot().world!.requests).find(value => value.proposal.businessKey === id)! }
  }
  const first = await request(targets[0]!)
  await h.run.drive({ until: h.run.snapshot().time })
  await h.connection.dispatchOperation(first.request.notificationOperationId!, () => Date.now())
  const wake = await h.connection.receiveOperation(first.request.notificationOperationId!)
  await h.run.drive({ until: h.run.snapshot().time })
  await h.propose(h.director, 'rename-plan', { kind: 'world/resolve', requestId: first.request.id, supersedes: null,
    resolution: { kind: 'apply', rationale: 'Rename original isolated object.', payload: first.input } },
  { kind: 'resolve', requestId: first.request.id }, wake)
  const plan = Object.values(h.run.snapshot().world!.plans).at(-1)!
  const handler = new LocalObjectWorldExecution(h.run, h.connection,
    { checkpointId: 'unused' as never, ownerName: 'local-object-test', maxDrainRounds: 4, maxAttempts: 3 }, h.lifetime.signal)
  return { ...h, first, plan, handler, request, targets }
}
