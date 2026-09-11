import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import {
  teamTaskCreateIdempotencyKeySchema, teamTaskCreateInputSchema, teamWorkflowPlanIdempotencyKeySchema,
  teamWorkflowPlanSchema, teamWorkflowTaskTemplateSchema,
} from '@clocky/clocky-team'
import type {
  ParticipantId, TeamSystemWorkflowProof, TeamSystemWorkflowScope, TeamTaskCreateInput,
  TeamTaskSnapshot, TeamWorkflowPlanSnapshot, TeamWorkflowTaskTemplate,
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

/** Publish real coordinator/worker/reviewer records before authorizing plan and task JSON. */
async function setup(backend: Backend) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'workflow-template-admission-'))
  roots.push(root)
  const ctx = await hub(backend, root)
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Compile only tasks represented by their admitted workflow templates.', budgets: {} }, rules: {}, budgets: {},
  })
  const teamId = created.team.id
  const members = new Map<string, ParticipantId>()
  for (const role of ['coordinator', 'worker', 'reviewer']) {
    const member = await inviteBootstrapParticipant(ctx, {
      teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: 'local-agent', displayName: role, role, capabilities: [],
    })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId, participantId: member.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    members.set(role, member.id)
  }
  const coordinator = members.get('coordinator')
  const reviewer = members.get('reviewer')
  if (coordinator === undefined || reviewer === undefined) throw new Error('Workflow fixture omitted its author or reviewer')
  const author = await postActor(ctx, teamId, coordinator)
  let commands = 0
  return { ctx, root, teamId, coordinator, reviewer, author,
    nextKey: () => teamTaskCreateIdempotencyKeySchema.parse(`template-command-${commands++}`) }
}

function template(id: string, overrides: Partial<TeamWorkflowTaskTemplate> = {}): TeamWorkflowTaskTemplate {
  return teamWorkflowTaskTemplateSchema.parse({ id, subject: `Task ${id}`, description: `Perform ${id}.`, blockedBy: [],
    requiredCapabilities: [], priority: 1, readScopes: ['packages/team'], writeScopes: ['.tmp/results'],
    workspaceMode: 'shared', budget: { maxOutputTokens: 2 }, reviewPolicy: { kind: 'none' }, maxAttempts: 2, ...overrides })
}

