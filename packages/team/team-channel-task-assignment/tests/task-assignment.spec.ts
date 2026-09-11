import { consentChannelEndpoints } from '../../../core/team/tests/channel-endpoint-consent.ts'
import { recordEnvelope } from '../../../core/team/tests/channel-envelope-record.ts'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import { SessionId } from '@clocky/clocky-session'
import {
  activationIdSchema,
  channelIdSchema,
  channelManifestSchema,
  participantIdSchema,
  taskAttemptIdSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamEnvelopeDraftSchema,
  teamEnvelopeSchema,
  teamIdSchema,
  teamTaskIdSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ChannelManifest,
  ChannelRecord,
  JsonValue,
  ParticipantId,
  ParticipantSnapshot,
  TeamEnvelope,
  TeamEnvelopeDraft,
  TeamId,
  TeamSystemEnvelopePostProof,
  TeamSystemEnvelopePostScope,
  TeamSystemActivationProof,
  TeamSystemActivationScope,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseScope,
  TeamTaskAssignInput,
  TeamTaskId,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import * as TaskAssignmentChannel from '../src/index.ts'
import {
  TASK_ASSIGNMENT_ASSIGNEE_ROLE,
  TASK_ASSIGNMENT_CHANNEL_ADAPTER,
  TASK_ASSIGNMENT_ENVELOPE_KIND,
  parseTaskAssignmentChannelManifest,
  parseTaskAssignmentEnvelope,
  taskAssignmentChannelAdapter,
} from '../src/task-assignment.ts'

const roots: string[] = []
const teamId = teamIdSchema.parse('team-task-assignment')
const channelId = channelIdSchema.parse('channel-task-assignment')
const taskId = teamTaskIdSchema.parse('task-task-assignment')
const assigneeId = participantIdSchema.parse('participant-assignee')
const otherId = participantIdSchema.parse('participant-other')
const activationId = activationIdSchema.parse('activation-task-assignment')
const attemptId = taskAttemptIdSchema.parse('attempt-task-assignment')
const sessionId = 'session-task-assignment'
const TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
const TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE = 'team-scheduler-dag'
type ControllerActivationBindScope = Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-bind' }>
type SchedulerTaskAssignScope = Extract<TeamSystemTaskLeaseScope, { readonly kind: 'scheduler-task-assign' }>
const activationProofStores = new WeakMap<Context, WeakMap<TeamSystemActivationProof, ControllerActivationBindScope>>()

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Build one schema-valid version-one assignment manifest with selected protocol variations. */
function assignmentManifest(overrides: Record<string, unknown> = {}): ChannelManifest {
  return channelManifestSchema.parse({
    id: channelId,
    teamId,
    adapter: TASK_ASSIGNMENT_CHANNEL_ADAPTER,
    participants: [{ id: assigneeId, role: TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
    limits: { taskId, activationId, sessionId },
    ...overrides,
  })
}

/** Build the exact one self-addressed assignment draft accepted by this adapter. */
function assignmentDraft(overrides: Record<string, unknown> = {}): TeamEnvelopeDraft {
  return teamEnvelopeDraftSchema.parse({
    channelId,
    audience: [assigneeId],
    kind: TASK_ASSIGNMENT_ENVELOPE_KIND,
    payload: { taskId, attemptId, assignedRevision: 2, activationId, sessionId },
    delivery: 'turn',
    taskId,
    ...overrides,
  })
}

/** Build one Hub-stamped assignment Envelope for pure parser and fold tests. */
function assignmentEnvelope(overrides: Record<string, unknown> = {}): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'envelope-task-assignment',
    teamId,
    channelId,
    sequence: 2,
    senderId: assigneeId,
    audience: [assigneeId],
    kind: TASK_ASSIGNMENT_ENVELOPE_KIND,
    payload: { taskId, attemptId, assignedRevision: 2, activationId, sessionId },
    delivery: 'turn',
    taskId,
    priority: 'normal',
    createdAt: 1,
    ...overrides,
  })
}

