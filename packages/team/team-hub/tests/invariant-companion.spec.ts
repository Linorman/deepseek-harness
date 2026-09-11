import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import InvariantRegistry, { InvariantError } from '@clocky/clocky-invariants'
import Storage from '@clocky/clocky-storage'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { activationIdSchema, channelEventSchema, channelInvitationIdempotencyKeySchema, channelIdSchema, fingerprintChannelManifest, teamEventSchema, teamIdSchema, teamInterruptIdSchema } from '@clocky/clocky-team'
import type {
  ParticipantSnapshot,
  TeamChannelAdapter,
  TeamId,
  TeamSystemInterruptProof,
  TeamSystemInterruptScope,
  TeamSystemChannelAdmissionProof,
  TeamSystemChannelAdmissionScope,
} from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import TeamHub from '../src/index.ts'
import * as TeamHubInvariant from '../src/invariant.ts'
import { bindTestActivation, createTestCoordinatorTask, postActor, provisionTestCoordinator } from './fixtures.ts'

const roots: string[] = []
const channelAdmissionProofs = new WeakMap<Context, WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>>()

/** Issue one system-owned human endpoint proof for this invariant fixture. */
function systemHumanAdmissionActor(ctx: Context, scope: TeamSystemChannelAdmissionScope): TeamSystemChannelAdmissionProof {
  let proofs = channelAdmissionProofs.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>()
    proofs = sourceProofs
    channelAdmissionProofs.set(ctx, sourceProofs)
    ctx.teams.registerSystemChannelAdmissionProofSource({ name: 'team-run', resolveChannelAdmissionProof: proof => sourceProofs.get(proof) })
  }
  const proof = Object.freeze({}) as TeamSystemChannelAdmissionProof
  proofs.set(proof, scope)
  return proof
}

const taskCreateDefaults = {
  requiredCapabilities: [],
  priority: 0,
  readScopes: [],
  workspaceMode: 'shared' as const,
  budget: {},
  reviewPolicy: { kind: 'none' as const },
  maxAttempts: 3,
}

const taskSnapshotDefaults = {
  ...taskCreateDefaults,
  reviewHistory: [],
  attemptCount: 0,
  attemptHistory: [],
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const directAdapter: TeamChannelAdapter = {
  type: 'direct',
  version: 1,
  validateCreate() {},
  initialState() { return { opened: true } },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan() { return [] },
  projectView() { return {} },
}

const directV3Adapter: TeamChannelAdapter = { ...directAdapter, version: 3 }

/** Invite and activate one participant for an exact TeamRun interrupt topology. */
async function activeParticipant(
  ctx: Context,
  teamId: TeamId,
  kind: ParticipantSnapshot['kind'],
  role: string,
  displayName: string,
): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind,
    role,
    displayName,
    capabilities: [],
    ...kind === 'human' ? { owner: { kind: 'system' as const } } : {},
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
}

/** Create one opaque proof owned only by a test-local TeamRun source. */
function interruptProof(): TeamSystemInterruptProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team-run interrupt proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemInterruptProof
}

/** Register exact TeamRun human-to-coordinator interrupt proofs for this test context. */
function teamRunInterruptAuthority(ctx: Context): {
  issue(scope: TeamSystemInterruptScope): TeamSystemInterruptProof
} {
  const proofs = new WeakMap<TeamSystemInterruptProof, TeamSystemInterruptScope>()
  ctx.teams.registerSystemInterruptProofSource({
    name: 'team-run',
    resolveInterruptProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = interruptProof()
      proofs.set(proof, scope)
      return proof
    },
  })
}

/** Compose the provider under the invariant registry with local durable storage. */
async function setup(): Promise<Context> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-hub-invariant-companion-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(TeamHubInvariant)
  await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend: 'sqlite', routes: {} })
  await ctx.plugin(TeamHub)
  ctx.teams.registerAdapter(directAdapter)
  ctx.teams.registerAdapter({ ...directV3Adapter, version: 4 })
  return ctx
}

const violation: unknown = expect.objectContaining<Partial<InvariantError>>({
  code: 'INVARIANT',
  packageName: '@clocky/clocky-team-hub',
})

