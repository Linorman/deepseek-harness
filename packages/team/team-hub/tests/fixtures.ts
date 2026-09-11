import {
  activationIdSchema,
  channelManifestSchema,
  channelRecordSchema,
  participantIdSchema,
  participantSnapshotSchema,
  taskAttemptIdSchema,
  taskAttemptSnapshotSchema,
  taskLeaseSnapshotSchema,
  teamIdSchema,
  teamGoalSnapshotSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamTaskIdSchema,
  teamTaskSnapshotSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindInput,
  ActivationBindingSnapshot,
  ActivationFenceInput,
  ActivationQuiesceInput,
  ActivationStatusUpdateInput,
  ChannelManifest,
  ChannelRecord,
  ParticipantId,
  ParticipantSnapshot,
  TeamSystemActivationProof,
  TeamSystemActivationProofSource,
  TeamSystemActivationScope,
  TeamSystemHumanActionProof,
  TeamSystemHumanActionProofSource,
  TeamSystemHumanActionScope,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseProofSource,
  TeamSystemTaskLeaseScope,
  TeamPhase,
  TeamStallReason,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
  TeamActorProof,
  TeamId,
  TeamStateSnapshot,
  TeamTaskAssignInput,
  TeamTaskAttemptExpireInput,
  TeamTaskCreateCommandInput,
  TeamTaskCreateInput,
  TeamTaskDeleteInput,
  TeamTaskDetailsUpdateInput,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import type { Context } from '@clocky/cordis'
import { SessionId } from '@clocky/clocky-session'
import { inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { teamJournalRecordSchema } from '../src/schema.ts'
import type { TeamJournalRecord } from '../src/types.ts'

interface TestTeamPhaseInternals {
  readonly teams: ReadonlyMap<TeamId, {
    readonly queue: { run<T>(operation: () => Promise<T>): Promise<T> }
    readonly projection: { readonly team: { readonly updatedAt: number } }
  }>
  commitTeamCommand(
    loaded: unknown,
    records: readonly TeamJournalRecord[],
    code: 'TEAM_INVALID_ARGUMENT',
  ): Promise<void>
}

/** Test-local retention for exact controller-shaped activation proof scopes. */
interface TestActivationAuthority {
  readonly proofs: Map<TeamSystemActivationProof, TeamSystemActivationScope>
}

/** Test-local retention for exact Host human-action proof scopes. */
interface TestHumanActionAuthority {
  readonly proofs: Map<TeamSystemHumanActionProof, TeamSystemHumanActionScope>
}

/** Test-local retention for exact scheduler task-lease proof scopes. */
interface TestTaskLeaseAuthority {
  readonly proofs: Map<TeamSystemTaskLeaseProof, TeamSystemTaskLeaseScope>
}

const testActivationAuthorities = new WeakMap<Context, TestActivationAuthority>()
const testHumanActionAuthorities = new WeakMap<Context, TestHumanActionAuthority>()
const testTaskLeaseAuthorities = new WeakMap<Context, TestTaskLeaseAuthority>()
const testCoordinatorTaskSequences = new WeakMap<Context, number>()

export const teamId = teamIdSchema.parse('team-a')
export const otherTeamId = teamIdSchema.parse('team-b')
export const participantId = participantIdSchema.parse('participant-a')
export const otherParticipantId = participantIdSchema.parse('participant-b')
export const taskId = teamTaskIdSchema.parse('task-a')
export const otherTaskId = teamTaskIdSchema.parse('task-b')
export const taskCreatorId = participantIdSchema.parse('participant-task-creator')
export const taskCreatorActivationId = activationIdSchema.parse('activation-task-creator')
export const taskCreatorSessionId = SessionId('session-task-creator')

/**
 * Seed a lifecycle projection through the Hub's private journal append for a
 * read or recovery fixture that requires a non-active durable Team.
 * @param ctx - Hub context whose loaded Team projection receives the fixture record.
 * @param id - Durable Team selected for the phase fixture.
 * @param phase - Lifecycle phase appended directly to the test journal.
 * @param reason - Required durable explanation for a stalled fixture.
 * @returns the Team state after the fixture record commits.
 */
export async function seedTeamPhase(
  ctx: Context,
  id: TeamId,
  phase: TeamPhase,
  reason?: TeamStallReason,
): Promise<TeamStateSnapshot> {
  const hub = ctx.teams as unknown as TestTeamPhaseInternals
  const loaded = hub.teams.get(id)
  if (loaded === undefined) throw new Error(`Team Hub did not retain Team '${id}'`)
  await loaded.queue.run(async () => {
    const createdAt = Math.max(Date.now(), loaded.projection.team.updatedAt + 1)
    await hub.commitTeamCommand(loaded, [{
      type: 'team/phase',
      phase,
      ...reason === undefined ? {} : { reason },
      createdAt,
    }], 'TEAM_INVALID_ARGUMENT')
  })
  return await ctx.teams.getTeam({ teamId: id })
}

/**
 * Issue an ordinary-post proof for one current local or remote participant.
 * The helper reuses an existing deliverable binding so tests that separately
 * exercise activation lifecycle commands retain their selected epoch.
 */
export async function postActor(
  ctx: Context,
  teamId: TeamId,
  participantId: ParticipantId,
): Promise<TeamActorProof> {
  const state = await ctx.teams.getTeam({ teamId })
  const existing = state.activations.find(binding => (
    binding.activation.participantId === participantId
    && (binding.activation.status === 'idle' || binding.activation.status === 'running')
  ))
  const binding = existing ?? await bindPostActivation(ctx, state, participantId)
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}

/** Bind one activation through a test-local controller-shaped proof source. */
export async function bindTestActivation(
  ctx: Context,
  input: ActivationBindInput,
): Promise<ActivationBindingSnapshot> {
  return await withTestActivationProof(ctx, {
    kind: 'activation-controller-bind',
    expectedCursor: input.expectedCursor,
    binding: input.binding,
  }, async actor => await ctx.teams.bindActivation({ actor, ...input }))
}

/** Persist one activation status through a test-local controller-shaped proof source. */
export async function updateTestActivationStatus(
  ctx: Context,
  input: ActivationStatusUpdateInput,
): Promise<ActivationBindingSnapshot> {
  const scope = await testActivationStatusScope(ctx, input)
  return await withTestActivationProof(ctx, scope, async actor => await ctx.teams.updateActivationStatus({ actor, ...input }))
}

/** Fence one activation through a test-local controller-shaped proof source. */
export async function fenceTestActivation(
  ctx: Context,
  input: ActivationFenceInput,
): Promise<TeamStateSnapshot> {
  return await withTestActivationProof(ctx, {
    kind: 'activation-controller-fence',
    ...input,
  }, async actor => await ctx.teams.fenceActivation({ actor, ...input }))
}

/** Quiesce one activation through a test-local controller-shaped proof source. */
export async function quiesceTestActivation(
  ctx: Context,
  input: ActivationQuiesceInput,
): Promise<TeamStateSnapshot> {
  return await withTestActivationProof(ctx, {
    kind: 'activation-controller-quiesce',
    ...input,
  }, async actor => await ctx.teams.quiesceActivation({ actor, ...input }))
}

/** Assign one task through a test-local scheduler-shaped proof source. */
export async function assignTestTask(
  ctx: Context,
  input: TeamTaskAssignInput,
): Promise<TeamTaskSnapshot> {
  return await withTestTaskLeaseProof(ctx, {
    kind: 'scheduler-task-assign',
    ...input,
  }, async actor => await ctx.teams.assignTask({ actor, ...input }))
}

/** Expire one task lease through a test-local scheduler-shaped proof source. */
export async function expireTestTask(
  ctx: Context,
  input: TeamTaskAttemptExpireInput,
): Promise<TeamTaskSnapshot> {
  return await withTestTaskLeaseProof(ctx, {
    kind: 'scheduler-task-expire',
    ...input,
  }, async actor => await ctx.teams.expireTaskAttempt({ actor, ...input }))
}

/**
 * Update one task through a real current coordinator activation proof.
 * @param ctx - Hub context that owns the task.
 * @param input - JSON-only task detail fields.
 * @returns the durable updated task projection.
 */
export async function updateTestCoordinatorTask(
  ctx: Context,
  input: TeamTaskDetailsUpdateInput,
): Promise<TeamTaskSnapshot> {
  const actor = await coordinatorTaskActor(ctx, input.teamId)
  return await ctx.teams.updateTaskDetails({ actor, ...input })
}

/**
 * Delete one task through a real current coordinator activation proof.
 * @param ctx - Hub context that owns the task.
 * @param input - JSON-only task tombstone fields.
 * @returns the durable deleted task projection.
 */
export async function deleteTestCoordinatorTask(
  ctx: Context,
  input: TeamTaskDeleteInput,
): Promise<TeamTaskSnapshot> {
  const actor = await coordinatorTaskActor(ctx, input.teamId)
  return await ctx.teams.deleteTask({ actor, ...input })
}

/**
 * Create one task through a real current coordinator activation proof. The
 * fixture must provision that coordinator before it captures the task cursor;
 * this helper supplies a unique retry key unless a test selects one.
 * @param ctx - Hub context that owns the fixture Team.
 * @param input - JSON task fields; a supplied cursor remains stale when the test selected one deliberately.
 * @returns the durable task projection after coordinator-authorized creation.
 */
export async function createTestCoordinatorTask(
  ctx: Context,
  input: Omit<TeamTaskCreateInput, 'createCommand'> & {
    readonly createCommand?: TeamTaskCreateCommandInput
  },
): Promise<TeamTaskSnapshot> {
  const before = await ctx.teams.getTeam({ teamId: input.teamId })
  const actor = await coordinatorTaskActor(ctx, input.teamId)
  const current = await ctx.teams.getTeam({ teamId: input.teamId })
  const sequence = nextTestCoordinatorTaskSequence(ctx)
  return await ctx.teams.createTask({
    actor,
    ...input,
    expectedCursor: input.expectedCursor === before.team.cursor ? current.team.cursor : input.expectedCursor,
    createCommand: input.createCommand ?? {
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(JSON.stringify([
        'test-coordinator-task', input.teamId, sequence,
      ])),
    },
  })
}

/**
 * Add and bind one real active coordinator for a bare-Hub fixture that needs
 * task admission authority before it captures cursors or asserts membership.
 */
export async function provisionTestCoordinator(ctx: Context, teamId: TeamId): Promise<TeamActorProof> {
  const state = await ctx.teams.getTeam({ teamId })
  const existing = state.participants.find(candidate => (
    candidate.phase === 'active'
    && candidate.role === 'coordinator'
    && (candidate.kind === 'local-agent' || candidate.kind === 'remote-agent')
  ))
  if (existing !== undefined) return await coordinatorTaskActor(ctx, teamId)
  const sequence = nextTestCoordinatorTaskSequence(ctx)
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName: 'Test coordinator',
    role: 'coordinator',
    capabilities: [],
  })
  const provisioning = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: provisioning.team.cursor,
    phase: 'provisioning',
  })
  const activating = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: activating.team.cursor,
    phase: 'active',
  })
  const binding = await bindTestActivation(ctx, {
    expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(`test-coordinator-task-${sequence}-activation`),
        teamId,
        participantId: invited.id,
        status: 'idle',
      },
      sessionId: SessionId(`test-coordinator-task-${sequence}-session`),
      provider: 'in-process',
    },
  })
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}

