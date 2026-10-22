/** Serialized CAS over a dedicated append-only product stream; no run, Session or model is opened. */
import type { LogStream } from '@clocky/clocky-storage'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { scenarioDraftRevisionSchema, scenarioDraftSaveSchema, scenarioDraftReadSchema } from './draft-schema.ts'
import type { ScenarioDraftRevision, ScenarioDraftSave, ScenarioDraftSaveResult, ScenarioDraftRead, ScenarioDraftReadResult } from './draft-schema.ts'
import stringify from 'fast-json-stable-stringify'

/** Explicit retained-history bounds; exhaustion refuses further saves without deleting ancestors. */
export interface ScenarioDraftStoreLimits {
  readonly maxEntries: number
  readonly maxBytes: number
  readonly pageSize: number
  readonly maxResultBytes: number
}
/** Private immutable revision owner; the enclosing product service owns stream lifetime. */
export class ScenarioDraftStore {
  private entries: ScenarioDraftRevision[] = []
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  /** @param stream - Exclusive versioned draft log. @param limits - Positive deployment bounds. */
  constructor(private readonly stream: LogStream, private readonly limits: ScenarioDraftStoreLimits) {}

  /** Replay all revisions; missing prefixes, duplicate saves and broken ancestry refuse startup. */
  async load(): Promise<void> {
    if (this.stream.firstSequence !== 0) throw new Error('Draft history prefix is missing')
    let after = -1
    while (after < this.stream.tailSequence) {
      const rows = await this.stream.read(after, this.limits.pageSize)
      if (rows.length === 0) throw new Error('Draft history suffix is missing')
      for (const row of rows) {
        if (row.sequence !== after + 1) throw new Error('Draft history sequence is discontinuous')
        this.bytes(row.value)
        const entry = scenarioDraftRevisionSchema.parse(row.value)
        const own = this.owned(entry.author, entry.draftId)
        const head = own.at(-1)
        if (entry.parentRevision !== (head?.revision ?? null) || entry.revision !== (head === undefined ? 0 : head.revision + 1)
          || this.entries.some(value => value.author === entry.author && value.saveId === entry.saveId)) throw new Error('Draft history ancestry is invalid')
        this.capacity(); this.entries.push(entry); after = row.sequence
      }
    }
  }
  /** Read an independently authorized immutable document.
   * @param request - Owned draft and optional original revision.
   * @param call - Current lease.
   * @returns detached document, or null for missing/private identities. */
  read(request: ScenarioDraftRead, call: AuthenticatedProductCall): ScenarioDraftReadResult {
    this.authorize(call)
    const input = scenarioDraftReadSchema.parse(request), own = this.owned(call.principal.id, input.draftId)
    const value = input.revision === undefined ? own.at(-1) : own.find(item => item.revision === input.revision)
    const result = { value: value === undefined ? null : structuredClone(value) }
    this.resultBytes(result); return result
  }
  /** Serialize the original save against its exact ancestor.
   * @param request - Original save ID/payload and parent revision.
   * @param call - Authenticated current author.
   * @returns saved original or conflict; retry after an ambiguous append must reopen the owner first. */
  save(request: ScenarioDraftSave, call: AuthenticatedProductCall): Promise<ScenarioDraftSaveResult> {
    const input = scenarioDraftSaveSchema.parse(request)
    this.bytes(input)
    const work = this.tail.then(async (): Promise<ScenarioDraftSaveResult> => {
      this.authorize(call)
      const prior = this.entries.find(value => value.author === call.principal.id && value.saveId === input.saveId)
      if (prior !== undefined) {
        const { revision: _revision, author: _author, savedAt: _savedAt, ...original } = prior
        if (stringify(original) !== stringify(input)) throw new Error('Draft save ID payload changed')
        return { status: 'saved', value: structuredClone(prior) }
      }
      const head = this.owned(call.principal.id, input.draftId).at(-1)
      if (input.parentRevision !== (head?.revision ?? null)) {
        const result = { status: 'conflict' as const, current: structuredClone(head ?? null), attempted: input }
        this.resultBytes(result); return result
      }
      const value = scenarioDraftRevisionSchema.parse({ ...input, revision: head === undefined ? 0 : head.revision + 1,
        author: call.principal.id, savedAt: Date.now() })
      this.bytes(value); this.resultBytes({ status: 'saved', value }); this.capacity()
      try { await this.stream.append(this.stream.tailSequence, [value]) }
      catch (cause) { this.closed = true; throw cause }
      this.entries.push(value)
      this.authorize(call)
      return { status: 'saved', value: structuredClone(value) }
    })
    this.tail = work.then(() => {}, () => {})
    return work
  }
  /** Close new admission and drain previously admitted writes before stream close. */
  async drain(): Promise<void> { this.closed = true; await this.tail }
  private owned(author: string, draftId: string) {
    return this.entries.filter(value => value.author === author && value.draftId === draftId)
  }
  private authorize(call: AuthenticatedProductCall) {
    if (this.closed || call.signal.aborted) throw new Error('Draft owner or authorization is unavailable')
  }
  private bytes(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value)) > this.limits.maxBytes) throw new Error('Draft exceeds complete byte allowance')
  }
  private resultBytes(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value)) > this.limits.maxResultBytes) throw new Error('Draft response exceeds complete byte allowance')
  }
  private capacity() { if (this.entries.length >= this.limits.maxEntries) throw new Error('Draft history capacity is occupied') }
}
