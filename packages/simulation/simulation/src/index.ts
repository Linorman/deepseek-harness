export * from './communication.ts'
import { simulationArchivePrefixSchema } from './experiment.ts'
export * from './world-sources.ts'
export * from './world-management.ts'
export type * from './world-management-types.ts'
/** Named durable simulation run providers. @module @clocky/clocky-simulation */
import { Context, Service } from '@clocky/cordis'
import { simulationRunSelectionSchema } from './schema.ts'
import { simulationInspectionSelectionSchema } from './inspection.ts'
import type { SimulationInspectionSelection, SimulationRunObservation } from './inspection.ts'
import type { SimulationProvider, SimulationRun, SimulationRunRequest, SimulationRunSelection } from './types.ts'
import type { NativeWorldDomain } from './world-native-types.ts'
import type { SimulationWorldDomainRegistry } from './world-domain-registry.ts'
export type * from './types.ts'
export * from './schema.ts'
export * from './time.ts'
export * from './entity.ts'
export * from './writer.ts'
export * from './business.ts'
export * from './resource-reservation.ts'
export * from './world-hiring-resources.ts'
export * from './interaction.ts'
export * from './scheduler.ts'
export * from './outbox.ts'
export * from './outbox-retry.ts'
export * from './context.ts'
export * from './context-consumption.ts'
export * from './window.ts'
export * from './dispatch.ts'
export * from './budget.ts'
export * from './metrics.ts'
export * from './tokens.ts'
export * from './model-admission.ts'
export * from './activation-admission.ts'
export * from './world-submission.ts'
export * from './world-execution.ts'
export * from './capacity.ts'
export * from './deterministic.ts'
export * from './knowledge.ts'
export { knowledgeVisible, selectKnowledge } from './knowledge-query.ts'
export * from './task-evidence.ts'
export * from './task-execution.ts'
export * from './task-completion.ts'
export * from './task-outbox.ts'
export * from './management.ts'
export * from './maintenance.ts'
export * from './checkpoint-reference.ts'
export * from './checkpoint.ts'
export * from './ingress.ts'
export * from './inspection.ts'
export type * from './outbox-types.ts'
export type * from './scheduler-types.ts'
export type * from './business-types.ts'
export type * from './writer-types.ts'
export type * from './entity-types.ts'

declare module '@clocky/cordis' {
  interface Context {
    simulations: Simulations
  }
}

/** Registry whose providers own run IO and exclusive coordinator lifetimes. */
export class Simulations extends Service {
  /** Validate a portable Native prefix through its original provider without opening a run.
   * @param provider - Explicit installed reducer provider.
   * @param input - Complete original prefix, exact source format and source spec.
   * @returns detached replayed snapshot; absent provider capability refuses without IO.
   */
  validateArchivePrefix(provider: string, input: import('./experiment.ts').SimulationArchivePrefix): import('./types.ts').SimulationSnapshot {
    const selected = this.provider(provider)
    if (selected.validateArchivePrefix === undefined) throw new Error('Simulation provider cannot validate portable prefixes')
    return selected.validateArchivePrefix(simulationArchivePrefixSchema.parse(input))
  }

  private readonly providers = new Map<string, SimulationProvider>()

  constructor(ctx: Context) { super(ctx, 'simulations') }

  /**
   * Access the selected provider's explicit pure World parser/reducer catalog.
   * @param name - Registered deployment provider identity.
   * @returns the provider-owned catalog; absent World capability rejects before side effects.
   */
  domains(name: string): SimulationWorldDomainRegistry<NativeWorldDomain> {
    const catalog = this.provider(name).worldDomains
    if (catalog === undefined) throw new Error('Simulation provider has no installed World domain catalog')
    return catalog
  }

  /**
   * Register an implementation.
   * @param provider - Named implementation.
   * @returns effect-scoped disposer.
   */
  registerProvider(provider: SimulationProvider): () => void {
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis effects return callable asynchronous disposers.
    return this.ctx.effect(() => {
      if (this.providers.has(provider.name)) throw new Error(`Simulation provider '${provider.name}' already registered`)
      this.providers.set(provider.name, provider)
      return () => { this.providers.delete(provider.name) }
    })
  }

