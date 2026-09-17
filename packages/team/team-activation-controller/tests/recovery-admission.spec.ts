import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, onTestFailed, vi } from 'vitest'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import type { ActivationHandle, AgentRuntimeProvider } from '@clocky/clocky-agent-runtime'
import { SessionId } from '@clocky/clocky-session'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import {
  activationIdSchema,
  fingerprintTeamHumanActorPayload,
  jsonObjectSchema,
  participantIdSchema,
  participantInviteInputSchema,
} from '@clocky/clocky-team'
import type { TeamId, TeamHumanActorProof, TeamHumanActorScope, ParticipantSnapshot, ActivationBindingSnapshot, TeamSystemActivationProof, TeamSystemActivationScope } from '@clocky/clocky-team'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import * as Controller from '../src/index.ts'
import type { TeamActivationResumePreflightRequest } from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Run admission against the real Hub, controller and human resume authorization. */
async function setup(mountController = true, backend: 'json' | 'sqlite' = 'json') {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'controller-admission-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'team.sqlite') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(AgentRuntime)
  let sequence = 0
  const handles: ActivationHandle[] = []
  const provider: AgentRuntimeProvider = {
    name: 'admission-runtime',
    terminationMode: 'cooperative',
    async activate(request) {
      const activation = {
        id: activationIdSchema.parse(`admission-${++sequence}`),
        teamId: request.teamId,
        participantId: request.participant.id,
        status: 'idle' as const,
      }
      const handle: ActivationHandle = {
        activation,
        sessionId: request.sessionId,
        localAgent: undefined,
        async health() { return activation },
        onStatus() { return () => {} },
        interrupt() {},
        async dispose() {},
      }
      handles.push(handle)
      return handle
    },
  }
  const unregisterProvider = ctx.agentRuntimes.registerProvider(provider)
  if (mountController) await ctx.plugin(Controller, { statusSyncAttempts: 2 })
  return { ctx, provider, handles, unregisterProvider }
}

/** Add one schema-validated participant to a real Team. */
async function participant(ctx: Context, teamId: TeamId, kind: 'local-agent' | 'human', role: string) {
  const input = participantInviteInputSchema.parse({
    teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    kind, role, displayName: role, capabilities: [],
    ...kind === 'human' ? { owner: { kind: 'product-principal', principalId: `principal-${teamId}` } } : {},
  })
  const invited = await inviteBootstrapParticipant(ctx, input)
  for (const phase of ['provisioning', 'active'] as const) {
    await transitionBootstrapParticipant(ctx, {
      teamId, participantId: invited.id, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase,
    })
  }
  return invited
}

/** Issue an actual Hub authorization through a live authenticated-human proof source. */
async function authorize(ctx: Context, teamId: TeamId, human: ParticipantSnapshot) {
  const input = { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor }
  const proof = Object.freeze({}) as TeamHumanActorProof
  const bound = { teamId, operation: 'activate' as const, fence: { kind: 'cursor' as const, cursor: input.expectedCursor },
    payload: jsonObjectSchema.parse(input) }
  const scope: TeamHumanActorScope = {
    teamId, participantId: human.id, operation: 'activate', fence: bound.fence,
    payloadFingerprint: fingerprintTeamHumanActorPayload(bound),
  }
  const unregister = ctx.teams.registerHumanActorProofSource({
    name: `admission-human-${teamId}`, resolveHumanActorProof: value => value === proof ? scope : undefined,
  })
  const authorization = await ctx.teams.authorizeHumanResume({ actor: proof, ...input })
  return { authorization, close() { authorization.close(); unregister() } }
}

