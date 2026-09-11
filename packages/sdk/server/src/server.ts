import { admitEncodedImages } from '@clocky/clocky-attachment'
import { parseDirectChannelV4MessagePayload } from '@clocky/clocky-team-channel-direct'
import type {} from '@clocky/clocky-team-channel-summary'
import { channelSummarySelectionInputSchema, channelSummaryHumanProofInput, teamChannelListInputSchema } from '@clocky/clocky-team'
import { teamHumanActionResponseInputSchema } from '@clocky/clocky-team'
import { teamHumanInboxReadInputSchema, teamHumanInboxAcknowledgeInputSchema } from '@clocky/clocky-team'
import { channelGetRequestSchema, channelInvitationAcknowledgeInputSchema } from '@clocky/clocky-team'
import { resolvePrincipalChannelText, getPrincipalChannelInvitation, acknowledgePrincipalChannelInvitation, createPrincipalChannelAdmission } from '@clocky/clocky-team-channel-admission/principal'
/**
 * JSON-RPC methods and notifications for out-of-process harness SDKs.
 * The surrounding context owns plugins, persistence, and configured adapters.
 *
 * @module @clocky/clocky-sdk-jsonrpc-server/server
 */

import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { Context } from '@clocky/cordis'
import { resolve } from 'node:path'
import type { Agent, AgentHandle } from '@clocky/clocky-agent'
import type { ContentBlock } from '@clocky/clocky-llm'
import { ProductPrincipalError } from '@clocky/clocky-product-principal'
import type {
  AuthenticatedProductCall,
  AuthenticatedProductPrincipalLease,
  ProductPrincipalId,
} from '@clocky/clocky-product-principal'
import { SessionId } from '@clocky/clocky-session'
import type { SessionPersistence } from '@clocky/clocky-session-persistence'
import { parseDirectChannelV3MessagePayload } from '@clocky/clocky-team-channel-direct'
import type { DirectChannelHumanContentBlock } from '@clocky/clocky-team-channel-direct'
import { FixedBindingTeamAgentLinkDelivery } from '@clocky/clocky-team-agent-client'
import type {} from '@clocky/clocky-team-link'
import { createCapabilityWebSocketTeamLinkProvider } from '@clocky/clocky-team-link-websocket'
import type { TeamRunHandle } from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-team-run'
import {
  TeamError,
  activationBindingSnapshotSchema,
  channelIdSchema,
  teamArchiveInputSchema,
  channelCloseInputSchema,
  channelOpenInputSchema,
  channelPostIdempotencyKeySchema,
  envelopeIdSchema,
  jsonObjectSchema,
  participantIdSchema,
  participantInterruptRequestInputSchema,
  participantInviteInputSchema,
  participantPhaseTransitionInputSchema,
  teamResumeInputSchema,
  teamGoalPhaseTransitionInputSchema,
  teamGoalUpdateInputSchema,
  teamIdSchema,
  teamTaskCancelInputSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamTaskCreateInputSchema,
  teamTaskDeleteInputSchema,
  teamTaskDetailsUpdateInputSchema,
  teamTaskReviewResolveInputSchema,
  teamTaskIdSchema,
} from '@clocky/clocky-team'
import { TeamArtifactError } from '@clocky/clocky-team-artifact'
import type {} from '@clocky/clocky-team-artifact'
import type {
  ActivationBindingSnapshot,
  ChannelEnvelopePostInput,
  ChannelCloseInput,
  ChannelOpenInput,
  ParticipantInterruptRequestInput,
  ParticipantInviteInput,
  ParticipantPhaseTransitionInput,
  TeamHumanActorProofInput,
  TeamHumanActorProof,
  TeamId,
  TeamArchiveInput,
  TeamResumeInput,
  TeamGoalPhaseTransitionInput,
  TeamGoalUpdateInput,
  TeamTaskCancelInput,
  TeamTaskCreateInput,
  TeamTaskDeleteInput,
  TeamTaskDetailsUpdateInput,
  TeamTaskReviewResolveInput,
} from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-human-actor'
import type {
  ActivationDisposeParams,
  ActivationDisposeResult,
  ActivationInterruptParams,
  ActivationInterruptResult,
  ActivationLinkEnrollParams,
  ActivationLinkEnrollResult,
  ActivationOpenParams,
  ActivationOpenResult,
  ActivationStatusParams,
  ActivationStatusResult,
  InitializeParams,
  InitializeResult,
  JsonRpcTransportPeer,
  SdkActivationSeed,
  SdkActivationState,
  SdkActivationStatus,
  SdkActivationTarget,
  SessionEventNotification,
  TeamCancelParams,
  TeamCancelResult,
  TeamArchiveParams,
  TeamArchiveResult,
  TeamCreateParams,
  TeamCreateResult,
  TeamResumeParams,
  TeamResumeResult,
  TeamWaitFinalParams,
  TeamWaitFinalResult,
  TeamListParams,
  TeamListResult,
  TeamGetParams,
  TeamGetResult,
  TeamGoalUpdateParams,
  TeamGoalUpdateResult,
  TeamGoalTransitionParams,
  TeamGoalTransitionResult,
  TeamQuiescenceParams,
  TeamQuiescenceResult,
  TeamMetricsParams,
  TeamMetricsResult,
  TeamAuditReadParams,
  TeamAuditReadResult,
  TeamArtifactReadParams,
  TeamArtifactReadResult,
  TeamArtifactListParams,
  TeamArtifactListResult,
  TeamMemberListParams,
  TeamMemberListResult,
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
  TeamChannelCatalogParams,
  TeamChannelCatalogResult,
  TeamChannelSummarizeParams,
  TeamChannelSummarizeResult,
  TeamChannelListParams,
  TeamChannelListResult,
  TeamChannelAdmissionParams,
  TeamChannelAdmissionResult,
  TeamChannelInvitationAcknowledgeParams,
  TeamChannelInvitationResult,
  TeamChannelOpenResult,
  TeamChannelInputParams,
  TeamChannelAttachmentParams,
  TeamChannelAttachmentResult,
  TeamChannelPostParams,
  TeamChannelPostResult,
  TeamChannelReadParams,
  TeamChannelReadResult,
  TeamChannelCloseParams,
  TeamChannelCloseResult,
  TeamChannelWatchParams,
  TeamChannelWatchResult,
  TeamTaskCreateParams,
  TeamTaskCreateResult,
  TeamTaskGetParams,
  TeamTaskGetResult,
  TeamTaskListParams,
  TeamTaskListResult,
  TeamWorkflowPlanListParams,
  TeamWorkflowPlanListResult,
  TeamTaskUpdateParams,
  TeamTaskUpdateResult,
  TeamTaskCancelParams,
  TeamTaskCancelResult,
  TeamTaskDeleteParams,
  TeamTaskDeleteResult,
  TeamTaskReviewParams,
  TeamTaskReviewResult,
  TeamTaskWatchParams,
  TeamTaskWatchResult,
} from '@clocky/clocky-sdk-protocol'
import {
  activationDisposeParamsSchema,
  activationInterruptParamsSchema,
  activationLinkEnrollParamsSchema,
  activationOpenParamsSchema,
  activationStatusParamsSchema,
  initializeParamsSchema,
  JsonRpcRequestError,
  shutdownParamsSchema,
  teamArchiveParamsSchema,
  teamCancelParamsSchema,
  teamCreateParamsSchema,
  teamWaitFinalParamsSchema,
  teamResumeParamsSchema,
  teamListParamsSchema,
  teamGetParamsSchema,
  teamGoalUpdateParamsSchema,
  teamGoalTransitionParamsSchema,
  teamQuiescenceParamsSchema,
  teamMetricsParamsSchema,
  teamAuditReadParamsSchema,
  teamArtifactReadParamsSchema,
  teamArtifactListParamsSchema,
  teamMemberListParamsSchema,
  teamMemberInviteParamsSchema,
  teamMemberActivateParamsSchema,
  teamMemberRemoveParamsSchema,
  teamMemberInterruptParamsSchema,
  teamChannelOpenParamsSchema,
  teamChannelInvitationParamsSchema,
  teamChannelCatalogParamsSchema,
  teamChannelSummarizeParamsSchema,
  teamChannelListParamsSchema,
  teamChannelAdmissionParamsSchema,
  teamChannelInvitationAcknowledgeParamsSchema,
  teamChannelInputParamsSchema,
  teamChannelAttachmentParamsSchema,
  teamChannelPostParamsSchema,
  teamChannelReadParamsSchema,
  teamChannelCloseParamsSchema,
  teamChannelWatchParamsSchema,
  teamTaskCreateParamsSchema,
  teamTaskGetParamsSchema,
  teamTaskListParamsSchema,
  teamWorkflowPlanListParamsSchema,
  teamTaskUpdateParamsSchema,
  teamTaskCancelParamsSchema,
  teamTaskDeleteParamsSchema,
  teamTaskReviewParamsSchema,
  teamTaskWatchParamsSchema,
} from '@clocky/clocky-sdk-protocol'
import type { ZodType } from 'zod'

/** Maximum verified artifact bytes returned by one SDK request. */
const MAX_TEAM_ARTIFACT_READ_BYTES = 8 * 1024 * 1024

interface ProductTeamRecord {
  readonly run: TeamRunHandle
  /** Stable principal that created this current-run record. */
  readonly owner: ProductPrincipalId
  /** Current run state used only by server-owned wait and cancel operations. */
  readonly state: 'active' | 'terminal'
}

/** One child-owned fixed Link delivery plus its ephemeral provider registration. */
interface ActivationLinkDelivery {
  readonly binding: ActivationBindingSnapshot
  readonly enrollment: LinkEnrollmentFingerprint
  readonly delivery: FixedBindingTeamAgentLinkDelivery
  readonly unregister: () => void
}

/** Opaque credential comparison material retained without its plaintext value. */
interface LinkEnrollmentFingerprint {
  readonly provider: string
  readonly endpoint: string
  readonly capabilityHash: string
}

/** One exact remote Agent lifetime reserved by an activation target. */
interface ActivationRecord {
  /** Immutable wire-owned Team/Participant/Session/epoch identity. */
  readonly target: SdkActivationTarget
  /** Immutable initial Session construction mode. */
  readonly seed: SdkActivationSeed
  /** Published Agent factory handle after the opening transaction succeeds. */
  handle: AgentHandle | undefined
  /** Current lifecycle state owned by this server. */
  status: SdkActivationStatus
  /** Per-epoch sequence stamped onto every observed state. */
  statusSequence: number
  /** Shared opening operation, if the server has not finished publication. */
  opening: Promise<SdkActivationState> | undefined
  /** Shared terminal release operation, if disposal has begun. */
  disposal: Promise<SdkActivationState> | undefined
  /** Child-owned remote Link delivery after post-bind enrollment. */
  linkDelivery: ActivationLinkDelivery | undefined
}

/** Stable application error labels retained in structured JSON-RPC data. */
type SdkActivationErrorCode =
  | 'SDK_ACTIVATION_NOT_INITIALIZED'
  | 'SDK_ACTIVATION_NOT_FOUND'
  | 'SDK_ACTIVATION_TARGET_MISMATCH'
  | 'SDK_ACTIVATION_SEED_MISMATCH'
  | 'SDK_ACTIVATION_SESSION_CONFLICT'
  | 'SDK_ACTIVATION_PARTICIPANT_CONFLICT'
  | 'SDK_ACTIVATION_NOT_LIVE'
  | 'SDK_ACTIVATION_PROVENANCE_MISMATCH'
  | 'SDK_ACTIVATION_PERSISTENCE_REQUIRED'
  | 'SDK_ACTIVATION_ROUTE_LOCKED'
  | 'SDK_ACTIVATION_LINK_UNAVAILABLE'
  | 'SDK_ACTIVATION_LINK_MISMATCH'

/** Structured lifecycle rejection that survives JSON-RPC transport unchanged. */
class SdkActivationError extends JsonRpcRequestError {
  /** @param message - wire-visible rejection detail. @param code - stable application classification. */
  constructor(message: string, code: SdkActivationErrorCode) {
    super(-32_001, message, { code })
    this.name = 'SdkActivationError'
  }
}

/** Stable application classifications for Team-request rejections. */
type SdkTeamErrorCode =
  | 'SDK_TEAM_NOT_FOUND'
  | 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE'
  | 'SDK_TEAM_ARTIFACT_NOT_FOUND'
  | 'SDK_TEAM_ARTIFACT_UNAVAILABLE'

