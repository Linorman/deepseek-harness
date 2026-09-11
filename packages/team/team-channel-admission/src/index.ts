/** Durable invitation admission waits shared by channel dispatch Consumers. @module @clocky/clocky-team-channel-admission */
import { Context, Service } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { TeamError } from '@clocky/clocky-team'
import type { ParticipantId, ChannelAdmissionSnapshot, TeamId, ChannelId, ChannelSnapshot, TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope } from '@clocky/clocky-team'

declare module '@clocky/cordis' {
  interface Context {
    teamChannelAdmission: TeamChannelAdmission
  }
}

/** Exact channel and cancellation lifetime for a dispatch waiting on endpoint consent. */
export interface ChannelAdmissionWaitRequest {
  /** Pending or active channel to observe. */
  readonly channelId: ChannelId
  /** Dispatch owner's cancellation lifetime. */
  readonly signal: AbortSignal
}

/** Runtime-only endpoint capability supplied by an authenticated product transport. */
export interface HumanChannelAdmissionRequest {
  /** Exact pending manifest and invitation projection produced by the Hub. */
  readonly admission: ChannelAdmissionSnapshot
  /** Product human selected by the Team owner; the proof binder independently verifies ownership. */
  readonly participantId: ParticipantId
  /** Caller and creation cancellation lifetime. */
  readonly signal: AbortSignal
}

/** Accept a supported immutable human endpoint manifest using live transport authority. */
export type HumanChannelAdmission = (request: HumanChannelAdmissionRequest) => Promise<void>

/** Bounded startup and deadline recovery configuration. */
export interface Config {
  /** Delay between independent recovery passes. */
  readonly scanIntervalMs: number
  /** Maximum Team summaries discovered per storage page. */
  readonly teamPageSize: number
  /** Maximum channel invitations inspected per pass. */
  readonly maxChannelsPerPass: number
}

/** Validate recovery cadence and bounded discovery. */
export const Config: z<Config> = z.object({
  scanIntervalMs: z.number().step(1).min(1).default(100),
  teamPageSize: z.number().step(1).min(1).default(64),
  maxChannelsPerPass: z.number().step(1).min(1).default(128),
})

/** Shared channel admission Consumer; endpoint acknowledgements remain owned by their authenticated receivers. */
export default class TeamChannelAdmission extends Service {
  static inject = ['teams']
  static Config = Config
  private readonly proofs = new WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>()
  private readonly queued: { teamId: TeamId; channelId: ChannelId }[] = []
  private teamCursor = -1
  private drive: Promise<void> | undefined
  private readonly closing = new AbortController()
  private readonly waits = new Set<Promise<ChannelSnapshot>>()

  /** @param ctx - context carrying the authoritative Team provider.
   * @param config - validated recovery cadence and page bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'teamChannelAdmission')
    ctx.teams.registerSystemChannelAdmissionProofSource({ name: 'team-channel-admission',
      resolveChannelAdmissionProof: proof => this.proofs.get(proof) })
    const schedule = () => { void this.runOnce().catch((error: unknown) => {
      if (!this.closing.signal.aborted) ctx.logger.warn(`team-channel-admission: recovery failed: ${String(error)}`)
    }) }
    const timer = setInterval(schedule, config.scanIntervalMs)
    timer.unref()
    schedule()
    ctx.effect(() => async () => {
      clearInterval(timer)
      this.closing.abort()
      await Promise.allSettled([...this.waits, ...this.drive === undefined ? [] : [this.drive]])
    })
  }

  /**
   * Replay one bounded discovery/expiry pass; acknowledged invitations are never reissued.
   * @returns settlement after this pass's accepted Hub operations finish.
   */
  runOnce(): Promise<void> {
    if (this.closing.signal.aborted) return Promise.resolve()
    if (this.drive !== undefined) return this.drive
    const operation = this.recover()
    this.drive = operation
    void operation.then(() => { if (this.drive === operation) this.drive = undefined },
      () => { if (this.drive === operation) this.drive = undefined })
    return operation
  }

