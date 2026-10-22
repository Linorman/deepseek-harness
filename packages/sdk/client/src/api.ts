import { isCompactionAssessment, isCompactionNoGain } from '@clocky/clocky-compaction/no-gain'
import type { SimulationRawArchiveParams, SimulationRawArchiveResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationRunControlParams, SimulationRunControlResult } from '@clocky/clocky-sdk-protocol'
import type {
  SimulationWorldBranchParams,
  SimulationWorldBranchReadParams,
  SimulationWorldCausalParams,
  SimulationWorldCompareParams,
  SimulationWorldBranchResult,
  SimulationWorldCausalResult,
  SimulationWorldCompareResult,
} from '@clocky/clocky-sdk-protocol'
import type { SimulationBackupExportParams, SimulationBackupExportResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationRetentionPreviewParams, SimulationRetentionExecuteParams, SimulationRetentionReadParams, SimulationRetentionRecordsParams, SimulationRetentionPlan, SimulationRetentionResult, SimulationRetentionRecordsResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationGenerationRequestParams, SimulationGenerationReadParams, SimulationGenerationExecuteParams, SimulationGenerationTransitionParams, SimulationGenerationPersonaDraftParams, SimulationGenerationResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationRebuildIndexParams, SimulationRebuildIndexResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationDraftReadParams, SimulationDraftReadResult, SimulationDraftSaveParams, SimulationDraftSaveResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationWorldManagementFieldsParams, SimulationWorldManagementFieldsResult, SimulationWorldManagementPreviewParams, SimulationWorldManagementPreviewResult, SimulationWorldManagementSubmitParams, SimulationWorldManagementSubmitResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationWorldDomainParams, SimulationWorldDomainResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationWorldCasesParams, SimulationWorldCasesResult, SimulationWorldCaseParams, SimulationWorldCaseResult, SimulationWorldCaseCancelParams, SimulationWorldCaseCancelResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationWorldPreflightParams, SimulationWorldPreflightResult, SimulationWorldCreateParams, SimulationWorldCreateResult,
  SimulationWorldPrepareParams, SimulationWorldPrepareResult, SimulationWorldExportParams, SimulationWorldExportResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationRequestsParams, SimulationRequestsResult, SimulationRetryRequestParams, SimulationRetryRequestResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationPreflightParams, SimulationPreflightResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationOperationRetryParams, SimulationOperationRetryResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationRunStatusesParams, SimulationRunStatusesResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationTasksParams, SimulationTasksResult, SimulationTaskCancelParams, SimulationTaskCancelResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationTaskReviewListParams, SimulationTaskReviewListResult, SimulationTaskReviewResolveParams, SimulationTaskReviewResolveResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationSourceParams, SimulationSourceResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationRecordsParams, SimulationRecordsResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationWatchParams, SimulationWatchResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationControlParams, SimulationControlResult, SimulationManageParams, SimulationManageResult, SimulationManagementParams, SimulationManagementResult, SimulationCheckpointParams, SimulationCheckpointResult, SimulationRestoreParams, SimulationRestoreResult, SimulationIngressParams, SimulationIngressResult, SimulationIngressRequestParams, SimulationIngressRequestResult } from '@clocky/clocky-sdk-protocol'
import type { SimulationCatalogParams, SimulationCatalogResult, SimulationListParams, SimulationListResult, SimulationInspectParams, SimulationInspectResult, SimulationBrowseParams, SimulationBrowseResult, SimulationObjectParams, SimulationObjectResult, SimulationCreateParams, SimulationCreateResult, SimulationPrepareParams, SimulationPrepareResult, SimulationRequestParams, SimulationRequestResult } from '@clocky/clocky-sdk-protocol'
import type { TeamTaskUpdateLookupParams, TeamTaskUpdateLookupResult } from '@clocky/clocky-sdk-protocol'
export type { TeamTaskUpdateLookupParams, TeamTaskUpdateLookupResult } from '@clocky/clocky-sdk-protocol'
import { isSimulationContextViewEvent, isSimulationGenerationEvent } from '@clocky/clocky-session/surface'
import { KNOWN_SESSION_EVENT_TYPES } from '@clocky/clocky-session'
import type { TeamMemberInspectParams, TeamMemberInspectResult } from '@clocky/clocky-sdk-protocol'
import type { TeamTaskInspectParams, TeamTaskInspectResult } from '@clocky/clocky-sdk-protocol'
import type { TeamBrowseParams, TeamBrowseResult } from '@clocky/clocky-sdk-protocol'
import type { TeamMemberSessionResult } from '@clocky/clocky-sdk-protocol'
import type { TeamInboxRespondParams } from '@clocky/clocky-sdk-protocol'
import type { TeamHumanActionResponseResult } from '@clocky/clocky-team'
import type { TeamHumanInboxReadInput, TeamHumanInboxPage, TeamHumanInboxAcknowledgeInput, TeamHumanInboxAcknowledgement } from '@clocky/clocky-team'
/** Team-owned high-level API over a Clocky JSON-RPC runtime. @module @clocky/clocky-sdk-client/api */

import { resolve } from 'node:path'
import type { SessionEvent } from '@clocky/clocky-session'
import type {
  TeamCancelResult,
  TeamResumeParams,
  TeamWaitFinalResult,
  TeamListResult,
  TeamListParams,
  TeamGetResult,
  TeamSelectionResult,
  TeamGoalUpdateParams,
  TeamGoalUpdateResult,
  TeamGoalTransitionParams,
  TeamGoalTransitionResult,
  TeamMemberListResult,
  TeamMemberListParams,
  TeamTaskListResult,
  TeamTaskListParams,
  TeamWorkflowPlanListResult,
  TeamWorkflowPlanListParams,
  TeamChannelReadResult,
  TeamChannelReadParams,
  TeamQuiescenceResult,
  TeamMetricsResult,
  TeamAuditReadParams,
  TeamAuditReadResult,
  TeamArtifactReadResult,
  TeamArtifactListResult,
  TeamArtifactListParams,
  TeamMemberInviteParams,
  TeamMemberInviteResult,
  TeamMemberActivateParams,
  TeamMemberActivateResult,
  TeamMemberRemoveParams,
  TeamMemberRemoveResult,
  TeamMemberInterruptParams,
  TeamMemberInterruptResult,
  TeamChannelOpenParams,
  TeamChannelInvitationParams,
  TeamChannelCatalogResult,
  TeamChannelSummarizeParams,
  TeamChannelSummarizeResult,
  TeamChannelListParams,
  TeamChannelListResult,
  TeamChannelAdmissionResult,
  TeamChannelInvitationAcknowledgeParams,
  TeamChannelInvitationResult,
  TeamChannelOpenResult,
  TeamChannelInputParams,
  TeamChannelAttachmentParams,
  TeamChannelAttachmentResult,
  TeamChannelPostParams,
  TeamChannelPostResult,
  TeamChannelCloseParams,
  TeamChannelCloseResult,
  TeamChannelWatchResult,
  TeamTaskCreateParams,
  TeamTaskCreateResult,
  TeamTaskGetResult,
  TeamTaskUpdateParams,
  TeamTaskUpdateResult,
  TeamTaskCancelParams,
  TeamTaskCancelResult,
  TeamTaskDeleteParams,
  TeamTaskDeleteResult,
  TeamTaskReviewParams,
  TeamTaskReviewResult,
  TeamTaskWatchResult,
} from '@clocky/clocky-sdk-protocol'
import { HarnessClient, isRecord, SdkProtocolError } from './client.ts'
import type { ContentBlock, ClockyOptions, HarnessClientOptions, HarnessNotification, RunResult } from './types.ts'

