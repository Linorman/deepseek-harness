/** Governance acknowledgements execute through the original atomic Native mutation capability. */
import { WORLD_GOVERNANCE_PROPOSE_DEFINITION, WORLD_GOVERNANCE_PROPOSE_PIN,
  WORLD_GOVERNANCE_HIRE_APPROVAL_DEFINITION, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN,
  WORLD_GOVERNANCE_ROUTE_PIN, WORLD_GOVERNANCE_ROUTE_DEFINITION, WORLD_GOVERNANCE_DELEGATE_PIN, WORLD_GOVERNANCE_DELEGATE_DEFINITION,
  WORLD_GOVERNANCE_VOTE_DEFINITION, WORLD_GOVERNANCE_VOTE_PIN, governanceEarlyClosure } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldPlan } from '@clocky/clocky-simulation'
import type { WorldExecutionHandler } from './execution.ts'

/** Installed governance adapter; independent proposals and votes are already frozen by Native acceptance. */
export class GovernanceWorldExecution implements WorldExecutionHandler {
  readonly definition
  readonly ref
  readonly generation
  readonly settleBoundary?: () => Promise<boolean>

  /**
   * @param run - Original exclusive Native owner; this adapter performs no provider or model IO.
   * @param contribution - Exact installed operation to acknowledge, without changing its text, voter or choice.
   */
  constructor(private readonly run: SimulationRun, contribution: 'route' | 'delegation' | 'proposal' | 'vote' | 'hire-approval') {
    const pin = contribution === 'route' ? WORLD_GOVERNANCE_ROUTE_PIN : contribution === 'delegation' ? WORLD_GOVERNANCE_DELEGATE_PIN : contribution === 'proposal' ? WORLD_GOVERNANCE_PROPOSE_PIN
      : contribution === 'vote' ? WORLD_GOVERNANCE_VOTE_PIN : WORLD_GOVERNANCE_HIRE_APPROVAL_PIN
    this.definition = contribution === 'route' ? WORLD_GOVERNANCE_ROUTE_DEFINITION : contribution === 'delegation' ? WORLD_GOVERNANCE_DELEGATE_DEFINITION : contribution === 'proposal' ? WORLD_GOVERNANCE_PROPOSE_DEFINITION
      : contribution === 'vote' ? WORLD_GOVERNANCE_VOTE_DEFINITION : WORLD_GOVERNANCE_HIRE_APPROVAL_DEFINITION
    this.ref = pin.implementationRef
    this.generation = pin.generation
    if (contribution === 'vote') this.settleBoundary = async () => {
      const state = this.run.snapshot(), governance = state.world?.governance
      const proposal = governance === undefined ? undefined : Object.values(governance.proposals)
        .find(value => governanceEarlyClosure(state, governance, value.id) !== undefined)
      return proposal !== undefined && await this.run.closeWorldGovernance(proposal.id, { boundary: true }) !== undefined
    }
  }

  reconciliationPlans(): readonly SimulationWorldPlan['id'][] { return [] }

  retainsResponsibility(_plan: SimulationWorldPlan): boolean { return false }

  async execute(plan: SimulationWorldPlan): Promise<undefined> {
    await this.run.commitWorldMutation({ planId: plan.id, payload: { kind: 'acknowledge' } })
    return undefined
  }

  async reconcile(plan: SimulationWorldPlan): Promise<void> { await this.execute(plan) }
}
