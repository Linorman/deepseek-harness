/** Versioned Harbor contracts: generated references grow beyond the original actor/offer identity bound. */
import { z } from 'zod'
import { simulationWorldDomainPinSchema } from '@clocky/clocky-simulation'
import type { SimulationWorldDomainDefinition, SimulationWorldDomainPin } from '@clocky/clocky-simulation'
import * as original from './harbor-v1-protocol.ts'

const orderIdentity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_:/-]{0,105}$/)
const loanIdentity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_:/-]{0,104}$/)
/** Original actions with enough space for judge-generated order and loan prefixes. */
export const harborActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('deliver'), orderId: orderIdentity }),
  ...original.harborActionSchema.options.filter(option => !['deliver', 'cancel-order', 'repay'].includes(option.shape.kind.value)),
  z.strictObject({ kind: z.literal('cancel-order'), orderId: orderIdentity }),
  z.strictObject({ kind: z.literal('repay'), loanId: loanIdentity }),
])
/** Controls retain their original fields; actor actions use the current generated-reference contract. */
export const harborCommandSchema = z.discriminatedUnion('kind', [
  original.harborCommandSchema.options[0].extend({ actions: z.array(harborActionSchema).min(1).max(8) }),
  ...original.harborCommandSchema.options.filter(option => option.shape.kind.value !== 'act'),
])
/** Current complete request envelope. */
export const harborRequestSchema = original.harborRequestSchema.extend({ command: harborCommandSchema })
const report = original.harborAuditSchema.options[1]
/** Audit output preserves the exact generated identifiers, including maximum-length original offers. */
export const harborAuditSchema = z.discriminatedUnion('kind', [original.harborAuditSchema.options[0], report.extend({
  openOrders: z.array(report.shape.openOrders.element.extend({ id: orderIdentity })),
  openLoans: z.array(report.shape.openLoans.element.extend({ id: loanIdentity })),
})])
/** Current retained judge receipt. */
export const harborResultSchema = original.harborResultSchema.extend({
  receipt: original.harborResultSchema.shape.receipt.extend({ audit: harborAuditSchema.nullable() }),
})
/** Retained second-generation schema and implementation identity. */
export const HARBOR_V2_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({
  domain: 'harbor', operation: 'execute', version: '2',
  schemaRef: 'clocky.harbor.command/schema/2', implementationRef: 'clocky.harbor.local/2', generation: 2,
}))
/** Exact second-generation parsers retained without reinterpretation. */
export const HARBOR_V2_DEFINITION: SimulationWorldDomainDefinition = Object.freeze({
  domain: HARBOR_V2_PIN.domain, operation: HARBOR_V2_PIN.operation, version: HARBOR_V2_PIN.version, schemaRef: HARBOR_V2_PIN.schemaRef,
  schemas: { request: harborRequestSchema, plan: harborRequestSchema, mutation: harborResultSchema,
    result: z.union([harborResultSchema, z.strictObject({})]) },
})
/** A director explicitly authorizes forwarding; the already-bound Native request supplies the exact body. */
export const harborForwardPlanSchema = z.strictObject({ forwardOriginal: z.literal(true) })
/** Current operation separates the actor request from the director's forwarding decision. */
export const HARBOR_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({
  domain: 'harbor', operation: 'execute', version: '3',
  schemaRef: 'clocky.harbor.command/schema/3', implementationRef: 'clocky.harbor.local/3', generation: 3,
}))
/** Current parsers retain actor requests and judge receipts while bounding the forwarding plan. */
export const HARBOR_DEFINITION: SimulationWorldDomainDefinition = Object.freeze({
  domain: HARBOR_PIN.domain, operation: HARBOR_PIN.operation, version: HARBOR_PIN.version, schemaRef: HARBOR_PIN.schemaRef,
  schemas: { ...HARBOR_V2_DEFINITION.schemas, plan: harborForwardPlanSchema },
})
/** An installed immutable protocol version; never substitute one version for another retained pin. */
export interface HarborContract {
  /** Exact Native and execution identity. */
  readonly pin: SimulationWorldDomainPin
  /** Original shared parser objects. */
  readonly definition: SimulationWorldDomainDefinition
  /** Whether the director copies the admitted body or explicitly authorizes its unchanged forwarding. */
  readonly planMode: 'copy-original' | 'forward-original'
}
/** Versions required by retained runs and current authoring, without aliases or payload rewriting. */
export const HARBOR_CONTRACTS: readonly HarborContract[] = Object.freeze([
  { pin: original.HARBOR_PIN, definition: original.HARBOR_DEFINITION, planMode: 'copy-original' },
  { pin: HARBOR_V2_PIN, definition: HARBOR_V2_DEFINITION, planMode: 'copy-original' },
  { pin: HARBOR_PIN, definition: HARBOR_DEFINITION, planMode: 'forward-original' },
])
/** Default contract for new installations. */
export const HARBOR_CURRENT: HarborContract = { pin: HARBOR_PIN, definition: HARBOR_DEFINITION, planMode: 'forward-original' }
export { HARBOR_ACTORS } from './harbor-v1-protocol.ts'
/** Current validated case action or control. */
export type HarborCommand = z.infer<typeof harborCommandSchema>
/** Current normalized judge outcome. */
export type HarborResult = z.infer<typeof harborResultSchema>