describe('Team-Hub invariant companion', () => {
  it('accepts each committed Team and channel notification family when the Hub has the projection', async () => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, {
      goal: { objective: 'Review the change', budgets: {} },
      rules: { mode: 'local' },
      budgets: { tokens: 50 },
    })
    const invited = await inviteBootstrapParticipant(ctx, {
      teamId: created.team.id,
      expectedCursor: created.team.cursor,
      kind: 'local-agent',
      displayName: 'Reviewer',
      role: 'reviewer',
      capabilities: [],
    })
    let current = await ctx.teams.getTeam({ teamId: created.team.id })
    await transitionBootstrapParticipant(ctx, {
      teamId: current.team.id,
      participantId: invited.id,
      expectedCursor: current.team.cursor,
      phase: 'provisioning',
    })
    await provisionTestCoordinator(ctx, created.team.id)
    current = await ctx.teams.getTeam({ teamId: created.team.id })
    const active = await transitionBootstrapParticipant(ctx, {
      teamId: current.team.id,
      participantId: invited.id,
      expectedCursor: current.team.cursor,
      phase: 'active',
    })
    current = await ctx.teams.getTeam({ teamId: created.team.id })

    const binding = await bindTestActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('activation-a'),
          teamId: current.team.id,
          participantId: active.id,
          status: 'running',
        },
        sessionId: SessionId('activation-session'),
        provider: 'sdk',
        recovery: {
          kind: 'sdk-local-cold-replace',
          version: 1,
          runtimeProvider: 'sdk',
          profile: 'local-sdk-v1',
          agent: { provider: 'mock', model: 'mock', maxTokens: 32 },
          process: { hostId: 'host-a', pid: 42, started: 'start-a', processGroupId: 42 },
        },
      },
    })
    const goalLease = ctx.teams.openActivationActorProofIssuer().issue(binding)
    await expect(ctx.teams.updateTeamGoal({
      teamId: created.team.id,
      actor: {
        teamId: binding.activation.teamId,
        participantId: binding.activation.participantId,
        activationId: binding.activation.id,
        sessionId: binding.sessionId,
        provider: binding.provider,
      } as never,
      expectedRevision: created.goal.revision,
      objective: 'Raw activation identity must not mutate this Team goal.',
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.getTeam({ teamId: created.team.id })).resolves.toMatchObject({
      goal: { revision: created.goal.revision, objective: created.goal.objective },
    })
    await ctx.teams.updateTeamGoal({
      teamId: created.team.id,
      actor: goalLease.proof,
      expectedRevision: created.goal.revision,
      objective: 'Review the durable projection.',
    })
    goalLease.revoke()
    current = await ctx.teams.getTeam({ teamId: created.team.id })
    const task = await createTestCoordinatorTask(ctx, {
      teamId: current.team.id,
      expectedCursor: current.team.cursor,
      subject: 'Inspect',
      description: 'Check the durable projection.',
      blockedBy: [],
      writeScopes: [],
      ...taskCreateDefaults,
    })
    current = await ctx.teams.getTeam({ teamId: created.team.id })
    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed',
      binding,
      cursor: current.team.cursor,
      createdAt: current.team.updatedAt,
    })) }).not.toThrow()
    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed',
      binding: {
        ...binding,
        provider: 'other-provider',
        recovery: { ...binding.recovery!, runtimeProvider: 'other-provider' },
      },
      cursor: current.team.cursor,
      createdAt: current.team.updatedAt,
    })) }).toThrow(violation)
    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed',
      binding: { ...binding, recovery: { ...binding.recovery!, profile: 'other-sdk-v1' } },
      cursor: current.team.cursor,
      createdAt: current.team.updatedAt,
    })) }).toThrow(violation)
    expect(task.teamId).toBe(current.team.id)

    const human = await activeParticipant(ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    current = await ctx.teams.getTeam({ teamId: created.team.id })
    const opened = await openTestChannel(ctx, {
      teamId: current.team.id,
      expectedCursor: current.team.cursor,
      adapter: { type: directV3Adapter.type, version: 4 },
      participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }],
      limits: {},
    })
    current = await ctx.teams.getTeam({ teamId: created.team.id })
    await bindTestActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('interrupt-coordinator-activation'),
          teamId: current.team.id,
          participantId: coordinator.id,
          status: 'idle',
        },
        sessionId: SessionId('interrupt-coordinator-session'),
        provider: 'in-process',
      },
    })
    await acknowledgeTestChannelActivations(ctx, opened.manifest.id)
    const admission = await ctx.teams.getChannelAdmission({ channelId: opened.manifest.id })
    const invitation = admission.invitations.find(item => item.participantId === human.id)
    if (invitation === undefined) throw new Error('invariant interrupt fixture has no human invitation')
    const idempotencyKey = channelInvitationIdempotencyKeySchema.parse('invariant-human-consent')
    await ctx.teams.acknowledgeChannelInvitation({
      actor: systemHumanAdmissionActor(ctx, {
        kind: 'channel-invitation-acknowledge', teamId: opened.manifest.teamId, channelId: opened.manifest.id,
        participantId: human.id, revision: invitation.revision,
        manifestFingerprint: fingerprintChannelManifest(opened.manifest), idempotencyKey,
      }),
      channelId: opened.manifest.id, revision: invitation.revision,
      manifestFingerprint: fingerprintChannelManifest(opened.manifest), idempotencyKey,
    })
    const channel = await ctx.teams.getChannel({ channelId: opened.manifest.id })
    current = await ctx.teams.getTeam({ teamId: created.team.id })
    const authority = teamRunInterruptAuthority(ctx)
    const interrupt = await ctx.teams.requestParticipantInterrupt({
      teamId: current.team.id,
      expectedCursor: current.team.cursor,
      actor: authority.issue({
        kind: 'team-run-human-interrupt',
        teamId: current.team.id,
        channelId: channel.manifest.id,
        humanId: human.id,
        coordinatorId: coordinator.id,
      }),
    })
    const hub = ctx.teams as TeamHub
    expect(hub.inspectLoadedParticipantInterrupt(teamIdSchema.parse('missing-team'), interrupt.id)).toBeUndefined()
    expect(hub.inspectLoadedParticipantInterrupt(current.team.id, teamInterruptIdSchema.parse('missing-interrupt'))).toBeUndefined()
    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'participant-interrupt/changed',
      interrupt: { ...interrupt, id: teamInterruptIdSchema.parse('missing-interrupt') },
      cursor: current.team.cursor,
      createdAt: current.team.updatedAt,
    })) }).toThrow(violation)

    current = await ctx.teams.getTeam({ teamId: created.team.id })
    await postActor(ctx, created.team.id, active.id)
    current = await ctx.teams.getTeam({ teamId: created.team.id })
    const openedReviewer = await openTestChannel(ctx, {
      teamId: current.team.id,
      expectedCursor: current.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: active.id, role: 'reviewer' }],
      limits: {},
    })
    await expect(acknowledgeTestChannelActivations(ctx, openedReviewer.manifest.id)).resolves.toMatchObject({ phase: 'active' })
    await ctx.fiber.dispose()
  })

  it('rejects post-commit notifications that disagree with a loaded projection', async () => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Review the change', budgets: {} }, rules: {}, budgets: {} })
    const hub = ctx.teams as TeamHub
    const current = hub.inspectLoadedTeam(created.team.id)
    if (current === undefined) throw new Error('Team Hub did not load its created Team')

    const wrongId = teamIdSchema.parse('other-team')
    const identity = vi.spyOn(hub, 'inspectLoadedTeam').mockReturnValue({
      ...current,
      team: { ...current.team, id: wrongId },
    })
    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({ type: 'team/changed', team: created.team })) }).toThrow(violation)
    identity.mockRestore()

    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'team/changed',
      team: { ...created.team, cursor: created.team.cursor + 1 },
    })) }).toThrow(violation)
    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'goal/changed',
      goal: { ...created.goal, revision: created.goal.revision + 1 },
      cursor: created.team.cursor + 1,
      createdAt: created.team.updatedAt + 1,
    })) }).toThrow(violation)
    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'participant/changed',
      participant: {
        id: 'absent-participant',
        teamId: created.team.id,
        kind: 'local-agent',
        displayName: 'Absent',
        role: 'reviewer',
        capabilities: [],
        phase: 'active',
      },
      cursor: created.team.cursor,
      createdAt: created.team.updatedAt,
    })) }).toThrow(violation)
    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'task/changed',
      task: {
        id: 'absent-task',
        teamId: created.team.id,
        revision: 1,
        execution: { kind: 'participant' },
        createCommand: {
          creator: {
            teamId: created.team.id,
            participantId: 'absent-participant',
            activationId: 'absent-task-creator',
            sessionId: 'absent-task-session',
            provider: 'in-process',
          },
          idempotencyKey: 'absent-task-create',
        },
        subject: 'Absent',
        description: 'This task was not committed.',
        phase: 'pending',
        blockedBy: [],
        writeScopes: [],
        ...taskSnapshotDefaults,
      },
      cursor: created.team.cursor,
      createdAt: created.team.updatedAt,
    })) }).toThrow(violation)
    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'activation/changed',
      binding: {
        activation: {
          id: activationIdSchema.parse('absent-activation'),
          teamId: created.team.id,
          participantId: 'absent-participant',
          status: 'idle',
        },
        sessionId: SessionId('absent-session'),
        provider: 'in-process',
      },
      cursor: created.team.cursor,
      createdAt: created.team.updatedAt,
    })) }).toThrow(violation)

    const participant = await activeParticipant(ctx, created.team.id, 'local-agent', 'reviewer', 'Channel reviewer')
    await postActor(ctx, created.team.id, participant.id)
    const channelOpened = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: participant.id, role: 'reviewer' }],
      limits: {},
    })
    const channel = await acknowledgeTestChannelActivations(ctx, channelOpened.manifest.id)
    const channelIdentity = vi.spyOn(hub, 'inspectLoadedChannel').mockReturnValue({
      ...channel,
      manifest: { ...channel.manifest, id: channelIdSchema.parse('other-channel') },
    })
    expect(() => { ctx.emit('channel/changed', channelEventSchema.parse({
      channelId: channel.manifest.id,
      record: {
        type: 'channel/opened',
        sequence: 0,
        createdAt: created.team.updatedAt,
        manifest: channel.manifest,
      },
    })) }).toThrow(violation)
    channelIdentity.mockRestore()
    await ctx.fiber.dispose()
  })

  it('rejects resource and audit publications that precede their authoritative Team facts', async () => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Publish only committed work.', budgets: {} }, rules: {}, budgets: {} })
    const teamId = created.team.id
    const createdAt = created.team.updatedAt
    const pending = [
      { type: 'workspace-allocation/changed', allocation: { id: 'uncommitted-allocation', teamId, revision: 1,
        taskId: 'task-1', attemptId: 'attempt-1', assignedRevision: 1, participantId: 'worker-1', activationId: 'activation-1',
        sessionId: 'session-1', provider: 'shared', mode: 'shared', lifecycle: 'reserved', reservedAt: createdAt, updatedAt: createdAt },
      cursor: created.team.cursor, createdAt },
      { type: 'human-action/changed', action: { id: 'uncommitted-action', teamId, kind: 'question', phase: 'pending',
        participantId: 'worker-1', sessionId: 'session-1', sourceId: 'question-1', details: { question: 'Continue?' },
        createdAt, updatedAt: createdAt }, cursor: created.team.cursor, createdAt },
      { type: 'usage/changed', teamId, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
        turns: 1, costUnits: 0, updatedAt: createdAt }, cursor: created.team.cursor, createdAt },
      { type: 'workflow-plan/changed', plan: { id: 'uncommitted-plan', teamId, revision: 1, idempotencyKey: 'plan-1',
        phase: 'compiling', taskBindings: [], plan: { version: 1, name: 'Review',
          tasks: [{ id: 'review', subject: 'Review', description: 'Review the result.', blockedBy: [], requiredCapabilities: [],
            priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 }],
          bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
          channel: { participantRoles: ['coordinator', 'worker'], graph: { initial: { kind: 'participant', role: 'coordinator' },
            transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
          result: { kind: 'task-results', taskTemplateIds: ['review'] },
        } }, cursor: created.team.cursor, createdAt },
      { type: 'policy/denied', teamId, hook: 'close', code: 'REVIEW_REQUIRED', message: 'Review is required.',
        cursor: created.team.cursor + 1, createdAt },
    ]
    try {
      for (const candidate of pending) {
        const event = teamEventSchema.parse(candidate)
        expect(() => { ctx.emit('team/changed', event) }, candidate.type).toThrow(violation)
      }
      expect((ctx.teams as TeamHub).inspectLoadedTeam(teamId)).toEqual(created)
    } finally { await ctx.fiber.dispose() }
  })

  it('ignores raw notifications when no Team Hub provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(TeamHubInvariant)

    expect(() => { ctx.emit('team/changed', teamEventSchema.parse({
      type: 'team/changed',
      team: {
        id: 'unowned-team',
        depth: 0,
        maxTeamDepth: 0,
        goal: {
          teamId: 'unowned-team',
          revision: 1,
          objective: 'No provider is mounted.',
          phase: 'active',
          budgets: {},
        },
        phase: 'active',
        cursor: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    })) }).not.toThrow()
    await ctx.fiber.dispose()
  })
})
