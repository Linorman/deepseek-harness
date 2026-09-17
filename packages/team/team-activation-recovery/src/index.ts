import type { TeamListPageRequest } from '@clocky/clocky-team'
/**
 * Explicit one-shot same-host recovery of stale Team activation epochs.
 * @module @clocky/clocky-team-activation-recovery
 */

import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { TeamError } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-activation-controller'
import type {
  ActivationBindingSnapshot,
  ActivationFenceInput,
  ParticipantSnapshot,
  TeamStateSnapshot,
  TeamSystemActivationProof,
  TeamSystemActivationProofSource,
  TeamSystemActivationScope,
} from '@clocky/clocky-team'

/** Cordis plugin name. */
export const name = 'team-activation-recovery'
/** Durable Team state and the sole cold-replacement owner must exist first. */
export const inject = ['teams', 'teamActivations']

/** Explicit local SDK deployment identity selected for one startup scan. */
export interface Config {
  /** AgentRuntime provider that owns the stale activation. */
  readonly provider: string
  /** Recovery record kind selected by the matching provider. */
  readonly kind?: 'sdk-local-cold-replace' | 'acp-local-cold-replace'
  /** Non-secret recovery profile configured on this host. */
  readonly profile: string
  /** Stable identity of the host allowed to replace the recorded process. */
  readonly hostId: string
  /** Optional recurring recovery pulse for epochs created after startup. */
  readonly pulseIntervalMs?: number
  /** Additional exact execution hosts accepted through their durable supervisor descriptors. */
  readonly supervisorHosts?: string[]
  /** Maximum Team identities requested from one durable discovery page. */
  readonly pageSize?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  provider: z.string().min(1).required(),
  kind: z.union([z.const('sdk-local-cold-replace'), z.const('acp-local-cold-replace')]).default('sdk-local-cold-replace'),
  profile: z.string().min(1).required(),
  hostId: z.string().min(1).required(),
  pulseIntervalMs: z.number().step(1).min(1).default(undefined as unknown as number),
  supervisorHosts: z.array(z.string().min(1)),
  pageSize: z.number().step(1).min(1).default(128),
})

const TEAM_ACTIVATION_RECOVERY_PROOF_SOURCE = 'team-activation-recovery'

interface ResolvedConfig {
  readonly provider: string
  readonly kind: NonNullable<Config['kind']>
  readonly profile: string
  readonly hostId: string
  readonly pulseIntervalMs?: number
  readonly supervisorHosts: readonly string[]
  readonly pageSize: number
}

/** Snapshot relation established by the Team binding schema for a locally quiesced epoch. */
type QuiescedActivationBinding = ActivationBindingSnapshot & {
  readonly quiescedWakeChannelIds: NonNullable<ActivationBindingSnapshot['quiescedWakeChannelIds']>
}

/** Private issuer for one startup-recovery wake-cleanup proof at a time. */
class ActivationRecoveryProofIssuer {
  private readonly proofs = new Map<TeamSystemActivationProof, TeamSystemActivationScope>()
  private closed = false

  /** Source registered for this recovery plugin fiber. */
  readonly source: TeamSystemActivationProofSource = Object.freeze({
    name: TEAM_ACTIVATION_RECOVERY_PROOF_SOURCE,
    resolveActivationProof: (proof: TeamSystemActivationProof): TeamSystemActivationScope | undefined =>
      this.resolve(proof),
  })

  /** Issue one exact recovery quiescence proof only for its one Hub call. */
  async quiesce<T>(input: ActivationFenceInput, operation: (actor: TeamSystemActivationProof) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('team-activation-recovery proof issuer is closed')
    const proof = createTeamActivationRecoveryProof()
    this.proofs.set(proof, Object.freeze({
      kind: 'activation-recovery-quiesce',
      ...structuredClone(input),
    }))
    try {
      return await operation(proof)
    } finally {
      this.proofs.delete(proof)
    }
  }

  /** Invalidate every outstanding proof before the recovery plugin tears down. */
  close(): void {
    this.closed = true
    this.proofs.clear()
  }

