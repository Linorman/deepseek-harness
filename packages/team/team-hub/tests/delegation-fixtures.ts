import type { Context } from '@clocky/cordis'
import type { TeamChildCreateInput, TeamStateSnapshot, TeamSystemDelegationProof, TeamSystemDelegationScope, TeamTaskSnapshot } from '@clocky/clocky-team'
import { createTestRootTeam } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { createTestCoordinatorTask, provisionTestCoordinator } from './fixtures.ts'

/** Create a real parent reservation using the same public commands as the Consumer. */
export async function delegationFixture(ctx: Context, workspacePath: string) {
  let actualWorkspace = workspacePath
  const proofs = new Map<TeamSystemDelegationProof, TeamSystemDelegationScope>()
  ctx.teams.registerSystemDelegationProofSource({ name: 'team-delegation', resolveDelegationProof: proof => proofs.get(proof),
    resolveChildWorkspace: async () => actualWorkspace })
  const parent = await createTestRootTeam(ctx, { goal: { objective: 'Parent work', budgets: {} }, rules: { workspacePath }, budgets: {} })
  await provisionTestCoordinator(ctx, parent.team.id)
  let state = await ctx.teams.getTeam({ teamId: parent.team.id })
  const authorityGrant = { ...state.team.authorityGrant!, workspaceModes: ['shared'] as const, readScopes: [], writeScopes: [] }
  const task = await createTestCoordinatorTask(ctx, {
    teamId: parent.team.id, expectedCursor: state.team.cursor, subject: 'Delegate child work', description: 'Create one nested Team.',
    blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {},
    reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    execution: { kind: 'child-team', templateId: 'fixture', templateVersion: 1, authorityGrant, budget: {} },
  })
  state = await ctx.teams.getTeam({ teamId: parent.team.id })
  const child = { goal: { objective: 'Child work', budgets: {} }, rules: { workspacePath }, budgets: {}, authorityGrant }
  const input = { ...selection(state, task), child }
  const actor = issue({ kind: 'delegation-begin', ...input })
  const reserved = await ctx.teams.beginTaskDelegation({ ...input, actor })
  proofs.delete(actor)
  const creation = reserved.delegation!.creation as TeamChildCreateInput
  return { task: reserved, creation, parentId: state.team.id, issue,
    revoke(proof: TeamSystemDelegationProof) { proofs.delete(proof) },
    moveWorkspace(path: string) { actualWorkspace = path },
    async current() {
      const latest = await ctx.teams.getTeam({ teamId: state.team.id })
      const task = latest.tasks.find(candidate => candidate.id === reserved.id)!
      return { state: latest, task, input: selection(latest, task) }
    },
  }
  function issue(scope: TeamSystemDelegationScope): TeamSystemDelegationProof {
    const proof = Object.freeze({}) as TeamSystemDelegationProof
    proofs.set(proof, scope)
    return proof
  }
}

function selection(state: TeamStateSnapshot, task: TeamTaskSnapshot) {
  return { teamId: state.team.id, taskId: task.id, expectedCursor: state.team.cursor,
    expectedRevision: task.revision, delegationId: task.delegation!.id }
}
