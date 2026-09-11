/**
 * SDK-backed AgentRuntime provider. Each accepted remote Participant epoch
 * owns a fresh SDK runtime subprocess, its complete wire target, and the
 * process teardown that follows remote disposal.
 * @module @clocky/clocky-agent-runtime-sdk
 */

import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@clocky/cordis'
import type {} from '@clocky/clocky-activation-supervisor'
import z from '@clocky/schemastery'
import { AgentRuntimeTerminationUnconfirmedError } from '@clocky/clocky-agent-runtime'
import type {
  ActivationHandle,
  AgentRuntimeActivationRequest,
  AgentRuntimeFencer,
  AgentRuntimeProvider,
} from '@clocky/clocky-agent-runtime'
import {
  parseActivationStatusNotification,
  TransportClosedError,
} from '@clocky/clocky-sdk-client'
import type {
  HarnessClientOptions,
  SdkActivationState,
  SdkActivationTarget,
} from '@clocky/clocky-sdk-client'
import { scrubbedParentEnv } from '@clocky/clocky-subprocess'
import { createProcessInspector } from '@clocky/clocky-subprocess-local'
import type { ProcessIdentity, ProcessInspector } from '@clocky/clocky-subprocess-local'
import { activationIdSchema, activationRecoverySnapshotSchema, assertActivationStatusTransition } from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, ActivationRecoverySnapshot, ActivationSnapshot, ActivationStatus, TeamEvent } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team'
import type { TeamLinkEnrollment } from '@clocky/clocky-team-link'
import type {} from '@clocky/clocky-team-link'
import {
  harnessSdkActivationClientFactory,
  type SdkActivationClient,
  type SdkActivationClientFactory,
} from './client.ts'
import { AgentRuntimeSdkError } from './error.ts'

export { AgentRuntimeSdkError } from './error.ts'
export type { AgentRuntimeSdkErrorCode } from './error.ts'
export type { SdkActivationClient, SdkActivationClientFactory } from './client.ts'

/** Cordis plugin name. */
export const name = 'agent-runtime-sdk'
/** The activation registry must exist before this provider registers itself. */
export const inject = ['agentRuntimes']

/** Node's largest safe timer delay; larger values overflow into immediate timers. */
const MAX_TIMER_DELAY_MS = 2_147_483_647
/** Default bound on the protocol shutdown exchange during child-process disposal. */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000
/** Default EOF grace while a child flushes and tears down its own resources. */
const DEFAULT_DISPOSE_EOF_GRACE_MS = 6_000
/** Default termination-confirmation grace after process shutdown escalation. */
const DEFAULT_DISPOSE_GRACE_MS = 3_000
/** Default bounded wait after each stale child-process termination tier. */
const DEFAULT_RECOVERY_FENCE_GRACE_MS = 1_000

/** Deployment configuration for the SDK remote-placement provider. */
export interface Config {
  /** Provider name registered on `ctx.agentRuntimes`. */
  readonly providerName: string
  /** Executable started for every accepted remote activation. */
  readonly command: string
  /** Arguments passed to {@link command}. */
  readonly args: string[]
  /** Working directory for both the child process and its SDK initialization. */
  readonly cwd: string
  /** Explicit child environment layered onto a credential-scrubbed parent environment. */
  readonly env: Record<string, string>
  /** Opaque product credential sent only in the child SDK initialization handshake. */
  readonly credential?: string
  /** Per-request SDK protocol deadline; omitted means the SDK client waits without a deadline. */
  readonly requestTimeoutMs?: number
  /** Bound on the SDK protocol shutdown request during disposal. */
  readonly shutdownTimeoutMs?: number
  /** Grace after stdin EOF before the SDK client starts process termination. */
  readonly disposeEofGraceMs?: number
  /** Process termination-confirmation grace used by the SDK client. */
  readonly disposeGraceMs?: number
  /** Dynamic Team Link enrollment provider used after the Hub commits an activation binding. */
  readonly teamLinkEnrollmentProvider?: string
  /** Explicit non-secret SDK runtime profile required to cold-replace a persisted activation. */
  readonly recoveryProfile?: string
  /** Stable identity of the local host allowed to fence and replace the runtime child. */
  readonly recoveryHostId?: string
  /** Maximum wait after each stale-child termination tier during cold replacement. */
  readonly recoveryFenceGraceMs?: number
  /** Supervisor implementation advertising this owned process to remote recovery consumers. */
  readonly recoverySupervisor?: {
    /** Stable supervisor implementation name. */
    readonly name: string
    /** Supervisor protocol version required by the persisted descriptor. */
    readonly version: number
    /** Non-secret endpoint identity selected by the deployment. */
    readonly endpointId: string
  } | undefined
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default('sdk'),
  command: z.string().min(1).required(),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1).required(),
  env: z.dict(z.string()).default({}),
  credential: z.string().min(1),
  requestTimeoutMs: z.number().max(MAX_TIMER_DELAY_MS),
  shutdownTimeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
  disposeEofGraceMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_DISPOSE_EOF_GRACE_MS),
  disposeGraceMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_DISPOSE_GRACE_MS),
  teamLinkEnrollmentProvider: z.string().min(1),
  recoveryProfile: z.string().min(1),
  recoveryHostId: z.string().min(1),
  recoveryFenceGraceMs: z.number().max(MAX_TIMER_DELAY_MS),
  recoverySupervisor: z.union([
    z.const(undefined),
    z.object({
      name: z.string().min(1).required(), version: z.number().step(1).min(1).required(), endpointId: z.string().min(1).required(),
    }),
  ]),
})

/** Configuration after the Loader applied all time-bound defaults. */
type ResolvedConfig = Required<Omit<Config, 'requestTimeoutMs' | 'credential' | 'teamLinkEnrollmentProvider' | 'recoveryProfile' | 'recoveryHostId' | 'recoverySupervisor'>>
  & Pick<Config, 'requestTimeoutMs' | 'credential' | 'teamLinkEnrollmentProvider' | 'recoveryProfile' | 'recoveryHostId' | 'recoverySupervisor'>
  & { readonly recovery?: SdkLocalRecoveryConfig | undefined }

/** Validated local-only recovery settings selected as one atomic deployment choice. */
interface SdkLocalRecoveryConfig {
  /** Required profile id that the recovery owner compares before resuming. */
  readonly profile: string
  /** Host identity that owns both the recorded process and this fencer. */
  readonly hostId: string
  /** Bounded wait after graceful and forced stale-child termination. */
  readonly fenceGraceMs: number
}

/** A provider whose admission can close while its accepted handles remain live. */
export interface SdkAgentRuntimeProvider extends AgentRuntimeProvider {
  /** Stop accepting new activation requests without revoking returned handles. */
  closeAdmission(): void
  /** Trusted stale-child fencer when local cold replacement is explicitly configured. */
  readonly fencer?: AgentRuntimeFencer | undefined
}

/** One concurrent or resident provider-owned activation entry. */
class ActivationEntry {
  /** Shared materialization for duplicate requests while this exact epoch remains live. */
  operation!: Promise<ActivationHandle>

  /** @param sessionId - Session reserved for this Team participant epoch. */
  constructor(readonly sessionId: ActivationHandle['sessionId']) {}
}

