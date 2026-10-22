import { createWorldBackup } from '@clocky/clocky-simulation-team'
import type { SimulationProductBackupExportInput, SimulationProductBackupExportResult } from './retention-types.ts'
import { simulationProductBackupExportResultSchema } from './retention-schema.ts'
/** Durable original retention commands. Accepted full bytes precede the completed location pointer in one owner journal. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { Context } from '@clocky/cordis'
import type { LogStream } from '@clocky/clocky-storage'
import type {} from '@clocky/clocky-storage-log'
import { verifyWorldArchive, planWorldArchive } from '@clocky/clocky-simulation-team'
import type { WorldArchiveBody } from '@clocky/clocky-simulation-team'
import { simulationProductRetentionPlanSchema, simulationProductRetentionExecuteInputSchema,
  simulationProductRetentionResultSchema, simulationProductRetentionRecordsResultSchema } from './retention-schema.ts'
import type { SimulationProductRetentionPlan, SimulationProductRetentionExecuteInput, SimulationProductRetentionReadInput,
  SimulationProductRetentionResult, SimulationProductRetentionRecordsInput, SimulationProductRetentionRecordsResult } from './retention-types.ts'
import { SimulationProductError } from './index.ts'
const hash = (body: WorldArchiveBody) => createHash('sha256').update(JSON.stringify(body)).digest('hex')
const recordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accepted'), ownerPrincipalId: z.string().min(1),
    input: simulationProductRetentionExecuteInputSchema, plan: simulationProductRetentionPlanSchema, body: z.json() }),
  z.strictObject({ kind: z.literal('completed'), commandId: z.string().min(1), archiveHash: z.string().regex(/^[a-f0-9]{64}$/) }),
])
type Accepted = Extract<z.infer<typeof recordSchema>, { kind: 'accepted' }>
interface Original { readonly accepted: Accepted; completed: boolean }
/** One product-held archive journal, independent of model-written Native history. */
export class ProductRetention {
  private stream: LogStream | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private readonly originals = new Map<string, Original>()
  private closing = false
  /**
   * @param ctx - Routed storage owner.
   * @param name - Private deployment-selected journal.
   * @param limits - Resolved archive and command bounds.
   */
  constructor(private readonly ctx: Context, private readonly name: string,
    private readonly limits: { maxEntries: number; maxBytes: number; pageSize: number; maxCommands: number; maxResponseBytes: number }) {}

  /** Close admission and drain all accepted archive writes before releasing storage. */
  async close(): Promise<void> { this.closing = true; await this.tail; await this.stream?.close() }

  /** Pure preview of an exact frozen body; no durable archive or original command is created.
   * @param runId - Authenticated product directory identity.
   * @param body - Complete owner-validated archive closure.
   * @returns finite source-bound retention metadata without private record bodies.
   */
  preview(runId: SimulationProductRetentionPlan['runId'], body: WorldArchiveBody): SimulationProductRetentionPlan {
    const planned = planWorldArchive(body, this.limits, this.ctx.simulationTeams.worldArchiveProviders())
    const snapshot = z.object({ revision: z.number().int().nonnegative() }).parse(body.snapshot)
    const refs = z.object({ sessions: z.array(z.object({ kind: z.enum(['materialized', 'unmaterialized']) })) }).parse(body.references)
    return simulationProductRetentionPlanSchema.parse({ runId, version: 1, planHash: planned.hash, snapshotRevision: snapshot.revision,
      bytes: planned.bytes, nativeEntries: planned.nativeEntries, ownerStreams: planned.ownerStreams,
      materializedSessions: planned.materializedSessions, unmaterializedSessions: refs.sessions.filter(ref => ref.kind === 'unmaterialized').length,
      attachments: planned.attachments, destructive: false, reclaimableBytes: 0, pinPolicy: 'complete-owner-history' })
  }

  /** Original acceptance freezes full bytes; retries use the original body even if the live run later changes.
   * @param input - Immutable user command and preview identity.
   * @param principalId - Actual authenticated owner, never selected by input.
   * @param authorize - Current authority check before and after awaited IO.
   * @param capture - Original quiescent source exporter, used only before first acceptance.
   * @returns retained original status after verified location publication.
   */
  execute(input: SimulationProductRetentionExecuteInput, principalId: string, authorize: () => void,
    capture: () => Promise<WorldArchiveBody>): Promise<SimulationProductRetentionResult> {
    return this.serial(authorize, async () => {
      let original = this.originals.get(input.commandId)
      if (original !== undefined) this.same(original, input.runId, principalId, input)
      else {
        if (this.originals.size >= this.limits.maxCommands) throw unavailable('Retention command history capacity is occupied')
        const body = await capture(), plan = this.preview(input.runId, body)
        authorize()
        if (plan.planHash !== input.planHash || plan.snapshotRevision !== input.expectedRevision) throw invalid('Retention source moved; obtain a new preview')
        const record = recordSchema.parse({ kind: 'accepted', ownerPrincipalId: principalId, input, plan, body })
        await this.append(record)
        original = this.originals.get(input.commandId)
        if (original === undefined) throw new Error('Retention acceptance was not retained')
      }
      authorize()
      // Recheck the exact retained bytes before publishing or returning the original completed location.
      const verified = verifyWorldArchive(JSON.stringify(original.accepted.body), this.limits,
        this.ctx.simulationTeams.worldArchiveProviders())
      if (hash(verified) !== input.planHash) throw unavailable('Retention archive integrity check failed')
      if (!original.completed) await this.append({ kind: 'completed', commandId: input.commandId, archiveHash: input.planHash })
      return this.result(original)
    })
  }

