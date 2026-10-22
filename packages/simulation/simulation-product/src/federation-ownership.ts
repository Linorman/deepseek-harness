/** A single durable coordinator owns federated resource identity. Unreachable coordination never grants a local writer. */
import { Context, Service } from '@clocky/cordis'
import schema from '@clocky/schemastery'
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import type { LogArchive, LogEntry, LogStream } from '@clocky/clocky-storage'
import type {} from '@clocky/clocky-storage-log'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'

const id = z.string().min(1).max(128), generation = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const quantity = z.string().regex(/^(0|[1-9][0-9]{0,99})$/)
const objectSchema = z.strictObject({ objectId: id, home: id, generation, quantity })
const transferSchema = z.strictObject({ transferId: id, objectId: id, source: id, target: id, generation,
  quantity, status: z.enum(['reserved', 'confirmed', 'settled']) })
const policySchema = z.strictObject({ stream: id, coordinatorPrincipalId: id,
  partitions: z.array(z.strictObject({ runId: id, principalId: id })).min(2) })
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('register'), object: objectSchema }),
  z.strictObject({ kind: z.literal('reserve'), transfer: transferSchema }),
  z.strictObject({ kind: z.literal('confirm'), transferId: id }),
  z.strictObject({ kind: z.literal('settle'), transferId: id }),
  z.strictObject({ kind: z.literal('spend'), operationId: id, objectId: id, home: id, generation, amount: quantity }),
  z.strictObject({ kind: z.literal('policy'), policy: policySchema }),
])
/** Authoritative federated resource; Native resources are not silently mirrored or debited by this owner. */
export type FederationOwnedResource = z.infer<typeof objectSchema>
/** Complete original ownership transfer and its retained settlement responsibility. */
export type FederationOwnershipTransfer = z.infer<typeof transferSchema>
/** Deployment-selected single coordinator and allowed partition principals. */
export interface FederationOwnershipConfig {
  readonly stream: string
  readonly coordinatorPrincipalId: string
  readonly partitions: { runId: string; principalId: string }[]
  readonly maxEntries: number
  readonly maxEntryBytes: number
  readonly pageSize: number
}
export const Config: schema<FederationOwnershipConfig> = schema.object({ stream: schema.string().required(),
  coordinatorPrincipalId: schema.string().required(),
  partitions: schema.array(schema.object({ runId: schema.string().required(), principalId: schema.string().required() })).required(),
  maxEntries: schema.number().min(1).step(1).default(10000), maxEntryBytes: schema.number().min(1).step(1).default(1048576),
  pageSize: schema.number().min(1).step(1).default(64) })
