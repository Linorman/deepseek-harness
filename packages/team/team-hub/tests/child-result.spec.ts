import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import { consultChannelAdapter } from '@clocky/clocky-team-channel-basic'
import { FULL_TRANSCRIPT_VIEW_POLICY } from '@clocky/clocky-team-channel-direct'
import {
  channelIdSchema, channelManifestSchema, channelRecordSchema, fingerprintChannelManifest, channelPostIdempotencyKeySchema,
  fingerprintTeamChildResultContent, fingerprintTeamHumanActorPayload, teamChildRunBindingSchema, teamDelegationResultAdmissionSchema,
  teamIdSchema, teamTaskSnapshotSchema, jsonObjectSchema, jsonValueSchema, teamSystemEnvelopePostScopeSchema,
  channelEnvelopePostInputSchema,
} from '@clocky/clocky-team'
import type {
  TeamDelegationResultAdmission, TeamSystemChildResultProof, TeamSystemChildResultScope,
  TeamSystemDelegationProof, TeamSystemDelegationScope,
  TeamSystemMaintenanceProof, TeamSystemMaintenanceScope,
  TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope, TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope,
  TeamHumanActorProof,
} from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { quiesceTestActivation, seedTeamPhase } from './fixtures.ts'
import type { TeamSystemClosureDriverProof, TeamSystemClosureDriverScope } from '@clocky/clocky-team'
import { foldChannelRecord, foldTeamRecord, teamProjectionData, teamProjectionFromData } from '../src/fold.ts'
import { teamJournalRecordSchema } from '../src/schema.ts'
import { CHANNEL_WAL_FORMAT_VERSION, TEAM_JOURNAL_FORMAT_VERSION, TEAM_CHECKPOINT_FORMAT_VERSION } from '../src/types.ts'

const roots: string[] = []
const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.useRealTimers()
})
const parentId = teamIdSchema.parse('parent-result-team')
const childId = teamIdSchema.parse('child-result-team')
const channelId = channelIdSchema.parse('child-result-consult')
const binding = teamChildRunBindingSchema.parse({ parentTeamId: parentId, parentTaskId: 'parent-task', childTeamId: childId,
  delegationId: 'delegation-one', parentServiceId: 'parent-service', coordinatorId: 'child-coordinator', channelId })
const grant = { operations: ['register', 'invite', 'activate', 'channel-open', 'send', 'dispatch', 'task-mutate', 'close'],
  workspaceModes: ['shared'], readScopes: ['.'], writeScopes: ['.'], budgets: {} }
