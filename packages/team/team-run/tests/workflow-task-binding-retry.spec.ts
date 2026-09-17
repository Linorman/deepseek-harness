import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentDefaultModelConfig from '@clocky/clocky-agent-default-model'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import * as InProcessRuntime from '@clocky/clocky-agent-runtime-in-process'
import { createUserMessage, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import Storage, { type LogStream } from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import TeamChannelAdmission from '@clocky/clocky-team-channel-admission'
import TeamLinks from '@clocky/clocky-team-link'
import * as TeamLinkLocal from '@clocky/clocky-team-link-local'
import * as TeamAgentClient from '@clocky/clocky-team-agent-client'
import { teamTaskSnapshotSchema, teamWorkflowPlanIdempotencyKeySchema, teamWorkflowPlanSchema, teamWorkflowPlanSnapshotSchema } from '@clocky/clocky-team'
import * as TeamActivationController from '@clocky/clocky-team-activation-controller'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import * as WorkflowChannel from '@clocky/clocky-team-channel-workflow'
import * as TeamRun from '../src/index.ts'

const roots: string[] = []
const mounted: { ctx: Context; model: CompilerModel }[] = []

/** Keep the real coordinator request running while its public compiler command is exercised. */
class CompilerModel extends LlmAdapter {
  readonly started = Promise.withResolvers<undefined>()
  readonly release = Promise.withResolvers<undefined>()
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.started.resolve(undefined)
    await this.release.promise
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

afterEach(async () => {
  for (const { ctx, model } of mounted.splice(0)) {
    model.release.resolve(undefined)
    await ctx.fiber.dispose()
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Compose actual local activation and compilation without a task-execution consumer. */
async function setup() {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'workflow-binding-retry-'))
  roots.push(root)
  const ctx = new Context()
  const model = new CompilerModel()
  mounted.push({ ctx, model })
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['mock'], model)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'hub') })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(TeamChannelAdmission, { scanIntervalMs: 100, teamPageSize: 64, maxChannelsPerPass: 128 })
  await ctx.plugin(DirectChannel)
  await ctx.plugin(WorkflowChannel)
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(InProcessRuntime, { providerName: 'in-process' })
  await ctx.plugin(TeamActivationController)
  await ctx.plugin(TeamLinks)
  await ctx.plugin(TeamLinkLocal, { providerName: 'local', pageSize: 32, disposalTimeoutMs: 1000, notificationRetryDelayMs: 1 })
  await ctx.plugin(TeamAgentClient, { reconnectDelayMs: 1, disposalTimeoutMs: 1000 })
  await ctx.plugin(TeamRun)
  const open = ctx.storageLog.open.bind(ctx.storageLog)
  let journal: LogStream | undefined
  vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
    const stream = await open(descriptor)
    if (descriptor.name.startsWith('team/')) journal = stream
    return stream
  })
  const run = await ctx.teamRuns.create({ objective: 'Recover workflow task binding.', cwd: root })
  const coordinator = run.coordinatorLease.localAgent
  if (coordinator === undefined || journal === undefined) throw new Error('Compiler fixture did not publish its coordinator and journal')
  coordinator.followup(createUserMessage({ content: [{ type: 'text', text: 'Compile the requested workflow.' }], source: { kind: 'user' } }))
  await model.started.promise
  const authority = ctx.teamRuns.coordinatorTaskAuthority(coordinator)
  const request = {
    idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('workflow-binding-retry'),
    plan: teamWorkflowPlanSchema.parse({
      version: 1, name: 'single-binding',
      tasks: [{ id: 'research', subject: 'Research', description: 'Produce the workflow result.', blockedBy: [],
        requiredCapabilities: ['team-default-worker'], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
        budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 }],
      bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
      channel: { participantRoles: ['coordinator', 'worker'], viewPolicy: { type: 'recent-window', version: 1 },
        graph: { initial: { kind: 'participant', role: 'coordinator' },
          transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
      result: { kind: 'task-results', taskTemplateIds: ['research'] },
    }),
  }
  const compile = async () => await ctx.agents.withInitiator(coordinator,
    async () => await ctx.teamRuns.startWorkflowPlan(authority, request))
  return { ctx, run, journal, compile }
}

/** Narrow the real JSON record read from storage before selecting its business payload. */
function objectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a durable journal object')
  return value as Record<string, unknown>
}

