/** Durable Host effect owner. A dispatched request is only queried after uncertainty; recovery never sends it again. */
import type { LogStream } from '@clocky/clocky-storage'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import stringify from 'fast-json-stable-stringify'
import { externalEffectIntentSchema, externalEffectGrantSchema, externalEffectReceiptSchema, externalEffectEventSchema } from './external-effect-schema.ts'
import type { ExternalEffectIntent, ExternalEffectGrant, ExternalEffectReceipt, ExternalEffectRecord } from './external-effect-schema.ts'

/** The first adapter is limited to a queryable, idempotent test environment. Credentials remain in its Host closure. */
export interface ExternalEffectAdapter {
  readonly id: string
  readonly environment: 'test'
  readonly action: string
  readonly targets: readonly string[]
  readonly maxOccupiedUnits: number
  /** Submit once under the stable original key. A throw means unknown, including a malformed receipt. */
  dispatch(intent: ExternalEffectIntent, idempotencyKey: string): Promise<ExternalEffectReceipt>
  /** Query the original key without creating an effect. Null retains unknown occupancy. */
  query(intent: ExternalEffectIntent, idempotencyKey: string): Promise<ExternalEffectReceipt | null>
}
/** Deployment policy owns real user admission; simulated roles cannot populate this list. */
export interface ExternalEffectOwnerOptions {
  readonly authorizedPrincipals: readonly string[]
  readonly mode: 'live' | 'replay' | 'branch' | 'import' | 'inspect'
  readonly maxEntries: number
  readonly maxEntryBytes: number
  readonly pageSize: number
}
/** Exclusive journal owner; stream lifetime belongs to the enclosing service. */
export class ExternalEffectOwner {
  private readonly records = new Map<string, ExternalEffectRecord>()
  private readonly adapters: ReadonlyMap<string, ExternalEffectAdapter>
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private entries = 0
  private loaded = false
  /**
   * @param stream - Exclusive versioned journal.
   * @param adapters - Trusted Host test adapters.
   * @param options - Deployment policy and finite bounds. */
  constructor(private readonly stream: LogStream, adapters: readonly ExternalEffectAdapter[],
    private readonly options: ExternalEffectOwnerOptions) {
    this.adapters = new Map(adapters.map(adapter => [adapter.id, adapter]))
    for (const adapter of adapters) z.literal('test').parse(adapter.environment)
    if (this.adapters.size !== adapters.length || adapters.some(adapter =>
      !Number.isSafeInteger(adapter.maxOccupiedUnits) || adapter.maxOccupiedUnits < 0)) throw new Error('Invalid external adapter registration')
    for (const limit of [options.maxEntries, options.maxEntryBytes, options.pageSize]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid external effect allowance')
    }
  }
  /** Recover original requests and reservations without calling any adapter. Broken history refuses startup. */
  async load(): Promise<void> {
    if (this.loaded) throw new Error('External effect owner already loaded')
    this.loaded = true
    try { await this.replay() }
    catch (cause) { this.closed = true; throw cause }
  }
  private async replay(): Promise<void> {
    if (this.stream.version !== 1 || this.stream.firstSequence !== 0) throw new Error('External effect journal version or prefix is invalid')
    let sequence = -1
    while (sequence < this.stream.tailSequence) {
      const rows = await this.stream.read(sequence, this.options.pageSize)
      if (!rows.length) throw new Error('External effect journal suffix is missing')
      for (const row of rows) {
        if (row.sequence !== sequence + 1) throw new Error('External effect journal sequence is invalid')
        this.bound(row.value)
        const event = externalEffectEventSchema.parse(row.value)
        this.validate(event.record); this.records.set(event.record.intent.effectId, event.record)
        sequence = row.sequence; this.entries++
        if (this.entries > this.options.maxEntries) throw new Error('External effect journal capacity exceeded')
      }
    }
  }
  /** Save an exact original intent. Reusing an ID with changed content is rejected.
   *
   * @param request - Exact finite original intent.
   * @param call - Current real user lease.
   * @returns Durable original.
   */
  propose(request: ExternalEffectIntent, call: AuthenticatedProductCall): Promise<ExternalEffectRecord> {
    const input = externalEffectIntentSchema.parse(request)
    return this.serial(async () => {
      this.authorize(call); this.adapter(input)
      const prior = this.records.get(input.effectId)
      if (prior) {
        this.owned(input.effectId, call)
        if (stringify(prior.intent) !== stringify(input)) throw new Error('External effect original intent changed')
        return structuredClone(prior)
      }
      if (input.compensatesEffectId !== undefined) {
        const source = this.owned(input.compensatesEffectId, call)
        if (source.status !== 'confirmed' || source.intent.effectId === input.effectId)
          throw new Error('Compensation requires a distinct confirmed original effect')
      }
      return this.commit({ intent: input, principalId: call.principal.id, idempotencyKey: randomUUID(),
        source: 'real-test', status: 'proposed', revoked: false })
    }, call)
  }
  /** Save explicit current real-user consent for this exact action/target and finite units/expiry.
   *
   * @param request - Exact user grant.
   * @param call - Current real user lease.
   * @returns Durable consent. */
  grant(request: ExternalEffectGrant, call: AuthenticatedProductCall): Promise<ExternalEffectRecord> {
    const input = externalEffectGrantSchema.parse(request)
    return this.serial(async () => {
      this.authorize(call); this.live()
      const record = this.owned(input.effectId, call)
      if (record.grant) {
        const expected = { ...input, principalId: call.principal.id, credentialGeneration: call.credentialGeneration }
        if (stringify(expected) !== stringify(record.grant)) throw new Error('External grant original changed')
        return structuredClone(record)
      }
      if (record.status !== 'proposed' || input.action !== record.intent.action || input.target !== record.intent.target
        || input.maxUnits < record.intent.units || input.expiresAt <= Date.now()) throw new Error('External grant scope or expiry invalid')
      return this.commit({ ...record, status: 'user-authorized', grant: { ...input,
        principalId: call.principal.id, credentialGeneration: call.credentialGeneration } })
    }, call)
  }
  /** Dispatch at most once. Unknown/dispatched requests use query, including after restart or revocation.
   *
   * @param effectId - Original request identity.
   * @param call - Current real user lease.
   * @returns Durable state after reconciliation or dispatch. */
  execute(effectId: string, call: AuthenticatedProductCall): Promise<ExternalEffectRecord> {
    return this.serial(async () => {
      this.authorize(call); this.live()
      let record = this.owned(effectId, call)
      const adapter = this.adapter(record.intent)
      if (['confirmed', 'failed', 'cancelled'].includes(record.status)) return structuredClone(record)
      if (record.status === 'dispatched' || record.status === 'outcome-unknown') return this.queryRecord(record, adapter)
      this.consent(record, call)
      if (record.status === 'user-authorized') {
        const occupied = [...this.records.values()].filter(value => value.intent.adapterId === adapter.id
          && ['reserved', 'dispatched', 'outcome-unknown', 'confirmed'].includes(value.status)).reduce((sum, value) => sum + value.intent.units, 0)
        if (record.intent.units > adapter.maxOccupiedUnits - occupied) throw new Error('External adapter finite allowance occupied')
        record = await this.commit({ ...record, status: 'reserved' })
      }
      // A recovered reservation still obeys the current Host cap; consent alone does not restore old capacity.
      const occupied = [...this.records.values()].filter(value => value.intent.adapterId === adapter.id
        && ['reserved', 'dispatched', 'outcome-unknown', 'confirmed'].includes(value.status)).reduce((sum, value) => sum + value.intent.units, 0)
      if (occupied > adapter.maxOccupiedUnits) throw new Error('External adapter finite allowance occupied')
      // Recheck after every await and persist dispatch before crossing the Host IO boundary.
      this.consent(record, call)
      record = await this.commit({ ...record, status: 'dispatched' })
      this.consent(record, call)
      let observation: unknown
      try { observation = await adapter.dispatch(structuredClone(record.intent), record.idempotencyKey) }
      catch { return this.commit({ ...record, status: 'outcome-unknown' }) }
      return this.observe(record, observation)
    }, call)
  }
  /** Pure authenticated lookup; no provider query, Session or model work occurs.
   *
   * @param effectId - Original request identity.
   * @param call - Current real user lease.
   * @returns Detached durable state. */
  inspect(effectId: string, call: AuthenticatedProductCall): ExternalEffectRecord {
    this.authorize(call); return structuredClone(this.owned(effectId, call))
  }
  /** Revocation does not release a possibly dispatched reservation. Only unstarted effects can cancel.
   *
   * @param effectId - Original request identity.
   * @param call - Current real user lease.
   * @returns Durable revoked state. */
  revoke(effectId: string, call: AuthenticatedProductCall): Promise<ExternalEffectRecord> {
    return this.serial(async () => {
      this.authorize(call); this.live()
      const record = this.owned(effectId, call)
      return this.commit({ ...record, revoked: true,
        status: ['proposed', 'user-authorized', 'reserved'].includes(record.status) ? 'cancelled' : record.status })
    }, call)
  }
  /** Stop admission and await the one admitted operation before stream teardown. */
  async drain(): Promise<void> { this.closed = true; await this.tail }
  private async queryRecord(record: ExternalEffectRecord, adapter: ExternalEffectAdapter) {
    let observation: unknown
    try { observation = await adapter.query(structuredClone(record.intent), record.idempotencyKey) }
    catch { return this.commit({ ...record, status: 'outcome-unknown' }) }
    if (observation === null) return this.commit({ ...record, status: 'outcome-unknown' })
    return this.observe(record, observation)
  }
  private observe(record: ExternalEffectRecord, observation: unknown) {
    const parsed = externalEffectReceiptSchema.safeParse(observation)
    if (!parsed.success || parsed.data.effectId !== record.intent.effectId || parsed.data.idempotencyKey !== record.idempotencyKey
      || parsed.data.action !== record.intent.action || parsed.data.target !== record.intent.target
      || parsed.data.units !== record.intent.units) {
      return this.commit({ ...record, status: 'outcome-unknown' })
    }
    return this.commit({ ...record, status: parsed.data.outcome, receipt: parsed.data })
  }
  private serial<T>(fn: () => Promise<T>, call: AuthenticatedProductCall): Promise<T> {
    const result = this.tail.then(fn).then((value) => { this.authorize(call); return value })
    this.tail = result.then(() => {}, () => {}); return result
  }
  private async commit(record: ExternalEffectRecord): Promise<ExternalEffectRecord> {
    const event = externalEffectEventSchema.parse({ version: 1, record }); this.bound(event); this.validate(event.record)
    if (this.entries >= this.options.maxEntries) throw new Error('External effect journal capacity occupied')
    try { await this.stream.append(this.stream.tailSequence, [event]) }
    catch (cause) { this.closed = true; throw cause }
    this.records.set(record.intent.effectId, event.record); this.entries++; return structuredClone(event.record)
  }
  private validate(record: ExternalEffectRecord) {
    const prior = this.records.get(record.intent.effectId)
    if (record.grant && [...this.records.values()].some(value => value.intent.effectId !== record.intent.effectId
      && value.grant?.grantId === record.grant?.grantId)) throw new Error('External grant already belongs to another effect')
    if (!prior) {
      if (record.intent.compensatesEffectId !== undefined) {
        const source = this.records.get(record.intent.compensatesEffectId)
        if (source === undefined || source.status !== 'confirmed' || source.principalId !== record.principalId
          || source.intent.effectId === record.intent.effectId) throw new Error('Compensation source responsibility invalid')
      }
      if (record.status !== 'proposed' || record.grant || record.revoked || record.receipt
        || [...this.records.values()].some(value => value.idempotencyKey === record.idempotencyKey)) throw new Error('External effect origin invalid')
      return
    }
    const successors: Record<ExternalEffectRecord['status'], readonly ExternalEffectRecord['status'][]> = {
      proposed: ['user-authorized', 'cancelled'], 'user-authorized': ['reserved', 'cancelled'], reserved: ['dispatched', 'cancelled'],
      dispatched: ['dispatched', 'outcome-unknown', 'confirmed', 'failed'], 'outcome-unknown': ['outcome-unknown', 'confirmed', 'failed'],
      confirmed: ['confirmed'], failed: ['failed'], cancelled: ['cancelled'],
    }
    if (!successors[prior.status].includes(record.status) || stringify(prior.intent) !== stringify(record.intent)
      || prior.principalId !== record.principalId || prior.idempotencyKey !== record.idempotencyKey
      || (prior.revoked && !record.revoked) || (prior.grant && stringify(prior.grant) !== stringify(record.grant))
      || (prior.receipt && stringify(prior.receipt) !== stringify(record.receipt))) throw new Error('External effect history transition invalid')
    if (record.status !== 'cancelled' && !record.grant) throw new Error('External effect authorization missing')
    if (record.grant && (record.grant.effectId !== record.intent.effectId || record.grant.action !== record.intent.action
      || record.grant.target !== record.intent.target || record.grant.maxUnits < record.intent.units
      || record.grant.principalId !== record.principalId)) throw new Error('External effect authorization scope invalid')
    if (['confirmed', 'failed'].includes(record.status) && (!record.receipt || record.receipt.outcome !== record.status
      || record.receipt.effectId !== record.intent.effectId || record.receipt.idempotencyKey !== record.idempotencyKey
      || record.receipt.action !== record.intent.action || record.receipt.target !== record.intent.target
      || record.receipt.units !== record.intent.units)) throw new Error('External effect receipt invalid')
  }
  private adapter(intent: ExternalEffectIntent) {
    const adapter = this.adapters.get(intent.adapterId)
    if (!adapter || adapter.action !== intent.action || !adapter.targets.includes(intent.target)) throw new Error('External adapter scope unavailable')
    return adapter
  }
  private owned(id: string, call: AuthenticatedProductCall) {
    const record = this.records.get(id)
    if (!record || record.principalId !== call.principal.id) throw new Error('External effect unavailable')
    return record
  }
  private authorize(call: AuthenticatedProductCall) {
    if (this.closed || call.signal.aborted || !this.options.authorizedPrincipals.includes(call.principal.id)) throw new Error('External effect authorization unavailable')
  }
  private consent(record: ExternalEffectRecord, call: AuthenticatedProductCall) {
    this.authorize(call)
    if (!record.grant || record.revoked || record.grant.expiresAt <= Date.now()
      || record.grant.credentialGeneration !== call.credentialGeneration) throw new Error('External effect consent unavailable')
  }
  private live() { if (this.options.mode !== 'live') throw new Error('External effects disabled in this execution mode') }
  private bound(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value)) > this.options.maxEntryBytes) throw new Error('External effect complete byte allowance exceeded')
  }
}
