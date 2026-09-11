import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import ProductPrincipalRegistry, { productPrincipalId } from '@clocky/clocky-product-principal'
import type { AuthenticatedProductCall, ProductPrincipal } from '@clocky/clocky-product-principal'
import {
  TeamError,
  TeamRuntime,
  fingerprintTeamHumanActorPayload,
} from '../../../core/team/src/index.ts'
import type {
  ParticipantSnapshot,
  TeamHumanActorProof,
  TeamHumanActorProofResolution,
  TeamStateSnapshot,
  TeamPolicyHook,
} from '../../../core/team/src/index.ts'

vi.mock('@clocky/clocky-team', async () => await import('../../../core/team/src/index.ts'))

import * as HumanActor from '../src/index.ts'

/** Test-only Team runtime with a caller-controlled detached participant projection. */
abstract class TestRuntime extends (TeamRuntime as unknown as new (ctx: Context) => TeamRuntime) {
  state: TeamStateSnapshot = { participants: [] } as unknown as TeamStateSnapshot

  getTeam(): Promise<TeamStateSnapshot> {
    return Promise.resolve(this.state)
  }

  resolveHumanActorProof(proof: TeamHumanActorProof): TeamHumanActorProofResolution {
    return this.requireHumanActorProof(proof)
  }
}

const TestRuntimePlugin = TestRuntime as unknown as new (ctx: Context) => TestRuntime

/** Create one authenticated-call value equivalent to a live product-principal lease callback. */
function call(controller = new AbortController(), id = 'principal-1'): { readonly call: AuthenticatedProductCall; readonly controller: AbortController } {
  const principal: ProductPrincipal = Object.freeze({
    id: productPrincipalId(id),
    issuer: 'local',
    subject: id,
    assurance: 'local-session',
    credentialGeneration: 1,
  })
  return {
    controller,
    call: Object.freeze({ principal, credentialGeneration: 1, signal: controller.signal }),
  }
}

/** Create one valid human projection with a selectable active phase and immutable grant. */
function human(
  id: string,
  owner = 'principal-1',
  options: { readonly phase?: ParticipantSnapshot['phase']; readonly operations?: readonly TeamPolicyHook[]; readonly grant?: boolean } = {},
): ParticipantSnapshot {
  return {
    id: id as ParticipantSnapshot['id'],
    teamId: 'team-1' as ParticipantSnapshot['teamId'],
    kind: 'human',
    displayName: id,
    role: 'owner',
    capabilities: [],
    phase: options.phase ?? 'active',
    owner: { kind: 'product-principal', principalId: owner as never },
    ...(options.grant === false ? {} : {
      authorityGrant: {
        operations: options.operations ?? ['goal-mutate'],
        workspaceModes: [],
        readScopes: [],
        writeScopes: [],
        budgets: {},
      },
    }),
  }
}

/** Mount the Team provider, product-principal registry, and human binder. */
async function setup(participants: readonly ParticipantSnapshot[]): Promise<{
  readonly ctx: Context
  readonly runtime: TestRuntime
  readonly humanActorFiber: { dispose(): Promise<void> }
  readonly runtimeFiber: { dispose(): Promise<void> }
}> {
  const ctx = new Context()
  const runtimeFiber = await ctx.plugin(TestRuntimePlugin)
  const runtime = ctx.teams as TestRuntime
  runtime.state = { participants } as unknown as TeamStateSnapshot
  await ctx.plugin(ProductPrincipalRegistry)
  const humanActorFiber = await ctx.plugin(HumanActor)
  return { ctx, runtime, humanActorFiber, runtimeFiber }
}

const input = {
  teamId: 'team-1' as never,
  operation: 'goal-mutate' as const,
  fence: { kind: 'revision' as const, revision: 3 },
  payload: { expectedRevision: 3, objective: 'Ship safely.' },
}

