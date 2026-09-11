/** Restart-safe, provider-routed convergence of durable Team closure work. @module @clocky/clocky-team-closure-driver */

import { Context, Service } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { TeamError } from '@clocky/clocky-team'
import type {
  ChannelEvent,
  JsonObject,
  TeamEvent,
  TeamId,
  TeamSnapshot,
  TeamStateSnapshot,
  TeamSystemClosureDriverProof,
  TeamSystemClosureDriverProofSource,
  TeamSystemClosureDriverScope,
} from '@clocky/clocky-team'
import type {
  TeamClosureDriveBackend,
  TeamClosureDriveBackendRef,
  TeamClosureDriverBudgetStallRequest,
  TeamClosureDriverDriveRequest,
  TeamClosureDriverTurnEndRequest,
  TeamClosureDriveRequest,
  TeamClosureDriveTrigger,
} from './types.ts'
import type { TeamClosureDriverHubReady } from './hub.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'team-closure-driver'
/** Durable Team state and one selected provider bridge must exist before recovery begins. */
export const inject = ['teams', 'teamClosureDrives', 'teamClosureDriverHub']

const PROOF_SOURCE_NAME = 'team-closure-driver'
const DEFAULT_OBSERVER_RETRY_ATTEMPTS = 3

/** Explicit bounded closure-recovery configuration. */
export interface Config {
  /** Registered backend that translates proof-bound passes into provider-owned closure commands. */
  readonly backend: string
  /** Maximum Team summaries inspected by one full discovery drive. */
  readonly maxTeamsPerDrive: number
  /** Maximum Team summaries requested in one provider list page. */
  readonly pageSize: number
  /** Maximum time allowed to await accepted backend work during plugin disposal. */
  readonly disposalTimeoutMs: number
  /** Optional recurring discovery pulse for missed in-process notifications. */
  readonly pulseIntervalMs?: number
  /** Bounded retries for a current observer racing another Team-journal append. */
  readonly observerRetryAttempts?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  backend: z.string().min(1).required(),
  maxTeamsPerDrive: z.number().step(1).min(1).required(),
  pageSize: z.number().step(1).min(1).required(),
  disposalTimeoutMs: z.number().step(1).min(1).required(),
  pulseIntervalMs: z.number().step(1).min(1).default(undefined as unknown as number),
  observerRetryAttempts: z.number().step(1).min(1).default(DEFAULT_OBSERVER_RETRY_ATTEMPTS),
})

/** Stable failure classes raised by the provider-facing backend registry. */
export type TeamClosureDriveErrorCode =
  | 'TEAM_CLOSURE_DRIVE_BACKEND_INVALID'
  | 'TEAM_CLOSURE_DRIVE_BACKEND_DUPLICATE'
  | 'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE'
  | 'TEAM_CLOSURE_DRIVE_STATE_INVALID'

/** Explicit error for a malformed, duplicate, or unavailable closure-drive backend. */
export class TeamClosureDriveError extends Error {
  /** @param message - Safe diagnostic for the rejected backend operation.
   * @param code - Stable backend-registry error code.
   */
  constructor(message: string, readonly code: TeamClosureDriveErrorCode) {
    super(message)
    this.name = 'TeamClosureDriveError'
  }
}

declare module '@clocky/cordis' {
  interface Context {
    /** Provider-facing registry for the Hub bridge selected by `team-closure-driver`. */
    teamClosureDrives: TeamClosureDriveBackendRegistry
    /** Current closure driver used by local observers to admit lifecycle facts before returning errors. */
    teamClosureDriver: TeamClosureDriver
  }
}

/** Named registry for provider bridges that own the durable closure commands. */
export class TeamClosureDriveBackendRegistry extends Service {
  private readonly backends = new Map<string, TeamClosureDriveBackend>()

  /** @param ctx - Context that owns this provider-facing registry. */
  constructor(ctx: Context) {
    super(ctx, 'teamClosureDrives')
  }

  /**
   * Register one backend bridge. Disposing the provider fiber removes it from
   * future passes without invalidating an already admitted backend call.
   * @param backend - Hub-facing implementation selected by a composition.
   * @returns HMR-safe disposer for this exact backend registration.
   */
  registerBackend(backend: TeamClosureDriveBackend): () => void {
    assertBackend(backend)
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return this.ctx.effect(function* (this: TeamClosureDriveBackendRegistry) {
      if (this.backends.has(backend.name)) {
        throw new TeamClosureDriveError(
          `Team closure-drive backend '${backend.name}' is already registered`,
          'TEAM_CLOSURE_DRIVE_BACKEND_DUPLICATE',
        )
      }
      this.backends.set(backend.name, backend)
      yield () => {
        this.backends.delete(backend.name)
      }
    }.bind(this), 'teamClosureDrives.registerBackend()')
  }