  /** Return the durable original status without requiring a currently held live simulation owner.
   * @param input - Exact original run and command.
   * @param principalId - Actual authenticated owner.
   * @param authorize - Current ownership and credential check.
   * @returns original bounded status or authorized absence.
   */
  read(input: SimulationProductRetentionReadInput, principalId: string, authorize: () => void): Promise<SimulationProductRetentionResult> {
    return this.serial(authorize, () => {
      const original = this.originals.get(input.commandId)
      if (original === undefined) return simulationProductRetentionResultSchema.parse({ ...input, status: 'not-found' })
      this.same(original, input.runId, principalId)
      return this.result(original)
    })
  }

  /** Read an original bounded owner page only after independent whole-record authorization.
   * @param input - Original archived owner and finite page selection.
   * @param principalId - Actual authenticated owner.
   * @param authorize - Independent whole-record grant and ownership check.
   * @returns exact immutable source records within response bounds.
   */
  records(input: SimulationProductRetentionRecordsInput, principalId: string,
    authorize: () => void): Promise<SimulationProductRetentionRecordsResult> {
    return this.serial(authorize, () => {
      const original = this.originals.get(input.commandId)
      if (original === undefined || !original.completed) throw unavailable('Original completed archive is unavailable')
      this.same(original, input.runId, principalId)
      const body = verifyWorldArchive(JSON.stringify(original.accepted.body), this.limits, this.ctx.simulationTeams.worldArchiveProviders())
      const refs = z.object({ team: z.object({ owner: z.object({ teamId: z.string() }), stream: z.object({ name: z.string() }) }),
        channels: z.array(z.object({ owner: z.object({ channelId: z.string() }),
          stream: z.object({ name: z.string() }) })) }).parse(body.references)
      let entries: WorldArchiveBody['native']['entries'] | undefined
      if (input.owner === 'native' && input.ownerId === input.runId) entries = body.native.entries
      if (input.owner === 'team' && refs.team.owner.teamId === input.ownerId) entries = body.owners.find(stream => stream.name === refs.team.stream.name)?.entries
      if (input.owner === 'channel') {
        const reference = refs.channels.find(ref => ref.owner.channelId === input.ownerId)
        if (reference !== undefined) entries = body.owners.find(stream => stream.name === reference.stream.name)?.entries
      }
      if (input.owner === 'session') entries = body.sessions.find(session => z.object({ id: z.string() }).parse(session.header).id === input.ownerId)?.events.map((value, sequence) => ({ sequence, value }))
      if (entries === undefined) throw unavailable('Original archived owner is unavailable')
      const selected = entries.filter(entry => entry.sequence > input.afterSequence).slice(0, input.limit)
      const result = simulationProductRetentionRecordsResultSchema.parse({ runId: input.runId, commandId: input.commandId,
        archiveHash: original.accepted.plan.planHash, owner: input.owner, ownerId: input.ownerId, entries: selected,
        hasMore: entries.length > (selected.at(-1)?.sequence ?? input.afterSequence) + 1 })
      if (Buffer.byteLength(JSON.stringify(result)) > this.limits.maxResponseBytes) throw invalid('Archive record page exceeds complete response byte bounds')
      return result
    })
  }

  /** Resolve a complete immutable source only under independent whole-record disclosure.
   * @param input - Exact retained original source.
   * @param principalId - Authenticated current author.
   * @param authorize - Current source ownership and disclosure lease.
   * @returns detached verified owner archive; no live run, Session or model is opened.
   */
  source(input: SimulationProductRetentionReadInput, principalId: string, authorize: () => void): Promise<WorldArchiveBody> {
    return this.serial(authorize, () => {
      const original = this.originals.get(input.commandId)
      if (original === undefined || !original.completed) throw unavailable('Original completed archive is unavailable')
      this.same(original, input.runId, principalId)
      return verifyWorldArchive(JSON.stringify(original.accepted.body), this.limits, this.ctx.simulationTeams.worldArchiveProviders())
    })
  }

