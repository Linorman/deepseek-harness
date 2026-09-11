// SessionManager: the instance cluster Map<SessionId, Session> (lazy-built, resident) + the frame
// dispatch entry + list state, constructed and held by SessionRuntime (one per client runtime).
// List data never enters zustand; React connects via subscribe/getListSnapshot.

import type {
  IApiClient, HostFrame, MuxFrame, RpcError, RpcRequest, RpcResult, SessionId,
  SessionSummary, JobView,
} from '@clocky/clocky-api-remotes/client'
// Value import from the inline-safe wire layer (not the connection plugin):
// plugin-to-plugin value imports are a bundle purity error.
import { transportError } from '@clocky/clocky-host-apiproxy/api'
import { mergeOrderedBaseline } from '../ordered-baseline.ts'
import type { ConversationRuntime } from './conversation-assembler.ts'
import type { PendingInteractionStatus } from './pending.ts'
// Type-only merge edge: the title domain's client-namespace outlet declares
// the 'title' projection key this manager projects into list rows (and any
// useProjection('title') consumer reads). Zero value imports by construction.
import type {} from '@clocky/clocky-session-title/client'
import { Notifier } from './notifier.ts'
import { ProjectionValueStore } from './projection-store.ts'
import { Session } from './session.ts'
import type { SessionRemotes } from './remotes.ts'

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

interface SessionListEntry extends SessionSummary {
  title?: string
  projectionValues?: Readonly<Record<string, unknown>>
  pendingInteraction?: PendingInteractionStatus
  completed: boolean
}

/** Immutable session-list snapshot for useSessionList. */
export interface SessionListSnapshot {
  items: readonly SessionListEntry[]
  /** Selected Session id (validated against items; masked to undefined while its session is off the list). */
  current: SessionId | undefined
  state: 'idle' | 'loading' | 'error'
  /** Arrival lifecycle (see {@link SessionListPhase}); `state` stays the pull-activity axis. */
  phase: SessionListPhase
  error: RpcError | null
  /** Background jobs per session; an absent key is an empty set. */
  jobsBySession: Readonly<Record<SessionId, readonly JobView[]>>
}

type SessionListMutation =
  | { kind: 'upsert'; summary: SessionSummary }
  | { kind: 'remove'; sessionId: SessionId }
  | { kind: 'status'; sessionId: SessionId; running: boolean }
  | { kind: 'activity'; sessionId: SessionId; updatedAt: number }
  /** Local first-send flip: the sender clears blank without waiting for a host frame. */
  | { kind: 'engaged'; sessionId: SessionId }

/** Stable identity of a frame retained until an uninstantiated Session can consume it. */
function bufferedRequestKey(envelope: RpcRequest<MuxFrame>): string | undefined {
  const frame = envelope.payload
  switch (frame.type) {
    case 'approval/requested': return `a:${frame.approvalId}`
    case 'question/requested': return `q:${envelope.rpcId}`
    case 'session/queue': return 'queue'
    /* v8 ignore next -- pendingBuffers contains only the three frame types above. */
    default: return undefined
  }
}

/** Match ui-user-questions's binary plan-review routing at the wire boundary. */
function questionInteractionStatus(
  questions: Extract<MuxFrame, { type: 'question/requested' }>['questions'],
): PendingInteractionStatus {
  if (questions.length !== 1) return 'question'
  const question = questions[0] as typeof questions[number]
  const intent = question.intent
  if (intent?.kind !== 'plan-review' || question.detail === undefined) return 'question'
  if (question.multiSelect === true) return 'question'
  const options = question.options ?? []
  if (options.length > 2) return 'question'
  return options.some(option => option.label === intent.approve) ? 'plan-review' : 'question'
}

