import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import { taskConcurrencyUsage, taskChildTeamReservation, teamClosureIdempotencyKeySchema,
  teamTaskIdSchema,
  participantIdSchema,
  teamDelegationIdSchema,
  teamChildRunBindingSchema,
  type JsonObject, type TeamSystemChildCreationProof, type TeamSystemChildCreationScope, type TeamSystemClosureProof,
  type TeamSystemClosureDriverProof, type TeamSystemClosureDriverScope, type TeamSystemTaskControlProof, type TeamSystemTaskControlScope } from '@clocky/clocky-team'
import type { TeamTaskId } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import ProductPrincipalRegistry, { productPrincipalId } from '@clocky/clocky-product-principal'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import * as TeamHumanActor from '@clocky/clocky-team-human-actor'
import { jsonObjectSchema, teamIdSchema } from '@clocky/clocky-team'
import { delegationFixture } from './delegation-fixtures.ts'
import { createTestCoordinatorTask, provisionTestCoordinator, seedTeamPhase } from './fixtures.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { consultChannelAdapter } from '@clocky/clocky-team-channel-basic'
import { FULL_TRANSCRIPT_VIEW_POLICY } from '@clocky/clocky-team-channel-direct'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup(backend: 'json' | 'sqlite' = 'json', budgets: JsonObject = {}, childBudgets: JsonObject = {},
  taskBudget: JsonObject = {}) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'task-delegation-'))
  roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  const hub = await ctx.plugin(TeamHub, { maxTeamDepth: 2, maxEnvelopeBytes: 4096 })
  const fixture = await delegationFixture(ctx, root, budgets, childBudgets, taskBudget)
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