/** Recognize the real durable binding batch at the storage boundary. */
function isTaskBinding(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || !('type' in value) || value.type !== 'workflow-plan/changed'
    || !('plan' in value)) return false
  const plan = value.plan
  return plan !== null && typeof plan === 'object' && 'phase' in plan && plan.phase === 'compiling'
    && 'taskBindings' in plan && Array.isArray(plan.taskBindings) && plan.taskBindings.length === 1
}

/** Read the real source journal once within this small compiler fixture's bound. */
async function records(journal: LogStream): Promise<readonly unknown[]> {
  const entries = await journal.read(-1, 128)
  expect(await journal.read(entries.at(-1)?.sequence ?? -1, 1)).toEqual([])
  return entries.map(entry => entry.value)
}

describe('workflow task binding retries through TeamRun', () => {
  it('reuses the created task and attached channel after binding policy denies', async () => {
    const harness = await setup()
    const removePolicy = harness.ctx.teams.registerPolicy('task-mutate', {
      name: 'defer-workflow-task-binding',
      async apply(request, next) {
        return request.facts.operation === 'workflow-task-bind'
          ? { kind: 'deny', code: 'BINDING_NOT_READY', message: 'Binding has not been authorized.' }
          : await next()
      },
    })
    await expect(harness.compile()).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    const failed = await harness.ctx.teams.getTeam({ teamId: harness.run.teamId })
    expect(failed.tasks).toHaveLength(1)
    const task = failed.tasks[0]!
    const plan = failed.workflowPlans?.[0]
    expect(plan).toMatchObject({ phase: 'compiling', taskBindings: [] })
    expect(task.workflowPlanId).toBe(plan?.id)
    expect((await records(harness.journal)).filter(isTaskBinding)).toEqual([])
    removePolicy()
    const completed = await harness.compile()
    expect(completed).toMatchObject({ id: plan?.id, phase: 'ready', taskBindings: [{ templateId: 'research', taskId: task.id }] })
    const after = await harness.ctx.teams.getTeam({ teamId: harness.run.teamId })
    expect(after.tasks).toEqual(failed.tasks)
    expect(after.channelIds).toEqual(failed.channelIds)
    expect((await records(harness.journal)).filter(isTaskBinding)).toHaveLength(1)
    await expect(harness.compile()).resolves.toEqual(completed)
    expect(await harness.ctx.teams.getTeam({ teamId: harness.run.teamId })).toEqual(after)
  })

  it('recovers an actually appended binding after its journal reply is lost without duplicating it', async () => {
    const harness = await setup()
    const failure = Object.assign(new Error('binding append reply lost after durable commit'), { code: 'EIO' })
    const append = harness.journal.append.bind(harness.journal)
    let failed = false
    vi.spyOn(harness.journal, 'append').mockImplementation(async (cursor, values, options) => {
      const result = await append(cursor, values, options)
      if (!failed && values.some(isTaskBinding)) { failed = true; throw failure }
      return result
    })
    await expect(harness.compile()).rejects.toBe(failure)
    expect(failed).toBe(true)
    const retained = await records(harness.journal)
    const bindings = retained.filter(isTaskBinding)
    expect(bindings).toHaveLength(1)
    const tasks = retained.map(objectRecord).filter(record => record.type === 'task/changed')
    expect(tasks).toHaveLength(1)
    const task = teamTaskSnapshotSchema.parse(tasks[0]?.task)
    const plan = teamWorkflowPlanSnapshotSchema.parse(objectRecord(bindings[0]).plan)
    expect(plan).toMatchObject({ phase: 'compiling', taskBindings: [{ templateId: 'research', taskId: task.id }] })
    const completed = await harness.compile()
    expect(completed).toMatchObject({ id: plan.id, phase: 'ready', taskBindings: [{ templateId: 'research', taskId: task.id }] })
    const after = await harness.ctx.teams.getTeam({ teamId: harness.run.teamId })
    expect(after.tasks).toEqual([task])
    expect(after.channelIds).toEqual([harness.run.channel.manifest.id, plan.channelId])
    expect((await records(harness.journal)).filter(isTaskBinding)).toHaveLength(1)
    await expect(harness.compile()).resolves.toEqual(completed)
    expect(await harness.ctx.teams.getTeam({ teamId: harness.run.teamId })).toEqual(after)
  })
})
