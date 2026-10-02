/** Serialized durable acceptance before native IO, with independently bounded complete replay. */
import type { LogStream } from '@clocky/clocky-storage'
import { foldCreationEntry, simulationCreationEntrySchema } from './creation-book.ts'
import type { SimulationCreationBook, SimulationCreationCommand } from './creation-types.ts'
import type { SimulationProductCommandId, SimulationProductRequestReceipt } from './administration-types.ts'

/** Explicit storage and retained request allowances resolved by the administration owner. */
export interface SimulationCreationStoreOptions {
  readonly recoveryPageSize: number
  readonly maxCommands: number
  readonly maxEntryBytes: number
}
/** One command journal writer; accepted requests and terminal results publish only after append. */
export class SimulationCreationStore {
  private state: SimulationCreationBook = { commands: new Map(), creations: new Map() }
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false

  /** @param stream - Caller-owned version 1 administration journal. @param options - Validated recovery/count/byte bounds. */
  constructor(private readonly stream: LogStream, private readonly options: SimulationCreationStoreOptions) {}

  /**
   * Replay the full retained command prefix before admitting writes.
   * @returns recovery completion; missing prefix/suffix, sequence gaps, corrupt entries and retained excess reject.
   */
  async load(): Promise<void> {
    if (this.stream.firstSequence !== 0) throw new Error('Simulation creation history has no complete prefix')
    let after = -1
    while (after < this.stream.tailSequence) {
      const rows = await this.stream.read(after, this.options.recoveryPageSize)
      if (rows.length === 0) throw new Error('Simulation creation history has an incomplete suffix')
      for (const row of rows) {
        if (row.sequence !== after + 1) throw new Error('Simulation creation history is not contiguous')
        this.checkBytes(row.value)
        this.state = foldCreationEntry(this.state, row.value)
        this.checkCount(this.state)
        after = row.sequence
      }
    }
  }
  /**
   * Read detached original intents and immutable attempt outcomes.
   * @returns one bounded private projection; this does not inspect or open a native run.
   */
  snapshot(): SimulationCreationBook { return structuredClone(this.state) }

  /**
   * Serialize authority/payload comparison and durable acceptance at the same owner queue position.
   * @param prepare - Synchronous current authorization and input resolution against the latest command projection.
   * @returns the retained command only after append; a returned existing command is an exact retry without another append.
   */
  accept(prepare: (state: SimulationCreationBook) => { readonly command: SimulationCreationCommand; readonly existing: boolean }):
  Promise<SimulationCreationCommand> {
    return this.enqueue(async () => {
      const chosen = prepare(this.snapshot())
      if (chosen.existing) return structuredClone(chosen.command)
      const entry = simulationCreationEntrySchema.parse({ kind: 'command/accepted', command: chosen.command })
      this.checkBytes(entry)
      const next = foldCreationEntry(this.state, entry)
      this.checkCount(next)
      await this.stream.append(this.stream.tailSequence, [entry])
      this.state = next
      return structuredClone(chosen.command)
    })
  }
  /**
   * Persist the original accepted attempt's terminal result without replacing another request.
   * @param id - Exact pending command identity.
   * @param failure - Explicit public failure category; absent means preparation completed.
   * @param diagnostic - Safe checkpoint/recovery stage and source; private error text is never retained here.
   * @returns immutable terminal receipt after its append; later duplicate settlement rejects.
   */
  finish(id: SimulationProductCommandId, failure?: SimulationProductRequestReceipt['failure'],
    diagnostic?: SimulationProductRequestReceipt['diagnostic']): Promise<SimulationProductRequestReceipt> {
    return this.enqueue(async () => {
      const entry = simulationCreationEntrySchema.parse({ ...failure === undefined ? { kind: 'command/completed', commandId: id }
        : { kind: 'command/failed', commandId: id, failure }, ...diagnostic === undefined ? {} : { diagnostic } })
      this.checkBytes(entry)
      const next = foldCreationEntry(this.state, entry)
      await this.stream.append(this.stream.tailSequence, [entry])
      this.state = next
      // The fold requires the retained original request and has just installed its terminal receipt.
      const command = next.commands.get(id)
      /* v8 ignore next -- foldCreationEntry requires the original pending command before terminal installation. */
      if (command === undefined) throw new Error('Simulation settled command has no original identity')
      return structuredClone(command.receipt)
    })
  }
  /** Close admission and drain accepted writes; the caller then closes its own stream. */
  async drain(): Promise<void> { this.closing = true; await this.tail }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Simulation creation journal is closed'))
    const work = this.tail.then(operation)
    this.tail = work.then(() => {}, () => {})
    return work
  }
  private checkBytes(value: unknown): void {
    if (Buffer.byteLength(JSON.stringify(value)) > this.options.maxEntryBytes) throw new Error('Simulation creation entry exceeds durable allowance')
  }
  private checkCount(state: SimulationCreationBook): void {
    if (state.commands.size > this.options.maxCommands) throw new Error('Simulation creation request capacity exceeded')
  }
}