  /**
   * Resolve one live backend without changing its registration lifetime.
   * @param backend - configured backend identity.
   * @returns the live provider bridge, or `undefined` after removal.
   */
  getBackend(backend: string): TeamClosureDriveBackend | undefined {
    return this.backends.get(backend)
  }

  /**
   * Resolve the exact configured bridge or reject before recovery can silently
   * skip durable closure work.
   * @param backend - configured backend identity.
   * @returns the live provider bridge.
   * @throws {@link TeamClosureDriveError} when the backend is unavailable.
   */
  requireBackend(backend: string): TeamClosureDriveBackend {
    const resolved = this.backends.get(backend)
    if (resolved !== undefined) return resolved
    throw new TeamClosureDriveError(
      `Team closure-drive backend '${backend}' is not registered`,
      'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE',
    )
  }

  /**
   * List current backend identities in registration order.
   * @returns detached registered backend references.
   */
  listBackends(): readonly TeamClosureDriveBackendRef[] {
    return [...this.backends.values()].map(backend => Object.freeze({ name: backend.name }))
  }
}

/** One coalesced serial drive retained for one Team identity. */
interface TeamDrive {
  /** Team whose durable closure facts remain authoritative. */
  readonly teamId: TeamId
  /** A notification arrived while the current pass read or drove this Team. */
  requested: boolean
  /** Causes that the next pass must expose to the provider backend. */
  readonly triggers: Set<TeamClosureDriveTrigger>
  /** Current-observer facts waiting for a proof-bound pass. */
  readonly actions: Map<string, TeamClosureDriverAction>
  /** Settles after every pass currently coalesced into this Team drive. */
  readonly operation: Promise<void>
  /** Resolve or reject the public operation after the drive loop settles. */
  readonly settle: PromiseWithResolvers<void>
}

/** Validated immutable driver limits. */
interface ResolvedConfig {
  readonly backend: string
  readonly maxTeamsPerDrive: number
  readonly pageSize: number
  readonly disposalTimeoutMs: number
  readonly pulseIntervalMs?: number
  readonly observerRetryAttempts: number
}

/** One provider pass selected either from durable facts or a current observer. */
type TeamClosureDriverAction = TeamClosureDriverTurnEndRequest | ({
  readonly kind: 'budget'
} & TeamClosureDriverBudgetStallRequest)

/** Provider-routed Team closure scanner with one serializer and one proof map per mounted driver. */
export class TeamClosureDriver {
  private readonly config: ResolvedConfig
  private readonly drives = new Map<string, TeamDrive>()
  private readonly accepted = new Set<Promise<void>>()
  private discoveryCursor = -1
  private readonly listeners: (() => void)[] = []
  private readonly proofs = new Map<TeamSystemClosureDriverProof, TeamSystemClosureDriverScope>()
  private readonly abort = new AbortController()
  private readonly proofSource: TeamSystemClosureDriverProofSource = Object.freeze({
    name: PROOF_SOURCE_NAME,
    resolveClosureDriverProof: (proof: TeamSystemClosureDriverProof): TeamSystemClosureDriverScope | undefined => this.proofs.get(proof),
  })
  private unregisterProofSource: (() => void) | undefined
  private pulseTimer: ReturnType<typeof setInterval> | undefined
  private pulseRunning: Promise<void> | undefined
  private started = false
  private starting: Promise<void> | undefined
  private closing = false
  private finalized = false
  private disposal: Promise<void> | undefined

  /**
   * @param ctx - Context carrying the Team projection service.
   * @param backends - Provider-facing registry selected by composition.
   * @param config - Explicit scan, shutdown, and optional pulse bounds.
   */
  constructor(
    private readonly ctx: Context,
    private readonly backends: TeamClosureDriveBackendRegistry,
    config: Config,
  ) {
    this.config = resolveConfig(config)
  }

  /**
   * Subscribe before scanning so notifications racing startup request a later
   * pass, then finish one bounded startup recovery drive.
   * @returns resolution after the initial bounded drive settles.
   */
  async start(): Promise<void> {
    if (this.closing) throw new Error('team-closure-driver is disposing')
    const starting = this.starting
    if (starting !== undefined) {
      await starting
      return
    }
    if (this.started) return
    const operation = this.startInternal()
    this.starting = operation
    try {
      await operation
    } finally {
      this.starting = undefined
    }
  }

