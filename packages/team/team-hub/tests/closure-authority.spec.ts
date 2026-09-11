import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import {
  activationIdSchema,
  fingerprintTeamFinalContent,
  jsonValueSchema,
  teamFinalAdmissionIdempotencyKeySchema,
  teamClosureIdempotencyKeySchema,
  teamHumanActionIdSchema,
  teamHumanActionSourceIdSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamUsageSampleIdSchema,
  teamUsageChargeSchema,
  teamWorkflowPlanIdempotencyKeySchema,
  teamWorkflowPlanSchema,
  channelInvitationIdempotencyKeySchema,
  fingerprintChannelManifest,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  TeamEnvelope,
  ChannelId,
  ChannelSnapshot,
  ParticipantSnapshot,
  TeamActorProofLease,
  TeamChannelAdapter,
  TeamId,
  TeamSystemClosureProof,
  TeamSystemClosureScope,
  TeamSystemClosureDriverProof,
  TeamSystemClosureDriverScope,
  TeamSystemFinalReceiptProof,
  TeamSystemFinalReceiptScope,
  TeamSystemPhaseProof,
  TeamSystemPhaseScope,
  TeamSystemMaintenanceProof,
  TeamSystemMaintenanceScope,
  TeamSystemInterruptProof,
  TeamSystemInterruptScope,
  TeamSystemActivationProof,
  TeamSystemActivationScope,
  TeamSystemHumanActionProof,
  TeamSystemHumanActionScope,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseScope,
  TeamSystemTaskControlProof,
  TeamSystemTaskControlScope,
  TeamSystemCancellationCleanupProof,
  TeamSystemCancellationCleanupScope,
  TeamSystemFinalizationCleanupProof,
  TeamSystemFinalizationCleanupScope,
  TeamSystemTopologyProof,
  TeamSystemTopologyScope,
  TeamSystemSchedulerChannelProof,
  TeamSystemSchedulerChannelScope,
  TeamSystemWorkflowProof,
  TeamSystemWorkflowScope,
  TeamSystemChannelLifecycleProof,
  TeamSystemChannelLifecycleScope,
  TeamSystemChannelAdmissionProof,
  TeamSystemChannelAdmissionScope,
  TeamSystemDelegationProof,
  TeamSystemDelegationScope,
  TeamChildCreateInput,
  TeamTaskSnapshot,
  TeamClosureSnapshot,
  TeamCancellationSnapshot,
  TeamPhase,
} from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import TeamHub from '../src/index.ts'
import { admitTestFinal } from './final-admission-fixture.ts'
import { assignTestTask, createTestCoordinatorTask, seedTeamPhase, testHumanActionAuthority } from './fixtures.ts'
import { createTestChildTeam, createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, closeTestChannel, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { workflowChannelAdapter } from '@clocky/clocky-team-channel-workflow'
import type { TeamJournalRecord } from '../src/types.ts'
import { TEAM_JOURNAL_FORMAT_VERSION } from '../src/types.ts'
import { teamProjectionCheckpointSchema } from '../src/schema.ts'

const roots: string[] = []
const channelAdmissionProofStores = new WeakMap<Context, WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>>()
const delegationProofStores = new WeakMap<Context, WeakMap<TeamSystemDelegationProof, TeamSystemDelegationScope>>()

/** Issue one fixture-owned delegation proof for a real parent reservation. */
function delegationProof(ctx: Context, scope: TeamSystemDelegationScope): TeamSystemDelegationProof {
  let proofs = delegationProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemDelegationProof, TeamSystemDelegationScope>()
    proofs = sourceProofs
    delegationProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemDelegationProofSource({ name: 'team-delegation', resolveDelegationProof: proof => sourceProofs.get(proof), resolveChildWorkspace: async () => process.cwd() })
  }
  const proof = Object.freeze({}) as TeamSystemDelegationProof
  proofs.set(proof, scope)
  return proof
}

/** Reserve one child creation payload through the public delegation Consumer. */
async function reserveChildCreation(
  ctx: Context,
  task: TeamTaskSnapshot,
  objective: string,
  budgets: Readonly<Record<string, number>> = {},
): Promise<TeamChildCreateInput> {
  const state = await ctx.teams.getTeam({ teamId: task.teamId })
  if (state.team.authorityGrant === undefined) throw new Error('closure child fixture parent has no authority grant')
  const authorityGrant = { ...state.team.authorityGrant, workspaceModes: ['shared'] as const, readScopes: [], writeScopes: [] }
  const child = { goal: { objective, budgets }, rules: { workspacePath: process.cwd() }, budgets, authorityGrant }
  const input = {
    teamId: task.teamId, taskId: task.id, expectedCursor: state.team.cursor,
    expectedRevision: task.revision, delegationId: task.delegation!.id, child,
  }
  const reserved = await ctx.teams.beginTaskDelegation({ actor: delegationProof(ctx, { kind: 'delegation-begin', ...input }), ...input })
  const creation = reserved.delegation?.creation
  if (creation === undefined) throw new Error('closure child fixture reservation did not retain creation input')
  return creation
}

/** Issue one fixture-owned system-human endpoint proof for exact channel consent. */
function systemHumanAdmissionActor(
  ctx: Context,
  scope: TeamSystemChannelAdmissionScope,
): { readonly proof: TeamSystemChannelAdmissionProof; revoke(): void } {
  let proofs = channelAdmissionProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>()
    proofs = sourceProofs
    channelAdmissionProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemChannelAdmissionProofSource({
      name: 'team-run',
      resolveChannelAdmissionProof: proof => sourceProofs.get(proof),
    })
  }
  const proof = Object.freeze({}) as TeamSystemChannelAdmissionProof
  proofs.set(proof, scope)
  return Object.freeze({ proof, revoke: () => { proofs?.delete(proof) } })
}

/** Acknowledge one current system-owned human channel endpoint. */
async function acknowledgeSystemHumanChannel(ctx: Context, channelId: ChannelId, participantId: ParticipantSnapshot['id']): Promise<void> {
  const channel = await ctx.teams.getChannel({ channelId })
  const invitation = (await ctx.teams.getChannelAdmission({ channelId })).invitations.find(item => item.participantId === participantId)
  if (invitation === undefined || invitation.status === 'acknowledged') return
  const idempotencyKey = channelInvitationIdempotencyKeySchema.parse(`closure-human:${String(participantId)}`)
  const authority = systemHumanAdmissionActor(ctx, {
    kind: 'channel-invitation-acknowledge', teamId: channel.manifest.teamId, channelId, participantId,
    revision: invitation.revision, manifestFingerprint: fingerprintChannelManifest(channel.manifest), idempotencyKey,
  })
  try {
    await ctx.teams.acknowledgeChannelInvitation({
      actor: authority.proof, channelId, revision: invitation.revision,
      manifestFingerprint: fingerprintChannelManifest(channel.manifest), idempotencyKey,
    })
  } finally { authority.revoke() }
}

afterEach(async () => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Compose the Hub over an isolated SQLite journal. */
async function setup(
  config: { readonly maxTeamDepth?: number } = {},
  root?: string,
  backend: 'json' | 'sqlite' = 'sqlite',
): Promise<{ readonly ctx: Context; readonly root: string; dispose(): Promise<void> }> {
  const durableRoot = root ?? await freshRoot()
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    if (backend === 'json') {
      await ctx.plugin(StorageJson, { root: durableRoot })
    } else {
      await ctx.plugin(StorageSqlite, { path: join(durableRoot, 'team-hub.db') })
    }
    await ctx.plugin(StorageLog, { backend, routes: {} })
    await ctx.plugin(TeamHub, config)
    ctx.teams.registerAdapter(directV3Adapter)
    ctx.teams.registerAdapter(directV4Adapter)
    ctx.teams.registerAdapter(workflowChannelAdapter)
    controllerActivationAuthorities.set(ctx, activationAuthority(ctx, 'team-activation-controller'))
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
  return { ctx, root: durableRoot, async dispose() { await ctx.fiber.dispose() } }
}

/** Create a project-local directory for one storage-backed test. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-hub-closure-authority-'))
  roots.push(root)
  return root
}

/** The product direct-v3 roster used by TeamRun closure scopes. */
const directV3Adapter: TeamChannelAdapter = {
  type: 'direct',
  version: 3,
  validateCreate() {},
  initialState() { return { opened: true } },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan({ envelope }) {
    return (envelope.audience ?? []).map(participantId => ({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    }))
  },
  projectView() { return {} },
}
const directV4Adapter: TeamChannelAdapter = { ...directV3Adapter, version: 4 }

/** Invite and activate one Team participant. */
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

/** Bind an idle activation whose proof remains admissible while closure quiescence runs. */
async function bindIdleActivation(
  ctx: Context,
  teamId: TeamId,
  participantId: ParticipantSnapshot['id'],
  suffix: string,
): Promise<ActivationBindingSnapshot> {
  const state = await ctx.teams.getTeam({ teamId })
  const existing = state.activations.findLast(binding => binding.activation.participantId === participantId
    && (binding.activation.status === 'idle' || binding.activation.status === 'running')
    && String(binding.sessionId).startsWith('session-closure-direct-v4-'))
  if (existing !== undefined) return existing
  const input = {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(`activation-closure-${suffix}`),
        teamId,
        participantId,
        status: 'idle' as const,
      },
      sessionId: SessionId(`session-closure-${suffix}`),
      provider: 'closure-authority-test',
    },
  }
  const issued = controllerActivationAuthority(ctx).issue({ kind: 'activation-controller-bind', ...input })
  try {
    return await ctx.teams.bindActivation({ actor: issued.proof, ...input })
  } finally {
    issued.revoke()
  }
}

/** Open the default two-party TeamRun direct-v4 channel. */
async function openDirectV3(
  ctx: Context,
  teamId: TeamId,
  humanId: ParticipantSnapshot['id'],
  coordinatorId: ParticipantSnapshot['id'],
): Promise<ChannelSnapshot> {
  let state = await ctx.teams.getTeam({ teamId })
  if (!state.activations.some(binding => binding.activation.participantId === coordinatorId
    && (binding.activation.status === 'idle' || binding.activation.status === 'running'))) {
    await bindIdleActivation(ctx, teamId, coordinatorId, `direct-v4-${String(teamId)}`)
    state = await ctx.teams.getTeam({ teamId })
  }
  const opened = await openTestChannel(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    adapter: { type: 'direct', version: 4 },
    participants: [{ id: humanId, role: 'human' }, { id: coordinatorId, role: 'coordinator' }],
    limits: {},
  })
  await acknowledgeTestChannelActivations(ctx, opened.manifest.id)
  await acknowledgeSystemHumanChannel(ctx, opened.manifest.id, humanId)
  return await ctx.teams.getChannel({ channelId: opened.manifest.id })
}

/** Issue one revocable runtime activation authority. */
function issueActivation(ctx: Context, binding: ActivationBindingSnapshot): TeamActorProofLease {
  return ctx.teams.openActivationActorProofIssuer().issue(binding)
}

/** Retain each test fixture's canonical controller source without exposing it to production code. */
const controllerActivationAuthorities = new WeakMap<Context, ReturnType<typeof activationAuthority>>()

/** Return the controller authority installed by this fixture's isolated Hub setup. */
function controllerActivationAuthority(ctx: Context): ReturnType<typeof activationAuthority> {
  const authority = controllerActivationAuthorities.get(ctx)
  if (authority === undefined) throw new Error('closure-authority fixture has no controller activation source')
  return authority
}

/** Create one non-serializable proof that only a registered activation source can resolve. */
function activationProof(): TeamSystemActivationProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test activation proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemActivationProof
}

/** Register a source with individually revocable opaque activation lifecycle proofs. */
function activationAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemActivationScope): { readonly proof: TeamSystemActivationProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemActivationProof, TeamSystemActivationScope>()
  const dispose = ctx.teams.registerSystemActivationProofSource({
    name,
    resolveActivationProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = activationProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Register individually revocable proofs for exact generic channel lifecycle operations. */
function channelLifecycleAuthority(ctx: Context): {
  issue(scope: TeamSystemChannelLifecycleScope): { readonly proof: TeamSystemChannelLifecycleProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope>()
  const dispose = ctx.teams.registerSystemChannelLifecycleProofSource({
    name: 'team-channel-lifecycle',
    resolveChannelLifecycleProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof: object = {}
      Object.defineProperty(proof, 'toJSON', {
        enumerable: true,
        value: (): never => { throw new TypeError('test channel-lifecycle proofs are runtime-only') },
      })
      const actor = Object.freeze(proof) as TeamSystemChannelLifecycleProof
      proofs.set(actor, scope)
      return Object.freeze({ proof: actor, revoke: (): void => { proofs.delete(actor) } })
    },
    dispose,
  })
}

/** Persist one controller-owned status observation with an exact short-lived proof. */
async function updateActivationStatus(
  ctx: Context,
  binding: ActivationBindingSnapshot,
  status: 'starting' | 'running' | 'idle' | 'offline' | 'stopping',
): Promise<ActivationBindingSnapshot> {
  const state = await ctx.teams.getTeam({ teamId: binding.activation.teamId })
  const input = {
    teamId: binding.activation.teamId,
    activationId: binding.activation.id,
    expectedCursor: state.team.cursor,
    status,
  }
  const issued = controllerActivationAuthority(ctx).issue({
    kind: 'activation-controller-status',
    participantId: binding.activation.participantId,
    sessionId: binding.sessionId,
    provider: binding.provider,
    ...input,
  })
  try {
    const updated = await ctx.teams.updateActivationStatus({ actor: issued.proof, ...input })
    if (status !== 'offline') return updated
    const current = await ctx.teams.getTeam({ teamId: binding.activation.teamId })
    const currentBinding = current.activations.find(item => item.activation.id === binding.activation.id)
    if (currentBinding === undefined) return updated
    const quiesceInput = {
      teamId: currentBinding.activation.teamId,
      activationId: currentBinding.activation.id,
      participantId: currentBinding.activation.participantId,
      sessionId: currentBinding.sessionId,
      provider: currentBinding.provider,
      expectedCursor: current.team.cursor,
    }
    const quiesce = controllerActivationAuthority(ctx).issue({ kind: 'activation-controller-quiesce', ...quiesceInput })
    try {
      const settled = await ctx.teams.quiesceActivation({ actor: quiesce.proof, ...quiesceInput })
      return settled.activations.find(item => item.activation.id === currentBinding.activation.id) ?? updated
    } finally {
      quiesce.revoke()
    }
  } finally {
    issued.revoke()
  }
}

/** Create one non-serializable proof that only a registered test source can resolve. */
function closureProof(): TeamSystemClosureProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test closure proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemClosureProof
}

/** Register a source with individually revocable, source-owned closure proofs. */
function closureAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemClosureScope): { readonly proof: TeamSystemClosureProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemClosureProof, TeamSystemClosureScope>()
  const dispose = ctx.teams.registerSystemClosureProofSource({
    name,
    resolveClosureProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = closureProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: () => proofs.delete(proof) })
    },
    dispose,
  })
}

/** Create one non-serializable proof retained only by a closure-driver source. */
function closureDriverProof(): TeamSystemClosureDriverProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test closure-driver proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemClosureDriverProof
}