declare module '@clocky/cordis' { interface Context { federationOwnership: FederationOwnership } }
/** The coordinator is the only writer. Partition calls carry generations but never mint or release local ownership. */
export default class FederationOwnership extends Service<FederationOwnershipConfig> {
  static inject = ['storageLog']
  static Config = Config
  private readonly registrations = new Map<string, FederationOwnedResource>()
  private readonly objects = new Map<string, FederationOwnedResource>()
  private readonly transfers = new Map<string, FederationOwnershipTransfer>()
  private readonly spends = new Map<string, { event: Extract<z.infer<typeof eventSchema>, { kind: 'spend' }>; remaining: string }>()
  private readonly ready: Promise<void>
  private stream: LogStream | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false
  private policySeen = false
  /** @param ctx - Coordinator storage owner. @param config - Fixed coordinator and finite partition policy. */
  constructor(ctx: Context, private readonly config: FederationOwnershipConfig) {
    super(ctx, 'federationOwnership')
    id.parse(config.coordinatorPrincipalId)
    if (!config.stream.trim() || config.partitions.length < 2
      || new Set(config.partitions.map(p => p.runId)).size !== config.partitions.length)
      throw new Error('Federation ownership requires distinct explicit partitions')
    for (const partition of config.partitions) { id.parse(partition.runId); id.parse(partition.principalId) }
    for (const bound of [config.maxEntries, config.maxEntryBytes, config.pageSize])
      if (!Number.isSafeInteger(bound) || bound < 1) throw new Error('Federation ownership allowance invalid')
    this.ready = this.load()
    void this.ready.catch((_cause: unknown) => { /* Startup and teardown observe the same failed replay. */ })
    ctx.effect(() => async () => { this.closing = true; await Promise.allSettled([this.ready, this.tail]); await this.stream?.close() })
  }
  protected async [Service.init](): Promise<void> { await this.ready }
  /** Register a new resource at generation zero; coordinator authority is independent of simulation governance.
   * @param input - Exact resource identity, home and quantity.
   * @param call - Coordinator Host lease.
   * @returns Durable original resource; an identity cannot acquire another original payload. */
  register(input: { objectId: string; home: string; quantity: string }, call: AuthenticatedProductCall): Promise<FederationOwnedResource> {
    const object = objectSchema.parse({ ...input, generation: 0 })
    return this.serial(call, this.config.coordinatorPrincipalId, async () => {
      this.partition(object.home)
      const prior = this.registrations.get(object.objectId)
      if (prior) {
        if (!isDeepStrictEqual(prior, object)) throw new Error('Federation resource identity already exists')
        return structuredClone(this.object(object.objectId))
      }
      await this.append({ kind: 'register', object }); return structuredClone(object)
    })
  }
  /** Spend only through the canonical owner; a transfer reservation blocks both partitions until settlement.
   * @param input - Original operation and exact owner generation.
   * @param call - Home partition Host lease.
   * @returns Canonical quantity immediately after this operation; retries return that original result across ownership changes. */
  spend(input: { operationId: string; objectId: string; home: string; generation: number; amount: string },
    call: AuthenticatedProductCall): Promise<string> {
    const event = eventSchema.options[4].parse({ ...input, kind: 'spend' })
    return this.serial(call, this.partition(input.home).principalId, async () => {
      const prior = this.spends.get(event.operationId)
      if (prior) {
        if (!isDeepStrictEqual(prior.event, event)) throw new Error('Federation spend original changed')
        return prior.remaining
      }
      this.checkSpend(event)
      await this.append(event); return this.object(event.objectId).quantity
    })
  }
  /** Freeze the whole resource before transport; timeout or missing acknowledgement never releases either side.
   * @param input - Immutable source-to-target transfer.
   * @param call - Current source partition Host lease.
   * @returns Durable original reservation. Partial Native-resource transactions are outside this contract. */
  reserve(input: { transferId: string; objectId: string; source: string; target: string; generation: number },
    call: AuthenticatedProductCall): Promise<FederationOwnershipTransfer> {
    const parsed = z.strictObject({ transferId: id, objectId: id, source: id, target: id, generation }).parse(input)
    return this.serial(call, this.partition(parsed.source).principalId, async () => {
      const prior = this.transfers.get(parsed.transferId)
      if (prior) {
        if (Object.entries(parsed).some(([key, value]) => prior[key as keyof typeof parsed] !== value))
          throw new Error('Federation transfer original changed')
        return structuredClone(prior)
      }
      const object = this.object(parsed.objectId)
      this.checkOwner(object, parsed.source, parsed.generation); this.partition(parsed.target)
      if (parsed.source === parsed.target || this.pending(parsed.objectId)) throw new Error('Federation resource reserved or target invalid')
      const transfer = transferSchema.parse({ ...parsed, quantity: object.quantity, status: 'reserved' })
      await this.append({ kind: 'reserve', transfer }); return structuredClone(transfer)
    })
  }
  /** Destination explicitly accepts the original reservation; acceptance alone does not grant a writer.
   * @param transferId - Original reservation.
   * @param call - Target partition Host lease.
   * @returns Original confirmed responsibility, including unknown settlement after a lost response. */
  confirm(transferId: string, call: AuthenticatedProductCall): Promise<FederationOwnershipTransfer> {
    return this.serial(call, () => this.partition(this.transfer(transferId).target).principalId, async () => {
      const transfer = this.transfer(transferId)
      if (transfer.status === 'reserved') await this.append({ kind: 'confirm', transferId })
      return structuredClone(this.transfer(transferId))
    })
  }
  /** Commit one generation change at the coordinator; old source and old target fences permanently fail.
   * @param transferId - Explicitly confirmed original.
   * @param call - Coordinator Host lease.
   * @returns Settled original. A network partition cannot substitute a local settlement. */
  settle(transferId: string, call: AuthenticatedProductCall): Promise<FederationOwnershipTransfer> {
    return this.serial(call, this.config.coordinatorPrincipalId, async () => {
      const transfer = this.transfer(transferId)
      if (transfer.status === 'reserved') throw new Error('Federation settlement awaits target confirmation')
      if (transfer.status !== 'settled') await this.append({ kind: 'settle', transferId })
      return structuredClone(this.transfer(transferId))
    })
  }
  /** Capture the exact registry prefix at one serialized queue position while callers hold every mailbox cut.
   * @param call - Coordinator Host lease.
   * @param capture - Called while resource admission is frozen.
   * @returns Caller result after release; capture must not re-enter this registry. */
  withCheckpoint<T>(call: AuthenticatedProductCall, capture: (archive: LogArchive) => T | Promise<T>): Promise<T> {
    return this.serial(call, this.config.coordinatorPrincipalId, async () => {
      const entries: LogEntry[] = []; let after = -1
      while (after < this.journal().tailSequence) {
        const page = await this.journal().read(after, this.config.pageSize)
        if (!page.length) throw new Error('Federation ownership checkpoint prefix incomplete')
        for (const row of page) { if (row.sequence !== after + 1) throw new Error('Federation ownership checkpoint sequence gap')
          entries.push(row); after = row.sequence }
      }
      const archive = { name: this.config.stream, version: 1, entries }
      this.bound(archive); return capture(archive)
    })
  }
  /** Inspect canonical owners and unresolved transfers; reading never releases responsibility.
   * @param call - Coordinator Host lease.
   * @returns Detached bounded canonical state. */
  inspect(call: AuthenticatedProductCall): Promise<{ resources: FederationOwnedResource[]; transfers: FederationOwnershipTransfer[] }> {
    return this.serial(call, this.config.coordinatorPrincipalId, () => {
      const value = { resources: [...this.objects.values()], transfers: [...this.transfers.values()] }
      this.bound(value); return structuredClone(value)
    })
  }
  private journal(): LogStream {
    if (this.stream === undefined) throw new Error('Federation ownership journal is unavailable')
    return this.stream
  }
  private object(objectId: string) { const object = this.objects.get(objectId); if (!object) throw new Error('Federation resource absent'); return object }
  private transfer(transferId: string) { id.parse(transferId); const transfer = this.transfers.get(transferId)
    if (!transfer) throw new Error('Federation transfer absent'); return transfer }
  private partition(runId: string) { const p = this.config.partitions.find(p => p.runId === runId)
    if (!p) throw new Error('Federation partition unavailable'); return p }
  private pending(objectId: string) { return [...this.transfers.values()].some(t => t.objectId === objectId && t.status !== 'settled') }
  private checkOwner(object: FederationOwnedResource, home: string, gen: number) {
    if (object.home !== home || object.generation !== gen) throw new Error('Federation stale ownership generation fenced')
  }
  private checkSpend(event: Extract<z.infer<typeof eventSchema>, { kind: 'spend' }>) {
    const object = this.object(event.objectId); this.checkOwner(object, event.home, event.generation)
    if (this.pending(object.objectId) || BigInt(event.amount) > BigInt(object.quantity)) throw new Error('Federation resource reserved or insufficient')
  }
  private fold(event: z.infer<typeof eventSchema>) {
    if (!this.policySeen && event.kind !== 'policy') throw new Error('Federation ownership policy missing')
    switch (event.kind) {
      case 'policy':
        if (this.policySeen || !isDeepStrictEqual(event.policy, this.policy())) throw new Error('Federation ownership policy changed')
        this.policySeen = true; return
      case 'register': this.partition(event.object.home)
        if (this.objects.has(event.object.objectId) || event.object.generation !== 0) throw new Error('Federation resource registration repeats')
        this.registrations.set(event.object.objectId, structuredClone(event.object))
        this.objects.set(event.object.objectId, event.object); return
      case 'reserve': {
        const transfer = event.transfer, object = this.object(transfer.objectId)
        this.checkOwner(object, transfer.source, transfer.generation); this.partition(transfer.target)
        if (transfer.status !== 'reserved' || transfer.source === transfer.target || transfer.quantity !== object.quantity
          || this.pending(object.objectId) || this.transfers.has(transfer.transferId)) throw new Error('Federation transfer reservation invalid')
        this.transfers.set(transfer.transferId, transfer); return
      }
      case 'confirm': { const transfer = this.transfer(event.transferId)
        if (transfer.status !== 'reserved') throw new Error('Federation transfer confirmation repeats')
        transfer.status = 'confirmed'; return }
      case 'settle': { const transfer = this.transfer(event.transferId), object = this.object(transfer.objectId)
        if (transfer.status !== 'confirmed') throw new Error('Federation transfer settlement lacks confirmation')
        this.checkOwner(object, transfer.source, transfer.generation)
        if (object.generation >= Number.MAX_SAFE_INTEGER) throw new Error('Federation ownership generation exhausted')
        object.home = transfer.target; object.generation++; transfer.status = 'settled'; return }
      case 'spend': { this.checkSpend(event)
        if (this.spends.has(event.operationId)) throw new Error('Federation spend repeats')
        this.object(event.objectId).quantity = String(BigInt(this.object(event.objectId).quantity) - BigInt(event.amount))
        this.spends.set(event.operationId, { event, remaining: this.object(event.objectId).quantity }); return }
    }
  }
  private async load() {
    this.stream = await this.ctx.storageLog.open({ name: this.config.stream, version: 1 })
    if (this.journal().firstSequence !== 0 || this.journal().tailSequence + 1 > this.config.maxEntries) throw new Error('Federation ownership history incomplete or too large')
    if (this.journal().tailSequence === -1) {
      const event = { kind: 'policy' as const, policy: this.policy() }; this.bound(event)
      await this.journal().append(-1, [event])
    }
    let after = -1
    while (after < this.journal().tailSequence) {
      const page = await this.journal().read(after, this.config.pageSize)
      if (!page.length) throw new Error('Federation ownership history suffix missing')
      for (const row of page) {
        if (row.sequence !== after + 1) throw new Error('Federation ownership history sequence gap')
        this.bound(row.value); this.fold(eventSchema.parse(row.value)); after = row.sequence
      }
    }
  }
  private policy() { return { stream: this.config.stream, coordinatorPrincipalId: this.config.coordinatorPrincipalId,
    partitions: this.config.partitions.map(partition => ({ ...partition })) } }
  private async append(event: z.infer<typeof eventSchema>) {
    this.bound(event)
    if (this.journal().tailSequence + 1 >= this.config.maxEntries) throw new Error('Federation ownership capacity occupied')
    // Reject before persistence; replay uses the same relationships and cannot accept a malformed generation transition.
    const resources = structuredClone(this.objects), transfers = structuredClone(this.transfers), spends = structuredClone(this.spends)
    this.fold(event)
    this.objects.clear(); resources.forEach((value, key) => this.objects.set(key, value))
    this.transfers.clear(); transfers.forEach((value, key) => this.transfers.set(key, value))
    this.spends.clear(); spends.forEach((value, key) => this.spends.set(key, value))
    try { await this.journal().append(this.journal().tailSequence, [event]) }
    catch (cause) { this.closing = true; throw cause }
    this.fold(event)
  }
  private serial<T>(call: AuthenticatedProductCall, principal: string | (() => string), work: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      await this.ready; this.authorize(call, typeof principal === 'string' ? principal : principal())
      const value = await work(); this.authorize(call, typeof principal === 'string' ? principal : principal()); return value
    })
    this.tail = result.then(() => {}, () => {}); return result
  }
  private authorize(call: AuthenticatedProductCall, principal: string) {
    if (this.closing || call.signal.aborted || call.principal.id !== principal) throw new Error('Federation ownership authorization unavailable')
  }
  private bound(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value)) > this.config.maxEntryBytes) throw new Error('Federation ownership complete byte allowance exceeded')
  }
}
