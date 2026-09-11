// Boots the shipped Web composition over the built dist this lane already uses
// and asserts what that composition produces: the model-visible tool catalog
// and file-reference guidance plus its retry, sandbox, and approval defaults.
// No browser and no model call — these are composition facts, and the browser
// scenarios in this lane cover the surface itself.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { CallId } from '@clocky/clocky-llm'
import { canonicalPath, writableRoots } from '@clocky/clocky-sandbox'
import { SessionId } from '@clocky/clocky-session'
import { settingsNamespace } from '@clocky/clocky-settings'
import type { ParticipantId, ParticipantSnapshot, TeamId } from '@clocky/clocky-team'
// Empty type imports carry the tools/sandboxPolicy/approval Context merges.
import type {} from '@clocky/clocky-tools'
import type {} from '@clocky/clocky-sandbox-policy'
import type {} from '@clocky/clocky-user-approval'
import type {} from '@clocky/clocky-permission-presets'
import type {} from '@clocky/clocky-agent-presets'
import type {} from '@clocky/clocky-agent-runtime'
import type {} from '@clocky/clocky-commands'
import type {} from '@clocky/clocky-storage-log'
import type {} from '@clocky/clocky-storage'
import type {} from '@clocky/clocky-system-prompt'
import type {} from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-activation-controller'
import type {} from '@clocky/clocky-team-link'
import type {} from '@clocky/clocky-team-run'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const FILE_REFERENCE_PROMPT = fileURLToPath(new URL(
  './snapshots/web-runtime-context/file-reference-prompt.expected.md', import.meta.url,
))

/**
 * The catalog the shipped Web composition puts in front of the model, minus the
 * ripgrep-dependent pair below. The absences are deliberate, not incidental
 * gaps: the `cordis_*` toolset executes model-written JavaScript that no
 * sandbox row confines, `web_fetch` chooses its own request target, and
 * `mcp_*` servers spawn outside `ctx.shell`. The composition Agent Note owns the
 * rationale and its sources.
 */
const EXPECTED_TOOLS = [
  'ask_user_question',
  'bash',
  'edit',
  'exit_plan_mode',
  'job_kill',
  'job_list',
  'job_output',
  'read',
  'read_image',
  'skill',
  'todo_write',
  'web_search',
  'write',
]

/**
 * `glob` and `grep` come from `clocky-tool-fs-search`, which spawns the PACKAGED
 * ripgrep binary (`@vscode/ripgrep`) through the subprocess seam, so the pair
 * is always present on every host — asserted as fixed members, not a host
 * dependency.
 */
const RIPGREP_TOOLS = ['glob', 'grep']

let scaffold: WebScaffold | undefined

/** Narrow private Hub face used only to seed one pre-existing TeamRun worker's durable active fixture state. */
interface TeamHubParticipantFixtureInternals {
  readonly teams: ReadonlyMap<TeamId, {
    readonly queue: { run<T>(operation: () => Promise<T>): Promise<T> }
    readonly projection: {
      readonly team: { readonly updatedAt: number }
      readonly participants: ReadonlyMap<ParticipantId, ParticipantSnapshot>
    }
  }>
  commitTeamCommand(
    loaded: unknown,
    records: readonly {
      readonly type: 'participant/changed'
      readonly participant: ParticipantSnapshot
      readonly createdAt: number
    }[],
    code: 'TEAM_INVALID_ARGUMENT',
  ): Promise<void>
}

/** Seed only the default TeamRun worker's provisioning-to-active durable fixture transition. */
async function seedActiveTeamRunWorker(ctx: WebScaffold['ctx'], teamId: TeamId, workerId: ParticipantId): Promise<void> {
  const hub = ctx.teams as unknown as TeamHubParticipantFixtureInternals
  const loaded = hub.teams.get(teamId)
  if (loaded === undefined) throw new Error(`shipped composition did not retain Team '${teamId}' for worker fixture seeding`)
  await loaded.queue.run(async () => {
    const worker = loaded.projection.participants.get(workerId)
    if (worker?.phase !== 'provisioning') {
      throw new Error(`shipped composition worker '${workerId}' is not provisioned for fixture activation`)
    }
    const createdAt = Math.max(Date.now(), loaded.projection.team.updatedAt + 1)
    await hub.commitTeamCommand(loaded, [{
      type: 'participant/changed',
      participant: { ...worker, phase: 'active' },
      createdAt,
    }], 'TEAM_INVALID_ARGUMENT')
  })
}

afterEach(async () => {
  await scaffold?.close()
  scaffold = undefined
})