  /** Install the proof source and watches once, then await the first recovery sweep. */
  private async startInternal(): Promise<void> {
    const hub = this.ctx.get('teamClosureDriverHub') as TeamClosureDriverHubReady | undefined
    if (hub?.backend !== this.config.backend) {
      throw new TeamClosureDriveError(
        `Team closure-driver backend '${this.config.backend}' is not provided by the mounted Hub bridge`,
        'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE',
      )
    }
    this.backends.requireBackend(this.config.backend)
    const teams = this.ctx.get('teams')
    if (teams === undefined) {
      throw new TeamClosureDriveError('Team closure-driver requires an active Team runtime', 'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE')
    }
    this.unregisterProofSource = teams.registerSystemClosureDriverProofSource(this.proofSource)
    this.started = true
    this.listeners.push(this.ctx.on('team/changed', (event) => {
      void this.driveFrom({ teamId: teamIdFromEvent(event) }, 'team-event')
    }))
    this.listeners.push(this.ctx.on('channel/changed', (event) => {
      const operation = this.requestChannelDrive(event)
      this.track(operation, `Channel '${event.channelId}' closure drive request`)
    }))
    if (this.config.pulseIntervalMs !== undefined) {
      this.pulseTimer = setInterval(() => { this.requestPulse() }, this.config.pulseIntervalMs)
      this.pulseTimer.unref()
    }
    try {
      await this.driveFrom({}, 'startup')
    } catch (error: unknown) {
      await Promise.allSettled([this.close()])
      throw error
    }
  }

  /**
   * Discover every eligible Team or drive one selected Team. The backend owns
   * semantic cleanup; this consumer only serializes current-state observations.
   * @param request - optional durable Team restriction.
   * @returns resolution after every pass selected by this request settles.
   */
  drive(request: TeamClosureDriverDriveRequest = {}): Promise<void> {
    return this.driveFrom(request, 'manual')
  }

  /**
   * Admit one current coordinator turn result before its product caller
   * reports the missing final or structured failure.
   * @param request - exact activation, Session, turn, and durable reason observation.
   * @returns resolution after the corresponding Team fact is accepted.
   */
  recordTurnEnd(request: TeamClosureDriverTurnEndRequest): Promise<void> {
    assertTurnEndRequest(request)
    if (!this.started || this.closing) {
      return Promise.reject(new TeamClosureDriveError(
        'Team closure driver is not accepting current turn observations',
        'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE',
      ))
    }
    return this.driveFrom({ teamId: request.teamId }, 'turn-end', structuredClone(request))
  }

  /**
   * Admit one frozen budget exhaustion observation through the same
   * proof-bound Hub path used by restart recovery.
   * @param request - Team identity and exact budget reason.
   * @returns resolution after the durable stalled phase is accepted.
   */
  recordBudgetStall(request: TeamClosureDriverBudgetStallRequest): Promise<void> {
    assertBudgetStallRequest(request)
    if (!this.started || this.closing) {
      return Promise.reject(new TeamClosureDriveError(
        'Team closure driver is not accepting budget observations',
        'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE',
      ))
    }
    return this.driveFrom({ teamId: request.teamId }, 'pulse', { kind: 'budget', ...structuredClone(request) })
  }

  /**
   * Stop watches and new drives, then await already admitted backend calls
   * within the configured disposal bound while retaining their proofs.
   * @returns resolution after accepted calls settle, or their aggregate failure.
   */
  close(): Promise<void> {
    this.disposal ??= this.dispose()
    return this.disposal
  }

  /** Run one public or background drive and retain its rejection handler for disposal. */
  private driveFrom(
    request: TeamClosureDriverDriveRequest,
    trigger: TeamClosureDriveTrigger,
    action?: TeamClosureDriverAction,
  ): Promise<void> {
    if (this.closing) return Promise.resolve()
    const operation = request.teamId === undefined
      ? this.driveAllTeams(trigger)
      : this.requestTeamDrive(request.teamId, trigger, action)
    this.track(operation, request.teamId === undefined ? 'Team closure discovery drive' : `Team '${request.teamId}' closure drive`)
    return operation
  }

  /** Start at most one optional discovery pulse while an earlier pulse remains pending. */
  private requestPulse(): void {
    if (this.closing || this.pulseRunning !== undefined) return
    const operation = this.driveFrom({}, 'pulse')
    this.pulseRunning = operation
    void operation.then(
      () => { this.pulseRunning = undefined },
      () => { this.pulseRunning = undefined },
    )
  }

