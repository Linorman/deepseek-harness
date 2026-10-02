import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import { taskConcurrencyUsage, taskChildTeamReservation, teamClosureIdempotencyKeySchema,
  teamTaskIdSchema,
  participantIdSchema,
  teamDelegationIdSchema,
  teamChildRunBindingSchema,
  type JsonObject, type TeamSystemChildCreationProof, type TeamSystemChildCreationScope,
  type TeamSystemClosureDriverProof, type TeamSystemClosureDriverScope, type TeamSystemTaskControlProof, type TeamSystemTaskControlScope } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import ProductPrincipalRegistry, { productPrincipalId } from '@clocky/clocky-product-principal'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import * as TeamHumanActor from '@clocky/clocky-team-human-actor'
import { jsonObjectSchema, teamIdSchema } from '@clocky/clocky-team'
import { delegationFixture } from './delegation-fixtures.ts'
import { createTestCoordinatorTask, provisionTestCoordinator } from './fixtures.ts'
import { inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { consultChannelAdapter } from '@clocky/clocky-team-channel-basic'
import { FULL_TRANSCRIPT_VIEW_POLICY } from '@clocky/clocky-team-channel-direct'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup(backend: 'json' | 'sqlite' = 'json', budgets: JsonObject = {}, childBudgets: JsonObject = {}) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'task-delegation-'))
  roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  const hub = await ctx.plugin(TeamHub, { maxTeamDepth: 2, maxEnvelopeBytes: 4096 })
  const fixture = await delegationFixture(ctx, root, budgets, childBudgets)
  const creation = new Map<TeamSystemChildCreationProof, TeamSystemChildCreationScope>()
  ctx.teams.registerSystemChildCreationProofSource({ name: 'team-child-delegation', resolveChildCreationProof: proof => creation.get(proof) })
  async function create(payload = fixture.creation) {
    const state = await ctx.teams.getTeam({ teamId: payload.parentTeamId })
    const actor = Object.freeze({}) as TeamSystemChildCreationProof
    creation.set(actor, { kind: 'team-child-create', ...payload, expectedParentCursor: state.team.cursor })
    try { return await ctx.teams.createTeam({ ...payload, actor }) } finally { creation.delete(actor) }
  }
  async function cancel() {
    const { task, input } = await fixture.current()
    const coordinator = task.createCommand.creator
    if (!('activationId' in coordinator)) throw new Error('Cancellation fixture requires an activation-backed coordinator creator')
    const proofs = new Map<TeamSystemTaskControlProof, TeamSystemTaskControlScope>()
    const dispose = ctx.teams.registerSystemTaskControlProofSource({ name: 'team-run', resolveTaskControlProof: proof => proofs.get(proof) })
    const actor = Object.freeze({}) as TeamSystemTaskControlProof
    proofs.set(actor, { kind: 'team-run-default-worker-cancel', teamId: input.teamId, taskId: input.taskId,
      expectedRevision: input.expectedRevision, coordinator })
    try {
      return await ctx.teams.cancelTask({ actor, teamId: input.teamId, taskId: input.taskId, expectedRevision: input.expectedRevision })
    } finally { dispose() }
  }
  return { ctx, fixture, create, cancel, hub }
}