/** Hub-owned issuer selected for one remote activation's Link credentials. */
interface EnrollmentReservation {
  /** Stable issuer registry name used to notice listener replacement. */
  readonly provider: string
  /** Reserve one credential against the issuer currently registered under {@link provider}. */
  reserve(binding: ActivationBindingSnapshot): Promise<TeamLinkEnrollment>
}

/** One subscription reader that buffers pre-publication remote status states. */
class StatusBridge {
  private active = true
  private handle: RemoteActivationHandle | undefined
  private readonly pending: SdkActivationState[] = []
  private failure: Error | undefined
  private latest: SdkActivationState | undefined

  /**
   * @param subscription - raw SDK notification subscription for this child process.
   * @param target - complete immutable remote epoch identity.
   */
  constructor(
    private readonly subscription: ReturnType<SdkActivationClient['subscribe']>,
    private readonly target: SdkActivationTarget,
  ) {
    void this.consume()
  }

  /** Reject a terminal pre-publication state before a caller can own its handle. */
  assertPublishable(initial: SdkActivationState): void {
    if (this.failure !== undefined) throw this.failure
    assertInitialStatus(initial.status)
    if (this.latest === undefined || this.latest.statusSequence < initial.statusSequence) return
    if (this.latest.statusSequence === initial.statusSequence && this.latest.status === initial.status) return
    if (this.latest.statusSequence > initial.statusSequence) {
      assertInitialStatus(this.latest.status)
      return
    }
    throw new AgentRuntimeSdkError(
      `SDK runtime reported conflicting status sequence ${initial.statusSequence} for activation '${this.target.activationId}'`,
      'AGENT_RUNTIME_SDK_STATUS_INVALID',
    )
  }

  /** Attach the published handle and replay only states observed before publication. */
  bind(handle: RemoteActivationHandle): void {
    this.handle = handle
    for (const state of this.pending.splice(0)) handle.observeRemote(state)
  }

  /** Stop notification delivery before the client process is closed. */
  stop(): void {
    // v8 ignore next -- no public callback can re-enter after the first close clears its subscription.
    if (!this.active) return
    this.active = false
    this.subscription.close()
  }

  /** Read raw notifications until the subscription closes or transport fails. */
  private async consume(): Promise<void> {
    try {
      for (;;) {
        const notification = await this.subscription.next()
        const parsed = parseActivationStatusNotification(notification)
        if (parsed === undefined) continue
        assertRemoteTarget(parsed.state, this.target)
        this.record(parsed.state)
        if (this.handle === undefined) this.pending.push(parsed.state)
        else this.handle.observeRemote(parsed.state)
      }
    } catch (error: unknown) {
      if (!this.active) return
      this.failure = toError(error)
      this.handle?.transportLost(this.failure)
    }
  }

  /** Retain only monotonic pre-publication status evidence for the eventual handle. */
  private record(state: SdkActivationState): void {
    if (this.latest === undefined || state.statusSequence > this.latest.statusSequence) {
      this.latest = state
      return
    }
    if (state.statusSequence < this.latest.statusSequence || state.status === this.latest.status) return
    throw new AgentRuntimeSdkError(
      `SDK runtime reported conflicting status sequence ${state.statusSequence} for activation '${this.target.activationId}'`,
      'AGENT_RUNTIME_SDK_STATUS_INVALID',
    )
  }
}

/** One caller-owned remote activation handle and its child SDK process. */
class RemoteActivationHandle implements ActivationHandle {
  /** SDK placement never publishes a same-process Agent. */
  readonly localAgent = undefined

  private readonly statusListeners = new Set<(activation: ActivationSnapshot) => void>()
  private status: ActivationSnapshot['status']
  private statusSequence: number
  private offline = false
  private disposing = false
  private terminationUnconfirmed: AgentRuntimeTerminationUnconfirmedError | undefined
  private released = false
  private disposal: Promise<void> | undefined
  private processClose: Promise<void> | undefined
  private linkEnrollment: TeamLinkEnrollment | undefined
  private initialLinkEnrollment: Promise<void> | undefined
  private linkEnrollmentTail = Promise.resolve()
  private readonly linkRevocations = new Set<Promise<void>>()

  /**
   * @param client - client that owns this activation's child runtime process.
   * @param target - complete immutable remote epoch identity.
   * @param bridge - status subscription stopped before client-process teardown.
   * @param onEnded - release the provider's duplicate-admission slot once.
   * @param onWarning - contained diagnostic sink.
   * @param initial - published remote state returned by `activation/open`.
   */
  constructor(
    private readonly client: SdkActivationClient,
    private readonly target: SdkActivationTarget,
    private readonly bridge: StatusBridge,
    private readonly onEnded: () => void,
    private readonly onWarning: (message: string) => void,
    initial: SdkActivationState,
    readonly activation: ActivationHandle['activation'],
    readonly sessionId: ActivationHandle['sessionId'],
    readonly recovery: ActivationHandle['recovery'],
  ) {
    this.status = initial.status
    this.statusSequence = initial.statusSequence
  }

  /** Read the latest remote status unless this handle is stopping or terminal. */
  async health(): Promise<ActivationSnapshot> {
    if (this.terminationUnconfirmed !== undefined) throw this.terminationUnconfirmed
    if (this.offline || this.disposing) return this.statusSnapshot()
    try {
      const state = await this.client.getActivationStatus({ target: this.target })
      this.observeRemote(state)
    } catch (error: unknown) {
      if (isTransportLoss(error)) {
        this.transportLost(toError(error))
        await this.disposal
      } else {
        this.protocolViolation(toError(error))
        throw error
      }
    }
    return this.statusSnapshot()
  }