/** Issue one activation proof for an existing real active coordinator in an isolated Hub fixture. */
async function coordinatorTaskActor(ctx: Context, teamId: TeamId): Promise<TeamActorProof> {
  const state = await ctx.teams.getTeam({ teamId })
  const coordinator = state.participants.find(candidate => (
    candidate.phase === 'active'
    && candidate.role === 'coordinator'
    && (candidate.kind === 'local-agent' || candidate.kind === 'remote-agent')
  ))
  if (coordinator === undefined) {
    throw new Error(`Fixture Team '${teamId}' has no active coordinator for task creation`)
  }
  const binding = state.activations.find(candidate => (
    candidate.activation.participantId === coordinator.id
    && (candidate.activation.status === 'idle' || candidate.activation.status === 'running')
  ))
  if (binding !== undefined) return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
  const sequence = nextTestCoordinatorTaskSequence(ctx)
  const created = await bindTestActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(`test-coordinator-task-${sequence}-activation`),
        teamId,
        participantId: coordinator.id,
        status: 'idle',
      },
      sessionId: SessionId(`test-coordinator-task-${sequence}-session`),
      provider: 'in-process',
    },
  })
  return ctx.teams.openActivationActorProofIssuer().issue(created).proof
}

/** Allocate a context-local monotonically unique fixture suffix. */
function nextTestCoordinatorTaskSequence(ctx: Context): number {
  const sequence = (testCoordinatorTaskSequences.get(ctx) ?? 0) + 1
  testCoordinatorTaskSequences.set(ctx, sequence)
  return sequence
}

