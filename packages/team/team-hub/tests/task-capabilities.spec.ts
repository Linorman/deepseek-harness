/** Task authoring capability reads retain only current durable grants and limits. */
import { expect, it } from 'vitest'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import type { Context } from '@clocky/cordis'
import type { TeamHumanActorProof, TeamHumanActorScope, TeamTaskCapabilitiesInput } from '@clocky/clocky-team'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, teamId, teamPhase } from './fixtures.ts'

const grant = { operations: ['task-mutate', 'workspace-integrate'], workspaceModes: ['shared'],
  readScopes: ['packages'], writeScopes: ['packages'], budgets: {} }

function reader(ctx: Context, memberId: ReturnType<typeof participant>['id']) {
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  ctx.teams.registerHumanActorProofSource({ name: 'capability-reader', resolveHumanActorProof: proof => scopes.get(proof) })
  return async (input: TeamTaskCapabilitiesInput) => {
    const actor = Object.freeze({}) as TeamHumanActorProof
    const bound = { teamId, operation: 'task-capabilities-read' as const,
      fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
    scopes.set(actor, { teamId, participantId: memberId, operation: bound.operation, fence: bound.fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
    try { return await ctx.teams.getTaskCapabilities({ ...input, actor }) }
    finally { scopes.delete(actor) }
  }
}

function records(options: {
  readonly granted?: boolean
  readonly integrationGrant?: boolean
  readonly task?: boolean
  readonly phase?: 'active' | 'quiescing'
  readonly simulation?: boolean
  readonly ageMs?: number
  readonly budgetWallTimeMs?: number
} = {}) {
  const now = Date.now() - (options.ageMs ?? 0)
  const human = participant({ id: 'capability-human', kind: 'human', phase: 'active',
    owner: { kind: 'product-principal', principalId: 'capability-principal' },
    ...options.granted ? { authorityGrant: { ...grant, operations: options.integrationGrant === false
      ? ['task-mutate'] : grant.operations } } : {} })
  const creation = createdTeam({ createdAt: now, rules: options.simulation ? { simulationRunId: 'run-a' } : {},
    ...options.budgetWallTimeMs === undefined ? {} : { budgets: { maxWallTimeMs: options.budgetWallTimeMs } } })
  const journal = [creation, teamPhase({ createdAt: now + 1 }),
    ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
      participantChanged({ participant: { ...human, phase }, createdAt: now + index + 2 }))]
  if (options.task) journal.push(taskChanged({ task: task({ createdAt: now + 5,
    createCommand: { creator: { teamId, participantId: human.id }, idempotencyKey: 'capability-test-task' },
  }), createdAt: now + 5 }))
  if (options.phase === 'quiescing') journal.push(teamPhase({ phase: 'quiescing', createdAt: now + 6 }))
  return { human, journal }
}

const input: TeamTaskCapabilitiesInput = { teamId, integration: true, readScopes: ['packages/team'],
  writeScopes: ['packages/team'] }

it.each(['json', 'sqlite'] as const)('projects an authorized task authoring choice after durable recovery (%s)', async (backend) => {
  const fixture = records({ granted: true })
  const ctx = await recover(backend, fixture.journal)
  const before = await ctx.teams.getTeam({ teamId })
  const result = await reader(ctx, fixture.human.id)(input)
  expect(result.create).toEqual({ allowed: true, reasons: [] })
  expect(result.workspaceModes).toEqual([
    { mode: 'shared', allowed: true, reasons: [] },
    ...(['worktree', 'sandbox', 'remote'] as const).map(mode => ({ mode, allowed: false, reasons: ['not-authorized'] })),
  ])
  expect(result.readScopes).toEqual({ editable: true, accepted: true })
  expect(result.writeScopes).toEqual({ editable: true, accepted: true })
  expect(result.teamCursor).toBe(before.team.cursor)
  expect(await ctx.teams.getTeam({ teamId })).toEqual(before)
  expect(JSON.stringify(result)).not.toContain('capability-principal')
})

it.each([
  { title: 'missing human grant', options: {}, reasons: ['not-authorized'] },
  { title: 'inactive Team', options: { granted: true, phase: 'quiescing' }, reasons: ['team-inactive'] },
  { title: 'Simulation ownership', options: { granted: true, simulation: true }, reasons: ['simulation-managed'] },
  { title: 'task capacity', options: { granted: true, task: true }, reasons: ['task-limit'] },
  { title: 'expired wall clock budget', options: { granted: true, ageMs: 10000 }, reasons: ['time-budget'] },
  { title: 'expired Team budget', options: { granted: true, ageMs: 10000, budgetWallTimeMs: 1000 }, reasons: ['time-budget'] },
] as const)('explains $title without disclosing the grant', async ({ options, reasons }) => {
  const fixture = records(options)
  const ctx = await recover('json', fixture.journal, undefined, teamId, [], fixture.journal.length - 1, [],
    options.task ? { maxTasksPerTeam: 1 } : 'budgetWallTimeMs' in options
      ? { maxWallTimeMsPerTeam: 60000 } : 'ageMs' in options ? { maxWallTimeMsPerTeam: 1000 } : {})
  const result = await reader(ctx, fixture.human.id)(input)
  expect(result.create.allowed).toBe(false)
  expect(result.create.reasons).toEqual(expect.arrayContaining([...reasons]))
  expect(JSON.stringify(result)).not.toContain('capability-principal')
})

it('requires the integration grant and rejects scopes beyond the human grant', async () => {
  const fixture = records({ granted: true })
  const ctx = await recover('json', fixture.journal)
  const read = reader(ctx, fixture.human.id)
  const beyond = await read({ ...input, readScopes: ['secret/private'], writeScopes: ['secret/private'] })
  expect(beyond.readScopes.accepted).toBe(false)
  expect(beyond.writeScopes.accepted).toBe(false)
  const noIntegration = await read({ ...input, integration: false })
  expect(noIntegration.create.allowed).toBe(true)
  const restricted = records({ granted: true, integrationGrant: false })
  const restrictedCtx = await recover('json', restricted.journal)
  const restrictedRead = reader(restrictedCtx, restricted.human.id)
  expect((await restrictedRead({ ...input, integration: false })).create.allowed).toBe(true)
  expect((await restrictedRead(input)).create.reasons).toContain('not-authorized')
})

it('enforces separate request and response byte limits for capability reads', async () => {
  const fixture = records({ granted: true })
  const requestCtx = await recover('json', fixture.journal, undefined, teamId, [], fixture.journal.length - 1, [],
    { maxSelectionBytes: 40 })
  await expect(reader(requestCtx, fixture.human.id)(input)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  const responseCtx = await recover('json', fixture.journal, undefined, teamId, [], fixture.journal.length - 1, [],
    { maxSelectionBytes: 120 })
  await expect(reader(responseCtx, fixture.human.id)({ teamId, integration: false, readScopes: [], writeScopes: [] }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
})

it.each(['json', 'sqlite'] as const)('checks exact durable member Session ownership for authenticated reads (%s)', async (backend) => {
  const fixture = records({ granted: true })
  const worker = participant({ id: 'session-worker', kind: 'local-agent', role: 'worker', phase: 'active' })
  const sessionId = SessionId('session-owner')
  const start = Date.now() + 10
  const journal = [...fixture.journal, ...(['invited', 'provisioning', 'active'] as const).map((phase, index) =>
    participantChanged({ participant: { ...worker, phase }, createdAt: start + index })), {
    type: 'activation/changed' as const,
    binding: { activation: { id: 'session-worker-activation' as never, teamId, participantId: worker.id,
      status: 'idle' as const }, sessionId, provider: 'in-process' }, createdAt: start + 3,
  }]
  const ctx = await recover(backend, journal)
  const scopes = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  ctx.teams.registerHumanActorProofSource({ name: 'session-reader', resolveHumanActorProof: proof => scopes.get(proof) })
  const check = async (participantId: typeof worker.id, selectedSession: typeof sessionId) => {
    const input = { teamId, participantId, sessionId: selectedSession }
    const actor = Object.freeze({}) as TeamHumanActorProof
    const bound = { teamId, operation: 'session-content-read' as const,
      fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
    scopes.set(actor, { teamId, participantId: fixture.human.id, operation: bound.operation, fence: bound.fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(bound) })
    try { await ctx.teams.assertHumanSessionRead({ ...input, actor }) }
    finally { scopes.delete(actor) }
  }
  const before = await ctx.teams.getTeam({ teamId })
  await expect(check(worker.id, sessionId)).resolves.toBeUndefined()
  await expect(check(worker.id, SessionId('another-session'))).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  await expect(check(fixture.human.id, sessionId)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect(await ctx.teams.getTeam({ teamId })).toEqual(before)
})
