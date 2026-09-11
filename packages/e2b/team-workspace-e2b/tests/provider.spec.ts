import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { FileNotFoundError, FileType, SandboxNotFoundError } from '@clocky/clocky-e2b'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import type {
  TeamWorkspaceAllocation,
  TeamWorkspacePrepareRequest,
  TeamWorkspaceSourceIntegrateRequest,
} from '@clocky/clocky-team-workspace'
import type { TaskAttemptId, TeamArtifactReference, TeamTaskSnapshot } from '@clocky/clocky-team'
import { encodeTeamWorkspaceChangeSet } from '@clocky/clocky-team-workspace'
import * as RemoteWorkspace from '../src/index.ts'

class FakeRemoteFilesystem {
  readonly nodes = new Map<string, {
    readonly type: FileType
    readonly data: Uint8Array
    readonly symlinkTarget?: string
    readonly modifiedTime: Date
  }>()

  constructor() {
    this.nodes.set('/', { type: FileType.DIR, data: new Uint8Array(), modifiedTime: new Date(0) })
    this.nodes.set('/runtime', { type: FileType.DIR, data: new Uint8Array(), modifiedTime: new Date(0) })
  }

  readonly files = {
    makeDir: async (path: string): Promise<boolean> => {
      if (this.nodes.has(path)) return false
      const parts = path.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += `/${part}`
        if (!this.nodes.has(current)) this.nodes.set(current, { type: FileType.DIR, data: new Uint8Array(), modifiedTime: new Date() })
      }
      return true
    },
    getInfo: async (path: string) => this.info(path),
    write: async (path: string, data: string | Uint8Array | ArrayBuffer) => {
      const parent = path.slice(0, path.lastIndexOf('/')) || '/'
      await this.files.makeDir(parent)
      const bytes = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data instanceof ArrayBuffer ? new Uint8Array(data) : data
      this.nodes.set(path, { type: FileType.FILE, data: Uint8Array.from(bytes), modifiedTime: new Date() })
      return this.info(path)
    },
    list: async (root: string): Promise<Array<{
      readonly name: string
      readonly path: string
      readonly type: FileType
      readonly size: number
      readonly symlinkTarget?: string
      readonly mode: number
      readonly permissions: string
      readonly owner: string
      readonly group: string
      readonly modifiedTime?: Date | undefined
    }>> => {
      const prefix = root.endsWith('/') ? root : `${root}/`
      return [...this.nodes.entries()]
        .filter(([path, node]) => path.startsWith(prefix) && path !== root && node.type === FileType.FILE)
        .map(([path, node]) => ({
          name: path.slice(path.lastIndexOf('/') + 1),
          path,
          type: node.type,
          size: node.data.byteLength,
          ...node.symlinkTarget === undefined ? {} : { symlinkTarget: node.symlinkTarget },
          mode: 0o600,
          permissions: 'rw-------',
          owner: 'user',
          group: 'user',
          modifiedTime: node.modifiedTime,
        }))
    },
    read: async (path: string, options: { readonly format?: 'text' | 'bytes' }) => {
      const node = this.required(path)
      if (options.format === 'text') return new TextDecoder().decode(node.data)
      return Uint8Array.from(node.data)
    },
    remove: async (path: string): Promise<void> => {
      if (!this.nodes.has(path)) throw new FileNotFoundError(`missing ${path}`)
      const prefix = path.endsWith('/') ? path : `${path}/`
      for (const candidate of [...this.nodes.keys()]) {
        if (candidate === path || candidate.startsWith(prefix)) this.nodes.delete(candidate)
      }
    },
  }

  file(path: string, value: string): void {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/'
    void this.files.makeDir(parent)
    this.nodes.set(path, { type: FileType.FILE, data: new TextEncoder().encode(value), modifiedTime: new Date() })
  }

  symlink(path: string, target: string, type: FileType = FileType.DIR): void {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/'
    void this.files.makeDir(parent)
    this.nodes.set(path, { type, data: new Uint8Array(), symlinkTarget: target, modifiedTime: new Date() })
  }

  other(path: string): void {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/'
    void this.files.makeDir(parent)
    this.nodes.set(path, { type: 'other' as FileType, data: new Uint8Array(), modifiedTime: new Date() })
  }

  private required(path: string): {
    readonly type: FileType
    readonly data: Uint8Array
    readonly symlinkTarget?: string
    readonly modifiedTime: Date
  } {
    const node = this.nodes.get(path)
    if (node === undefined) throw new FileNotFoundError(`missing ${path}`)
    return node
  }

  private async info(path: string) {
    const node = this.required(path)
    return {
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      type: node.type,
      size: node.data.byteLength,
      ...node.symlinkTarget === undefined ? {} : { symlinkTarget: node.symlinkTarget },
      mode: node.type === FileType.DIR ? 0o700 : 0o600,
      permissions: node.type === FileType.DIR ? 'rwx------' : 'rw-------',
      owner: 'user',
      group: 'user',
      modifiedTime: node.modifiedTime,
    }
  }
}

function fixture() {
  const teamId = 'remote-team' as never
  const taskId = 'remote-task' as never
  const attemptId = 'remote-attempt' as never
  const participantId = 'remote-participant' as never
  const activationId = 'remote-activation' as never
  const sessionId = 'remote-session' as never
  const binding = {
    activation: { id: activationId, teamId, participantId, status: 'idle' as const },
    sessionId,
    provider: 'e2b-agent',
  }
  const task = {
    id: taskId,
    teamId,
    revision: 2,
    workspaceMode: 'remote' as const,
    phase: 'assigned' as const,
    lease: {
      attemptId,
      assignedRevision: 3,
      participantId,
      activationId,
      expiresAt: Date.now() + 60_000,
    },
  } as unknown as TeamTaskSnapshot
  const state = {
    team: { id: teamId, phase: 'active' as const },
    tasks: [task],
    participants: [{ id: participantId, teamId, kind: 'local-agent' as const, phase: 'active' as const }],
    activations: [binding],
  }
  const teams = {
    getTeam: vi.fn(async () => state),
    authorize: vi.fn(async () => ({ kind: 'allow' as const })),
  }
  const agents = { get: vi.fn(() => ({ session: { id: sessionId } })) }
  const artifactBytes = new Map<string, Uint8Array>()
  const saves = vi.fn(async (_provider: string, request: {
    readonly name?: string
    readonly sourceAttemptId?: TaskAttemptId
    readonly kind: 'file' | 'patch'
    readonly visibility: 'team'
    readonly data: Uint8Array | string
  }) => {
    const id = `remote-artifact:${request.kind}:${request.name}`
    artifactBytes.set(id, typeof request.data === 'string' ? new TextEncoder().encode(request.data) : Uint8Array.from(request.data))
    return {
      id,
      provider: 'remote-artifacts',
      kind: request.kind,
      uri: `artifact://${request.name}`,
      sourceAttemptId: request.sourceAttemptId,
      visibility: request.visibility,
    }
  })
  const reads = vi.fn(async (_provider: string, input: { readonly reference: { readonly id: string } }) => {
    const bytes = artifactBytes.get(input.reference.id)
    if (bytes === undefined) throw new Error(`missing artifact ${input.reference.id}`)
    return Uint8Array.from(bytes)
  })
  const request: TeamWorkspacePrepareRequest = {
    teamId,
    taskId,
    attemptId,
    assignedRevision: 3,
    participantId,
    activationId,
    sessionId,
  }
  return { state, teams, agents, saves, reads, request, task, binding }
}

