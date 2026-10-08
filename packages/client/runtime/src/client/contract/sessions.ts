import type { JobView } from '@clocky/clocky-api-remotes/client'
import type { SessionProjectionMap } from '@clocky/clocky-session-projection/types'
import type { PendingInteractionStatus } from './pending.ts'
/**
 * The outward sessions-service face — what `ctx.sessions` exposes to feature
 * packages and the renderer host, and therefore exactly what the test
 * runtime's sessions double must implement. Wire-pump entry points
 * (handleMuxEnvelope/handleConnected/refresh) and runtime internals stay on
 * the concrete class; cross-domain consumers keep the narrower
 * [SessionsPort](./sessions-port.ts). Widening this interface is the
 * explicit act of widening what features may do to the sessions domain.
 */
import type { Context } from '@clocky/cordis'
import type { RpcResult, SessionId } from '@clocky/clocky-api-remotes/client'
import type { HostObservable, SessionMaybeProvideInfo } from '@clocky/clocky-client-ui-slots'
import type { AgentContext } from './agent-scope.ts'
import type { SessionFace } from './session.ts'
import type { ObservableSnapshot } from './store.ts'

export type { AgentContext } from './agent-scope.ts'

/**
 * Coarse Host connection state for presentation: `connecting` before the
 * first handshake, `reconnecting` during backoff, and `unauthorized` after the
 * Host explicitly refused this browser's product credential. `unauthorized`
 * holds until a later handshake succeeds, so retries cannot hide it.
 */
export interface ConnectionStatus {
  readonly state: 'connecting' | 'connected' | 'reconnecting' | 'unauthorized'
}

/** The sessions-service face injected as `ctx.sessions`. */
export interface ISessions {
  /** The useSessions standard feed (list rows + current selection; read face — writes stay inside the domain). */
  readonly list: ObservableSnapshot<SessionListState>
  /** The useConnection standard feed. */
  readonly connection: ObservableSnapshot<ConnectionStatus>
  /** Atomic current-session provide projection (the renderer host's `sessions.provideInfo` feed). */
  readonly currentProvideInfo: HostObservable<SessionMaybeProvideInfo>
  /**
   * The `session.search` result bound the wire schema fixes, exposed to
   * presentation as injected data. Not per-connection state: every transport
   * (fixture included) reports the same number.
   */
  readonly searchResultLimit: number
  /**
   * Select a session as current.
   * @param id - session id (must exist in the list; unknown ids fail loud).
   */
  open(id: SessionId): void
  /**
   * Record the composition one session now runs. The agent-preset seat calls
   * this after a successful blank-session switch, so the header label moves
   * with the composition instead of waiting for the next full list refresh.
   * @param sessionId - the switched session.
   * @param agentPreset - the preset id the host confirmed.
   */
  noteAgentPreset(sessionId: SessionId, agentPreset: string): void
  /** Clear the current selection into the no-session view state. */
  clear(): void
  /** Refresh the durable Session list before opening a newly published Participant transcript. */
  refresh(): Promise<void>
  /**
   * Search the Host's visible message-content index. Results stay
   * request-local; the list snapshot remains the metadata authority.
   * @param query - non-blank literal phrase.
   * @param signal - cancellation for a superseded search.
   * @returns bounded results, or a business/transport error.
   */
  search(
    query: string,
    signal: AbortSignal,
  ): Promise<RpcResult<{ items: SessionSearchResultItem[]; hasMore: boolean }>>
  /**
   * Register a per-session standard-props provider (hooks become `use<Name>`
   * selector hooks on the render side; props spread verbatim).
   * @param descriptor - static member roster plus per-session resolver.
   * @returns disposer removing the provider.
   */
  provide(descriptor: SessionProvideDescriptor): () => void
  /**
   * Resolve an Agent-scoped context view (use-and-discard).
   * @param id - session id.
   * @returns scoped ctx, or undefined for a session neither listed nor already scoped.
   */
  scope(id: SessionId): AgentContext | undefined
  /**
   * Read the Agent scope tag off a context (service-method boundary: fetch
   * bundles must reach scope resolution through ctx.sessions).
   * @param ctx - any client context.
   * @returns the session id, or undefined on root contexts.
   */
  scopeOf(ctx: Context): SessionId | undefined
  /**
   * Resolve the session face behind an Agent-scoped context.
   * @param ctx - an Agent-scoped context.
   * @returns the session face, or undefined when the ctx is untagged or its scope was pruned.
   */
  sessionOf(ctx: Context): SessionFace | undefined
  /**
   * Resolve the stable session binding (scope-addressed assembly feed).
   * @param id - session id.
   * @returns binding, or undefined for a session neither listed nor already scoped.
   */
  binding(id: SessionId): SessionBinding | undefined
}