/** Instance cluster + frame entry + the session list. */
export class SessionManager {
  private readonly sessions = new Map<SessionId, Session>()
  /** Pre-instantiation buffer for answerable requests and the queued-turn snapshot, which history
   *  cannot reconstruct on open. Live requests remain until resolution; queue and replay duplicates
   *  compact by identity. Instantiation replays and clears it, while removal drops it. */
  private readonly pendingBuffers = new Map<SessionId, RpcRequest<MuxFrame>[]>()
  /** Outstanding answerable interactions per session, keyed by their stable request identity.
   *  Manager-owned rather than read off Session instances because the sidebar must light up for
   *  sessions never instantiated. Cleared per connection generation — the reopen replay re-adds
   *  still-pending requests — and on session-removed. */
  private readonly pendingInteractions = new Map<SessionId, Map<string, PendingInteractionStatus>>()
  /**
   * Sessions that finished running while not selected — the sidebar's green
   * "done" reminder (manager-owned, survives connection generations; cleared
   * on select and session-removed, re-armed by the next completion).
   */
  private readonly completedNotifications = new Set<SessionId>()
  /** Last-observed running bits per session; the true→false edge here arms {@link completedNotifications}. */
  private readonly prevRunning = new Map<SessionId, boolean>()
  /** Per-session projection value stores, retained independently of instance arrival (the
   *  title-snapshot precedent, generalized): push frames land here whether or not the Session
   *  is instantiated (list rows read the 'title' key), and an instantiated Session adopts the
   *  same store so history-baseline seeding and frames converge on one row set. */
  private readonly projectionStores = new Map<SessionId, ProjectionValueStore>()
  private summaries: SessionSummary[] = []
  private listState: 'idle' | 'loading' | 'error' = 'idle'
  /** Arrival phase; the pending → ready edge fires on the first successful pull (see SessionListPhase). */
  private listPhase: SessionListPhase = 'pending'
  private listError: RpcError | null = null
  private listInflight: Promise<void> | null = null
  /** Mutations arriving after a list request starts are replayed over its response. */
  private listMutations: SessionListMutation[] | null = null
  /**
   * Background jobs per session, last-wins from `session/jobs`. An empty set
   * is stored as an absent key, so absence and `[]` are one representation.
   */
  private readonly jobsBySession = new Map<SessionId, readonly JobView[]>()

  private selected: SessionId | undefined

  private listSnapshotCache: SessionListSnapshot
  /** Entry-identity cache (reference stability): list rebuilds reuse the previous entry
   *  object when every field matches — wire refreshes mint all-new summary objects, so identity
   *  must be recovered by value or every SessionListItem memo misses on every refresh. */
  private entryCache = new Map<SessionId, SessionListEntry>()
  private itemsCache: readonly SessionListEntry[] = []
  private readonly notifier = new Notifier(() => {
    this.listSnapshotCache = this.buildListSnapshot()
  })

  /**
   * @param api - shared wire client.
   * @param restoredSelection - persisted real-Session selection candidate.
   */
  constructor(
    private readonly api: IApiClient,
    private readonly remote: SessionRemotes,
    restoredSelection?: SessionId,
    private readonly conversation?: ConversationRuntime,
  ) {
    this.selected = restoredSelection
    this.listSnapshotCache = this.buildListSnapshot()
  }

  // ---- Selection ----

  /**
   * Select a listed Session.
   * @param sessionId - Listed Session identifier.
   */
  select(sessionId: SessionId): void {
    if (!this.summaries.some(summary => summary.sessionId === sessionId)) {
      throw new Error(`sessions.select: unknown session ${sessionId}`)
    }
    this.selected = sessionId
    // Looking at the session consumes its completion reminder (dot clears).
    this.completedNotifications.delete(sessionId)
    this.notifier.notifyNow()
  }

  /** Clear the selection (the layout falls to the no-session view state). */
  clearSelection(): void {
    this.selected = undefined
    this.notifier.notifyNow()
  }


  // ---- Instance management ----

  /**
   * Drop a session instance (scope-prune companion: instance
   * and scope share one lifecycle). The host session log is the durable
   * truth — a later get() lazily rebuilds and open() backfills history.
   * @param sessionId - the session to drop.
   */
  drop(sessionId: SessionId): void {
    this.sessions.delete(sessionId)
  }

  /**
   * Lazy build: return the existing instance or construct one (no auto-open —
   * open is triggered by the container's select callback).
   * @param sessionId - the session to get.
   * @returns the resident instance.
   */
  get(sessionId: SessionId): Session {
    let session = this.sessions.get(sessionId)
    if (session === undefined) {
      session = this.createSession(sessionId)
      this.sessions.set(sessionId, session)
      // Replay approval/question/queued frames buffered before instantiation (rpcId
      // verbatim, same semantics as the subscribed baseline replay). Replay happens
      // BEFORE the running-bit sync: a not-running summary must sweep replayed queue
      // rows the same way a live status flip would (their retirement events dropped
      // while the session was uninstantiated).
      const buffered = this.pendingBuffers.get(sessionId)
      if (buffered !== undefined) {
        this.pendingBuffers.delete(sessionId)
        for (const envelope of buffered) session.handleMuxEnvelope(envelope.rpcId, envelope.payload)
      }
      // Sync the running and blank bits from the list snapshot into the new
      // instance (consistency when the list precedes open).
      const summary = this.summaries.find(s => s.sessionId === sessionId)
      if (summary !== undefined) {
        session.handleBlank(summary.blank)
        session.handleRunning(summary.running)
      }
    }
    return session
  }