  /** Resolve only one live proof retained by this exact recovery plugin fiber. */
  private resolve(proof: TeamSystemActivationProof): TeamSystemActivationScope | undefined {
    if (this.closed) return undefined
    return this.proofs.get(proof)
  }
}

/** Run exactly one deployment-selected startup scan. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)
  const proofs = new ActivationRecoveryProofIssuer()
  const unregisterProofSource = ctx.teams.registerSystemActivationProofSource(proofs.source)
  try {
    await recoverOnce(ctx, resolved, proofs)
  } catch (error: unknown) {
    proofs.close()
    unregisterProofSource()
    throw error
  }
  const controller = new AbortController()
  let running: Promise<void> | undefined
  ctx.effect(() => async () => {
    controller.abort()
    await running
    proofs.close()
    unregisterProofSource()
  }, 'team-activation-recovery.activationProofSource()')
  if (resolved.pulseIntervalMs !== undefined) {
    const timer = setInterval(() => {
      if (running !== undefined) return
      running = recoverOnce(ctx, resolved, proofs, controller.signal).catch((error: unknown) => {
        ctx.logger.warn(`team-activation-recovery: recurring scan failed: ${String(error)}`)
      }).finally(() => { running = undefined })
    }, resolved.pulseIntervalMs)
    timer.unref()
    ctx.effect(() => () => { clearInterval(timer) }, 'team-activation-recovery.pulse()')
  }
}

/** Scan the currently discovered durable Teams for matching recoverable epochs. */
async function recoverOnce(
  ctx: Context,
  resolved: ResolvedConfig,
  proofs: ActivationRecoveryProofIssuer,
  signal: AbortSignal = new AbortController().signal,
): Promise<void> {
  let afterCursor: TeamListPageRequest['afterCursor'] = -1
  do {
    signal.throwIfAborted()
    const page = await ctx.teams.listTeamsPage({ afterCursor, limit: resolved.pageSize })
    for (const team of page.items) {
      signal.throwIfAborted()
      if (team.phase !== 'active') continue
      const state = await ctx.teams.getTeam({ teamId: team.id })
      if (state.team.phase !== 'active') continue
      for (const candidate of latestParticipantBindings(state)) {
        signal.throwIfAborted()
        if (!matchesLocalStartupRecovery(candidate, state.participants, resolved)) continue
        const current = await ctx.teams.getTeam({ teamId: team.id })
        if (current.team.phase !== 'active') continue
        const binding = currentLatestBinding(current, candidate)
        if (binding === undefined || !matchesLocalStartupRecovery(binding, current.participants, resolved)) continue
        if (binding.quiescenceSource === 'quiesced') {
          const quiescedBinding = binding as QuiescedActivationBinding
          if (await hasUnclosedWakeChannel(ctx, quiescedBinding)) {
            const input: ActivationFenceInput = {
              teamId: binding.activation.teamId,
              activationId: binding.activation.id,
              participantId: binding.activation.participantId,
              sessionId: binding.sessionId,
              provider: binding.provider,
              expectedCursor: current.team.cursor,
            }
            await proofs.quiesce(input, async actor => await ctx.teams.quiesceActivation({ actor, ...input }))
          }
          continue
        }
        try {
          await ctx.teamActivations.coldReplace({
            teamId: current.team.id,
            participantId: binding.activation.participantId,
            activationId: binding.activation.id,
            signal,
          })
        } catch (error: unknown) {
          if (signal.aborted) throw error
          if (error instanceof TeamError && error.code === 'TEAM_ACTIVATION_RECOVERY_CONFLICT') continue
          const latest = await ctx.teams.getTeam({ teamId: current.team.id })
          if (!isRecordedRecoveryStall(latest)) throw error
        }
      }
    }
    if (page.nextCursor === undefined) break
    if (page.nextCursor === afterCursor) {
      throw new TeamError('Activation recovery received a non-advancing Team page', 'TEAM_CURSOR_CONFLICT')
    }
    afterCursor = page.nextCursor
  } while (true)
}

