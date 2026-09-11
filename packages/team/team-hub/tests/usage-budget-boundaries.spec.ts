import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import AgentRuntime from '../../../core/agent-runtime/src/index.ts'
import { teamUsageSampleInputSchema } from '@clocky/clocky-team'
import type { JsonObject, TeamActorProof, TeamId, TeamUsageSampleInput } from '@clocky/clocky-team'
import * as ActivationController from '../../team-activation-controller/src/index.ts'
import { TeamClosureDriver, TeamClosureDriveBackendRegistry } from '../../team-closure-driver/src/index.ts'
import TeamClosureDriverHub from '../../team-closure-driver/src/hub.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import TeamHub from '../src/index.ts'
import type { Config as TeamHubConfig } from '../src/index.ts'
import { assignTestTask, createTestCoordinatorTask, postActor, provisionTestCoordinator } from './fixtures.ts'

type Backend = 'json' | 'sqlite'
type BudgetConfig = Pick<TeamHubConfig, 'maxTurnsPerTeam' | 'maxModelTokensPerTeam' | 'maxCostUnitsPerTeam'>
const roots: string[] = []
const contexts = new Set<Context>()
const drivers = new Set<TeamClosureDriver>()

afterEach(async () => {
  for (const driver of drivers) await driver.close()
  drivers.clear()
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function hub(backend: Backend, root: string, config: BudgetConfig = {}) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { recoveryPageSize: 128, ...config })
  return ctx
}

async function dispose(ctx: Context) {
  await ctx.fiber.dispose()
  contexts.delete(ctx)
}

/** Bind usage to real durable participant and activation identities. */
async function seed(backend: Backend, budgets: JsonObject = {}, config: BudgetConfig = {}) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  await mkdir(join(process.cwd(), '.tmp', 'usage-budget-boundaries-evidence'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'usage-budget-boundaries-'))
  roots.push(root)
  const ctx = await hub(backend, root, config)
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Preserve accounted work at frozen budget boundaries.', budgets: {} }, rules: {}, budgets,
  })
  const teamId = created.team.id
  const participant = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: created.team.cursor,
    kind: 'local-agent', displayName: 'Usage reporter', role: 'worker', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
  }
  const actor = await postActor(ctx, teamId, participant.id)
  return { ctx, root, teamId, actor, participantId: participant.id }
}

function sample(id: string, inputTokens: number, outputTokens: number, costUnits: number, turn = 1): TeamUsageSampleInput {
  return teamUsageSampleInputSchema.parse(JSON.parse(JSON.stringify({ id, provider: 'meter', model: 'reported-cost',
    turn, step: 0, usage: { inputTokens, outputTokens }, costUnits })))
}

async function record(ctx: Context, teamId: TeamId, actor: TeamActorProof, value: TeamUsageSampleInput) {
  return await ctx.teams.recordUsage({ actor, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, sample: value })
}

/** Start the actual scanner and Hub bridge after the seed writer has released its proof sources. */
async function startDriver(ctx: Context) {
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(ActivationController)
  await ctx.plugin(TeamClosureDriveBackendRegistry)
  await ctx.plugin(TeamClosureDriverHub, { backend: 'hub' })
  const driver = new TeamClosureDriver(ctx, ctx.teamClosureDrives, {
    backend: 'hub', maxTeamsPerDrive: 8, pageSize: 8, disposalTimeoutMs: 5000,
  })
  drivers.add(driver)
  await driver.start()
  return driver
}

