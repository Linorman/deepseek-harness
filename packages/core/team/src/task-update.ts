/** Retry-safe task-detail updates separate original admission from the current task projection. */
import type { Branded } from '@clocky/clocky-brand'
import type { TeamId, TeamTaskId, TeamTaskCreator, TeamHumanTaskCreator, TeamTaskDetailsUpdateInput, TeamTaskSnapshot } from './types.ts'
import { TeamError } from './error.ts'

/** Caller-owned identity retained across uncertain task-update responses. */
export type TeamTaskUpdateCommandId = Branded<'TeamTaskUpdateCommandId'>

/** Durable input and provenance committed atomically with the corresponding task revision. */
export interface TeamTaskUpdateCommandReceipt {
  readonly kind: 'applied'
  readonly input: TeamTaskDetailsUpdateInput
  readonly creator: TeamTaskCreator | TeamHumanTaskCreator
  readonly appliedRevision: number
  readonly appliedAt: number
}

/** Closed semantic refusals recorded only after current write authority and policy pass. */
export type TeamTaskUpdateRejectionReason = 'stale-revision' | 'workflow-owned' | 'active-execution' | 'invalid-edit'

/** Private terminal refusal binds the original input and author without changing the task. */
export interface TeamTaskUpdateCommandRejection {
  readonly kind: 'rejected'
  readonly input: TeamTaskDetailsUpdateInput
  readonly creator: TeamTaskCreator | TeamHumanTaskCreator
  readonly observedRevision: number
  readonly rejectedAt: number
  readonly reason: TeamTaskUpdateRejectionReason
  readonly message: string
}

/** Every admitted command identity retains exactly one terminal outcome. */
export type TeamTaskUpdateCommand = TeamTaskUpdateCommandReceipt | TeamTaskUpdateCommandRejection

/** Public original refusal omits submitted instructions, private diagnostics and authority material. */
export interface TeamTaskUpdateRejection extends TeamTaskUpdateLookupInput {
  readonly expectedRevision: number
  readonly observedRevision: number
  readonly rejectedAt: number
  readonly reason: TeamTaskUpdateRejectionReason
}

/** Original acceptance metadata contains neither the submitted instructions nor authority material. */
export interface TeamTaskUpdateReceipt {
  readonly teamId: TeamId
  readonly taskId: TeamTaskId
  readonly commandId: TeamTaskUpdateCommandId
  readonly expectedRevision: number
  readonly appliedRevision: number
  readonly appliedAt: number
}

/** A retry returns the original admission plus the current task, which may have advanced. */
export interface TeamTaskDetailsUpdateResult {
  readonly receipt: TeamTaskUpdateReceipt
  readonly task: TeamTaskSnapshot
}

/** Exact lookup of one retained command under an authorized Team read. */
export interface TeamTaskUpdateLookupInput {
  readonly teamId: TeamId
  readonly taskId: TeamTaskId
  readonly commandId: TeamTaskUpdateCommandId
}

/** Absence is an observation, not proof that a delayed original request cannot still commit. */
export type TeamTaskUpdateLookup = { readonly kind: 'applied'; readonly receipt: TeamTaskUpdateReceipt }
  | { readonly kind: 'rejected'; readonly rejection: TeamTaskUpdateRejection }
  | { readonly kind: 'not-found'; readonly teamId: TeamId; readonly taskId: TeamTaskId; readonly commandId: TeamTaskUpdateCommandId }

/**
 * Resolve normalized editable fields before identity comparison and durable admission.
 * @param input - Parsed caller identity, revision and optional replacements.
 * @returns the exact semantic request retained by the provider.
 */
export function normalizeTaskDetailsUpdate(input: TeamTaskDetailsUpdateInput): TeamTaskDetailsUpdateInput {
  return { ...input, ...input.subject === undefined ? {} : { subject: input.subject.trim() },
    ...input.description === undefined ? {} : { description: input.description.trim() },
    ...input.blockedBy === undefined ? {} : { blockedBy: [...input.blockedBy] } }
}

/**
 * Expose only immutable admission metadata from a durable private receipt.
 * @param receipt - Provider-validated command input and attribution.
 * @returns the public original-operation result.
 */
export function taskUpdateReceipt(receipt: TeamTaskUpdateCommandReceipt): TeamTaskUpdateReceipt {
  const { input, appliedRevision, appliedAt } = receipt
  return { teamId: input.teamId, taskId: input.taskId, commandId: input.commandId,
    expectedRevision: input.expectedRevision, appliedRevision, appliedAt }
}

/**
 * Expose original refusal metadata without its private input or diagnostic.
 * @param command - Validated terminal refusal retained by the provider.
 * @returns immutable original refusal identity and reason.
 */
export function taskUpdateRejection(command: TeamTaskUpdateCommandRejection): TeamTaskUpdateRejection {
  const { input, observedRevision, rejectedAt, reason } = command
  return { teamId: input.teamId, taskId: input.taskId, commandId: input.commandId,
    expectedRevision: input.expectedRevision, observedRevision, rejectedAt, reason }
}

/** A provider emits this refusal only after retaining the terminal command outcome. */
export class TeamTaskUpdateRejectedError extends TeamError {
  /** Original refusal metadata excludes submitted fields and authority material. */
  readonly rejection: TeamTaskUpdateRejection

  /** @param command - Authoritative original refusal already committed by the provider. */
  constructor(command: TeamTaskUpdateCommandRejection) {
    const codes = { 'stale-revision': 'TEAM_TASK_STALE_REVISION', 'workflow-owned': 'TEAM_WORKFLOW_PLAN_INVALID',
      'active-execution': 'TEAM_INVALID_ARGUMENT', 'invalid-edit': 'TEAM_TASK_GRAPH_INVALID' } as const
    super(command.message, codes[command.reason])
    this.rejection = Object.freeze(taskUpdateRejection(command))
  }
}
