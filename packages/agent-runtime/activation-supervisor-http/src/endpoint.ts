/** Execution-host supervisor endpoint backed by durable ownership and exact SDK process-tree fencing. */

import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { SdkLocalProcessFencer } from '@clocky/clocky-agent-runtime-sdk'
import { ActivationSupervisorError } from '@clocky/clocky-activation-supervisor'
import type { ActivationSupervisorProvider, ActivationSupervisorObservation } from '@clocky/clocky-activation-supervisor'
import { createProcessInspector } from '@clocky/clocky-subprocess-local'
import type { ProcessInspector } from '@clocky/clocky-subprocess-local'
import { defineLogStream } from '@clocky/clocky-storage-log'
import type { StorageLogFacility } from '@clocky/clocky-storage-log'
import { activationBindingSnapshotSchema } from '@clocky/clocky-team'
import type { ActivationBindingSnapshot } from '@clocky/clocky-team'
import { readSupervisorJson, supervisorRequestSchema, validateSupervisorTarget } from './protocol.ts'

/** Cordis plugin name. */
export const name = 'activation-supervisor-http-endpoint'
/** Execution-host ownership is persisted before any remote health/fence operation. */
export const inject = ['activationSupervisors', 'storageLog']

/** Deployment-owned process profile, listener, authentication, and operation bounds. */
export interface Config {
  readonly name: string
  readonly version: number
  readonly hostId: string
  readonly endpointId: string
  readonly runtimeProvider: string
  readonly profile: string
  readonly bindHost: string
  readonly port: number
  readonly credentialEnv: string
  readonly fenceGraceMs: number
  readonly requestTimeoutMs: number
  readonly maxPayloadBytes: number
  readonly maxConcurrentOperations: number
}

/** Validate all listener and resource limits at load. */
export const Config: z<Config> = z.object({
  name: z.string().min(1).required(), version: z.number().step(1).min(1).required(),
  hostId: z.string().min(1).required(), endpointId: z.string().min(1).required(),
  runtimeProvider: z.string().min(1).required(), profile: z.string().min(1).required(),
  bindHost: z.string().min(1).required(), port: z.number().step(1).min(0).max(65535).required(),
  credentialEnv: z.string().min(1).required(), fenceGraceMs: z.number().step(1).min(1).max(2147483647).required(),
  requestTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
  maxPayloadBytes: z.number().step(1).min(1).required(), maxConcurrentOperations: z.number().step(1).min(1).required(),
})

/** Durable process owner; the HTTP caller cannot enroll or substitute a process identity. */
export class SdkProcessSupervisor implements ActivationSupervisorProvider {
  private readonly fencer: SdkLocalProcessFencer
  private readonly queues = new Map<string, Promise<unknown>>()
  private closing = false
  /** @param config - exact execution host and allowed SDK runtime profile.
   * @param logs - durable ownership stream provider on this host.
   * @param inspector - exact process-identity implementation; defaults to the real host inspector.
   */
  constructor(
    private readonly config: Config,
    private readonly logs: StorageLogFacility,
    inspector: ProcessInspector = createProcessInspector(),
  ) {
    if (!inspector.hasExactIdentity) throw new TypeError('Supervisor requires exact process creation identities on this host')
    this.fencer = new SdkLocalProcessFencer({
      provider: config.runtimeProvider, profile: config.profile, hostId: config.hostId, fenceGraceMs: config.fenceGraceMs,
    }, inspector)
  }
  get name(): string { return this.config.name }
  get version(): number { return this.config.version }

  validate(binding: ActivationBindingSnapshot): void {
    validateSupervisorTarget(binding, this.config)
    if (binding.recovery?.supervisor?.terminationMode !== 'owned-process') {
      throw new ActivationSupervisorError('Process supervisor requires owned-process termination', 'SUPERVISOR_INVALID')
    }
    this.fencer.validate(binding)
  }