  /** Subscribe to later status changes without replaying the current snapshot. */
  onStatus(listener: (activation: ActivationSnapshot) => void): () => void {
    if (this.offline) return () => {}
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  /** Forward an interruption request to the exact remote epoch. */
  interrupt(cause: Parameters<ActivationHandle['interrupt']>[0]): void {
    if (this.offline || this.disposing) return
    try {
      void this.client.interruptActivation({ target: this.target, cause }).catch((error: unknown) => {
        if (isTransportLoss(error)) this.transportLost(toError(error))
        else this.warn(`remote interruption failed: ${renderError(error)}`)
      })
    } catch (error: unknown) {
      if (isTransportLoss(error)) this.transportLost(toError(error))
      else this.warn(`remote interruption failed: ${renderError(error)}`)
    }
  }

  /** Dispose the remote epoch and then reap its dedicated runtime process. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    if (this.offline) {
      this.disposal = this.closeOffline()
      return this.disposal
    }
    this.disposal = this.disposeOwned()
    return this.disposal
  }

  /** Enroll one fixed remote Link only after a matching durable binding exists. */
  enrollLink(
    binding: ActivationBindingSnapshot,
    reserve: () => Promise<TeamLinkEnrollment>,
  ): Promise<void> {
    if (!this.canEnrollLink() || this.linkEnrollment !== undefined) return Promise.resolve()
    this.initialLinkEnrollment ??= this.queueLinkEnrollment(async () => {
      if (!this.canEnrollLink() || this.linkEnrollment !== undefined) return
      await this.enrollLinkOwned(binding, reserve)
    })
    return this.initialLinkEnrollment
  }

  /** Replace an invalidated issuer credential while this exact activation remains live. */
  renewLink(
    binding: ActivationBindingSnapshot,
    reserve: () => Promise<TeamLinkEnrollment>,
  ): Promise<void> {
    if (!this.canEnrollLink() || this.linkEnrollment === undefined) return Promise.resolve()
    return this.queueLinkEnrollment(async () => {
      if (!this.canEnrollLink() || this.linkEnrollment === undefined) return
      await this.enrollLinkOwned(binding, reserve)
    })
  }

  /** Accept one protocol state only when it belongs to this epoch and is newer. */
  observeRemote(state: SdkActivationState): void {
    // v8 ignore next -- an offline handle stops the sole subscription before any later notification can reach it.
    if (this.offline) return
    assertRemoteTarget(state, this.target)
    if (state.statusSequence < this.statusSequence) return
    if (state.statusSequence === this.statusSequence) {
      if (state.status === this.status) return
      throw new AgentRuntimeSdkError(
        `SDK runtime reported conflicting status sequence ${state.statusSequence} for activation '${this.target.activationId}'`,
        'AGENT_RUNTIME_SDK_STATUS_INVALID',
      )
    }
    assertStatusTransition(this.status, state.status)
    this.statusSequence = state.statusSequence
    if (state.status === 'offline') {
      // v8 ignore next -- disposal stops the sole subscription synchronously before its remote RPC can await.
      if (this.disposing) return
      this.bridge.stop()
      this.finishOffline()
      void this.closeProcess().catch((error: unknown) => {
        this.warn(`remote runtime close after offline status failed: ${renderError(error)}`)
      })
      return
    }
    // v8 ignore next -- disposal stops the sole subscription synchronously before its remote RPC can await.
    if (!this.disposing) this.reportStatus(state.status)
  }

  /** Mark the handle terminal after an unexpected SDK transport failure. */
  transportLost(error: Error): void {
    // v8 ignore next -- the sole subscription cannot signal a terminal edge after it was stopped or this handle went offline.
    if (this.offline || this.disposing) return
    this.warn(`remote activation transport closed: ${error.message}`)
    this.beginTerminationAfterLoss(error)
  }

  /** Fail the activation after a post-bind remote Link enrollment rejection. */
  linkEnrollmentFailed(error: Error): void {
    this.protocolViolation(error)
  }

  /** Fail closed after a malformed target, sequence, or lifecycle transition. */
  private protocolViolation(error: Error): void {
    // v8 ignore next -- health is the only public caller and returns before a terminal or disposing handle reads the wire.
    if (this.offline || this.disposing) return
    this.warn(`remote activation protocol violation: ${error.message}`)
    this.beginTerminationAfterLoss(error)
  }

  /** Stop the owned runtime after a lost remote observation, publishing offline only after process teardown proves it stopped. */
  private beginTerminationAfterLoss(reason: Error): void {
    this.disposing = true
    this.bridge.stop()
    const termination = (async (): Promise<void> => {
      try {
        await this.closeProcess()
      } catch (error: unknown) {
        this.reportStatus('stopping')
        throw this.markTerminationUnconfirmed(new AggregateError(
          [reason, error],
          `SDK activation '${this.target.activationId}' lost transport and its process termination was not confirmed`,
        ))
      }
      this.finishOffline()
    })()
    this.disposal ??= termination
    void termination.catch(() => {})
  }

  /** Run the caller-visible stopping → remote disposal → process close → offline sequence. */
  private async disposeOwned(): Promise<void> {
    this.disposing = true
    this.reportStatus('stopping')
    this.bridge.stop()
    const failures: unknown[] = []
    let remoteOffline = false
    let processClosed = false
    try {
      await this.revokeLinkEnrollment()
    } catch (error: unknown) {
      failures.push(error)
    }
    try {
      const state = await this.client.disposeActivation({ target: this.target })
      assertRemoteTarget(state, this.target)
      if (state.status !== 'offline') {
        throw new AgentRuntimeSdkError(
          `SDK runtime disposed activation '${this.target.activationId}' without an offline status`,
          'AGENT_RUNTIME_SDK_STATUS_INVALID',
        )
      }
      assertStatusTransition(this.status, state.status)
      if (state.statusSequence > this.statusSequence) this.statusSequence = state.statusSequence
      remoteOffline = true
    } catch (error: unknown) {
      failures.push(error)
    }
    try {
      await this.closeProcess()
      processClosed = true
    } catch (error: unknown) {
      failures.push(error)
    }
    if (remoteOffline || processClosed) {
      this.finishOffline()
      for (const failure of failures) {
        this.warn(`remote activation cleanup failed after termination was proven: ${renderError(failure)}`)
      }
      return
    }
    throw this.markTerminationUnconfirmed(new AggregateError(
      failures,
      `SDK activation '${this.target.activationId}' termination could not be confirmed`,
    ))
  }

  /** Revoke any post-bind credential before waiting for an already-offline child process. */
  private async closeOffline(): Promise<void> {
    const failures: unknown[] = []
    try {
      await this.revokeLinkEnrollment()
    } catch (error: unknown) {
      failures.push(error)
    }
    try {
      await this.closeProcess()
    } catch (error: unknown) {
      failures.push(error)
    }
    for (const failure of failures) {
      this.warn(`remote activation cleanup failed after offline termination proof: ${renderError(failure)}`)
    }
  }

  /** Close the one child process, memoizing a single client-level teardown operation. */
  private closeProcess(): Promise<void> {
    this.processClose ??= this.client.close()
    return this.processClose
  }

  /** Retain one provider-neutral failure while the remote epoch may still be able to execute work. */
  private markTerminationUnconfirmed(cause: unknown): AgentRuntimeTerminationUnconfirmedError {
    this.terminationUnconfirmed ??= new AgentRuntimeTerminationUnconfirmedError(
      `SDK activation '${this.target.activationId}' termination is unconfirmed`,
      { cause },
    )
    return this.terminationUnconfirmed
  }

  /** Report one non-terminal status transition while containing observer failures. */
  private reportStatus(status: ActivationSnapshot['status']): void {
    if (this.status === status) return
    this.status = status
    const activation = this.statusSnapshot()
    for (const listener of [...this.statusListeners]) {
      try {
        listener(activation)
      } catch (error: unknown) {
        this.warn(`activation status listener failed: ${renderError(error)}`)
      }
    }
  }

  /** Publish terminal offline exactly once and release the duplicate-admission slot. */
  private finishOffline(): void {
    // v8 ignore next -- every caller returns after the first terminal transition and stops the sole subscription.
    if (this.offline) return
    this.offline = true
    void this.revokeLinkEnrollment().catch((error: unknown) => {
      this.warn(`remote Team Link enrollment revoke failed: ${renderError(error)}`)
    })
    const changed = this.status !== 'offline'
    this.status = 'offline'
    // v8 ignore next -- no caller sets the private status to offline before this terminal method owns it.
    if (changed) {
      const activation = this.statusSnapshot()
      for (const listener of [...this.statusListeners]) {
        try {
          listener(activation)
        } catch (error: unknown) {
          this.warn(`activation status listener failed: ${renderError(error)}`)
        }
      }
    }
    this.statusListeners.clear()
    // v8 ignore next -- release follows the same one-shot terminal transition as `offline` above.
    if (this.released) return
    this.released = true
    this.onEnded()
  }

  /** Bind one enrollment credential to the child runtime before its fixed delivery starts. */
  private async enrollLinkOwned(
    binding: ActivationBindingSnapshot,
    reserve: () => Promise<TeamLinkEnrollment>,
  ): Promise<void> {
    if (!matchesLinkBinding(this.target, binding) || !isDeliverableStatus(binding.activation.status)) {
      throw new AgentRuntimeSdkError(
        `Team Link binding does not match remote activation '${this.target.activationId}'`,
        'AGENT_RUNTIME_SDK_TARGET_MISMATCH',
      )
    }
    const enrollment = await reserve()
    try {
      if (!this.canEnrollLink()) {
        await this.revokeEnrollment(enrollment)
        return
      }
      await this.client.enrollActivationLink({
        target: this.target,
        binding: {
          activationId: String(binding.activation.id),
          teamId: String(binding.activation.teamId),
          participantId: String(binding.activation.participantId),
          sessionId: String(binding.sessionId),
          provider: binding.provider,
        },
        enrollment: {
          provider: enrollment.provider,
          endpoint: enrollment.endpoint,
          capability: enrollment.capability,
        },
      })
    } catch (error: unknown) {
      await this.revokeEnrollment(enrollment)
      throw error
    }
    if (!this.canEnrollLink()) {
      await this.revokeEnrollment(enrollment)
      return
    }
    const previous = this.linkEnrollment
    this.linkEnrollment = enrollment
    if (previous !== undefined) await this.revokeEnrollment(previous)
  }

  /** Serialize credential work so an HMR replacement cannot overlap activation teardown. */
  private queueLinkEnrollment(operation: () => Promise<void>): Promise<void> {
    const queued = this.linkEnrollmentTail.then(operation, operation)
    this.linkEnrollmentTail = queued.then(() => undefined, () => undefined)
    return queued
  }

  /** Return whether this handle can still give a child a replacement credential. */
  private canEnrollLink(): boolean {
    return !this.offline && !this.disposing
  }

  /** Revoke one opaque credential while retaining only its settlement. */
  private async revokeEnrollment(enrollment: TeamLinkEnrollment): Promise<void> {
    const revocation = enrollment.revoke()
    this.linkRevocations.add(revocation)
    try {
      await revocation
    } finally {
      this.linkRevocations.delete(revocation)
    }
  }

  /** Revoke the activation-owned credential after pending enrollment work settles. */
  private async revokeLinkEnrollment(): Promise<void> {
    await this.linkEnrollmentTail
    const enrollment = this.linkEnrollment
    this.linkEnrollment = undefined
    if (enrollment !== undefined) await this.revokeEnrollment(enrollment)
    await Promise.all([...this.linkRevocations])
  }

  /** Build an immutable detached status snapshot for external callers. */
  private statusSnapshot(): ActivationSnapshot {
    return Object.freeze({ ...this.activation, status: this.status })
  }

  /** Send one contained diagnostic without letting a logger failure affect activation ownership. */
  private warn(message: string): void {
    try {
      this.onWarning(message)
    } catch {
      // A diagnostic sink cannot change the activation's lifecycle.
    }
  }
}

/** Construction inputs for one same-host SDK stale-activation fencer. */
export interface SdkLocalProcessFencerConfig {
  /** Runtime-provider name selected by the durable activation binding. */
  readonly provider: string
  /** Explicit SDK runtime profile that must match the persisted recovery plan. */
  readonly profile: string
  /** Host identity that owns the persisted process identity. */
  readonly hostId: string
  /** Maximum wait after graceful and forced termination. */
  readonly fenceGraceMs: number
  /** Optional recovery kind restriction for another provider reusing this fencer. */
  readonly kind?: ActivationRecoverySnapshot['kind']
}

/** Fences stale same-host SDK child processes before a replacement activation can resume. */
export class SdkLocalProcessFencer implements AgentRuntimeFencer {
  /**
   * @param config - immutable provider/profile/host match requirements.
   * @param inspector - exact process-identity and tree owner.
   * @param platform - host platform, injectable for deterministic process tests.
   */
  constructor(
    private readonly config: SdkLocalProcessFencerConfig,
    private readonly inspector: ProcessInspector,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly processGroupExists: (processGroupId: number) => boolean = hasProcessGroup,
  ) {}

