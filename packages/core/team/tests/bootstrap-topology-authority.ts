import { teamDelegationIdSchema } from '@clocky/clocky-team'
import type {
  ParticipantInviteInput,
  ParticipantPhaseTransitionInput,
  ParticipantSnapshot,
  TeamArchiveInput,
  TeamChildCreateInput,
  TeamRootCreateInput,
  TeamStateSnapshot,
  TeamSystemArchiveProof,
  TeamSystemArchiveProofSource,
  TeamSystemArchiveScope,
  TeamSystemChildCreationProof,
  TeamSystemChildCreationProofSource,
  TeamSystemChildCreationScope,
  TeamSystemRootCreationProof,
  TeamSystemRootCreationProofSource,
  TeamSystemRootCreationScope,
  TeamSystemTopologyProof,
  TeamSystemTopologyProofSource,
  TeamSystemTopologyScope,
  TeamParticipantOwner,
} from '@clocky/clocky-team'
import { teamRootCreateInputSchema } from '@clocky/clocky-team'
import type { Context } from '@clocky/cordis'

/** Test-local retention for exact TeamRun bootstrap-topology proof scopes. */
interface TestBootstrapTopologyAuthority {
  readonly proofs: Map<TeamSystemTopologyProof, TeamSystemTopologyScope>
}

const authorities = new WeakMap<Context, TestBootstrapTopologyAuthority>()

/**
 * Create one root Team through a short-lived exact system proof.
 * This fixture intentionally cannot create a child Team, whose delegation
 * authority remains a separate product concern.
 * @param ctx - isolated Hub fixture context without a mounted TeamRun source.
 * @param input - complete JSON-only root Team creation payload.
 * @returns the newly created durable Team state.
 */
export async function createTestRootTeam(
  ctx: Context,
  input: TeamRootCreateInput,
): Promise<TeamStateSnapshot> {
  const root = teamRootCreateInputSchema.parse(input)
  const scope: TeamSystemRootCreationScope = {
    kind: 'team-run-root-create',
    ...root,
  }
  return await withTestRootCreationProof(ctx, scope, async actor =>
    await ctx.teams.createTeam({ actor, ...root }))
}

/**
 * Create one nested fixture Team through a short-lived exact delegated proof.
 * Shipped compositions register no child-delegation source; this helper exists
 * only to preserve focused hierarchy and usage-propagation fixture coverage.
 * @param ctx - isolated Hub fixture context without a product child-delegation owner.
 * @param input - complete JSON-only child payload selected by the fixture.
 * @param expectedParentCursor - optional fixture-selected parent cursor for a deliberately malformed parent projection.
 * @returns the newly created durable child Team state.
 */
export async function createTestChildTeam(
  ctx: Context,
  input: Omit<TeamChildCreateInput, 'delegationId'> & { readonly delegationId?: TeamChildCreateInput['delegationId'] },
  expectedParentCursor?: number,
): Promise<TeamStateSnapshot> {
  const child: TeamChildCreateInput = {
    ...input, delegationId: input.delegationId ?? teamDelegationIdSchema.parse(`fixture-delegation:${input.parentTaskId}`),
  }
  const cursor = expectedParentCursor ?? (await ctx.teams.getTeam({ teamId: input.parentTeamId })).team.cursor
  const scope: TeamSystemChildCreationScope = {
    kind: 'team-child-create',
    ...structuredClone(child),
    expectedParentCursor: cursor,
  }
  return await withTestChildCreationProof(ctx, scope, async actor =>
    await ctx.teams.createTeam({ actor, ...child }))
}

/**
 * Archive one terminal fixture Team through a short-lived exact TeamRun-shaped
 * proof. The helper never reconstructs authority from a durable Team state.
 * @param ctx - isolated Hub fixture context without a mounted TeamRun source.
 * @param input - JSON-only terminal Team/cursor fields selected by the fixture.
 * @returns the durable Team state after its archive marker is appended.
 */
export async function archiveTestTerminalTeam(
  ctx: Context,
  input: TeamArchiveInput,
): Promise<TeamStateSnapshot> {
  const scope: TeamSystemArchiveScope = {
    kind: 'team-run-terminal-archive',
    ...input,
  }
  return await withTestArchiveProof(ctx, scope, async actor =>
    await ctx.teams.archiveTeam({ actor, ...input }))
}

/** Retain one exact root-creation scope only until its fixture Hub call settles. */
async function withTestRootCreationProof<T>(
  ctx: Context,
  scope: TeamSystemRootCreationScope,
  operation: (actor: TeamSystemRootCreationProof) => Promise<T>,
): Promise<T> {
  const proofs = new Map<TeamSystemRootCreationProof, TeamSystemRootCreationScope>()
  const source: TeamSystemRootCreationProofSource = {
    name: 'team-run',
    resolveRootCreationProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemRootCreationProofSource(source)
  const proof = createTestRootCreationProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    proofs.delete(proof)
    unregister()
  }
}

/** Create one fixture-only root-creation proof that cannot cross a durable or wire boundary. */
function createTestRootCreationProof(): TeamSystemRootCreationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Test root-creation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemRootCreationProof
}