  private createSession(sessionId: SessionId): Session {
    return new Session(sessionId, this.api, this.remote, {
      // The sender's local first-send flip mirrors into the list row so the
      // session surfaces (lists filter on blank) before any host frame lands.
      onEngaged: (engaged) => {
        this.recordMutation({ kind: 'engaged', sessionId: engaged.sessionId })
      },
      projections: this.projectionStore(sessionId),
      ...this.conversation === undefined ? {} : { conversation: this.conversation },
    })
  }

  /** Rebuild every resident Session after one coalesced registry transaction. */
  rebuildConversationRegistry(): void {
    for (const session of this.sessions.values()) session.rebuildConversationRegistry()
  }

  /** Resident per-session projection store (create-on-demand; outlives instantiation). */
  private projectionStore(sessionId: SessionId): ProjectionValueStore {
    let store = this.projectionStores.get(sessionId)
    if (store === undefined) {
      store = new ProjectionValueStore()
      // List rows project off store keys (title); any-key changes re-enter
      // the manager's own batched rebuild channel.
      store.subscribeAny(() => { this.notifier.markDirty() })
      this.projectionStores.set(sessionId, store)
    }
    return store
  }

  // ---- List API ----

  /** Full refresh via session.list (single-flight: an in-flight call is reused). */
  refreshList(): Promise<void> {
    if (this.listInflight !== null) return this.listInflight
    this.listState = 'loading'
    this.listError = null
    const established = this.summaries
    const mutations: SessionListMutation[] = []
    this.listMutations = mutations
    this.notifier.markDirty()
    this.listInflight = (async () => {
      try {
        const { result } = await this.api.sessions.list({})
        if (result.ok) {
          const baseline = this.listPhase === 'pending'
            ? result.value.items
            : mergeOrderedBaseline(established, result.value.items, summary => summary.sessionId)
          // Seed first observations from the pull-time baseline BEFORE replaying
          // in-flight mutations, then reconcile the reminders after EVERY
          // replayed mutation: an edge that happens entirely between mutations
          // (baseline idle → running → idle) must still arm, which a single
          // sync on the folded result would collapse away.
          for (const s of baseline) {
            if (!this.prevRunning.has(s.sessionId)) this.prevRunning.set(s.sessionId, s.running)
          }
          let summaries = baseline
          for (const mutation of mutations) {
            summaries = applyMutation(summaries, mutation)
            this.summaries = summaries
            this.syncCompletedNotifications()
          }
          this.summaries = summaries
          this.listState = 'idle'
          this.listPhase = 'ready'
          // Covers the empty-mutations pull (a plain baseline carries no edge).
          this.syncCompletedNotifications()
          // Push running/blank bits down to instantiated Sessions (the list is the authoritative summary source).
          for (const s of this.summaries) {
            const session = this.sessions.get(s.sessionId)
            if (session === undefined) continue
            session.handleBlank(s.blank)
            session.handleRunning(s.running)
          }
          // Seed each row's projection baseline into the per-session value
          // store (cold titles surface without opening the session). Per-key
          // apply, not seed(): the list block is a partial baseline — the
          // cold cache serves only version-matching keys — so an absent key
          // must not clear; higher-seq-wins still keeps a stale list block
          // from overwriting a newer push frame or tail baseline.
          for (const s of result.value.items) {
            const block = s.projections
            if (block === undefined) continue
            const store = this.projectionStore(s.sessionId)
            const values = block.values as Record<string, unknown>
            for (const key of Object.keys(values)) store.apply(key, values[key], block.asOfSeq)
          }
        } else {
          this.listState = 'error'
          this.listError = result.error
        }
      } catch (error) {
        this.listState = 'error'
        const folded = transportError<never>(error)
        /* v8 ignore next -- the `? null` arm is unreachable: transportError always returns ok:false. */
        this.listError = folded.ok ? null : folded.error
      } finally {
        this.listMutations = null
        this.listInflight = null
        this.notifier.markDirty()
      }
    })()
    return this.listInflight
  }

