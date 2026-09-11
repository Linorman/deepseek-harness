/** Bounded supervisor request/response parsing shared by both authenticated HTTP peers. */

import { z } from 'zod'
import { ActivationSupervisorError } from '@clocky/clocky-activation-supervisor'
import { activationBindingSnapshotSchema, activationSupervisorDescriptorSchema } from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, ActivationSupervisorDescriptor } from '@clocky/clocky-team'
import type { ActivationSupervisorObservation } from '@clocky/clocky-activation-supervisor'

/** Wire version; unsupported revisions reject rather than silently change fencing semantics. */
export const SUPERVISOR_HTTP_VERSION = 1

/** Runtime parser for complete exact-epoch operations. */
export const supervisorRequestSchema = z.object({
  version: z.literal(SUPERVISOR_HTTP_VERSION),
  operation: z.enum(['health', 'fence']),
  binding: activationBindingSnapshotSchema,
}).strict()

/** Runtime parser for generation-bearing endpoint results. */
export const supervisorObservationSchema = z.object({
  descriptor: activationSupervisorDescriptorSchema,
  status: z.enum(['reachable', 'unreachable', 'terminated', 'unknown']),
}).strict() satisfies z.ZodType<ActivationSupervisorObservation>

/** Public error codes contain no process paths, credentials, or provider diagnostics. */
export const supervisorErrorSchema = z.object({
  code: z.enum(['SUPERVISOR_UNAVAILABLE', 'SUPERVISOR_INVALID', 'SUPERVISOR_GENERATION_MISMATCH', 'SUPERVISOR_TERMINATION_UNCONFIRMED']),
}).strict()

/** Read one bounded HTTP body; a large advertised or streamed body rejects before parsing.
 * @param chunks - readable request or response bytes.
 * @param maxBytes - complete encoded payload ceiling.
 * @returns the parsed JSON value; callers apply the operation-specific schema.
 */
export async function readSupervisorJson(chunks: AsyncIterable<Uint8Array | string>, maxBytes: number): Promise<unknown> {
  const buffers: Buffer[] = []
  let total = 0
  for await (const chunk of chunks) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new Error('Supervisor payload exceeds its configured byte limit')
    buffers.push(buffer)
  }
  return JSON.parse(Buffer.concat(buffers).toString('utf8')) as unknown
}

/** Require a descriptor matching the configured endpoint and exact durable epoch.
 * @param binding - wire-validated activation facts.
 * @param expected - deployment-owned endpoint selection.
 * @returns the exact validated supervisor descriptor.
 */
export function validateSupervisorTarget(binding: ActivationBindingSnapshot, expected: {
  readonly name: string
  readonly version: number
  readonly hostId: string
  readonly endpointId: string
}): ActivationSupervisorDescriptor {
  const descriptor = binding.recovery?.supervisor
  if (descriptor === undefined) throw new ActivationSupervisorError(
    'Activation has no supervisor descriptor', 'SUPERVISOR_UNAVAILABLE',
  )
  if (descriptor.generation !== binding.activation.id || descriptor.hostId !== binding.recovery?.process.hostId) {
    throw new ActivationSupervisorError(
      'Supervisor descriptor differs from the activation generation or execution host', 'SUPERVISOR_GENERATION_MISMATCH',
    )
  }
  if (descriptor.name !== expected.name || descriptor.version !== expected.version
    || descriptor.hostId !== expected.hostId || descriptor.endpointId !== expected.endpointId) {
    throw new ActivationSupervisorError(
      'Supervisor descriptor does not match the configured endpoint', 'SUPERVISOR_INVALID',
    )
  }
  return descriptor
}