/** Keep an offline coordinator epoch whose Session remains available for resume. */
async function team(ctx: Context, dispose = true) {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Validate exact recovery ownership.', budgets: {} }, rules: {}, budgets: {} })
  const teamId = created.team.id
  const human = await participant(ctx, teamId, 'human', 'owner')
  const coordinator = await participant(ctx, teamId, 'local-agent', 'coordinator')
  const lease = await ctx.teamActivations.activate({
    teamId, participantId: coordinator.id, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    provider: 'admission-runtime', sessionId: SessionId(`admission-session-${teamId}`),
    seed: { kind: 'fresh' }, agent: { options: {} }, signal: new AbortController().signal,
  })
  if (dispose) await lease.dispose()
  const humanAuthorization = await authorize(ctx, teamId, human)
  const request: TeamActivationResumePreflightRequest = {
    teamId, participantId: coordinator.id, activationId: lease.binding.activation.id,
    provider: lease.binding.provider, sessionId: lease.binding.sessionId, authorization: humanAuthorization.authorization,
  }
  return { teamId, human, coordinator, lease, request, humanAuthorization }
}

/** Reconstruct an offline residency report whose process still requires a provider fence. */
async function recoverableTeam(ctx: Context, maxTokens: number | undefined, preset?: string, status: 'offline' | 'idle' = 'offline') {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Resume a provider-owned epoch.', budgets: {} }, rules: {}, budgets: {} })
  const teamId = created.team.id
  const human = await participant(ctx, teamId, 'human', 'owner')
  const coordinator = await participant(ctx, teamId, 'local-agent', 'coordinator')
  const proofs = new Map<TeamSystemActivationProof, TeamSystemActivationScope>()
  const unregister = ctx.teams.registerSystemActivationProofSource({
    name: 'team-activation-controller', resolveActivationProof: proof => proofs.get(proof),
  })
  const binding: ActivationBindingSnapshot = {
    activation: { id: activationIdSchema.parse(`stale-${teamId}`), teamId, participantId: coordinator.id, status: 'idle' },
    sessionId: SessionId(`persisted-${teamId}`), provider: 'admission-runtime',
    ...preset === undefined ? {} : { selection: { preset, provider: 'mock', model: 'mock' } },
    recovery: { kind: 'sdk-local-cold-replace', version: 1, runtimeProvider: 'admission-runtime', profile: 'same-host',
      agent: { provider: 'mock', model: 'mock', ...maxTokens === undefined ? {} : { maxTokens } },
      process: { hostId: 'test-host', pid: 123, started: 'owned-generation' } },
  }
  const bind = { binding, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor }
  const bindProof = Object.freeze({}) as TeamSystemActivationProof
  proofs.set(bindProof, { kind: 'activation-controller-bind', ...bind })
  await ctx.teams.bindActivation({ actor: bindProof, ...bind })
  proofs.delete(bindProof)
  const statusInput = { teamId, activationId: binding.activation.id,
    expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, status }
  const statusProof = Object.freeze({}) as TeamSystemActivationProof
  proofs.set(statusProof, { kind: 'activation-controller-status', ...statusInput,
    participantId: coordinator.id, sessionId: binding.sessionId, provider: binding.provider })
  if (status === 'offline') await ctx.teams.updateActivationStatus({ actor: statusProof, ...statusInput })
  proofs.delete(statusProof)
  unregister()
  const humanAuthorization = await authorize(ctx, teamId, human)
  return { teamId, human, coordinator, binding, humanAuthorization,
    request: { teamId, participantId: coordinator.id, activationId: binding.activation.id,
      sessionId: binding.sessionId, provider: binding.provider, authorization: humanAuthorization.authorization } }
}

