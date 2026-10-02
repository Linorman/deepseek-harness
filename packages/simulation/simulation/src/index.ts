/** Named durable simulation run providers. @module @clocky/clocky-simulation */
import { Context, Service } from '@clocky/cordis'
import { simulationRunSelectionSchema } from './schema.ts'
import { simulationInspectionSelectionSchema } from './inspection.ts'
import type { SimulationInspectionSelection, SimulationRunObservation } from './inspection.ts'
import type { SimulationProvider, SimulationRun, SimulationRunRequest, SimulationRunSelection } from './types.ts'
export type * from './types.ts'
export * from './schema.ts'
export * from './time.ts'
export * from './entity.ts'
export * from './writer.ts'
export * from './business.ts'
export * from './interaction.ts'
export * from './scheduler.ts'
export * from './outbox.ts'
export * from './outbox-retry.ts'
export * from './context.ts'
export * from './window.ts'
export * from './dispatch.ts'
export * from './budget.ts'
export * from './metrics.ts'
export * from './tokens.ts'
export * from './capacity.ts'
export * from './deterministic.ts'
export * from './knowledge.ts'
export { knowledgeVisible, selectKnowledge } from './knowledge-query.ts'
export * from './task-evidence.ts'
export * from './task-execution.ts'
export * from './task-completion.ts'
export * from './task-outbox.ts'
export * from './management.ts'
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
  private readonly providers = new Map<string, SimulationProvider>()

  constructor(ctx: Context) { super(ctx, 'simulations') }

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
   * Read existing run facts without opening an execution owner or changing phase.
   * @param selection - Resolved inspection selection.
   * @returns detached history and owner observation, or undefined for a missing run; caller owns authorization and redaction.
   */
  inspect(selection: SimulationInspectionSelection): Promise<SimulationRunObservation | undefined> {
    const provider = this.provider(selection.provider)
    if (provider.inspect === undefined) return Promise.reject(new Error('Simulation provider does not support read-only inspection'))
    return provider.inspect(selection)
  }

  private provider(name: string): SimulationProvider {
    const provider = this.providers.get(name)
    if (provider === undefined) throw new Error(`Simulation provider '${name}' is not registered`)
    return provider
  }
}
export default Simulations