/** Reusable SDK that owns one Team-capable runtime subprocess. */
export class Clocky implements AsyncDisposable {
  private clientInstance: HarnessClient
  private readonly launch: HarnessClientOptions
  private readonly credential: string
  private readonly cwd: string
  private readonly provider: string
  private readonly model: string
  private readonly maxTokens: number | undefined
  private initialized: Promise<void> | undefined
  private closed = false

  /** @param options - runtime launch spec plus the Team coordinator route. */
  constructor(options: ClockyOptions) {
    this.launch = options.launch
    this.clientInstance = new HarnessClient(options.launch)
    this.credential = options.credential
    this.cwd = resolve(options.cwd ?? options.launch.cwd ?? process.cwd())
    this.provider = options.provider
    this.model = options.model
    this.maxTokens = options.maxTokens
  }

  /** Underlying JSON-RPC client; calling it does not confer Team authority. */
  get client(): HarnessClient {
    return this.clientInstance
  }

  /** Start and initialize the runtime once, replacing a failed nonterminal client. */
  start(): Promise<void> {
    this.initialized ??= (async () => {
      try {
        await this.clientInstance.initialize({
          credential: this.credential,
          cwd: this.cwd,
          provider: this.provider,
          model: this.model,
          ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
        })
      } catch (error) {
        this.initialized = undefined
        await this.clientInstance.close()
        if (!this.closed) this.clientInstance = new HarnessClient(this.launch)
        throw error
      }
    })()
    return this.initialized
  }

  /**
   * Create one Team and admit its initial input through this runtime's creation path.
   * @param input - initial text or direct-v3 human content.
   * @param options - optional durable Team objective.
   * @returns handle for the newly created Team.
   */
  async createTeam(input: string | ContentBlock[], options: TeamCreateOptions = {}): Promise<HarnessTeam> {
    await this.start()
    const contentBlocks = normalizeInput(input)
    const created = await this.client.createTeam({
      objective: resolveObjective(input, contentBlocks, options.objective),
      contentBlocks,
    })
    return new HarnessTeam(this, created.teamId, created.coordinatorSessionId)
  }

  /**
   * Resume one Team through the authenticated connection's human proof.
   * @param params - Team identity and observed cursor selected for resume.
   * @returns the resumed Team handle.
   */
  async resumeTeam(params: TeamResumeParams): Promise<HarnessTeam> {
    await this.start()
    const resumed = await this.client.resumeTeam(params)
    return new HarnessTeam(this, resumed.teamId, resumed.coordinatorSessionId)
  }

  /**
   * Read current scheduling ownership and preconditions without opening or advancing a run.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async getSimulationControl(params: SimulationControlParams): Promise<SimulationControlResult> {
    await this.start()
    return await this.client.getSimulationControl(params)
  }

  /**
   * Persist an original stopping target or explicit clear without starting scheduling.
   * @param params - Complete target and caller-retained command identity; clear explicitly carries null.
   * @returns original durable receipt and current control observation.
   */
  async updateSimulationRunControl(params: SimulationRunControlParams): Promise<SimulationRunControlResult> {
    await this.start()
    return await this.client.updateSimulationRunControl(params)
  }

  /**
   * Submit an original scheduling intent; exact retries retain its result without undoing later intent.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async manageSimulation(params: SimulationManageParams): Promise<SimulationManageResult> {
    await this.start()
    return await this.client.manageSimulation(params)
  }

  /**
   * Query an original scheduling outcome; absence does not establish failure.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async getSimulationManagement(params: SimulationManagementParams): Promise<SimulationManagementResult> {
    await this.start()
    return await this.client.getSimulationManagement(params)
  }

  /**
   * Inspect exact real personnel choices without reservation.
   * @param params - Exact original selection or complete confirmed form.
   * @returns strictly validated original quote or durable receipt; transport loss grants no replacement command.
   */
  async readSimulationWorldManagementFields(params: SimulationWorldManagementFieldsParams): Promise<SimulationWorldManagementFieldsResult> {
    await this.start()
    return await this.client.readSimulationWorldManagementFields(params)
  }

  /**
   * Preview actual personnel impact without inference or reservation.
   * @param params - Exact original selection or complete confirmed form.
   * @returns strictly validated original quote or durable receipt; transport loss grants no replacement command.
   */
  async previewSimulationWorldManagement(params: SimulationWorldManagementPreviewParams): Promise<SimulationWorldManagementPreviewResult> {
    await this.start()
    return await this.client.previewSimulationWorldManagement(params)
  }

  /**
   * Submit or precisely retry the original confirmed personnel command.
   * @param params - Exact original selection or complete confirmed form.
   * @returns strictly validated original quote or durable receipt; transport loss grants no replacement command.
   */
  async submitSimulationWorldManagement(params: SimulationWorldManagementSubmitParams): Promise<SimulationWorldManagementSubmitResult> {
    await this.start()
    return await this.client.submitSimulationWorldManagement(params)
  }

  /**
   * Read one independently authorized World domain window.
   * @param params - Exact bounded domain selector and continuation.
   * @returns original selection with explicit coverage, without opening execution.
   */
  async readSimulationWorldDomain(params: SimulationWorldDomainParams): Promise<SimulationWorldDomainResult> {
    await this.start()
    return await this.client.readSimulationWorldDomain(params)
  }

  /**
   * Use the exact original World case selection without starting scheduling.
   * @param params - Exact owned World selection.
   * @returns strict original result; any disclosed bodies retain their independent permissions.
   */
  async listSimulationWorldCases(params: SimulationWorldCasesParams): Promise<SimulationWorldCasesResult> {
    await this.start()
    return await this.client.listSimulationWorldCases(params)
  }

  /**
   * Use the exact original World case selection without starting scheduling.
   * @param params - Exact owned World selection.
   * @returns strict original result; any disclosed bodies retain their independent permissions.
   */
  async inspectSimulationWorldCase(params: SimulationWorldCaseParams): Promise<SimulationWorldCaseResult> {
    await this.start()
    return await this.client.inspectSimulationWorldCase(params)
  }

  /**
   * Use the exact original World case selection without starting scheduling.
   * @param params - Exact owned World selection.
   * @returns strict original result; any disclosed bodies retain their independent permissions.
   */
  async cancelSimulationWorldCase(params: SimulationWorldCaseCancelParams): Promise<SimulationWorldCaseCancelResult> {
    await this.start()
    return await this.client.cancelSimulationWorldCase(params)
  }

  /**
   * Read canonical run-owned task controls without starting execution.
   * @param params - Exact bounded owned-run observation.
   * @returns canonical task controls without bodies or general Team authority.
   */
  async listSimulationTasks(params: SimulationTasksParams): Promise<SimulationTasksResult> {
    await this.start()
    return await this.client.listSimulationTasks(params)
  }

  /**
   * Cancel the exact original run-owned task with a current revision and attempt fence.
   * @param params - Immutable command identity and cancellation intent; null requires no active lease.
   * @returns durable original receipt; this neither resumes execution nor grants ordinary Team writes.
   */
  async cancelSimulationTask(params: SimulationTaskCancelParams): Promise<SimulationTaskCancelResult> {
    await this.start()
    return await this.client.cancelSimulationTask(params)
  }

  /**
   * Read bounded canonical review targets without task bodies.
   * @param params - Exact run and optional page/revision fence.
   * @returns current scene-authorized review metadata.
   */
  async listSimulationTaskReviews(params: SimulationTaskReviewListParams): Promise<SimulationTaskReviewListResult> {
    await this.start()
    return await this.client.listSimulationTaskReviews(params)
  }

  /**
   * Resolve one exact original administrative review through the installed scene's authority.
   * @param params - Original scene review command and canonical attempt/revision.
   * @returns persistent original receipt.
   */
  async resolveSimulationTaskReview(params: SimulationTaskReviewResolveParams): Promise<SimulationTaskReviewResolveResult> {
    await this.start()
    return await this.client.resolveSimulationTaskReview(params)
  }

