import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { SubprocessRuntime } from '@clocky/clocky-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@clocky/clocky-subprocess'
import { activationIdSchema, participantIdSchema, taskAttemptIdSchema, teamIdSchema, teamTaskCreateIdempotencyKeySchema, teamTaskIdSchema } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import type { ActivationBindingSnapshot, TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-team'
import type { TeamWorkspaceAllocation, TeamWorkspacePrepareRequest, TeamWorkspaceProvider } from '@clocky/clocky-team-workspace'
import * as WorktreeWorkspace from '../src/index.ts'

const teamId = teamIdSchema.parse('worktree-error-team')
const participantId = participantIdSchema.parse('worktree-error-worker')
const activationId = activationIdSchema.parse('worktree-error-activation')
const sessionId = SessionId('worktree-error-session')
const taskId = teamTaskIdSchema.parse('worktree-error-task')
const attemptId = taskAttemptIdSchema.parse('worktree-error-attempt')
const COMMIT = 'a'.repeat(40)

const contexts = new Set<Context>()
const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of [...contexts]) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

interface Reply {
  readonly stdout?: string
  readonly stderr?: string
  readonly exitCode?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly exited?: boolean
  readonly stdoutLossy?: boolean
  readonly stderrLossy?: boolean
  readonly omitStdout?: boolean
  readonly onSpawn?: (spec: SubprocessSpawnSpec) => void
  readonly onTerminate?: () => void
  readonly done?: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>
  readonly doneReject?: Error
  readonly waitForExit?: (signal?: AbortSignal) => Promise<boolean>
}

/** Minimal explicit subprocess provider that makes Git process outcomes controllable at the seam. */
class StubSubprocessRuntime extends SubprocessRuntime {
  replies: Reply[] = []
  specs: SubprocessSpawnSpec[] = []
  resolveError: unknown = undefined

  async resolveExecutable(): Promise<string> {
    if (this.resolveError !== undefined) throw this.resolveError
    return 'git'
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const reply = this.replies.shift()
    if (reply === undefined) throw new Error(`missing Git reply for ${spec.argv.join(' ')}`)
    reply.onSpawn?.(spec)
    const stdout = reader(reply.stdout ?? '', reply.stdoutLossy ?? false)
    const stderr = reader(reply.stderr ?? '', reply.stderrLossy ?? false)
    return {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        ...reply.omitStdout ? {} : { stdout },
        stderr,
      },
      done: reply.done ?? (reply.doneReject === undefined
        ? Promise.resolve({
          exitCode: reply.exitCode === undefined ? 0 : reply.exitCode,
          signal: reply.signal ?? null,
        })
        : Promise.reject(reply.doneReject)),
      terminate() { reply.onTerminate?.() },
      async waitForExit(signal) { return await reply.waitForExit?.(signal) ?? reply.exited ?? true },
    }
  }

  async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('not used')
  }
}

/** Build one offset reader with an optional deliberately lossy first read. */
function reader(text: string, lossy: boolean): SubprocessOutputReader {
  return {
    readFrom() {
      return { text, nextOffset: text.length, lossy }
    },
  }
}

/** Build a current attempt and mutable Team state suitable for a stubbed worktree allocation. */
function fixture(): {
  readonly request: TeamWorkspacePrepareRequest
  readonly state: TeamStateSnapshot
  readonly binding: ActivationBindingSnapshot
} {
  const binding: ActivationBindingSnapshot = {
    activation: { id: activationId, teamId, participantId, status: 'idle' },
    sessionId,
    provider: 'test',
  }
  const task: TeamTaskSnapshot = {
    execution: { kind: 'participant' },
    id: taskId,
    teamId,
    revision: 2,
    createCommand: {
      creator: { teamId, participantId, activationId, sessionId, provider: 'test' },
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('worktree-error-path-task'),
    },
    subject: 'Stub worktree',
    description: 'Exercise Git failure paths.',
    phase: 'assigned',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: 'worktree',
    budget: {},
    reviewPolicy: { kind: 'none' },
    reviewHistory: [],
    maxAttempts: 1,
    attemptCount: 1,
    attemptHistory: [],
    lease: {
      attemptId,
      assignedRevision: 2,
      ordinal: 1,
      participantId,
      activationId,
      assignedAt: 1,
      durationMs: 60_000,
      renewedAt: 1,
      expiresAt: Date.now() + 60_000,
    },
  }
  return {
    binding,
    request: { teamId, taskId, attemptId, assignedRevision: 2, participantId, activationId, sessionId },
    state: {
      team: {
        id: teamId,
        depth: 0,
        maxTeamDepth: 0,
        goal: { teamId, revision: 1, objective: 'Exercise errors.', phase: 'active', budgets: {} },
        phase: 'active', cursor: 1, createdAt: 1, updatedAt: 1,
      },
      goal: { teamId, revision: 1, objective: 'Exercise errors.', phase: 'active', budgets: {} },
      rules: {}, budgets: {},
      participants: [{
        id: participantId, teamId, kind: 'local-agent', displayName: 'Stub worker', role: 'worker', capabilities: [], phase: 'active',
      }],
      activations: [binding], tasks: [task], workspaceAllocations: [], channelIds: [],
    },
  }
}