/** Invoke adapter validation with selected manifest, state, sender, and draft variations. */
function validateSend(
  draft: TeamEnvelopeDraft,
  options: {
    readonly manifest?: ChannelManifest
    readonly state?: JsonValue
    readonly senderId?: ParticipantId
  } = {},
): void {
  taskAssignmentChannelAdapter.validateSend({
    manifest: options.manifest ?? assignmentManifest(),
    state: options.state ?? taskAssignmentChannelAdapter.initialState(options.manifest ?? assignmentManifest()),
    senderId: options.senderId ?? assigneeId,
    draft,
  })
}

/** Compose a real JSON-backed Hub plus the task-assignment adapter provider. */
async function setup(root?: string) {
  const durableRoot = root ?? await freshRoot()
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: durableRoot })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    const postAuthority = schedulerEnvelopePostAuthority(ctx)
    const adapterFiber = await ctx.plugin(TaskAssignmentChannel)
    return { ctx, root: durableRoot, adapterFiber, postAuthority }
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
}

/** Create one nonserializable opaque scheduler post proof. */
function schedulerEnvelopePostProof(): TeamSystemEnvelopePostProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('scheduler post proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemEnvelopePostProof
}

/** Register a test-only scheduler source that retains its opaque post proofs. */
function schedulerEnvelopePostAuthority(ctx: Context): {
  issue(scope: TeamSystemEnvelopePostScope): TeamSystemEnvelopePostProof
} {
  const proofs = new WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
  ctx.teams.registerSystemEnvelopePostProofSource({
    name: TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE,
    resolveEnvelopePostProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = schedulerEnvelopePostProof()
      proofs.set(proof, scope)
      return proof
    },
  })
}

/** Persist one test-owned activation binding through a single-call controller proof. */
async function bindActivation(
  ctx: Context,
  input: { readonly expectedCursor: number; readonly binding: ActivationBindingSnapshot },
): Promise<ActivationBindingSnapshot> {
  let proofs = activationProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemActivationProof, ControllerActivationBindScope>()
    proofs = sourceProofs
    activationProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemActivationProofSource({
      name: TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE,
      resolveActivationProof: proof => sourceProofs.get(proof),
    })
  }
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test activation controller proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemActivationProof
  proofs.set(actor, { kind: 'activation-controller-bind', ...input })
  try {
    return await ctx.teams.bindActivation({ actor, ...input })
  } finally {
    proofs.delete(actor)
  }
}

/** Assign one test fixture lease through a one-shot canonical scheduler proof. */
async function assignSchedulerLease(ctx: Context, input: TeamTaskAssignInput) {
  const proofs = new WeakMap<TeamSystemTaskLeaseProof, SchedulerTaskAssignScope>()
  const unregister = ctx.teams.registerSystemTaskLeaseProofSource({
    name: TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE,
    resolveTaskLeaseProof: proof => proofs.get(proof),
  })
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test scheduler task-lease proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemTaskLeaseProof
  proofs.set(actor, { kind: 'scheduler-task-assign', ...input })
  try {
    return await ctx.teams.assignTask({ actor, ...input })
  } finally {
    proofs.delete(actor)
    unregister()
  }
}

/** Allocate one project-local persistent root for a real Hub composition. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-channel-task-assignment-'))
  roots.push(root)
  return root
}

/** Invite one local participant and progress it to active durable membership. */
async function activeParticipant(
  ctx: Context,
  id: TeamId,
  role = 'worker',
  displayName = 'Assignee',
): Promise<ParticipantSnapshot> {
  let state = await ctx.teams.getTeam({ teamId: id })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId: id,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName,
    role,
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId: id })
  await transitionBootstrapParticipant(ctx, {
    teamId: id,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: id })
  return await transitionBootstrapParticipant(ctx, {
    teamId: id,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
}

/** Create the durable task whose identifier a real assignment channel may reference. */
async function createTask(ctx: Context, id: TeamId) {
  const coordinator = await activeParticipant(ctx, id, 'coordinator', 'Coordinator')
  let state = await ctx.teams.getTeam({ teamId: id })
  const binding = await bindActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(`activation-task-assignment-coordinator-${id}`),
        teamId: id,
        participantId: coordinator.id,
        status: 'idle',
      },
      sessionId: SessionId(`session-task-assignment-coordinator-${id}`),
      provider: 'task-assignment-test',
    },
  })
  const actor = ctx.teams.openActivationActorProofIssuer().issue(binding).proof
  state = await ctx.teams.getTeam({ teamId: id })
  return await ctx.teams.createTask({
    actor,
    teamId: id,
    expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`task-assignment:${id}`) },
    subject: 'Run task work',
    description: 'Complete one assigned task.',
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
}

