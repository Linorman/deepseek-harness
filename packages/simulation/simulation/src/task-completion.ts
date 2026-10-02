/** Scenario completion policies and durable task-result intent. @module @clocky/clocky-simulation/task-completion */
import { z } from 'zod'
import { taskAttemptIdSchema, taskAttemptOutcomeSchema } from '@clocky/clocky-team'
import type { SimulationPolicyRef } from './deterministic.ts'
import { simulationPolicyRefSchema } from './deterministic.ts'
import { simulationOperationIdSchema } from './business.ts'
import type { SimulationTaskExecution } from './task-execution.ts'
import type { SimulationSnapshot } from './types.ts'

/** Terminal facts available to a trusted task completion policy. */
export type SimulationTaskPolicyOutcome = Extract<import('@clocky/clocky-team').TaskAttemptOutcome,
  { readonly kind: 'completed' | 'failed' | 'cancelled' }>

/** Actor-owned terminal outcomes; scheduler release/expiry remains outside completion policy. */
export const simulationTaskOutcomeSchema = taskAttemptOutcomeSchema.refine(value =>
  value.kind === 'completed' || value.kind === 'failed' || value.kind === 'cancelled', 'Task completion requires an actor-owned terminal outcome') as z.ZodType<SimulationTaskPolicyOutcome>
/** Policy-selected immutable terminal intent; world-operation evidence is checked independently. */
export const simulationTaskResultRequestSchema = z.strictObject({
  attemptId: taskAttemptIdSchema, policy: simulationPolicyRefSchema,
  operations: z.array(simulationOperationIdSchema).refine(values => new Set(values).size === values.length,
    'Task result requires distinct operation evidence'), outcome: simulationTaskOutcomeSchema,
}).refine(value => value.outcome.kind !== 'completed' || value.operations.length > 0,
  'Task completion requires applied world-operation evidence')
/** Accepted result intent for one exact original attempt. */
export type SimulationTaskResultRequest = z.infer<typeof simulationTaskResultRequestSchema>
/** Source evaluation can wait without inventing a terminal task outcome. */
export type SimulationTaskCompletionAssessment = { readonly status: 'waiting'
  readonly reason: string }
  | { readonly status: 'result'
    readonly operations: readonly import('./business-types.ts').SimulationOperationId[]
    readonly outcome: SimulationTaskPolicyOutcome }
/** Trusted bounded, synchronous, deterministic scenario rule over a detached frozen run view; no IO or mutations. */
export interface SimulationTaskCompletionPolicy extends SimulationPolicyRef {
  /**
   * Check the scenario's actual accepted effects and return waiting or a terminal intent.
   * @param state - Frozen authoritative world and source facts.
   * @param execution - Original task attempt and its ordered decision associations.
   * @returns scenario assessment; Native independently rejects missing, foreign or unapplied effect evidence.
   */
  evaluate(this: void, state: Readonly<SimulationSnapshot>,
    execution: Readonly<SimulationTaskExecution>): SimulationTaskCompletionAssessment
}
/** Policy/result is retained before target settlement; it is not a Team completion receipt. */
export interface SimulationTaskResult {
  readonly request: SimulationTaskResultRequest
  readonly sequence: number
}
