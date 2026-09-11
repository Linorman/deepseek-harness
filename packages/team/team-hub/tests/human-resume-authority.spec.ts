import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema } from '@clocky/clocky-team'
import type {
  TeamHumanActorProof,
  TeamHumanActorProofInput,
  TeamHumanActorScope,
  TeamResumeInput,
} from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { seedTeamPhase } from './fixtures.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

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

async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-hub-human-resume-'))
  roots.push(root)
  return root
}

async function activeHumanTeam(ctx: Context) {
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Resume through an authenticated human proof.', budgets: {} }, rules: {}, budgets: {},
  })
  let state = await ctx.teams.getTeam({ teamId: created.team.id })
  const human = await inviteBootstrapParticipant(ctx, {
    teamId: created.team.id,
    expectedCursor: state.team.cursor,
    kind: 'human',
    displayName: 'Resume owner',
    role: 'owner',
    capabilities: [],
    owner: { kind: 'product-principal', principalId: 'principal-resume-owner' as never },
    authorityGrant: { operations: ['activate'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} },
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: created.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
  })
  return { human, state: await ctx.teams.getTeam({ teamId: created.team.id }) }
}

describe('authenticated human Team resume authority', () => {
  it('binds the exact cursor-fenced input, revalidates after policy, and rejects terminal recovery', async () => {
    const harness = await setup()
    const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
    const unregister = harness.ctx.teams.registerHumanActorProofSource({
      name: 'team-human-resume',
      resolveHumanActorProof: proof => proofs.get(proof),
    })
    try {
      const { human, state } = await activeHumanTeam(harness.ctx)
      const issue = (input: TeamResumeInput): TeamHumanActorProof => {
        const proof = Object.freeze({}) as TeamHumanActorProof
        const bound: TeamHumanActorProofInput = {
          teamId: input.teamId,
          operation: 'activate',
          fence: { kind: 'cursor', cursor: input.expectedCursor },
          payload: jsonObjectSchema.parse(structuredClone(input)),
        }
        proofs.set(proof, {
          teamId: input.teamId,
          participantId: human.id,
          operation: bound.operation,
          payloadFingerprint: fingerprintTeamHumanActorPayload(bound),
          fence: bound.fence,
        })
        return proof
      }
      const input = { teamId: state.team.id, expectedCursor: state.team.cursor }
      const proof = issue(input)
      const authorization = await harness.ctx.teams.authorizeHumanResume({ actor: proof, ...input })
      await expect(authorization.assert()).resolves.toMatchObject({ team: { id: input.teamId, phase: 'active' } })
      expect(authorization.isLive()).toBe(true)
      proofs.delete(proof)
      expect(authorization.isLive()).toBe(false)
      await expect(authorization.assert()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      authorization.close()

      const stale = issue(input)
      await expect(harness.ctx.teams.authorizeHumanResume({
        actor: stale,
        ...input,
        expectedCursor: input.expectedCursor + 1,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

      const revocable = issue(input)
      const unregisterPolicy = harness.ctx.teams.registerPolicy('activate', {
        name: 'revoke-human-resume-proof-after-policy',
        async apply(request, next) {
          if (request.facts.operation === 'team-resume') proofs.delete(revocable)
          return await next()
        },
      })
      try {
        await expect(harness.ctx.teams.authorizeHumanResume({ actor: revocable, ...input }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        unregisterPolicy()
      }

      const quiescing = await seedTeamPhase(harness.ctx, input.teamId, 'quiescing')
      await seedTeamPhase(harness.ctx, quiescing.team.id, 'completed')
      const terminalState = await harness.ctx.teams.getTeam({ teamId: input.teamId })
      const terminal = issue({ teamId: input.teamId, expectedCursor: terminalState.team.cursor })
      await expect(harness.ctx.teams.authorizeHumanResume({
        actor: terminal,
        teamId: input.teamId,
        expectedCursor: terminalState.team.cursor,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally {
      unregister()
      await harness.dispose()
    }
  })
})