  /** Observe durable deadlines in bounded FIFO order; restart rebuilds this non-authoritative queue. */
  private async recover(): Promise<void> {
    if (this.queued.length === 0) {
      const page = await this.ctx.teams.listTeamsPage({ afterCursor: this.teamCursor, limit: this.config.teamPageSize })
      if (page.nextCursor !== undefined && page.nextCursor <= this.teamCursor) {
        throw new TeamError('Channel admission Team page cursor did not advance', 'TEAM_CURSOR_CONFLICT')
      }
      for (const team of page.items) {
        const state = await this.ctx.teams.getTeam({ teamId: team.id })
        this.queued.push(...state.channelIds.map(channelId => ({ teamId: team.id, channelId })))
      }
      this.teamCursor = page.nextCursor ?? -1
    }
    for (let count = 0; count < this.config.maxChannelsPerPass && !this.closing.signal.aborted; count += 1) {
      const selected = this.queued.shift()
      if (selected === undefined) return
      try {
        const admission = await this.ctx.teams.getChannelAdmission({ channelId: selected.channelId })
        const now = Date.now()
        if (!['pending', 'active'].includes(admission.channel.phase)
          || !admission.invitations.some(invitation => invitation.status === 'pending' && invitation.deadline <= now)) continue
        const state = await this.ctx.teams.getTeam({ teamId: selected.teamId })
        const input = { ...selected, expectedTeamCursor: state.team.cursor, expectedChannelCursor: admission.channel.cursor }
        const token: object = { toJSON(): never { throw new TypeError('Channel admission proof is runtime-only') } }
        const proof = Object.freeze(token) as TeamSystemChannelAdmissionProof
        this.proofs.set(proof, { kind: 'channel-invitations-expire', ...input, now })
        try { await this.ctx.teams.expireChannelInvitations({ actor: proof, ...input }) }
        catch (error: unknown) {
          if (!(error instanceof TeamError) || !['TEAM_CHANNEL_CURSOR_CONFLICT', 'TEAM_CURSOR_CONFLICT'].includes(error.code)) throw error
        } finally { this.proofs.delete(proof) }
      } catch (error: unknown) {
        this.queued.unshift(selected)
        throw error
      }
    }
  }

  /**
   * Wait for durable required endpoint consent before dispatching channel work.
   * @param request - exact channel and caller cancellation lifetime.
   * @returns an active channel snapshot; terminal admission rejects without dispatch.
   */
  waitUntilActive(request: ChannelAdmissionWaitRequest): Promise<ChannelSnapshot> {
    const operation = this.wait(request)
    this.waits.add(operation)
    void operation.then(() => this.waits.delete(operation), () => this.waits.delete(operation))
    return operation
  }

  /** Observe after each current cursor so an acknowledgement cannot fall between scan and watch. */
  private async wait(request: ChannelAdmissionWaitRequest): Promise<ChannelSnapshot> {
    const signal = AbortSignal.any([request.signal, this.closing.signal])
    for (;;) {
      signal.throwIfAborted()
      const current = await this.ctx.teams.getChannel({ channelId: request.channelId })
      if (current.phase === 'active') return current
      if (current.phase !== 'pending') throw new TeamError(`Channel admission ended with '${current.phase}'`, 'TEAM_INVALID_ARGUMENT')
      const changed = await this.ctx.teams.watchChannel({ channelId: request.channelId, afterCursor: current.cursor, signal })
      if (changed.kind === 'closed') throw new TeamError('Channel admission provider closed before dispatch', 'TEAM_INVALID_ARGUMENT')
      if (changed.cursor <= current.cursor) {
        throw new TeamError('Channel admission watch cursor did not advance', 'TEAM_CHANNEL_CURSOR_CONFLICT')
      }
    }
  }
}
