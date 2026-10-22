/** Opt-in durable cross-run mailbox. Receipt confirms inbox acceptance, never an arbitrary world/resource transaction. */
import { Context, Service } from '@clocky/cordis'
import schema from '@clocky/schemastery'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { SimulationRun, SimulationSnapshot } from '@clocky/clocky-simulation'
import { simulationFederationTimeSchema } from '@clocky/clocky-simulation'
import stringify from 'fast-json-stable-stringify'
import { captureLogArchive } from '@clocky/clocky-storage'
import type { LogArchive } from '@clocky/clocky-storage'
import type { LogStream } from '@clocky/clocky-storage'
import type {} from '@clocky/clocky-storage-log'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
const id = z.string().min(1).max(128)
const logicalTime = z.string().regex(/^(0|[1-9][0-9]{0,99})$/)
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Global business identity is (sourceRun, sourceGeneration, messageId); causal IDs resolve only inside that source namespace. */
export const federationMessageSchema = z.strictObject({ version: z.literal(1), messageId: id, sourceRun: id, targetRun: id,
  sourceGeneration: sequence, targetGeneration: sequence, sourceSequence: sequence, at: logicalTime,
  after: z.array(id).max(64), body: z.string().max(16384) })
/** Receipt position is source/generation-scoped, equal to sourceSequence; private destination-global positions never leave the owner. */
export const federationReceiptSchema = z.strictObject({ version: z.literal(1), messageId: id, targetRun: id,
  targetGeneration: sequence, digest: z.string().regex(/^[a-f0-9]{64}$/), inboxSequence: sequence })
/** Exact cross-run message. */
export type FederationMessage = z.infer<typeof federationMessageSchema>
/** Durable inbox receipt. */
export type FederationReceipt = z.infer<typeof federationReceiptSchema>
/** A source promises no subsequent message earlier than this boundary; sequence covers every prior target message. */
export const federationBoundarySchema = z.strictObject({ version: z.literal(1), sourceRun: id, targetRun: id,
  sourceGeneration: sequence, targetGeneration: sequence, nextSequence: sequence, time: logicalTime })
/** Durable conservative time promise. */
export type FederationBoundary = z.infer<typeof federationBoundarySchema>
/** Complete detached mailbox inspection, including unresolved time dependencies and permanent stops. */
export interface FederationMailboxInspection {
  readonly runId: string
  readonly generation: number
  readonly time: string
  readonly stoppedPeers: readonly string[]
  readonly boundaries: readonly FederationBoundary[]
  readonly inbox: readonly { message: FederationMessage; receipt: FederationReceipt }[]
  readonly outbox: readonly { message: FederationMessage; receipt?: FederationReceipt }[]
}
const policySchema = z.strictObject({ runId: id, generation: sequence, principalId: id,
  peers: z.array(z.strictObject({ runId: id, generation: sequence, principalId: id })).max(1000) })
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('created'), policy: policySchema }),
  z.strictObject({ kind: z.literal('outbound-boundary'), boundary: federationBoundarySchema }),
  z.strictObject({ kind: z.literal('inbound-boundary'), boundary: federationBoundarySchema, principalId: id }),
  z.strictObject({ kind: z.literal('clock'), time: logicalTime }),
  z.strictObject({ kind: z.literal('stop'), peerRun: id }),
  z.strictObject({ kind: z.literal('outbox'), message: federationMessageSchema }),
  z.strictObject({ kind: z.literal('inbox'), message: federationMessageSchema, principalId: id }),
  z.strictObject({ kind: z.literal('receipt'), receipt: federationReceiptSchema, principalId: id }),
])
/** Durable mailbox time facts shared by live projection and protected checkpoint verification. */
export interface FederationMailboxTime {
  readonly time: string
  readonly stoppedPeers: readonly string[]
}
/** Project clock/stop facts from strict original frames; authority and peer-boundary admission remain the owner's responsibility.
 * @param state - Prior immutable clock/stop projection, initially time zero and no stops.
 * @param input - Original strict mailbox frame at the next cursor.
 * @returns new monotonic time/stop facts, or the same projection for another known frame; unknown formats reject.
 */