/** Bind a test-only deliverable activation for the local or remote post sender. */
async function bindPostActivation(
  ctx: Context,
  state: Pick<TeamStateSnapshot, 'team' | 'participants'>,
  participantId: ParticipantId,
): Promise<ActivationBindingSnapshot> {
  const participant = state.participants.find(candidate => candidate.id === participantId)
  if (participant?.kind !== 'local-agent' && participant?.kind !== 'remote-agent') {
    throw new Error(`Participant '${participantId}' cannot issue an activation proof for an ordinary Envelope`)
  }
  return await bindTestActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(`test-post-${participantId}`),
        teamId: state.team.id,
        participantId,
        status: 'idle',
      },
      sessionId: SessionId(`test-post-${participantId}`),
      provider: 'in-process',
    },
  })
}

/** Select the exact current binding for a status fixture, or a valid unreachable scope for a missing epoch. */
async function testActivationStatusScope(
  ctx: Context,
  input: ActivationStatusUpdateInput,
): Promise<TeamSystemActivationScope> {
  const state = await ctx.teams.getTeam({ teamId: input.teamId })
  const binding = state.activations.find(candidate => candidate.activation.id === input.activationId)
  return {
    kind: 'activation-controller-status',
    teamId: input.teamId,
    activationId: input.activationId,
    participantId: binding?.activation.participantId ?? participantIdSchema.parse(`missing-activation-participant:${input.activationId}`),
    sessionId: binding?.sessionId ?? SessionId(`missing-activation-session:${input.activationId}`),
    provider: binding?.provider ?? 'in-process',
    expectedCursor: input.expectedCursor,
    status: input.status,
  }
}

