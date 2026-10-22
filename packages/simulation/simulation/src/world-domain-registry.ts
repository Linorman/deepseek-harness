/** Pure domain parser and execution registry; Cordis providers own its registration disposer. */
import { z } from 'zod'
import { simulationWorldBusinessSummarySchema } from './world-summary.ts'
import type { SimulationWorldBusinessSummary, SimulationWorldBusinessSummaryEvidence } from './world-summary.ts'
import { simulationWorldEvidenceFieldSchema } from './world-evidence.ts'
import {
  simulationWorldDomainSelectorSchema, simulationWorldDomainPinSchema, simulationWorldDomainRequestSchema,
  simulationWorldDomainPlanSchema, simulationWorldDomainResultSchema, simulationWorldDomainMutationSchema,
} from './world-domain.ts'
import type {
  SimulationWorldDomainDefinition, SimulationWorldDomainImplementation, SimulationWorldDomainLease,
  SimulationWorldDomainSelector, SimulationWorldDomainPin, SimulationWorldDomainFailureCode,
  SimulationWorldDomainRequest, SimulationWorldDomainPlan, SimulationWorldDomainResult, SimulationWorldDomainMutation,
} from './world-domain-types.ts'

/** Stable failure with trusted diagnostics; messages are never a public domain result. */
export class SimulationWorldDomainError extends Error {
  /**
   * Construct a categorized failure without assigning any world authority.
   * @param code - Stable category used by consumers and persisted responsibility handling.
   * @param message - Trusted diagnostic, unsuitable for automatic public disclosure.
   * @param options - Optional parser failure cause.
   */
  constructor(readonly code: SimulationWorldDomainFailureCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SimulationWorldDomainError'
  }
}

interface Registration<I extends SimulationWorldDomainImplementation> {
  readonly definition: SimulationWorldDomainDefinition
  readonly pin: SimulationWorldDomainPin
  implementation: I | undefined
  accepting: boolean
  leases: number
  readonly drained: Promise<void>
  readonly complete: () => void
}

/**
 * Versioned operation admission with exact generation leases and retained schema tombstones.
 * Registration removal closes new admission synchronously. Existing leases keep their original
 * implementation until released; retained plans remain parseable but cannot silently execute on a
 * replacement. Native remains responsible for durable pin manifests, read comparison and effects.
 */
export class SimulationWorldDomainRegistry<I extends SimulationWorldDomainImplementation = SimulationWorldDomainImplementation> {
  private readonly current = new Map<string, Registration<I>>()
  private readonly retained = new Map<string, Registration<I>>()
  private readonly schemas = new Map<string, Pick<SimulationWorldDomainDefinition, 'schemas' | 'evidenceFields'>>()

