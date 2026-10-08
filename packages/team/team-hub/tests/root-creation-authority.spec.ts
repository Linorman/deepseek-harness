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
  TeamSystemPhaseProof,
  TeamSystemPhaseScope,
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

it('reuses only an exact Simulation genesis and rejects foreign source, run and changed payload', async () => {
  const { ctx } = await setup()
  try {
    const { teamIdSchema, teamSystemRootCreationScopeSchema } = await import('@clocky/clocky-team')
    const input = { ...rootInput('Reserved Simulation root'),
      rules: { simulationRunId: 'company', activationLifecycleOwner: 'simulation/company' } }
    const scope = teamSystemRootCreationScopeSchema.parse({ kind: 'simulation-root-create', ...input,
      runId: 'company', lifecycleOwner: 'simulation/company', teamId: teamIdSchema.parse('reserved-company') })
    if (scope.kind !== 'simulation-root-create') throw new Error('fixture scope missing')
    const source = rootCreationAuthority(ctx, 'simulation-team')
    const wrong = rootCreationAuthority(ctx, 'another-owner').issue(scope)
    await expect(ctx.teams.createTeam({ ...input, actor: wrong.proof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const wrongRun = source.issue(teamSystemRootCreationScopeSchema.parse({ ...scope, runId: 'another-run' }))
    await expect(ctx.teams.createTeam({ ...input, actor: wrongRun.proof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const good = source.issue(scope)
    const [first, second] = await Promise.all([
      ctx.teams.createTeam({ ...input, actor: good.proof }), ctx.teams.createTeam({ ...input, actor: good.proof }),
    ])
    expect(first.team.id).toBe(scope.teamId)
    expect(second).toEqual(first)
    const schedulerProof = Object.freeze({}) as TeamSystemPhaseProof
    const schedulerScope: TeamSystemPhaseScope = { kind: 'scheduler-stall', teamId: first.team.id,
      phase: 'stalled', reason: { code: 'TASK_NO_ELIGIBLE_OWNER', message: 'A generic scheduler cannot stall Simulation.' } }
    const unregisterScheduler = ctx.teams.registerSystemPhaseProofSource({ name: 'team-scheduler-dag',
      resolvePhaseProof: proof => proof === schedulerProof ? schedulerScope : undefined })
    try {
      const beforeStall = await ctx.teams.getTeam({ teamId: first.team.id })
      await expect(ctx.teams.transitionTeamPhase({ actor: schedulerProof, teamId: first.team.id,
        expectedCursor: beforeStall.team.cursor, phase: 'stalled', reason: schedulerScope.reason }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(await ctx.teams.getTeam({ teamId: first.team.id })).toEqual(beforeStall)
    } finally { unregisterScheduler() }
    const journal = ctx.storageLog.get(`team/${scope.teamId}`)
    if (journal === undefined) throw new Error('Reserved Simulation Team journal is missing')
    const missingGenesis = vi.spyOn(journal, 'read').mockResolvedValueOnce([])
    try {
      await expect(ctx.teams.createTeam({ ...input, actor: good.proof }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally { missingGenesis.mockRestore() }
    const changed = { ...input, goal: { objective: 'Changed after creation', budgets: {} } }
    const changedProof = source.issue({ ...scope, ...changed })
    await expect(ctx.teams.createTeam({ ...changed, actor: changedProof.proof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const otherRules = { ...input, rules: { ...input.rules, activationLifecycleOwner: 'another-owner' } }
    const otherOwner = source.issue({ ...scope, ...otherRules, lifecycleOwner: 'another-owner' })
    await expect(ctx.teams.createTeam({ ...otherRules, actor: otherOwner.proof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const interrupted = source.issue({ ...scope, teamId: teamIdSchema.parse('storage-fault-reservation') })
    const open = ctx.storageLog.open.bind(ctx.storageLog)
    const failure = new Error('reserved Team storage unavailable')
    const storageFault = vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
      if (descriptor.name === 'team/storage-fault-reservation') throw failure
      return await open(descriptor)
    })
    try { await expect(ctx.teams.createTeam({ ...input, actor: interrupted.proof })).rejects.toBe(failure) }
    finally { storageFault.mockRestore() }
    const revoked = source.issue({ ...scope, teamId: teamIdSchema.parse('revoked-reservation') })
    ctx.teams.registerPolicy('register', { name: 'revoke-simulation-bootstrap', async apply(_request, next) {
      revoked.revoke()
      return await next()
    } })
    await expect(ctx.teams.createTeam({ ...input, actor: revoked.proof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 10 })).items).toHaveLength(1)
  } finally { await ctx.fiber.dispose() }
})
