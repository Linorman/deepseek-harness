import { indexInboxAdmission, inboxAdmissionBytes, readInboxAdmission, isInboxAdmission, type InboxAdmissionKey } from './admission-index.ts'
import type { TeamListPageRequest } from '@clocky/clocky-team'
/** Durable principal-bound final delivery and independent display acknowledgement. @module @clocky/clocky-team-human-client */
import { Context, Service } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { z as schema } from 'zod'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import type { AuthenticatedProductCall, ProductPrincipalId } from '@clocky/clocky-product-principal'
import { TeamError, teamHumanFinalInputSchema, teamHumanInboxItemSchema, teamHumanInboxReadInputSchema, teamHumanInboxAcknowledgeInputSchema, teamHumanMessageInputSchema, teamHumanInboxActionSchema, teamHumanActionResponseInputSchema } from '@clocky/clocky-team'
import type { TeamHumanFinalInput, TeamHumanInboxItem, TeamHumanInboxPage, TeamHumanInboxReadInput, TeamHumanInboxAcknowledgeInput, TeamHumanInboxAcknowledgement, TeamHumanDeliveryRuntime, TeamHumanInboxFinal, TeamHumanSinkProof, TeamHumanInboxMessage, TeamHumanMessageInput, TeamSystemHumanDeliveryProof, TeamSystemHumanDeliveryScope, TeamId, ChannelId, TeamHumanActionResponder, TeamHumanActionResponseInput, TeamHumanActionResponseResult, TeamHumanInboxAction, TeamStateSnapshot } from '@clocky/clocky-team'
import { StorageLogError } from '@clocky/clocky-storage-log'
import type { LogStream, LogNameScanCursor } from '@clocky/clocky-storage-log'
import type {} from '@clocky/clocky-storage-log'

/** Cordis Consumer identity. */
export const name = 'team-human-client'
/** The Team provider supplies authorization; storage owns durable appends. */
export const inject = ['teams', 'storageLog', 'productPrincipals']
/** Optional bounded migration of displayed history into immutable admission anchors. */
export interface InboxRetentionConfig {
  /** Minimum physical inbox records retained after a compaction. */
  readonly tailRecords: number
  /** Maximum physical stream names examined per discovery page. */
  readonly maxStreamsPerDrive: number
  /** Maximum inbox records examined across one retention drive. */
  readonly maxRecordsPerDrive: number
  /** Maximum selected bytes per drive, counting the larger source or admission-anchor record for each item. */
  readonly maxBytesPerDrive: number
}

/** Deployment bounds for storage, API pages and long polling. */
export interface Config {
  /** Omission disables automatic display-history retention; admission anchors remain durable. */
  readonly retention?: InboxRetentionConfig
  /** Maximum records read from the log backend at once. */
  readonly storagePageSize: number
  /** Maximum deliveries in one product response. */
  readonly maxPageSize: number
  /** Maximum UTF-8 bytes of one complete inbox delivery. */
  readonly maxDeliveryBytes: number
  /** Maximum admitted operations waiting for the local log owner. */
  readonly maxPendingOperations: number
  /** Long-poll time limit in milliseconds. */
  readonly watchTimeoutMs: number
  /** Delay between restart-safe storage observations in milliseconds. */
  readonly pollIntervalMs: number
}
/** Required load-time limits; no protocol values are inferred from a Session. */
export const Config: z<Config> = z.object({
  retention: z.object({
    tailRecords: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    maxStreamsPerDrive: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    maxRecordsPerDrive: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    maxBytesPerDrive: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  }).default(undefined as unknown as InboxRetentionConfig),
  storagePageSize: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxPageSize: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxDeliveryBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxPendingOperations: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  watchTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
  pollIntervalMs: z.number().step(1).min(1).max(2147483647).required(),
})
const recordSchema = schema.union([
  teamHumanInboxItemSchema,
  schema.object({ kind: schema.literal('display'), principalId: schema.string().min(1), throughCursor: schema.number().int().nonnegative() }).strict(),
])
const inboxCheckpointSchema = schema.object({
  version: schema.literal(1),
  principalId: schema.string().min(1),
  displayCursor: schema.number().int().nonnegative(),
  indexedThroughCursor: schema.number().int().nonnegative().optional(),
}).strict()

