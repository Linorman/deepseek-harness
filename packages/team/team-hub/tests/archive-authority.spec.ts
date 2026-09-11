import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import type {
  ParticipantSnapshot,
  TeamArchiveInput,
  TeamHumanActorProof,
  TeamHumanActorProofInput,
  TeamHumanActorScope,
  TeamPolicy,
  TeamSystemArchiveProof,
  TeamSystemArchiveScope,
  TeamStateSnapshot,
} from '@clocky/clocky-team'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { seedTeamPhase } from './fixtures.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Compose the local Hub over one isolated JSON Team journal backend. */
async function setup(): Promise<{ readonly ctx: Context; dispose(): Promise<void> }> {
  const root = await freshRoot()
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
  return { ctx, async dispose() { await ctx.fiber.dispose() } }
}

/** Allocate one repository-local root for an isolated durable Team journal. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-hub-archive-authority-'))
  roots.push(root)
  return root
}

/** Create one non-serializable terminal archive token retained only by a registered source. */
function archiveProof(): TeamSystemArchiveProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test archive proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemArchiveProof
}

/** Register test-local terminal archive scopes with independently revocable opaque proofs. */
function archiveAuthority(ctx: Context, name = 'team-run'): {
  issue(scope: TeamSystemArchiveScope): { readonly proof: TeamSystemArchiveProof; revoke(): void }
} {
  const proofs = new Map<TeamSystemArchiveProof, TeamSystemArchiveScope>()
  ctx.teams.registerSystemArchiveProofSource({
    name,
    resolveArchiveProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = archiveProof()
      proofs.set(proof, structuredClone(scope))
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
  })
}

/** Construct one exact archive source scope from JSON-only terminal input. */
function archiveScope(input: TeamArchiveInput): TeamSystemArchiveScope {
  return { kind: 'team-run-terminal-archive', ...input }
}

/** Create and directly fixture-settle one terminal Team for archive admission tests. */
async function terminalTeam(ctx: Context, objective = 'Archive a terminal Team.'): Promise<TeamStateSnapshot> {
  const created = await createTestRootTeam(ctx, { goal: { objective, budgets: {} }, rules: {}, budgets: {} })
  const quiescing = await seedTeamPhase(ctx, created.team.id, 'quiescing')
  return await seedTeamPhase(ctx, quiescing.team.id, 'completed')
}

/** Create one terminal Team with an active close-authorized human participant. */
async function terminalHumanTeam(ctx: Context, objective = 'Archive a human-owned terminal Team.'): Promise<{
  readonly state: TeamStateSnapshot
  readonly human: ParticipantSnapshot
}> {
  const created = await createTestRootTeam(ctx, { goal: { objective, budgets: {} }, rules: {}, budgets: {} })
  let state = await ctx.teams.getTeam({ teamId: created.team.id })
  const human = await inviteBootstrapParticipant(ctx, {
    teamId: created.team.id,
    expectedCursor: state.team.cursor,
    kind: 'human',
    displayName: 'Terminal owner',
    role: 'owner',
    capabilities: [],
    owner: { kind: 'product-principal', principalId: 'principal-terminal-owner' as never },
    authorityGrant: { operations: ['close'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} },
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
  })
  const quiescing = await seedTeamPhase(ctx, created.team.id, 'quiescing')
  return { state: await seedTeamPhase(ctx, quiescing.team.id, 'completed'), human }
}