  /** Scan bounded Team pages and request work only for durable closure candidates. */
  private async driveAllTeams(trigger: TeamClosureDriveTrigger): Promise<void> {
    let afterCursor = this.discoveryCursor
    let inspected = 0
    const retryState = { retry: false }
    while (!this.closing && inspected < this.config.maxTeamsPerDrive) {
      const page = await this.ctx.teams.listTeamsPage({
        afterCursor,
        limit: Math.min(this.config.pageSize, this.config.maxTeamsPerDrive - inspected),
      })
      if (page.items.length === 0) {
        this.discoveryCursor = -1
        return
      }
      const candidates = page.items.filter(team => isClosureDriveCandidate(team, [trigger]))
      const budgetActions = await Promise.all(page.items
        .filter(isBudgetScanCandidate)
        .map(async (summary) => {
          try {
            const state = await this.ctx.teams.getTeam({ teamId: summary.id })
            const reason = teamBudgetStallReason(state)
            return reason === undefined ? undefined : {
              kind: 'budget' as const,
              teamId: summary.id,
              reason,
            }
          } catch (error: unknown) {
            retryState.retry = true
            if (!this.closing) this.ctx.logger.warn(
              `team-closure-driver: budget scan for Team '${summary.id}' failed: ${renderError(error)}`,
            )
            return undefined
          }
        }))
      inspected += page.items.length
      if (page.nextCursor !== undefined && page.nextCursor <= afterCursor) {
        throw new TeamError('Team closure discovery page cursor did not advance', 'TEAM_CURSOR_CONFLICT')
      }
      await settleAll(
        [
          ...candidates.map(team => this.requestTeamDrive(team.id, trigger)),
          ...budgetActions.flatMap(action => action === undefined
            ? []
            : [this.requestTeamDrive(action.teamId, trigger, action)]),
        ],
        'Team closure discovery failed',
      )
      if (inspected >= this.config.maxTeamsPerDrive || page.nextCursor === undefined) {
        if (!retryState.retry) this.discoveryCursor = page.nextCursor === undefined ? -1 : page.nextCursor
        return
      }
      afterCursor = page.nextCursor
      if (!retryState.retry) this.discoveryCursor = afterCursor
    }
  }

  /** Return an existing serializer or start one new coalesced Team drive. */
  private requestTeamDrive(teamId: TeamId, trigger: TeamClosureDriveTrigger, action?: TeamClosureDriverAction): Promise<void> {
    if (this.closing) return Promise.resolve()
    const key = teamKey(teamId)
    const current = this.drives.get(key)
    if (current !== undefined) {
      current.requested = true
      current.triggers.add(trigger)
      if (action !== undefined) current.actions.set(actionKey(action), action)
      return current.operation
    }
    const settle = Promise.withResolvers<void>()
    const drive: TeamDrive = {
      teamId,
      requested: true,
      triggers: new Set([trigger]),
      actions: new Map<string, TeamClosureDriverAction>(action === undefined ? [] : [[actionKey(action), action]]),
      operation: settle.promise,
      settle,
    }
    this.drives.set(key, drive)
    void this.runTeamDrive(drive).then(settle.resolve, settle.reject)
    return drive.operation
  }

  /** Resolve a channel notification back to its owning Team without trusting event payload routing. */
  private async requestChannelDrive(event: ChannelEvent): Promise<void> {
    try {
      const channel = await this.ctx.teams.getChannel({ channelId: event.channelId })
      if (!this.closing) await this.requestTeamDrive(channel.manifest.teamId, 'channel-event')
    } catch (error: unknown) {
      if (!this.closing) this.ctx.logger.warn(`team-closure-driver: channel '${event.channelId}' drive request failed: ${renderError(error)}`)
    }
  }