/** Retain an exact scope only until its one fixture Hub call settles. */
async function withTestActivationProof<T>(
  ctx: Context,
  scope: TeamSystemActivationScope,
  operation: (actor: TeamSystemActivationProof) => Promise<T>,
): Promise<T> {
  const authority = testActivationAuthority(ctx)
  const proof = createTestActivationProof()
  authority.proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    authority.proofs.delete(proof)
  }
}

/** Register the canonical controller name only within this isolated test Context. */
function testActivationAuthority(ctx: Context): TestActivationAuthority {
  const existing = testActivationAuthorities.get(ctx)
  if (existing !== undefined) return existing
  const authority: TestActivationAuthority = { proofs: new Map() }
  const source: TeamSystemActivationProofSource = {
    name: 'team-activation-controller',
    resolveActivationProof: proof => authority.proofs.get(proof),
  }
  ctx.teams.registerSystemActivationProofSource(source)
  testActivationAuthorities.set(ctx, authority)
  return authority
}

/** Create one fixture-only proof that cannot cross a durable or wire boundary. */
function createTestActivationProof(): TeamSystemActivationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Test activation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemActivationProof
}

/** Register the canonical Host source in one isolated Hub fixture and issue revocable exact scopes. */
export function testHumanActionAuthority(ctx: Context): {
  issue(scope: TeamSystemHumanActionScope): { readonly proof: TeamSystemHumanActionProof; revoke(): void }
} {
  let authority = testHumanActionAuthorities.get(ctx)
  if (authority === undefined) {
    authority = { proofs: new Map() }
    const source: TeamSystemHumanActionProofSource = {
      name: 'host-api-proxy',
      resolveHumanActionProof: proof => authority?.proofs.get(proof),
    }
    ctx.teams.registerSystemHumanActionProofSource(source)
    testHumanActionAuthorities.set(ctx, authority)
  }
  return Object.freeze({
    issue(scope) {
      const proof = createTestHumanActionProof()
      authority.proofs.set(proof, Object.freeze(structuredClone(scope)))
      return Object.freeze({ proof, revoke: (): void => { authority?.proofs.delete(proof) } })
    },
  })
}

/** Create one fixture-only proof that cannot cross a durable or wire boundary. */
function createTestHumanActionProof(): TeamSystemHumanActionProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Test human-action proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemHumanActionProof
}

