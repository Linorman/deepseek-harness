/**
 * In-process AgentRuntime provider. It activates one Team-resolved Participant
 * through the public Agent factory without inheriting parent Agent authority.
 * @module @clocky/clocky-agent-runtime-in-process
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type { Agent, AgentHandle } from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-agent-presets'
import type {} from '@clocky/clocky-session-persistence'
import type {
  ActivationHandle,
  AgentRuntimeActivationRequest,
  AgentRuntimeProvider,
} from '@clocky/clocky-agent-runtime'
import { activationIdSchema } from '@clocky/clocky-team'
import type { ActivationSnapshot } from '@clocky/clocky-team'
import { AgentRuntimeInProcessError } from './error.ts'

export { AgentRuntimeInProcessError } from './error.ts'
export type { AgentRuntimeInProcessErrorCode } from './error.ts'

/** Cordis plugin name. */
export const name = 'agent-runtime-in-process'
/** The activation registry and public Agent factory must exist before registration. */
export const inject = ['agentRuntimes', 'agents', 'sessionPersistence']

/** Deployment configuration for the in-process placement provider. */
export interface Config {
  /** Provider name registered on `ctx.agentRuntimes`. */
  readonly providerName: string
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  providerName: z.string().default('in-process'),
})

/** Root-owned scope that supplies the Agent factory to one accepted activation. */
const activationOwner = Object.assign(
  function agentRuntimeActivationOwner(_ctx: Context): void {},
  { inject: ['agents'] },
)

/** Build one collision-free provider-local ownership key from a Team and Participant. */
function activationKey(request: AgentRuntimeActivationRequest): string {
  return JSON.stringify([request.teamId, request.participant.id])
}

/** Pending or resident local Agent attached to one provider-owned slot. */
class ActivationEntry {
  /** Materialization that callers join while the slot remains live. */
  operation!: Promise<ActivationHandle>
  /** Exact local Agent once the factory publishes this activation. */
  agent: Agent | undefined
  /** Local handle used to mark an externally disposed Agent offline. */
  handle: InProcessActivationHandle | undefined
}

/** One local activation handle owning an Agent factory handle. */
class InProcessActivationHandle implements ActivationHandle {
  private disposal: Promise<void> | undefined
  private offline = false
  private status: ActivationSnapshot['status']
  private readonly statusListeners = new Set<(activation: ActivationSnapshot) => void>()

  /**
   * @param owner - published Agent factory handle for this activation epoch.
   * @param activation - immutable Team/Participant activation projection.
   * @param onDisposed - releases the provider's duplicate-activation slot.
   */
  constructor(
    private readonly owner: AgentHandle,
    private readonly disposeScope: () => Promise<void>,
    readonly activation: ActivationHandle['activation'],
    readonly sessionId: ActivationHandle['sessionId'],
    private readonly onDisposed: () => void,
    private readonly onListenerError: (error: unknown) => void,
  ) {
    this.status = activation.status
  }

  /** Exact in-process Agent published by the factory. */
  get localAgent() { return this.owner.agent }

  /** Return the current local residency status without changing ownership. */
  health(): Promise<ActivationHandle['activation']> {
    const status = this.offline
      ? 'offline' as const
      : this.disposal !== undefined
        ? 'stopping' as const
        : this.owner.agent.status === 'running'
          ? 'running' as const
          : 'idle' as const
    this.reportStatus(status)
    return Promise.resolve(this.statusSnapshot(status))
  }