/** One serialized inbox owner; retention opens at most one admission anchor beside its inbox stream. */
export class TeamHumanClient extends Service implements TeamHumanDeliveryRuntime {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly deliveryProofs = new Map<TeamSystemHumanDeliveryProof, TeamSystemHumanDeliveryScope>()
  private readonly channelQueue: { teamId: TeamId; channelId: ChannelId }[] = []
  private teamCursor: TeamListPageRequest['afterCursor'] = -1
  private drive: Promise<void> | undefined
  private retentionCursor: LogNameScanCursor | undefined
  private readonly retentionNames: string[] = []
  private readonly actionResponders = new Set<TeamHumanActionResponder>()
  private pending = 0
  private readonly stop = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()

  /** @param ctx - Team, storage and principal service context. @param config - Explicit deployment limits. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'teamHumanDelivery')
    ctx.teams.registerSystemHumanDeliveryProofSource({ name: 'team-human-client',
      resolveHumanDeliveryProof: proof => this.deliveryProofs.get(proof) })
    const schedule = (): void => {
      if (this.isClosing()) return
      void this.runOnce().catch((error: unknown) => {
        if (!this.isClosing()) ctx.logger.warn(`team-human-client: background pass failed: ${String(error)}`)
      })
    }
    ctx.on('channel/changed', schedule)
    ctx.on('team/changed', schedule)
    const timer = setInterval(schedule, config.pollIntervalMs)
    timer.unref()
    ctx.effect(() => () => { clearInterval(timer) })
    schedule()
  }

  /**
   * Persist one Hub-authorized final; retries return its original inbox sequence.
   * @param request - Exact content and owner selected under the Hub's admission locks.
   * @returns The durable delivery after the backend append settles.
   */
  async admitFinal(request: TeamHumanFinalInput, proof: TeamHumanSinkProof): Promise<TeamHumanInboxFinal> {
    const input = teamHumanFinalInputSchema.parse(request)
    const validate = () => { this.ctx.teams.validateHumanSinkProof(proof, { kind: 'final', input }) }
    validate()
    return await this.serial(input.principalId, async (stream) => {
      validate()
      const record = await this.findAdmission(stream, { kind: 'final', ...input })
      if (record !== undefined) {
        const { kind: _kind, sequence: _sequence, ...prior } = record
        if (!isDeepStrictEqual(prior, input)) throw new TeamError('Principal delivery retry changed its exact final content', 'TEAM_FINAL_INVALID')
        validate()
        return record
      }
      const item: TeamHumanInboxFinal = { ...input, kind: 'final', sequence: stream.tailSequence + 1 }
      if (Buffer.byteLength(JSON.stringify(item), 'utf8') > this.config.maxDeliveryBytes) {
        throw new TeamError('Complete principal delivery exceeds maxDeliveryBytes', 'TEAM_CHANNEL_BACKPRESSURE')
      }
      validate()
      await stream.append(stream.tailSequence, [item])
      return item
    })
  }

  /**
   * Persist exact ordinary channel content without granting final-result authority.
   * @param request - Hub-validated Envelope, recipient and optional rendered view.
   * @returns Original delivery on retry, or the newly committed inbox item.
   */
  async admitMessage(request: TeamHumanMessageInput, proof: TeamHumanSinkProof): Promise<TeamHumanInboxMessage> {
    const input = teamHumanMessageInputSchema.parse(request)
    const validate = () => { this.ctx.teams.validateHumanSinkProof(proof, { kind: 'message', input }) }
    validate()
    return await this.serial(input.principalId, async (stream) => {
      validate()
      const record = await this.findAdmission(stream, { kind: 'message', ...input })
      if (record !== undefined) {
        const { kind: _kind, sequence: _sequence, ...prior } = record
        if (!isDeepStrictEqual(prior, input)) throw new TeamError('Human message retry changed its accepted content', 'TEAM_INVALID_ARGUMENT')
        validate()
        return record
      }
      const item: TeamHumanInboxMessage = { ...input, kind: 'message', sequence: stream.tailSequence + 1 }
      if (Buffer.byteLength(JSON.stringify(item), 'utf8') > this.config.maxDeliveryBytes) {
        throw new TeamError('Complete principal message exceeds maxDeliveryBytes', 'TEAM_CHANNEL_BACKPRESSURE')
      }
      validate()
      await stream.append(stream.tailSequence, [item])
      return item
    })
  }