  /** Drain all coalesced request causes for one Team without overlapping backend state selection. */
  private async runTeamDrive(drive: TeamDrive): Promise<void> {
    const failures: unknown[] = []
    let observerRetries = 0
    try {
      while ((drive.requested || drive.actions.size > 0) && !this.closing) {
        drive.requested = false
        const triggers = new Set(drive.triggers)
        drive.triggers.clear()
        const actionEntry = drive.actions.entries().next().value
        const action = actionEntry?.[1]
        if (actionEntry !== undefined) {
          drive.actions.delete(actionEntry[0])
          triggers.add(isBudgetAction(actionEntry[1]) ? 'pulse' : 'turn-end')
        }
        try {
          await this.driveTeam(drive.teamId, [...triggers], action)
          observerRetries = 0
        } catch (error: unknown) {
          const retryableRace = isTeamCursorConflict(error)
            || (action === undefined && isClosureRecoveryProofInvalid(error))
          if (retryableRace && observerRetries < this.config.observerRetryAttempts) {
            observerRetries += 1
            await yieldToQueuedTeamEvents()
            if (action !== undefined) drive.actions.set(actionKey(action), action)
            for (const trigger of triggers) drive.triggers.add(trigger)
            drive.requested = true
            continue
          }
          observerRetries = 0
          failures.push(error)
        }
      }
      if (drive.actions.size > 0) failures.push(unadmittedObservationError())
      throwFailures(failures, `Team '${drive.teamId}' closure drive failed`)
    } finally {
      this.drives.delete(teamKey(drive.teamId))
    }
  }

  /** Read one current projection and permit the provider bridge to select one next idempotent action. */
  private async driveTeam(
    teamId: TeamId,
    triggers: readonly TeamClosureDriveTrigger[],
    action?: TeamClosureDriverAction,
  ): Promise<void> {
    const state = await this.ctx.teams.getTeam({ teamId })
    if (this.closing) {
      if (action !== undefined) throw unadmittedObservationError()
      return
    }
    if (action === undefined && !isClosureDriveCandidate(state.team, triggers)) return
    if (action !== undefined && (state.team.closure !== undefined || state.team.cancellation !== undefined)) return
    const backend = this.backends.requireBackend(this.config.backend)
    const actor = createClosureDriverProof()
    const scope = action === undefined ? closureDriverScope(state.team) : observedScope(state.team, action)
    const request = Object.freeze({
      state: deepFreeze(structuredClone(state)),
      triggers: Object.freeze([...triggers]),
      actor,
      signal: this.abort.signal,
    } satisfies TeamClosureDriveRequest)
    this.proofs.set(actor, scope)
    try {
      await backend.drive(request)
    } finally {
      this.proofs.delete(actor)
    }
  }

  /** Retain background rejection handling without altering the caller-visible promise. */
  private track(operation: Promise<void>, label: string): void {
    if (this.accepted.has(operation)) return
    this.accepted.add(operation)
    void operation.then(
      () => { this.accepted.delete(operation) },
      (error: unknown) => {
        this.accepted.delete(operation)
        this.ctx.logger.warn(`team-closure-driver: ${label} failed: ${renderError(error)}`)
      },
    )
  }