  /** Subscribe to subsequent local residency transitions for this exact epoch. */
  onStatus(listener: (activation: ActivationSnapshot) => void): () => void {
    if (this.offline) return () => {}
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  /**
   * Stop the current local turn while retaining unclaimed inbox work.
   * @param cause - cancellation cause passed to the exact published Agent.
   */
  interrupt(cause: Parameters<ActivationHandle['interrupt']>[0]): void {
    if (this.disposal !== undefined || this.offline) return
    this.owner.agent.cancel(cause, { keepInbox: true })
  }

  /**
   * Cancel the local Agent, release its factory handle, and free this
   * provider's duplicate-activation slot. Idempotent.
   * @returns resolution after the Agent factory reaches quiescent disposal.
   */
  dispose(): Promise<void> {
    this.disposal ??= this.disposeOwned()
    return this.disposal
  }

  /** Run the one activation-local cancellation and ownership-release sequence. */
  private async disposeOwned(): Promise<void> {
    this.reportStatus('stopping')
    if (!this.offline) this.owner.agent.cancel({ kind: 'disposed' }, { keepInbox: true })
    try {
      await this.owner.dispose()
    } finally {
      this.offline = true
      this.reportStatus('offline')
      try {
        await this.disposeScope()
      } finally {
        this.onDisposed()
      }
    }
  }

  /** Mark a handle offline after its Agent's structural owner disposes it. */
  markOffline(): void {
    this.offline = true
    this.reportStatus('offline')
  }

  /** Forward a provider-observed Agent status without exposing local internals. */
  reportStatus(status: ActivationSnapshot['status']): void {
    if (this.status === status) return
    this.status = status
    const activation = this.statusSnapshot(status)
    for (const listener of this.statusListeners) {
      try {
        listener(activation)
      } catch (error: unknown) {
        this.onListenerError(error)
      }
    }
  }

  /** Build one immutable status projection detached from this mutable handle. */
  private statusSnapshot(status: ActivationSnapshot['status']): ActivationSnapshot {
    return Object.freeze({ ...this.activation, status })
  }
}

/** Provider for fresh, fork-seeded, and persisted local Agent activations. */
class InProcessAgentRuntimeProvider implements AgentRuntimeProvider {
  readonly terminationMode = 'cooperative' as const
  private readonly activations = new Map<string, ActivationEntry>()
  private closing = false

  /**
   * @param ctx - provider context carrying the public Agent registry.
   * @param name - registry name for this placement provider.
   */
  constructor(
    private readonly ctx: Context,
    readonly name: string,
  ) {
    ctx.on('agent/status', ({ agent, status }) => {
      for (const entry of this.activations.values()) {
        if (entry.agent === agent) entry.handle?.reportStatus(status)
      }
    })
    ctx.on('agent/disposed', ({ agent }) => {
      for (const [key, entry] of this.activations) {
        if (entry.agent === agent) {
          entry.handle?.markOffline()
          this.activations.delete(key)
        }
      }
    })
  }

  /** Close admission without revoking activation handles already returned to callers. */
  closeAdmission(): void {
    this.closing = true
  }

  /**
   * Activate one Team-resolved Participant. Concurrent requests for the same
   * Team/Participant share the first published handle only when they name the
   * same durable Session.
   * @param request - resolved activation request from the registry.
   * @returns the published in-process activation handle.
   */
  async activate(request: AgentRuntimeActivationRequest): Promise<ActivationHandle> {
    if (this.closing) {
      throw new AgentRuntimeInProcessError('in-process AgentRuntime provider is closed', 'AGENT_RUNTIME_IN_PROCESS_CLOSED')
    }
    if (request.participant.kind !== 'local-agent') {
      throw new AgentRuntimeInProcessError(
        `in-process AgentRuntime provider cannot activate ${request.participant.kind} participant '${request.participant.id}'`,
        'AGENT_RUNTIME_IN_PROCESS_PARTICIPANT_UNSUPPORTED',
      )
    }
    const key = activationKey(request)
    const existing = this.activations.get(key)
    if (existing !== undefined) {
      const handle = await existing.operation
      if (handle.sessionId !== request.sessionId) {
        throw new AgentRuntimeInProcessError(
          `Participant '${request.participant.id}' is already active on another Session`,
          'AGENT_RUNTIME_IN_PROCESS_SESSION_MISMATCH',
        )
      }
      return handle
    }
    const entry = new ActivationEntry()
    const operation = this.materialize(
      request,
      () => {
        if (this.activations.get(key) === entry) this.activations.delete(key)
      },
      (handle) => {
        entry.agent = handle.localAgent
        entry.handle = handle
      },
    )
    entry.operation = operation
    this.activations.set(key, entry)
    void operation.catch(() => {
      /* v8 ignore next -- no replacement can enter while this unpublished operation still owns the slot. */
      if (this.activations.get(key) === entry) this.activations.delete(key)
    })
    return await operation
  }

