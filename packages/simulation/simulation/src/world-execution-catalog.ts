/** Execution-provider admission shared by restore and run-bound dispatch. */
import { SimulationWorldDomainError } from './world-domain-registry.ts'
import type { SimulationWorldDomainRegistry } from './world-domain-registry.ts'
import type { SimulationWorldDomainLease, SimulationWorldDomainPin } from './world-domain-types.ts'
import type { SimulationSnapshot } from './types.ts'

/**
 * Hold every original execution generation before writable restoration or dispatch construction.
 * @param snapshot - Original read-only or exclusively opened Native projection, including retained history.
 * @param executions - Explicit installed execution capabilities; absence rejects a World run.
 * @param native - Optional Native catalog for exact shared parser-contract comparison during restoration.
 * @returns idempotent release after admitted restoration IO or validation finishes; no callbacks are invoked.
 */
export function retainWorldExecutionCatalog(snapshot: Pick<SimulationSnapshot, 'world'>,
  executions: SimulationWorldDomainRegistry | undefined, native?: SimulationWorldDomainRegistry): () => void {
  const world = snapshot.world
  if (world === undefined) return () => {}
  if (executions === undefined) throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_UNAVAILABLE',
    'World restoration requires an installed execution provider catalog')
  const leases: SimulationWorldDomainLease[] = []
  const definitions = new Map<string, ReturnType<SimulationWorldDomainRegistry['definition']>>()
  const release = (): void => { for (const lease of leases.splice(0)) lease.release() }
  const requirePin = (pin: SimulationWorldDomainPin): ReturnType<SimulationWorldDomainRegistry['definition']> => {
    const key = JSON.stringify(pin), retained = definitions.get(key)
    if (retained !== undefined) return retained
    leases.push(executions.acquire(pin))
    const selector = { domain: pin.domain, operation: pin.operation, version: pin.version }
    const definition = executions.definition(selector)
    if (native !== undefined) {
      const original = native.definition(selector)
      if (original.schemaRef !== definition.schemaRef || (['request', 'plan', 'result', 'mutation'] as const)
        .some(kind => original.schemas[kind] !== definition.schemas[kind])) {
        throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_MISMATCH',
          'Execution payload parsers differ from the original Native schema contract')
      }
    }
    definitions.set(key, definition)
    return definition
  }
  try {
    for (const pin of world.definition.operations) requirePin(pin)
    for (const intent of Object.values(world.intents)) requirePin(intent.pin).schemas.request.parse(intent.payload)
    for (const request of Object.values(world.requests)) requirePin(request.pin).schemas.request.parse(request.proposal.payload)
    for (const plan of Object.values(world.plans)) {
      const definition = requirePin(plan.pin)
      if (plan.proposal.resolution.kind === 'apply') definition.schemas.plan.parse(plan.proposal.resolution.payload)
    }
    for (const result of Object.values(world.results)) {
      const request = world.requests[result.requestId]
      if (request === undefined) throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_MISMATCH',
        'A retained result has no original request provider')
      const definition = requirePin(request.pin)
      if (result.outcome.kind === 'committed') definition.schemas.result.parse(result.payload)
    }
    for (const mutation of Object.values(world.mutations)) { requirePin(mutation.pin); executions.parseMutation(mutation) }
  } catch (error: unknown) {
    release()
    if (error instanceof SimulationWorldDomainError) throw error
    throw new SimulationWorldDomainError('SIM_WORLD_SCHEMA', 'Retained execution payload violates its original schema', { cause: error })
  }
  return release
}
