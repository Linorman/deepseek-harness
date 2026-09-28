/** Absolute decision deadlines spanning model and tool steps. @module @clocky/clocky-simulation-team/deadline */
import type { Agent } from '@clocky/clocky-agent'
import type { SimulationDecisionId, SimulationWriterLease } from '@clocky/clocky-simulation'
import type { SimulationContextViewEventData } from '@clocky/clocky-session'

interface DeadlineEntry {
  readonly id: SimulationDecisionId
  readonly writer: SimulationWriterLease
  readonly actor: Agent
  readonly deadline: number
  readonly inputId: SimulationContextViewEventData['inputId']
  timer?: ReturnType<typeof setTimeout>
}

/** Owns deadline timers until submission, expiry or connection shutdown. */
export class SimulationDeadlines {
  private readonly entries = new Map<SimulationDecisionId, DeadlineEntry>()
  private readonly pending = new Set<Promise<void>>()
  private closed = false

  constructor(private readonly reportFailure: (error: unknown) => void) {}

  /**
   * Establish or reuse a persisted absolute deadline before downstream inference.
   * @param writer - Current decision authority.
   * @param id - Prepared decision.
   * @param actor - Exact local model actor.
   * @param inputId - Frozen input identity that a timer may interrupt.
   * @returns completion after deadline admission; an already expired decision rejects before another request.
   */
  async start(writer: SimulationWriterLease, id: SimulationDecisionId, actor: Agent,
    inputId: SimulationContextViewEventData['inputId']): Promise<void> {
    this.assertOpen()
    const timing = await writer.startDecision(id, Date.now())
    this.assertOpen()
    const entry = this.entries.get(id) ?? { id, writer, actor, inputId, deadline: timing.deadline }
    if (Date.now() >= timing.deadline) {
      const expiry = this.expire(entry)
      this.pending.add(expiry)
      try { await expiry }
      finally { this.pending.delete(expiry) }
      throw new Error('Simulation decision deadline exceeded before model dispatch')
    }
    if (!this.entries.has(id)) {
      this.entries.set(id, entry)
      this.arm(entry)
    }
  }

  /**
   * Retire the timer when its proposal is durably submitted or its slot is cancelled.
   * @param id - Completed decision.
   */
  finish(id: SimulationDecisionId): void {
    clearTimeout(this.entries.get(id)?.timer)
    this.entries.delete(id)
  }

  /**
   * Release one stopped actor's timers and drain accepted deadline writes before writer release.
   * @param actor - Exact retired activation handle.
   * @returns completion after its timer admission is closed and accepted run writes settle.
   */
  async retire(actor: Agent): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.actor === actor) this.finish(entry.id)
    }
    await Promise.allSettled([...this.pending])
  }

  /** Close timer admission and drain accepted timeout writes before coordinator release. */
  async close(): Promise<void> {
    this.closed = true
    for (const id of this.entries.keys()) this.finish(id)
    await Promise.allSettled([...this.pending])
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Simulation deadline owner is closed')
  }

  private arm(entry: DeadlineEntry): void {
    // Node's timer delay is a signed 32-bit integer; rearming retains the original absolute deadline.
    entry.timer = setTimeout(() => {
      if (this.closed || this.entries.get(entry.id) !== entry) return
      if (Date.now() < entry.deadline) { this.arm(entry); return }
      const work = this.expire(entry).catch((error: unknown) => {
        try { this.reportFailure(error) }
        finally { this.cancelCurrent(entry, 'Simulation deadline persistence failed') }
      })
      this.pending.add(work)
      const settled = () => { this.pending.delete(work); this.finish(entry.id) }
      void work.then(settled, settled)
    }, Math.min(0x7fffffff, Math.max(1, entry.deadline - Date.now())))
  }

  private async expire(entry: DeadlineEntry): Promise<void> {
    const decision = await entry.writer.expireDecision(entry.id, Date.now())
    if (decision.status === 'cancelled' && decision.cancellation === 'timeout') {
      this.cancelCurrent(entry, 'Simulation decision deadline exceeded')
    }
  }

  private cancelCurrent(entry: DeadlineEntry, reason: string): void {
    const view = entry.actor.session.events.findLast(event => event.type === 'simulation/context-view')
    if (view?.type !== 'simulation/context-view' || view.data.inputId !== entry.inputId) return
    entry.actor.cancel({ kind: 'hook', reason }, { keepInbox: true })
  }
}