/** Register a source with independently revocable opaque closure-driver proofs. */
function closureDriverAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemClosureDriverScope): { readonly proof: TeamSystemClosureDriverProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemClosureDriverProof, TeamSystemClosureDriverScope>()
  const dispose = ctx.teams.registerSystemClosureDriverProofSource({
    name,
    resolveClosureDriverProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = closureDriverProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered final-receipt source can resolve. */
function finalReceiptProof(): TeamSystemFinalReceiptProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test final-receipt proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemFinalReceiptProof
}

/** Register a source with individually revocable opaque TeamRun final-receipt proofs. */
function finalReceiptAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemFinalReceiptScope): { readonly proof: TeamSystemFinalReceiptProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemFinalReceiptProof, TeamSystemFinalReceiptScope>()
  const dispose = ctx.teams.registerSystemFinalReceiptProofSource({
    name,
    resolveFinalReceiptProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = finalReceiptProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered phase source can resolve. */
function phaseProof(): TeamSystemPhaseProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test phase proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemPhaseProof
}

/** Register a source with individually revocable, source-owned phase proofs. */
function phaseAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemPhaseScope): { readonly proof: TeamSystemPhaseProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemPhaseProof, TeamSystemPhaseScope>()
  const dispose = ctx.teams.registerSystemPhaseProofSource({
    name,
    resolvePhaseProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = phaseProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: () => proofs.delete(proof) })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered maintenance source can resolve. */
function maintenanceProof(): TeamSystemMaintenanceProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test maintenance proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemMaintenanceProof
}

/** Register a source with individually revocable, source-owned maintenance proofs. */
function maintenanceAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemMaintenanceScope): { readonly proof: TeamSystemMaintenanceProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemMaintenanceProof, TeamSystemMaintenanceScope>()
  const dispose = ctx.teams.registerSystemMaintenanceProofSource({
    name,
    resolveMaintenanceProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = maintenanceProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered interrupt source can resolve. */
function interruptProof(): TeamSystemInterruptProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test interrupt proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemInterruptProof
}

/** Register a source with individually revocable, source-owned interrupt proofs. */
function interruptAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemInterruptScope): { readonly proof: TeamSystemInterruptProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemInterruptProof, TeamSystemInterruptScope>()
  const dispose = ctx.teams.registerSystemInterruptProofSource({
    name,
    resolveInterruptProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = interruptProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered scheduler source can resolve. */
function taskLeaseProof(): TeamSystemTaskLeaseProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test task-lease proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemTaskLeaseProof
}

/** Register a source with individually revocable opaque scheduler task-lease proofs. */
function taskLeaseAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemTaskLeaseScope): { readonly proof: TeamSystemTaskLeaseProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemTaskLeaseProof, TeamSystemTaskLeaseScope>()
  const dispose = ctx.teams.registerSystemTaskLeaseProofSource({
    name,
    resolveTaskLeaseProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = taskLeaseProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered TeamRun task-control source can resolve. */
function taskControlProof(): TeamSystemTaskControlProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test task-control proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemTaskControlProof
}

/** Register a source with individually revocable opaque TeamRun default-worker task-control proofs. */
function taskControlAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemTaskControlScope): { readonly proof: TeamSystemTaskControlProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemTaskControlProof, TeamSystemTaskControlScope>()
  const dispose = ctx.teams.registerSystemTaskControlProofSource({
    name,
    resolveTaskControlProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = taskControlProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered TeamRun cancellation-cleanup source can resolve. */
function cancellationCleanupProof(): TeamSystemCancellationCleanupProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test cancellation-cleanup proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemCancellationCleanupProof
}

/** Register a source with individually revocable opaque TeamRun cancellation-cleanup proofs. */
function cancellationCleanupAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemCancellationCleanupScope): { readonly proof: TeamSystemCancellationCleanupProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemCancellationCleanupProof, TeamSystemCancellationCleanupScope>()
  const dispose = ctx.teams.registerSystemCancellationCleanupProofSource({
    name,
    resolveCancellationCleanupProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = cancellationCleanupProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered TeamRun finalization-cleanup source can resolve. */
function finalizationCleanupProof(): TeamSystemFinalizationCleanupProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test finalization-cleanup proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemFinalizationCleanupProof
}

/** Register a source with individually revocable opaque TeamRun finalization-cleanup proofs. */
function finalizationCleanupAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemFinalizationCleanupScope): { readonly proof: TeamSystemFinalizationCleanupProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemFinalizationCleanupProof, TeamSystemFinalizationCleanupScope>()
  const dispose = ctx.teams.registerSystemFinalizationCleanupProofSource({
    name,
    resolveFinalizationCleanupProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = finalizationCleanupProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered TeamRun topology source can resolve. */
function topologyProof(): TeamSystemTopologyProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test topology proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemTopologyProof
}

/** Register a source with independently revocable exact TeamRun topology scopes. */
function topologyAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemTopologyScope): { readonly proof: TeamSystemTopologyProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemTopologyProof, TeamSystemTopologyScope>()
  const dispose = ctx.teams.registerSystemTopologyProofSource({
    name,
    resolveTopologyProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = topologyProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered TeamRun workflow source can resolve. */
function workflowProof(): TeamSystemWorkflowProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test workflow proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemWorkflowProof
}

/** Register a source with individually revocable opaque TeamRun workflow compiler proofs. */
function workflowAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemWorkflowScope): { readonly proof: TeamSystemWorkflowProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemWorkflowProof, TeamSystemWorkflowScope>()
  const dispose = ctx.teams.registerSystemWorkflowProofSource({
    name,
    resolveWorkflowProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = workflowProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Create one non-serializable proof that only a registered scheduler channel source can resolve. */
function schedulerChannelProof(): TeamSystemSchedulerChannelProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test scheduler channel proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemSchedulerChannelProof
}

/** Register a source with individually revocable opaque scheduler review and wake channel proofs. */
function schedulerChannelAuthority(ctx: Context, name: string): {
  issue(scope: TeamSystemSchedulerChannelScope): { readonly proof: TeamSystemSchedulerChannelProof; revoke(): void }
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemSchedulerChannelProof, TeamSystemSchedulerChannelScope>()
  const dispose = ctx.teams.registerSystemSchedulerChannelProofSource({
    name,
    resolveSchedulerChannelProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = schedulerChannelProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}

/** Return one retry-stable cancellation request excluding its runtime authority. */
function cancellationInput(teamId: TeamId, expectedCursor: number) {
  return {
    teamId,
    expectedCursor,
    idempotencyKey: teamClosureIdempotencyKeySchema.parse(`closure-authority-cancel-${teamId}`),
    reason: { code: 'USER_CANCELLED', message: 'The current TeamRun requested cancellation.' },
  }
}

/** Seed only a durable TeamRun cancellation intent for post-release cleanup authority tests. */
async function seedTeamRunCancellation(ctx: Context, teamId: TeamId): Promise<TeamCancellationSnapshot> {
  const hub = ctx.teams as unknown as {
    readonly teams: ReadonlyMap<TeamId, {
      readonly queue: { run<T>(operation: () => Promise<T>): Promise<T> }
      readonly projection: { readonly team: { readonly updatedAt: number; readonly phase: TeamPhase } }
    }>
    commitTeamCommand(
      loaded: unknown,
      records: readonly TeamJournalRecord[],
      code: 'TEAM_INVALID_ARGUMENT',
    ): Promise<void>
  }
  const loaded = hub.teams.get(teamId)
  if (loaded === undefined) throw new Error(`Team Hub did not retain the cancellation cleanup fixture Team '${teamId}'`)
  const cancellation = await loaded.queue.run(async () => {
    const requestedAt = Math.max(Date.now(), loaded.projection.team.updatedAt + 1)
    const value: TeamCancellationSnapshot = {
      teamId,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse(`cancellation-cleanup-${teamId}`),
      actor: { kind: 'system', name: 'team-run' },
      reason: { code: 'TEAM_RUN_CANCELLED', message: 'Seeded TeamRun cancellation cleanup.' },
      requestedAt,
    }
    const records: TeamJournalRecord[] = [{ type: 'team/cancellation', cancellation: value, createdAt: requestedAt }]
    if (loaded.projection.team.phase !== 'quiescing') {
      records.push({ type: 'team/phase', phase: 'quiescing', createdAt: requestedAt })
    }
    await hub.commitTeamCommand(loaded, records, 'TEAM_INVALID_ARGUMENT')
    return value
  })
  return structuredClone(cancellation)
}

/** Seed an already durable closure intent for a recovery-only lifecycle fixture. */
async function seedClosureIntent(
  ctx: Context,
  teamId: TeamId,
  fields: Omit<TeamClosureSnapshot, 'teamId' | 'requestedAt'>,
): Promise<TeamClosureSnapshot> {
  const hub = ctx.teams as unknown as {
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
  const loaded = hub.teams.get(teamId)
  if (loaded === undefined) throw new Error(`Team Hub did not retain the closure recovery fixture Team '${teamId}'`)
  const state = await ctx.teams.getTeam({ teamId })
  const closure = await loaded.queue.run(async () => {
    const requestedAt = Math.max(Date.now(), loaded.projection.team.updatedAt + 1)
    const value: TeamClosureSnapshot = { teamId, ...structuredClone(fields), requestedAt }
    const records: TeamJournalRecord[] = [{ type: 'team/closure', closure: value, createdAt: requestedAt }]
    if (value.kind === 'complete') {
      records.push({
        type: 'goal/changed',
        goal: { ...state.team.goal, revision: state.team.goal.revision + 1, phase: 'complete' },
        createdAt: requestedAt,
      }, { type: 'team/phase', phase: 'quiescing', createdAt: requestedAt })
    } else if (value.kind === 'fail' && state.team.phase !== 'quiescing') {
      records.push({ type: 'team/phase', phase: 'quiescing', createdAt: requestedAt })
    }
    await hub.commitTeamCommand(loaded, records, 'TEAM_INVALID_ARGUMENT')
    return value
  })
  return structuredClone(closure)
}

/** Seed one terminal participant phase for a usage-rejection fixture without inventing a topology departure authority. */
async function seedParticipantPhase(
  ctx: Context,
  teamId: TeamId,
  participantId: ParticipantSnapshot['id'],
  phase: 'left' | 'failed',
): Promise<void> {
  const hub = ctx.teams as unknown as {
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
  const loaded = hub.teams.get(teamId)
  if (loaded === undefined) throw new Error(`Team Hub did not retain participant phase fixture Team '${teamId}'`)
  const state = await ctx.teams.getTeam({ teamId })
  const participant = state.participants.find(candidate => candidate.id === participantId)
  if (participant === undefined) throw new Error(`Team '${teamId}' has no fixture participant '${participantId}'`)
  await loaded.queue.run(async () => {
    const createdAt = Math.max(Date.now(), loaded.projection.team.updatedAt + 1)
    await hub.commitTeamCommand(loaded, [{
      type: 'participant/changed',
      participant: { ...participant, phase },
      createdAt,
    }], 'TEAM_INVALID_ARGUMENT')
  })
}

/** Locate the authoritative storage handle for a precise durable-append failure window. */
function finalSinkLog(ctx: Context, kind: 'team' | 'channel', id: TeamId | ChannelId) {
  type Stream = Awaited<ReturnType<Context['storageLog']['open']>>
  const hub = ctx.teams as unknown as {
    teams: ReadonlyMap<TeamId | ChannelId, { readonly stream: Stream }>
    channels: ReadonlyMap<TeamId | ChannelId, { readonly stream: Stream }>
  }
  const loaded = (kind === 'team' ? hub.teams : hub.channels).get(id)
  if (loaded === undefined) throw new Error(`missing ${kind} log for final admission fault injection`)
  return loaded.stream
}

/** Create one active closed result sink and a committed coordinator final. */
async function finalSinkFixture(ctx: Context, ttlMs?: number, existingTeamId?: TeamId) {
  const created = existingTeamId === undefined
    ? await createTestRootTeam(ctx, { goal: { objective: 'Accept one durable final.', budgets: {} }, rules: {}, budgets: {} })
    : await ctx.teams.getTeam({ teamId: existingTeamId })
  const human = await activeParticipant(ctx, created.team.id, 'human', 'human', 'Human')
  const coordinator = await activeParticipant(ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
  const binding = await bindIdleActivation(ctx, created.team.id, coordinator.id, 'final-sink')
  const channel = await openDirectV3(ctx, created.team.id, human.id, coordinator.id)
  const actor = issueActivation(ctx, binding)
  const final = await ctx.teams.postChannelEnvelope({ actor: actor.proof, expectedCursor: channel.cursor,
    draft: { channelId: channel.manifest.id, audience: [human.id], kind: 'final', payload: { text: 'The exact accepted result.' },
      delivery: 'turn', ...ttlMs === undefined ? {} : { ttlMs } } })
  actor.revoke()
  const source = finalReceiptAuthority(ctx, 'team-run')
  const scope = { teamId: created.team.id, channelId: channel.manifest.id, humanId: human.id, coordinatorId: coordinator.id }
  return { human, coordinator, binding, channel, final, source, scope }
}

/** Read only final-sink business records from the persisted Team audit projection. */
async function finalAdmissions(ctx: Context, final: TeamEnvelope) {
  const audit = await ctx.teams.readAudit({ teamId: final.teamId, afterCursor: -1, limit: 128 })
  return audit.items.filter(item => item.type === 'team/final-admitted')
}

describe('TeamHub closed final sink', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    for (const phase of ['paused', 'blocked'] as const) {
      it(`leaves a ${phase} objective's final unadmitted until it resumes on ${backend}`, async () => {
        const harness = await setup({}, undefined, backend)
        const fixture = await finalSinkFixture(harness.ctx)
        const goalActor = issueActivation(harness.ctx, fixture.binding)
        const recipient = fixture.source.issue(fixture.scope)
        try {
          const current = await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })
          const suspended = await harness.ctx.teams.transitionTeamGoalPhase({
            actor: goalActor.proof, teamId: fixture.final.teamId, expectedRevision: current.goal.revision, phase,
            ...phase === 'blocked' ? { blocker: { code: 'WAITING_FOR_INPUT', message: 'The objective needs another input.' } } : {},
          })
          await expect(admitTestFinal(harness.ctx, recipient.proof, fixture.final))
            .rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
          expect(await finalAdmissions(harness.ctx, fixture.final)).toEqual([])
          expect((await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })).team.cursor).toBe(suspended.team.cursor)
          const delivery = await harness.ctx.teams.readChannel({ channelId: fixture.final.channelId, afterCursor: -1 })
          expect(delivery.records.some(record => record.type === 'channel/receipt')).toBe(false)
          await harness.ctx.teams.transitionTeamGoalPhase({
            actor: goalActor.proof, teamId: fixture.final.teamId, expectedRevision: suspended.goal.revision, phase: 'active',
          })
          await expect(admitTestFinal(harness.ctx, recipient.proof, fixture.final)).resolves.toMatchObject({
            envelopeId: fixture.final.id, recipientId: fixture.human.id,
          })
          expect(await finalAdmissions(harness.ctx, fixture.final)).toHaveLength(1)
        } finally { goalActor.revoke(); recipient.revoke(); fixture.source.dispose(); await harness.dispose() }
      })
    }

    for (const kind of ['cancel', 'fail', 'complete'] as const) {
      it(`keeps human-action admission closed after ${kind} intent on ${backend}`, async () => {
        const harness = await setup({}, undefined, backend)
        const fixture = await finalSinkFixture(harness.ctx)
        const teamId = fixture.final.teamId
        const host = testHumanActionAuthority(harness.ctx)
        const action = (suffix: string) => ({
          id: teamHumanActionIdSchema.parse(`question:cancellation-${suffix}`), teamId, kind: 'question' as const, phase: 'pending' as const,
          sessionId: fixture.binding.sessionId, participantId: fixture.coordinator.id,
          sourceId: teamHumanActionSourceIdSchema.parse(`question-cancellation-${suffix}`),
          details: { question: 'Continue this work?' }, createdAt: 0, updatedAt: 0,
        })
        const upsert = async (pending: ReturnType<typeof action>) => {
          const input = { teamId, expectedCursor: (await harness.ctx.teams.getTeam({ teamId })).team.cursor }
          const proof = host.issue({ kind: 'host-human-action-upsert', ...input, action: pending })
          try { return await harness.ctx.teams.upsertHumanAction({ actor: proof.proof, ...input }) }
          finally { proof.revoke() }
        }
        const actor = issueActivation(harness.ctx, fixture.binding)
        try {
          const initial = action('existing')
          await upsert(initial)
          const resolve = async () => {
            const input = { teamId, expectedCursor: (await harness.ctx.teams.getTeam({ teamId })).team.cursor }
            const proof = host.issue({ kind: 'host-human-action-resolve', ...input, action: initial,
              phase: 'resolved', outcome: { answer: 'Continue this work.' } })
            try { return await harness.ctx.teams.resolveHumanAction({ actor: proof.proof, ...input }) }
            finally { proof.revoke() }
          }
          if (kind === 'complete') {
            const recipient = fixture.source.issue(fixture.scope)
            try {
              await expect(admitTestFinal(harness.ctx, recipient.proof, fixture.final)).rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })
              expect(await finalAdmissions(harness.ctx, fixture.final)).toEqual([])
            } finally { recipient.revoke() }
            await resolve()
          }
          const before = await harness.ctx.teams.getTeam({ teamId })
          const input = { ...cancellationInput(teamId, before.team.cursor),
            reason: { code: 'OWNER_CLOSING', message: 'The owner selected a lifecycle operation.' } }
          const close = async () => {
            if (kind === 'cancel') return await harness.ctx.teams.cancelTeam({ actor: actor.proof, ...input })
            if (kind === 'fail') return await harness.ctx.teams.failTeam({ actor: actor.proof, ...input })
            const closer = closureAuthority(harness.ctx, 'team-run')
            const proof = closer.issue({ kind: 'team-run-complete', ...fixture.scope, finalEnvelopeId: fixture.final.id })
            try {
              return await harness.ctx.teams.completeTeam({ actor: proof.proof, ...input,
                finalChannelId: fixture.final.channelId, finalEnvelopeId: fixture.final.id })
            } finally { proof.revoke(); closer.dispose() }
          }
          const closing = await close()
          expect(closing.humanActions).toMatchObject([{
            id: initial.id, phase: kind === 'cancel' ? 'cancelled' : kind === 'fail' ? 'pending' : 'resolved',
            ...kind === 'cancel' ? { outcome: { kind: 'team-cancelled' } } : {},
          }])
          expect(closing.team.phase).toBe('quiescing')
          const policies: unknown[] = []
          const unregister = harness.ctx.teams.registerPolicy('human-action', {
            name: 'observe-human-admission-after-closure',
            async apply(request, next) { policies.push(request); return await next() },
          })
          try {
            await expect(upsert(initial)).resolves.toEqual(closing.humanActions?.[0])
            await expect(upsert(action('late'))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
            expect(policies).toEqual([])
            expect(await harness.ctx.teams.getTeam({ teamId })).toEqual(closing)
          } finally { unregister() }
          if (kind === 'fail') {
            await expect(resolve()).resolves.toMatchObject({ id: initial.id, phase: 'resolved', outcome: { answer: 'Continue this work.' } })
          }
        } finally { actor.revoke(); fixture.source.dispose(); await harness.dispose() }
      })
    }

    it(`rejects root final admission for a child and repairs its failed parent charge on ${backend}`, async () => {
      const harness = await setup({ maxTeamDepth: 1 }, undefined, backend)
      const parent = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Own the child final usage.', budgets: {} }, rules: {}, budgets: {},
      })
      const parentCoordinator = await activeParticipant(harness.ctx, parent.team.id, 'local-agent', 'coordinator', 'Parent coordinator')
      await bindIdleActivation(harness.ctx, parent.team.id, parentCoordinator.id, 'parent-final-charge')
      const parentState = await harness.ctx.teams.getTeam({ teamId: parent.team.id })
      if (parentState.team.authorityGrant === undefined) throw new Error('parent final fixture has no authority grant')
      const parentGrant = { ...parentState.team.authorityGrant, workspaceModes: ['shared'] as const, readScopes: [], writeScopes: [] }
      const parentTask = await createTestCoordinatorTask(harness.ctx, {
        teamId: parent.team.id, expectedCursor: parentState.team.cursor,
        subject: 'Own child usage', description: 'Collect this child result.', blockedBy: [], requiredCapabilities: [], priority: 0,
        readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
        execution: { kind: 'child-team', templateId: 'closure-child', templateVersion: 1, authorityGrant: parentGrant, budget: {} },
      })
      const child = await createTestChildTeam(harness.ctx, await reserveChildCreation(harness.ctx, parentTask, 'Report one charged child result.'))
      const fixture = await finalSinkFixture(harness.ctx, undefined, child.team.id)
      const actor = issueActivation(harness.ctx, fixture.binding)
      const recipient = fixture.source.issue(fixture.scope)
      const unregister = harness.ctx.teams.registerPolicy('usage', {
        name: 'defer-parent-final-charge',
        async apply(request, next) {
          if (request.facts.chargeId !== undefined) {
            return { kind: 'deny', code: 'PARENT_NOT_READY', message: 'The parent charge is temporarily unavailable.' }
          }
          return await next()
        },
      })
      const sample = { id: teamUsageSampleIdSchema.parse('pending-parent-final-charge'), turn: 1, step: 0,
        usage: { inputTokens: 1, outputTokens: 1 } }
      try {
        await expect(harness.ctx.teams.recordUsage({ actor: actor.proof,
          expectedCursor: (await harness.ctx.teams.getTeam({ teamId: child.team.id })).team.cursor, sample }))
          .rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
        const pending = await harness.ctx.teams.getTeam({ teamId: child.team.id })
        const audit = await harness.ctx.teams.readAudit({ teamId: child.team.id, afterCursor: -1, limit: 128 })
        const record = audit.items.find(item => item.type === 'usage/parent-charge-pending')
        if (record === undefined) throw new Error('usage rejection did not retain its parent charge')
        const charge = teamUsageChargeSchema.parse(record.facts.charge)
        const rejection: unknown = await admitTestFinal(harness.ctx, recipient.proof, fixture.final).catch((error: unknown) => error)
        expect(rejection).toMatchObject({ code: 'TEAM_FINAL_INVALID' })
        expect(rejection).toBeInstanceOf(Error)
        expect((rejection as Error).message).toContain('Child completion requires its parent-service result')
        expect((rejection as Error).message).not.toContain(charge.id)
        expect(await finalAdmissions(harness.ctx, fixture.final)).toEqual([])
        expect((await harness.ctx.teams.getTeam({ teamId: child.team.id })).team.cursor).toBe(pending.team.cursor)
        unregister()
        await harness.ctx.teams.recordUsage({ actor: actor.proof, expectedCursor: pending.team.cursor, sample })
        await expect(admitTestFinal(harness.ctx, recipient.proof, fixture.final))
          .rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
        expect(await finalAdmissions(harness.ctx, fixture.final)).toEqual([])
        expect((await harness.ctx.teams.getTeam({ teamId: parent.team.id })).usage).toMatchObject({ inputTokens: 1, outputTokens: 1 })
      } finally { unregister(); recipient.revoke(); actor.revoke(); fixture.source.dispose(); await harness.dispose() }
    })

    it(`preserves an already completed objective when selecting final closure on ${backend}`, async () => {
      const harness = await setup({}, undefined, backend)
      const fixture = await finalSinkFixture(harness.ctx)
      const actor = issueActivation(harness.ctx, fixture.binding)
      const source = closureAuthority(harness.ctx, 'team-run')
      const closing = source.issue({ kind: 'team-run-complete', ...fixture.scope, finalEnvelopeId: fixture.final.id })
      try {
        const initial = await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })
        const completedGoal = await harness.ctx.teams.transitionTeamGoalPhase({ actor: actor.proof,
          teamId: fixture.final.teamId, expectedRevision: initial.goal.revision, phase: 'complete' })
        const selected = await harness.ctx.teams.completeTeam({ actor: closing.proof, teamId: fixture.final.teamId,
          expectedCursor: completedGoal.team.cursor, idempotencyKey: teamClosureIdempotencyKeySchema.parse('completed-objective-final'),
          reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'The completed objective now has its final selection.' },
          finalChannelId: fixture.final.channelId, finalEnvelopeId: fixture.final.id })
        expect(selected.team.phase).toBe('quiescing')
        expect(selected.goal).toEqual(completedGoal.goal)
        expect(selected.team.closure?.finalEnvelopeId).toBe(fixture.final.id)
        const audit = await harness.ctx.teams.readAudit({ teamId: fixture.final.teamId, afterCursor: -1, limit: 128 })
        expect(audit.items.filter(item => item.type === 'goal/changed')).toHaveLength(1)
      } finally { closing.revoke(); source.dispose(); actor.revoke(); fixture.source.dispose(); await harness.dispose() }
    })

    it(`leaves completion selection available until a stalled Team resumes on ${backend}`, async () => {
      const harness = await setup({}, undefined, backend)
      const fixture = await finalSinkFixture(harness.ctx)
      const source = closureAuthority(harness.ctx, 'team-run')
      const scheduler = phaseAuthority(harness.ctx, 'team-scheduler-dag')
      const resumer = phaseAuthority(harness.ctx, 'team-run')
      const closing = source.issue({ kind: 'team-run-complete', ...fixture.scope, finalEnvelopeId: fixture.final.id })
      try {
        const initial = await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })
        const reason = { code: 'OWNER_NOT_READY', message: 'The scheduler is waiting for the owner to resume.' }
        const stall = scheduler.issue({ kind: 'scheduler-stall', teamId: initial.team.id, phase: 'stalled', reason })
        let stalled: typeof initial
        try {
          stalled = await harness.ctx.teams.transitionTeamPhase({ actor: stall.proof,
            teamId: initial.team.id, expectedCursor: initial.team.cursor, phase: 'stalled', reason })
        } finally { stall.revoke() }
        const input = { actor: closing.proof, teamId: initial.team.id, expectedCursor: stalled.team.cursor,
          idempotencyKey: teamClosureIdempotencyKeySchema.parse('resumed-completion-selection'),
          reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'Select the final after the owner resumes.' },
          finalChannelId: fixture.final.channelId, finalEnvelopeId: fixture.final.id }
        await expect(harness.ctx.teams.completeTeam(input)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
        expect(await harness.ctx.teams.getTeam({ teamId: initial.team.id })).toEqual(stalled)
        expect(await finalAdmissions(harness.ctx, fixture.final)).toEqual([])
        const resume = resumer.issue({ kind: 'team-run-resume', teamId: initial.team.id, phase: 'active' })
        let active: typeof initial
        try {
          active = await harness.ctx.teams.transitionTeamPhase({ actor: resume.proof,
            teamId: initial.team.id, expectedCursor: stalled.team.cursor, phase: 'active' })
        } finally { resume.revoke() }
        await expect(harness.ctx.teams.completeTeam({ ...input, expectedCursor: active.team.cursor })).resolves.toMatchObject({
          team: { phase: 'quiescing', closure: { idempotencyKey: input.idempotencyKey, finalEnvelopeId: fixture.final.id } },
        })
      } finally {
        closing.revoke(); resumer.dispose(); scheduler.dispose(); source.dispose(); fixture.source.dispose()
        await harness.dispose()
      }
    })

    for (const blocker of ['pending task', 'compiling workflow'] as const) {
      it(`defers first final admission while a ${blocker} remains on ${backend}`, async () => {
        const harness = await setup({}, undefined, backend)
        const fixture = await finalSinkFixture(harness.ctx)
        const actor = issueActivation(harness.ctx, fixture.binding)
        const recipient = fixture.source.issue(fixture.scope)
        const controls = taskControlAuthority(harness.ctx, 'team-run')
        const workflows = workflowAuthority(harness.ctx, 'team-run')
        const coordinator = { teamId: fixture.final.teamId, participantId: fixture.coordinator.id,
          activationId: fixture.binding.activation.id, sessionId: fixture.binding.sessionId, provider: fixture.binding.provider }
        const specification = { subject: 'Unfinished work', description: 'Finish the admitted work before selecting a final.',
          blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared' as const,
          budget: {}, reviewPolicy: { kind: 'none' as const }, maxAttempts: 1 }
        try {
          const state = await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })
          let settle: () => Promise<unknown>
          if (blocker === 'pending task') {
            const task = await createTestCoordinatorTask(harness.ctx, { teamId: fixture.final.teamId,
              expectedCursor: state.team.cursor, ...specification })
            settle = async () => {
              const input = { teamId: fixture.final.teamId, taskId: task.id, expectedRevision: task.revision }
              const proof = controls.issue({ kind: 'team-run-default-worker-cancel', coordinator, ...input })
              try { return await harness.ctx.teams.cancelTask({ actor: proof.proof, ...input }) }
              finally { proof.revoke() }
            }
          } else {
            const plan = await harness.ctx.teams.admitWorkflowPlan({ actor: actor.proof, teamId: fixture.final.teamId,
              expectedCursor: state.team.cursor, idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('final-compiling-workflow'),
              plan: teamWorkflowPlanSchema.parse({
                name: 'Pending final work', version: 1, tasks: [{ id: 'first', ...specification }],
                bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
                channel: { participantRoles: ['coordinator', 'human'], graph: {
                  initial: { kind: 'participant', role: 'coordinator' },
                  transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1,
                } }, result: { kind: 'task-results', taskTemplateIds: ['first'] },
              }) })
            settle = async () => {
              const input = { teamId: fixture.final.teamId, planId: plan.id,
                expectedCursor: (await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })).team.cursor,
                expectedRevision: plan.revision, phase: 'failed' as const,
                failure: { code: 'COMPILATION_STOPPED', message: 'The owner ended the unfinished compilation.' } }
              const proof = workflows.issue({ kind: 'team-run-workflow-plan-phase', coordinator, ...input })
              try { return await harness.ctx.teams.transitionWorkflowPlan({ actor: proof.proof, ...input }) }
              finally { proof.revoke() }
            }
          }
          const blocked = await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })
          await expect(admitTestFinal(harness.ctx, recipient.proof, fixture.final)).rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })
          expect(await finalAdmissions(harness.ctx, fixture.final)).toEqual([])
          expect((await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })).team.cursor).toBe(blocked.team.cursor)
          await settle()
          await expect(admitTestFinal(harness.ctx, recipient.proof, fixture.final)).resolves.toMatchObject({ envelopeId: fixture.final.id })
          expect(await finalAdmissions(harness.ctx, fixture.final)).toHaveLength(1)
        } finally {
          workflows.dispose(); controls.dispose(); recipient.revoke(); actor.revoke(); fixture.source.dispose()
          await harness.dispose()
        }
      })
    }

    for (const policy of ['close', 'dispatch'] as const) {
      it(`leaves the first final result unreserved when ${policy} policy denies on ${backend}`, async () => {
        const harness = await setup({}, undefined, backend)
        const fixture = await finalSinkFixture(harness.ctx)
        const recipient = fixture.source.issue(fixture.scope)
        let deny = true
        let calls = 0
        const unregister = harness.ctx.teams.registerPolicy(policy, {
          name: `deny-first-final-${policy}`,
          async apply(request, next) {
            if (request.facts.operation === 'final-admission') {
              calls += 1
              if (deny) return { kind: 'deny', code: 'FINAL_NOT_READY', message: 'The result owner is not ready to accept the final.' }
            }
            return await next()
          },
        })
        try {
          const initial = await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })
          await expect(admitTestFinal(harness.ctx, recipient.proof, fixture.final)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
          expect(await finalAdmissions(harness.ctx, fixture.final)).toEqual([])
          const rejected = await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })
          expect(rejected.goal).toEqual(initial.goal)
          expect(rejected.team.phase).toBe('active')
          expect(rejected.team.closure).toBeUndefined()
          expect((await harness.ctx.teams.readChannel({ channelId: fixture.final.channelId, afterCursor: -1 })).records
            .filter(record => record.type === 'channel/receipt')).toEqual([])
          deny = false
          const accepted = await admitTestFinal(harness.ctx, recipient.proof, fixture.final)
          const acceptedCalls = calls
          deny = true
          await expect(admitTestFinal(harness.ctx, recipient.proof, fixture.final)).resolves.toEqual(accepted)
          expect(calls).toBe(acceptedCalls)
          expect(await finalAdmissions(harness.ctx, fixture.final)).toHaveLength(1)
        } finally { unregister(); recipient.revoke(); fixture.source.dispose(); await harness.dispose() }
      })
    }

    it(`binds final admission retries to content and revalidates the source proof on ${backend}`, async () => {
      const harness = await setup({}, undefined, backend)
      const fixture = await finalSinkFixture(harness.ctx)
      const { final, source, scope } = fixture
      let authority = source.issue(scope)
      const input = { teamId: final.teamId, channelId: final.channelId, envelopeId: final.id,
        envelopeSequence: final.sequence, contentFingerprint: fingerprintTeamFinalContent(final.payload),
        idempotencyKey: teamFinalAdmissionIdempotencyKeySchema.parse(`team-run-final:${final.teamId}`),
      }
      try {
        await expect(harness.ctx.teams.ackChannelEnvelope({ actor: authority.proof, channelId: final.channelId,
          envelopeId: final.id, expectedCursor: (await harness.ctx.teams.getChannel({ channelId: final.channelId })).cursor }))
          .rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
        await expect(harness.ctx.teams.admitTeamFinalResult({ ...input, actor: {} as TeamSystemFinalReceiptProof }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        const provider = harness.ctx.teams as unknown as {
          ensureTeam(id: TeamId): Promise<unknown>
          ensureAttachedChannel(id: ChannelId): Promise<unknown>
        }
        const ensureTeam = vi.spyOn(provider, 'ensureTeam')
        const ensureChannel = vi.spyOn(provider, 'ensureAttachedChannel')
        const open = vi.spyOn(harness.ctx.storageLog, 'open')
        const list = vi.spyOn(harness.ctx.storageLog, 'list')
        try {
          for (const selection of [{ teamId: 'foreign-team' as TeamId }, { channelId: 'foreign-channel' as ChannelId }]) {
            await expect(harness.ctx.teams.admitTeamFinalResult({ ...input, ...selection, actor: authority.proof }))
              .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
          }
          expect(ensureTeam).not.toHaveBeenCalled()
          expect(ensureChannel).not.toHaveBeenCalled()
          expect(open).not.toHaveBeenCalled()
          expect(list).not.toHaveBeenCalled()
        } finally { ensureTeam.mockRestore(); ensureChannel.mockRestore(); open.mockRestore(); list.mockRestore() }
        const foreign = source.issue({ ...scope, channelId: 'foreign-channel' as ChannelId })
        await expect(harness.ctx.teams.admitTeamFinalResult({ ...input, actor: foreign.proof }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        foreign.revoke()
        for (const fields of [{ envelopeSequence: final.sequence + 1 }, { contentFingerprint: fingerprintTeamFinalContent({ text: 'Another result' }) }]) {
          await expect(harness.ctx.teams.admitTeamFinalResult({ ...input, ...fields, actor: authority.proof }))
            .rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
        }
        const unregister = harness.ctx.teams.registerPolicy('dispatch', { name: 'revoke-final-admission',
          async apply(request, next) { if (request.facts.operation === 'final-admission') authority.revoke(); return await next() } })
        await expect(harness.ctx.teams.admitTeamFinalResult({ ...input, actor: authority.proof }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        unregister()
        expect(await finalAdmissions(harness.ctx, final)).toHaveLength(0)
        authority = source.issue(scope)
        const admitted = await harness.ctx.teams.admitTeamFinalResult({ ...input, actor: authority.proof })
        expect(admitted).toMatchObject({ recipientId: fixture.human.id, owner: { kind: 'system' }, contentFingerprint: input.contentFingerprint })
        await expect(harness.ctx.teams.admitTeamFinalResult({ ...input, actor: authority.proof })).resolves.toEqual(admitted)
        await expect(harness.ctx.teams.admitTeamFinalResult({ ...input, actor: authority.proof,
          idempotencyKey: teamFinalAdmissionIdempotencyKeySchema.parse('another-key') })).rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
        await expect(harness.ctx.teams.admitTeamFinalResult({ ...input, actor: authority.proof,
          contentFingerprint: fingerprintTeamFinalContent({ text: 'Changed retry' }) })).rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
        const posting = issueActivation(harness.ctx, fixture.binding)
        const changed = await harness.ctx.teams.postChannelEnvelope({ actor: posting.proof,
          expectedCursor: (await harness.ctx.teams.getChannel({ channelId: final.channelId })).cursor,
          draft: { channelId: final.channelId, audience: [fixture.human.id], kind: 'final',
            payload: { text: 'Different valid final.' }, delivery: 'turn' } })
        posting.revoke()
        await expect(admitTestFinal(harness.ctx, authority.proof, changed)).rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
        authority.revoke()
        await expect(harness.ctx.teams.admitTeamFinalResult({ ...input, actor: authority.proof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        expect(await finalAdmissions(harness.ctx, final)).toHaveLength(1)
      } finally { authority.revoke(); source.dispose(); await harness.dispose() }
    })

    it(`rejects an expired unreceipted final before reserving completion intent on ${backend}`, async () => {
      const harness = await setup({}, undefined, backend)
      const fixture = await finalSinkFixture(harness.ctx, 1)
      const { final, scope } = fixture
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(final.createdAt + 2)
      const expiry = schedulerChannelAuthority(harness.ctx, 'team-scheduler-dag')
      const closer = closureAuthority(harness.ctx, 'team-run')
      try {
        let state = await harness.ctx.teams.getTeam({ teamId: final.teamId })
        const input = { teamId: final.teamId, channelId: final.channelId, expectedTeamCursor: state.team.cursor,
          expectedChannelCursor: (await harness.ctx.teams.getChannel({ channelId: final.channelId })).cursor,
          now: final.createdAt + 2, limit: 1 }
        const expireProof = expiry.issue({ kind: 'scheduler-channel-delivery-expire', ...input })
        expect((await harness.ctx.teams.expireSchedulerChannelDeliveries({ actor: expireProof.proof, ...input })).expired)
          .toMatchObject([{ envelopeId: final.id }])
        expireProof.revoke()
        const actor = closer.issue({ kind: 'team-run-complete', ...scope, finalEnvelopeId: final.id })
        const complete = { teamId: final.teamId, expectedCursor: state.team.cursor,
          idempotencyKey: teamClosureIdempotencyKeySchema.parse('final-complete'), actor: actor.proof,
          reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'Accept the current final.' },
          finalChannelId: final.channelId, finalEnvelopeId: final.id }
        await expect(harness.ctx.teams.completeTeam(complete)).rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
        actor.revoke()
        state = await harness.ctx.teams.getTeam({ teamId: final.teamId })
        expect(state.team).toMatchObject({ phase: 'active' })
        expect(state.team.closure).toBeUndefined()
        expect(await finalAdmissions(harness.ctx, final)).toHaveLength(0)
        const posting = issueActivation(harness.ctx, fixture.binding)
        const replacement = await harness.ctx.teams.postChannelEnvelope({ actor: posting.proof,
          expectedCursor: (await harness.ctx.teams.getChannel({ channelId: final.channelId })).cursor,
          draft: { channelId: final.channelId, audience: [fixture.human.id], kind: 'final',
            payload: { text: 'Current final result.' }, delivery: 'turn' } })
        posting.revoke()
        const accepted = closer.issue({ kind: 'team-run-complete', ...scope, finalEnvelopeId: replacement.id })
        await expect(harness.ctx.teams.completeTeam({ ...complete, actor: accepted.proof,
          expectedCursor: state.team.cursor, finalEnvelopeId: replacement.id })).resolves.toMatchObject({
          team: { phase: 'quiescing', closure: { kind: 'complete', finalEnvelopeId: replacement.id } },
        })
        accepted.revoke()
      } finally { closer.dispose(); expiry.dispose(); fixture.source.dispose(); await harness.dispose() }
    })

    it(`leaves the result sink available after rejecting an expired final on ${backend}`, async () => {
      const harness = await setup({}, undefined, backend)
      const fixture = await finalSinkFixture(harness.ctx, 1)
      const { final, scope } = fixture
      const expiry = schedulerChannelAuthority(harness.ctx, 'team-scheduler-dag')
      const recipient = fixture.source.issue(scope)
      const posting = issueActivation(harness.ctx, fixture.binding)
      try {
        const state = await harness.ctx.teams.getTeam({ teamId: final.teamId })
        const input = { teamId: final.teamId, channelId: final.channelId, expectedTeamCursor: state.team.cursor,
          expectedChannelCursor: (await harness.ctx.teams.getChannel({ channelId: final.channelId })).cursor,
          now: final.createdAt + 2, limit: 1 }
        const expired = expiry.issue({ kind: 'scheduler-channel-delivery-expire', ...input })
        try {
          expect((await harness.ctx.teams.expireSchedulerChannelDeliveries({ actor: expired.proof, ...input })).expired)
            .toMatchObject([{ envelopeId: final.id }])
        } finally { expired.revoke() }
        await expect(admitTestFinal(harness.ctx, recipient.proof, final)).rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
        expect(await finalAdmissions(harness.ctx, final)).toEqual([])
        expect((await harness.ctx.teams.getTeam({ teamId: final.teamId })).team.cursor).toBe(state.team.cursor)
        const replacement = await harness.ctx.teams.postChannelEnvelope({ actor: posting.proof,
          expectedCursor: (await harness.ctx.teams.getChannel({ channelId: final.channelId })).cursor,
          draft: { channelId: final.channelId, audience: [fixture.human.id], kind: 'final',
            payload: { text: 'Current final result.' }, delivery: 'turn' } })
        await expect(admitTestFinal(harness.ctx, recipient.proof, replacement)).resolves.toMatchObject({
          envelopeId: replacement.id, contentFingerprint: fingerprintTeamFinalContent(replacement.payload),
        })
        expect(await finalAdmissions(harness.ctx, final)).toHaveLength(1)
        expect((await harness.ctx.teams.readChannel({ channelId: final.channelId, afterCursor: -1 })).records
          .filter(record => record.type === 'channel/receipt')).toEqual([])
      } finally { posting.revoke(); recipient.revoke(); expiry.dispose(); fixture.source.dispose(); await harness.dispose() }
    })

    for (const restart of [false, true]) {
      it(`preserves admitted final receipt through TTL expiry ${restart ? 'after restart' : 'while active'} on ${backend}`, async () => {
        let harness = await setup({}, undefined, backend)
        const fixture = await finalSinkFixture(harness.ctx, 1)
        const { final, scope } = fixture
        const posting = issueActivation(harness.ctx, fixture.binding)
        const other = await harness.ctx.teams.postChannelEnvelope({ actor: posting.proof,
          expectedCursor: (await harness.ctx.teams.getChannel({ channelId: final.channelId })).cursor,
          draft: { channelId: final.channelId, audience: [fixture.human.id], kind: 'message',
            payload: { text: 'An ordinary expiring delivery.' }, delivery: 'turn', ttlMs: 1 } })
        const auxiliary = await openDirectV3(harness.ctx, final.teamId, fixture.human.id, fixture.coordinator.id)
        const otherChannelFinal = await harness.ctx.teams.postChannelEnvelope({ actor: posting.proof,
          expectedCursor: auxiliary.cursor,
          draft: { channelId: auxiliary.manifest.id, audience: [fixture.human.id], kind: 'final',
            payload: { text: 'An unselected expiring final.' }, delivery: 'turn', ttlMs: 1 } })
        posting.revoke()
        let source = fixture.source
        let recipient = source.issue(scope)
        const admitted = await admitTestFinal(harness.ctx, recipient.proof, final)
        if (restart) {
          recipient.revoke()
          source.dispose()
          await harness.dispose()
          harness = await setup({}, harness.root, backend)
          source = finalReceiptAuthority(harness.ctx, 'team-run')
          recipient = source.issue(scope)
        }
        const expiry = schedulerChannelAuthority(harness.ctx, 'team-scheduler-dag')
        const closer = closureAuthority(harness.ctx, 'team-run')
        try {
          const state = await harness.ctx.teams.getTeam({ teamId: final.teamId })
          expect(state.team.phase).toBe('active')
          const expire = async (channelId: ChannelId) => {
            const input = { teamId: final.teamId, channelId, expectedTeamCursor: state.team.cursor,
              expectedChannelCursor: (await harness.ctx.teams.getChannel({ channelId })).cursor,
              now: otherChannelFinal.createdAt + 2, limit: 1 }
            const proof = expiry.issue({ kind: 'scheduler-channel-delivery-expire', ...input })
            try { return await harness.ctx.teams.expireSchedulerChannelDeliveries({ actor: proof.proof, ...input }) }
            finally { proof.revoke() }
          }
          expect((await expire(final.channelId)).expired).toMatchObject([{ envelopeId: other.id }])
          expect((await expire(auxiliary.manifest.id)).expired).toMatchObject([{ envelopeId: otherChannelFinal.id }])
          const afterOtherExpiry = await harness.ctx.teams.getChannel({ channelId: final.channelId })
          expect((await expire(final.channelId)).expired).toEqual([])
          expect((await harness.ctx.teams.getChannel({ channelId: final.channelId })).cursor).toBe(afterOtherExpiry.cursor)
          await expect(admitTestFinal(harness.ctx, recipient.proof, final)).resolves.toEqual(admitted)
          await expect(harness.ctx.teams.ackChannelEnvelope({ actor: recipient.proof, channelId: final.channelId,
            envelopeId: final.id, expectedCursor: afterOtherExpiry.cursor }))
            .resolves.toMatchObject({ envelopeId: final.id, participantId: fixture.human.id })
          await expect(admitTestFinal(harness.ctx, recipient.proof, final)).resolves.toEqual(admitted)
          const complete = closer.issue({ kind: 'team-run-complete', ...scope, finalEnvelopeId: final.id })
          try {
            await expect(harness.ctx.teams.completeTeam({ actor: complete.proof, teamId: final.teamId,
              expectedCursor: state.team.cursor, idempotencyKey: teamClosureIdempotencyKeySchema.parse('ttl-protected-complete'),
              reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'The accepted result has its durable receipt.' },
              finalChannelId: final.channelId, finalEnvelopeId: final.id,
            })).resolves.toMatchObject({ team: { phase: 'quiescing', closure: { finalEnvelopeId: final.id } } })
          } finally { complete.revoke() }
          expect(await finalAdmissions(harness.ctx, final)).toHaveLength(1)
          const records = (await harness.ctx.teams.readChannel({ channelId: final.channelId, afterCursor: -1 })).records
          expect(records.filter(record => record.type === 'channel/receipt')).toMatchObject([{ envelopeId: final.id }])
          expect(records.filter(record => record.type === 'channel/delivery-expired')).toMatchObject([{ envelopeId: other.id }])
        } finally { closer.dispose(); expiry.dispose(); recipient.revoke(); source.dispose(); await harness.dispose() }
      })
    }

    for (const kind of ['cancel', 'fail'] as const) {
      it(`settles an admitted final delivery through explicit ${kind} on ${backend}`, async () => {
        const harness = await setup({}, undefined, backend)
        const fixture = await finalSinkFixture(harness.ctx, 1)
        const recipient = fixture.source.issue(fixture.scope)
        const actor = issueActivation(harness.ctx, fixture.binding)
        const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
        try {
          await admitTestFinal(harness.ctx, recipient.proof, fixture.final)
          const state = await harness.ctx.teams.getTeam({ teamId: fixture.final.teamId })
          const request = { actor: actor.proof, teamId: fixture.final.teamId, expectedCursor: state.team.cursor,
            idempotencyKey: teamClosureIdempotencyKeySchema.parse(`selected-final-${kind}`),
            reason: { code: 'EXPLICIT_CLOSURE', message: 'End the Team through its selected lifecycle operation.' } }
          if (kind === 'cancel') {
            await harness.ctx.teams.cancelTeam(request)
          } else {
            const failed = await harness.ctx.teams.failTeam(request)
            const closure = failed.team.closure
            if (closure === undefined) throw new Error('failure command did not persist closure intent')
            const continuation = driver.issue({ kind: 'closure-recover-fail', teamId: state.team.id,
              expectedCursor: failed.team.cursor, closureIdempotencyKey: closure.idempotencyKey,
              closureRequestedAt: closure.requestedAt })
            try {
              await harness.ctx.teams.continueTeamClosure({ actor: continuation.proof,
                teamId: state.team.id, expectedCursor: failed.team.cursor })
            } finally { continuation.revoke() }
          }
          const records = (await harness.ctx.teams.readChannel({ channelId: fixture.final.channelId, afterCursor: -1 })).records
          expect(records.filter(record => record.type === 'channel/delivery-expired')).toMatchObject([{
            envelopeId: fixture.final.id, participantId: fixture.human.id, reason: kind === 'cancel' ? 'cancellation' : 'closure',
          }])
          expect(records.filter(record => record.type === 'channel/receipt')).toEqual([])
          expect(await finalAdmissions(harness.ctx, fixture.final)).toHaveLength(1)
          expect((await harness.ctx.teams.getTeam({ teamId: state.team.id })).team.phase).toBe('quiescing')
        } finally { driver.dispose(); actor.revoke(); recipient.revoke(); fixture.source.dispose(); await harness.dispose() }
      })
    }

    it(`accepts a final whose TTL clock elapsed when no delivery-expired fact exists on ${backend}`, async () => {
      const harness = await setup({}, undefined, backend)
      const fixture = await finalSinkFixture(harness.ctx, 1)
      const { final, scope } = fixture
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(final.createdAt + 10)
      const closer = closureAuthority(harness.ctx, 'team-run')
      try {
        const state = await harness.ctx.teams.getTeam({ teamId: final.teamId })
        const actor = closer.issue({ kind: 'team-run-complete', ...scope, finalEnvelopeId: final.id })
        await expect(harness.ctx.teams.completeTeam({ teamId: final.teamId, expectedCursor: state.team.cursor,
          idempotencyKey: teamClosureIdempotencyKeySchema.parse('elapsed-final-complete'), actor: actor.proof,
          reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'Accept the still-pending final.' },
          finalChannelId: final.channelId, finalEnvelopeId: final.id,
        })).resolves.toMatchObject({ team: { phase: 'quiescing', closure: { kind: 'complete', finalEnvelopeId: final.id } } })
        actor.revoke()
      } finally { closer.dispose(); fixture.source.dispose(); await harness.dispose() }
    })

    for (const corruption of ['future', 'before-creation', 'team', 'channel', 'recipient', 'owner', 'closure-channel', 'closure-envelope'] as const) {
      it(`replays the journal when a final admission checkpoint has invalid ${corruption} provenance on ${backend}`, async () => {
        const first = await setup({}, undefined, backend)
        const fixture = await finalSinkFixture(first.ctx)
        const auxiliary = await openDirectV3(first.ctx, fixture.final.teamId, fixture.human.id, fixture.coordinator.id)
        const state = await first.ctx.teams.getTeam({ teamId: fixture.final.teamId })
        const closer = closureAuthority(first.ctx, 'team-run')
        const closing = closer.issue({ kind: 'team-run-complete', ...fixture.scope, finalEnvelopeId: fixture.final.id })
        await first.ctx.teams.completeTeam({ actor: closing.proof, teamId: fixture.final.teamId,
          expectedCursor: state.team.cursor, idempotencyKey: teamClosureIdempotencyKeySchema.parse('checkpoint-final-complete'),
          reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'Accept the exact final.' },
          finalChannelId: fixture.final.channelId, finalEnvelopeId: fixture.final.id,
        })
        closing.revoke()
        closer.dispose()
        const actor = fixture.source.issue(fixture.scope)
        const admitted = await admitTestFinal(first.ctx, actor.proof, fixture.final)
        actor.revoke()
        fixture.source.dispose()
        await first.dispose()
        const recovered = await setup({}, first.root, backend)
        const source = finalReceiptAuthority(recovered.ctx, 'team-run')
        try {
          const stream = await recovered.ctx.storageLog.open({ name: `team/${fixture.final.teamId}`, version: TEAM_JOURNAL_FORMAT_VERSION })
          const checkpoint = await stream.readCheckpoint()
          if (checkpoint === undefined) throw new Error('disposed Hub did not persist its Team checkpoint')
          const parsed = teamProjectionCheckpointSchema.parse(checkpoint.value)
          const changes = {
            future: { admittedAt: parsed.projection.team.updatedAt + 1 },
            'before-creation': { admittedAt: parsed.projection.team.createdAt - 1 },
            team: { teamId: 'foreign-team' },
            channel: { channelId: 'unattached-final-channel' },
            recipient: { recipientId: fixture.coordinator.id },
            owner: { owner: { kind: 'product-principal', principalId: 'another-owner' } },
            'closure-channel': { channelId: auxiliary.manifest.id },
            'closure-envelope': { envelopeId: 'different-final-envelope' },
          }
          await stream.writeCheckpoint({ sequence: checkpoint.sequence, value: jsonValueSchema.parse({ ...parsed,
            projection: { ...parsed.projection, finalAdmission: { ...admitted, ...changes[corruption] } },
          }) })
          await stream.close()
          const authority = source.issue(fixture.scope)
          try { expect(await admitTestFinal(recovered.ctx, authority.proof, fixture.final)).toEqual(admitted) }
          finally { authority.revoke() }
        } finally { source.dispose(); await recovered.dispose() }
      })
    }

    it(`rejects a human receipt when persisted final content proof disagrees with the WAL on ${backend}`, async () => {
      const first = await setup({}, undefined, backend)
      const fixture = await finalSinkFixture(first.ctx)
      const actor = fixture.source.issue(fixture.scope)
      const admitted = await admitTestFinal(first.ctx, actor.proof, fixture.final)
      actor.revoke()
      fixture.source.dispose()
      await first.dispose()
      const recovered = await setup({}, first.root, backend)
      const source = finalReceiptAuthority(recovered.ctx, 'team-run')
      try {
        const stream = await recovered.ctx.storageLog.open({ name: `team/${fixture.final.teamId}`, version: TEAM_JOURNAL_FORMAT_VERSION })
        const checkpoint = await stream.readCheckpoint()
        if (checkpoint === undefined) throw new Error('disposed Hub did not persist its Team checkpoint')
        const parsed = teamProjectionCheckpointSchema.parse(checkpoint.value)
        await stream.writeCheckpoint({ sequence: checkpoint.sequence, value: jsonValueSchema.parse({ ...parsed,
          projection: { ...parsed.projection, finalAdmission: { ...admitted,
            contentFingerprint: fingerprintTeamFinalContent({ text: 'This content was never posted.' }),
          } },
        }) })
        await stream.close()
        const authority = source.issue(fixture.scope)
        const channel = await recovered.ctx.teams.getChannel({ channelId: fixture.final.channelId })
        await expect(recovered.ctx.teams.ackChannelEnvelope({ actor: authority.proof, channelId: fixture.final.channelId,
          envelopeId: fixture.final.id, expectedCursor: channel.cursor })).rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
        authority.revoke()
        const read = await recovered.ctx.teams.readChannel({ channelId: fixture.final.channelId, afterCursor: -1 })
        expect(read.records.filter(record => record.type === 'channel/receipt')).toHaveLength(0)
        expect(read.channel.cursor).toBe(channel.cursor)
      } finally { source.dispose(); await recovered.dispose() }
    })

    for (const corruption of ['channel', 'task', 'task-template'] as const) {
      it(`replays the journal when a partial workflow checkpoint references an unattached ${corruption} on ${backend}`, async () => {
        const first = await setup({}, undefined, backend)
        const fixture = await finalSinkFixture(first.ctx)
        const actor = issueActivation(first.ctx, fixture.binding)
        const state = await first.ctx.teams.getTeam({ teamId: fixture.final.teamId })
        let plan = await first.ctx.teams.admitWorkflowPlan({ actor: actor.proof, teamId: state.team.id,
          expectedCursor: state.team.cursor, idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('checkpoint-workflow'),
          plan: teamWorkflowPlanSchema.parse({ version: 1, name: 'checkpoint-workflow',
            tasks: ['review', 'summarize'].map((id, index) => ({ id, subject: id, description: 'Review the result.',
              blockedBy: index === 0 ? [] : ['review'], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [],
              workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 })),
            bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 },
            channel: { participantRoles: ['coordinator', 'human'], graph: { initial: { kind: 'participant', role: 'coordinator' },
              transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
            result: { kind: 'task-results', taskTemplateIds: ['review', 'summarize'] },
          }),
        })
        const template = plan.plan.tasks[0]
        if (template === undefined || plan.actor === undefined) throw new Error('workflow admission lost its author or first template')
        const { id: templateId, ...fields } = template
        let current = await first.ctx.teams.getTeam({ teamId: state.team.id })
        const task = await first.ctx.teams.createTask({ actor: actor.proof, teamId: state.team.id, expectedCursor: current.team.cursor,
          createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('checkpoint-workflow-task') },
          workflowPlanId: plan.id, workflowTemplateId: templateId, ...fields, blockedBy: [], reviewPolicy: { kind: 'none' },
        })
        current = await first.ctx.teams.getTeam({ teamId: state.team.id })
        const bindings = workflowAuthority(first.ctx, 'team-run')
        const input = { teamId: state.team.id, planId: plan.id, expectedCursor: current.team.cursor,
          expectedRevision: plan.revision, templateId, taskId: task.id }
        const bind = bindings.issue({ kind: 'team-run-workflow-task-bind', coordinator: plan.actor, ...input })
        plan = await first.ctx.teams.bindWorkflowPlanTask({ actor: bind.proof, ...input })
        bind.revoke()
        bindings.dispose()
        actor.revoke()
        fixture.source.dispose()
        await first.dispose()
        const recovered = await setup({}, first.root, backend)
        try {
          const stream = await recovered.ctx.storageLog.open({ name: `team/${state.team.id}`, version: TEAM_JOURNAL_FORMAT_VERSION })
          const checkpoint = await stream.readCheckpoint()
          if (checkpoint === undefined) throw new Error('disposed Hub did not persist its Team checkpoint')
          const parsed = teamProjectionCheckpointSchema.parse(checkpoint.value)
          await stream.writeCheckpoint({ sequence: checkpoint.sequence, value: jsonValueSchema.parse({ ...parsed,
            projection: { ...parsed.projection, workflowPlans: [corruption === 'channel'
              ? { ...plan, channelId: 'unattached-workflow-channel' }
              : { ...plan, taskBindings: [corruption === 'task'
                ? { templateId, taskId: 'missing-workflow-task' }
                : { templateId: 'summarize', taskId: task.id }] }] },
          }) })
          await stream.close()
          expect(await recovered.ctx.teams.getWorkflowPlan({ teamId: state.team.id, planId: plan.id })).toEqual(plan)
        } finally { await recovered.dispose() }
      })

    }

    it(`retains admitted final content across terminal channel compaction on ${backend}`, async () => {
      const harness = await setup({}, undefined, backend)
      const fixture = await finalSinkFixture(harness.ctx)
      const { final, source, scope } = fixture
      const actor = source.issue(scope)
      const maintenance = maintenanceAuthority(harness.ctx, 'team-scheduler-dag')
      try {
        await admitTestFinal(harness.ctx, actor.proof, final)
        await harness.ctx.teams.ackChannelEnvelope({ actor: actor.proof, channelId: final.channelId, envelopeId: final.id,
          expectedCursor: (await harness.ctx.teams.getChannel({ channelId: final.channelId })).cursor })
        const closed = await closeTestChannel(harness.ctx, { channelId: final.channelId,
          expectedCursor: (await harness.ctx.teams.getChannel({ channelId: final.channelId })).cursor })
        const input = { teamId: final.teamId, channelId: final.channelId, expectedCursor: closed.cursor, throughSequence: final.sequence }
        const proof = maintenance.issue({ kind: 'scheduler-channel-compaction', ...input })
        await expect(harness.ctx.teams.compactChannel({ ...input, actor: proof.proof })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
        proof.revoke()
        const retained = await harness.ctx.teams.readChannel({ channelId: final.channelId, afterCursor: -1 })
        expect(retained.records.some(record => record.type === 'channel/envelope' && record.envelope.id === final.id)).toBe(true)
      } finally { actor.revoke(); source.dispose(); maintenance.dispose(); await harness.dispose() }
    })
  }
})

describe('TeamHub closure authority', () => {
  it('rejects raw, forged, revoked, and cross-Team activation authority before policy or durable acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Reject unauthenticated closure input.', budgets: {} }, rules: {}, budgets: {},
    })
    const participant = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Closer')
    const binding = await bindIdleActivation(harness.ctx, created.team.id, participant.id, 'primary')
    const revoked = issueActivation(harness.ctx, binding)
    revoked.revoke()

    const foreign = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Supply a foreign closure proof.', budgets: {} }, rules: {}, budgets: {},
    })
    const foreignParticipant = await activeParticipant(harness.ctx, foreign.team.id, 'local-agent', 'worker', 'Foreign closer')
    const foreignBinding = await bindIdleActivation(harness.ctx, foreign.team.id, foreignParticipant.id, 'foreign')
    const foreignProof = issueActivation(harness.ctx, foreignBinding)

    const closePolicies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-invalid-closure-authority',
      async apply(request, next) {
        closePolicies.push(request)
        return await next()
      },
    })
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const request = cancellationInput(created.team.id, before.team.cursor)
    const invalidActors: readonly unknown[] = [
      { kind: 'participant', participantId: participant.id },
      { kind: 'system', name: 'team-run' },
      {},
      revoked.proof,
      foreignProof.proof,
    ]
    for (const actor of invalidActors) {
      await expect(harness.ctx.teams.cancelTeam({ ...request, actor } as never))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }

    const after = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(after.team).toMatchObject({ cursor: before.team.cursor, phase: 'active' })
    expect(after.team.closure).toBeUndefined()
    expect(after.team.cancellation).toBeUndefined()
    expect(closePolicies).toEqual([])
    unregister()
    await harness.dispose()
  })

  it('revalidates closure proofs after close policy before terminal Team journal admission', async () => {
    const harness = await setup()
    const teamRun = closureAuthority(harness.ctx, 'team-run')
    let revoke: (() => void) | undefined
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'revoke-terminal-closure-after-policy',
      async apply(_request, next) {
        const current = revoke
        revoke = undefined
        current?.()
        return await next()
      },
    })
    try {
      const failed = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Reject a policy-revoked failure closure.', budgets: {} }, rules: {}, budgets: {},
      })
      let state = await harness.ctx.teams.getTeam({ teamId: failed.team.id })
      const failure = teamRun.issue({ kind: 'team-run-create-failure', teamId: failed.team.id })
      revoke = () => { failure.revoke() }
      await expect(harness.ctx.teams.failTeam({
        teamId: failed.team.id,
        expectedCursor: state.team.cursor,
        idempotencyKey: teamClosureIdempotencyKeySchema.parse(`closure-proof-policy-fail-${failed.team.id}`),
        reason: { code: 'TEAM_RUN_CREATION_FAILED', message: 'The proof was revoked during close policy evaluation.' },
        actor: failure.proof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      state = await harness.ctx.teams.getTeam({ teamId: failed.team.id })
      expect(state.team).toMatchObject({ cursor: failed.team.cursor, phase: 'active' })
      expect(state.team.closure).toBeUndefined()

      const cancelling = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Reject a policy-revoked cancellation closure.', budgets: {} }, rules: {}, budgets: {},
      })
      const closer = await activeParticipant(harness.ctx, cancelling.team.id, 'local-agent', 'worker', 'Cancelling closer')
      const binding = await bindIdleActivation(harness.ctx, cancelling.team.id, closer.id, 'policy-cancel')
      state = await harness.ctx.teams.getTeam({ teamId: cancelling.team.id })
      const beforeCancellationCursor = state.team.cursor
      const cancellation = issueActivation(harness.ctx, binding)
      revoke = () => { cancellation.revoke() }
      await expect(harness.ctx.teams.cancelTeam({
        ...cancellationInput(cancelling.team.id, state.team.cursor),
        actor: cancellation.proof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      state = await harness.ctx.teams.getTeam({ teamId: cancelling.team.id })
      expect(state.team).toMatchObject({ cursor: beforeCancellationCursor, phase: 'active' })
      expect(state.team.cancellation).toBeUndefined()
      expect(state.team.closure).toBeUndefined()

      const completing = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Reject a policy-revoked completion closure.', budgets: {} }, rules: {}, budgets: {},
      })
      const human = await activeParticipant(harness.ctx, completing.team.id, 'human', 'human', 'Human recipient')
      const coordinator = await activeParticipant(harness.ctx, completing.team.id, 'local-agent', 'coordinator', 'Coordinator')
      const completionCloser = await activeParticipant(harness.ctx, completing.team.id, 'local-agent', 'worker', 'Completion closer')
      const coordinatorBinding = await bindIdleActivation(harness.ctx, completing.team.id, coordinator.id, 'policy-complete-coordinator')
      const closerBinding = await bindIdleActivation(harness.ctx, completing.team.id, completionCloser.id, 'policy-complete-closer')
      const channel = await openDirectV3(harness.ctx, completing.team.id, human.id, coordinator.id)
      const coordinatorActor = issueActivation(harness.ctx, coordinatorBinding)
      const final = await harness.ctx.teams.postChannelEnvelope({
        actor: coordinatorActor.proof,
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [human.id],
          kind: 'final',
          payload: { text: 'The final result is available.' },
          delivery: 'turn',
        },
      })
      coordinatorActor.revoke()
      const humanSource = finalReceiptAuthority(harness.ctx, 'team-run')
      const humanActor = humanSource.issue({ teamId: completing.team.id, channelId: channel.manifest.id,
        humanId: human.id, coordinatorId: coordinator.id })
      await admitTestFinal(harness.ctx, humanActor.proof, final)
      await harness.ctx.teams.ackChannelEnvelope({
        actor: humanActor.proof,
        channelId: channel.manifest.id,
        envelopeId: final.id,
        expectedCursor: (await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      })
      humanActor.revoke()
      humanSource.dispose()
      await closeTestChannel(harness.ctx, {
        channelId: channel.manifest.id,
        expectedCursor: (await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      })
      state = await harness.ctx.teams.getTeam({ teamId: completing.team.id })
      const beforeCompletionCursor = state.team.cursor
      const completion = issueActivation(harness.ctx, closerBinding)
      revoke = () => { completion.revoke() }
      await expect(harness.ctx.teams.completeTeam({
        teamId: completing.team.id,
        expectedCursor: state.team.cursor,
        idempotencyKey: teamClosureIdempotencyKeySchema.parse(`closure-proof-policy-complete-${completing.team.id}`),
        reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'The proof was revoked during close policy evaluation.' },
        finalChannelId: channel.manifest.id,
        finalEnvelopeId: final.id,
        actor: completion.proof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      state = await harness.ctx.teams.getTeam({ teamId: completing.team.id })
      expect(state.team).toMatchObject({ cursor: beforeCompletionCursor, phase: 'active' })
      expect(state.team.closure).toBeUndefined()
    } finally {
      unregister()
      teamRun.dispose()
      await harness.dispose()
    }
  })

  it('revalidates cancellation closure proofs after channel-close policy before WAL admission', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Reject a revoked cancellation channel close.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const channel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const coordinatorBinding = (await harness.ctx.teams.getTeam({ teamId: created.team.id })).activations
      .find(binding => binding.activation.participantId === coordinator.id)
    if (coordinatorBinding === undefined) throw new Error('cancellation closure fixture has no coordinator activation')
    await updateActivationStatus(harness.ctx, coordinatorBinding, 'offline')
    const cancellation = await seedTeamRunCancellation(harness.ctx, created.team.id)
    const beforeTeam = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const beforeChannel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
    const teamRun = closureAuthority(harness.ctx, 'team-run')
    const closure = teamRun.issue({
      kind: 'team-run-cancel',
      teamId: created.team.id,
      channelId: channel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    })
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'revoke-cancellation-closure-before-channel-wal',
      async apply(request, next) {
        if (request.facts.closure === 'cancel') closure.revoke()
        return await next()
      },
    })
    try {
      await expect(harness.ctx.teams.cancelTeam({
        teamId: created.team.id,
        expectedCursor: beforeTeam.team.cursor,
        idempotencyKey: cancellation.idempotencyKey,
        reason: cancellation.reason,
        actor: closure.proof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const afterTeam = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const afterChannel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
      expect(afterTeam.team.cursor).toBe(beforeTeam.team.cursor)
      expect(afterTeam.team.closure).toBeUndefined()
      expect(afterTeam.team.cancellation).toEqual(cancellation)
      expect(afterChannel).toMatchObject({ phase: 'active', cursor: beforeChannel.cursor })
    } finally {
      unregister()
      teamRun.dispose()
      await harness.dispose()
    }
  })

  for (const backend of ['json', 'sqlite'] as const) {
    for (const failureCount of [1, 2]) {
      it(`settles every cancellation channel after ${failureCount} append failure(s) on ${backend}`, async () => {
        const harness = await setup({}, undefined, backend)
        type Stream = Awaited<ReturnType<Context['storageLog']['open']>>
        const streams = new Map<string, Stream>()
        const originalOpen = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
        const observeOpen = vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
          const stream = await originalOpen(descriptor)
          streams.set(stream.name, stream)
          return stream
        })
        const team = await createTestRootTeam(harness.ctx, {
          goal: { objective: 'Settle all cancellation channels despite independent storage failures.', budgets: {} }, rules: {}, budgets: {},
        })
        const human = await activeParticipant(harness.ctx, team.team.id, 'human', 'human', 'Human')
        const coordinator = await activeParticipant(harness.ctx, team.team.id, 'local-agent', 'coordinator', 'Coordinator')
        const channels: ChannelSnapshot[] = []
        for (let index = 0; index < 3; index += 1) channels.push(await openDirectV3(harness.ctx, team.team.id, human.id, coordinator.id))
        const coordinatorBinding = (await harness.ctx.teams.getTeam({ teamId: team.team.id })).activations
          .find(binding => binding.activation.participantId === coordinator.id)
        if (coordinatorBinding === undefined) throw new Error('cancellation channel fixture has no coordinator activation')
        await updateActivationStatus(harness.ctx, coordinatorBinding, 'offline')
        const source = closureAuthority(harness.ctx, 'team-run')
        const actor = source.issue({ kind: 'team-run-cancel', teamId: team.team.id,
          channelId: channels[0]!.manifest.id, humanId: human.id, coordinatorId: coordinator.id })
        const firstError = new Error('first cancellation channel append failed')
        const lastError = new Error('last cancellation channel append failed')
        const faults = [0, ...failureCount === 2 ? [2] : []].map((index) => {
          const channel = channels[index]!
          const stream = streams.get(`channel/${channel.manifest.id}`)
          if (stream === undefined) throw new Error('the storage provider did not open the cancellation channel')
          return vi.spyOn(stream, 'append').mockRejectedValueOnce(index === 0 ? firstError : lastError)
        })
        try {
          const before = await harness.ctx.teams.getTeam({ teamId: team.team.id })
          const request = { actor: actor.proof, ...cancellationInput(team.team.id, before.team.cursor) }
          const failure: unknown = await harness.ctx.teams.cancelTeam(request).catch((error: unknown) => error)
          expect((await harness.ctx.teams.getChannel({ channelId: channels[1]!.manifest.id })).phase).toBe('closed')
          expect((await harness.ctx.teams.getChannel({ channelId: channels[2]!.manifest.id })).phase)
            .toBe(failureCount === 2 ? 'active' : 'closed')
          expect((await harness.ctx.teams.getChannel({ channelId: channels[0]!.manifest.id })).phase).toBe('active')
          if (failureCount === 1) expect(failure).toBe(firstError)
          else {
            expect(failure).toBeInstanceOf(AggregateError)
            expect((failure as AggregateError).errors).toEqual([firstError, lastError])
          }
          const unsettled = await harness.ctx.teams.getTeam({ teamId: team.team.id })
          expect(unsettled.team.phase).toBe('quiescing')
          expect(unsettled.team.closure).toBeUndefined()
          expect(unsettled.team.cancellation?.idempotencyKey).toBe(request.idempotencyKey)
          for (const fault of faults) fault.mockRestore()
          const completed = await harness.ctx.teams.cancelTeam(request)
          expect(completed.team.phase).toBe('cancelled')
          await expect(harness.ctx.teams.cancelTeam(request)).resolves.toEqual(completed)
          for (const channel of channels) {
            const records = (await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
            expect(records.filter(record => record.type === 'channel/closed')).toHaveLength(1)
          }
        } finally {
          for (const fault of faults) fault.mockRestore()
          observeOpen.mockRestore(); actor.revoke(); source.dispose(); await harness.dispose()
        }
      })
    }
  }

  it('revalidates cancellation authority before each remaining channel policy after revocation', async () => {
    const harness = await setup()
    const team = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Stop revoked cancellation authority before subsequent policies.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, team.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(harness.ctx, team.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const channels: ChannelSnapshot[] = []
    for (let index = 0; index < 3; index += 1) channels.push(await openDirectV3(harness.ctx, team.team.id, human.id, coordinator.id))
    const coordinatorBinding = (await harness.ctx.teams.getTeam({ teamId: team.team.id })).activations
      .find(binding => binding.activation.participantId === coordinator.id)
    if (coordinatorBinding === undefined) throw new Error('cancellation authority fixture has no coordinator activation')
    await updateActivationStatus(harness.ctx, coordinatorBinding, 'offline')
    const source = closureAuthority(harness.ctx, 'team-run')
    const scope = { kind: 'team-run-cancel' as const, teamId: team.team.id,
      channelId: channels[0]!.manifest.id, humanId: human.id, coordinatorId: coordinator.id }
    const actor = source.issue(scope)
    const policies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'revoke-first-cancellation-channel',
      async apply(request, next) {
        if (request.facts.closure === 'cancel') {
          policies.push(request.facts.channelId)
          actor.revoke()
        }
        return await next()
      },
    })
    try {
      const state = await harness.ctx.teams.getTeam({ teamId: team.team.id })
      const input = cancellationInput(team.team.id, state.team.cursor)
      const failure: unknown = await harness.ctx.teams.cancelTeam({ actor: actor.proof, ...input }).catch((error: unknown) => error)
      expect(policies).toEqual([channels[0]!.manifest.id])
      expect(failure).toBeInstanceOf(AggregateError)
      expect((failure as AggregateError).errors).toMatchObject([
        { code: 'TEAM_ACTOR_PROOF_INVALID' }, { code: 'TEAM_ACTOR_PROOF_INVALID' }, { code: 'TEAM_ACTOR_PROOF_INVALID' },
      ])
      for (const channel of channels) {
        const current = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
        expect(current).toMatchObject({ phase: 'active', cursor: channel.cursor })
      }
      unregister()
      const replacement = source.issue(scope)
      try {
        await expect(harness.ctx.teams.cancelTeam({ actor: replacement.proof, ...input })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
      } finally { replacement.revoke() }
    } finally { unregister(); actor.revoke(); source.dispose(); await harness.dispose() }
  })

  for (const { operation, kind, pending } of [
    { operation: 'failure-delivery-expiry', kind: 'fail', pending: true },
    { operation: 'closure-driver-failure-channel-close', kind: 'fail', pending: false },
    { operation: 'cancellation-delivery-expiry', kind: 'cancel', pending: true },
    { operation: 'closure-driver-cancellation-channel-close', kind: 'cancel', pending: false },
  ] as const) {
    it(`revalidates driver authority before each remaining ${operation} policy`, async () => {
      const harness = await setup()
      const team = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Revalidate recovered closure authority for each selected channel.', budgets: {} }, rules: {}, budgets: {},
      })
      const human = await activeParticipant(harness.ctx, team.team.id, 'human', 'human', 'Human')
      const coordinator = await activeParticipant(harness.ctx, team.team.id, 'local-agent', 'coordinator', 'Coordinator')
      const channels: ChannelSnapshot[] = []
      for (let index = 0; index < 3; index += 1) channels.push(await openDirectV3(harness.ctx, team.team.id, human.id, coordinator.id))
      if (pending) {
        const binding = await bindIdleActivation(harness.ctx, team.team.id, coordinator.id, 'pending-expiry-revocation')
        const posting = issueActivation(harness.ctx, binding)
        try {
          for (const channel of channels) {
            await harness.ctx.teams.postChannelEnvelope({ actor: posting.proof, expectedCursor: channel.cursor,
              draft: { channelId: channel.manifest.id, audience: [human.id], kind: 'message',
                payload: { text: 'Pending delivery before failure intent.' }, delivery: 'turn' } })
          }
        } finally { posting.revoke() }
      }
      const coordinatorBinding = (await harness.ctx.teams.getTeam({ teamId: team.team.id })).activations
        .find(binding => binding.activation.participantId === coordinator.id)
      if (coordinatorBinding === undefined) throw new Error('driver revocation fixture has no coordinator activation')
      await updateActivationStatus(harness.ctx, coordinatorBinding, 'offline')
      const originalChannels = await Promise.all(channels.map(channel => harness.ctx.teams.getChannel({ channelId: channel.manifest.id })))
      const source = closureAuthority(harness.ctx, 'team-run')
      const origin = source.issue(kind === 'cancel'
        ? { kind: 'team-run-cancel', teamId: team.team.id, channelId: channels[0]!.manifest.id,
          humanId: human.id, coordinatorId: coordinator.id }
        : { kind: 'team-run-create-failure', teamId: team.team.id })
      const before = await harness.ctx.teams.getTeam({ teamId: team.team.id })
      const request = { actor: origin.proof, teamId: team.team.id, expectedCursor: before.team.cursor,
        idempotencyKey: teamClosureIdempotencyKeySchema.parse(`driver-revocation-${operation}`),
        reason: { code: 'OWNER_CLOSING', message: 'The setup owner requires all remaining channels to settle.' } }
      if (kind === 'cancel') {
        const unregisterFailure = harness.ctx.teams.registerPolicy('close', {
          name: 'interrupt-initial-cancellation-cleanup',
          async apply(request, next) {
            if (request.facts.operation === 'cancellation-delivery-expiry' || request.facts.closure === 'cancel') {
              throw new Error('cancellation cleanup provider unavailable')
            }
            return await next()
          },
        })
        try { await expect(harness.ctx.teams.cancelTeam(request)).rejects.toBeInstanceOf(AggregateError) }
        finally { unregisterFailure() }
      } else {
        await harness.ctx.teams.failTeam(request)
      }
      origin.revoke()
      source.dispose()
      const failed = await harness.ctx.teams.getTeam({ teamId: team.team.id })
      const intent = kind === 'cancel' ? failed.team.cancellation : failed.team.closure
      if (intent === undefined) throw new Error('closure command did not persist its intent')
      const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
      const selection = { teamId: team.team.id, expectedCursor: failed.team.cursor }
      const scope: TeamSystemClosureDriverScope = kind === 'cancel'
        ? { kind: 'closure-recover-cancel', ...selection,
          cancellationIdempotencyKey: intent.idempotencyKey, cancellationRequestedAt: intent.requestedAt }
        : { kind: 'closure-recover-fail', ...selection,
          closureIdempotencyKey: intent.idempotencyKey, closureRequestedAt: intent.requestedAt }
      const actor = driver.issue(scope)
      const policies: unknown[] = []
      const unregister = harness.ctx.teams.registerPolicy('close', {
        name: 'revoke-first-recovered-channel-policy',
        async apply(request, next) {
          if (request.facts.operation === operation) {
            policies.push(request.facts.channelId)
            actor.revoke()
          }
          return await next()
        },
      })
      try {
        const input = { teamId: team.team.id, expectedCursor: failed.team.cursor }
        const failure: unknown = await harness.ctx.teams.continueTeamClosure({ actor: actor.proof, ...input })
          .catch((error: unknown) => error)
        expect(policies).toEqual([channels[0]!.manifest.id])
        expect(failure).toBeInstanceOf(AggregateError)
        expect((failure as AggregateError).errors).toMatchObject([
          { code: 'TEAM_ACTOR_PROOF_INVALID' }, { code: 'TEAM_ACTOR_PROOF_INVALID' }, { code: 'TEAM_ACTOR_PROOF_INVALID' },
        ])
        for (const channel of originalChannels) {
          expect(await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).toEqual(channel)
        }
        expect((await harness.ctx.teams.getTeam({ teamId: team.team.id })).team).toMatchObject({
          phase: 'quiescing', cursor: failed.team.cursor, [kind === 'cancel' ? 'cancellation' : 'closure']: intent,
        })
        unregister()
        const replacement = driver.issue(scope)
        try {
          const continued = await harness.ctx.teams.continueTeamClosure({ actor: replacement.proof, ...input })
          expect(continued.team.phase).toBe(kind === 'cancel' ? 'cancelled' : 'failed')
          for (const channel of channels) {
            const records = (await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
            expect(records.filter(record => record.type === (pending ? 'channel/delivery-expired' : 'channel/closed')))
              .toHaveLength(1)
          }
        } finally { replacement.revoke() }
      } finally { unregister(); actor.revoke(); driver.dispose(); await harness.dispose() }
    })
  }

  for (const backend of ['json', 'sqlite'] as const) {
    for (const kind of ['fail', 'cancel'] as const) {
      it(`replays terminal ${kind} only with live exact closure authority on ${backend}`, async () => {
        const harness = await setup({}, undefined, backend)
        const team = await createTestRootTeam(harness.ctx, {
          goal: { objective: 'Replay the accepted terminal operation without another business append.', budgets: {} }, rules: {}, budgets: {},
        })
        const human = await activeParticipant(harness.ctx, team.team.id, 'human', 'human', 'Human')
        const coordinator = await activeParticipant(harness.ctx, team.team.id, 'local-agent', 'coordinator', 'Coordinator')
        const channel = await openDirectV3(harness.ctx, team.team.id, human.id, coordinator.id)
        const topology = await harness.ctx.teams.getTeam({ teamId: team.team.id })
        for (const binding of topology.activations) {
          await updateActivationStatus(harness.ctx, binding, 'offline')
        }
        const source = closureAuthority(harness.ctx, 'team-run')
        const actor = source.issue(kind === 'fail' ? { kind: 'team-run-create-failure', teamId: team.team.id }
          : { kind: 'team-run-cancel', teamId: team.team.id, channelId: channel.manifest.id, humanId: human.id, coordinatorId: coordinator.id })
        const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
        try {
          const before = await harness.ctx.teams.getTeam({ teamId: team.team.id })
          const input = { ...cancellationInput(team.team.id, before.team.cursor),
            reason: { code: 'OWNER_FINISHED', message: 'The owner selected the terminal operation.' } }
          const request = { actor: actor.proof, ...input }
          const accepted = kind === 'fail'
            ? await harness.ctx.teams.failTeam(request)
            : await harness.ctx.teams.cancelTeam(request)
          const continuation = (state: typeof accepted): TeamSystemClosureDriverScope => {
            const selection = { teamId: team.team.id, expectedCursor: state.team.cursor }
            if (kind === 'fail') {
              const closure = state.team.closure
              if (closure?.kind !== 'fail') throw new Error('accepted failure has no exact durable intent')
              return { kind: 'closure-recover-fail', ...selection,
                closureIdempotencyKey: closure.idempotencyKey, closureRequestedAt: closure.requestedAt }
            }
            const cancellation = state.team.cancellation
            if (cancellation === undefined) throw new Error('accepted cancellation has no exact durable intent')
            return { kind: 'closure-recover-cancel', ...selection,
              cancellationIdempotencyKey: cancellation.idempotencyKey, cancellationRequestedAt: cancellation.requestedAt }
          }
          const initial = driver.issue(continuation(accepted))
          const terminal = await harness.ctx.teams.continueTeamClosure({ actor: initial.proof,
            teamId: team.team.id, expectedCursor: accepted.team.cursor })
          initial.revoke()
          expect(terminal.team.phase).toBe(kind === 'fail' ? 'failed' : 'cancelled')
          const replay = kind === 'fail' ? harness.ctx.teams.failTeam.bind(harness.ctx.teams) : harness.ctx.teams.cancelTeam.bind(harness.ctx.teams)
          await expect(replay(request)).resolves.toEqual(terminal)
          await expect(replay({ ...request, reason: { ...input.reason, message: 'Different request facts.' } }))
            .rejects.toMatchObject({ code: 'TEAM_CLOSURE_IDEMPOTENCY_CONFLICT' })
          const terminalProof = driver.issue(continuation(terminal))
          try {
            const resume = { actor: terminalProof.proof, teamId: team.team.id, expectedCursor: terminal.team.cursor }
            await expect(harness.ctx.teams.continueTeamClosure(resume)).resolves.toEqual(terminal)
            terminalProof.revoke()
            await expect(harness.ctx.teams.continueTeamClosure(resume)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
          } finally { terminalProof.revoke() }
          actor.revoke()
          await expect(replay(request)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
          expect(await harness.ctx.teams.getTeam({ teamId: team.team.id })).toEqual(terminal)
          const audit = await harness.ctx.teams.readAudit({ teamId: team.team.id, afterCursor: -1, limit: 128 })
          expect(audit.items.filter(item => item.type === 'team/closure')).toHaveLength(1)
          const records = (await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
          expect(records.filter(record => record.type === 'channel/closed')).toHaveLength(1)
        } finally { actor.revoke(); driver.dispose(); source.dispose(); await harness.dispose() }
      })
    }
  }

  for (const backend of ['json', 'sqlite'] as const) {
    it(`keeps recovered offline status nonterminal until cancellation has quiescence proof on ${backend}`, async () => {
      const first = await setup({}, undefined, backend)
      const team = await createTestRootTeam(first.ctx, {
        goal: { objective: 'Require durable quiescence for a recovered offline epoch.', budgets: {} }, rules: {}, budgets: {},
      })
      const human = await activeParticipant(first.ctx, team.team.id, 'human', 'human', 'Human')
      const coordinator = await activeParticipant(first.ctx, team.team.id, 'local-agent', 'coordinator', 'Coordinator')
      const binding = await bindIdleActivation(first.ctx, team.team.id, coordinator.id, 'durable-offline-without-proof')
      const channel = await openDirectV3(first.ctx, team.team.id, human.id, coordinator.id)
      const initial = await first.ctx.teams.getTeam({ teamId: team.team.id })
      await first.dispose()
      const recovered = await setup({}, first.root, backend)
      const stream = await recovered.ctx.storageLog.open({ name: `team/${team.team.id}`, version: TEAM_JOURNAL_FORMAT_VERSION })
      try {
        await stream.append(initial.team.cursor, [{ type: 'activation/changed',
          binding: { ...binding, activation: { ...binding.activation, status: 'offline' } }, createdAt: initial.team.updatedAt + 1 }])
      } finally { await stream.close() }
      const source = closureAuthority(recovered.ctx, 'team-run')
      const actor = source.issue({ kind: 'team-run-cancel', teamId: team.team.id,
        channelId: channel.manifest.id, humanId: human.id, coordinatorId: coordinator.id })
      const driver = closureDriverAuthority(recovered.ctx, 'team-closure-driver')
      try {
        const observed = await recovered.ctx.teams.getTeam({ teamId: team.team.id })
        expect(observed.activations).toMatchObject([{ activation: { id: binding.activation.id, status: 'offline' } }])
        expect(observed.activations[0]?.quiescedAt).toBeUndefined()
        const request = { actor: actor.proof, ...cancellationInput(team.team.id, observed.team.cursor) }
        const accepted = await recovered.ctx.teams.cancelTeam(request)
        expect(accepted.team.phase).toBe('quiescing')
        expect(accepted.team.closure).toBeUndefined()
        expect(accepted.team.cancellation?.idempotencyKey).toBe(request.idempotencyKey)
        expect((await recovered.ctx.teams.getChannel({ channelId: channel.manifest.id })).phase).toBe('active')
        const cancellation = accepted.team.cancellation
        if (cancellation === undefined) throw new Error('cancel command did not retain its durable intent')
        const resume = driver.issue({ kind: 'closure-recover-cancel', teamId: team.team.id,
          expectedCursor: accepted.team.cursor, cancellationIdempotencyKey: cancellation.idempotencyKey,
          cancellationRequestedAt: cancellation.requestedAt })
        try {
          await expect(recovered.ctx.teams.continueTeamClosure({ actor: resume.proof,
            teamId: team.team.id, expectedCursor: accepted.team.cursor })).resolves.toEqual(accepted)
        } finally { resume.revoke() }
        await expect(recovered.ctx.teams.cancelTeam(request)).resolves.toEqual(accepted)
        const cleanup = cancellationCleanupAuthority(recovered.ctx, 'team-run')
        const closeInput = { teamId: team.team.id, cancellationIdempotencyKey: cancellation.idempotencyKey,
          cancellationRequestedAt: cancellation.requestedAt, expectedTeamCursor: accepted.team.cursor,
          channelId: channel.manifest.id, expectedCursor: channel.cursor, reason: 'Team cancelled' }
        const closeProof = cleanup.issue({ kind: 'team-run-cancellation-channel-close', ...closeInput })
        try {
          await expect(recovered.ctx.teams.closeTeamCancellationChannel({ actor: closeProof.proof, ...closeInput }))
            .rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })
          expect((await recovered.ctx.teams.getChannel({ channelId: channel.manifest.id })).phase).toBe('active')
        } finally { closeProof.revoke(); cleanup.dispose() }
        const input = { teamId: team.team.id, activationId: binding.activation.id, participantId: coordinator.id,
          sessionId: binding.sessionId, provider: binding.provider, expectedCursor: accepted.team.cursor }
        const proof = controllerActivationAuthority(recovered.ctx).issue({ kind: 'activation-controller-quiesce', ...input })
        try { await recovered.ctx.teams.quiesceActivation({ actor: proof.proof, ...input }) }
        finally { proof.revoke() }
        const terminal = await recovered.ctx.teams.cancelTeam(request)
        expect(terminal.team.phase).toBe('cancelled')
        expect(terminal.team.cancellation).toEqual(cancellation)
        expect(terminal.activations[0]?.quiescedAt).toBeTypeOf('number')
        expect(terminal.activations[0]?.quiescenceSource).toBe('quiesced')
        const records = (await recovered.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
        expect(records.filter(record => record.type === 'channel/closed')).toHaveLength(1)
      } finally { actor.revoke(); driver.dispose(); source.dispose(); await recovered.dispose() }
      const verified = await setup({}, first.root, backend)
      try {
        expect((await verified.ctx.teams.getTeam({ teamId: team.team.id })).team.phase).toBe('cancelled')
      } finally { await verified.dispose() }
    })
  }

  it('continues only an exact durable cancellation with a closure-driver proof', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Settle a durable cancellation after restart.', budgets: {} }, rules: {}, budgets: {},
    })
    const cancellation = await seedTeamRunCancellation(harness.ctx, created.team.id)
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
    try {
      const issued = driver.issue({
        kind: 'closure-recover-cancel',
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        cancellationIdempotencyKey: cancellation.idempotencyKey,
        cancellationRequestedAt: cancellation.requestedAt,
      })
      const settled = await harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        actor: issued.proof,
      })
      expect(settled.team).toMatchObject({
        phase: 'cancelled',
        cancellation,
        closure: {
          kind: 'cancel',
          idempotencyKey: cancellation.idempotencyKey,
          actor: cancellation.actor,
          reason: cancellation.reason,
        },
      })
      issued.revoke()

      const foreign = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Reject a foreign recovery proof.', budgets: {} }, rules: {}, budgets: {},
      })
      const foreignCancellation = await seedTeamRunCancellation(harness.ctx, foreign.team.id)
      const foreignState = await harness.ctx.teams.getTeam({ teamId: foreign.team.id })
      const foreignProof = driver.issue({
        kind: 'closure-recover-cancel',
        teamId: foreign.team.id,
        expectedCursor: foreignState.team.cursor,
        cancellationIdempotencyKey: foreignCancellation.idempotencyKey,
        cancellationRequestedAt: foreignCancellation.requestedAt,
      })
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: (await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
        actor: foreignProof.proof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      foreignProof.revoke()

      const current = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const wrongOperation = driver.issue({
        kind: 'closure-recover-fail',
        teamId: created.team.id,
        expectedCursor: current.team.cursor,
        closureIdempotencyKey: cancellation.idempotencyKey,
        closureRequestedAt: cancellation.requestedAt,
      })
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: current.team.cursor,
        actor: wrongOperation.proof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      wrongOperation.revoke()
      const revoked = driver.issue({
        kind: 'closure-recover-cancel',
        teamId: created.team.id,
        expectedCursor: current.team.cursor,
        cancellationIdempotencyKey: cancellation.idempotencyKey,
        cancellationRequestedAt: cancellation.requestedAt,
      })
      revoked.revoke()
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: current.team.cursor,
        actor: revoked.proof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const stale = driver.issue({
        kind: 'closure-recover-cancel',
        teamId: created.team.id,
        expectedCursor: current.team.cursor - 1,
        cancellationIdempotencyKey: cancellation.idempotencyKey,
        cancellationRequestedAt: cancellation.requestedAt,
      })
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: current.team.cursor - 1,
        actor: stale.proof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      stale.revoke()
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: current.team.cursor,
        actor: {} as TeamSystemClosureDriverProof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally {
      driver.dispose()
      await harness.dispose()
    }
  })

  it('persists current coordinator missing-final and structured failure observations', async () => {
    const harness = await setup()
    const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
    try {
      const missing = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Persist a missing final.', budgets: {} }, rules: {}, budgets: {},
      })
      const missingCoordinator = await activeParticipant(harness.ctx, missing.team.id, 'local-agent', 'coordinator', 'Coordinator')
      const missingBinding = await bindIdleActivation(harness.ctx, missing.team.id, missingCoordinator.id, 'missing-final')
      let current = await harness.ctx.teams.getTeam({ teamId: missing.team.id })
      const missingScope: TeamSystemClosureDriverScope = {
        kind: 'closure-stall-missing-final',
        teamId: missing.team.id,
        expectedCursor: current.team.cursor,
        coordinatorId: missingCoordinator.id,
        activationId: missingBinding.activation.id,
        sessionId: missingBinding.sessionId,
        provider: missingBinding.provider,
        turn: 2,
        reason: { code: 'FINAL_ANSWER_MISSING', message: 'The coordinator ended without a final answer.' },
      }
      let issued = driver.issue(missingScope)
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: missing.team.id,
        expectedCursor: current.team.cursor,
        actor: issued.proof,
      })).resolves.toMatchObject({
        team: { phase: 'stalled', stallReason: missingScope.reason },
      })
      issued.revoke()

      const failed = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Persist a turn failure.', budgets: {} }, rules: {}, budgets: {},
      })
      const failedCoordinator = await activeParticipant(harness.ctx, failed.team.id, 'local-agent', 'coordinator', 'Coordinator')
      const failedBinding = await bindIdleActivation(harness.ctx, failed.team.id, failedCoordinator.id, 'turn-failure')
      current = await harness.ctx.teams.getTeam({ teamId: failed.team.id })
      const failureScope: TeamSystemClosureDriverScope = {
        kind: 'closure-fail-turn',
        teamId: failed.team.id,
        expectedCursor: current.team.cursor,
        coordinatorId: failedCoordinator.id,
        activationId: failedBinding.activation.id,
        sessionId: failedBinding.sessionId,
        provider: failedBinding.provider,
        turn: 3,
        reason: { code: 'MODEL_UNAVAILABLE', message: 'The model provider failed.' },
      }
      issued = driver.issue(failureScope)
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: failed.team.id,
        expectedCursor: current.team.cursor,
        actor: issued.proof,
      })).resolves.toMatchObject({
        team: {
          phase: 'quiescing',
          closure: { kind: 'fail', reason: failureScope.reason, actor: { kind: 'system', name: 'team-closure-driver' } },
        },
      })
      issued.revoke()
    } finally {
      driver.dispose()
      await harness.dispose()
    }
  })

  it('rejects a turn observation from an offline coordinator epoch after a replacement activation binds', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Reject an offline coordinator observation.', budgets: {} }, rules: {}, budgets: {},
    })
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const oldBinding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'offline-observer-old')
    await updateActivationStatus(harness.ctx, oldBinding, 'offline')
    const current = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
    const issued = driver.issue({
      kind: 'closure-stall-missing-final',
      teamId: created.team.id,
      expectedCursor: current.team.cursor,
      coordinatorId: coordinator.id,
      activationId: oldBinding.activation.id,
      sessionId: oldBinding.sessionId,
      provider: oldBinding.provider,
      turn: 1,
      reason: { code: 'FINAL_ANSWER_MISSING', message: 'The offline epoch must not stall its replacement.' },
    })
    try {
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: current.team.cursor,
        actor: issued.proof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.phase).toBe('active')
    } finally {
      issued.revoke()
      driver.dispose()
      await harness.dispose()
    }
  })

  it('persists an exhausted wall-time budget through the closure-driver proof', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Persist a budget stall.', budgets: {} },
      rules: {},
      budgets: { maxWallTimeMs: 1 },
    })
    vi.spyOn(Date, 'now').mockReturnValue(102)
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
    const reason = {
      code: 'TEAM_WALL_TIME_BUDGET_EXCEEDED',
      message: `Team '${created.team.id}' exceeded its 1ms wall-time budget`,
    }
    const issued = driver.issue({
      kind: 'closure-stall-budget',
      teamId: created.team.id,
      expectedCursor: before.team.cursor,
      reason,
    })
    try {
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        actor: issued.proof,
      })).resolves.toMatchObject({ team: { phase: 'stalled', stallReason: reason } })
    } finally {
      issued.revoke()
      driver.dispose()
      await harness.dispose()
    }
  })

  it('stalls a quiescing Team that has no durable closure producer', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Persist an orphaned quiescing stall.', budgets: {} }, rules: {}, budgets: {},
    })
    const quiescing = await seedTeamPhase(harness.ctx, created.team.id, 'quiescing')
    const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
    const reason = {
      code: 'TEAM_CLOSURE_INTENT_MISSING',
      message: `Team '${created.team.id}' is quiescing without a durable closure producer`,
    }
    const issued = driver.issue({
      kind: 'closure-stall-quiescing',
      teamId: created.team.id,
      expectedCursor: quiescing.team.cursor,
      reason,
    })
    try {
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: quiescing.team.cursor,
        actor: issued.proof,
      })).resolves.toMatchObject({ team: { phase: 'stalled', stallReason: reason } })
    } finally {
      issued.revoke()
      driver.dispose()
      await harness.dispose()
    }
  })

  it('continues a durable cancellation after the Hub reopens its JSON journal', async () => {
    const first = await setup({}, undefined, 'json')
    const created = await createTestRootTeam(first.ctx, {
      goal: { objective: 'Recover cancellation after process loss.', budgets: {} }, rules: {}, budgets: {},
    })
    const cancellation = await seedTeamRunCancellation(first.ctx, created.team.id)
    const root = first.root
    await first.dispose()

    const recovered = await setup({}, root, 'json')
    const before = await recovered.ctx.teams.getTeam({ teamId: created.team.id })
    const driver = closureDriverAuthority(recovered.ctx, 'team-closure-driver')
    try {
      const issued = driver.issue({
        kind: 'closure-recover-cancel',
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        cancellationIdempotencyKey: cancellation.idempotencyKey,
        cancellationRequestedAt: cancellation.requestedAt,
      })
      await expect(recovered.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        actor: issued.proof,
      })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
      const after = await recovered.ctx.teams.getTeam({ teamId: created.team.id })
      expect(after.team).toMatchObject({
        phase: 'cancelled',
        cancellation,
        closure: { kind: 'cancel', idempotencyKey: cancellation.idempotencyKey, actor: cancellation.actor },
      })
      issued.revoke()
    } finally {
      driver.dispose()
      await recovered.dispose()
    }
  })

  for (const backend of ['json', 'sqlite'] as const) {
    for (const window of ['intent', 'admission', 'receipt'] as const) {
      it(`recovers a final result from the ${window} window on ${backend}`, async () => {
        const first = await setup({}, undefined, backend)
        const created = await createTestRootTeam(first.ctx, {
          goal: { objective: 'Recover an interrupted final receipt.', budgets: {} }, rules: {}, budgets: {},
        })
        const human = await activeParticipant(first.ctx, created.team.id, 'human', 'human', 'Human')
        const coordinator = await activeParticipant(first.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
        const coordinatorBinding = await bindIdleActivation(first.ctx, created.team.id, coordinator.id, `receipt-recovery-${backend}`)
        const channel = await openDirectV3(first.ctx, created.team.id, human.id, coordinator.id)
        const coordinatorActor = issueActivation(first.ctx, coordinatorBinding)
        const final = await first.ctx.teams.postChannelEnvelope({
          actor: coordinatorActor.proof,
          expectedCursor: channel.cursor,
          draft: {
            channelId: channel.manifest.id,
            audience: [human.id],
            kind: 'final',
            payload: { text: 'Recover this accepted final.' },
            delivery: 'turn',
          },
        })
        coordinatorActor.revoke()
        const closer = closureAuthority(first.ctx, 'team-run')
        const before = await first.ctx.teams.getTeam({ teamId: created.team.id })
        const initial = closer.issue({
          kind: 'team-run-complete',
          teamId: created.team.id,
          channelId: channel.manifest.id,
          humanId: human.id,
          coordinatorId: coordinator.id,
          finalEnvelopeId: final.id,
        })
        const accepted = await first.ctx.teams.completeTeam({
          teamId: created.team.id,
          expectedCursor: before.team.cursor,
          idempotencyKey: teamClosureIdempotencyKeySchema.parse(`receipt-recovery-${backend}-${created.team.id}`),
          reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'The final was accepted before the receipt append was interrupted.' },
          finalChannelId: channel.manifest.id,
          finalEnvelopeId: final.id,
          actor: initial.proof,
        })
        initial.revoke()
        closer.dispose()
        expect(accepted.team).toMatchObject({ phase: 'quiescing', closure: { finalEnvelopeId: final.id } })
        if (window !== 'intent') {
          const receipts = finalReceiptAuthority(first.ctx, 'team-run')
          const receipt = receipts.issue({ teamId: created.team.id, channelId: channel.manifest.id,
            humanId: human.id, coordinatorId: coordinator.id })
          await admitTestFinal(first.ctx, receipt.proof, final)
          if (window === 'receipt') {
            await first.ctx.teams.ackChannelEnvelope({ actor: receipt.proof, channelId: channel.manifest.id, envelopeId: final.id,
              expectedCursor: (await first.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor })
          }
          receipt.revoke()
          receipts.dispose()
        }
        await updateActivationStatus(first.ctx, coordinatorBinding, 'offline')
        const root = first.root
        await first.dispose()

        const recovered = await setup({}, root, backend)
        const driver = closureDriverAuthority(recovered.ctx, 'team-closure-driver')
        try {
          let state = await recovered.ctx.teams.getTeam({ teamId: created.team.id })
          const closure = state.team.closure
          if (closure?.kind !== 'complete' || closure.finalChannelId === undefined || closure.finalEnvelopeId === undefined) {
            throw new Error('completion intent did not survive restart')
          }
          if (window === 'intent') {
            const sinkProof = driver.issue({ kind: 'closure-recover-complete', teamId: created.team.id,
              expectedCursor: state.team.cursor, closureIdempotencyKey: closure.idempotencyKey,
              closureRequestedAt: closure.requestedAt, finalChannelId: closure.finalChannelId, finalEnvelopeId: closure.finalEnvelopeId })
            const appendFailure = new Error('final sink append failed')
            const append = vi.spyOn(finalSinkLog(recovered.ctx, 'team', created.team.id), 'append').mockRejectedValueOnce(appendFailure)
            await expect(recovered.ctx.teams.continueTeamClosure({ teamId: created.team.id,
              expectedCursor: state.team.cursor, actor: sinkProof.proof })).rejects.toBe(appendFailure)
            append.mockRestore()
            expect(await finalAdmissions(recovered.ctx, final)).toHaveLength(0)
            const sinkAccepted = await recovered.ctx.teams.continueTeamClosure({ teamId: created.team.id,
              expectedCursor: state.team.cursor, actor: sinkProof.proof })
            sinkProof.revoke()
            expect(sinkAccepted.team.phase).toBe('quiescing')
            expect(sinkAccepted.team.cursor).toBe(state.team.cursor + 1)
            const unreceipted = await recovered.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
            expect(unreceipted.records.filter(record => record.type === 'channel/receipt')).toHaveLength(0)
            state = sinkAccepted
          }
          const issued = driver.issue({
            kind: 'closure-recover-complete',
            teamId: created.team.id,
            expectedCursor: state.team.cursor,
            closureIdempotencyKey: closure.idempotencyKey,
            closureRequestedAt: closure.requestedAt,
            finalChannelId: closure.finalChannelId,
            finalEnvelopeId: closure.finalEnvelopeId,
          })
          if (window === 'admission') {
            await recovered.ctx.teams.getChannel({ channelId: channel.manifest.id })
            const appendFailure = new Error('final receipt append failed')
            const append = vi.spyOn(finalSinkLog(recovered.ctx, 'channel', channel.manifest.id), 'append').mockRejectedValueOnce(appendFailure)
            await expect(recovered.ctx.teams.continueTeamClosure({ teamId: created.team.id,
              expectedCursor: state.team.cursor, actor: issued.proof })).rejects.toBe(appendFailure)
            append.mockRestore()
            expect(await finalAdmissions(recovered.ctx, final)).toHaveLength(1)
          }
          await expect(recovered.ctx.teams.continueTeamClosure({
            teamId: created.team.id,
            expectedCursor: state.team.cursor,
            actor: issued.proof,
          })).resolves.toMatchObject({ team: { phase: 'completed' } })
          issued.revoke()
          const records = await recovered.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
          expect(records.records.filter(record => record.type === 'channel/receipt')).toHaveLength(1)
          expect(await finalAdmissions(recovered.ctx, final)).toMatchObject([{ facts: { admission: {
            teamId: created.team.id, channelId: channel.manifest.id, envelopeId: final.id,
            envelopeSequence: final.sequence, contentFingerprint: fingerprintTeamFinalContent(final.payload),
            recipientId: human.id, owner: { kind: 'system' }, sink: 'team-run-result',
          } } }])
        } finally {
          driver.dispose()
          await recovered.dispose()
        }
      })

    }

    it(`persists a normal completion intent through ${backend} restart until its driver closes owned resources`, async () => {
      const first = await setup({}, undefined, backend)
      const created = await createTestRootTeam(first.ctx, {
        goal: { objective: 'Recover one accepted completion intent.', budgets: {} }, rules: {}, budgets: {},
      })
      const human = await activeParticipant(first.ctx, created.team.id, 'human', 'human', 'Human')
      const coordinator = await activeParticipant(first.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
      const coordinatorBinding = await bindIdleActivation(first.ctx, created.team.id, coordinator.id, `intent-complete-coordinator-${backend}`)
      const channel = await openDirectV3(first.ctx, created.team.id, human.id, coordinator.id)
      const coordinatorActor = issueActivation(first.ctx, coordinatorBinding)
      const final = await first.ctx.teams.postChannelEnvelope({
        actor: coordinatorActor.proof,
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [human.id],
          kind: 'final',
          payload: { text: 'The durable completion intent is ready.' },
          delivery: 'turn',
        },
      })
      coordinatorActor.revoke()
      const receipts = finalReceiptAuthority(first.ctx, 'team-run')
      const humanActor = receipts.issue({
        teamId: created.team.id,
        channelId: channel.manifest.id,
        humanId: human.id,
        coordinatorId: coordinator.id,
      })
      await admitTestFinal(first.ctx, humanActor.proof, final)
      await first.ctx.teams.ackChannelEnvelope({
        actor: humanActor.proof,
        channelId: channel.manifest.id,
        envelopeId: final.id,
        expectedCursor: (await first.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      })
      humanActor.revoke()
      receipts.dispose()
      const closer = closureAuthority(first.ctx, 'team-run')
      const before = await first.ctx.teams.getTeam({ teamId: created.team.id })
      const initial = closer.issue({
        kind: 'team-run-complete',
        teamId: created.team.id,
        channelId: channel.manifest.id,
        humanId: human.id,
        coordinatorId: coordinator.id,
        finalEnvelopeId: final.id,
      })
      const accepted = await first.ctx.teams.completeTeam({
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        idempotencyKey: teamClosureIdempotencyKeySchema.parse(`intent-first-complete-${backend}-${created.team.id}`),
        reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'The human receipt is durable.' },
        finalChannelId: channel.manifest.id,
        finalEnvelopeId: final.id,
        actor: initial.proof,
      })
      expect(accepted.team).toMatchObject({
        phase: 'quiescing',
        closure: { kind: 'complete', actor: { kind: 'system', name: 'team-run' }, finalEnvelopeId: final.id },
      })
      expect(accepted.goal.phase).toBe('complete')
      initial.revoke()
      closer.dispose()
      const root = first.root
      await first.dispose()

      const recovered = await setup({}, root, backend)
      const driver = closureDriverAuthority(recovered.ctx, 'team-closure-driver')
      try {
        let state = await recovered.ctx.teams.getTeam({ teamId: created.team.id })
        const closure = state.team.closure
        if (closure?.kind !== 'complete'
          || closure.finalChannelId === undefined
          || closure.finalEnvelopeId === undefined) {
          throw new Error('completion intent did not survive restart')
        }
        expect(state.team).toMatchObject({ phase: 'quiescing', closure: { kind: 'complete', finalEnvelopeId: final.id } })
        let issued = driver.issue({
          kind: 'closure-recover-complete',
          teamId: created.team.id,
          expectedCursor: state.team.cursor,
          closureIdempotencyKey: closure.idempotencyKey,
          closureRequestedAt: closure.requestedAt,
          finalChannelId: closure.finalChannelId,
          finalEnvelopeId: closure.finalEnvelopeId,
        })
        await expect(recovered.ctx.teams.continueTeamClosure({
          teamId: created.team.id,
          expectedCursor: state.team.cursor,
          actor: issued.proof,
        })).resolves.toMatchObject({ team: { phase: 'quiescing', closure } })
        issued.revoke()

        for (const binding of state.activations) await updateActivationStatus(recovered.ctx, binding, 'offline')
        state = await recovered.ctx.teams.getTeam({ teamId: created.team.id })
        issued = driver.issue({
          kind: 'closure-recover-complete',
          teamId: created.team.id,
          expectedCursor: state.team.cursor,
          closureIdempotencyKey: closure.idempotencyKey,
          closureRequestedAt: closure.requestedAt,
          finalChannelId: closure.finalChannelId,
          finalEnvelopeId: closure.finalEnvelopeId,
        })
        await expect(recovered.ctx.teams.continueTeamClosure({
          teamId: created.team.id,
          expectedCursor: state.team.cursor,
          actor: issued.proof,
        })).resolves.toMatchObject({ team: { phase: 'completed', closure } })
        expect(await recovered.ctx.teams.getChannel({ channelId: channel.manifest.id })).toMatchObject({ phase: 'closed' })
        issued.revoke()
      } finally {
        driver.dispose()
        await recovered.dispose()
      }
    })

    it(`persists a normal failure intent through ${backend} restart until its driver closes owned resources`, async () => {
      const first = await setup({}, undefined, backend)
      const created = await createTestRootTeam(first.ctx, {
        goal: { objective: 'Recover one accepted failure intent.', budgets: {} }, rules: {}, budgets: {},
      })
      const worker = await activeParticipant(first.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
      const binding = await bindIdleActivation(first.ctx, created.team.id, worker.id, `intent-fail-worker-${backend}`)
      const state = await first.ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await openTestChannel(first.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: 'direct', version: 3 },
        participants: [{ id: worker.id, role: 'worker' }],
        limits: {},
      })
      const closer = closureAuthority(first.ctx, 'team-run')
      const before = await first.ctx.teams.getTeam({ teamId: created.team.id })
      const initial = closer.issue({ kind: 'team-run-create-failure', teamId: created.team.id })
      const accepted = await first.ctx.teams.failTeam({
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        idempotencyKey: teamClosureIdempotencyKeySchema.parse(`intent-first-fail-${backend}-${created.team.id}`),
        reason: { code: 'MODEL_UNAVAILABLE', message: 'The model provider failed permanently.' },
        actor: initial.proof,
      })
      expect(accepted.team).toMatchObject({
        phase: 'quiescing',
        closure: { kind: 'fail', actor: { kind: 'system', name: 'team-run' } },
      })
      initial.revoke()
      closer.dispose()
      const root = first.root
      await first.dispose()

      const recovered = await setup({}, root, backend)
      const driver = closureDriverAuthority(recovered.ctx, 'team-closure-driver')
      try {
        let current = await recovered.ctx.teams.getTeam({ teamId: created.team.id })
        const closure = current.team.closure
        if (closure?.kind !== 'fail') throw new Error('failure intent did not survive restart')
        let issued = driver.issue({
          kind: 'closure-recover-fail',
          teamId: created.team.id,
          expectedCursor: current.team.cursor,
          closureIdempotencyKey: closure.idempotencyKey,
          closureRequestedAt: closure.requestedAt,
        })
        await expect(recovered.ctx.teams.continueTeamClosure({
          teamId: created.team.id,
          expectedCursor: current.team.cursor,
          actor: issued.proof,
        })).resolves.toMatchObject({ team: { phase: 'quiescing', closure } })
        issued.revoke()

        const recoveredBinding = current.activations.find(item => item.activation.id === binding.activation.id)
        if (recoveredBinding === undefined) throw new Error('failure activation did not survive restart')
        await updateActivationStatus(recovered.ctx, recoveredBinding, 'offline')
        current = await recovered.ctx.teams.getTeam({ teamId: created.team.id })
        issued = driver.issue({
          kind: 'closure-recover-fail',
          teamId: created.team.id,
          expectedCursor: current.team.cursor,
          closureIdempotencyKey: closure.idempotencyKey,
          closureRequestedAt: closure.requestedAt,
        })
        await expect(recovered.ctx.teams.continueTeamClosure({
          teamId: created.team.id,
          expectedCursor: current.team.cursor,
          actor: issued.proof,
        })).resolves.toMatchObject({ team: { phase: 'failed', closure } })
        expect(await recovered.ctx.teams.getChannel({ channelId: channel.manifest.id })).toMatchObject({ phase: 'closed' })
        issued.revoke()
      } finally {
        driver.dispose()
        await recovered.dispose()
      }
    })
  }

  it('leaves a durable cancellation nonterminal while existing resource checks remain unsatisfied', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Do not terminalize a live cancellation.', budgets: {} }, rules: {}, budgets: {},
    })
    const worker = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Live worker')
    await bindIdleActivation(harness.ctx, created.team.id, worker.id, 'recover-cancel-live')
    const cancellation = await seedTeamRunCancellation(harness.ctx, created.team.id)
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
    try {
      const issued = driver.issue({
        kind: 'closure-recover-cancel',
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        cancellationIdempotencyKey: cancellation.idempotencyKey,
        cancellationRequestedAt: cancellation.requestedAt,
      })
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        actor: issued.proof,
      })).resolves.toMatchObject({ team: { phase: 'quiescing', cancellation } })
      const after = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      expect(after.team.cursor).toBe(before.team.cursor)
      expect(after.team.closure).toBeUndefined()
      issued.revoke()
    } finally {
      driver.dispose()
      await harness.dispose()
    }
  })

  it('terminalizes exact durable failure and completion intents without reusing their original actor proof', async () => {
    const harness = await setup()
    const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
    try {
      const failing = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Recover a durable failure.', budgets: {} }, rules: {}, budgets: {},
      })
      const failure = await seedClosureIntent(harness.ctx, failing.team.id, {
        kind: 'fail',
        idempotencyKey: teamClosureIdempotencyKeySchema.parse(`closure-recover-fail-${failing.team.id}`),
        actor: { kind: 'system', name: 'team-run' },
        reason: { code: 'MODEL_UNAVAILABLE', message: 'The durable failure was accepted before process loss.' },
      })
      let state = await harness.ctx.teams.getTeam({ teamId: failing.team.id })
      const failProof = driver.issue({
        kind: 'closure-recover-fail',
        teamId: failing.team.id,
        expectedCursor: state.team.cursor,
        closureIdempotencyKey: failure.idempotencyKey,
        closureRequestedAt: failure.requestedAt,
      })
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: failing.team.id,
        expectedCursor: state.team.cursor,
        actor: failProof.proof,
      })).resolves.toMatchObject({ team: { phase: 'failed', closure: failure } })
      failProof.revoke()

      const completing = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Recover a human-receipted final.', budgets: {} }, rules: {}, budgets: {},
      })
      const human = await activeParticipant(harness.ctx, completing.team.id, 'human', 'human', 'Human')
      const coordinator = await activeParticipant(harness.ctx, completing.team.id, 'local-agent', 'coordinator', 'Coordinator')
      const coordinatorBinding = await bindIdleActivation(harness.ctx, completing.team.id, coordinator.id, 'recover-complete-coordinator')
      const channel = await openDirectV3(harness.ctx, completing.team.id, human.id, coordinator.id)
      const coordinatorActor = issueActivation(harness.ctx, coordinatorBinding)
      const final = await harness.ctx.teams.postChannelEnvelope({
        actor: coordinatorActor.proof,
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [human.id],
          kind: 'final',
          payload: { text: 'The durable final is ready.' },
          delivery: 'turn',
        },
      })
      coordinatorActor.revoke()
      const receipts = finalReceiptAuthority(harness.ctx, 'team-run')
      const receipt = receipts.issue({
        teamId: completing.team.id,
        channelId: channel.manifest.id,
        humanId: human.id,
        coordinatorId: coordinator.id,
      })
      await admitTestFinal(harness.ctx, receipt.proof, final)
      await harness.ctx.teams.ackChannelEnvelope({
        actor: receipt.proof,
        channelId: channel.manifest.id,
        envelopeId: final.id,
        expectedCursor: (await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      })
      receipt.revoke()
      receipts.dispose()
      await updateActivationStatus(harness.ctx, coordinatorBinding, 'offline')
      await closeTestChannel(harness.ctx, {
        channelId: channel.manifest.id,
        expectedCursor: (await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      })
      const completion = await seedClosureIntent(harness.ctx, completing.team.id, {
        kind: 'complete',
        idempotencyKey: teamClosureIdempotencyKeySchema.parse(`closure-recover-complete-${completing.team.id}`),
        actor: { kind: 'system', name: 'team-run' },
        reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'The durable final answer was accepted.' },
        finalChannelId: channel.manifest.id,
        finalEnvelopeId: final.id,
      })
      state = await harness.ctx.teams.getTeam({ teamId: completing.team.id })
      const completionProof = driver.issue({
        kind: 'closure-recover-complete',
        teamId: completing.team.id,
        expectedCursor: state.team.cursor,
        closureIdempotencyKey: completion.idempotencyKey,
        closureRequestedAt: completion.requestedAt,
        finalChannelId: channel.manifest.id,
        finalEnvelopeId: final.id,
      })
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: completing.team.id,
        expectedCursor: state.team.cursor,
        actor: completionProof.proof,
      })).resolves.toMatchObject({ team: { phase: 'completed', closure: completion } })
      completionProof.revoke()
    } finally {
      driver.dispose()
      await harness.dispose()
    }
  })

  it('re-resolves a closure-driver proof after close policy before channel or Team settlement', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Reject a revoked recovery pass.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const channel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const coordinatorBinding = (await harness.ctx.teams.getTeam({ teamId: created.team.id })).activations
      .find(binding => binding.activation.participantId === coordinator.id)
    if (coordinatorBinding === undefined) throw new Error('closure-driver fixture has no coordinator activation')
    await updateActivationStatus(harness.ctx, coordinatorBinding, 'offline')
    const cancellation = await seedTeamRunCancellation(harness.ctx, created.team.id)
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const beforeChannel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
    const driver = closureDriverAuthority(harness.ctx, 'team-closure-driver')
    const issued = driver.issue({
      kind: 'closure-recover-cancel',
      teamId: created.team.id,
      expectedCursor: before.team.cursor,
      cancellationIdempotencyKey: cancellation.idempotencyKey,
      cancellationRequestedAt: cancellation.requestedAt,
    })
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'revoke-closure-driver-before-channel-wal',
      async apply(request, next) {
        if (request.facts.operation === 'closure-driver-cancellation-channel-close') issued.revoke()
        return await next()
      },
    })
    try {
      await expect(harness.ctx.teams.continueTeamClosure({
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        actor: issued.proof,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const after = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const afterChannel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
      expect(after.team.cursor).toBe(before.team.cursor)
      expect(after.team.cancellation).toEqual(cancellation)
      expect(after.team.closure).toBeUndefined()
      expect(afterChannel).toMatchObject({ phase: 'active', cursor: beforeChannel.cursor })
    } finally {
      unregister()
      driver.dispose()
      await harness.dispose()
    }
  })

  it('requires exact one-shot TeamRun topology proofs before participant policy, Team journal, or bootstrap channel WAL admission', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect default topology assembly.', budgets: {} }, rules: {}, budgets: {},
    })
    harness.ctx.teams.registerViewPolicy({ type: 'directed', version: 1, project() { return {} } })
    const authority = topologyAuthority(harness.ctx, 'team-run')
    const invitePolicies: unknown[] = []
    const channelPolicies: unknown[] = []
    let revokeChannelProofAfterPolicy: (() => void) | undefined
    const unregisterInvite = harness.ctx.teams.registerPolicy('invite', {
      name: 'observe-topology-invite',
      async apply(request, next) {
        invitePolicies.push(request)
        return await next()
      },
    })
    const unregisterChannel = harness.ctx.teams.registerPolicy('channel-open', {
      name: 'observe-topology-channel',
      async apply(request, next) {
        channelPolicies.push(request)
        revokeChannelProofAfterPolicy?.()
        return await next()
      },
    })
    const invite = async (
      kind: ParticipantSnapshot['kind'],
      role: string,
      displayName: string,
    ): Promise<ParticipantSnapshot> => {
      const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const participant = {
        kind, role, displayName, capabilities: [],
        ...kind === 'human' ? { owner: { kind: 'system' as const } } : {},
      }
      const input = { teamId: created.team.id, expectedCursor: state.team.cursor, ...participant }
      const issued = authority.issue({
        kind: 'team-run-bootstrap-participant-invite',
        teamId: input.teamId,
        expectedCursor: input.expectedCursor,
        participant,
      })
      try {
        return await harness.ctx.teams.inviteParticipant({ actor: issued.proof, ...input })
      } finally {
        issued.revoke()
      }
    }
    const phase = async (participant: ParticipantSnapshot, expectedPhase: 'invited' | 'provisioning', next: 'provisioning' | 'active') => {
      const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const input = { teamId: created.team.id, participantId: participant.id, expectedCursor: state.team.cursor, phase: next }
      const issued = authority.issue({
        kind: 'team-run-bootstrap-participant-phase',
        ...input,
        expectedPhase,
      })
      try {
        return await harness.ctx.teams.transitionParticipantPhase({ actor: issued.proof, ...input })
      } finally {
        issued.revoke()
      }
    }
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const invalidInput = {
      teamId: created.team.id,
      expectedCursor: before.team.cursor,
      kind: 'human' as const,
      role: 'human',
      displayName: 'Human',
      capabilities: [],
      owner: { kind: 'system' as const },
    }
    await expect(harness.ctx.teams.inviteParticipant({ actor: topologyProof(), ...invalidInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(before.team.cursor)
    expect(invitePolicies).toEqual([])

    const human = await invite('human', 'human', 'Human')
    await phase(human, 'invited', 'provisioning')
    const activeHuman = await phase(human, 'provisioning', 'active')
    const coordinator = await invite('local-agent', 'coordinator', 'Coordinator')
    await phase(coordinator, 'invited', 'provisioning')
    const activeCoordinator = await phase(coordinator, 'provisioning', 'active')
    const team = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const channelInput = {
      teamId: created.team.id,
      expectedCursor: team.team.cursor,
      adapter: { type: 'direct', version: 4 },
      viewPolicy: { type: 'directed', version: 1 },
      participants: [{ id: activeHuman.id, role: 'human' }, { id: activeCoordinator.id, role: 'coordinator' }],
      limits: {},
    }
    const channelScope: TeamSystemTopologyScope = {
      kind: 'team-run-bootstrap-channel-open',
      ...channelInput,
      humanId: activeHuman.id,
      coordinatorId: activeCoordinator.id,
    }
    const revoked = authority.issue(channelScope)
    revoked.revoke()
    await expect(harness.ctx.teams.openChannel({ actor: revoked.proof, ...channelInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(channelPolicies).toEqual([])
    const revokedAfterPolicy = authority.issue(channelScope)
    revokeChannelProofAfterPolicy = () => { revokedAfterPolicy.revoke() }
    await expect(harness.ctx.teams.openChannel({ actor: revokedAfterPolicy.proof, ...channelInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    revokeChannelProofAfterPolicy = undefined
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).channelIds).toEqual([])
    const accepted = authority.issue(channelScope)
    try {
      await expect(harness.ctx.teams.openChannel({ actor: accepted.proof, ...channelInput }))
        .resolves.toMatchObject({ manifest: { teamId: created.team.id, adapter: { type: 'direct', version: 4 } } })
    } finally {
      accepted.revoke()
    }
    expect(channelPolicies).toHaveLength(2)
    unregisterChannel()
    unregisterInvite()
    authority.dispose()
    await harness.dispose()
  })

  it('revalidates goal, topology, and activation proofs after policy before durable acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Reject policy-revoked authority before durable acceptance.', budgets: {} }, rules: {}, budgets: {},
    })
    const topology = topologyAuthority(harness.ctx, 'team-run')
    const bootstrapParticipant = async (role: string, displayName: string): Promise<ParticipantSnapshot> => {
      let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const inviteInput = {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'local-agent' as const,
        role,
        displayName,
        capabilities: [],
      }
      const invite = topology.issue({
        kind: 'team-run-bootstrap-participant-invite',
        teamId: inviteInput.teamId,
        expectedCursor: inviteInput.expectedCursor,
        participant: {
          kind: inviteInput.kind,
          role: inviteInput.role,
          displayName: inviteInput.displayName,
          capabilities: inviteInput.capabilities,
        },
      })
      const invited = await harness.ctx.teams.inviteParticipant({ actor: invite.proof, ...inviteInput })
      invite.revoke()
      const transition = async (
        expectedPhase: 'invited' | 'provisioning',
        phase: 'provisioning' | 'active',
      ): Promise<ParticipantSnapshot> => {
        state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
        const input = {
          teamId: created.team.id,
          participantId: invited.id,
          expectedCursor: state.team.cursor,
          phase,
        }
        const issued = topology.issue({
          kind: 'team-run-bootstrap-participant-phase',
          ...input,
          expectedPhase,
        })
        const transitioned = await harness.ctx.teams.transitionParticipantPhase({ actor: issued.proof, ...input })
        issued.revoke()
        return transitioned
      }
      await transition('invited', 'provisioning')
      return await transition('provisioning', 'active')
    }
    const goalParticipant = await bootstrapParticipant('coordinator', 'Goal coordinator')
    const lifecycleParticipant = await bootstrapParticipant('worker', 'Lifecycle worker')
    const bindParticipant = await bootstrapParticipant('worker', 'Bind worker')
    const goalBinding = await bindIdleActivation(harness.ctx, created.team.id, goalParticipant.id, 'policy-goal')
    const lifecycleBinding = await bindIdleActivation(harness.ctx, created.team.id, lifecycleParticipant.id, 'policy-lifecycle')
    const controller = controllerActivationAuthority(harness.ctx)
    const revocations = new Map<'goal-mutate' | 'invite' | 'activate' | 'task-mutate', () => void>()
    const register = (hook: 'goal-mutate' | 'invite' | 'activate' | 'task-mutate') => harness.ctx.teams.registerPolicy(hook, {
      name: `revoke-${hook}-proof-after-policy`,
      async apply(_request, next) {
        revocations.get(hook)?.()
        return await next()
      },
    })
    const unregisterGoal = register('goal-mutate')
    const unregisterInvite = register('invite')
    const unregisterActivate = register('activate')
    const unregisterTask = register('task-mutate')
    const rejectAfterPolicy = async (
      hook: 'goal-mutate' | 'invite' | 'activate' | 'task-mutate',
      revoke: () => void,
      operation: () => Promise<unknown>,
    ): Promise<void> => {
      const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      revocations.set(hook, revoke)
      try {
        await expect(operation()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        revocations.delete(hook)
      }
      expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(before.team.cursor)
    }
    try {
      let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const goalUpdate = issueActivation(harness.ctx, goalBinding)
      await rejectAfterPolicy('goal-mutate', () => { goalUpdate.revoke() }, async () => await harness.ctx.teams.updateTeamGoal({
        actor: goalUpdate.proof,
        teamId: created.team.id,
        expectedRevision: state.goal.revision,
        objective: 'This policy-revoked goal must not persist.',
      }))

      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const goalPhase = issueActivation(harness.ctx, goalBinding)
      await rejectAfterPolicy('goal-mutate', () => { goalPhase.revoke() }, async () => await harness.ctx.teams.transitionTeamGoalPhase({
        actor: goalPhase.proof,
        teamId: created.team.id,
        expectedRevision: state.goal.revision,
        phase: 'blocked',
        blocker: { code: 'policy-revoked', message: 'The proof was revoked during policy evaluation.' },
      }))

      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const inviteInput = {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'local-agent' as const,
        role: 'worker',
        displayName: 'Topology candidate',
        capabilities: [],
      }
      const inviteScope: TeamSystemTopologyScope = {
        kind: 'team-run-bootstrap-participant-invite',
        teamId: inviteInput.teamId,
        expectedCursor: inviteInput.expectedCursor,
        participant: {
          kind: inviteInput.kind,
          role: inviteInput.role,
          displayName: inviteInput.displayName,
          capabilities: inviteInput.capabilities,
        },
      }
      const invite = topology.issue(inviteScope)
      await rejectAfterPolicy('invite', () => { invite.revoke() }, async () => await harness.ctx.teams.inviteParticipant({
        actor: invite.proof,
        ...inviteInput,
      }))

      const acceptedInvite = topology.issue(inviteScope)
      const invited = await harness.ctx.teams.inviteParticipant({ actor: acceptedInvite.proof, ...inviteInput })
      acceptedInvite.revoke()
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const phaseInput = {
        teamId: created.team.id,
        participantId: invited.id,
        expectedCursor: state.team.cursor,
        phase: 'provisioning' as const,
      }
      const phase = topology.issue({
        kind: 'team-run-bootstrap-participant-phase',
        ...phaseInput,
        expectedPhase: 'invited',
      })
      await rejectAfterPolicy('activate', () => { phase.revoke() }, async () => await harness.ctx.teams.transitionParticipantPhase({
        actor: phase.proof,
        ...phaseInput,
      }))

      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const bindInput = {
        expectedCursor: state.team.cursor,
        binding: {
          activation: {
            id: activationIdSchema.parse('activation-policy-revoked-bind'),
            teamId: created.team.id,
            participantId: bindParticipant.id,
            status: 'idle' as const,
          },
          sessionId: SessionId('session-policy-revoked-bind'),
          provider: 'policy-revoked-test',
        },
      }
      const bind = controller.issue({ kind: 'activation-controller-bind', ...bindInput })
      await rejectAfterPolicy('activate', () => { bind.revoke() }, async () => await harness.ctx.teams.bindActivation({
        actor: bind.proof,
        ...bindInput,
      }))

      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const statusInput = {
        teamId: created.team.id,
        activationId: lifecycleBinding.activation.id,
        expectedCursor: state.team.cursor,
        status: 'running' as const,
      }
      const status = controller.issue({
        kind: 'activation-controller-status',
        participantId: lifecycleBinding.activation.participantId,
        sessionId: lifecycleBinding.sessionId,
        provider: lifecycleBinding.provider,
        ...statusInput,
      })
      await rejectAfterPolicy('activate', () => { status.revoke() }, async () => await harness.ctx.teams.updateActivationStatus({
        actor: status.proof,
        ...statusInput,
      }))

      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const task = await createTestCoordinatorTask(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        subject: 'Fence policy race',
        description: 'Revoke fence authority after the task policy grants it.',
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
      const assigned = await assignTestTask(harness.ctx, {
        teamId: created.team.id,
        taskId: task.id,
        expectedRevision: task.revision,
        participantId: lifecycleParticipant.id,
        activationId: lifecycleBinding.activation.id,
        leaseDurationMs: 1_000,
      })
      if (assigned.lease === undefined) throw new Error('fence policy race task must retain an activation lease')
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const quiescenceInput = {
        teamId: created.team.id,
        activationId: lifecycleBinding.activation.id,
        participantId: lifecycleBinding.activation.participantId,
        sessionId: lifecycleBinding.sessionId,
        provider: lifecycleBinding.provider,
        expectedCursor: state.team.cursor,
      }
      const fence = controller.issue({ kind: 'activation-controller-fence', ...quiescenceInput })
      await rejectAfterPolicy('task-mutate', () => { fence.revoke() }, async () => await harness.ctx.teams.fenceActivation({
        actor: fence.proof,
        ...quiescenceInput,
      }))

      const quiesce = controller.issue({ kind: 'activation-controller-quiesce', ...quiescenceInput })
      await rejectAfterPolicy('activate', () => { quiesce.revoke() }, async () => await harness.ctx.teams.quiesceActivation({
        actor: quiesce.proof,
        ...quiescenceInput,
      }))
    } finally {
      unregisterTask()
      unregisterActivate()
      unregisterInvite()
      unregisterGoal()
      topology.dispose()
      await harness.dispose()
    }
  })

  it('requires exact generic channel lifecycle proofs before policy and rechecks them after policy', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect generic channel admission.', budgets: {} }, rules: {}, budgets: {},
    })
    const initiator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'initiator', 'Initiator')
    const recipient = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'recipient', 'Recipient')
    const authority = channelLifecycleAuthority(harness.ctx)
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const input = {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'direct', version: 3 },
      participants: [{ id: initiator.id, role: 'initiator' }, { id: recipient.id, role: 'recipient' }],
      limits: { maxTurns: 2 },
    }
    const scope = (request: typeof input): TeamSystemChannelLifecycleScope => ({
      kind: 'channel-open',
      ...request,
    })
    const policyRequests: unknown[] = []
    let blockAfterPolicy = false
    let releasePolicy: (() => void) | undefined
    const policyGate = new Promise<void>((resolve) => { releasePolicy = resolve })
    let enteredPolicy: (() => void) | undefined
    const policyEntered = new Promise<void>((resolve) => { enteredPolicy = resolve })
    const unregister = harness.ctx.teams.registerPolicy('channel-open', {
      name: 'observe-generic-channel-lifecycle',
      async apply(request, next) {
        policyRequests.push(request)
        if (blockAfterPolicy) {
          enteredPolicy?.()
          await policyGate
        }
        return await next()
      },
    })
    try {
      await expect(harness.ctx.teams.openChannel(input as never))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await expect(harness.ctx.teams.openChannel({
        actor: {} as TeamSystemChannelLifecycleProof,
        authorityKind: 'channel-lifecycle',
        ...input,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const mismatched = authority.issue({
        kind: 'channel-open',
        ...input,
        limits: { maxTurns: 3 },
      })
      await expect(harness.ctx.teams.openChannel({
        actor: mismatched.proof,
        authorityKind: 'channel-lifecycle',
        ...input,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      mismatched.revoke()
      expect(policyRequests).toEqual([])

      const accepted = authority.issue(scope(input))
      const channel = await harness.ctx.teams.openChannel({
        actor: accepted.proof,
        authorityKind: 'channel-lifecycle',
        ...input,
      })
      accepted.revoke()
      expect(channel.manifest).toMatchObject({ teamId: created.team.id, limits: { maxTurns: 2 } })
      expect(policyRequests).toHaveLength(1)

      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const racedInput = { ...input, expectedCursor: state.team.cursor }
      const raced = authority.issue(scope(racedInput))
      blockAfterPolicy = true
      const race = harness.ctx.teams.openChannel({
        actor: raced.proof,
        authorityKind: 'channel-lifecycle',
        ...racedInput,
      })
      await policyEntered
      raced.revoke()
      releasePolicy?.()
      await expect(race).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const afterRace = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      expect(afterRace.team.cursor).toBe(state.team.cursor)
      expect(afterRace.channelIds).toEqual([channel.manifest.id])

      blockAfterPolicy = false
      const streamInput = { ...input, expectedCursor: afterRace.team.cursor }
      const streamProof = authority.issue(scope(streamInput))
      const streamsBefore = await harness.ctx.storageLog.list()
      const open = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
      const opened = Promise.withResolvers<undefined>()
      const continueOpen = Promise.withResolvers<undefined>()
      const streamSpy = vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name.startsWith('channel/')) {
          opened.resolve(undefined)
          await continueOpen.promise
        }
        return stream
      })
      try {
        const opening = harness.ctx.teams.openChannel({
          actor: streamProof.proof,
          authorityKind: 'channel-lifecycle',
          ...streamInput,
        })
        await opened.promise
        streamProof.revoke()
        continueOpen.resolve(undefined)
        await expect(opening).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        streamSpy.mockRestore()
      }
      expect(await harness.ctx.storageLog.list()).toEqual(streamsBefore)
      expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(afterRace.team.cursor)
    } finally {
      unregister()
      authority.dispose()
      await harness.dispose()
    }
  })

  it('requires exact scheduler wake-channel proofs before policy, WAL attachment, or failed-wake cleanup', async () => {
    const harness = await setup()
    harness.ctx.teams.registerAdapter({ ...directV3Adapter, type: 'task-assignment', version: 1 })
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect scheduler wake channel authority.', budgets: {} }, rules: {}, budgets: {},
    })
    const worker = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    const binding = await bindIdleActivation(harness.ctx, created.team.id, worker.id, 'scheduler-wake')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const coordinatorBinding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'scheduler-wake-coordinator')
    const coordinatorActor = issueActivation(harness.ctx, coordinatorBinding)
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const task = await harness.ctx.teams.createTask({
      actor: coordinatorActor.proof,
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('scheduler-wake-task') },
      subject: 'Wake channel task',
      description: 'Only the scheduler may open its task-assignment wake.',
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
    coordinatorActor.revoke()
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const input = {
      teamId: created.team.id,
      expectedTeamCursor: state.team.cursor,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: worker.id,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
    }
    const scope: TeamSystemSchedulerChannelScope = { kind: 'scheduler-wake-channel-open', ...input }
    const scheduler = schedulerChannelAuthority(harness.ctx, 'team-scheduler-dag')
    const other = schedulerChannelAuthority(harness.ctx, 'other-system')
    const policies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('channel-open', {
      name: 'observe-scheduler-wake-open',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })
    const revoked = scheduler.issue(scope)
    revoked.revoke()
    const staleInput = { ...input, expectedTeamCursor: input.expectedTeamCursor - 1 }
    const stale = scheduler.issue({ kind: 'scheduler-wake-channel-open', ...staleInput })
    const wrongOperation = scheduler.issue({
      kind: 'scheduler-review-channel-open',
      teamId: input.teamId,
      expectedTeamCursor: input.expectedTeamCursor,
      taskId: input.taskId,
      expectedRevision: input.expectedRevision,
      attemptId: 'scheduler-wake-wrong-attempt' as never,
      initiatorId: worker.id,
      reviewerId: worker.id,
      reviewerActivationId: binding.activation.id,
      reviewerSessionId: binding.sessionId,
      reviewerProvider: binding.provider,
    })
    for (const actor of [schedulerChannelProof(), revoked.proof, stale.proof, wrongOperation.proof, other.issue(scope).proof]) {
      const selected = actor === stale.proof ? staleInput : input
      await expect(harness.ctx.teams.openSchedulerWakeChannel({ actor, ...selected }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).channelIds).toEqual([])
    expect(policies).toEqual([])

    const openPolicyEntered = Promise.withResolvers<undefined>()
    const releaseOpenPolicy = Promise.withResolvers<undefined>()
    const unregisterOpenGate = harness.ctx.teams.registerPolicy('channel-open', {
      name: 'revoke-scheduler-wake-open-after-policy',
      async apply(request, next) {
        if (request.facts.operation !== 'scheduler-wake-channel-open') return await next()
        openPolicyEntered.resolve(undefined)
        await releaseOpenPolicy.promise
        return await next()
      },
    })
    const revokedDuringOpenPolicy = scheduler.issue(scope)
    const openPolicyRace = harness.ctx.teams.openSchedulerWakeChannel({ actor: revokedDuringOpenPolicy.proof, ...input })
    await openPolicyEntered.promise
    revokedDuringOpenPolicy.revoke()
    releaseOpenPolicy.resolve(undefined)
    await expect(openPolicyRace).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).channelIds).toEqual([])
    unregisterOpenGate()

    const streamsBeforeOpen = await harness.ctx.storageLog.list()
    const storageOpen = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
    const channelStreamOpened = Promise.withResolvers<undefined>()
    const continueChannelOpen = Promise.withResolvers<undefined>()
    const streamSpy = vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
      const stream = await storageOpen(descriptor)
      if (descriptor.name.startsWith('channel/')) {
        channelStreamOpened.resolve(undefined)
        await continueChannelOpen.promise
      }
      return stream
    })
    const revokedAfterStreamOpen = scheduler.issue(scope)
    try {
      const streamOpenRace = harness.ctx.teams.openSchedulerWakeChannel({ actor: revokedAfterStreamOpen.proof, ...input })
      await channelStreamOpened.promise
      revokedAfterStreamOpen.revoke()
      continueChannelOpen.resolve(undefined)
      await expect(streamOpenRace).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally {
      streamSpy.mockRestore()
    }
    expect(await harness.ctx.storageLog.list()).toEqual(streamsBeforeOpen)
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).channelIds).toEqual([])

    const opened = scheduler.issue(scope)
    const wake = await harness.ctx.teams.openSchedulerWakeChannel({ actor: opened.proof, ...input })
    opened.revoke()
    await acknowledgeTestChannelActivations(harness.ctx, wake.manifest.id)
    expect(wake.manifest).toMatchObject({
      adapter: { type: 'task-assignment', version: 1 },
      participants: [{ id: worker.id, role: 'assignee' }],
      limits: { taskId: task.id, activationId: binding.activation.id, sessionId: binding.sessionId },
    })
    expect(policies).toHaveLength(4)
    const currentWake = await harness.ctx.teams.getChannel({ channelId: wake.manifest.id })
    const closeInput = {
      teamId: created.team.id,
      taskId: task.id,
      participantId: worker.id,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      channelId: wake.manifest.id,
      expectedChannelCursor: currentWake.cursor,
    }
    const close = scheduler.issue({
      kind: 'scheduler-failed-wake-channel-close',
      ...closeInput,
      reason: 'Task assignment did not commit',
    })
    const closePolicyEntered = Promise.withResolvers<undefined>()
    const releaseClosePolicy = Promise.withResolvers<undefined>()
    const unregisterCloseGate = harness.ctx.teams.registerPolicy('close', {
      name: 'revoke-scheduler-failed-wake-close-after-policy',
      async apply(request, next) {
        if (request.facts.operation !== 'scheduler-failed-wake-channel-close') return await next()
        closePolicyEntered.resolve(undefined)
        await releaseClosePolicy.promise
        return await next()
      },
    })
    const revokedDuringClosePolicy = scheduler.issue({
      kind: 'scheduler-failed-wake-channel-close',
      ...closeInput,
      reason: 'Task assignment did not commit',
    })
    const closePolicyRace = harness.ctx.teams.closeSchedulerFailedWakeChannel({
      actor: revokedDuringClosePolicy.proof,
      ...closeInput,
    })
    await closePolicyEntered.promise
    revokedDuringClosePolicy.revoke()
    releaseClosePolicy.resolve(undefined)
    await expect(closePolicyRace).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(await harness.ctx.teams.getChannel({ channelId: wake.manifest.id }))
      .toMatchObject({ phase: 'active', cursor: currentWake.cursor })
    unregisterCloseGate()
    await expect(harness.ctx.teams.closeSchedulerFailedWakeChannel({ actor: close.proof, ...closeInput }))
      .resolves.toMatchObject({ phase: 'closed' })
    close.revoke()
    const tornDown = scheduler.issue(scope)
    scheduler.dispose()
    await expect(harness.ctx.teams.openSchedulerWakeChannel({ actor: tornDown.proof, ...input }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    unregister()
    other.dispose()
    await harness.dispose()
  })

  it('requires exact scheduler delivery-expiry proofs and permits attached terminal channels during cancellation quiescence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Expire only the scheduler-selected delivery batch.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human recipient')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const coordinatorBinding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'scheduler-delivery-expiry')
    const opened = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const coordinatorLease = issueActivation(harness.ctx, coordinatorBinding)
    const delivered = await harness.ctx.teams.postChannelEnvelope({
      actor: coordinatorLease.proof,
      expectedCursor: opened.cursor,
      draft: {
        channelId: opened.manifest.id,
        audience: [human.id],
        kind: 'message',
        payload: { text: 'This delivery should expire after its TTL.' },
        delivery: 'turn',
        ttlMs: 1,
      },
    })
    coordinatorLease.revoke()
    const closed = await closeTestChannel(harness.ctx, {
      channelId: opened.manifest.id,
      expectedCursor: delivered.sequence,
      reason: 'Expiry remains valid after terminal channel closure.',
    })
    const ttlMs = delivered.ttlMs
    if (ttlMs === undefined) throw new Error('TTL delivery fixture lost its deadline')
    const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const current = await harness.ctx.teams.getChannel({ channelId: closed.manifest.id })
    const input = {
      teamId: created.team.id,
      channelId: closed.manifest.id,
      expectedTeamCursor: state.team.cursor,
      expectedChannelCursor: current.cursor,
      now: delivered.createdAt + ttlMs,
      limit: 1,
    }
    const scope: TeamSystemSchedulerChannelScope = { kind: 'scheduler-channel-delivery-expire', ...input }
    const scheduler = schedulerChannelAuthority(harness.ctx, 'team-scheduler-dag')
    const other = schedulerChannelAuthority(harness.ctx, 'other-system')
    const revoked = scheduler.issue(scope)
    revoked.revoke()
    const staleScope = scheduler.issue({ ...scope, expectedChannelCursor: input.expectedChannelCursor - 1 })
    const clockAbuse = scheduler.issue({ ...scope, now: input.now + 1 })
    const wrongOperation = scheduler.issue({
      kind: 'scheduler-wake-channel-open',
      teamId: input.teamId,
      expectedTeamCursor: input.expectedTeamCursor,
      taskId: 'scheduler-delivery-wrong-operation' as never,
      expectedRevision: 1,
      participantId: coordinator.id,
      activationId: coordinatorBinding.activation.id,
      sessionId: coordinatorBinding.sessionId,
    })
    const invalidActors = [
      schedulerChannelProof(), revoked.proof, staleScope.proof, clockAbuse.proof, wrongOperation.proof, other.issue(scope).proof,
    ]
    for (const actor of invalidActors) {
      await expect(harness.ctx.teams.expireSchedulerChannelDeliveries({ actor, ...input }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    expect((await harness.ctx.teams.readChannel({ channelId: closed.manifest.id, afterCursor: -1 })).records
      .filter(record => record.type === 'channel/delivery-expired')).toEqual([])

    const staleInput = { ...input, expectedChannelCursor: input.expectedChannelCursor - 1 }
    const staleCurrent = scheduler.issue({ kind: 'scheduler-channel-delivery-expire', ...staleInput })
    await expect(harness.ctx.teams.expireSchedulerChannelDeliveries({ actor: staleCurrent.proof, ...staleInput }))
      .rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })

    await createTestCoordinatorTask(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Advance the Team cursor after scheduler expiry selection',
      description: 'The selected delivery proof must not survive an unrelated Team journal mutation.',
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
    const staleTeam = scheduler.issue(scope)
    await expect(harness.ctx.teams.expireSchedulerChannelDeliveries({ actor: staleTeam.proof, ...input }))
      .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })

    const quiescingWithoutCancellation = await seedTeamPhase(harness.ctx, created.team.id, 'quiescing')
    const nonCancellingInput = { ...input, expectedTeamCursor: quiescingWithoutCancellation.team.cursor }
    await expect(harness.ctx.teams.expireSchedulerChannelDeliveries({
      actor: scheduler.issue({ kind: 'scheduler-channel-delivery-expire', ...nonCancellingInput }).proof,
      ...nonCancellingInput,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

    await seedTeamRunCancellation(harness.ctx, created.team.id)
    const cancellingState = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(cancellingState.team).toMatchObject({ phase: 'quiescing', cancellation: { actor: { kind: 'system', name: 'team-run' } } })
    const currentInput = { ...input, expectedTeamCursor: cancellingState.team.cursor }
    const currentScope: TeamSystemSchedulerChannelScope = { kind: 'scheduler-channel-delivery-expire', ...currentInput }
    const accepted = scheduler.issue(currentScope)
    await expect(harness.ctx.teams.expireSchedulerChannelDeliveries({ actor: accepted.proof, ...currentInput }))
      .resolves.toMatchObject({
        channel: { manifest: { id: closed.manifest.id }, phase: 'closed' },
        expired: [{ participantId: human.id, envelopeId: delivered.id, envelopeSequence: delivered.sequence }],
      })
    accepted.revoke()
    const records = await harness.ctx.teams.readChannel({ channelId: closed.manifest.id, afterCursor: -1 })
    expect(records.records.filter(record => record.type === 'channel/delivery-expired')).toHaveLength(1)

    const tornDown = scheduler.issue(currentScope)
    scheduler.dispose()
    await expect(harness.ctx.teams.expireSchedulerChannelDeliveries({ actor: tornDown.proof, ...currentInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    other.dispose()
    await harness.dispose()
  })

  it('permits only the stopping activation controller to stall a durable cancellation with unconfirmed remote termination', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Retain an unconfirmed remote cancellation.', budgets: {} }, rules: {}, budgets: {},
    })
    const remote = await activeParticipant(harness.ctx, created.team.id, 'remote-agent', 'worker', 'Remote worker')
    const binding = await bindIdleActivation(harness.ctx, created.team.id, remote.id, 'remote-cancellation')
    await updateActivationStatus(harness.ctx, binding, 'stopping')
    const controller = phaseAuthority(harness.ctx, 'team-activation-controller')
    const reason = {
      code: 'REMOTE_CANCELLATION_UNCONFIRMED',
      message: `Remote activation '${binding.activation.id}' did not confirm termination.`,
    }
    const withoutCancellation = await seedTeamPhase(harness.ctx, created.team.id, 'quiescing')
    const missingCancellationInput = {
      teamId: created.team.id,
      expectedCursor: withoutCancellation.team.cursor,
      phase: 'stalled' as const,
      reason,
    }
    const missingCancellation = controller.issue({
      kind: 'activation-controller-cancellation-stall',
      ...missingCancellationInput,
      cancellationIdempotencyKey: teamClosureIdempotencyKeySchema.parse('missing-remote-cancellation'),
      cancellationRequestedAt: 0,
      activationId: binding.activation.id,
      participantId: binding.activation.participantId,
      sessionId: binding.sessionId,
      provider: binding.provider,
    })
    await expect(harness.ctx.teams.transitionTeamPhase({
      actor: missingCancellation.proof,
      ...missingCancellationInput,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    missingCancellation.revoke()
    const cancellation = await seedTeamRunCancellation(harness.ctx, created.team.id)
    const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const input = {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      phase: 'stalled' as const,
      reason,
    }
    const scope: TeamSystemPhaseScope = {
      kind: 'activation-controller-cancellation-stall',
      ...input,
      cancellationIdempotencyKey: cancellation.idempotencyKey,
      cancellationRequestedAt: cancellation.requestedAt,
      activationId: binding.activation.id,
      participantId: binding.activation.participantId,
      sessionId: binding.sessionId,
      provider: binding.provider,
    }
    const other = phaseAuthority(harness.ctx, 'other-phase-source')
    const invalid = controller.issue({ ...scope, cancellationRequestedAt: cancellation.requestedAt + 1 })
    await expect(harness.ctx.teams.transitionTeamPhase({ actor: invalid.proof, ...input }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    invalid.revoke()
    await expect(harness.ctx.teams.transitionTeamPhase({ actor: other.issue(scope).proof, ...input }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const accepted = controller.issue(scope)
    const stalled = await harness.ctx.teams.transitionTeamPhase({ actor: accepted.proof, ...input })
    expect(stalled.team).toMatchObject({ phase: 'stalled', stallReason: input.reason, cancellation })
    accepted.revoke()
    const replay = controller.issue({ ...scope, expectedCursor: stalled.team.cursor })
    await expect(harness.ctx.teams.transitionTeamPhase({
      actor: replay.proof,
      ...input,
      expectedCursor: stalled.team.cursor,
    })).resolves.toMatchObject({ team: { phase: 'stalled', stallReason: input.reason } })
    replay.revoke()
    controller.dispose()
    other.dispose()
    await harness.dispose()
  })

  for (const backend of ['json', 'sqlite'] as const) {
    it(`rejects an agent in the human channel role before reserving completion on ${backend}`, async () => {
      const harness = await setup({}, undefined, backend)
      const team = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Require an actual human result owner for completion.', budgets: {} }, rules: {}, budgets: {},
      })
      const recipient = await activeParticipant(harness.ctx, team.team.id, 'local-agent', 'human', 'Agent recipient')
      const coordinator = await activeParticipant(harness.ctx, team.team.id, 'local-agent', 'coordinator', 'Coordinator')
      const recipientBinding = await bindIdleActivation(harness.ctx, team.team.id, recipient.id, 'agent-human-recipient')
      const coordinatorBinding = await bindIdleActivation(harness.ctx, team.team.id, coordinator.id, 'agent-human-coordinator')
      const channel = await openDirectV3(harness.ctx, team.team.id, recipient.id, coordinator.id)
      const sender = issueActivation(harness.ctx, coordinatorBinding)
      const receiver = issueActivation(harness.ctx, recipientBinding)
      const policies: unknown[] = []
      const unregister = harness.ctx.teams.registerPolicy('close', {
        name: 'observe-invalid-final-recipient',
        async apply(request, next) { policies.push(request); return await next() },
      })
      try {
        await expect(harness.ctx.teams.postChannelEnvelope({ actor: sender.proof, expectedCursor: channel.cursor,
          draft: { channelId: channel.manifest.id, audience: [recipient.id], kind: 'final',
            payload: { text: 'An agent received this message.' }, delivery: 'turn' } }))
          .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
        expect(policies).toEqual([])
        expect((await harness.ctx.teams.getTeam({ teamId: team.team.id })).team.closure).toBeUndefined()
      } finally { unregister(); receiver.revoke(); sender.revoke(); await harness.dispose() }
    })
  }

  it('permits a distinct active activation closer after the coordinator final is durably receipted', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Close from a distinct active activation.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human recipient')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const closer = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Distinct closer')
    const coordinatorBinding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'coordinator')
    const closerBinding = await bindIdleActivation(harness.ctx, created.team.id, closer.id, 'closer')
    const channel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const coordinatorLease = issueActivation(harness.ctx, coordinatorBinding)
    const final = await harness.ctx.teams.postChannelEnvelope({
      actor: coordinatorLease.proof,
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [human.id],
        kind: 'final',
        payload: { text: 'The Team completed its work.' },
        delivery: 'turn',
      },
    })
    const humanSource = finalReceiptAuthority(harness.ctx, 'team-run')
    const humanLease = humanSource.issue({ teamId: created.team.id, channelId: channel.manifest.id,
      humanId: human.id, coordinatorId: coordinator.id })
    await admitTestFinal(harness.ctx, humanLease.proof, final)
    await harness.ctx.teams.ackChannelEnvelope({
      actor: humanLease.proof,
      channelId: channel.manifest.id,
      envelopeId: final.id,
      expectedCursor: (await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
    })
    humanLease.revoke()
    humanSource.dispose()
    await closeTestChannel(harness.ctx, {
      channelId: channel.manifest.id,
      expectedCursor: (await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
    })

    const closeActorIds: Array<ParticipantSnapshot['id'] | undefined> = []
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-distinct-activation-closer',
      async apply(request, next) {
        closeActorIds.push(request.actorId)
        return await next()
      },
    })
    const closerLease = issueActivation(harness.ctx, closerBinding)
    const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const request = {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse(`closure-authority-complete-${created.team.id}`),
      reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'The final answer was durably receipted.' },
      finalChannelId: channel.manifest.id,
      finalEnvelopeId: final.id,
      actor: closerLease.proof,
    }
    const completed = await harness.ctx.teams.completeTeam(request)
    expect(completed.team).toMatchObject({
      phase: 'quiescing',
      closure: { kind: 'complete', actor: { kind: 'participant', participantId: closer.id } },
    })
    expect(closeActorIds).toEqual([closer.id])

    closerLease.revoke()
    const beforeReplay = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    await expect(harness.ctx.teams.completeTeam({ ...request, expectedCursor: 0 }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(beforeReplay.team.cursor)
    expect(closeActorIds).toEqual([closer.id])
    unregister()
    await harness.dispose()
  })

  it('rejects a wrong system source or scope before cancellation policy or durable admission', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Reject mismatched TeamRun closure scopes.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const channel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const scope: TeamSystemClosureScope = {
      kind: 'team-run-cancel',
      teamId: created.team.id,
      channelId: channel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    }
    const wrongSource = closureAuthority(harness.ctx, 'other-system')
    const teamRun = closureAuthority(harness.ctx, 'team-run')
    const policies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-system-closure-rejection',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const request = cancellationInput(created.team.id, before.team.cursor)
    await expect(harness.ctx.teams.cancelTeam({ ...request, actor: wrongSource.issue(scope).proof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.cancelTeam({
      ...request,
      actor: teamRun.issue({
        kind: 'team-run-complete',
        teamId: scope.teamId,
        channelId: scope.channelId,
        humanId: scope.humanId,
        coordinatorId: scope.coordinatorId,
        finalEnvelopeId: 'wrong-final' as never,
      }).proof,
    }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const after = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(after.team).toMatchObject({ cursor: before.team.cursor })
    expect(after.team.cancellation).toBeUndefined()
    expect(after.team.closure).toBeUndefined()
    expect(policies).toEqual([])
    unregister()
    teamRun.dispose()
    wrongSource.dispose()
    await harness.dispose()
  })

  it('defers default-channel closure until a TeamRun cancellation releases its activation', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Retry cancellation after channel closure.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const coordinatorBinding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'retry-coordinator')
    const channel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const scope: TeamSystemClosureScope = {
      kind: 'team-run-cancel',
      teamId: created.team.id,
      channelId: channel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    }
    const teamRun = closureAuthority(harness.ctx, 'team-run')
    const firstState = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const first = await harness.ctx.teams.cancelTeam({
      ...cancellationInput(created.team.id, firstState.team.cursor),
      actor: teamRun.issue(scope).proof,
    })
    expect(first.team).toMatchObject({
      phase: 'quiescing',
      cancellation: { actor: { kind: 'system', name: 'team-run' } },
    })
    expect(first.team.closure).toBeUndefined()
    await expect(harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).resolves.toMatchObject({ phase: 'active' })

    await updateActivationStatus(harness.ctx, coordinatorBinding, 'offline')
    const beforeRetry = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const cancelled = await harness.ctx.teams.cancelTeam({
      ...cancellationInput(created.team.id, beforeRetry.team.cursor),
      actor: teamRun.issue(scope).proof,
    })
    expect(cancelled.team).toMatchObject({
      phase: 'cancelled',
      cancellation: { actor: { kind: 'system', name: 'team-run' } },
      closure: { kind: 'cancel', actor: { kind: 'system', name: 'team-run' } },
    })
    await expect(harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).resolves.toMatchObject({ phase: 'closed' })
    teamRun.dispose()
    await harness.dispose()
  })

  it('rejects forged, revoked, and cross-Team phase proofs before close policy or durable acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Reject unauthenticated phase input.', budgets: {} }, rules: {}, budgets: {},
    })
    const foreign = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Supply a foreign phase proof.', budgets: {} }, rules: {}, budgets: {},
    })
    const scheduler = phaseAuthority(harness.ctx, 'team-scheduler-dag')
    const reason = { code: 'TASK_NO_ELIGIBLE_OWNER', message: 'Ready work has no eligible owner.' }
    const revoked = scheduler.issue({
      kind: 'scheduler-stall', teamId: created.team.id, phase: 'stalled', reason,
    })
    revoked.revoke()
    const foreignProof = scheduler.issue({
      kind: 'scheduler-stall', teamId: foreign.team.id, phase: 'stalled', reason,
    })
    const closePolicies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-invalid-phase-authority',
      async apply(request, next) {
        closePolicies.push(request)
        return await next()
      },
    })
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const input = { teamId: created.team.id, expectedCursor: before.team.cursor, phase: 'stalled' as const, reason }
    const invalidActors: readonly unknown[] = [{}, phaseProof(), revoked.proof, foreignProof.proof]
    for (const actor of invalidActors) {
      await expect(harness.ctx.teams.transitionTeamPhase({ ...input, actor } as never))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    const after = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(after.team).toMatchObject({ cursor: before.team.cursor, phase: 'active' })
    expect(closePolicies).toEqual([])
    unregister()
    scheduler.dispose()
    await harness.dispose()
  })

  it('rejects wrong phase source and scope before close policy or durable acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Reject mismatched phase scopes.', budgets: {} }, rules: {}, budgets: {},
    })
    const reason = { code: 'TASK_NO_ELIGIBLE_OWNER', message: 'Ready work has no eligible owner.' }
    const other = phaseAuthority(harness.ctx, 'other-system')
    const scheduler = phaseAuthority(harness.ctx, 'team-scheduler-dag')
    const teamRun = phaseAuthority(harness.ctx, 'team-run')
    const closePolicies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-mismatched-phase-authority',
      async apply(request, next) {
        closePolicies.push(request)
        return await next()
      },
    })
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const input = { teamId: created.team.id, expectedCursor: before.team.cursor, phase: 'stalled' as const, reason }
    await expect(harness.ctx.teams.transitionTeamPhase({
      ...input,
      actor: other.issue({ kind: 'scheduler-stall', teamId: created.team.id, phase: 'stalled', reason }).proof,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.transitionTeamPhase({
      ...input,
      actor: scheduler.issue({ kind: 'team-run-resume', teamId: created.team.id, phase: 'active' }).proof,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.transitionTeamPhase({
      ...input,
      actor: teamRun.issue({ kind: 'scheduler-stall', teamId: created.team.id, phase: 'stalled', reason }).proof,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.transitionTeamPhase({
      ...input,
      actor: scheduler.issue({
        kind: 'scheduler-stall',
        teamId: created.team.id,
        phase: 'stalled',
        reason: { code: reason.code, message: 'Different reason.' },
      }).proof,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const after = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(after.team).toMatchObject({ cursor: before.team.cursor, phase: 'active' })
    expect(closePolicies).toEqual([])
    unregister()
    teamRun.dispose()
    scheduler.dispose()
    other.dispose()
    await harness.dispose()
  })

  it('accepts exact scheduler-stall and TeamRun-resume phase scopes', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Transition through source-owned phase proofs.', budgets: {} }, rules: {}, budgets: {},
    })
    const scheduler = phaseAuthority(harness.ctx, 'team-scheduler-dag')
    const teamRun = phaseAuthority(harness.ctx, 'team-run')
    const reason = { code: 'TASK_NO_ELIGIBLE_OWNER', message: 'Ready work has no eligible owner.' }
    const closePolicies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-valid-phase-authority',
      async apply(request, next) {
        closePolicies.push(request)
        return await next()
      },
    })
    const active = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const stalled = await harness.ctx.teams.transitionTeamPhase({
      teamId: created.team.id,
      expectedCursor: active.team.cursor,
      phase: 'stalled',
      reason,
      actor: scheduler.issue({
        kind: 'scheduler-stall', teamId: created.team.id, phase: 'stalled', reason,
      }).proof,
    })
    expect(stalled.team).toMatchObject({ phase: 'stalled', stallReason: reason })
    const resumed = await harness.ctx.teams.transitionTeamPhase({
      teamId: created.team.id,
      expectedCursor: stalled.team.cursor,
      phase: 'active',
      actor: teamRun.issue({ kind: 'team-run-resume', teamId: created.team.id, phase: 'active' }).proof,
    })
    expect(resumed.team).toMatchObject({ phase: 'active' })
    expect(resumed.team.stallReason).toBeUndefined()
    expect(closePolicies).toHaveLength(2)
    expect(closePolicies[0]).toMatchObject({ facts: { actor: { kind: 'system', name: 'team-scheduler-dag' } } })
    expect(closePolicies[1]).toMatchObject({ facts: { actor: { kind: 'system', name: 'team-run' } } })
    unregister()
    teamRun.dispose()
    scheduler.dispose()
    await harness.dispose()
  })

  it('fences final-result admission with an exact human-receipted TeamRun quiesce proof', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Fence new channel admission after an accepted final.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const coordinatorBinding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'finalization-phase-coordinator')
    const channel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const coordinatorLease = issueActivation(harness.ctx, coordinatorBinding)
    const final = await harness.ctx.teams.postChannelEnvelope({
      actor: coordinatorLease.proof,
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [human.id],
        kind: 'final',
        payload: { text: 'The final result is ready.' },
        delivery: 'turn',
      },
    })
    coordinatorLease.revoke()
    const receipts = finalReceiptAuthority(harness.ctx, 'team-run')
    const receipt = receipts.issue({
      teamId: created.team.id,
      channelId: channel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    })
    await admitTestFinal(harness.ctx, receipt.proof, final)
    await harness.ctx.teams.ackChannelEnvelope({
      actor: receipt.proof,
      channelId: channel.manifest.id,
      envelopeId: final.id,
      expectedCursor: (await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
    })
    receipt.revoke()
    const phases = phaseAuthority(harness.ctx, 'team-run')
    const policies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-finalization-admission',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const input = {
      teamId: created.team.id,
      expectedCursor: before.team.cursor,
      phase: 'quiescing' as const,
    }
    const scope: TeamSystemPhaseScope = {
      kind: 'team-run-finalization-quiesce',
      ...input,
      finalChannelId: channel.manifest.id,
      finalEnvelopeId: final.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    }
    const revoked = phases.issue(scope)
    revoked.revoke()
    await expect(harness.ctx.teams.transitionTeamPhase({ actor: revoked.proof, ...input }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.transitionTeamPhase({
      actor: phases.issue({ ...scope, finalEnvelopeId: 'wrong-finalization-phase-envelope' as never }).proof,
      ...input,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(policies).toEqual([])

    const admitted = phases.issue(scope)
    const quiescing = await harness.ctx.teams.transitionTeamPhase({ actor: admitted.proof, ...input })
    admitted.revoke()
    expect(quiescing.team).toMatchObject({ phase: 'quiescing' })
    expect(policies).toHaveLength(1)
    expect((policies[0] as { readonly facts: Record<string, unknown> } | undefined)?.facts).toMatchObject({
      operation: 'finalization-admission', finalEnvelopeId: final.id,
    })
    unregister()
    await closeTestChannel(harness.ctx, {
      channelId: channel.manifest.id,
      expectedCursor: (await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
    })
    const coalescedInput = {
      teamId: created.team.id,
      expectedCursor: quiescing.team.cursor,
      phase: 'quiescing' as const,
    }
    const coalesced = phases.issue({
      kind: 'team-run-finalization-quiesce',
      ...coalescedInput,
      finalChannelId: channel.manifest.id,
      finalEnvelopeId: final.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    })
    await expect(harness.ctx.teams.transitionTeamPhase({ actor: coalesced.proof, ...coalescedInput }))
      .resolves.toMatchObject({ team: { phase: 'quiescing', cursor: quiescing.team.cursor } })
    coalesced.revoke()
    expect(policies).toHaveLength(1)
    phases.dispose()
    receipts.dispose()
    await harness.dispose()
  })

  it('rejects forged, revoked, cross-scope, and widened maintenance proofs before close policy or compaction', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect terminal retention authority.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const channel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const team = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const currentChannel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
    const scheduler = maintenanceAuthority(harness.ctx, 'team-scheduler-dag')
    const other = maintenanceAuthority(harness.ctx, 'other-system')
    const teamInput = { teamId: created.team.id, expectedCursor: team.team.cursor, throughSequence: 0 }
    const channelInput = {
      teamId: created.team.id,
      channelId: channel.manifest.id,
      expectedCursor: currentChannel.cursor,
      throughSequence: 0,
    }
    const revoked = scheduler.issue({ kind: 'scheduler-team-journal-compaction', ...teamInput })
    revoked.revoke()
    const closePolicies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-invalid-maintenance-authority',
      async apply(request, next) {
        closePolicies.push(request)
        return await next()
      },
    })

    const invalidTeamActors: readonly unknown[] = [
      {},
      maintenanceProof(),
      revoked.proof,
      other.issue({ kind: 'scheduler-team-journal-compaction', ...teamInput }).proof,
      scheduler.issue({ kind: 'scheduler-channel-compaction', ...channelInput }).proof,
      scheduler.issue({
        kind: 'scheduler-team-journal-compaction',
        ...teamInput,
        throughSequence: teamInput.throughSequence + 1,
      }).proof,
    ]
    for (const actor of invalidTeamActors) {
      await expect(harness.ctx.teams.compactTeam({ ...teamInput, actor } as never))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    await expect(harness.ctx.teams.compactChannel({
      ...channelInput,
      actor: scheduler.issue({
        kind: 'scheduler-channel-compaction',
        ...channelInput,
        channelId: 'foreign-maintenance-channel' as typeof channelInput.channelId,
      }).proof,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

    const afterTeam = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const afterChannel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
    expect(afterTeam.team.cursor).toBe(team.team.cursor)
    expect(afterChannel.cursor).toBe(currentChannel.cursor)
    expect(closePolicies).toEqual([])
    unregister()
    other.dispose()
    scheduler.dispose()
    await harness.dispose()
  })

  it('rejects invalid scheduler task-lease proofs before task policy or journal acceptance, then accepts exact assignment and expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect scheduler lease authority.', budgets: {} }, rules: {}, budgets: {},
    })
    const participant = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    const binding = await bindIdleActivation(harness.ctx, created.team.id, participant.id, 'task-lease')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const coordinatorBinding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'task-lease-coordinator')
    const coordinatorActor = issueActivation(harness.ctx, coordinatorBinding)
    let team = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const task = await harness.ctx.teams.createTask({
      actor: coordinatorActor.proof,
      teamId: created.team.id,
      expectedCursor: team.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('scheduler-lease-task') },
      subject: 'Execute work',
      description: 'Run the assigned work.',
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
    coordinatorActor.revoke()
    team = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const assignInput = {
      teamId: created.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: participant.id,
      activationId: binding.activation.id,
      leaseDurationMs: 1,
    }
    const scheduler = taskLeaseAuthority(harness.ctx, 'team-scheduler-dag')
    const scope: TeamSystemTaskLeaseScope = { kind: 'scheduler-task-assign', ...assignInput }
    const revoked = scheduler.issue(scope)
    revoked.revoke()
    const foreign = scheduler.issue({
      kind: 'scheduler-task-assign',
      ...assignInput,
      teamId: 'foreign-task-lease-team' as never,
    })
    const stale = scheduler.issue({
      kind: 'scheduler-task-assign',
      ...assignInput,
      expectedRevision: assignInput.expectedRevision + 1,
    })
    const wrongOperation = scheduler.issue({
      kind: 'scheduler-task-expire',
      teamId: created.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
      attemptId: 'wrong-attempt' as never,
    })
    const other = taskLeaseAuthority(harness.ctx, 'other-system')
    const policies: unknown[] = []
    let revokeAfterPolicy: (() => void) | undefined
    const unregisterPolicy = harness.ctx.teams.registerPolicy('task-assign', {
      name: 'observe-invalid-task-lease-authority',
      async apply(request, next) {
        policies.push(request)
        const revoke = revokeAfterPolicy
        revokeAfterPolicy = undefined
        revoke?.()
        return await next()
      },
    })
    for (const actor of [taskLeaseProof(), revoked.proof, foreign.proof, stale.proof, wrongOperation.proof, other.issue(scope).proof]) {
      await expect(harness.ctx.teams.assignTask({ actor, ...assignInput }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    const afterInvalid = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(afterInvalid.team.cursor).toBe(team.team.cursor)
    const unchanged = afterInvalid.tasks.find(candidate => candidate.id === task.id)
    expect(unchanged).toMatchObject({ phase: 'pending' })
    expect(unchanged?.lease).toBeUndefined()
    expect(policies).toEqual([])

    const revokedDuringAssignment = scheduler.issue(scope)
    const beforeAssignmentRevocation = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    revokeAfterPolicy = () => { revokedDuringAssignment.revoke() }
    await expect(harness.ctx.teams.assignTask({ actor: revokedDuringAssignment.proof, ...assignInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const afterAssignmentRevocation = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(afterAssignmentRevocation.team.cursor).toBe(beforeAssignmentRevocation.team.cursor)
    expect(afterAssignmentRevocation.tasks.find(candidate => candidate.id === task.id)).toMatchObject({ phase: 'pending' })

    const assignedProof = scheduler.issue(scope)
    const assigned = await harness.ctx.teams.assignTask({ actor: assignedProof.proof, ...assignInput })
    assignedProof.revoke()
    expect(assigned).toMatchObject({ phase: 'assigned', lease: { participantId: participant.id } })
    if (assigned.lease === undefined) throw new Error('scheduler assignment did not retain a lease')
    vi.setSystemTime(102)
    const expireInput = {
      teamId: created.team.id,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      attemptId: assigned.lease.attemptId,
    }
    const revokedDuringExpiry = scheduler.issue({ kind: 'scheduler-task-expire', ...expireInput })
    const beforeExpiryRevocation = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    revokeAfterPolicy = () => { revokedDuringExpiry.revoke() }
    await expect(harness.ctx.teams.expireTaskAttempt({ actor: revokedDuringExpiry.proof, ...expireInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const afterExpiryRevocation = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(afterExpiryRevocation.team.cursor).toBe(beforeExpiryRevocation.team.cursor)
    expect(afterExpiryRevocation.tasks.find(candidate => candidate.id === task.id)).toMatchObject({
      phase: 'assigned', lease: { attemptId: assigned.lease.attemptId },
    })

    const expiryProof = scheduler.issue({ kind: 'scheduler-task-expire', ...expireInput })
    const expired = await harness.ctx.teams.expireTaskAttempt({ actor: expiryProof.proof, ...expireInput })
    expiryProof.revoke()
    expect(expired).toMatchObject({ phase: 'failed' })
    expect(expired.lease).toBeUndefined()
    expect(policies).toHaveLength(4)

    const tornDown = scheduler.issue({ kind: 'scheduler-task-expire', ...expireInput })
    scheduler.dispose()
    await expect(harness.ctx.teams.expireTaskAttempt({ actor: tornDown.proof, ...expireInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    unregisterPolicy()
    other.dispose()
    await harness.dispose()
  })

  it('requires exact TeamRun default-worker task-control proofs before task policy or journal acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect default-worker task control.', budgets: {} }, rules: {}, budgets: {},
    })
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const worker = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    const binding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'task-control')
    const taskActor = issueActivation(harness.ctx, binding)
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const defaultTask = await harness.ctx.teams.createTask({
      actor: taskActor.proof,
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('task-control-default-worker') },
      subject: 'Coordinator-owned default worker task',
      description: 'Allow exact current-coordinator task controls.',
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
    taskActor.revoke()
    const otherCoordinator = await activeParticipant(
      harness.ctx,
      created.team.id,
      'local-agent',
      'coordinator',
      'Other coordinator',
    )
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const otherBinding = await bindIdleActivation(
      harness.ctx,
      created.team.id,
      otherCoordinator.id,
      'other-task-control',
    )
    const unrelatedActor = issueActivation(harness.ctx, otherBinding)
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const unrelatedTask = await harness.ctx.teams.createTask({
      actor: unrelatedActor.proof,
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('task-control-unrelated-worker') },
      subject: 'Unowned task',
      description: 'Reject task-control authority for unrelated tasks.',
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
    unrelatedActor.revoke()
    const taskControlCoordinator = {
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
    }
    const controls = taskControlAuthority(harness.ctx, 'team-run')
    const other = taskControlAuthority(harness.ctx, 'other-system')
    const policies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('task-mutate', {
      name: 'observe-invalid-default-worker-task-control',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const proposalInput = {
      teamId: created.team.id,
      taskId: defaultTask.id,
      expectedRevision: defaultTask.revision,
      proposedOwnerId: worker.id,
    }
    const proposalScope: TeamSystemTaskControlScope = {
      kind: 'team-run-default-worker-owner-proposal',
      teamId: created.team.id,
      coordinator: taskControlCoordinator,
      taskId: defaultTask.id,
      expectedRevision: defaultTask.revision,
      proposedOwnerId: worker.id,
    }
    const revoked = controls.issue(proposalScope)
    revoked.revoke()
    const foreign = controls.issue({ ...proposalScope, teamId: 'foreign-task-control-team' as never })
    const stale = controls.issue({ ...proposalScope, expectedRevision: proposalScope.expectedRevision + 1 })
    const wrongKind = controls.issue({
      kind: 'team-run-default-worker-cancel',
      teamId: created.team.id,
      coordinator: taskControlCoordinator,
      taskId: defaultTask.id,
      expectedRevision: defaultTask.revision,
    })
    const wrongCoordinator = controls.issue({
      ...proposalScope,
      coordinator: { ...taskControlCoordinator, participantId: worker.id },
    })
    for (const actor of [
      taskControlProof(),
      revoked.proof,
      foreign.proof,
      stale.proof,
      wrongKind.proof,
      wrongCoordinator.proof,
      other.issue(proposalScope).proof,
    ]) {
      await expect(harness.ctx.teams.proposeTaskOwner({ actor, ...proposalInput }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    const unrelatedInput = {
      teamId: created.team.id,
      taskId: unrelatedTask.id,
      expectedRevision: unrelatedTask.revision,
      proposedOwnerId: worker.id,
    }
    await expect(harness.ctx.teams.proposeTaskOwner({
      actor: controls.issue({
        kind: 'team-run-default-worker-owner-proposal',
        teamId: created.team.id,
        coordinator: taskControlCoordinator,
        taskId: unrelatedTask.id,
        expectedRevision: unrelatedTask.revision,
        proposedOwnerId: worker.id,
      }).proof,
      ...unrelatedInput,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(state.team.cursor)
    expect(policies).toEqual([])

    const hub = harness.ctx.teams as unknown as {
      teams: ReadonlyMap<TeamId, { queue: { run<T>(operation: () => Promise<T>): Promise<T> } }>
    }
    const loaded = hub.teams.get(created.team.id)
    if (loaded === undefined) throw new Error('Team Hub did not retain the task-control race fixture Team')
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { started = resolve })
    const blocker = loaded.queue.run(async () => {
      started?.()
      await gate
    })
    await entered
    const raced = controls.issue(proposalScope)
    const race = harness.ctx.teams.proposeTaskOwner({ actor: raced.proof, ...proposalInput })
    raced.revoke()
    release?.()
    await blocker
    await expect(race).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(state.team.cursor)

    const proposal = controls.issue(proposalScope)
    const proposed = await harness.ctx.teams.proposeTaskOwner({ actor: proposal.proof, ...proposalInput })
    proposal.revoke()
    expect(proposed).toMatchObject({ phase: 'pending', proposedOwnerId: worker.id })
    const cancelInput = {
      teamId: created.team.id,
      taskId: proposed.id,
      expectedRevision: proposed.revision,
    }
    await expect(harness.ctx.teams.cancelTask(cancelInput as never))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(policies).toHaveLength(1)
    const cancelPolicyEntered = Promise.withResolvers<undefined>()
    const releaseCancelPolicy = Promise.withResolvers<undefined>()
    const unregisterCancelGate = harness.ctx.teams.registerPolicy('task-mutate', {
      name: 'revoke-default-worker-cancel-after-policy',
      async apply(request, next) {
        if (request.facts.taskId !== proposed.id || request.facts.cancellation === undefined) return await next()
        cancelPolicyEntered.resolve(undefined)
        await releaseCancelPolicy.promise
        return await next()
      },
    })
    const revokedDuringCancelPolicy = controls.issue({
      kind: 'team-run-default-worker-cancel',
      teamId: created.team.id,
      coordinator: taskControlCoordinator,
      taskId: proposed.id,
      expectedRevision: proposed.revision,
    })
    const cancelPolicyRace = harness.ctx.teams.cancelTask({ actor: revokedDuringCancelPolicy.proof, ...cancelInput })
    await cancelPolicyEntered.promise
    revokedDuringCancelPolicy.revoke()
    releaseCancelPolicy.resolve(undefined)
    await expect(cancelPolicyRace).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(await harness.ctx.teams.getTask({ teamId: created.team.id, taskId: proposed.id }))
      .toMatchObject({ phase: 'pending', revision: proposed.revision })
    unregisterCancelGate()
    const cancel = controls.issue({
      kind: 'team-run-default-worker-cancel',
      teamId: created.team.id,
      coordinator: taskControlCoordinator,
      taskId: proposed.id,
      expectedRevision: proposed.revision,
    })
    const cancelled = await harness.ctx.teams.cancelTask({ actor: cancel.proof, ...cancelInput })
    cancel.revoke()
    expect(cancelled).toMatchObject({ phase: 'cancelled' })
    expect(policies).toHaveLength(3)

    const tornDown = controls.issue(proposalScope)
    controls.dispose()
    await expect(harness.ctx.teams.proposeTaskOwner({ actor: tornDown.proof, ...proposalInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    unregister()
    other.dispose()
    await harness.dispose()
  })

  it('preflights exact TeamRun cancellation-cleanup proofs before repair, policy, or journal acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect post-release cancellation cleanup.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const coordinatorBinding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'cancellation-cleanup-coordinator')
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const task = await createTestCoordinatorTask(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Pending post-release cleanup task',
      description: 'Only the retained durable cancellation may cancel this task.',
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
    const channel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const cancellation = await seedTeamRunCancellation(harness.ctx, created.team.id)
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const taskInput = {
      teamId: created.team.id,
      cancellationIdempotencyKey: cancellation.idempotencyKey,
      cancellationRequestedAt: cancellation.requestedAt,
      expectedTeamCursor: state.team.cursor,
      taskId: task.id,
      expectedRevision: task.revision,
    }
    const taskScope: TeamSystemCancellationCleanupScope = {
      kind: 'team-run-cancellation-task-cancel',
      ...taskInput,
    }
    const channelInput = {
      teamId: created.team.id,
      cancellationIdempotencyKey: cancellation.idempotencyKey,
      cancellationRequestedAt: cancellation.requestedAt,
      expectedTeamCursor: state.team.cursor,
      channelId: channel.manifest.id,
      expectedCursor: channel.cursor,
      reason: 'Team cancelled',
    }
    const channelScope: TeamSystemCancellationCleanupScope = {
      kind: 'team-run-cancellation-channel-close',
      ...channelInput,
    }
    const cleanup = cancellationCleanupAuthority(harness.ctx, 'team-run')
    const other = cancellationCleanupAuthority(harness.ctx, 'other-system')
    const taskPolicies: unknown[] = []
    const closePolicies: unknown[] = []
    const unregisterTaskPolicy = harness.ctx.teams.registerPolicy('task-mutate', {
      name: 'observe-invalid-cancellation-task-cleanup',
      async apply(request, next) {
        taskPolicies.push(request)
        return await next()
      },
    })
    const unregisterClosePolicy = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-invalid-cancellation-channel-cleanup',
      async apply(request, next) {
        closePolicies.push(request)
        return await next()
      },
    })
    const hub = harness.ctx.teams as unknown as {
      readonly teams: ReadonlyMap<TeamId, { readonly queue: { run<T>(operation: () => Promise<T>): Promise<T> } }>
      repairPendingParentCharges(loaded: unknown): Promise<void>
    }
    const repair = vi.spyOn(hub, 'repairPendingParentCharges')
    const revoked = cleanup.issue(taskScope)
    revoked.revoke()
    const crossTeam = cleanup.issue({ ...taskScope, teamId: 'foreign-cancellation-cleanup-team' as never })
    const staleInput = { ...taskInput, expectedTeamCursor: taskInput.expectedTeamCursor - 1 }
    const stale = cleanup.issue({ kind: 'team-run-cancellation-task-cancel', ...staleInput })
    const wrongOperation = cleanup.issue(channelScope)
    const wrongChannel = cleanup.issue(channelScope)
    for (const actor of [
      cancellationCleanupProof(),
      revoked.proof,
      crossTeam.proof,
      stale.proof,
      wrongOperation.proof,
      other.issue(taskScope).proof,
    ]) {
      await expect(harness.ctx.teams.cancelTeamCancellationTask({ actor, ...taskInput }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    await expect(harness.ctx.teams.closeTeamCancellationChannel({
      actor: wrongChannel.proof,
      ...channelInput,
      channelId: 'wrong-cancellation-cleanup-channel' as never,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(repair).not.toHaveBeenCalled()
    const premature = cleanup.issue(channelScope)
    await expect(harness.ctx.teams.closeTeamCancellationChannel({
      actor: premature.proof,
      ...channelInput,
    })).rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })
    premature.revoke()

    const loaded = hub.teams.get(created.team.id)
    if (loaded === undefined) throw new Error('Team Hub did not retain the cancellation cleanup race fixture Team')
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { started = resolve })
    const blocker = loaded.queue.run(async () => {
      started?.()
      await gate
    })
    await entered
    const raced = cleanup.issue(taskScope)
    const race = harness.ctx.teams.cancelTeamCancellationTask({ actor: raced.proof, ...taskInput })
    raced.revoke()
    release?.()
    await blocker
    await expect(race).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

    const afterInvalid = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(afterInvalid.team.cursor).toBe(taskInput.expectedTeamCursor)
    expect(afterInvalid.tasks.find(candidate => candidate.id === task.id)).toMatchObject({ phase: 'pending', revision: task.revision })
    expect(await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).toMatchObject({ phase: 'active', cursor: channel.cursor })
    expect(repair).toHaveBeenCalledOnce()
    expect(taskPolicies).toEqual([])
    expect(closePolicies).toEqual([])

    const taskPolicyEntered = Promise.withResolvers<undefined>()
    const releaseTaskPolicy = Promise.withResolvers<undefined>()
    const unregisterTaskGate = harness.ctx.teams.registerPolicy('task-mutate', {
      name: 'revoke-cancellation-task-cleanup-after-policy',
      async apply(request, next) {
        if (request.facts.operation !== 'cancellation-task-cleanup') return await next()
        taskPolicyEntered.resolve(undefined)
        await releaseTaskPolicy.promise
        return await next()
      },
    })
    const revokedDuringTaskPolicy = cleanup.issue(taskScope)
    const taskPolicyRace = harness.ctx.teams.cancelTeamCancellationTask({
      actor: revokedDuringTaskPolicy.proof,
      ...taskInput,
    })
    await taskPolicyEntered.promise
    revokedDuringTaskPolicy.revoke()
    releaseTaskPolicy.resolve(undefined)
    await expect(taskPolicyRace).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(taskInput.expectedTeamCursor)
    unregisterTaskGate()

    const acceptedTask = cleanup.issue(taskScope)
    const cancelled = await harness.ctx.teams.cancelTeamCancellationTask({ actor: acceptedTask.proof, ...taskInput })
    acceptedTask.revoke()
    expect(cancelled).toMatchObject({ phase: 'cancelled', revision: task.revision + 1 })
    let afterTask = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    await updateActivationStatus(harness.ctx, coordinatorBinding, 'offline')
    afterTask = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const currentChannel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
    const currentChannelInput = {
      ...channelInput,
      expectedTeamCursor: afterTask.team.cursor,
      expectedCursor: currentChannel.cursor,
    }
    const channelPolicyEntered = Promise.withResolvers<undefined>()
    const releaseChannelPolicy = Promise.withResolvers<undefined>()
    const unregisterChannelGate = harness.ctx.teams.registerPolicy('close', {
      name: 'revoke-cancellation-channel-cleanup-after-policy',
      async apply(request, next) {
        if (request.facts.operation !== 'cancellation-channel-cleanup') return await next()
        channelPolicyEntered.resolve(undefined)
        await releaseChannelPolicy.promise
        return await next()
      },
    })
    const revokedDuringChannelPolicy = cleanup.issue({
      kind: 'team-run-cancellation-channel-close',
      ...currentChannelInput,
    })
    const channelPolicyRace = harness.ctx.teams.closeTeamCancellationChannel({
      actor: revokedDuringChannelPolicy.proof,
      ...currentChannelInput,
    })
    await channelPolicyEntered.promise
    revokedDuringChannelPolicy.revoke()
    releaseChannelPolicy.resolve(undefined)
    await expect(channelPolicyRace).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(await harness.ctx.teams.getChannel({ channelId: channel.manifest.id }))
      .toMatchObject({ phase: 'active', cursor: currentChannelInput.expectedCursor })
    unregisterChannelGate()
    const acceptedChannel = cleanup.issue({
      kind: 'team-run-cancellation-channel-close',
      ...currentChannelInput,
    })
    const closed = await harness.ctx.teams.closeTeamCancellationChannel({ actor: acceptedChannel.proof, ...currentChannelInput })
    acceptedChannel.revoke()
    expect(closed).toMatchObject({ phase: 'closed' })
    expect(taskPolicies).toHaveLength(2)
    expect(closePolicies).toHaveLength(2)

    const tornDown = cleanup.issue({
      kind: 'team-run-cancellation-channel-close',
      ...currentChannelInput,
    })
    cleanup.dispose()
    await expect(harness.ctx.teams.closeTeamCancellationChannel({ actor: tornDown.proof, ...currentChannelInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    repair.mockRestore()
    unregisterClosePolicy()
    unregisterTaskPolicy()
    other.dispose()
    await harness.dispose()
  })

  it('requires a human-receipted final and exact TeamRun finalization-cleanup proof before channel policy or WAL acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect post-release finalization cleanup.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const coordinatorBinding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'finalization-coordinator')
    const finalChannel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const auxiliaryChannel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const coordinatorLease = issueActivation(harness.ctx, coordinatorBinding)
    const final = await harness.ctx.teams.postChannelEnvelope({
      actor: coordinatorLease.proof,
      expectedCursor: finalChannel.cursor,
      draft: {
        channelId: finalChannel.manifest.id,
        audience: [human.id],
        kind: 'final',
        payload: { text: 'The Team completed its work.' },
        delivery: 'turn',
      },
    })
    coordinatorLease.revoke()
    const receipts = finalReceiptAuthority(harness.ctx, 'team-run')
    const receipt = receipts.issue({
      teamId: created.team.id,
      channelId: finalChannel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    })
    const finalAfterPost = await harness.ctx.teams.getChannel({ channelId: finalChannel.manifest.id })
    await admitTestFinal(harness.ctx, receipt.proof, final)
    await harness.ctx.teams.ackChannelEnvelope({
      actor: receipt.proof,
      channelId: finalChannel.manifest.id,
      envelopeId: final.id,
      expectedCursor: finalAfterPost.cursor,
    })
    receipt.revoke()
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const auxiliary = await harness.ctx.teams.getChannel({ channelId: auxiliaryChannel.manifest.id })
    const auxiliaryInput = {
      teamId: created.team.id,
      finalChannelId: finalChannel.manifest.id,
      finalEnvelopeId: final.id,
      expectedTeamCursor: state.team.cursor,
      channelId: auxiliary.manifest.id,
      expectedCursor: auxiliary.cursor,
      reason: 'parent Team completed',
    }
    const auxiliaryScope: TeamSystemFinalizationCleanupScope = {
      kind: 'team-run-finalization-channel-close',
      ...auxiliaryInput,
      humanId: human.id,
      coordinatorId: coordinator.id,
    }
    let cleanup = finalizationCleanupAuthority(harness.ctx, 'team-run')
    const other = finalizationCleanupAuthority(harness.ctx, 'other-system')
    const policies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-finalization-cleanup',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })
    const hub = harness.ctx.teams as unknown as {
      readonly teams: ReadonlyMap<TeamId, { readonly queue: { run<T>(operation: () => Promise<T>): Promise<T> } }>
      repairPendingParentCharges(loaded: unknown): Promise<void>
    }
    const repair = vi.spyOn(hub, 'repairPendingParentCharges')
    const revoked = cleanup.issue(auxiliaryScope)
    revoked.revoke()
    const crossTeam = cleanup.issue({ ...auxiliaryScope, teamId: 'foreign-finalization-cleanup-team' as never })
    const staleInput = { ...auxiliaryInput, expectedTeamCursor: auxiliaryInput.expectedTeamCursor - 1 }
    const stale = cleanup.issue({
      kind: 'team-run-finalization-channel-close',
      ...staleInput,
      humanId: human.id,
      coordinatorId: coordinator.id,
    })
    const wrongFinalInput = { ...auxiliaryInput, finalEnvelopeId: 'wrong-finalization-envelope' as never }
    const wrongFinal = cleanup.issue({
      kind: 'team-run-finalization-channel-close',
      ...wrongFinalInput,
      humanId: human.id,
      coordinatorId: coordinator.id,
    })
    const wrongChannel = cleanup.issue(auxiliaryScope)
    for (const actor of [
      finalizationCleanupProof(),
      revoked.proof,
      crossTeam.proof,
      stale.proof,
      wrongFinal.proof,
      other.issue(auxiliaryScope).proof,
    ]) {
      const input = actor === wrongFinal.proof ? wrongFinalInput : auxiliaryInput
      await expect(harness.ctx.teams.closeTeamFinalizationChannel({ actor, ...input }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    await expect(harness.ctx.teams.closeTeamFinalizationChannel({
      actor: wrongChannel.proof,
      ...auxiliaryInput,
      channelId: 'wrong-finalization-cleanup-channel' as never,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

    const tornDown = cleanup.issue(auxiliaryScope)
    cleanup.dispose()
    await expect(harness.ctx.teams.closeTeamFinalizationChannel({ actor: tornDown.proof, ...auxiliaryInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    cleanup = finalizationCleanupAuthority(harness.ctx, 'team-run')

    const loaded = hub.teams.get(created.team.id)
    if (loaded === undefined) throw new Error('Team Hub did not retain the finalization cleanup race fixture Team')
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { started = resolve })
    const blocker = loaded.queue.run(async () => {
      started?.()
      await gate
    })
    await entered
    const raced = cleanup.issue(auxiliaryScope)
    const race = harness.ctx.teams.closeTeamFinalizationChannel({ actor: raced.proof, ...auxiliaryInput })
    raced.revoke()
    release?.()
    await blocker
    await expect(race).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

    const afterInvalid = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(afterInvalid.team.cursor).toBe(auxiliaryInput.expectedTeamCursor)
    expect(await harness.ctx.teams.getChannel({ channelId: auxiliaryChannel.manifest.id }))
      .toMatchObject({ phase: 'active', cursor: auxiliaryInput.expectedCursor })
    expect(repair).not.toHaveBeenCalled()
    expect(policies).toEqual([])

    const finalizationPolicyEntered = Promise.withResolvers<undefined>()
    const releaseFinalizationPolicy = Promise.withResolvers<undefined>()
    const unregisterFinalizationGate = harness.ctx.teams.registerPolicy('close', {
      name: 'revoke-finalization-cleanup-after-policy',
      async apply(request, next) {
        if (request.facts.operation !== 'finalization-channel-cleanup') return await next()
        finalizationPolicyEntered.resolve(undefined)
        await releaseFinalizationPolicy.promise
        return await next()
      },
    })
    const revokedDuringFinalizationPolicy = cleanup.issue(auxiliaryScope)
    const finalizationPolicyRace = harness.ctx.teams.closeTeamFinalizationChannel({
      actor: revokedDuringFinalizationPolicy.proof,
      ...auxiliaryInput,
    })
    await finalizationPolicyEntered.promise
    revokedDuringFinalizationPolicy.revoke()
    releaseFinalizationPolicy.resolve(undefined)
    await expect(finalizationPolicyRace).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(await harness.ctx.teams.getChannel({ channelId: auxiliaryChannel.manifest.id }))
      .toMatchObject({ phase: 'active', cursor: auxiliaryInput.expectedCursor })
    unregisterFinalizationGate()

    const acceptedAuxiliary = cleanup.issue(auxiliaryScope)
    const closedAuxiliary = await harness.ctx.teams.closeTeamFinalizationChannel({
      actor: acceptedAuxiliary.proof,
      ...auxiliaryInput,
    })
    acceptedAuxiliary.revoke()
    expect(closedAuxiliary).toMatchObject({ phase: 'closed' })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const currentFinalChannel = await harness.ctx.teams.getChannel({ channelId: finalChannel.manifest.id })
    const finalInput = {
      teamId: created.team.id,
      finalChannelId: finalChannel.manifest.id,
      finalEnvelopeId: final.id,
      expectedTeamCursor: state.team.cursor,
      channelId: finalChannel.manifest.id,
      expectedCursor: currentFinalChannel.cursor,
      reason: 'Team completed',
    }
    const acceptedFinal = cleanup.issue({
      kind: 'team-run-finalization-channel-close',
      ...finalInput,
      humanId: human.id,
      coordinatorId: coordinator.id,
    })
    const closedFinal = await harness.ctx.teams.closeTeamFinalizationChannel({ actor: acceptedFinal.proof, ...finalInput })
    acceptedFinal.revoke()
    expect(closedFinal).toMatchObject({ phase: 'closed' })
    expect(repair).not.toHaveBeenCalled()
    expect(policies).toHaveLength(3)

    repair.mockRestore()
    unregister()
    cleanup.dispose()
    other.dispose()
    receipts.dispose()
    await harness.dispose()
  })

  it('requires exact TeamRun workflow compiler proofs before workflow policy, journal, or channel-WAL acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect workflow compiler authority.', budgets: {} }, rules: {}, budgets: {},
    })
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const worker = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    const binding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'workflow-authority')
    await bindIdleActivation(harness.ctx, created.team.id, worker.id, 'workflow-authority-worker')
    const workflowCoordinator = {
      teamId: binding.activation.teamId,
      participantId: binding.activation.participantId,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
    }
    const coordinatorLease = issueActivation(harness.ctx, binding)
    const workflowPlan = teamWorkflowPlanSchema.parse({
      name: 'Workflow authority plan',
      version: 1,
      tasks: [{
        id: 'first', subject: 'First', description: 'Run the first workflow task.', blockedBy: [],
        requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
        budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
      }],
      bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
      channel: {
        participantRoles: ['coordinator', 'worker'],
        graph: {
          initial: { kind: 'participant', role: 'coordinator' },
          transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }],
          maxTurns: 1,
        },
      },
      result: { kind: 'task-results', taskTemplateIds: ['first'] },
    })
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    let plan = await harness.ctx.teams.admitWorkflowPlan({
      actor: coordinatorLease.proof,
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-authority-plan'),
      plan: workflowPlan,
    })
    coordinatorLease.revoke()
    const workflow = workflowAuthority(harness.ctx, 'team-run')
    const other = workflowAuthority(harness.ctx, 'other-system')
    const channelParticipants = [
      { id: coordinator.id, role: 'coordinator' },
      { id: worker.id, role: 'worker' },
    ]
    const channelLimits = {
      graph: {
        initial: { kind: 'participant' as const, participantId: coordinator.id },
        transitions: [{ condition: { kind: 'always' as const }, target: { kind: 'terminate' as const } }],
        maxTurns: 1,
      },
    }
    harness.ctx.teams.registerViewPolicy({ type: 'directed', version: 1, project() { return {} } })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const openInput = {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: 'workflow', version: 1 },
      viewPolicy: { type: 'directed', version: 1 },
      workflowPlanId: plan.id,
      expectedPlanRevision: plan.revision,
      participants: channelParticipants,
      limits: channelLimits,
    }
    const openScope: TeamSystemWorkflowScope = {
      kind: 'team-run-workflow-channel-open',
      teamId: openInput.teamId,
      coordinator: workflowCoordinator,
      planId: plan.id,
      expectedCursor: openInput.expectedCursor,
      expectedRevision: plan.revision,
      adapter: openInput.adapter,
      viewPolicy: openInput.viewPolicy,
      participants: openInput.participants,
      limits: openInput.limits,
    }
    const revoked = workflow.issue(openScope)
    revoked.revoke()
    const foreign = workflow.issue({ ...openScope, teamId: 'foreign-workflow-team' as never })
    const stale = workflow.issue({ ...openScope, expectedRevision: openScope.expectedRevision + 1 })
    const wrongCoordinator = workflow.issue({
      ...openScope,
      coordinator: { ...workflowCoordinator, participantId: worker.id },
    })
    const wrongOperation = workflow.issue({
      kind: 'team-run-workflow-channel-bind',
      teamId: created.team.id,
      coordinator: workflowCoordinator,
      planId: plan.id,
      expectedCursor: openInput.expectedCursor,
      expectedRevision: plan.revision,
      channelId: 'wrong-workflow-channel' as never,
    })
    const channelPolicies: unknown[] = []
    const taskPolicies: unknown[] = []
    const closePolicies: unknown[] = []
    let revokeWorkflowChannelProofAfterPolicy: (() => void) | undefined
    let revokeWorkflowCloseAfterPolicy: (() => void) | undefined
    const unregisterChannel = harness.ctx.teams.registerPolicy('channel-open', {
      name: 'observe-invalid-workflow-channel-open',
      async apply(request, next) {
        channelPolicies.push(request)
        const revoke = revokeWorkflowChannelProofAfterPolicy
        revokeWorkflowChannelProofAfterPolicy = undefined
        revoke?.()
        return await next()
      },
    })
    const unregisterTask = harness.ctx.teams.registerPolicy('task-mutate', {
      name: 'observe-invalid-workflow-mutations',
      async apply(request, next) {
        taskPolicies.push(request)
        return await next()
      },
    })
    const unregisterClose = harness.ctx.teams.registerPolicy('close', {
      name: 'observe-invalid-workflow-close',
      async apply(request, next) {
        closePolicies.push(request)
        if (request.facts.operation === 'workflow-channel-cleanup') {
          const revoke = revokeWorkflowCloseAfterPolicy
          revokeWorkflowCloseAfterPolicy = undefined
          revoke?.()
        }
        return await next()
      },
    })
    for (const actor of [
      workflowProof(),
      revoked.proof,
      foreign.proof,
      stale.proof,
      wrongCoordinator.proof,
      wrongOperation.proof,
      other.issue(openScope).proof,
    ]) {
      await expect(harness.ctx.teams.openChannel({ actor, ...openInput }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    const afterInvalidOpen = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(afterInvalidOpen.team.cursor).toBe(state.team.cursor)
    expect(channelPolicies).toEqual([])

    const revokedAfterPolicy = workflow.issue(openScope)
    revokeWorkflowChannelProofAfterPolicy = () => { revokedAfterPolicy.revoke() }
    await expect(harness.ctx.teams.openChannel({ actor: revokedAfterPolicy.proof, ...openInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(state.team.cursor)

    const hub = harness.ctx.teams as unknown as {
      teams: ReadonlyMap<TeamId, { queue: { run<T>(operation: () => Promise<T>): Promise<T> } }>
    }
    const loaded = hub.teams.get(created.team.id)
    if (loaded === undefined) throw new Error('Team Hub did not retain the workflow authority race fixture Team')
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { started = resolve })
    const blocker = loaded.queue.run(async () => {
      started?.()
      await gate
    })
    await entered
    const raced = workflow.issue(openScope)
    const race = harness.ctx.teams.openChannel({ actor: raced.proof, ...openInput })
    raced.revoke()
    release?.()
    await blocker
    await expect(race).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(state.team.cursor)

    const open = workflow.issue(openScope)
    const channel = await harness.ctx.teams.openChannel({ actor: open.proof, ...openInput })
    open.revoke()
    await acknowledgeTestChannelActivations(harness.ctx, channel.manifest.id)
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const currentUnboundChannel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
    const policyCloseInput = {
      teamId: created.team.id,
      planId: plan.id,
      expectedTeamCursor: state.team.cursor,
      expectedRevision: plan.revision,
      channelId: channel.manifest.id,
      expectedCursor: currentUnboundChannel.cursor,
      reason: 'Workflow channel did not bind.',
    }
    const policyCloseScope: TeamSystemWorkflowScope = {
      kind: 'team-run-workflow-channel-close', coordinator: workflowCoordinator, ...policyCloseInput,
    }
    const revokedDuringClosePolicy = workflow.issue(policyCloseScope)
    revokeWorkflowCloseAfterPolicy = () => { revokedDuringClosePolicy.revoke() }
    await expect(harness.ctx.teams.closeWorkflowChannel({
      actor: revokedDuringClosePolicy.proof,
      ...policyCloseInput,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const afterClosePolicyRevocation = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const afterClosePolicyChannel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
    expect(afterClosePolicyRevocation.team.cursor).toBe(policyCloseInput.expectedTeamCursor)
    expect(afterClosePolicyChannel).toMatchObject({ phase: 'active', cursor: policyCloseInput.expectedCursor })

    const channelBindInput = {
      teamId: created.team.id,
      planId: plan.id,
      expectedCursor: state.team.cursor,
      expectedRevision: plan.revision,
      channelId: channel.manifest.id,
    }
    const channelBindScope: TeamSystemWorkflowScope = {
      kind: 'team-run-workflow-channel-bind', coordinator: workflowCoordinator, ...channelBindInput,
    }
    await expect(harness.ctx.teams.bindWorkflowPlanChannel({
      actor: workflow.issue(openScope).proof,
      ...channelBindInput,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const channelBind = workflow.issue(channelBindScope)
    plan = await harness.ctx.teams.bindWorkflowPlanChannel({ actor: channelBind.proof, ...channelBindInput })
    channelBind.revoke()

    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const task = await createTestCoordinatorTask(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      workflowPlanId: plan.id,
      workflowTemplateId: 'first' as never,
      subject: 'First',
      description: 'Run the first workflow task.',
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
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const taskBindInput = {
      teamId: created.team.id,
      planId: plan.id,
      expectedCursor: state.team.cursor,
      expectedRevision: plan.revision,
      templateId: 'first' as never,
      taskId: task.id,
    }
    const taskBindScope: TeamSystemWorkflowScope = {
      kind: 'team-run-workflow-task-bind', coordinator: workflowCoordinator, ...taskBindInput,
    }
    await expect(harness.ctx.teams.bindWorkflowPlanTask({
      actor: workflow.issue(channelBindScope).proof,
      ...taskBindInput,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const taskBind = workflow.issue(taskBindScope)
    plan = await harness.ctx.teams.bindWorkflowPlanTask({ actor: taskBind.proof, ...taskBindInput })
    taskBind.revoke()

    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const phaseInput = {
      teamId: created.team.id,
      planId: plan.id,
      expectedCursor: state.team.cursor,
      expectedRevision: plan.revision,
      phase: 'ready' as const,
    }
    const phaseScope: TeamSystemWorkflowScope = {
      kind: 'team-run-workflow-plan-phase', coordinator: workflowCoordinator, ...phaseInput,
    }
    await expect(harness.ctx.teams.transitionWorkflowPlan({
      actor: workflow.issue(taskBindScope).proof,
      ...phaseInput,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const phase = workflow.issue(phaseScope)
    plan = await harness.ctx.teams.transitionWorkflowPlan({ actor: phase.proof, ...phaseInput })
    phase.revoke()

    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const currentChannel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
    const closeInput = {
      teamId: created.team.id,
      planId: plan.id,
      expectedTeamCursor: state.team.cursor,
      expectedRevision: plan.revision,
      channelId: channel.manifest.id,
      expectedCursor: currentChannel.cursor,
      reason: 'Workflow channel did not bind.',
    }
    const closeScope: TeamSystemWorkflowScope = {
      kind: 'team-run-workflow-channel-close', coordinator: workflowCoordinator, ...closeInput,
    }
    await expect(harness.ctx.teams.closeWorkflowChannel({ actor: workflow.issue(closeScope).proof, ...closeInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).phase).toBe('active')
    expect(channelPolicies).toHaveLength(4)
    expect(taskPolicies).toHaveLength(4)
    expect(closePolicies).toHaveLength(1)

    const tornDown = workflow.issue(openScope)
    workflow.dispose()
    await expect(harness.ctx.teams.openChannel({ actor: tornDown.proof, ...openInput }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    unregisterClose()
    unregisterTask()
    unregisterChannel()
    other.dispose()
    await harness.dispose()
  })

  it('rejects forged, revoked, foreign, wrong-operation, and wrong-source human-action proofs before policy or journal acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect Host human-action authority.', budgets: {} }, rules: {}, budgets: {},
    })
    const participant = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const action = {
      id: teamHumanActionIdSchema.parse('question:human-action-authority:1'),
      teamId: created.team.id,
      kind: 'question' as const,
      phase: 'pending' as const,
      sessionId: SessionId('human-action-authority-session'),
      participantId: participant.id,
      sourceId: teamHumanActionSourceIdSchema.parse('human-action-authority-source'),
      details: { questionRpcId: 'human-action-authority-source' },
      createdAt: 0,
      updatedAt: 0,
    }
    const scope: TeamSystemHumanActionScope = {
      kind: 'host-human-action-upsert',
      teamId: created.team.id,
      expectedCursor: before.team.cursor,
      action,
    }
    const host = testHumanActionAuthority(harness.ctx)
    const revoked = host.issue(scope)
    revoked.revoke()
    const foreign = host.issue({
      kind: 'host-human-action-upsert',
      teamId: 'foreign-human-action-team' as never,
      expectedCursor: before.team.cursor,
      action: { ...action, teamId: 'foreign-human-action-team' as never },
    })
    const wrongOperation = host.issue({
      kind: 'host-human-action-resolve',
      teamId: created.team.id,
      expectedCursor: before.team.cursor,
      action,
      phase: 'resolved',
      outcome: { kind: 'answered' },
    })
    const otherProof: object = {}
    Object.defineProperty(otherProof, 'toJSON', {
      enumerable: true,
      value: (): never => { throw new TypeError('other human-action proofs are runtime-only') },
    })
    const opaqueOther = Object.freeze(otherProof) as TeamSystemHumanActionProof
    const unregisterOther = harness.ctx.teams.registerSystemHumanActionProofSource({
      name: 'other-host',
      resolveHumanActionProof: proof => proof === opaqueOther ? scope : undefined,
    })
    const policies: unknown[] = []
    const unregisterPolicy = harness.ctx.teams.registerPolicy('human-action', {
      name: 'observe-invalid-human-action-authority',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })
    for (const actor of [{}, revoked.proof, foreign.proof, wrongOperation.proof, opaqueOther]) {
      await expect(harness.ctx.teams.upsertHumanAction({
        actor: actor as never,
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    const afterInvalid = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(afterInvalid.team.cursor).toBe(before.team.cursor)
    expect(afterInvalid.humanActions).toEqual([])
    expect(policies).toEqual([])

    const upsert = host.issue(scope)
    const pending = await harness.ctx.teams.upsertHumanAction({
      actor: upsert.proof,
      teamId: created.team.id,
      expectedCursor: before.team.cursor,
    })
    upsert.revoke()
    expect(pending.phase).toBe('pending')
    expect(typeof pending.createdAt).toBe('number')
    expect(typeof pending.updatedAt).toBe('number')
    expect(pending.createdAt).not.toBe(0)
    const current = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const resolve = host.issue({
      kind: 'host-human-action-resolve',
      teamId: created.team.id,
      expectedCursor: current.team.cursor,
      action,
      phase: 'resolved',
      outcome: { kind: 'answered', answer: { answers: [] } },
    })
    const settled = await harness.ctx.teams.resolveHumanAction({
      actor: resolve.proof,
      teamId: created.team.id,
      expectedCursor: current.team.cursor,
    })
    resolve.revoke()
    expect(settled).toMatchObject({ phase: 'resolved', outcome: { kind: 'answered' } })
    expect(policies).toHaveLength(2)
    unregisterPolicy()
    unregisterOther()
    await harness.dispose()
  })

  it('revalidates human-action, usage, and interrupt proofs after policy before Team journal acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Reject proofs revoked while policy evaluates.', budgets: {} }, rules: {}, budgets: {},
    })
    const worker = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    let revokeHumanAction: (() => void) | undefined
    let revokeUsage: (() => void) | undefined
    let revokeInterrupt: (() => void) | undefined
    const unregisterHumanAction = harness.ctx.teams.registerPolicy('human-action', {
      name: 'revoke-human-action-proof-after-policy',
      async apply(_request, next) {
        revokeHumanAction?.()
        return await next()
      },
    })
    const unregisterUsage = harness.ctx.teams.registerPolicy('usage', {
      name: 'revoke-usage-proof-after-policy',
      async apply(_request, next) {
        revokeUsage?.()
        return await next()
      },
    })
    const unregisterInterrupt = harness.ctx.teams.registerPolicy('interrupt', {
      name: 'revoke-interrupt-proof-after-policy',
      async apply(_request, next) {
        revokeInterrupt?.()
        return await next()
      },
    })
    const host = testHumanActionAuthority(harness.ctx)
    try {
      const beforeUpsert = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const action = {
        id: teamHumanActionIdSchema.parse('question:policy-revoked-human-action'),
        teamId: created.team.id,
        kind: 'question' as const,
        phase: 'pending' as const,
        sessionId: SessionId('policy-revoked-human-action-session'),
        participantId: worker.id,
        sourceId: teamHumanActionSourceIdSchema.parse('policy-revoked-human-action-source'),
        details: { questionRpcId: 'policy-revoked-human-action-source' },
        createdAt: 0,
        updatedAt: 0,
      }
      const upsert = host.issue({
        kind: 'host-human-action-upsert',
        teamId: created.team.id,
        expectedCursor: beforeUpsert.team.cursor,
        action,
      })
      revokeHumanAction = () => { upsert.revoke() }
      try {
        await expect(harness.ctx.teams.upsertHumanAction({
          actor: upsert.proof,
          teamId: created.team.id,
          expectedCursor: beforeUpsert.team.cursor,
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        revokeHumanAction = undefined
      }
      await expect(harness.ctx.teams.getTeam({ teamId: created.team.id })).resolves.toMatchObject({
        team: { cursor: beforeUpsert.team.cursor }, humanActions: [],
      })

      const admitted = host.issue({
        kind: 'host-human-action-upsert',
        teamId: created.team.id,
        expectedCursor: beforeUpsert.team.cursor,
        action,
      })
      await harness.ctx.teams.upsertHumanAction({
        actor: admitted.proof,
        teamId: created.team.id,
        expectedCursor: beforeUpsert.team.cursor,
      })
      admitted.revoke()
      const beforeResolve = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const resolve = host.issue({
        kind: 'host-human-action-resolve',
        teamId: created.team.id,
        expectedCursor: beforeResolve.team.cursor,
        action,
        phase: 'resolved',
        outcome: { kind: 'answered', answer: { answers: [] } },
      })
      revokeHumanAction = () => { resolve.revoke() }
      try {
        await expect(harness.ctx.teams.resolveHumanAction({
          actor: resolve.proof,
          teamId: created.team.id,
          expectedCursor: beforeResolve.team.cursor,
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        revokeHumanAction = undefined
      }
      await expect(harness.ctx.teams.getTeam({ teamId: created.team.id })).resolves.toMatchObject({
        team: { cursor: beforeResolve.team.cursor },
        humanActions: [expect.objectContaining({ id: action.id, phase: 'pending' })],
      })

      const binding = await bindIdleActivation(harness.ctx, created.team.id, worker.id, 'policy-revoked-usage')
      const usage = issueActivation(harness.ctx, binding)
      const beforeUsage = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      revokeUsage = () => { usage.revoke() }
      try {
        await expect(harness.ctx.teams.recordUsage({
          actor: usage.proof,
          expectedCursor: beforeUsage.team.cursor,
          sample: {
            id: teamUsageSampleIdSchema.parse('policy-revoked-usage'),
            turn: 1,
            step: 0,
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        revokeUsage = undefined
      }
      await expect(harness.ctx.teams.getTeam({ teamId: created.team.id })).resolves.toMatchObject({
        team: { cursor: beforeUsage.team.cursor }, usage: beforeUsage.usage,
      })

      const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
      const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
      const coordinatorBinding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'policy-revoked-interrupt')
      const channel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
      const teamRun = interruptAuthority(harness.ctx, 'team-run')
      try {
        const beforeInterrupt = await harness.ctx.teams.getTeam({ teamId: created.team.id })
        const interrupt = teamRun.issue({
          kind: 'team-run-human-interrupt',
          teamId: created.team.id,
          channelId: channel.manifest.id,
          humanId: human.id,
          coordinatorId: coordinator.id,
        })
        revokeInterrupt = () => { interrupt.revoke() }
        try {
          await expect(harness.ctx.teams.requestParticipantInterrupt({
            actor: interrupt.proof,
            teamId: created.team.id,
            expectedCursor: beforeInterrupt.team.cursor,
          })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        } finally {
          revokeInterrupt = undefined
        }
        await expect(harness.ctx.teams.getTeam({ teamId: created.team.id })).resolves.toMatchObject({
          team: { cursor: beforeInterrupt.team.cursor },
        })
        const target = issueActivation(harness.ctx, coordinatorBinding)
        await expect(harness.ctx.teams.listPendingParticipantInterrupts({ actor: target.proof })).resolves.toEqual([])
        target.revoke()
      } finally {
        teamRun.dispose()
      }
    } finally {
      unregisterInterrupt()
      unregisterUsage()
      unregisterHumanAction()
      await harness.dispose()
    }
  })

  it('rejects forged, revoked, foreign, wrong-kind, and torn-down activation proofs before activation policy or journal append', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect activation lifecycle authority.', budgets: {} }, rules: {}, budgets: {},
    })
    const participant = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const input = {
      expectedCursor: before.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse('activation-authority-primary'),
          teamId: created.team.id,
          participantId: participant.id,
          status: 'idle' as const,
        },
        sessionId: SessionId('activation-authority-session'),
        provider: 'activation-authority-test',
      },
    }
    const controller = controllerActivationAuthority(harness.ctx)
    const scope: TeamSystemActivationScope = { kind: 'activation-controller-bind', ...input }
    const revoked = controller.issue(scope)
    revoked.revoke()
    const foreign = controller.issue({
      kind: 'activation-controller-bind',
      ...input,
      binding: { ...input.binding, activation: { ...input.binding.activation, teamId: 'foreign-team' as never } },
    })
    const stale = controller.issue({
      kind: 'activation-controller-bind',
      ...input,
      expectedCursor: input.expectedCursor + 1,
    })
    const wrongKind = controller.issue({
      kind: 'activation-controller-status',
      teamId: created.team.id,
      activationId: input.binding.activation.id,
      participantId: participant.id,
      sessionId: input.binding.sessionId,
      provider: input.binding.provider,
      expectedCursor: input.expectedCursor,
      status: 'running',
    })
    const other = activationAuthority(harness.ctx, 'other-system')
    const policies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('activate', {
      name: 'observe-invalid-activation-authority',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })

    for (const actor of [activationProof(), revoked.proof, foreign.proof, stale.proof, wrongKind.proof, other.issue(scope).proof]) {
      await expect(harness.ctx.teams.bindActivation({ ...input, actor }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }

    const live = controller.issue(scope)
    controller.dispose()
    await expect(harness.ctx.teams.bindActivation({ ...input, actor: live.proof }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

    const after = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(after.team.cursor).toBe(before.team.cursor)
    expect(after.activations).toEqual([])
    expect(policies).toEqual([])
    unregister()
    other.dispose()
    await harness.dispose()
  })

  it('accepts exact controller and recovery activation scopes without persisting their proofs', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Accept exact activation lifecycle authority.', budgets: {} }, rules: {}, budgets: {},
    })
    const participant = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    const binding = await bindIdleActivation(harness.ctx, created.team.id, participant.id, 'valid')
    const running = await updateActivationStatus(harness.ctx, binding, 'running')
    const controller = controllerActivationAuthority(harness.ctx)
    const beforeFence = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const fenceInput = {
      teamId: created.team.id,
      activationId: running.activation.id,
      participantId: participant.id,
      sessionId: running.sessionId,
      provider: running.provider,
      expectedCursor: beforeFence.team.cursor,
    }
    const fenced = await harness.ctx.teams.fenceActivation({
      actor: controller.issue({ kind: 'activation-controller-fence', ...fenceInput }).proof,
      ...fenceInput,
    })
    const fencedBinding = fenced.activations.find(candidate => candidate.activation.id === running.activation.id)
    expect(fencedBinding).toMatchObject({
      activation: { status: 'offline' },
      quiescenceSource: 'fenced',
    })

    const settledParticipant = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'settler', 'Settler')
    const settledBinding = await bindIdleActivation(harness.ctx, created.team.id, settledParticipant.id, 'quiesced')
    const beforeQuiesce = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const quiesceInput = {
      teamId: created.team.id,
      activationId: settledBinding.activation.id,
      participantId: settledParticipant.id,
      sessionId: settledBinding.sessionId,
      provider: settledBinding.provider,
      expectedCursor: beforeQuiesce.team.cursor,
    }
    const quiesced = await harness.ctx.teams.quiesceActivation({
      actor: controller.issue({ kind: 'activation-controller-quiesce', ...quiesceInput }).proof,
      ...quiesceInput,
    })
    expect(quiesced.activations.find(candidate => candidate.activation.id === settledBinding.activation.id)).toMatchObject({
      activation: { status: 'offline' },
      quiescenceSource: 'quiesced',
    })
    const recovery = activationAuthority(harness.ctx, 'team-activation-recovery')
    const beforeRecoveryReplay = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const recoveryInput = { ...quiesceInput, expectedCursor: beforeRecoveryReplay.team.cursor }
    await expect(harness.ctx.teams.quiesceActivation({
      actor: recovery.issue({ kind: 'activation-recovery-quiesce', ...recoveryInput }).proof,
      ...recoveryInput,
    })).resolves.toMatchObject({ team: { cursor: beforeRecoveryReplay.team.cursor } })
    expect((await harness.ctx.teams.getActivation({
      teamId: created.team.id,
      activationId: settledBinding.activation.id,
    }))).toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'quiesced' })
    recovery.dispose()
    await harness.dispose()
  })

  it('revalidates an activation proof after it waits for the Team lock', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Revalidate activation proof under Team lock.', budgets: {} }, rules: {}, budgets: {},
    })
    const participant = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    const binding = await bindIdleActivation(harness.ctx, created.team.id, participant.id, 'race')
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const input = {
      teamId: created.team.id,
      activationId: binding.activation.id,
      expectedCursor: before.team.cursor,
      status: 'running' as const,
    }
    const issued = controllerActivationAuthority(harness.ctx).issue({
      kind: 'activation-controller-status',
      participantId: participant.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
      ...input,
    })
    const hub = harness.ctx.teams as unknown as {
      teams: ReadonlyMap<TeamId, { queue: { run<T>(operation: () => Promise<T>): Promise<T> } }>
    }
    const loaded = hub.teams.get(created.team.id)
    if (loaded === undefined) throw new Error('Team Hub did not retain the race fixture Team')
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { started = resolve })
    const blocker = loaded.queue.run(async () => {
      started?.()
      await gate
    })
    await entered
    const policies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('activate', {
      name: 'observe-raced-activation-authority',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })
    const operation = harness.ctx.teams.updateActivationStatus({ actor: issued.proof, ...input })
    issued.revoke()
    release?.()
    await blocker
    await expect(operation).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const after = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(after.team.cursor).toBe(before.team.cursor)
    expect(after.activations.find(candidate => candidate.activation.id === binding.activation.id))
      .toMatchObject({ activation: { status: 'idle' } })
    expect(policies).toEqual([])
    unregister()
    await harness.dispose()
  })

  it('rejects invalid coordinator task and workflow authorities before task policy or journal acceptance', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect coordinator-authored admissions.', budgets: {} }, rules: {}, budgets: {},
    })
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    const worker = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    const binding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'coordinator-admission')
    const plan = teamWorkflowPlanSchema.parse({
      name: 'Coordinator admission plan',
      version: 1,
      tasks: [{
        id: 'first', subject: 'First', description: 'Run the first workflow task.', blockedBy: [],
        requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
        budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
      }],
      bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
      channel: {
        participantRoles: ['coordinator', 'worker'],
        graph: {
          initial: { kind: 'participant', role: 'coordinator' },
          transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }],
          maxTurns: 1,
        },
      },
      result: { kind: 'task-results', taskTemplateIds: ['first'] },
    })
    const taskInput = (expectedCursor: number, suffix: string) => ({
      teamId: created.team.id,
      expectedCursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`coordinator-task-${suffix}`) },
      subject: 'Coordinator task',
      description: 'Persist only after coordinator proof validation.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'shared' as const,
      budget: {},
      reviewPolicy: { kind: 'none' as const },
      maxAttempts: 1,
    })
    const policies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('task-mutate', {
      name: 'observe-invalid-coordinator-admissions',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })
    const beforeMissingCommand = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const validCoordinator = issueActivation(harness.ctx, binding)
    const { createCommand: _missingCommand, ...missingCommandInput } = taskInput(
      beforeMissingCommand.team.cursor,
      'missing-command',
    )
    await expect(harness.ctx.teams.createTask({
      actor: validCoordinator.proof,
      ...missingCommandInput,
    } as never)).rejects.toThrow(/createCommand/u)
    validCoordinator.revoke()
    expect(policies).toEqual([])
    const rejectBoth = async (actor: unknown, suffix: string): Promise<void> => {
      const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await expect(harness.ctx.teams.createTask({
        actor,
        ...taskInput(before.team.cursor, suffix),
      } as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await expect(harness.ctx.teams.admitWorkflowPlan({
        actor,
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse(`coordinator-plan-${suffix}`),
        plan,
      } as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const after = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      expect(after.team.cursor).toBe(before.team.cursor)
    }

    await rejectBoth({}, 'forged')
    await rejectBoth(undefined, 'missing')
    const revoked = issueActivation(harness.ctx, binding)
    revoked.revoke()
    await rejectBoth(revoked.proof, 'revoked')

    const foreign = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Foreign coordinator proof.', budgets: {} }, rules: {}, budgets: {},
    })
    const foreignCoordinator = await activeParticipant(harness.ctx, foreign.team.id, 'local-agent', 'coordinator', 'Foreign coordinator')
    const foreignBinding = await bindIdleActivation(harness.ctx, foreign.team.id, foreignCoordinator.id, 'foreign-coordinator-admission')
    const foreignProof = issueActivation(harness.ctx, foreignBinding)
    await rejectBoth(foreignProof.proof, 'foreign')

    const workerBinding = await bindIdleActivation(harness.ctx, created.team.id, worker.id, 'worker-admission')
    const workerProof = issueActivation(harness.ctx, workerBinding)
    await rejectBoth(workerProof.proof, 'wrong-role')

    const hub = harness.ctx.teams as unknown as {
      teams: ReadonlyMap<TeamId, { queue: { run<T>(operation: () => Promise<T>): Promise<T> } }>
    }
    const loaded = hub.teams.get(created.team.id)
    if (loaded === undefined) throw new Error('Team Hub did not retain the coordinator-admission race fixture Team')
    const beforeRace = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { started = resolve })
    const blocker = loaded.queue.run(async () => {
      started?.()
      await gate
    })
    await entered
    const raced = issueActivation(harness.ctx, binding)
    const operation = harness.ctx.teams.createTask({
      actor: raced.proof,
      ...taskInput(beforeRace.team.cursor, 'race'),
    })
    raced.revoke()
    release?.()
    await blocker
    await expect(operation).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(beforeRace.team.cursor)

    const policyEntered = Promise.withResolvers<undefined>()
    const releasePolicy = Promise.withResolvers<undefined>()
    const unregisterPolicyGate = harness.ctx.teams.registerPolicy('task-mutate', {
      name: 'revoke-coordinator-task-create-after-policy',
      async apply(_request, next) {
        policyEntered.resolve(undefined)
        await releasePolicy.promise
        return await next()
      },
    })
    const beforePolicyRace = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const revokedDuringPolicy = issueActivation(harness.ctx, binding)
    const policyRace = harness.ctx.teams.createTask({
      actor: revokedDuringPolicy.proof,
      ...taskInput(beforePolicyRace.team.cursor, 'policy-race'),
    })
    await policyEntered.promise
    revokedDuringPolicy.revoke()
    releasePolicy.resolve(undefined)
    await expect(policyRace).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(beforePolicyRace.team.cursor)
    unregisterPolicyGate()

    const stale = issueActivation(harness.ctx, binding)
    await updateActivationStatus(harness.ctx, binding, 'offline')
    await rejectBoth(stale.proof, 'stale')
    expect(policies).toHaveLength(1)
    foreignProof.revoke()
    workerProof.revoke()
    stale.revoke()
    unregister()
    await harness.dispose()
  })

  it('derives durable task-command and workflow-plan authors from the current coordinator proof', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Derive coordinator-authored durable facts.', budgets: {} }, rules: {}, budgets: {},
    })
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'worker', 'Worker')
    const binding = await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'derived-coordinator-admission')
    const taskLease = issueActivation(harness.ctx, binding)
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const task = await harness.ctx.teams.createTask({
      actor: taskLease.proof,
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('derived-coordinator-task') },
      subject: 'Coordinator task',
      description: 'Derive durable task provenance from the proof.',
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
    expect(task.createCommand).toEqual({
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('derived-coordinator-task'),
      creator: {
        teamId: created.team.id,
        participantId: coordinator.id,
        activationId: binding.activation.id,
        sessionId: binding.sessionId,
        provider: binding.provider,
      },
    })
    const plan = teamWorkflowPlanSchema.parse({
      name: 'Derived coordinator plan',
      version: 1,
      tasks: [{
        id: 'first', subject: 'First', description: 'Run the first workflow task.', blockedBy: [],
        requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
        budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
      }],
      bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
      channel: {
        participantRoles: ['coordinator', 'worker'],
        graph: {
          initial: { kind: 'participant', role: 'coordinator' },
          transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }],
          maxTurns: 1,
        },
      },
      result: { kind: 'task-results', taskTemplateIds: ['first'] },
    })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const planLease = issueActivation(harness.ctx, binding)
    const admitted = await harness.ctx.teams.admitWorkflowPlan({
      actor: planLease.proof,
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('derived-coordinator-plan'),
      plan,
    })
    expect(admitted.actor).toEqual({
      teamId: created.team.id,
      participantId: coordinator.id,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
    })
    taskLease.revoke()
    planLease.revoke()
    await harness.dispose()
  })

  it('rejects left or failed usage actors before pending parent-charge repair or usage policy', async () => {
    for (const phase of ['left', 'failed'] as const) {
      const harness = await setup({ maxTeamDepth: 1 })
      const parent = await createTestRootTeam(harness.ctx, {
        goal: { objective: `Parent charge guard ${phase}.`, budgets: {} }, rules: {}, budgets: {},
      })
      const coordinator = await activeParticipant(harness.ctx, parent.team.id, 'local-agent', 'coordinator', 'Coordinator')
      await bindIdleActivation(harness.ctx, parent.team.id, coordinator.id, `parent-task-${phase}`)
      const parentState = await harness.ctx.teams.getTeam({ teamId: parent.team.id })
      const parentTask = await createTestCoordinatorTask(harness.ctx, {
        teamId: parent.team.id,
        expectedCursor: parentState.team.cursor,
        subject: 'Own child usage',
        description: 'Accept child usage charges.',
        blockedBy: [],
        requiredCapabilities: [],
        priority: 0,
        readScopes: [],
        writeScopes: [],
        workspaceMode: 'shared',
        budget: {},
        reviewPolicy: { kind: 'none' },
        maxAttempts: 1,
        execution: { kind: 'child-team', templateId: 'closure-child', templateVersion: 1, authorityGrant: { ...parentState.team.authorityGrant!, workspaceModes: ['shared'] as const, readScopes: [], writeScopes: [] }, budget: {} },
      })
      const child = await createTestChildTeam(harness.ctx, await reserveChildCreation(harness.ctx, parentTask, `Child charge guard ${phase}.`))
      const participant = await activeParticipant(harness.ctx, child.team.id, 'local-agent', 'worker', 'Worker')
      const binding = await bindIdleActivation(harness.ctx, child.team.id, participant.id, `usage-${phase}`)
      const actor = harness.ctx.teams.openActivationActorProofIssuer().issue(binding).proof
      let denyParentCharge = true
      const usagePolicies: unknown[] = []
      const unregister = harness.ctx.teams.registerPolicy('usage', {
        name: `deny-pending-parent-charge-${phase}`,
        async apply(request, next) {
          usagePolicies.push(request)
          if (denyParentCharge && request.facts.chargeId !== undefined) {
            return { kind: 'deny', code: 'PARENT_NOT_READY', message: 'The parent charge is temporarily unavailable.' }
          }
          return await next()
        },
      })
      const sample = {
        id: `usage-pending-${phase}` as never,
        turn: 1,
        step: 0,
        usage: { inputTokens: 1, outputTokens: 1 },
      }
      await expect(harness.ctx.teams.recordUsage({
        actor,
        expectedCursor: (await harness.ctx.teams.getTeam({ teamId: child.team.id })).team.cursor,
        sample,
      })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
      await seedParticipantPhase(harness.ctx, child.team.id, participant.id, phase)
      const beforeRejectedUsage = await harness.ctx.teams.getTeam({ teamId: child.team.id })
      const parentBeforeRejectedUsage = await harness.ctx.teams.getTeam({ teamId: parent.team.id })
      const policyCount = usagePolicies.length
      denyParentCharge = false
      await expect(harness.ctx.teams.recordUsage({
        actor,
        expectedCursor: beforeRejectedUsage.team.cursor,
        sample,
      })).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
      const afterRejectedUsage = await harness.ctx.teams.getTeam({ teamId: child.team.id })
      const parentAfterRejectedUsage = await harness.ctx.teams.getTeam({ teamId: parent.team.id })
      expect(afterRejectedUsage.team.cursor).toBe(beforeRejectedUsage.team.cursor)
      expect(parentAfterRejectedUsage.team.cursor).toBe(parentBeforeRejectedUsage.team.cursor)
      expect(usagePolicies).toHaveLength(policyCount)
      unregister()
      await harness.dispose()
    }
  })

  it('rejects forged, revoked, foreign, and wrong-source interrupt proofs before policy or journal append', async () => {
    const harness = await setup()
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Protect soft interrupt authority.', budgets: {} }, rules: {}, budgets: {},
    })
    const human = await activeParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    await bindIdleActivation(harness.ctx, created.team.id, coordinator.id, 'interrupt-coordinator')
    const channel = await openDirectV3(harness.ctx, created.team.id, human.id, coordinator.id)
    const teamRun = interruptAuthority(harness.ctx, 'team-run')
    const other = interruptAuthority(harness.ctx, 'other-system')
    const scope: TeamSystemInterruptScope = {
      kind: 'team-run-human-interrupt',
      teamId: created.team.id,
      channelId: channel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    }
    const revoked = teamRun.issue(scope)
    revoked.revoke()
    const foreign = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Supply a foreign interrupt proof.', budgets: {} }, rules: {}, budgets: {},
    })
    const foreignProof = teamRun.issue({ ...scope, teamId: foreign.team.id })
    const policies: unknown[] = []
    const unregister = harness.ctx.teams.registerPolicy('interrupt', {
      name: 'observe-invalid-interrupt-authority',
      async apply(request, next) {
        policies.push(request)
        return await next()
      },
    })
    const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const input = { teamId: created.team.id, expectedCursor: before.team.cursor }
    for (const actor of [{}, interruptProof(), revoked.proof, foreignProof.proof, other.issue(scope).proof]) {
      await expect(harness.ctx.teams.requestParticipantInterrupt({ ...input, actor } as never))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    }
    const after = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    expect(after.team.cursor).toBe(before.team.cursor)
    expect(policies).toEqual([])
    unregister()
    other.dispose()
    teamRun.dispose()
    await harness.dispose()
  })
})

for (const backend of ['json', 'sqlite'] as const) {
  it(`settles pending, review, workflow and human work from a failure intent after ${backend} restart`, async () => {
    const first = await setup({}, undefined, backend)
    const created = await createTestRootTeam(first.ctx,
      { goal: { objective: 'Close unfinished business work.',
        budgets: {} },
      rules: {},
      budgets: {} })
    const teamId = created.team.id
    const coordinator = await activeParticipant(first.ctx, teamId, 'local-agent', 'coordinator', 'Coordinator')
    const reviewer = await activeParticipant(first.ctx, teamId, 'human', 'human', 'Reviewer')
    const binding = await bindIdleActivation(first.ctx, teamId, coordinator.id, `business-fail-${backend}`)
    const owner = issueActivation(first.ctx, binding)
    const tasks = []
    for (const subject of ['Pending task', 'Review task']) {
      const task = await first.ctx.teams.createTask({
        actor: owner.proof, teamId, expectedCursor: (await first.ctx.teams.getTeam({ teamId })).team.cursor,
        createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`${backend}-${subject}`) },
        subject, description: subject, blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [],
        workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'participant', reviewerId: reviewer.id }, maxAttempts: 2,
      })
      if (subject === 'Pending task') { tasks.push(task); continue }
      const assigned = await assignTestTask(first.ctx,
        { teamId,
          taskId: task.id,
          expectedRevision: task.revision,
          participantId: coordinator.id,
          activationId: binding.activation.id,
          leaseDurationMs: 60_000 })
      if (assigned.lease === undefined) throw new Error('review task lease is missing')
      const running = await first.ctx.teams.startTaskAttempt({ actor: owner.proof,
        taskId: task.id,
        expectedRevision: assigned.revision,
        attemptId: assigned.lease.attemptId })
      tasks.push(await first.ctx.teams.settleTaskAttempt({ actor: owner.proof, taskId: task.id, expectedRevision: running.revision,
        attemptId: assigned.lease.attemptId, outcome: { kind: 'completed', result: { summary: 'Keep this completed attempt.' } } }))
    }
    const plan = await first.ctx.teams.admitWorkflowPlan({
      actor: owner.proof, teamId, expectedCursor: (await first.ctx.teams.getTeam({ teamId })).team.cursor,
      idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse(`unfinished-plan-${backend}`),
      plan: teamWorkflowPlanSchema.parse({
        name: 'Unfinished compilation', version: 1,
        tasks: [{ id: 'first', subject: 'First', description: 'First', blockedBy: [], requiredCapabilities: [], priority: 0,
          readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 }],
        bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
        channel: { participantRoles: ['coordinator',
          'human'],
        graph: { initial: { kind: 'participant',
          role: 'coordinator' },
        transitions: [{ condition: { kind: 'always' },
          target: { kind: 'terminate' } }],
        maxTurns: 1 } },
        result: { kind: 'task-results', taskTemplateIds: ['first'] },
      }),
    })
    owner.revoke()
    const action = {
      id: teamHumanActionIdSchema.parse(`question:closure-fail:${backend}`), teamId, kind: 'question' as const, phase: 'pending' as const,
      sessionId: binding.sessionId, participantId: coordinator.id, sourceId: teamHumanActionSourceIdSchema.parse(`question-${backend}`),
      details: { question: 'Continue?' }, createdAt: 0, updatedAt: 0,
    }
    const actionInput = { teamId, expectedCursor: (await first.ctx.teams.getTeam({ teamId })).team.cursor }
    const host = testHumanActionAuthority(first.ctx)
    const humanProof = host.issue({ kind: 'host-human-action-upsert', ...actionInput, action })
    await first.ctx.teams.upsertHumanAction({ actor: humanProof.proof, ...actionInput })
    humanProof.revoke()
    const closer = closureAuthority(first.ctx, 'team-run')
    const proof = closer.issue({ kind: 'team-run-create-failure', teamId })
    const reason = { code: 'MODEL_UNAVAILABLE', message: 'The model provider failed.' }
    const accepted = await first.ctx.teams.failTeam({ actor: proof.proof, teamId,
      expectedCursor: (await first.ctx.teams.getTeam({ teamId })).team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse(`business-fail-${backend}`), reason })
    proof.revoke()
    closer.dispose()
    expect(accepted.tasks.map(task => task.phase)).toEqual(['pending', 'review'])
    await first.dispose()

    const reopened = await setup({}, first.root, backend)
    const driver = closureDriverAuthority(reopened.ctx, 'team-closure-driver')
    try {
      for (let pass = 0; pass < 2; pass += 1) {
        const current = await reopened.ctx.teams.getTeam({ teamId })
        const closure = current.team.closure
        if (closure?.kind !== 'fail') throw new Error('failure intent is missing')
        const recovery = driver.issue({ kind: 'closure-recover-fail', teamId, expectedCursor: current.team.cursor,
          closureIdempotencyKey: closure.idempotencyKey, closureRequestedAt: closure.requestedAt })
        const settled = await reopened.ctx.teams.continueTeamClosure({ actor: recovery.proof, teamId, expectedCursor: current.team.cursor })
        recovery.revoke()
        expect(settled.tasks.map(task => task.phase)).toEqual(['cancelled', 'cancelled'])
        expect(settled.tasks[1]?.attemptHistory).toEqual(tasks[1]?.attemptHistory)
        expect(settled.tasks[1]?.reviewHistory).toEqual(tasks[1]?.reviewHistory)
        expect(settled.workflowPlans).toMatchObject([{ id: plan.id, phase: 'failed', failure: reason }])
        expect(settled.humanActions).toMatchObject([{ id: action.id, phase: 'cancelled', outcome: { kind: 'team-failed', reason } }])
        expect(settled.activations[0]).toMatchObject({ activation: { status: 'idle' } })
        if (pass === 1) expect(settled.team.cursor).toBe(current.team.cursor)
      }
    } finally {
      driver.dispose()
      await reopened.dispose()
    }
    const verified = await setup({}, first.root, backend)
    expect((await verified.ctx.teams.getTeam({ teamId })).tasks.map(task => task.phase)).toEqual(['cancelled', 'cancelled'])
    await verified.dispose()
  })
}