/** Retain one scheduler lease scope only until its one fixture Hub call settles. */
async function withTestTaskLeaseProof<T>(
  ctx: Context,
  scope: TeamSystemTaskLeaseScope,
  operation: (actor: TeamSystemTaskLeaseProof) => Promise<T>,
): Promise<T> {
  const authority = testTaskLeaseAuthority(ctx)
  const proof = createTestTaskLeaseProof()
  authority.proofs.set(proof, Object.freeze(structuredClone(scope)))
  try {
    return await operation(proof)
  } finally {
    authority.proofs.delete(proof)
  }
}

/** Register the canonical scheduler name only within this isolated test Context. */
function testTaskLeaseAuthority(ctx: Context): TestTaskLeaseAuthority {
  const existing = testTaskLeaseAuthorities.get(ctx)
  if (existing !== undefined) return existing
  const authority: TestTaskLeaseAuthority = { proofs: new Map() }
  const source: TeamSystemTaskLeaseProofSource = {
    name: 'team-scheduler-dag',
    resolveTaskLeaseProof: proof => authority.proofs.get(proof),
  }
  ctx.teams.registerSystemTaskLeaseProofSource(source)
  testTaskLeaseAuthorities.set(ctx, authority)
  return authority
}

/** Create one fixture-only scheduler proof that cannot cross a durable or wire boundary. */
function createTestTaskLeaseProof(): TeamSystemTaskLeaseProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Test scheduler task-lease proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemTaskLeaseProof
}

export function participant(overrides: Record<string, unknown> = {}): ParticipantSnapshot {
  return participantSnapshotSchema.parse({
    id: participantId,
    teamId,
    kind: 'local-agent',
    displayName: 'Reviewer',
    role: 'reviewer',
    capabilities: [],
    phase: 'invited',
    ...overrides,
    ...(overrides.kind === 'human' && !Object.hasOwn(overrides, 'owner')
      ? { owner: { kind: 'system' } }
      : {}),
  })
}

export function task(overrides: Record<string, unknown> = {}): TeamTaskSnapshot {
  const id = teamTaskIdSchema.parse(typeof overrides.id === 'string' ? overrides.id : taskId)
  const ownerTeamId = teamIdSchema.parse(typeof overrides.teamId === 'string' ? overrides.teamId : teamId)
  return teamTaskSnapshotSchema.parse({
    id,
    teamId: ownerTeamId,
    revision: 1,
    execution: { kind: 'participant' },
    createCommand: {
      creator: {
        teamId: ownerTeamId,
        participantId: taskCreatorId,
        activationId: taskCreatorActivationId,
        sessionId: taskCreatorSessionId,
        provider: 'in-process',
      },
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`fixture-task-create:${id}`),
    },
    subject: 'Review the change',
    description: 'Inspect the submitted implementation.',
    phase: 'pending',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: ['packages/team'],
    workspaceMode: 'shared',
    budget: {},
    reviewPolicy: { kind: 'none' as const },
    reviewHistory: [],
    maxAttempts: 3,
    attemptCount: 0,
    attemptHistory: [],
    ...overrides,
  })
}

/** Build one revisioned Team goal owned by the fixture Team. */
export function goal(overrides: Record<string, unknown> = {}) {
  return teamGoalSnapshotSchema.parse({
    teamId,
    revision: 1,
    objective: 'Review the change',
    phase: 'active',
    budgets: { tokens: 50 },
    ...overrides,
  })
}

/** Build one current task lease whose timestamps can be aligned with a fold record. */
export function taskLease(overrides: Record<string, unknown> = {}): TaskLeaseSnapshot {
  return taskLeaseSnapshotSchema.parse({
    attemptId: taskAttemptIdSchema.parse('attempt-a'),
    assignedRevision: 2,
    ordinal: 1,
    participantId,
    assignedAt: 13,
    durationMs: 10,
    renewedAt: 13,
    expiresAt: 23,
    ...overrides,
  })
}

/** Build one terminal task-attempt history row matching the default fixture task. */
export function settledAttempt(overrides: Record<string, unknown> = {}): TaskAttemptSnapshot {
  return taskAttemptSnapshotSchema.parse({
    id: taskAttemptIdSchema.parse('attempt-a'),
    teamId,
    taskId,
    ordinal: 1,
    participantId,
    assignedAt: 13,
    leaseExpiresAt: 23,
    settledAt: 20,
    outcome: { kind: 'released' },
    ...overrides,
  })
}

