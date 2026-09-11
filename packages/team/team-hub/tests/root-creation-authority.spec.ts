import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import type {
  TeamRootCreateInput,
  TeamPolicy,
  TeamSystemRootCreationProof,
  TeamSystemRootCreationScope,
} from '@clocky/clocky-team'
import { teamDelegationIdSchema } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import type { Config as TeamHubConfig } from '../src/index.ts'
import { createTestChildTeam } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { createTestCoordinatorTask, provisionTestCoordinator } from './fixtures.ts'

const roots: string[] = []

interface Harness {
  readonly ctx: Context
  readonly root: string
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Compose the local Hub over an isolated JSON Team journal backend. */
async function setup(root?: string, config: TeamHubConfig = {}): Promise<Harness> {
  const durableRoot = root ?? await freshRoot()
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: durableRoot })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub, Object.assign({ maxTeamDepth: 1 }, config))
    return { ctx, root: durableRoot }
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
}

/** Allocate one repository-local root for an isolated durable Team journal. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-root-creation-authority-'))
  roots.push(root)
  return root
}

/** Create a non-serializable root-creation token retained only by a registered source. */
function rootCreationProof(): TeamSystemRootCreationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test root-creation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemRootCreationProof
}

/** Register test-local root-creation scopes with independently revocable opaque proofs. */
function rootCreationAuthority(ctx: Context, name = 'team-run'): {
  issue(scope: TeamSystemRootCreationScope): { readonly proof: TeamSystemRootCreationProof; revoke(): void }
} {
  const proofs = new Map<TeamSystemRootCreationProof, TeamSystemRootCreationScope>()
  ctx.teams.registerSystemRootCreationProofSource({
    name,
    resolveRootCreationProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = rootCreationProof()
      proofs.set(proof, structuredClone(scope))
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
  })
}

/** Construct one exact root payload and its matching source scope. */
function rootInput(objective = 'Create a durable root Team.'): TeamRootCreateInput {
  return {
    goal: { objective, budgets: {} },
    rules: { productTemplate: { id: 'default-v1', version: 1 } },
    budgets: {},
  }
}

/** Bind one opaque proof to every JSON field accepted by the root creation command. */
function rootScope(input: TeamRootCreateInput): TeamSystemRootCreationScope {
  return { kind: 'team-run-root-create', ...input }
}

describe('root Team creation authority', () => {
  it('fails closed for raw roots, binds the full source payload before policy, and records its system origin', async () => {
    const { ctx } = await setup()
    try {
      const authority = rootCreationAuthority(ctx)
      const policy = vi.fn<TeamPolicy['apply']>(async (_request, next) => await next())
      ctx.teams.registerPolicy('register', { name: 'observe-root-creation', apply: policy })
      const input = rootInput()

      await expect(ctx.teams.createTeam(input as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(policy).not.toHaveBeenCalled()
      await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [] })

      const foreignAuthority = rootCreationAuthority(ctx, 'test-root-creation')
      const foreign = foreignAuthority.issue(rootScope(input))
      try {
        await expect(ctx.teams.createTeam({ actor: foreign.proof, ...input }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        foreign.revoke()
      }
      expect(policy).not.toHaveBeenCalled()
      await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [] })

      const mismatches: readonly TeamRootCreateInput[] = [
        rootInput('Attempt to substitute the root objective.'),
        { ...input, rules: { productTemplate: { id: 'substituted-template', version: 1 } } },
        { ...input, budgets: { maxTeams: 2 } },
        {
          ...input,
          authorityGrant: {
            operations: [], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {},
          },
        },
      ]
      for (const mismatch of mismatches) {
        const issuedMismatch = authority.issue(rootScope(input))
        try {
          await expect(ctx.teams.createTeam({ actor: issuedMismatch.proof, ...mismatch }))
            .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        } finally {
          issuedMismatch.revoke()
        }
      }
      expect(policy).not.toHaveBeenCalled()
      await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [] })

      const issued = authority.issue(rootScope(input))
      let root: Awaited<ReturnType<Context['teams']['createTeam']>>
      try {
        expect(() => JSON.stringify(issued.proof)).toThrow(/runtime-only/u)
        root = await ctx.teams.createTeam({ actor: issued.proof, ...input })
      } finally {
        issued.revoke()
      }
      expect(root!.team).toMatchObject({ createdBy: { kind: 'system', name: 'team-run' } })
      expect(policy).toHaveBeenCalledTimes(1)
      expect(policy.mock.calls[0]?.[0]).toMatchObject({
        hook: 'register',
        facts: {
          creationSource: 'team-run',
          goal: input.goal,
          rules: input.rules,
          budgets: input.budgets,
        },
      })

      await provisionTestCoordinator(ctx, root!.team.id)
      const state = await ctx.teams.getTeam({ teamId: root!.team.id })
      const anchor = await createTestCoordinatorTask(ctx, {
        teamId: state.team.id,
        expectedCursor: state.team.cursor,
        subject: 'Anchor child Team creation.',
        description: 'Nested creation remains outside the root proof slice.',
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
      const childInput = {
        parentTeamId: root!.team.id,
        parentTaskId: anchor.id,
        delegationId: teamDelegationIdSchema.parse('unreserved-child-delegation'),
        ...rootInput('Create a child Team through the existing provider path.'),
      }
      await expect(ctx.teams.createTeam(childInput as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await expect(createTestChildTeam(ctx, childInput)).rejects.toMatchObject({ code: 'TEAM_DELEGATION_INVALID' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('re-resolves a root proof after stream open and closes the unappended handle when it was revoked', async () => {
    const { ctx } = await setup()
    try {
      const authority = rootCreationAuthority(ctx)
      const input = rootInput('Recheck root authority after opening the stream.')
      const issued = authority.issue(rootScope(input))
      const open = ctx.storageLog.open.bind(ctx.storageLog)
      const opened = Promise.withResolvers<undefined>()
      const continueOpen = Promise.withResolvers<undefined>()
      vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        opened.resolve(undefined)
        await continueOpen.promise
        return stream
      })

      const creating = ctx.teams.createTeam({ actor: issued.proof, ...input })
      await opened.promise
      issued.revoke()
      continueOpen.resolve(undefined)
      await expect(creating).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await expect(ctx.storageLog.list()).resolves.toEqual([])
      await expect(ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [] })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('recovers proof-owned root creation provenance from a current Team checkpoint', async () => {
    const first = await setup(undefined, { checkpointEvery: 1 })
    try {
      const authority = rootCreationAuthority(first.ctx)
      const input = rootInput('Recover root creation provenance.')
      const issued = authority.issue(rootScope(input))
      let created: Awaited<ReturnType<Context['teams']['createTeam']>>
      try {
        created = await first.ctx.teams.createTeam({ actor: issued.proof, ...input })
      } finally {
        issued.revoke()
      }
      await first.ctx.fiber.dispose()

      const second = await setup(first.root)
      try {
        await expect(second.ctx.teams.getTeam({ teamId: created!.team.id })).resolves.toMatchObject({
          team: { createdBy: { kind: 'system', name: 'team-run' } },
        })
      } finally {
        await second.ctx.fiber.dispose()
      }
    } finally {
      await first.ctx.fiber.dispose()
    }
  })
})
