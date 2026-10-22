import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { z } from 'zod'
import type { LogStream } from '@clocky/clocky-storage'
import { createHash } from 'node:crypto'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema } from '@clocky/clocky-simulation'
import { importArchiveLogs, restoreWorldArchive, verifyWorldArchive } from '@clocky/clocky-simulation-team'
import Mailbox from '../src/federation-mailbox.ts'
import Ownership from '../src/federation-ownership.ts'
import { captureFederationCheckpoint, verifyFederationCheckpoint, federationCheckpointStreams } from '../src/federation-checkpoint.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { registration, call } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('captures %s Native/mailbox/coordinator cuts and restores unknown transfer responsibility from original streams', async (backend) => {
  const parent = resolve('.tmp/world-post-mvp/e2'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, `checkpoint-${backend}-`))
  const a = await createContext(join(root, 'a'), backend), b = await createContext(join(root, 'b'), backend)
  const c = await createContext(join(root, 'c'), backend), restored = await createContext(join(root, 'restored'), backend)
  const ar = registration('a'), br = registration('b'), aid = String(ar.spec.runId), bid = String(br.spec.runId)
  const source = await a.ctx.simulations.open(a.ctx.simulations.resolve({ provider: 'local', spec: ar.spec, mode: 'create' }))
  const target = await b.ctx.simulations.open(b.ctx.simulations.resolve({ provider: 'local', spec: br.spec, mode: 'create' }))
  const mailboxConfig = (runId: string, peer: string, principalId: string, peerPrincipal: string) => ({ stream: `mail-${runId}`,
    runId, generation: 1, principalId, peers: [{ runId: peer, generation: 1, principalId: peerPrincipal }],
    maxEntries: 100, maxEntryBytes: 1024 * 1024, pageSize: 4 })
  const ac = mailboxConfig(aid, bid, 'a', 'b'), bc = mailboxConfig(bid, aid, 'b', 'a')
  const ownershipConfig = { stream: 'federation-ownership', coordinatorPrincipalId: 'coordinator',
    partitions: [{ runId: aid, principalId: 'a' }, { runId: bid, principalId: 'b' }],
    maxEntries: 100, maxEntryBytes: 1024 * 1024, pageSize: 4 }
  await a.ctx.plugin(Mailbox, ac); await b.ctx.plugin(Mailbox, bc); await c.ctx.plugin(Ownership, ownershipConfig)
  const teamA = await a.ctx.simulationTeams.ensureTeam(source, { goal: { objective: 'partition a', budgets: {} }, budgets: {} }, 'partition/a')
  const teamB = await b.ctx.simulationTeams.ensureTeam(target, { goal: { objective: 'partition b', budgets: {} }, budgets: {} }, 'partition/b')
  const ca = await a.ctx.simulationTeams.attach(source, teamA.team.id, 'partition/a')
  const cb = await b.ctx.simulationTeams.attach(target, teamB.team.id, 'partition/b')
  const local = call(undefined, 'a'), remote = call(undefined, 'b'), coordinator = call(undefined, 'coordinator')
  const limits = { maxEntries: 10000, maxBytes: 8 * 1024 * 1024, pageSize: 4 }
  try {
    await source.setPhase('paused', source.snapshot().revision); await target.setPhase('paused', target.snapshot().revision)
    const acknowledged = await a.ctx.federationMailbox.enqueue({ messageId: 'acknowledged', targetRun: bid, after: [], body: 'first' }, local)
    await a.ctx.federationMailbox.acknowledge(await b.ctx.federationMailbox.receive(acknowledged, local), remote)
    const delivered = await a.ctx.federationMailbox.enqueue({ messageId: 'delivered-no-reply', targetRun: bid, after: [], body: 'original' }, local)
    await b.ctx.federationMailbox.receive(delivered, local)
    await a.ctx.federationMailbox.enqueue({ messageId: 'not-delivered', targetRun: bid, after: [], body: 'in-flight' }, local)
    await c.ctx.federationOwnership.register({ objectId: 'shared-credit', home: aid, quantity: '7' }, coordinator)
    await c.ctx.federationOwnership.reserve({ transferId: 'unknown-transfer', objectId: 'shared-credit', source: aid, target: bid, generation: 0 }, local)
    // The actual Native append is blocked while its executor and mailbox gates are occupied.
    // Reversed checkpoint lock order would deadlock after this barrier releases.
    const nativeStream = Reflect.get(source, 'stream') as LogStream
    const append = nativeStream.append.bind(nativeStream)
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    let blockSync = true
    nativeStream.append = async (...args) => {
      if (blockSync) { blockSync = false; entered.resolve(undefined); await release.promise }
      return append(...args)
    }
    const synchronized = a.ctx.federationMailbox.syncNativeClock(source, local)
    await entered.promise
    let checkpointDone = false
    const pending = captureFederationCheckpoint(c.ctx.federationOwnership, coordinator, [
      { runId: aid, generation: 1, mailbox: a.ctx.federationMailbox, connection: ca, call: local },
      { runId: bid, generation: 1, mailbox: b.ctx.federationMailbox, connection: cb, call: remote },
    ], limits).then((value) => { checkpointDone = true; return value })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(checkpointDone).toBe(false)
    release.resolve(undefined)
    const [, initialCheckpoint] = await Promise.all([synchronized, pending])
    let checkpoint = initialCheckpoint
    nativeStream.append = append
    await a.ctx.federationMailbox.enqueue({ messageId: 'after-native-cut', targetRun: bid, after: [], body: 'later mailbox responsibility' }, local)
    checkpoint = await captureFederationCheckpoint(c.ctx.federationOwnership, coordinator, [
      { runId: aid, generation: 1, mailbox: a.ctx.federationMailbox, connection: ca, call: local },
      { runId: bid, generation: 1, mailbox: b.ctx.federationMailbox, connection: cb, call: remote },
    ], limits)
    const sourcePartition = checkpoint.partitions.find(p => p.runId === aid)!
    const sourceWorld = verifyWorldArchive(JSON.stringify(sourcePartition.world), limits)
    const retainedFence = z.object({ federationTime: z.object({ sourceSequence: z.number() }) }).parse(sourceWorld.snapshot).federationTime
    expect(sourcePartition.mailbox.archive.entries.length).toBeGreaterThan(retainedFence.sourceSequence + 1)
    const changedFence = (changes: Record<string, unknown>, removeCursor = false) => {
      const changed = structuredClone(checkpoint), partition = changed.partitions.find(p => p.runId === aid)!
      const world = verifyWorldArchive(JSON.stringify(partition.world), limits)
      const snapshot = z.record(z.string(), z.json()).parse(world.snapshot)
      const fence = z.record(z.string(), z.json()).parse(snapshot['federationTime'])
      const updated = z.record(z.string(), z.json()).parse({ ...fence, ...changes })
      if (removeCursor) delete updated['sourceSequence']
      world.snapshot = { ...snapshot, federationTime: updated }
      const original = world.native.entries.findLast(entry =>
        z.object({ kind: z.string() }).parse(entry.value).kind === 'run/federation-time')!
      original.value = { ...z.record(z.string(), z.json()).parse(original.value), evidence: updated }
      partition.world = z.json().parse(world)
      partition.worldHash = createHash('sha256').update(JSON.stringify(partition.world)).digest('hex')
      return changed
    }
    for (const change of [{ ownerId: 'foreign-mailbox' }, { runId: bid }, { generation: 2 },
      { sourceSequence: sourcePartition.mailbox.archive.entries.length }, { sourceSequence: 0 },
      { sourceHash: 'f'.repeat(64) }, { limit: '1' }, { blockedPeers: ['unrecorded-stop'] }])
      expect(() => verifyFederationCheckpoint(JSON.stringify(changedFence(change)), limits)).toThrow(/Native mailbox/)
    expect(() => verifyFederationCheckpoint(JSON.stringify(changedFence({}, true)), limits)).toThrow()
    const unclosed = structuredClone(checkpoint), selected = unclosed.partitions.find(p => p.runId === aid)!
    const descendant = verifyWorldArchive(JSON.stringify(selected.world), limits), ancestor = structuredClone(descendant)
    const ancestorState = z.object({ revision: z.number(), spec: z.record(z.string(), z.json()) }).parse(ancestor.snapshot)
    ancestor.snapshot = { ...z.record(z.string(), z.json()).parse(ancestor.snapshot),
      spec: { ...ancestorState.spec, runId: 'unrepresented-provenance' } }
    const refs = z.record(z.string(), z.json()).parse(ancestor.references)
    ancestor.references = { ...refs, run: { ...z.record(z.string(), z.json()).parse(refs['run']), runId: 'unrepresented-provenance' } }
    const retained = verifyWorldArchive(JSON.stringify(ancestor), limits)
    descendant.provenance = [z.json().parse(retained)]
    descendant.snapshot = { ...z.record(z.string(), z.json()).parse(descendant.snapshot), experiment: {
      sourceHash: createHash('sha256').update(JSON.stringify(retained)).digest('hex'),
      parentRunId: 'unrepresented-provenance', sourceRevision: ancestorState.revision,
    } }
    selected.world = z.json().parse(descendant)
    selected.worldHash = createHash('sha256').update(JSON.stringify(selected.world)).digest('hex')
    expect(() => verifyFederationCheckpoint(JSON.stringify(unclosed), limits)).toThrow(/provenance mailbox closure/)
    expect(verifyFederationCheckpoint(JSON.stringify(checkpoint), limits)).toEqual(checkpoint)
    expect(checkpoint.partitions).toHaveLength(2)
    for (const partition of checkpoint.partitions) {
      const record = partition.runId === aid ? ar : br
      const selection = simulationRunSelectionSchema.parse({ provider: 'local', spec: record.spec, mode: 'open' })
      await restoreWorldArchive(JSON.stringify(partition.world), join(root, `world-restored-${partition.runId}`), limits, {}, async (staging) => {
        const owner = await createContext(staging, backend)
        const nativeRoot = join(staging, 'simulation', createHash('sha256').update(partition.runId).digest('hex'))
        await mkdir(nativeRoot, { recursive: true })
        const native = backend === 'json' ? new JsonStorageBackend(join(nativeRoot, 'journal'))
          : new SqliteStorageBackend({ path: join(nativeRoot, 'journal.sqlite'), journalMode: 'wal' })
        return { ctx: owner.ctx, native: native.log, owners: owner.ctx.storage.backend.get(backend).log!, async validate() {
          await native.close()
          const restoredRun = await owner.ctx.simulations.open(selection)
          try {
            expect(restoredRun.snapshot().phase).toBe('paused')
            const restoredConnection = await owner.ctx.simulationTeams.attach(restoredRun, restoredRun.snapshot().teamReservation!.teamId,
              partition.runId === aid ? 'partition/a' : 'partition/b')
            try {
              const checkpointId = simulationCheckpointIdSchema.parse('federation/import-anchor')
              if (restoredRun.snapshot().checkpoints?.[checkpointId]?.status !== 'completed') {
                const result = await restoredConnection.checkpoint({ id: checkpointId, implementationVersion: 'federation/1',
                  maxDrainRounds: 4, maxAttempts: 3 })
                expect(result.status).toBe('completed')
              }
              return { checkpointId, implementationVersion: 'federation/1' }
            } finally { await restoredConnection.close() }
          } finally { await restoredRun.close() }
        }, async close() { await native.close(); await owner.ctx.fiber.dispose() } }
      })
    }
    const bad = structuredClone(checkpoint); bad.registry.archive.entries[0]!.value = {}
    expect(() => verifyFederationCheckpoint(JSON.stringify(bad), limits)).toThrow(/hash mismatch/)
    const missingOriginal = structuredClone(checkpoint)
    const sourceStream = missingOriginal.partitions.find(p => p.runId === aid)!.mailbox
    sourceStream.archive.entries.splice(sourceStream.archive.entries.findIndex(entry =>
      z.object({ kind: z.string() }).parse(entry.value).kind === 'outbox'), 1)
    sourceStream.archive.entries.forEach((entry, index) => { entry.sequence = index })
    sourceStream.sha256 = createHash('sha256').update(JSON.stringify(sourceStream.archive)).digest('hex')
    expect(() => verifyFederationCheckpoint(JSON.stringify(missingOriginal), limits)).toThrow()
    const unknownEvent = structuredClone(checkpoint), ownerStream = unknownEvent.partitions[0]!.mailbox
    ownerStream.archive.entries.push({ sequence: ownerStream.archive.entries.length, value: { kind: 'future-required-event' } })
    ownerStream.sha256 = createHash('sha256').update(JSON.stringify(ownerStream.archive)).digest('hex')
    expect(() => verifyFederationCheckpoint(JSON.stringify(unknownEvent), limits)).toThrow()
    const bytes = Buffer.byteLength(JSON.stringify(checkpoint))
    expect(() => verifyFederationCheckpoint(JSON.stringify(checkpoint), { ...limits, maxBytes: bytes })).not.toThrow()
    expect(() => verifyFederationCheckpoint(JSON.stringify(checkpoint), { ...limits, maxBytes: bytes - 1 })).toThrow(/allowance/)
    expect(() => verifyFederationCheckpoint(JSON.stringify(checkpoint), { ...limits, maxEntries: 1 })).toThrow(/entry allowance/)
    const parts = federationCheckpointStreams(checkpoint), facet = restored.ctx.storage.backend.get(backend).log!
    await importArchiveLogs(facet, [parts.registry, ...parts.partitions.map(p => p.archive)])
    await restored.ctx.plugin(Ownership, ownershipConfig)
    expect(await restored.ctx.federationOwnership.inspect(coordinator)).toMatchObject({
      resources: [{ home: aid, generation: 0, quantity: '7' }], transfers: [{ transferId: 'unknown-transfer', status: 'reserved' }] })
    await expect(restored.ctx.federationOwnership.spend({ operationId: 'cannot-spend-unknown', objectId: 'shared-credit', home: aid,
      generation: 0, amount: '1' }, local)).rejects.toThrow(/reserved/)
    await restored.ctx.plugin(Mailbox, ac)
    const state = await restored.ctx.federationMailbox.inspect(local)
    expect(state.outbox).toHaveLength(4)
    expect(state.outbox.filter(item => item.receipt === undefined)).toHaveLength(3)
    await expect(importArchiveLogs(facet, [parts.registry])).rejects.toThrow(/already exists/)
  } finally {
    await ca.close(); await cb.close(); await source.close(); await target.close()
    await Promise.all([a.ctx.fiber.dispose(), b.ctx.fiber.dispose(), c.ctx.fiber.dispose(), restored.ctx.fiber.dispose()])
  }
})
