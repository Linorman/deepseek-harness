/** Coordinated mailbox cuts retain exact original messages and resource responsibility; projections are never restore truth. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { simulationFederationTimeSchema } from '@clocky/clocky-simulation'
import stringify from 'fast-json-stable-stringify'
import { federationMessageSchema, federationReceiptSchema, foldFederationMailboxTime } from './federation-mailbox.ts'
import type { LogArchive, LogArchiveLimits } from '@clocky/clocky-storage'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { verifyWorldArchive } from '@clocky/clocky-simulation-team'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type FederationMailbox from './federation-mailbox.ts'
import type { FederationMailboxTime } from './federation-mailbox.ts'
import type FederationOwnership from './federation-ownership.ts'
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const streamSchema = z.strictObject({ name: z.string().min(1), version: z.literal(1),
  entries: z.array(z.strictObject({ sequence: z.number().int().nonnegative(), value: z.json() })) })
const heldStream = z.strictObject({ sha256: hash, archive: streamSchema })
const checkpointSchema = z.strictObject({ format: z.literal('world-federation-checkpoint/1'), registry: heldStream,
  partitions: z.array(z.strictObject({ runId: z.string().min(1), generation: z.number().int().nonnegative(),
    mailbox: heldStream, world: z.json(), worldHash: hash })).min(2) })
/** Complete original coordinator and mailbox prefixes at a consistent protected cut. */
export type FederationCheckpoint = z.infer<typeof checkpointSchema>
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/**
 * Freeze mailbox queues and their paused Native collections in stable run order, then the resource coordinator.
 * @param ownership - Actual canonical coordinator service; local fallback ownership is unsupported.
 * @param coordinatorCall - Current coordinator Host lease.
 * @param partitions - Every participating actual mailbox and its own Host lease, ordered internally to avoid gate inversion.
 * @param limits - Complete result bytes and aggregate entries.
 * @returns Self-contained versioned cut with in-flight original responsibility and hashes; no model or transport IO occurs.
 */
export async function captureFederationCheckpoint(ownership: FederationOwnership, coordinatorCall: AuthenticatedProductCall,
  partitions: readonly { runId: string
    generation: number
    mailbox: FederationMailbox
    connection: SimulationTeamConnection
    call: AuthenticatedProductCall }[],
  limits: LogArchiveLimits): Promise<FederationCheckpoint> {
  if (partitions.length < 2 || new Set(partitions.map(p => p.runId)).size !== partitions.length)
    throw new Error('Federation checkpoint requires distinct complete partitions')
  const ordered = [...partitions].sort((a, b) => a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0)
  const retained: FederationCheckpoint['partitions'] = []
  const hold = async (index: number): Promise<FederationCheckpoint> => {
    const selected = ordered[index]
    if (selected === undefined) return ownership.withCheckpoint(coordinatorCall, (archive) => {
      const value = { format: 'world-federation-checkpoint/1' as const,
        registry: { sha256: digest(archive), archive }, partitions: retained }
      return verifyFederationCheckpoint(JSON.stringify(value), limits)
    })
    // Clock synchronization already holds mailbox admission while committing the Native fence.
    // Native driving reads only that durable fence, so it never acquires this mailbox in reverse order.
    return selected.mailbox.withCheckpoint(selected.call, async (state, archive) => {
      if (state.runId !== selected.runId || state.generation !== selected.generation)
        throw new Error('Federation checkpoint partition generation mismatch')
      const collection = await selected.connection.collectCheckpointCandidate(
        8, 3, selected.call.signal, 'quiescent')
      try {
        const world = await collection.exportArchive(limits)
        const snapshot = z.object({ spec: z.object({ runId: z.string() }) }).parse(world.snapshot)
        if (snapshot.spec.runId !== state.runId) throw new Error('Federation mailbox and Native run identity differ')
        retained.push({ runId: state.runId, generation: state.generation,
          mailbox: { sha256: digest(archive), archive: streamSchema.parse(archive) },
          world: z.json().parse(world), worldHash: digest(world) })
        return await hold(index + 1)
      } finally { collection.release() }
    })
  }
  return hold(0)
}