  /**
   * Recover the immutable sink content referenced by an already committed human receipt.
   * @param input - Hub-validated principal, Team and Envelope selection.
   * @returns Exact persisted ordinary delivery, or undefined if storage has no such admission.
   */
  async getMessageAdmission(
    input: Pick<TeamHumanMessageInput, 'principalId' | 'teamId' | 'envelopeId'>, proof: TeamHumanSinkProof,
  ): Promise<TeamHumanInboxMessage | undefined> {
    const validate = () => { this.ctx.teams.validateHumanSinkProof(proof, { kind: 'message-read', input }) }
    validate()
    return await this.serial(input.principalId, async (stream) => {
      const item = await this.findAdmission(stream, { kind: 'message', ...input })
      validate()
      return item
    })
  }

  /** Register a provider retaining actual human-action callbacks. @param responder - Runtime continuation owner. @returns Disposer. */
  registerActionResponder(responder: TeamHumanActionResponder): () => void {
    this.actionResponders.add(responder)
    return () => { this.actionResponders.delete(responder) }
  }

  /**
   * Route one exact answer through a current continuation owner or explicit failure recovery.
   * @param call - Revocable authenticated product principal.
   * @param request - Actor-free action, revision, retry key and answer.
   * @returns Durable answer acceptance or explicit unavailability.
   */
  async respond(call: AuthenticatedProductCall, request: TeamHumanActionResponseInput): Promise<TeamHumanActionResponseResult> {
    const input = teamHumanActionResponseInputSchema.parse(request)
    this.assertCall(call)
    for (const responder of this.actionResponders) {
      const result = await responder.respond(call, input)
      this.assertCall(call)
      if (result !== undefined) return result
    }
    const fallback = this.actionResponders.values().next().value
    if (fallback === undefined) throw new TeamError('No human-action continuation provider is mounted', 'TEAM_INVALID_ARGUMENT')
    const result = await fallback.unavailable(call, input)
    this.assertCall(call)
    return result
  }

  /** Persist source-specific action revisions; answering always rereads the authoritative current action. */
  private async deliverActions(state: TeamStateSnapshot): Promise<void> {
    for (const action of state.humanActions ?? []) {
      for (const human of state.participants) {
        if (human.kind !== 'human' || human.phase !== 'active' || human.owner?.kind !== 'product-principal'
          || !human.authorityGrant?.operations.includes('human-action') || !human.authorityGrant.operations.includes('dispatch')) continue
        const principalId = human.owner.principalId
        const candidate = { kind: 'action' as const, principalId, recipientId: human.id, teamId: state.team.id,
          action, text: JSON.stringify(action.details) }
        const policy = await this.ctx.teams.authorize({ hook: 'human-action', teamId: state.team.id, actorId: human.id,
          facts: { operation: 'principal-inbox-delivery', actionId: action.id } })
        if (policy.kind !== 'allow') continue
        await this.serial(principalId, async (stream) => {
          const record = await this.findAdmission(stream, candidate)
          if (record !== undefined) {
            const { sequence: _sequence, ...prior } = record
            if (!isDeepStrictEqual(prior, candidate)) throw new TeamError('Human action revision changed its retained content', 'TEAM_INVALID_ARGUMENT')
            return
          }
          const item: TeamHumanInboxAction = { ...candidate, sequence: stream.tailSequence + 1 }
          if (Buffer.byteLength(JSON.stringify(item), 'utf8') > this.config.maxDeliveryBytes) {
            throw new TeamError('Complete principal action exceeds maxDeliveryBytes', 'TEAM_CHANNEL_BACKPRESSURE')
          }
          await stream.append(stream.tailSequence, [teamHumanInboxActionSchema.parse(item)])
        })
      }
    }
  }

  /** Drive one bounded page of durable human deliveries, including startup replay. @returns Settlement of this pass. */
  runOnce(): Promise<void> {
    if (this.drive !== undefined) return this.drive
    const operation = this.track(this.driveCycle())
    this.drive = operation
    void operation.then(() => { if (this.drive === operation) this.drive = undefined },
      () => { if (this.drive === operation) this.drive = undefined })
    return operation
  }

  private async driveCycle(): Promise<void> {
    const results = await Promise.allSettled([this.driveDeliveries(), this.driveRetention()])
    const failures: unknown[] = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Principal delivery and retention failed')
  }