describe('controller recovery admission', () => {
  it.each(['provider', 'writeback', 'unload'] as const)('keeps accepted stale-fence %s work owned until settlement during close', async (pause) => {
    let phase = 'service setup'
    onTestFailed(() => { console.error(`stale-fence close failed during ${phase}`) })
    const { ctx } = await setup(false, 'sqlite')
    phase = 'durable fixture creation'
    const owner = await recoverableTeam(ctx, undefined)
    phase = 'controller setup'
    const controller = await ctx.plugin(Controller)
    const service = ctx.teamActivations
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const unregister = ctx.agentRuntimes.registerFencer({ provider: 'admission-runtime', validate() {},
      async fence() { if (pause !== 'writeback') { entered.resolve(undefined); await released.promise } } })
    if (pause === 'writeback') {
      const fence = ctx.teams.fenceActivation.bind(ctx.teams)
      vi.spyOn(ctx.teams, 'fenceActivation').mockImplementationOnce(async (request) => {
        entered.resolve(undefined)
        await released.promise
        return await fence(request)
      })
    }
    const fencing = ctx.teamActivations.fenceStale(owner.request)
    phase = 'provider entry'
    await Promise.race([entered.promise, fencing])
    await expect(ctx.teamActivations.fenceStale(owner.request)).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
    await expect(ctx.teamActivations.coldReplace({ ...owner.request, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
    await expect(ctx.teamActivations.activate({ teamId: owner.teamId, participantId: owner.coordinator.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: owner.teamId })).team.cursor,
      provider: owner.binding.provider, sessionId: owner.binding.sessionId, seed: { kind: 'resume' },
      agent: { options: {} }, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
    let closed = false
    if (pause === 'unload') unregister()
    const closing = (pause === 'unload' ? controller.dispose() : service.close()).then(() => { closed = true })
    try {
      phase = 'pending close'
      await new Promise(resolve => setImmediate(resolve))
      expect(closed).toBe(false)
      if (pause !== 'unload') await expect(service.fenceStale(owner.request)).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
      released.resolve(undefined)
      phase = 'durable settlement'
      await Promise.all([fencing, closing])
      phase = 'durable verification'
      expect((await ctx.teams.getTeam({ teamId: owner.teamId })).activations[0]).toMatchObject({
        activation: { status: 'offline' }, quiescenceSource: 'fenced',
      })
    } finally {
      released.resolve(undefined)
      await Promise.allSettled([fencing, closing])
      unregister()
      owner.humanAuthorization.close()
    }
  })

  it('rejects stale-fence targets that do not name the exact owned epoch', async () => {
    const { ctx, handles } = await setup()
    const owner = await team(ctx, false)
    const dispose = vi.spyOn(handles[0]!, 'dispose')
    try {
      for (const target of [
        { activationId: activationIdSchema.parse('another-epoch') },
        { sessionId: SessionId('another-session') },
        { provider: 'another-provider' },
      ]) {
        await expect(ctx.teamActivations.fenceStale({ ...owner.request, ...target }))
          .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
        expect(dispose).not.toHaveBeenCalled()
      }
      await ctx.teamActivations.fenceStale(owner.request)
      expect(dispose).toHaveBeenCalledOnce()
      expect((await ctx.teams.getTeam({ teamId: owner.teamId })).activations[0]?.quiescedAt).toBeDefined()
    } finally { owner.humanAuthorization.close() }
  })

  it.each(['offline', 'idle'] as const)('requires provider termination evidence for an unowned %s epoch before durable stale fencing', async (status) => {
    const { ctx } = await setup(false)
    const owner = await recoverableTeam(ctx, undefined, undefined, status)
    await ctx.plugin(Controller)
    const before = await ctx.teams.getTeam({ teamId: owner.teamId })
    const fence = vi.fn(async () => {}).mockRejectedValueOnce(new Error('Termination unknown'))
    try {
      await expect(ctx.teamActivations.fenceStale(owner.request))
        .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_FENCE_UNAVAILABLE' })
      expect(await ctx.teams.getTeam({ teamId: owner.teamId })).toEqual(before)
      const unregister = ctx.agentRuntimes.registerFencer({ provider: 'admission-runtime', validate() {}, fence })
      try {
        await expect(ctx.teamActivations.fenceStale(owner.request)).rejects.toThrow('Termination unknown')
        expect(await ctx.teams.getTeam({ teamId: owner.teamId })).toEqual(before)
        await ctx.teamActivations.fenceStale(owner.request)
        expect(fence).toHaveBeenCalledTimes(2)
        expect(fence).toHaveBeenLastCalledWith({ ...owner.binding, activation: { ...owner.binding.activation, status } })
        const after = await ctx.teams.getTeam({ teamId: owner.teamId })
        expect(after.activations[0]?.quiescenceSource).toBe('fenced')
        expect(after.activations[0]?.quiescedAt).toBeDefined()
        await ctx.teamActivations.fenceStale(owner.request)
        expect(fence).toHaveBeenCalledTimes(2)
      } finally { unregister() }
    } finally { owner.humanAuthorization.close() }
  })

  it('does not record a stale fence after human authorization revokes during provider termination', async () => {
    const { ctx } = await setup(false)
    const owner = await recoverableTeam(ctx, undefined)
    await ctx.plugin(Controller)
    const before = await ctx.teams.getTeam({ teamId: owner.teamId })
    const unregister = ctx.agentRuntimes.registerFencer({ provider: 'admission-runtime', validate() {},
      async fence() { owner.humanAuthorization.close() } })
    try {
      await expect(ctx.teamActivations.fenceStale(owner.request)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(await ctx.teams.getTeam({ teamId: owner.teamId })).toEqual(before)
    } finally { unregister(); owner.humanAuthorization.close() }
  })

  it.each([
    ['retired provider', 'provider' as const],
    ['missing fencer', 'fencer' as const],
  ])('records a named recovery stall when the %s cannot fence a local epoch', async (_label, failure) => {
    const { ctx, unregisterProvider } = await setup(false)
    const owner = await recoverableTeam(ctx, undefined)
    await ctx.plugin(Controller)
    if (failure === 'provider') unregisterProvider()
    await expect(ctx.teamActivations.coldReplace({ ...owner.request, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_FENCE_UNAVAILABLE' })
    const current = await ctx.teams.getTeam({ teamId: owner.teamId })
    expect(current.team.phase).toBe('stalled')
    expect(current.team.stallReason?.code).toBe(
      failure === 'provider' ? 'AGENT_RUNTIME_PROVIDER_UNAVAILABLE' : 'AGENT_RUNTIME_FENCER_UNAVAILABLE',
    )
    owner.humanAuthorization.close()
  })

  it('does not persist a recovery stall when the cold-replacement caller is already aborted', async () => {
    const { ctx } = await setup(false)
    const owner = await recoverableTeam(ctx, undefined)
    await ctx.plugin(Controller)
    const controller = new AbortController()
    controller.abort()

    await expect(ctx.teamActivations.coldReplace({ ...owner.request, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    const current = await ctx.teams.getTeam({ teamId: owner.teamId })
    expect(current.team.phase).toBe('active')
    expect(current.team.stallReason).toBeUndefined()
    owner.humanAuthorization.close()
  })

  it('records a named fence failure when the local fencer cannot terminate the epoch', async () => {
    const { ctx } = await setup(false)
    const owner = await recoverableTeam(ctx, undefined)
    await ctx.plugin(Controller)
    ctx.agentRuntimes.registerFencer({
      provider: owner.binding.provider,
      validate() {},
      async fence() { throw new Error('fence fixture failed') },
    })
    await expect(ctx.teamActivations.coldReplace({ ...owner.request, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_FENCE_FAILED' })
    const current = await ctx.teams.getTeam({ teamId: owner.teamId })
    expect(current.team.phase).toBe('stalled')
    expect(current.team.stallReason?.code).toBe('AGENT_RUNTIME_FENCE_FAILED')
    owner.humanAuthorization.close()
  })

  for (const maxTokens of [undefined, 32]) {
    it(`requires a fencer and reuses persisted model options with maxTokens=${String(maxTokens)}`, async () => {
      const { ctx, provider } = await setup(false)
      const owner = await recoverableTeam(ctx, maxTokens, 'persisted-specialist')
      await ctx.plugin(Controller)
      const activate = vi.spyOn(provider, 'activate')
      await expect(ctx.teamActivations.preflightResume(owner.request))
        .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_UNSUPPORTED' })
      const fence = vi.fn(async () => {})
      ctx.agentRuntimes.registerFencer({ provider: owner.binding.provider, validate() {}, fence })
      await ctx.teamActivations.preflightResume(owner.request)
      expect(fence).not.toHaveBeenCalled()
      const replacement = await ctx.teamActivations.coldReplace({ ...owner.request, signal: new AbortController().signal })
      expect(fence).toHaveBeenCalledOnce()
      expect(activate.mock.calls[0]?.[0].agent.options).toEqual({
        provider: 'mock', model: 'mock', ...maxTokens === undefined ? {} : { maxTokens },
      })
      expect(activate.mock.calls[0]?.[0].agent.preset).toBe('persisted-specialist')
      expect(replacement.binding.selection?.preset).toBe('persisted-specialist')
      expect(replacement.binding.activation.id).not.toBe(owner.binding.activation.id)
      expect(replacement.binding.sessionId).toBe(owner.binding.sessionId)
      await replacement.dispose()
      owner.humanAuthorization.close()
    })
  }

  for (const moment of ['fence-complete', 'replacement-read'] as const) {
    it(`stops cold replacement when close occurs at ${moment}`, async () => {
      const { ctx, provider } = await setup(false)
      const owner = await recoverableTeam(ctx, undefined)
      await ctx.plugin(Controller)
      ctx.agentRuntimes.registerFencer({ provider: owner.binding.provider, validate() {}, async fence() {} })
      const activate = vi.spyOn(provider, 'activate')
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      if (moment === 'fence-complete') {
        const original = ctx.teams.fenceActivation.bind(ctx.teams)
        vi.spyOn(ctx.teams, 'fenceActivation').mockImplementation(async (input) => {
          const result = await original(input)
          entered.resolve(undefined)
          await release.promise
          return result
        })
      } else {
        const original = ctx.teams.getTeam.bind(ctx.teams)
        vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (input) => {
          const result = await original(input)
          if (result.activations.some(binding =>
            binding.activation.id === owner.binding.activation.id && binding.quiescedAt !== undefined)) {
            entered.resolve(undefined)
            await release.promise
          }
          return result
        })
      }
      const replacement = ctx.teamActivations.coldReplace({ ...owner.request, signal: new AbortController().signal })
      const rejected = expect(replacement).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
      await entered.promise
      const closed = ctx.teamActivations.close()
      release.resolve(undefined)
      await Promise.all([rejected, closed])
      expect(activate).not.toHaveBeenCalled()
      expect((await ctx.teams.getTeam({ teamId: owner.teamId })).activations).toHaveLength(1)
      owner.humanAuthorization.close()
    })
  }

  it('rejects wrong participant, Session, provider and epoch requests before provider work', async () => {
    const { ctx } = await setup()
    const owner = await team(ctx)
    const other = await participant(ctx, owner.teamId, 'local-agent', 'other')
    const requests = [
      { ...owner.request, participantId: participantIdSchema.parse('absent-participant') },
      { ...owner.request, participantId: owner.human.id },
      { ...owner.request, participantId: other.id },
      { ...owner.request, sessionId: SessionId('another-session') },
      { ...owner.request, provider: 'another-provider' },
      { ...owner.request, activationId: activationIdSchema.parse('absent-epoch') },
    ]
    for (const request of requests) {
      await expect(ctx.teamActivations.preflightResume(request))
        .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_UNSUPPORTED' })
    }
    await ctx.teamActivations.preflightResume(owner.request)
    owner.humanAuthorization.close()
  })

  it('rejects a resident epoch, retired participant and unavailable placement provider', async () => {
    const { ctx, unregisterProvider } = await setup()
    const owner = await team(ctx, false)
    await expect(ctx.teamActivations.preflightResume(owner.request)).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_UNSUPPORTED' })
    await owner.lease.dispose()
    unregisterProvider()
    await expect(ctx.teamActivations.preflightResume(owner.request)).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_UNSUPPORTED' })
    const input = {
      teamId: owner.teamId, participantId: owner.coordinator.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: owner.teamId })).team.cursor, phase: 'left' as const,
    }
    const actor = Object.freeze({}) as TeamHumanActorProof
    const bound = { teamId: owner.teamId, operation: 'close' as const,
      fence: { kind: 'cursor' as const, cursor: input.expectedCursor }, payload: jsonObjectSchema.parse(input) }
    const scope: TeamHumanActorScope = { teamId: owner.teamId, participantId: owner.human.id,
      operation: 'close', fence: bound.fence, payloadFingerprint: fingerprintTeamHumanActorPayload(bound) }
    const unregister = ctx.teams.registerHumanActorProofSource({
      name: 'retire-preflight-participant', resolveHumanActorProof: proof => proof === actor ? scope : undefined,
    })
    await ctx.teams.transitionParticipantPhase({ actor, ...input })
    unregister()
    await expect(ctx.teamActivations.preflightResume(owner.request)).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_UNSUPPORTED' })
    owner.humanAuthorization.close()
  })

  it('does not accept one Team authorization for another Team recovery', async () => {
    const { ctx } = await setup()
    const first = await team(ctx)
    const second = await team(ctx)
    await expect(ctx.teamActivations.preflightResume({ ...second.request, authorization: first.request.authorization }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    first.humanAuthorization.close()
    second.humanAuthorization.close()
  })

  it('rejects cross-Team authorization before activation or fencing begins', async () => {
    const { ctx, provider } = await setup()
    const first = await team(ctx)
    const second = await team(ctx)
    const activate = vi.spyOn(provider, 'activate')
    const request = {
      teamId: second.teamId, participantId: second.coordinator.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: second.teamId })).team.cursor,
      provider: 'admission-runtime', sessionId: second.lease.binding.sessionId,
      seed: { kind: 'resume' as const }, agent: { options: {} }, signal: new AbortController().signal,
      authorization: first.request.authorization,
    }
    await expect(ctx.teamActivations.activate(request)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teamActivations.coldReplace({ ...second.request, authorization: first.request.authorization,
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(activate).not.toHaveBeenCalled()
    first.humanAuthorization.close()
    second.humanAuthorization.close()
  })

  it('captures the accepted recovery target before an asynchronous caller edit', async () => {
    const { ctx } = await setup()
    const first = await team(ctx)
    const second = await team(ctx)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const originalRead = ctx.teams.getTeam.bind(ctx.teams)
    const read = vi.spyOn(ctx.teams, 'getTeam').mockImplementationOnce(async (input) => {
      entered.resolve(undefined)
      await release.promise
      return await originalRead(input)
    })
    const draft = { ...first.request }
    const preflight = ctx.teamActivations.preflightResume(draft)
    await entered.promise
    Object.assign(draft, second.request)
    release.resolve(undefined)
    await preflight
    expect(read.mock.calls[0]?.[0].teamId).toBe(first.teamId)
    first.humanAuthorization.close()
    second.humanAuthorization.close()
  })

  it('revalidates human authorization after provider publication and before durable bind', async () => {
    const { ctx, provider } = await setup()
    const owner = await team(ctx)
    const dispose = vi.fn(async () => {})
    vi.spyOn(provider, 'activate').mockImplementationOnce(async (request) => {
      owner.request.authorization.close()
      return {
        activation: { id: activationIdSchema.parse('revoked-publication'), teamId: request.teamId,
          participantId: request.participant.id, status: 'idle' },
        sessionId: request.sessionId, localAgent: undefined,
        async health() { return { id: activationIdSchema.parse('revoked-publication'), teamId: request.teamId,
          participantId: request.participant.id, status: 'idle' } },
        onStatus() { return () => {} }, interrupt() {}, dispose,
      }
    })
    await expect(ctx.teamActivations.activate({
      teamId: owner.teamId, participantId: owner.coordinator.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: owner.teamId })).team.cursor,
      provider: 'admission-runtime', sessionId: owner.lease.binding.sessionId,
      seed: { kind: 'resume' }, agent: { options: {} }, signal: new AbortController().signal,
      authorization: owner.request.authorization,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(dispose).toHaveBeenCalledOnce()
    expect((await ctx.teams.getTeam({ teamId: owner.teamId })).activations).toHaveLength(1)
    owner.humanAuthorization.close()
  })

  it('rejects cold replacement without an exact retained epoch and recoverable owner', async () => {
    const { ctx } = await setup()
    const owner = await team(ctx)
    const request = { teamId: owner.teamId, participantId: owner.coordinator.id,
      activationId: owner.lease.binding.activation.id, signal: new AbortController().signal }
    await expect(ctx.teamActivations.coldReplace({ ...request, activationId: activationIdSchema.parse('missing-predecessor') }))
      .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_NOT_FOUND' })
    await expect(ctx.teamActivations.coldReplace({ ...request, participantId: owner.human.id }))
      .rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_CONFLICT' })
    await expect(ctx.teamActivations.coldReplace(request)).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_RECOVERY_UNSUPPORTED' })
    owner.humanAuthorization.close()
  })

  it('reads offline provider health through cleanup and keeps stopping health stable', async () => {
    const { ctx, handles } = await setup()
    const owner = await team(ctx, false)
    const handle = handles[0]
    if (handle === undefined) throw new Error('runtime handle is missing')
    vi.spyOn(handle, 'health').mockResolvedValue({ ...handle.activation, status: 'offline' })
    const stopping = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(handle, 'dispose').mockImplementation(async () => { stopping.resolve(undefined); await release.promise })
    const health = owner.lease.health()
    await stopping.promise
    expect((await owner.lease.health()).activation.status).toBe('stopping')
    owner.lease.interrupt({ kind: 'user' })
    release.resolve(undefined)
    expect((await health).activation.status).toBe('offline')
    owner.humanAuthorization.close()
  })

  it('contains an immediate provider exit after durable publication', async () => {
    const { ctx, provider } = await setup()
    const originalActivate = provider.activate.bind(provider)
    vi.spyOn(provider, 'activate').mockImplementation(async (request) => {
      const handle = await originalActivate(request)
      vi.spyOn(handle, 'health').mockResolvedValueOnce(handle.activation).mockResolvedValue({ ...handle.activation, status: 'offline' })
      return handle
    })
    const owner = await team(ctx, false)
    await vi.waitFor(async () => {
      expect((await ctx.teams.getTeam({ teamId: owner.teamId })).activations[0]?.quiescedAt).toBeTypeOf('number')
    })
    owner.humanAuthorization.close()
  })

  it('revalidates a pending bind proof after policy revokes its human authority', async () => {
    const { ctx } = await setup()
    const owner = await team(ctx)
    ctx.teams.registerPolicy('activate', {
      name: 'revoke-human-bind-proof',
      async apply(_request, next) { owner.request.authorization.close(); return await next() },
    })
    await expect(ctx.teamActivations.activate({
      teamId: owner.teamId, participantId: owner.coordinator.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: owner.teamId })).team.cursor,
      provider: 'admission-runtime', sessionId: owner.lease.binding.sessionId,
      seed: { kind: 'resume' }, agent: { options: {} }, signal: new AbortController().signal,
      authorization: owner.request.authorization,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await ctx.teams.getTeam({ teamId: owner.teamId })).activations).toHaveLength(1)
    owner.humanAuthorization.close()
  })

  it('revokes an uncommitted bind proof when close overtakes its policy', async () => {
    const { ctx } = await setup()
    const owner = await team(ctx)
    let closing: Promise<unknown> | undefined
    ctx.teams.registerPolicy('activate', {
      name: 'close-before-bind-commit',
      async apply(_request, next) {
        closing = ctx.teamActivations.close().catch((error: unknown) => error)
        return await next()
      },
    })
    await expect(ctx.teamActivations.activate({
      teamId: owner.teamId, participantId: owner.coordinator.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: owner.teamId })).team.cursor,
      provider: 'admission-runtime', sessionId: owner.lease.binding.sessionId,
      seed: { kind: 'resume' }, agent: { options: {} }, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect(await closing).toBeInstanceOf(AggregateError)
    expect((await ctx.teams.getTeam({ teamId: owner.teamId })).activations).toHaveLength(1)
    owner.humanAuthorization.close()
  })

  it('quiesces a durably bound epoch when its status subscription fails', async () => {
    const { ctx, provider } = await setup()
    const owner = await team(ctx)
    const original = provider.activate.bind(provider)
    const disposed = vi.fn(async () => undefined)
    vi.spyOn(provider, 'activate').mockImplementationOnce(async (request) => {
      const handle = await original(request)
      let subscriptions = 0
      handle.onStatus = () => {
        if (++subscriptions === 1) return () => {}
        throw new Error('status subscription failed')
      }
      handle.dispose = async () => {
        await disposed()
        handle.health = async () => ({ ...handle.activation, status: 'offline' })
      }
      return handle
    })
    await expect(ctx.teamActivations.activate({
      teamId: owner.teamId, participantId: owner.coordinator.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: owner.teamId })).team.cursor,
      provider: 'admission-runtime', sessionId: owner.lease.binding.sessionId,
      seed: { kind: 'resume' }, agent: { options: {} }, signal: new AbortController().signal,
    })).rejects.toThrow('status subscription failed')
    expect(disposed).toHaveBeenCalledOnce()
    const failed = (await ctx.teams.getTeam({ teamId: owner.teamId })).activations.at(-1)
    expect(failed).toMatchObject({
      activation: { status: 'offline' },
      quiescenceSource: 'quiesced',
    })
    expect(failed?.quiescedAt).toBeTypeOf('number')
    owner.humanAuthorization.close()
  })

  it('retains an admitted stopping proof while controller close awaits it', async () => {
    const { ctx } = await setup()
    const owner = await team(ctx, false)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    ctx.teams.registerPolicy('activate', {
      name: 'hold-stopping-status',
      async apply(_request, next) {
        entered.resolve(undefined)
        await release.promise
        return await next()
      },
    })
    const disposal = owner.lease.dispose()
    void disposal.catch(() => undefined)
    await entered.promise
    const closing = ctx.teamActivations.close()
    void closing.catch(() => undefined)
    release.resolve(undefined)
    try {
      await Promise.all([disposal, closing])
      const settled = (await ctx.teams.getTeam({ teamId: owner.teamId })).activations[0]
      expect(settled?.activation.status).toBe('offline')
      expect(settled?.quiescedAt).toBeTypeOf('number')
    } finally {
      owner.humanAuthorization.close()
    }
  })

  it('retains bound cleanup after subscription and provider disposal both fail', async () => {
    const { ctx, provider } = await setup()
    const owner = await team(ctx)
    const original = provider.activate.bind(provider)
    const disposed = vi.fn().mockRejectedValueOnce(new Error('provider cleanup failed')).mockResolvedValue(undefined)
    vi.spyOn(provider, 'activate').mockImplementationOnce(async (request) => {
      const handle = await original(request)
      let subscriptions = 0
      handle.onStatus = () => {
        if (++subscriptions === 1) return () => {}
        throw new Error('status subscription failed')
      }
      handle.dispose = async () => {
        await disposed()
        handle.health = async () => ({ ...handle.activation, status: 'offline' })
      }
      return handle
    })
    const failure = await ctx.teamActivations.activate({
      teamId: owner.teamId, participantId: owner.coordinator.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: owner.teamId })).team.cursor,
      provider: 'admission-runtime', sessionId: owner.lease.binding.sessionId,
      seed: { kind: 'resume' }, agent: { options: {} }, signal: new AbortController().signal,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors.map((error: Error) => error.message))
      .toEqual(['status subscription failed', 'provider cleanup failed'])
    expect((await ctx.teams.getTeam({ teamId: owner.teamId })).activations.at(-1)?.activation.status).toBe('stopping')
    await ctx.teamActivations.close()
    expect(disposed).toHaveBeenCalledTimes(2)
    const settled = (await ctx.teams.getTeam({ teamId: owner.teamId })).activations.at(-1)
    expect(settled?.activation.status).toBe('offline')
    expect(settled?.quiescedAt).toBeTypeOf('number')
    owner.humanAuthorization.close()
  })

  it('rejects Node timer overflow before starting controller work', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    expect(Controller.Config({ disposalTimeoutMs: 2_147_483_647 }).disposalTimeoutMs).toBe(2_147_483_647)
    expect(() => Controller.Config({ disposalTimeoutMs: 2_147_483_648 })).toThrow()
    expect(() => new Controller.TeamActivationController(ctx, { disposalTimeoutMs: 2_147_483_648 }))
      .toThrow('disposalTimeoutMs must not exceed 2147483647ms')
    expect(ctx.get('teamActivations')).toBeUndefined()
  })
})
