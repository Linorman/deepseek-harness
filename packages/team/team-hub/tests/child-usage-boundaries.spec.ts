/** Child delegation budgets and usage charges preserve their durable parent allowance. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { SessionId } from '@clocky/clocky-session'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import { createTestChildTeam, createTestRootTeam, inviteBootstrapParticipant,
  transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { activationIdSchema, activationReservationIdSchema, teamClosureIdempotencyKeySchema,
  teamUsageSampleInputSchema } from '@clocky/clocky-team'
import type { JsonObject, TeamSystemActivationProof, TeamSystemActivationScope,
  TeamSystemClosureProof, TeamSystemDelegationProof, TeamSystemDelegationScope } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { delegationFixture } from './delegation-fixtures.ts'
import { createTestCoordinatorTask, provisionTestCoordinator } from './fixtures.ts'

const contexts = new Set<Context>()
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function hub(backend: 'json' | 'sqlite') {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'child-usage-boundaries-'))
  roots.push(root)
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { recoveryPageSize: 128, maxTeamDepth: 2 })
  return { ctx, root }
}

/** Reserve the coordinator's real startup slot before a bounded parent delegates. */
async function boundedDelegation(ctx: Context, root: string, parentBudget: JsonObject,
  childBudget: JsonObject, taskBudget: JsonObject, parentUsageTokens = 0) {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Delegate under a live Activation bound.', budgets: {} },
    rules: { workspacePath: root }, budgets: parentBudget })
  const teamId = created.team.id
  const invited = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: created.team.cursor,
    kind: 'local-agent', displayName: 'Bounded coordinator', role: 'coordinator', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    await transitionBootstrapParticipant(ctx, { teamId, participantId: invited.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
  }
  const scopes = new Map<TeamSystemActivationProof, TeamSystemActivationScope>()
  ctx.teams.registerSystemActivationProofSource({ name: 'team-activation-controller',
    resolveActivationProof: proof => scopes.get(proof) })
  const reservation = { teamId, participantId: invited.id,
    reservationId: activationReservationIdSchema.parse('bounded-coordinator-startup'),
    sessionId: SessionId('bounded-coordinator-session'), provider: 'in-process',
    expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor }
  const reserveProof = Object.freeze({}) as TeamSystemActivationProof
  scopes.set(reserveProof, { kind: 'activation-controller-reserve', ...reservation })
  await ctx.teams.reserveActivation({ ...reservation, actor: reserveProof })
  scopes.delete(reserveProof)
  const binding = { activation: { id: activationIdSchema.parse('bounded-coordinator-epoch'), teamId,
    participantId: invited.id, status: 'idle' as const }, sessionId: reservation.sessionId,
  provider: reservation.provider, reservationId: reservation.reservationId }
  const bind = { expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, binding }
  const bindProof = Object.freeze({}) as TeamSystemActivationProof
  scopes.set(bindProof, { kind: 'activation-controller-bind', ...bind })
  await ctx.teams.bindActivation({ ...bind, actor: bindProof })
  scopes.delete(bindProof)
  let state = await ctx.teams.getTeam({ teamId })
  const authorityGrant = { ...state.team.authorityGrant!, workspaceModes: ['shared'] as const,
    readScopes: [] as const, writeScopes: [] as const }
  const task = await createTestCoordinatorTask(ctx, { teamId, expectedCursor: state.team.cursor,
    subject: 'Bounded child', description: 'Do one bounded child task.', blockedBy: [], requiredCapabilities: [],
    priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: taskBudget,
    reviewPolicy: { kind: 'none' }, maxAttempts: 1,
    execution: { kind: 'child-team', templateId: 'fixture', templateVersion: 1, authorityGrant, budget: childBudget } })
  if (parentUsageTokens > 0) {
    state = await ctx.teams.getTeam({ teamId })
    const current = state.activations.find(value => value.activation.participantId === invited.id)
    if (current === undefined) throw new Error('Bounded coordinator has no current activation')
    const actor = ctx.teams.openActivationActorProofIssuer().issue(current)
    try { await ctx.teams.recordUsage({ actor: actor.proof, expectedCursor: state.team.cursor,
      sample: teamUsageSampleInputSchema.parse({ id: 'parent-before-delegation', provider: 'meter', model: 'accounted',
        turn: 1, step: 0, usage: { inputTokens: parentUsageTokens, outputTokens: 0 }, costUnits: 0 }) }) }
    finally { actor.revoke() }
  }
  state = await ctx.teams.getTeam({ teamId })
  const child = { goal: { objective: 'Bounded child work', budgets: {} }, rules: { workspacePath: root },
    budgets: childBudget, authorityGrant }
  const input = { teamId, taskId: task.id, expectedCursor: state.team.cursor,
    expectedRevision: task.revision, delegationId: task.delegation!.id, child }
  const delegationProof = Object.freeze({}) as TeamSystemDelegationProof
  const delegationScopes = new Map<TeamSystemDelegationProof, TeamSystemDelegationScope>([
    [delegationProof, { kind: 'delegation-begin', ...input }],
  ])
  ctx.teams.registerSystemDelegationProofSource({ name: 'team-delegation',
    resolveDelegationProof: proof => delegationScopes.get(proof), resolveChildWorkspace: async () => root })
  return await ctx.teams.beginTaskDelegation({ ...input, actor: delegationProof })
}

