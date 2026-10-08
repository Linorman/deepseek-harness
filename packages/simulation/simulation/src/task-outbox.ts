import { teamTaskCreateFields } from '@clocky/clocky-team/schema'
/** Accepted participant-task creation and its durable target receipt. @module @clocky/clocky-simulation/task-outbox */
import { z } from 'zod'
import { teamIdSchema, teamTaskIdSchema } from '@clocky/clocky-team'
import type { Branded } from '@clocky/clocky-brand'
import type { SimulationEntityBinding } from './writer-types.ts'
import type { SimulationEntityId } from './entity-types.ts'
import type { SimulationRunId } from './types.ts'
import type { SimulationDecisionId, SimulationOperationId } from './business-types.ts'

/** Task fields explicitly selected before decision acceptance; task execution is always Participant-owned. */
export const simulationTaskSpecSchema = z.object(teamTaskCreateFields).pick({
  subject: true, description: true, blockedBy: true, requiredCapabilities: true, priority: true,
  readScopes: true, writeScopes: true, workspaceMode: true, reviewPolicy: true, budget: true, maxAttempts: true,
}).strict()
/** Explicit accepted task definition. */
export type SimulationTaskSpec = z.infer<typeof simulationTaskSpecSchema>
/** Task identity returned by the owning Team, never a proof of task completion. */
export const simulationTaskReceiptSchema = z.strictObject({
  operationId: z.string().min(1).transform(value => value as Branded<'SimulationOperationId'>), fingerprint: z.string().min(1), teamId: teamIdSchema, taskId: teamTaskIdSchema,
})
/** Durable target-side creation receipt. */
export type SimulationTaskReceipt = z.infer<typeof simulationTaskReceiptSchema>
/** Frozen task creation input derived from one accepted operation. */
export interface SimulationOutboundTask {
  readonly runId: SimulationRunId
  readonly decisionId: SimulationDecisionId
  readonly operationId: SimulationOperationId
  readonly fingerprint: string
  readonly entityId: SimulationEntityId
  readonly sender: SimulationEntityBinding
  readonly task: SimulationTaskSpec
  readonly publishAllowed: boolean
}
/** Definitive target outcome; thrown errors retain uncertainty. */
export type SimulationTaskOutcome =
  | { readonly status: 'applied'; readonly taskReceipt: SimulationTaskReceipt }
  | { readonly status: 'rejected' | 'blocked-authority'; readonly code: string }
/** Task transport must deduplicate accepted operation identity at the Team target. */
export interface SimulationTaskTransport {
  /**
   * Create once, or reconcile an existing task when publication is no longer allowed.
   * @param task - Exact accepted task fields and source identity.
   * @returns target receipt or definitive rejection.
   */
  createTask(task: SimulationOutboundTask): Promise<SimulationTaskOutcome>
}
