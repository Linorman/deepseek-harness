import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import {
  teamTaskCreateIdempotencyKeySchema, teamTaskCreateInputSchema, teamTaskIdSchema, teamWorkflowPlanIdempotencyKeySchema,
  teamWorkflowPlanSchema, teamWorkflowPlanTaskBindInputSchema, teamWorkflowTaskTemplateIdSchema,
} from '@clocky/clocky-team'
import type {
  ParticipantId, TeamSystemWorkflowProof, TeamSystemWorkflowScope, TeamTaskId,
  TeamWorkflowPlanSnapshot, TeamWorkflowTaskTemplateId,
} from '@clocky/clocky-team'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { postActor } from './fixtures.ts'
import TeamHub from '../src/index.ts'

type Backend = 'json' | 'sqlite'
const roots: string[] = []
const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function hub(backend: Backend, root: string) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub)
  return ctx
}

async function setup(backend: Backend) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'workflow-task-binding-admission-'))
  roots.push(root)
  const ctx = await hub(backend, root)
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Bind only the exact compiled workflow tasks.', budgets: {} }, rules: {}, budgets: {},
  })
  const teamId = created.team.id
  let coordinator: ParticipantId | undefined
  for (const role of ['coordinator', 'worker']) {
    const member = await inviteBootstrapParticipant(ctx, { teamId,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: 'local-agent', displayName: role, role, capabilities: [] })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId, participantId: member.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    if (role === 'coordinator') coordinator = member.id
  }
  if (coordinator === undefined) throw new Error('Compiler fixture requires its coordinator')
  const actor = await postActor(ctx, teamId, coordinator)
  let sequence = 0
  return { ctx, root, teamId, actor, nextKey: () => teamTaskCreateIdempotencyKeySchema.parse(`binding-task-${sequence++}`) }
}