async function secondDelegation(selected: Awaited<ReturnType<typeof setup>>, blockedBy: readonly TeamTaskId[],
  childBudgets: JsonObject = {}) {
  const { ctx, fixture } = selected
  if (fixture.task.execution.kind !== 'child-team') throw new Error('Fixture has no child-team task execution')
  const state = await ctx.teams.getTeam({ teamId: fixture.parentId })
  const second = await createTestCoordinatorTask(ctx, { teamId: fixture.parentId, expectedCursor: state.team.cursor,
    subject: 'Second delegated task', description: 'Wait for durable parent capacity.', blockedBy,
    requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {},
    reviewPolicy: { kind: 'none' }, maxAttempts: 1, execution: { ...fixture.task.execution, budget: childBudgets } })
  const latest = await ctx.teams.getTeam({ teamId: fixture.parentId })
  const { parentTeamId: _parent, parentTaskId: _task, delegationId: _delegation, ...baseChild } = fixture.creation
  const child = { ...baseChild, budgets: childBudgets }
  if (second.delegation === undefined) throw new Error('Second task has no delegation')
  const input = { teamId: fixture.parentId, taskId: second.id, expectedCursor: latest.team.cursor,
    expectedRevision: second.revision, delegationId: second.delegation.id, child }
  return { second, input }
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
  it('rechecks a source that retires between the token lifetime check and async assertion', async () => {
    const f = await endpoints()
    try {
      f.fixture.retireSourceDuringNextProofResolution()
      await expect(f.authorization.assertCurrent()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect((await f.ctx.teams.getTeam({ teamId: f.child.team.id })).team.childRun).toBeUndefined()
    } finally { f.authorization.close() }
  })

  it('allows child cancellation under a retained parent failure intent without a task cancellation', async () => {
    const f = await endpoints()
    const proof = Object.freeze({}) as TeamSystemClosureProof
    const dispose = f.ctx.teams.registerSystemClosureProofSource({ name: 'team-run',
      resolveClosureProof: candidate => candidate === proof
        ? { kind: 'team-run-create-failure', teamId: f.fixture.parentId } : undefined })
    try {
      const parent = await f.ctx.teams.getTeam({ teamId: f.fixture.parentId })
      const failed = await f.ctx.teams.failTeam({ actor: proof, teamId: f.fixture.parentId,
        expectedCursor: parent.team.cursor, idempotencyKey: teamClosureIdempotencyKeySchema.parse('child-run-parent-failure'),
        reason: { code: 'MODEL_UNAVAILABLE', message: 'Parent coordinator cannot continue.' } })
      expect(failed.team.closure?.kind).toBe('fail')
      const current = await f.fixture.current()
      expect(current.task.cancellation).toBeUndefined()
      const input = { ...current.input, operation: 'cancel' as const }
      const token = await f.ctx.teams.authorizeChildRun({ ...input,
        actor: f.fixture.issue({ kind: 'delegation-authorize-run', ...input }) })
      try { await expect(token.assertCurrent()).resolves.toMatchObject({ operation: 'cancel', childTeamId: f.child.team.id }) }
      finally { token.close() }
      const start = { ...current.input, operation: 'start' as const }
      await expect(f.ctx.teams.authorizeChildRun({ ...start,
        actor: f.fixture.issue({ kind: 'delegation-authorize-run', ...start }) }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally { dispose(); f.authorization.close() }
  })

  it('allows child cancellation under a retained parent cancellation without a task cancellation', async () => {
    const f = await endpoints()
    const parent = await f.ctx.teams.getTeam({ teamId: f.fixture.parentId })
    const coordinator = parent.participants.find(participant => participant.role === 'coordinator')
    const binding = parent.activations.find(value => value.activation.participantId === coordinator?.id)
    if (binding === undefined) throw new Error('Parent coordinator has no active activation')
    const actor = f.ctx.teams.openActivationActorProofIssuer().issue(binding)
    try {
      const cancelled = await f.ctx.teams.cancelTeam({ actor: actor.proof, teamId: f.fixture.parentId,
        expectedCursor: parent.team.cursor, idempotencyKey: teamClosureIdempotencyKeySchema.parse('child-run-parent-cancel'),
        reason: { code: 'PARENT_CANCELLED', message: 'Parent cancelled delegated work.' } })
      expect(cancelled.team.cancellation).toBeDefined()
      const current = await f.fixture.current()
      expect(current.task.cancellation).toBeUndefined()
      const input = { ...current.input, operation: 'cancel' as const }
      const token = await f.ctx.teams.authorizeChildRun({ ...input,
        actor: f.fixture.issue({ kind: 'delegation-authorize-run', ...input }) })
      try { await expect(token.assertCurrent()).resolves.toMatchObject({ operation: 'cancel', childTeamId: f.child.team.id }) }
      finally { token.close() }
      await expect(f.authorization.assertCurrent()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally { actor.revoke(); f.authorization.close() }
  })

  it('does not accept child startup authorization as a cancellation credential', async () => {
    const f = await endpoints()
    try {
      const before = await f.ctx.teams.getTeam({ teamId: f.child.team.id })
      await expect(f.ctx.teams.cancelChildTeam({ authorization: f.authorization,
        childTeamId: f.child.team.id, expectedCursor: before.team.cursor,
        idempotencyKey: teamClosureIdempotencyKeySchema.parse('wrong-child-operation'),
        reason: { code: 'PARENT_CANCELLED', message: 'A startup proof cannot cancel.' } }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(await f.ctx.teams.getTeam({ teamId: f.child.team.id })).toEqual(before)
    } finally { f.authorization.close() }
  })
  it('replays an active child binding without publishing another parent revision', async () => {
    const f = await endpoints()
    try {
      const current = await f.fixture.current()
      const input = { ...current.input, childTeamId: f.child.team.id }
      expect(await f.ctx.teams.bindTaskDelegation({ ...input,
        actor: f.fixture.issue({ kind: 'delegation-bind', ...input }) })).toEqual(current.task)
      expect((await f.fixture.current()).state.team.cursor).toBe(current.state.team.cursor)
    } finally { f.authorization.close() }
  })
  it('does not settle a missing child stream without a durable cancellation intent', async () => {
    const { ctx, fixture } = await setup()
    const current = await fixture.current()
    const childTeamId = current.task.delegation?.childTeamId
    if (childTeamId === undefined) throw new Error('Fixture has no reserved child identity')
    const input = { ...current.input, childTeamId }
    await expect(ctx.teams.settleTaskDelegation({ ...input,
      actor: fixture.issue({ kind: 'delegation-settle', ...input }) }))
      .rejects.toMatchObject({ code: 'TEAM_DELEGATION_CHILD_MISSING' })
    expect((await fixture.current()).task).toEqual(current.task)
  })

  it('refuses to settle a stale missing-child read after child creation wins the race', async () => {
    const { ctx, fixture, create, cancel } = await setup()
    const reservedId = fixture.task.delegation?.childTeamId
    if (reservedId === undefined) throw new Error('Delegation has no reserved child identity')
    const missing: unknown = await ctx.teams.getTeam({ teamId: reservedId }).catch((error: unknown) => error)
    expect(missing).toMatchObject({ code: 'TEAM_NOT_FOUND' })
    const child = await create()
    await cancel()
    const current = await fixture.current()
    const input = { ...current.input, childTeamId: child.team.id }
    const hub = ctx.teams as unknown as { ensureTeam(teamId: string): Promise<unknown> }
    const ensure = hub.ensureTeam.bind(hub)
    let lost = false
    const stale = vi.spyOn(hub, 'ensureTeam').mockImplementation(async (teamId) => {
      if (teamId === child.team.id && !lost) { lost = true; throw missing }
      return await ensure(teamId)
    })
    try {
      await expect(ctx.teams.settleTaskDelegation({ ...input,
        actor: fixture.issue({ kind: 'delegation-settle', ...input }) }))
        .rejects.toMatchObject({ code: 'TEAM_DELEGATION_BUSY' })
    } finally { stale.mockRestore() }
    expect(lost).toBe(true)
    expect(await ensure(child.team.id)).toMatchObject({ id: child.team.id })
    expect((await fixture.current()).task).toEqual(current.task)
  })

  it('rejects a binding proof reused as a child settlement command', async () => {
    const { ctx, fixture, create } = await setup()
    const child = await create()
    const current = await fixture.current()
    const input = { ...current.input, childTeamId: child.team.id }
    const actor = fixture.issue({ kind: 'delegation-bind', ...input })
    await expect(ctx.teams.settleTaskDelegation({ ...input, actor }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await fixture.current()).task).toEqual(current.task)
  })
  it('does not treat a child stream storage outage as a missing child cancellation', async () => {
    const { ctx, fixture } = await setup()
    const current = await fixture.current()
    const childTeamId = current.task.delegation?.childTeamId
    if (childTeamId === undefined) throw new Error('Fixture has no reserved child identity')
    const input = { ...current.input, childTeamId }
    const open = ctx.storageLog.open.bind(ctx.storageLog)
    const outage = new Error('Child stream storage is unavailable')
    const fault = vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
      if (descriptor.name === `team/${childTeamId}`) throw outage
      return await open(descriptor)
    })
    try {
      await expect(ctx.teams.settleTaskDelegation({ ...input,
        actor: fixture.issue({ kind: 'delegation-settle', ...input }) })).rejects.toBe(outage)
    } finally { fault.mockRestore() }
    expect((await fixture.current()).task).toEqual(current.task)
  })
  it('settles a failed child with a retained fallback reason and replays without another parent write', async () => {
    const { ctx, fixture, create } = await setup()
    const child = await create()
    await ctx.teams.getTeam({ teamId: child.team.id })
    await seedTeamPhase(ctx, child.team.id, 'quiescing')
    await seedTeamPhase(ctx, child.team.id, 'failed')
    const current = await fixture.current()
    const input = { ...current.input, childTeamId: child.team.id }
    const failed = await ctx.teams.settleTaskDelegation({ ...input,
      actor: fixture.issue({ kind: 'delegation-settle', ...input }) })
    expect(failed).toMatchObject({ phase: 'failed', delegation: { phase: 'failed',
      failure: { code: 'CHILD_TEAM_FAILED' } } })
    const replay = await fixture.current()
    const replayInput = { ...replay.input, childTeamId: child.team.id }
    expect(await ctx.teams.settleTaskDelegation({ ...replayInput,
      actor: fixture.issue({ kind: 'delegation-settle', ...replayInput }) })).toEqual(failed)
    expect((await fixture.current()).state.team.cursor).toBe(replay.state.team.cursor)
  })
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
    const invisible = await createTestRootTeam(ctx, { goal: { objective: 'Keep this unrelated Team private.', budgets: {} },
      rules: {}, budgets: {} })
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
      expect(directory.items.map(item => item.id)).not.toContain(invisible.team.id)
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
  it('requires the child-run proof kind before consulting a reserved task', async () => {
    const { ctx, fixture } = await setup()
    const current = await fixture.current()
    const input = { ...current.input, operation: 'start' as const }
    const wrong = fixture.issue({ kind: 'delegation-bind', ...current.input,
      childTeamId: current.task.delegation!.childTeamId! })
    await expect(ctx.teams.authorizeChildRun({ ...input, actor: wrong }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await fixture.current()).task).toEqual(current.task)
  })

  it('refuses a delegation source that retires itself while resolving its operation proof', async () => {
    const { ctx, fixture } = await setup()
    const current = await fixture.current()
    const input = { ...current.input, operation: 'cancel' as const }
    const actor = fixture.issue({ kind: 'delegation-authorize-run', ...input })
    fixture.retireSourceDuringNextProofResolution()
    await expect(ctx.teams.authorizeChildRun({ ...input, actor }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await fixture.current()).task).toEqual(current.task)
  })

  it('rejects startup authority after the reserved child workspace changes', async () => {
    const { ctx, fixture, create } = await setup()
    const child = await create()
    const current = await fixture.current()
    const bind = { ...current.input, childTeamId: child.team.id }
    await ctx.teams.bindTaskDelegation({ ...bind, actor: fixture.issue({ kind: 'delegation-bind', ...bind }) })
    const latest = await fixture.current()
    const input = { ...latest.input, operation: 'start' as const }
    fixture.moveWorkspace('/different-controlled-root')
    await expect(ctx.teams.authorizeChildRun({ ...input, actor: fixture.issue({ kind: 'delegation-authorize-run', ...input }) }))
      .rejects.toMatchObject({ code: 'TEAM_DELEGATION_WORKSPACE_UNAVAILABLE' })
    expect((await fixture.current()).task).toEqual(latest.task)
  })

  it('rejects a child-run token before a second delegation reserves its child identity', async () => {
    const selected = await setup()
    const pending = await secondDelegation(selected, [])
    if (pending.second.delegation === undefined) throw new Error('Second delegation has no identity')
    const { child: _child, ...base } = pending.input
    const input = { ...base, operation: 'cancel' as const }
    await expect(selected.ctx.teams.authorizeChildRun({ ...input,
      actor: selected.fixture.issue({ kind: 'delegation-authorize-run', ...input }) }))
      .rejects.toMatchObject({ code: 'TEAM_DELEGATION_INVALID' })
    expect((await selected.ctx.teams.getTask({ teamId: selected.fixture.parentId, taskId: pending.second.id })).delegation?.childTeamId)
      .toBeUndefined()
  })

  it('rechecks the frozen task wall-time budget before and after issuing startup authority', async () => {
    const { ctx, fixture, create } = await setup('json', {}, {}, { maxWallTimeMs: 1_000_000 })
    const child = await create()
    const current = await fixture.current()
    const bind = { ...current.input, childTeamId: child.team.id }
    await ctx.teams.bindTaskDelegation({ ...bind, actor: fixture.issue({ kind: 'delegation-bind', ...bind }) })
    const latest = await fixture.current()
    const startedAt = latest.task.delegation?.startedAt
    if (startedAt === undefined) throw new Error('Delegation has no durable start time')
    const input = { ...latest.input, operation: 'start' as const }
    const actor = fixture.issue({ kind: 'delegation-authorize-run', ...input })
    const expired = vi.spyOn(Date, 'now').mockReturnValue(startedAt + 1_000_001)
    try {
      await expect(ctx.teams.authorizeChildRun({ ...input, actor }))
        .rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
    } finally { expired.mockRestore() }
    const token = await ctx.teams.authorizeChildRun({ ...input, actor })
    const late = vi.spyOn(Date, 'now').mockReturnValue(startedAt + 1_000_001)
    try {
      await expect(token.assertCurrent()).rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
      expect((await fixture.current()).task).toEqual(latest.task)
    } finally { late.mockRestore(); token.close() }
  })

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

  it('rejects a wrong delegation operation and a changed controlled workspace before retrying a reservation', async () => {
    const { ctx, fixture } = await setup()
    const current = await fixture.current()
    const { parentTeamId: _parent, parentTaskId: _task, delegationId: _delegation, ...child } = fixture.creation
    const input = { ...current.input, child }
    const wrongOperation = fixture.issue({ kind: 'delegation-bind', ...current.input,
      childTeamId: fixture.task.delegation!.childTeamId! })
    await expect(ctx.teams.beginTaskDelegation({ ...input, actor: wrongOperation }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    fixture.moveWorkspace('/different-controlled-root')
    await expect(ctx.teams.beginTaskDelegation({ ...input, actor: fixture.issue({ kind: 'delegation-begin', ...input }) }))
      .rejects.toMatchObject({ code: 'TEAM_DELEGATION_WORKSPACE_UNAVAILABLE' })
    expect((await fixture.current()).task).toEqual(current.task)
  })
  it('retains the parent reservation when reading its child stream fails for a storage reason', async () => {
    const { ctx, fixture, create } = await setup()
    const reservedId = fixture.task.delegation?.childTeamId
    if (reservedId === undefined) throw new Error('Fixture has no reserved child identity')
    const before = await fixture.current()
    const open = ctx.storageLog.open.bind(ctx.storageLog)
    const failure = new Error('reserved child stream cannot be read')
    const storageFault = vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
      if (descriptor.name === `team/${reservedId}`) throw failure
      return await open(descriptor)
    })
    try { await expect(create()).rejects.toBe(failure) }
    finally { storageFault.mockRestore() }
    expect((await fixture.current()).task).toEqual(before.task)
  })
  it('propagates a real Team storage fault during principal lineage discovery', async () => {
    const { ctx, fixture, create, hub } = await setup()
    const child = await create()
    await hub.dispose()
    await ctx.plugin(TeamHub, { maxTeamDepth: 2 })
    const open = ctx.storageLog.open.bind(ctx.storageLog)
    const failure = new Error('Team journal storage unavailable for lineage read')
    const fault = vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
      if (descriptor.name === `team/${fixture.parentId}`) throw failure
      return await open(descriptor)
    })
    try {
      await expect(ctx.teams.resolveHumanReadAuthority({ teamId: child.team.id,
        principalId: productPrincipalId('lineage-reader') })).rejects.toBe(failure)
    } finally { fault.mockRestore() }
  })
  it.each(['unfinished dependency', 'occupied concurrency'] as const)(
    'waits for %s before reserving a second child Team', async (reason) => {
      const selected = await setup('json', reason === 'occupied concurrency' ? { maxConcurrency: 1 } : {})
      const { ctx, fixture } = selected
      const { second, input } = await secondDelegation(selected, reason === 'unfinished dependency' ? [fixture.task.id] : [])
      await expect(ctx.teams.beginTaskDelegation({ ...input,
        actor: fixture.issue({ kind: 'delegation-begin', ...input }) }))
        .rejects.toMatchObject({ code: 'TEAM_DELEGATION_BUSY' })
      expect((await ctx.teams.getTask({ teamId: fixture.parentId, taskId: second.id })).delegation?.childTeamId)
        .toBeUndefined()
    },
  )
  it('refuses a child budget larger than the remaining parent concurrency limit', async () => {
    const selected = await setup('json', { maxConcurrency: 1 })
    const { ctx, fixture } = selected
    const { second, input } = await secondDelegation(selected, [], { maxConcurrency: 2 })
    await expect(ctx.teams.beginTaskDelegation({ ...input,
      actor: fixture.issue({ kind: 'delegation-begin', ...input }) }))
      .rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
    expect((await ctx.teams.getTask({ teamId: fixture.parentId, taskId: second.id })).delegation?.childTeamId)
      .toBeUndefined()
  })
  it('keeps a pending child task unreserved after the parent Team stalls', async () => {
    const selected = await setup()
    const { ctx, fixture } = selected
    const { second } = await secondDelegation(selected, [])
    await seedTeamPhase(ctx, fixture.parentId, 'stalled', {
      code: 'PARENT_STALLED', message: 'Parent must recover before delegating again.',
    })
    const state = await ctx.teams.getTeam({ teamId: fixture.parentId })
    const { parentTeamId: _parent, parentTaskId: _task, delegationId: _delegation, ...child } = fixture.creation
    if (second.delegation === undefined) throw new Error('Second task has no delegation')
    const input = { teamId: fixture.parentId, taskId: second.id, expectedCursor: state.team.cursor,
      expectedRevision: second.revision, delegationId: second.delegation.id, child }
    await expect(ctx.teams.beginTaskDelegation({ ...input,
      actor: fixture.issue({ kind: 'delegation-begin', ...input }) }))
      .rejects.toMatchObject({ code: 'TEAM_DELEGATION_BUSY' })
    expect((await ctx.teams.getTask({ teamId: fixture.parentId, taskId: second.id })).delegation?.childTeamId)
      .toBeUndefined()
  })
  it('cancels a pending child task before it reserves any child stream', async () => {
    const selected = await setup()
    const { ctx, fixture } = selected
    const { second } = await secondDelegation(selected, [])
    const creator = second.createCommand.creator
    if (!('activationId' in creator)) throw new Error('Fixture second child requires an activation-backed creator')
    const proofs = new Map<TeamSystemTaskControlProof, TeamSystemTaskControlScope>()
    ctx.teams.registerSystemTaskControlProofSource({ name: 'team-run',
      resolveTaskControlProof: proof => proofs.get(proof) })
    const input = { teamId: fixture.parentId, taskId: second.id, expectedRevision: second.revision }
    const actor = Object.freeze({}) as TeamSystemTaskControlProof
    proofs.set(actor, { kind: 'team-run-default-worker-cancel', ...input, coordinator: creator })
    const cancelled = await ctx.teams.cancelTask({ ...input, actor })
    expect(cancelled).toMatchObject({ phase: 'cancelled', delegation: { phase: 'cancelled' } })
    expect(cancelled.delegation?.childTeamId).toBeUndefined()
    expect((await ctx.teams.getTask({ teamId: fixture.parentId, taskId: second.id })).phase).toBe('cancelled')
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
    const retry = { ...command, expectedCursor: cancelling.team.cursor }
    expect(await ctx.teams.cancelChildTeam({ ...retry, authorization: token })).toEqual(cancelling)
    await expect(ctx.teams.cancelChildTeam({ ...retry,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('changed-child-cancellation'), authorization: token }))
      .rejects.toMatchObject({ code: 'TEAM_CLOSURE_IDEMPOTENCY_CONFLICT' })
    token.close()
    await expect(ctx.teams.cancelChildTeam({ ...command, authorization: token })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })
})