  /**
   * Search visible session message content without adding transient query
   * state to the list snapshot.
   * @param query - non-blank literal phrase.
   * @param signal - cancellation for superseded UI queries.
   * @returns the Host result or a folded transport error.
   */
  async search(
    query: string,
    signal: AbortSignal,
  ): Promise<RpcResult<{ items: SessionSearchResultItem[]; hasMore: boolean }>> {
    try {
      return (await this.api.sessions.search({ query }, signal)).result
    } catch (error: unknown) {
      return transportError(error)
    }
  }

  /**
   * Insert-or-enrich a locally synthesized summary: a new id prepends; an
   * existing entry only gains fields it lacks, never overwriting list-refresh data.
   */
  private mergeSummary(summary: SessionSummary): void {
    this.recordMutation({ kind: 'upsert', summary })
  }

  /**
   * Record a host-confirmed composition switch (see ISessions.noteAgentPreset).
   * @param sessionId - the switched session.
   * @param agentPreset - the preset id the host confirmed.
   */
  noteAgentPreset(sessionId: SessionId, agentPreset: string): void {
    this.recordMutation({ kind: 'upsert', summary: {
      sessionId, updatedAt: Date.now(), running: false, blank: true, agentPreset,
    } })
  }

  /** Apply immediately and retain for replay when a list response is in flight. */
  private recordMutation(mutation: SessionListMutation): void {
    this.listMutations?.push(mutation)
    this.summaries = applyMutation(this.summaries, mutation)
    // Eager edge reconciliation — a snapshot-build-time pass would miss consecutive status frames.
    this.syncCompletedNotifications()
    this.notifier.markDirty()
  }

  // ---- Subscription API (for useSessionList) ----

  /**
   * uSES subscription entry for useSessionList.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener)
  }

  /**
   * Cached list snapshot (rebuilt lazily when dirty with no listeners).
   * @returns the cached reference (stable until the next flush).
   */
  getListSnapshot(): SessionListSnapshot {
    this.notifier.ensureFresh()
    return this.listSnapshotCache
  }

  /** Add or refresh one stable pending-interaction identity. */
  private trackPending(sessionId: SessionId, key: string, status: PendingInteractionStatus): void {
    let interactions = this.pendingInteractions.get(sessionId)
    if (interactions === undefined) {
      interactions = new Map()
      this.pendingInteractions.set(sessionId, interactions)
    }
    if (interactions.get(key) === status) return
    interactions.set(key, status)
    this.notifier.markDirty()
  }

  /** Settle one pending-interaction identity without disturbing sibling waits. */
  private resolvePending(sessionId: SessionId, key: string): void {
    const interactions = this.pendingInteractions.get(sessionId)
    if (interactions === undefined || !interactions.delete(key)) return
    if (interactions.size === 0) this.pendingInteractions.delete(sessionId)
    this.notifier.markDirty()
  }

  // ---- ConnectionController sinks (wired by boot) ----