async function admit(fixture: Awaited<ReturnType<typeof setup>>, name: string) {
  const tasks = ['first', 'parallel', 'dependent'].map(id => ({
    id, subject: `Task ${id}`, description: `Perform ${id}.`, blockedBy: id === 'dependent' ? ['first'] : [],
    requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
    budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
  }))
  return await fixture.ctx.teams.admitWorkflowPlan({ actor: fixture.actor, teamId: fixture.teamId,
    expectedCursor: (await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.cursor,
    idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse(name),
    plan: teamWorkflowPlanSchema.parse(JSON.parse(JSON.stringify({ version: 1, name, tasks,
      bounds: { maxTasks: 3, maxParallelism: 2, maxTotalAttempts: 3 },
      channel: { participantRoles: ['coordinator', 'worker'], graph: { initial: { kind: 'participant', role: 'coordinator' },
        transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
      result: { kind: 'task-results', taskTemplateIds: ['first', 'parallel', 'dependent'] },
    }))) })
}

/** Create only exact template tasks; malformed task admission is covered separately. */
async function create(fixture: Awaited<ReturnType<typeof setup>>, plan: TeamWorkflowPlanSnapshot, templateId: string) {
  const source = plan.plan.tasks.find(task => task.id === templateId)
  if (source === undefined) throw new Error('Fixture requested a nonexistent task template')
  const { id, blockedBy, reviewPolicy: _reviewPolicy, ...fields } = source
  const dependencies = blockedBy.map((dependency) => {
    const binding = plan.taskBindings.find(candidate => candidate.templateId === dependency)
    if (binding === undefined) throw new Error('Fixture must bind dependencies before creating their dependent task')
    return binding.taskId
  })
  const input = teamTaskCreateInputSchema.parse(JSON.parse(JSON.stringify({ ...fields, blockedBy: dependencies,
    teamId: fixture.teamId, expectedCursor: (await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.cursor,
    workflowPlanId: plan.id, workflowTemplateId: id, reviewPolicy: { kind: 'none' }, createCommand: { idempotencyKey: fixture.nextKey() },
  })))
  return await fixture.ctx.teams.createTask({ actor: fixture.actor, ...input })
}

/** Retain the current compiler source's exact scope for one public command only. */
async function withCompiler<T>(ctx: Context, scope: TeamSystemWorkflowScope, run: (actor: TeamSystemWorkflowProof) => Promise<T>) {
  const token: object = {}
  Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Compiler proofs are runtime-only') } })
  const actor = Object.freeze(token) as TeamSystemWorkflowProof
  const unregister = ctx.teams.registerSystemWorkflowProofSource({ name: 'team-run',
    resolveWorkflowProof: candidate => candidate === actor ? scope : undefined })
  try { return await run(actor) }
  finally { unregister() }
}

async function bind(
  ctx: Context, plan: TeamWorkflowPlanSnapshot, templateId: TeamWorkflowTaskTemplateId, taskId: TeamTaskId, cursor?: number,
) {
  if (plan.actor === undefined) throw new Error('Binding requires the plan author retained by admission')
  const input = teamWorkflowPlanTaskBindInputSchema.parse(JSON.parse(JSON.stringify({ teamId: plan.teamId, planId: plan.id,
    expectedCursor: cursor ?? (await ctx.teams.getTeam({ teamId: plan.teamId })).team.cursor,
    expectedRevision: plan.revision, templateId, taskId })))
  return await withCompiler(ctx, { kind: 'team-run-workflow-task-bind', coordinator: plan.actor, ...input },
    async actor => await ctx.teams.bindWorkflowPlanTask({ actor, ...input }))
}

const firstId = teamWorkflowTaskTemplateIdSchema.parse('first')
const parallelId = teamWorkflowTaskTemplateIdSchema.parse('parallel')
const dependentId = teamWorkflowTaskTemplateIdSchema.parse('dependent')

describe('workflow task binding admission', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`rejects nonexistent and foreign template/task references before mutation policy on ${backend}`, async () => {
      const f = await setup(backend)
      const plan = await admit(f, 'binding-references')
      const first = await create(f, plan, 'first')
      const parallel = await create(f, plan, 'parallel')
      const foreign = await admit(f, 'another-plan')
      const foreignTask = await create(f, foreign, 'first')
      const before = await f.ctx.teams.getTeam({ teamId: f.teamId })
      const policy = vi.fn()
      f.ctx.teams.registerPolicy('task-mutate', { name: 'observe-rejected-binding', async apply(request, next) {
        policy(request)
        return await next()
      } })
      const cases = [
        { templateId: teamWorkflowTaskTemplateIdSchema.parse('not-in-plan'), taskId: first.id, code: 'TEAM_WORKFLOW_PLAN_INVALID' },
        { templateId: firstId, taskId: teamTaskIdSchema.parse('not-created'), code: 'TEAM_TASK_NOT_FOUND' },
        { templateId: firstId, taskId: foreignTask.id, code: 'TEAM_WORKFLOW_PLAN_INVALID' },
        { templateId: firstId, taskId: parallel.id, code: 'TEAM_WORKFLOW_PLAN_INVALID' },
      ]
      for (const row of cases) {
        await expect(bind(f.ctx, plan, row.templateId, row.taskId)).rejects.toMatchObject({ code: row.code })
        expect(await f.ctx.teams.getTeam({ teamId: f.teamId })).toEqual(before)
      }
      expect(policy).not.toHaveBeenCalled()
    })

    it(`orders independent bindings, refuses retargeting, and preserves duplicate binding across restart on ${backend}`, async () => {
      const f = await setup(backend)
      const admitted = await admit(f, 'ordered-bindings')
      const first = await create(f, admitted, 'first')
      const parallel = await create(f, admitted, 'parallel')
      const observed = (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor
      let plan = await bind(f.ctx, admitted, parallelId, parallel.id)
      await expect(bind(f.ctx, admitted, firstId, first.id)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      plan = await bind(f.ctx, plan, firstId, first.id)
      expect(plan.taskBindings).toEqual([{ templateId: firstId, taskId: first.id }, { templateId: parallelId, taskId: parallel.id }])
      const dependent = await create(f, plan, 'dependent')
      plan = await bind(f.ctx, plan, dependentId, dependent.id)
      expect(plan.taskBindings).toEqual([{ templateId: firstId, taskId: first.id },
        { templateId: parallelId, taskId: parallel.id }, { templateId: dependentId, taskId: dependent.id }])
      const before = await f.ctx.teams.getTeam({ teamId: f.teamId })
      const audit = await f.ctx.teams.readAudit({ teamId: f.teamId, afterCursor: -1, limit: 128 })
      const policy = vi.fn()
      f.ctx.teams.registerPolicy('task-mutate', { name: 'observe-binding-replay', async apply(request, next) {
        policy(request)
        return await next()
      } })
      await expect(bind(f.ctx, plan, firstId, parallel.id)).rejects.toThrow('already bound to another task')
      expect(await bind(f.ctx, plan, firstId, first.id, observed)).toEqual(plan)
      expect(await f.ctx.teams.getTeam({ teamId: f.teamId })).toEqual(before)
      expect(await f.ctx.teams.readAudit({ teamId: f.teamId, afterCursor: -1, limit: 128 })).toEqual(audit)
      expect(policy).not.toHaveBeenCalled()
      await f.ctx.fiber.dispose()
      contexts.delete(f.ctx)
      const recovered = await hub(backend, f.root)
      expect(await bind(recovered, plan, firstId, first.id, observed)).toEqual(plan)
      expect(await recovered.teams.getTeam({ teamId: f.teamId })).toEqual(before)
      expect(await recovered.teams.readAudit({ teamId: f.teamId, afterCursor: -1, limit: 128 })).toEqual(audit)
    })

    it(`rejects new binding after compilation fails while retaining accepted binding replay on ${backend}`, async () => {
      const f = await setup(backend)
      const admitted = await admit(f, 'failed-binding')
      const first = await create(f, admitted, 'first')
      const parallel = await create(f, admitted, 'parallel')
      const bound = await bind(f.ctx, admitted, firstId, first.id)
      if (bound.actor === undefined) throw new Error('Failed plan requires its retained author')
      const input = { teamId: f.teamId, planId: bound.id, expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
        expectedRevision: bound.revision, phase: 'failed' as const, failure: { code: 'COMPILER_STOPPED', message: 'Compilation was stopped.' } }
      const failed = await withCompiler(f.ctx, { kind: 'team-run-workflow-plan-phase', coordinator: bound.actor, ...input },
        async actor => await f.ctx.teams.transitionWorkflowPlan({ actor, ...input }))
      const before = await f.ctx.teams.getTeam({ teamId: f.teamId })
      await expect(bind(f.ctx, failed, parallelId, parallel.id)).rejects.toThrow('is not compiling')
      expect(await bind(f.ctx, failed, firstId, first.id)).toEqual(failed)
      expect(await f.ctx.teams.getTeam({ teamId: f.teamId })).toEqual(before)
    })
  }
})
