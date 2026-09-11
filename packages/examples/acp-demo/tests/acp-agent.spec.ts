import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@clocky/cordis'
import Loader from '@clocky/cordis-plugin-loader'
import { agentEvents } from '@clocky/clocky-agent'
import { TOOL_ORDER_REST } from '@clocky/clocky-system-prompt'
import type { Message } from '@clocky/clocky-llm'
import { SessionId } from '@clocky/clocky-session'
import * as acpAgent from '../src/index.ts'

/**
 * In-process unit coverage for the @clocky/clocky-acp-demo composition:
 * mounting it brings up the agent-spine-demo spine, local Team stack, JSONL
 * persistence, and ACP bridge in one `ctx.plugin`. It loads no Loader-only
 * plugin, so it mounts in a plain Context.
 *
 * The REAL Loader-path guard (export shape via `unwrapExports`, the headline
 * ACP operations end-to-end) is the keyless bin smoke in `load-path.e2e.ts`;
 * this spec asserts the composition and the persistenceRoot default branch.
 */
async function mount(config: acpAgent.Config, withBash = false): Promise<Context> {
  const ctx = new Context()
  if (withBash) {
    ctx.provide('shell', {
      sandboxMode: undefined,
      resolve() { throw new Error('composition test does not execute bash') },
      run() { throw new Error('composition test does not execute bash') },
      start() { throw new Error('composition test does not execute bash') },
    })
  }
  config.persistenceRoot ??= await mkdtemp(join(tmpdir(), 'clocky-acp-demo-persistence-'))
  await ctx.plugin(acpAgent, config)
  return ctx
}

async function isolatedSkillsConfig(catalogDescriptionMaxLength?: number): Promise<NonNullable<acpAgent.Config['skills']>> {
  const home = await mkdtemp(join(tmpdir(), 'clocky-acp-demo-skills-'))
  return {
    filesystem: { clockyHome: join(home, '.clocky'), agentsHome: join(home, '.agents') },
    ...catalogDescriptionMaxLength !== undefined ? { tool: { catalogDescriptionMaxLength } } : {},
  }
}