  /** Close all local entry paths before awaiting work that the backend already accepted. */
  private async dispose(): Promise<void> {
    this.closing = true
    if (this.pulseTimer !== undefined) {
      clearInterval(this.pulseTimer)
      this.pulseTimer = undefined
    }
    for (const stop of this.listeners.splice(0)) stop()
    this.abort.abort()
    const accepted = [...this.accepted]
    if (accepted.length === 0) {
      this.finalizeDisposal()
      return
    }
    const settled = Promise.allSettled(accepted)
    try {
      const results = await withTimeout(settled, this.config.disposalTimeoutMs)
      this.finalizeDisposal()
      const failures: unknown[] = []
      for (const result of results) {
        if (result.status === 'rejected') failures.push(result.reason)
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Team closure-driver disposal failed')
    } catch (error: unknown) {
      void settled.then(() => { this.finalizeDisposal() })
      throw error
    }
  }

  /** Release proof ownership only after every admitted drive has settled. */
  private finalizeDisposal(): void {
    if (this.finalized) return
    this.finalized = true
    this.proofs.clear()
    this.unregisterProofSource?.()
    this.unregisterProofSource = undefined
  }
}

/** Install one closure driver after resolving its configured provider bridge. */
export async function apply(ctx: Context, config: Config): Promise<() => Promise<void>> {
  const registry = ctx.get('teamClosureDrives')
  if (registry === undefined) {
    throw new TeamClosureDriveError('Team closure-driver requires an active backend registry', 'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE')
  }
  const driver = new TeamClosureDriver(ctx, registry, config)
  let unregister!: () => void
  try {
    await driver.start()
    unregister = ctx.provide('teamClosureDriver', driver)
  } catch (error: unknown) {
    await Promise.allSettled([driver.close()])
    throw error
  }
  return async () => {
    try {
      await driver.close()
    } finally {
      unregister()
    }
  }
}

/** Reject malformed provider entries before they enter the registry. */
function assertBackend(backend: TeamClosureDriveBackend): void {
  if (backend.name.length === 0 || backend.name.trim() !== backend.name) {
    throw new TeamClosureDriveError(
      'Team closure-drive backend requires a non-empty name and drive() method',
      'TEAM_CLOSURE_DRIVE_BACKEND_INVALID',
    )
  }
}

/** Select only nonterminal Teams with durable lifecycle work visible to this drive. */
function isClosureDriveCandidate(
  team: TeamSnapshot,
  triggers: readonly TeamClosureDriveTrigger[],
): boolean {
  if (team.phase === 'completed' || team.phase === 'failed' || team.phase === 'cancelled') return false
  if (team.closure !== undefined || team.cancellation !== undefined) return true
  return team.phase === 'quiescing'
    && triggers.some(trigger => trigger === 'startup' || trigger === 'pulse' || trigger === 'manual')
}

/** Select active Teams whose frozen budget may need a pulse-created stall. */
function isBudgetScanCandidate(team: TeamSnapshot): boolean {
  return team.phase === 'active' && team.closure === undefined && team.cancellation === undefined
}

/** Return the first exhausted Team budget visible in one detached state. */
function teamBudgetStallReason(state: TeamStateSnapshot): TeamSnapshot['stallReason'] {
  const raw = state.rules['teamLimits']
  const limits = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as JsonObject : undefined
  const ceiling = (key: string, legacyKey?: string): number | undefined => {
    const typedValue = state.budgets[key]
    const typed = typeof typedValue === 'number' && typedValue >= 0
      && (key === 'maxCostUnits' ? Number.isFinite(typedValue) : Number.isSafeInteger(typedValue))
      ? typedValue : undefined
    const legacyValue = legacyKey === undefined ? undefined : limits?.[legacyKey]
    const legacy = typeof legacyValue === 'number' && Number.isSafeInteger(legacyValue) && legacyValue > 0
      ? legacyValue : undefined
    return typed === undefined ? legacy : legacy === undefined ? typed : Math.min(typed, legacy)
  }
  const wallTime = ceiling('maxWallTimeMs', 'maxWallTimeMsPerTeam')
  if (wallTime !== undefined && Math.max(0, Date.now() - state.team.createdAt) >= wallTime) {
    return {
      code: 'TEAM_WALL_TIME_BUDGET_EXCEEDED',
      message: `Team '${state.team.id}' exceeded its ${String(wallTime)}ms wall-time budget`,
    }
  }
  const usage = state.usage
  const values = {
    maxInputTokens: usage?.inputTokens ?? 0,
    maxOutputTokens: usage?.outputTokens ?? 0,
    maxTotalTokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
    maxTurns: usage?.turns ?? 0,
    maxCostUnits: usage?.costUnits ?? 0,
  }
  const dimensions: readonly { readonly key: keyof typeof values; readonly legacy?: string; readonly code: string }[] = [
    // Retry and concurrency ceilings gate new attempts without stopping work already admitted.
    { key: 'maxInputTokens', code: 'TEAM_INPUT_TOKENS_BUDGET_EXCEEDED' },
    { key: 'maxOutputTokens', legacy: 'maxModelTokensPerTeam', code: 'TEAM_TOKEN_BUDGET_EXCEEDED' },
    { key: 'maxTotalTokens', code: 'TEAM_TOTAL_TOKENS_BUDGET_EXCEEDED' },
    { key: 'maxTurns', legacy: 'maxTurnsPerTeam', code: 'TEAM_TURN_BUDGET_EXCEEDED' },
    { key: 'maxCostUnits', legacy: 'maxCostUnitsPerTeam', code: 'TEAM_COST_BUDGET_EXCEEDED' },
  ]
  for (const dimension of dimensions) {
    const limit = ceiling(dimension.key, dimension.legacy)
    if (limit === undefined || values[dimension.key] < limit) continue
    return {
      code: dimension.code,
      message: `Team '${state.team.id}' reached its ${dimension.key} budget of ${String(limit)}`,
    }
  }
  return undefined
}

/** Derive the only Core continuation scope permitted by the current durable Team facts. */
function closureDriverScope(team: TeamSnapshot): TeamSystemClosureDriverScope {
  const cancellation = team.cancellation
  if (cancellation !== undefined) {
    return Object.freeze({
      kind: 'closure-recover-cancel' as const,
      teamId: team.id,
      expectedCursor: team.cursor,
      cancellationIdempotencyKey: cancellation.idempotencyKey,
      cancellationRequestedAt: cancellation.requestedAt,
    })
  }
  const closure = team.closure
  if (closure === undefined) {
    return Object.freeze({
      kind: 'closure-stall-quiescing' as const,
      teamId: team.id,
      expectedCursor: team.cursor,
      reason: {
        code: 'TEAM_CLOSURE_INTENT_MISSING',
        message: `Team '${team.id}' is quiescing without a durable closure producer`,
      },
    })
  }
  switch (closure.kind) {
    case 'complete': {
      if (closure.finalChannelId === undefined || closure.finalEnvelopeId === undefined) {
        throw new TeamClosureDriveError(
          `Team '${team.id}' completion intent has no final channel and Envelope identity`,
          'TEAM_CLOSURE_DRIVE_STATE_INVALID',
        )
      }
      return Object.freeze({
        kind: 'closure-recover-complete' as const,
        teamId: team.id,
        expectedCursor: team.cursor,
        closureIdempotencyKey: closure.idempotencyKey,
        closureRequestedAt: closure.requestedAt,
        finalChannelId: closure.finalChannelId,
        finalEnvelopeId: closure.finalEnvelopeId,
      })
    }
    case 'fail':
      return Object.freeze({
        kind: 'closure-recover-fail' as const,
        teamId: team.id,
        expectedCursor: team.cursor,
        closureIdempotencyKey: closure.idempotencyKey,
        closureRequestedAt: closure.requestedAt,
      })
    case 'cancel':
      throw new TeamClosureDriveError(
        `Team '${team.id}' has a cancellation closure without durable cancellation admission`,
        'TEAM_CLOSURE_DRIVE_STATE_INVALID',
      )
    /* v8 ignore next -- TeamClosureKind is closed and every durable form is handled above. */
    default:
      closure.kind satisfies never
      throw new Error('unreachable Team closure kind')
  }
}

/** Convert one current observer action into a cursor-bound closure-driver scope. */
function observedScope(team: TeamSnapshot, action: TeamClosureDriverAction): TeamSystemClosureDriverScope {
  if (isBudgetAction(action)) {
    return Object.freeze({
      kind: 'closure-stall-budget' as const,
      teamId: team.id,
      expectedCursor: team.cursor,
      reason: structuredClone(action.reason),
    })
  }
  if (action.outcome === 'missing-final') {
    return Object.freeze({
      kind: 'closure-stall-missing-final' as const,
      teamId: team.id,
      expectedCursor: team.cursor,
      coordinatorId: action.coordinatorId,
      activationId: action.activationId,
      sessionId: action.sessionId,
      provider: action.provider,
      turn: action.turn,
      ...action.finalChannelId === undefined ? {} : { finalChannelId: action.finalChannelId },
      ...action.humanId === undefined ? {} : { humanId: action.humanId },
      reason: structuredClone(action.reason),
    })
  }
  return Object.freeze({
    kind: 'closure-fail-turn' as const,
    teamId: team.id,
    expectedCursor: team.cursor,
    coordinatorId: action.coordinatorId,
    activationId: action.activationId,
    sessionId: action.sessionId,
    provider: action.provider,
    turn: action.turn,
    ...action.finalChannelId === undefined ? {} : { finalChannelId: action.finalChannelId },
    ...action.humanId === undefined ? {} : { humanId: action.humanId },
    reason: structuredClone(action.reason),
  })
}

/** Narrow the optional budget action without widening the current-turn contract. */
function isBudgetAction(action: TeamClosureDriverAction): action is Extract<TeamClosureDriverAction, { readonly kind: 'budget' }> {
  return (action as { readonly kind?: unknown }).kind === 'budget'
}

/** Return one stable action key for coalescing duplicate observer notifications. */
function actionKey(action: TeamClosureDriverAction): string {
  return JSON.stringify(action)
}

/** Validate one current coordinator turn observation before it can retain a proof. */
function assertTurnEndRequest(request: TeamClosureDriverTurnEndRequest): void {
  if (request.provider.length === 0 || request.provider.trim() !== request.provider
    || !Number.isSafeInteger(request.turn) || request.turn < 0
    || request.reason.code.length === 0 || request.reason.message.length === 0) {
    throw invalidObservedAction('turn-end observation is malformed')
  }
  if ((request.finalChannelId === undefined) !== (request.humanId === undefined)) {
    throw invalidObservedAction('turn-end observation final channel and human must be supplied together')
  }
  if (request.outcome === 'missing-final' && request.reason.code !== 'FINAL_ANSWER_MISSING') {
    throw invalidObservedAction('missing-final observation must use FINAL_ANSWER_MISSING')
  }
}

/** Validate one current budget observation before it can retain a proof. */
function assertBudgetStallRequest(request: TeamClosureDriverBudgetStallRequest): void {
  if (request.reason.code.length === 0 || request.reason.message.length === 0) {
    throw invalidObservedAction('budget observation is malformed')
  }
}

/** Build the stable error used for malformed current-observer requests. */
function invalidObservedAction(message: string): TeamClosureDriveError {
  return new TeamClosureDriveError(`Team closure driver: ${message}`, 'TEAM_CLOSURE_DRIVE_STATE_INVALID')
}

/** Distinguish an interrupted queue entry from a durably accepted observer fact. */
function unadmittedObservationError(): TeamClosureDriveError {
  return new TeamClosureDriveError(
    'Team closure driver retired before the queued observation was admitted',
    'TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE',
  )
}

/** Recognize the bounded Team-journal race that permits a fresh observer read. */
function isTeamCursorConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { readonly code?: unknown }).code === 'TEAM_CURSOR_CONFLICT'
}

