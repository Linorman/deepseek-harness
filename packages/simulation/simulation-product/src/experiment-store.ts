/** Private original branch commands; completion is a distinct family and never fabricates a World preflight approval. */
import { z } from 'zod'
import { scenarioCatalogSchema } from '@clocky/clocky-simulation-scenario'
import { SimulationProductError } from './index.ts'
import { isDeepStrictEqual } from 'node:util'
import type { WorldBackupBundle } from '@clocky/clocky-simulation-team'
import type { LogStream } from '@clocky/clocky-storage'
import type { SimulationProductRecord } from './registration-types.ts'
import type { SimulationWorldPreparation } from './world-preparation.ts'
import { simulationWorldPreparationSchema } from './world-creation.ts'
import { simulationProductRecordSchema } from './directory.ts'
import { simulationProductWorldBranchInputSchema, simulationProductWorldBranchResultSchema } from './experiment-schema.ts'
import type { SimulationProductWorldBranchInput, SimulationProductWorldBranchResult } from './experiment-types.ts'
/** Actual new branch execution configuration and immutable source identity, independent of original world-create approval. */
export interface SimulationWorldBranchCreation {
  readonly kind: 'world-branch'
  readonly record: SimulationProductRecord
  readonly preparation: SimulationWorldPreparation
  readonly input: SimulationProductWorldBranchInput
  readonly sourceHash: string
}
const acceptedSchema = z.strictObject({ kind: z.literal('accepted'), input: simulationProductWorldBranchInputSchema,
  record: simulationProductRecordSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  parentPreparation: simulationWorldPreparationSchema, legacyCatalog: scenarioCatalogSchema.optional() }).refine(value =>
  value.parentPreparation.resolved.apiVersion === 'clocky.world/v1' ? value.legacyCatalog === undefined : value.legacyCatalog !== undefined,
'Legacy branch originals require their frozen complete compiler catalog')
const completedSchema = z.strictObject({ kind: z.literal('completed'), commandId: z.uuid(), preparation: simulationWorldPreparationSchema })
const eventSchema = z.discriminatedUnion('kind', [acceptedSchema, completedSchema])
type Original = z.infer<typeof acceptedSchema> & { creation?: SimulationWorldBranchCreation }
/** Parse exact separate branch provenance; no original World preflight approval is created.
 * @param bundle - Complete hash-verified private bundle with branch journal provenance.
 * @returns original completed branch configuration; incomplete, changed or unrelated provenance rejects.
 */