  async admitOwned(binding: ActivationBindingSnapshot): Promise<void> {
    this.validate(binding)
    if (this.fencer.health(binding) !== 'reachable') throw new ActivationSupervisorError('Runtime must enroll its exact live process before publication', 'SUPERVISOR_INVALID')
    await this.withOwnership(binding, true, async () => {})
  }

  async health(binding: ActivationBindingSnapshot, signal: AbortSignal): Promise<ActivationSupervisorObservation> {
    const descriptor = validateSupervisorTarget(binding, this.config)
    return await this.withOwnership(binding, false, (terminated) => {
      signal.throwIfAborted()
      return Promise.resolve({ descriptor, status: terminated ? 'terminated' : this.fencer.health(binding) })
    })
  }

  async fence(binding: ActivationBindingSnapshot, signal: AbortSignal): Promise<ActivationSupervisorObservation> {
    const descriptor = validateSupervisorTarget(binding, this.config)
    return await this.withOwnership(binding, false, async (terminated) => {
      signal.throwIfAborted()
      if (!terminated) await this.fencer.fence(binding)
      return { descriptor, status: 'terminated' }
    })
  }

  /** Retire local enrollment and wait for every accepted ownership or fence operation.
   * @returns completion after each durable append and process operation settles.
   */
  async close(): Promise<void> {
    this.closing = true
    const settled = await Promise.allSettled(this.queues.values())
    const failures: unknown[] = settled.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'Supervisor accepted operations failed during retirement')
  }

  private async withOwnership<T>(
    binding: ActivationBindingSnapshot,
    admit: boolean,
    operation: (terminated: boolean) => Promise<T>,
  ): Promise<T> {
    if (this.closing) throw new ActivationSupervisorError('Supervisor owner is retired', 'SUPERVISOR_UNAVAILABLE')
    this.validate(binding)
    const identity = ownedIdentity(binding)
    const key = createHash('sha256').update(JSON.stringify([this.name, this.version, this.config.endpointId, binding.activation.id])).digest('hex')
    const previous = this.queues.get(key) ?? Promise.resolve()
    const proceed = async () => {
      const stream = await this.logs.open(defineLogStream({ name: `activation-supervisor/${key}`, version: 1 }))
      try {
        const records = await stream.read(-1, 3)
        let terminated = false
        if (records.length === 0 && admit) {
          if (Buffer.byteLength(JSON.stringify(identity)) > this.config.maxPayloadBytes) throw new ActivationSupervisorError('Supervisor ownership record exceeds its byte limit', 'SUPERVISOR_INVALID')
          await stream.append(-1, [{ version: 1, binding: identity }])
        } else {
          const record = records[0]
          if (records.length < 1 || records.length > 2 || record?.sequence !== 0 || typeof record.value !== 'object' || record.value === null) {
            throw new ActivationSupervisorError('Supervisor has no complete owned epoch record', 'SUPERVISOR_UNAVAILABLE')
          }
          const value = record.value as { version?: unknown; binding?: unknown }
          const owned = activationBindingSnapshotSchema.parse(value.binding)
          if (value.version !== 1 || !isDeepStrictEqual(ownedIdentity(owned), identity)) {
            throw new ActivationSupervisorError('Supervisor request differs from its owned process generation', 'SUPERVISOR_GENERATION_MISMATCH')
          }
          if (records.length === 2) {
            if (records[1]?.sequence !== 1 || !isDeepStrictEqual(records[1].value, { version: 1, terminated: true })) {
              throw new ActivationSupervisorError('Supervisor termination record is malformed', 'SUPERVISOR_INVALID')
            }
            terminated = true
          }
        }
        const result = await operation(terminated)
        if (!terminated && typeof result === 'object' && result !== null && 'status' in result && result.status === 'terminated') {
          await stream.append(0, [{ version: 1, terminated: true }])
        }
        return result
      } finally {
        await stream.close()
      }
    }
    const result = previous.then(proceed, proceed)
    this.queues.set(key, result)
    try { return await result } finally { if (this.queues.get(key) === result) this.queues.delete(key) }
  }
}