/** Recognize a recovery proof invalidated by a concurrent durable lifecycle append. */
function isClosureRecoveryProofInvalid(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { readonly code?: unknown }).code === 'TEAM_ACTOR_PROOF_INVALID'
}

/** Let an accepted Team event finish publishing before selecting a fresh cursor. */
async function yieldToQueuedTeamEvents(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

/** Resolve the Team identity carried by every immutable Team notification form. */
function teamIdFromEvent(event: TeamEvent): TeamId {
  switch (event.type) {
    case 'team/created':
    case 'team/changed':
      return event.team.id
    case 'goal/changed':
      return event.goal.teamId
    case 'participant/changed':
      return event.participant.teamId
    case 'activation/changed':
      return event.binding.activation.teamId
    case 'participant-interrupt/changed':
      return event.interrupt.target.teamId
    case 'human-action/changed':
      return event.action.teamId
    case 'usage/changed':
      return event.teamId
    case 'workflow-plan/changed':
      return event.plan.teamId
    case 'task/changed':
      return event.task.teamId
    case 'workspace/observed':
      return event.observation.teamId
    case 'workspace-allocation/changed':
      return event.allocation.teamId
    case 'policy/denied':
      return event.teamId
    /* v8 ignore next -- TeamEvent is closed and every durable notification is routed above. */
    default:
      event satisfies never
      throw new Error('unreachable Team event')
  }
}

/** Return one collision-free map key for a branded Team identity. */
function teamKey(teamId: TeamId): string {
  return JSON.stringify(teamId)
}

/** Validate explicit deployment limits before any listener or proof can be retained. */
function resolveConfig(config: Config): ResolvedConfig {
  if (config.backend.trim() !== config.backend || config.backend.length === 0) {
    throw new TypeError('team-closure-driver: backend must be non-empty without surrounding whitespace')
  }
  return {
    backend: config.backend,
    maxTeamsPerDrive: positiveSafeInteger('maxTeamsPerDrive', config.maxTeamsPerDrive),
    pageSize: positiveSafeInteger('pageSize', config.pageSize),
    disposalTimeoutMs: positiveSafeInteger('disposalTimeoutMs', config.disposalTimeoutMs),
    ...config.pulseIntervalMs === undefined ? {} : {
      pulseIntervalMs: positiveSafeInteger('pulseIntervalMs', config.pulseIntervalMs),
    },
    observerRetryAttempts: positiveSafeInteger(
      'observerRetryAttempts',
      config.observerRetryAttempts ?? DEFAULT_OBSERVER_RETRY_ATTEMPTS,
    ),
  }
}

/** Reject a non-positive or non-integral bounded recovery limit. */
function positiveSafeInteger(name: keyof Config, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`team-closure-driver: ${name} must be a positive safe integer`)
  }
  return value
}

/** Create one nonserializable core proof owned by the current driver pass. */
function createClosureDriverProof(): TeamSystemClosureDriverProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team closure-driver proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemClosureDriverProof
}

/** Recursively freeze detached Team observations before a backend can inspect them. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

/** Bound backend shutdown without retaining a timer after normal settlement. */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`team-closure-driver: disposal exceeded ${timeoutMs}ms`)) }, timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Render a listener or background-drive failure without allowing formatting to throw. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/** Wait for every parallel Team pass so discovery reports all branch failures. */
async function settleAll(operations: readonly Promise<void>[], message: string): Promise<void> {
  const results = await Promise.allSettled(operations)
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason as unknown)
  throwFailures(failures, message)
}

/** Report failures only after every operation owned by the caller has settled. */
function throwFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, message)
}