/** Session list row projected from the host list RPC plus live stream increments. */
export interface SessionSummary {
  /** Immutable ownership reported by the Host; used for exact Team input routing. */
  team?: import('@clocky/clocky-api-remotes/client').SessionSummary['team']
  id: SessionId
  /** Latest durable log-backed title, absent until the host projects one. */
  title?: string
  /** Human-facing label: durable title, project basename, then session id. */
  displayTitle: string
  cwd?: string
  /**
   * Agent preset this session's agent was composed from; absent when the
   * deployment composes no presets. The session header labels what the
   * session actually runs rather than the deployment's current default.
   */
  agentPreset?: string
  running: boolean
  /** User interaction currently blocking this session. */
  pendingInteraction?: PendingInteractionStatus
  /** Finished while not selected and not yet opened. Absent = false. */
  completed?: boolean
  /**
   * Empty-log bit (Host summary derivation mirror). Non-product Workspace
   * flows may reuse a blank Session targeting the same Workspace.
   */
  blank: boolean
  updatedAt: number
  /** Current host-computed projection values retained by the object layer. */
  projectionValues?: Readonly<Partial<SessionProjectionMap>>
}

/**
 * Session list store shape. `current` rides the same snapshot (arbitrated:
 * the single useSessions standard hook reads list and selection together —
 * sidebar highlighting and SessionProvider share one fact source).
 */
export interface SessionListState {
  /** Host-list order. */
  ids: SessionId[]
  /** Host rows keyed by Session id. */
  byId: Record<SessionId, SessionSummary>
  current: SessionId | undefined
  /** Arrival lifecycle projected 1:1 from the manager snapshot (see SessionListPhase): empty-with-ready means "truly no sessions". */
  phase: SessionListPhase
  /**
   * Background jobs each session can see, mirrored last-wins from
   * `session/jobs`. A missing key is an empty set — the Host sends no baseline
   * for a session without tasks — so consumers read absence, never a sentinel.
   */
  jobsBySession: Readonly<Record<SessionId, readonly JobView[]>>
}

/** Session assembly handle for SessionProvider/inject factories (identity-stable per session). */
export interface SessionBinding {
  readonly sessionId: SessionId
  /** The outward session face only — feature code never sees the concrete class. */
  readonly session: SessionFace
  readonly ctx: AgentContext
}

/** One plugin's per-session standard-props contribution (see {@link SessionRuntime.provide}). */
export interface SessionProvideContribution {
  /** Bare observable sources, keyed by hook base name ('input' → useInput). */
  hooks?: Record<string, HostObservable<unknown>>
  /** Stable plain members (action callbacks etc.), spread into standard props verbatim. */
  props?: Record<string, unknown>
}

/**
 * Static declaration plus per-session resolver for one standard-kit
 * contribution. The declared names let the renderer construct the same hook
 * and prop surface while no session is current.
 */
export interface SessionProvideDescriptor {
  /** Hook base names (`input` becomes `useInput`). */
  hooks?: readonly string[]
  /** Plain standard-prop names. */
  props?: readonly string[]
  /** Resolve every declared member for one definite session. */
  resolve(binding: SessionBinding): SessionProvideContribution
}

/**
 * List arrival lifecycle, orthogonal to the pull-activity `state` axis:
 * `pending` (no successful pull yet — an empty items array means "nothing
 * arrived", not "nothing exists") → `ready` (at least one pull landed).
 * Monotone: `ready` never steps back — later pull failures and reconnect
 * re-pulls ride the `state`/`error` axis, which is where failure is modeled
 * (no `error` phase here; that would duplicate `state`).
 */
export type SessionListPhase = 'pending' | 'ready'

/** Request-local content hit returned to sidebar search consumers. */
export interface SessionSearchResultItem {
  sessionId: SessionId
  snippet: string
}
