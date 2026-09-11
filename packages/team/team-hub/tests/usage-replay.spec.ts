import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { teamUsageSampleIdSchema } from '@clocky/clocky-team'
import type { JsonObject, TeamId, TeamUsageRate, TeamUsageSampleInput } from '@clocky/clocky-team'
import { createTestChildTeam, createTestRootTeam } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { provisionTestCoordinator } from './fixtures.ts'
import { delegationFixture } from './delegation-fixtures.ts'
import TeamHub from '../src/index.ts'

const roots: string[] = []
const contexts = new Set<Context>()
const rates = {
  'meter/model': { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 },
  'meter/overflow': { input: Number.MAX_SAFE_INTEGER, output: 0, cacheRead: 0, cacheWrite: 0 },
} satisfies Readonly<Record<string, TeamUsageRate>>

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Compose actual routed storage and the Hub with an explicit creation-time price table. */
async function setup(backend: 'json' | 'sqlite', root?: string, usageRates: Readonly<Record<string, TeamUsageRate>> = rates) {
  if (root === undefined) {
    await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
    root = await mkdtemp(join(process.cwd(), '.tmp', 'usage-replay-'))
    roots.push(root)
  }
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { usageRates, maxTeamDepth: 1 })
  return { ctx, root, async dispose() { await ctx.fiber.dispose(); contexts.delete(ctx) } }
}

/** Issue revocable usage authority from the coordinator's current durable binding. */
async function usageActor(ctx: Context, teamId: TeamId) {
  await provisionTestCoordinator(ctx, teamId)
  const state = await ctx.teams.getTeam({ teamId })
  const binding = state.activations[0]
  if (binding === undefined) throw new Error('usage fixture did not bind its coordinator')
  return ctx.teams.openActivationActorProofIssuer().issue(binding)
}

/** Count authoritative business observations after audit reconciliation. */
async function recordCount(ctx: Context, teamId: TeamId, type: string) {
  const audit = await ctx.teams.readAudit({ teamId, afterCursor: -1, limit: 128 })
  return audit.items.filter(item => item.type === type).length
}

/** Provider-style sample: Agent Client reports tokens and model identity without provider cost. */
function sample(id: string): TeamUsageSampleInput {
  return { id: teamUsageSampleIdSchema.parse(id), provider: 'meter', model: 'model',
    turn: 1, step: 0, usage: { inputTokens: 2, outputTokens: 1 } }
}