  /**
   * Request a full checkpoint; accepted work outlives its waiter and remains paused after completion.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async checkpointSimulation(params: SimulationCheckpointParams): Promise<SimulationCheckpointResult> {
    await this.start()
    return await this.client.checkpointSimulation(params)
  }

  /**
   * Verify checkpoint history and current suffix, then acquire a paused owner without rollback or inference.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async restoreSimulation(params: SimulationRestoreParams): Promise<SimulationRestoreResult> {
    await this.start()
    return await this.client.restoreSimulation(params)
  }

  /**
   * Submit one attributed entity input with its original identity and exact simulated time.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async ingressSimulation(params: SimulationIngressParams): Promise<SimulationIngressResult> {
    await this.start()
    return await this.client.ingressSimulation(params)
  }

  /**
   * Query original input assignment and consumption independently of scheduling.
   * @param params - Actor-free selection; retain the original identity and payload across uncertain outcomes.
   * @returns validated public observation or original durable receipt; private configuration and input text are withheld.
   */
  async getSimulationIngress(params: SimulationIngressRequestParams): Promise<SimulationIngressRequestResult> {
    await this.start()
    return await this.client.getSimulationIngress(params)
  }

  /**
   * Read authorized Simulation metadata without executing models.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns validated bounded public result; private run configuration and knowledge are withheld.
   */
  async simulationCatalog(params: SimulationCatalogParams = {}): Promise<SimulationCatalogResult> {
    await this.start()
    return await this.client.simulationCatalog(params)
  }

  /**
   * Grant a bounded retry allowance for the original unknown intent without publishing or resuming it.
   * @param params - Original command, unknown operation, exact retained attempt count and reason.
   * @returns persistent original grant receipt; explicit scheduling is required to reconcile the target.
   */
  async retrySimulationOperation(params: SimulationOperationRetryParams): Promise<SimulationOperationRetryResult> {
    await this.start()
    return await this.client.retrySimulationOperation(params)
  }

  /**
   * Observe a bounded authorized run batch without taking execution ownership.
   * @param params - Exact bounded authorized run batch.
   * @returns native and scheduling metadata without execution.
   */
  async getSimulationRunStatuses(params: SimulationRunStatusesParams): Promise<SimulationRunStatusesResult> {
    await this.start()
    return await this.client.getSimulationRunStatuses(params)
  }

  /**
   * Read authorized Simulation metadata without executing models.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns validated bounded public result; private run configuration and knowledge are withheld.
   */
  async listSimulations(params: SimulationListParams = {}): Promise<SimulationListResult> {
    await this.start()
    return await this.client.listSimulations(params)
  }

  /**
   * Read authorized Simulation metadata without executing models.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns validated bounded public result; private run configuration and knowledge are withheld.
   */
  async inspectSimulation(params: SimulationInspectParams): Promise<SimulationInspectResult> {
    await this.start()
    return await this.client.inspectSimulation(params)
  }

  /** Explicit original experiment operation; reads never infer or resume scheduling.
   * @param params - Exact original command or source references; retain IDs across uncertain outcomes.
   * @returns Strict public result correlated to its original selection.
   */
  async branchWorld(params: SimulationWorldBranchParams): Promise<SimulationWorldBranchResult> {
    await this.start()
    return await this.client.branchWorld(params)
  }

  /** Explicit original experiment operation; reads never infer or resume scheduling.
   * @param params - Exact original command or source references; retain IDs across uncertain outcomes.
   * @returns Strict public result correlated to its original selection.
   */
  async readWorldBranch(params: SimulationWorldBranchReadParams): Promise<SimulationWorldBranchResult> {
    await this.start()
    return await this.client.readWorldBranch(params)
  }

  /** Explicit original experiment operation; reads never infer or resume scheduling.
   * @param params - Exact original command or source references; retain IDs across uncertain outcomes.
   * @returns Strict public result correlated to its original selection.
   */
  async queryWorldCausal(params: SimulationWorldCausalParams): Promise<SimulationWorldCausalResult> {
    await this.start()
    return await this.client.queryWorldCausal(params)
  }

  /** Explicit original experiment operation; reads never infer or resume scheduling.
   * @param params - Exact original command or source references; retain IDs across uncertain outcomes.
   * @returns Strict public result correlated to its original selection.
   */
  async compareWorlds(params: SimulationWorldCompareParams): Promise<SimulationWorldCompareResult> {
    await this.start()
    return await this.client.compareWorlds(params)
  }

  /** Read the exact completed private backup; rejects changed authority or original selection.
   * @param params - Original run and retention command identity.
   * @returns bounded private bundle bytes without capture, restore or inference.
   */
  async backupExport(params: SimulationBackupExportParams): Promise<SimulationBackupExportResult> {
    await this.start()
    return await this.client.backupExport(params)
  }

  /**
   * Explicit retention preview; preview and read do not pause or infer.
   * @param params - Original selection and payload; preserve its identity across uncertain outcomes.
   * @returns source-bound conservative archive plan; a live or nonquiescent source refuses without pausing.
   */
  async retentionPreview(params: SimulationRetentionPreviewParams): Promise<SimulationRetentionPlan> {
    await this.start()
    return await this.client.retentionPreview(params)
  }

  /**
   * Explicit retention execute; preview and read do not pause or infer.
   * @param params - Original selection and payload; preserve its identity across uncertain outcomes.
   * @returns validated original state; replaced authority or mismatched selection rejects.
   */
  async retentionExecute(params: SimulationRetentionExecuteParams): Promise<SimulationRetentionResult> {
    await this.start()
    return await this.client.retentionExecute(params)
  }

  /**
   * Explicit retention read; preview and read do not pause or infer.
   * @param params - Original selection and payload; preserve its identity across uncertain outcomes.
   * @returns validated original state; replaced authority or mismatched selection rejects.
   */
  async retentionRead(params: SimulationRetentionReadParams): Promise<SimulationRetentionResult> {
    await this.start()
    return await this.client.retentionRead(params)
  }

  /**
   * Explicit retention records; preview and read do not pause or infer.
   * @param params - Original selection and payload; preserve its identity across uncertain outcomes.
   * @returns independently authorized original owner records in ascending sequence order.
   */
  async retentionRecords(params: SimulationRetentionRecordsParams): Promise<SimulationRetentionRecordsResult> {
    await this.start()
    return await this.client.retentionRecords(params)
  }

  /**
   * Explicit generation request; reads never start inference.
   * @param params - Original selection and payload; preserve its identity across uncertain outcomes.
   * @returns validated original state; replaced authority or mismatched selection rejects.
   */
  async generationRequest(params: SimulationGenerationRequestParams): Promise<SimulationGenerationResult> {
    await this.start()
    return await this.client.generationRequest(params)
  }

  /**
   * Explicit generation read; reads never start inference.
   * @param params - Original selection and payload; preserve its identity across uncertain outcomes.
   * @returns the original private job or absent history without any model request.
   */
  async generationRead(params: SimulationGenerationReadParams): Promise<SimulationGenerationResult> {
    await this.start()
    return await this.client.generationRead(params)
  }

  /**
   * Explicit generation execute; reads never start inference.
   * @param params - Original selection and payload; preserve its identity across uncertain outcomes.
   * @returns retained output or explicit unresolved responsibility after the accepted model attempt.
   */
  async generationExecute(params: SimulationGenerationExecuteParams): Promise<SimulationGenerationResult> {
    await this.start()
    return await this.client.generationExecute(params)
  }

  /**
   * Explicit generation transition; reads never start inference.
   * @param params - Original selection and payload; preserve its identity across uncertain outcomes.
   * @returns validated original state; replaced authority or mismatched selection rejects.
   */
  async generationTransition(params: SimulationGenerationTransitionParams): Promise<SimulationGenerationResult> {
    await this.start()
    return await this.client.generationTransition(params)
  }