  get provider(): string {
    return this.config.provider
  }

  validate(binding: ActivationBindingSnapshot): void {
    if (this.inspector.hasExactIdentity !== true) {
      throw new AgentRuntimeSdkError(
        'SDK recovery requires exact local process creation identities',
        'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED',
      )
    }
    this.requireRecovery(binding)
  }

  /** Observe the exact process tree without inferring absence from a reused or exited root PID.
   * @param binding - persisted SDK epoch owned by this deployment.
   * @returns reachable for the original live root, terminated only for a proven absent POSIX group, otherwise unknown.
   */
  health(binding: ActivationBindingSnapshot): 'reachable' | 'terminated' | 'unknown' {
    this.validate(binding)
    const recovery = this.requireRecovery(binding)
    const root = { pid: recovery.process.pid, started: recovery.process.started }
    if (this.inspector.isAlive(root)) return 'reachable'
    if (this.platform === 'win32' || recovery.process.processGroupId === undefined) return 'unknown'
    return this.processGroupExists(recovery.process.processGroupId) ? 'unknown' : 'terminated'
  }

  /** Terminate one exact recorded process tree without following a recycled process id. */
  async fence(binding: ActivationBindingSnapshot): Promise<void> {
    this.validate(binding)
    const recovery = this.requireRecovery(binding)
    const root: ProcessIdentity = { pid: recovery.process.pid, started: recovery.process.started }
    if (!this.inspector.isAlive(root)) {
      if (this.platform === 'win32') {
        throw new AgentRuntimeSdkError(
          'SDK recovery cannot prove a stale Windows process tree is absent after its root exited',
          'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED',
        )
      }
      const processGroupId = recovery.process.processGroupId
      if (processGroupId === undefined || this.processGroupExists(processGroupId)) {
        throw new AgentRuntimeSdkError('SDK recovery cannot prove a stale POSIX process group is absent', 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED')
      }
      return
    }
    const discovered = this.inspector.processTree(root.pid).find(candidate => candidate.pid === root.pid)
    if (discovered === undefined || discovered.started !== root.started) {
      throw new AgentRuntimeSdkError(
        `SDK recovery cannot prove process identity for activation '${binding.activation.id}'`,
        'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED',
      )
    }
    const observed = new Map<string, ProcessIdentity>()
    const capture = (): void => {
      observed.set(processKey(root), root)
      for (const candidate of this.inspector.processTree(root.pid)) observed.set(processKey(candidate), candidate)
    }
    capture()
    if (this.platform !== 'win32') {
      await this.fencePosix(root, recovery, observed, capture)
      return
    }
    this.signalWindows(observed, 'SIGTERM')
    if (await this.waitForWindowsExit(observed, capture)) return
    this.signalWindows(observed, 'SIGKILL')
    if (await this.waitForWindowsExit(observed, capture)) return
    throw new AgentRuntimeSdkError(
      `SDK recovery could not terminate activation '${binding.activation.id}' process tree`,
      'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED',
    )
  }

  /** Validate that a durable recovery plan belongs to this exact local provider deployment. */
  private requireRecovery(binding: ActivationBindingSnapshot): ActivationRecoverySnapshot {
    const raw = binding.recovery
    if (raw === undefined) {
      throw new AgentRuntimeSdkError(
        `SDK activation '${binding.activation.id}' has no local cold-replacement plan`,
        'AGENT_RUNTIME_SDK_RECOVERY_BINDING_INVALID',
      )
    }
    let recovery: ActivationRecoverySnapshot
    try {
      recovery = activationRecoverySnapshotSchema.parse(raw)
    } catch (error: unknown) {
      throw new AgentRuntimeSdkError(
        `SDK activation '${binding.activation.id}' has an invalid local cold-replacement plan`,
        'AGENT_RUNTIME_SDK_RECOVERY_BINDING_INVALID',
        { cause: error },
      )
    }
    if (binding.provider !== this.provider
      || recovery.runtimeProvider !== this.provider
      || recovery.profile !== this.config.profile
      || recovery.process.hostId !== this.config.hostId
      || this.config.kind !== undefined && recovery.kind !== this.config.kind) {
      throw new AgentRuntimeSdkError(
        `SDK activation '${binding.activation.id}' recovery plan does not belong to this provider deployment`,
        'AGENT_RUNTIME_SDK_RECOVERY_BINDING_INVALID',
      )
    }
    return recovery
  }

  /** Fence a detached process group only while its original leader identity remains live. */
  private async fencePosix(
    root: ProcessIdentity,
    recovery: ActivationRecoverySnapshot,
    observed: ReadonlyMap<string, ProcessIdentity>,
    capture: () => void,
  ): Promise<void> {
    const processGroupId = recovery.process.processGroupId
    if (processGroupId === undefined) {
      throw new AgentRuntimeSdkError('SDK local cold replacement requires a persisted POSIX process group', 'AGENT_RUNTIME_SDK_RECOVERY_BINDING_INVALID')
    }
    this.inspector.signalGroup(processGroupId, 'SIGTERM')
    const afterTerm = await this.waitForPosixExit(root, processGroupId, observed, capture)
    if (afterTerm === 'gone') return
    if (afterTerm === 'unsafe-group') {
      throw new AgentRuntimeSdkError('SDK recovery found a surviving or reused POSIX process group after its root exited', 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED')
    }
    if (!this.inspector.isAlive(root)) {
      throw new AgentRuntimeSdkError('SDK recovery lost its original POSIX process identity before forced termination', 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED')
    }
    this.inspector.signalGroup(processGroupId, 'SIGKILL')
    const afterKill = await this.waitForPosixExit(root, processGroupId, observed, capture)
    if (afterKill === 'gone') return
    throw new AgentRuntimeSdkError('SDK recovery could not prove its POSIX process group terminated', 'AGENT_RUNTIME_SDK_RECOVERY_FENCE_FAILED')
  }

  /** Signal every identity that Windows taskkill can resolve through its root process. */
  private signalWindows(observed: ReadonlyMap<string, ProcessIdentity>, signal: 'SIGTERM' | 'SIGKILL'): void {
    for (const identity of observed.values()) this.inspector.signalProcess(identity, signal)
  }

  /** Wait for POSIX group absence without signaling again after the original root exits. */
  private async waitForPosixExit(
    root: ProcessIdentity,
    processGroupId: number,
    observed: ReadonlyMap<string, ProcessIdentity>,
    capture: () => void,
  ): Promise<'gone' | 'root-live' | 'unsafe-group'> {
    const deadline = Date.now() + this.config.fenceGraceMs
    for (;;) {
      capture()
      if (!this.inspector.isAlive(root)) {
        if (!this.processGroupExists(processGroupId)) {
          return [...observed.values()].every(identity => !this.inspector.isAlive(identity)) ? 'gone' : 'unsafe-group'
        }
        if (Date.now() >= deadline) return 'unsafe-group'
        await fenceSleep(Math.min(20, deadline - Date.now()))
        continue
      }
      if (Date.now() >= deadline) return 'root-live'
      await fenceSleep(Math.min(20, deadline - Date.now()))
    }
  }

  /** Wait for every captured Windows process while collecting descendants born during shutdown. */
  private async waitForWindowsExit(
    observed: ReadonlyMap<string, ProcessIdentity>,
    capture: () => void,
  ): Promise<boolean> {
    const deadline = Date.now() + this.config.fenceGraceMs
    for (;;) {
      capture()
      if ([...observed.values()].every(identity => !this.inspector.isAlive(identity))) return true
      if (Date.now() >= deadline) return false
      await fenceSleep(Math.min(20, deadline - Date.now()))
    }
  }
}

/** Build one identity-safe lookup key without conflating a recycled process id. */
function processKey(identity: ProcessIdentity): string {
  return JSON.stringify([identity.pid, identity.started])
}

/** Return whether a POSIX process group remains addressable without signaling it. */
function hasProcessGroup(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error: unknown) {
    return !(isErrno(error, 'ESRCH'))
  }
}

/** Await one bounded recovery poll without retaining a timer after the fence settles. */
function fenceSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, delayMs) })
}