/** Structured rejection for unavailable Team ownership or authenticated authority. */
class SdkTeamError extends JsonRpcRequestError {
  constructor(message: string, code: SdkTeamErrorCode = 'SDK_TEAM_NOT_FOUND') {
    super(-32_002, message, { code })
    this.name = 'SdkTeamError'
  }
}

/** Product-authentication failures normalized for the SDK transport without credential material. */
class SdkProductAuthenticationError extends JsonRpcRequestError {
  /** @param code - stable product-authentication classification. */
  constructor(readonly productCode: 'PRODUCT_AUTH_REQUIRED' | 'PRODUCT_AUTH_INVALID') {
    super(
      -32_003,
      productCode === 'PRODUCT_AUTH_REQUIRED' ? 'Product authentication is required' : 'Product authentication is invalid',
      { code: productCode },
    )
    this.name = 'SdkProductAuthenticationError'
  }
}

/**
 * SDK server over one booted harness context and transport peer. Construction
 * subscribes to session and agent lifecycle events until shutdown.
 * Its initialized route cannot change while a remote activation is resident.
 */
export class HarnessSdkJsonRpcServer {
  private cwd = process.cwd()
  private provider: string | undefined
  private model: string | undefined
  private maxTokens: number | undefined
  private readonly productTeams = new Map<string, ProductTeamRecord>()
  /** Product creation transactions that shutdown must settle before it snapshots active Team ownership. */
  private readonly pendingProductTeamCreations = new Set<Promise<TeamCreateResult>>()
  /** All accepted activation epochs, including terminal offline tombstones. */
  private readonly activations = new Map<string, ActivationRecord>()
  /** One current resident epoch per Session; terminal epochs leave this table. */
  private readonly activationSessions = new Map<string, ActivationRecord>()
  /** Current resident epoch by opaque Team then opaque Participant, preserving NUL values. */
  private readonly activationParticipants = new Map<string, Map<string, ActivationRecord>>()
  private readonly disposers: (() => void)[] = []
  /** Current connection-scoped product-authentication lease; never exposes a credential. */
  private connectionLease: AuthenticatedProductPrincipalLease | undefined
  /** Serializes replacement authentication so one connection never leaks an abandoned lease. */
  private initializationTail: Promise<void> = Promise.resolve()
  private shutdownTask: Promise<Record<string, never>> | undefined
  private shuttingDown = false

  constructor(
    private readonly ctx: Context,
    private readonly transport: JsonRpcTransportPeer,
    private readonly productPrincipalProvider = 'local',
  ) {
    if (productPrincipalProvider.length === 0 || productPrincipalProvider.trim() !== productPrincipalProvider) {
      throw new Error('SDK product principal provider must be non-empty without surrounding whitespace')
    }
    this.disposers.push(ctx.on('session/event', (session, event) => {
      const payload: SessionEventNotification = { sessionId: String(session.id), event }
      this.transport.notify('session.event', payload)
    }))
    this.disposers.push(ctx.on('agent/status', ({ agent, status }) => {
      this.transport.notify('session.status', { sessionId: String(agent.session.id), status })
      const record = this.activationForAgent(agent)
      if (record !== undefined && record.status !== 'stopping' && record.status !== 'offline') {
        this.transitionActivation(record, status)
      }
    }))
    this.disposers.push(ctx.on('agent/disposed', ({ agent }) => {
      const record = this.activationForAgent(agent)
      if (record === undefined) return
      this.transitionActivation(record, 'offline')
      void this.closeLinkDelivery(record).catch(() => undefined)
    }))
    this.disposers.push(ctx.on('team/changed', (event) => {
      this.transport.notify('team.event', { event })
    }))
    this.disposers.push(ctx.on('channel/changed', (event) => {
      this.transport.notify('channel.event', { event })
    }))
  }

  /**
   * Configure the SDK route. The adapter must already be owned by the
   * surrounding composition; this server never mounts a provider during the
   * handshake. A resident activation pins the selected route.
   * @param params - SDK handshake parameters.
   * @returns server identity for the handshake.
   */
  initialize(params: InitializeParams): Promise<InitializeResult> {
    const operation = this.initializationTail.then(async () => await this.initializeConnection(params))
    this.initializationTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  /** Authenticate and retain one connection lease before the route becomes usable. */
  private async initializeConnection(params: InitializeParams): Promise<InitializeResult> {
    const principals = this.ctx.get('productPrincipals')
    if (principals === undefined) throw new SdkProductAuthenticationError('PRODUCT_AUTH_REQUIRED')
    let nextLease: AuthenticatedProductPrincipalLease
    try {
      nextLease = await principals.authenticate({
        provider: this.productPrincipalProvider,
        credential: params.credential,
      })
    } catch (error: unknown) {
      throw productAuthenticationError(error)
    }
    if (params.maxTokens !== undefined
      && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0)) {
      await nextLease.revoke()
      throw new TypeError('initialize maxTokens must be a positive safe integer')
    }
    const cwd = resolve(params.cwd)
    if (this.hasResidentActivation() && (this.cwd !== cwd
      || this.provider !== params.provider
      || this.model !== params.model
      || this.maxTokens !== params.maxTokens)) {
      await nextLease.revoke()
      throw new SdkActivationError(
        'SDK route cannot change while a remote activation is resident',
        'SDK_ACTIVATION_ROUTE_LOCKED',
      )
    }
    if (!this.hasAdapterFor(params.provider)) {
      await nextLease.revoke()
      throw new Error(`no adapter registered for provider "${params.provider}"`)
    }
    this.cwd = cwd
    this.provider = params.provider
    this.model = params.model
    this.maxTokens = params.maxTokens
    const previousLease = this.connectionLease
    this.connectionLease = nextLease
    if (previousLease !== undefined) void previousLease.revoke().catch(() => undefined)
    return { serverInfo: { name: 'clocky-sdk-runtime', version: '0.0.1' } }
  }

  /**
   * Create the default Team topology and admit its initial human content.
   * @param params - Team objective and direct-v3 human content.
   * @returns the Team, coordinator transcript, and initial Envelope identities.
   */
  async createTeam(params: TeamCreateParams): Promise<TeamCreateResult> {
    this.requireRoute()
    return await this.withAuthenticatedProductCall(async call => await this.createTeamWithCall(params, call))
  }

  /** Create one Team from the connection-scoped authenticated product call. */
  private async createTeamWithCall(
    params: TeamCreateParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamCreateResult> {
    const route = this.requireRoute()
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    const creation = this.createProductTeam(params, route, call)
    this.pendingProductTeamCreations.add(creation)
    try {
      return await creation
    } finally {
      this.pendingProductTeamCreations.delete(creation)
    }
  }

  /** Create one product Team before publishing its active server-owned record. */
  private async createProductTeam(
    params: TeamCreateParams,
    route: { readonly provider: string; readonly model: string; readonly maxTokens: number | undefined },
    call: AuthenticatedProductCall,
  ): Promise<TeamCreateResult> {
    const content = parseTeamContent(params.contentBlocks)
    const run = await this.ctx.teamRuns.create({
      admitHumanChannel: createPrincipalChannelAdmission(this.ctx, call),
      signal: call.signal,
      objective: params.objective,
      cwd: this.cwd,
      selection: { provider: route.provider, model: route.model },
      humanOwner: { kind: 'product-principal', principalId: call.principal.id },
      ...route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens },
    })
    try {
      const envelope = await this.ctx.teamRuns.postHumanInput({
        teamId: run.teamId,
        content,
        delivery: 'turn',
        humanOwner: { kind: 'product-principal', principalId: call.principal.id },
      })
      const coordinator = run.coordinatorLease.localAgent
      if (coordinator === undefined) throw new Error(`Team '${run.teamId}' did not publish a local coordinator`)
      this.productTeams.set(String(run.teamId), { run, owner: call.principal.id, state: 'active' })
      return {
        teamId: String(run.teamId),
        coordinatorSessionId: String(coordinator.session.id),
        envelopeId: String(envelope.id),
      }
    } catch (error: unknown) {
      try {
        await this.ctx.teamRuns.cancel(run.teamId, { kind: 'product-principal', principalId: call.principal.id })
      } catch (cancellation: unknown) {
        throw new AggregateError([error, cancellation], `Team '${run.teamId}' input admission and rollback both failed`)
      }
      throw error
    }
  }

  /**
   * Resume one Team through the current connection's human proof.
   * @param params - Team identity and observed cursor selected for recovery.
   * @returns the reattached Team and coordinator Session identities.
   */
  async resumeTeam(params: TeamResumeParams): Promise<TeamResumeResult> {
    return await this.withAuthenticatedProductCall(async call => await this.resumeTeamWithCall(params, call))
  }

  /** Bind one complete Team resume to the current connection through provider preflight and coordinator publication. */
  private async resumeTeamWithCall(
    params: TeamResumeParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamResumeResult> {
    const route = this.requireRoute()
    const input = sdkTeamResumeInput(params)
    const prior = this.productTeams.get(params.teamId)
    if (prior !== undefined && prior.owner !== call.principal.id) {
      return await this.rejectUnauthenticatedTeamWrite()
    }
    return await this.withHumanActorProof(
      call,
      humanTeamResumeProofInput(input),
      async (actor) => {
        const authorization = await this.requireTeams().authorizeHumanResume({ actor, ...input })
        try {
          const run = await this.ctx.teamRuns.resume({
            admitHumanChannel: createPrincipalChannelAdmission(this.ctx, call),
            teamId: input.teamId,
            cwd: this.cwd,
            selection: { provider: route.provider, model: route.model },
            ...route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens },
            authorization,
            humanOwner: { kind: 'product-principal', principalId: call.principal.id },
            signal: call.signal,
          })
          const coordinator = run.coordinatorLease.localAgent
          if (coordinator === undefined) {
            throw new Error(`Team '${run.teamId}' resume did not publish a local coordinator`)
          }
          this.productTeams.set(String(run.teamId), {
            run,
            owner: call.principal.id,
            state: 'active',
          })
          return { teamId: String(run.teamId), coordinatorSessionId: String(coordinator.session.id) }
        } finally {
          authorization.close()
        }
      },
    )
  }

  /**
   * Await a current product Team's explicit final result and retain terminal run state.
   * Detached or another-principal Teams reject before TeamRun receives the wait.
   * @param params - Team selected by its creation receipt.
   * @returns settled human-facing final result.
   */
  async waitForTeamFinal(params: TeamWaitFinalParams): Promise<TeamWaitFinalResult> {
    return await this.withAuthenticatedProductCall(async call => await this.waitForTeamFinalWithCall(params, call))
  }