/** Mount a provider with Git replies for its top-level and base-commit mount checks. */
async function mount(replies: readonly Reply[], overrides: Partial<WorktreeWorkspace.Config> = {}) {
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'team-workspace-worktree-errors-'))
  roots.push(root)
  const repoRoot = join(root, 'repo')
  const allocationParent = join(root, 'allocations')
  await mkdir(repoRoot)
  await mkdir(allocationParent)
  const current = fixture()
  const team = { state: current.state }
  const ctx = new Context()
  contexts.add(ctx)
  ctx.provide('teams', {
    getTeam: async () => team.state,
    authorize: async () => ({ kind: 'allow' as const }),
  } as never)
  ctx.provide('agents', { get: () => ({ id: sessionId, session: { id: sessionId } }) } as never)
  await ctx.plugin(StubSubprocessRuntime)
  await ctx.plugin(TeamWorkspaceRegistry)
  const subprocess = ctx.subprocess as StubSubprocessRuntime
  subprocess.replies.push(...replies)
  const config: WorktreeWorkspace.Config = {
    providerName: 'stub-worktree', repoRoot, allocationParent,
    baseRef: 'HEAD', gitExecutable: 'git', processGraceMs: 1, commandTimeoutMs: 1_000, outputMaxBytes: 1024,
    ...overrides,
  }
  return { ctx, subprocess, config, ...current, team, repoRoot, allocationParent }
}

/** Replies that allow mounting through Git top-level and base-commit validation. */
function mountedReplies(repoRoot: string): Reply[] {
  return [{ stdout: `${repoRoot}\n` }, { stdout: `${COMMIT}\n` }]
}

/** Materialize one direct provider reservation through the two-stage contract. */
async function materialize(provider: TeamWorkspaceProvider, request: TeamWorkspacePrepareRequest): Promise<TeamWorkspaceAllocation> {
  const preparation = await provider.prepare(request)
  return await preparation.materialize()
}