/** Match one Node operating-system error without trusting arbitrary thrown values. */
function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { readonly code?: unknown }).code === code
}

/** Provider for fresh and persisted-resume remote Agent activations over the SDK protocol. */
class SdkRuntimeProvider implements SdkAgentRuntimeProvider {
  readonly terminationMode = 'owned-process' as const
  private readonly activations = new Map<string, ActivationEntry>()
  private readonly processInspector: ProcessInspector | undefined
  private readonly staleFencer: AgentRuntimeFencer | undefined
  private closing = false

  /**
   * @param ctx - provider context used only for contained diagnostics.
   * @param config - validated local process launch configuration.
   * @param clientFactory - factory that creates one SDK client per accepted epoch.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly clientFactory: SdkActivationClientFactory,
    processInspector: ProcessInspector | undefined,
  ) {
    this.processInspector = processInspector
    if (config.recovery === undefined) return
    if (processInspector === undefined) throw new TypeError('agent-runtime-sdk recovery requires a local process inspector')
    if (processInspector.hasExactIdentity !== true) {
      throw new TypeError('agent-runtime-sdk recovery requires exact local process creation identities')
    }
    this.staleFencer = new SdkLocalProcessFencer({
      provider: config.providerName,
      profile: config.recovery.profile,
      hostId: config.recovery.hostId,
      fenceGraceMs: config.recovery.fenceGraceMs,
    }, processInspector)
  }

  /** Provider registry name. */
  get name(): string {
    return this.config.providerName
  }