describe('TeamHumanActor', () => {
  it('discovers invitations using owner membership without requiring channel creation authority', async () => {
    const { ctx, runtime, humanActorFiber, runtimeFiber } = await setup([human('human-1', 'principal-1', { operations: [] })])
    try {
      const read = { teamId: input.teamId, operation: 'channel-invitation-read' as const,
        fence: { kind: 'read' as const }, payload: { channelId: 'own-channel' } }
      await ctx.teamHumanActors.withProof(call().call, read, async (proof) => {
        expect(runtime.resolveHumanActorProof(proof).scope).toMatchObject({
          participantId: 'human-1', operation: 'channel-invitation-read', fence: { kind: 'read' },
        })
      })
      for (const operation of ['channel-admission-read', 'channel-list-read'] as const) {
        await ctx.teamHumanActors.withProof(call().call, { ...read, operation }, async (proof) => {
          expect(runtime.resolveHumanActorProof(proof).scope).toMatchObject({ participantId: 'human-1', operation, fence: { kind: 'read' } })
        })
      }
      await expect(ctx.teamHumanActors.withProof(call().call, { ...read, operation: 'channel-open' }, async () => 'invalid'))
        .rejects.toMatchObject({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' })
    } finally {
      await humanActorFiber.dispose()
      await runtimeFiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('binds exactly one active principal-owned human to a canonical payload fingerprint and revokes the proof after one operation', async () => {
    const { ctx, runtime, humanActorFiber, runtimeFiber } = await setup([human('human-1')])
    const authenticated = call()
    let captured: TeamHumanActorProof | undefined
    const result = await ctx.teamHumanActors.withProof(authenticated.call, input, async (proof) => {
      captured = proof
      const first = runtime.resolveHumanActorProof(proof)
      const second = runtime.resolveHumanActorProof(proof)
      expect(first).toEqual(second)
      expect(first).toMatchObject({
        sourceName: 'team-human-actor',
        scope: {
          teamId: 'team-1', participantId: 'human-1', operation: 'goal-mutate',
          fence: { kind: 'revision', revision: 3 },
          payloadFingerprint: fingerprintTeamHumanActorPayload(input),
        },
      })
      expect(() => JSON.stringify(proof)).toThrow(/runtime-only/u)
      expect(() => structuredClone(proof)).toThrow()
      return 'accepted'
    })
    expect(result).toBe('accepted')
    expect(() => runtime.resolveHumanActorProof(captured as TeamHumanActorProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await humanActorFiber.dispose()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it.each([
    ['missing', [] as readonly ParticipantSnapshot[], 'TEAM_HUMAN_ACTOR_NOT_FOUND'],
    ['inactive', [human('human-1', 'principal-1', { phase: 'left' })], 'TEAM_HUMAN_ACTOR_NOT_FOUND'],
    ['owned by another principal', [human('human-1', 'principal-2')], 'TEAM_HUMAN_ACTOR_NOT_FOUND'],
    ['ownerless', [{ ...human('human-1'), owner: undefined }], 'TEAM_HUMAN_ACTOR_NOT_FOUND'],
    ['malformed-owner', [human('human-1', ' principal-1')], 'TEAM_HUMAN_ACTOR_NOT_FOUND'],
    ['system-owned', [{ ...human('human-1'), owner: { kind: 'system' } }], 'TEAM_HUMAN_ACTOR_NOT_FOUND'],
    ['ambiguous', [human('human-1'), human('human-2')], 'TEAM_HUMAN_ACTOR_AMBIGUOUS'],
    ['grant-denied', [human('human-1', 'principal-1', { operations: ['close'] })], 'TEAM_HUMAN_ACTOR_FORBIDDEN'],
    ['grant-missing', [human('human-1', 'principal-1', { grant: false })], 'TEAM_HUMAN_ACTOR_FORBIDDEN'],
  ] as const)('fails closed when the principal-to-human mapping is %s', async (_case, participants, code) => {
    const { ctx, humanActorFiber, runtimeFiber } = await setup(participants)
    await expect(ctx.teamHumanActors.withProof(call().call, input, async () => 'unreachable'))
      .rejects.toMatchObject({ code })
    await humanActorFiber.dispose()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('revokes an in-flight proof when the authenticated call is revoked or the binder unloads', async () => {
    const { ctx, runtime, humanActorFiber, runtimeFiber } = await setup([human('human-1')])
    const authenticated = call()
    let captured: TeamHumanActorProof | undefined
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const pending = ctx.teamHumanActors.withProof(authenticated.call, input, async (proof) => {
      captured = proof
      entered?.()
      await gate
      return 'settled'
    })
    await started
    expect(runtime.resolveHumanActorProof(captured as TeamHumanActorProof)).toBeDefined()
    authenticated.controller.abort()
    expect(() => runtime.resolveHumanActorProof(captured as TeamHumanActorProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    release?.()
    await expect(pending).resolves.toBe('settled')

    let secondProof: TeamHumanActorProof | undefined
    let secondRelease: (() => void) | undefined
    let secondEntered: (() => void) | undefined
    const secondGate = new Promise<void>((resolve) => { secondRelease = resolve })
    const secondStarted = new Promise<void>((resolve) => { secondEntered = resolve })
    const second = ctx.teamHumanActors.withProof(call().call, input, async (proof) => {
      secondProof = proof
      secondEntered?.()
      await secondGate
      return 'settled'
    })
    await secondStarted
    await humanActorFiber.dispose()
    expect(() => runtime.resolveHumanActorProof(secondProof as TeamHumanActorProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    secondRelease?.()
    await expect(second).resolves.toBe('settled')
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects malformed proof inputs and a binder that has already been disposed', async () => {
    const { ctx, humanActorFiber, runtimeFiber } = await setup([human('human-1')])
    const service = ctx.teamHumanActors
    await expect(ctx.teamHumanActors.withProof(call().call, {
      ...input,
      fence: { kind: 'cursor', cursor: -1 },
    } as never, async () => 'unreachable')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await humanActorFiber.dispose()
    await expect(service.withProof(call().call, input, async () => 'unreachable'))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('registers its source through the explicit apply lifecycle', async () => {
    const ctx = new Context()
    const runtimeFiber = await ctx.plugin(TestRuntimePlugin)
    await ctx.plugin(ProductPrincipalRegistry)
    const dispose = HumanActor.apply(ctx)
    expect(ctx.teamHumanActors).toBeInstanceOf(HumanActor.TeamHumanActor)
    dispose()
    await runtimeFiber.dispose()
    await ctx.fiber.dispose()
  })

  it('fails loudly when applied without a Team runtime', async () => {
    const ctx = new Context()
    const principals = await ctx.plugin(ProductPrincipalRegistry)
    expect(() => HumanActor.apply(ctx)).toThrow(expect.objectContaining({ code: 'TEAM_INVALID_ARGUMENT' }))
    await principals.dispose()
    await ctx.fiber.dispose()
  })
})
