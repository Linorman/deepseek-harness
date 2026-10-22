/** Exact registered institution operations; generic World envelopes retain Native caller and implementation authority. */
import { z } from 'zod'
import { simulationWorldDomainPinSchema } from './world-domain.ts'
import { simulationNormEnactRequestSchema, simulationNormRevokeRequestSchema, simulationNormReferenceSchema } from './world-norms.ts'

/** Original enacted institution operation; schema, artifact and generation must match throughout replay. */
export const WORLD_NORM_ENACT_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'governance', operation: 'enact-norm',
  version: '1', schemaRef: 'clocky.governance.enact-norm/schema/2', implementationRef: 'clocky.governance.enact-norm/native/2', generation: 2 }))
/** Original approved revocation operation. */
export const WORLD_NORM_REVOKE_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'governance', operation: 'revoke-norm',
  version: '1', schemaRef: 'clocky.governance.revoke-norm/schema/2', implementationRef: 'clocky.governance.revoke-norm/native/2', generation: 2 }))
/** Safe result contains only exact original version and disposition; private plan rationale is never copied. */
export const simulationNormResultPayloadSchema = z.union([z.strictObject({ norm: simulationNormReferenceSchema,
  status: z.enum(['enacted', 'revoked']) }), z.strictObject({})])
/** Installed exact enact parser set; plans and mutations must preserve the complete original enact input. */
export const WORLD_NORM_ENACT_DEFINITION = Object.freeze({ domain: 'governance', operation: 'enact-norm', version: '1',
  schemaRef: WORLD_NORM_ENACT_PIN.schemaRef, schemas: Object.freeze({ request: simulationNormEnactRequestSchema,
    plan: simulationNormEnactRequestSchema, mutation: simulationNormEnactRequestSchema, result: simulationNormResultPayloadSchema }) })
/** Installed exact revocation parser set. */
export const WORLD_NORM_REVOKE_DEFINITION = Object.freeze({ domain: 'governance', operation: 'revoke-norm', version: '1',
  schemaRef: WORLD_NORM_REVOKE_PIN.schemaRef, schemas: Object.freeze({ request: simulationNormRevokeRequestSchema,
    plan: simulationNormRevokeRequestSchema, mutation: simulationNormRevokeRequestSchema, result: simulationNormResultPayloadSchema }) })