  /**
   * Mux frame entry: sessionId-bearing frames go only to instantiated sessions
   * (no lazy build; non-pending frames for uninstantiated sessions drop —
   * history backfills them on open).
   * @param envelope - the frame with its wire rpcId.
   */
  handleMuxEnvelope(envelope: RpcRequest<MuxFrame>): void {
    const frame = envelope.payload
    if (frame.type === 'stream/error') return // Controller already treats this as stream failure
    if (frame.type === 'team/changed' || frame.type === 'channel/changed') return
    if (
      frame.type === 'session/event'
      && frame.event.type === 'user/message'
      && frame.event.data.source.kind === 'user'
    ) {
      // session.list supplies the cold baseline, while a direct prompt or an
      // admitted steer advances it between pulls. Max keeps replayed or
      // repaired older user messages from moving the row backwards.
      this.recordMutation({ kind: 'activity', sessionId: frame.sessionId, updatedAt: frame.event.time })
    }
    if (frame.type === 'session/projection') {
      // Finished host-computed value: land it in the resident store whether or
      // not the Session is instantiated (list rows read the 'title' key). The
      // synchronous markDirty keeps the list snapshot same-tick fresh (the
      // store's own any-key channel is microtask-batched).
      this.projectionStore(frame.sessionId).apply(frame.key, frame.value, frame.seq)
      this.notifier.markDirty()
      return
    }
    if (frame.type === 'session/jobs') {
      // Whole-set snapshot, so last-wins with no reconciliation. The Host omits
      // the baseline for an empty set, which is the same fact an emptying change
      // reports as `[]` — both land as an absent key.
      if (frame.jobs.length === 0) this.jobsBySession.delete(frame.sessionId)
      else this.jobsBySession.set(frame.sessionId, frame.jobs)
      this.notifier.markDirty()
      return
    }
    if (frame.type === 'session/subscribed') {
      // Rows past the host's durable baseline rode state a restart lost; drop
      // them so last-wins cannot pin a phantom value over recomputed truth.
      this.projectionStores.get(frame.sessionId)?.truncate(frame.lastSeq)
      // Same re-baseline reasoning as the queue below: this generation sends a
      // task baseline only when the set is non-empty, so a mirror kept from the
      // previous generation would survive as a phantom list.
      this.jobsBySession.delete(frame.sessionId)
      this.notifier.markDirty()
      // New mux-generation baseline: discard the previous queue snapshot.
      // The host omits session/queue when the live queue is empty, so retaining
      // it could replay stale work when the Session is instantiated later.
      // This is the same re-baseline signal Session uses for its own mirror.
      const buffered = this.pendingBuffers.get(frame.sessionId)
      if (buffered !== undefined) {
        const kept = buffered.filter(item => item.payload.type !== 'session/queue')
        if (kept.length !== buffered.length) {
          if (kept.length === 0) this.pendingBuffers.delete(frame.sessionId)
          else this.pendingBuffers.set(frame.sessionId, kept)
        }
      }
    }
    // List-level pending-interaction status (the sidebar amber dot): tracked
    // for every session, instantiated or not; stable keys make replays idempotent.
    if (frame.type === 'approval/requested') {
      this.trackPending(frame.sessionId, `a:${frame.approvalId}`, 'approval')
    } else if (frame.type === 'approval/resolved') {
      this.resolvePending(frame.sessionId, `a:${frame.approvalId}`)
    } else if (frame.type === 'question/requested') {
      this.trackPending(
        frame.sessionId,
        `q:${envelope.rpcId}`,
        questionInteractionStatus(frame.questions),
      )
    } else if (frame.type === 'question/resolved') {
      this.resolvePending(frame.sessionId, `q:${frame.questionRpcId}`)
    }
    const session = this.sessions.get(frame.sessionId)
    if (session === undefined) {
      // Answerable requests never hit history: retain each live identity until
      // instantiation, compacting replay duplicates and resolutions so list
      // status cannot outlive the PendingWait the user would need to answer.
      // Queue is a latest-value snapshot; everything else drops because open
      // backfills it from history.
      switch (frame.type) {
        case 'approval/requested':
        case 'question/requested':
        case 'session/queue': {
          const buffer = this.pendingBuffers.get(frame.sessionId) ?? []
          const key = frame.type === 'approval/requested'
            ? `a:${frame.approvalId}`
            : frame.type === 'question/requested' ? `q:${envelope.rpcId}` : 'queue'
          const prior = buffer.findIndex(item => bufferedRequestKey(item) === key)
          if (prior === -1) buffer.push(envelope)
          else buffer[prior] = envelope
          this.pendingBuffers.set(frame.sessionId, buffer)
          return
        }
        case 'approval/resolved':
        case 'question/resolved': {
          const buffer = this.pendingBuffers.get(frame.sessionId)
          if (buffer === undefined) return
          const key = frame.type === 'approval/resolved'
            ? `a:${frame.approvalId}`
            : `q:${frame.questionRpcId}`
          const prior = buffer.findIndex(item => bufferedRequestKey(item) === key)
          if (prior !== -1) buffer.splice(prior, 1)
          if (buffer.length === 0) this.pendingBuffers.delete(frame.sessionId)
          return
        }
        default:
          return
      }
    }
    session.handleMuxEnvelope(envelope.rpcId, frame)
  }

