/** Process-local wall-time observations; durable model accounting remains Native-owned. */
import { activeSimulationMaintenance, simulationTokenCount } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { Context } from '@clocky/cordis'
import type {} from '../src/index.ts'

/** Observe committed maintenance boundaries without changing the run or admitting work. */
export class LongitudinalMetrics {
  private readonly started = performance.now()
  private active: { id: string; startedMs: number; inherited: boolean } | undefined
  private readonly intervals: { id: string; startedMs: number; finishedMs: number; inherited: boolean }[] = []
  private first = true

  /** @param ctx - Actual Loader/Native context whose committed facts define the measured run. */
  constructor(ctx: Context) {
    ctx.on('simulation/committed', (state) => {
      const current = activeSimulationMaintenance(state), now = performance.now() - this.started
      if (this.active !== undefined && current?.request.id !== this.active.id) {
        this.intervals.push({ ...this.active, finishedMs: now }); this.active = undefined
      }
      if (current !== undefined && this.active === undefined)
        this.active = { id: current.request.id, startedMs: now, inherited: this.first }
      this.first = false
    })
  }

  /** @param state - Exact sampled durable prefix. @returns cumulative process timing and conservative token categories. */
  sample(state: SimulationSnapshot) {
    const elapsedMs = performance.now() - this.started
    const maintenanceMs = this.intervals.reduce((sum, value) => sum + value.finishedMs - value.startedMs, 0)
      + (this.active === undefined ? 0 : elapsedMs - this.active.startedMs)
    const categories = { actor: bucket(), director: bucket(), generation: bucket(), auxiliary: bucket() }
    for (const value of Object.values(state.tokenReservations ?? {})) {
      const category = value.compactionId !== undefined ? categories.auxiliary
        : value.entityId === state.world?.definition.directorEntityId ? categories.director : categories.actor
      category.calls++
      if (value.status === 'not-dispatched') continue
      if (value.usage !== undefined) category.knownTokens += simulationTokenCount(value.usage)
      else { category.unknownCalls++; category.retainedTokens += Math.max(value.reserved,
        value.observedUsage === undefined ? 0 : simulationTokenCount(value.observedUsage)) }
    }
    for (const value of Object.values(state.generationJobs ?? {})) {
      if (value.status === 'cancelled' && value.sessionSequence === undefined) continue
      if (value.sessionSequence !== undefined) categories.generation.calls++
      if (value.usage !== undefined) categories.generation.knownTokens += simulationTokenCount(value.usage)
      else {
        if (value.sessionSequence !== undefined) categories.generation.unknownCalls++
        categories.generation.retainedTokens += Math.max(value.job.budget.maxTokens,
          value.observedUsage === undefined ? 0 : simulationTokenCount(value.observedUsage))
      }
    }
    return { processPeakRssBytes: process.resourceUsage().maxRSS * 1024, processElapsedMs: elapsedMs, maintenanceMs,
      maintenanceFraction: maintenanceMs / elapsedMs,
      maintenanceIntervals: [...this.intervals], activeMaintenance: this.active ?? null,
      historicalIdentities: Object.keys(state.entities).length, sourceRevision: state.revision,
      modelAccounting: categories, monetaryCost: { status: 'unknown', reason: 'No frozen provider price schedule' } }
  }
}
function bucket() { return { calls: 0, knownTokens: 0, unknownCalls: 0, retainedTokens: 0 } }