describe('terminal Team archive authority', () => {
  it('fails closed before policy for raw, foreign, and mismatched terminal archive proof requests', async () => {
    const harness = await setup()
    try {
      const state = await terminalTeam(harness.ctx)
      const input = { teamId: state.team.id, expectedCursor: state.team.cursor }
      const authority = archiveAuthority(harness.ctx)
      const policy = vi.fn<TeamPolicy['apply']>(async (_request, next) => await next())
      harness.ctx.teams.registerPolicy('close', { name: 'observe-terminal-archive', apply: policy })

      await expect(harness.ctx.teams.archiveTeam(input as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(policy).not.toHaveBeenCalled()

      const foreignAuthority = archiveAuthority(harness.ctx, 'test-archive-source')
      const foreign = foreignAuthority.issue(archiveScope(input))
      try {
        await expect(harness.ctx.teams.archiveTeam({ actor: foreign.proof, ...input }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        foreign.revoke()
      }
      expect(policy).not.toHaveBeenCalled()

      const wrongCursor = authority.issue(archiveScope(input))
      try {
        await expect(harness.ctx.teams.archiveTeam({
          actor: wrongCursor.proof,
          ...input,
          expectedCursor: input.expectedCursor + 1,
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        wrongCursor.revoke()
      }
      expect(policy).not.toHaveBeenCalled()

      const other = await terminalTeam(harness.ctx, 'Archive a different terminal Team.')
      const wrongTeam = authority.issue(archiveScope(input))
      try {
        await expect(harness.ctx.teams.archiveTeam({
          actor: wrongTeam.proof,
          teamId: other.team.id,
          expectedCursor: other.team.cursor,
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        wrongTeam.revoke()
      }
      expect(policy).not.toHaveBeenCalled()
      await expect(harness.ctx.teams.getTeam({ teamId: input.teamId })).resolves.not.toHaveProperty('team.archivedAt')
    } finally {
      await harness.dispose()
    }
  })

  it('admits only a terminal TeamRun scope, revalidates after policy, and requires proof for an idempotent archive read', async () => {
    const harness = await setup()
    try {
      const active = await createTestRootTeam(harness.ctx, { goal: { objective: 'Do not archive active work.', budgets: {} }, rules: {}, budgets: {} })
      const terminal = await terminalTeam(harness.ctx)
      const authority = archiveAuthority(harness.ctx)
      const activeInput = { teamId: active.team.id, expectedCursor: active.team.cursor }
      const activeProof = authority.issue(archiveScope(activeInput))
      try {
        await expect(harness.ctx.teams.archiveTeam({ actor: activeProof.proof, ...activeInput }))
          .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      } finally {
        activeProof.revoke()
      }

      const input = { teamId: terminal.team.id, expectedCursor: terminal.team.cursor }
      const issued = authority.issue(archiveScope(input))
      const policy = vi.fn<TeamPolicy['apply']>(async (_request, next) => await next())
      harness.ctx.teams.registerPolicy('close', { name: 'observe-authorized-terminal-archive', apply: policy })
      let archived: TeamStateSnapshot
      try {
        expect(() => JSON.stringify(issued.proof)).toThrow(/runtime-only/u)
        expect(() => structuredClone(issued.proof)).toThrow()
        archived = await harness.ctx.teams.archiveTeam({ actor: issued.proof, ...input })
      } finally {
        issued.revoke()
      }
      expect(archived!.team).toMatchObject({ phase: 'completed', archivedAt: archived!.team.updatedAt })
      expect(policy).toHaveBeenCalledWith(expect.objectContaining({
        hook: 'close',
        facts: {
          operation: 'terminal-archive',
          phase: 'archived',
          expectedCursor: input.expectedCursor,
          sourceName: 'team-run',
        },
      }), expect.any(Function))
      await expect(harness.ctx.teams.archiveTeam({ actor: issued.proof, ...input }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

      const race = await terminalTeam(harness.ctx, 'Revoke terminal archive proof in policy.')
      const raceInput = { teamId: race.team.id, expectedCursor: race.team.cursor }
      const revocable = authority.issue(archiveScope(raceInput))
      harness.ctx.teams.registerPolicy('close', {
        name: 'revoke-terminal-archive-proof',
        apply: async (request, next) => {
          if (request.facts.operation === 'terminal-archive' && request.teamId === raceInput.teamId) revocable.revoke()
          return await next()
        },
      })
      await expect(harness.ctx.teams.archiveTeam({ actor: revocable.proof, ...raceInput }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await expect(harness.ctx.teams.getTeam({ teamId: raceInput.teamId })).resolves.not.toHaveProperty('team.archivedAt')
    } finally {
      await harness.dispose()
    }
  })

  it('binds authenticated-human terminal archive authority to the complete input and revalidates after policy', async () => {
    const harness = await setup()
    const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
    const unregister = harness.ctx.teams.registerHumanActorProofSource({
      name: 'team-human-terminal-archive',
      resolveHumanActorProof: proof => proofs.get(proof),
    })
    try {
      const terminal = await terminalHumanTeam(harness.ctx)
      const input = { teamId: terminal.state.team.id, expectedCursor: terminal.state.team.cursor }
      const proofInput: TeamHumanActorProofInput = {
        teamId: input.teamId,
        operation: 'close',
        fence: { kind: 'cursor', cursor: input.expectedCursor },
        payload: jsonObjectSchema.parse(structuredClone(input)),
      }
      const issue = (scope: TeamHumanActorProofInput = proofInput): TeamHumanActorProof => {
        const proof = Object.freeze({}) as TeamHumanActorProof
        proofs.set(proof, {
          teamId: scope.teamId,
          participantId: terminal.human.id,
          operation: scope.operation,
          payloadFingerprint: fingerprintTeamHumanActorPayload(scope),
          fence: scope.fence,
        })
        return proof
      }
      const policy = vi.fn<TeamPolicy['apply']>(async (_request, next) => await next())
      harness.ctx.teams.registerPolicy('close', { name: 'observe-human-terminal-archive', apply: policy })

      const forged = Object.freeze({}) as TeamHumanActorProof
      await expect(harness.ctx.teams.archiveTeam({ actor: forged, ...input }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(policy).not.toHaveBeenCalled()

      const crossOperation = issue({ ...proofInput, operation: 'task-mutate' })
      await expect(harness.ctx.teams.archiveTeam({ actor: crossOperation, ...input }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(policy).not.toHaveBeenCalled()

      const stale = issue()
      await expect(harness.ctx.teams.archiveTeam({ actor: stale, ...input, expectedCursor: input.expectedCursor + 1 }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(policy).not.toHaveBeenCalled()

      const revocable = issue()
      const unregisterRevoke = harness.ctx.teams.registerPolicy('close', {
        name: 'revoke-human-terminal-archive-proof',
        async apply(request, next) {
          if (request.facts.operation === 'terminal-archive' && request.teamId === input.teamId) proofs.delete(revocable)
          return await next()
        },
      })
      try {
        await expect(harness.ctx.teams.archiveTeam({ actor: revocable, ...input }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        unregisterRevoke()
      }
      await expect(harness.ctx.teams.getTeam({ teamId: input.teamId })).resolves.not.toHaveProperty('team.archivedAt')

      const accepted = issue()
      const archived = await harness.ctx.teams.archiveTeam({ actor: accepted, ...input })
      expect(typeof archived.team.archivedAt).toBe('number')
      const policyRequest = policy.mock.calls.at(-1)?.[0]
      if (policyRequest === undefined) throw new Error('terminal archive did not reach the policy')
      expect(policyRequest.hook).toBe('close')
      expect(policyRequest.actorId).toBe(terminal.human.id)
      expect(policyRequest.facts.sourceName).toBe('team-human-terminal-archive')
    } finally {
      unregister()
      await harness.dispose()
    }
  })
})