  get fencer(): AgentRuntimeFencer | undefined {
    return this.staleFencer
  }

  /** Close admission without revoking activation handles already returned to callers. */
  closeAdmission(): void {
    this.closing = true
  }

  /** Activate one active remote-agent participant in its own SDK runtime process. */
  async activate(request: AgentRuntimeActivationRequest): Promise<ActivationHandle> {
    if (this.closing) {
      throw new AgentRuntimeSdkError('SDK AgentRuntime provider is closed', 'AGENT_RUNTIME_SDK_CLOSED')
    }
    const route = assertSupportedRequest(request)
    const reserveEnrollment = this.resolveEnrollmentReservation()
    throwIfAborted(request.signal)
    const key = activationKey(request)
    const existing = this.activations.get(key)
    if (existing !== undefined) {
      if (existing.sessionId !== request.sessionId) {
        throw new AgentRuntimeSdkError(
          `Participant '${request.participant.id}' is already active on another Session`,
          'AGENT_RUNTIME_SDK_SESSION_MISMATCH',
        )
      }
      return await existing.operation
    }
    const entry = new ActivationEntry(request.sessionId)
    const operation = this.materialize(request, route, reserveEnrollment, () => {
      // v8 ignore next -- this exact entry is removed only by its own terminal callback or rejected operation.
      if (this.activations.get(key) === entry) this.activations.delete(key)
    })
    entry.operation = operation
    this.activations.set(key, entry)
    void operation.catch(() => {
      /* v8 ignore next -- the exact entry remains sole owner until the unpublished operation rejects. */
      if (this.activations.get(key) === entry) this.activations.delete(key)
    })
    return await operation
  }

  /** Start, initialize, open, and transfer one private runtime process into a returned handle. */
  private async materialize(
    request: AgentRuntimeActivationRequest,
    route: SdkRoute,
    reservation: EnrollmentReservation | undefined,
    onEnded: () => void,
  ): Promise<ActivationHandle> {
    const credential = this.config.credential
    if (credential === undefined) {
      throw new AgentRuntimeSdkError(
        'SDK remote activation requires an explicitly configured product credential',
        'AGENT_RUNTIME_SDK_PRODUCT_AUTH_REQUIRED',
      )
    }
    const activationId = activationIdSchema.parse(`activation-${randomUUID()}`)
    const target = Object.freeze({
      activationId: String(activationId),
      teamId: String(request.teamId),
      participantId: String(request.participant.id),
      sessionId: String(request.sessionId),
    }) satisfies SdkActivationTarget
    const client = this.clientFactory.create(launchOptions(this.config))
    let bridge: StatusBridge | undefined
    try {
      await raceAbort(request.signal, () => client.initialize({
        credential,
        cwd: this.config.cwd,
        provider: route.provider,
        model: route.model,
        ...route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens },
      }))
      bridge = new StatusBridge(client.subscribe(), target)
      const initial = await raceAbort(request.signal, () => client.openActivation({
        target,
        seed: request.seed.kind === 'fresh' ? { kind: 'fresh' } : { kind: 'resume' },
      }))
      // Notifications and the matching response share one transport; yield a
      // microtask so an already-delivered malformed state rejects before this
      // handle becomes caller-owned.
      await Promise.resolve()
      assertRemoteTarget(initial, target)
      bridge.assertPublishable(initial)
      const recovery = this.recoverySnapshot(client, route, activationId)
      const activation = Object.freeze({
        id: activationId,
        teamId: request.teamId,
        participantId: request.participant.id,
        status: initial.status,
      })
      if (recovery?.supervisor !== undefined) {
        const supervisors = this.ctx.get('activationSupervisors')
        if (supervisors === undefined) throw new AgentRuntimeSdkError('SDK supervised recovery requires an execution-host supervisor owner', 'AGENT_RUNTIME_SDK_RECOVERY_UNAVAILABLE')
        await supervisors.admitOwned({ activation, sessionId: request.sessionId, provider: this.name, recovery })
      }
      let stopBindingWatch = () => {}
      let stopEnrollmentWatch = () => {}
      const handle = new RemoteActivationHandle(
        client,
        target,
        bridge,
        () => {
          stopBindingWatch()
          stopEnrollmentWatch()
          onEnded()
        },
        (message) => { this.warn(message) },
        initial,
        activation,
        request.sessionId,
        recovery,
      )
      if (reservation !== undefined) {
        let binding: ActivationBindingSnapshot | undefined
        let issuerUnavailable = false
        stopBindingWatch = this.ctx.on('team/changed', (event: TeamEvent) => {
          const observed = this.enrollBoundLink(event, target, handle, current => reservation.reserve(current))
          if (observed === undefined) return
          binding = isDeliverableStatus(observed.activation.status) ? observed : undefined
        })
        const stopIssuerRemoved = this.ctx.on('team-link/enrollment-provider-removed', (issuer) => {
          if (issuer.name === reservation.provider) issuerUnavailable = true
        })
        const stopIssuerAdded = this.ctx.on('team-link/enrollment-provider-added', (issuer) => {
          if (!issuerUnavailable || issuer.name !== reservation.provider || binding === undefined) return
          issuerUnavailable = false
          this.renewBoundLink(target, handle, binding, current => reservation.reserve(current))
        })
        stopEnrollmentWatch = () => {
          stopIssuerRemoved()
          stopIssuerAdded()
        }
      }
      bridge.bind(handle)
      throwIfAborted(request.signal)
      return handle
    } catch (error: unknown) {
      bridge?.stop()
      try {
        await client.close()
      } catch (closeError: unknown) {
        this.warn(`unpublished remote runtime close failed: ${renderError(closeError)}`)
      }
      throw error
    }
  }

  /** Send a provider diagnostic while containing logger failures. */
  private warn(message: string): void {
    try {
      this.ctx.logger.warn(`agent-runtime-sdk '${this.name}': ${message}`)
    } catch {
      // Logging does not own a remote process or activation handle.
    }
  }

  /** Resolve the configured Hub-owned credential issuer before allocating a child process. */
  private resolveEnrollmentReservation(): EnrollmentReservation | undefined {
    const provider = this.config.teamLinkEnrollmentProvider
    if (provider === undefined) return undefined
    const links = this.ctx.get('teamLinks')
    if (links?.getEnrollmentProvider(provider) === undefined) {
      throw new AgentRuntimeSdkError(
        `Team Link enrollment provider '${provider}' is not registered`,
        'AGENT_RUNTIME_SDK_TEAM_LINK_UNAVAILABLE',
      )
    }
    return {
      provider,
      reserve: async binding => await links.reserveEnrollment({ provider, binding }),
    }
  }

  /** Start post-bind child enrollment only for this provider's exact durable activation epoch. */
  private enrollBoundLink(
    event: TeamEvent,
    target: SdkActivationTarget,
    handle: RemoteActivationHandle,
    reserve: (binding: ActivationBindingSnapshot) => Promise<TeamLinkEnrollment>,
  ): ActivationBindingSnapshot | undefined {
    if (event.type !== 'activation/changed') return
    const binding = event.binding
    if (!matchesLinkBinding(target, binding) || binding.provider !== this.name) return
    if (isDeliverableStatus(binding.activation.status)) {
      void handle.enrollLink(binding, () => reserve(binding)).catch((error: unknown) => {
        handle.linkEnrollmentFailed(toError(error))
      })
    }
    return binding
  }

  /** Replace a lost issuer credential without turning a transient listener reload into activation loss. */
  private renewBoundLink(
    target: SdkActivationTarget,
    handle: RemoteActivationHandle,
    binding: ActivationBindingSnapshot,
    reserve: (binding: ActivationBindingSnapshot) => Promise<TeamLinkEnrollment>,
  ): void {
    if (!matchesLinkBinding(target, binding)
      || binding.provider !== this.name
      || !isDeliverableStatus(binding.activation.status)) return
    void handle.renewLink(binding, () => reserve(binding)).catch((error: unknown) => {
      this.warn(`remote Team Link credential re-enrollment failed: ${renderError(error)}`)
    })
  }

  /** Build one durable plan only when the deployment explicitly enabled local cold replacement. */
  private recoverySnapshot(client: SdkActivationClient, route: SdkRoute, activationId: ActivationSnapshot['id']): ActivationRecoverySnapshot | undefined {
    const recovery = this.config.recovery
    if (recovery === undefined) return undefined
    const pid = client.pid
    if (pid === undefined) {
      throw new AgentRuntimeSdkError('SDK runtime client did not expose its child process id for recovery', 'AGENT_RUNTIME_SDK_RECOVERY_UNAVAILABLE')
    }
    const inspector = this.processInspector
    if (inspector === undefined) {
      throw new AgentRuntimeSdkError('SDK runtime has no local process inspector for recovery', 'AGENT_RUNTIME_SDK_RECOVERY_UNAVAILABLE')
    }
    const identity = inspector.processTree(pid).find(candidate => candidate.pid === pid)
    if (identity === undefined || identity.started.length === 0) {
      throw new AgentRuntimeSdkError(`SDK runtime child '${pid}' has no observable process identity for recovery`, 'AGENT_RUNTIME_SDK_RECOVERY_UNAVAILABLE')
    }
    return activationRecoverySnapshotSchema.parse({
      kind: 'sdk-local-cold-replace',
      version: 1,
      runtimeProvider: this.name,
      ...this.config.recoverySupervisor === undefined ? {} : { supervisor: {
        ...this.config.recoverySupervisor,
        hostId: recovery.hostId,
        generation: activationId,
        terminationMode: this.terminationMode,
      } },
      profile: recovery.profile,
      agent: {
        provider: route.provider,
        model: route.model,
        ...(route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens }),
      },
      process: {
        hostId: recovery.hostId,
        pid: identity.pid,
        started: identity.started,
        ...(process.platform === 'win32' ? {} : { processGroupId: identity.pid }),
      },
    })
  }
}