/** Normalize live observations out of the immutable execution identity. */
function ownedIdentity(binding: ActivationBindingSnapshot): ActivationBindingSnapshot {
  return {
    activation: { ...binding.activation, status: 'starting' }, sessionId: binding.sessionId,
    provider: binding.provider, recovery: structuredClone(binding.recovery),
  }
}

/** Bound listener retained until every accepted operation and response settles. */
export interface SupervisorHttpEndpoint {
  /** Actual listener port, including an ephemeral port selected from zero. */
  readonly port: number
  /** Close admission and wait for accepted fencing to finish. @returns quiescent listener completion. */
  close(this: void): Promise<void>
}

/** Start one authenticated listener; only health/fence are wire operations.
 * @param provider - execution owner with durable enrollment and real process fencing.
 * @param config - listener identity, credential environment, and complete request limits.
 * @returns listener whose close awaits all admitted process operations.
 */
export async function listenSupervisorEndpoint(provider: ActivationSupervisorProvider, config: Config): Promise<SupervisorHttpEndpoint> {
  if (!process.env[config.credentialEnv]) throw new TypeError(`Supervisor credential environment '${config.credentialEnv}' is empty`)
  const pending = new Set<Promise<void>>()
  let closing = false
  let closed: Promise<void> | undefined
  const server = createServer({ requestTimeout: config.requestTimeoutMs, headersTimeout: config.requestTimeoutMs }, (request, response) => {
    if (closing || pending.size >= config.maxConcurrentOperations) { response.writeHead(503).end(); return }
    const credential = process.env[config.credentialEnv]
    if (!credential) { response.writeHead(503).end(); return }
    const credentialDigest = createHash('sha256').update(`Bearer ${credential}`).digest()
    const received = createHash('sha256').update(request.headers.authorization ?? '').digest()
    if (!timingSafeEqual(received, credentialDigest)) { response.writeHead(401).end(); return }
    if (request.method !== 'POST' || request.url !== '/') { response.writeHead(404).end(); return }
    const run = (async () => {
      try {
        const input = supervisorRequestSchema.parse(await readSupervisorJson(request, config.maxPayloadBytes))
        provider.validate(input.binding)
        const observation = await provider[input.operation](input.binding, new AbortController().signal)
        const body = JSON.stringify(observation)
        if (Buffer.byteLength(body) > config.maxPayloadBytes) throw new Error('Supervisor response exceeds its byte limit')
        if (!response.destroyed) response.writeHead(200, { 'content-type': 'application/json' }).end(body)
      } catch (error: unknown) {
        // Input, ownership, storage, and process failures refuse the request without exposing credentials or execution paths.
        if (!response.destroyed && !response.headersSent) {
          response.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({
            code: error instanceof ActivationSupervisorError ? error.code : 'SUPERVISOR_INVALID',
          }))
        }
      }
    })()
    pending.add(run)
    void run.then(() => { pending.delete(run) }, () => { pending.delete(run) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.bindHost, () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Supervisor listener has no TCP address')
  return {
    port: address.port,
    close: () => {
      closing = true
      closed ??= new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
        .then(async () => { await Promise.all(pending) })
      return closed
    },
  }
}

/** Mount the real execution owner and its remote listener.
 * @param ctx - supervisor and durable log registries on the execution host.
 * @param config - exact SDK process profile and endpoint bounds.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const provider = new SdkProcessSupervisor(config, ctx.storageLog)
  const endpoint = await listenSupervisorEndpoint(provider, config)
  let unregister: () => void
  try { unregister = ctx.activationSupervisors.registerProvider(provider) } catch (error: unknown) {
    await endpoint.close()
    throw error
  }
  ctx.effect(() => async () => {
    unregister()
    const outcomes = await Promise.allSettled([endpoint.close(), provider.close()])
    const failures: unknown[] = outcomes.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'Supervisor endpoint retirement failed')
  }, 'activationSupervisorHttp.endpoint()')
}
