import type { TeamListPageRequest } from '@clocky/clocky-team'
/** Durable recovery of release-requested Team workspace allocations. @module @clocky/clocky-team-workspace-recovery */

import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { TeamError } from '@clocky/clocky-team'
import type {
  TeamId,
  TeamSystemWorkspaceAllocationProof,
  TeamSystemWorkspaceAllocationProofSource,
  TeamSystemWorkspaceAllocationScope,
  TeamWorkspaceAllocationSnapshot,
} from '@clocky/clocky-team'
import type { TeamWorkspaceAllocationMetadata, TeamWorkspacePrepareRequest } from '@clocky/clocky-team-workspace'
import { TeamWorkspaceLostError } from '@clocky/clocky-team-workspace'

/** Cordis plugin name. */
export const name = 'team-workspace-recovery'
/** Team durability and the registered workspace providers must exist before recovery. */
export const inject = ['teams', 'teamWorkspaces']

const PROOF_SOURCE_NAME = 'team-workspace-recovery'
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Explicit bounded recovery configuration. */
export interface Config {
  /** Maximum Team records inspected in one recovery drive. */
  readonly maxTeamsPerDrive: number
  /** Maximum Team-list page size used while scanning durable state. */
  readonly pageSize: number
  /** Maximum distinct Teams retained in the event queue; overflow requests a durable scan. */
  readonly maxPendingTeams?: number
  /** Maximum attempts for one durable Team or Team-page read after an I/O failure. */
  readonly readAttempts?: number
  /** Milliseconds between retries of one failed durable read. */
  readonly readRetryDelayMs?: number
  /** Maximum confirmation attempts after one successful provider release. */
  readonly confirmationAttempts?: number
  /** Milliseconds between confirmation attempts after a failed durable append. */
  readonly confirmationRetryDelayMs?: number
  /** Optional interval that retries durable release requests without new events. */
  readonly pulseIntervalMs?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  maxTeamsPerDrive: z.number().step(1).min(1).required(),
  pageSize: z.number().step(1).min(1).required(),
  maxPendingTeams: z.number().step(1).min(1).default(undefined as unknown as number),
  readAttempts: z.number().step(1).min(1).default(3),
  readRetryDelayMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(100),
  confirmationAttempts: z.number().step(1).min(1).default(3),
  confirmationRetryDelayMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(100),
  pulseIntervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(undefined as unknown as number),
})

/** Resolved immutable scan limits retained by one recovery Consumer. */
interface ResolvedConfig {
  readonly maxTeamsPerDrive: number
  readonly pageSize: number
  readonly maxPendingTeams: number
  readonly readAttempts: number
  readonly readRetryDelayMs: number
  readonly confirmationAttempts: number
  readonly confirmationRetryDelayMs: number
  readonly pulseIntervalMs?: number
}

/** Private one-shot issuer for source-scoped allocation lifecycle transitions. */
class WorkspaceRecoveryProofIssuer {
  private readonly proofs = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()

  /** Source contribution retained for this mounted recovery owner. */
  readonly source: TeamSystemWorkspaceAllocationProofSource = Object.freeze({
    name: PROOF_SOURCE_NAME,
    resolveWorkspaceAllocationProof: (proof: TeamSystemWorkspaceAllocationProof) => this.proofs.get(proof),
  })

  /** Run one exact allocation lifecycle command through an ephemeral source proof. */
  async withProof<T>(
    scope: TeamSystemWorkspaceAllocationScope,
    operation: (actor: TeamSystemWorkspaceAllocationProof) => Promise<T>,
  ): Promise<T> {
    const proof = createWorkspaceRecoveryProof()
    this.proofs.set(proof, Object.freeze(structuredClone(scope)))
    try {
      return await operation(proof)
    } finally {
      this.proofs.delete(proof)
    }
  }

  /** Invalidate all retained proof scopes before unregistration. */
  close(): void {
    this.proofs.clear()
  }
}