/** Provider/model route extracted from the Team-resolved AgentOptions. */
interface SdkRoute {
  /** Child SDK provider route. */
  readonly provider: string
  /** Child SDK model. */
  readonly model: string
  /** Optional child output-token cap. */
  readonly maxTokens: number | undefined
}

/** Build a collision-free provider-local key from opaque Team and Participant ids. */
function activationKey(request: AgentRuntimeActivationRequest): string {
  return JSON.stringify([request.teamId, request.participant.id])
}

/** Validate every capability this provider owns before a child client is created. */
function assertSupportedRequest(request: AgentRuntimeActivationRequest): SdkRoute {
  if (request.participant.kind !== 'remote-agent' || request.participant.phase !== 'active') {
    throw new AgentRuntimeSdkError(
      `SDK AgentRuntime provider can activate only active remote-agent participant '${request.participant.id}'`,
      'AGENT_RUNTIME_SDK_PARTICIPANT_UNSUPPORTED',
    )
  }
  if (request.agent.preset !== undefined) {
    throw new AgentRuntimeSdkError(
      'SDK AgentRuntime provider does not compose named Agent presets',
      'AGENT_RUNTIME_SDK_PRESET_UNSUPPORTED',
    )
  }
  switch (request.seed.kind) {
    case 'fresh':
    case 'resume':
      break
    case 'fork':
      throw new AgentRuntimeSdkError(
        'SDK AgentRuntime provider supports fresh and resume seeds only',
        'AGENT_RUNTIME_SDK_SEED_UNSUPPORTED',
      )
    /* v8 ignore next -- AgentRuntimeSeed is closed at this typed same-process boundary. */
    default:
      return assertNever(request.seed)
  }
  const { provider, model, maxTokens } = request.agent.options
  if (typeof provider !== 'string' || provider.trim().length === 0
    || typeof model !== 'string' || model.trim().length === 0
    || (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens <= 0))) {
    throw new AgentRuntimeSdkError(
      'SDK AgentRuntime activation requires non-empty AgentOptions provider and model, with an optional positive safe-integer maxTokens',
      'AGENT_RUNTIME_SDK_AGENT_OPTIONS_INVALID',
    )
  }
  return { provider, model, maxTokens }
}

/** Preserve a closed-union exhaustiveness assertion without accepting future seed kinds silently. */
/* v8 ignore next -- AgentRuntimeSeed is a closed typed same-process union. */
function assertNever(value: never): never {
  throw new Error(`unsupported SDK AgentRuntime seed: ${String(value)}`)
}

/** Resolve and validate one local child-process working directory at provider load. */
function resolveConfiguredCwd(cwd: string): string {
  if (cwd.trim().length === 0) {
    throw new TypeError('agent-runtime-sdk cwd must be a non-empty existing directory')
  }
  const resolved = resolve(cwd)
  try {
    if (statSync(resolved).isDirectory()) return resolved
  } catch {
    // The typed configuration reports the named invalid directory below.
  }
  throw new TypeError(`agent-runtime-sdk cwd is not an existing directory: ${resolved}`)
}

/** Validate timer values before any provider registration can publish a bad teardown deadline. */
function assertTimeout(name: keyof Pick<Config, 'requestTimeoutMs' | 'shutdownTimeoutMs' | 'disposeEofGraceMs' | 'disposeGraceMs' | 'recoveryFenceGraceMs'>, value: number | undefined): void {
  if (value === undefined) return
  if (Number.isFinite(value) && value > 0 && value <= MAX_TIMER_DELAY_MS) return
  throw new TypeError(`agent-runtime-sdk ${name} must be a positive finite millisecond value at most ${MAX_TIMER_DELAY_MS}`)
}

