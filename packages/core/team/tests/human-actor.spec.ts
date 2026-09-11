import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import {
  TeamError,
  TeamRuntime,
  fingerprintTeamHumanActorPayload,
  teamHumanActorProofInputSchema,
  teamHumanActorScopeSchema,
} from '../src/index.ts'
import type {
  TeamHumanActorProof,
  TeamHumanActorProofResolution,
  TeamHumanActorProofSource,
  TeamHumanActorScope,
} from '../src/index.ts'

/** Concrete test-only runtime whose inherited source registry is the behavior under test. */
abstract class TestRuntime extends (TeamRuntime as unknown as new (ctx: Context) => TeamRuntime) {
  resolveHumanActorProof(proof: TeamHumanActorProof): TeamHumanActorProofResolution {
    return this.requireHumanActorProof(proof)
  }
}

const TestRuntimePlugin = TestRuntime as unknown as new (ctx: Context) => TestRuntime

/** Create one opaque proof that a source can retain privately. */
function proof(): TeamHumanActorProof {
  const value: object = {}
  Object.defineProperty(value, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('runtime-only') },
  })
  return Object.freeze(value) as TeamHumanActorProof
}

/** Mount one test runtime and return its owning Context/fiber pair. */
async function setup(): Promise<{ readonly ctx: Context; readonly runtime: TestRuntime; readonly fiber: { dispose(): Promise<void> } }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(TestRuntimePlugin)
  return { ctx, runtime: ctx.teams as TestRuntime, fiber }
}

describe('TeamRuntime authenticated human proof sources', () => {
  it('resolves a live human proof source only while its contribution and proof remain live', async () => {
    const { ctx, runtime, fiber } = await setup()
    const token = proof()
    const scope = teamHumanActorScopeSchema.parse({
      teamId: 'team-1',
      participantId: 'human-1',
      operation: 'goal-mutate',
      payloadFingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      fence: { kind: 'revision', revision: 4 },
    })
    const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>([[token, scope]])
    const source: TeamHumanActorProofSource = {
      name: 'team-human-actor',
      resolveHumanActorProof(candidate) { return proofs.get(candidate) },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerHumanActorProofSource(source)
    }, { inject: ['teams'] }))

    const resolution = runtime.resolveHumanActorProof(token)
    expect(resolution).toEqual({ sourceName: 'team-human-actor', scope })
    expect(Object.isFrozen(resolution)).toBe(true)
    expect(Object.isFrozen(resolution.scope)).toBe(true)
    expect(() => JSON.stringify(token)).toThrow(/runtime-only/u)
    expect(() => structuredClone(token)).toThrow()
    expect(() => runtime.resolveHumanActorProof({} as TeamHumanActorProof))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.registerHumanActorProofSource({ ...source }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_HUMAN_ACTOR_PROOF_SOURCE_DUPLICATE' }))
    expect(() => runtime.registerHumanActorProofSource({ ...source, name: ' team-human-actor' }))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_HUMAN_ACTOR_PROOF_SOURCE_INVALID' }))

    const mutable = scope as unknown as { fence: { revision: number } }
    mutable.fence.revision = 9
    expect(resolution.scope.fence).toEqual({ kind: 'revision', revision: 4 })

    await contribution.dispose()
    expect(() => runtime.resolveHumanActorProof(token))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a malformed scope or a throwing source as an invalid proof', async () => {
    const { ctx, runtime, fiber } = await setup()
    const invalid = proof()
    const throwing = proof()
    const malformedSource: TeamHumanActorProofSource = {
      name: 'malformed-human-source',
      resolveHumanActorProof(candidate) {
        if (candidate === throwing) throw new Error('source failure')
        return candidate === invalid
          ? {
            teamId: 'team-1' as never,
            participantId: 'human-1' as never,
            operation: 'goal-mutate',
            payloadFingerprint: 'not-a-digest' as never,
            fence: { kind: 'cursor', cursor: 0 },
          }
          : undefined
      },
    }
    const contribution = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.teams.registerHumanActorProofSource(malformedSource)
    }, { inject: ['teams'] }))
    expect(() => runtime.resolveHumanActorProof(invalid))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    expect(() => runtime.resolveHumanActorProof(throwing))
      .toThrow(expect.objectContaining<Partial<TeamError>>({ code: 'TEAM_ACTOR_PROOF_INVALID' }))
    await contribution.dispose()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('fingerprints exactly the Team operation, fence, and canonical JSON payload', () => {
    const first = teamHumanActorProofInputSchema.parse({
      teamId: 'team-1',
      operation: 'goal-mutate',
      fence: { kind: 'cursor', cursor: 5 },
      payload: { b: [2, { z: true, a: null }], a: 'first' },
    })
    const reordered = teamHumanActorProofInputSchema.parse({
      teamId: 'team-1',
      operation: 'goal-mutate',
      fence: { kind: 'cursor', cursor: 5 },
      payload: { a: 'first', b: [2, { a: null, z: true }] },
    })
    expect(fingerprintTeamHumanActorPayload(first)).toBe(fingerprintTeamHumanActorPayload(reordered))
    expect(fingerprintTeamHumanActorPayload(first)).not.toBe(fingerprintTeamHumanActorPayload({
      ...first,
      operation: 'close',
    }))
    expect(teamHumanActorProofInputSchema.safeParse({
      ...first,
      fence: { kind: 'revision', revision: 0 },
    }).success).toBe(false)
  })
})
