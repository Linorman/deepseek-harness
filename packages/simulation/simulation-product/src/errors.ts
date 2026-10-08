/** Public product error classification across separately bundled entry points. */
import type { SimulationProductError } from './index.ts'

/**
 * Recognize product refusals without depending on a constructor duplicated by entry-point bundling.
 * @param cause - Failure from a mounted product service.
 * @returns whether the failure carries a declared public category and Error message.
 */
export function isSimulationProductError(cause: unknown): cause is SimulationProductError {
  return cause instanceof Error && 'code' in cause && (cause.code === 'SIMULATION_PRODUCT_FORBIDDEN'
    || cause.code === 'SIMULATION_PRODUCT_INVALID' || cause.code === 'SIMULATION_PRODUCT_UNAVAILABLE'
    || cause.code === 'SIMULATION_PRODUCT_STALE' || cause.code === 'SIMULATION_PRODUCT_MODEL_CHANGED')
}