export function foldFederationMailboxTime(state: FederationMailboxTime, input: unknown): FederationMailboxTime {
  const event = eventSchema.parse(input)
  if (event.kind === 'clock') {
    if (BigInt(event.time) < BigInt(state.time)) throw new Error('Federation clock fact regressed')
    return { ...state, time: event.time }
  }
  if (event.kind === 'stop') {
    if (state.stoppedPeers.includes(event.peerRun)) throw new Error('Duplicate federation peer stop')
    return { ...state, stoppedPeers: [...state.stoppedPeers, event.peerRun] }
  }
  return state
}
/** Explicit deployment peer scopes. No ownership migration or network discovery is inferred. */
export interface FederationMailboxConfig {
  readonly stream: string
  readonly runId: string
  readonly generation: number
  readonly principalId: string
  readonly peers: { runId: string; generation: number; principalId: string }[]
  readonly maxEntries: number
  readonly maxEntryBytes: number
  readonly pageSize: number
}
export const Config: schema<FederationMailboxConfig> = schema.object({ stream: schema.string().required(),
  runId: schema.string().required(),
  generation: schema.number().min(0).step(1).required(),
  principalId: schema.string().required(),
  peers: schema.array(schema.object({ runId: schema.string().required(), generation: schema.number().min(0).step(1).required(),
    principalId: schema.string().required() })).default([]), maxEntries: schema.number().min(1).step(1).default(10000),
  maxEntryBytes: schema.number().min(1).step(1).default(65536), pageSize: schema.number().min(1).step(1).default(64) })
