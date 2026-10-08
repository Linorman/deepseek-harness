/** Independent run-local provisioning queues; callers retain admission and current-authority checks. */
import type { SimulationRun } from '@clocky/clocky-simulation'

/** Serialize one topology owner's work and drain accepted IO before releasing its run. */
export class ProvisioningQueue {
  private readonly pending = new Map<SimulationRun,Promise<void>>()

  /** Admit an operation after prior work for the same run settles, including prior rejection.
   * @param run - Run identity whose accepted IO must remain ordered.
   * @param operation - Owner-specific provisioning and authority rechecks.
   * @returns that operation's result; its failure does not prevent later queued work.
   */
  enqueue<T>(run: SimulationRun, operation: () => Promise<T>): Promise<T> {
    const work = (this.pending.get(run) ?? Promise.resolve()).then(operation)
    const settled = work.then(() => {}, () => {})
    this.pending.set(run, settled)
    void settled.then(() => { if (this.pending.get(run) === settled) this.pending.delete(run) })
    return work
  }

  /** Wait for this owner's accepted run IO after the caller closes admission.
   * @param run - Closing run identity.
   * @returns settlement of the queued tail, including failed operations.
   */
  async drain(run: SimulationRun): Promise<void> { await this.pending.get(run) }
}