  private async driveRetention(): Promise<void> {
    const limits = this.config.retention
    if (limits === undefined || this.isClosing()) return
    if (this.retentionNames.length === 0) {
      let page
      try {
        page = await this.ctx.storageLog.scanNames({ prefix: 'principal-inbox/',
          ...this.retentionCursor === undefined ? {} : { afterCursor: this.retentionCursor }, limit: limits.maxStreamsPerDrive })
      } catch (error: unknown) {
        if (error instanceof StorageLogError && error.code === 'scan-expired') { this.retentionCursor = undefined; return }
        throw error
      }
      this.retentionNames.push(...page.names)
      this.retentionCursor = page.nextCursor
    }
    let remainingRecords = limits.maxRecordsPerDrive
    let remainingBytes = limits.maxBytesPerDrive
    for (let count = 0; count < limits.maxStreamsPerDrive && !this.isClosing(); count++) {
      if (remainingRecords === 0 || remainingBytes === 0) return
      const name = this.retentionNames.shift()
      if (name === undefined) return
      const observed = await this.serialStream(name, async (stream) => {
        const checkpoint = await stream.readCheckpoint()
        if (checkpoint === undefined) return undefined
        const saved = inboxCheckpointSchema.parse(checkpoint.value)
        const principalId = productPrincipalId(saved.principalId)
        if (name !== inboxName(principalId) || checkpoint.sequence > stream.tailSequence
          || saved.displayCursor >= checkpoint.sequence
          || stream.firstSequence > 0 && (saved.indexedThroughCursor === undefined || saved.indexedThroughCursor < stream.firstSequence - 1)
          || saved.indexedThroughCursor !== undefined
            && (saved.indexedThroughCursor > saved.displayCursor || saved.indexedThroughCursor >= checkpoint.sequence)) {
          throw new TeamError('Principal retention checkpoint is invalid', 'TEAM_INVALID_ARGUMENT')
        }
        const through = Math.min(saved.displayCursor, stream.tailSequence - limits.tailRecords)
        if (through < stream.firstSequence) return undefined
        const candidates: { sequence: number; value: schema.infer<typeof recordSchema> }[] = []
        let sequence = stream.firstSequence
        let deferred = false
        for await (const record of this.records(stream, principalId, sequence - 1, Math.min(remainingRecords, through - sequence + 1))) {
          if (sequence > through) break
          const sourceBytes = Buffer.byteLength(JSON.stringify(record), 'utf8')
          const bytes = record.kind === 'display' || sourceBytes > limits.maxBytesPerDrive
            ? sourceBytes : Math.max(sourceBytes, inboxAdmissionBytes(record))
          remainingRecords--
          if (bytes > limits.maxBytesPerDrive) throw new TeamError('Inbox record exceeds retention.maxBytesPerDrive', 'TEAM_CHANNEL_BACKPRESSURE')
          if (bytes > remainingBytes) { deferred = candidates.length === 0; remainingBytes = 0; break }
          remainingBytes -= bytes
          candidates.push({ sequence, value: record })
          sequence++
        }
        return { principalId, checkpoint, saved, tail: stream.tailSequence, first: stream.firstSequence, candidates, deferred }
      })
      if (observed?.deferred === true) { this.retentionNames.unshift(name); return }
      if (observed === undefined || observed.candidates.length === 0) continue
      let through = observed.first - 1
      for (const row of observed.candidates) {
        if (row.value.kind === 'action') {
          const current = await this.ctx.teams.getHumanAction({ teamId: row.value.teamId, actionId: row.value.action.id })
          if (current.updatedAt < row.value.action.updatedAt) throw new TeamError('Inbox action is ahead of its source revision', 'TEAM_INVALID_ARGUMENT')
          if (current.phase === 'pending' && current.response === undefined) break
        }
        through = row.sequence
      }
      if (through < observed.first) continue
      await this.serialStream(name, async (stream) => {
        if (stream.tailSequence !== observed.tail || stream.firstSequence !== observed.first
          || !isDeepStrictEqual(await stream.readCheckpoint(), observed.checkpoint)) return
        for (const row of observed.candidates) {
          if (row.sequence > through) break
          if (row.value.kind !== 'display') await indexInboxAdmission(this.ctx, row.value)
        }
        await stream.writeCheckpoint({ sequence: observed.checkpoint.sequence, value: { ...observed.saved,
          indexedThroughCursor: Math.max(observed.saved.indexedThroughCursor ?? -1, through) } })
        await stream.compact({ throughSequence: through, expectedCheckpointSequence: observed.checkpoint.sequence })
      })
    }
  }

