/** Explicit role-only source selectors; authenticated users never inherit simulated actor authority. */
import { SimulationWorldError } from './world-errors.ts'
import type { SimulationWorldIntent, SimulationWorldRequest, SimulationWorldPlan, SimulationWorldDecisionSource } from './world-types.ts'
import type { SimulationEntityId, SimulationOperationId } from './identities.ts'
/**
 * Require the real simulated requester at a role-only boundary.
 * @param intent - Original intent with disjoint user or actor provenance.
 * @returns the actual requester; authenticated user originals refuse.
 */
export function worldRoleRequester(intent: Pick<SimulationWorldIntent, 'requesterEntityId'>): SimulationEntityId {
  if (intent.requesterEntityId === null) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'This domain requires its original simulated role requester')
  return intent.requesterEntityId
}
/**
 * Require immutable Decision provenance at a role-only boundary.
 * @param request - Original request with disjoint user or actor source.
 * @returns the actual decision source; authenticated management refuses.
 */
export function worldDecisionSource(request: Pick<SimulationWorldRequest, 'source'>): SimulationWorldDecisionSource {
  if (request.source.kind !== 'decision') throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'This context requires its actual original decision source')
  return request.source
}
/**
 * Require a real role planning Operation.
 * @param plan - Accepted plan with an actual Operation or explicit user null.
 * @returns the real role Operation; direct management plans refuse.
 */
export function worldRolePlanOperationId(plan: Pick<SimulationWorldPlan, 'operationId'>): SimulationOperationId {
  if (plan.operationId === null) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'This domain requires its original role planning operation')
  return plan.operationId
}
/**
 * Require the actual role planning envelope at a model-only submission boundary.
 * @param plan - Accepted original role or direct user plan.
 * @returns the narrowed role plan; direct user applications refuse.
 */
export function worldRolePlan(plan: SimulationWorldPlan): Extract<SimulationWorldPlan, { readonly operationId: SimulationOperationId }> {
  if (plan.operationId === null) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Direct user applications are not model proposals')
  return plan
}