async function setup(options: {
  readonly artifact?: boolean
  readonly integration?: boolean
  readonly maxArtifactBytes?: number
  readonly maxEntriesPerPublish?: number
  readonly maxIntegrationBytes?: number
  readonly lossPollIntervalMs?: number
} = {}) {
  const remote = new FakeRemoteFilesystem()
  const sandbox = { sandboxId: 'fake-sandbox', files: remote.files, getInfo: vi.fn(async () => ({ sandboxId: 'fake-sandbox' })) }
  const e2b = {
    runtimeRoot: '/runtime/.clocky-e2b',
    getSandbox: vi.fn(async () => sandbox),
  }
  const harness = fixture()
  const ctx = new Context()
  await mkdir('.tmp-supervisor', { recursive: true })
  const logRoot = await mkdtemp(join(process.cwd(), '.tmp-supervisor/e2b-artifacts-'))
  ctx.effect(() => async () => { await rm(logRoot, { recursive: true, force: true }) }, 'test E2B artifact ledger directory')
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: logRoot })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  ctx.provide('teams', harness.teams as never)
  ctx.provide('agents', harness.agents as never)
  ctx.provide('e2b', e2b as never)
  if (options.artifact !== false) {
    ctx.provide('teamArtifacts', { save: harness.saves, read: harness.reads } as never)
  }
  await ctx.plugin(TeamWorkspaceRegistry)
  const providerFiber = await ctx.plugin(RemoteWorkspace, {
    artifactProvider: 'remote-artifacts',
    maxArtifactBytes: options.maxArtifactBytes ?? 128,
    ...(options.maxEntriesPerPublish === undefined ? {} : { maxEntriesPerPublish: options.maxEntriesPerPublish }),
    ...(options.integration === true ? {
      integrationRoot: '/runtime/.clocky-e2b/team-integrations',
      integrationEnabled: true,
    } : {}),
    maxIntegrationBytes: options.maxIntegrationBytes ?? 4096,
    lossPollIntervalMs: options.lossPollIntervalMs ?? 5000,
  })
  return { ctx, harness, remote, e2b, sandbox, providerFiber }
}