/** Install bounded startup and event recovery; teardown drains accepted provider operations. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)
  const proofs = new WorkspaceRecoveryProofIssuer()
  const unregister = ctx.teams.registerSystemWorkspaceAllocationProofSource(proofs.source)
  const pending = new Set<TeamId>()
  let accepting = true
  let timer: ReturnType<typeof setInterval> | undefined
  let running: Promise<void> | undefined
  let sweepCursor: TeamListPageRequest['afterCursor'] | undefined = -1
  let overflow = false
  const schedule = (): void => {
    if (!accepting || running !== undefined) return
    if (sweepCursor === undefined && overflow) {
      sweepCursor = -1
      overflow = false
    }
    const cursor = sweepCursor
    if (cursor === undefined && pending.size === 0) return
    const teams = cursor === undefined ? [...pending].slice(0, resolved.maxTeamsPerDrive) : []
    for (const teamId of teams) pending.delete(teamId)
    running = (cursor === undefined
      ? reconcileTeams(ctx, proofs, resolved, teams)
      : recoverOnce(ctx, resolved, proofs, cursor).then((next) => { sweepCursor = next })
    ).catch((error: unknown) => {
      if (cursor !== undefined) sweepCursor = error instanceof TeamError && error.code === 'TEAM_DISCOVERY_CURSOR_EXPIRED' ? -1 : undefined
      ctx.logger.warn(`team-workspace-recovery: drive failed: ${renderError(error)}`)
    }).finally(() => {
      running = undefined
      schedule()
    })
  }
  const unsubscribe = ctx.on('team/changed', (event) => {
    if (!accepting || event.type !== 'workspace-allocation/changed' || !hasReleaseIntent(event.allocation)) return
    const teamId = event.allocation.teamId
    if (pending.has(teamId) || pending.size < resolved.maxPendingTeams) pending.add(teamId)
    else overflow = true
    schedule()
  })
  running = recoverOnce(ctx, resolved, proofs, -1).then((next) => { sweepCursor = next })
  try {
    await running
  } catch (error: unknown) {
    accepting = false
    unsubscribe()
    proofs.close()
    unregister()
    throw error
  } finally {
    running = undefined
  }
  ctx.effect(() => async () => {
    accepting = false
    unsubscribe()
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    pending.clear()
    sweepCursor = undefined
    overflow = false
    try {
      await running
    } finally {
      proofs.close()
      unregister()
    }
  }, 'team-workspace-recovery.lifecycle()')
  schedule()
  if (resolved.pulseIntervalMs === undefined) return
  timer = setInterval(() => {
    sweepCursor ??= -1
    schedule()
  }, resolved.pulseIntervalMs)
  timer.unref()
}

/** Attempt every selected Team even when another allocation's durable settlement fails. */
async function reconcileTeams(
  ctx: Context,
  proofs: WorkspaceRecoveryProofIssuer,
  config: ResolvedConfig,
  teams: readonly TeamId[],
): Promise<void> {
  const errors: unknown[] = []
  for (const teamId of teams) {
    try {
      const state = await readWithRetry(config, `Team '${teamId}'`, async () => await ctx.teams.getTeam({ teamId }))
      for (const allocation of state.workspaceAllocations) {
        if (!hasReleaseIntent(allocation)) continue
        try {
          await reconcileAllocation(ctx, proofs, config, allocation)
        } catch (error: unknown) {
          errors.push(error)
        }
      }
    } catch (error: unknown) {
      errors.push(error)
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'Team workspace recovery settlement failed')
}

/** Scan bounded Team pages and settle only durable release-requested allocations. */
async function recoverOnce(
  ctx: Context,
  config: ResolvedConfig,
  proofs: WorkspaceRecoveryProofIssuer,
  afterCursor: TeamListPageRequest['afterCursor'],
): Promise<TeamListPageRequest['afterCursor'] | undefined> {
  let inspected = 0
  while (inspected < config.maxTeamsPerDrive) {
    const page = await readWithRetry(config, 'Team list', async () => await ctx.teams.listTeamsPage({
      afterCursor,
      limit: Math.min(config.pageSize, config.maxTeamsPerDrive - inspected),
    }))
    const selected = page.items.slice(0, config.maxTeamsPerDrive - inspected)
    await reconcileTeams(ctx, proofs, config, selected.map(team => team.id))
    inspected += page.scanned
    if (page.nextCursor !== undefined && page.nextCursor === afterCursor) {
      throw new TeamError('Team list recovery page cursor did not advance', 'TEAM_CURSOR_CONFLICT')
    }
    if (inspected >= config.maxTeamsPerDrive) return page.nextCursor
    if (page.nextCursor === undefined) return
    afterCursor = page.nextCursor
  }
}

/** Reconcile one provider-owned cleanup and record either release or durable preservation. */
async function reconcileAllocation(
  ctx: Context,
  proofs: WorkspaceRecoveryProofIssuer,
  config: ResolvedConfig,
  candidate: TeamWorkspaceAllocationSnapshot,
): Promise<void> {
  if (candidate.lifecycle === 'unavailable') {
    const state = await readWithRetry(config, `Team '${candidate.teamId}'`, async () => await ctx.teams.getTeam({ teamId: candidate.teamId }))
    const current = state.workspaceAllocations.find(allocation => allocation.id === candidate.id)
    if (current === undefined || !hasReleaseIntent(current)) return
    if (current.lifecycle === 'unavailable') {
      const input = lifecycleInput(state.team.cursor, current)
      await proofs.withProof({ kind: 'workspace-allocation-release-request', ...input }, async actor =>
        await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...input }))
    }
  }
  const request = workspaceRequest(candidate)
  try {
    await ctx.teamWorkspaces.reconcileRelease(candidate.mode, request, workspaceMetadata(candidate))
  } catch (error: unknown) {
    if (!(error instanceof TeamWorkspaceLostError)) {
      await preserveAfterFailure(ctx, proofs, config, candidate, error)
      return
    }
    const state = await readWithRetry(config, `Team '${candidate.teamId}'`, async () => await ctx.teams.getTeam({ teamId: candidate.teamId }))
    const current = state.workspaceAllocations.find(allocation => allocation.id === candidate.id)
    if (current?.lifecycle !== 'release-requested') return
    const lossInput = { ...lifecycleInput(state.team.cursor, current), loss: error.loss }
    const unavailable = await proofs.withProof({ kind: 'workspace-allocation-loss', ...lossInput }, async actor =>
      await ctx.teams.recordWorkspaceAllocationLoss({ actor, ...lossInput }))
    if (!error.loss.terminationProven) return
    const latest = await ctx.teams.getTeam({ teamId: current.teamId })
    const releaseInput = lifecycleInput(latest.team.cursor, unavailable)
    await proofs.withProof({ kind: 'workspace-allocation-release-request', ...releaseInput }, async actor =>
      await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...releaseInput }))
    await ctx.teamWorkspaces.reconcileRelease(candidate.mode, request, workspaceMetadata(candidate))
  }
  const failures: unknown[] = []
  for (let attempt = 0; attempt < config.confirmationAttempts; attempt += 1) {
    const state = await readWithRetry(config, `Team '${candidate.teamId}'`, async () => await ctx.teams.getTeam({ teamId: candidate.teamId }))
    const current = state.workspaceAllocations.find(allocation => allocation.id === candidate.id)
    if (current === undefined || current.lifecycle !== 'release-requested') return
    const input = lifecycleInput(state.team.cursor, current)
    try {
      await proofs.withProof({ kind: 'workspace-allocation-release', ...input }, async actor =>
        await ctx.teams.confirmWorkspaceAllocationRelease({ actor, ...input }))
      return
    } catch (error: unknown) {
      failures.push(error)
    }
    if (attempt + 1 < config.confirmationAttempts) {
      await new Promise<void>((resolve) => { setTimeout(resolve, config.confirmationRetryDelayMs) })
    }
  }
  const failure = new AggregateError(failures, `Workspace allocation '${candidate.id}' release succeeded but confirmation failed`)
  try {
    await preserveAfterFailure(ctx, proofs, config, candidate, failure)
  } catch (error: unknown) {
    throw new AggregateError([...failures, error], `Workspace allocation '${candidate.id}' release has no durable settlement`)
  }
}

