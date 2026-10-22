/** Host error identity for Native world admission. @module @clocky/clocky-simulation/world-errors */
import type { z } from 'zod'
import type { simulationWorldFailureCodeSchema } from './world.ts'

/** Native-owned quota classes; consumers never infer capacity from diagnostic prose. */
export type SimulationWorldLimit = 'position' | 'entities' | 'participants' | 'channels' | 'bytes' | 'requests' | 'commands' | 'plans' | 'births' | 'expansions' | 'mutations'
type FailureCode = z.infer<typeof simulationWorldFailureCodeSchema>
type Failure = { readonly code: 'SIM_WORLD_LIMIT'; readonly limit: SimulationWorldLimit }
  | { readonly code: Exclude<FailureCode, 'SIM_WORLD_LIMIT'> }
type FailureArguments = [code: Exclude<FailureCode, 'SIM_WORLD_LIMIT'>, message: string]
  | [code: 'SIM_WORLD_LIMIT', message: string, limit: SimulationWorldLimit]

/** Owned Native validation error, distinct from model-selected rejection reasons. */
export class SimulationWorldError extends Error {
  /** Stable category retained for existing Native callers. */
  readonly code: FailureCode
  /** Exact fixed failure facts; quota variants carry their owning limit. */
  readonly failure: Failure
  /**
   * Retain a stable category without exposing arbitrary rationale as a public explanation.
   * @param args - Fixed category and trusted diagnostic; limit errors also require their exact quota class.
   */
  constructor(...args: FailureArguments) {
    super(args[1])
    this.code = args[0]
    this.failure = args[0] === 'SIM_WORLD_LIMIT' ? { code: args[0], limit: args[2] } : { code: args[0] }
    this.name = 'SimulationWorldError'
  }
}