  /**
   * Explicit generation persona-draft; reads never start inference.
   * @param params - Original selection and payload; preserve its identity across uncertain outcomes.
   * @returns original generation linked to its committed A2 draft revision and body hash.
   */
  async generationPersonaDraft(params: SimulationGenerationPersonaDraftParams): Promise<SimulationGenerationResult> {
    await this.start()
    return await this.client.generationPersonaDraft(params)
  }

  /**
   * Read authorized Simulation metadata without executing models.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns validated bounded public result; private run configuration and knowledge are withheld.
   */
  async rebuildSimulationIndex(params: SimulationRebuildIndexParams): Promise<SimulationRebuildIndexResult> {
    await this.start()
    return await this.client.rebuildSimulationIndex(params)
  }

  /**
   * Read authorized metadata without model calls.
   * @param params - Original selection and payload; preserve its identity across uncertain outcomes.
   * @returns validated original state; replaced authority or mismatched selection rejects.
   */
  async browseSimulation(params: SimulationBrowseParams): Promise<SimulationBrowseResult> {
    await this.start()
    return await this.client.browseSimulation(params)
  }

  /**
   * Inspect one exact retained Team Envelope source without activating execution.
   * @param params - Decision source ordinal and bounded lookup/body continuation.
   * @returns separately authorized text, redacted status or explicit lookup continuation.
   */
  async inspectSimulationSource(params: SimulationSourceParams): Promise<SimulationSourceResult> {
    await this.start()
    return await this.client.inspectSimulationSource(params)
  }

  /**
   * Preserve original registered-source bytes with an explicit whole-record body grant.
   * @param params - Run and bounded continuation; no caller path, provider or version override.
   * @returns raw-only archive parts; no inference, writable restoration or Native validation occurs.
   */
  async archiveRawSimulation(params: SimulationRawArchiveParams): Promise<SimulationRawArchiveResult> {
    await this.start()
    return await this.client.archiveRawSimulation(params)
  }

  /**
   * Read retained Simulation journal metadata or separately authorized original JSON text.
   * @param params - Exact run/filter/mode with optional revision and continuation.
   * @returns validated bounded policy-tagged page; does not open execution or infer historical events.
   */
  async readSimulationRecords(params: SimulationRecordsParams): Promise<SimulationRecordsResult> {
    await this.start()
    return await this.client.readSimulationRecords(params)
  }

  /**
   * Observe bounded read invalidation without opening or driving a run.
   * @param params - Exact run and optional prior cursor/real wait. Zero is an immediate probe.
   * @returns metadata-only hint; callers decide whether to repeat the wait or refresh pages.
   */
  async watchSimulation(params: SimulationWatchParams): Promise<SimulationWatchResult> {
    await this.start()
    return await this.client.watchSimulation(params)
  }

  /**
   * Read authorized Simulation metadata without executing models.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns validated bounded public result; private run configuration and knowledge are withheld.
   */
  async inspectSimulationObject(params: SimulationObjectParams): Promise<SimulationObjectResult> {
    await this.start()
    return await this.client.inspectSimulationObject(params)
  }

  /**
   * Validate creation semantics without allocating a run, Team, actor or command.
   * @param params - Allowlisted template draft and optional run allowances.
   * @returns current resolved configuration or safe field issues; no resources are reserved.
   */
  async preflightSimulation(params: SimulationPreflightParams): Promise<SimulationPreflightResult> {
    await this.start()
    return await this.client.preflightSimulation(params)
  }

  /** Access private immutable authoring revisions without model execution.
   * @param params - Original private authoring request.
   * @returns saved revision or explicit conflict; mismatched original identities reject.
   */
  async readSimulationDraft(params: SimulationDraftReadParams): Promise<SimulationDraftReadResult> {
    await this.start()
    return await this.client.readSimulationDraft(params)
  }
  /** Access private immutable authoring revisions without model execution.
   * @param params - Original private authoring request.
   * @returns saved revision or explicit conflict; mismatched original identities reject.
   */
  async saveSimulationDraft(params: SimulationDraftSaveParams): Promise<SimulationDraftSaveResult> {
    await this.start()
    return await this.client.saveSimulationDraft(params)
  }

  /**
   * Preflight a portable scenario without creating a run or starting its models.
   * @param params - Strict World definition.
   * @returns installed preview or bounded field diagnostics.
   */
  async preflightSimulationWorld(params: SimulationWorldPreflightParams): Promise<SimulationWorldPreflightResult> {
    await this.start()
    return await this.client.preflightSimulationWorld(params)
  }

  /**
   * Submit the original portable World creation intent, retaining it across uncertain replies.
   * @param params - Immutable command, definition and preflight identity.
   * @returns durable original creation receipt; the run remains paused.
   */
  async createSimulationWorld(params: SimulationWorldCreateParams): Promise<SimulationWorldCreateResult> {
    await this.start()
    return await this.client.createSimulationWorld(params)
  }

  /**
   * Prepare the original accepted World without scheduling inference.
   * @param params - Run and original preparation command.
   * @returns receipt correlated to the original command and run.
   */
  async prepareSimulationWorld(params: SimulationWorldPrepareParams): Promise<SimulationWorldPrepareResult> {
    await this.start()
    return await this.client.prepareSimulationWorld(params)
  }

  /**
   * Export the authorized original portable definition, preserving private run history.
   * @param params - Original World run selection.
   * @returns matching creation definition; this is not a run backup.
   */
  async exportSimulationWorldDefinition(params: SimulationWorldExportParams): Promise<SimulationWorldExportResult> {
    await this.start()
    return await this.client.exportSimulationWorldDefinition(params)
  }

  /**
   * Allocate and prepare a run with the retained original command identity.
   * @param params - Exact original allowlisted creation payload.
   * @returns immutable creation receipt without starting inference.
   */
  async createSimulation(params: SimulationCreateParams): Promise<SimulationCreateResult> {
    await this.start()
    return await this.client.createSimulation(params)
  }

  /**
   * Submit or query an original durable preparation request without starting inference.
   * @param params - Actor-free selection; command IDs must be retained across uncertain outcomes.
   * @returns original durable receipt; absence does not establish failure.
   */
  async prepareSimulation(params: SimulationPrepareParams): Promise<SimulationPrepareResult> {
    await this.start()
    return await this.client.prepareSimulation(params)
  }

  /**
   * Discover original administrative receipts for one authorized run without exposing command inputs.
   * @param params - Exact run and optional revision-pinned bounded page.
   * @returns metadata-only page; reads neither schedule inference nor retry any command.
   */
  async listSimulationRequests(params: SimulationRequestsParams): Promise<SimulationRequestsResult> {
    await this.start()
    return await this.client.listSimulationRequests(params)
  }

  /**
   * Retry only the server-retained original command, preserving its input and identity.
   * @param params - Exact run and original command discovered from receipt metadata.
   * @returns original accepted or terminal receipt; never retries automatically.
   */
  async retrySimulationRequest(params: SimulationRetryRequestParams): Promise<SimulationRetryRequestResult> {
    await this.start()
    return await this.client.retrySimulationRequest(params)
  }

  /**
   * Query the exact original durable administrative command; absence does not establish failure.
   * @param params - Original retained command identity.
   * @returns known original request or non-authoritative absence without scheduling work.
   */
  async getSimulationRequest(params: SimulationRequestParams): Promise<SimulationRequestResult> {
    await this.start()
    return await this.client.getSimulationRequest(params)
  }

  /**
   * List durable Teams visible to this runtime.
   * @param params - optional page cursor and limit.
   * @returns the validated result from the runtime.
   */
  async listTeams(params: TeamListParams = {}): Promise<TeamListResult> {
    await this.start()
    return await this.client.listTeams(params)
  }