describe('frozen usage budget boundaries', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`keeps exact legacy ceilings active and retains over-budget and later settled usage on ${backend}`, async () => {
      const cases = [
        { name: 'turns', config: { maxTurnsPerTeam: 1 }, first: sample('first', 0, 0, 0),
          next: sample('over', 0, 0, 0, 2), code: 'TEAM_TURN_BUDGET_EXCEEDED' },
        { name: 'output', config: { maxModelTokensPerTeam: 2 }, first: sample('first', 0, 2, 0),
          next: sample('over', 0, 1, 0), code: 'TEAM_TOKEN_BUDGET_EXCEEDED' },
        { name: 'cost', config: { maxCostUnitsPerTeam: 2 }, first: sample('first', 0, 0, 2),
          next: sample('over', 0, 0, 0.5), code: 'TEAM_COST_BUDGET_EXCEEDED' },
      ]
      for (const row of cases) {
        const fixture = await seed(backend, {}, row.config)
        await record(fixture.ctx, fixture.teamId, fixture.actor, row.first)
        expect((await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.phase).toBe('active')
        const exceeded = await record(fixture.ctx, fixture.teamId, fixture.actor, row.next)
        const stalled = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
        expect(stalled).toMatchObject({ usage: exceeded, team: { phase: 'stalled', stallReason: { code: row.code } } })
        const settled = sample('settled', 1, 1, 0.25, 3)
        const retained = await record(fixture.ctx, fixture.teamId, fixture.actor, settled)
        expect(retained).toMatchObject({ inputTokens: exceeded.inputTokens + 1, outputTokens: exceeded.outputTokens + 1,
          costUnits: exceeded.costUnits + 0.25 })
        const audit = await fixture.ctx.teams.readAudit({ teamId: fixture.teamId, afterCursor: -1, limit: 128 })
        expect(audit.items.filter(entry => entry.type === 'usage/changed')).toHaveLength(3)
        expect(audit.items.filter(entry => entry.type === 'team/phase' && entry.facts.phase === 'stalled')).toHaveLength(1)
        const after = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
        expect(after.team.stallReason).toEqual(stalled.team.stallReason)
        await dispose(fixture.ctx)
        const recovered = await hub(backend, fixture.root, { maxTurnsPerTeam: 100, maxModelTokensPerTeam: 100, maxCostUnitsPerTeam: 100 })
        expect(await recovered.teams.getTeam({ teamId: fixture.teamId })).toEqual(after)
        expect(await recovered.teams.readAudit({ teamId: fixture.teamId, afterCursor: -1, limit: 128 })).toEqual(audit)
      }
    })

    it(`retains observations at and above typed token, turn and fractional-cost ceilings on ${backend}`, async () => {
      const cases = [
        { key: 'maxInputTokens', limit: 2, first: sample('first', 2, 0, 0), next: sample('over', 1, 0, 0) },
        { key: 'maxOutputTokens', limit: 2, first: sample('first', 0, 2, 0), next: sample('over', 0, 1, 0) },
        { key: 'maxTotalTokens', limit: 2, first: sample('first', 1, 1, 0), next: sample('over', 1, 0, 0) },
        { key: 'maxTurns', limit: 1, first: sample('first', 0, 0, 0), next: sample('over', 0, 0, 0, 2) },
        { key: 'maxCostUnits', limit: 0.5, first: sample('first', 0, 0, 0.5), next: sample('over', 0, 0, 0.25) },
      ]
      for (const row of cases) {
        const fixture = await seed(backend, { [row.key]: row.limit })
        await record(fixture.ctx, fixture.teamId, fixture.actor, row.first)
        expect((await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.phase).toBe('active')
        const usage = await record(fixture.ctx, fixture.teamId, fixture.actor, row.next)
        const state = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
        expect(state).toMatchObject({ usage, team: { phase: 'stalled', stallReason: {
          message: `Team '${fixture.teamId}' exceeded its ${row.key} budget of ${row.limit}`,
        } } })
        const audit = await fixture.ctx.teams.readAudit({ teamId: fixture.teamId, afterCursor: -1, limit: 128 })
        expect(audit.items.slice(-2).map(entry => entry.type)).toEqual(['usage/changed', 'team/phase'])
        expect(audit.items.filter(entry => entry.type === 'usage/changed')).toHaveLength(2)
        await dispose(fixture.ctx)
        const recovered = await hub(backend, fixture.root)
        expect(await recovered.teams.getTeam({ teamId: fixture.teamId })).toEqual(state)
      }
    })

    it(`scans real under-budget and exactly exhausted usage after restart on ${backend}`, async () => {
      for (const key of ['maxInputTokens', 'maxOutputTokens', 'maxTotalTokens', 'maxTurns', 'maxCostUnits']) {
        const fixture = await seed(backend, { [key]: 2 })
        const unit = key === 'maxInputTokens' || key === 'maxTotalTokens' ? sample('first', 1, 0, 0)
          : key === 'maxOutputTokens' ? sample('first', 0, 1, 0)
            : key === 'maxCostUnits' ? sample('first', 0, 0, 1) : sample('first', 0, 0, 0)
        await record(fixture.ctx, fixture.teamId, fixture.actor, unit)
        await dispose(fixture.ctx)
        const ctx = await hub(backend, fixture.root)
        const driver = await startDriver(ctx)
        const before = await ctx.teams.getTeam({ teamId: fixture.teamId })
        expect(before.team.phase).toBe('active')
        const binding = before.activations[0]
        if (binding === undefined) throw new Error('Recovery requires a retained usage activation')
        const actor = ctx.teams.openActivationActorProofIssuer().issue(binding)
        const second = teamUsageSampleInputSchema.parse({ ...unit, id: 'second', turn: 2 })
        const usage = await record(ctx, fixture.teamId, actor.proof, second)
        expect((await ctx.teams.getTeam({ teamId: fixture.teamId })).team.phase).toBe('active')
        await driver.drive()
        expect(await ctx.teams.getTeam({ teamId: fixture.teamId })).toMatchObject({ usage, team: { phase: 'stalled', stallReason: {
          message: `Team '${fixture.teamId}' reached its ${key} budget of 2`,
        } } })
        actor.revoke()
        await driver.close()
        drivers.delete(driver)
      }
    })

    it(`accepts the real driver's stricter frozen output ceiling on ${backend}`, async () => {
      const fixture = await seed(backend, { maxOutputTokens: 20 }, { maxModelTokensPerTeam: 1 })
      await record(fixture.ctx, fixture.teamId, fixture.actor, sample('exact-legacy', 0, 1, 0))
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      await writeFile(join(process.cwd(), '.tmp', 'usage-budget-boundaries-evidence', `stricter-${backend}-input.json`),
        `${JSON.stringify(before, null, 2)}\n`)
      await dispose(fixture.ctx)
      const ctx = await hub(backend, fixture.root)
      await startDriver(ctx)
      expect(await ctx.teams.getTeam({ teamId: fixture.teamId })).toMatchObject({ usage: before.usage, team: { phase: 'stalled', stallReason: {
        code: 'TEAM_TOKEN_BUDGET_EXCEEDED', message: `Team '${fixture.teamId}' reached its maxOutputTokens budget of 1`,
      } } })
    })

    it(`retains usage above the stricter frozen output ceiling before recording its stall on ${backend}`, async () => {
      const fixture = await seed(backend, { maxOutputTokens: 20 }, { maxModelTokensPerTeam: 1 })
      const usage = await record(fixture.ctx, fixture.teamId, fixture.actor, sample('over-legacy', 0, 2, 0))
      expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toMatchObject({ usage, team: {
        phase: 'stalled', stallReason: { code: 'TEAM_TOKEN_BUDGET_EXCEEDED' },
      } })
      const audit = await fixture.ctx.teams.readAudit({ teamId: fixture.teamId, afterCursor: -1, limit: 128 })
      expect(audit.items.slice(-2).map(entry => entry.type)).toEqual(['usage/changed', 'team/phase'])
    })

    it(`leaves a legally assigned final retry active during a real startup budget scan on ${backend}`, async () => {
      const fixture = await seed(backend, { maxRetries: 1 })
      await provisionTestCoordinator(fixture.ctx, fixture.teamId)
      const task = await createTestCoordinatorTask(fixture.ctx, { teamId: fixture.teamId,
        expectedCursor: (await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.cursor,
        subject: 'Finish the admitted retry', description: 'An accepted attempt retains its permission to finish.',
        blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
        budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 2 })
      const binding = (await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).activations
        .find(candidate => candidate.activation.participantId === fixture.participantId)
      if (binding === undefined) throw new Error('Retry fixture requires its real worker binding')
      const selection = { teamId: fixture.teamId, taskId: task.id, participantId: fixture.participantId,
        activationId: binding.activation.id, leaseDurationMs: 60000 }
      const first = await assignTestTask(fixture.ctx, { ...selection, expectedRevision: task.revision })
      if (first.lease === undefined) throw new Error('The initial assignment did not retain a lease')
      const released = await fixture.ctx.teams.settleTaskAttempt({ actor: fixture.actor, taskId: task.id,
        attemptId: first.lease.attemptId, expectedRevision: first.revision, outcome: { kind: 'released' } })
      const retry = await assignTestTask(fixture.ctx, { ...selection, expectedRevision: released.revision })
      expect(retry).toMatchObject({ phase: 'assigned', attemptCount: 2 })
      await writeFile(join(process.cwd(), '.tmp', 'usage-budget-boundaries-evidence', `retry-${backend}-input.json`),
        `${JSON.stringify(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId }), null, 2)}\n`)
      await dispose(fixture.ctx)
      const ctx = await hub(backend, fixture.root)
      await startDriver(ctx)
      const state = await ctx.teams.getTeam({ teamId: fixture.teamId })
      expect(state.team.phase).toBe('active')
      expect(state.tasks).toEqual([retry])
    })

    it.each(['maxInputTokens', 'maxOutputTokens', 'maxTotalTokens', 'maxTurns', 'maxCostUnits'])(
      `honors the schema-valid zero %s ceiling through the real driver on ${backend}`, async (key) => {
        const fixture = await seed(backend, { [key]: 0 })
        if (key !== 'maxTurns') await record(fixture.ctx, fixture.teamId, fixture.actor, sample('zero', 0, 0, 0))
        const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
        expect(before.team.phase).toBe('active')
        await dispose(fixture.ctx)
        const ctx = await hub(backend, fixture.root)
        await startDriver(ctx)
        expect(await ctx.teams.getTeam({ teamId: fixture.teamId })).toMatchObject({ usage: before.usage, team: {
          phase: 'stalled', stallReason: { message: `Team '${fixture.teamId}' reached its ${key} budget of 0` },
        } })
      },
    )

    it(`stalls at a real fractional typed cost ceiling through the startup driver on ${backend}`, async () => {
      const fixture = await seed(backend, { maxCostUnits: 0.5 })
      await record(fixture.ctx, fixture.teamId, fixture.actor, sample('exact-fraction', 0, 0, 0.5))
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      await writeFile(join(process.cwd(), '.tmp', 'usage-budget-boundaries-evidence', `fraction-${backend}-input.json`),
        `${JSON.stringify(before, null, 2)}\n`)
      await dispose(fixture.ctx)
      const ctx = await hub(backend, fixture.root)
      await startDriver(ctx)
      expect(await ctx.teams.getTeam({ teamId: fixture.teamId })).toMatchObject({ usage: before.usage, team: { phase: 'stalled', stallReason: {
        code: 'TEAM_COST_BUDGET_EXCEEDED', message: `Team '${fixture.teamId}' reached its maxCostUnits budget of 0.5`,
      } } })
    })
  }
})