export function manifest(overrides: Record<string, unknown> = {}): ChannelManifest {
  return channelManifestSchema.parse({
    id: 'channel-a',
    teamId,
    adapter: { type: 'direct', version: 1 },
    participants: [{ id: participantId, role: 'reviewer' }],
    limits: { turns: 2 },
    ...overrides,
  })
}

function teamRecord(value: Record<string, unknown>): TeamJournalRecord {
  return teamJournalRecordSchema.parse(value)
}

export function createdTeam(overrides: Record<string, unknown> = {}): TeamJournalRecord {
  return teamRecord({
    type: 'team/created',
    teamId,
    depth: 0,
    maxTeamDepth: 0,
    goal: goal(),
    rules: { mode: 'local' },
    budgets: { tokens: 50 },
    createdAt: 10,
    ...overrides,
  })
}

export function teamPhase(overrides: Record<string, unknown> = {}): TeamJournalRecord {
  return teamRecord({ type: 'team/phase', phase: 'active', createdAt: 11, ...overrides })
}

export function goalChanged(overrides: Record<string, unknown> = {}): TeamJournalRecord {
  return teamRecord({
    type: 'goal/changed',
    goal: goal({ revision: 2 }),
    createdAt: 12,
    ...overrides,
  })
}

export function participantChanged(overrides: Record<string, unknown> = {}): TeamJournalRecord {
  return teamRecord({ type: 'participant/changed', participant: participant(), createdAt: 12, ...overrides })
}

export function taskChanged(overrides: Record<string, unknown> = {}): TeamJournalRecord {
  return teamRecord({ type: 'task/changed', task: task(), createdAt: 13, ...overrides })
}

export function channelAttached(overrides: Record<string, unknown> = {}): TeamJournalRecord {
  return teamRecord({ type: 'channel/attached', channelId: 'channel-a', createdAt: 14, ...overrides })
}

function channelRecord(value: Record<string, unknown>): ChannelRecord {
  return channelRecordSchema.parse(value)
}

export function channelOpened(overrides: Record<string, unknown> = {}): ChannelRecord {
  return channelRecord({ type: 'channel/opened', sequence: 0, createdAt: 20, manifest: manifest(), ...overrides })
}

export function channelPhase(overrides: Record<string, unknown> = {}): ChannelRecord {
  return channelRecord({ type: 'channel/phase', sequence: 1, createdAt: 21, phase: 'active', ...overrides })
}

export function channelEnvelope(overrides: Record<string, unknown> = {}): ChannelRecord {
  const envelopeOverrides = (overrides.envelope ?? {}) as Record<string, unknown>
  const envelope = {
    id: 'envelope-a',
    teamId,
    channelId: 'channel-a',
    sequence: 2,
    senderId: participantId,
    audience: null,
    kind: 'message',
    payload: { text: 'Review ready.' },
    delivery: 'context',
    priority: 'normal',
    createdAt: 22,
    ...envelopeOverrides,
  }
  const { envelope: _envelope, deliveryIntents: overrideDeliveryIntents, ...recordOverrides } = overrides
  return channelRecord({
    type: 'channel/envelope',
    envelope,
    deliveryIntents: overrideDeliveryIntents ?? [{ participantId, envelopeId: envelope.id, delivery: envelope.delivery }],
    ...recordOverrides,
  })
}

export function channelReceipt(overrides: Record<string, unknown> = {}): ChannelRecord {
  return channelRecord({
    type: 'channel/receipt',
    sequence: 3,
    createdAt: 23,
    participantId,
    envelopeId: 'envelope-a',
    cursor: 2,
    ...overrides,
  })
}

export function channelAdapter(overrides: Record<string, unknown> = {}): ChannelRecord {
  return channelRecord({
    type: 'channel/adapter',
    sequence: 4,
    createdAt: 24,
    adapter: { type: 'direct', version: 1 },
    payload: { handled: true },
    ...overrides,
  })
}

export function channelClosed(overrides: Record<string, unknown> = {}): ChannelRecord {
  return channelRecord({ type: 'channel/closed', sequence: 5, createdAt: 25, phase: 'closed', ...overrides })
}
