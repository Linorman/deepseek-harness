/** Original Harbor v1 parsers retained for exact context replay; new runs use the versioned current contract. */
import { z } from 'zod'
import { simulationWorldDomainPinSchema } from '@clocky/clocky-simulation'
import type { SimulationWorldDomainDefinition } from '@clocky/clocky-simulation'

const identity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_:/-]{0,99}$/)
// Preserve v1 reference bounds and parser sharing: frozen context hashes depend on this exact schema.
const orderIdentity = identity
const loanIdentity = identity
const positive = z.number().int().min(1).max(1_000_000_000)
const nonnegative = z.number().int().min(0).max(1_000_000_000)
const stock = z.enum(['food', 'water', 'medicine', 'fuel'])
const text = z.string().min(1).max(4000)
/** Original environment actions, without a model-selected actor or Team identity. */
export const harborActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('transfer'), to: identity, resource: z.enum(['cash', 'food', 'water', 'medicine', 'fuel']), quantity: positive }),
  z.strictObject({ kind: z.literal('offer'), id: identity, to: identity, resource: stock, quantity: positive,
    unitPrice: nonnegative, leadDays: z.number().int().min(0).max(30), expiresDay: z.number().int().min(0).max(365) }),
  z.strictObject({ kind: z.literal('accept'), offerId: identity }),
  z.strictObject({ kind: z.literal('deliver'), orderId: orderIdentity }),
  z.strictObject({ kind: z.literal('cancel-order'), orderId: orderIdentity }),
  z.strictObject({ kind: z.literal('loan-offer'), id: identity, to: identity, principal: positive, repayAmount: positive,
    dueDay: z.number().int().min(1).max(365) }),
  z.strictObject({ kind: z.literal('accept-loan'), offerId: identity }),
  z.strictObject({ kind: z.literal('repay'), loanId: loanIdentity }),
  z.strictObject({ kind: z.literal('settle-costs') }),
  z.strictObject({ kind: z.literal('operating'), value: z.boolean(), reason: text }),
  z.strictObject({ kind: z.literal('create-actor'), id: identity, name: text,
    actorKind: z.enum(['firm', 'community', 'institution', 'person']), purpose: text, cash: nonnegative,
    stocks: z.strictObject({ food: nonnegative, water: nonnegative, medicine: nonnegative, fuel: nonnegative }), dailyCost: nonnegative }),
  z.strictObject({ kind: z.literal('organization'), id: identity, name: text, purpose: text }),
  z.strictObject({ kind: z.literal('join'), organizationId: identity, role: text }),
  z.strictObject({ kind: z.literal('leave'), organizationId: identity }),
  z.strictObject({ kind: z.literal('message'), to: z.array(identity).min(1).max(32), text,
    delayDays: z.number().int().min(0).max(30), public: z.boolean() }),
])
/** Experimental control never contains a generated business decision. */
export const harborCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('act'), viewId: z.string().regex(/^view-[a-f0-9]{64}$/),
    actor: identity.optional(),
    rationale: z.string().min(20).max(4000), actions: z.array(harborActionSchema).min(1).max(8) }),
  z.strictObject({ kind: z.literal('advance'), day: z.number().int().min(1).max(365) }),
  z.strictObject({ kind: z.literal('wake'), actors: z.array(identity).min(1).max(32), reason: text }),
  z.strictObject({ kind: z.literal('checkpoint'), memory: z.string().min(80).max(50000) }),
  z.strictObject({ kind: z.literal('restore-check'), checkpointId: z.string().regex(/^cp-[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal('audit') }),
  z.strictObject({ kind: z.literal('finish'), report: z.string().min(100).max(50000) }),
])
/** One installed operation uses the same payload at request, plan and execution. */
export const harborRequestSchema = z.strictObject({
  scopeEntityId: z.literal('harbor'),
  targetEntityId: z.literal('harbor-environment'),
  command: harborCommandSchema,
})
/** Public receipts exclude private actor views and case source paths. */
const coverage = z.strictObject({ decisions: nonnegative, materialDecisions: nonnegative, activeWeeks: nonnegative,
  actors: nonnegative, teamIdentities: nonnegative, checkpoints: nonnegative, checkpointDays: nonnegative, maxCheckpointGap: nonnegative })
/** Audit summaries retain the original verdict and unresolved liabilities, without accepting arbitrary object fields. */
export const harborAuditSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('error'), message: text }),
  z.strictObject({ kind: z.literal('report'), mechanicallyComplete: z.boolean(), day: nonnegative,
    checks: z.strictObject({ worldIntegrity: z.boolean(), horizon: z.boolean(), decisionCoverage: z.boolean(),
      checkpointCoverage: z.boolean(), recoveryCheck: z.boolean() }),
    coverage, balances: z.strictObject({ cash: nonnegative,
      stocks: z.strictObject({ food: nonnegative, water: nonnegative, medicine: nonnegative, fuel: nonnegative }) }),
    openOrders: z.array(z.strictObject({ id: orderIdentity, seller: identity, buyer: identity, resource: stock,
      quantity: positive, dueDay: nonnegative, escrow: nonnegative, breachedAt: nonnegative.nullable() })),
    openLoans: z.array(z.strictObject({ id: loanIdentity, lender: identity, borrower: identity, repayAmount: positive,
      dueDay: nonnegative, breachedAt: nonnegative.nullable() })),
    unpaidCosts: z.array(z.strictObject({ id: identity, unpaidCosts: positive })) }),
])
/** Strict retained judge outcome, including explicit rejection and audit evidence. */
export const harborResultSchema = z.strictObject({
  ok: z.boolean(), day: z.number().int().min(0).max(365),
  command: z.enum(['act', 'advance', 'wake', 'checkpoint', 'restore-check', 'audit', 'finish']),
  receipt: z.strictObject({ error: z.string().max(4000).nullable(), decisionId: identity.nullable(),
    checkpointId: z.string().regex(/^cp-[a-f0-9]{64}$/).nullable(), checkpointDay: nonnegative.nullable(),
    restored: z.boolean().nullable(), audit: harborAuditSchema.nullable(),
    report: z.literal('output/final-report.md').nullable(), wakeActors: z.array(identity) }),
})
/** Exact schema and implementation identity for the optional local case adapter. */
export const HARBOR_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({
  domain: 'harbor', operation: 'execute', version: '1',
  schemaRef: 'clocky.harbor.command/schema/1', implementationRef: 'clocky.harbor.local/1', generation: 1,
}))
/** Parsers are shared by the pure Native reducer and external execution provider. */
export const HARBOR_DEFINITION: SimulationWorldDomainDefinition = Object.freeze({
  domain: HARBOR_PIN.domain, operation: HARBOR_PIN.operation, version: HARBOR_PIN.version, schemaRef: HARBOR_PIN.schemaRef,
  schemas: { request: harborRequestSchema, plan: harborRequestSchema, mutation: harborResultSchema,
    result: z.union([harborResultSchema, z.strictObject({})]) },
})
/** Initial public identities from the delivered case; no private seed values are encoded here. */
export const HARBOR_ACTORS = ['coop', 'rival', 'supplier', 'clinic', 'council', 'north', 'west', 'oldtown',
  'riverside', 'workers', 'mutual-aid', 'press'] as const
/** A validated original case action or experiment control. */
export type HarborCommand = z.infer<typeof harborCommandSchema>
/** Durable normalized original judge outcome. */
export type HarborResult = z.infer<typeof harborResultSchema>