it('assembles the shipped Web catalog, file-reference guidance, retry policy, and confined access default', async () => {
  scaffold = await launchWebScaffold()
  const ctx = scaffold.ctx
  // Team control mutations must wait for the product-principal-bound human
  // actor provider; otherwise delete/update calls race startup and fail with
  // the generic "no authenticated Team actor" response.
  expect(ctx.get('teamHumanActors')).toBeDefined()
  expect(ctx.llm.providerRetryPolicy('test-provider')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "maxRetries": 5,
      "mode": "normal",
      "retryableCodes": [
        "EMPTY_RESPONSE",
        "RATE_LIMIT",
        "SERVER",
        "TIMEOUT",
        "TRANSPORT",
      ],
    }
  `)
  await ctx.settings.update(settingsNamespace('llm-pi-ai'), {
    providers: {
      openai: {
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:9/v1',
        models: [{ id: 'test-model', contextWindow: 128_000, maxTokens: 8_192 }],
      },
      anthropic: {
        api: 'anthropic-messages',
        baseURL: 'http://127.0.0.1:9',
        models: [{ id: 'test-model', contextWindow: 128_000, maxTokens: 8_192 }],
        retryPolicy: { mode: 'always' },
      },
    },
  })
  expect(ctx.llm.providerRetryPolicy('openai')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "maxRetries": 5,
      "mode": "normal",
      "retryableCodes": [
        "EMPTY_RESPONSE",
        "RATE_LIMIT",
        "SERVER",
        "TIMEOUT",
        "TRANSPORT",
      ],
    }
  `)
  expect(ctx.llm.providerRetryPolicy('anthropic')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "mode": "always",
    }
  `)
  // The catalog belongs to an AGENT, not to the process: every model-facing row
  // now lives in a preset mounted under one session's scope, so the global
  // layer holds nothing and a caller must name the agent to see anything. This
  // composes from the deployment default — what a session that names no preset
  // gets — which is the shape this test has always been about.
  expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([])
  const handle = await ctx.agents.create({
    sessionId: SessionId('shipped-composition'),
    setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
  })
  try {
    const names = ctx.tools.schemas(handle.agent).map(schema => schema.name).sort()
    expect(names.filter(name => !RIPGREP_TOOLS.includes(name))).toEqual(EXPECTED_TOOLS)
    // The packaged ripgrep binary ships with the dependency, so the pair is a
    // fixed roster member on every host.
    expect(names.filter(name => RIPGREP_TOOLS.includes(name))).toEqual(RIPGREP_TOOLS)
    const fileReferenceSection = (await ctx.systemPrompt.assemble({ scope: handle.agent })).sections
      .find(section => section.name === 'ui:deliverable-file-references')
    expect(fileReferenceSection?.text).toBe(readFileSync(FILE_REFERENCE_PROMPT, 'utf8').trimEnd())
  } finally {
    await handle.dispose()
  }
  // `workspace-write` is not "the workspace and nothing else": the shared roots
  // helper always admits the temp directories too. Pinning it against an
  // explicit mode keeps the claim independent of this surface's default, and
  // keeps a future sandbox-confinement test from being run inside /tmp — where an
  // "escape" write succeeds by design and reads as a sandbox failure.
  expect(writableRoots(scaffold.ctx.sandboxPolicy.resolve({ mode: 'workspace-write' }))).toEqual(
    expect.arrayContaining([canonicalPath('/tmp'), canonicalPath(tmpdir())]),
  )
  expect(scaffold.ctx.sandboxPolicy.defaultMode).toBe('workspace-write')
  expect(scaffold.ctx.approval.config.policy).toBe('ask')
  expect(scaffold.ctx.permissionPresets.defaultPreset).toBe('workspace-write')

  const commandHandle = await scaffold.ctx.agents.create({
    sessionId: SessionId('shipped-command-catalog'),
    meta: { cwd: scaffold.workspaceCwd },
    agentOptions: { provider: 'test-provider', model: 'test-model' },
  })
  try {
    expect(scaffold.ctx.commands.list(commandHandle.agent)).toContainEqual({
      name: 'feedback',
      description: 'record feedback about this session',
      input: { hint: '<text>' },
    })
  } finally {
    await commandHandle.dispose()
  }
}, 120_000)

it('assembles local Team services while scoping Team tools to an explicitly preset coordinator', async () => {
  scaffold = await launchWebScaffold()
  const ctx = scaffold.ctx
  expect(ctx.get('storageLog')).toBeDefined()
  expect(ctx.storage.backend.names()).toEqual(expect.arrayContaining(['json', 'sqlite']))
  expect(ctx.get('teams')).toBeDefined()
  expect(ctx.get('agentRuntimes')).toBeDefined()
  expect(ctx.get('teamActivations')).toBeDefined()
  expect(ctx.get('teamLinks')?.getProvider('local')).toBeDefined()
  expect(ctx.get('teamWorkspaces')?.getProvider('shared-local')).toBeDefined()
  expect(ctx.get('goals')).toBeUndefined()
  expect(ctx.teams.listAdapters()).toEqual(expect.arrayContaining([
    { type: 'task-assignment', version: 1 },
  ]))
  await expect(ctx.agentPresets.resolve('minimal')).resolves.toMatchObject({
    id: 'minimal', trust: 'system',
  })
  const teamRuns = ctx.get('teamRuns')
  if (teamRuns === undefined) throw new Error('Web composition did not provide TeamRun')

  const ordinary = await ctx.agents.create({
    sessionId: SessionId('shipped-team-ordinary'),
    meta: { cwd: scaffold.workspaceCwd },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
  })
  try {
    expect(ctx.tools.get('team_final', ordinary.agent)).toBeUndefined()
    expect(ctx.tools.get('team_task_start', ordinary.agent)).toBeUndefined()
    expect(ctx.tools.get('team_task_wait', ordinary.agent)).toBeUndefined()
    expect(ctx.tools.get('team_task_list', ordinary.agent)).toBeUndefined()
    expect(ctx.tools.get('team_task_watch', ordinary.agent)).toBeUndefined()
    expect(ctx.tools.get('team_task_cancel', ordinary.agent)).toBeUndefined()
    expect(ctx.tools.get('team_task_propose_owner', ordinary.agent)).toBeUndefined()
    expect(ctx.tools.get('team_workflow_start', ordinary.agent)).toBeUndefined()
    expect(ctx.tools.get('team_workflow_wait', ordinary.agent)).toBeUndefined()
    const run = await teamRuns.create({
      objective: 'Return an explicit final result.',
      cwd: scaffold.workspaceCwd,
      preset: 'standard',
    })
    let workerLease: Awaited<ReturnType<typeof ctx.teamActivations.activate>> | undefined
    try {
      await teamRuns.postHumanInput({
        teamId: run.teamId,
        content: [{ type: 'text', text: 'Prepare the default Team task tools.' }],
        delivery: 'context',
      })
      const coordinator = run.coordinatorLease.localAgent
      if (coordinator === undefined) throw new Error('TeamRun did not publish a local coordinator')
      expect(coordinator.session.header.agentPreset).toBe('standard')
      expect(ctx.tools.get('subagent_fork', coordinator)).toBeUndefined()
      expect(ctx.tools.get('create_goal', coordinator)).toBeUndefined()
      expect(ctx.tools.get('get_goal', coordinator)?.name).toBe('get_goal')
      expect(ctx.tools.get('update_goal', coordinator)?.name).toBe('update_goal')
      expect(ctx.tools.get('team_final', coordinator)?.name).toBe('team_final')
      expect(ctx.tools.get('team_task_start', coordinator)?.name).toBe('team_task_start')
      expect(ctx.tools.get('team_task_wait', coordinator)?.name).toBe('team_task_wait')
      expect(ctx.tools.get('team_task_list', coordinator)?.name).toBe('team_task_list')
      expect(ctx.tools.get('team_task_watch', coordinator)?.name).toBe('team_task_watch')
      expect(ctx.tools.get('team_task_cancel', coordinator)?.name).toBe('team_task_cancel')
      expect(ctx.tools.get('team_task_propose_owner', coordinator)?.name).toBe('team_task_propose_owner')
      expect(ctx.tools.get('team_workflow_start', coordinator)?.name).toBe('team_workflow_start')
      expect(ctx.tools.get('team_workflow_wait', coordinator)?.name).toBe('team_workflow_wait')
      await expect.poll(() => ctx.commands.find(coordinator, 'goal')).toMatchObject({
        description: 'view this Team’s durable objective; authenticated product actors own mutations',
      })
      const goalCommand = await ctx.commands.execute(
        coordinator,
        '/goal edit Use the Team-owned objective.',
        [],
        new AbortController().signal,
      )
      expect(goalCommand?.result).toEqual({
        kind: 'error',
        text: 'Changing a Team objective through /goal requires an authenticated Team actor.',
      })
      await expect(ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({
        team: { goal: { objective: 'Return an explicit final result.', revision: 1 } },
      })

      await seedActiveTeamRunWorker(ctx, run.teamId, run.worker!.id)
      const activeWorker = await ctx.teams.getTeam({ teamId: run.teamId })
      workerLease = await ctx.teamActivations.activate({
        teamId: run.teamId,
        participantId: run.worker!.id,
        expectedCursor: activeWorker.team.cursor,
        provider: 'in-process',
        sessionId: SessionId('shipped-team-worker'),
        seed: { kind: 'fresh' },
        agent: { cwd: scaffold.workspaceCwd, options: coordinator.options, preset: 'minimal' },
        signal: new AbortController().signal,
      })
      const worker = workerLease.localAgent
      if (worker === undefined) throw new Error('TeamRun worker activation did not publish a local Agent')
      expect(worker.session.header).toMatchObject({
        teamId: run.teamId,
        participantId: run.worker!.id,
        agentPreset: 'minimal',
      })
      expect(ctx.tools.get('team_task_start', worker)).toBeUndefined()
      expect(ctx.tools.get('team_task_wait', worker)).toBeUndefined()
      expect(ctx.tools.get('team_task_list', worker)).toBeUndefined()
      expect(ctx.tools.get('team_task_watch', worker)).toBeUndefined()
      expect(ctx.tools.get('team_task_cancel', worker)).toBeUndefined()
      expect(ctx.tools.get('team_task_propose_owner', worker)).toBeUndefined()
      expect(ctx.tools.get('team_workflow_start', worker)).toBeUndefined()
      expect(ctx.tools.get('team_workflow_wait', worker)).toBeUndefined()
    } finally {
      await workerLease?.dispose()
      await teamRuns.cancel(run.teamId)
    }
  } finally {
    await ordinary.dispose()
  }
}, 120_000)

it('keeps authenticated Team task deletion available in the shipped Web composition', async () => {
  scaffold = await launchWebScaffold()
  const created = await scaffold.authenticatedRpc<{
    team: { id: string; cursor: number }
  }>('team.create', { objective: 'Exercise task deletion.', cwd: scaffold.workspaceCwd })
  if (!created.result.ok) throw new Error(created.result.error.message)
  const teamId = created.result.value.team.id
  const task = await scaffold.authenticatedRpc<{ id: string; revision: number }>('team.task.create', {
    teamId,
    expectedCursor: created.result.value.team.cursor,
    idempotencyKey: 'web-task-delete-regression',
    subject: 'Disposable task',
    description: 'Delete this lease-free task.',
    blockedBy: [],
    // Keep the task lease-free so the delete call exercises the human control
    // path rather than racing the scheduler's default worker.
    requiredCapabilities: ['human-delete-regression'],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: 'shared',
    budget: {},
    reviewPolicy: { kind: 'none' },
    maxAttempts: 1,
  })
  if (!task.result.ok) throw new Error(task.result.error.message)
  const deleted = await scaffold.authenticatedRpc<{ phase: string }>('team.task.delete', {
    teamId,
    taskId: task.result.value.id,
    expectedRevision: task.result.value.revision,
  })
  expect(deleted.result).toMatchObject({ ok: true, value: { phase: 'deleted' } })
  const cancelled = await scaffold.authenticatedRpc<{ phase: string }>('team.cancel', { teamId })
  expect(cancelled.result).toMatchObject({ ok: true })
}, 120_000)

it('lets a preset producer reach the background-job registry', async () => {
  scaffold = await launchWebScaffold()
  const ctx = scaffold.ctx
  const handle = await ctx.agents.create({
    sessionId: SessionId('shipped-background-job'),
    meta: { cwd: scaffold.workspaceCwd },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
  })
  try {
    const signal = new AbortController().signal
    // `tool-bash` is a preset row and `tasks` is a host registry; the producer
    // resolves it with `ctx.get`, so a registry hidden behind a preset realm
    // fails here — with every task control still listed in the catalog above.
    const started = await ctx.tools.execute({
      signal,
      callId: CallId('shipped-bash-background'),
      name: 'bash',
      arguments: {
        command: 'printf SHIPPED_BACKGROUND_OK',
        description: 'shipped background probe',
        run_in_background: true,
      },
      agent: handle.agent,
    })
    expect({ isError: started.isError, content: started.content }).toEqual({
      isError: false,
      content: [{ type: 'text', text: 'started background job bash-1' }],
    })

    // The controller reads what the producer started: same registry, one
    // owner. A per-preset registry would list nothing here even on success.
    const listed = await ctx.tools.execute({
      signal,
      callId: CallId('shipped-task-list'),
      name: 'job_list',
      arguments: {},
      agent: handle.agent,
    })
    expect(listed.isError).toBe(false)
    expect(listed.content).toEqual([
      { type: 'text', text: expect.stringContaining('bash-1 [bash]') as unknown as string },
    ])

    // The full round trip: the output a host-plane producer wrote is collected
    // through a preset-plane control, which is the linkage the realm severed.
    const collected = await ctx.tools.execute({
      signal,
      callId: CallId('shipped-task-output'),
      name: 'job_output',
      arguments: { job_id: 'bash-1', wait: true },
      agent: handle.agent,
    })
    expect(collected.isError).toBe(false)
    expect(collected.content).toEqual([
      { type: 'text', text: expect.stringContaining('SHIPPED_BACKGROUND_OK') as unknown as string },
    ])
  } finally {
    await handle.dispose()
  }
}, 120_000)
