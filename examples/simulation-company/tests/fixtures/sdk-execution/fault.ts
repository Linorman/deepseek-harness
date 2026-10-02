/** Interrupt only native result acceptance; real SDK services, report delivery and task completion stay production-owned. */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@clocky/cordis'
import type { SimulationRun } from '@clocky/clocky-simulation'

export const inject = ['simulations', 'sessionPersistence']
/**
 * Hold a one-shot external failure after actual report persistence and retain only source selectors for client inspection.
 * @param ctx - Real Loader owner and native run opening service.
 * @returns nothing; wrappers preserve real execution except the configured single lost native result.
 */
export function apply(ctx: Context): void {
  const open = ctx.simulations.open.bind(ctx.simulations)
  let interrupted = process.env.SDK_EXECUTION_FAULT !== 'true'
  ctx.simulations.open = async (...args) => {
    const run: SimulationRun = await open(...args)
    const result = run.recordTaskResult.bind(run)
    run.recordTaskResult = async (...input) => {
      if (!interrupted) {
        interrupted = true
        throw new Error('SDK execution fixture interrupted after real report delivery')
      }
      const accepted = await result(...input)
      const state = run.snapshot(), execution = state.taskExecutions?.[input[0].attemptId]
      if (execution?.request.reportContinuation !== undefined) {
        const decisionId = execution.decisions?.at(-1)?.request.decisionId
        const history = await ctx.sessionPersistence.readFrom(execution.request.sessionId, 0)
        const report = state.operations[execution.request.reportContinuation.operationId]
        const original = report === undefined ? undefined : state.decisions[report.decisionId]?.context
        if (original?.status !== 'prepared') throw new Error('Actual continuation lost its original prepared context')
        await writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, 'sdk-execution-continuation.json'),
          JSON.stringify({ decisionId, report: execution.request.reportContinuation,
            attemptId: execution.request.attemptId, history, originalContext: original.view,
            scope: { teamId: execution.request.teamId, participantId: execution.request.participantId,
              sessionId: execution.request.sessionId } }), { mode: 0o600 })
      }
      return accepted
    }
    return run
  }
}
