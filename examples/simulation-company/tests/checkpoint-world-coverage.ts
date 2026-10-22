/** Independent ownership checks and actual Native publication refusals for a real collected World checkpoint. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { checkpointState, simulationCheckpointIdSchema, simulationCheckpointManifestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationCheckpointManifest } from '@clocky/clocky-simulation'

type Reference = NonNullable<SimulationCheckpointManifest['state']['world']>['records'][number]

/**
 * Check content commitments against the original owning tables, then refuse missing/changed records at a real sealed cut.
 * @param run - Real quiescent Native run with an already collected canonical checkpoint.
 * @param root - Project-local evidence directory.
 * @returns normally only after all references and rejection paths preserve original business state.
 */
export async function verifyCheckpointWorldCoverage(run: SimulationRun, root: string): Promise<void> {
  const original = run.snapshot(), checkpoint = original.latestCheckpointId === undefined ? undefined
    : original.checkpoints?.[original.latestCheckpointId]
  assert.ok(checkpoint?.status === 'completed' && original.world !== undefined)
  const manifest = checkpoint.manifest, vector = manifest.state.world
  assert.ok(vector)
  const digest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
  const expected: Reference[] = []
  const requireReference = (kind: Reference['kind'], id: string, sequence: number, value: unknown, version: string | null = null): void => {
    const record = vector.records.find(value => value.kind === kind && value.id === id && value.version === version)
    assert.ok(record, `Checkpoint omitted original ${kind}/${id}/${version}`)
    assert.equal(record.sequence, sequence)
    assert.equal(record.fingerprint, digest(value))
    expected.push(record)
  }
  const world = original.world
  const tables = [
    ['intent', world.intents], ['request', world.requests], ['plan', world.plans], ['result', world.results],
    ['mutation', world.mutations], ['reservation', world.reservations], ['cancellation', world.cancellations],
    ['proposal', world.governance.proposals], ['vote', world.governance.votes], ['resolution', world.governance.resolutions],
    ['norm-announcement', world.norms.announcements], ['personnel-reservation', world.personnel.reservations],
    ['personnel-fence', world.personnel.fences], ['external-contact', world.external.contacts],
    ['external-representative', world.external.representatives], ['external-identity', world.external.identities],
    ['external-interaction', world.external.interactions], ['external-adjudication', world.external.adjudications],
    ['evidence-challenge', world.evidence.challenges],
  ] as const
  const requireTable = (kind: Reference['kind'], table: Readonly<Record<string, { readonly sequence: number }>>): void => {
    for (const [id, value] of Object.entries(table)) requireReference(kind, id, value.sequence, value)
  }
  for (const [kind, table] of tables) requireTable(kind, table)
  for (const [id, value] of Object.entries(world.evidence.revisions))
    requireReference('evidence-revision', id, value.sequence, value, String(value.revision))
  for (const [id, value] of Object.entries(world.external.events))
    requireReference('external-event', id, value.original.adjudicationSequence, value)
  for (const [id, values] of Object.entries(world.facts)) for (const value of values)
    requireReference('fact', id, value.sequence, value, value.version)
  for (const [id, values] of Object.entries(world.norms.versions)) for (const value of values)
    requireReference('norm', id, value.sequence, value, value.version)
  for (const value of world.norms.closures) requireReference('norm-closure', value.id, value.sequence, value)
  if (original.worldBootstrap !== undefined) {
    requireReference('bootstrap', original.worldBootstrap.request.definitionHash, original.worldBootstrap.sequence,
      original.worldBootstrap, '1')
    for (const value of original.worldBootstrap.occurrences)
      requireReference('calendar-occurrence', value.eventId, value.sequence, value, String(value.occurrence))
  }
  assert.equal(expected.length, vector.records.length, 'Checkpoint has an unowned reference')
  assert.deepEqual(vector.domains, world.definition.operations)
  assert.equal(vector.definitionFingerprint, digest(world.definition))
  assert.equal(vector.projectionFingerprint, digest({ world, bootstrap: original.worldBootstrap ?? null }))

  const id = simulationCheckpointIdSchema.parse(`${manifest.id}/record-coverage`)
  await run.beginCheckpoint({ id, implementationVersion: manifest.implementationVersion, maxDrainRounds: 4, maxAttempts: 3 })
  const cut = await run.acquireCheckpointCut(4), refusals: Array<{ kind: Reference['kind']; alteration: string; revision: number }> = []
  const selected = vector.records.filter(value => ['evidence-challenge', 'evidence-revision', 'external-adjudication', 'external-event']
    .includes(value.kind))
  try {
    const actual = simulationCheckpointManifestSchema.parse({ ...manifest, id, run: cut.reference, state: checkpointState(cut.snapshot) })
    assert.ok(actual.state.world)
    for (const reference of selected) {
      for (const alteration of ['missing', 'fingerprint', 'sequence'] as const) {
        const records = actual.state.world.records.flatMap(value => value.kind !== reference.kind || value.id !== reference.id
          || value.version !== reference.version ? [value] : alteration === 'missing' ? [] : [{ ...value,
            ...alteration === 'fingerprint' ? { fingerprint: `sha256:${'f'.repeat(64)}` } : { sequence: value.sequence + 1 } }])
        const changed = simulationCheckpointManifestSchema.parse({ ...actual, state: { ...actual.state,
          world: { ...actual.state.world, records } } })
        const revision = run.snapshot().revision
        await assert.rejects(cut.publish(changed), /quiescent run prefix/)
        assert.equal(run.snapshot().revision, revision)
        refusals.push({ kind: reference.kind, alteration, revision })
      }
    }
    assert.equal((await cut.publish(actual)).status, 'completed')
  } finally { cut.release() }
  const after = run.snapshot()
  for (const key of ['world', 'worldBootstrap', 'entities', 'relations', 'resources', 'operations', 'decisions'] as const satisfies
    readonly (keyof SimulationSnapshot)[]) assert.deepEqual(after[key], original[key], `Coverage probe changed ${key}`)
  await writeFile(resolve(root, 'checkpoint-world-coverage.json'), JSON.stringify({ manifestVersion: manifest.version,
    nativeStreamVersion: manifest.run.stream.version, originalManifest: manifest, expected, refusals,
    probe: after.checkpoints?.[id], originalWorld: world, bootstrap: original.worldBootstrap ?? null,
    personaEntities: Object.values(original.entities).filter(value => value.profile['persona'] !== undefined),
    modelRoutes: manifest.state.contextVersions, pendingEvents: manifest.state.pendingEvents,
    pendingOperations: manifest.state.pendingOperations }, null, 2) + '\n')
}