  /** Create or resume the local Agent and transfer its lifecycle into one activation handle. */
  private async materialize(
    request: AgentRuntimeActivationRequest,
    onDisposed: () => void,
    onPublished: (handle: InProcessActivationHandle) => void,
  ): Promise<ActivationHandle> {
    // The provider fiber only controls admission. An accepted Agent must stay
    // resident while its returned handle remains owned by the caller, so its
    // structural factory owner is a root-owned scope released by that handle.
    const scope = await this.ctx.root.plugin(activationOwner)
    let owner: AgentHandle | undefined
    try {
      owner = request.seed.kind === 'resume'
        ? await scope.ctx.agents.resume({
          resumeSessionId: request.sessionId,
          agentOptions: request.agent.options,
          signal: request.signal,
          setup: async (agentCtx) => {
            const agent = agentCtx.agent
            /* v8 ignore next -- AgentRegistry invokes setup from the newly scoped Agent context. */
            if (agent === undefined) throw new Error('AgentRuntime resume setup has no scoped Agent')
            const header = agent.session.header
            if (header.teamId !== request.teamId || header.participantId !== request.participant.id) {
              throw new AgentRuntimeInProcessError(
                `Session '${request.sessionId}' does not belong to Team participant '${request.participant.id}'`,
                'AGENT_RUNTIME_IN_PROCESS_SESSION_PROVENANCE_MISMATCH',
              )
            }
            await this.composePreset(agentCtx, request.agent.preset)
          },
        })
        : await scope.ctx.agents.create({
          sessionId: request.sessionId,
          meta: {
            teamId: request.teamId,
            participantId: request.participant.id,
            ...request.agent.cwd === undefined ? {} : { cwd: request.agent.cwd },
            ...request.agent.preset === undefined ? {} : { agentPreset: request.agent.preset },
            ...request.seed.kind === 'fork' ? {
              parentSession: request.seed.sourceSessionId,
              seedLength: request.seed.events.length,
            } : {},
          },
          ...request.seed.kind === 'fork' ? { seed: request.seed.events } : {},
          agentOptions: request.agent.options,
          signal: request.signal,
          setup: async (agentCtx) => {
            const agent = agentCtx.agent
            /* v8 ignore next -- AgentRegistry invokes setup from the newly scoped Agent context. */
            if (agent === undefined) throw new Error('AgentRuntime creation setup has no scoped Agent')
            await this.composePreset(agentCtx, request.agent.preset)
            await this.ctx.sessionPersistence.materializeHeader(agent.session)
          },
        })
    } catch (error: unknown) {
      await scope.dispose()
      throw error
    }
    const activation = Object.freeze({
      id: activationIdSchema.parse(`activation-${randomUUID()}`),
      teamId: request.teamId,
      participantId: request.participant.id,
      status: 'idle' as const,
    })
    const handle = new InProcessActivationHandle(
      owner,
      scope.dispose,
      activation,
      request.sessionId,
      onDisposed,
      (error) => { this.ctx.logger.warn(`agent-runtime-in-process: activation status listener failed: ${renderError(error)}`) },
    )
    onPublished(handle)
    return handle
  }

  /** Compose a requested preset in the unpublished Agent scope. */
  private async composePreset(agentCtx: Context, preset: string | undefined): Promise<void> {
    if (preset === undefined) return
    const presets = agentCtx.get('agentPresets')
    if (presets === undefined) {
      throw new AgentRuntimeInProcessError(
        `in-process AgentRuntime provider cannot serve named Agent preset '${preset}' without ctx.agentPresets`,
        'AGENT_RUNTIME_IN_PROCESS_PRESET_UNAVAILABLE',
      )
    }
    try {
      await presets.mount(agentCtx, preset)
    } catch (cause: unknown) {
      throw new AgentRuntimeInProcessError(
        `in-process AgentRuntime provider could not compose named Agent preset '${preset}'`,
        'AGENT_RUNTIME_IN_PROCESS_PRESET_UNAVAILABLE',
        { cause },
      )
    }
  }
}

/** Render a contained listener failure without allowing logging to throw. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/**
 * Register the local placement provider.
 * @param ctx - context carrying the activation registry and Agent factory.
 * @param config - provider registry name.
 */
export function apply(ctx: Context, config: Config): void {
  const provider = new InProcessAgentRuntimeProvider(ctx, config.providerName)
  ctx.effect(() => {
    const unregister = ctx.agentRuntimes.registerProvider(provider)
    return () => {
      provider.closeAdmission()
      unregister()
    }
  }, 'agentRuntimeInProcess.registerProvider()')
}
