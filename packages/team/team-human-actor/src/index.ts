/** Authenticated product-principal binder for runtime-only human Team proofs. @module @clocky/clocky-team-human-actor */

import { Context, Service } from '@clocky/cordis'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import {
  TeamError,
  fingerprintTeamHumanActorPayload,
  teamHumanActorProofInputSchema,
  teamHumanActorScopeSchema,
} from '@clocky/clocky-team'
import type {
  ParticipantSnapshot,
  TeamHumanActorProof,
  TeamHumanActorProofInput,
  TeamHumanActorProofResolution,
  TeamHumanActorProofSource,
  TeamHumanActorScope,
} from '@clocky/clocky-team'

/** Cordis plugin name. */
export const name = 'team-human-actor'
/** Team durability and an authenticated product-principal seam must exist before binding. */
export const inject = ['teams', 'productPrincipals']

const PROOF_SOURCE_NAME = 'team-human-actor'

declare module '@clocky/cordis' {
  interface Context {
    /** Product-authenticated binder for one-shot active-human Team mutation proofs. */
    teamHumanActors: TeamHumanActor
  }
}

/** Create one opaque proof that cannot be serialized or structured-cloned across a boundary. */
function createHumanActorProof(): TeamHumanActorProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team human actor proofs are runtime-only and cannot be serialized') },
  })
  return Object.freeze(proof) as TeamHumanActorProof
}

/** Return whether one active human participant owns the supplied product principal. */
function isOwnedActiveHuman(participant: ParticipantSnapshot, principalId: string): boolean {
  if (participant.kind !== 'human'
    || participant.phase !== 'active'
    || participant.owner?.kind !== 'product-principal') return false
  try {
    return productPrincipalId(participant.owner.principalId) === principalId
  } catch {
    return false
  }
}

/** Effect-scoped product-principal to active-human binder. */
export class TeamHumanActor extends Service {
  private readonly proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  private closed = false

  /** @param ctx - Context that owns the Team provider and registered product-principal seam. */
  constructor(ctx: Context) {
    super(ctx, 'teamHumanActors')
    teamHumanActorProofSources.set(this, Object.freeze({
      name: PROOF_SOURCE_NAME,
      resolveHumanActorProof: (proof: TeamHumanActorProof): TeamHumanActorScope | undefined => this.resolve(proof),
    } satisfies TeamHumanActorProofSource))
  }

  /**
   * Map one authenticated principal to exactly one active human participant and
   * hold its exact payload-bound proof only while the supplied operation runs.
   * @param call - runtime-only authenticated product call retained by its transport lease.
   * @param input - complete parsed JSON-only mutation input and observed fence.
   * @param operation - Hub call that may resolve the proof more than once before settling.
   * @returns the operation result after the proof is revoked.
   */
  async withProof<T>(
    call: AuthenticatedProductCall,
    input: TeamHumanActorProofInput,
    operation: (proof: TeamHumanActorProof) => Promise<T>,
  ): Promise<T> {
    const parsed = this.parseInput(input)
    this.assertLive(call.signal)
    const state = await this.ctx.teams.getTeam({ teamId: parsed.teamId })
    this.assertLive(call.signal)
    const principalId = productPrincipalId(call.principal.id)
    const matches = state.participants.filter(participant => isOwnedActiveHuman(participant, principalId))
    if (matches.length === 0) {
      throw new TeamError('Authenticated principal owns no active human Team participant', 'TEAM_HUMAN_ACTOR_NOT_FOUND')
    }
    if (matches.length > 1) {
      throw new TeamError('Authenticated principal maps to multiple active human Team participants', 'TEAM_HUMAN_ACTOR_AMBIGUOUS')
    }
    const participant = matches[0] as ParticipantSnapshot
    const grant = participant.authorityGrant
    if (parsed.operation !== 'channel-invitation-read' && parsed.operation !== 'channel-admission-read' && parsed.operation !== 'channel-list-read' && parsed.operation !== 'channel-content-read' && (grant === undefined || !grant.operations.includes(parsed.operation))) {
      throw new TeamError('Active human Team participant is not authorized for this operation', 'TEAM_HUMAN_ACTOR_FORBIDDEN')
    }
    const scope = teamHumanActorScopeSchema.parse({
      teamId: parsed.teamId,
      participantId: participant.id,
      operation: parsed.operation,
      payloadFingerprint: fingerprintTeamHumanActorPayload(parsed),
      fence: parsed.fence,
    })
    const proof = createHumanActorProof()
    this.proofs.set(proof, scope)
    const revoke = (): void => { this.proofs.delete(proof) }
    call.signal.addEventListener('abort', revoke, { once: true })
    try {
      this.assertLive(call.signal)
      return await operation(proof)
    } finally {
      call.signal.removeEventListener('abort', revoke)
      revoke()
    }
  }

  /** Invalidate every outstanding proof before the source leaves the Team runtime. */
  close(): void {
    this.closed = true
    this.proofs.clear()
  }

  /** Resolve only a currently live proof issued by this exact binder instance. */
  private resolve(proof: TeamHumanActorProof): TeamHumanActorScope | undefined {
    return this.proofs.get(proof)
  }

  /** Reject a malformed complete input before it can receive a runtime proof. */
  private parseInput(input: TeamHumanActorProofInput): TeamHumanActorProofInput {
    try {
      return teamHumanActorProofInputSchema.parse(input)
    } catch (cause: unknown) {
      throw new TeamError('Human actor proof input is invalid', 'TEAM_INVALID_ARGUMENT', { cause })
    }
  }

  /** Reject product calls that have been revoked before proof issuance or Hub admission. */
  private assertLive(signal: AbortSignal): void {
    if (this.closed || signal.aborted) {
      throw new TeamError('Human actor proof is invalid or its source is unavailable', 'TEAM_ACTOR_PROOF_INVALID')
    }
  }
}

/** Install one human binder and its Team runtime proof source in the containing Cordis fiber. */
export const apply = (ctx: Context): (() => void) => {
  const service = new TeamHumanActor(ctx)
  const source = teamHumanActorProofSources.get(service)
  /* v8 ignore next 2 -- the constructor initializes the exact source before `apply()` reads it. */
  if (source === undefined) throw new Error('Team human actor proof source was not initialized')
  const teams = ctx.get('teams')
  if (teams === undefined) throw new TeamError('Team human actor requires an active Team runtime', 'TEAM_INVALID_ARGUMENT')
  const unregister = teams.registerHumanActorProofSource(source)
  return () => {
    service.close()
    unregister()
  }
}

/** Keep each source object private to the exact binder instance that owns its proof map. */
const teamHumanActorProofSources = new WeakMap<TeamHumanActor, TeamHumanActorProofSource>()

export type { TeamHumanActorProofResolution }