  /**
   * Install one exact operation version and return its lifecycle disposer.
   * @param definition - Complete strict payload parser definition.
   * @param implementation - Provider-owned capabilities and immutable artifact/generation identity.
   * @returns a disposer which closes new admission immediately and resolves after existing leases drain.
   */
  register(definition: SimulationWorldDomainDefinition, implementation: I): () => Promise<void> {
    const selector = parseSimulationWorldSchema(simulationWorldDomainSelectorSchema, {
      domain: definition.domain, operation: definition.operation, version: definition.version,
    })
    const pin = Object.freeze(parseSimulationWorldSchema(simulationWorldDomainPinSchema, {
      ...selector, schemaRef: definition.schemaRef,
      implementationRef: implementation.ref, generation: implementation.generation,
    }))
    const selectorIdentity = selectorKey(selector)
    const pinIdentity = pinKey(pin)
    if (this.current.has(selectorIdentity) || this.retained.has(pinIdentity)) {
      throw new SimulationWorldDomainError('SIM_WORLD_REGISTRATION_CONFLICT', 'An operation or its exact implementation pin was already registered')
    }
    const evidenceFields = definition.evidenceFields === undefined ? undefined : parseSimulationWorldSchema(
      z.array(simulationWorldEvidenceFieldSchema).min(1).refine(fields => new Set(fields.map(field => field.code)).size === fields.length,
        'Evidence field codes must be distinct'), definition.evidenceFields)
    const schemaKinds = ['request', 'plan', 'result', 'mutation'] as const
    for (const kind of schemaKinds) strictSchema(definition.schemas[kind])
    const schemaIdentity = JSON.stringify([selectorIdentity, pin.schemaRef])
    const previousSchema = this.schemas.get(schemaIdentity)
    if (previousSchema !== undefined && (schemaKinds.some(kind => previousSchema.schemas[kind] !== definition.schemas[kind])
      || JSON.stringify(previousSchema.evidenceFields ?? []) !== JSON.stringify(evidenceFields ?? []))) {
      throw new SimulationWorldDomainError('SIM_WORLD_REGISTRATION_CONFLICT', 'A retained schema reference cannot name different payload parsers or evidence fields')
    }
    const copied = Object.freeze({ ...selector, schemaRef: pin.schemaRef,
      ...evidenceFields === undefined ? {} : { evidenceFields: Object.freeze(evidenceFields.map(field => Object.freeze(field))) },
      ...definition.directorEvents === true ? { directorEvents: true as const } : {}, schemas: Object.freeze({
        request: definition.schemas.request, plan: definition.schemas.plan,
        result: definition.schemas.result, mutation: definition.schemas.mutation,
      }) })
    let complete!: () => void
    const drained = new Promise<void>((resolve) => { complete = resolve })
    const registration: Registration<I> = { definition: copied, pin, implementation,
      accepting: true, leases: 0, drained, complete }
    this.schemas.set(schemaIdentity, copied)
    this.retained.set(pinIdentity, registration)
    this.current.set(selectorIdentity, registration)
    return () => {
      if (registration.accepting) {
        registration.accepting = false
        this.current.delete(selectorIdentity)
        this.finish(registration)
      }
      return registration.drained
    }
  }

  /**
   * Resolve an installed exact operation version before admitting a new request.
   * @param selector - Explicit domain, operation and version.
   * @returns the immutable installed definition; unknown or disposed versions throw a stable failure.
   */
  resolve(selector: SimulationWorldDomainSelector): SimulationWorldDomainDefinition {
    return this.admission(parseSimulationWorldSchema(simulationWorldDomainSelectorSchema, selector)).definition
  }

  /**
   * Capture the exact installed implementation for a newly accepted plan.
   * @param selector - Explicit operation version.
   * @returns the immutable pin which must be persisted together with the accepted plan.
   */
  pin(selector: SimulationWorldDomainSelector): SimulationWorldDomainPin {
    return this.admission(parseSimulationWorldSchema(simulationWorldDomainSelectorSchema, selector)).pin
  }

  /**
   * Read immutable installed capability metadata without taking an execution lease.
   * @param selector - Exact installed operation version.
   * @returns the original frozen definition; missing or retired registrations reject.
   */
  definition(selector: SimulationWorldDomainSelector): SimulationWorldDomainDefinition {
    return this.admission(parseSimulationWorldSchema(simulationWorldDomainSelectorSchema, selector)).definition
  }

  /**
   * Project business facts with the original installed generation without admitting execution.
   * @param value - Complete retained parser and implementation pin; newer versions never substitute.
   * @param evidence - Public original acceptance/result and separately disclosed proposed body and target context.
   * @returns validated bounded summary, or undefined when that exact projector is absent or retired.
   * @throws when original evidence, a disclosed body, output or source references fail validation.
   */
  summarize(value: SimulationWorldDomainPin, evidence: SimulationWorldBusinessSummaryEvidence): SimulationWorldBusinessSummary | undefined {
    const pin = parseSimulationWorldSchema(simulationWorldDomainPinSchema, value)
    const registration = this.retained.get(pinKey(pin))
    if (registration?.accepting !== true || registration.implementation?.summary === undefined) return undefined
    if (pinKey(evidence.request.pin) !== pinKey(pin)) {
      throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_MISMATCH', 'Summary request differs from original domain pin')
    }
    if (evidence.requestBody.status === 'allowed') {
      this.payload(registration, 'request', evidence.requestBody.proposal.payload)
    }
    if (evidence.result !== undefined) {
      if (evidence.result.requestId !== evidence.request.id) {
        throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_MISMATCH', 'Summary result belongs to another request')
      }
      this.payload(registration, 'result', evidence.result.payload)
    }
    const summary = simulationWorldBusinessSummarySchema.parse(registration.implementation.summary(evidence))
    const sources = { request: evidence.request.sequence, result: evidence.result?.sequence, bindings: evidence.nativeRevision }
    if (summary.nativeRevision !== evidence.nativeRevision || summary.sources.some(source => source.kind === 'environment'
      ? evidence.environment.status !== 'allowed' || source.sequence > evidence.nativeRevision
        || source.profileRevision !== undefined && source.profileRevision !== evidence.environment.profileRevision
      : sources[source.kind] !== source.sequence)) {
      throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_MISMATCH', 'Summary source differs from authorized original evidence')
    }
    return summary
  }

