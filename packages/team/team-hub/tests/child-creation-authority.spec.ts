import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import type {
  TeamChildCreateInput,
  TeamPolicy,
  TeamSystemChildCreationProof,
  TeamSystemChildCreationScope,
} from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { delegationFixture } from './delegation-fixtures.ts'
import { createTestCoordinatorTask } from './fixtures.ts'

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
    await ctx.plugin(TeamHub, { maxTeamDepth: 1 })
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
  const root = await mkdtemp(join(parent, 'team-hub-child-creation-authority-'))
  roots.push(root)
  return root
}

/** Create one non-serializable child-delegation token retained only by a registered source. */
function childCreationProof(): TeamSystemChildCreationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test child-creation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemChildCreationProof
}

/** Register test-local child-creation scopes with independently revocable opaque proofs. */
function childCreationAuthority(ctx: Context, name = 'team-child-delegation'): {
  issue(scope: TeamSystemChildCreationScope): { readonly proof: TeamSystemChildCreationProof; revoke(): void }
} {
  const proofs = new Map<TeamSystemChildCreationProof, TeamSystemChildCreationScope>()
  ctx.teams.registerSystemChildCreationProofSource({
    name,
    resolveChildCreationProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = childCreationProof()
      proofs.set(proof, structuredClone(scope))
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
  })
}

/** Create one active parent Team and its task anchor for delegated child creation. */
async function parentAnchor(ctx: Context): Promise<{ readonly input: TeamChildCreateInput; readonly cursor: number }> {
  const fixture = await delegationFixture(ctx, process.cwd())
  const { state } = await fixture.current()
  return { input: fixture.creation, cursor: state.team.cursor }
}

/** Bind one complete child input and observed parent cursor into a source scope. */
function childScope(input: TeamChildCreateInput, expectedParentCursor: number): TeamSystemChildCreationScope {
  return { kind: 'team-child-create', ...input, expectedParentCursor }
}

describe('nested Team child-creation authority', () => {
  it('rechecks source revocation after register policy before the reserved child stream is written', async () => {
    const harness = await setup()
    try {
      const { input, cursor } = await parentAnchor(harness.ctx)
      const authority = childCreationAuthority(harness.ctx)
      const issued = authority.issue(childScope(input, cursor))
      harness.ctx.teams.registerPolicy('register', { name: 'revoke-reserved-child', async apply(_request, next) {
        issued.revoke()
        return await next()
      } })
      await expect(harness.ctx.teams.createTeam({ actor: issued.proof, ...input }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect((await harness.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items).toHaveLength(1)
    } finally { await harness.dispose() }
  })

  it('fails closed before register policy for raw, foreign, and mismatched child delegation proofs', async () => {
    const harness = await setup()
    try {
      const { input, cursor } = await parentAnchor(harness.ctx)
      const authority = childCreationAuthority(harness.ctx)
      const policy = vi.fn<TeamPolicy['apply']>(async (_request, next) => await next())
      harness.ctx.teams.registerPolicy('register', { name: 'observe-child-delegation', apply: policy })

      await expect(harness.ctx.teams.createTeam(input as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(policy).not.toHaveBeenCalled()

      const foreignAuthority = childCreationAuthority(harness.ctx, 'foreign-child-delegation')
      const foreign = foreignAuthority.issue(childScope(input, cursor))
      try {
        await expect(harness.ctx.teams.createTeam({ actor: foreign.proof, ...input }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        foreign.revoke()
      }
      expect(policy).not.toHaveBeenCalled()

      const mismatched = authority.issue(childScope(input, cursor))
      try {
        await expect(harness.ctx.teams.createTeam({
          actor: mismatched.proof,
          ...input,
          goal: { objective: 'Substitute the child objective.', budgets: {} },
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        mismatched.revoke()
      }
      expect(policy).not.toHaveBeenCalled()
    } finally {
      await harness.dispose()
    }
  })

  it('fences the parent cursor and re-resolves a source proof after register policy before child journal append', async () => {
    const harness = await setup()
    try {
      const { input, cursor } = await parentAnchor(harness.ctx)
      const authority = childCreationAuthority(harness.ctx)
      const stale = authority.issue(childScope(input, cursor))
      const advancing = await harness.ctx.teams.getTeam({ teamId: input.parentTeamId })
      await createTestCoordinatorTask(harness.ctx, {
        teamId: input.parentTeamId,
        expectedCursor: advancing.team.cursor,
        subject: 'Advance the parent cursor',
        description: 'Invalidate a stale child delegation proof.',
        blockedBy: [],
        requiredCapabilities: [],
        priority: 0,
        readScopes: [],
        writeScopes: [],
        workspaceMode: 'shared',
        budget: {},
        reviewPolicy: { kind: 'none' },
        maxAttempts: 1,
      })
      try {
        await expect(harness.ctx.teams.createTeam({ actor: stale.proof, ...input }))
          .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
      } finally {
        stale.revoke()
      }

      const current = (await harness.ctx.teams.getTeam({ teamId: input.parentTeamId })).team.cursor
      const issued = authority.issue(childScope(input, current))
      const policy = vi.fn<TeamPolicy['apply']>(async (_request, next) => await next())
      harness.ctx.teams.registerPolicy('register', { name: 'observe-authorized-child-delegation', apply: policy })
      let child: Awaited<ReturnType<Context['teams']['createTeam']>>
      try {
        expect(() => JSON.stringify(issued.proof)).toThrow(/runtime-only/u)
        expect(() => structuredClone(issued.proof)).toThrow()
        child = await harness.ctx.teams.createTeam({ actor: issued.proof, ...input })
      } finally {
        issued.revoke()
      }
      expect(child!.team).toMatchObject({
        parentTeamId: input.parentTeamId, parentTaskId: input.parentTaskId, depth: 1,
      })
      expect(child!.team).not.toHaveProperty('createdBy')
      expect(policy).toHaveBeenCalledOnce()
      expect(policy.mock.calls[0]?.[0]).toMatchObject({
        hook: 'register',
        facts: {
          creationSource: 'team-child-delegation', parentTeamId: input.parentTeamId, parentTaskId: input.parentTaskId,
        },
      })

      const secondInput: TeamChildCreateInput = {
        ...input,
        goal: { objective: 'Revoke child creation proof in policy.', budgets: {} },
      }
      const secondCursor = (await harness.ctx.teams.getTeam({ teamId: input.parentTeamId })).team.cursor
      const revocable = authority.issue(childScope(secondInput, secondCursor))
      harness.ctx.teams.registerPolicy('register', {
        name: 'revoke-child-creation-proof',
        apply: async (request, next) => {
          if (request.facts.creationSource === 'team-child-delegation') revocable.revoke()
          return await next()
        },
      })
      await expect(harness.ctx.teams.createTeam({ actor: revocable.proof, ...secondInput }))
        .rejects.toMatchObject({ code: 'TEAM_DELEGATION_INVALID' })
    } finally {
      await harness.dispose()
    }
  })
})