describe('priced usage replay', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`replays derived prices while preserving raw policy facts and legitimate updates on ${backend}`, async () => {
      const { ctx } = await setup(backend)
      const team = await createTestRootTeam(ctx, { goal: { objective: 'Replay priced provider usage.', budgets: {} }, rules: {}, budgets: {} })
      const actor = await usageActor(ctx, team.team.id)
      const facts: JsonObject[] = []
      const unregister = ctx.teams.registerPolicy('usage', {
        name: 'observe-priced-usage-input',
        async apply(request, next) { facts.push(structuredClone(request.facts)); return await next() },
      })
      try {
        const input = sample('priced-root')
        const request = { actor: actor.proof,
          expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor, sample: input }
        const accepted = await ctx.teams.recordUsage(request)
        expect(accepted).toMatchObject({ inputTokens: 2, outputTokens: 1, costUnits: 7 })
        expect(facts).toHaveLength(1)
        expect(Object.hasOwn(facts[0]!, 'costUnits')).toBe(false)
        const initial = await ctx.teams.getTeam({ teamId: team.team.id })
        await expect(ctx.teams.recordUsage(request)).resolves.toEqual(accepted)
        await expect(ctx.teams.recordUsage({ ...request, expectedCursor: initial.team.cursor })).resolves.toEqual(accepted)
        expect(await ctx.teams.getTeam({ teamId: team.team.id })).toEqual(initial)
        expect(await recordCount(ctx, team.team.id, 'usage/changed')).toBe(1)
        expect(facts).toHaveLength(1)
        for (const provenance of [{ provider: 'another-meter' }, { model: 'another-model' }]) {
          await expect(ctx.teams.recordUsage({ ...request, expectedCursor: initial.team.cursor, sample: { ...input, ...provenance } }))
            .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
        }
        expect(facts).toHaveLength(1)
        expect(await ctx.teams.getTeam({ teamId: team.team.id })).toEqual(initial)

        const changed = { ...input, usage: { inputTokens: 3, outputTokens: 1 } }
        await expect(ctx.teams.recordUsage({ ...request, expectedCursor: initial.team.cursor, sample: changed }))
          .resolves.toMatchObject({ inputTokens: 3, outputTokens: 1, costUnits: 9 })
        const explicitRequest = { ...request,
          expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor,
          sample: { ...changed, costUnits: 42 } }
        const explicit = await ctx.teams.recordUsage(explicitRequest)
        expect(explicit.costUnits).toBe(42)
        await expect(ctx.teams.recordUsage(explicitRequest)).resolves.toEqual(explicit)
        expect(await recordCount(ctx, team.team.id, 'usage/changed')).toBe(3)
        expect(facts.at(-1)?.costUnits).toBe(42)

        const overflow: TeamUsageSampleInput = { ...sample('priced-overflow'), model: 'overflow', turn: 2,
          usage: { inputTokens: 2, outputTokens: 0 } }
        await ctx.teams.recordUsage({ actor: actor.proof,
          expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor,
          sample: { ...overflow, costUnits: 1 } })
        const beforeOverflow = await ctx.teams.getTeam({ teamId: team.team.id })
        let denied = true
        let overflowPolicies = 0
        const stopOverflow = ctx.teams.registerPolicy('usage', {
          name: 'deny-before-invalid-derived-price',
          async apply(_request, next) {
            overflowPolicies += 1
            if (denied) return { kind: 'deny', code: 'USAGE_NOT_READY', message: 'Usage policy has not permitted this update.' }
            return await next()
          },
        })
        try {
          const omittedCost = { actor: actor.proof, expectedCursor: beforeOverflow.team.cursor, sample: overflow }
          await expect(ctx.teams.recordUsage({ ...omittedCost, expectedCursor: request.expectedCursor }))
            .rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
          expect(overflowPolicies).toBe(0)
          await expect(ctx.teams.recordUsage(omittedCost)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
          denied = false
          await expect(ctx.teams.recordUsage(omittedCost)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
          expect(overflowPolicies).toBe(2)
          expect((await ctx.teams.getTeam({ teamId: team.team.id })).usage).toEqual(beforeOverflow.usage)
          expect(await recordCount(ctx, team.team.id, 'usage/changed')).toBe(4)
        } finally { stopOverflow() }

        const revoke = ctx.teams.registerPolicy('usage', {
          name: 'revoke-updated-usage-owner',
          async apply(_request, next) { actor.revoke(); return await next() },
        })
        try {
          await expect(ctx.teams.recordUsage({ actor: actor.proof,
            expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor,
            sample: { ...input, usage: { inputTokens: 4, outputTokens: 1 } } }))
            .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
          expect(await recordCount(ctx, team.team.id, 'usage/changed')).toBe(4)
        } finally { revoke() }
      } finally { unregister(); actor.revoke() }
    })

    it(`repairs a priced child charge once and reuses frozen pricing after restart on ${backend}`, async () => {
      let harness = await setup(backend)
      const delegation = await delegationFixture(harness.ctx, harness.root)
      const parent = await harness.ctx.teams.getTeam({ teamId: delegation.parentId })
      const child = await createTestChildTeam(harness.ctx, delegation.creation)
      expect(child.team.parentTaskId).toBe(delegation.task.id)
      expect(child.team.id).toBe(delegation.task.delegation?.childTeamId)
      let actor = await usageActor(harness.ctx, child.team.id)
      const input = sample('priced-child')
      const request = { actor: actor.proof,
        expectedCursor: (await harness.ctx.teams.getTeam({ teamId: child.team.id })).team.cursor, sample: input }
      const denyParent = harness.ctx.teams.registerPolicy('usage', {
        name: 'delay-priced-parent-charge',
        async apply(request, next) {
          if (request.facts.chargeId !== undefined) return { kind: 'deny', code: 'PARENT_NOT_READY', message: 'Parent accounting is unavailable.' }
          return await next()
        },
      })
      try {
        await expect(harness.ctx.teams.recordUsage(request)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
        const accepted = (await harness.ctx.teams.getTeam({ teamId: child.team.id })).usage
        denyParent()
        await expect(harness.ctx.teams.recordUsage(request)).resolves.toEqual(accepted)
        const repaired = await harness.ctx.teams.getTeam({ teamId: child.team.id })
        await expect(harness.ctx.teams.recordUsage({ ...request, expectedCursor: repaired.team.cursor })).resolves.toEqual(accepted)
        expect(await recordCount(harness.ctx, child.team.id, 'usage/changed')).toBe(1)
        expect(await recordCount(harness.ctx, child.team.id, 'usage/parent-charge-pending')).toBe(1)
        expect(await recordCount(harness.ctx, parent.team.id, 'usage/child-charged')).toBe(1)
        expect((await harness.ctx.teams.getTeam({ teamId: parent.team.id })).usage)
          .toMatchObject({ inputTokens: 2, outputTokens: 1, costUnits: 7 })

        actor.revoke()
        await harness.dispose()
        harness = await setup(backend, harness.root, { 'meter/model': { input: 20, output: 30, cacheRead: 0, cacheWrite: 0 } })
        actor = await usageActor(harness.ctx, child.team.id)
        await expect(harness.ctx.teams.recordUsage({ ...request, actor: actor.proof })).resolves.toEqual(accepted)
        expect(await recordCount(harness.ctx, child.team.id, 'usage/changed')).toBe(1)
        expect(await recordCount(harness.ctx, parent.team.id, 'usage/child-charged')).toBe(1)
        const current = await harness.ctx.teams.getTeam({ teamId: child.team.id })
        await expect(harness.ctx.teams.recordUsage({ actor: actor.proof, expectedCursor: current.team.cursor,
          sample: { ...input, usage: { inputTokens: 3, outputTokens: 1 } } }))
          .resolves.toMatchObject({ inputTokens: 3, outputTokens: 1, costUnits: 9 })
        expect((await harness.ctx.teams.getTeam({ teamId: parent.team.id })).usage)
          .toMatchObject({ inputTokens: 3, outputTokens: 1, costUnits: 9 })
        expect(await recordCount(harness.ctx, child.team.id, 'usage/changed')).toBe(2)
        expect(await recordCount(harness.ctx, parent.team.id, 'usage/child-charged')).toBe(2)
      } finally { denyParent(); actor.revoke() }
    })
  }
})
