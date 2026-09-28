/** Named durable simulation run providers. @module @clocky/clocky-simulation */
import { Context, Service } from '@clocky/cordis'
import { simulationRunSelectionSchema } from './schema.ts'
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
export * from './context.ts'
export * from './window.ts'
export * from './dispatch.ts'
export * from './budget.ts'
export * from './tokens.ts'
export * from './capacity.ts'
export * from './deterministic.ts'
export * from './knowledge.ts'
export * from './task-evidence.ts'
export * from './task-outbox.ts'
export * from './management.ts'
export * from './checkpoint-reference.ts'
export * from './checkpoint.ts'
export * from './ingress.ts'
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

  private provider(name: string): SimulationProvider {
    const provider = this.providers.get(name)
    if (provider === undefined) throw new Error(`Simulation provider '${name}' is not registered`)
    return provider
  }
}
export default Simulations