async function composePrefix(ctx: Context): Promise<Message[]> {
  const agent = ctx.agentLoop.create(SessionId(`acp-demo-prefix-${randomUUID()}`), {}, { cwd: '/tmp' })
  const signal = new AbortController().signal
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step', { messages: [], turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter', messages: [] }),
  )
  if (decision.kind === 'enter') {
    for (const message of decision.messages) {
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
  return agent.session.deriveMessages()
}

async function withIsolatedSkillHomes<T>(run: () => Promise<T>): Promise<T> {
  const oldClockyHome = process.env.CLOCKY_HOME
  const oldAgentsHome = process.env.CLOCKY_AGENTS_HOME
  const home = await mkdtemp(join(tmpdir(), 'clocky-acp-demo-default-skills-'))
  process.env.CLOCKY_HOME = join(home, '.clocky')
  process.env.CLOCKY_AGENTS_HOME = join(home, '.agents')
  try {
    return await run()
  } finally {
    if (oldClockyHome === undefined) {
      delete process.env.CLOCKY_HOME
    } else {
      process.env.CLOCKY_HOME = oldClockyHome
    }
    if (oldAgentsHome === undefined) {
      delete process.env.CLOCKY_AGENTS_HOME
    } else {
      process.env.CLOCKY_AGENTS_HOME = oldAgentsHome
    }
  }
}

describe('clocky-acp-demo composition', () => {
  it('brings up the spine, local Team stack, persistence, and ACP bridge', async () => {
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      interruptRetryAttempts: 2,
      persona: 'hi',
      persistenceRoot: await mkdtemp(join(tmpdir(), 'clocky-acp-demo-test-')),
      persistenceCompression: 'none',
      skills: await isolatedSkillsConfig(),
      workspaceContext: false,
    })
    expect(ctx.get('agents')).toBeDefined()
    expect(ctx.get('sessions')).toBeDefined()
    expect(ctx.get('sessionPersistence')).toBeDefined()
    expect(ctx.get('sessionQuery')).toBeDefined()
    expect(ctx.get('sessionReferenceResolver')).toBeUndefined()
    expect((ctx.get('sessionPersistence') as unknown as { config: { compression?: string } }).config.compression).toBe('none')
    expect(ctx.get('agentLoop')).toBeDefined()
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'mock', model: 'mock' })
    expect(ctx.get('storage')).toBeDefined()
    expect(ctx.get('storageLog')).toBeDefined()
    expect(ctx.get('teams')).toBeDefined()
    expect(ctx.get('agentRuntimes')).toBeDefined()
    expect(ctx.get('teamActivations')).toBeDefined()
    expect(ctx.get('teamLinks')).toBeDefined()
    expect(ctx.get('teamRuns')).toBeDefined()
    expect(ctx.get('userQuestions')).toBeUndefined()
    expect(ctx.get('commands')).toBeUndefined()
    expect(ctx.get('tools')?.get('ask_user_question')).toBeUndefined()
    expect(ctx.get('goals')).toBeUndefined()
    for (const name of ['create_goal', 'get_goal', 'update_goal']) {
      expect(ctx.get('tools')?.get(name)).toBeUndefined()
    }
    // No pre-created agents — ACP session/new creates them on demand.
    expect(ctx.get('agents')!.list()).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('rejects removed same-session Goal config at the ACP boundary', () => {
    const legacyConfig = {
      provider: 'mock',
      model: 'mock',
      workspaceContext: false,
      goals: false,
    } as unknown as acpAgent.Config
    expect(() => acpAgent.Config(legacyConfig)).toThrow(/goals/u)
  })

  it('uses an explicit Team storage root for durable Team records', async () => {
    const teamStorageRoot = await mkdtemp(join(tmpdir(), 'clocky-acp-demo-team-storage-'))
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      teamStorageRoot,
      skills: await isolatedSkillsConfig(),
      workspaceContext: false,
    })
    await ctx.teamRuns.create({ objective: 'storage root check', cwd: process.cwd() })
    expect(await readdir(join(teamStorageRoot, 'logs'))).not.toEqual([])
    await ctx.fiber.dispose()
  })

  it('defaults the persistence root when omitted', async () => {
    // Exercises the `DEFAULT_PERSISTENCE_ROOT` fallback for a direct-apply caller that
    // bypasses the schema's `.default(...)`: call `apply` directly (not via
    // `ctx.plugin`, which validates+defaults the config first) with no
    // persistenceRoot, so the runtime fallback is the one that fires.
    const ctx = new Context()
    // No persona: covers the omitted-persona forwarding branch too.
    await acpAgent.apply(ctx, {
      provider: 'mock',
      model: 'mock',
      skills: await isolatedSkillsConfig(),
      workspaceContext: false,
    })
    expect(ctx.get('sessionPersistence')).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('forwards explicit project-instruction controls to the bundled spine', async () => {
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      persona: 'hi',
      persistenceRoot: await mkdtemp(join(tmpdir(), 'clocky-acp-demo-workspace-context-')),
      workspaceContext: false,
    })
    expect(ctx.get('agents')).toBeDefined()
    expect(ctx.get('agentLoop')).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('uses default skill config when apply is called directly without skills', async () => {
    await withIsolatedSkillHomes(async () => {
      const ctx = new Context()
      await acpAgent.apply(ctx, { provider: 'mock', model: 'mock', workspaceContext: false })
      expect(ctx.skills).toBeDefined()
      expect(await ctx.skills.list()).toEqual([])
      await ctx.fiber.dispose()
    })
  })

  it('forwards skill config and clockyHome into agent-spine-demo', async () => {
    const skills = await isolatedSkillsConfig(6)
    const ctx = await mount({ provider: 'mock', model: 'mock', persona: 'hi', clockyHome: skills.filesystem!.clockyHome!, skills, workspaceContext: false })
    ctx.skills.register({ name: 'acp-skill', description: 'ACP skill', source: 'runtime', content: 'body' })
    expect(JSON.stringify(await composePrefix(ctx))).toContain('- `acp-skill`: ACP...')
    await ctx.fiber.dispose()
  })

  it('forwards maxParallelToolCalls to the bundled agent loop', async () => {
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      maxParallelToolCalls: 3,
      persistenceRoot: await mkdtemp(join(tmpdir(), 'clocky-acp-demo-test-parallel-')),
      skills: await isolatedSkillsConfig(),
      workspaceContext: false,
    })
    expect(ctx.get('agentLoop')?.config.maxParallelToolCalls).toBe(3)
    await ctx.fiber.dispose()
  })

  it('forwards task admission config to the bundled task provider', async () => {
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      jobs: { maxConcurrentJobsPerOwner: 1 },
      skills: await isolatedSkillsConfig(),
      workspaceContext: false,
    })
    let settle!: (outcome: { status: 'killed' }) => void
    ctx.jobs.start({
      kind: 'bash',
      label: 'hold configured slot',
      run: () => ({
        cancel: () => { settle({ status: 'killed' }) },
        done: new Promise((resolve) => { settle = resolve }),
      }),
    })
    expect(() => ctx.jobs.start({
      kind: 'bash',
      label: 'blocked configured task',
      run: () => ({ cancel: () => {}, done: Promise.resolve({ status: 'completed' }) }),
    })).toThrow('(limit: 1)')
    await ctx.fiber.dispose()
  })

  it('forwards bundled tool config into agent-core', async () => {
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      workspaceContext: false,
      toolBash: { enableRunInBackground: false },
      toolJobs: { waitTimeoutMs: 7, maxWaitTimeoutMs: 11 },
      skills: await isolatedSkillsConfig(),
    }, true)
    const bash = ctx.tools.schemas().find(tool => tool.name === 'bash')
    expect(Object.keys((bash!.parameters as { properties: Record<string, unknown> }).properties))
      .not.toContain('run_in_background')
    await ctx.fiber.dispose()
  })

  it('exposes its plugin shape', () => {
    expect(acpAgent.name).toBe('acp-demo')
    expect(acpAgent.Config).toBeDefined()
  })

  it('forwards toolOrder through agent-spine-demo to the system-prompt assembly', async () => {
    const ctx = await mount({
      provider: 'mock',
      model: 'mock',
      toolOrder: ['zulu', TOOL_ORDER_REST],
      persistenceRoot: await mkdtemp(join(tmpdir(), 'clocky-acp-demo-test-tool-order-')),
      workspaceContext: false,
    })
    // The bundle's own bash tools pend on the absent `ctx.shell` executor in
    // this providerless mount, so register two plain tools to order.
    for (const name of ['alpha', 'zulu']) {
      ctx.get('tools')!.register({
        name,
        description: name,
        parameters: {},
        output: { schema: { type: 'null' }, render: () => [] },
        execute: async () => null,
      })
    }
    const assembly = await ctx.get('systemPrompt')!.assemble()
    expect(assembly.tools.map(tool => tool.name)).toEqual([
      'zulu',
      'alpha',
      'job_kill',
      'job_list',
      'job_output',
      'skill',
    ])
    await ctx.fiber.dispose()
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/Config/apply', () => {
    // A default export would make `unwrapExports` collapse this inject-less namespace and silently
    // drop `name`/`Config` while the app still boots. Guard the postmortem-0001 shape directly.
    expect('default' in acpAgent).toBe(false)
    expect(typeof acpAgent.apply).toBe('function')

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(acpAgent) as Record<string, unknown>
    expect(unwrapped).toBe(acpAgent)
    expect(unwrapped.name).toBe('acp-demo')
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })
})
