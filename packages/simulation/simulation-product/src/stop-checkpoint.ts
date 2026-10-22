/** One automatic collection attempt per reached target; the existing owner queue owns collection and teardown. */
import { createHash } from 'node:crypto'
import { simulationCheckpointIdSchema } from '@clocky/clocky-simulation'
import type { SimulationCheckpointRequest, SimulationRunControlState } from '@clocky/clocky-simulation'

/** A failed or uncertain automatic save requires explicit retry rather than a background retry loop. */
export class StopCheckpointScheduler {
  private attempted: string | undefined

  /**
   * Queue the original target's save only after model work has settled and scheduling is paused.
   * @param stop - Detached current target; reading this value never starts collection.
   * @param policy - Original owner's checkpoint implementation and finite collector allowances.
   * @param collect - Existing serialized collector, also drained by owner retirement.
   */
  schedule(stop: (Pick<SimulationRunControlState, 'activation' | 'state' | 'target' | 'checkpoint' | 'commandId' | 'checkpointId'>
    & { readonly cut: object | null }) | undefined, policy: Omit<SimulationCheckpointRequest, 'id'>,
  collect: (request: SimulationCheckpointRequest, commandId: string) => Promise<unknown>): void {
    if (stop?.activation !== 'effective' || stop.state !== 'paused' || stop.cut === null
      || stop.target?.checkpointPolicy !== 'request' || stop.checkpoint !== 'pending' || this.attempted === stop.commandId) return
    this.attempted = stop.commandId
    const id = simulationCheckpointIdSchema.parse(stop.checkpointId
      ?? `stop-target/${createHash('sha256').update(stop.commandId).digest('hex')}`)
    void collect({ ...policy, id }, stop.commandId).catch((_collectionFailure: unknown) => {
      // Only the queued collector's rejection reaches here. Its failed or unconfirmed Native state remains
      // observable and paused; neither this callback nor another synchronization repeats inference or saving.
    })
  }
}
