/** Opt-in local test adapter. Its durable sink is a test environment, never an email/payment provider. */
import { Context, Service } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type { LogStream } from '@clocky/clocky-storage'
import type {} from '@clocky/clocky-storage-log'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { ExternalEffectOwner } from './external-effect-owner.ts'
import type { ExternalEffectAdapter } from './external-effect-owner.ts'
import { externalEffectReceiptSchema } from './external-effect-schema.ts'
import type { ExternalEffectIntent, ExternalEffectGrant, ExternalEffectReceipt, ExternalEffectRecord } from './external-effect-schema.ts'

/** Deployment-only finite sandbox policy. No provider credential or real environment is accepted. */
export interface Config {
  readonly stream: string
  readonly authorizedPrincipals: string[]
  readonly mode: 'live' | 'replay' | 'branch' | 'import' | 'inspect'
  readonly maxOccupiedUnits: number
  readonly maxEntries: number
  readonly maxEntryBytes: number
  readonly pageSize: number
}
export const Config: z<Config> = z.object({ stream: z.string().required(), authorizedPrincipals: z.array(z.string()).default([]),
  mode: z.union(['live', 'replay', 'branch', 'import', 'inspect']).default('inspect'),
  maxOccupiedUnits: z.number().min(0).step(1).required(), maxEntries: z.number().min(1).step(1).default(10000),
  maxEntryBytes: z.number().min(1).step(1).default(65536), pageSize: z.number().min(1).step(1).default(64) })

declare module '@clocky/cordis' { interface Context { externalEffectSandbox: ExternalEffectSandbox } }
/** Host service for explicit, authenticated sandbox operations; disposal drains before closing both journals. */
export default class ExternalEffectSandbox extends Service<Config> {
  static inject = ['storageLog']
  static Config = Config
  private initializedOwner: ExternalEffectOwner | undefined
  private get owner(): ExternalEffectOwner {
    if (!this.initializedOwner) throw new Error('External effect sandbox is not initialized')
    return this.initializedOwner
  }
  private readonly ready: Promise<void>
  private readonly streams: LogStream[] = []
  constructor(ctx: Context, config: Config) {
    super(ctx, 'externalEffectSandbox')
    this.ready = this.initialize(config)
    void this.ready.catch((_cause: unknown) => { /* Initialization is observed by Service.init and teardown. */ })
    ctx.effect(() => async () => {
      await this.ready.catch(() => {})
      await this.initializedOwner?.drain()
      for (const stream of this.streams.reverse()) await stream.close()
    })
  }
  protected async [Service.init](): Promise<void> { await this.ready }
  /** Save an original sandbox request.
   * @param input - Exact finite test intent.
   * @param call - Real user lease.
   * @returns Durable original.
   */
  async propose(input: ExternalEffectIntent, call: AuthenticatedProductCall): Promise<ExternalEffectRecord> {
    await this.ready; return this.owner.propose(input, call)
  }
  /** Record finite explicit user consent.
   * @param input - Grant for the original action.
   * @param call - Real user lease.
   * @returns Durable consent. */
  async grant(input: ExternalEffectGrant, call: AuthenticatedProductCall): Promise<ExternalEffectRecord> {
    await this.ready; return this.owner.grant(input, call)
  }
  /** Send once, or reconcile a prior unknown result.
   * @param effectId - Original request identity.
   * @param call - Real user lease.
   * @returns Current durable state. */
  async execute(effectId: string, call: AuthenticatedProductCall): Promise<ExternalEffectRecord> {
    await this.ready; return this.owner.execute(effectId, call)
  }
  /** Inspect without provider IO.
   * @param effectId - Original request identity.
   * @param call - Real user lease.
   * @returns Current durable state. */
  async inspect(effectId: string, call: AuthenticatedProductCall): Promise<ExternalEffectRecord> {
    await this.ready; return this.owner.inspect(effectId, call)
  }
  /** Cancel only unstarted effects, retaining uncertain occupancy.
   * @param effectId - Original request identity.
   * @param call - Real user lease.
   * @returns Durable revoked state. */
  async revoke(effectId: string, call: AuthenticatedProductCall): Promise<ExternalEffectRecord> {
    await this.ready; return this.owner.revoke(effectId, call)
  }
  private async initialize(config: Config) {
    const provider = await this.ctx.storageLog.open({ name: `${config.stream}:sink`, version: 1 }); this.streams.push(provider)
    const receipts = new Map<string, ExternalEffectReceipt>()
    if (provider.firstSequence !== 0) throw new Error('Sandbox sink prefix is missing')
    let after = -1
    while (after < provider.tailSequence) {
      const rows = await provider.read(after, config.pageSize)
      if (!rows.length) throw new Error('Sandbox sink suffix is missing')
      for (const row of rows) {
        if (row.sequence !== after + 1 || Buffer.byteLength(JSON.stringify(row.value)) > config.maxEntryBytes
          || receipts.size >= config.maxEntries) throw new Error('Sandbox sink history invalid')
        const receipt = externalEffectReceiptSchema.parse(row.value)
        if (receipts.has(receipt.idempotencyKey)) throw new Error('Sandbox sink duplicate key')
        receipts.set(receipt.idempotencyKey, receipt); after = row.sequence
      }
    }
    const adapter: ExternalEffectAdapter = { id: 'local-sandbox', environment: 'test', action: 'record-test-action',
      targets: ['local-test-ledger'], maxOccupiedUnits: config.maxOccupiedUnits,
      dispatch: async (intent, idempotencyKey) => {
        const prior = receipts.get(idempotencyKey)
        if (prior) return structuredClone(prior)
        const receipt = externalEffectReceiptSchema.parse({ effectId: intent.effectId, idempotencyKey, action: intent.action,
          target: intent.target, units: intent.units, outcome: 'confirmed', receiptId: idempotencyKey })
        if (receipts.size >= config.maxEntries || Buffer.byteLength(JSON.stringify(receipt)) > config.maxEntryBytes) throw new Error('Sandbox sink capacity occupied')
        await provider.append(provider.tailSequence, [receipt]); receipts.set(idempotencyKey, receipt)
        return receipt
      },
      query: async (_intent, key) => {
        // Reread the actual sink after a lost append reply; the in-memory map can lag durable acceptance.
        let sequence = -1
        while (sequence < provider.tailSequence) {
          const rows = await provider.read(sequence, config.pageSize)
          if (!rows.length) throw new Error('Sandbox sink suffix is missing')
          for (const row of rows) {
            const receipt = externalEffectReceiptSchema.parse(row.value)
            if (receipt.idempotencyKey === key) return receipt
            sequence = row.sequence
          }
        }
        return null
      } }
    const stream = await this.ctx.storageLog.open({ name: config.stream, version: 1 }); this.streams.push(stream)
    this.initializedOwner = new ExternalEffectOwner(stream, [adapter], { authorizedPrincipals: config.authorizedPrincipals,
      mode: config.mode, maxEntries: config.maxEntries, maxEntryBytes: config.maxEntryBytes, pageSize: config.pageSize })
    await this.owner.load()
  }
}