/** A proven expired world retains its earlier release intent across a crash after loss admission. */
function hasReleaseIntent(allocation: TeamWorkspaceAllocationSnapshot): boolean {
  return allocation.lifecycle === 'release-requested'
    || (allocation.lifecycle === 'unavailable' && allocation.loss?.terminationProven === true && allocation.releaseRequestedAt !== undefined)
}

/** Preserve a still-current release request when its provider cannot prove cleanup. */
async function preserveAfterFailure(
  ctx: Context,
  proofs: WorkspaceRecoveryProofIssuer,
  config: ResolvedConfig,
  candidate: TeamWorkspaceAllocationSnapshot,
  error: unknown,
): Promise<void> {
  const state = await readWithRetry(config, `Team '${candidate.teamId}'`, async () => await ctx.teams.getTeam({ teamId: candidate.teamId }))
  const current = state.workspaceAllocations.find(allocation => allocation.id === candidate.id)
  if (current === undefined || current.lifecycle !== 'release-requested') return
  const input = {
    ...lifecycleInput(state.team.cursor, current),
    reason: {
      code: 'WORKSPACE_RELEASE_RECOVERY_FAILED',
      message: renderError(error),
    },
  }
  await proofs.withProof({ kind: 'workspace-allocation-preserve', ...input }, async actor =>
    await ctx.teams.preserveWorkspaceAllocation({ actor, ...input }))
}