const goal = (teamId: string) => ({ teamId, revision: 1, objective: 'Run delegated work', phase: 'active', budgets: {} })
function members(teamId: string, id: string, kind: string, role: string, at: number) {
  return ['invited', 'provisioning', 'active'].map((phase, offset) => ({ type: 'participant/changed', createdAt: at + offset,
    participant: { id, teamId, kind, role, displayName: id, capabilities: [], phase, authorityGrant: grant,
      ...(kind === 'human' ? { owner: { kind: 'product-principal', principalId: 'parent-principal' } } : {}) } }))
}
/** Valid serialized source history isolates result authority from Agent-runtime side effects. */
function history(
  options: {
    missing?: boolean
    wrongCause?: boolean
    live?: boolean
    parentCancelling?: boolean
    noRequest?: boolean
    completedWork?: boolean
    pendingWork?: boolean
    failedWork?: boolean
    emptyArtifactWork?: boolean
    orphanedClosure?: boolean
  } = {},
) {
  const creation = { parentTeamId: parentId, parentTaskId: binding.parentTaskId, delegationId: binding.delegationId,
    goal: { objective: 'Run delegated work', budgets: {} }, rules: {}, budgets: {}, authorityGrant: grant }
  const initial = teamTaskSnapshotSchema.parse({
    createdAt: 1005, id: binding.parentTaskId, teamId: parentId, revision: 1,
    execution: { kind: 'child-team', templateId: 'fixture', templateVersion: 1, authorityGrant: grant, budget: {} },
    createCommand: { creator: { teamId: parentId, participantId: 'parent-human' }, idempotencyKey: 'create-delegation' },
    subject: 'Delegated work', description: 'Complete the child', phase: 'pending', blockedBy: [], requiredCapabilities: [],
    priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' },
    reviewHistory: [], maxAttempts: 1, attemptCount: 0, attemptHistory: [],
    delegation: { id: binding.delegationId, phase: 'requested', requestedAt: 1005, updatedAt: 1005 } })
  const reserved = teamTaskSnapshotSchema.parse({ ...initial, revision: 2, phase: 'running', attemptCount: 1,
    delegation: { ...initial.delegation, phase: 'creating', startedAt: 1006, updatedAt: 1006, childTeamId: childId, creation } })
  const parent: unknown[] = [
    { type: 'team/created', teamId: parentId, depth: 0, maxTeamDepth: 2, goal: goal(parentId), rules: {}, budgets: {}, authorityGrant: grant,
      createdBy: { kind: 'system', name: 'team-run' }, createdAt: 1000 },
    { type: 'team/phase', phase: 'active', createdAt: 1001 }, ...members(parentId, 'parent-human', 'human', 'human', 1002),
    { type: 'task/changed', task: initial, createdAt: 1005 }, { type: 'task/changed', task: reserved, createdAt: 1006 },
  ]
  if (options.parentCancelling) parent.push({ type: 'team/cancellation', createdAt: 1120,
    cancellation: { teamId: parentId, idempotencyKey: 'cancel-parent-result', actor: { kind: 'system', name: 'team-run' },
      reason: { code: 'PARENT_CANCELLED', message: 'Cancel delegated work' }, requestedAt: 1120 } },
  { type: 'team/phase', phase: 'quiescing', createdAt: 1120 })
  const epoch = { activation: { id: 'child-coordinator-epoch', teamId: childId, participantId: binding.coordinatorId, status: 'starting' },
    sessionId: 'child-coordinator-session', provider: 'fixture' }
  const child: unknown[] = [
    { type: 'team/created', teamId: childId, parentTeamId: parentId, parentTaskId: binding.parentTaskId,
      depth: 1, maxTeamDepth: 2, goal: goal(childId), rules: {}, budgets: {}, authorityGrant: grant, createdAt: 1007 },
    { type: 'team/phase', phase: 'active', createdAt: 1008 },
    ...members(childId, binding.parentServiceId, 'service', 'parent-service', 1009),
    ...members(childId, binding.coordinatorId, 'local-agent', 'coordinator', 1012),
    { type: 'channel/attached', channelId, createdAt: 1015 },
    { type: 'team/child-run-bound', binding, createdAt: 1016 },
    { type: 'activation/changed', binding: epoch, createdAt: 1017 },
    { type: 'activation/changed', binding: { ...epoch, activation: { ...epoch.activation, status: 'idle' } }, createdAt: 1018 },
  ]
  if (options.completedWork) {
    const initialWork = teamTaskSnapshotSchema.parse({ id: 'child-artifact-work', teamId: childId, createdAt: 1020, revision: 1,
      execution: { kind: 'participant' }, createCommand: { creator: { teamId: childId,
        participantId: binding.coordinatorId, activationId: epoch.activation.id, sessionId: epoch.sessionId,
        provider: epoch.provider }, idempotencyKey: 'child-artifact-work' },
      subject: 'Publish child artifacts', description: 'Retain visible child output.', phase: 'pending',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, reviewHistory: [], maxAttempts: 1, attemptCount: 0, attemptHistory: [] })
    const lease = { attemptId: 'child-artifact-attempt', assignedRevision: 2, ordinal: 1,
      participantId: binding.coordinatorId, activationId: epoch.activation.id,
      assignedAt: 1021, durationMs: 1000, renewedAt: 1021, expiresAt: 2021 }
    const assignedWork = teamTaskSnapshotSchema.parse({ ...initialWork, revision: 2, phase: 'assigned', attemptCount: 1, lease })
    const runningWork = teamTaskSnapshotSchema.parse({ ...assignedWork, revision: 3, phase: 'running',
      lease: { ...lease, startedAt: 1022 } })
    const visible = (id: string) => ({ id, provider: 'child-workspace', kind: 'report',
      uri: `artifact://child/${id}`, visibility: 'team', sourceAttemptId: lease.attemptId })
    const completedWork = teamTaskSnapshotSchema.parse({ ...runningWork, revision: 4, phase: 'completed', lease: undefined,
      attemptHistory: [{ id: lease.attemptId, teamId: childId, taskId: initialWork.id, ordinal: 1,
        participantId: binding.coordinatorId, activationId: epoch.activation.id, assignedAt: 1021, startedAt: 1022,
        leaseExpiresAt: 2021, settledAt: 1023, outcome: { kind: 'completed', result: {
          summary: 'Child artifact output.', artifacts: [visible('alpha'), visible('zeta'),
            { ...visible('hidden'), visibility: 'private' }, visible('zeta'), visible('middle')],
        } } }] })
    child.push({ type: 'task/changed', task: initialWork, createdAt: 1020 },
      { type: 'task/changed', task: assignedWork, createdAt: 1021 },
      { type: 'task/changed', task: runningWork, createdAt: 1022 },
      { type: 'task/changed', task: completedWork, createdAt: 1023 })
  }
  if (options.pendingWork) {
    const pendingWork = teamTaskSnapshotSchema.parse({ id: 'child-unfinished-work', teamId: childId,
      createdAt: 1024, revision: 1, execution: { kind: 'participant' },
      createCommand: { creator: { teamId: childId, participantId: binding.coordinatorId,
        activationId: epoch.activation.id, sessionId: epoch.sessionId, provider: epoch.provider },
      idempotencyKey: 'child-unfinished-work' },
      subject: 'Unfinished child work', description: 'Remain pending during result admission.', phase: 'pending',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, reviewHistory: [], maxAttempts: 1, attemptCount: 0, attemptHistory: [] })
    child.push({ type: 'task/changed', task: pendingWork, createdAt: 1024 })
  }
  if (options.failedWork) {
    const initialWork = teamTaskSnapshotSchema.parse({ id: 'child-failed-work', teamId: childId,
      createdAt: 1024, revision: 1, execution: { kind: 'participant' },
      createCommand: { creator: { teamId: childId, participantId: binding.coordinatorId,
        activationId: epoch.activation.id, sessionId: epoch.sessionId, provider: epoch.provider },
      idempotencyKey: 'child-failed-work' },
      subject: 'Failed optional work', description: 'Retain the failed attempt without artifacts.', phase: 'pending',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, reviewHistory: [], maxAttempts: 1, attemptCount: 0, attemptHistory: [] })
    const lease = { attemptId: 'child-failed-attempt', assignedRevision: 2, ordinal: 1,
      participantId: binding.coordinatorId, activationId: epoch.activation.id,
      assignedAt: 1025, durationMs: 1000, renewedAt: 1025, expiresAt: 2025 }
    const assignedWork = teamTaskSnapshotSchema.parse({ ...initialWork, revision: 2, phase: 'assigned', attemptCount: 1, lease })
    const runningWork = teamTaskSnapshotSchema.parse({ ...assignedWork, revision: 3, phase: 'running',
      lease: { ...lease, startedAt: 1026 } })
    const failedWork = teamTaskSnapshotSchema.parse({ ...runningWork, revision: 4, phase: 'failed', lease: undefined,
      attemptHistory: [{ id: lease.attemptId, teamId: childId, taskId: initialWork.id, ordinal: 1,
        participantId: binding.coordinatorId, activationId: epoch.activation.id, assignedAt: 1025, startedAt: 1026,
        leaseExpiresAt: 2025, settledAt: 1027,
        outcome: { kind: 'failed', failure: { code: 'CHILD_TASK_FAILED', message: 'Optional child work failed.' } } }] })
    child.push({ type: 'task/changed', task: initialWork, createdAt: 1024 },
      { type: 'task/changed', task: assignedWork, createdAt: 1025 },
      { type: 'task/changed', task: runningWork, createdAt: 1026 },
      { type: 'task/changed', task: failedWork, createdAt: 1027 })
  }
  if (options.emptyArtifactWork) {
    const initialWork = teamTaskSnapshotSchema.parse({ id: 'child-empty-artifact-work', teamId: childId,
      createdAt: 1030, revision: 1, execution: { kind: 'participant' },
      createCommand: { creator: { teamId: childId, participantId: binding.coordinatorId,
        activationId: epoch.activation.id, sessionId: epoch.sessionId, provider: epoch.provider },
      idempotencyKey: 'child-empty-artifact-work' },
      subject: 'Complete without artifacts', description: 'Retain a completed result without artifact output.', phase: 'pending',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
      budget: {}, reviewPolicy: { kind: 'none' }, reviewHistory: [], maxAttempts: 1, attemptCount: 0, attemptHistory: [] })
    const lease = { attemptId: 'child-empty-artifact-attempt', assignedRevision: 2, ordinal: 1,
      participantId: binding.coordinatorId, activationId: epoch.activation.id,
      assignedAt: 1031, durationMs: 1000, renewedAt: 1031, expiresAt: 2031 }
    const assignedWork = teamTaskSnapshotSchema.parse({ ...initialWork, revision: 2, phase: 'assigned', attemptCount: 1, lease })
    const runningWork = teamTaskSnapshotSchema.parse({ ...assignedWork, revision: 3, phase: 'running',
      lease: { ...lease, startedAt: 1032 } })
    const completedWork = teamTaskSnapshotSchema.parse({ ...runningWork, revision: 4, phase: 'completed', lease: undefined,
      attemptHistory: [{ id: lease.attemptId, teamId: childId, taskId: initialWork.id, ordinal: 1,
        participantId: binding.coordinatorId, activationId: epoch.activation.id, assignedAt: 1031, startedAt: 1032,
        leaseExpiresAt: 2031, settledAt: 1033,
        outcome: { kind: 'completed', result: { summary: 'Completed without artifact references.' } } }] })
    child.push({ type: 'task/changed', task: initialWork, createdAt: 1030 },
      { type: 'task/changed', task: assignedWork, createdAt: 1031 },
      { type: 'task/changed', task: runningWork, createdAt: 1032 },
      { type: 'task/changed', task: completedWork, createdAt: 1033 })
  }
  if (!options.live) child.push(
    { type: 'activation/changed', binding: { ...epoch, activation: { ...epoch.activation, status: 'stopping' } }, createdAt: 1112 },
    { type: 'activation/changed', binding: { ...epoch, activation: { ...epoch.activation, status: 'offline' },
      quiescedAt: 1113, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }, createdAt: 1113 },
  )
  if (options.orphanedClosure) child.push(
    { type: 'goal/changed', goal: { ...goal(childId), revision: 2, phase: 'complete' }, createdAt: 1119 },
    { type: 'team/closure', createdAt: 1120,
      closure: { teamId: childId, kind: 'complete', idempotencyKey: 'child-result:delegation-one',
        actor: { kind: 'system', name: 'team-run' },
        reason: { code: 'CHILD_RESULT_ACCEPTED', message: 'Child completion was claimed without parent admission.' },
        finalChannelId: channelId, finalEnvelopeId: 'child-response', requestedAt: 1120 } },
    { type: 'team/phase', phase: 'quiescing', createdAt: 1120 },
  )
  const manifest = channelManifestSchema.parse({ id: channelId, teamId: childId, adapter: { type: 'consult', version: 1 },
    viewPolicy: { type: 'full-transcript', version: 1 },
    participants: [{ id: binding.parentServiceId, role: 'initiator' }, { id: binding.coordinatorId, role: 'respondent' }], limits: {} })
  const fingerprint = fingerprintChannelManifest(manifest)
  const invitations = manifest.participants.map((member, index) => ({ participantId: member.id, role: member.role,
    visibility: 'channel', required: true, deadline: 2000, endpoint: index === 0 ? { kind: 'service', name: 'team-run' } : { kind: 'activation' },
    revision: 1, manifestFingerprint: fingerprint, status: 'pending' }))
  const request = { id: 'child-request', teamId: childId, channelId, sequence: 6, senderId: binding.parentServiceId,
    audience: [binding.coordinatorId], kind: 'request', payload: { text: 'Complete delegated work.' }, delivery: 'turn', priority: 'normal', createdAt: 1106 }
  const response = { id: 'child-response', teamId: childId, channelId, sequence: 8, senderId: binding.coordinatorId,
    audience: [binding.parentServiceId], kind: 'response', payload: { text: 'Child work complete.' }, delivery: 'turn', priority: 'normal', createdAt: 1108,
    causationId: options.wrongCause ? 'wrong-request' : request.id }
  const wal: unknown[] = [{ type: 'channel/opened', sequence: 0, manifest, createdAt: 1100 },
    ...invitations.map((invitation, index) => ({ type: 'channel/invitation', sequence: index + 1, invitation, createdAt: 1101 + index })),
    ...invitations.map((invitation, index) => ({ type: 'channel/acknowledged', sequence: index + 3,
      invitation: { ...invitation, status: 'acknowledged', acknowledgementKey: `ack-${index}`, settledAt: 1103 + index }, createdAt: 1103 + index })),
    { type: 'channel/phase', sequence: 5, phase: 'active', createdAt: 1105 },
    ...options.noRequest ? [] : [
      { type: 'channel/envelope', envelope: request, deliveryIntents: [{ participantId: binding.coordinatorId, envelopeId: request.id, delivery: 'turn' }] },
      { type: 'channel/receipt', sequence: 7, createdAt: 1107, participantId: binding.coordinatorId, envelopeId: request.id, cursor: request.sequence },
    ],
  ]
  if (!options.missing) wal.push(
    { type: 'channel/envelope', envelope: response, deliveryIntents: [{ participantId: binding.parentServiceId, envelopeId: response.id, delivery: 'turn' }] },
    { type: 'channel/phase', sequence: 9, phase: 'closing', createdAt: 1109 },
    { type: 'channel/closed', sequence: 10, phase: 'closed', createdAt: 1110 },
  )
  for (const [id, rows] of [[parentId, parent], [childId, child]] as const) {
    let projection
    for (const [cursor, record] of rows.entries()) {
      projection = foldTeamRecord(projection, teamJournalRecordSchema.parse(record), cursor, id)
    }
  }
  let projection
  for (const [cursor, record] of wal.entries()) {
    projection = foldChannelRecord(projection, channelRecordSchema.parse(record), cursor, channelId, consultChannelAdapter)
  }
  return { parent, child, wal, response, request }
}
async function storage(backend: 'json' | 'sqlite', root: string) {
  const ctx = new Context(); contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'child-results.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  return ctx
}
async function setup(backend: 'json' | 'sqlite', options: Parameters<typeof history>[0] = {}) {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/child-result-')); roots.push(root)
  const data = history(options)
  const ctx = await storage(backend, root)
  for (const [name, version, records] of [[`team/${parentId}`, TEAM_JOURNAL_FORMAT_VERSION, data.parent],
    [`team/${childId}`, TEAM_JOURNAL_FORMAT_VERSION, data.child], [`channel/${channelId}`, CHANNEL_WAL_FORMAT_VERSION, data.wal]] as const) {
    const stream = await ctx.storageLog.open({ name, version }); await stream.append(-1, records); await stream.close()
  }
  await ctx.plugin(TeamHub)
  ctx.teams.registerAdapter(consultChannelAdapter)
  ctx.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
  return { ctx, root, data }
}
function authority(ctx: Context) {
  const resultProofs = new Map<TeamSystemChildResultProof, TeamSystemChildResultScope>()
  const delegationProofs = new Map<TeamSystemDelegationProof, TeamSystemDelegationScope>()
  const retireResultSource = ctx.teams.registerSystemChildResultProofSource({ name: 'team-run', resolveChildResultProof: proof => resultProofs.get(proof) })
  ctx.teams.registerSystemDelegationProofSource({ name: 'team-delegation', resolveDelegationProof: proof => delegationProofs.get(proof),
    resolveChildWorkspace: async () => { throw new Error('Result admission must not resolve a workspace') } })
  return {
    retireResultSource,
    issueResult(scope: TeamSystemChildResultScope): TeamSystemChildResultProof {
      const proof = Object.freeze({}) as TeamSystemChildResultProof
      resultProofs.set(proof, scope)
      return proof
    },
    changeResultScopes(update: (scope: TeamSystemChildResultScope) => TeamSystemChildResultScope) {
      for (const [proof, scope] of resultProofs) resultProofs.set(proof, update(scope))
    },
    async admit() {
      const state = await ctx.teams.getTeam({ teamId: parentId }); const task = state.tasks[0]!
      const input = { teamId: parentId, taskId: task.id, expectedCursor: state.team.cursor, expectedRevision: task.revision,
        delegationId: binding.delegationId, childTeamId: childId, responseEnvelopeId: 'child-response' as never }
      const actor = Object.freeze({}) as TeamSystemDelegationProof
      delegationProofs.set(actor, { kind: 'delegation-result-admit', ...input })
      try { return await ctx.teams.admitTaskDelegationResult({ actor, ...input }) } finally { delegationProofs.delete(actor) }
    },
    async complete(admission: TeamDelegationResultAdmission) {
      const state = await ctx.teams.getTeam({ teamId: childId })
      const actor = Object.freeze({}) as TeamSystemChildResultProof
      resultProofs.set(actor, { kind: 'child-result-complete', binding, admission, expectedCursor: state.team.cursor })
      try { return await ctx.teams.completeChildTeam({ actor, childTeamId: childId, expectedCursor: state.team.cursor }) }
      finally { resultProofs.delete(actor) }
    },
    async missing() {
      const state = await ctx.teams.getTeam({ teamId: childId }); const epoch = state.activations[0]!
      const actor = Object.freeze({}) as TeamSystemChildResultProof
      resultProofs.set(actor, { kind: 'child-result-missing', binding, expectedCursor: state.team.cursor,
        activationId: epoch.activation.id, sessionId: epoch.sessionId, provider: epoch.provider, turn: 1 })
      try { return await ctx.teams.recordChildResultMissing({ actor, childTeamId: childId, expectedCursor: state.team.cursor }) }
      finally { resultProofs.delete(actor) }
    },
  }
}
async function storedRows(ctx: Context, name: string, version: number) {
  const retained = ctx.storageLog.get(name)
  const stream = retained ?? await ctx.storageLog.open({ name, version })
  try { return await stream.read(-1, 100) }
  finally { if (retained === undefined) await stream.close() }
}
async function pendingServiceResponses(ctx: Context): Promise<number> {
  let projection
  for (const row of await storedRows(ctx, `channel/${channelId}`, CHANNEL_WAL_FORMAT_VERSION)) {
    projection = foldChannelRecord(projection, channelRecordSchema.parse(row.value), row.sequence, channelId, consultChannelAdapter)
  }
  return projection?.pendingDeliveries.get(binding.parentServiceId)?.size ?? 0
}
for (const backend of ['json', 'sqlite'] as const) describe(`child result (${backend})`, () => {
  it('refuses a recovered child completion intent without a durable parent result admission', async () => {
    const f = await setup(backend, { orphanedClosure: true })
    const before = await f.ctx.teams.getTeam({ teamId: childId })
    const closure = before.team.closure
    if (closure?.kind !== 'complete' || closure.finalChannelId === undefined || closure.finalEnvelopeId === undefined) {
      throw new Error('Orphaned child fixture did not retain its completion intent')
    }
    const proof = Object.freeze({}) as TeamSystemClosureDriverProof
    const scope: TeamSystemClosureDriverScope = { kind: 'closure-recover-complete', teamId: childId,
      expectedCursor: before.team.cursor, closureIdempotencyKey: closure.idempotencyKey,
      closureRequestedAt: closure.requestedAt, finalChannelId: closure.finalChannelId,
      finalEnvelopeId: closure.finalEnvelopeId }
    const unregister = f.ctx.teams.registerSystemClosureDriverProofSource({ name: 'team-closure-driver',
      resolveClosureDriverProof: candidate => candidate === proof ? scope : undefined })
    try {
      await expect(f.ctx.teams.continueTeamClosure({ actor: proof, teamId: childId,
        expectedCursor: before.team.cursor })).rejects.toMatchObject({ code: 'TEAM_CHILD_RESULT_INVALID' })
      expect(await f.ctx.teams.getTeam({ teamId: childId })).toEqual(before)
    } finally { unregister() }
  })
  it('rejects a child-result proof selected for missing-result recovery when asked to complete', async () => {
    const f = await setup(backend)
    const child = await f.ctx.teams.getTeam({ teamId: childId })
    const epoch = child.activations[0]
    if (epoch === undefined) throw new Error('Child fixture has no coordinator activation')
    const proof = Object.freeze({}) as TeamSystemChildResultProof
    const scope: TeamSystemChildResultScope = { kind: 'child-result-missing', binding,
      expectedCursor: child.team.cursor, activationId: epoch.activation.id,
      sessionId: epoch.sessionId, provider: epoch.provider, turn: 1 }
    f.ctx.teams.registerSystemChildResultProofSource({ name: 'team-run',
      resolveChildResultProof: candidate => candidate === proof ? scope : undefined })
    await expect(f.ctx.teams.completeChildTeam({ actor: proof, childTeamId: childId,
      expectedCursor: child.team.cursor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await f.ctx.teams.getTeam({ teamId: childId })).team.cursor).toBe(child.team.cursor)
  })
  it('rejects completion authority reused for missing-output recovery', async () => {
    const f = await setup(backend)
    const owner = authority(f.ctx)
    const admission = await owner.admit()
    const child = await f.ctx.teams.getTeam({ teamId: childId })
    const actor = owner.issueResult({ kind: 'child-result-complete', binding, admission,
      expectedCursor: child.team.cursor })
    await expect(f.ctx.teams.recordChildResultMissing({ actor, childTeamId: childId,
      expectedCursor: child.team.cursor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await f.ctx.teams.getTeam({ teamId: childId })).team.phase).toBe('active')
  })
  it('rejects a child completion bound to another parent delegation identity', async () => {
    const f = await setup(backend)
    const owner = authority(f.ctx)
    const admission = await owner.admit()
    const child = await f.ctx.teams.getTeam({ teamId: childId })
    const forged = teamChildRunBindingSchema.parse({ ...binding, delegationId: 'another-delegation' })
    const actor = owner.issueResult({ kind: 'child-result-complete', binding: forged, admission,
      expectedCursor: child.team.cursor })
    await expect(f.ctx.teams.completeChildTeam({ actor, childTeamId: childId,
      expectedCursor: child.team.cursor })).rejects.toMatchObject({ code: 'TEAM_CHILD_RESULT_INVALID' })
    expect((await f.ctx.teams.getTeam({ teamId: childId })).team.childResultAdmission).toBeUndefined()
  })
  for (const invalid of ['swapped-endpoints', 'cancelled-parent'] as const) {
    it(`rejects child channel opening with ${invalid} before attaching a channel`, async () => {
      const f = await setup(backend, { parentCancelling: invalid === 'cancelled-parent' })
      await f.ctx.teams.getTeam({ teamId: parentId })
      const state = await f.ctx.teams.getTeam({ teamId: childId })
      const input = { teamId: childId, expectedCursor: state.team.cursor, adapter: { type: 'consult', version: 1 },
        viewPolicy: { type: 'full-transcript', version: 1 }, limits: {},
        participants: invalid === 'swapped-endpoints'
          ? [{ id: binding.coordinatorId, role: 'initiator' }, { id: binding.parentServiceId, role: 'respondent' }]
          : [{ id: binding.parentServiceId, role: 'initiator' }, { id: binding.coordinatorId, role: 'respondent' }] }
      const proof = Object.freeze({}) as TeamSystemChannelLifecycleProof
      const scope: TeamSystemChannelLifecycleScope = { kind: 'channel-open', ...input }
      f.ctx.teams.registerSystemChannelLifecycleProofSource({ name: 'team-run-child',
        resolveChannelLifecycleProof: value => value === proof ? scope : undefined })
      await expect(f.ctx.teams.openChannel({ actor: proof, authorityKind: 'channel-lifecycle', ...input }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect((await f.ctx.teams.getTeam({ teamId: childId })).channelIds).toEqual(state.channelIds)
    })
  }
  it('does not lend the child-open source generic channel-close authority', async () => {
    const f = await setup(backend, { missing: true, live: true })
    const channel = await f.ctx.teams.getChannel({ channelId })
    const input = { teamId: childId, channelId, expectedCursor: channel.cursor, reason: 'Wrong operation source' }
    const proof = Object.freeze({}) as TeamSystemChannelLifecycleProof
    const scope: TeamSystemChannelLifecycleScope = { kind: 'channel-close', ...input }
    f.ctx.teams.registerSystemChannelLifecycleProofSource({ name: 'team-run-child',
      resolveChannelLifecycleProof: value => value === proof ? scope : undefined })
    await expect(f.ctx.teams.closeChannel({ actor: proof, channelId, expectedCursor: channel.cursor, reason: input.reason }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await f.ctx.teams.getChannel({ channelId })).phase).toBe('active')
  })
  it('recovers the accepted parent result from an anchored checkpoint after its journal row is compacted', async () => {
    const f = await setup(backend)
    const owner = authority(f.ctx)
    const admission = await owner.admit()
    await owner.complete(admission)
    const parent = await f.ctx.teams.getTeam({ teamId: parentId })
    const rows = await storedRows(f.ctx, `team/${parentId}`, TEAM_JOURNAL_FORMAT_VERSION)
    await f.ctx.fiber.dispose(); contexts.delete(f.ctx)
    const restored = await storage(backend, f.root)
    const stream = await restored.storageLog.open({ name: `team/${parentId}`, version: TEAM_JOURNAL_FORMAT_VERSION })
    const record = teamJournalRecordSchema.parse({ type: 'goal/changed',
      goal: { ...parent.team.goal, revision: parent.team.goal.revision + 1, objective: 'Await accepted child settlement' },
      createdAt: parent.team.updatedAt + 1 })
    await stream.append(parent.team.cursor, [jsonValueSchema.parse(record)])
    let projection
    for (const row of rows) projection = foldTeamRecord(projection, teamJournalRecordSchema.parse(row.value), row.sequence, parentId)
    projection = foldTeamRecord(projection, record, parent.team.cursor + 1, parentId)
    await stream.writeCheckpoint({ sequence: projection.team.cursor, value: jsonValueSchema.parse({ kind: 'team-projection',
      version: TEAM_CHECKPOINT_FORMAT_VERSION, teamId: parentId, projection: teamProjectionData(projection) }) })
    await stream.compact({ throughSequence: admission.parentCursor, expectedCheckpointSequence: projection.team.cursor })
    expect(stream.firstSequence).toBe(admission.parentCursor + 1)
    await stream.close()
    await restored.plugin(TeamHub)
    restored.teams.registerAdapter(consultChannelAdapter)
    restored.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
    expect((await restored.teams.getTeam({ teamId: childId })).team).toMatchObject({ phase: 'completed', childResultAdmission: { parent: admission } })
  })
  it('rejects fabricated completion authority and a source retired during policy admission', async () => {
    const f = await setup(backend)
    const owner = authority(f.ctx)
    const admission = await owner.admit()
    const state = await f.ctx.teams.getTeam({ teamId: childId })
    await expect(f.ctx.teams.completeChildTeam({ actor: Object.freeze({}) as TeamSystemChildResultProof,
      childTeamId: childId, expectedCursor: state.team.cursor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    f.ctx.teams.registerPolicy('close', { name: 'retire-child-owner', async apply(_request, next) {
      await owner.retireResultSource()
      return await next()
    } })
    await expect(owner.complete(admission)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await f.ctx.teams.getTeam({ teamId: childId })).team.childResultAdmission).toBeUndefined()
    expect(await pendingServiceResponses(f.ctx)).toBe(1)
  })
  it('rejects a child-result proof whose scope changes while close policy is pending', async () => {
    const f = await setup(backend)
    const owner = authority(f.ctx)
    const admission = await owner.admit()
    const before = await f.ctx.teams.getTeam({ teamId: childId })
    f.ctx.teams.registerPolicy('close', { name: 'change-child-result-proof', async apply(_request, next) {
      owner.changeResultScopes(scope => scope.kind === 'child-result-complete'
        ? { ...scope, expectedCursor: scope.expectedCursor + 1 } : scope)
      return await next()
    } })
    await expect(owner.complete(admission)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(await f.ctx.teams.getTeam({ teamId: childId })).toEqual(before)
    expect(await pendingServiceResponses(f.ctx)).toBe(1)
  })
  it('requires explicit recovery before a stalled child can complete its accepted result', async () => {
    const f = await setup(backend)
    const owner = authority(f.ctx)
    const admission = await owner.admit()
    await seedTeamPhase(f.ctx, childId, 'stalled', { code: 'WAITING_FOR_RECOVERY', message: 'Child recovery is pending.' })
    await expect(owner.complete(admission)).rejects.toMatchObject({ code: 'TEAM_CHILD_RESULT_INVALID' })
    expect((await f.ctx.teams.getTeam({ teamId: childId })).team.phase).toBe('stalled')
  })
  it('admits sorted distinct visible artifacts from completed child work', async () => {
    const f = await setup(backend, { completedWork: true })
    const owner = authority(f.ctx)
    const admission = await owner.admit()
    expect(admission.artifacts.map(artifact => artifact.id)).toEqual(['alpha', 'middle', 'zeta'])
    expect(admission.artifacts.every(artifact => artifact.visibility === 'team')).toBe(true)
    expect((await owner.complete(admission)).team.phase).toBe('completed')
  })
  it('does not admit a parent-visible result while any child work remains unfinished', async () => {
    const f = await setup(backend, { completedWork: true, pendingWork: true })
    const before = await f.ctx.teams.getTeam({ teamId: parentId })
    await expect(authority(f.ctx).admit()).rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })
    expect(await f.ctx.teams.getTeam({ teamId: parentId })).toEqual(before)
    expect((await f.ctx.teams.getTeam({ teamId: childId })).tasks.some(task => task.phase === 'pending')).toBe(true)
  })
  it('omits failed child work while preserving completed visible artifacts', async () => {
    const f = await setup(backend, { completedWork: true, failedWork: true })
    const admission = await authority(f.ctx).admit()
    expect(admission.artifacts.map(artifact => artifact.id)).toEqual(['alpha', 'middle', 'zeta'])
    expect((await f.ctx.teams.getTeam({ teamId: childId })).tasks.some(task => task.phase === 'failed')).toBe(true)
  })
  it('keeps the parent artifact result stable when another completed task has no artifacts', async () => {
    const f = await setup(backend, { completedWork: true, emptyArtifactWork: true })
    const admission = await authority(f.ctx).admit()
    expect(admission.artifacts.map(artifact => artifact.id)).toEqual(['alpha', 'middle', 'zeta'])
    expect((await f.ctx.teams.getTeam({ teamId: childId })).tasks.filter(task => task.phase === 'completed')).toHaveLength(2)
  })
  it('rejects child completion after its parent task accepts cancellation', async () => {
    const f = await setup(backend)
    const owner = authority(f.ctx)
    const admission = await owner.admit()
    const parent = await f.ctx.teams.getTeam({ teamId: parentId })
    const task = parent.tasks[0]
    if (task === undefined) throw new Error('Fixture omitted its parent task')
    const input = { teamId: parentId, taskId: task.id, expectedRevision: task.revision,
      reason: 'Parent no longer needs the child result.' }
    const bound = { teamId: parentId, operation: 'task-mutate' as const,
      fence: { kind: 'revision' as const, revision: input.expectedRevision }, payload: jsonObjectSchema.parse(input) }
    const actor = Object.freeze({}) as TeamHumanActorProof
    f.ctx.teams.registerHumanActorProofSource({ name: 'parent-task-cancellation',
      resolveHumanActorProof: proof => proof === actor ? { teamId: parentId,
        participantId: task.createCommand.creator.participantId, operation: bound.operation,
        fence: bound.fence, payloadFingerprint: fingerprintTeamHumanActorPayload(bound) } : undefined })
    await f.ctx.teams.cancelTask({ ...input, actor })
    await expect(owner.complete(admission)).rejects.toMatchObject({ code: 'TEAM_CHILD_RESULT_INVALID' })
    expect((await f.ctx.teams.getTeam({ teamId: childId })).team.phase).toBe('active')
  })
  for (const prefix of ['parent', 'child-admission', 'service-receipt'] as const) {
    it(`resumes completion after a restart retaining only ${prefix}`, async () => {
      const f = await setup(backend)
      const admission = await authority(f.ctx).admit()
      const before = await f.ctx.teams.getTeam({ teamId: childId })
      await f.ctx.fiber.dispose(); contexts.delete(f.ctx)
      const writer = await storage(backend, f.root)
      if (prefix !== 'parent') {
        const stream = await writer.storageLog.open({ name: `team/${childId}`, version: TEAM_JOURNAL_FORMAT_VERSION })
        const admittedAt = Math.max(before.team.updatedAt + 1, admission.admittedAt)
        await stream.append(before.team.cursor, [{ type: 'team/child-result-admitted',
          admission: { parent: admission, admittedAt }, createdAt: admittedAt }])
        await stream.close()
      }
      if (prefix === 'service-receipt') {
        const stream = await writer.storageLog.open({ name: `channel/${channelId}`, version: CHANNEL_WAL_FORMAT_VERSION })
        await stream.append(10, [{ type: 'channel/receipt', sequence: 11, createdAt: admission.admittedAt + 1,
          participantId: binding.parentServiceId, envelopeId: admission.responseEnvelopeId, cursor: admission.responseSequence }])
        await stream.close()
      }
      await writer.plugin(TeamHub)
      writer.teams.registerAdapter(consultChannelAdapter)
      writer.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
      const owner = authority(writer)
      expect(await owner.admit()).toEqual(admission)
      expect((await owner.complete(admission)).team.phase).toBe('completed')
      expect((await owner.complete(admission)).team.childResultAdmission?.parent).toEqual(admission)
      expect((await writer.teams.getTeam({ teamId: parentId })).tasks[0]?.phase).toBe('running')
    })
  }
  for (const corruption of ['parent-admission', 'service-receipt'] as const) {
    it(`rejects a completed child whose durable ${corruption} is missing`, async () => {
      const f = await setup(backend)
      const owner = authority(f.ctx)
      await owner.complete(await owner.admit())
      const parent = await storedRows(f.ctx, `team/${parentId}`, TEAM_JOURNAL_FORMAT_VERSION)
      const child = await storedRows(f.ctx, `team/${childId}`, TEAM_JOURNAL_FORMAT_VERSION)
      const channel = await storedRows(f.ctx, `channel/${channelId}`, CHANNEL_WAL_FORMAT_VERSION)
      await f.ctx.fiber.dispose(); contexts.delete(f.ctx)
      const root = await mkdtemp(join(process.cwd(), '.tmp/child-result-corrupt-')); roots.push(root)
      const restored = await storage(backend, root)
      for (const [name, version, records] of [
        [`team/${parentId}`, TEAM_JOURNAL_FORMAT_VERSION, corruption === 'parent-admission' ? parent.slice(0, -1) : parent],
        [`team/${childId}`, TEAM_JOURNAL_FORMAT_VERSION, child],
        [`channel/${channelId}`, CHANNEL_WAL_FORMAT_VERSION, corruption === 'service-receipt' ? channel.slice(0, -1) : channel],
      ] as const) {
        const stream = await restored.storageLog.open({ name, version })
        await stream.append(-1, records.map(row => row.value))
        await stream.close()
      }
      await restored.plugin(TeamHub)
      restored.teams.registerAdapter(consultChannelAdapter)
      restored.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
      await expect(restored.teams.getTeam({ teamId: childId })).rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
    })
  }
  it('accepts the parent result before a closed consult service receipt and recovers completed child evidence', async () => {
    const f = await setup(backend); const owner = authority(f.ctx)
    const admission = await owner.admit()
    expect(admission).toMatchObject({ binding, requestEnvelopeId: f.data.request.id, responseEnvelopeId: f.data.response.id, text: 'Child work complete.' })
    expect((await f.ctx.teams.getTeam({ teamId: parentId })).tasks[0]).toMatchObject({ phase: 'running', delegation: { phase: 'settling', result: admission } })
    const inspected = await f.ctx.teams.inspectTask({ teamId: parentId, taskId: binding.parentTaskId, section: 'record' })
    expect(inspected).toMatchObject({ section: 'record', history: { attempts: 0, reviews: 0 },
      task: { delegation: { result: { text: admission.text } } } })
    expect(await f.ctx.teams.inspectTask({ teamId: parentId, taskId: binding.parentTaskId, section: 'attempts', expectedRevision: inspected.revision }))
      .toMatchObject({ section: 'attempts', items: [], total: 0 })
    expect(await pendingServiceResponses(f.ctx)).toBe(1)
    const completed = await owner.complete(admission)
    expect(completed.team).toMatchObject({ phase: 'completed', childResultAdmission: { parent: admission } })
    let projection
    for (const row of await storedRows(f.ctx, `team/${childId}`, TEAM_JOURNAL_FORMAT_VERSION)) {
      projection = foldTeamRecord(projection, teamJournalRecordSchema.parse(row.value), row.sequence, childId)
    }
    if (projection === undefined) throw new Error('Child journal contains no projection')
    const checkpoint = teamProjectionData(projection)
    expect(() => teamProjectionFromData({ ...checkpoint, team: { ...checkpoint.team,
      childResultAdmission: { ...checkpoint.team.childResultAdmission!, admittedAt: checkpoint.team.updatedAt + 1 } } }))
      .toThrow('child result admission exceeds its Team lifetime')
    expect(completed.participants.some(member => member.kind === 'human')).toBe(false)
    expect(await pendingServiceResponses(f.ctx)).toBe(0)
    const replay = await owner.complete(admission)
    expect(replay).toEqual(completed)
    expect((await f.ctx.teams.getTeam({ teamId: childId })).team.cursor).toBe(completed.team.cursor)
    const consult = await f.ctx.teams.getChannel({ channelId })
    expect(consult.phase).toBe('closed')
    const compactInput = { teamId: childId, channelId, expectedCursor: consult.cursor, throughSequence: 0 }
    const compactScope: TeamSystemMaintenanceScope = { kind: 'scheduler-channel-compaction', ...compactInput }
    const compactProof = Object.freeze({}) as TeamSystemMaintenanceProof
    const stopMaintenance = f.ctx.teams.registerSystemMaintenanceProofSource({ name: 'team-scheduler-dag',
      resolveMaintenanceProof: proof => proof === compactProof ? compactScope : undefined })
    try {
      await expect(f.ctx.teams.compactChannel({ ...compactInput, actor: compactProof }))
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      expect(f.ctx.teams.getMetrics()).toMatchObject({ channelCompactions: 0 })
      expect((await f.ctx.teams.readChannel({ channelId, afterCursor: -1 })).records).not.toHaveLength(0)
    } finally { stopMaintenance() }
    await f.ctx.fiber.dispose(); contexts.delete(f.ctx)
    const restored = await storage(backend, f.root); await restored.plugin(TeamHub); restored.teams.registerAdapter(consultChannelAdapter)
    restored.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
    expect((await restored.teams.getTeam({ teamId: childId })).team).toMatchObject({ phase: 'completed', childResultAdmission: { parent: admission } })
  })
  it('recovers an accepted child closure after the coordinator is independently proven quiescent', async () => {
    const f = await setup(backend, { live: true }); const owner = authority(f.ctx)
    const admission = await owner.admit()
    const closing = await owner.complete(admission)
    expect(closing.team.phase).toBe('quiescing')
    expect(closing.activations[0]?.activation.status).toBe('idle')
    await f.ctx.fiber.dispose(); contexts.delete(f.ctx)
    const restored = await storage(backend, f.root); await restored.plugin(TeamHub); restored.teams.registerAdapter(consultChannelAdapter)
    restored.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
    const state = await restored.teams.getTeam({ teamId: childId }); const epoch = state.activations[0]!
    await quiesceTestActivation(restored, { teamId: childId, expectedCursor: state.team.cursor,
      activationId: epoch.activation.id, participantId: epoch.activation.participantId,
      sessionId: epoch.sessionId, provider: epoch.provider })
    const ready = await restored.teams.getTeam({ teamId: childId }); const closure = ready.team.closure!
    const actor = Object.freeze({}) as TeamSystemClosureDriverProof
    const scope: TeamSystemClosureDriverScope = { kind: 'closure-recover-complete', teamId: childId,
      expectedCursor: ready.team.cursor, closureIdempotencyKey: closure.idempotencyKey, closureRequestedAt: closure.requestedAt,
      finalChannelId: binding.channelId, finalEnvelopeId: admission.responseEnvelopeId }
    restored.teams.registerSystemClosureDriverProofSource({ name: 'team-closure-driver', resolveClosureDriverProof: proof => proof === actor ? scope : undefined })
    const result = await restored.teams.continueTeamClosure({ actor, teamId: childId, expectedCursor: ready.team.cursor })
    expect(result.team.phase).toBe('completed')
    expect(result.team.childResultAdmission?.parent).toEqual(admission)
    expect((await restored.teams.getTeam({ teamId: parentId })).tasks[0]?.phase).toBe('running')
  })
  it('rejects fabricated parent acceptance and wrong response causation', async () => {
    const f = await setup(backend); const owner = authority(f.ctx)
    const fake = teamDelegationResultAdmissionSchema.parse({ binding,
      requestEnvelopeId: f.data.request.id, requestSequence: f.data.request.sequence,
      responseEnvelopeId: f.data.response.id, responseSequence: f.data.response.sequence,
      contentFingerprint: fingerprintTeamChildResultContent(f.data.response.payload), text: f.data.response.payload.text,
      artifacts: [], parentTaskRevision: 3, parentCursor: 7, admittedAt: 1115 })
    await expect(owner.complete(fake)).rejects.toMatchObject({ code: 'TEAM_CHILD_RESULT_PARENT_PENDING' })
    const admitted = await owner.admit()
    const mismatched = teamDelegationResultAdmissionSchema.parse({ ...admitted,
      text: 'A different parent-visible result was claimed.' })
    const before = await f.ctx.teams.getTeam({ teamId: childId })
    await expect(owner.complete(mismatched)).rejects.toMatchObject({ code: 'TEAM_CHILD_RESULT_PARENT_PENDING' })
    expect(await f.ctx.teams.getTeam({ teamId: childId })).toEqual(before)
    const malformed = await setup(backend, { wrongCause: true })
    await expect(authority(malformed.ctx).admit()).rejects.toMatchObject({ code: 'TEAM_CHILD_RESULT_INVALID' })
  })
  it('does not report missing output while an exact service response awaits parent admission', async () => {
    const ready = await setup(backend, { live: true })
    expect((await authority(ready.ctx).missing()).team.phase).toBe('active')
    const missing = await setup(backend, { live: true, missing: true })
    expect((await authority(missing.ctx).missing()).team).toMatchObject({ phase: 'stalled', stallReason: { code: 'CHILD_RESULT_MISSING' } })
  })
  it('refuses a missing-result report from a coordinator epoch that has already gone offline', async () => {
    const f = await setup(backend, { missing: true })
    await expect(authority(f.ctx).missing()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await f.ctx.teams.getTeam({ teamId: childId })).team.phase).toBe('active')
  })
  it('does not overwrite an already stalled child with another missing-result report', async () => {
    const f = await setup(backend, { missing: true, live: true })
    await f.ctx.teams.getTeam({ teamId: childId })
    await seedTeamPhase(f.ctx, childId, 'stalled', { code: 'PROVIDER_UNAVAILABLE', message: 'Awaiting provider recovery.' })
    const before = await f.ctx.teams.getTeam({ teamId: childId })
    expect(await authority(f.ctx).missing()).toEqual(before)
    expect(await f.ctx.teams.getTeam({ teamId: childId })).toEqual(before)
  })
})


/** Runtime-only delegation source issues the immutable objective to its child service channel. */
async function delegationRequest(
  ctx: Context, patch: Record<string, unknown> = {}, scopePatch: Record<string, unknown> = {}, sourceName = 'team-delegation',
) {
  await ctx.teams.getTeam({ teamId: parentId })
  const channel = await ctx.teams.getChannel({ channelId })
  const base = { channelId, audience: [binding.coordinatorId], kind: 'request', delivery: 'turn', payload: { text: 'Run delegated work' } }
  const { idempotencyKey = `child-request:${binding.delegationId}`, ...draftPatch } = patch
  const input = channelEnvelopePostInputSchema.parse({ expectedCursor: channel.cursor, idempotencyKey, draft: { ...base, ...draftPatch } })
  const proofs = new Map<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
  const stop = ctx.teams.registerSystemEnvelopePostProofSource({ name: sourceName, resolveEnvelopePostProof: proof => proofs.get(proof) })
  const actor = Object.freeze({ toJSON(): never { throw new Error('Proof is runtime-only') } }) as unknown as TeamSystemEnvelopePostProof
  proofs.set(actor, teamSystemEnvelopePostScopeSchema.parse({ kind: 'team-delegation-request', binding,
    objective: 'Run delegated work', ...scopePatch }))
  try { return await ctx.teams.postChannelEnvelope({ actor, ...input }) }
  finally { proofs.clear(); stop() }
}

it('admits only the frozen parent objective and derives the child final response from that one retained request', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1500)
  const f = await setup('json', { noRequest: true, missing: true, live: true })
  const posted = await delegationRequest(f.ctx)
  expect(posted).toMatchObject({ senderId: binding.parentServiceId, audience: [binding.coordinatorId], kind: 'request', payload: { text: 'Run delegated work' } })
  const state = await f.ctx.teams.getTeam({ teamId: childId })
  const issuer = f.ctx.teams.openActivationActorProofIssuer()
  const lease = issuer.issue(state.activations[0]!)
  try {
    const response = await f.ctx.teams.postChannelFinalEnvelope({ actor: lease.proof, channelId, idempotencyKey: channelPostIdempotencyKeySchema.parse('child-final'), text: 'Canonical child answer' })
    expect(response).toMatchObject({ kind: 'response', audience: [binding.parentServiceId], causationId: posted.id,
      payload: { text: 'Canonical child answer' } })
  } finally { lease.revoke(); issuer.close() }
})

it.each([
  ['message rather than request', { kind: 'message' }],
  ['context delivery', { delivery: 'context' }],
  ['broadcast', { audience: null }],
  ['empty audience', { audience: [] }],
  ['wrong recipient', { audience: [binding.parentServiceId] }],
  ['different objective text', { payload: { text: 'Changed objective' } }],
  ['extra payload', { payload: { text: 'Run delegated work', extra: true } }],
  ['caller task identity', { taskId: 'unowned-task' }],
  ['caller causation', { causationId: 'unowned-envelope' }],
  ['different retry key', { idempotencyKey: 'changed-key' }],
] as const)('refuses a delegated service request with %s before appending an Envelope', async (_name, patch) => {
  const f = await setup('json', { noRequest: true, missing: true, live: true })
  const before = await f.ctx.teams.getChannel({ channelId })
  await expect(delegationRequest(f.ctx, patch)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect(await f.ctx.teams.getChannel({ channelId })).toEqual(before)
})

it('refuses a request proof whose captured objective is no longer the exact parent reservation', async () => {
  const f = await setup('json', { noRequest: true, missing: true, live: true })
  await expect(delegationRequest(f.ctx, {}, { objective: 'Changed objective' }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})

it('refuses a child final when its service channel has retained no parent request', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1500)
  const f = await setup('json', { noRequest: true, missing: true, live: true })
  const state = await f.ctx.teams.getTeam({ teamId: childId })
  const issuer = f.ctx.teams.openActivationActorProofIssuer()
  const lease = issuer.issue(state.activations[0]!)
  try {
    await expect(f.ctx.teams.postChannelFinalEnvelope({ actor: lease.proof, channelId, idempotencyKey: channelPostIdempotencyKeySchema.parse('child-final'), text: 'Uncaused answer' }))
      .rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
  } finally { lease.revoke(); issuer.close() }
})


it('does not lend another proof source the delegation service sender namespace', async () => {
  const f = await setup('json', { noRequest: true, missing: true, live: true })
  await expect(delegationRequest(f.ctx, {}, {}, 'other-proof-owner')).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
})

it('refuses a blank child final before deriving a response or changing the service channel', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1500)
  const f = await setup('json', { missing: true, live: true })
  const state = await f.ctx.teams.getTeam({ teamId: childId })
  const issuer = f.ctx.teams.openActivationActorProofIssuer()
  const lease = issuer.issue(state.activations[0]!)
  try {
    const before = await f.ctx.teams.getChannel({ channelId })
    await expect(f.ctx.teams.postChannelFinalEnvelope({ actor: lease.proof, channelId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('blank-child-final'), text: '   ' }))
      .rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
    expect(await f.ctx.teams.getChannel({ channelId })).toEqual(before)
  } finally { lease.revoke(); issuer.close() }
})