  /**
   * Validate explicit selection before IO.
   * @param request - Run request.
   * @returns resolved selection.
   */
  resolve(request: SimulationRunRequest): SimulationRunSelection {
    const spec = simulationRunSelectionSchema.parse(request)
    this.provider(spec.provider)
    return spec
  }

  /**
   * Open a resolved run.
   * @param selection - Explicit provider and run configuration.
   * @returns caller-owned run.
   */
  open(selection: SimulationRunSelection): Promise<SimulationRun> {
    return this.provider(selection.provider).open(selection)
  }

  /**
   * Resolve immutable selection and provider support before read-only IO.
   * @param request - Provider and expected run spec; no execution or storage path flags.
   * @returns validated supported inspection selection.
   */
  resolveInspection(request: SimulationInspectionSelection): SimulationInspectionSelection {
    const selection = simulationInspectionSelectionSchema.parse(request)
    if (this.provider(selection.provider).inspect === undefined) throw new Error('Simulation provider does not support read-only inspection')
    return selection
  }

  /**
   * Read raw registered-source bytes without acquiring execution or selecting a fallback Native parser.
   * @param selection - Deployment-owned provider/run selection; public consumers must authorize whole-record disclosure.
   * @returns bounded storage-only preservation or absence, never writable/replayed Native state.
   */
  rawArchive(selection: SimulationInspectionSelection): Promise<import('./inspection.ts').SimulationRawArchiveObservation | undefined> {
    const selected = simulationInspectionSelectionSchema.parse(selection), provider = this.provider(selected.provider)
    if (provider.rawArchive === undefined) return Promise.reject(new Error('Simulation provider does not support raw preservation'))
    return provider.rawArchive(selected)
  }

  /**
   * Read existing run facts without opening an execution owner or changing phase.
   * @param selection - Resolved inspection selection.
   * @returns detached history and owner observation, or undefined for a missing run; caller owns authorization and redaction.
   */
  inspect(selection: SimulationInspectionSelection): Promise<SimulationRunObservation | undefined> {
    const provider = this.provider(selection.provider)
    if (provider.inspect === undefined) return Promise.reject(new Error('Simulation provider does not support read-only inspection'))
    return provider.inspect(selection)
  }

  /**
   * Rebuild a provider-owned reference index without opening a writer or invoking models.
   * @param selection - Existing provider and immutable spec.
   * @param expectedRevision - Exact source revision.
   * @param authorize - Current trusted caller fence, retained through source IO.
   * @returns published source identity; unsupported providers reject explicitly.
   */
  rebuildIndex(selection: SimulationInspectionSelection, expectedRevision: number, authorize: () => void):
  Promise<import('./inspection.ts').SimulationIndexManifest> {
    const selected = simulationInspectionSelectionSchema.parse(selection)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return Promise.reject(new Error('Invalid index source revision'))
    const provider = this.provider(selected.provider)
    if (provider.rebuildIndex === undefined) return Promise.reject(new Error('Simulation provider does not support index rebuilding'))
    authorize()
    return provider.rebuildIndex(selected, expectedRevision, authorize)
  }

  /**
   * Preview existing history through its installed provider without opening or creating a run.
   * @param selection - Exact provider and immutable existing-run spec.
   * @param request - Current-prefix strict user action, without a durable reservation.
   * @param authority - Trusted live authentication, exact management permission and source-cut resolver.
   * @returns actual bounded Native quote, or undefined for absent history.
   */
  previewWorldManagement(selection: SimulationInspectionSelection,
    request: import('./world-management-types.ts').SimulationWorldManagementPreviewRequest,
    authority: import('./world-management-types.ts').SimulationWorldManagementAuthority):
  Promise<import('./world-management-types.ts').SimulationWorldManagementPreview | undefined> {
    const selected = simulationInspectionSelectionSchema.parse(selection), provider = this.provider(selected.provider)
    if (provider.previewWorldManagement === undefined) return Promise.reject(new Error('Simulation provider does not support read-only management preview'))
    return provider.previewWorldManagement(selected, request, authority)
  }