  /** Require the current connection principal before waiting on its product Team. */
  private async waitForTeamFinalWithCall(
    params: TeamWaitFinalParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamWaitFinalResult> {
    const record = this.productTeamForOwner(params.teamId, call)
    if (record?.state !== 'active') return this.rejectUnauthenticatedTeamWrite()
    const final = await this.ctx.teamRuns.waitForFinal({
      teamId: record.run.teamId,
      humanOwner: { kind: 'product-principal', principalId: call.principal.id },
    })
    this.productTeams.set(params.teamId, { ...record, state: 'terminal' })
    return {
      teamId: String(final.teamId),
      channelId: String(final.channelId),
      envelopeId: String(final.envelopeId),
      text: final.text,
    }
  }

  /**
   * Cancel one current product Team and retain terminal run state.
   * Detached or another-principal Teams reject before TeamRun receives cancellation.
   * @param params - Team selected by its creation receipt.
   * @returns the terminal Team phase after cancellation settlement.
   */
  async cancelTeam(params: TeamCancelParams): Promise<TeamCancelResult> {
    return await this.withAuthenticatedProductCall(async call => await this.cancelTeamWithCall(params, call))
  }

  /** Require the current connection principal before cancelling its product Team. */
  private async cancelTeamWithCall(
    params: TeamCancelParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamCancelResult> {
    const record = this.productTeamForOwner(params.teamId, call)
    if (record?.state === 'active') {
      await this.ctx.teamRuns.cancel(record.run.teamId, { kind: 'product-principal', principalId: call.principal.id })
      this.productTeams.set(params.teamId, { ...record, state: 'terminal' })
      const teams = this.ctx.get('teams')
      if (teams === undefined) return { phase: 'cancelled' }
      const state = await teams.getTeam({ teamId: record.run.teamId })
      return { phase: state.team.phase }
    }
    return this.rejectUnauthenticatedTeamWrite()
  }

  /**
   * Archive one terminal Team through the current connection's human proof.
   * @param params - terminal Team identity and observed cursor.
   * @returns the archived Team identity and durable archive timestamp.
   */
  async archiveTeam(params: TeamArchiveParams): Promise<TeamArchiveResult> {
    return await this.withAuthenticatedProductCall(async call => await this.archiveTeamWithCall(params, call))
  }

  /** Bind one complete terminal archive to the current connection before Hub admission. */
  private async archiveTeamWithCall(
    params: TeamArchiveParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamArchiveResult> {
    this.requireRoute()
    const input = sdkTeamArchiveInput(params)
    const state = await this.withHumanActorProof(
      call,
      humanTeamArchiveProofInput(input),
      async actor => await this.requireTeams().archiveTeam({ actor, ...input }),
    )
    const archivedAt = state.team.archivedAt
    if (archivedAt === undefined) {
      throw new Error(`Team provider archived Team '${state.team.id}' without an archive timestamp`)
    }
    return { teamId: String(state.team.id), archivedAt }
  }

  /** Return one current-run record only when it belongs to the authenticated connection principal. */
  private productTeamForOwner(teamId: string, call: AuthenticatedProductCall): ProductTeamRecord | undefined {
    const record = this.productTeams.get(teamId)
    return record?.owner === call.principal.id ? record : undefined
  }

  /**
   * List durable Teams from the mounted Hub without requiring a local owner.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async listTeams(params: TeamListParams): Promise<TeamListResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return await teams.listTeamsPage({
      afterCursor: params.afterCursor ?? -1,
      limit: params.limit ?? 128,
    })
  }

  /**
   * Read one complete durable Team projection without activating an Agent.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async getTeam(params: TeamGetParams): Promise<TeamGetResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return { state: await teams.getTeam({ teamId: teamIdSchema.parse(params.teamId) }) }
  }

  /**
   * Update one Team objective through the current connection's human proof.
   * @param params - complete actor-free objective update input.
   * @returns the resulting Team state.
   */
  async updateTeamGoal(params: TeamGoalUpdateParams): Promise<TeamGoalUpdateResult> {
    return await this.withAuthenticatedProductCall(async call => await this.updateTeamGoalWithCall(params, call))
  }

  /** Bind one complete Team objective update to the current connection before Hub admission. */
  private async updateTeamGoalWithCall(
    params: TeamGoalUpdateParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamGoalUpdateResult> {
    this.requireRoute()
    const input = sdkTeamGoalUpdateInput(params)
    const state = await this.withHumanActorProof(
      call,
      humanTeamGoalProofInput(input),
      async actor => await this.requireTeams().updateTeamGoal({ actor, ...input }),
    )
    return { state }
  }

  /**
   * Transition one Team objective through the current connection's human proof.
   * @param params - complete actor-free objective phase transition input.
   * @returns the resulting Team state.
   */
  async transitionTeamGoal(params: TeamGoalTransitionParams): Promise<TeamGoalTransitionResult> {
    return await this.withAuthenticatedProductCall(async call => await this.transitionTeamGoalWithCall(params, call))
  }

  /** Bind one complete Team objective transition to the current connection before Hub admission. */
  private async transitionTeamGoalWithCall(
    params: TeamGoalTransitionParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamGoalTransitionResult> {
    this.requireRoute()
    const input = sdkTeamGoalTransitionInput(params)
    const state = await this.withHumanActorProof(
      call,
      humanTeamGoalProofInput(input),
      async actor => await this.requireTeams().transitionTeamGoalPhase({ actor, ...input }),
    )
    return { state }
  }

  /**
   * Read durable quiescence diagnostics without changing Team state.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async teamQuiescence(params: TeamQuiescenceParams): Promise<TeamQuiescenceResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return { value: await teams.inspectQuiescence(teamIdSchema.parse(params.teamId)) }
  }

  /**
   * Return process-local Team operational counters for dashboards and alerts.
   * @param _params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  teamMetrics(_params: TeamMetricsParams): TeamMetricsResult {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return teams.getMetrics()
  }

  /**
   * Read one bounded Team or channel audit page.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async teamAuditRead(params: TeamAuditReadParams): Promise<TeamAuditReadResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    const page = await teams.readAudit({
      teamId: teamIdSchema.parse(params.teamId),
      ...params.channelId === undefined ? {} : { channelId: channelIdSchema.parse(params.channelId) },
      afterCursor: params.afterCursor ?? -1,
      limit: params.limit ?? 128,
    })
    return {
      teamId: String(page.teamId),
      ...page.channelId === undefined ? {} : { channelId: String(page.channelId) },
      ...page.firstCursor === undefined ? {} : { firstCursor: page.firstCursor },
      items: page.items,
      ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor },
    }
  }

  /**
   * Read one visible Team artifact through the mounted provider.
   * @param params - Team and durable artifact identifiers.
   * @returns verified bytes and the exact durable reference.
   */
  async teamArtifactRead(params: TeamArtifactReadParams): Promise<TeamArtifactReadResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    const artifacts = this.ctx.get('teamArtifacts')
    if (artifacts === undefined) {
      throw new SdkTeamError('SDK runtime has no Team artifact provider', 'SDK_TEAM_ARTIFACT_UNAVAILABLE')
    }
    const selected = await teams.getArtifact({ teamId: teamIdSchema.parse(params.teamId), artifactId: params.artifactId })
    if (selected === undefined) {
      throw new SdkTeamError(`Team artifact '${params.artifactId}' was not found`, 'SDK_TEAM_ARTIFACT_NOT_FOUND')
    }
    const provider = selected.provider
    if (provider === undefined || artifacts.getProvider(provider) === undefined) {
      throw new SdkTeamError(`Team artifact '${selected.id}' is unavailable`, 'SDK_TEAM_ARTIFACT_UNAVAILABLE')
    }
    let bytes: Uint8Array
    try {
      bytes = await artifacts.read(provider, { reference: selected })
    } catch (error: unknown) {
      if (error instanceof TeamArtifactError && error.code === 'TEAM_ARTIFACT_NOT_FOUND') {
        throw new SdkTeamError(`Team artifact '${selected.id}' was not found`, 'SDK_TEAM_ARTIFACT_NOT_FOUND')
      }
      throw new SdkTeamError(`Team artifact '${selected.id}' is unavailable`, 'SDK_TEAM_ARTIFACT_UNAVAILABLE')
    }
    if (bytes.byteLength > MAX_TEAM_ARTIFACT_READ_BYTES) {
      throw new SdkTeamError(`Team artifact '${selected.id}' exceeds the SDK read limit`, 'SDK_TEAM_ARTIFACT_UNAVAILABLE')
    }
    return { artifact: selected, bytes: bytes.byteLength, data: Buffer.from(bytes).toString('base64') }
  }

  /**
   * List bounded visible artifact references retained by one Team.
   * @param params - Team identity, page cursor, and page limit.
   * @returns the validated result from the runtime.
   */
  async listTeamArtifacts(params: TeamArtifactListParams): Promise<TeamArtifactListResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return await teams.listArtifactsPage({
      teamId: teamIdSchema.parse(params.teamId),
      afterCursor: params.afterCursor ?? -1,
      limit: params.limit ?? 128,
    })
  }

  /**
   * Return durable participant descriptors for one Team.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async listTeamMembers(params: TeamMemberListParams): Promise<TeamMemberListResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return await teams.listParticipantsPage({
      teamId: teamIdSchema.parse(params.teamId),
      afterCursor: params.afterCursor ?? -1,
      limit: params.limit ?? 128,
    })
  }

  /**
   * Invite one Team participant through the current connection's human proof.
   * @param params - actor-free nonhuman participant invitation input.
   * @returns the invited participant projection.
   */
  async inviteTeamMember(params: TeamMemberInviteParams): Promise<TeamMemberInviteResult> {
    return await this.withAuthenticatedProductCall(async call => await this.inviteTeamMemberWithCall(params, call))
  }

  /**
   * Activate one invited Team participant through the current connection's human proof.
   * @param params - actor-free participant activation input.
   * @returns the active participant projection.
   */
  async activateTeamMember(params: TeamMemberActivateParams): Promise<TeamMemberActivateResult> {
    return await this.withAuthenticatedProductCall(async call => await this.activateTeamMemberWithCall(params, call))
  }

  /**
   * Remove one active Team participant through the current connection's human proof.
   * @param params - actor-free participant removal input.
   * @returns the departed participant projection.
   */
  async removeTeamMember(params: TeamMemberRemoveParams): Promise<TeamMemberRemoveResult> {
    return await this.withAuthenticatedProductCall(async call => await this.removeTeamMemberWithCall(params, call))
  }

  /**
   * Interrupt one Team participant through the current connection's human proof.
   * @param params - actor-free interrupt target and cursor input.
   * @returns the durable interrupt projection.
   */
  async interruptTeamMember(params: TeamMemberInterruptParams): Promise<TeamMemberInterruptResult> {
    return await this.withAuthenticatedProductCall(async call => await this.interruptTeamMemberWithCall(params, call))
  }

  /** Discover registrations through the authenticated product connection.
   * @param params - Empty discovery selection.
   * @returns Current protocol, view-policy and summary capabilities.
   */
  async getTeamChannelCatalog(params: TeamChannelCatalogParams = {}): Promise<TeamChannelCatalogResult> {
    return await this.withAuthenticatedProductCall(call => Promise.resolve(this.channelCatalogWithCall(params, call)))
  }

  private channelCatalogWithCall(params: TeamChannelCatalogParams, call: AuthenticatedProductCall): TeamChannelCatalogResult {
    this.requireRoute()
    teamChannelCatalogParamsSchema.parse(params)
    call.signal.throwIfAborted()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    const summary = this.ctx.get('teamChannelSummaries')
    return { adapters: teams.listAdapters(), viewPolicies: teams.listViewPolicies(),
      ...summary === undefined ? {} : { summary: summary.describe() } }
  }

  /** Commit an authenticated human's explicit bounded summary.
   * @param params - Source range, channel cursor and stable retry identity.
   * @returns The durable summary and source provenance.
   */
  async summarizeTeamChannel(params: TeamChannelSummarizeParams): Promise<TeamChannelSummarizeResult> {
    return await this.withAuthenticatedProductCall(call => this.channelSummarizeWithCall(params, call))
  }

  private async channelSummarizeWithCall(
    params: TeamChannelSummarizeParams, call: AuthenticatedProductCall,
  ): Promise<TeamChannelSummarizeResult> {
    this.requireRoute()
    const actors = this.ctx.get('teamHumanActors')
    if (actors === undefined) return await this.rejectUnauthenticatedTeamWrite()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    const summary = this.ctx.get('teamChannelSummaries')
    if (summary === undefined) throw new SdkTeamError('SDK runtime has no channel summary Consumer')
    const input = channelSummarySelectionInputSchema.parse(params)
    const channel = await teams.getChannel({ channelId: input.channelId })
    return { value: await actors.withProof(call, channelSummaryHumanProofInput(channel.manifest.teamId, input),
      requester => summary.summarize({ requester, ...input })) }
  }

  /**
   * List attached channels through the current authenticated Team membership.
   * @param params - Team identity and optional insertion cursor/page size.
   * @returns Bounded channel projections and an optional continuation cursor.
   */
  async listTeamChannels(params: TeamChannelListParams): Promise<TeamChannelListResult> {
    return await this.withAuthenticatedProductCall(call => this.listTeamChannelsWithCall(params, call))
  }

  private async listTeamChannelsWithCall(params: TeamChannelListParams, call: AuthenticatedProductCall): Promise<TeamChannelListResult> {
    this.requireRoute()
    const humanActors = this.ctx.get('teamHumanActors')
    if (humanActors === undefined) return await this.rejectUnauthenticatedTeamWrite()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    const input = teamChannelListInputSchema.parse(params)
    return await humanActors.withProof(call, { teamId: input.teamId, operation: 'channel-list-read',
      fence: { kind: 'read' }, payload: jsonObjectSchema.parse(input) }, actor => teams.listTeamChannels({ actor, ...input }))
  }

  /**
   * Read channel admission metadata under the current authenticated Team membership.
   * @param params - Actor-free Team and channel selection.
   * @returns Immutable manifest and endpoint invitation state.
   */
  async getTeamChannelAdmission(params: TeamChannelAdmissionParams): Promise<TeamChannelAdmissionResult> {
    return await this.withAuthenticatedProductCall(call => this.channelAdmissionWithCall(params, call))
  }

  private async channelAdmissionWithCall(
    params: TeamChannelAdmissionParams, call: AuthenticatedProductCall,
  ): Promise<TeamChannelAdmissionResult> {
    this.requireRoute()
    const humanActors = this.ctx.get('teamHumanActors')
    if (humanActors === undefined) return await this.rejectUnauthenticatedTeamWrite()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    const parsed = teamChannelAdmissionParamsSchema.parse(params)
    const input = { teamId: teamIdSchema.parse(parsed.teamId), channelId: channelIdSchema.parse(parsed.channelId) }
    return { value: await humanActors.withProof(call, { teamId: input.teamId, operation: 'channel-admission-read',
      fence: { kind: 'read' }, payload: jsonObjectSchema.parse(input) }, actor => teams.getHumanChannelAdmission({ actor, ...input })) }
  }

  /**
   * Discover only the authenticated human's invitation without recording consent.
   * @param params - channel identity, with no caller-selected actor.
   * @returns the complete manifest and the caller's invitation.
   */
  async getTeamChannelInvitation(params: TeamChannelInvitationParams): Promise<TeamChannelInvitationResult> {
    return await this.withAuthenticatedProductCall(async call => await this.channelInvitationWithCall(params, call))
  }

  /**
   * Explicitly accept the discovered protocol and exact manifest.
   * @param params - invitation revision, manifest fingerprint and stable retry key.
   * @returns the durable acknowledgement and current channel state.
   */
  async acknowledgeTeamChannelInvitation(params: TeamChannelInvitationAcknowledgeParams): Promise<TeamChannelInvitationResult> {
    return await this.withAuthenticatedProductCall(async call => await this.channelInvitationAcknowledgeWithCall(params, call))
  }

  private async channelInvitationWithCall(
    params: TeamChannelInvitationParams, call: AuthenticatedProductCall,
  ): Promise<TeamChannelInvitationResult> {
    this.requireRoute()
    const input = channelGetRequestSchema.parse(params)
    return { value: await getPrincipalChannelInvitation(this.ctx, call, input) }
  }

  private async channelInvitationAcknowledgeWithCall(
    params: TeamChannelInvitationAcknowledgeParams, call: AuthenticatedProductCall,
  ): Promise<TeamChannelInvitationResult> {
    this.requireRoute()
    const input = channelInvitationAcknowledgeInputSchema.parse(params)
    return { value: await acknowledgePrincipalChannelInvitation(this.ctx, call, input) }
  }

  /**
   * Open one generic Team channel through the current connection's human proof.
   * @param params - actor-free generic channel manifest input.
   * @returns the opened channel projection.
   */
  async openTeamChannel(params: TeamChannelOpenParams): Promise<TeamChannelOpenResult> {
    return await this.withAuthenticatedProductCall(async call => await this.openTeamChannelWithCall(params, call))
  }

  /**
   * Post one actor-free wire payload through the current authenticated human proof.
   * @param params - actor-free channel post input.
   * @returns the Hub-stamped Envelope projection.
   */
  async postTeamChannel(params: TeamChannelPostParams): Promise<TeamChannelPostResult> {
    return await this.withAuthenticatedProductCall(async call => await this.postTeamChannelWithCall(params, call))
  }

  /**
   * Admit direct-channel media or basic-protocol text through an acknowledged invitation.
   * @param params - Actor-free media content and the ordinary post fences.
   * @returns The durable Envelope containing content-addressed image references.
   */
  async inputTeamChannel(params: TeamChannelInputParams): Promise<TeamChannelPostResult> {
    return await this.withAuthenticatedProductCall(call => this.inputTeamChannelWithCall(params, call))
  }

  private async inputTeamChannelWithCall(params: TeamChannelInputParams, call: AuthenticatedProductCall): Promise<TeamChannelPostResult> {
    this.requireRoute()
    const parsed = teamChannelInputParamsSchema.parse(params)
    const own = await getPrincipalChannelInvitation(this.ctx, call, { channelId: channelIdSchema.parse(parsed.channelId) })
    if (own.channel.manifest.adapter.type !== 'direct') {
      const first = parsed.content[0]
      if (parsed.content.length !== 1 || first?.type !== 'text') throw new TeamError('Basic channel input requires exactly one text block', 'TEAM_INVALID_ARGUMENT')
      const routing = { audience: parsed.audience === null ? null : parsed.audience.map(id => participantIdSchema.parse(id)),
        delivery: parsed.delivery, ...parsed.causationId === undefined ? {} : { causationId: envelopeIdSchema.parse(parsed.causationId) },
        ...parsed.taskId === undefined ? {} : { taskId: teamTaskIdSchema.parse(parsed.taskId) },
        ...parsed.idempotencyKey === undefined ? {} : { idempotencyKey: channelPostIdempotencyKeySchema.parse(parsed.idempotencyKey) } }
      const draft = await resolvePrincipalChannelText(this.ctx, call, own, { ...routing, text: first.text })
      const { content: _content, ...post } = parsed
      return await this.postTeamChannelWithCall({ ...post, ...draft }, call)
    }
    if (own.invitation.status !== 'acknowledged' || (parsed.idempotencyKey === undefined && own.channel.phase !== 'active')
      || ![3, 4].includes(own.channel.manifest.adapter.version)) {
      throw new TeamError('Media input requires an acknowledged active direct channel', 'TEAM_INVALID_ARGUMENT')
    }
    const { content, ...post } = parsed
    const images = content.filter(part => part.type === 'image')
    const attachments = this.ctx.get('attachments')
    if (images.length > 0 && attachments === undefined) {
      throw new TeamError('Image attachment storage is unavailable', 'TEAM_INVALID_ARGUMENT')
    }
    call.signal.throwIfAborted()
    const refs = attachments === undefined || images.length === 0 ? [] : await admitEncodedImages(attachments, images)
    call.signal.throwIfAborted()
    let nextImage = 0
    const durableContent = content.map(part => part.type === 'text' ? { type: 'text', text: part.text }
      : { type: 'image', attachment: refs[nextImage++] })
    return await this.postTeamChannelWithCall({ ...post, kind: 'message', payload: jsonObjectSchema.parse({ content: durableContent }) }, call)
  }

  /**
   * Read only an image reference retained in the exact authorized channel Envelope.
   * @param params - Team, channel, Envelope, and attachment identities.
   * @returns Digest-verified bytes and the retained reference.
   */
  async readTeamChannelAttachment(params: TeamChannelAttachmentParams): Promise<TeamChannelAttachmentResult> {
    return await this.withAuthenticatedProductCall(call => this.readTeamChannelAttachmentWithCall(params, call))
  }

  private async readTeamChannelAttachmentWithCall(
    params: TeamChannelAttachmentParams, call: AuthenticatedProductCall,
  ): Promise<TeamChannelAttachmentResult> {
    this.requireRoute()
    const parsed = teamChannelAttachmentParamsSchema.parse(params)
    const teams = this.ctx.get('teams')
    const humanActors = this.ctx.get('teamHumanActors')
    const attachments = this.ctx.get('attachments')
    if (teams === undefined || humanActors === undefined || attachments === undefined) {
      throw new TeamError('Authenticated channel attachment access is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
    }
    const input = { teamId: teamIdSchema.parse(parsed.teamId), channelId: channelIdSchema.parse(parsed.channelId),
      envelopeId: envelopeIdSchema.parse(parsed.envelopeId), envelopeSequence: parsed.envelopeSequence }
    return await humanActors.withProof(call, { teamId: input.teamId, operation: 'channel-content-read', fence: { kind: 'read' },
      payload: jsonObjectSchema.parse(input) }, async (actor) => {
      const envelope = await teams.getHumanChannelEnvelope({ actor, ...input })
      const content = parseDirectChannelV4MessagePayload(envelope.payload).content
      const selected = content.find(part => part.type === 'image' && part.attachment.attachmentId === parsed.attachmentId)
      if (selected?.type !== 'image') throw new TeamError('Image is not referenced by the selected Envelope', 'TEAM_INVALID_ARGUMENT')
      const stored = await attachments.readImage(selected.attachment, call.signal)
      call.signal.throwIfAborted()
      await teams.getHumanChannelEnvelope({ actor, ...input })
      return { attachment: stored.ref, data: Buffer.from(stored.data).toString('base64') }
    })
  }

  /** Resolve the channel Team under the provider, then bind the complete post to this connection call. */
  private async postTeamChannelWithCall(
    params: TeamChannelPostParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamChannelPostResult> {
    this.requireRoute()
    const humanActors = this.ctx.get('teamHumanActors')
    if (humanActors === undefined) return await this.rejectUnauthenticatedTeamWrite()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    const input = sdkChannelPostInput(params)
    const channel = await teams.getChannel({ channelId: input.draft.channelId })
    const proofInput: TeamHumanActorProofInput = {
      teamId: channel.manifest.teamId,
      operation: 'send',
      fence: { kind: 'cursor', cursor: input.expectedCursor },
      payload: jsonObjectSchema.parse(structuredClone(input)),
    }
    return {
      value: await humanActors.withProof(
        call,
        proofInput,
        async actor => await teams.postChannelEnvelope({ actor, ...input }),
      ),
    }
  }

  /**
   * Read one bounded channel WAL suffix including its optional view projection.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async readTeamChannel(params: TeamChannelReadParams): Promise<TeamChannelReadResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return {
      value: await teams.readChannelPage({
        channelId: channelIdSchema.parse(params.channelId),
        afterCursor: params.afterCursor ?? -1,
        limit: params.limit ?? 128,
      }),
    }
  }

  /**
   * Close one generic Team channel through the current connection's human proof.
   * @param params - actor-free channel close input.
   * @returns the terminal channel projection.
   */
  async closeTeamChannel(params: TeamChannelCloseParams): Promise<TeamChannelCloseResult> {
    return await this.withAuthenticatedProductCall(async call => await this.closeTeamChannelWithCall(params, call))
  }

  /** Bind one complete member invitation to the current connection before Hub admission. */
  private async inviteTeamMemberWithCall(
    params: TeamMemberInviteParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamMemberInviteResult> {
    this.requireRoute()
    const input = sdkMemberInviteInput(params)
    const participant = await this.withHumanActorProof(
      call,
      humanMemberInviteProofInput(input),
      async actor => await this.requireTeams().inviteParticipant({ actor, ...input }),
    )
    return { value: participant }
  }

  /** Bind one activation phase transition to the current connection before Hub admission. */
  private async activateTeamMemberWithCall(
    params: TeamMemberActivateParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamMemberActivateResult> {
    this.requireRoute()
    const input = sdkMemberPhaseInput(params, 'active')
    const participant = await this.withHumanActorProof(
      call,
      humanMemberPhaseProofInput(input, 'activate'),
      async actor => await this.requireTeams().transitionParticipantPhase({ actor, ...input }),
    )
    return { value: participant }
  }

  /** Bind one member departure to the current connection before Hub admission. */
  private async removeTeamMemberWithCall(
    params: TeamMemberRemoveParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamMemberRemoveResult> {
    this.requireRoute()
    const input = sdkMemberPhaseInput(params, 'left')
    const participant = await this.withHumanActorProof(
      call,
      humanMemberPhaseProofInput(input, 'close'),
      async actor => await this.requireTeams().transitionParticipantPhase({ actor, ...input }),
    )
    return { value: participant }
  }

  /** Bind one member interrupt request to the current connection before Hub admission. */
  private async interruptTeamMemberWithCall(
    params: TeamMemberInterruptParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamMemberInterruptResult> {
    this.requireRoute()
    const input = sdkMemberInterruptInput(params)
    const value = await this.withHumanActorProof(
      call,
      humanMemberInterruptProofInput(input),
      async actor => await this.requireTeams().requestParticipantInterrupt({ actor, ...input }),
    )
    return { value }
  }

  /** Bind one generic non-workflow channel open to the current connection before Hub admission. */
  private async openTeamChannelWithCall(
    params: TeamChannelOpenParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamChannelOpenResult> {
    this.requireRoute()
    const input = sdkChannelOpenInput(params)
    const { workflowPlanId, expectedPlanRevision, ...genericInput } = input
    if (workflowPlanId !== undefined || expectedPlanRevision !== undefined) {
      throw new SdkTeamError('SDK channel opening cannot select a workflow plan', 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE')
    }
    const value = await this.withHumanActorProof(
      call,
      humanChannelOpenProofInput(genericInput),
      async actor => await this.requireTeams().openChannel({ actor, authorityKind: 'human', ...genericInput }),
    )
    return { value }
  }

  /** Resolve the close channel's Team before binding its complete close command to the current connection. */
  private async closeTeamChannelWithCall(
    params: TeamChannelCloseParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamChannelCloseResult> {
    this.requireRoute()
    const input = sdkChannelCloseInput(params)
    const humanActors = this.requireHumanActors()
    const teams = this.requireTeams()
    const channel = await teams.getChannel({ channelId: input.channelId })
    const value = await humanActors.withProof(
      call,
      humanChannelCloseProofInput(channel.manifest.teamId, input),
      async actor => await teams.closeChannel({ actor, ...input }),
    )
    return { value }
  }

  /** Require the explicitly mounted authenticated-human binder before any provider lookup. */
  private requireHumanActors() {
    const humanActors = this.ctx.get('teamHumanActors')
    if (humanActors === undefined) {
      throw new SdkTeamError(
        'SDK Team management requires an authenticated human-proof route, but the mounted Team provider does not expose one.',
        'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE',
      )
    }
    return humanActors
  }

  /** Require the mounted Team provider without creating or inferring authority. */
  private requireTeams() {
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return teams
  }

  /** Retain one connection proof only while its exact Hub operation remains pending. */
  private async withHumanActorProof<T>(
    call: AuthenticatedProductCall,
    input: TeamHumanActorProofInput,
    operation: (actor: TeamHumanActorProof) => Promise<T>,
  ): Promise<T> {
    return await this.requireHumanActors().withProof(call, input, operation)
  }

  /**
   * Wait for one channel WAL cursor to advance or close.
   * @param params - validated Team operation parameters.
   * @param signal - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async watchTeamChannel(params: TeamChannelWatchParams, signal?: AbortSignal): Promise<TeamChannelWatchResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return {
      value: await teams.watchChannel({
        channelId: channelIdSchema.parse(params.channelId),
        afterCursor: params.afterCursor ?? -1,
        ...signal === undefined ? {} : { signal },
      }),
    }
  }

  /**
   * Return durable tasks, including tombstones, for one Team.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async listTeamTasks(params: TeamTaskListParams): Promise<TeamTaskListResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return await teams.listTasksPage({
      teamId: teamIdSchema.parse(params.teamId),
      afterCursor: params.afterCursor ?? -1,
      limit: params.limit ?? 128,
    })
  }

  /**
   * Return bounded durable workflow plan projections for one Team.
   * @param params - Team identity, page cursor, and page limit.
   * @returns the validated result from the runtime.
   */
  async listWorkflowPlans(params: TeamWorkflowPlanListParams): Promise<TeamWorkflowPlanListResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    const page = await teams.listWorkflowPlansPage({
      teamId: teamIdSchema.parse(params.teamId),
      afterCursor: params.afterCursor ?? -1,
      limit: params.limit ?? 128,
    })
    return {
      items: page.items,
      ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor },
    }
  }

  /**
   * Create one Team task through the current connection's human proof.
   * @param params - actor-free task definition and idempotency input.
   * @returns the created task projection.
   */
  async createTeamTask(params: TeamTaskCreateParams): Promise<TeamTaskCreateResult> {
    return await this.withAuthenticatedProductCall(async call => await this.createTeamTaskWithCall(params, call))
  }

  /**
   * Read one durable Team task.
   * @param params - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async getTeamTask(params: TeamTaskGetParams): Promise<TeamTaskGetResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return {
      value: await teams.getTask({
        teamId: teamIdSchema.parse(params.teamId),
        taskId: teamTaskIdSchema.parse(params.taskId),
      }),
    }
  }

  /**
   * Update one Team task through the current connection's human proof.
   * @param params - actor-free task-details update input.
   * @returns the updated task projection.
   */
  async updateTeamTask(params: TeamTaskUpdateParams): Promise<TeamTaskUpdateResult> {
    return await this.withAuthenticatedProductCall(async call => await this.updateTeamTaskWithCall(params, call))
  }

  /**
   * Cancel one Team task through the current connection's human proof.
   * @param params - actor-free task cancellation input.
   * @returns the cancelled task projection.
   */
  async cancelTeamTask(params: TeamTaskCancelParams): Promise<TeamTaskCancelResult> {
    return await this.withAuthenticatedProductCall(async call => await this.cancelTeamTaskWithCall(params, call))
  }

  /**
   * Delete one Team task through the current connection's human proof.
   * @param params - actor-free task deletion input.
   * @returns the deleted task projection.
   */
  async deleteTeamTask(params: TeamTaskDeleteParams): Promise<TeamTaskDeleteResult> {
    return await this.withAuthenticatedProductCall(async call => await this.deleteTeamTaskWithCall(params, call))
  }

  /**
   * Resolve one Team task review through the current connection's human proof.
   * @param params - actor-free task-review decision input.
   * @returns the reviewed task projection.
   */
  async reviewTeamTask(params: TeamTaskReviewParams): Promise<TeamTaskReviewResult> {
    return await this.withAuthenticatedProductCall(async call => await this.reviewTeamTaskWithCall(params, call))
  }

  /** Bind one complete task creation to the current connection before Hub admission. */
  private async createTeamTaskWithCall(
    params: TeamTaskCreateParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamTaskCreateResult> {
    this.requireRoute()
    const input = sdkTaskCreateInput(params)
    const value = await this.withHumanActorProof(
      call,
      humanTaskCreateProofInput(input),
      async actor => await this.requireTeams().createTask({ actor, ...input }),
    )
    return { value }
  }

  /** Bind one complete task-details update to the current connection before Hub admission. */
  private async updateTeamTaskWithCall(
    params: TeamTaskUpdateParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamTaskUpdateResult> {
    this.requireRoute()
    const input = sdkTaskUpdateInput(params)
    const value = await this.withHumanActorProof(
      call,
      humanTaskRevisionProofInput(input),
      async actor => await this.requireTeams().updateTaskDetails({ actor, ...input }),
    )
    return { value }
  }

  /** Bind one task cancellation to the current connection before Hub admission. */
  private async cancelTeamTaskWithCall(
    params: TeamTaskCancelParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamTaskCancelResult> {
    this.requireRoute()
    const input = sdkTaskCancelInput(params)
    const value = await this.withHumanActorProof(
      call,
      humanTaskRevisionProofInput(input),
      async actor => await this.requireTeams().cancelTask({ actor, ...input }),
    )
    return { value }
  }

  /** Bind one task tombstone to the current connection before Hub admission. */
  private async deleteTeamTaskWithCall(
    params: TeamTaskDeleteParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamTaskDeleteResult> {
    this.requireRoute()
    const input = sdkTaskDeleteInput(params)
    const value = await this.withHumanActorProof(
      call,
      humanTaskRevisionProofInput(input),
      async actor => await this.requireTeams().deleteTask({ actor, ...input }),
    )
    return { value }
  }

  /** Bind one task review to the current connection and let the Hub derive the reviewer. */
  private async reviewTeamTaskWithCall(
    params: TeamTaskReviewParams,
    call: AuthenticatedProductCall,
  ): Promise<TeamTaskReviewResult> {
    this.requireRoute()
    const input = sdkTaskReviewInput(params)
    const value = await this.withHumanActorProof(
      call,
      humanTaskReviewProofInput(teamIdSchema.parse(params.teamId), input),
      async actor => await this.requireTeams().resolveTaskReview({ actor, ...input }),
    )
    return { value }
  }

  /**
   * Wait for one Team task graph cursor to advance or close.
   * @param params - validated Team operation parameters.
   * @param signal - validated Team operation parameters.
   * @returns the validated result from the runtime.
   */
  async watchTeamTasks(params: TeamTaskWatchParams, signal?: AbortSignal): Promise<TeamTaskWatchResult> {
    this.requireRoute()
    const teams = this.ctx.get('teams')
    if (teams === undefined) throw new SdkTeamError('SDK runtime has no Team provider')
    return {
      value: await teams.watchTeam({
        teamId: teamIdSchema.parse(params.teamId),
        afterCursor: params.afterCursor ?? -1,
        ...signal === undefined ? {} : { signal },
      }),
    }
  }

  /**
   * Publish one fresh or persisted-resume remote activation. Exact retrying
   * calls share the first operation; changed ownership fields never alias it.
   * @param params - full activation target plus fresh/resume Session seed.
   * @returns the published remote activation state.
   */
  async openActivation(params: ActivationOpenParams): Promise<ActivationOpenResult> {
    this.requireRoute()
    if (this.shuttingDown) throw new Error('SDK server is shutting down')
    const existing = this.activations.get(params.target.activationId)
    if (existing !== undefined) {
      this.assertMatchingTarget(existing, params.target)
      if (!sameSeed(existing.seed, params.seed)) {
        throw new SdkActivationError(
          `Activation '${params.target.activationId}' was opened with another seed`,
          'SDK_ACTIVATION_SEED_MISMATCH',
        )
      }
      return { state: await (existing.opening ?? Promise.resolve(this.activationState(existing))) }
    }
    const sessionOccupant = this.activationSessions.get(params.target.sessionId)
    if (sessionOccupant !== undefined) {
      throw new SdkActivationError(
        `Session '${params.target.sessionId}' is already resident for activation '${sessionOccupant.target.activationId}'`,
        'SDK_ACTIVATION_SESSION_CONFLICT',
      )
    }
    const participantOccupant = this.activationParticipant(params.target)
    if (participantOccupant !== undefined) {
      throw new SdkActivationError(
        `Participant '${params.target.participantId}' is already resident for activation '${participantOccupant.target.activationId}'`,
        'SDK_ACTIVATION_PARTICIPANT_CONFLICT',
      )
    }
    const record: ActivationRecord = {
      target: freezeTarget(params.target),
      seed: freezeSeed(params.seed),
      handle: undefined,
      status: 'starting',
      statusSequence: 0,
      opening: undefined,
      disposal: undefined,
      linkDelivery: undefined,
    }
    this.activations.set(record.target.activationId, record)
    this.activationSessions.set(record.target.sessionId, record)
    this.setActivationParticipant(record)
    this.notifyActivation(record)
    const opening = this.materializeActivation(record)
    record.opening = opening
    void opening.then(
      () => {
        record.opening = undefined
      },
      () => {
        record.opening = undefined
        this.releaseActivationResidency(record)
        this.activations.delete(record.target.activationId)
      },
    )
    return { state: await opening }
  }

  /**
   * Start one fixed remote Link delivery after the authoritative Hub committed
   * the activation binding and issued its ephemeral credential.
   * @param params - exact activation target, durable binding, and credential.
   * @returns an empty acknowledgement after the child accepted delivery ownership.
   */
  async enrollActivationLink(params: ActivationLinkEnrollParams): Promise<ActivationLinkEnrollResult> {
    try {
      const record = this.requireLiveActivation(params.target)
      const binding = activationBindingSnapshotSchema.parse({
        activation: {
          id: params.binding.activationId,
          teamId: params.binding.teamId,
          participantId: params.binding.participantId,
          status: record.status,
        },
        sessionId: params.binding.sessionId,
        provider: params.binding.provider,
      })
      if (!sameLinkTarget(params.target, params.binding)
        || (binding.activation.status !== 'idle' && binding.activation.status !== 'running')) {
        throw new SdkActivationError(
          `Team Link enrollment does not match live activation '${params.target.activationId}'`,
          'SDK_ACTIVATION_LINK_MISMATCH',
        )
      }
      const enrollment = enrollmentFingerprint(params)
      const existing = record.linkDelivery
      if (existing !== undefined) {
        if (sameLinkBinding(existing.binding, binding) && sameEnrollment(existing.enrollment, enrollment)) return {}
        if (!sameLinkBinding(existing.binding, binding)) {
          throw new SdkActivationError(
            `Activation '${params.target.activationId}' already owns another Team Link delivery`,
            'SDK_ACTIVATION_LINK_MISMATCH',
          )
        }
        await this.closeLinkDelivery(record)
      }
      const links = this.ctx.get('teamLinks')
      if (links === undefined) {
        throw new SdkActivationError(
          'SDK runtime has no Team Link registry for remote activation delivery',
          'SDK_ACTIVATION_LINK_UNAVAILABLE',
        )
      }
      const providerName = `sdk-link:${params.target.activationId}`
      let unregister: (() => void) | undefined
      try {
        const provider = createCapabilityWebSocketTeamLinkProvider({
          providerName,
          endpoint: params.enrollment.endpoint,
        }, params.enrollment.capability)
        unregister = links.registerProvider(provider)
        const delivery = new FixedBindingTeamAgentLinkDelivery(this.ctx, {
          agent: record.handle.agent,
          binding,
        }, { linkProvider: providerName })
        record.linkDelivery = { binding, enrollment, delivery, unregister }
        delivery.start()
        return {}
      } catch (error: unknown) {
        unregister?.()
        record.linkDelivery = undefined
        throw error
      }
    } catch (error: unknown) {
      throw error instanceof Error ? error : new Error('SDK activation Link enrollment failed', { cause: error })
    }
  }

  /**
   * Read one exact remote activation state without inferring it from a session.
   * @param params - full activation target identity.
   * @returns the current state for the exact epoch.
   */
  activationStatus(params: ActivationStatusParams): ActivationStatusResult {
    return { state: this.activationState(this.requireActivation(params.target)) }
  }

  /**
   * Request cancellation of work on one exact remote activation without
   * releasing its Session or activation ownership.
   * @param params - target identity and caller-provided cancellation cause.
   * @returns an acknowledgement once the cancellation request reaches the Agent.
   */
  interruptActivation(params: ActivationInterruptParams): ActivationInterruptResult {
    const record = this.requireLiveActivation(params.target)
    record.handle.agent.cancel(params.cause, { keepInbox: true })
    return {}
  }

  /**
   * Stop admission and dispose one exact remote activation without closing the
   * hosting SDK process.
   * @param params - full activation target identity.
   * @returns the terminal offline state after the exact Agent has drained.
   */
  async disposeActivation(params: ActivationDisposeParams): Promise<ActivationDisposeResult> {
    const record = this.requireActivation(params.target)
    return { state: await this.disposeActivationRecord(record) }
  }

  /**
   * Dispose server-owned agents, adapter, and subscriptions to quiescence.
   * The surrounding context remains running.
   * @param revokeConnection - whether to revoke the retained product-authentication connection lease after shutdown.
   * @returns empty JSON-RPC result.
   */
  shutdown(revokeConnection = true): Promise<Record<string, never>> {
    this.shutdownTask ??= this.performShutdown()
    if (!revokeConnection) return this.shutdownTask
    return this.shutdownTask.then(async (result) => {
      await this.releaseConnectionLease()
      return result
    })
  }

  private async performShutdown(): Promise<Record<string, never>> {
    this.shuttingDown = true
    const pendingActivations = [...this.activations.values()]
      .flatMap(record => record.opening === undefined ? [] : [record.opening])
    const pendingProductTeamCreations = [...this.pendingProductTeamCreations]
    await Promise.allSettled([...pendingActivations, ...pendingProductTeamCreations])
    const activeProductTeams = [...this.productTeams.values()]
      .filter((record): record is ProductTeamRecord & { readonly state: 'active' } => record.state === 'active')
    this.productTeams.clear()
    const activations = [...this.activations.values()]
    const failures: unknown[] = []
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.()
      } catch (error) {
        failures.push(error)
      }
    }
    const teardownResults = await Promise.allSettled([
      ...activeProductTeams.map(record => Promise.resolve().then(() => this.ctx.teamRuns.cancel(
        record.run.teamId,
        { kind: 'product-principal', principalId: record.owner },
      ))),
      ...activations.map(record => Promise.resolve().then(() => this.disposeActivationRecord(record))),
    ])
    failures.push(...teardownResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason as unknown))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'SDK server teardown failed')
    return {}
  }

  /**
   * Dispatch one incoming JSON-RPC request to its typed handler. Throws (→ a
   * JSON-RPC error response) on an unknown method.
   * @param method - the JSON-RPC method name.
   * @param params - the raw params object from the wire.
   * @returns the handler's result, to be serialized as the response.
   */
  async handleRequest(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    if (method === 'initialize') {
      return await this.initialize(parseWireParams('initialize', initializeParamsSchema, params))
    }
    if (method === 'shutdown') {
      try {
        return await this.withAuthenticatedProductCall(async call =>
          await this.handleAuthenticatedRequest(method, params, call))
      } finally {
        await this.releaseConnectionLease()
      }
    }
    return await this.withAuthenticatedProductCall(async call =>
      await this.handleAuthenticatedRequest(method, params, call))
  }

  /** Dispatch one post-authentication request with its runtime-only call context. */
  private async handleAuthenticatedRequest(
    method: string,
    params: Record<string, unknown> | undefined,
    call: AuthenticatedProductCall,
  ): Promise<unknown> {
    switch (method) {
      case 'activation/open':
        return this.openActivation(parseWireParams('activation/open', activationOpenParamsSchema, params))
      case 'activation/link-enroll':
        return this.enrollActivationLink(parseWireParams('activation/link-enroll', activationLinkEnrollParamsSchema, params))
      case 'activation/status':
        return this.activationStatus(parseWireParams('activation/status', activationStatusParamsSchema, params))
      case 'activation/interrupt':
        return this.interruptActivation(parseWireParams('activation/interrupt', activationInterruptParamsSchema, params))
      case 'activation/dispose':
        return this.disposeActivation(parseWireParams('activation/dispose', activationDisposeParamsSchema, params))
      case 'team/create':
        return this.createTeamWithCall(parseWireParams('team/create', teamCreateParamsSchema, params), call)
      case 'team/list':
        return this.listTeams(parseWireParams('team/list', teamListParamsSchema, params ?? {}))
      case 'team/get':
        return this.getTeam(parseWireParams('team/get', teamGetParamsSchema, params))
      case 'team/goal-update':
        return this.updateTeamGoalWithCall(parseWireParams('team/goal-update', teamGoalUpdateParamsSchema, params), call)
      case 'team/goal-transition':
        return this.transitionTeamGoalWithCall(parseWireParams('team/goal-transition', teamGoalTransitionParamsSchema, params), call)
      case 'team/quiescence':
        return this.teamQuiescence(parseWireParams('team/quiescence', teamQuiescenceParamsSchema, params))
      case 'team/inbox-respond': {
        const inbox = this.ctx.get('teamHumanDelivery')
        if (inbox === undefined) throw new SdkTeamError('Durable principal inbox is not mounted')
        return await inbox.respond(call, parseWireParams('team/inbox-respond', teamHumanActionResponseInputSchema, params))
      }
      case 'team/inbox-read': {
        const inbox = this.ctx.get('teamHumanDelivery')
        if (inbox === undefined) throw new SdkTeamError('Durable principal inbox is not mounted')
        return await inbox.read(call, parseWireParams('team/inbox-read', teamHumanInboxReadInputSchema, params ?? {}))
      }
      case 'team/inbox-watch': {
        const inbox = this.ctx.get('teamHumanDelivery')
        if (inbox === undefined) throw new SdkTeamError('Durable principal inbox is not mounted')
        return await inbox.watch(call, parseWireParams('team/inbox-watch', teamHumanInboxReadInputSchema, params ?? {}))
      }
      case 'team/inbox-acknowledge': {
        const inbox = this.ctx.get('teamHumanDelivery')
        if (inbox === undefined) throw new SdkTeamError('Durable principal inbox is not mounted')
        return await inbox.acknowledge(call, parseWireParams('team/inbox-acknowledge', teamHumanInboxAcknowledgeInputSchema, params ?? {}))
      }
      case 'team/metrics':
        return this.teamMetrics(parseWireParams('team/metrics', teamMetricsParamsSchema, params ?? {}))
      case 'team/audit-read':
        return this.teamAuditRead(parseWireParams('team/audit-read', teamAuditReadParamsSchema, params))
      case 'team/artifact-read':
        return this.teamArtifactRead(parseWireParams('team/artifact-read', teamArtifactReadParamsSchema, params))
      case 'team/artifact-list':
        return this.listTeamArtifacts(parseWireParams('team/artifact-list', teamArtifactListParamsSchema, params))
      case 'team/member-list':
        return this.listTeamMembers(parseWireParams('team/member-list', teamMemberListParamsSchema, params))
      case 'team/member-invite':
        return this.inviteTeamMemberWithCall(parseWireParams('team/member-invite', teamMemberInviteParamsSchema, params), call)
      case 'team/member-activate':
        return this.activateTeamMemberWithCall(parseWireParams('team/member-activate', teamMemberActivateParamsSchema, params), call)
      case 'team/member-remove':
        return this.removeTeamMemberWithCall(parseWireParams('team/member-remove', teamMemberRemoveParamsSchema, params), call)
      case 'team/member-interrupt':
        return this.interruptTeamMemberWithCall(parseWireParams('team/member-interrupt', teamMemberInterruptParamsSchema, params), call)
      case 'team/channel-catalog':
        return this.channelCatalogWithCall(parseWireParams('team/channel-catalog', teamChannelCatalogParamsSchema, params), call)
      case 'team/channel-summarize':
        return this.channelSummarizeWithCall(parseWireParams('team/channel-summarize', teamChannelSummarizeParamsSchema, params), call)
      case 'team/channel-list':
        return this.listTeamChannelsWithCall(parseWireParams('team/channel-list', teamChannelListParamsSchema, params), call)
      case 'team/channel-admission':
        return this.channelAdmissionWithCall(parseWireParams('team/channel-admission', teamChannelAdmissionParamsSchema, params), call)
      case 'team/channel-invitation':
        return this.channelInvitationWithCall(parseWireParams('team/channel-invitation', teamChannelInvitationParamsSchema, params), call)
      case 'team/channel-invitation-acknowledge':
        return this.channelInvitationAcknowledgeWithCall(parseWireParams('team/channel-invitation-acknowledge', teamChannelInvitationAcknowledgeParamsSchema, params), call)
      case 'team/channel-open':
        return this.openTeamChannelWithCall(parseWireParams('team/channel-open', teamChannelOpenParamsSchema, params), call)
      case 'team/channel-input':
        return this.inputTeamChannelWithCall(parseWireParams('team/channel-input', teamChannelInputParamsSchema, params), call)
      case 'team/channel-attachment':
        return this.readTeamChannelAttachmentWithCall(parseWireParams('team/channel-attachment', teamChannelAttachmentParamsSchema, params), call)
      case 'team/channel-post':
        return this.postTeamChannelWithCall(parseWireParams('team/channel-post', teamChannelPostParamsSchema, params), call)
      case 'team/channel-read':
        return this.readTeamChannel(parseWireParams('team/channel-read', teamChannelReadParamsSchema, params))
      case 'team/channel-close':
        return this.closeTeamChannelWithCall(parseWireParams('team/channel-close', teamChannelCloseParamsSchema, params), call)
      case 'team/channel-watch':
        return this.watchTeamChannel(parseWireParams('team/channel-watch', teamChannelWatchParamsSchema, params))
      case 'team/task-create':
        return this.createTeamTaskWithCall(parseWireParams('team/task-create', teamTaskCreateParamsSchema, params), call)
      case 'team/task-get':
        return this.getTeamTask(parseWireParams('team/task-get', teamTaskGetParamsSchema, params))
      case 'team/task-list':
        return this.listTeamTasks(parseWireParams('team/task-list', teamTaskListParamsSchema, params))
      case 'team/workflow-plan-list':
        return this.listWorkflowPlans(parseWireParams('team/workflow-plan-list', teamWorkflowPlanListParamsSchema, params))
      case 'team/task-update':
        return this.updateTeamTaskWithCall(parseWireParams('team/task-update', teamTaskUpdateParamsSchema, params), call)
      case 'team/task-cancel':
        return this.cancelTeamTaskWithCall(parseWireParams('team/task-cancel', teamTaskCancelParamsSchema, params), call)
      case 'team/task-delete':
        return this.deleteTeamTaskWithCall(parseWireParams('team/task-delete', teamTaskDeleteParamsSchema, params), call)
      case 'team/task-review':
        return this.reviewTeamTaskWithCall(parseWireParams('team/task-review', teamTaskReviewParamsSchema, params), call)
      case 'team/task-watch':
        return this.watchTeamTasks(parseWireParams('team/task-watch', teamTaskWatchParamsSchema, params))
      case 'team/resume':
        return this.resumeTeamWithCall(parseWireParams('team/resume', teamResumeParamsSchema, params), call)
      case 'team/wait-final':
        return this.waitForTeamFinalWithCall(parseWireParams('team/wait-final', teamWaitFinalParamsSchema, params), call)
      case 'team/cancel':
        return this.cancelTeamWithCall(parseWireParams('team/cancel', teamCancelParamsSchema, params), call)
      case 'team/archive':
        return this.archiveTeamWithCall(parseWireParams('team/archive', teamArchiveParamsSchema, params), call)
      case 'shutdown':
        parseWireParams('shutdown', shutdownParamsSchema, params ?? {})
        return this.shutdown(false)
      default:
        throw new Error(`unknown SDK runtime method: ${method}`)
    }
  }

  /** Run one post-initialization request through the retained connection lease. */
  private async withAuthenticatedProductCall<T>(
    operation: (call: AuthenticatedProductCall) => Promise<T>,
  ): Promise<T> {
    const lease = this.connectionLease
    if (lease === undefined) throw new SdkProductAuthenticationError('PRODUCT_AUTH_REQUIRED')
    try {
      return await lease.withCall(operation)
    } catch (error: unknown) {
      if (!(error instanceof ProductPrincipalError)) throw error
      if (this.connectionLease === lease) {
        this.connectionLease = undefined
        void lease.revoke().catch(() => undefined)
      }
      throw productAuthenticationError(error)
    }
  }

  /** Drop the retained connection lease only after any admitted request has settled. */
  private async releaseConnectionLease(): Promise<void> {
    const lease = this.connectionLease
    this.connectionLease = undefined
    if (lease !== undefined) await lease.revoke()
  }

  private hasAdapterFor(provider: string): boolean {
    return this.ctx.get('llm')?.listProviders().some(entry => entry.id === provider) ?? false
  }

  /** Materialize an accepted remote epoch and report the first published state. */
  private async materializeActivation(record: ActivationRecord): Promise<SdkActivationState> {
    try {
      const handle = record.seed.kind === 'fresh'
        ? await this.createFreshActivationAgent(record)
        : await this.resumeActivationAgent(record)
      record.handle = handle
      if (this.ctx.agents.get(handle.agent.id) !== handle.agent) {
        await handle.dispose()
        throw new SdkActivationError(
          `Activation '${record.target.activationId}' lost its Agent before publication completed`,
          'SDK_ACTIVATION_NOT_LIVE',
        )
      }
      return this.transitionActivation(record, handle.agent.status)
    } catch (error: unknown) {
      this.transitionActivation(record, 'offline')
      throw error
    }
  }

  /** Create a fresh durable Session with paired Team/Participant provenance. */
  private createFreshActivationAgent(record: ActivationRecord): Promise<AgentHandle> {
    const persistence: SessionPersistence | undefined = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      return Promise.reject(new SdkActivationError(
        'SDK activation requires session persistence to materialize Team provenance',
        'SDK_ACTIVATION_PERSISTENCE_REQUIRED',
      ))
    }
    const route = this.requireRoute()
    return this.ctx.agents.create({
      sessionId: SessionId(record.target.sessionId),
      meta: {
        cwd: this.cwd,
        teamId: record.target.teamId,
        participantId: record.target.participantId,
      },
      agentOptions: {
        provider: route.provider,
        model: route.model,
        ...route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens },
      },
      setup: async (agentCtx) => {
        const agent = agentCtx.agent
        if (agent === undefined) throw new Error('SDK activation creation setup has no scoped Agent')
        await persistence.materializeHeader(agent.session)
      },
    })
  }

  /** Resume one persisted Session only after proving its immutable provenance. */
  private resumeActivationAgent(record: ActivationRecord): Promise<AgentHandle> {
    const route = this.requireRoute()
    return this.ctx.agents.resume({
      resumeSessionId: SessionId(record.target.sessionId),
      agentOptions: {
        provider: route.provider,
        model: route.model,
        ...route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens },
      },
      setup: (agentCtx) => {
        const agent = agentCtx.agent
        if (agent === undefined) throw new Error('SDK activation resume setup has no scoped Agent')
        const { header } = agent.session
        if (header.teamId === record.target.teamId && header.participantId === record.target.participantId) return
        throw new SdkActivationError(
          `Session '${record.target.sessionId}' does not belong to Team participant '${record.target.participantId}'`,
          'SDK_ACTIVATION_PROVENANCE_MISMATCH',
        )
      },
    })
  }

  /**
   * Reject a generic Team write: its wire identifiers select durable subjects
   * but cannot prove that the caller holds Team authority.
   */
  private rejectUnauthenticatedTeamWrite(): Promise<never> {
    return Promise.reject(new SdkTeamError(
      'SDK Team management requires an authenticated human-proof route, but the mounted Team provider does not expose one.',
      'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE',
    ))
  }

  /** Return the configured runtime route or reject activation before side effects. */
  private requireRoute(): { provider: string; model: string; maxTokens: number | undefined } {
    if (this.provider === undefined || this.model === undefined) {
      throw new SdkActivationError(
        'SDK server is not initialized with a provider and model',
        'SDK_ACTIVATION_NOT_INITIALIZED',
      )
    }
    return { provider: this.provider, model: this.model, maxTokens: this.maxTokens }
  }

  /** Read one exact activation, rejecting an id that does not belong to this process. */
  private requireActivation(target: SdkActivationTarget): ActivationRecord {
    const record = this.activations.get(target.activationId)
    if (record === undefined) {
      throw new SdkActivationError(
        `Activation '${target.activationId}' was not found`,
        'SDK_ACTIVATION_NOT_FOUND',
      )
    }
    this.assertMatchingTarget(record, target)
    return record
  }

  /** Read one activation that still owns a published remote Agent. */
  private requireLiveActivation(target: SdkActivationTarget): ActivationRecord & { handle: AgentHandle } {
    const record = this.requireActivation(target)
    if (record.handle === undefined || record.status === 'starting' || record.status === 'stopping' || record.status === 'offline') {
      throw new SdkActivationError(
        `Activation '${target.activationId}' is not live`,
        'SDK_ACTIVATION_NOT_LIVE',
      )
    }
    if (this.ctx.agents.get(record.handle.agent.id) !== record.handle.agent) {
      this.transitionActivation(record, 'offline')
      throw new SdkActivationError(
        `Activation '${target.activationId}' is not live`,
        'SDK_ACTIVATION_NOT_LIVE',
      )
    }
    return record as ActivationRecord & { handle: AgentHandle }
  }

  /** Dispose one activation handle exactly once and emit terminal state only after it drains. */
  private async disposeActivationRecord(record: ActivationRecord): Promise<SdkActivationState> {
    if (record.status === 'offline') return this.activationState(record)
    record.disposal ??= this.releaseActivation(record)
    return await record.disposal
  }

  /** Await opening when necessary, then dispose only this activation's Agent. */
  private async releaseActivation(record: ActivationRecord): Promise<SdkActivationState> {
    if (record.opening !== undefined) await record.opening
    if (record.status === 'offline') return this.activationState(record)
    const handle = record.handle
    if (handle === undefined) {
      throw new SdkActivationError(
        `Activation '${record.target.activationId}' has no published Agent`,
        'SDK_ACTIVATION_NOT_LIVE',
      )
    }
    this.transitionActivation(record, 'stopping')
    const failures: unknown[] = []
    try {
      await this.closeLinkDelivery(record)
    } catch (error: unknown) {
      failures.push(error)
    }
    try {
      await handle.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, `SDK activation '${record.target.activationId}' release failed`)
    return this.transitionActivation(record, 'offline')
  }

  /** Close the child delivery before its Agent or dynamic credential can outlive the activation. */
  private async closeLinkDelivery(record: ActivationRecord): Promise<void> {
    const current = record.linkDelivery
    if (current === undefined) return
    record.linkDelivery = undefined
    const failures: unknown[] = []
    try {
      await current.delivery.close()
    } catch (error: unknown) {
      failures.push(error)
    }
    try {
      current.unregister()
    } catch (error: unknown) {
      failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, `SDK activation '${record.target.activationId}' Team Link close failed`)
  }

  /** Find the activation whose exact published Agent emitted a lifecycle edge. */
  private activationForAgent(agent: Agent): ActivationRecord | undefined {
    for (const record of this.activations.values()) {
      if (record.handle?.agent === agent) return record
    }
    return undefined
  }

  /** Current resident activation for an exact Team participant pair. */
  private activationParticipant(target: SdkActivationTarget): ActivationRecord | undefined {
    return this.activationParticipants.get(target.teamId)?.get(target.participantId)
  }

  /** Install one resident activation without concatenating opaque identifiers. */
  private setActivationParticipant(record: ActivationRecord): void {
    let participants = this.activationParticipants.get(record.target.teamId)
    if (participants === undefined) {
      participants = new Map()
      this.activationParticipants.set(record.target.teamId, participants)
    }
    participants.set(record.target.participantId, record)
  }

  /** Remove only the exact terminal activation from residency indexes. */
  private releaseActivationResidency(record: ActivationRecord): void {
    if (this.activationSessions.get(record.target.sessionId) === record) {
      this.activationSessions.delete(record.target.sessionId)
    }
    const participants = this.activationParticipants.get(record.target.teamId)
    if (participants?.get(record.target.participantId) !== record) return
    participants.delete(record.target.participantId)
    if (participants.size === 0) this.activationParticipants.delete(record.target.teamId)
  }

  /** Verify retry/status/disposal identity against the original accepted target. */
  private assertMatchingTarget(record: ActivationRecord, target: SdkActivationTarget): void {
    if (record.target.teamId === target.teamId
      && record.target.participantId === target.participantId
      && record.target.sessionId === target.sessionId) return
    throw new SdkActivationError(
      `Activation '${target.activationId}' target does not match its accepted Team, participant, and Session`,
      'SDK_ACTIVATION_TARGET_MISMATCH',
    )
  }

  /** Return a detached immutable exact activation state. */
  private activationState(record: ActivationRecord): SdkActivationState {
    return Object.freeze({ ...record.target, status: record.status, statusSequence: record.statusSequence })
  }

  /** Record and notify a real lifecycle edge, leaving duplicate reports silent. */
  private transitionActivation(record: ActivationRecord, status: SdkActivationStatus): SdkActivationState {
    if (record.status === status) return this.activationState(record)
    if (record.status === 'offline') return this.activationState(record)
    record.status = status
    record.statusSequence += 1
    if (status === 'offline') this.releaseActivationResidency(record)
    const state = this.activationState(record)
    this.transport.notify('activation.status', { state })
    return state
  }

  /** Notify the first reserved `starting` state before publication work begins. */
  private notifyActivation(record: ActivationRecord): void {
    this.transport.notify('activation.status', { state: this.activationState(record) })
  }

  /** Whether any epoch is still resident and therefore pins the initialized route. */
  private hasResidentActivation(): boolean {
    return this.activationSessions.size > 0
  }
}

/** Freeze a wire target before using it as a long-lived map identity. */
function freezeTarget(target: SdkActivationTarget): SdkActivationTarget {
  return Object.freeze({ ...target })
}

/** Freeze a parsed seed so a retry comparison has no caller-owned aliases. */
function freezeSeed(seed: SdkActivationSeed): SdkActivationSeed {
  return Object.freeze({ ...seed })
}

/** Compare the closed seed union by its only current discriminant. */
function sameSeed(left: SdkActivationSeed, right: SdkActivationSeed): boolean {
  return left.kind === right.kind
}

/** Confirm a post-bind Link identity repeats the already-owned activation target. */
function sameLinkTarget(target: SdkActivationTarget, binding: ActivationLinkEnrollParams['binding']): boolean {
  return target.activationId === binding.activationId
    && target.teamId === binding.teamId
    && target.participantId === binding.participantId
    && target.sessionId === binding.sessionId
}

/** Compare one immutable Link binding while leaving mutable residency status outside its identity. */
function sameLinkBinding(left: ActivationBindingSnapshot, right: ActivationBindingSnapshot): boolean {
  return left.activation.id === right.activation.id
    && left.activation.teamId === right.activation.teamId
    && left.activation.participantId === right.activation.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
}

/** Retain comparison material for an opaque credential without retaining its plaintext value. */
function enrollmentFingerprint(params: ActivationLinkEnrollParams): LinkEnrollmentFingerprint {
  return {
    provider: params.enrollment.provider,
    endpoint: params.enrollment.endpoint,
    capabilityHash: createHash('sha256').update(params.enrollment.capability).digest('hex'),
  }
}

/** Compare two post-bind enrollment configurations without re-exposing credential data. */
function sameEnrollment(left: LinkEnrollmentFingerprint, right: LinkEnrollmentFingerprint): boolean {
  return left.provider === right.provider
    && left.endpoint === right.endpoint
    && left.capabilityHash === right.capabilityHash
}

/** Parse the strict actor-free SDK terminal archive as its canonical Hub input. */
function sdkTeamArchiveInput(params: TeamArchiveParams): TeamArchiveInput {
  return teamArchiveInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    expectedCursor: params.expectedCursor,
  })
}

/** Bind the complete parsed terminal archive to an authenticated human proof. */
function humanTeamArchiveProofInput(input: TeamArchiveInput): TeamHumanActorProofInput {
  return {
    teamId: input.teamId,
    operation: 'close',
    fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Parse the strict actor-free SDK Team resume as its canonical Hub input. */
function sdkTeamResumeInput(params: TeamResumeParams): TeamResumeInput {
  return teamResumeInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    expectedCursor: params.expectedCursor,
  })
}

/** Bind the complete parsed Team resume to an authenticated human proof. */
function humanTeamResumeProofInput(input: TeamResumeInput): TeamHumanActorProofInput {
  return {
    teamId: input.teamId,
    operation: 'activate',
    fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Parse the strict actor-free SDK Team objective update as its canonical Hub input. */
function sdkTeamGoalUpdateInput(params: TeamGoalUpdateParams): TeamGoalUpdateInput {
  return teamGoalUpdateInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    expectedRevision: params.expectedRevision,
    ...params.objective === undefined ? {} : { objective: params.objective },
    ...params.budgets === undefined ? {} : { budgets: jsonObjectSchema.parse(structuredClone(params.budgets)) },
  })
}

/** Parse the strict actor-free SDK Team objective transition as its canonical Hub input. */
function sdkTeamGoalTransitionInput(params: TeamGoalTransitionParams): TeamGoalPhaseTransitionInput {
  return teamGoalPhaseTransitionInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    expectedRevision: params.expectedRevision,
    phase: params.phase,
    ...params.blocker === undefined ? {} : { blocker: structuredClone(params.blocker) },
  })
}

/** Bind a complete parsed Team objective mutation to an authenticated human proof. */
function humanTeamGoalProofInput(
  input: TeamGoalUpdateInput | TeamGoalPhaseTransitionInput,
): TeamHumanActorProofInput {
  return {
    teamId: input.teamId,
    operation: 'goal-mutate',
    fence: { kind: 'revision', revision: input.expectedRevision },
    payload: jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Parse the complete actor-free SDK task creation as its canonical Hub input. */
function sdkTaskCreateInput(params: TeamTaskCreateParams): TeamTaskCreateInput {
  return teamTaskCreateInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    expectedCursor: params.expectedCursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(params.idempotencyKey) },
    ...params.parentTaskId === undefined ? {} : { parentTaskId: teamTaskIdSchema.parse(params.parentTaskId) },
    subject: params.subject,
    description: params.description,
    ...params.integration === undefined ? {} : { integration: structuredClone(params.integration) },
    blockedBy: params.blockedBy.map(taskId => teamTaskIdSchema.parse(taskId)),
    requiredCapabilities: params.requiredCapabilities,
    priority: params.priority,
    readScopes: params.readScopes,
    writeScopes: params.writeScopes,
    workspaceMode: params.workspaceMode,
    budget: jsonObjectSchema.parse(structuredClone(params.budget)),
    reviewPolicy: structuredClone(params.reviewPolicy),
    maxAttempts: params.maxAttempts,
  })
}

/** Parse one exact actor-free SDK task-details update as its canonical Hub input. */
function sdkTaskUpdateInput(params: TeamTaskUpdateParams): TeamTaskDetailsUpdateInput {
  return teamTaskDetailsUpdateInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    taskId: teamTaskIdSchema.parse(params.taskId),
    expectedRevision: params.expectedRevision,
    ...params.subject === undefined ? {} : { subject: params.subject },
    ...params.description === undefined ? {} : { description: params.description },
    ...params.blockedBy === undefined ? {} : { blockedBy: params.blockedBy.map(taskId => teamTaskIdSchema.parse(taskId)) },
  })
}