  /**
   * Host frame entry: list upkeep + per-instance running/removed/agent-error relay.
   * @param envelope - the frame with its wire rpcId.
   */
  handleHostEnvelope(envelope: RpcRequest<HostFrame>): void {
    const frame = envelope.payload
    switch (frame.type) {
      case 'host/session-added': {
        this.mergeSummary({
          sessionId: frame.sessionId, updatedAt: Date.now(), running: false, blank: frame.blank,
          ...(frame.cwd !== undefined ? { cwd: frame.cwd } : {}),
          ...(frame.agentPreset !== undefined ? { agentPreset: frame.agentPreset } : {}),
        })
        this.sessions.get(frame.sessionId)?.handleBlank(frame.blank)
        return
      }
      case 'host/session-removed': {
        this.recordMutation({ kind: 'remove', sessionId: frame.sessionId })
        this.sessions.get(frame.sessionId)?.handleRemoved()
        this.pendingBuffers.delete(frame.sessionId) // a removed session's buffered frames must not replay on a future instantiation
        this.pendingInteractions.delete(frame.sessionId) // a removed session cannot wait on anyone
        // Owner disposal already dropped these registry-side, but that lands on
        // the mux stream while this frame rides the host stream, so the two have
        // no relative order. Clearing here makes a detached Activation's rows
        // disappear whichever arrives first.
        this.jobsBySession.delete(frame.sessionId)
        this.projectionStores.delete(frame.sessionId)
        return
      }
      case 'host/session-status': {
        this.recordMutation({ kind: 'status', sessionId: frame.sessionId, running: frame.running })
        this.sessions.get(frame.sessionId)?.handleRunning(frame.running)
        return
      }
      case 'host/agent-error': {
        this.sessions.get(frame.sessionId)?.handleAgentError(frame.message)
        return // not reflected in the list
      }
      default:
        return // stream/error ignored; unknown frames ignored (documented default)
    }
  }

  /**
   * The moment a connection generation dies (before any next-generation frame
   * can arrive — onConnected waits for the readiness handshake while replayed
   * frames flow from stream open, so clearing there would race the replay):
   * drop generation-scoped live state. Interactions resolved while disconnected
   * send no frame, so stale statuses and buffered answerable frames must not
   * survive into the next generation — mux-open replay re-adds every still-pending
   * request with its live rpcId.
  */
  handleDisconnected(): void {
    if (this.pendingInteractions.size > 0) {
      this.pendingInteractions.clear()
      this.notifier.markDirty()
    }
    for (const [sessionId, buffer] of [...this.pendingBuffers]) {
      const kept = buffer.filter(item =>
        item.payload.type !== 'approval/requested' && item.payload.type !== 'question/requested')
      if (kept.length === buffer.length) continue
      if (kept.length === 0) this.pendingBuffers.delete(sessionId)
      else this.pendingBuffers.set(sessionId, kept)
    }
  }

  /** After each connection generation: refresh the session baseline and rebuild opened windows. */
  handleConnected(): void {
    void this.refreshList()
    for (const session of this.sessions.values()) void session.resync()
  }

  /**
   * Reconcile completion reminders against the latest summaries, eagerly after
   * every mutation and pull (a snapshot-build-time pass would collapse
   * consecutive status frames into one observation). A running→idle edge of a
   * non-selected session arms its reminder; running disarms it; removal drops
   * it. First observation only records the running bit — sessions already
   * idle at load get no reminder.
   */
  private syncCompletedNotifications(): void {
    const seen = new Set<SessionId>()
    for (const s of this.summaries) {
      seen.add(s.sessionId)
      const prev = this.prevRunning.get(s.sessionId)
      if (prev === undefined) {
        this.prevRunning.set(s.sessionId, s.running)
        continue
      }
      if (prev && !s.running) {
        if (s.sessionId !== this.selected) this.completedNotifications.add(s.sessionId)
      } else if (s.running) {
        this.completedNotifications.delete(s.sessionId)
      }
      this.prevRunning.set(s.sessionId, s.running)
    }
    for (const id of this.prevRunning.keys()) {
      if (!seen.has(id)) this.prevRunning.delete(id)
    }
    for (const id of this.completedNotifications) {
      if (!seen.has(id)) this.completedNotifications.delete(id)
    }
  }