/** Continue the discovery scan only after this exact candidate wrote a named durable stall. */
function isRecordedRecoveryStall(state: TeamStateSnapshot): boolean {
  const code = state.team.stallReason?.code
  return state.team.phase === 'stalled'
    && (code?.startsWith('SUPERVISOR_') === true || code?.startsWith('AGENT_RUNTIME_') === true)
}

/** Create one non-serializable proof that only this recovery plugin fiber can resolve. */
function createTeamActivationRecoveryProof(): TeamSystemActivationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => {
      throw new TypeError('Team activation recovery proofs are runtime-only and cannot be serialized')
    },
  })
  return Object.freeze(proof) as TeamSystemActivationProof
}

/** Re-read one initial candidate only when it remains that participant's latest epoch. */
function currentLatestBinding(
  state: TeamStateSnapshot,
  candidate: ActivationBindingSnapshot,
): ActivationBindingSnapshot | undefined {
  const binding = state.activations.find(item => item.activation.id === candidate.activation.id)
  if (binding === undefined) return undefined
  const latest = latestParticipantBindings(state).find(
    item => item.activation.participantId === binding.activation.participantId,
  )
  return latest?.activation.id === binding.activation.id ? binding : undefined
}

/** Retain only each participant's latest durable epoch; state retains activation history. */
function latestParticipantBindings(state: TeamStateSnapshot): readonly ActivationBindingSnapshot[] {
  const latestIndexes = new Map<string, number>()
  for (const [index, binding] of state.activations.entries()) {
    latestIndexes.set(binding.activation.participantId, index)
  }
  return state.activations.filter((binding, index) => latestIndexes.get(binding.activation.participantId) === index)
}

/** Match an unfinished epoch or a quiesced epoch whose wake cleanup may need retry. */
function matchesLocalStartupRecovery(
  binding: ActivationBindingSnapshot,
  participants: readonly ParticipantSnapshot[],
  config: ResolvedConfig,
): boolean {
  const recovery = binding.recovery
  const participant = participants.find(candidate => candidate.id === binding.activation.participantId)
  return recovery?.kind === config.kind
    && binding.provider === config.provider
    && recovery.profile === config.profile
    && (recovery.supervisor === undefined ? recovery.process.hostId === config.hostId
      : (recovery.supervisor.hostId === config.hostId || config.supervisorHosts.includes(recovery.supervisor.hostId)))
    && participant?.phase === 'active'
    && (participant.kind === 'local-agent' || participant.kind === 'remote-agent')
}

/** Return whether a recorded quiesced wake channel has not yet reached a terminal phase. */
async function hasUnclosedWakeChannel(ctx: Context, binding: QuiescedActivationBinding): Promise<boolean> {
  for (const channelId of binding.quiescedWakeChannelIds) {
    const channel = await ctx.teams.getChannel({ channelId })
    if (channel.phase === 'closed' || channel.phase === 'expired' || channel.phase === 'failed') continue
    return true
  }
  return false
}

/** Reject non-canonical deployment identities before any process can be fenced. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    provider: normalizedConfigText('provider', config.provider),
    kind: config.kind ?? 'sdk-local-cold-replace',
    profile: normalizedConfigText('profile', config.profile),
    hostId: normalizedConfigText('hostId', config.hostId),
    supervisorHosts: (config.supervisorHosts ?? []).map(host => normalizedConfigText('supervisorHosts', host)),
    pageSize: positiveInterval(config.pageSize ?? 128),
    ...config.pulseIntervalMs === undefined ? {} : { pulseIntervalMs: positiveInterval(config.pulseIntervalMs) },
  }
}

/** Validate one optional recurring recovery interval before creating a timer. */
function positiveInterval(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('team-activation-recovery: pulseIntervalMs must be a positive safe integer')
  }
  return value
}

/** Normalize one exact deployment identity without changing its durable comparison value. */
function normalizedConfigText(field: keyof Config, value: string): string {
  if (value.trim().length === 0 || value.trim() !== value) {
    throw new TypeError(`team-activation-recovery: ${field} must be non-empty without surrounding whitespace`)
  }
  return value
}