declare module '@clocky/cordis' { interface Context { federationMailbox: FederationMailbox } }
/** One exclusive destination inbox and source outbox; this service does not mutate Native facts. */
export default class FederationMailbox extends Service<FederationMailboxConfig> {
  static inject = ['storageLog']
  static Config = Config
  private readonly inbox = new Map<string, { message: FederationMessage; receipt: FederationReceipt }>()
  private readonly outbox = new Map<string, { message: FederationMessage; receipt?: FederationReceipt }>()
  private readonly ready: Promise<void>
  private initializedStream: LogStream | undefined
  private get stream(): LogStream {
    if (!this.initializedStream) throw new Error('Federation mailbox is not initialized')
    return this.initializedStream
  }
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false
  private entries = 0
  private time = '0'
  private readonly outgoingBoundaries = new Map<string, FederationBoundary>()
  private readonly incomingBoundaries = new Map<string, FederationBoundary>()
  private readonly stopped = new Set<string>()
  /**
   * @param ctx - Host context.
   * @param config - Finite explicit peer policy. */
  constructor(ctx: Context, private readonly config: FederationMailboxConfig) {
    super(ctx, 'federationMailbox')
    if (new Set(config.peers.map(peer => peer.runId)).size !== config.peers.length || config.peers.some(peer => peer.runId === config.runId)) throw new Error('Federation peers invalid')
    for (const value of [config.maxEntries, config.maxEntryBytes, config.pageSize]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Federation allowance invalid')
    }
    id.parse(config.runId); id.parse(config.principalId); sequence.parse(config.generation)
    this.ready = this.load()
    void this.ready.catch((_cause: unknown) => { /* Service.init and teardown observe this same startup result. */ })
    ctx.effect(() => async () => {
      this.closing = true; await Promise.allSettled([this.ready, this.tail]); await this.initializedStream?.close()
    })
  }
  protected async [Service.init](): Promise<void> { await this.ready }
  /** Persist the source original before any transport IO. Source sequence is assigned per target.
   *
   * @param input - Exact ID, peer, causal prerequisites and bounded body.
   * @param call - Source Host user lease.
   * @returns Original durable wire message. */
  enqueue(input: { messageId: string; targetRun: string; after: string[]; body: string; at?: string },
    call: AuthenticatedProductCall): Promise<FederationMessage> {
    const parsed = z.strictObject({ messageId: id, targetRun: id, at: logicalTime.default('0'),
      after: z.array(id).max(64), body: z.string().max(16384) }).parse(input)
    return this.serial(async () => {
      this.authorize(call, this.config.principalId)
      const peer = this.peer(parsed.targetRun), prior = this.outbox.get(parsed.messageId)
      if (prior) {
        if (prior.message.targetRun !== parsed.targetRun || prior.message.at !== parsed.at
          || stringify(prior.message.after) !== stringify(parsed.after)
          || prior.message.body !== parsed.body) throw new Error('Federation original message changed')
        return structuredClone(prior.message)
      }
      if (this.stopped.has(peer.runId) || BigInt(parsed.at) < BigInt(this.outgoingBoundaries.get(peer.runId)?.time ?? '0'))
        throw new Error('Federation stopped or message precedes promised boundary')
      const message = federationMessageSchema.parse({ ...parsed, version: 1, sourceRun: this.config.runId,
        targetRun: peer.runId, sourceGeneration: this.config.generation, targetGeneration: peer.generation,
        sourceSequence: [...this.outbox.values()].filter(value => value.message.targetRun === peer.runId).length })
      await this.append({ kind: 'outbox', message }); return structuredClone(message)
    }, call, this.config.principalId)
  }
  /** Accept once in destination order; missing causal predecessors reject with an explicit retryable block.
   *
   * @param input - Original wire message.
   * @param call - Authenticated configured source principal.
   * @returns Durable original inbox receipt. */
  receive(input: FederationMessage, call: AuthenticatedProductCall): Promise<FederationReceipt> {
    const message = federationMessageSchema.parse(input)
    return this.serial(async () => {
      const peer = this.peer(message.sourceRun); this.authorize(call, peer.principalId)
      this.destination(message)
      const prior = this.inbox.get(this.messageKey(message))
      if (prior) {
        if (stringify(prior.message) !== stringify(message)) throw new Error('Federation message identity collision')
        return structuredClone(prior.receipt)
      }
      if (this.stopped.has(peer.runId) || this.precedesAcceptedTime(message)) throw new Error('Federation stopped or late message refused')
      const expected = [...this.inbox.values()].filter(value => value.message.sourceRun === message.sourceRun).length
      if (message.sourceSequence !== expected || message.after.some(cause => !this.inbox.has(this.messageKey(message, cause)))) throw new Error('Federation blocked: missing sequence or causal predecessor')
      await this.append({ kind: 'inbox', message, principalId: call.principal.id })
      const accepted = this.inbox.get(this.messageKey(message))
      if (!accepted) throw new Error('Federation inbox acceptance is missing')
      return structuredClone(accepted.receipt)
    }, call, this.peer(message.sourceRun).principalId)
  }
  /** Persist a validated destination acknowledgement; lost replies leave the original outbox pending.
   *
   * @param input - Receipt for one original outbox message.
   * @param call - Authenticated destination Host lease; a source sender cannot confirm its own delivery.
   * @returns Durable receipt. */
  acknowledge(input: FederationReceipt, call: AuthenticatedProductCall): Promise<FederationReceipt> {
    const receipt = federationReceiptSchema.parse(input), peer = this.peer(receipt.targetRun)
    return this.serial(async () => {
      this.authorize(call, peer.principalId)
      const prior = this.outbox.get(receipt.messageId)
      if (!prior || !this.matches(prior.message, receipt)) throw new Error('Federation receipt does not match original')
      if (prior.receipt) {
        if (stringify(prior.receipt) !== stringify(receipt)) throw new Error('Federation receipt changed')
        return structuredClone(prior.receipt)
      }
      await this.append({ kind: 'receipt', receipt, principalId: call.principal.id }); return structuredClone(receipt)
    }, call, peer.principalId)
  }
  /** Inspect bounded originals including pending delivery responsibility; no transport or model IO occurs.
   *
   * @param call - Local Host user lease.
   * @returns Detached inbox and outbox with their original receipts. */
  async inspect(call: AuthenticatedProductCall): Promise<FederationMailboxInspection> {
    await this.ready; await this.tail; this.authorize(call, this.config.principalId)
    return this.project()
  }
  private project(): FederationMailboxInspection {
    const result: FederationMailboxInspection = { runId: this.config.runId, generation: this.config.generation, time: this.time,
      stoppedPeers: [...this.stopped], boundaries: [...this.incomingBoundaries.values()],
      inbox: [...this.inbox.values()], outbox: [...this.outbox.values()] }
    if (Buffer.byteLength(JSON.stringify(result)) > this.config.maxEntryBytes) throw new Error('Federation inspection exceeds complete byte allowance')
    return structuredClone(result)
  }
  /** Retain the authenticated mailbox cut in the actual Native executor; direct drive and event consumption enforce it.
   * @param run - The exact local Native run, initially paused when binding its first fence.
   * @param call - Current local Host lease, rechecked inside the Native queue.
   * @returns Native snapshot after its durable fence commit; no model or scheduling work occurs.
   */
  syncNativeClock(run: SimulationRun, call: AuthenticatedProductCall): Promise<SimulationSnapshot> {
    return this.serial(async () => {
      this.authorize(call, this.config.principalId)
      if (run.snapshot().spec.runId !== this.config.runId) throw new Error('Federation Native run identity mismatch')
      const sourceSequence = this.stream.tailSequence
      const archive = await captureLogArchive(this.stream, sourceSequence, { maxEntries: this.config.maxEntries,
        maxBytes: this.config.maxEntryBytes, pageSize: this.config.pageSize })
      const sourceHash = createHash('sha256').update(JSON.stringify(archive)).digest('hex')
      this.authorize(call, this.config.principalId)
      const binding = run.bindFederationTime(this.config.stream, () => {
        this.authorize(call, this.config.principalId)
        return simulationFederationTimeSchema.parse({ ownerId: this.config.stream, runId: this.config.runId,
          generation: this.config.generation, sourceSequence,
          limit: this.time, blockedPeers: [...this.stopped], sourceHash })
      })
      try { return await binding.sync() } finally { binding.dispose() }
    }, call, this.config.principalId)
  }
  /** Hold the mailbox serializer throughout a coordinated cut; callbacks must not call this mailbox recursively.
   * @param call - Local Host user lease.
   * @param capture - Owner coordinator receiving detached state and the complete immutable journal.
   * @returns the coordinator result after authority is rechecked; callbacks cannot mutate retained state.
   */
  withCheckpoint<T>(call: AuthenticatedProductCall,
    capture: (state: FederationMailboxInspection, archive: LogArchive) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      this.authorize(call, this.config.principalId)
      const archive = await captureLogArchive(this.stream, this.stream.tailSequence, { maxEntries: this.config.maxEntries,
        maxBytes: this.config.maxEntryBytes, pageSize: this.config.pageSize })
      this.authorize(call, this.config.principalId)
      return capture(this.project(), archive)
    }, call, this.config.principalId)
  }
  /** Persist a no-earlier-message promise before exporting it to a peer.
   *
   * @param targetRun - Configured destination.
   * @param time - Inclusive safe simulation boundary.
   * @param call - Local Host user lease.
   * @returns Original durable boundary. */
  sealBoundary(targetRun: string, time: string, call: AuthenticatedProductCall): Promise<FederationBoundary> {
    logicalTime.parse(time)
    return this.serial(async () => {
      this.authorize(call, this.config.principalId); const peer = this.peer(targetRun)
      const prior = this.outgoingBoundaries.get(targetRun)
      if (this.stopped.has(targetRun) || BigInt(time) < BigInt(prior?.time ?? '0')) throw new Error('Federation stopped or boundary regressed')
      const boundary: FederationBoundary = { version: 1, sourceRun: this.config.runId, targetRun,
        sourceGeneration: this.config.generation, targetGeneration: peer.generation, time,
        nextSequence: [...this.outbox.values()].filter(value => value.message.targetRun === targetRun).length }
      if (prior && stringify(prior) === stringify(boundary)) return structuredClone(prior)
      await this.append({ kind: 'outbound-boundary', boundary }); return structuredClone(boundary)
    }, call, this.config.principalId)
  }
  /** Accept a time promise only after all messages covered by its source sequence are durable here.
   *
   * @param input - Exact source promise.
   * @param call - Authenticated source Host lease.
   * @returns Durable accepted promise. */
  receiveBoundary(input: FederationBoundary, call: AuthenticatedProductCall): Promise<FederationBoundary> {
    const boundary = federationBoundarySchema.parse(input), peer = this.peer(boundary.sourceRun)
    return this.serial(async () => {
      this.authorize(call, peer.principalId)
      const prior = this.incomingBoundaries.get(peer.runId)
      if (prior && stringify(prior) === stringify(boundary)) return structuredClone(prior)
      this.checkBoundary(boundary, true)
      await this.append({ kind: 'inbound-boundary', boundary, principalId: call.principal.id }); return structuredClone(boundary)
    }, call, peer.principalId)
  }
  /** Advance only to every peer's durable no-earlier-message promise; absent or unreachable peers block.
   *
   * @param time - Requested monotonic mailbox boundary; Native treats the synced value as an exclusive execution limit.
   * @param call - Local Host user lease.
   * @returns Durable local simulation boundary. */
  advance(time: string, call: AuthenticatedProductCall): Promise<string> {
    logicalTime.parse(time)
    return this.serial(async () => {
      this.authorize(call, this.config.principalId); this.checkAdvance(time)
      await this.append({ kind: 'clock', time }); return this.time
    }, call, this.config.principalId)
  }
  /** Record a permanent peer failure. This generation cannot resume time or accept more messages from it.
   *
   * @param peerRun - Explicit unreachable peer.
   * @param call - Local Host user lease.
   * @returns Durable stopped peer identity. */
  stopPeer(peerRun: string, call: AuthenticatedProductCall): Promise<string> {
    return this.serial(async () => {
      this.authorize(call, this.config.principalId); this.peer(peerRun)
      if (!this.stopped.has(peerRun)) await this.append({ kind: 'stop', peerRun })
      return peerRun
    }, call, this.config.principalId)
  }
  private precedesAcceptedTime(message: FederationMessage): boolean {
    return BigInt(message.at) < BigInt(this.time)
      || BigInt(message.at) < BigInt(this.incomingBoundaries.get(message.sourceRun)?.time ?? '0')
  }
  private checkAdvance(time: string) {
    if (this.stopped.size || BigInt(time) < BigInt(this.time) || this.config.peers.some(peer =>
      !this.incomingBoundaries.has(peer.runId) || BigInt(time) > BigInt(this.incomingBoundaries.get(peer.runId)?.time ?? '0'))) throw new Error('Federation clock blocked: missing peer boundary or permanent stop')
  }
  private checkBoundary(boundary: FederationBoundary, incoming: boolean) {
    const peer = this.peer(incoming ? boundary.sourceRun : boundary.targetRun)
    if (boundary.sourceRun !== (incoming ? peer.runId : this.config.runId)
      || boundary.targetRun !== (incoming ? this.config.runId : peer.runId)
      || boundary.sourceGeneration !== (incoming ? peer.generation : this.config.generation)
      || boundary.targetGeneration !== (incoming ? this.config.generation : peer.generation) || this.stopped.has(peer.runId))
      throw new Error('Federation boundary scope invalid')
    const originals = incoming ? [...this.inbox.values()] : [...this.outbox.values()]
    const count = originals.filter(value => incoming
      ? value.message.sourceRun === peer.runId : value.message.targetRun === peer.runId).length
    const prior = (incoming ? this.incomingBoundaries : this.outgoingBoundaries).get(peer.runId)
    if (boundary.nextSequence !== count || BigInt(boundary.time) < BigInt(prior?.time ?? '0'))
      throw new Error('Federation boundary blocked: missing messages or regressed time')
  }
  private async load() {
    this.initializedStream = await this.ctx.storageLog.open({ name: this.config.stream, version: 1 })
    if (this.stream.firstSequence !== 0) throw new Error('Federation history prefix missing')
    if (this.stream.tailSequence === -1) await this.append({ kind: 'created', policy: this.policy() })
    let after = this.entries - 1
    while (after < this.stream.tailSequence) {
      const rows = await this.stream.read(after, this.config.pageSize)
      if (!rows.length) throw new Error('Federation history suffix missing')
      for (const row of rows) {
        if (row.sequence !== after + 1) throw new Error('Federation history sequence invalid')
        this.bound(row.value); this.fold(eventSchema.parse(row.value)); after = row.sequence; this.entries++
        if (this.entries > this.config.maxEntries) throw new Error('Federation history capacity exceeded')
      }
    }
  }
  private policy(): z.infer<typeof policySchema> {
    return policySchema.parse({ runId: this.config.runId, generation: this.config.generation,
      principalId: this.config.principalId, peers: this.config.peers })
  }
  private fold(event: z.infer<typeof eventSchema>) {
    if (this.entries === 0 && event.kind !== 'created') throw new Error('Federation original policy is missing')
    switch (event.kind) {
      case 'created':
        if (this.entries !== 0 || stringify(event.policy) !== stringify(this.policy())) throw new Error('Federation original policy changed')
        return
      case 'outbound-boundary': this.checkBoundary(event.boundary, false); this.outgoingBoundaries.set(event.boundary.targetRun, event.boundary); return
      case 'inbound-boundary':
        if (event.principalId !== this.peer(event.boundary.sourceRun).principalId) throw new Error('Federation boundary original author changed')
        this.checkBoundary(event.boundary, true); this.incomingBoundaries.set(event.boundary.sourceRun, event.boundary); return
      case 'clock': this.checkAdvance(event.time); this.foldTime(event); return
      case 'stop': this.peer(event.peerRun); this.foldTime(event); return
      case 'outbox': {
        const message = event.message, peer = this.peer(message.targetRun)
        if (this.stopped.has(peer.runId) || BigInt(message.at) < BigInt(this.outgoingBoundaries.get(peer.runId)?.time ?? '0')
          || message.sourceRun !== this.config.runId || message.sourceGeneration !== this.config.generation
          || message.targetGeneration !== peer.generation || this.outbox.has(message.messageId)
          || message.sourceSequence !== [...this.outbox.values()].filter(value => value.message.targetRun === peer.runId).length) throw new Error('Federation outbox history invalid')
        this.outbox.set(message.messageId, { message }); return
      }
      case 'inbox': {
        const message = event.message, peer = this.peer(message.sourceRun)
        this.destination(message)
        if (this.stopped.has(peer.runId) || this.precedesAcceptedTime(message)
          || event.principalId !== peer.principalId || this.inbox.has(this.messageKey(message))
          || message.sourceSequence !== [...this.inbox.values()].filter(value => value.message.sourceRun === peer.runId).length
          || message.after.some(cause => !this.inbox.has(this.messageKey(message, cause))))
          throw new Error('Federation inbox history invalid')
        this.inbox.set(this.messageKey(message), { message, receipt: { version: 1, messageId: message.messageId,
          targetRun: message.targetRun,
          targetGeneration: message.targetGeneration, digest: this.digest(message), inboxSequence: message.sourceSequence } }); return
      }
      case 'receipt': {
        const original = this.outbox.get(event.receipt.messageId)
        if (!original || original.receipt || event.principalId !== this.peer(event.receipt.targetRun).principalId
          || !this.matches(original.message, event.receipt)) throw new Error('Federation receipt history invalid')
        original.receipt = event.receipt; return
      }
    }
  }
  private foldTime(event: unknown): void {
    const next = foldFederationMailboxTime({ time: this.time, stoppedPeers: [...this.stopped] }, event)
    this.time = next.time; this.stopped.clear()
    for (const peer of next.stoppedPeers) this.stopped.add(peer)
  }
  private async append(event: z.infer<typeof eventSchema>) {
    this.bound(event)
    if (this.entries >= this.config.maxEntries) throw new Error('Federation journal capacity occupied')
    try { await this.stream.append(this.stream.tailSequence, [event]) }
    catch (cause) { this.closing = true; throw cause }
    this.fold(event); this.entries++
  }
  private serial<T>(fn: () => Promise<T>, call: AuthenticatedProductCall, principalId: string): Promise<T> {
    const result = this.tail.then(async () => { await this.ready; return fn() })
      .then((value) => { this.authorize(call, principalId); return value })
    this.tail = result.then(() => {}, () => {}); return result
  }
  private authorize(call: AuthenticatedProductCall, principalId: string) {
    if (this.closing || call.signal.aborted || call.principal.id !== principalId) throw new Error('Federation authorization unavailable')
  }
  private destination(message: FederationMessage) {
    if (message.targetRun !== this.config.runId || message.targetGeneration !== this.config.generation
      || message.sourceGeneration !== this.peer(message.sourceRun).generation) throw new Error('Federation stale generation or destination')
  }
  private messageKey(message: Pick<FederationMessage, 'sourceRun' | 'sourceGeneration' | 'messageId'>,
    messageId = message.messageId): string {
    return JSON.stringify([message.sourceRun, message.sourceGeneration, messageId])
  }
  private peer(runId: string) {
    const peer = this.config.peers.find(value => value.runId === runId)
    if (!peer) throw new Error('Federation peer unavailable')
    return peer
  }
  private digest(message: FederationMessage) { return createHash('sha256').update(stringify(message)).digest('hex') }
  private matches(message: FederationMessage, receipt: FederationReceipt) {
    return message.messageId === receipt.messageId && message.targetRun === receipt.targetRun
      && message.targetGeneration === receipt.targetGeneration && message.sourceSequence === receipt.inboxSequence
      && this.digest(message) === receipt.digest
  }
  private bound(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value)) > this.config.maxEntryBytes) throw new Error('Federation complete byte allowance exceeded')
  }
}