  /** Resolve one member's published Session without activating it.
   * @param teamId - owning Team.
   * @param participantId - retained Team member.
   * @returns validated published binding.
   */
  async getTeamMemberSession(teamId: string, participantId: string): Promise<TeamMemberSessionResult> {
    await this.start()
    return await this.client.getTeamMemberSession({ teamId, participantId })
  }

  /** Read current task fields or one revision-pinned history page without private artifact references.
   * @param params - Exact Team/task, section, optional revision and history continuation.
   * @returns the validated bounded task inspection.
   */
  async inspectTeamTask(params: TeamTaskInspectParams): Promise<TeamTaskInspectResult> {
    await this.start()
    return await this.client.inspectTeamTask(params)
  }

  /** Read bounded collection summaries.
   * @param params - Collection selection.
   * @returns the matching page.
   */
  async browseTeam(params: TeamBrowseParams): Promise<TeamBrowseResult> {
    await this.start()
    return await this.client.browseTeam(params)
  }

  /** Read one workflow's bounded task/dependency window.
   * @param params - Exact workflow and revision/page selection.
   * @returns current workflow inspection.
   */
  async inspectWorkflowPlan(params: import('@clocky/clocky-sdk-protocol').TeamWorkflowInspectParams):
  Promise<import('@clocky/clocky-team').TeamWorkflowInspection> {
    await this.start()
    return await this.client.inspectWorkflowPlan(params)
  }

  /** Read the latest durable human action without loading its Team history.
   * @param teamId - Owning Team.
   * @param actionId - Exact action identity.
   * @returns current action snapshot.
   */
  async readTeamAction(teamId: string, actionId: string): Promise<import('@clocky/clocky-team').TeamHumanActionSnapshot> {
    await this.start()
    return await this.client.readTeamAction({ teamId, actionId })
  }

  /** Read exact member metadata and a capability window.
   * @param params - member selection and optional continuation.
   * @returns validated bounded detail.
   */
  async inspectTeamMember(params: TeamMemberInspectParams): Promise<TeamMemberInspectResult> {
    await this.start()
    return await this.client.inspectTeamMember(params)
  }

  /** Read bounded Team selection data without activating an Agent.
   * @param teamId - Team identity to inspect.
   * @param options - Request exact scalar metadata when it fits the selection byte allowance.
   * @returns validated selection projection.
   */
  async getTeamSelection(teamId: string, options: { readonly includeMetadata?: boolean | undefined } = {}): Promise<TeamSelectionResult> {
    await this.start()
    return await this.client.getTeamSelection({ teamId, ...options })
  }

  /**
   * Read one complete durable Team state.
   * @param teamId - Team identity selected for this operation.
   * @returns the validated result from the runtime.
   */
  async getTeam(teamId: string): Promise<TeamGetResult> {
    await this.start()
    return await this.client.getTeam({ teamId })
  }

  /**
   * List durable participant projections for one Team.
   * @param teamId - Team identity selected for this operation.
   * @param options - optional page cursor and limit.
   * @returns the validated result from the runtime.
   */
  async listTeamMembers(
    teamId: string,
    options: Omit<TeamMemberListParams, 'teamId'> = {},
  ): Promise<TeamMemberListResult> {
    await this.start()
    return await this.client.listTeamMembers({ teamId, ...options })
  }

  /**
   * List durable task projections for one Team.
   * @param teamId - Team identity selected for this operation.
   * @param options - optional page cursor and limit.
   * @returns the validated result from the runtime.
   */
  async listTeamTasks(
    teamId: string,
    options: Omit<TeamTaskListParams, 'teamId'> = {},
  ): Promise<TeamTaskListResult> {
    await this.start()
    return await this.client.listTeamTasks({ teamId, ...options })
  }

  /**
   * List bounded durable workflow plan projections for one Team.
   * @param teamId - Team identity selected for this operation.
   * @param options - optional page cursor and limit.
   * @returns the validated result from the runtime.
   */
  async listWorkflowPlans(
    teamId: string,
    options: Omit<TeamWorkflowPlanListParams, 'teamId'> = {},
  ): Promise<TeamWorkflowPlanListResult> {
    await this.start()
    return await this.client.listWorkflowPlans({ teamId, ...options })
  }

  /**
   * List bounded visible artifact references retained by one Team.
   * @param teamId - Team identity selected for this operation.
   * @param options - optional page cursor and limit.
   * @returns the validated result from the runtime.
   */
  async listTeamArtifacts(
    teamId: string,
    options: Omit<TeamArtifactListParams, 'teamId'> = {},
  ): Promise<TeamArtifactListResult> {
    await this.start()
    return await this.client.listTeamArtifacts({ teamId, ...options })
  }

  /**
   * Read durable quiescence diagnostics for one Team.
   * @param teamId - Team identity selected for this operation.
   * @returns the validated result from the runtime.
   */
  async teamQuiescence(teamId: string): Promise<TeamQuiescenceResult> {
    await this.start()
    return await this.client.getTeamQuiescence({ teamId })
  }

  /**
   * Answer a durable human action.
   * @param input - Exact request fence and typed answer.
   * @returns Durable acceptance or unavailability.
   */
  async inboxRespond(input: TeamInboxRespondParams): Promise<TeamHumanActionResponseResult> {
    await this.start()
    return await this.client.inboxRespond(input)
  }