/** Retain one exact child creation scope only until its fixture Hub call settles. */
async function withTestChildCreationProof<T>(
  ctx: Context,
  scope: TeamSystemChildCreationScope,
  operation: (actor: TeamSystemChildCreationProof) => Promise<T>,
): Promise<T> {
  const proofs = new Map<TeamSystemChildCreationProof, TeamSystemChildCreationScope>()
  const source: TeamSystemChildCreationProofSource = {
    name: 'team-child-delegation',
    resolveChildCreationProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemChildCreationProofSource(source)
  const proof = createTestChildCreationProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    proofs.delete(proof)
    unregister()
  }
}

/** Create one fixture-only proof that cannot cross a durable or wire boundary. */
function createTestChildCreationProof(): TeamSystemChildCreationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Test child-creation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemChildCreationProof
}

/** Retain one exact terminal archive scope only until its fixture Hub call settles. */
async function withTestArchiveProof<T>(
  ctx: Context,
  scope: TeamSystemArchiveScope,
  operation: (actor: TeamSystemArchiveProof) => Promise<T>,
): Promise<T> {
  const proofs = new Map<TeamSystemArchiveProof, TeamSystemArchiveScope>()
  const source: TeamSystemArchiveProofSource = {
    name: 'team-run',
    resolveArchiveProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemArchiveProofSource(source)
  const proof = createTestArchiveProof()
  proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    proofs.delete(proof)
    unregister()
  }
}

/** Create one fixture-only proof that cannot cross a durable or wire boundary. */
function createTestArchiveProof(): TeamSystemArchiveProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Test archive proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemArchiveProof
}

/**
 * Invite one fixture participant through a short-lived exact bootstrap proof.
 * @param ctx - isolated bare-Hub fixture context.
 * @param input - JSON-only invitation fields selected by the fixture.
 * @returns the invited durable participant projection.
 */
export async function inviteBootstrapParticipant(
  ctx: Context,
  input: Omit<ParticipantInviteInput, 'owner'> & { readonly owner?: TeamParticipantOwner | string | undefined },
): Promise<ParticipantSnapshot> {
  const { owner: suppliedOwner, ...withoutOwner } = input
  const owner = typeof suppliedOwner === 'string'
    ? { kind: 'product-principal' as const, principalId: suppliedOwner as never }
    : suppliedOwner ?? (input.kind === 'human' ? { kind: 'system' as const } : undefined)
  const normalized: ParticipantInviteInput = {
    ...withoutOwner,
    ...owner === undefined ? {} : { owner },
  }
  const { teamId, expectedCursor, ...participant } = normalized
  const scope: TeamSystemTopologyScope = {
    kind: 'team-run-bootstrap-participant-invite',
    teamId,
    expectedCursor,
    participant,
  }
  return await withBootstrapTopologyProof(ctx, scope, async actor =>
    await ctx.teams.inviteParticipant({ actor, ...normalized }))
}

/**
 * Advance one invited or provisioning fixture participant through a short-lived exact bootstrap proof.
 * @param ctx - isolated bare-Hub fixture context.
 * @param input - JSON-only transition fields selected by the fixture.
 * @returns the transitioned durable participant projection.
 */
export async function transitionBootstrapParticipant(
  ctx: Context,
  input: ParticipantPhaseTransitionInput,
): Promise<ParticipantSnapshot> {
  const state = await ctx.teams.getTeam({ teamId: input.teamId })
  const participant = state.participants.find(candidate => candidate.id === input.participantId)
  if (participant === undefined || (participant.phase !== 'invited' && participant.phase !== 'provisioning')) {
    throw new Error(`Fixture participant '${input.participantId}' cannot use a bootstrap topology transition`)
  }
  if (input.phase !== 'provisioning' && input.phase !== 'active') {
    throw new Error(`Fixture participant '${input.participantId}' cannot transition to '${input.phase}' through bootstrap topology authority`)
  }
  const scope: TeamSystemTopologyScope = {
    kind: 'team-run-bootstrap-participant-phase',
    teamId: input.teamId,
    participantId: input.participantId,
    expectedCursor: input.expectedCursor,
    expectedPhase: participant.phase,
    phase: input.phase,
  }
  return await withBootstrapTopologyProof(ctx, scope, async actor =>
    await ctx.teams.transitionParticipantPhase({ actor, ...input }))
}

/** Retain one exact scope only until its fixture Hub call settles. */
async function withBootstrapTopologyProof<T>(
  ctx: Context,
  scope: TeamSystemTopologyScope,
  operation: (actor: TeamSystemTopologyProof) => Promise<T>,
): Promise<T> {
  const authority = bootstrapTopologyAuthority(ctx)
  const proof = createBootstrapTopologyProof()
  authority.proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    authority.proofs.delete(proof)
  }
}

/** Register the canonical TeamRun source only within one isolated bare-Hub fixture context. */
function bootstrapTopologyAuthority(ctx: Context): TestBootstrapTopologyAuthority {
  const existing = authorities.get(ctx)
  if (existing !== undefined) return existing
  const authority: TestBootstrapTopologyAuthority = { proofs: new Map() }
  const source: TeamSystemTopologyProofSource = {
    name: 'team-run',
    resolveTopologyProof: proof => authority.proofs.get(proof),
  }
  ctx.teams.registerSystemTopologyProofSource(source)
  authorities.set(ctx, authority)
  return authority
}

/** Create one fixture-only proof that cannot cross a durable or wire boundary. */
function createBootstrapTopologyProof(): TeamSystemTopologyProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Test bootstrap topology proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemTopologyProof
}
