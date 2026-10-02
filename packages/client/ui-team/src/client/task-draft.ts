/** Task-form input and command retry identity; current task facts remain in runtime. */
import type { ParticipantId, TeamManagementCommand, TeamTaskId, TeamTaskRecord, TeamTaskDetailState } from '@clocky/clocky-client-runtime/client'

type TaskAttemptId = NonNullable<TeamTaskDetailState['latest']['value']>['id']

type UpdateInput = Extract<TeamManagementCommand, { operation: 'taskUpdate' }>['input']

type CreateInput = Extract<TeamManagementCommand, { operation: 'taskCreate' }>['input']

/** Task form identity; integration selects its exact source task. */
export type TeamTaskDialogTarget = { readonly kind: 'taskCreate' }
  | { readonly kind: 'taskUpdate' | 'taskReview' | 'taskIntegrate'; readonly taskId: TeamTaskId }

/** Editable values retain raw text, including incomplete numeric and scope inputs. */
export interface TaskFormFields {
  readonly subject: string
  readonly description: string
  readonly blockedBy: readonly TeamTaskId[]
  readonly workspaceMode: CreateInput['workspaceMode']
  readonly priority: string
  readonly maxAttempts: string
  readonly capabilities: string
  readonly readScopes: string
  readonly writeScopes: string
  readonly reviewer: ParticipantId | undefined
  readonly decision: 'accepted' | 'rework'
  readonly reason: string
  readonly maxTokens: string
  readonly maxTurns: string
  readonly placementMembers: readonly ParticipantId[]
  readonly placementRoles: string
  readonly placementProviders: string
  readonly placementPresets: string
  readonly placementModels: string
  readonly provider: string
  readonly integrationTarget: string
  readonly expectedTarget: string
  readonly integrationMode: 'proposal' | 'integrate'
  readonly sourceAttemptId: TaskAttemptId | undefined
  readonly dependencySearch: string
}

/** Initial editable fields support discard detection without retaining the authoritative task object. */
export interface TaskFormDraft {
  readonly fields: TaskFormFields
  readonly initial: TaskFormFields
  readonly baselineRevision: number | undefined
  readonly updateRetry?: { readonly input: UpdateInput } | undefined
  /** Resolved submitted input prevents a fresh ID for the same retained edit and revision. */
  readonly previousUpdateInput?: UpdateInput | undefined
  readonly createRetry?: { readonly fingerprint: string; readonly key: CreateInput['idempotencyKey'] } | undefined
}

/**
 * Seed a form after its exact runtime inspection is available.
 * @param target - Requested operation and source identity.
 * @param task - Current inspected editable fields; absent for new tasks.
 * @param integrationSubject - Locale-owned initial integration title.
 * @param sourceAttemptId - Inspected completed attempt offered as the initial integration source.
 * @returns unsent fields and their original revision; no grants or execution history is retained.
 */
export function createTaskFormDraft(target: TeamTaskDialogTarget, task: TeamTaskRecord | undefined,
  integrationSubject: string, sourceAttemptId?: TaskAttemptId): TaskFormDraft {
  const fields: TaskFormFields = {
    subject: target.kind === 'taskIntegrate' ? integrationSubject : task?.subject ?? '',
    description: target.kind === 'taskIntegrate' ? '' : task?.description ?? '',
    blockedBy: target.kind === 'taskIntegrate' && task !== undefined ? [task.id] : task?.blockedBy ?? [],
    workspaceMode: 'shared', priority: '0', maxAttempts: '1', capabilities: '', readScopes: '', writeScopes: '',
    reviewer: undefined, decision: 'accepted', reason: '', maxTokens: '', maxTurns: '', placementMembers: [],
    placementRoles: '', placementProviders: '', placementPresets: '', placementModels: '', provider: '',
    integrationTarget: '', expectedTarget: '', integrationMode: 'proposal', sourceAttemptId, dependencySearch: '',
  }
  return { fields, initial: fields, baselineRevision: task?.revision }
}

/**
 * Select an operation's independent input slot within a Team.
 * @param target - New-task, editing, review or integration identity.
 * @returns an unambiguous JSON key containing no form body.
 */
export function taskDraftKey(target: TeamTaskDialogTarget): string {
  return JSON.stringify([target.kind, 'taskId' in target ? target.taskId : null])
}

/**
 * Determine whether disposal would lose user input or an uncertain command identity.
 * @param draft - Retained form, if one was edited.
 * @returns true when input differs from its initial fields or a command has an outstanding retry identity.
 */
export function hasTaskDraftInput(draft: TaskFormDraft | undefined): boolean {
  return draft !== undefined && (draft.createRetry !== undefined || draft.updateRetry !== undefined
    || draft.previousUpdateInput !== undefined
    || JSON.stringify(draft.fields) !== JSON.stringify(draft.initial))
}

/**
 * Compare retained editable input with the resolved original request before minting another ID.
 * @param draft - User-entered fields, reviewed revision and previously submitted input.
 * @returns whether a fresh submission would repeat exactly the same edit and revision.
 */
export function isPreviousTaskUpdateUnchanged(draft: TaskFormDraft): boolean {
  const input = draft.previousUpdateInput
  return input !== undefined && input.expectedRevision === draft.baselineRevision
    && input.subject === draft.fields.subject.trim() && input.description === draft.fields.description.trim()
    && JSON.stringify(input.blockedBy) === JSON.stringify(draft.fields.blockedBy)
}