describe('worktree provider Git and filesystem failure paths', () => {
  it.each([
    [{ exited: false }, 'did not drain within'],
    [{ omitStdout: true }, 'stdout was not collected'],
    [{ stdoutLossy: true }, 'stdout exceeded'],
    [{ exitCode: 1, stderr: 'broken ref' }, 'failed with exit 1'],
    [{ exitCode: null, signal: 'SIGTERM' }, 'failed with SIGTERM'],
    [{ exitCode: null, signal: null }, 'failed with unknown signal'],
  ] as const)('rejects incomplete or failed Git top-level validation %#', async (reply, message) => {
    const mounted = await mount([])
    mounted.subprocess.replies.push(reply)
    await expect(WorktreeWorkspace.apply(mounted.ctx, mounted.config)).rejects.toThrow(message)
  })

  it('rejects a non-commit Git base reply and an executable-resolution failure before registration', async () => {
    const invalidBase = await mount([])
    invalidBase.subprocess.replies.push(...mountedReplies(invalidBase.repoRoot).slice(0, 1), { stdout: 'not-a-commit\n' })
    await expect(WorktreeWorkspace.apply(invalidBase.ctx, invalidBase.config)).rejects.toThrow('did not resolve to one commit')

    const executable = await mount([])
    executable.subprocess.resolveError = new Error('git unavailable')
    await expect(WorktreeWorkspace.apply(executable.ctx, executable.config)).rejects.toThrow('git unavailable')
  })

  it('rejects an empty Git repository-top-level reply before it resolves a base revision', async () => {
    const emptyTopLevel = await mount([])
    emptyTopLevel.subprocess.replies.push({ stdout: '' })
    await expect(WorktreeWorkspace.apply(emptyTopLevel.ctx, emptyTopLevel.config))
      .rejects.toThrow('reported no top-level directory')
  })

  it('cleans an owned symbolic-link worktree after verification rejects it', async () => {
    const mounted = await mount([])
    mounted.subprocess.replies.push(...mountedReplies(mounted.repoRoot), {
      onSpawn(spec) {
        const root = spec.argv.at(-2)
        if (root === undefined) throw new Error('worktree add lacks its path')
        const outside = join(mounted.repoRoot, 'outside')
        mkdirSync(outside)
        symlinkSync(outside, root)
      },
    }, {})
    const apply = WorktreeWorkspace.apply(mounted.ctx, mounted.config)
    await expect(apply).resolves.toBeUndefined()
    const provider = mounted.ctx.teamWorkspaces.resolve('worktree')
    await expect(materialize(provider, mounted.request)).rejects.toThrow('symbolic-link worktree')
  })

  it('aggregates failed cleanup after rejecting a provider-created invalid worktree', async () => {
    const mounted = await mount([])
    mounted.subprocess.replies.push(...mountedReplies(mounted.repoRoot), {
      onSpawn(spec) {
        const root = spec.argv.at(-2)
        if (root === undefined) throw new Error('worktree add lacks its path')
        const outside = join(mounted.repoRoot, 'outside-aggregate')
        mkdirSync(outside)
        symlinkSync(outside, root)
      },
    }, { exitCode: 1, stderr: 'normal removal failed' })
    await WorktreeWorkspace.apply(mounted.ctx, mounted.config)
    const provider = mounted.ctx.teamWorkspaces.resolve('worktree')
    await expect(materialize(provider, mounted.request)).rejects.toBeInstanceOf(AggregateError)
  })

  it('revalidates durable ownership after Git creates a worktree and removes that clean root on a stale lease', async () => {
    const mounted = await mount([])
    let root: string | undefined
    mounted.subprocess.replies.push(...mountedReplies(mounted.repoRoot), {
      onSpawn(spec) {
        root = spec.argv.at(-2)
        if (root === undefined) throw new Error('worktree add lacks its path')
        mkdirSync(root)
        mounted.team.state = {
          ...mounted.team.state,
          tasks: [{ ...mounted.team.state.tasks[0]!, lease: { ...mounted.team.state.tasks[0]!.lease!, expiresAt: 0 } }],
        }
      },
    }, {
      onSpawn() {
        if (root === undefined) throw new Error('worktree remove lacked its allocated root')
        rmSync(root, { recursive: true, force: true })
      },
    })
    await WorktreeWorkspace.apply(mounted.ctx, mounted.config)
    const provider = mounted.ctx.teamWorkspaces.resolve('worktree')
    await expect(materialize(provider, mounted.request)).rejects.toThrow('has expired')
    if (root === undefined) throw new Error('provider did not create the test worktree')
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('waits for a normal release before a later allocation creates and revalidates a fresh worktree', async () => {
    const mounted = await mount([])
    let root: string | undefined
    mounted.subprocess.replies.push(...mountedReplies(mounted.repoRoot), {
      onSpawn(spec) {
        root = spec.argv.at(-2)
        if (root === undefined) throw new Error('initial worktree add lacks its path')
        mkdirSync(root)
      },
    })
    await WorktreeWorkspace.apply(mounted.ctx, mounted.config)
    const provider = mounted.ctx.teamWorkspaces.resolve('worktree')
    const first = await materialize(provider, mounted.request)
    if (root === undefined) throw new Error('provider did not create the first test worktree')

    const removal = Promise.withResolvers<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>()
    mounted.subprocess.replies.push({
      done: removal.promise,
      onSpawn() { rmSync(root!, { recursive: true, force: true }) },
    }, {
      onSpawn(spec) {
        const nextRoot = spec.argv.at(-2)
        if (nextRoot === undefined) throw new Error('replacement worktree add lacks its path')
        mkdirSync(nextRoot)
      },
    }, {
      onSpawn() { rmSync(root!, { recursive: true, force: true }) },
    })
    const release = first.release()
    await vi.waitFor(() => {
      expect(mounted.subprocess.specs.some(spec => spec.argv.includes('remove'))).toBe(true)
    })
    let allocated = false
    const next = materialize(provider, mounted.request).then((allocation) => {
      allocated = true
      return allocation
    })
    await Promise.resolve()
    expect(allocated).toBe(false)
    removal.resolve({ exitCode: 0, signal: null })
    await release
    const second = await next
    expect(allocated).toBe(true)
    expect(second).not.toBe(first)
    await second.release()
  })

  it('gives every Git command a deadline signal and fails rather than waiting indefinitely for an unresponsive process', async () => {
    const mounted = await mount([], { commandTimeoutMs: 1 })
    mounted.subprocess.replies.push(...mountedReplies(mounted.repoRoot))
    await WorktreeWorkspace.apply(mounted.ctx, mounted.config)
    const never = new Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>(() => {})
    let terminated = false
    mounted.subprocess.replies.push({
      done: never,
      async waitForExit(signal) { return !signal?.aborted },
      onTerminate() { terminated = true },
    })
    const provider = mounted.ctx.teamWorkspaces.resolve('worktree')
    await expect(materialize(provider, mounted.request)).rejects.toMatchObject({
      name: 'TimeoutReason',
      code: 'TEAM_WORKTREE_GIT_TIMEOUT',
    })
    expect(terminated).toBe(true)
    const gitSpec = mounted.subprocess.specs.at(-1)
    expect(gitSpec?.signal?.aborted).toBe(true)
  })

  it('fails loudly when a fresh bounded drain cannot prove process-tree exit after timeout', async () => {
    const mounted = await mount([], { commandTimeoutMs: 1 })
    mounted.subprocess.replies.push(...mountedReplies(mounted.repoRoot))
    await WorktreeWorkspace.apply(mounted.ctx, mounted.config)
    const never = new Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>(() => {})
    mounted.subprocess.replies.push({ done: never, async waitForExit() { return false } })
    const provider = mounted.ctx.teamWorkspaces.resolve('worktree')
    await expect(materialize(provider, mounted.request)).rejects.toThrow('Git command failed and its process tree remained live')
  })

  it('propagates a Git process launch failure only after its bounded exit observation', async () => {
    const mounted = await mount([])
    mounted.subprocess.replies.push(...mountedReplies(mounted.repoRoot))
    await WorktreeWorkspace.apply(mounted.ctx, mounted.config)
    const failure = new Error('spawn failed')
    mounted.subprocess.replies.push({ doneReject: failure })
    const provider = mounted.ctx.teamWorkspaces.resolve('worktree')
    await expect(materialize(provider, mounted.request)).rejects.toBe(failure)
  })

  it.each([
    [false, 'TEAM_WORKTREE_GIT_TIMEOUT'],
    [true, 'TEAM_WORKTREE_GIT_TIMEOUT'],
  ] as const)('fails a Git command whose post-exit tree wait exceeds its deadline (%s)', async (exited, code) => {
    const mounted = await mount([], { commandTimeoutMs: 10 })
    mounted.subprocess.replies.push(...mountedReplies(mounted.repoRoot))
    await WorktreeWorkspace.apply(mounted.ctx, mounted.config)
    let terminated = false
    let waits = 0
    mounted.subprocess.replies.push({
      waitForExit: async () => {
        waits += 1
        if (waits > 1) return true
        return await new Promise(resolve => setTimeout(() => { resolve(exited) }, 30))
      },
      onTerminate() { terminated = true },
    })
    const provider = mounted.ctx.teamWorkspaces.resolve('worktree')
    await expect(materialize(provider, mounted.request)).rejects.toMatchObject({ name: 'TimeoutReason', code })
    if (!exited) expect(terminated).toBe(true)
  })

  it('reports a non-timeout process-tree quiescence failure after a successful fresh drain', async () => {
    const mounted = await mount([])
    mounted.subprocess.replies.push(...mountedReplies(mounted.repoRoot))
    await WorktreeWorkspace.apply(mounted.ctx, mounted.config)
    let waits = 0
    mounted.subprocess.replies.push({
      async waitForExit() {
        waits += 1
        return waits > 1
      },
    })
    const provider = mounted.ctx.teamWorkspaces.resolve('worktree')
    await expect(materialize(provider, mounted.request)).rejects.toThrow('did not reach quiescence')
  })

  it('does not delete a replacement allocation entry when a creator fails after it is superseded', async () => {
    const mounted = await mount([])
    mounted.subprocess.replies.push(...mountedReplies(mounted.repoRoot))
    await WorktreeWorkspace.apply(mounted.ctx, mounted.config)
    const finished = Promise.withResolvers<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>()
    mounted.subprocess.replies.push({ done: finished.promise })
    const provider = mounted.ctx.teamWorkspaces.resolve('worktree')
    const allocation = materialize(provider, mounted.request)
    const internals = provider as unknown as { readonly allocations: Map<string, Promise<unknown>> }
    await vi.waitFor(() => { expect(internals.allocations.size).toBe(1) })
    const [key] = internals.allocations.keys()
    if (key === undefined) throw new Error('provider did not reserve an allocation key')
    const replacement = Promise.resolve({ replacement: true })
    internals.allocations.set(key, replacement)
    finished.resolve({ exitCode: 1, signal: null })
    await expect(allocation).rejects.toThrow('failed with exit 1')
    expect(internals.allocations.get(key)).toBe(replacement)
  })

})