  /** Export an immutable completed original after a separate private-record grant.
   * @param input - Original retained command.
   * @param principalId - Authenticated owner.
   * @param authorize - Current private-record authority, rechecked after IO.
   * @returns complete portable bytes within the response allowance; never recaptures or invokes a model.
   */
  backupExport(input: SimulationProductBackupExportInput, principalId: string,
    authorize: () => void): Promise<SimulationProductBackupExportResult> {
    return this.serial(authorize, () => {
      const original = this.originals.get(input.commandId)
      if (original === undefined || !original.completed) throw unavailable('Original completed archive is unavailable')
      this.same(original, input.runId, principalId)
      const body = verifyWorldArchive(JSON.stringify(original.accepted.body), this.limits, this.ctx.simulationTeams.worldArchiveProviders())
      const bundle = JSON.stringify(createWorldBackup(body, this.limits, undefined, this.ctx.simulationTeams.worldArchiveProviders()))
      const result = simulationProductBackupExportResultSchema.parse({ ...input, archiveHash: original.accepted.plan.planHash,
        bundleHash: createHash('sha256').update(bundle).digest('hex'), kind: 'full-private-backup', bundle })
      if (Buffer.byteLength(JSON.stringify(result)) > this.limits.maxResponseBytes) throw invalid('Complete backup response exceeds byte allowance')
      return result
    })
  }

  private same(original: Original, runId: string, principalId: string, input?: SimulationProductRetentionExecuteInput) {
    if (original.accepted.ownerPrincipalId !== principalId || original.accepted.input.runId !== runId)
      throw new SimulationProductError('Retention original is unavailable', 'SIMULATION_PRODUCT_FORBIDDEN')
    if (input !== undefined && !isDeepStrictEqual(original.accepted.input, input)) throw invalid('Retention command identity has another original payload')
  }
  private result(original: Original): SimulationProductRetentionResult {
    return simulationProductRetentionResultSchema.parse({ runId: original.accepted.input.runId,
      commandId: original.accepted.input.commandId,
      status: original.completed ? 'completed' : 'accepted', plan: original.accepted.plan,
      ...original.completed ? { archiveHash: original.accepted.plan.planHash } : {} })
  }
  private async load() {
    if (this.stream !== undefined) return
    const stream = await this.ctx.storageLog.open({ name: this.name, version: 1 })
    try {
      if (stream.firstSequence !== 0 || stream.tailSequence + 1 > this.limits.maxCommands * 2) throw unavailable('Retention history is incomplete or exceeds capacity')
      let after = -1
      while (after < stream.tailSequence) {
        const page = await stream.read(after, this.limits.pageSize)
        if (!page.length) throw unavailable('Retention history has a gap')
        for (const entry of page) {
          if (entry.sequence !== after + 1) throw unavailable('Retention history has a sequence gap')
          this.fold(entry.value); after = entry.sequence
        }
      }
      this.stream = stream
    } catch (error) { this.originals.clear(); await stream.close(); throw error }
  }
  private fold(value: unknown) {
    const record = recordSchema.parse(value)
    if (record.kind === 'accepted') {
      if (this.originals.has(record.input.commandId)) throw unavailable('Retention original was accepted twice')
      const body = verifyWorldArchive(JSON.stringify(record.body), this.limits, this.ctx.simulationTeams.worldArchiveProviders())
      if (!isDeepStrictEqual(this.preview(record.input.runId, body), record.plan) || record.plan.planHash !== record.input.planHash
        || record.plan.snapshotRevision !== record.input.expectedRevision) throw unavailable('Retention original payload failed integrity validation')
      this.originals.set(record.input.commandId, { accepted: record, completed: false })
    } else {
      const original = this.originals.get(record.commandId)
      if (original === undefined || original.completed || original.accepted.plan.planHash !== record.archiveHash) throw unavailable('Retention location lost its original acceptance')
      original.completed = true
    }
  }
  private async append(value: z.infer<typeof recordSchema>) {
    if (this.stream === undefined) throw new Error('Retention journal is not open')
    if (Buffer.byteLength(JSON.stringify(value)) > this.limits.maxBytes) throw invalid('Complete retained archive entry exceeds byte allowance')
    try { await this.stream.append(this.stream.tailSequence, [value]) }
    catch (error) {
      // Re-read the durable outcome on retry instead of assuming a failed waiter means no accepted bytes.
      const stream = this.stream; this.stream = undefined; this.originals.clear(); await stream.close(); throw error
    }
    this.fold(value)
  }
  private serial<T>(authorize: () => void, operation: () => T | Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(unavailable('Retention owner is closing'))
    const work = this.tail.then(async () => {
      authorize(); await this.load(); authorize(); const result = await operation(); authorize(); return result
    })
    this.tail = work.then(() => {}, () => {})
    return work
  }
}
function invalid(message: string) { return new SimulationProductError(message, 'SIMULATION_PRODUCT_INVALID') }
function unavailable(message: string) { return new SimulationProductError(message, 'SIMULATION_PRODUCT_UNAVAILABLE') }