  /** Discover bounded Team pages and deliver only their currently pending principal-owned recipients. */
  private async driveDeliveries(): Promise<void> {
    if (this.isClosing()) return
    if (this.channelQueue.length === 0) {
      let page
      try { page = await this.ctx.teams.listTeamsPage({ afterCursor: this.teamCursor, limit: this.config.storagePageSize }) }
      catch (error: unknown) {
        if (error instanceof TeamError && error.code === 'TEAM_DISCOVERY_CURSOR_EXPIRED') { this.teamCursor = -1; return }
        throw error
      }
      if (page.nextCursor !== undefined && page.nextCursor === this.teamCursor) {
        throw new TeamError('Human delivery Team page cursor did not advance', 'TEAM_CURSOR_CONFLICT')
      }
      for (const team of page.items) {
        const state = await this.ctx.teams.getTeam({ teamId: team.id })
        await this.deliverActions(state)
        this.channelQueue.push(...state.channelIds.map(channelId => ({ teamId: team.id, channelId })))
      }
      this.teamCursor = page.nextCursor ?? -1
    }
    for (let count = 0; count < this.config.maxPageSize && !this.isClosing(); count += 1) {
      const selected = this.channelQueue.shift()
      if (selected === undefined) return
      try {
        const state = await this.ctx.teams.getTeam({ teamId: selected.teamId })
        if (state.team.cancellation !== undefined || (state.team.phase !== 'active'
          && !(state.team.phase === 'quiescing' && state.team.closure?.kind === 'complete'))) continue
        const snapshot = await this.ctx.teams.getChannel({ channelId: selected.channelId })
        if (snapshot.phase !== 'active' && snapshot.phase !== 'closed') continue
        const manifest = snapshot.manifest
        for (const human of state.participants) {
          if (human.kind !== 'human' || human.phase !== 'active' || human.owner?.kind !== 'product-principal'
            || !manifest.participants.some(member => member.id === human.id)) continue
          let page
          try {
            page = await this.ctx.teams.listChannelPendingDeliveries({ channelId: selected.channelId,
              participantId: human.id, afterCursor: -1, limit: this.config.storagePageSize })
          } catch (error: unknown) {
            if (snapshot.phase === 'closed' && error instanceof TeamError && error.code === 'TEAM_INVALID_ARGUMENT') continue
            throw error
          }
          for (const delivery of page.deliveries) {
            if (delivery.envelope.kind === 'final' || this.isClosing()) continue
            const channel = await this.ctx.teams.getChannel({ channelId: selected.channelId })
            const scope: TeamSystemHumanDeliveryScope = { ...selected, envelopeId: delivery.envelope.id,
              recipientId: human.id, principalId: human.owner.principalId, expectedCursor: channel.cursor }
            const token: object = {}
            Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Human delivery proofs are runtime-only') } })
            const proof = Object.freeze(token) as TeamSystemHumanDeliveryProof
            this.deliveryProofs.set(proof, scope)
            try { await this.ctx.teams.admitHumanChannelDelivery({ actor: proof, ...scope }) }
            finally { this.deliveryProofs.delete(proof) }
          }
        }
      } catch (error: unknown) {
        this.channelQueue.unshift(selected)
        throw error
      }
    }
  }