/** Parse one exact actor-free SDK task cancellation as its canonical Hub input. */
function sdkTaskCancelInput(params: TeamTaskCancelParams): TeamTaskCancelInput {
  return teamTaskCancelInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    taskId: teamTaskIdSchema.parse(params.taskId),
    expectedRevision: params.expectedRevision,
    ...params.reason === undefined ? {} : { reason: params.reason },
  })
}

/** Parse one exact actor-free SDK task tombstone as its canonical Hub input. */
function sdkTaskDeleteInput(params: TeamTaskDeleteParams): TeamTaskDeleteInput {
  return teamTaskDeleteInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    taskId: teamTaskIdSchema.parse(params.taskId),
    expectedRevision: params.expectedRevision,
  })
}

/** Parse one actor-free SDK review without accepting a caller-selected reviewer identity. */
function sdkTaskReviewInput(params: TeamTaskReviewParams): TeamTaskReviewResolveInput {
  return teamTaskReviewResolveInputSchema.parse({
    taskId: teamTaskIdSchema.parse(params.taskId),
    expectedRevision: params.expectedRevision,
    nextPhase: params.decision === 'accepted' ? 'completed' : 'pending',
    reason: params.reason,
  })
}

/** Bind the complete parsed task creation to an authenticated human proof. */
function humanTaskCreateProofInput(input: TeamTaskCreateInput): TeamHumanActorProofInput {
  return {
    teamId: input.teamId,
    operation: 'task-mutate',
    fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Bind a complete parsed revision-fenced task mutation to an authenticated human proof. */
function humanTaskRevisionProofInput(
  input: TeamTaskDetailsUpdateInput | TeamTaskCancelInput | TeamTaskDeleteInput,
): TeamHumanActorProofInput {
  return {
    teamId: input.teamId,
    operation: 'task-mutate',
    fence: { kind: 'revision', revision: input.expectedRevision },
    payload: jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Bind the server-selected Team plus complete parsed review facts to an authenticated human proof. */
function humanTaskReviewProofInput(teamId: TeamId, input: TeamTaskReviewResolveInput): TeamHumanActorProofInput {
  return {
    teamId,
    operation: 'task-mutate',
    fence: { kind: 'revision', revision: input.expectedRevision },
    payload: jsonObjectSchema.parse({ teamId, ...structuredClone(input) }),
  }
}

/** Parse the complete actor-free SDK member invitation as its canonical Hub input. */
function sdkMemberInviteInput(params: TeamMemberInviteParams): ParticipantInviteInput {
  return participantInviteInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    expectedCursor: params.expectedCursor,
    kind: params.kind,
    displayName: params.displayName,
    role: params.role,
    capabilities: params.capabilities,
    ...params.provider === undefined ? {} : { provider: params.provider },
    ...params.preset === undefined ? {} : { preset: params.preset },
    ...params.model === undefined ? {} : { model: params.model },
    ...params.authScheme === undefined ? {} : { authScheme: params.authScheme },
  })
}

/** Parse one exact member phase transition selected by the actor-free SDK wire. */
function sdkMemberPhaseInput(
  params: TeamMemberActivateParams | TeamMemberRemoveParams,
  phase: 'active' | 'left',
): ParticipantPhaseTransitionInput {
  return participantPhaseTransitionInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    participantId: participantIdSchema.parse(params.participantId),
    expectedCursor: params.expectedCursor,
    phase,
  })
}