  /**
   * Read the authenticated principal inbox.
   * @param input - Actor-free inbox selection.
   * @returns Validated durable result.
   */
  async inboxRead(input: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage> {
    await this.start()
    return await this.client.inboxRead(input)
  }

  /**
   * Watch the authenticated principal inbox.
   * @param input - Actor-free inbox selection.
   * @returns Validated durable result.
   */
  async inboxWatch(input: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage> {
    await this.start()
    return await this.client.inboxWatch(input)
  }

  /**
   * Acknowledge the authenticated principal inbox display cursor.
   * @param input - Actor-free inbox selection.
   * @returns Validated durable result.
   */
  async inboxAcknowledge(input: TeamHumanInboxAcknowledgeInput): Promise<TeamHumanInboxAcknowledgement> {
    await this.start()
    return await this.client.inboxAcknowledge(input)
  }

  /**
   * Read process-local Team operational counters for dashboards and alerts.
   * @returns the validated result from the runtime.
   */
  async teamMetrics(): Promise<TeamMetricsResult> {
    await this.start()
    return await this.client.getTeamMetrics()
  }

  /**
   * Read one bounded Team or channel audit page.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async teamAudit(params: TeamAuditReadParams): Promise<TeamAuditReadResult> {
    await this.start()
    return await this.client.readTeamAudit(params)
  }

  /**
   * Create one Team, stream its coordinator transcript, and await its explicit final result.
   * @param input - initial text or direct-v3 human content.
   * @param options - optional durable Team objective and notification observer.
   * @returns completed Team result and transcript projection.
   */
  async run(input: string | ContentBlock[], options: RunOptions = {}): Promise<RunResult> {
    await this.start()
    const client = this.client
    const contentBlocks = normalizeInput(input)
    const subscription = client.subscribe()
    const events: SessionEvent[] = []
    const notifications: HarnessNotification[] = []
    try {
      const created = await client.createTeam({
        objective: resolveObjective(input, contentBlocks, options.objective),
        contentBlocks,
      })
      const team = new HarnessTeam(this, created.teamId, created.coordinatorSessionId)
      const collect = (notification: HarnessNotification): void => {
        if (!belongsToCoordinator(notification, team.coordinatorSessionId)) return
        notifications.push(notification)
        options.onNotification?.(notification)
        if (notification.method === 'session.event' && notification.params.sessionId === team.coordinatorSessionId) {
          const event = validatedSessionEvent(notification.params.event)
          if (event !== undefined) events.push(event)
        }
      }
      for (let queued = subscription.tryNext(); queued !== undefined; queued = subscription.tryNext()) collect(queued)

      const final = await waitForFinal(client, team, subscription, collect)
      return {
        teamId: team.id,
        finalResponse: final.text,
        final,
        events,
        notifications,
      }
    } finally {
      subscription.close()
    }
  }

  /** Shut down and reap the owned runtime subprocess. */
  close(): Promise<void> {
    this.closed = true
    return this.clientInstance.close()
  }

  /** `await using` support. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }
}

/** Handle for an SDK-tracked TeamRun and its authenticated Team management operations. */
export class HarnessTeam {
  /**
   * @param harness - runtime that owns this handle.
   * @param id - Hub-minted Team identity, not an authority proof.
   * @param coordinatorSessionId - coordinator transcript root.
   */
  constructor(
    readonly harness: Clocky,
    readonly id: string,
    readonly coordinatorSessionId: string,
  ) {}

  /**
   * Await this SDK-tracked runtime-owned TeamRun's explicit final result; untracked Team ids reject.
   * @returns settled final Team result.
   */
  async waitForFinal(): Promise<TeamWaitFinalResult> {
    await this.harness.start()
    return await this.harness.client.waitForTeamFinal({ teamId: this.id })
  }

  /**
   * Resume this Team through the authenticated connection's human proof.
   * @param params - observed Team cursor selected for resume.
   * @returns resolution after the coordinator is reattached.
   */
  async resume(params: Omit<TeamResumeParams, 'teamId'>): Promise<void> {
    await this.harness.start()
    const resumed = await this.harness.client.resumeTeam({ ...params, teamId: this.id })
    if (resumed.teamId !== this.id) throw new SdkProtocolError(`team/resume returned another Team '${resumed.teamId}'`)
  }

  /**
   * Read the latest durable Team state without activating a new Agent.
   * @returns the validated result from the runtime.
   */
  async state(): Promise<TeamGetResult> {
    await this.harness.start()
    return await this.harness.client.getTeam({ teamId: this.id })
  }

  /**
   * Update this Team objective through the authenticated connection's human proof.
   * @param params - validated goal fields and observed revision.
   * @returns the resulting durable Team state.
   */
  async updateGoal(params: Omit<TeamGoalUpdateParams, 'teamId'>): Promise<TeamGoalUpdateResult> {
    await this.harness.start()
    return await this.harness.client.updateTeamGoal({ ...params, teamId: this.id })
  }

  /**
   * Transition this Team objective through the authenticated connection's human proof.
   * @param params - validated target phase, optional blocker, and observed revision.
   * @returns the resulting durable Team state.
   */
  async transitionGoal(params: Omit<TeamGoalTransitionParams, 'teamId'>): Promise<TeamGoalTransitionResult> {
    await this.harness.start()
    return await this.harness.client.transitionTeamGoal({ ...params, teamId: this.id })
  }

  /**
   * Read the durable participant roster for this Team.
   * @param options - optional page cursor and limit.
   * @returns the validated result from the runtime.
   */
  async members(options: Omit<TeamMemberListParams, 'teamId'> = {}): Promise<TeamMemberListResult> {
    await this.harness.start()
    return await this.harness.client.listTeamMembers({ ...options, teamId: this.id })
  }

  /**
   * Read durable tasks for this Team.
   * @param options - optional page cursor and limit.
   * @returns the validated result from the runtime.
   */
  async tasks(options: Omit<TeamTaskListParams, 'teamId'> = {}): Promise<TeamTaskListResult> {
    await this.harness.start()
    return await this.harness.client.listTeamTasks({ ...options, teamId: this.id })
  }

  /**
   * Read bounded durable workflow plans for this Team.
   * @param options - optional page cursor and limit.
   * @returns the validated result from the runtime.
   */
  async workflowPlans(options: Omit<TeamWorkflowPlanListParams, 'teamId'> = {}): Promise<TeamWorkflowPlanListResult> {
    await this.harness.start()
    return await this.harness.client.listWorkflowPlans({ ...options, teamId: this.id })
  }

  /**
   * Read bounded visible artifact references retained by this Team.
   * @param options - optional page cursor and limit.
   * @returns the validated result from the runtime.
   */
  async artifacts(options: Omit<TeamArtifactListParams, 'teamId'> = {}): Promise<TeamArtifactListResult> {
    await this.harness.start()
    return await this.harness.client.listTeamArtifacts({ ...options, teamId: this.id })
  }

  /**
   * Read durable quiescence diagnostics for this Team.
   * @returns the validated result from the runtime.
   */
  async quiescence(): Promise<TeamQuiescenceResult> {
    await this.harness.start()
    return await this.harness.client.getTeamQuiescence({ teamId: this.id })
  }

  /**
   * Read process-local Team operational counters for this runtime.
   * @returns the validated result from the runtime.
   */
  async metrics(): Promise<TeamMetricsResult> {
    await this.harness.start()
    return await this.harness.client.getTeamMetrics()
  }

  /**
   * Read a bounded Team or channel audit page.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async audit(params: Omit<TeamAuditReadParams, 'teamId'> = {}): Promise<TeamAuditReadResult> {
    await this.harness.start()
    return await this.harness.client.readTeamAudit({ ...params, teamId: this.id })
  }

  /**
   * Read one visible Team artifact by its durable reference id.
   * @param artifactId - artifact id retained by a Team task result.
   * @returns verified bytes and the exact durable reference.
   */
  async readArtifact(artifactId: string): Promise<TeamArtifactReadResult> {
    await this.harness.start()
    return await this.harness.client.readTeamArtifact({ teamId: this.id, artifactId })
  }

  /**
   * Invite one non-human Team participant through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the invited participant projection.
   */
  async inviteMember(params: Omit<TeamMemberInviteParams, 'teamId'>): Promise<TeamMemberInviteResult> {
    await this.harness.start()
    return await this.harness.client.inviteTeamMember({ ...params, teamId: this.id })
  }

  /**
   * Activate one invited Team participant through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the active participant projection.
   */
  async activateMember(params: Omit<TeamMemberActivateParams, 'teamId'>): Promise<TeamMemberActivateResult> {
    await this.harness.start()
    return await this.harness.client.activateTeamMember({ ...params, teamId: this.id })
  }

  /**
   * Remove one active Team participant through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the departed participant projection.
   */
  async removeMember(params: Omit<TeamMemberRemoveParams, 'teamId'>): Promise<TeamMemberRemoveResult> {
    await this.harness.start()
    return await this.harness.client.removeTeamMember({ ...params, teamId: this.id })
  }

  /**
   * Request a soft interrupt for one Team participant through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the durable interrupt projection.
   */
  async interruptMember(params: Omit<TeamMemberInterruptParams, 'teamId'>): Promise<TeamMemberInterruptResult> {
    await this.harness.start()
    return await this.harness.client.interruptTeamMember({ ...params, teamId: this.id })
  }

  /** Discover installed channel capabilities.
   * @returns Protocols, view policies and optional summary bounds.
   */
  async channelCatalog(): Promise<TeamChannelCatalogResult> {
    await this.harness.start()
    return await this.harness.client.getTeamChannelCatalog()
  }

  /** Summarize an explicit channel range under this connection's human authority.
   * @param params - Selected source range, cursor and retry key.
   * @returns The committed summary and its provenance.
   */
  async summarizeChannel(params: TeamChannelSummarizeParams): Promise<TeamChannelSummarizeResult> {
    await this.harness.start()
    return await this.harness.client.summarizeTeamChannel(params)
  }

  /**
   * List this Team's attached channels by insertion index.
   * @param params - Optional continuation cursor and page size.
   * @returns A bounded page without channel message history.
   */
  async channels(params: Omit<TeamChannelListParams, 'teamId'> = {}): Promise<TeamChannelListResult> {
    await this.harness.start()
    return await this.harness.client.listTeamChannels({ ...params, teamId: this.id })
  }

  /**
   * Read a channel's admission metadata through this Team's membership.
   * @param channelId - Channel owned by this Team.
   * @returns Current manifest and admission state, without accepting an invitation.
   */
  async admission(channelId: string): Promise<TeamChannelAdmissionResult> {
    await this.harness.start()
    return await this.harness.client.getTeamChannelAdmission({ teamId: this.id, channelId })
  }

  /**
   * Discover only the authenticated human's invitation without recording consent.
   * @param params - channel identity, with no caller-selected actor.
   * @returns the complete manifest and the caller's invitation.
   */
  async invitation(params: TeamChannelInvitationParams): Promise<TeamChannelInvitationResult> {
    await this.harness.start()
    return await this.harness.client.getTeamChannelInvitation(params)
  }

  /**
   * Explicitly accept the discovered protocol and exact manifest.
   * @param params - invitation revision, manifest fingerprint and stable retry key.
   * @returns the durable acknowledgement and current channel state.
   */
  async acknowledgeInvitation(params: TeamChannelInvitationAcknowledgeParams): Promise<TeamChannelInvitationResult> {
    await this.harness.start()
    return await this.harness.client.acknowledgeTeamChannelInvitation(params)
  }

  /**
   * Open one generic Team channel through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the opened channel projection.
   */
  async openChannel(params: Omit<TeamChannelOpenParams, 'teamId'>): Promise<TeamChannelOpenResult> {
    await this.harness.start()
    return await this.harness.client.openTeamChannel({ ...params, teamId: this.id })
  }

  /**
   * Post ordered direct-channel media or one consult/discussion text block.
   * @param params - Actor-free media input and post fences.
   * @returns The durable accepted Envelope.
   */
  async inputChannel(params: TeamChannelInputParams): Promise<TeamChannelPostResult> {
    await this.harness.start()
    return await this.harness.client.inputTeamChannel(params)
  }

  /**
   * Read an image from an exact Envelope belonging to this Team.
   * @param params - Channel, Envelope, and referenced attachment identities.
   * @returns Verified image metadata and bytes.
   */
  async channelAttachment(params: Omit<TeamChannelAttachmentParams, 'teamId'>): Promise<TeamChannelAttachmentResult> {
    await this.harness.start()
    return await this.harness.client.readTeamChannelAttachment({ ...params, teamId: this.id })
  }

  /**
   * Post one actor-free payload through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the Hub-stamped Envelope projection.
   */
  async postChannel(params: TeamChannelPostParams): Promise<TeamChannelPostResult> {
    await this.harness.start()
    return await this.harness.client.postTeamChannel(params)
  }

  /**
   * Read a bounded WAL suffix for one Team channel.
   * @param channelId - Team channel identity to read or watch.
   * @param afterCursor - last observed channel or task cursor, when available.
   * @param limit - maximum number of WAL records to return.
   * @returns the validated result from the runtime.
   */
  async channel(channelId: string, afterCursor?: number, limit?: number): Promise<TeamChannelReadResult> {
    await this.harness.start()
    const params: TeamChannelReadParams = {
      channelId,
      ...afterCursor === undefined ? {} : { afterCursor },
      ...limit === undefined ? {} : { limit },
    }
    return await this.harness.client.readTeamChannel(params)
  }

  /**
   * Close one generic Team channel through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the terminal channel projection.
   */
  async closeChannel(params: TeamChannelCloseParams): Promise<TeamChannelCloseResult> {
    await this.harness.start()
    return await this.harness.client.closeTeamChannel(params)
  }

  /**
   * Wait for one channel cursor to advance or close.
   * @param channelId - Team channel identity to read or watch.
   * @param afterCursor - last observed channel or task cursor, when available.
   * @returns the validated result from the runtime.
   */
  async watchChannel(channelId: string, afterCursor?: number): Promise<TeamChannelWatchResult> {
    await this.harness.start()
    return await this.harness.client.watchTeamChannel({ channelId, ...afterCursor === undefined ? {} : { afterCursor } })
  }

  /**
   * Create one Team task through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async createTask(params: Omit<TeamTaskCreateParams, 'teamId'>): Promise<TeamTaskCreateResult> {
    await this.harness.start()
    return await this.harness.client.createTeamTask({ ...params, teamId: this.id })
  }

  /**
   * Read one durable task.
   * @param taskId - validated operation parameters.
   * @returns the validated result from the runtime.
   */
  async task(taskId: string): Promise<TeamTaskGetResult> {
    await this.harness.start()
    return await this.harness.client.getTeamTask({ teamId: this.id, taskId })
  }

  /** Read original update admission for this Team without executing another command.
   * @param params - Task and original command identity.
   * @returns immutable original acceptance or absence at this read.
   */
  async updateResult(params: Omit<TeamTaskUpdateLookupParams, 'teamId'>): Promise<TeamTaskUpdateLookupResult> {
    await this.harness.start()
    return await this.harness.client.getTeamTaskUpdateResult({ ...params, teamId: this.id })
  }

  /**
   * Update one Team task through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async updateTask(params: Omit<TeamTaskUpdateParams, 'teamId'>): Promise<TeamTaskUpdateResult> {
    await this.harness.start()
    return await this.harness.client.updateTeamTask({ ...params, teamId: this.id })
  }

  /**
   * Cancel one Team task through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async cancelTask(params: Omit<TeamTaskCancelParams, 'teamId'>): Promise<TeamTaskCancelResult> {
    await this.harness.start()
    return await this.harness.client.cancelTeamTask({ ...params, teamId: this.id })
  }

  /**
   * Delete one Team task through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async deleteTask(params: Omit<TeamTaskDeleteParams, 'teamId'>): Promise<TeamTaskDeleteResult> {
    await this.harness.start()
    return await this.harness.client.deleteTeamTask({ ...params, teamId: this.id })
  }

  /**
   * Resolve one Team task review through the authenticated connection's human proof.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async reviewTask(params: Omit<TeamTaskReviewParams, 'teamId'>): Promise<TeamTaskReviewResult> {
    await this.harness.start()
    return await this.harness.client.reviewTeamTask({ ...params, teamId: this.id })
  }

  /**
   * Wait for one task graph cursor to advance or close.
   * @param afterCursor - last observed channel or task cursor, when available.
   * @returns the validated result from the runtime.
   */
  async watchTasks(afterCursor?: number): Promise<TeamTaskWatchResult> {
    await this.harness.start()
    return await this.harness.client.watchTeamTasks({
      ...afterCursor === undefined ? {} : { afterCursor },
      teamId: this.id,
    })
  }

  /**
   * Cancel this SDK-tracked runtime-owned TeamRun and return its terminal durable phase; untracked Team ids reject.
   * @returns the terminal durable Team phase.
   */
  async cancel(): Promise<TeamCancelResult> {
    await this.harness.start()
    return await this.harness.client.cancelTeam({ teamId: this.id })
  }

  /**
   * Archive this terminal Team through the authenticated connection's human proof.
   * @returns resolution after the durable archive marker is committed.
   */
  async archive(): Promise<void> {
    await this.harness.start()
    const current = await this.harness.client.getTeam({ teamId: this.id })
    await this.harness.client.archiveTeam({ teamId: this.id, expectedCursor: current.state.team.cursor })
  }
}

/** Optional explicit objective for Team creation. */
export interface TeamCreateOptions {
  /** User objective retained by the Team journal; text input supplies this by default. */
  objective?: string
}

/** Per-run Team objective and related notification observer. */
export interface RunOptions extends TeamCreateOptions {
  /** Observer for coordinator notifications in wire order. */
  onNotification?: (notification: HarnessNotification) => void
}

/** Normalize a string into one text block; explicit content remains ordered. */
export function normalizeInput(input: string | ContentBlock[]): ContentBlock[] {
  return typeof input === 'string' ? [{ type: 'text', text: input }] : input
}

/** Resolve the durable Team objective before the request crosses the wire boundary. */
export function resolveObjective(input: string | ContentBlock[], contentBlocks: ContentBlock[], explicit: string | undefined): string {
  if (explicit !== undefined) return requiredObjective(explicit)
  if (typeof input === 'string') return requiredObjective(input)
  const text = contentBlocks
    .filter((block): block is ContentBlock & { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
  return requiredObjective(text, 'objective is required when Team input contains no text')
}

/** Await Team completion while continuing to drain streamed coordinator notifications. */
async function waitForFinal(
  client: HarnessClient,
  team: HarnessTeam,
  subscription: ReturnType<HarnessClient['subscribe']>,
  collect: (notification: HarnessNotification) => void,
): Promise<TeamWaitFinalResult> {
  const completion = client.waitForTeamFinal({ teamId: team.id })
  while (true) {
    for (let queued = subscription.tryNext(); queued !== undefined; queued = subscription.tryNext()) collect(queued)
    const next = subscription.next()
    const result = await Promise.race([
      completion.then(final => ({ kind: 'final' as const, final })),
      next.then(notification => ({ kind: 'notification' as const, notification })),
    ])
    if (result.kind === 'final') return result.final
    collect(result.notification)
  }
}

/** Determine whether one runtime notification belongs to the coordinator transcript. */
function belongsToCoordinator(notification: HarnessNotification, coordinatorSessionId: string): boolean {
  return notification.params.sessionId === coordinatorSessionId
}

/** Validate the one event payload exposed as a typed coordinator transcript. */
function validatedSessionEvent(value: unknown): SessionEvent | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new SdkProtocolError(`session.event carried no event envelope: ${JSON.stringify(value)}`)
  }
  if (Object.hasOwn(value, 'ignorable') && value.ignorable !== true) throw new SdkProtocolError('session.event carried an invalid ignorable marker')
  if (!KNOWN_SESSION_EVENT_TYPES.has(value.type)) {
    if (value.ignorable === true) return undefined
    throw new SdkProtocolError('session.event carried an unknown required event')
  }
  if (value.type === 'compaction/assessment' || value.type === 'compaction/end' && isRecord(value.data)
    && Object.hasOwn(value.data, 'noGain')) validateCompactionEvidenceEvent(value)
  if (value.type === 'simulation/context-view' && !isSimulationContextViewEvent(value)) {
    throw new SdkProtocolError('simulation/context-view event is malformed')
  }
  if ((value.type === 'simulation/generation-input' || value.type === 'simulation/generation-output')
    && !isSimulationGenerationEvent(value)) throw new SdkProtocolError('Simulation generation event is malformed')
  if (value.type === 'team/channel-view') validateTeamChannelViewEvent(value)
  if (value.type === 'assistant/message') {
    const message = isRecord(value.data) ? value.data.message : undefined
    const content = isRecord(message) ? message.content : undefined
    if (!Array.isArray(content) || !content.every(block => isRecord(block) && typeof block.type === 'string')) {
      throw new SdkProtocolError(`assistant/message event carried malformed content: ${JSON.stringify(value)}`)
    }
  }
  return value as unknown as SessionEvent
}

/** Validate the required durable model-view event at the SDK wire boundary. */
function validateTeamChannelViewEvent(value: Record<string, unknown>): void {
  const data = value.data
  const surfaceOp = value.surfaceOp
  if (!Number.isSafeInteger(value.seq) || (value.seq as number) < 0
    || !Number.isSafeInteger(value.time) || (value.time as number) < 0
    || Object.hasOwn(value, 'ignorable') || surfaceOp !== 'append'
    || !isRecord(data)) {
    throw new SdkProtocolError('team/channel-view event has an invalid envelope')
  }
  const keys = [
    'teamId', 'channelId', 'adapter', 'viewPolicy', 'triggeringEnvelopeId',
    'sourceEnvelopeIds', 'delivery', 'content', 'causationId', 'taskId', 'review',
  ]
  if (Object.keys(data).some(key => !keys.includes(key))
    || !nonEmptyString(data.teamId)
    || !nonEmptyString(data.channelId)
    || !nonEmptyString(data.triggeringEnvelopeId)
    || !validImplementation(data.adapter)
    || !validImplementation(data.viewPolicy)
    || (data.delivery !== 'context' && data.delivery !== 'turn' && data.delivery !== 'steer')
    || !validSourceEnvelopeIds(data.sourceEnvelopeIds, data.triggeringEnvelopeId)
    || !validContent(data.content)) {
    throw new SdkProtocolError('team/channel-view event has malformed data')
  }
  for (const field of ['causationId', 'taskId']) {
    if (Object.hasOwn(data, field) && !nonEmptyString(data[field])) {
      throw new SdkProtocolError('team/channel-view event has malformed optional provenance')
    }
  }
  if (Object.hasOwn(data, 'review') && !validReviewFence(data.review)) {
    throw new SdkProtocolError('team/channel-view event has malformed review provenance')
  }
}

/** Validate one versioned implementation identity. */
function validImplementation(value: unknown): boolean {
  return isRecord(value)
    && Object.keys(value).length === 2
    && nonEmptyString(value.type)
    && Number.isSafeInteger(value.version)
    && (value.version as number) > 0
}

/** Validate ordered, duplicate-free view provenance ending at the trigger. */
function validSourceEnvelopeIds(value: unknown, triggeringEnvelopeId: unknown): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.every(nonEmptyString)
    && new Set(value).size === value.length
    && value.at(-1) === triggeringEnvelopeId
}

/** Validate merge-extensible model content without discarding block fields. */
function validContent(value: unknown): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.every(block => isRecord(block) && nonEmptyString(block.type))
}

/** Validate the optional review fence carried by a review view. */
function validReviewFence(value: unknown): boolean {
  if (!isRecord(value)) return false
  const allowed = ['attemptId', 'reviewRevision', 'reviewerId', 'initiatorId']
  return Object.keys(value).every(key => allowed.includes(key))
    && nonEmptyString(value.attemptId)
    && Number.isSafeInteger(value.reviewRevision)
    && (value.reviewRevision as number) > 0
    && nonEmptyString(value.reviewerId)
    && (!Object.hasOwn(value, 'initiatorId') || nonEmptyString(value.initiatorId))
}

/** Recognize one lossless non-empty string carried across the SDK boundary. */
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Require a non-whitespace objective before a Team exists. */
function requiredObjective(value: string, message = 'objective must be non-empty'): string {
  const objective = value.trim()
  if (objective.length === 0) throw new TypeError(message)
  return objective
}

/** Validate newly typed diagnostic evidence before exposing it in a coordinator transcript. */
function validateCompactionEvidenceEvent(event: Record<string, unknown>): void {
  const data = event.data
  const validEnvelope = Number.isSafeInteger(event.seq) && (event.seq as number) >= 0
    && Number.isSafeInteger(event.time) && (event.time as number) >= 0
    && Object.keys(event).length === 4 && !Object.hasOwn(event, 'ignorable') && !Object.hasOwn(event, 'surfaceOp')
  let validData = false
  if (isRecord(data)) {
    if (event.type === 'compaction/assessment') validData = isCompactionAssessment(data)
    else validData = Object.keys(data).every(key => ['compactionId', 'sourceCommandId', 'turn', 'error', 'noGain'].includes(key))
      && typeof data.compactionId === 'string' && data.compactionId.length > 0
      && (!Object.hasOwn(data, 'sourceCommandId') || typeof data.sourceCommandId === 'string' && data.sourceCommandId.length > 0)
      && (data.turn === null || Number.isSafeInteger(data.turn) && (data.turn as number) >= 0)
      && typeof data.error === 'string' && isCompactionNoGain(data.noGain)
  }
  if (!validEnvelope || !validData) throw new SdkProtocolError('Compaction evidence event is malformed')
}