  /**
   * Read one principal-owned page, rechecking membership and dispatch policy for every item.
   * @param call - Current transport-authenticated principal lease.
   * @param request - Actor-free bounded page selection.
   * @returns A page whose omitted cursor begins after the shared display acknowledgement.
   */
  async read(call: AuthenticatedProductCall, request: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage> {
    return await this.readPage(call, request)
  }

  /** A display acknowledgement must not inspect deliveries beyond the selected cursor. */
  private async readPage(
    call: AuthenticatedProductCall, request: TeamHumanInboxReadInput, throughCursor?: number,
  ): Promise<TeamHumanInboxPage> {
    const input = teamHumanInboxReadInputSchema.parse(request)
    this.assertCall(call)
    const page = await this.serial(call.principal.id, async (stream) => {
      this.assertCall(call)
      const { displayCursor } = await this.displayState(stream, call.principal.id)
      const after = input.afterCursor ?? displayCursor
      if (after > stream.tailSequence) throw new TeamError('Inbox cursor is ahead of durable storage', 'TEAM_INVALID_ARGUMENT')
      const limit = Math.min(input.limit ?? this.config.maxPageSize, this.config.maxPageSize)
      const items: TeamHumanInboxItem[] = []
      let cursor = after
      for await (const record of this.records(stream, call.principal.id, after)) {
        if (record.kind === 'display') continue
        if (throughCursor !== undefined && record.sequence > throughCursor) break
        items.push(record)
        cursor = record.sequence
        if (items.length === limit) break
      }
      this.assertCall(call)
      return { items, displayCursor, cursor: items.length === limit ? cursor : stream.tailSequence,
        ...(items.length === limit && cursor < stream.tailSequence ? { nextCursor: cursor } : {}) }
    })
    for (const item of page.items) await this.assertVisible(call, item)
    this.assertCall(call)
    return page
  }

  /**
   * Long-poll storage using the same authenticated page checks as an ordinary read.
   * @param call - Revocable authenticated product call.
   * @param input - Cursor and page bound; omission begins after the shared display position.
   * @returns Newly readable items, or an empty page when the deployment timeout expires.
   */
  watch(call: AuthenticatedProductCall, input: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage> {
    if (this.operations.size >= this.config.maxPendingOperations) return Promise.reject(new TeamError('Principal inbox watch admission is full', 'TEAM_CHANNEL_BACKPRESSURE'))
    return this.track((async () => {
      const signal = AbortSignal.any([call.signal, this.stop.signal])
      const end = Date.now() + this.config.watchTimeoutMs
      for (;;) {
        const page = await this.read(call, input)
        if (page.items.length > 0 || Date.now() >= end) return page
        await delay(Math.min(this.config.pollIntervalMs, end - Date.now()), undefined, { signal })
      }
    })())
  }

  /**
   * Advance only the principal's shared display cursor, independently of channel receipts.
   * @param call - Current authenticated product call.
   * @param request - Exact inbox delivery sequence acknowledged by the client.
   * @returns The durable monotonic display position, including idempotent older acknowledgements.
   */
  async acknowledge(call: AuthenticatedProductCall, request: TeamHumanInboxAcknowledgeInput): Promise<TeamHumanInboxAcknowledgement> {
    const input = teamHumanInboxAcknowledgeInputSchema.parse(request)
    this.assertCall(call)
    let cursor: number | undefined
    for (;;) {
      const page = await this.readPage(call, { afterCursor: cursor, limit: this.config.maxPageSize }, input.throughCursor)
      const end = page.items.at(-1)?.sequence
      if (end === undefined || end >= input.throughCursor || page.nextCursor === undefined) break
      cursor = page.nextCursor
    }
    const observed = await this.serial(call.principal.id, async (stream) => {
      this.assertCall(call)
      const { displayCursor } = await this.displayState(stream, call.principal.id)
      return { displayCursor, item: input.throughCursor <= displayCursor ? undefined
        : await this.displayTarget(stream, call.principal.id, input.throughCursor) }
    })
    this.assertCall(call)
    if (observed.item === undefined) return { displayCursor: observed.displayCursor }
    await this.assertVisible(call, observed.item)
    return await this.serial(call.principal.id, async (stream) => {
      const { displayCursor, indexedThroughCursor } = await this.displayState(stream, call.principal.id)
      this.assertCall(call)
      if (input.throughCursor <= displayCursor) return { displayCursor }
      const selected = await this.displayTarget(stream, call.principal.id, input.throughCursor)
      if (!isDeepStrictEqual(selected, observed.item)) {
        throw new TeamError('Display acknowledgement delivery changed during authorization', 'TEAM_INVALID_ARGUMENT')
      }
      this.assertCall(call)
      await stream.append(stream.tailSequence, [{ kind: 'display', principalId: call.principal.id, throughCursor: input.throughCursor }])
      await stream.writeCheckpoint({
        sequence: stream.tailSequence,
        value: { version: 1, principalId: call.principal.id, displayCursor: input.throughCursor,
          ...indexedThroughCursor === undefined ? {} : { indexedThroughCursor } },
      })
      return { displayCursor: input.throughCursor }
    })
  }

  /** Select an immutable owned delivery without consulting Team services under the inbox serializer. */
  private async displayTarget(stream: LogStream, principalId: ProductPrincipalId, throughCursor: number): Promise<TeamHumanInboxItem> {
    const row = (await stream.read(throughCursor - 1, 1))[0]
    const selected = row === undefined ? undefined : recordSchema.parse(row.value)
    if (selected === undefined || selected.kind === 'display' || selected.sequence !== throughCursor || selected.principalId !== principalId) {
      throw new TeamError('Display acknowledgement must select a retained inbox delivery', 'TEAM_INVALID_ARGUMENT')
    }
    return selected
  }

  /** Stop admission and long polls, then await every admitted storage call before disposal. */
  async close(): Promise<void> {
    this.stop.abort()
    await Promise.allSettled([...this.operations])
  }

  /** Display appends are authoritative even when their following checkpoint write never completes. */
  private async displayState(stream: LogStream, principalId: ProductPrincipalId): Promise<{
    displayCursor: number
    indexedThroughCursor?: number
  }> {
    const checkpoint = await stream.readCheckpoint()
    const saved = checkpoint === undefined ? undefined : inboxCheckpointSchema.parse(checkpoint.value)
    if (checkpoint !== undefined && (saved?.principalId !== principalId || checkpoint.sequence > stream.tailSequence
      || saved.displayCursor >= checkpoint.sequence)) {
      throw new TeamError('Principal inbox display checkpoint is invalid', 'TEAM_INVALID_ARGUMENT')
    }
    let displayCursor = saved?.displayCursor ?? -1
    const indexed = saved?.indexedThroughCursor === undefined ? {} : { indexedThroughCursor: saved.indexedThroughCursor }
    if ((checkpoint?.sequence ?? -1) === stream.tailSequence) return { displayCursor, ...indexed }
    for await (const record of this.records(stream, principalId, checkpoint?.sequence ?? -1)) {
      if (record.kind !== 'display') continue
      const row = (await stream.read(record.throughCursor - 1, 1))[0]
      const target = row === undefined ? undefined : teamHumanInboxItemSchema.safeParse(row.value)
      if (record.throughCursor < displayCursor || row?.sequence !== record.throughCursor
        || target?.success !== true || target.data.sequence !== row.sequence || target.data.principalId !== principalId) {
        throw new TeamError('Principal display record does not select a monotonic retained delivery', 'TEAM_INVALID_ARGUMENT')
      }
      displayCursor = record.throughCursor
    }
    const state = { displayCursor, ...indexed }
    if (displayCursor !== (saved?.displayCursor ?? -1)) {
      await stream.writeCheckpoint({ sequence: stream.tailSequence, value: { version: 1, principalId, ...state } })
    }
    return state
  }

  /** Resolve immutable references from their anchors before scanning the retained display suffix. */
  private async findAdmission<Key extends InboxAdmissionKey>(stream: LogStream,
    key: Key): Promise<Extract<TeamHumanInboxItem, { kind: Key['kind'] }> | undefined> {
    let after = -1
    if (stream.firstSequence > 0) {
      const checkpoint = await stream.readCheckpoint()
      const saved = checkpoint === undefined ? undefined : inboxCheckpointSchema.parse(checkpoint.value)
      if (saved?.principalId !== key.principalId || saved.indexedThroughCursor === undefined
        || saved.indexedThroughCursor < stream.firstSequence - 1 || saved.indexedThroughCursor > saved.displayCursor
        || checkpoint === undefined || checkpoint.sequence > stream.tailSequence || saved.indexedThroughCursor >= checkpoint.sequence) {
        throw new TeamError('Compacted principal inbox has no admission reference checkpoint', 'TEAM_INVALID_ARGUMENT')
      }
      const indexed = await readInboxAdmission(this.ctx, key)
      if (indexed !== undefined && indexed.sequence <= saved.indexedThroughCursor) return indexed
      after = stream.firstSequence - 1
    }
    for await (const record of this.records(stream, key.principalId, after)) {
      if (record.kind !== 'display' && isInboxAdmission(record, key)) return record
    }
    return undefined
  }

  /** Validate each durable boundary with fixed-page memory and no retained transcript projection. */
  private async *records(
    stream: LogStream, principalId: ProductPrincipalId, after = -1, maxRecords?: number,
  ): AsyncGenerator<schema.infer<typeof recordSchema>> {
    if (after < stream.firstSequence - 1) {
      throw new TeamError('Principal inbox history was compacted; read from firstCursor - 1 to inspect the retained history',
        'TEAM_INBOX_COMPACTED', { details: { firstCursor: stream.firstSequence } })
    }
    let cursor = after
    let displayCursor = -1
    let consumed = 0
    for (;;) {
      const limit = maxRecords === undefined ? this.config.storagePageSize : Math.min(this.config.storagePageSize, maxRecords - consumed)
      if (limit === 0) return
      const rows = await stream.read(cursor, limit)
      if (rows.length === 0) return
      for (const row of rows) {
        if (row.sequence <= cursor) {
          throw new TeamError('Principal inbox storage cursor did not advance', 'TEAM_INVALID_ARGUMENT')
        }
        const value = recordSchema.parse(row.value)
        if (value.principalId !== principalId || value.kind !== 'display' && value.sequence !== row.sequence
          || value.kind === 'display' && value.throughCursor >= row.sequence) {
          throw new TeamError('Principal inbox record has invalid ownership or sequence', 'TEAM_INVALID_ARGUMENT')
        }
        if (value.kind === 'display' && after === -1) {
          const target = (await stream.read(value.throughCursor - 1, 1))[0]
          if (value.throughCursor < displayCursor || target?.sequence !== value.throughCursor
            || !teamHumanInboxItemSchema.safeParse(target.value).success) {
            throw new TeamError('Principal display record does not select a monotonic retained delivery', 'TEAM_INVALID_ARGUMENT')
          }
          displayCursor = value.throughCursor
        }
        yield value
        consumed++
        cursor = row.sequence
      }
    }
  }

  /** Recheck durable ownership after extensible policy before returning private content. */
  private async assertVisible(call: AuthenticatedProductCall, item: TeamHumanInboxItem): Promise<void> {
    this.assertCall(call)
    const check = async (): Promise<void> => {
      const state = await this.ctx.teams.getTeam({ teamId: item.teamId })
      this.assertCall(call)
      const matches = state.participants.filter(p => p.kind === 'human' && p.phase === 'active'
        && p.owner?.kind === 'product-principal' && p.owner.principalId === call.principal.id)
      if (matches.length !== 1 || matches[0]?.id !== item.recipientId) {
        throw new TeamError('Authenticated principal does not own exactly one active delivery recipient', matches.length > 1 ? 'TEAM_HUMAN_ACTOR_AMBIGUOUS' : 'TEAM_HUMAN_ACTOR_NOT_FOUND')
      }
      if (!matches[0].authorityGrant?.operations.includes('dispatch')
        || item.kind === 'action' && !matches[0].authorityGrant.operations.includes('human-action')) throw new TeamError('Human grant denies inbox access', 'TEAM_HUMAN_ACTOR_FORBIDDEN')
    }
    await check()
    const decision = await this.ctx.teams.authorize({ hook: item.kind === 'action' ? 'human-action' : 'dispatch', teamId: item.teamId, actorId: item.recipientId,
      facts: item.kind === 'action' ? { operation: 'principal-inbox-read', actionId: item.action.id }
        : { operation: 'principal-inbox-read', channelId: item.channelId, envelopeId: item.envelopeId } })
    if (decision.kind !== 'allow') throw new TeamError('Team policy denies principal inbox access', 'TEAM_HUMAN_ACTOR_FORBIDDEN')
    await check()
  }

  /** Read the mutable cancellation state without retaining a narrowing across awaits. */
  private isClosing(): boolean { return this.stop.signal.aborted }

  /** Do not expose retained principal facts after its carrier or this Consumer retires. */
  private assertCall(call: AuthenticatedProductCall): void {
    if (call.signal.aborted || this.isClosing()) throw new TeamError('Principal inbox authentication is no longer live', 'TEAM_ACTOR_PROOF_INVALID')
  }

  /** One storage handle owner bounds open resources and serializes display and delivery appends. */
  private serial<T>(principalId: ProductPrincipalId, operation: (stream: LogStream) => Promise<T>): Promise<T> {
    return this.serialStream(inboxName(principalId), operation)
  }

  private serialStream<T>(name: string, operation: (stream: LogStream) => Promise<T>): Promise<T> {
    if (this.isClosing()) return Promise.reject(new TeamError('Principal inbox is closed', 'TEAM_ACTOR_PROOF_INVALID'))
    if (this.pending >= this.config.maxPendingOperations) return Promise.reject(new TeamError('Principal inbox admission is full', 'TEAM_CHANNEL_BACKPRESSURE'))
    this.pending += 1
    const result = this.queue.then(async () => {
      const stream = await this.ctx.storageLog.open({ name, version: 1 })
      try { return await operation(stream) } finally { await stream.close() }
    })
    // The queue tail contains failures only to keep later independent operations runnable.
    this.queue = result.catch(() => undefined).finally(() => { this.pending -= 1 })
    return this.track(result)
  }

  /** Retain accepted work until quiescent disposal without converting failures into success. */
  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation))
    return operation
  }
}

function inboxName(principalId: ProductPrincipalId): string {
  return `principal-inbox/${createHash('sha256').update(principalId).digest('hex')}`
}

/**
 * Mount the durable inbox Consumer.
 * @param ctx - Plugin context.
 * @param config - Explicit deployment limits.
 * @returns Async disposal after admitted work settles.
 */
export function apply(ctx: Context, config: Config): () => Promise<void> {
  const service = new TeamHumanClient(ctx, config)
  return () => service.close()
}