/** Parse one exact member interrupt selected by the actor-free SDK wire. */
function sdkMemberInterruptInput(params: TeamMemberInterruptParams): ParticipantInterruptRequestInput {
  return participantInterruptRequestInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    participantId: participantIdSchema.parse(params.participantId),
    expectedCursor: params.expectedCursor,
  })
}

/** Parse one generic non-workflow channel opening selected by the actor-free SDK wire. */
function sdkChannelOpenInput(params: TeamChannelOpenParams): ChannelOpenInput {
  return channelOpenInputSchema.parse({
    teamId: teamIdSchema.parse(params.teamId),
    expectedCursor: params.expectedCursor,
    adapter: params.adapter,
    ...params.viewPolicy === undefined ? {} : { viewPolicy: params.viewPolicy },
    participants: params.participants,
    limits: jsonObjectSchema.parse(structuredClone(params.limits)),
  })
}

/** Parse one exact channel close selected by the actor-free SDK wire. */
function sdkChannelCloseInput(params: TeamChannelCloseParams): ChannelCloseInput {
  return channelCloseInputSchema.parse({
    channelId: channelIdSchema.parse(params.channelId),
    expectedCursor: params.expectedCursor,
    ...params.reason === undefined ? {} : { reason: params.reason },
  })
}