  /**
   * Read bounded Native personnel duties with the provider's actual installed manifest and no execution owner.
   * @param selection - Explicit immutable read selection; create/open and storage options are excluded.
   * @param query - Exact original person/assignment selector and complete item/byte bounds.
   * @returns detached paired Native prefix and report, or undefined if history is absent.
   */
  inspectPersonnelObligations(selection: SimulationInspectionSelection, query: import('./personnel-obligations.ts').PersonnelObligationQuery):
  Promise<import('./inspection.ts').SimulationPersonnelObligationObservation | undefined> {
    const selected = simulationInspectionSelectionSchema.parse(selection), provider = this.provider(selected.provider)
    if (provider.inspectPersonnelObligations === undefined) return Promise.reject(new Error('Simulation provider does not support read-only personnel inventory'))
    return provider.inspectPersonnelObligations(selected, query)
  }

  private provider(name: string): SimulationProvider {
    const provider = this.providers.get(name)
    if (provider === undefined) throw new Error(`Simulation provider '${name}' is not registered`)
    return provider
  }
}
export default Simulations
export * from './world.ts'
export type * from './world-types.ts'
export * from './world-errors.ts'
export * from './world-hire.ts'
export * from './world-domain.ts'
export type * from './world-domain-types.ts'
export * from './world-domain-registry.ts'
export * from './world-execution-catalog.ts'
export * from './world-domains.ts'
export type * from './world-native-types.ts'
export * from './world-membership.ts'
export * from './world-facts.ts'
export type * from './world-facts-types.ts'
export * from './world-governance.ts'
export type * from './world-governance-types.ts'
export * from './world-governance-domains.ts'
export * from './world-hire-approval.ts'
export type * from './world-hire-approval-types.ts'
export * from './world-hire-approval-domains.ts'
export * from './world-norms.ts'
export type * from './world-norms-types.ts'
export * from './world-bootstrap.ts'
export type * from './world-bootstrap-types.ts'
export * from './world-calendar.ts'
export * from './world-norm-domains.ts'

export { SimulationDecisionPausedError } from './pause.ts'
export { SimulationRevisionConflictError } from './revision.ts'

export * from './world-hire-existing.ts'
export * from './personnel-obligations.ts'
export * from './world-personnel.ts'
export * from './personnel-state.ts'
export * from './personnel-terminal.ts'
export * from './personnel-counts.ts'
export * from './world-role-permissions.ts'

export * from './world-external.ts'
export type * from './world-external-types.ts'
export * from './world-external-claims.ts'
export * from './world-external-mediated.ts'
export type * from './world-external-mediated-types.ts'

export * from './world-external-actor.ts'

export * from './business-context.ts'

export * from './world-evidence.ts'
export type * from './world-evidence-types.ts'
export * from './context-reference.ts'

export * from './world-hiring-market.ts'

export * from './world-calendar-civil.ts'

export * from './world-norm-impact.ts'
export * from './world-environment.ts'
export * from './world-representation.ts'

export * from './world-generation.ts'

export * from './world-local-object.ts'

export * from './experiment.ts'

export * from './federation-time.ts'

export * from './driver-observation.ts'

export { attributeSimulationTokens } from './token-attribution.ts'
export type { SimulationTokenCategory, SimulationTokenAttribution, SimulationTokenAttributionBucket } from './token-attribution.ts'

export * from './run-control.ts'
export type * from './control-observation-types.ts'

export { simulationWorldBusinessSummarySchema } from './world-summary.ts'
export type { SimulationWorldBusinessSummary, SimulationWorldBusinessSummaryEvidence } from './world-summary.ts'
export * from './run-control-observation.ts'

export { simulationContextBytes } from './context-size.ts'

export * from './native-migration.ts'