  /**
   * Admit one execution against the original generation, without invoking provider code.
   * @param value - Exact pin retained by the accepted plan.
   * @returns a lease retaining its original implementation until release.
   */
  acquire(value: SimulationWorldDomainPin): SimulationWorldDomainLease<I> {
    const pin = parseSimulationWorldSchema(simulationWorldDomainPinSchema, value)
    const registration = this.original(pin)
    if (!registration.accepting || registration.implementation === undefined) {
      throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_UNAVAILABLE', 'The original implementation generation no longer admits execution')
    }
    registration.leases++
    let released = false
    return Object.freeze({ pin: registration.pin, implementation: registration.implementation,
      release: () => {
        if (released) return
        released = true
        registration.leases--
        this.finish(registration)
      } })
  }

  /**
   * Parse a proposed tool/public request against the live installed request parser.
   * @param value - Untrusted complete proposed body.
   * @param originalPin - Retained parser identity for replay/retry; it never grants a new execution lease.
   * @returns a strict JSON request; caller identity still requires Native admission.
   */
  parseRequest(value: unknown, originalPin?: SimulationWorldDomainPin): SimulationWorldDomainRequest {
    const request = parseSimulationWorldSchema(simulationWorldDomainRequestSchema, value)
    const pin = originalPin === undefined ? undefined : parseSimulationWorldSchema(simulationWorldDomainPinSchema, originalPin)
    if (pin !== undefined && selectorKey(pin) !== selectorKey(request))
      throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_MISMATCH', 'Request selector differs from its retained pin')
    const registration = pin === undefined ? this.admission(request) : this.original(pin)
    return { ...request, payload: this.payload(registration, 'request', request.payload) }
  }

  /**
   * Parse an immutable accepted plan using its original retained parser generation.
   * @param value - Untrusted complete persisted/public plan.
   * @returns the validated envelope and payload; this does not admit execution.
   */
  parsePlan(value: unknown): SimulationWorldDomainPlan {
    const plan = parseSimulationWorldSchema(simulationWorldDomainPlanSchema, value)
    return { ...plan, payload: this.payload(this.original(plan.pin), 'plan', plan.payload) }
  }

  /**
   * Parse an original result without treating an unknown domain payload as success.
   * @param value - Untrusted complete result.
   * @returns the strict result parsed by its retained schema pin.
   */
  parseResult(value: unknown): SimulationWorldDomainResult {
    const result = parseSimulationWorldSchema(simulationWorldDomainResultSchema, value)
    return { ...result, payload: this.payload(this.original(result.pin), 'result', result.payload) }
  }

  /**
   * Parse a retained mutation responsibility without reassigning it to a replacement provider.
   * @param value - Untrusted complete mutation.
   * @returns the strict responsibility envelope parsed by its original pin.
   */
  parseMutation(value: unknown): SimulationWorldDomainMutation {
    const mutation = parseSimulationWorldSchema(simulationWorldDomainMutationSchema, value)
    return { ...mutation, payload: this.payload(this.original(mutation.pin), 'mutation', mutation.payload) }
  }

  /**
   * Read an original payload parser without taking a lease or invoking provider code.
   * @param pin - Frozen context's exact schema and implementation identity.
   * @param kind - Proposed request or apply-plan payload.
   * @returns retained strict parser; parsing grants no admission or execution authority.
   */
  payloadSchema(pin: SimulationWorldDomainPin, kind: 'request' | 'plan'): z.ZodType {
    return this.original(parseSimulationWorldSchema(simulationWorldDomainPinSchema, pin)).definition.schemas[kind]
  }

  private payload(registration: Registration<I>, kind: keyof SimulationWorldDomainDefinition['schemas'], value: unknown): SimulationWorldDomainRequest['payload'] {
    return parseSimulationWorldSchema(z.json(), parseSimulationWorldSchema(registration.definition.schemas[kind], value))
  }

