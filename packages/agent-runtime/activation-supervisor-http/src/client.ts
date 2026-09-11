/** Authenticated remote supervisor provider; transport loss remains unreachable, never terminated. */

import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { ActivationSupervisorError } from '@clocky/clocky-activation-supervisor'
import type { ActivationSupervisorObservation, ActivationSupervisorProvider } from '@clocky/clocky-activation-supervisor'
import type { ActivationBindingSnapshot } from '@clocky/clocky-team'
import { readSupervisorJson, supervisorErrorSchema, supervisorObservationSchema, SUPERVISOR_HTTP_VERSION, validateSupervisorTarget } from './protocol.ts'

/** Cordis plugin name. */
export const name = 'activation-supervisor-http'
/** Registry that owns admitted recovery operations. */
export const inject = ['activationSupervisors']

/** Explicit endpoint identity, authentication source, and request bounds. */
export interface Config {
  readonly name: string
  readonly version: number
  readonly hostId: string
  readonly endpointId: string
  readonly url: string
  readonly credentialEnv: string
  readonly timeoutMs: number
  readonly maxPayloadBytes: number
  readonly allowInsecureHttp?: boolean
}

/** Validate deployment settings before any remote request. */
export const Config: z<Config> = z.object({
  name: z.string().min(1).required(), version: z.number().step(1).min(1).required(),
  hostId: z.string().min(1).required(), endpointId: z.string().min(1).required(),
  url: z.string().min(1).required(), credentialEnv: z.string().min(1).required(),
  timeoutMs: z.number().step(1).min(1).max(2147483647).required(),
  maxPayloadBytes: z.number().step(1).min(1).required(), allowInsecureHttp: z.boolean().default(false),
})

/** Create a provider whose credentials never enter a durable descriptor.
 * @param config - exact endpoint and deployment bounds.
 * @returns provider to register on the Hub's supervisor registry.
 */
export function createHttpActivationSupervisor(config: Config): ActivationSupervisorProvider {
  const url = new URL(config.url)
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && config.allowInsecureHttp === true))) {
    throw new TypeError('Supervisor requires HTTPS without URL credentials, or explicitly enabled HTTP')
  }
  if (!process.env[config.credentialEnv]) throw new TypeError(`Supervisor credential environment '${config.credentialEnv}' is empty`)
  const invoke = async (operation: 'health' | 'fence', binding: ActivationBindingSnapshot, signal: AbortSignal): Promise<ActivationSupervisorObservation> => {
    const descriptor = validateSupervisorTarget(binding, config)
    const credential = process.env[config.credentialEnv]
    if (!credential) throw new ActivationSupervisorError('Supervisor credential is unavailable', 'SUPERVISOR_UNAVAILABLE')
    const body = JSON.stringify({ version: SUPERVISOR_HTTP_VERSION, operation, binding })
    if (Buffer.byteLength(body) > config.maxPayloadBytes) throw new ActivationSupervisorError('Supervisor request exceeds its byte limit', 'SUPERVISOR_INVALID')
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        body, signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
      })
    } catch (error: unknown) {
      if (signal.aborted) throw error
      if (operation === 'health') return { descriptor, status: 'unreachable' }
      throw new ActivationSupervisorError('Supervisor transport cannot prove termination', 'SUPERVISOR_TERMINATION_UNCONFIRMED')
    }
    if ((!response.ok && response.status !== 409) || response.body === null) {
      await response.body?.cancel()
      throw new ActivationSupervisorError(`Supervisor rejected ${operation} with HTTP ${response.status}`, 'SUPERVISOR_UNAVAILABLE')
    }
    let payload: unknown
    try { payload = await readSupervisorJson(response.body, config.maxPayloadBytes) } catch (error: unknown) {
      if (signal.aborted) throw error
      throw new ActivationSupervisorError('Supervisor response could not be read within its bounds', 'SUPERVISOR_TERMINATION_UNCONFIRMED')
    }
    if (!response.ok) {
      const failure = supervisorErrorSchema.safeParse(payload)
      throw new ActivationSupervisorError('Supervisor rejected the exact execution operation', failure.success ? failure.data.code : 'SUPERVISOR_INVALID')
    }
    const parsed = supervisorObservationSchema.safeParse(payload)
    if (!parsed.success) throw new ActivationSupervisorError('Supervisor returned an invalid execution observation', 'SUPERVISOR_INVALID')
    return parsed.data
  }
  return {
    name: config.name, version: config.version,
    validate: (binding) => { validateSupervisorTarget(binding, config) },
    health: async (binding, signal) => await invoke('health', binding, signal),
    fence: async (binding, signal) => await invoke('fence', binding, signal),
  }
}

/** Register one authenticated remote endpoint.
 * @param ctx - supervisor registry owner.
 * @param config - endpoint identity and bounded transport configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.activationSupervisors.registerProvider(createHttpActivationSupervisor(config))
}