async function admit(fixture: Awaited<ReturnType<typeof setup>>, tasks: readonly TeamWorkflowTaskTemplate[], name: string) {
  const plan = teamWorkflowPlanSchema.parse(JSON.parse(JSON.stringify({ version: 1, name, tasks,
    bounds: { maxTasks: tasks.length, maxParallelism: 1, maxTotalAttempts: tasks.length * 2 },
    channel: { participantRoles: ['coordinator', 'worker', 'reviewer'],
      graph: { initial: { kind: 'participant', role: 'coordinator' },
        transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
    result: { kind: 'task-results', taskTemplateIds: tasks.map(task => task.id) },
  })))
  return await fixture.ctx.teams.admitWorkflowPlan({ actor: fixture.author, teamId: fixture.teamId,
    expectedCursor: (await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.cursor,
    idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse(name), plan })
}

/** Resolve valid task JSON; absent dependency bindings remain empty for the public executor to reject. */
async function create(
  fixture: Awaited<ReturnType<typeof setup>>, plan: TeamWorkflowPlanSnapshot | undefined,
  source: TeamWorkflowTaskTemplate, overrides: Partial<TeamTaskCreateInput> = {},
) {
  const { id, blockedBy, reviewPolicy, ...fields } = source
  const dependencies = blockedBy.flatMap((dependency) => {
    const binding = plan?.taskBindings.find(candidate => candidate.templateId === dependency)
    return binding === undefined ? [] : [binding.taskId]
  })
  const input = teamTaskCreateInputSchema.parse(JSON.parse(JSON.stringify({ ...fields,
    teamId: fixture.teamId, expectedCursor: (await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.cursor,
    createCommand: { idempotencyKey: fixture.nextKey() }, blockedBy: dependencies,
    reviewPolicy: reviewPolicy.kind === 'none' ? { kind: 'none' } : { kind: 'participant', reviewerId: fixture.reviewer },
    ...plan === undefined ? {} : { workflowPlanId: plan.id, workflowTemplateId: id }, ...overrides,
  })))
  return await fixture.ctx.teams.createTask({ actor: fixture.author, ...input })
}

/** Let the registered compiler source authorize one exact durable dependency binding. */
async function bind(
  fixture: Awaited<ReturnType<typeof setup>>, plan: TeamWorkflowPlanSnapshot, source: TeamWorkflowTaskTemplate, task: TeamTaskSnapshot,
) {
  if (plan.actor === undefined) throw new Error('Workflow binding requires its durable coordinator author')
  const expectedCursor = (await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).team.cursor
  const scope: TeamSystemWorkflowScope = { kind: 'team-run-workflow-task-bind', teamId: fixture.teamId,
    coordinator: plan.actor, planId: plan.id, expectedCursor, expectedRevision: plan.revision, templateId: source.id, taskId: task.id }
  const token: object = {}
  Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Compiler proof is runtime-only') } })
  const actor = Object.freeze(token) as TeamSystemWorkflowProof
  const unregister = fixture.ctx.teams.registerSystemWorkflowProofSource({ name: 'team-run',
    resolveWorkflowProof: candidate => candidate === actor ? scope : undefined })
  try {
    return await fixture.ctx.teams.bindWorkflowPlanTask({ actor, teamId: fixture.teamId, planId: plan.id,
      expectedCursor, expectedRevision: plan.revision, templateId: source.id, taskId: task.id })
  } finally { unregister() }
}

describe('workflow template admission through public task JSON', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`rejects task fields that diverge from the admitted template before mutation policy on ${backend}`, async () => {
      const fixture = await setup(backend)
      const source = template('first')
      const unrelated = await create(fixture, undefined, template('unrelated'))
      const plan = await admit(fixture, [source], 'matching-template')
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      const policy = vi.fn()
      fixture.ctx.teams.registerPolicy('task-mutate', { name: 'observe-template-admission', async apply(request, next) {
        policy(request)
        return await next()
      } })
      const mismatches: Partial<TeamTaskCreateInput>[] = [
        { blockedBy: [unrelated.id] }, { subject: 'Another subject' }, { description: 'Another description.' },
        { requiredCapabilities: ['another-capability'] }, { priority: 2 }, { readScopes: ['another-read-root'] },
        { writeScopes: ['another-write-root'] }, { workspaceMode: 'worktree' }, { budget: { maxOutputTokens: 3 } }, { maxAttempts: 3 },
      ]
      for (const mismatch of mismatches) {
        await expect(create(fixture, plan, source, mismatch)).rejects.toMatchObject({ code: 'TEAM_WORKFLOW_PLAN_INVALID' })
        expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(before)
      }
      expect(policy).not.toHaveBeenCalled()
      const accepted = await create(fixture, plan, source)
      expect(accepted).toMatchObject({ workflowPlanId: plan.id, workflowTemplateId: source.id,
        subject: source.subject, description: source.description, blockedBy: [], requiredCapabilities: [],
        priority: source.priority, readScopes: source.readScopes, writeScopes: source.writeScopes,
        workspaceMode: source.workspaceMode, budget: source.budget, maxAttempts: source.maxAttempts })
      expect(policy).toHaveBeenCalledTimes(1)
    })

    it(`requires the template's explicit review route and current reviewer role on ${backend}`, async () => {
      const fixture = await setup(backend)
      const none = template('unreviewed')
      const unreviewed = await admit(fixture, [none], 'unreviewed-plan')
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      await expect(create(fixture, unreviewed, none, { reviewPolicy: { kind: 'participant', reviewerId: fixture.reviewer } }))
        .rejects.toThrow('unexpected review route')
      expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(before)
      const reviewed = template('reviewed', { reviewPolicy: { kind: 'participant', reviewerRole: 'reviewer' } })
      const plan = await admit(fixture, [reviewed], 'reviewed-plan')
      const beforeReviewed = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      for (const reviewPolicy of [{ kind: 'none' } as const, { kind: 'participant', reviewerId: fixture.coordinator } as const]) {
        await expect(create(fixture, plan, reviewed, { reviewPolicy })).rejects.toThrow('invalid reviewer role')
        expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(beforeReviewed)
      }
      const task = await create(fixture, plan, reviewed)
      expect(task.reviewPolicy).toEqual({ kind: 'participant', reviewerId: fixture.reviewer })
    })

    it(`requires a durable dependency binding before accepting the dependent task and preserves compilation on restart on ${backend}`, async () => {
      const fixture = await setup(backend)
      const first = template('first')
      const second = template('second', { blockedBy: [first.id] })
      let plan = await admit(fixture, [first, second], 'dependency-plan')
      const task = await create(fixture, plan, first)
      const before = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      await expect(create(fixture, plan, second)).rejects.toThrow('unbound dependency')
      expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(before)
      plan = await bind(fixture, plan, first, task)
      const afterBinding = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      await expect(create(fixture, plan, second, { blockedBy: [] })).rejects.toMatchObject({ code: 'TEAM_WORKFLOW_PLAN_INVALID' })
      expect(await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })).toEqual(afterBinding)
      const dependent = await create(fixture, plan, second)
      expect(dependent.blockedBy).toEqual([task.id])
      const compiled = await fixture.ctx.teams.getTeam({ teamId: fixture.teamId })
      await fixture.ctx.fiber.dispose()
      contexts.delete(fixture.ctx)
      const recovered = await hub(backend, fixture.root)
      expect(await recovered.teams.getTeam({ teamId: fixture.teamId })).toEqual(compiled)
      expect(compiled.workflowPlans).toEqual([plan])
      expect(compiled.tasks).toEqual([task, dependent])
    })
  }
})