  private admission(selector: SimulationWorldDomainSelector): Registration<I> {
    const current = this.current.get(selectorKey(selector))
    if (current) return current
    const registrations = [...this.retained.values()]
    if (!registrations.some(value => value.pin.domain === selector.domain)) {
      throw new SimulationWorldDomainError('SIM_WORLD_DOMAIN_UNKNOWN', 'The domain is not installed')
    }
    if (!registrations.some(value => value.pin.domain === selector.domain && value.pin.operation === selector.operation)) {
      throw new SimulationWorldDomainError('SIM_WORLD_OPERATION_UNKNOWN', 'The operation is not installed in this domain')
    }
    if (registrations.some(value => selectorKey(value.pin) === selectorKey(selector))) {
      throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_UNAVAILABLE', 'The installed version has closed new admission')
    }
    throw new SimulationWorldDomainError('SIM_WORLD_VERSION_UNAVAILABLE', 'The requested operation version is not installed')
  }

  private original(pin: SimulationWorldDomainPin): Registration<I> {
    const original = this.retained.get(pinKey(pin))
    if (original) return original
    this.admission(pin)
    throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_MISMATCH', 'The schema or implementation pin does not match an installed generation')
  }

  private finish(registration: Registration<I>): void {
    if (registration.accepting || registration.leases !== 0) return
    registration.implementation = undefined
    registration.complete()
  }
}

function selectorKey(value: SimulationWorldDomainSelector): string {
  return JSON.stringify([value.domain, value.operation, value.version])
}

function pinKey(value: SimulationWorldDomainPin): string {
  return JSON.stringify([selectorKey(value), value.schemaRef, value.implementationRef, value.generation])
}

/**
 * Classify strict World boundary validation without hiding implementation or business failures.
 * @param schema - Original envelope or installed payload parser.
 * @param value - Untrusted public, tool or retained input.
 * @returns the parser output; schema rejection reports bounded field diagnostics and retains its original Zod error as cause.
 */
export function parseSimulationWorldSchema<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  try {
    return schema.parse(value)
  } catch (cause) {
    if (!(cause instanceof z.ZodError)) throw cause
    const issues = cause.issues.slice(0, 8).map(issue =>
      `${issue.path.map(String).join('.').slice(0, 128) || '$'}: ${issue.message.slice(0, 256)}`)
    const remaining = cause.issues.length - issues.length
    throw new SimulationWorldDomainError('SIM_WORLD_SCHEMA',
      `World domain input does not satisfy its strict schema: ${issues.join('; ')}${remaining > 0 ? `; ${remaining} more issues` : ''}`, { cause })
  }
}

function strictSchema(schema: z.ZodType): z.core.JSONSchema.JSONSchema {
  let json: z.core.JSONSchema.JSONSchema
  try {
    json = z.toJSONSchema(schema, { io: 'input' })
  } catch (cause) {
    throw new SimulationWorldDomainError('SIM_WORLD_SCHEMA', 'Domain payload schemas must have a strict JSON input representation', { cause })
  }
  const visit = (node: z.core.JSONSchema.JSONSchema): void => {
    if (node.type === 'object' && node.additionalProperties !== false) {
      throw new SimulationWorldDomainError('SIM_WORLD_SCHEMA', 'Domain payload object parsers must reject unknown fields')
    }
    if (!node.type && node.const === undefined && !node.enum && !node.$ref && !node.anyOf && !node.oneOf && !node.allOf) {
      throw new SimulationWorldDomainError('SIM_WORLD_SCHEMA', 'Opaque domain payload parsers cannot establish a strict contract')
    }
    for (const children of [node.properties, node.$defs]) {
      if (children) for (const child of Object.values(children)) if (typeof child === 'object') visit(child)
    }
    for (const children of [node.anyOf, node.oneOf, node.allOf, node.prefixItems]) {
      if (children) for (const child of children) if (typeof child === 'object') visit(child)
    }
    if (node.items && typeof node.items === 'object') {
      if (Array.isArray(node.items)) {
        for (const child of node.items) if (typeof child === 'object') visit(child)
      } else visit(node.items)
    }
  }
  visit(json)
  return json
}