/** Create a real active Team, task, and single-assignee assignment channel. */
async function openedAssignmentChannel(ctx: Context) {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Assign one task', budgets: {} }, rules: {}, budgets: {} })
  const assignee = await activeParticipant(ctx, created.team.id)
  const task = await createTask(ctx, created.team.id)
  const state = await ctx.teams.getTeam({ teamId: created.team.id })
  const binding = await bindActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationId,
        teamId: created.team.id,
        participantId: assignee.id,
        status: 'idle',
      },
      sessionId: SessionId(sessionId),
      provider: 'task-assignment-test',
    },
  })
  const channelState = await ctx.teams.getTeam({ teamId: created.team.id })
  let channel = await openTestChannel(ctx, {
    teamId: created.team.id,
    expectedCursor: channelState.team.cursor,
    adapter: TASK_ASSIGNMENT_CHANNEL_ADAPTER,
    participants: [{ id: assignee.id, role: TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
    limits: { taskId: task.id, activationId, sessionId },
  })
  const actorLease = ctx.teams.openActivationActorProofIssuer().issue(binding)
  try {
    channel = await consentChannelEndpoints(ctx, channel, [{ participantId: assignee.id, actor: actorLease.proof }],
      (manifest) => { taskAssignmentChannelAdapter.validateCreate(manifest) })
  } finally { actorLease.revoke() }
  const assigned = await assignSchedulerLease(ctx, {
    teamId: created.team.id,
    taskId: task.id,
    expectedRevision: task.revision,
    participantId: assignee.id,
    activationId: binding.activation.id,
    wakeChannelId: channel.manifest.id,
    leaseDurationMs: 1_000,
  })
  return { assignee, task: assigned, channel, binding }
}

/** Build the sole scheduler-owned assignment admission scope for one assigned task. */
function assignmentScope(
  teamId: TeamId,
  channelId: ChannelManifest['id'],
  assigneeId: ParticipantId,
  task: TeamTaskSnapshot,
  binding: { readonly activation: { readonly id: typeof activationId }; readonly sessionId: SessionId },
): TeamSystemEnvelopePostScope {
  if (task.lease === undefined) throw new Error('assignment fixture must retain a current task lease')
  return {
    kind: 'scheduler-assignment',
    teamId,
    channelId,
    taskId: task.id,
    attemptId: task.lease.attemptId,
    assignedRevision: task.revision,
    assigneeId,
    activationId: binding.activation.id,
    sessionId: binding.sessionId,
  }
}

/** Build one exact scheduler assignment post from the current durable lease. */
function assignmentPostRequest(
  authority: { issue(scope: TeamSystemEnvelopePostScope): TeamSystemEnvelopePostProof },
  input: {
    readonly channel: ChannelManifest
    readonly assigneeId: ParticipantId
    readonly task: TeamTaskSnapshot
    readonly binding: { readonly activation: { readonly id: typeof activationId }; readonly sessionId: SessionId }
    readonly expectedCursor: number
  },
) {
  if (input.task.lease === undefined) throw new Error('assignment fixture must retain a current task lease')
  return {
    actor: authority.issue(assignmentScope(
      input.channel.teamId,
      input.channel.id,
      input.assigneeId,
      input.task,
      input.binding,
    )),
    expectedCursor: input.expectedCursor,
    draft: {
      channelId: input.channel.id,
      audience: [input.assigneeId],
      kind: TASK_ASSIGNMENT_ENVELOPE_KIND,
      payload: {
        taskId: input.task.id,
        attemptId: input.task.lease.attemptId,
        assignedRevision: input.task.revision,
        activationId: input.binding.activation.id,
        sessionId: input.binding.sessionId,
      },
      delivery: 'turn' as const,
      taskId: input.task.id,
    },
  }
}

/** Fold a valid read suffix from the adapter's immutable manifest state. */
function foldRecords(manifest: ChannelManifest, records: readonly ChannelRecord[]): JsonValue {
  let state = taskAssignmentChannelAdapter.initialState(manifest)
  for (const record of records) state = taskAssignmentChannelAdapter.fold(state, record)
  return state
}

describe('task-assignment channel adapter', () => {
  it('parses exactly one assignee, immutable task binding limits, and stable adapter constants', () => {
    const parsed = parseTaskAssignmentChannelManifest(assignmentManifest())
    expect(parsed).toEqual({ channelId, teamId, assigneeId, taskId, activationId, sessionId })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(TASK_ASSIGNMENT_CHANNEL_ADAPTER).toEqual({ type: 'task-assignment', version: 1 })

    expect(() => parseTaskAssignmentChannelManifest(assignmentManifest({ adapter: { type: 'direct', version: 1 } })))
      .toThrow(/does not select/)
    expect(() => parseTaskAssignmentChannelManifest(assignmentManifest({ adapter: { type: 'task-assignment', version: 2 } })))
      .toThrow(/does not select/)
    expect(() => parseTaskAssignmentChannelManifest(assignmentManifest({ participants: [] })))
      .toThrow(/exactly one/)
    expect(() => parseTaskAssignmentChannelManifest(assignmentManifest({
      participants: [{ id: assigneeId, role: 'dispatcher' }, { id: otherId, role: TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
    }))).toThrow(/exactly one/)
    expect(() => parseTaskAssignmentChannelManifest(assignmentManifest({
      participants: [{ id: assigneeId, role: 'worker' }],
    }))).toThrow(/assignee role/)
    expect(() => parseTaskAssignmentChannelManifest(assignmentManifest({ limits: {} }))).toThrow(/unsupported fields/)
    expect(() => parseTaskAssignmentChannelManifest(assignmentManifest({
      limits: { taskId, activationId, sessionId, extra: true },
    }))).toThrow(/unsupported fields/)
    expect(() => parseTaskAssignmentChannelManifest(assignmentManifest({
      limits: { taskId: '', activationId, sessionId },
    }))).toThrow(/taskId must be a nonempty string/)
  })

  it('accepts only the one self-addressed synthetic assignment turn', () => {
    expect(() => { validateSend(assignmentDraft()) }).not.toThrow()
    expect(() => { validateSend(assignmentDraft({ audience: null })) }).toThrow(/exactly its assignee/)
    expect(() => { validateSend(assignmentDraft({ audience: [] })) }).toThrow(/exactly its assignee/)
    expect(() => { validateSend(assignmentDraft({ audience: [otherId] })) }).toThrow(/exactly its assignee/)
    expect(() => { validateSend(assignmentDraft(), { senderId: otherId }) }).toThrow(/sender must be the assignee/)
    expect(() => { validateSend(assignmentDraft({ kind: 'message' })) }).toThrow(/only assignment/)
    expect(() => { validateSend(assignmentDraft({ delivery: 'context' })) }).toThrow(/delivery must be turn/)
    expect(() => { validateSend(assignmentDraft({ causationId: 'envelope-prior' })) }).toThrow(/cannot carry a causation/)
    expect(() => { validateSend(assignmentDraft({ taskId: teamTaskIdSchema.parse('other-task') })) }).toThrow(/taskId must match/)
    expect(() => {
      validateSend(assignmentDraft({
        payload: { taskId, attemptId, assignedRevision: 2, activationId, sessionId, extra: true },
      }))
    })
      .toThrow(/unsupported fields/)
    expect(() => { validateSend(assignmentDraft({ payload: { taskId, attemptId, assignedRevision: 2, activationId } })) })
      .toThrow(/unsupported fields/)
    expect(() => { validateSend(assignmentDraft({ payload: { taskId, attemptId: '', assignedRevision: 2, activationId, sessionId } })) })
      .toThrow(/attemptId must be a nonempty string/)
    expect(() => { validateSend(assignmentDraft({ payload: { taskId, attemptId, assignedRevision: 0, activationId, sessionId } })) })
      .toThrow(/assignedRevision must be a positive/)
    expect(() => { validateSend(assignmentDraft({ payload: {
      taskId,
      attemptId,
      assignedRevision: Number.MAX_SAFE_INTEGER + 1,
      activationId,
      sessionId,
    } })) }).toThrow(/assignedRevision must be a positive/)
    expect(() => { validateSend(assignmentDraft({ payload: {
      taskId: teamTaskIdSchema.parse('other-task'),
      attemptId,
      assignedRevision: 2,
      activationId,
      sessionId,
    } })) }).toThrow(/payload must match/)
    expect(() => { validateSend(assignmentDraft({ payload: {
      taskId,
      attemptId,
      assignedRevision: 2,
      activationId: activationIdSchema.parse('other-activation'),
      sessionId: 'other-session',
    } })) }).toThrow(/payload must match/)
  })

  it('keeps immutable state, derives exactly one delivery, and validates recovery projections', () => {
    const manifest = assignmentManifest()
    const envelope = assignmentEnvelope()
    const opened = { type: 'channel/opened', sequence: 0, createdAt: 1, manifest } satisfies ChannelRecord
    const active = { type: 'channel/phase', sequence: 1, createdAt: 1, phase: 'active' } satisfies ChannelRecord
    const record = recordEnvelope(envelope) satisfies ChannelRecord
    const initial = taskAssignmentChannelAdapter.initialState(manifest)
    expect(initial).toEqual({ taskId, activationId, sessionId, assigneeId })
    expect(Object.isFrozen(initial)).toBe(true)
    expect(taskAssignmentChannelAdapter.expectedNext({ manifest, state: initial }))
      .toEqual({ kind: 'participant', participantId: assigneeId })
    expect(Object.isFrozen(taskAssignmentChannelAdapter.expectedNext({ manifest, state: initial }))).toBe(true)
    expect(taskAssignmentChannelAdapter.fold(initial, opened)).toBe(initial)
    expect(taskAssignmentChannelAdapter.fold(initial, active)).toBe(initial)

    const accepted = taskAssignmentChannelAdapter.fold(initial, record)
    expect(accepted).toEqual({
      taskId,
      activationId,
      sessionId,
      assigneeId,
      envelopeId: envelope.id,
      attemptId,
      assignedRevision: 2,
    })
    expect(Object.isFrozen(accepted)).toBe(true)
    expect(taskAssignmentChannelAdapter.afterAccept({ manifest, state: accepted, record })).toEqual([])
    expect(taskAssignmentChannelAdapter.expectedNext({ manifest, state: accepted })).toEqual({ kind: 'none' })
    const plan = taskAssignmentChannelAdapter.deliveryPlan({ manifest, state: accepted, envelope })
    expect(plan).toEqual([{ participantId: assigneeId, envelopeId: envelope.id, delivery: 'turn' }])
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan[0])).toBe(true)
    expect(taskAssignmentChannelAdapter.projectView({ manifest, state: accepted, records: [opened, active, record] })).toEqual({
      assigneeId,
      taskId,
      activationId,
      sessionId,
      envelopeId: envelope.id,
      attemptId,
      assignedRevision: 2,
    })
    expect(Object.isFrozen(taskAssignmentChannelAdapter.projectView({ manifest, state: initial, records: [] }))).toBe(true)

    expect(() => { validateSend(assignmentDraft(), { manifest, state: accepted }) }).toThrow(/already accepted/)
    expect(() => { taskAssignmentChannelAdapter.fold(accepted, record) }).toThrow(/cannot retain more than one/)
    expect(() => { taskAssignmentChannelAdapter.fold(initial, {
      type: 'channel/adapter',
      sequence: 3,
      createdAt: 1,
      adapter: TASK_ASSIGNMENT_CHANNEL_ADAPTER,
      payload: {},
    }) }).toThrow(/does not accept adapter-owned/)
    expect(() => { taskAssignmentChannelAdapter.afterAccept({ manifest, state: initial, record }) }).toThrow(/must retain/)
    expect(() => { taskAssignmentChannelAdapter.deliveryPlan({
      manifest,
      state: accepted,
      envelope: assignmentEnvelope({ id: 'other-envelope' }),
    }) }).toThrow(/requires the accepted/)
    expect(() => { taskAssignmentChannelAdapter.projectView({ manifest, state: initial, records: [record] }) })
      .toThrow(/missing its accepted/)
    expect(() => { taskAssignmentChannelAdapter.projectView({ manifest, state: accepted, records: [] }) })
      .toThrow(/retains an absent/)
    expect(() => {
      taskAssignmentChannelAdapter.projectView({
        manifest,
        state: {
          taskId,
          activationId,
          sessionId,
          assigneeId,
          envelopeId: envelope.id,
          attemptId: taskAttemptIdSchema.parse('attempt-mismatch'),
          assignedRevision: 2,
        },
        records: [record],
      })
    }).toThrow(/does not match its accepted/)
    expect(() => { taskAssignmentChannelAdapter.projectView({ manifest, state: accepted, records: [record, record] }) })
      .toThrow(/cannot contain more/)
  })

  it('rejects malformed or manifest-mismatched fold state through every stateful operation', () => {
    const manifest = assignmentManifest()
    const envelope = assignmentEnvelope()
    const record = recordEnvelope(envelope) satisfies ChannelRecord
    const invalid: JsonValue = []
    const mismatched: JsonValue = { taskId, activationId, sessionId, assigneeId: otherId }
    const partialAssignment: JsonValue = { taskId, activationId, sessionId, assigneeId, envelopeId: envelope.id }

    expect(() => { validateSend(assignmentDraft(), { manifest, state: invalid }) }).toThrow(/state must be an object/)
    expect(() => { taskAssignmentChannelAdapter.fold(invalid, record) }).toThrow(/state must be an object/)
    expect(() => { taskAssignmentChannelAdapter.afterAccept({ manifest, state: invalid, record }) }).toThrow(/state must be an object/)
    expect(() => { taskAssignmentChannelAdapter.expectedNext({ manifest, state: invalid }) }).toThrow(/state must be an object/)
    expect(() => { taskAssignmentChannelAdapter.deliveryPlan({ manifest, state: invalid, envelope }) }).toThrow(/state must be an object/)
    expect(() => { taskAssignmentChannelAdapter.projectView({ manifest, state: invalid, records: [] }) }).toThrow(/state must be an object/)
    expect(() => { validateSend(assignmentDraft(), { manifest, state: mismatched }) }).toThrow(/does not match/)
    expect(() => { taskAssignmentChannelAdapter.expectedNext({ manifest, state: partialAssignment }) })
      .toThrow(/unsupported fields/)
  })

  it('exports a narrow envelope parser that rejects cross-channel or invalid durable assignment data', () => {
    const manifest = assignmentManifest()
    const envelope = assignmentEnvelope()
    expect(parseTaskAssignmentEnvelope(manifest, envelope)).toEqual({
      envelopeId: envelope.id,
      channelId,
      teamId,
      assigneeId,
      taskId,
      attemptId,
      assignedRevision: 2,
      activationId,
      sessionId,
    })
    expect(Object.isFrozen(parseTaskAssignmentEnvelope(manifest, envelope))).toBe(true)
    expect(() => { parseTaskAssignmentEnvelope(manifest, assignmentEnvelope({ channelId: channelIdSchema.parse('other-channel') })) })
      .toThrow(/does not belong/)
    expect(() => { parseTaskAssignmentEnvelope(manifest, assignmentEnvelope({ teamId: teamIdSchema.parse('other-team') })) })
      .toThrow(/does not belong/)
    expect(() => { parseTaskAssignmentEnvelope(manifest, assignmentEnvelope({ payload: {
      taskId,
      attemptId,
      assignedRevision: '2',
      activationId,
      sessionId,
    } })) }).toThrow(/assignedRevision must be a positive/)
  })
})

describe('task-assignment channel plugin composition', () => {
  it('registers version one on TeamRuntime and removes it with the contributing fiber', async () => {
    const harness = await setup()
    expect(harness.ctx.teams.listAdapters()).toEqual([TASK_ASSIGNMENT_CHANNEL_ADAPTER])
    await harness.adapterFiber.dispose()
    expect(() => { harness.ctx.teams.getAdapter(TASK_ASSIGNMENT_CHANNEL_ADAPTER) }).toThrow(/not registered/)
    await harness.ctx.fiber.dispose()
  })

  it('persists and recovers exactly one self-addressed assignment delivery', async () => {
    const harness = await setup()
    const root = harness.root
    let channelIdForRecovery: ChannelManifest['id'] | undefined
    let taskIdForRecovery: TeamTaskId | undefined
    let assigneeIdForRecovery: ParticipantId | undefined
    try {
      const { assignee, task, channel, binding } = await openedAssignmentChannel(harness.ctx)
      const envelope = await harness.ctx.teams.postChannelEnvelope(assignmentPostRequest(harness.postAuthority, {
        channel: channel.manifest,
        assigneeId: assignee.id,
        task,
        binding,
        expectedCursor: channel.cursor,
      }))
      const read = await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      const state = foldRecords(channel.manifest, read.records)
      expect(read.records.map(record => record.type)).toEqual(['channel/opened', 'channel/phase', 'channel/invitation',
        'channel/acknowledged', 'channel/phase', 'channel/envelope'])
      expect(taskAssignmentChannelAdapter.deliveryPlan({ manifest: channel.manifest, state, envelope }))
        .toEqual([{ participantId: assignee.id, envelopeId: envelope.id, delivery: 'turn' }])
      expect(() => { taskAssignmentChannelAdapter.projectView({ manifest: channel.manifest, state, records: read.records }) })
        .not.toThrow()
      const directActor = harness.ctx.teams.openActivationActorProofIssuer().issue(binding).proof
      await expect(harness.ctx.teams.postChannelEnvelope({
        ...assignmentPostRequest(harness.postAuthority, {
          channel: channel.manifest,
          assigneeId: assignee.id,
          task,
          binding,
          expectedCursor: envelope.sequence,
        }),
        actor: directActor,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await expect(harness.ctx.teams.postChannelEnvelope(assignmentPostRequest(harness.postAuthority, {
        channel: channel.manifest,
        assigneeId: assignee.id,
        task,
        binding,
        expectedCursor: envelope.sequence,
      }))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ADAPTER_REJECTED' })
      channelIdForRecovery = channel.manifest.id
      taskIdForRecovery = task.id
      assigneeIdForRecovery = assignee.id
    } finally {
      await harness.ctx.fiber.dispose()
    }

    if (channelIdForRecovery === undefined || taskIdForRecovery === undefined || assigneeIdForRecovery === undefined) {
      throw new Error('recovery fixture must persist assignment facts')
    }
    const recovered = await setup(root)
    try {
      const channel = await recovered.ctx.teams.getChannel({ channelId: channelIdForRecovery })
      const task = await recovered.ctx.teams.getTask({ teamId: channel.manifest.teamId, taskId: taskIdForRecovery })
      const binding = await recovered.ctx.teams.getActivation({ teamId: channel.manifest.teamId, activationId })
      await expect(recovered.ctx.teams.postChannelEnvelope(assignmentPostRequest(recovered.postAuthority, {
        channel: channel.manifest,
        assigneeId: assigneeIdForRecovery,
        task,
        binding,
        expectedCursor: channel.cursor,
      }))).rejects.toMatchObject({ code: 'TEAM_CHANNEL_ADAPTER_REJECTED' })
    } finally {
      await recovered.ctx.fiber.dispose()
    }
  })
})
