import { LocalObjectWorldExecution } from './local-object.ts'
import { startupNoticePolicy } from './startup-notice.ts'
import { WORLD_LOCAL_OBJECT_DEFINITION, WORLD_LOCAL_OBJECT_PIN } from '@clocky/clocky-simulation'
import { EvolutionWorldExecution } from './evolution.ts'
import { RepresentationWorldExecution } from './representation.ts'
import { WORLD_REPRESENTATION_DEFINITION, WORLD_REPRESENTATION_PIN } from '@clocky/clocky-simulation'
import { WORLD_ENVIRONMENT_DEFINITION, WORLD_ENVIRONMENT_PIN, WORLD_EXPERIENCE_DEFINITION, WORLD_EXPERIENCE_PIN } from '@clocky/clocky-simulation'
import { HiringMarketWorldExecution } from './hiring-market.ts'
import { WORLD_HIRING_MARKET_DEFINITION, WORLD_HIRING_MARKET_PIN } from '@clocky/clocky-simulation'
/** Installed execution factories are independent of Native reducers and product directory lifetimes. */
import { Context, Service } from '@clocky/cordis'
import { SimulationWorldDomainRegistry, SimulationWorldDomainError, retainWorldExecutionCatalog,
  WORLD_GENERATE_AND_HIRE_DEFINITION, WORLD_GENERATE_AND_HIRE_PIN,
  WORLD_HIRE_EXISTING_DEFINITION, WORLD_HIRE_EXISTING_PIN,
  WORLD_GOVERNANCE_ROUTE_DEFINITION, WORLD_GOVERNANCE_ROUTE_PIN,
  WORLD_GOVERNANCE_DELEGATE_DEFINITION, WORLD_GOVERNANCE_DELEGATE_PIN, WORLD_GOVERNANCE_PROPOSE_DEFINITION, WORLD_GOVERNANCE_PROPOSE_PIN,
  WORLD_GOVERNANCE_VOTE_DEFINITION, WORLD_GOVERNANCE_VOTE_PIN,
  WORLD_GOVERNANCE_HIRE_APPROVAL_DEFINITION, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN,
  WORLD_NORM_ENACT_DEFINITION, WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_DEFINITION, WORLD_NORM_REVOKE_PIN,
  WORLD_EXTERNAL_INTERACT_DEFINITION, WORLD_EXTERNAL_INTERACT_PIN,
  WORLD_EXTERNAL_ACTOR_DEFINITION, WORLD_EXTERNAL_ACTOR_PIN,
  WORLD_EXTERNAL_MEDIATED_DEFINITION, WORLD_EXTERNAL_MEDIATED_PIN,
  WORLD_TRANSFER_DEFINITION, WORLD_TRANSFER_PIN, WORLD_DEPART_DEFINITION, WORLD_DEPART_PIN } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWorldDomainDefinition, SimulationWorldDomainImplementation,
  SimulationWorldDomainPin, SimulationSnapshot } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { ResolvedWorldScenario, ResolvedWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import type { SimulationWorldDriverAnchor } from './types.ts'
import type { WorldExecutionHandler } from './execution.ts'
import { OrganizationWorldExecution } from './organization.ts'
import { ExistingHireWorldExecution } from './hire-existing.ts'
import { GovernanceWorldExecution } from './governance.ts'
import { NormWorldExecution } from './norms.ts'
import { ExternalWorldExecution } from './external.ts'
import { ExternalActorWorldExecution } from './external-actor.ts'
import { ExternalMediatedWorldExecution } from './external-mediated.ts'
import { PersonnelWorldExecution } from './personnel.ts'

/** Trusted original owner capabilities supplied only when binding an installed factory. */
export interface WorldExecutionBinding {
  /** Exclusively held original Native run. */
  readonly run: SimulationRun
  /** Canonical connection for the original Team owner. */
  readonly connection: SimulationTeamConnection
  /** Accepted compilation and immutable model routes. */
  readonly resolved: ResolvedWorldScenario | ResolvedWorldScenarioV1
  /** Original checkpoint and bounded maintenance namespace. */
  readonly anchor: SimulationWorldDriverAnchor
  /** Caller-owned execution lifetime. */
  readonly lifetime: AbortSignal
}

/** An actual run-independent factory; registration and validation never call create. */
export interface WorldExecutionProvider extends SimulationWorldDomainImplementation {
  /** The exact strict payload parsers shared with the Native provider. */
  readonly definition: SimulationWorldDomainDefinition
  /** @param binding - Original admitted run and canonical connection. @returns its original handler, without IO. */
  create(binding: WorldExecutionBinding): WorldExecutionHandler
}

function provider(definition: SimulationWorldDomainDefinition, pin: SimulationWorldDomainPin,
  create: WorldExecutionProvider['create']): WorldExecutionProvider {
  return Object.freeze({ definition, ref: pin.implementationRef, generation: pin.generation, create })
}

/** Single declaration used both for trusted restore admission and actual builtin handler construction. */
export const builtinWorldExecutionProviders: readonly WorldExecutionProvider[] = Object.freeze([
  provider(WORLD_LOCAL_OBJECT_DEFINITION, WORLD_LOCAL_OBJECT_PIN, b => new LocalObjectWorldExecution(b.run, b.connection,
    b.anchor, b.lifetime)),
  provider(WORLD_ENVIRONMENT_DEFINITION, WORLD_ENVIRONMENT_PIN, b => new EvolutionWorldExecution(b.run, 'supply')),
  provider(WORLD_REPRESENTATION_DEFINITION, WORLD_REPRESENTATION_PIN, b => new RepresentationWorldExecution(b.run)),
  provider(WORLD_EXPERIENCE_DEFINITION, WORLD_EXPERIENCE_PIN, b => new EvolutionWorldExecution(b.run, 'experience')),
  provider(WORLD_HIRING_MARKET_DEFINITION, WORLD_HIRING_MARKET_PIN, b => new HiringMarketWorldExecution(b.run)),
  provider(WORLD_GENERATE_AND_HIRE_DEFINITION, WORLD_GENERATE_AND_HIRE_PIN, b =>
    new OrganizationWorldExecution(b.run, b.connection, b.resolved, b.anchor, b.lifetime)),
  provider(WORLD_HIRE_EXISTING_DEFINITION, WORLD_HIRE_EXISTING_PIN, b => new ExistingHireWorldExecution(b.run)),
  provider(WORLD_GOVERNANCE_ROUTE_DEFINITION, WORLD_GOVERNANCE_ROUTE_PIN, b => new GovernanceWorldExecution(b.run, 'route')),
  provider(WORLD_GOVERNANCE_DELEGATE_DEFINITION, WORLD_GOVERNANCE_DELEGATE_PIN, b => new GovernanceWorldExecution(b.run, 'delegation')),
  provider(WORLD_GOVERNANCE_PROPOSE_DEFINITION, WORLD_GOVERNANCE_PROPOSE_PIN, b => new GovernanceWorldExecution(b.run, 'proposal')),
  provider(WORLD_GOVERNANCE_VOTE_DEFINITION, WORLD_GOVERNANCE_VOTE_PIN, b => new GovernanceWorldExecution(b.run, 'vote')),
  provider(WORLD_GOVERNANCE_HIRE_APPROVAL_DEFINITION, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, b => new GovernanceWorldExecution(b.run, 'hire-approval')),
  provider(WORLD_NORM_ENACT_DEFINITION, WORLD_NORM_ENACT_PIN, b => new NormWorldExecution(b.run, 'enact')),
  provider(WORLD_NORM_REVOKE_DEFINITION, WORLD_NORM_REVOKE_PIN, b => new NormWorldExecution(b.run, 'revoke')),
  provider(WORLD_EXTERNAL_INTERACT_DEFINITION, WORLD_EXTERNAL_INTERACT_PIN, b => new ExternalWorldExecution(b.run)),
  provider(WORLD_EXTERNAL_ACTOR_DEFINITION, WORLD_EXTERNAL_ACTOR_PIN, b =>
    new ExternalActorWorldExecution(b.run, b.connection, b.resolved, b.anchor, b.lifetime)),
  provider(WORLD_EXTERNAL_MEDIATED_DEFINITION, WORLD_EXTERNAL_MEDIATED_PIN, b =>
    new ExternalMediatedWorldExecution(b.run, b.connection, b.resolved, b.anchor, b.lifetime)),
  provider(WORLD_TRANSFER_DEFINITION, WORLD_TRANSFER_PIN, b => new PersonnelWorldExecution(b.run, b.connection, b.anchor, b.lifetime, 'transfer')),
  provider(WORLD_DEPART_DEFINITION, WORLD_DEPART_PIN, b => new PersonnelWorldExecution(b.run, b.connection, b.anchor, b.lifetime, 'depart')),
])

declare module '@clocky/cordis' { interface Context { simulationWorldExecutions: SimulationWorldExecutions } }

/** Opt-in factory provider; pure browsing needs neither this service nor its execution bindings. */
export class SimulationWorldExecutions extends Service {
  static inject = ['simulationTeams']
  private readonly catalog = new SimulationWorldDomainRegistry<WorldExecutionProvider>()

  /** @param ctx - Provider Fiber; installs builtin factories and one neutral Team restoration catalog. */
  constructor(ctx: Context) {
    super(ctx, 'simulationWorldExecutions')
    ctx.effect(() => ctx.simulationTeams.registerDeterministicPolicy(startupNoticePolicy))
    for (const entry of builtinWorldExecutionProviders) ctx.effect(() => this.register(entry))
    ctx.effect(() => ctx.simulationTeams.registerWorldExecutionCatalog(this.catalog))
  }

  /**
   * Register an independent strict execution factory; its installing Fiber owns the returned disposer.
   * @param entry - Actual factory and exact immutable schema/artifact/generation identity.
   * @returns disposer which closes new restore/binding admission synchronously and drains admitted factory leases.
   */
  register(entry: WorldExecutionProvider): () => Promise<void> { return this.catalog.register(entry.definition, entry) }

  /**
   * Observe installation of current frozen pins without rereading retained payload bodies.
   * @param pins - Exact operation generations from an authoritative live Native control projection.
   * @param native - Installed Native parser catalog, compared by identity.
   * @returns whether all factories and original parsers are installed; this hint does not admit execution or restoration.
   */
  controlAvailable(pins: readonly SimulationWorldDomainPin[], native: SimulationWorldDomainRegistry): boolean {
    try {
      for (const pin of pins) {
        const execution = this.catalog.acquire(pin)
        try {
          const definition = native.definition({ domain: pin.domain, operation: pin.operation, version: pin.version })
          if (definition.schemaRef !== execution.implementation.definition.schemaRef
            || (['request', 'plan', 'result', 'mutation'] as const).some(kind =>
              definition.schemas[kind] !== execution.implementation.definition.schemas[kind])) return false
        } finally { execution.release() }
      }
      return true
    } catch (cause: unknown) {
      if (cause instanceof SimulationWorldDomainError) return false
      throw cause
    }
  }

  /**
   * Admit original execution generations before a product owner retires or restores its current connection.
   * @param snapshot - Current retained Native state, including all historical pins and payloads.
   * @param native - Installed Native catalog whose original parser objects must match.
   * @returns release after admitted ownership movement; this performs no construction, IO or inference.
   */
  retain(snapshot: Pick<SimulationSnapshot, 'world'>, native: SimulationWorldDomainRegistry): () => void {
    return retainWorldExecutionCatalog(snapshot, this.catalog, native)
  }

  /**
   * Bind every required original provider without IO, preserving explicitly supplied test adapters.
   * @param binding - Frozen Native run, resolved routes, connection and maintenance anchor.
   * @param overrides - Trusted already-bound adapters; exact pin and schemas are independently checked by the driver.
   * @returns complete handler set; a missing provider or malformed factory output rejects before scheduling.
   */
  handlers(binding: WorldExecutionBinding, overrides: readonly WorldExecutionHandler[] = []): readonly WorldExecutionHandler[] {
    const state = binding.run.snapshot(), release = retainWorldExecutionCatalog(state, this.catalog)
    try {
      const handlers = [...overrides]
      for (const pin of state.world?.definition.operations ?? []) {
        const existing = handlers.find(handler => handler.definition.domain === pin.domain
          && handler.definition.operation === pin.operation && handler.definition.version === pin.version)
        const lease = this.catalog.acquire(pin)
        try {
          const handler = existing ?? lease.implementation.create(binding)
          if (handler.ref !== pin.implementationRef || handler.generation !== pin.generation
            || handler.definition.schemaRef !== pin.schemaRef || handler.definition.domain !== pin.domain
            || handler.definition.operation !== pin.operation || handler.definition.version !== pin.version
            || (['request', 'plan', 'result', 'mutation'] as const).some(kind =>
              handler.definition.schemas[kind] !== lease.implementation.definition.schemas[kind])) {
            throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_MISMATCH', 'Execution factory returned another provider contract')
          }
          if (existing === undefined) handlers.push(handler)
        } finally { lease.release() }
      }
      return handlers
    } finally { release() }
  }
}
export default SimulationWorldExecutions