  private buildListSnapshot(): SessionListSnapshot {
    const pendingInteractions = new Map<SessionId, PendingInteractionStatus>()
    for (const [sessionId, interactions] of this.pendingInteractions) {
      const statuses = [...interactions.values()]
      // The composer selects the first question ahead of approval. Mirror that
      // answer order so the sidebar names the interaction the user can act on.
      const status = statuses.find(candidate => candidate !== 'approval') ?? statuses[0]
      if (status !== undefined) pendingInteractions.set(sessionId, status)
    }
    const fresh: SessionListEntry[] = this.summaries.map((summary) => {
      const projectionStore = this.projectionStores.get(summary.sessionId)
      const title = projectionStore?.get('title')
      const projectionValues = projectionStore?.values()
      const pendingInteraction = pendingInteractions.get(summary.sessionId)
      return {
        ...summary,
        ...(typeof title === 'string' && title !== '' ? { title } : {}),
        ...(projectionValues === undefined ? {} : { projectionValues }),
        ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
        completed: this.completedNotifications.has(summary.sessionId),
      }
    })
    const items = fresh.map((entry) => {
      const prev = this.entryCache.get(entry.sessionId)
      if (
        prev !== undefined && prev.updatedAt === entry.updatedAt && prev.running === entry.running
        && prev.blank === entry.blank && prev.agentPreset === entry.agentPreset
        && prev.cwd === entry.cwd && prev.title === entry.title
        && prev.pendingInteraction === entry.pendingInteraction
        && prev.projectionValues === entry.projectionValues
        && prev.completed === entry.completed
      ) return prev
      this.entryCache.set(entry.sessionId, entry)
      return entry
    })
    for (const id of this.entryCache.keys()) {
      if (!items.some(e => e.sessionId === id)) this.entryCache.delete(id)
    }
    const sameOrder = items.length === this.itemsCache.length && items.every((e, i) => e === this.itemsCache[i])
    if (!sameOrder) this.itemsCache = items
    const selected = this.selected
    const current = selected !== undefined
      && items.some(item => item.sessionId === selected)
      ? selected
      : undefined
    return {
      items: this.itemsCache,
      current,
      state: this.listState,
      phase: this.listPhase,
      error: this.listError,
      jobsBySession: Object.fromEntries(this.jobsBySession),
    }
  }
}

/** Apply one list mutation without deriving display order. */
function applyMutation(summaries: readonly SessionSummary[], mutation: SessionListMutation): SessionSummary[] {
  switch (mutation.kind) {
    case 'upsert': {
      const existing = summaries.find(summary => summary.sessionId === mutation.summary.sessionId)
      if (existing === undefined) return [mutation.summary, ...summaries]
      const filled: SessionSummary = {
        ...existing,
        // Blank only lowers: a stale true (session-added racing the local
        // first send) never re-hides an already-surfaced session.
        blank: existing.blank && mutation.summary.blank,
        ...(existing.cwd === undefined && mutation.summary.cwd !== undefined ? { cwd: mutation.summary.cwd } : {}),
        // Newest wins, not fill-only: a blank-session preset switch replaces
        // the creation-time value, and every producer of this field (the
        // create echo, the select echo, a list row) reports the CURRENT one.
        ...(mutation.summary.agentPreset !== undefined
          ? { agentPreset: mutation.summary.agentPreset } : {}),
      }
      if (filled.cwd === existing.cwd && filled.blank === existing.blank
        && filled.agentPreset === existing.agentPreset) return [...summaries]
      return summaries.map(summary => summary.sessionId === mutation.summary.sessionId ? filled : summary)
    }
    case 'remove':
      return summaries.filter(summary => summary.sessionId !== mutation.sessionId)
    case 'status':
      // running:true doubles as the cross-client blank flip (a blank session
      // never runs, so the first running frame proves a message landed).
      return summaries.map(summary => summary.sessionId === mutation.sessionId
        && (summary.running !== mutation.running || (mutation.running && summary.blank))
        ? { ...summary, running: mutation.running, blank: summary.blank && !mutation.running }
        : summary)
    case 'activity':
      return summaries.map(summary => summary.sessionId === mutation.sessionId
        && mutation.updatedAt > summary.updatedAt
        ? { ...summary, updatedAt: mutation.updatedAt }
        : summary)
    case 'engaged':
      return summaries.map(summary => summary.sessionId === mutation.sessionId && summary.blank
        ? { ...summary, blank: false }
        : summary)
  }
}
