import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import { consultChannelAdapter } from '@clocky/clocky-team-channel-basic'
import { FULL_TRANSCRIPT_VIEW_POLICY } from '@clocky/clocky-team-channel-direct'
import {
  channelIdSchema, channelManifestSchema, channelRecordSchema, fingerprintChannelManifest,
  fingerprintTeamChildResultContent, teamChildRunBindingSchema, teamDelegationResultAdmissionSchema,
  teamIdSchema, teamTaskSnapshotSchema, jsonValueSchema,
} from '@clocky/clocky-team'
import type {
  TeamDelegationResultAdmission, TeamSystemChildResultProof, TeamSystemChildResultScope,
  TeamSystemDelegationProof, TeamSystemDelegationScope,
  TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope,
} from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { quiesceTestActivation } from './fixtures.ts'
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
function history(options: { missing?: boolean; wrongCause?: boolean; live?: boolean; parentCancelling?: boolean } = {}) {
  const creation = { parentTeamId: parentId, parentTaskId: binding.parentTaskId, delegationId: binding.delegationId,
    goal: { objective: 'Run delegated work', budgets: {} }, rules: {}, budgets: {}, authorityGrant: grant }
  const initial = teamTaskSnapshotSchema.parse({ id: binding.parentTaskId, teamId: parentId, revision: 1,
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
  const child = [
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
  if (!options.live) child.push(
    { type: 'activation/changed', binding: { ...epoch, activation: { ...epoch.activation, status: 'stopping' } }, createdAt: 1112 },
    { type: 'activation/changed', binding: { ...epoch, activation: { ...epoch.activation, status: 'offline' },
      quiescedAt: 1113, quiescenceSource: 'quiesced', quiescedWakeChannelIds: [] }, createdAt: 1113 } as never,
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
    { type: 'channel/envelope', envelope: request, deliveryIntents: [{ participantId: binding.coordinatorId, envelopeId: request.id, delivery: 'turn' }] },
    { type: 'channel/receipt', sequence: 7, createdAt: 1107, participantId: binding.coordinatorId, envelopeId: request.id, cursor: request.sequence },
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
    const malformed = await setup(backend, { wrongCause: true })
    await expect(authority(malformed.ctx).admit()).rejects.toMatchObject({ code: 'TEAM_CHILD_RESULT_INVALID' })
  })
  it('does not report missing output while an exact service response awaits parent admission', async () => {
    const ready = await setup(backend, { live: true })
    expect((await authority(ready.ctx).missing()).team.phase).toBe('active')
    const missing = await setup(backend, { live: true, missing: true })
    expect((await authority(missing.ctx).missing()).team).toMatchObject({ phase: 'stalled', stallReason: { code: 'CHILD_RESULT_MISSING' } })
  })
})