/** Bind every parsed invitation field to its human proof. */
function humanMemberInviteProofInput(input: ParticipantInviteInput): TeamHumanActorProofInput {
  return {
    teamId: input.teamId,
    operation: 'invite',
    fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Bind every parsed member phase field to its human proof. */
function humanMemberPhaseProofInput(
  input: ParticipantPhaseTransitionInput,
  operation: 'activate' | 'close',
): TeamHumanActorProofInput {
  return {
    teamId: input.teamId,
    operation,
    fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Bind every parsed member interrupt field to its human proof. */
function humanMemberInterruptProofInput(input: ParticipantInterruptRequestInput): TeamHumanActorProofInput {
  return {
    teamId: input.teamId,
    operation: 'interrupt',
    fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Bind every parsed generic channel-open field to its human proof. */
function humanChannelOpenProofInput(input: ChannelOpenInput): TeamHumanActorProofInput {
  return {
    teamId: input.teamId,
    operation: 'channel-open',
    fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Bind the server-resolved close channel Team and every parsed close field to its human proof. */
function humanChannelCloseProofInput(teamId: TeamId, input: ChannelCloseInput): TeamHumanActorProofInput {
  return {
    teamId,
    operation: 'close',
    fence: { kind: 'cursor', cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(structuredClone(input)),
  }
}

/** Parse the complete actor-free SDK channel post as its canonical Hub input. */
function sdkChannelPostInput(params: TeamChannelPostParams): ChannelEnvelopePostInput {
  return {
    expectedCursor: params.expectedCursor,
    ...params.idempotencyKey === undefined ? {} : {
      idempotencyKey: channelPostIdempotencyKeySchema.parse(params.idempotencyKey),
    },
    draft: {
      channelId: channelIdSchema.parse(params.channelId),
      audience: params.audience === null ? null : params.audience.map(participantId => participantIdSchema.parse(participantId)),
      kind: params.kind,
      payload: jsonObjectSchema.parse(structuredClone(params.payload)),
      delivery: params.delivery,
      ...params.priority === undefined ? {} : { priority: params.priority },
      ...params.causationId === undefined ? {} : { causationId: envelopeIdSchema.parse(params.causationId) },
      ...params.correlationId === undefined ? {} : { correlationId: params.correlationId },
      ...params.taskId === undefined ? {} : { taskId: teamTaskIdSchema.parse(params.taskId) },
      ...params.traceId === undefined ? {} : { traceId: params.traceId },
      ...params.ttlMs === undefined ? {} : { ttlMs: params.ttlMs },
    },
  }
}


/** Restrict product ingress to the direct v3 human text/image vocabulary before creating a Team. */
function parseTeamContent(contentBlocks: ContentBlock[]): readonly DirectChannelHumanContentBlock[] {
  try {
    const payload = { content: contentBlocks } as unknown as Parameters<typeof parseDirectChannelV3MessagePayload>[0]
    return parseDirectChannelV3MessagePayload(payload).content
  } catch (error: unknown) {
    throw new JsonRpcRequestError(-32_602, 'invalid team/create content', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Parse untrusted request parameters into one strict activation payload. */
function parseWireParams<T>(method: string, schema: ZodType<T>, params: unknown): T {
  const parsed = schema.safeParse(params)
  if (parsed.success) return parsed.data
  throw new JsonRpcRequestError(-32_602, `invalid ${method} params`, {
    issues: parsed.error.issues.map(issue => ({ path: issue.path, message: issue.message })),
  })
}

/** Convert every credential-bound failure into a safe stable SDK authentication error. */
function productAuthenticationError(error: unknown): SdkProductAuthenticationError {
  if (error instanceof ProductPrincipalError && error.code === 'PRODUCT_AUTH_REQUIRED') {
    return new SdkProductAuthenticationError('PRODUCT_AUTH_REQUIRED')
  }
  return new SdkProductAuthenticationError('PRODUCT_AUTH_INVALID')
}