/** Retry transient storage reads without repeating an already successful provider action. */
async function readWithRetry<T>(config: ResolvedConfig, subject: string, read: () => Promise<T>): Promise<T> {
  const failures: unknown[] = []
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read()
    } catch (error: unknown) {
      if (isPermanentReadFailure(error)) throw error
      failures.push(error)
      if (attempt + 1 >= config.readAttempts) throw new AggregateError(failures, `${subject} recovery read failed`)
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, config.readRetryDelayMs) })
  }
}

/** Format, permission and stable Team admission failures require an external correction. */
function isPermanentReadFailure(error: unknown): boolean {
  if (error instanceof TeamError) return error.code !== 'TEAM_CURSOR_CONFLICT'
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return code === 'TEAM_JOURNAL_MALFORMED' || code === 'TEAM_CHANNEL_WAL_MALFORMED' || code === 'TEAM_CHECKPOINT_INVALID'
    || code === 'EACCES' || code === 'EPERM'
}

/** Build an exact provider reconciliation request without a live filesystem root. */
function workspaceRequest(allocation: TeamWorkspaceAllocationSnapshot): TeamWorkspacePrepareRequest {
  return {
    teamId: allocation.teamId,
    taskId: allocation.taskId,
    attemptId: allocation.attemptId,
    assignedRevision: allocation.assignedRevision,
    participantId: allocation.participantId,
    activationId: allocation.activationId,
    sessionId: allocation.sessionId,
  }
}

/** Copy durable provider metadata without treating any root or credential as recoverable authority. */
function workspaceMetadata(allocation: TeamWorkspaceAllocationSnapshot): TeamWorkspaceAllocationMetadata {
  return {
    id: allocation.id,
    provider: allocation.provider,
    mode: allocation.mode,
    ...workspaceRequest(allocation),
    ...allocation.baseVersion === undefined ? {} : { baseVersion: allocation.baseVersion },
    ...allocation.executionWorld === undefined ? {} : { executionWorld: allocation.executionWorld },
  }
}

/** Build the common cursor/revision fence for a current release-requested allocation. */
function lifecycleInput(teamCursor: number, allocation: TeamWorkspaceAllocationSnapshot) {
  return {
    teamId: allocation.teamId,
    expectedCursor: teamCursor,
    allocationId: allocation.id,
    expectedRevision: allocation.revision,
  }
}

/** Validate explicit bounded configuration values before a recovery owner mounts. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    maxTeamsPerDrive: positiveSafeInteger('maxTeamsPerDrive', config.maxTeamsPerDrive),
    pageSize: positiveSafeInteger('pageSize', config.pageSize),
    maxPendingTeams: positiveSafeInteger('maxPendingTeams', config.maxPendingTeams ?? config.maxTeamsPerDrive),
    readAttempts: positiveSafeInteger('readAttempts', config.readAttempts ?? 3),
    readRetryDelayMs: positiveTimerDelay('readRetryDelayMs', config.readRetryDelayMs ?? 100),
    confirmationAttempts: positiveSafeInteger('confirmationAttempts', config.confirmationAttempts ?? 3),
    confirmationRetryDelayMs: positiveTimerDelay('confirmationRetryDelayMs', config.confirmationRetryDelayMs ?? 100),
    ...config.pulseIntervalMs === undefined ? {} : { pulseIntervalMs: positiveTimerDelay('pulseIntervalMs', config.pulseIntervalMs) },
  }
}

/** Reject non-positive or non-integral recovery bounds. */
function positiveSafeInteger(name: keyof Config, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`team-workspace-recovery: ${name} must be a positive safe integer`)
  }
  return value
}

/** Reject durations that Node would coerce to a one-millisecond timer. */
function positiveTimerDelay(name: keyof Config, value: number): number {
  positiveSafeInteger(name, value)
  if (value > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`team-workspace-recovery: ${name} must not exceed ${MAX_TIMER_DELAY_MS}ms`)
  }
  return value
}

/** Create one opaque proof that cannot cross a durable or wire boundary. */
function createWorkspaceRecoveryProof(): TeamSystemWorkspaceAllocationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team workspace recovery proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemWorkspaceAllocationProof
}

/** Render an owned recovery failure without allowing diagnostic conversion to throw. */
function renderError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