/** Resolve schema-defaulted configuration into immutable launch inputs. */
function resolveConfig(config: Config): ResolvedConfig {
  const resolved = config as ResolvedConfig
  const recoveryFenceConfigured = config.recoveryFenceGraceMs !== undefined
  const recoveryFenceGraceMs = config.recoveryFenceGraceMs ?? DEFAULT_RECOVERY_FENCE_GRACE_MS
  assertTimeout('requestTimeoutMs', resolved.requestTimeoutMs)
  assertTimeout('shutdownTimeoutMs', resolved.shutdownTimeoutMs)
  assertTimeout('disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertTimeout('disposeGraceMs', resolved.disposeGraceMs)
  assertTimeout('recoveryFenceGraceMs', recoveryFenceGraceMs)
  const withRecoveryDefaults: ResolvedConfig = { ...resolved, recoveryFenceGraceMs }
  const recovery = resolveRecoveryConfig(withRecoveryDefaults, recoveryFenceConfigured)
  return {
    ...withRecoveryDefaults,
    args: [...withRecoveryDefaults.args],
    cwd: resolveConfiguredCwd(withRecoveryDefaults.cwd),
    env: { ...withRecoveryDefaults.env },
    ...(recovery === undefined ? {} : { recovery }),
  }
}

/** Resolve all-or-nothing local cold-replacement settings before child publication. */
function resolveRecoveryConfig(
  config: ResolvedConfig,
  recoveryFenceConfigured: boolean,
): SdkLocalRecoveryConfig | undefined {
  if (config.recoveryProfile === undefined && config.recoveryHostId === undefined) {
    if (config.recoverySupervisor !== undefined) throw new TypeError('agent-runtime-sdk recoverySupervisor requires recoveryProfile and recoveryHostId')
    if (recoveryFenceConfigured) {
      throw new TypeError('agent-runtime-sdk recoveryFenceGraceMs requires recoveryProfile and recoveryHostId')
    }
    return undefined
  }
  if (config.recoveryProfile === undefined || config.recoveryHostId === undefined) {
    throw new TypeError('agent-runtime-sdk recoveryProfile and recoveryHostId must be configured together')
  }
  const profile = normalizedRecoveryText(config.recoveryProfile, 'recoveryProfile')
  const hostId = normalizedRecoveryText(config.recoveryHostId, 'recoveryHostId')
  return { profile, hostId, fenceGraceMs: config.recoveryFenceGraceMs }
}

/** Reject surrounding whitespace in durable recovery identities before a child can publish. */
function normalizedRecoveryText(value: string, name: 'recoveryProfile' | 'recoveryHostId'): string {
  if (value.trim().length === 0 || value.trim() !== value) {
    throw new TypeError(`agent-runtime-sdk ${name} must be non-empty without surrounding whitespace`)
  }
  return value
}

/** Build one complete SDK client launch specification with no inherited credential-shaped environment values. */
function launchOptions(config: ResolvedConfig): HarnessClientOptions {
  return {
    command: config.command,
    args: [...config.args],
    cwd: config.cwd,
    env: { ...scrubbedParentEnv(), ...config.env },
    ...(config.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: config.requestTimeoutMs }),
    ...(config.recovery === undefined ? {} : { detached: true }),
    shutdownTimeoutMs: config.shutdownTimeoutMs,
    disposeEofGraceMs: config.disposeEofGraceMs,
    disposeGraceMs: config.disposeGraceMs,
  }
}

/** Require a remote state to repeat the exact immutable target that selected this process epoch. */
function assertRemoteTarget(state: SdkActivationState, target: SdkActivationTarget): void {
  if (state.activationId === target.activationId
    && state.teamId === target.teamId
    && state.participantId === target.participantId
    && state.sessionId === target.sessionId) return
  throw new AgentRuntimeSdkError(
    `SDK runtime returned another activation target for '${target.activationId}'`,
    'AGENT_RUNTIME_SDK_TARGET_MISMATCH',
  )
}

/** Match a durable binding to the exact remote activation target before enrollment. */
function matchesLinkBinding(target: SdkActivationTarget, binding: ActivationBindingSnapshot): boolean {
  return String(binding.activation.id) === target.activationId
    && String(binding.activation.teamId) === target.teamId
    && String(binding.activation.participantId) === target.participantId
    && String(binding.sessionId) === target.sessionId
}

/** Return whether an activation may receive an attached remote Link. */
function isDeliverableStatus(status: ActivationStatus): boolean {
  return status === 'idle' || status === 'running'
}

/** Permit only the Team-owned residency transitions before forwarding remote status to listeners. */
function assertStatusTransition(previous: ActivationStatus | undefined, next: ActivationStatus): void {
  try {
    assertActivationStatusTransition(previous, next)
  } catch (error: unknown) {
    throw new AgentRuntimeSdkError(
      `SDK runtime reported invalid activation status transition ${String(previous)} → ${next}`,
      'AGENT_RUNTIME_SDK_STATUS_INVALID',
      { cause: error },
    )
  }
}

/** Restrict `activation/open` publication to residency states that can bind a live epoch. */
function assertInitialStatus(status: ActivationStatus): void {
  try {
    assertStatusTransition(undefined, status)
  } catch (error: unknown) {
    throw new AgentRuntimeSdkError(
      `SDK runtime opened activation with non-publishable status '${status}'`,
      'AGENT_RUNTIME_SDK_STATUS_INVALID',
      { cause: error },
    )
  }
}

/** Race a startup operation against activation cancellation without exposing an accepted process on abort. */
async function raceAbort<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  throwIfAborted(signal)
  let removeAbort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    removeAbort = () => { signal.removeEventListener('abort', onAbort) }
  })
  try {
    return await Promise.race([operation(), aborted])
  } finally {
    removeAbort()
  }
}

/** Reject a cancellation signal before allocating or publishing a child process. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

/** Normalize an activation cancellation reason into an Error preserved through startup cleanup. */
function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error('SDK AgentRuntime activation was aborted before publication', { cause: signal.reason })
}

/** Identify the SDK client's process/stdio terminal error. */
function isTransportLoss(error: unknown): boolean {
  return error instanceof TransportClosedError
}

/** Normalize an unknown thrown value for a status subscription failure. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(renderError(error))
}

/** Render a contained diagnostic safely even for hostile error stringification. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/**
 * Create one SDK provider with an explicit client factory. The factory is an
 * embedding and test seam; {@link apply} uses the real process-owning client.
 * @param ctx - context used for provider diagnostics.
 * @param config - plugin configuration after schema validation/defaulting.
 * @param clientFactory - process client factory, defaulting to `HarnessClient`.
 * @param processInspector - optional same-host process inspector for deterministic recovery tests.
 * @returns a provider ready for `ctx.agentRuntimes.registerProvider()`.
 */
export function createSdkAgentRuntimeProvider(
  ctx: Context,
  config: Config,
  clientFactory: SdkActivationClientFactory = harnessSdkActivationClientFactory,
  processInspector?: ProcessInspector,
): SdkAgentRuntimeProvider {
  const resolved = resolveConfig(config)
  const inspector = resolved.recovery === undefined ? undefined : processInspector ?? createProcessInspector()
  return new SdkRuntimeProvider(ctx, resolved, clientFactory, inspector)
}

/**
 * Register the SDK remote placement provider.
 * @param ctx - context carrying the AgentRuntime registry.
 * @param config - child process launch and provider registration configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const provider = createSdkAgentRuntimeProvider(ctx, config)
  ctx.effect(() => {
    const unregisterFencer = provider.fencer === undefined ? undefined : ctx.agentRuntimes.registerFencer(provider.fencer)
    const unregister = ctx.agentRuntimes.registerProvider(provider)
    return () => {
      provider.closeAdmission()
      unregister()
      unregisterFencer?.()
    }
  }, 'agentRuntimeSdk.registerProvider()')
}