describe('E2B remote Team workspace provider', () => {
  afterEach(() => vi.restoreAllMocks())

  it('retains partial publication artifacts outside an expired sandbox and reloads them after provider restart', async () => {
    const test = await setup()
    const preparation = await test.ctx.teamWorkspaces.prepare('remote', test.harness.request)
    const allocation = await test.ctx.teamWorkspaces.materialize('remote', test.harness.request, preparation)
    await test.remote.files.write(`${allocation.root}/a.txt`, 'retained bytes')
    await test.remote.files.write(`${allocation.root}/b.txt`, 'lost bytes')
    const read = test.remote.files.read
    const failure = vi.spyOn(test.remote.files, 'read').mockImplementation(async (path, options) => {
      if (path.endsWith('/b.txt')) throw new SandboxNotFoundError('expired execution world')
      return await read(path, options)
    })
    await expect(test.ctx.teamWorkspaces.publish('remote', { allocation })).rejects.toMatchObject({
      code: 'TEAM_WORKSPACE_LOST', loss: { reason: 'sandbox-expired', terminationProven: true,
        artifacts: [{ id: 'remote-artifact:file:a.txt', sourceAttemptId: test.harness.request.attemptId }] },
    })
    failure.mockRestore()
    await test.providerFiber.dispose()
    await test.ctx.plugin(RemoteWorkspace, { artifactProvider: 'remote-artifacts' })
    test.sandbox.getInfo.mockRejectedValue(new SandboxNotFoundError('sandbox remains expired'))
    await expect(test.ctx.teamWorkspaces.restore('remote', test.harness.request, allocation)).rejects.toMatchObject({
      code: 'TEAM_WORKSPACE_LOST', loss: { artifacts: [{ id: 'remote-artifact:file:a.txt' }], terminationProven: true },
    })
    expect(new TextDecoder().decode(await test.harness.reads('remote-artifacts', { reference: { id: 'remote-artifact:file:a.txt' } }))).toBe('retained bytes')
    await test.ctx.fiber.dispose()
  })

  it('notifies an active allocation about definite sandbox loss and retries rejected consumer settlement', async () => {
    const test = await setup({ lossPollIntervalMs: 5 })
    const preparation = await test.ctx.teamWorkspaces.prepare('remote', test.harness.request)
    const allocation = await test.ctx.teamWorkspaces.materialize('remote', test.harness.request, preparation)
    const listener = vi.fn(async () => {})
    listener.mockRejectedValueOnce(new Error('durable cursor conflict'))
    const stop = allocation.onLoss?.(listener)
    test.sandbox.getInfo.mockRejectedValue(new SandboxNotFoundError('sandbox expired'))
    await vi.waitFor(() => { expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2) })
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'sandbox-expired', terminationProven: true }))
    await allocation.release()
    stop?.()
    await test.ctx.fiber.dispose()
  })

  it('keeps network uncertainty distinct from loss and refuses to restore an allocation in another sandbox', async () => {
    const test = await setup()
    const preparation = await test.ctx.teamWorkspaces.prepare('remote', test.harness.request)
    const allocation = await test.ctx.teamWorkspaces.materialize('remote', test.harness.request, preparation)
    const listener = vi.fn(async () => {})
    allocation.onLoss?.(listener)
    test.sandbox.getInfo.mockRejectedValueOnce(new Error('network partition'))
    await expect(test.ctx.teamWorkspaces.publish('remote', { allocation })).rejects.toThrow('network partition')
    expect(listener).not.toHaveBeenCalled()
    test.e2b.getSandbox.mockResolvedValue({ ...test.sandbox, sandboxId: 'replacement-world' })
    await expect(test.ctx.teamWorkspaces.restore('remote', test.harness.request, allocation)).rejects.toMatchObject({
      code: 'TEAM_WORKSPACE_LOST', loss: { reason: 'world-changed', terminationProven: false,
        executionWorld: { id: 'fake-sandbox' } },
    })
    await test.ctx.fiber.dispose()
  })

  it('normalizes remote roots and rejects escapes or provider-state overlap', async () => {
    const remote = new FakeRemoteFilesystem()
    const e2b = {
      runtimeRoot: '/runtime/.clocky-e2b',
      getSandbox: vi.fn(async () => ({ sandboxId: 'fake-sandbox', files: remote.files, getInfo: vi.fn(async () => ({ sandboxId: 'fake-sandbox' })) })),
    }
    const ctx = new Context()
    ctx.provide('e2b', e2b as never)
    await ctx.plugin(TeamWorkspaceRegistry)

    expect(() => { RemoteWorkspace.apply(ctx, {
      workspaceParent: '/runtime/.clocky-e2b/../escape',
    }) }).toThrow('workspaceParent must be inside the E2B runtime root')
    expect(() => { RemoteWorkspace.apply(ctx, {
      workspaceParent: '/runtime/.clocky-e2b/workspaces',
      integrationRoot: '/runtime/.clocky-e2b/workspaces',
    }) }).toThrow('integrationRoot and workspaceParent must not overlap')
    expect(() => { RemoteWorkspace.apply(ctx, {
      workspaceParent: '/runtime/.clocky-e2b/workspaces',
      integrationRoot: '/runtime/.clocky-e2b/workspaces/../workspaces/targets',
    }) }).toThrow('integrationRoot and workspaceParent must not overlap')

    RemoteWorkspace.apply(ctx, {
      workspaceParent: '/runtime/.clocky-e2b/workspaces/./nested/..',
    })
    const provider = ctx.teamWorkspaces.getProvider('remote-e2b')
    if (provider === undefined) throw new Error('E2B remote provider was not registered')
    const config = provider as unknown as { readonly config: { readonly workspaceParent: string } }
    expect(config.config.workspaceParent).toBe('/runtime/.clocky-e2b/workspaces')
    await ctx.fiber.dispose()
  })

  it('rejects invalid provider configuration before registration', () => {
    const ctx = new Context()
    ctx.provide('e2b', {
      runtimeRoot: '/runtime/.clocky-e2b',
      getSandbox: vi.fn(),
    } as never)

    expect(() => { RemoteWorkspace.apply(ctx, { workspaceParent: 'relative' }) })
      .toThrow('workspaceParent must be an absolute POSIX path')
    expect(() => { RemoteWorkspace.apply(ctx, { providerName: ' ' }) }).toThrow('providerName must be non-empty')
    expect(() => { RemoteWorkspace.apply(ctx, {
      integrationEnabled: true,
    }) }).toThrow('artifactProvider is required')
    expect(() => { RemoteWorkspace.apply(ctx, {
      workspaceParent: '/runtime/.clocky-e2b/workspaces',
      integrationRoot: '/runtime/outside',
    }) }).toThrow('integrationRoot must be inside')
    expect(() => { RemoteWorkspace.apply(ctx, {
      workspaceParent: '/runtime/.clocky-e2b/workspaces',
      artifactProvider: ' ',
    }) }).toThrow('artifactProvider must be non-empty')
    expect(() => { RemoteWorkspace.apply(ctx, {
      workspaceParent: '/runtime/.clocky-e2b/workspaces',
      maxArtifactBytes: 0,
    }) }).toThrow('maxArtifactBytes must be a positive safe integer')
    expect(() => { RemoteWorkspace.apply(ctx, {
      workspaceParent: '/runtime/.clocky-e2b/workspaces\0invalid',
    }) }).toThrow('workspaceParent must not contain a NUL byte')
  })

  it('covers eligibility fences, fallback artifacts, abandonment, and provider-owned reconciliation', async () => {
    const { ctx, harness, remote } = await setup({ artifact: false })
    const provider = ctx.teamWorkspaces.getProvider('remote-e2b')
    if (provider === undefined) throw new Error('E2B remote provider was not registered')
    await expect(provider.eligible({ task: harness.task, binding: harness.binding })).resolves.toBe(true)
    await expect(provider.eligible({ task: { ...harness.task, workspaceMode: 'sandbox' } as never, binding: harness.binding })).resolves.toBe(false)

    const variants = [
      { ...harness.state, team: { ...harness.state.team, phase: 'completed' } },
      { ...harness.state, tasks: [] },
      { ...harness.state, tasks: [{ ...harness.task, revision: harness.task.revision + 1 }] },
      { ...harness.state, participants: [{ ...harness.state.participants[0], phase: 'left' as const }] },
      { ...harness.state, activations: [] },
      { ...harness.state, activations: [{ ...harness.binding, provider: 'other' }] },
      { ...harness.state, activations: [{ ...harness.binding, activation: { ...harness.binding.activation, status: 'offline' as const } }] },
    ]
    for (const state of variants) {
      harness.teams.getTeam.mockResolvedValue(state as never)
      await expect(provider.eligible({ task: harness.task, binding: harness.binding })).resolves.toBe(false)
    }
    harness.teams.getTeam.mockResolvedValue(harness.state)
    harness.agents.get.mockReturnValue(undefined as never)
    await expect(provider.eligible({ task: harness.task, binding: harness.binding })).resolves.toBe(false)
    harness.agents.get.mockReturnValue({ session: { id: harness.request.sessionId } } as never)

    const abandoned = await ctx.teamWorkspaces.prepare('remote', harness.request)
    await abandoned.abandon()
    await abandoned.abandon()
    await expect(abandoned.materialize()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const preparation = await ctx.teamWorkspaces.prepare('remote', harness.request)
    await expect(ctx.teamWorkspaces.prepare('remote', harness.request)).resolves.toBe(preparation)
    const allocation = await ctx.teamWorkspaces.materialize('remote', harness.request, preparation)
    await expect(preparation.materialize()).resolves.toBe(allocation)
    await expect(provider.restore(harness.request, { ...allocation, id: 'forged' as never })).rejects.toMatchObject({
      code: 'TEAM_INVALID_ARGUMENT',
    })
    remote.file(`${allocation.root}/output.txt`, 'output')
    const published = await ctx.teamWorkspaces.publish('remote', { allocation })
    expect(published.artifacts).toMatchObject([{
      kind: 'file',
      uri: `e2b://fake-sandbox${allocation.root}/output.txt`,
      sourceAttemptId: harness.request.attemptId,
    }])

    const internals = provider as unknown as {
      readonly allocations: Map<string, TeamWorkspaceAllocation>
      readonly preparations: Map<string, unknown>
    }
    await expect(ctx.teamWorkspaces.restore('remote', harness.request, allocation)).resolves.toBe(allocation)
    internals.allocations.clear()
    internals.preparations.clear()
    const restored = await ctx.teamWorkspaces.restore('remote', harness.request, allocation)
    expect(restored.root).toBe(allocation.root)
    await expect(provider.reconcileRelease(harness.request, { ...allocation, id: 'forged' as never })).rejects.toMatchObject({
      code: 'TEAM_INVALID_ARGUMENT',
    })
    await provider.reconcileRelease(harness.request, allocation)
    await ctx.teamWorkspaces.reconcileRelease('remote', harness.request, allocation)
    expect([...remote.nodes.keys()]).not.toContain(allocation.root)
    await ctx.fiber.dispose()
  })

  it('enforces entry and artifact-size bounds during remote publication', async () => {
    const bounded = await setup({ artifact: false, maxEntriesPerPublish: 1 })
    const preparation = await bounded.ctx.teamWorkspaces.prepare('remote', bounded.harness.request)
    const allocation = await bounded.ctx.teamWorkspaces.materialize('remote', bounded.harness.request, preparation)
    bounded.remote.file(`${allocation.root}/first.txt`, 'first')
    bounded.remote.file(`${allocation.root}/second.txt`, 'second')
    await expect(bounded.ctx.teamWorkspaces.publish('remote', { allocation })).rejects.toMatchObject({
      code: 'TEAM_INVALID_ARGUMENT',
    })
    await allocation.release()
    await bounded.ctx.fiber.dispose()

    const sized = await setup({ artifact: false, maxArtifactBytes: 3 })
    const sizedPreparation = await sized.ctx.teamWorkspaces.prepare('remote', sized.harness.request)
    const sizedAllocation = await sized.ctx.teamWorkspaces.materialize('remote', sized.harness.request, sizedPreparation)
    sized.remote.file(`${sizedAllocation.root}/large.txt`, 'large')
    await expect(sized.ctx.teamWorkspaces.publish('remote', { allocation: sizedAllocation })).resolves.toMatchObject({
      changedPaths: ['large.txt'],
      artifacts: [],
      accepted: false,
    })
    await sizedAllocation.release()
    await sized.ctx.fiber.dispose()
  })

  it('rejects disabled integration and integration without an artifact store', async () => {
    const source = { teamId: 'remote-team' as never, taskId: 'remote-task' as never, attemptId: 'remote-attempt' as never }
    const patch = encodeTeamWorkspaceChangeSet({
      provider: 'remote-e2b',
      sourceAttemptId: source.attemptId,
      changes: [{ path: 'result.txt', kind: 'file' as const, data: 'cmVzdWx0' }],
    }, 4096)
    const disabled = await setup()
    const disabledArtifact = await disabled.harness.saves('remote-artifacts', {
      name: 'disabled', sourceAttemptId: source.attemptId, kind: 'patch', visibility: 'team', data: patch,
    })
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { ...source, artifacts: [disabledArtifact] },
      integrationTaskId: 'remote-disabled-task' as never,
      integrationAttemptId: 'remote-disabled-attempt' as never,
      target: 'main',
      mode: 'integrate',
    }
    await expect(disabled.ctx.teamWorkspaces.integrateSource('remote-e2b', request)).rejects.toMatchObject({
      code: 'TEAM_POLICY_DENIED',
    })
    await disabled.ctx.fiber.dispose()

    const missing = await setup({ integration: true, artifact: false })
    await expect(missing.ctx.teamWorkspaces.integrateSource('remote-e2b', {
      ...request,
      integrationTaskId: 'remote-missing-store-task' as never,
      integrationAttemptId: 'remote-missing-store-attempt' as never,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await missing.ctx.fiber.dispose()
  })

  it('allocates an isolated remote root after reservation, publishes bounded files, restores, and releases', async () => {
    const { ctx, harness, remote } = await setup()
    const preparation = await ctx.teamWorkspaces.prepare('remote', harness.request)
    expect('root' in preparation).toBe(false)
    const [allocation, concurrent] = await Promise.all([
      ctx.teamWorkspaces.materialize('remote', harness.request, preparation),
      preparation.materialize(),
    ])
    expect(concurrent).toBe(allocation)
    expect(allocation.root).toContain('/runtime/.clocky-e2b/team-workspaces/allocations/')
    remote.file(`${allocation.root}/result.txt`, 'remote result\n')
    remote.file(`${allocation.root}/nested/value.txt`, 'nested\n')
    const published = await ctx.teamWorkspaces.publish('remote', { allocation })
    expect(published).toMatchObject({
      teamId: harness.request.teamId,
      taskId: harness.request.taskId,
      attemptId: harness.request.attemptId,
      accepted: false,
      changedPaths: ['nested/value.txt', 'result.txt'],
    })
    expect(published.artifacts).toHaveLength(2)
    expect(harness.saves).toHaveBeenCalledTimes(2)

    const provider = ctx.teamWorkspaces.getProvider('remote-e2b')
    if (provider === undefined) throw new Error('E2B remote provider was not registered')
    const internals = provider as unknown as {
      readonly allocations: Map<string, TeamWorkspaceAllocation>
      readonly preparations: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()
    const restored = await ctx.teamWorkspaces.restore('remote', harness.request, allocation)
    expect(restored.root).toBe(allocation.root)
    await restored.release()
    expect([...remote.nodes.keys()].some(path => path === allocation.root || path.startsWith(`${allocation.root}/`))).toBe(false)
    await ctx.fiber.dispose()
  })

  it('fails closed when E2B is unavailable, when a manifest is tampered with, and for policy denial', async () => {
    const { ctx, harness, e2b, remote } = await setup()
    e2b.getSandbox.mockRejectedValue(new Error('sandbox expired'))
    await expect(ctx.teamWorkspaces.eligible('remote', { task: harness.task, binding: harness.binding })).resolves.toBe(false)
    await expect(ctx.teamWorkspaces.prepare('remote', harness.request)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    e2b.getSandbox.mockResolvedValue({ sandboxId: 'fake-sandbox', files: remote.files, getInfo: vi.fn(async () => ({ sandboxId: 'fake-sandbox' })) })
    harness.teams.authorize.mockResolvedValue({ kind: 'deny', message: 'remote denied' } as never)
    await expect(ctx.teamWorkspaces.prepare('remote', harness.request)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    harness.teams.authorize.mockResolvedValue({ kind: 'allow' } as never)
    const preparation = await ctx.teamWorkspaces.prepare('remote', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('remote', harness.request, preparation)
    const manifest = [...remote.nodes.keys()].find(path => path.endsWith('.json') && path.includes('/manifests/'))
    if (manifest === undefined) throw new Error('remote provider manifest was not written')
    await remote.files.write(manifest, '{}')
    await expect(allocation.release()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await ctx.fiber.dispose()
  })

  it('rejects missing remote manifests and cleans up a failed first materialization', async () => {
    const missingManifest = await setup()
    const preparation = await missingManifest.ctx.teamWorkspaces.prepare('remote', missingManifest.harness.request)
    const allocation = await missingManifest.ctx.teamWorkspaces.materialize('remote', missingManifest.harness.request, preparation)
    const manifest = [...missingManifest.remote.nodes.keys()].find(path => path.includes('/manifests/'))
    if (manifest === undefined) throw new Error('remote provider manifest was not written')
    await missingManifest.remote.files.remove(manifest)
    const provider = missingManifest.ctx.teamWorkspaces.getProvider('remote-e2b')
    if (provider === undefined) throw new Error('E2B remote provider was not registered')
    const internals = provider as unknown as {
      readonly allocations: Map<string, TeamWorkspaceAllocation>
      readonly preparations: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()
    await expect(missingManifest.ctx.teamWorkspaces.restore('remote', missingManifest.harness.request, allocation))
      .rejects.toMatchObject({ code: 'TEAM_WORKSPACE_LOST', loss: { reason: 'manifest-missing', terminationProven: false } })
    await expect(missingManifest.ctx.teamWorkspaces.reconcileRelease('remote', missingManifest.harness.request, allocation))
      .rejects.toMatchObject({ code: 'TEAM_WORKSPACE_LOST', loss: { reason: 'manifest-missing', terminationProven: false } })
    await missingManifest.remote.files.remove(allocation.root)
    await missingManifest.ctx.fiber.dispose()

    const failed = await setup()
    const failedProvider = failed.ctx.teamWorkspaces.getProvider('remote-e2b')
    if (failedProvider === undefined) throw new Error('E2B remote provider was not registered')
    const originalWrite = failed.remote.files.write
    vi.spyOn(failed.remote.files, 'write').mockRejectedValueOnce(new Error('manifest write failed'))
    const failedPreparation = await failed.ctx.teamWorkspaces.prepare('remote', failed.harness.request)
    await expect(failed.ctx.teamWorkspaces.materialize('remote', failed.harness.request, failedPreparation)).rejects.toThrow('manifest write failed')
    expect([...failed.remote.nodes.keys()].some(path => path.includes('/allocations/'))).toBe(false)
    vi.spyOn(failed.remote.files, 'write').mockImplementation(originalWrite)
    await failed.ctx.fiber.dispose()
  })

  it('publishes a portable patch and integrates it into a remote target with an expected-version fence', async () => {
    const { ctx, harness, remote } = await setup({ integration: true })
    const preparation = await ctx.teamWorkspaces.prepare('remote', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('remote', harness.request, preparation)
    remote.file(`${allocation.root}/result.txt`, 'remote result\n')
    const published = await ctx.teamWorkspaces.publish('remote', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('remote patch artifact was not published')
    expect(published.artifacts).toHaveLength(2)

    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId: harness.request.teamId, taskId: harness.request.taskId, attemptId: harness.request.attemptId, artifacts: [patch] },
      integrationTaskId: 'remote-integration-task' as never,
      integrationAttemptId: 'remote-integration-attempt' as never,
      target: 'main',
      expectedTarget: 'missing',
      mode: 'integrate',
      actorId: harness.request.participantId,
    }
    const integrated = await ctx.teamWorkspaces.integrateSource('remote-e2b', request)
    expect(integrated).toMatchObject({ status: 'integrated', target: 'main', artifact: patch })
    expect(new TextDecoder().decode(remote.nodes.get('/runtime/.clocky-e2b/team-integrations/main/result.txt')?.data)).toBe('remote result\n')
    const markerPath = [...remote.nodes.keys()].find(path => path.includes('/integration-markers/') && path.endsWith('.json'))
    if (markerPath === undefined) throw new Error('remote integration marker was not written')
    const markerText = await remote.files.read(markerPath, { format: 'text' })
    if (typeof markerText !== 'string') throw new Error('remote integration marker was not text')
    const marker = JSON.parse(markerText) as Record<string, unknown>
    await remote.files.remove('/runtime/.clocky-e2b/team-integrations/main')
    await remote.files.write(markerPath, JSON.stringify({ ...marker, status: 'prepared', targetVersion: undefined, targetCreated: true }))
    await expect(ctx.teamWorkspaces.integrateSource('remote-e2b', request)).resolves.toEqual(integrated)
    await expect(ctx.teamWorkspaces.integrateSource('remote-e2b', request)).resolves.toEqual(integrated)
    await expect(ctx.teamWorkspaces.integrateSource('remote-e2b', { ...request, expectedTarget: 'wrong' }))
      .resolves.toMatchObject({ status: 'conflict', artifact: patch })

    const largeTarget = '/runtime/.clocky-e2b/team-integrations/large-target'
    const largeFile = `${largeTarget}/large.bin`
    await remote.files.makeDir(largeTarget)
    remote.file(largeFile, 'a'.repeat(4_100))
    const largeIntegrated = await ctx.teamWorkspaces.integrateSource('remote-e2b', {
      ...request,
      target: 'large-target',
      expectedTarget: undefined,
      integrationTaskId: 'remote-large-task' as never,
      integrationAttemptId: 'remote-large-attempt' as never,
    })
    expect(largeIntegrated.status).toBe('integrated')
    const originalLarge = remote.nodes.get(largeFile)
    if (originalLarge === undefined) throw new Error('large remote target file was not written')
    remote.nodes.set(largeFile, {
      ...originalLarge,
      data: new TextEncoder().encode('b'.repeat(4_100)),
      modifiedTime: new Date(originalLarge.modifiedTime.getTime() + 1),
    })
    await expect(ctx.teamWorkspaces.integrateSource('remote-e2b', {
      ...request,
      target: 'large-target',
      expectedTarget: undefined,
      integrationTaskId: 'remote-large-task' as never,
      integrationAttemptId: 'remote-large-attempt' as never,
    })).resolves.toMatchObject({ status: 'conflict', artifact: patch })

    const interruptedRequest = {
      ...request,
      target: 'interrupted-target',
      expectedTarget: 'missing',
      integrationTaskId: 'remote-interrupted-task' as never,
      integrationAttemptId: 'remote-interrupted-attempt' as never,
    }
    const originalWrite = remote.files.write
    const writeSpy = vi.spyOn(remote.files, 'write').mockImplementation(async (path, data) => {
      if (path.endsWith('/result.txt')) throw new Error('remote write interrupted')
      return await originalWrite(path, data)
    })
    await expect(ctx.teamWorkspaces.integrateSource('remote-e2b', interruptedRequest)).rejects.toThrow('remote write interrupted')
    writeSpy.mockRestore()
    const interruptedMarker = [...remote.nodes.values()]
      .find(node => node.type === FileType.FILE && new TextDecoder().decode(node.data).includes('"target":"interrupted-target"'))
    expect(interruptedMarker).toBeDefined()
    await expect(ctx.teamWorkspaces.integrateSource('remote-e2b', interruptedRequest)).resolves.toMatchObject({
      status: 'integrated',
      target: 'interrupted-target',
    })
    await allocation.release()
    await ctx.fiber.dispose()
  })

  it('fails closed for integration policy, malformed patches, unsafe targets, and remote target types', async () => {
    const { ctx, harness, remote } = await setup({ integration: true })
    const preparation = await ctx.teamWorkspaces.prepare('remote', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('remote', harness.request, preparation)
    remote.file(`${allocation.root}/output.txt`, 'output\n')
    const published = await ctx.teamWorkspaces.publish('remote', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('remote patch artifact was not published')
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId: harness.request.teamId, taskId: harness.request.taskId, attemptId: harness.request.attemptId, artifacts: [patch] },
      integrationTaskId: 'remote-boundary-task' as never,
      integrationAttemptId: 'remote-boundary-attempt' as never,
      target: 'main',
      mode: 'integrate',
    }

    harness.teams.authorize.mockResolvedValue({ kind: 'deny', message: 'integration denied' } as never)
    await expect(ctx.teamWorkspaces.integrateSource('remote-e2b', request)).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    expect(harness.reads).not.toHaveBeenCalled()
    harness.teams.authorize.mockResolvedValue({ kind: 'allow' } as never)
    await expect(ctx.teamWorkspaces.integrateSource('remote-e2b', { ...request, target: '../escape' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.teamWorkspaces.integrateSource('remote-e2b', { ...request, target: '.' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const malformed = await harness.saves('remote-artifacts', {
      name: 'malformed',
      sourceAttemptId: harness.request.attemptId,
      kind: 'patch',
      visibility: 'team',
      data: 'not-json',
    })
    await expect(ctx.teamWorkspaces.integrateSource('remote-e2b', {
      ...request,
      source: { ...request.source, artifacts: [malformed] },
      integrationTaskId: 'remote-malformed-task' as never,
      integrationAttemptId: 'remote-malformed-attempt' as never,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const makePatch = (name: string, changes: Parameters<typeof encodeTeamWorkspaceChangeSet>[0]['changes']): Promise<TeamArtifactReference> => harness.saves('remote-artifacts', {
      name,
      sourceAttemptId: harness.request.attemptId,
      kind: 'patch',
      visibility: 'team',
      data: encodeTeamWorkspaceChangeSet({ provider: 'remote-e2b', sourceAttemptId: harness.request.attemptId, changes }, 4096),
    })
    const integrate = (artifact: TeamArtifactReference, target: string, suffix: string): Promise<unknown> => ctx.teamWorkspaces.integrateSource('remote-e2b', {
      ...request,
      source: { ...request.source, artifacts: [artifact] },
      target,
      expectedTarget: undefined,
      integrationTaskId: `remote-${suffix}-task` as never,
      integrationAttemptId: `remote-${suffix}-attempt` as never,
    })

    const existing = '/runtime/.clocky-e2b/team-integrations/existing'
    await remote.files.makeDir(existing)
    remote.file(`${existing}/old.txt`, 'old\n')
    await expect(integrate(patch, 'existing', 'existing')).resolves.toMatchObject({ status: 'integrated' })
    expect(new TextDecoder().decode(remote.nodes.get(`${existing}/old.txt`)?.data)).toBe('old\n')

    const fileTarget = '/runtime/.clocky-e2b/team-integrations/file-target'
    remote.file(fileTarget, 'not a directory')
    await expect(integrate(patch, 'file-target', 'file-target')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const symlinkTarget = '/runtime/.clocky-e2b/team-integrations/symlink-target'
    remote.symlink(symlinkTarget, '/outside')
    await expect(integrate(patch, 'symlink-target', 'symlink-target')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const childSymlinkTarget = '/runtime/.clocky-e2b/team-integrations/child-symlink'
    await remote.files.makeDir(childSymlinkTarget)
    remote.symlink(`${childSymlinkTarget}/output.txt`, '/outside/output.txt', FileType.FILE)
    await expect(integrate(patch, 'child-symlink', 'child-symlink')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const otherTarget = '/runtime/.clocky-e2b/team-integrations/other-target'
    await remote.files.makeDir(otherTarget)
    remote.other(`${otherTarget}/output.txt`)
    await expect(integrate(patch, 'other-target', 'other-target')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const symlinkChange = await makePatch('symlink-change', [{ path: 'link', kind: 'symlink', target: 'output.txt' }])
    await expect(integrate(symlinkChange, 'symlink-change', 'symlink-change')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const deleteDirectory = await makePatch('delete-directory', [{ path: 'dir', kind: 'delete' }])
    const deleteTarget = '/runtime/.clocky-e2b/team-integrations/delete-target'
    await remote.files.makeDir(`${deleteTarget}/dir`)
    await expect(integrate(deleteDirectory, 'delete-target', 'delete-directory')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const replaceDirectory = await makePatch('replace-directory', [{ path: 'dir', kind: 'file', data: 'bmV3' }])
    await expect(integrate(replaceDirectory, 'delete-target', 'replace-directory')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await allocation.release()
    await ctx.fiber.dispose()
  })

  it('reuses durable remote roots and preserves cleanup after provider boundary failures', async () => {
    const reused = await setup()
    const preparation = await reused.ctx.teamWorkspaces.prepare('remote', reused.harness.request)
    const allocation = await preparation.materialize()
    const provider = reused.ctx.teamWorkspaces.getProvider('remote-e2b')
    if (provider === undefined) throw new Error('E2B remote provider was not registered')
    const internals = provider as unknown as {
      readonly allocations: Map<string, TeamWorkspaceAllocation>
    }
    internals.allocations.clear()
    const reopened = await preparation.materialize()
    expect(reopened.root).toBe(allocation.root)
    await reopened.release()
    await reopened.release()
    await allocation.release()
    await reused.ctx.fiber.dispose()

    const concurrent = await setup()
    const concurrentPreparation = await concurrent.ctx.teamWorkspaces.prepare('remote', concurrent.harness.request)
    const originalMakeDir = concurrent.remote.files.makeDir
    const makeDirSpy = vi.spyOn(concurrent.remote.files, 'makeDir').mockImplementation(async (path) => {
      if (path.includes('/allocations/')) return false
      return await originalMakeDir(path)
    })
    await expect(concurrentPreparation.materialize()).rejects.toThrow('was created concurrently')
    makeDirSpy.mockRestore()
    await concurrent.ctx.fiber.dispose()

    const manifest = await setup()
    const manifestPreparation = await manifest.ctx.teamWorkspaces.prepare('remote', manifest.harness.request)
    const manifestAllocation = await manifestPreparation.materialize()
    const manifestProvider = manifest.ctx.teamWorkspaces.getProvider('remote-e2b')
    if (manifestProvider === undefined) throw new Error('E2B remote provider was not registered')
    const manifestInternals = manifestProvider as unknown as {
      readonly allocations: Map<string, TeamWorkspaceAllocation>
    }
    manifestInternals.allocations.clear()
    const originalRead = manifest.remote.files.read
    const readSpy = vi.spyOn(manifest.remote.files, 'read').mockImplementation(async (path, options) => {
      if (path.includes('/manifests/')) throw new Error('manifest transport failed')
      return await originalRead(path, options)
    })
    await expect(manifest.ctx.teamWorkspaces.restore('remote', manifest.harness.request, manifestAllocation))
      .rejects.toThrow('manifest transport failed')
    readSpy.mockRestore()

    const manifestPath = [...manifest.remote.nodes.keys()].find(path => path.includes('/manifests/'))
    if (manifestPath === undefined) throw new Error('remote provider manifest was not written')
    await manifest.remote.files.write(manifestPath, 'not-json')
    await expect(manifest.ctx.teamWorkspaces.restore('remote', manifest.harness.request, manifestAllocation))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await manifest.remote.files.remove(manifestAllocation.root)
    manifest.remote.file(manifestAllocation.root, 'not a directory')
    await expect(manifest.ctx.teamWorkspaces.restore('remote', manifest.harness.request, manifestAllocation))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await manifest.ctx.fiber.dispose()

    const infoFailure = await setup()
    const infoPreparation = await infoFailure.ctx.teamWorkspaces.prepare('remote', infoFailure.harness.request)
    const infoAllocation = await infoPreparation.materialize()
    const originalGetInfo = infoFailure.remote.files.getInfo
    const infoSpy = vi.spyOn(infoFailure.remote.files, 'getInfo').mockImplementation(async (path) => {
      if (path === infoAllocation.root) throw new Error('remote info transport failed')
      return await originalGetInfo(path)
    })
    const infoProvider = infoFailure.ctx.teamWorkspaces.getProvider('remote-e2b')
    if (infoProvider === undefined) throw new Error('E2B remote provider was not registered')
    const infoInternals = infoProvider as unknown as {
      readonly allocations: Map<string, TeamWorkspaceAllocation>
    }
    infoInternals.allocations.clear()
    await expect(infoFailure.ctx.teamWorkspaces.restore('remote', infoFailure.harness.request, infoAllocation))
      .rejects.toThrow('remote info transport failed')
    infoSpy.mockRestore()
    await infoFailure.ctx.fiber.dispose()

    const cleanup = await setup()
    const cleanupPreparation = await cleanup.ctx.teamWorkspaces.prepare('remote', cleanup.harness.request)
    const cleanupAllocation = await cleanupPreparation.materialize()
    const originalRemove = cleanup.remote.files.remove
    const removeSpy = vi.spyOn(cleanup.remote.files, 'remove').mockImplementation(async (path) => {
      if (path === cleanupAllocation.root) throw new Error('remote cleanup transport failed')
      await originalRemove(path)
    })
    await expect(cleanupAllocation.release()).rejects.toThrow('remote cleanup transport failed')
    removeSpy.mockRestore()
    await cleanupAllocation.release()
    await cleanup.ctx.fiber.dispose()
  })

  it('enforces remote integration marker, target-version, and ancestor fences', async () => {
    const { ctx, harness, remote } = await setup({ integration: true })
    const preparation = await ctx.teamWorkspaces.prepare('remote', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('remote', harness.request, preparation)
    remote.file(`${allocation.root}/result.txt`, 'remote result\n')
    const published = await ctx.teamWorkspaces.publish('remote', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('remote patch artifact was not published')
    const makeRequest = (target: string, suffix: string, expectedTarget?: string): TeamWorkspaceSourceIntegrateRequest => ({
      source: { teamId: harness.request.teamId, taskId: harness.request.taskId, attemptId: harness.request.attemptId, artifacts: [patch] },
      integrationTaskId: `remote-fence-${suffix}-task` as never,
      integrationAttemptId: `remote-fence-${suffix}-attempt` as never,
      target,
      ...expectedTarget === undefined ? {} : { expectedTarget },
      mode: 'integrate',
    })
    const integrate = (request: TeamWorkspaceSourceIntegrateRequest): Promise<unknown> => ctx.teamWorkspaces.integrateSource('remote-e2b', request)

    await expect(integrate({
      ...makeRequest('validation-target', 'empty-source'),
      source: { ...makeRequest('validation-target', 'empty-source').source, teamId: '' as never },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(integrate(makeRequest('', 'empty-target'))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(integrate(makeRequest(' ', 'whitespace-target'))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const expectedConflict = '/runtime/.clocky-e2b/team-integrations/expected-conflict'
    await remote.files.makeDir(expectedConflict)
    remote.file(`${expectedConflict}/foreign.txt`, 'foreign')
    await expect(integrate(makeRequest('expected-conflict', 'expected', 'wrong')))
      .resolves.toMatchObject({ status: 'conflict', artifact: patch })

    const racedTarget = '/runtime/.clocky-e2b/team-integrations/raced-target'
    await remote.files.makeDir(racedTarget)
    const originalGetInfo = remote.files.getInfo
    const raceSpy = vi.spyOn(remote.files, 'getInfo').mockImplementation(async (path) => {
      try {
        return await originalGetInfo(path)
      } catch (error: unknown) {
        if (path.includes('/integration-markers/') && error instanceof FileNotFoundError) remote.file(`${racedTarget}/foreign.txt`, 'foreign')
        throw error
      }
    })
    await expect(integrate(makeRequest('raced-target', 'raced')))
      .resolves.toMatchObject({ status: 'conflict', artifact: patch })
    raceSpy.mockRestore()

    const markerRequest = makeRequest('marker-target', 'marker')
    await expect(integrate(markerRequest)).resolves.toMatchObject({ status: 'integrated' })
    const markerEntry = [...remote.nodes.entries()].find(([path, node]) =>
      path.includes('/integration-markers/')
      && node.type === FileType.FILE
      && new TextDecoder().decode(node.data).includes('"target":"marker-target"'))
    if (markerEntry === undefined) throw new Error('remote integration marker was not written')
    const [markerPath, markerNode] = markerEntry
    const marker = JSON.parse(new TextDecoder().decode(markerNode.data)) as Record<string, unknown>
    await remote.files.write(markerPath, JSON.stringify({ ...marker, sourceTaskId: 'wrong-source' }))
    await expect(integrate(markerRequest)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await remote.files.write(markerPath, 'not-json')
    await expect(integrate(markerRequest)).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await remote.files.write(markerPath, JSON.stringify({ ...marker, status: 'prepared', targetVersion: undefined, targetCreated: true }))
    await expect(integrate(markerRequest)).resolves.toMatchObject({ status: 'conflict', artifact: patch })

    const deleteArtifact = await harness.saves('remote-artifacts', {
      name: 'delete-files',
      sourceAttemptId: harness.request.attemptId,
      kind: 'patch',
      visibility: 'team',
      data: encodeTeamWorkspaceChangeSet({
        provider: 'remote-e2b',
        sourceAttemptId: harness.request.attemptId,
        changes: [
          { path: 'remove.txt', kind: 'delete' },
          { path: 'missing.txt', kind: 'delete' },
        ],
      }, 4096),
    })
    const deleteTarget = '/runtime/.clocky-e2b/team-integrations/delete-files'
    await remote.files.makeDir(deleteTarget)
    remote.file(`${deleteTarget}/remove.txt`, 'remove me')
    await expect(integrate({
      ...makeRequest('delete-files', 'delete-files'),
      source: { ...makeRequest('delete-files', 'delete-files').source, artifacts: [deleteArtifact] },
    })).resolves.toMatchObject({ status: 'integrated' })
    expect(remote.nodes.has(`${deleteTarget}/remove.txt`)).toBe(false)

    await expect(integrate(makeRequest('nested/main', 'nested'))).resolves.toMatchObject({ status: 'integrated' })
    remote.file('/runtime/.clocky-e2b/team-integrations/ancestor', 'not a directory')
    await expect(integrate(makeRequest('ancestor/main', 'ancestor'))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await remote.files.remove('/runtime/.clocky-e2b/team-integrations')
    remote.file('/runtime/.clocky-e2b/team-integrations', 'not a directory')
    await expect(integrate(makeRequest('root-failure', 'root-failure'))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await allocation.release()
    await ctx.fiber.dispose()
  })

  it('keeps remote publication bounded when files or encoded patches exceed limits', async () => {
    const empty = await setup({ integration: true })
    const emptyPreparation = await empty.ctx.teamWorkspaces.prepare('remote', empty.harness.request)
    const emptyAllocation = await empty.ctx.teamWorkspaces.materialize('remote', empty.harness.request, emptyPreparation)
    await expect(empty.ctx.teamWorkspaces.publish('remote', { allocation: emptyAllocation })).resolves.toMatchObject({
      changedPaths: [],
      artifacts: [],
    })
    await emptyAllocation.release()
    await empty.ctx.fiber.dispose()

    const oversized = await setup({ integration: true })
    const oversizedPreparation = await oversized.ctx.teamWorkspaces.prepare('remote', oversized.harness.request)
    const oversizedAllocation = await oversized.ctx.teamWorkspaces.materialize('remote', oversized.harness.request, oversizedPreparation)
    oversized.remote.file(`${oversizedAllocation.root}/large.txt`, 'a'.repeat(4_097))
    const oversizedPublished = await oversized.ctx.teamWorkspaces.publish('remote', { allocation: oversizedAllocation })
    expect(oversizedPublished.artifacts.some(artifact => artifact.kind === 'patch')).toBe(false)
    await oversizedAllocation.release()
    await oversized.ctx.fiber.dispose()

    const encoded = await setup({ integration: true, maxIntegrationBytes: 128 })
    const encodedPreparation = await encoded.ctx.teamWorkspaces.prepare('remote', encoded.harness.request)
    const encodedAllocation = await encoded.ctx.teamWorkspaces.materialize('remote', encoded.harness.request, encodedPreparation)
    encoded.remote.file(`${encodedAllocation.root}/small.txt`, 'a')
    const encodedPublished = await encoded.ctx.teamWorkspaces.publish('remote', { allocation: encodedAllocation })
    expect(encodedPublished.artifacts.some(artifact => artifact.kind === 'patch')).toBe(false)
    await encodedAllocation.release()
    await encoded.ctx.fiber.dispose()

    const readBound = await setup({ artifact: false, integration: true, maxArtifactBytes: 3 })
    const readPreparation = await readBound.ctx.teamWorkspaces.prepare('remote', readBound.harness.request)
    const readAllocation = await readBound.ctx.teamWorkspaces.materialize('remote', readBound.harness.request, readPreparation)
    const readPath = `${readAllocation.root}/reported-small.txt`
    readBound.remote.file(readPath, 'a'.repeat(4_097))
    const originalList = readBound.remote.files.list
    const listSpy = vi.spyOn(readBound.remote.files, 'list').mockImplementation(async root =>
      (await originalList(root)).map(entry => ({ ...entry, size: 1 })))
    const readPublished = await readBound.ctx.teamWorkspaces.publish('remote', { allocation: readAllocation })
    expect(readPublished.artifacts).toEqual([])
    listSpy.mockRestore()
    await readAllocation.release()
    await readBound.ctx.fiber.dispose()
  })

  it('rejects malformed remote target listings and non-directory ancestors', async () => {
    const makePatch = async (harness: ReturnType<typeof fixture>, name: string): Promise<TeamArtifactReference> => await harness.saves('remote-artifacts', {
      name,
      sourceAttemptId: harness.request.attemptId,
      kind: 'patch',
      visibility: 'team',
      data: encodeTeamWorkspaceChangeSet({
        provider: 'remote-e2b',
        sourceAttemptId: harness.request.attemptId,
        changes: [{ path: 'result.txt', kind: 'file', data: 'cmVzdWx0' }],
      }, 4096),
    })

    const entries = await setup({ integration: true })
    const preparation = await entries.ctx.teamWorkspaces.prepare('remote', entries.harness.request)
    const allocation = await entries.ctx.teamWorkspaces.materialize('remote', entries.harness.request, preparation)
    const patch = await makePatch(entries.harness, 'listing-entries')
    const target = '/runtime/.clocky-e2b/team-integrations/directory-entry'
    await entries.remote.files.makeDir(target)
    const originalList = entries.remote.files.list
    const directoryEntrySpy = vi.spyOn(entries.remote.files, 'list').mockImplementation(async root => [
      ...(await originalList(root)),
      {
        name: 'nested-directory',
        path: `${root}/nested-directory`,
        type: FileType.DIR,
        size: 0,
        mode: 0o700,
        permissions: 'rwx------',
        owner: 'user',
        group: 'user',
        modifiedTime: new Date(),
      },
    ])
    const request = {
      source: {
        teamId: entries.harness.request.teamId,
        taskId: entries.harness.request.taskId,
        attemptId: entries.harness.request.attemptId,
        artifacts: [patch],
      },
      integrationTaskId: 'remote-listing-task' as never,
      integrationAttemptId: 'remote-listing-attempt' as never,
      target: 'directory-entry',
      mode: 'integrate' as const,
    }
    await expect(entries.ctx.teamWorkspaces.integrateSource('remote-e2b', request)).resolves.toMatchObject({ status: 'integrated' })
    directoryEntrySpy.mockRestore()

    const outOfRootTarget = '/runtime/.clocky-e2b/team-integrations/out-of-root-entry'
    await entries.remote.files.makeDir(outOfRootTarget)
    const outOfRootSpy = vi.spyOn(entries.remote.files, 'list').mockImplementation(async root => [
      ...(await originalList(root)),
      {
        name: 'outside.txt',
        path: '/outside.txt',
        type: FileType.FILE,
        size: 1,
        mode: 0o600,
        permissions: 'rw-------',
        owner: 'user',
        group: 'user',
        modifiedTime: new Date(),
      },
    ])
    await expect(entries.ctx.teamWorkspaces.integrateSource('remote-e2b', {
      ...request,
      target: 'out-of-root-entry',
      integrationTaskId: 'remote-out-of-root-task' as never,
      integrationAttemptId: 'remote-out-of-root-attempt' as never,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    outOfRootSpy.mockRestore()

    const nonFileTarget = '/runtime/.clocky-e2b/team-integrations/non-file-entry'
    await entries.remote.files.makeDir(nonFileTarget)
    const nonFileSpy = vi.spyOn(entries.remote.files, 'list').mockImplementation(async root => [
      ...(await originalList(root)),
      {
        name: 'special',
        path: `${root}/special`,
        type: 'other' as FileType,
        size: 0,
        mode: 0o600,
        permissions: 'rw-------',
        owner: 'user',
        group: 'user',
        modifiedTime: new Date(),
      },
    ])
    await expect(entries.ctx.teamWorkspaces.integrateSource('remote-e2b', {
      ...request,
      target: 'non-file-entry',
      integrationTaskId: 'remote-non-file-task' as never,
      integrationAttemptId: 'remote-non-file-attempt' as never,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    nonFileSpy.mockRestore()
    await allocation.release()
    await entries.ctx.fiber.dispose()

    const limited = await setup({ integration: true, maxEntriesPerPublish: 1 })
    const limitedPreparation = await limited.ctx.teamWorkspaces.prepare('remote', limited.harness.request)
    const limitedAllocation = await limited.ctx.teamWorkspaces.materialize('remote', limited.harness.request, limitedPreparation)
    const limitedTarget = '/runtime/.clocky-e2b/team-integrations/too-many'
    await limited.remote.files.makeDir(limitedTarget)
    limited.remote.file(`${limitedTarget}/one.txt`, 'one')
    limited.remote.file(`${limitedTarget}/two.txt`, 'two')
    const limitedPatch = await makePatch(limited.harness, 'too-many')
    await expect(limited.ctx.teamWorkspaces.integrateSource('remote-e2b', {
      source: { ...request.source, artifacts: [limitedPatch] },
      integrationTaskId: 'remote-too-many-task' as never,
      integrationAttemptId: 'remote-too-many-attempt' as never,
      target: 'too-many',
      mode: 'integrate',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await limitedAllocation.release()
    await limited.ctx.fiber.dispose()

    const large = await setup({ integration: true })
    const largePreparation = await large.ctx.teamWorkspaces.prepare('remote', large.harness.request)
    const largeAllocation = await large.ctx.teamWorkspaces.materialize('remote', large.harness.request, largePreparation)
    const largeTarget = '/runtime/.clocky-e2b/team-integrations/large-metadata'
    await large.remote.files.makeDir(largeTarget)
    large.remote.file(`${largeTarget}/large.bin`, 'a'.repeat(4_097))
    const largePatch = await makePatch(large.harness, 'large-metadata')
    const largeOriginalList = large.remote.files.list
    const largeListSpy = vi.spyOn(large.remote.files, 'list').mockImplementation(async root =>
      (await largeOriginalList(root)).map(entry => ({ ...entry, modifiedTime: undefined })))
    await expect(large.ctx.teamWorkspaces.integrateSource('remote-e2b', {
      source: { ...request.source, artifacts: [largePatch] },
      integrationTaskId: 'remote-large-metadata-task' as never,
      integrationAttemptId: 'remote-large-metadata-attempt' as never,
      target: 'large-metadata',
      mode: 'integrate',
    })).resolves.toMatchObject({ status: 'integrated' })
    largeListSpy.mockRestore()
    await largeAllocation.release()
    await large.ctx.fiber.dispose()
  })

  it('rejects oversized publish scans and forged allocation identities', async () => {
    const { ctx, harness, remote } = await setup()
    const preparation = await ctx.teamWorkspaces.prepare('remote', harness.request)
    const allocation = await ctx.teamWorkspaces.materialize('remote', harness.request, preparation)
    remote.file(`${allocation.root}/one.txt`, 'one')
    await expect(ctx.teamWorkspaces.publish('remote', { allocation: { ...allocation, root: '/other' } }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const provider = ctx.teamWorkspaces.getProvider('remote-e2b')
    if (provider === undefined) throw new Error('E2B remote provider was not registered')
    const config = provider as unknown as { readonly config: { readonly maxEntriesPerPublish: number } }
    expect(config.config.maxEntriesPerPublish).toBeGreaterThan(0)
    await allocation.release()
    await ctx.fiber.dispose()
  })
})