for (const backend of ['json', 'sqlite'] as const) {
  it(`refuses a child descendant allowance that has no representable identity slot on ${backend}`, async () => {
    const { ctx, root } = await hub(backend)
    const childBudget: JsonObject = { maxChildTeams: Number.MAX_SAFE_INTEGER }
    await expect(delegationFixture(ctx, root, {}, childBudget, childBudget))
      .rejects.toMatchObject({ code: 'TEAM_BUDGET_INVALID' })
  })

  it(`requires a frozen descendant allowance when the parent count is bounded on ${backend}`, async () => {
    const { ctx, root } = await hub(backend)
    await expect(delegationFixture(ctx, root, { maxChildTeams: 2 }, {}, { maxChildTeams: 2 }))
      .rejects.toMatchObject({ code: 'TEAM_BUDGET_INVALID' })
  })

  it(`counts the child identity as well as its descendants against the parent's lifetime allowance on ${backend}`, async () => {
    const { ctx, root } = await hub(backend)
    await expect(delegationFixture(ctx, root, { maxChildTeams: 1 }, { maxChildTeams: 1 }, { maxChildTeams: 1 }))
      .rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
  })

  it(`requires a child live-activation bound under a bounded parent on ${backend}`, async () => {
    const { ctx, root } = await hub(backend)
    await expect(boundedDelegation(ctx, root, { maxLiveActivations: 2 }, {}, { maxLiveActivations: 1 }))
      .rejects.toMatchObject({ code: 'TEAM_BUDGET_INVALID' })
  })

  it(`rejects occupied live-activation capacity without overspending a child's own ceiling on ${backend}`, async () => {
    const { ctx, root } = await hub(backend)
    await expect(boundedDelegation(ctx, root, { maxLiveActivations: 1 },
      { maxLiveActivations: 1 }, { maxLiveActivations: 1 }))
      .rejects.toMatchObject({ code: 'TEAM_DELEGATION_BUSY' })
  })

  it(`rejects a child token allowance after the parent has already spent part of its total on ${backend}`, async () => {
    const { ctx, root } = await hub(backend)
    await expect(boundedDelegation(ctx, root, { maxTotalTokens: 2 },
      { maxTotalTokens: 2 }, { maxTotalTokens: 2 }, 1))
      .rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
  })

  it(`does not charge the reserved delegation task twice against a legal child concurrency budget on ${backend}`, async () => {
    const { ctx, root } = await hub(backend)
    const parentBudget: JsonObject = { maxConcurrency: 2, maxChildTeams: 2 }
    const childBudget: JsonObject = { maxConcurrency: 1, maxChildTeams: 1 }
    const delegation = await delegationFixture(ctx, root, parentBudget, childBudget, childBudget)
    const child = await createTestChildTeam(ctx, delegation.creation)
    expect(child.team.parentTaskId).toBe(delegation.task.id)
    expect(child.budgets).toMatchObject(childBudget)
    expect((await ctx.teams.getTeam({ teamId: delegation.parentId })).tasks)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: delegation.task.id })]))
  })

  it(`retains child usage but refuses to bill a parent after its failure closure on ${backend}`, async () => {
    const { ctx, root } = await hub(backend)
    const delegation = await delegationFixture(ctx, root)
    const child = await createTestChildTeam(ctx, delegation.creation)
    const actor = await provisionTestCoordinator(ctx, child.team.id)
    const parent = await ctx.teams.getTeam({ teamId: delegation.parentId })
    const proof = Object.freeze({}) as TeamSystemClosureProof
    const unregister = ctx.teams.registerSystemClosureProofSource({ name: 'team-run',
      resolveClosureProof: candidate => candidate === proof ? {
        kind: 'team-run-create-failure', teamId: delegation.parentId,
      } : undefined })
    try {
      const failed = await ctx.teams.failTeam({ actor: proof, teamId: delegation.parentId,
        expectedCursor: parent.team.cursor, idempotencyKey: teamClosureIdempotencyKeySchema.parse('parent-usage-failure'),
        reason: { code: 'PARENT_FAILED', message: 'Parent cannot continue child work.' } })
      expect(failed.team.closure?.kind).toBe('fail')
      const input = teamUsageSampleInputSchema.parse({ id: 'child-after-parent-failure', provider: 'meter', model: 'reported-cost',
        turn: 1, step: 0, usage: { inputTokens: 2, outputTokens: 1 }, costUnits: 1 })
      await expect(ctx.teams.recordUsage({ actor, expectedCursor: (await ctx.teams.getTeam({ teamId: child.team.id })).team.cursor,
        sample: input })).rejects.toMatchObject({ code: 'TEAM_PARENT_USAGE_PENDING' })
      expect((await ctx.teams.getTeam({ teamId: child.team.id })).usage).toMatchObject({ inputTokens: 2, outputTokens: 1 })
      const childAudit = await ctx.teams.readAudit({ teamId: child.team.id, afterCursor: -1, limit: 128 })
      const parentAudit = await ctx.teams.readAudit({ teamId: delegation.parentId, afterCursor: -1, limit: 128 })
      expect(childAudit.items.filter(item => item.type === 'usage/parent-charge-pending')).toHaveLength(1)
      expect(parentAudit.items.filter(item => item.type === 'usage/child-charged')).toHaveLength(0)
    } finally { unregister() }
  })
}