/** Prepare actual child roster/channel facts before publishing their parent-authorized binding. */
async function endpoints(backend: 'json' | 'sqlite' = 'json') {
  const selected = await setup(backend)
  const { ctx, fixture } = selected
  const child = await selected.create()
  await provisionTestCoordinator(ctx, child.team.id)
  let state = await ctx.teams.getTeam({ teamId: child.team.id })
  const service = await inviteBootstrapParticipant(ctx, { teamId: child.team.id, expectedCursor: state.team.cursor,
    kind: 'service', displayName: 'Parent service', role: 'parent-service', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    state = await ctx.teams.getTeam({ teamId: child.team.id })
    await transitionBootstrapParticipant(ctx, {
      teamId: child.team.id, participantId: service.id, expectedCursor: state.team.cursor, phase,
    })
  }
  ctx.teams.registerAdapter(consultChannelAdapter)
  ctx.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
  state = await ctx.teams.getTeam({ teamId: child.team.id })
  const coordinator = state.participants.find(member => member.role === 'coordinator')!
  const channelInput = { teamId: child.team.id, expectedCursor: state.team.cursor, adapter: { type: 'consult', version: 1 },
    viewPolicy: { type: FULL_TRANSCRIPT_VIEW_POLICY.type, version: FULL_TRANSCRIPT_VIEW_POLICY.version },
    participants: [{ id: service.id, role: 'initiator' }, { id: coordinator.id, role: 'respondent' }], limits: {} }
  const channel = await openTestChannel(ctx, channelInput)
  const current = await fixture.current()
  const input = { ...current.input, childTeamId: child.team.id }
  await ctx.teams.bindTaskDelegation({ ...input, actor: fixture.issue({ kind: 'delegation-bind', ...input }) })
  const observed = await fixture.current()
  const scope = { kind: 'delegation-authorize-run' as const, ...observed.input, operation: 'start' as const }
  const actor = fixture.issue(scope)
  const authorization = await ctx.teams.authorizeChildRun({ ...observed.input, operation: 'start', actor })
  const binding = teamChildRunBindingSchema.parse({ parentTeamId: fixture.parentId, parentTaskId: fixture.task.id,
    childTeamId: child.team.id, delegationId: fixture.task.delegation!.id, parentServiceId: service.id,
    coordinatorId: coordinator.id, channelId: channel.manifest.id })
  const expectedCursor = (await ctx.teams.getTeam({ teamId: child.team.id })).team.cursor
  return { ...selected, child, channelInput, binding, scope, actor, authorization, expectedCursor }
}

describe('child endpoint publication authority', () => {
  it.each(['json', 'sqlite'] as const)('permits ancestor inspection through the reserved task without child mutation authority (%s)', async (backend) => {
    const { ctx, fixture, create } = await setup(backend)
    const child = await create()
    await provisionTestCoordinator(ctx, child.team.id)
    await ctx.plugin(ProductPrincipalRegistry)
    await ctx.plugin(TeamHumanActor)
    const principalId = productPrincipalId('parent-read-owner')
    const human = await inviteBootstrapParticipant(ctx, { teamId: fixture.parentId,
      expectedCursor: (await ctx.teams.getTeam({ teamId: fixture.parentId })).team.cursor,
      kind: 'human', role: 'owner', displayName: 'Parent reader', capabilities: [],
      owner: { kind: 'product-principal', principalId },
      authorityGrant: { operations: [], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} } })
    for (const phase of ['provisioning', 'active'] as const) await transitionBootstrapParticipant(ctx, {
      teamId: fixture.parentId, participantId: human.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: fixture.parentId })).team.cursor, phase,
    })
    const authority = await ctx.teams.resolveHumanReadAuthority({ teamId: child.team.id, principalId })
    expect(authority).toEqual({ teamId: fixture.parentId, participantId: human.id, operations: [] })
    const member = (await ctx.teams.getTeam({ teamId: child.team.id })).participants[0]!
    const controller = new AbortController()
    const call: AuthenticatedProductCall = { principal: { id: principalId, issuer: 'test', subject: 'owner',
      assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: controller.signal }
    const input = { teamId: child.team.id, participantIds: [member.id] }
    let issued: import('@clocky/clocky-team').TeamHumanActorProof | undefined
    await ctx.teamHumanActors.withProof(call, { teamId: child.team.id, operation: 'identity-resolve-read',
      fence: { kind: 'read' }, payload: jsonObjectSchema.parse(input) }, async (actor, membershipTeam) => {
      issued = actor
      expect(membershipTeam).toBe(fixture.parentId)
      expect((await ctx.teams.resolveIdentities({ ...input, actor })).items[0]?.state).toBe('resolved')
      const directory = await ctx.teamHumanActors.withReader(call, async reader => await ctx.teams.listHumanTeamsPage({
        reader, afterCursor: -1, limit: 128,
      }))
      expect(directory.items.map(item => item.id).sort()).toEqual([fixture.parentId, child.team.id].sort())
      expect(directory.items.find(item => item.id === child.team.id)?.readAccess).toBe('parent-inspection')
      expect(directory.items.find(item => item.id === fixture.parentId)?.readAccess).toBe('member')
      expect(directory.items.every(item => !('authorityGrant' in item) && !('budgets' in item.goal))).toBe(true)
      await expect(ctx.teams.resolveIdentities({ ...input, teamId: fixture.parentId, actor }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      controller.abort()
      await expect(ctx.teams.resolveIdentities({ ...input, actor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    })
    await expect(ctx.teams.resolveIdentities({ ...input, actor: issued! })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const freshCall = { ...call, signal: new AbortController().signal }
    const mutation = { teamId: child.team.id, operation: 'task-mutate' as const,
      fence: { kind: 'cursor' as const, cursor: child.team.cursor }, payload: {} }
    await expect(ctx.teamHumanActors.withProof(freshCall, mutation, async () => { throw new Error('Inherited read cannot reach mutation') }))
      .rejects.toMatchObject({ code: 'TEAM_HUMAN_ACTOR_NOT_FOUND' })
    for (const teamId of [child.team.id, teamIdSchema.parse('absent-private-team')]) {
      await expect(ctx.teams.resolveHumanReadAuthority({ teamId, principalId: productPrincipalId('foreign-reader') }))
        .rejects.toMatchObject({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', message: 'Authenticated principal cannot inspect this Team' })
    }
  })

  it.each(['json', 'sqlite'] as const)('publishes one exact binding and keeps retries idempotent (%s)', async (backend) => {
    const f = await endpoints(backend)
    try {
      expect(await f.ctx.teams.bindChildRun({ binding: f.binding,
        authorization: f.authorization, expectedCursor: f.expectedCursor })).toEqual(f.binding)
      const accepted = await f.ctx.teams.getTeam({ teamId: f.child.team.id })
      expect(await f.ctx.teams.bindChildRun({ binding: f.binding, authorization: f.authorization, expectedCursor: 0 })).toEqual(f.binding)
      expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).team.cursor).toBe(accepted.team.cursor)
      const current = await f.fixture.current()
      const input = { ...current.input, childTeamId: f.child.team.id }
      expect((await f.ctx.teams.bindTaskDelegation({ ...input, actor: f.fixture.issue({ kind: 'delegation-bind', ...input }) })).delegation?.phase)
        .toBe('active')
    } finally { f.authorization.close() }
  })

  it.each(['cursor', 'parent task', 'service'] as const)('rejects mismatched %s before endpoint publication', async (field) => {
    const f = await endpoints()
    try {
      const binding = { ...f.binding,
        ...field === 'parent task' ? { parentTaskId: teamTaskIdSchema.parse('other') } : {},
        ...field === 'service' ? { parentServiceId: participantIdSchema.parse('other') } : {} }
      await expect(f.ctx.teams.bindChildRun({ binding, authorization: f.authorization,
        expectedCursor: field === 'cursor' ? 0 : f.expectedCursor })).rejects.toMatchObject({
        code: field === 'cursor' ? 'TEAM_CURSOR_CONFLICT' : field === 'parent task' ? 'TEAM_ACTOR_PROOF_INVALID' : 'TEAM_INVALID_ARGUMENT',
      })
      expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).team.childRun).toBeUndefined()
    } finally { f.authorization.close() }
  })

  it('revalidates the retained startup scope after endpoint policy yields', async () => {
    const f = await endpoints()
    const remove = f.ctx.teams.registerPolicy('activate', { name: 'retarget-startup', async apply(request, next) {
      if (request.facts['operation'] === 'child-run-bind') f.fixture.replace(f.actor, { ...f.scope, operation: 'cancel' })
      return await next()
    } })
    try {
      await expect(f.ctx.teams.bindChildRun({ binding: f.binding, authorization: f.authorization, expectedCursor: f.expectedCursor }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const after = await f.ctx.teams.getTeam({ teamId: f.child.team.id })
      expect(after.team.childRun).toBeUndefined()
      expect(after.team.cursor).toBe(f.expectedCursor)
    } finally { remove(); f.authorization.close() }
  })

  it('rejects endpoint replacement after the original binding became durable', async () => {
    const f = await endpoints()
    try {
      await f.ctx.teams.bindChildRun({ binding: f.binding, authorization: f.authorization, expectedCursor: f.expectedCursor })
      const state = await f.ctx.teams.getTeam({ teamId: f.child.team.id })
      const channel = await openTestChannel(f.ctx, { ...f.channelInput, expectedCursor: state.team.cursor })
      await expect(f.ctx.teams.bindChildRun({ binding: { ...f.binding, channelId: channel.manifest.id },
        authorization: f.authorization, expectedCursor: state.team.cursor })).rejects.toThrow('already has different result endpoints')
      expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).team.childRun).toEqual(f.binding)
    } finally { f.authorization.close() }
  })
})

describe('parent child-Team reservations', () => {
  it('retains a stalled reservation and treats the same reason as an idempotent retry', async () => {
    const { ctx, fixture } = await setup()
    const current = await fixture.current()
    const request = { ...current.input, reason: { code: 'CHILD_UNAVAILABLE', message: 'The child host is unavailable' } }
    const stalled = await ctx.teams.stallTaskDelegation({ ...request, actor: fixture.issue({ kind: 'delegation-stall', ...request }) })
    expect(stalled).toMatchObject({ phase: 'running', delegation: { phase: 'stalled', childTeamId: fixture.task.delegation!.childTeamId } })
    const after = await fixture.current()
    expect(after.state.team.phase).toBe('stalled')
    const retry = { ...after.input, reason: request.reason }
    expect(await ctx.teams.stallTaskDelegation({ ...retry, actor: fixture.issue({ kind: 'delegation-stall', ...retry }) })).toEqual(stalled)
    expect((await fixture.current()).state.team.cursor).toBe(after.state.team.cursor)
    const start = { ...after.input, operation: 'start' as const }
    await expect(ctx.teams.authorizeChildRun({ ...start, actor: fixture.issue({ kind: 'delegation-authorize-run', ...start }) }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it('does not replace a terminal delegation with a late operational stall', async () => {
    const { ctx, fixture, cancel } = await setup()
    await cancel()
    const current = await fixture.current()
    const settle = { ...current.input, childTeamId: fixture.task.delegation!.childTeamId! }
    const terminal = await ctx.teams.settleTaskDelegation({ ...settle, actor: fixture.issue({ kind: 'delegation-settle', ...settle }) })
    const after = await fixture.current()
    const stalled = { ...after.input, reason: { code: 'LATE_FAILURE', message: 'An old operation finished late' } }
    expect(await ctx.teams.stallTaskDelegation({ ...stalled, actor: fixture.issue({ kind: 'delegation-stall', ...stalled }) })).toEqual(terminal)
    expect((await fixture.current()).state.team.cursor).toBe(after.state.team.cursor)
  })

  it.each(['cursor', 'revision', 'delegation'] as const)('rejects a stale %s on a provider-owned delegation operation', async (field) => {
    const { ctx, fixture } = await setup()
    const current = await fixture.current()
    const input = { ...current.input, operation: 'start' as const,
      ...field === 'cursor' ? { expectedCursor: 0 } : {},
      ...field === 'revision' ? { expectedRevision: current.task.revision - 1 } : {},
      ...field === 'delegation' ? { delegationId: teamDelegationIdSchema.parse('other') } : {},
    }
    await expect(ctx.teams.authorizeChildRun({ ...input, actor: fixture.issue({ kind: 'delegation-authorize-run', ...input }) }))
      .rejects.toMatchObject({ code: field === 'cursor' ? 'TEAM_CURSOR_CONFLICT'
        : field === 'revision' ? 'TEAM_TASK_STALE_REVISION' : 'TEAM_DELEGATION_INVALID' })
  })

  it('reuses the original child reservation and refuses changes to its frozen payload', async () => {
    const { ctx, fixture } = await setup()
    const { parentTeamId: _parent, parentTaskId: _task, delegationId: _delegation, ...child } = fixture.creation
    const current = await fixture.current()
    const retry = { ...current.input, child }
    expect(await ctx.teams.beginTaskDelegation({ ...retry, actor: fixture.issue({ kind: 'delegation-begin', ...retry }) })).toEqual(current.task)
    const changed = { ...retry, child: { ...child, goal: { ...child.goal, objective: 'Different child work' } } }
    await expect(ctx.teams.beginTaskDelegation({ ...changed, actor: fixture.issue({ kind: 'delegation-begin', ...changed }) }))
      .rejects.toThrow('changed its frozen payload')
    expect((await fixture.current()).state.team.cursor).toBe(current.state.team.cursor)
  })

  it('does not publish another revision when the parent already observed the same unbound child cursor', async () => {
    const { ctx, fixture, create } = await setup()
    const child = await create()
    const current = await fixture.current()
    const input = { ...current.input, childTeamId: child.team.id }
    const observed = await ctx.teams.bindTaskDelegation({ ...input, actor: fixture.issue({ kind: 'delegation-bind', ...input }) })
    const after = await fixture.current()
    const retry = { ...after.input, childTeamId: child.team.id }
    expect(await ctx.teams.bindTaskDelegation({ ...retry, actor: fixture.issue({ kind: 'delegation-bind', ...retry }) })).toEqual(observed)
    expect((await fixture.current()).state.team.cursor).toBe(after.state.team.cursor)
  })

  it.each(['operation', 'task'] as const)('revokes a startup authorization when its retained proof changes %s', async (change) => {
    const { ctx, fixture, create } = await setup()
    const child = await create()
    const current = await fixture.current()
    const bind = { ...current.input, childTeamId: child.team.id }
    await ctx.teams.bindTaskDelegation({ ...bind, actor: fixture.issue({ kind: 'delegation-bind', ...bind }) })
    const { input } = await fixture.current()
    const scope = { kind: 'delegation-authorize-run' as const, ...input, operation: 'start' as const }
    const actor = fixture.issue(scope)
    const token = await ctx.teams.authorizeChildRun({ ...input, operation: 'start', actor })
    try {
      await expect(token.assertCurrent()).resolves.toMatchObject({ operation: 'start', childTeamId: child.team.id })
      fixture.replace(actor, change === 'operation' ? { ...scope, operation: 'cancel' }
        : { ...scope, taskId: teamTaskIdSchema.parse('another-task') })
      await expect(token.assertCurrent()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally { token.close() }
  })

  it('rechecks the exact delegation proof after an awaited workspace lookup', async () => {
    const { ctx, fixture, create } = await setup()
    const child = await create()
    const current = await fixture.current()
    const bind = { ...current.input, childTeamId: child.team.id }
    await ctx.teams.bindTaskDelegation({ ...bind, actor: fixture.issue({ kind: 'delegation-bind', ...bind }) })
    const { input } = await fixture.current()
    const scope = { kind: 'delegation-authorize-run' as const, ...input, operation: 'start' as const }
    const actor = fixture.issue(scope)
    const token = await ctx.teams.authorizeChildRun({ ...input, operation: 'start', actor })
    const entered = Promise.withResolvers<undefined>(), resume = Promise.withResolvers<undefined>()
    fixture.beforeWorkspaceRead(async () => { entered.resolve(undefined); await resume.promise })
    const assertion = token.assertCurrent()
    try {
      await entered.promise
      fixture.replace(actor, { ...scope, operation: 'cancel' })
      resume.resolve(undefined)
      await expect(assertion).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally { resume.resolve(undefined); token.close() }
  })

  it.each(['json', 'sqlite'] as const)('passes only reserved descendant capacity into a third Team level (%s)', async (backend) => {
    const { ctx, fixture, create } = await setup(backend, { maxChildTeams: 2 }, { maxChildTeams: 1 })
    if (fixture.task.execution.kind !== 'child-team') throw new Error('Expected child execution')
    const child = await create()
    await provisionTestCoordinator(ctx, child.team.id)
    const current = await ctx.teams.getTeam({ teamId: child.team.id })
    const task = await createTestCoordinatorTask(ctx, { teamId: child.team.id, expectedCursor: current.team.cursor,
      subject: 'Grandchild', description: 'Use the reserved descendant slot',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
      execution: { ...fixture.task.execution, budget: { maxChildTeams: 0 } } })
    const state = await ctx.teams.getTeam({ teamId: child.team.id })
    const { parentTeamId: _parent, parentTaskId: _task, delegationId: _delegation, ...payload } = fixture.creation
    const begin = { teamId: child.team.id, taskId: task.id, expectedCursor: state.team.cursor,
      expectedRevision: task.revision, delegationId: task.delegation!.id, child: { ...payload, budgets: { maxChildTeams: 0 } } }
    const reserved = await ctx.teams.beginTaskDelegation({ ...begin, actor: fixture.issue({ kind: 'delegation-begin', ...begin }) })
    const grandchild = await create(reserved.delegation!.creation)
    expect(grandchild.team.depth).toBe(2)
    expect(grandchild.budgets.maxChildTeams).toBe(0)
    expect(taskChildTeamReservation(reserved)).toBe(1)
    expect(taskChildTeamReservation((await fixture.current()).task)).toBe(2)
  })

  it.each(['json', 'sqlite'] as const)('retains the child identity and subtree quota across cancellation and %s replay', async (backend) => {
    const { ctx, fixture, cancel, hub } = await setup(backend, { maxChildTeams: 2 }, { maxChildTeams: 1 })
    if (fixture.task.execution.kind !== 'child-team') throw new Error('Expected child execution')
    expect(taskChildTeamReservation(fixture.task)).toBe(2)
    await cancel()
    const { input } = await fixture.current()
    const settle = { ...input, childTeamId: fixture.task.delegation!.childTeamId! }
    const ended = await ctx.teams.settleTaskDelegation({ ...settle,
      actor: fixture.issue({ kind: 'delegation-settle', ...settle }) })
    expect(taskConcurrencyUsage(ended)).toBe(0)
    expect(taskChildTeamReservation(ended)).toBe(2)
    const current = await ctx.teams.getTeam({ teamId: fixture.parentId })
    const second = await createTestCoordinatorTask(ctx, { teamId: fixture.parentId, expectedCursor: current.team.cursor,
      subject: 'Second child', description: 'Must not reuse the first subtree quota',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
      execution: { ...fixture.task.execution, budget: { maxChildTeams: 0 } } })
    const state = await ctx.teams.getTeam({ teamId: fixture.parentId })
    const child = { ...fixture.creation, budgets: { maxChildTeams: 0 } }
    const { parentTeamId: _parent, parentTaskId: _task, delegationId: _delegation, ...payload } = child
    const begin = { teamId: fixture.parentId, taskId: second.id, expectedCursor: state.team.cursor,
      expectedRevision: second.revision, delegationId: second.delegation!.id, child: payload }
    await expect(ctx.teams.beginTaskDelegation({ ...begin, actor: fixture.issue({ kind: 'delegation-begin', ...begin }) }))
      .rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
    expect((await ctx.teams.getTask({ teamId: fixture.parentId, taskId: second.id })).delegation?.childTeamId).toBeUndefined()
    await hub.dispose()
    await ctx.plugin(TeamHub, { maxTeamDepth: 2 })
    const replayed = await ctx.teams.getTeam({ teamId: fixture.parentId })
    expect(replayed.tasks.reduce((sum, task) => sum + taskChildTeamReservation(task), 0)).toBe(2)
  })

  it.each([
    [{ maxChildTeams: 0 }, { maxChildTeams: 0 }, 'TEAM_BUDGET_EXCEEDED'],
    [{ maxChildTeams: 1 }, { maxChildTeams: 1 }, 'TEAM_BUDGET_EXCEEDED'],
    [{ maxChildTeams: 1 }, {}, 'TEAM_BUDGET_INVALID'],
  ] as const)('rejects child creation without enough frozen descendant capacity (%j, %j)', async (parent, child, code) => {
    await expect(setup('json', parent, child)).rejects.toMatchObject({ code })
  })

  it('admits the exact lifetime child limit without charging its retry twice', async () => {
    const { fixture, create } = await setup('json', { maxChildTeams: 1 }, { maxChildTeams: 0 })
    const first = await create()
    expect((await create()).team.id).toBe(first.team.id)
    expect(taskChildTeamReservation(fixture.task)).toBe(1)
  })

  it('reuses one durable child identity and retains capacity without a Participant lease', async () => {
    const { fixture, create } = await setup()
    expect(taskConcurrencyUsage(fixture.task)).toBe(1)
    expect(fixture.task.lease).toBeUndefined()
    const first = await create()
    const replay = await create()
    expect(first.team.id).toBe(fixture.task.delegation?.childTeamId)
    expect(replay.team.id).toBe(first.team.id)
  })

  it('rejects a changed live root after the child stream marker and revokes issued startup capabilities', async () => {
    const { ctx, fixture, create } = await setup()
    const child = await create()
    let current = await fixture.current()
    const bind = { ...current.input, childTeamId: child.team.id }
    await ctx.teams.bindTaskDelegation({ ...bind, actor: fixture.issue({ kind: 'delegation-bind', ...bind }) })
    current = await fixture.current()
    const input = { ...current.input, operation: 'start' as const }
    const actor = fixture.issue({ kind: 'delegation-authorize-run', ...input })
    const token = await ctx.teams.authorizeChildRun({ ...input, actor })
    await expect(token.assertCurrent()).resolves.toMatchObject({ operation: 'start', childTeamId: child.team.id })
    fixture.moveWorkspace('/different-workspace')
    await expect(token.assertCurrent()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    fixture.revoke(actor)
    await expect(token.assertCurrent()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    token.close()
  })

  it('cancels a reservation before any child stream without creating a synthetic child', async () => {
    const { ctx, fixture, cancel } = await setup()
    const pending = await cancel()
    expect(pending.phase).toBe('running')
    expect(pending.cancellation?.target.kind).toBe('delegation')
    const { input } = await fixture.current()
    const settle = { ...input, childTeamId: fixture.task.delegation!.childTeamId! }
    const settled = await ctx.teams.settleTaskDelegation({ ...settle, actor: fixture.issue({ kind: 'delegation-settle', ...settle }) })
    expect(settled.phase).toBe('cancelled')
    expect(taskConcurrencyUsage(settled)).toBe(0)
    await expect(ctx.teams.getTeam({ teamId: settle.childTeamId })).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' })
  })

  it('replays create retry and pre-child cancellation on the SQLite backend', async () => {
    const { create } = await setup('sqlite')
    const first = await create()
    const replay = await create()
    expect(replay.team.id).toBe(first.team.id)
    const cancelled = await setup('sqlite')
    const pending = await cancelled.cancel()
    expect(pending.phase).toBe('running')
    const current = await cancelled.fixture.current()
    const settle = { ...current.input, childTeamId: cancelled.fixture.task.delegation!.childTeamId! }
    const settled = await cancelled.ctx.teams.settleTaskDelegation({ ...settle, actor: cancelled.fixture.issue({ kind: 'delegation-settle', ...settle }) })
    expect(settled.phase).toBe('cancelled')
    expect(taskConcurrencyUsage(settled)).toBe(0)
    await expect(cancelled.ctx.teams.getTeam({ teamId: settle.childTeamId })).rejects.toMatchObject({ code: 'TEAM_NOT_FOUND' })
  })

  it.each(['json', 'sqlite'] as const)('retains cancellation until a bound child is terminal on the %s backend', async (backend) => {
    const { ctx, fixture, create, cancel } = await setup(backend)
    const child = await create()
    let current = await fixture.current()
    const bind = { ...current.input, childTeamId: child.team.id }
    await ctx.teams.bindTaskDelegation({ ...bind, actor: fixture.issue({ kind: 'delegation-bind', ...bind }) })

    const cancelled = await cancel()
    expect(cancelled.phase).toBe('running')
    expect(cancelled.delegation).toMatchObject({ phase: 'creating', childTeamId: child.team.id })
    current = await fixture.current()
    const settle = { ...current.input, childTeamId: child.team.id }
    await expect(ctx.teams.settleTaskDelegation({ ...settle, actor: fixture.issue({ kind: 'delegation-settle', ...settle }) }))
      .rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })

    current = await fixture.current()
    const authorizationInput = { ...current.input, operation: 'cancel' as const }
    const authorization = await ctx.teams.authorizeChildRun({
      ...authorizationInput,
      actor: fixture.issue({ kind: 'delegation-authorize-run', ...authorizationInput }),
    })
    let cancelledChild
    try {
      const childCurrent = await ctx.teams.getTeam({ teamId: child.team.id })
      cancelledChild = await ctx.teams.cancelChildTeam({
        authorization,
        childTeamId: child.team.id,
        expectedCursor: childCurrent.team.cursor,
        idempotencyKey: teamClosureIdempotencyKeySchema.parse('task-delegation-child-cancel:' + backend),
        reason: { code: 'PARENT_DELEGATION_CANCELLED', message: 'The parent delegation cancelled this child.' },
      })
    } finally { authorization.close() }
    expect(cancelledChild.team.phase).toBe('quiescing')
    const cancellation = cancelledChild.team.cancellation
    if (cancellation === undefined) throw new Error('child cancellation did not retain a durable intent')
    const proof = Object.freeze({}) as TeamSystemClosureDriverProof
    const scope: TeamSystemClosureDriverScope = {
      kind: 'closure-recover-cancel',
      teamId: child.team.id,
      expectedCursor: cancelledChild.team.cursor,
      cancellationIdempotencyKey: cancellation.idempotencyKey,
      cancellationRequestedAt: cancellation.requestedAt,
    }
    const unregister = ctx.teams.registerSystemClosureDriverProofSource({
      name: 'task-delegation-test-' + backend,
      resolveClosureDriverProof: candidate => candidate === proof ? scope : undefined,
    })
    let terminalChild
    try {
      terminalChild = await ctx.teams.continueTeamClosure({
        actor: proof,
        teamId: child.team.id,
        expectedCursor: cancelledChild.team.cursor,
      })
    } finally { unregister() }
    expect(terminalChild.team.phase).toBe('cancelled')

    current = await fixture.current()
    const settled = await ctx.teams.settleTaskDelegation({
      ...current.input,
      childTeamId: child.team.id,
      actor: fixture.issue({ kind: 'delegation-settle', ...current.input, childTeamId: child.team.id }),
    })
    expect(settled.phase).toBe('cancelled')
    expect(settled.delegation).toMatchObject({ phase: 'cancelled', childTeamId: child.team.id })
    expect(taskConcurrencyUsage(settled)).toBe(0)
  })

  it('authorizes cancellation before the parent observes a created child and rejects startup authority for cancellation', async () => {
    const { ctx, fixture, create, cancel } = await setup()
    const child = await create()
    await cancel()
    const { input, task } = await fixture.current()
    expect(task.delegation?.childCursor).toBeUndefined()
    const request = { ...input, operation: 'cancel' as const }
    const token = await ctx.teams.authorizeChildRun({ ...request, actor: fixture.issue({ kind: 'delegation-authorize-run', ...request }) })
    await expect(token.assertCurrent()).resolves.toMatchObject({ operation: 'cancel', childTeamId: child.team.id })
    const startup = { ...input, operation: 'start' as const }
    await expect(ctx.teams.authorizeChildRun({ ...startup, actor: fixture.issue({ kind: 'delegation-authorize-run', ...startup }) }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const command = { childTeamId: child.team.id, expectedCursor: child.team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('partial-child-cancel'),
      reason: { code: 'PARENT_CANCELLED', message: 'Parent cancelled partial startup' } }
    const cancelling = await ctx.teams.cancelChildTeam({ ...command, authorization: token })
    expect(cancelling.team).toMatchObject({ phase: 'quiescing', cancellation: { actor: { kind: 'system', name: 'team-delegation' } } })
    expect((await fixture.current()).task.phase).toBe('running')
    token.close()
    await expect(ctx.teams.cancelChildTeam({ ...command, authorization: token })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })
})
