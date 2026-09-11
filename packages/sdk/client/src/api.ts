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
   * List durable Teams visible to this runtime.
   * @param params - optional page cursor and limit.
   * @returns the validated result from the runtime.
   */
  async listTeams(params: TeamListParams = {}): Promise<TeamListResult> {
    await this.start()
    return await this.client.listTeams(params)
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
          events.push(validatedSessionEvent(notification.params.event))
        }
      }
      for (let queued = subscription.tryNext(); queued !== undefined; queued = subscription.tryNext()) collect(queued)

      const final = await waitForFinal(client, team, subscription, collect)
      for (let queued = subscription.tryNext(); queued !== undefined; queued = subscription.tryNext()) collect(queued)
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
function validatedSessionEvent(value: unknown): SessionEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new SdkProtocolError(`session.event carried no event envelope: ${JSON.stringify(value)}`)
  }
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
