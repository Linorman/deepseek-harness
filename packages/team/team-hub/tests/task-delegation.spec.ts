import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import { taskConcurrencyUsage, teamClosureIdempotencyKeySchema, type TeamSystemChildCreationProof, type TeamSystemChildCreationScope,
  type TeamSystemClosureDriverProof, type TeamSystemClosureDriverScope, type TeamSystemTaskControlProof, type TeamSystemTaskControlScope } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { delegationFixture } from './delegation-fixtures.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup(backend: 'json' | 'sqlite' = 'json') {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'task-delegation-'))
  roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { maxTeamDepth: 2 })
  const fixture = await delegationFixture(ctx, root)
  const creation = new Map<TeamSystemChildCreationProof, TeamSystemChildCreationScope>()
  ctx.teams.registerSystemChildCreationProofSource({ name: 'team-child-delegation', resolveChildCreationProof: proof => creation.get(proof) })
  async function create() {
    const { state } = await fixture.current()
    const actor = Object.freeze({}) as TeamSystemChildCreationProof
    creation.set(actor, { kind: 'team-child-create', ...fixture.creation, expectedParentCursor: state.team.cursor })
    try { return await ctx.teams.createTeam({ ...fixture.creation, actor }) } finally { creation.delete(actor) }
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
  return { ctx, fixture, create, cancel }
}

describe('parent child-Team reservations', () => {
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