export function productWorldBranchBackupCreation(bundle: WorldBackupBundle): SimulationWorldBranchCreation {
  const envelope = z.strictObject({ family: z.literal('world-branch'), entries: z.array(eventSchema).length(2) }).parse(bundle.productJournal)
  const creation = parseBranchFrames(envelope.entries)
  const state = z.object({ spec: z.unknown(), phase: z.literal('paused'),
    world: z.object({ definition: z.unknown() }),
    experiment: z.object({ namespace: z.string(), sourceHash: z.string(), memoryPolicy: z.string() }) }).parse(bundle.body.snapshot)
  if (!isDeepStrictEqual(state.spec, creation.record.spec) || state.experiment.namespace !== creation.input.commandId
    || state.experiment.sourceHash !== creation.sourceHash || state.experiment.memoryPolicy !== creation.input.memoryPolicy
    || !isDeepStrictEqual(state.world.definition, creation.preparation.resolved.world)) throw new Error('Branch backup differs from its original runtime and provenance')
  return creation
}
function parseBranchFrames(values: readonly unknown[]): SimulationWorldBranchCreation {
  const [first, last] = z.array(eventSchema).length(2).parse(values)
  if (first?.kind !== 'accepted' || last?.kind !== 'completed' || last.commandId !== first.input.commandId
    || first.record.id !== `world-branch-${first.input.commandId}` || String(first.record.spec.runId) !== String(first.record.id)
    || first.record.name !== first.input.name || last.preparation.ownerName !== `simulation/experiment/${first.input.commandId}`
    || last.preparation.checkpoint.id !== `product-branch/${first.input.commandId}`) throw new Error('Branch backup requires its exact completed original frames')
  const { runId: _runId, ...native } = first.record.spec
  if (!isDeepStrictEqual(native, last.preparation.resolved.native)) throw new Error('Branch runtime specification differs from its original target')
  return { kind: 'world-branch', record: first.record, input: first.input, sourceHash: first.sourceHash, preparation: last.preparation }
}
/** One exclusive bounded branch journal; its caller owns source permission and Native/Team lifecycle. */
export class ProductExperimentStore {
  private readonly frames = new Map<string, { accepted: z.infer<typeof acceptedSchema>; completed?: z.infer<typeof completedSchema> }>()
  private readonly originals = new Map<string, Original>()
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private entries = 0
  /** @param stream - Exclusive version-1 original branch journal. @param limits - Complete durable bounds. */
  constructor(private readonly stream: LogStream, private readonly limits: { maxCommands: number; maxBytes: number; pageSize: number }) {}
  /** Recover discovery and exact commands without opening Native owners or Sessions. */
  async load(): Promise<void> {
    if (this.stream.firstSequence !== 0 || this.stream.version !== 1) throw new Error('Branch journal prefix/version is invalid')
    let after = -1
    while (after < this.stream.tailSequence) {
      const rows = await this.stream.read(after, this.limits.pageSize)
      if (!rows.length) throw new Error('Branch journal suffix is missing')
      for (const row of rows) {
        if (row.sequence !== after + 1) throw new Error('Branch journal sequence is invalid')
        this.bound(row.value); this.fold(eventSchema.parse(row.value)); after = row.sequence; this.entries++
        if (this.entries > this.limits.maxCommands * 2) throw new Error('Branch journal capacity exceeded')
      }
    }
  }
  /** Completed new execution configurations for startup discovery; private source bodies are omitted.
   * @returns detached completed branch configurations from this original owner.
   */
  creations(): readonly SimulationWorldBranchCreation[] {
    return [...this.originals.values()].flatMap(value => value.creation === undefined ? [] : [structuredClone(value.creation)])
  }
  /** Resolve a completed owned branch; original authority is checked by the enclosing authenticated service.
   * @param runId - Exact product run identity.
   * @returns detached completed creation, or undefined.
   */
  creation(runId: string): SimulationWorldBranchCreation | undefined {
    const value = [...this.originals.values()].find(original => original.record.id === runId)?.creation
    return value === undefined ? undefined : structuredClone(value)
  }
  /** Read without executing a retained command; missing/foreign commands are indistinguishable.
   * @param commandId - Exact caller-retained UUID.
   * @param principalId - Authenticated current principal.
   * @returns redacted durable status.
   */
  read(commandId: string, principalId: string): SimulationProductWorldBranchResult {
    if (this.closed) throw new SimulationProductError('Branch journal unavailable until recovery', 'SIMULATION_PRODUCT_UNAVAILABLE')
    const original = this.originals.get(commandId)
    if (original === undefined || original.record.ownerPrincipalId !== principalId) return { status: 'not-found', commandId }
    return this.result(original)
  }
  /** Retain original input before Native IO, then retain a separately validated branch runtime before directory registration.
   * @param input - Exact original public command.
   * @param principalId - Actual authenticated author.
   * @param authorize - Live source disclosure and ownership check.
   * @param authorizeSource - Independent source disclosure, required only for new or incomplete work.
   * @param resolve - First-accept resolution; retries never substitute current compiler defaults.
   * @param execute - Native/Team branch preparation from this exact retained source and target.
   * @param register - Idempotent paused discovery publication.
   * @returns durable original completion, or retains acceptance if preparation/append acknowledgement is uncertain.
   */
  execute(input: SimulationProductWorldBranchInput, principalId: string, authorize: () => void, authorizeSource: () => void,
    resolve: () => Promise<Omit<z.infer<typeof acceptedSchema>, 'kind' | 'input'>>,
    execute: (original: z.infer<typeof acceptedSchema>) => Promise<SimulationWorldPreparation>,
    register: (creation: SimulationWorldBranchCreation) => Promise<void>): Promise<SimulationProductWorldBranchResult> {
    if (this.closed) return Promise.reject(new SimulationProductError('Branch journal unavailable until recovery', 'SIMULATION_PRODUCT_UNAVAILABLE'))
    const result = this.tail.then(async () => {
      if (this.closed) throw new SimulationProductError('Branch journal unavailable until recovery', 'SIMULATION_PRODUCT_UNAVAILABLE')
      authorize()
      let original = this.originals.get(input.commandId)
      if (!original?.creation) authorizeSource()
      if (original) {
        if (original.record.ownerPrincipalId !== principalId || !isDeepStrictEqual(original.input, input)) throw new SimulationProductError('Branch command original changed', 'SIMULATION_PRODUCT_INVALID')
      } else {
        if (this.originals.size >= this.limits.maxCommands) throw new Error('Branch command capacity occupied')
        const resolved = await resolve(); authorize(); authorizeSource()
        if (resolved.record.ownerPrincipalId !== principalId) throw new Error('Branch original principal differs')
        await this.append(acceptedSchema.parse({ kind: 'accepted', input, ...resolved }))
        original = this.originals.get(input.commandId)
        if (!original) throw new Error('Branch accepted original is missing')
      }
      if (original.creation === undefined) {
        const preparation = await execute(structuredClone(original)); authorize(); authorizeSource()
        await this.append(completedSchema.parse({ kind: 'completed', commandId: input.commandId, preparation }))
      }
      const creation = this.originals.get(input.commandId)?.creation
      if (!creation) throw new Error('Branch completed original is missing')
      authorize(); await register(structuredClone(creation)); authorize()
      return this.result(this.originals.get(input.commandId) ?? original)
    })
    this.tail = result.then(() => {}, () => {}); return result
  }
  /** Read the exact original branch family for a full private backup.
   * @param commandId - Original completed branch UUID.
   * @param principalId - Current authenticated owner.
   * @param authorize - Independent whole-record disclosure lease.
   * @returns immutable original accepted/completed frames; no source parent directory is required.
   */
  exportOriginal(commandId: string, principalId: string, authorize: () => void): Promise<z.infer<typeof eventSchema>[]> {
    const result = this.tail.then(() => {
      if (this.closed) throw new SimulationProductError('Branch journal unavailable until recovery', 'SIMULATION_PRODUCT_UNAVAILABLE')
      authorize()
      const original = this.originals.get(commandId), frames = this.frames.get(commandId)
      if (!original || original.record.ownerPrincipalId !== principalId || !frames?.completed) throw new Error('Completed branch original unavailable')
      return structuredClone([frames.accepted, frames.completed])
    })
    this.tail = result.then(() => {}, () => {}); return result
  }
  /** Import one exact completed original into an isolated validated target; identity transfer is unsupported.
   * @param values - Exact accepted/completed source frames.
   * @param principalId - Same current authenticated owner.
   * @param authorize - Live target credential lease.
   * @returns detached original branch configuration after atomic durable append.
   */
  importOriginal(values: readonly unknown[], principalId: string, authorize: () => void): Promise<SimulationWorldBranchCreation> {
    const creation = parseBranchFrames(values), events = z.array(eventSchema).length(2).parse(values)
    const result = this.tail.then(async () => {
      if (this.closed) throw new SimulationProductError('Branch journal unavailable until recovery', 'SIMULATION_PRODUCT_UNAVAILABLE')
      authorize()
      if (creation.record.ownerPrincipalId !== principalId) throw new Error('Branch import principal differs from original owner')
      const prior = this.originals.get(creation.input.commandId)
      if (prior) {
        if (!isDeepStrictEqual(prior.creation, creation)) throw new Error('Branch import original already differs')
        return structuredClone(creation)
      }
      if (this.originals.size >= this.limits.maxCommands) throw new Error('Branch command capacity occupied')
      for (const event of events) this.bound(event)
      try { await this.stream.append(this.stream.tailSequence, events) }
      catch (cause) { this.closed = true; throw cause }
      for (const event of events) { this.fold(event); this.entries++ }
      authorize(); return structuredClone(creation)
    })
    this.tail = result.then(() => {}, () => {}); return result
  }
  /** Stop admission and drain accepted writes before closing the stream. */
  async close(): Promise<void> { this.closed = true; await this.tail; await this.stream.close() }
  private result(value: Original): SimulationProductWorldBranchResult {
    return simulationProductWorldBranchResultSchema.parse({ status: value.creation ? 'completed' : 'accepted',
      commandId: value.input.commandId, runId: value.record.id, source: value.input.source, sourceHash: value.sourceHash,
      memoryPolicy: value.input.memoryPolicy, phase: 'paused', realEffects: false })
  }
  private bound(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value)) > this.limits.maxBytes) throw new Error('Branch complete durable bytes exceeded')
  }
  private async append(event: z.infer<typeof eventSchema>) {
    if (this.closed) throw new Error('Branch journal unavailable')
    this.bound(event)
    try { await this.stream.append(this.stream.tailSequence, [event]) }
    catch (cause) { this.closed = true; throw cause }
    this.fold(event); this.entries++
  }
  private fold(event: z.infer<typeof eventSchema>) {
    if (event.kind === 'accepted') {
      if (this.originals.has(event.input.commandId) || [...this.originals.values()].some(value => value.record.id === event.record.id)
        || event.record.id !== `world-branch-${event.input.commandId}` || String(event.record.spec.runId) !== String(event.record.id)
        || event.record.name !== event.input.name || this.originals.size >= this.limits.maxCommands) throw new Error('Branch original identity invalid')
      this.frames.set(event.input.commandId, { accepted: structuredClone(event) })
      this.originals.set(event.input.commandId, event); return
    }
    const original = this.originals.get(event.commandId)
    if (!original || original.creation !== undefined || event.preparation.ownerName !== `simulation/experiment/${event.commandId}`
      || event.preparation.checkpoint.id !== `product-branch/${event.commandId}`) throw new Error('Branch completion identity invalid')
    const frames = this.frames.get(event.commandId)
    if (!frames) throw new Error('Branch original frames missing')
    parseBranchFrames([frames.accepted, event])
    frames.completed = structuredClone(event)
    original.creation = { kind: 'world-branch', record: original.record, input: original.input,
      sourceHash: original.sourceHash, preparation: event.preparation }
  }
}