/**
 * Validate complete prefix hashes, coordinator policy and cross-partition originals before isolated owner replay.
 * @param text - Untrusted exact checkpoint bytes.
 * @param limits - Complete byte and entry bounds.
 * @returns Validated original streams; installing owners must additionally replay their strict versioned events.
 */
export function verifyFederationCheckpoint(text: string, limits: LogArchiveLimits): FederationCheckpoint {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || !Number.isSafeInteger(limits.maxEntries)
    || limits.maxEntries < 1 || Buffer.byteLength(text) > limits.maxBytes) throw new Error('Federation checkpoint byte/entry allowance invalid')
  const value = checkpointSchema.parse(JSON.parse(text))
  const streams = [value.registry, ...value.partitions.map(p => p.mailbox)]
  let count = 0
  for (const held of streams) {
    if (digest(held.archive) !== held.sha256) throw new Error('Federation checkpoint stream hash mismatch')
    for (const [index, entry] of held.archive.entries.entries()) if (entry.sequence !== index) throw new Error('Federation checkpoint sequence gap')
    count += held.archive.entries.length
  }
  if (count > limits.maxEntries) throw new Error('Federation checkpoint aggregate entry allowance exceeded')
  for (const partition of value.partitions) {
    if (digest(partition.world) !== partition.worldHash) throw new Error('Federation world checkpoint hash mismatch')
    const world = verifyWorldArchive(JSON.stringify(partition.world), limits)
    if (z.object({ spec: z.object({ runId: z.string() }) }).parse(world.snapshot).spec.runId !== partition.runId)
      throw new Error('Federation world checkpoint belongs to another partition')
    verifyNativeMailboxReferences(world, partition)
    let retained = world.provenance?.[0]
    while (retained !== undefined) {
      const ancestor = verifyWorldArchive(JSON.stringify(retained), limits)
      const runId = z.object({ spec: z.object({ runId: z.string() }) }).parse(ancestor.snapshot).spec.runId
      const owner = value.partitions.find(candidate => candidate.runId === runId)
      const hasFence = z.object({ federationTime: z.unknown().optional() }).parse(ancestor.snapshot).federationTime !== undefined
        || ancestor.native.entries.some(entry => z.object({ kind: z.literal('run/federation-time') }).safeParse(entry.value).success)
      if (hasFence && owner === undefined) throw new Error('Federation provenance mailbox closure is unavailable')
      if (owner !== undefined) verifyNativeMailboxReferences(ancestor, owner)
      count += ancestor.native.entries.length + ancestor.owners.reduce((sum, owner) => sum + owner.entries.length, 0)
        + ancestor.sessions.reduce((sum, session) => sum + session.events.length, 0)
      retained = ancestor.provenance?.[0]
    }
    count += world.native.entries.length + world.owners.reduce((sum, owner) => sum + owner.entries.length, 0)
      + world.sessions.reduce((sum, session) => sum + session.events.length, 0)
  }
  if (count > limits.maxEntries) throw new Error('Federation checkpoint aggregate entry allowance exceeded')
  const ids = value.partitions.map(p => p.runId)
  if (new Set(ids).size !== ids.length) throw new Error('Federation checkpoint duplicates a partition')
  const policy = z.object({ kind: z.literal('policy'), policy: z.object({
    partitions: z.array(z.object({ runId: z.string(), principalId: z.string() })) }) }).parse(value.registry.archive.entries[0]?.value)
  if (policy.policy.partitions.length !== ids.length || policy.policy.partitions.some(p => !ids.includes(p.runId)))
    throw new Error('Federation checkpoint omits a coordinator partition')
  for (const entry of value.registry.archive.entries) z.object({ kind: z.enum([
    'policy', 'register', 'reserve', 'confirm', 'settle', 'spend']) }).parse(entry.value)
  const receipts: { sourceRun: string; receipt: z.infer<typeof federationReceiptSchema> }[] = []
  const inboxPositions = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  const acceptedCauses = new Map<string, Set<string>>()
  const outbound = new Map<string, unknown>(), inbound = new Map<string, unknown>()
  const messages: { sourceRun: string; targetRun: string; sourceGeneration: number; targetGeneration: number }[] = []
  for (const partition of value.partitions) {
    const created = z.object({ kind: z.literal('created'), policy: z.object({ runId: z.string(), generation: z.number(),
      principalId: z.string(), peers: z.array(z.object({ runId: z.string(), generation: z.number(), principalId: z.string() })) }) })
      .parse(partition.mailbox.archive.entries[0]?.value)
    if (created.policy.runId !== partition.runId || created.policy.generation !== partition.generation
      || policy.policy.partitions.find(p => p.runId === partition.runId)?.principalId !== created.policy.principalId
      || created.policy.peers.some(peer => value.partitions.find(p => p.runId === peer.runId)?.generation !== peer.generation
        || policy.policy.partitions.find(p => p.runId === peer.runId)?.principalId !== peer.principalId))
      throw new Error('Federation checkpoint mailbox original authority policy differs from its partition')
  }
  for (const partition of value.partitions) for (const entry of partition.mailbox.archive.entries) {
    const event = z.object({ kind: z.enum(['created', 'outbound-boundary', 'inbound-boundary', 'clock', 'stop', 'outbox', 'inbox', 'receipt']),
      message: z.json().optional(), receipt: z.json().optional(), principalId: z.string().optional() }).parse(entry.value)
    if (event.kind === 'receipt') {
      const receipt = federationReceiptSchema.parse(event.receipt)
      if (policy.policy.partitions.find(p => p.runId === receipt.targetRun)?.principalId !== event.principalId)
        throw new Error('Federation checkpoint receipt has no actual target authority')
      receipts.push({ sourceRun: partition.runId, receipt })
    }
    if (event.kind !== 'outbox' && event.kind !== 'inbox') continue
    const wire = federationMessageSchema.parse(event.message)
    if ((event.kind === 'outbox' ? wire.sourceRun : wire.targetRun) !== partition.runId) throw new Error('Federation checkpoint message owner mismatch')
    const key = JSON.stringify([wire.sourceRun, wire.sourceGeneration, wire.targetRun, wire.targetGeneration, wire.messageId])
    const selected = event.kind === 'outbox' ? outbound : inbound
    if (selected.has(key)) throw new Error('Federation checkpoint message repeats')
    const sequenceKey = JSON.stringify([event.kind, wire.sourceRun, wire.sourceGeneration, wire.targetRun, wire.targetGeneration])
    if (wire.sourceSequence !== (sourceCounts.get(sequenceKey) ?? 0)) throw new Error('Federation checkpoint source sequence gap')
    sourceCounts.set(sequenceKey, wire.sourceSequence + 1)
    if (event.kind === 'inbox') {
      const causes = acceptedCauses.get(wire.targetRun) ?? new Set<string>()
      if (event.principalId !== policy.policy.partitions.find(p => p.runId === wire.sourceRun)?.principalId
        || wire.after.some(cause => !causes.has(JSON.stringify([wire.sourceRun, wire.sourceGeneration, cause]))))
        throw new Error('Federation checkpoint inbox author or causal reference is unauthorized')
      const identity = JSON.stringify([wire.sourceRun, wire.sourceGeneration, wire.messageId])
      if (causes.has(identity)) throw new Error('Federation checkpoint repeats an inbox message identity')
      causes.add(identity); acceptedCauses.set(wire.targetRun, causes)
      inboxPositions.set(key, wire.sourceSequence)
    }
    selected.set(key, event.message); messages.push(wire)
  }
  for (const wire of messages) {
    if (value.partitions.find(p => p.runId === wire.sourceRun)?.generation !== wire.sourceGeneration
      || value.partitions.find(p => p.runId === wire.targetRun)?.generation !== wire.targetGeneration)
      throw new Error('Federation checkpoint message crosses missing or stale partition')
  }
  for (const [key, message] of inbound) if (!outbound.has(key) || digest(outbound.get(key)) !== digest(message))
    throw new Error('Federation checkpoint inbox lost original source responsibility')
  for (const { sourceRun, receipt } of receipts) {
    const sourceGeneration = value.partitions.find(p => p.runId === sourceRun)?.generation
    const key = JSON.stringify([sourceRun, sourceGeneration, receipt.targetRun, receipt.targetGeneration, receipt.messageId])
    if (!inbound.has(key) || !outbound.has(key) || inboxPositions.get(key) !== receipt.inboxSequence
      || createHash('sha256').update(stringify(outbound.get(key))).digest('hex') !== receipt.digest
      || value.partitions.find(p => p.runId === receipt.targetRun)?.generation !== receipt.targetGeneration)
      throw new Error('Federation checkpoint receipt lost its original durable target acceptance')
  }
  return value
}
/** Native bridge evidence references an original mailbox prefix, never an arbitrary self-consistent pair of archives. */
function verifyNativeMailboxReferences(world: ReturnType<typeof verifyWorldArchive>,
  partition: FederationCheckpoint['partitions'][number]): void {
  const snapshot = z.object({ federationTime: simulationFederationTimeSchema.optional() }).parse(world.snapshot)
  const originals = world.native.entries.flatMap((entry) => {
    const kind = z.object({ kind: z.string() }).safeParse(entry.value)
    if (kind.success && kind.data.kind === 'run/federation-time')
      return [z.object({ evidence: simulationFederationTimeSchema }).parse(entry.value).evidence]
    return []
  })
  if (snapshot.federationTime === undefined && originals.length === 0) return
  if (snapshot.federationTime === undefined || !isDeepStrictEqual(originals.at(-1), snapshot.federationTime))
    throw new Error('Federation Native fence projection lost its original evidence')
  const archive = partition.mailbox.archive
  const required = new Map<number, z.infer<typeof simulationFederationTimeSchema>[]>()
  for (const evidence of originals) {
    if (evidence.ownerId !== archive.name || evidence.runId !== partition.runId || evidence.generation !== partition.generation
      || evidence.sourceSequence >= archive.entries.length) throw new Error('Federation Native mailbox reference scope or prefix is unavailable')
    const references = required.get(evidence.sourceSequence) ?? []
    references.push(evidence); required.set(evidence.sourceSequence, references)
  }
  // Hash original prefixes in one pass, avoiding quadratic rescans for long Native time histories.
  const empty = JSON.stringify({ name: archive.name, version: archive.version, entries: [] })
  const prefix = createHash('sha256').update(empty.slice(0, -2))
  let timeFacts: FederationMailboxTime = { time: '0', stoppedPeers: [] }
  for (const [index, entry] of archive.entries.entries()) {
    timeFacts = foldFederationMailboxTime(timeFacts, entry.value)
    if (index !== 0) prefix.update(',')
    prefix.update(JSON.stringify(entry))
    const references = required.get(index)
    if (references !== undefined) {
      const actual = prefix.copy().update(']}').digest('hex')
      const stopped = new Set(timeFacts.stoppedPeers)
      if (references.some(evidence => evidence.sourceHash !== actual || evidence.limit !== timeFacts.time
        || evidence.blockedPeers.length !== stopped.size || evidence.blockedPeers.some(peer => !stopped.has(peer))))
        throw new Error('Federation Native mailbox prefix hash or state mismatch')
    }
  }
}

/**
 * Select exact original stream bytes for isolated backend import, retaining per-owner stream identity.
 * @param checkpoint - Previously verified complete cut.
 * @returns Original coordinator and partition streams; callers must never append these into active live owners.
 */
export function federationCheckpointStreams(checkpoint: FederationCheckpoint): {
  registry: LogArchive
  partitions: { runId: string; archive: LogArchive }[]
} {
  return { registry: checkpoint.registry.archive,
    partitions: checkpoint.partitions.map(p => ({ runId: p.runId, archive: p.mailbox.archive })) }
}
