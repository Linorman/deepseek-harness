/** Trusted independently disposable disclosure policy; reload does not replace the product directory or its execution owners. */
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type { SimulationProductContextReader, SimulationProductRecordReader, SimulationProductCaseReader } from './registration-types.ts'
import type {} from './index.ts'

/** Explicit grants augment the directory's base configuration while this plugin remains mounted. */
export interface Config {
  /** Exact authenticated principals, owned product runs and entity selections; no body, credential or executable payload is accepted. */
  readonly readers: SimulationProductContextReader[]
  /** Separate whole-run original journal access; includes historical private data. */
  readonly recordReaders?: SimulationProductRecordReader[]
  /** Independently selected case prose and generated Persona disclosure. */
  readonly caseReaders?: SimulationProductCaseReader[]
}
/** The process-local registrar strictly validates every nested grant before installing it. */
export const Config: z<Config> = z.object({ readers: z.array(z.any()).required(), recordReaders: z.array(z.any()).default([]),
  caseReaders: z.array(z.any()).default([]) })
/** No policy exists without the independently owned read directory. */
export const inject = ['simulationProducts']
/** Stable deployment-plugin identity, separate from its grant contents. */
export const name = 'simulation-context-readers'
/**
 * Install a trusted policy contribution and retire only its grants on unload.
 * @param ctx - Deployment lifetime and read directory.
 * @param config - Explicit principal/entity grants; the owning registrar copies validated data.
 * @returns nothing; removal wakes authenticated invalidation waits and changes the read-policy version.
 */
export function apply(ctx: Context, config: Config): void {
  const register = ctx.simulationProducts.contextReaderRegistrar()
  const registerRecords = ctx.simulationProducts.recordReaderRegistrar()
  const registerCases = ctx.simulationProducts.caseReaderRegistrar()
  ctx.effect(() => registerCases(config.caseReaders ?? []), 'simulation case readers: policy lifetime')
  ctx.effect(() => registerRecords(config.recordReaders ?? []), 'simulation record readers: policy lifetime')
  ctx.effect(() => register(config.readers), 'simulation context readers: policy lifetime')
}
