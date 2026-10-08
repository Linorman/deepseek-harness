import { projectWorkspaceObservation } from '../../team-hub/src/workspace-observation.ts'
import type { TeamSystemWorkspaceAllocationProofSource, TeamWorkspaceObservationRequest } from '@clocky/clocky-team'
import type { TeamWorkspaceAllocationMetadata } from '@clocky/clocky-team-workspace'
import { mkdir, mkdtemp, readFile, readlink, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { dirname, join, parse as parsePath, relative, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import {
  activationIdSchema,
  participantIdSchema,
  taskAttemptIdSchema,
  teamIdSchema,
  teamTaskCreateIdempotencyKeySchema,
  teamTaskIdSchema,
} from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import TeamWorkspaceRegistry, { encodeTeamWorkspaceChangeSet } from '@clocky/clocky-team-workspace'
import type {
  ActivationBindingSnapshot,
  ParticipantSnapshot,
  TaskAttemptId,
  TeamArtifactReference,
  TeamStateSnapshot,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import type {
  TeamWorkspaceAllocation,
  TeamWorkspacePrepareRequest,
  TeamWorkspaceProvider,
  TeamWorkspaceSourceIntegrateRequest,
} from '@clocky/clocky-team-workspace'
import * as SharedWorkspace from '../src/index.ts'

const fsFaults = vi.hoisted(() => ({
  baselineWrite: undefined as 'EACCES' | 'EEXIST' | undefined,
  lstatPath: undefined as string | undefined,
  lstatMode: undefined as 'error' | 'second-error' | 'root-symlink' | undefined,
  lstatCount: 0,
  realpathAliasPath: undefined as string | undefined,
  realpathAliasTarget: undefined as string | undefined,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original,
    async writeFile(...args: Parameters<typeof original.writeFile>) {
      if (fsFaults.baselineWrite !== undefined && typeof args[0] === 'string' && args[0].includes('baseline-')) {
        throw Object.assign(new Error('provider baseline write failed'), { code: fsFaults.baselineWrite })
      }
      await original.writeFile(...args)
    },
    async lstat(...args: Parameters<typeof original.lstat>) {
      if (typeof args[0] !== 'string' || args[0] !== fsFaults.lstatPath) return await original.lstat(...args)
      fsFaults.lstatCount += 1
      if (fsFaults.lstatMode === 'error' || (fsFaults.lstatMode === 'second-error' && fsFaults.lstatCount === 2)) {
        throw Object.assign(new Error('selected metadata lookup failed'), { code: 'EACCES' })
      }
      const info = await original.lstat(...args)
      if (fsFaults.lstatMode === 'root-symlink') Object.assign(info, { uid: 0, isSymbolicLink: () => true })
      return info
    },
    async realpath(...args: Parameters<typeof original.realpath>) {
      if (typeof args[0] === 'string' && args[0] === fsFaults.realpathAliasPath
        && fsFaults.realpathAliasTarget !== undefined) return fsFaults.realpathAliasTarget
      return await original.realpath(...args)
    },
  }
})

type ArtifactSaveInput = {
  readonly kind: TeamArtifactReference['kind']
  readonly sourceAttemptId?: TaskAttemptId
  readonly data: Uint8Array | string
  readonly visibility: TeamArtifactReference['visibility']
  readonly name?: string
}
type ArtifactSave = (provider: string, input: ArtifactSaveInput) => Promise<TeamArtifactReference>
type ArtifactRead = (provider: string, input: { readonly reference: Pick<TeamArtifactReference, 'id'> }) => Promise<Uint8Array>

const teamId = teamIdSchema.parse('shared-workspace-team')
const participantId = participantIdSchema.parse('shared-workspace-worker')
const activationId = activationIdSchema.parse('shared-workspace-activation')
const sessionId = SessionId('shared-workspace-session')
const taskId = teamTaskIdSchema.parse('shared-workspace-task')
const attemptId = taskAttemptIdSchema.parse('shared-workspace-attempt')

const contexts = new Set<Context>()
const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  fsFaults.baselineWrite = undefined
  fsFaults.lstatPath = undefined
  fsFaults.lstatMode = undefined
  fsFaults.lstatCount = 0
  fsFaults.realpathAliasPath = undefined
  fsFaults.realpathAliasTarget = undefined
  const failures: unknown[] = []
  for (const ctx of [...contexts]) {
    try {
      await ctx.fiber.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  contexts.clear()
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'shared Team workspace provider cleanup failed')
})

/** Supply the durable reservation omitted by filesystem-only provider fixtures; the real Hub composition owns lifecycle verification. */
function reserveFixtureAllocation(harness: FakeHarness, metadata: TeamWorkspaceAllocationMetadata): void {
  if (harness.state.workspaceAllocations.some(allocation => allocation.id === metadata.id)) return
  const now = Date.now()
  const { id, provider, mode, teamId, taskId, attemptId, assignedRevision, participantId, activationId, sessionId, baseVersion } = metadata
  harness.state = { ...harness.state, workspaceAllocations: [...harness.state.workspaceAllocations,
    { id, provider, mode, teamId, taskId, attemptId, assignedRevision, participantId, activationId, sessionId,
      ...baseVersion === undefined ? {} : { baseVersion }, revision: 1, lifecycle: 'reserved', reservedAt: now, updatedAt: now }] }
}

/** One mutable fake Team/Agent world exposed through the real workspace registry. */
interface FakeHarness {
  readonly ctx: Context
  readonly provider: TeamWorkspaceProvider
  readonly request: TeamWorkspacePrepareRequest
  readonly task: TeamTaskSnapshot
  readonly binding: ActivationBindingSnapshot
  readonly live: Map<string, { readonly session: { readonly id: SessionId; readonly header: { readonly cwd?: string } } }>
  readonly authorizations: unknown[]
  readonly saves: ArtifactSave
  readonly reads: ArtifactRead
  readonly artifactBytes: Map<string, Uint8Array>
  policy: { readonly kind: 'allow' } | { readonly kind: 'deny'; readonly code: string; readonly message: string }
  state: TeamStateSnapshot
}

/** Create one disposable existing directory below the repository-local test area. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-workspace-shared-'))
  roots.push(root)
  return root
}

/** Build a fully current shared task, lease, local participant, and activation projection. */
function baseline(): {
  readonly task: TeamTaskSnapshot
  readonly binding: ActivationBindingSnapshot
  readonly request: TeamWorkspacePrepareRequest
  readonly state: TeamStateSnapshot
} {
  const binding: ActivationBindingSnapshot = {
    activation: { id: activationId, teamId, participantId, status: 'idle' },
    sessionId,
    provider: 'in-process',
  }
  const task: TeamTaskSnapshot = {
    createdAt: 0,
    execution: { kind: 'participant' },
    id: taskId,
    teamId,
    revision: 3,
    createCommand: {
      creator: { teamId, participantId, activationId, sessionId, provider: 'in-process' },
      idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('shared-workspace-provider-task'),
    },
    subject: 'Shared task',
    description: 'Execute in the configured shared workspace.',
    phase: 'running',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: 'shared',
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
      startedAt: 2,
      durationMs: 60_000,
      renewedAt: 1,
      expiresAt: Date.now() + 60_000,
    },
  }
  const participant: ParticipantSnapshot = {
    id: participantId,
    teamId,
    kind: 'local-agent',
    displayName: 'Shared worker',
    role: 'worker',
    capabilities: [],
    phase: 'active',
  }
  const state = {
    team: {
      id: teamId,
      depth: 0,
      maxTeamDepth: 0,
      goal: { teamId, revision: 1, objective: 'Run shared work.', phase: 'active', budgets: {} },
      phase: 'active',
      cursor: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    goal: { teamId, revision: 1, objective: 'Run shared work.', phase: 'active', budgets: {} },
    rules: {},
    budgets: {},
    participants: [participant],
    activations: [binding],
    tasks: [task],
    workspaceAllocations: [],
    channelIds: [],
  } as TeamStateSnapshot
  return {
    task,
    binding,
    state,
    request: {
      teamId,
      taskId,
      attemptId,
      assignedRevision: 2,
      participantId,
      activationId,
      sessionId,
    },
  }
}

/** Materialize a test allocation through the public two-stage workspace seam. */
async function materialize(harness: FakeHarness): Promise<TeamWorkspaceAllocation> {
  const preparation = await harness.ctx.teamWorkspaces.prepare('shared', harness.request)
  reserveFixtureAllocation(harness, preparation)
  return await harness.ctx.teamWorkspaces.materialize('shared', harness.request, preparation)
}

/** Mount the real workspace registry around a mutable fake Team and live Agent projection. */
async function setup(
  root: string,
  options: string | {
    readonly providerName?: string
    readonly artifact?: boolean
    readonly artifactProvider?: string
    readonly integration?: boolean
    readonly integrationRoot?: string
    readonly allowTeamWorkspacePath?: boolean
    readonly maxArtifactBytes?: number
    readonly maxIntegrationBytes?: number
    readonly observationStateRoot?: string
    readonly observationPulseIntervalMs?: number
    readonly observationMaxAllocationsPerPulse?: number
    readonly observationMaxEntries?: number
    readonly observationMaxPaths?: number
    readonly observationMaxStateBytes?: number
  } = {},
): Promise<FakeHarness & { readonly integrationRoot: string | undefined }> {
  const providerName = typeof options === 'string' ? options : options.providerName
  const artifact = typeof options === 'string' ? false : options.artifact === true
  const integration = typeof options === 'string' ? false : options.integration === true
  const artifactProvider = typeof options === 'string' ? undefined : options.artifactProvider
  const integrationRoot = integration
    ? typeof options === 'string' ? await freshRoot() : options.integrationRoot ?? await freshRoot()
    : undefined
  const initial = baseline()
  const live = new Map<string, { readonly session: { readonly id: SessionId; readonly header: { readonly cwd?: string } } }>([
    [String(sessionId), { session: { id: sessionId, header: { cwd: root } } }],
  ])
  const artifactBytes = new Map<string, Uint8Array>()
  let nextArtifact = 0
  const saves: ArtifactSave = vi.fn(async (
    _provider: string,
    input: ArtifactSaveInput,
  ): Promise<TeamArtifactReference> => {
    const id = `shared-artifact-${String(++nextArtifact)}`
    artifactBytes.set(id, typeof input.data === 'string' ? new TextEncoder().encode(input.data) : Uint8Array.from(input.data))
    return {
      id,
      provider: 'test-artifacts',
      kind: input.kind,
      uri: `artifact://${id}`,
      ...input.sourceAttemptId === undefined ? {} : { sourceAttemptId: input.sourceAttemptId },
      visibility: input.visibility,
    }
  })
  const reads: ArtifactRead = vi.fn(async (_provider: string, input: { readonly reference: Pick<TeamArtifactReference, 'id'> }) => {
    const bytes = artifactBytes.get(input.reference.id)
    if (bytes === undefined) throw new Error(`missing artifact ${input.reference.id}`)
    return Uint8Array.from(bytes)
  })
  const harness: Omit<FakeHarness, 'ctx' | 'provider'> = {
    ...initial,
    live,
    authorizations: [],
    saves,
    reads,
    artifactBytes,
    policy: { kind: 'allow' },
  }
  const ctx = new Context()
  contexts.add(ctx)
  const observationSources = new Set<TeamSystemWorkspaceAllocationProofSource>()
  ctx.provide('teams', {
    registerSystemWorkspaceAllocationProofSource(source: TeamSystemWorkspaceAllocationProofSource) {
      observationSources.add(source)
      return (): void => { observationSources.delete(source) }
    },
    async recordWorkspaceObservation(request: TeamWorkspaceObservationRequest) {
      const { actor, ...input } = request
      expect(() => JSON.stringify(actor)).toThrow('runtime-only')
      const scope = [...observationSources].map(source => source.resolveWorkspaceAllocationProof(actor)).find(value => value !== undefined)
      expect(scope).toEqual({ kind: 'workspace-observe', ...input })
      const allocation = harness.state.workspaceAllocations.find(value => value.id === input.allocationId)
      if (allocation === undefined) throw new Error('Provider fixture omitted durable allocation reservation')
      const observation = projectWorkspaceObservation(allocation, harness.task, input, Date.now())
      harness.state = { ...harness.state, workspaceAllocations: harness.state.workspaceAllocations.map(value =>
        value.id === allocation.id ? { ...value, observation } : value) }
      return observation
    },
    getTeam: async () => harness.state,
    authorize: async (request: unknown) => {
      harness.authorizations.push(request)
      return harness.policy
    },
  } as never)
  ctx.provide('agents', { get: (id: SessionId) => live.get(String(id)) } as never)
  if (artifact) ctx.provide('teamArtifacts', { save: saves, read: reads } as never)
  await ctx.plugin(TeamWorkspaceRegistry)
  await ctx.plugin(SharedWorkspace, {
    root,
    ...(typeof options === 'string' || options.observationStateRoot === undefined ? {} : { observationStateRoot: options.observationStateRoot }),
    ...(typeof options === 'string' || options.observationPulseIntervalMs === undefined ? {} : { observationPulseIntervalMs: options.observationPulseIntervalMs }),
    ...(typeof options === 'string' || options.observationMaxAllocationsPerPulse === undefined ? {} : { observationMaxAllocationsPerPulse: options.observationMaxAllocationsPerPulse }),
    ...(typeof options === 'string' || options.observationMaxEntries === undefined ? {} : { observationMaxEntries: options.observationMaxEntries }),
    ...(typeof options === 'string' || options.observationMaxPaths === undefined ? {} : { observationMaxPaths: options.observationMaxPaths }),
    ...(typeof options === 'string' || options.observationMaxStateBytes === undefined ? {} : { observationMaxStateBytes: options.observationMaxStateBytes }),
    ...(typeof options === 'string' || options.allowTeamWorkspacePath === undefined ? {} : { allowTeamWorkspacePath: options.allowTeamWorkspacePath }),
    ...(providerName === undefined ? {} : { providerName }),
    ...(artifact || artifactProvider !== undefined || integration ? { artifactProvider: artifactProvider ?? 'test-artifacts' } : {}),
    ...(integrationRoot === undefined ? {} : { integrationRoot }),
    ...(integration ? { integrationEnabled: true } : {}),
    ...(integration ? { maxIntegrationBytes: typeof options === 'string' ? 4096 : options.maxIntegrationBytes ?? 4096 } : {}),
    ...(artifact || artifactProvider !== undefined
      ? { maxArtifactBytes: typeof options === 'string' ? 4096 : options.maxArtifactBytes ?? 4096 }
      : {}),
  })
  const provider = ctx.teamWorkspaces.getProvider(providerName ?? 'shared-local')
  if (provider === undefined) throw new Error('shared workspace provider did not register')
  return Object.assign(harness, { ctx, provider, saves, reads, artifactBytes, integrationRoot })
}

describe('shared Team workspace provider', () => {
  it('preflights only a current shared route with a canonical available workspace', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { allowTeamWorkspacePath: true })
    const provider = harness.provider
    if (provider.preflight === undefined) throw new Error('shared provider has no preflight')
    const preflight = provider.preflight.bind(provider)
    const participant = harness.state.participants[0]
    if (participant === undefined) throw new Error('shared fixture has no participant')
    const route = { provider: 'in-process', model: 'test/model', cwd: root }
    const check = (task = harness.task, candidate = participant, cwd = route.cwd) =>
      preflight({ task, participant: candidate, route: { ...route, cwd } })
    expect(await check()).toBe(true)
    expect(await check({ ...harness.task, workspaceMode: 'sandbox' })).toBe(false)
    expect(await check(harness.task, { ...participant, teamId: teamIdSchema.parse('other-team') })).toBe(false)
    expect(await check(harness.task, { ...participant, phase: 'provisioning' })).toBe(false)
    expect(await check(harness.task, participant, '')).toBe(false)
    expect(await check(harness.task, participant, join(root, 'missing-cwd'))).toBe(false)

    harness.state = { ...harness.state, rules: { workspacePath: 'relative-workspace' } }
    expect(await check()).toBe(false)
    expect(await provider.eligible({ task: harness.task, binding: harness.binding })).toBe(false)
    await expect(provider.prepare(harness.request)).rejects.toThrow('must be an absolute path')
    const file = join(root, 'not-a-workspace')
    await writeFile(file, 'file\n')
    harness.state = { ...harness.state, rules: { workspacePath: file } }
    expect(await check()).toBe(false)
    await expect(provider.prepare(harness.request)).rejects.toThrow('not an existing directory')
    harness.state = { ...harness.state, rules: { workspacePath: join(root, 'missing-workspace') } }
    expect(await check()).toBe(false)
    await expect(provider.prepare(harness.request)).rejects.toThrow('cannot be canonicalized')
    harness.state = { ...harness.state, rules: { workspacePath: root } }
    await rm(root, { recursive: true, force: true })
    expect(await check()).toBe(false)
    expect(await provider.eligible({ task: harness.task, binding: harness.binding })).toBe(false)
  })

  it('records bounded periodic observations only when the pulse is explicitly configured', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { observationPulseIntervalMs: 1, observationMaxAllocationsPerPulse: 1 })
    const allocation = await materialize(harness)
    await writeFile(join(root, 'periodic.txt'), 'periodic output\n')
    await vi.waitFor(() => {
      const observation = harness.state.workspaceAllocations.find(value => value.id === allocation.id)?.observation
      expect(observation?.stage).toBe('periodic')
      expect(observation?.paths).toEqual([expect.objectContaining({ path: 'periodic.txt', change: 'added' })])
    }, { timeout: 2_000, interval: 5 })
  })

  it('bounds a periodic observation pass to one allocation even when another is queued', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { observationMaxAllocationsPerPulse: 1 })
    const allocation = await materialize(harness)
    const internals = harness.provider as unknown as {
      readonly allocations: Map<string, TeamWorkspaceAllocation>
      runObservationPulse(): Promise<void>
    }
    internals.allocations.set('second-attempt', allocation)
    const record = vi.spyOn(harness.ctx.teams, 'recordWorkspaceObservation')
    try {
      await internals.runObservationPulse()
      expect(record).toHaveBeenCalledOnce()
    } finally { internals.allocations.delete('second-attempt') }
    await allocation.release()
  })

  it('contains a periodic observation failure even when its first diagnostic write also fails', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { observationPulseIntervalMs: 1 })
    const allocation = await materialize(harness)
    const warnings = vi.spyOn(harness.ctx.logger, 'warn')
      .mockImplementationOnce(() => { throw new Error('diagnostic sink failed once') })
      .mockImplementation(() => {})
    harness.state = { ...harness.state, workspaceAllocations: [] }
    await vi.waitFor(() => {
      expect(warnings.mock.calls.some(([message]) => String(message).includes('periodic observation failed'))).toBe(true)
    }, { timeout: 2_000, interval: 5 })
    await allocation.release()
  })

  it('creates a fresh external observation home without a pre-created state directory', async () => {
    const root = await freshRoot()
    const external = await freshRoot()
    const stateRoot = join(external, 'fresh-home', 'team-workspace-observations')
    const mounted = await setup(root, { observationStateRoot: stateRoot })
    expect((await stat(stateRoot)).isDirectory()).toBe(true)
    if (process.platform !== 'win32') expect((await stat(stateRoot)).mode & 0o777).toBe(0o700)
    expect(await readdir(root)).toEqual([])
    expect(mounted.provider.name).toBe('shared-local')
  })

  it('accepts an already existing external observation home and rejects a non-directory ancestor', async () => {
    const root = await freshRoot()
    const external = await freshRoot()
    const ready = await setup(root, { observationStateRoot: external })
    expect(ready.provider.name).toBe('shared-local')
    const file = join(external, 'not-a-directory')
    await writeFile(file, 'file\n')
    await expect(setup(root, { observationStateRoot: join(file, 'child') })).rejects.toThrow('is not a directory')
  })

  it('propagates an external state ancestor metadata failure without creating a fallback directory', async () => {
    const root = await freshRoot()
    const external = await freshRoot()
    fsFaults.lstatPath = external
    fsFaults.lstatMode = 'error'
    try {
      await expect(setup(root, { observationStateRoot: join(external, 'state') }))
        .rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      fsFaults.lstatPath = undefined
      fsFaults.lstatMode = undefined
    }
    expect(await readdir(external)).toEqual([])
  })

  it('canonicalizes a root-owned first path alias before accepting external state', async () => {
    const root = await freshRoot()
    const external = await freshRoot()
    const filesystemRoot = parsePath(external).root
    const first = relative(filesystemRoot, external).split(sep)[0]
    if (first === undefined) throw new Error('external root has no first path segment')
    fsFaults.lstatPath = join(filesystemRoot, first)
    fsFaults.lstatMode = 'root-symlink'
    try {
      const harness = await setup(root, { observationStateRoot: external })
      expect(harness.provider.name).toBe('shared-local')
    } finally {
      fsFaults.lstatPath = undefined
      fsFaults.lstatMode = undefined
    }
  })

  it('rejects a post-canonical external alias that resolves to a parent of the shared root', async () => {
    const root = await freshRoot()
    const filesystemRoot = parsePath(root).root
    const first = relative(filesystemRoot, root).split(sep)[0]
    if (first === undefined) throw new Error('shared root has no first path segment')
    const firstPath = join(filesystemRoot, first)
    fsFaults.lstatPath = firstPath
    fsFaults.lstatMode = 'root-symlink'
    fsFaults.realpathAliasPath = firstPath
    fsFaults.realpathAliasTarget = dirname(dirname(root))
    try {
      await expect(SharedWorkspace.apply(new Context(), { root,
        observationStateRoot: join(firstPath, '.tmp') }))
        .rejects.toThrow('observationStateRoot must not contain the shared root')
    } finally {
      fsFaults.lstatPath = undefined
      fsFaults.lstatMode = undefined
      fsFaults.realpathAliasPath = undefined
      fsFaults.realpathAliasTarget = undefined
    }
  })

  it('resolves the direct provider default pulse allocation bound before registering', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    contexts.add(ctx)
    ctx.provide('teams', { registerSystemWorkspaceAllocationProofSource: () => () => {} } as never)
    ctx.provide('agents', { get: () => undefined } as never)
    await ctx.plugin(TeamWorkspaceRegistry)
    await SharedWorkspace.apply(ctx, { root })
    expect(ctx.teamWorkspaces.getProvider('shared-local')).toBeDefined()
  })

  it('refuses an external observation path through a user-controlled ancestor symlink', async () => {
    const root = await freshRoot()
    const external = await freshRoot()
    const target = await freshRoot()
    await symlink(target, join(external, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(setup(root, { observationStateRoot: join(external, 'redirect', 'state') })).rejects.toThrow('symbolic link')
    expect(await readdir(target)).toEqual([])
  })

  it('allocates one exact current shared root, calls policy, and releases only logical ownership', async () => {
    const root = await freshRoot()
    const harness = await setup(root)
    const participant = harness.state.participants[0]
    if (participant === undefined) throw new Error('shared workspace fixture omitted its Participant')

    await expect(harness.ctx.teamWorkspaces.preflight('shared', {
      task: harness.task,
      participant,
      route: { provider: 'in-process', model: 'test/model', cwd: root },
    })).resolves.toBe(true)
    const incompatibleRoot = await freshRoot()
    await expect(harness.ctx.teamWorkspaces.preflight('shared', {
      task: harness.task,
      participant,
      route: { provider: 'in-process', model: 'test/model', cwd: incompatibleRoot },
    })).resolves.toBe(false)

    await expect(harness.ctx.teamWorkspaces.eligible('shared', {
      task: harness.task,
      binding: harness.binding,
    })).resolves.toBe(true)

    const first = await materialize(harness)
    const second = await materialize(harness)

    expect(second).toBe(first)
    expect(first).toMatchObject({
      mode: 'shared',
      teamId,
      taskId,
      attemptId,
      assignedRevision: 2,
      root,
    })
    expect(Object.isFrozen(first)).toBe(true)
    await writeFile(join(root, 'unreported.txt'), 'shared output\n')
    await expect(harness.ctx.teamWorkspaces.publish('shared', { allocation: first })).resolves.toMatchObject({
      teamId,
      taskId,
      attemptId,
      changedPaths: ['unreported.txt'],
      artifacts: [],
      accepted: false,
    })
    expect(harness.authorizations).toHaveLength(4)
    for (const authorization of harness.authorizations) {
      expect(authorization).toMatchObject({
        hook: 'workspace-allocate',
        teamId,
        actorId: participantId,
        facts: {
          taskId,
          attemptId,
          assignedRevision: 2,
          participantId,
          activationId,
          sessionId,
          workspaceMode: 'shared',
          root,
        },
      })
    }

    await first.release()
    await first.release()
    expect((await stat(root)).isDirectory()).toBe(true)
    const afterRelease = await materialize(harness)
    expect(afterRelease).not.toBe(first)
    await expect(harness.ctx.teamWorkspaces.publish('shared', { allocation: first })).rejects.toMatchObject({
      code: 'TEAM_INVALID_ARGUMENT',
    })
  })

  it('reports modified and deleted baseline files without claiming integration of the source root', async () => {
    const root = await freshRoot()
    await writeFile(join(root, 'seed.txt'), 'original\n')
    const harness = await setup(root, { artifact: true, integration: true })
    const allocation = await materialize(harness)
    await writeFile(join(root, 'seed.txt'), 'changed\n')
    await expect(harness.ctx.teamWorkspaces.publish('shared', { allocation }))
      .resolves.toMatchObject({ changedPaths: ['seed.txt'], observation: { paths: [{ path: 'seed.txt', change: 'modified' }] },
        accepted: false })
    await rm(join(root, 'seed.txt'))
    await expect(harness.ctx.teamWorkspaces.publish('shared', { allocation }))
      .resolves.toMatchObject({ changedPaths: ['seed.txt'], observation: { paths: [{ path: 'seed.txt', change: 'deleted' }] },
        accepted: false })
    expect((await stat(root)).isDirectory()).toBe(true)
    await allocation.release()
  })

  it('uses the configured shared root when a live allocation loses its cached root hint', async () => {
    const root = await freshRoot()
    const harness = await setup(root)
    const allocation = await materialize(harness)
    const internals = harness.provider as unknown as { readonly roots: Map<string, string> }
    internals.roots.clear()
    await writeFile(join(root, 'fallback.txt'), 'fallback root\n')
    await expect(harness.ctx.teamWorkspaces.publish('shared', { allocation }))
      .resolves.toMatchObject({ changedPaths: ['fallback.txt'] })
    await allocation.release()
  })

  it('refuses publication when an observation has no retained source scan', async () => {
    const root = await freshRoot()
    const harness = await setup(root)
    const allocation = await materialize(harness)
    const observation = harness.state.workspaceAllocations.find(value => value.id === allocation.id)?.observation
    if (observation === undefined) throw new Error('shared fixture has no baseline observation')
    const internals = harness.provider as unknown as {
      readonly observedScans: Map<string, unknown>
      observeAllocation(...args: unknown[]): Promise<typeof observation>
    }
    internals.observedScans.clear()
    const observe = vi.spyOn(internals, 'observeAllocation').mockResolvedValueOnce(observation)
    try {
      await expect(harness.ctx.teamWorkspaces.publish('shared', { allocation }))
        .rejects.toThrow('no retained current scan')
    } finally { observe.mockRestore() }
    await allocation.release()
  })

  it('does not claim additions or deletions from the unobserved side of a partial scan', async () => {
    const root = await freshRoot()
    await writeFile(join(root, 'z.txt'), 'original\n')
    const completeBase = await setup(root, { artifact: true, integration: true, observationMaxEntries: 1 })
    const first = await materialize(completeBase)
    await rm(join(root, 'z.txt'))
    await writeFile(join(root, 'a.txt'), 'new\n')
    await writeFile(join(root, 'b.txt'), 'another new file\n')
    const partialFinal = await completeBase.ctx.teamWorkspaces.publish('shared', { allocation: first })
    expect(partialFinal.observation?.truncated).toBe(true)
    expect(partialFinal.observation?.paths.some(path => path.path === 'z.txt' && path.change === 'deleted')).toBe(false)
    await first.release()

    const otherRoot = await freshRoot()
    await writeFile(join(otherRoot, 'a.txt'), 'observed baseline\n')
    await writeFile(join(otherRoot, 'z.txt'), 'unobserved baseline\n')
    const partialBase = await setup(otherRoot, { artifact: true, integration: true, observationMaxEntries: 1 })
    const second = await materialize(partialBase)
    const stateRoot = join(partialBase.integrationRoot!, '.clocky-team-shared-state')
    const baselineName = (await readdir(stateRoot)).find(name => name.startsWith('baseline-'))
    if (baselineName === undefined) throw new Error('partial provider baseline was not retained')
    const baseline = JSON.parse(await readFile(join(stateRoot, baselineName), 'utf8')) as { baseline: Record<string, unknown> }
    const selected = Object.keys(baseline.baseline)[0]
    if (selected === undefined) throw new Error('partial baseline observed no file')
    const unobserved = selected === 'a.txt' ? 'z.txt' : 'a.txt'
    await rm(join(otherRoot, selected))
    const completeFinal = await partialBase.ctx.teamWorkspaces.publish('shared', { allocation: second })
    expect(completeFinal.observation?.paths.some(path => path.path === unobserved && path.change === 'added')).toBe(false)
    expect(completeFinal.observation?.paths).toContainEqual(expect.objectContaining({ path: selected, change: 'deleted' }))
    await second.release()
  })

  it('requires a durable reservation and reuses a live allocation after reservation recreation', async () => {
    const root = await freshRoot()
    const harness = await setup(root)
    const orphan = await harness.provider.prepare(harness.request)
    await expect(orphan.materialize()).rejects.toThrow('durable allocation reservation')
    const allocation = await materialize(harness)
    const internals = harness.provider as unknown as { readonly preparations: Map<string, unknown> }
    internals.preparations.clear()
    const abandoned = await harness.provider.prepare(harness.request)
    await abandoned.abandon()
    const recreated = await harness.provider.prepare(harness.request)
    reserveFixtureAllocation(harness, recreated)
    expect(await recreated.materialize()).toBe(allocation)
    await allocation.release()
  })

  it('retains a bounded incomplete baseline when its sidecar would exceed the state byte limit', async () => {
    const root = await freshRoot()
    await writeFile(join(root, 'seed.txt'), 'baseline content\n')
    const harness = await setup(root, { observationMaxStateBytes: 1 })
    const allocation = await materialize(harness)
    const observation = harness.state.workspaceAllocations.find(value => value.id === allocation.id)?.observation
    expect(observation?.truncated).toBe(true)
    expect(observation?.final.incompleteReasons).toContain('state-byte-limit')
    const published = await harness.ctx.teamWorkspaces.publish('shared', { allocation })
    expect(published.observation?.truncated).toBe(true)
    await allocation.release()
  })

  it('recovers a durable observation when the optional provider baseline sidecar has disappeared', async () => {
    const root = await freshRoot()
    await writeFile(join(root, 'seed.txt'), 'baseline content\n')
    const harness = await setup(root, { artifact: true, integration: true })
    const allocation = await materialize(harness)
    const stateRoot = join(harness.integrationRoot!, '.clocky-team-shared-state')
    const name = (await readdir(stateRoot)).find(value => value.startsWith('baseline-'))
    if (name === undefined) throw new Error('shared provider did not write its baseline')
    await rm(join(stateRoot, name))
    const internals = harness.provider as unknown as {
      readonly allocations: Map<string, unknown>
      readonly preparations: Map<string, unknown>
      readonly baselines: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()
    internals.baselines.clear()
    await writeFile(join(root, 'seed.txt'), 'changed after missing sidecar\n')
    const restored = await harness.provider.restore(harness.request, allocation)
    expect(restored.root).toBe(root)
    expect(harness.state.workspaceAllocations.find(value => value.id === allocation.id)?.observation)
      .toMatchObject({ stage: 'restore', baselineAvailable: false })
    await restored.release()
  })

  it('follows an explicitly enabled durable Team workspacePath for worker eligibility and allocation', async () => {
    const configuredRoot = await freshRoot()
    const selectedRoot = await freshRoot()
    const harness = await setup(configuredRoot, { allowTeamWorkspacePath: true })
    harness.state = { ...harness.state, rules: { workspacePath: selectedRoot } }
    harness.live.set(String(sessionId), { session: { id: sessionId, header: { cwd: selectedRoot } } })

    await expect(harness.provider.eligible({ task: harness.task, binding: harness.binding })).resolves.toBe(true)
    const allocation = await materialize(harness)
    expect(allocation.root).toBe(selectedRoot)
    await expect(harness.ctx.teamWorkspaces.publish('shared', { allocation })).resolves.toMatchObject({
      teamId,
      taskId,
      attemptId,
      accepted: false,
    })
    await allocation.release()
  })

  it('reconciles a vanished selected Team workspacePath without recreating its root', async () => {
    const configuredRoot = await freshRoot()
    const selectedRoot = await freshRoot()
    const harness = await setup(configuredRoot, { allowTeamWorkspacePath: true })
    harness.state = { ...harness.state, rules: { workspacePath: selectedRoot } }
    harness.live.set(String(sessionId), { session: { id: sessionId, header: { cwd: selectedRoot } } })
    const allocation = await materialize(harness)
    const internals = harness.provider as unknown as {
      readonly allocations: Map<string, unknown>
      readonly preparations: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()
    await rm(selectedRoot, { recursive: true, force: true })
    await expect(harness.provider.reconcileRelease(harness.request, allocation)).resolves.toBeUndefined()
    await expect(stat(selectedRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('covers report-only fallback artifacts, non-file entries, and ownership fences', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { artifactProvider: 'test-artifacts' })
    const allocation = await materialize(harness)
    await writeFile(join(root, 'output.txt'), 'shared output\n')
    const socket = process.platform === 'win32' ? undefined : createServer()
    if (socket !== undefined) {
      const previousCwd = process.cwd()
      try {
        process.chdir(root)
        await new Promise<void>((resolve, reject) => {
          socket.once('error', reject)
          socket.listen('socket-entry', () => { resolve() })
        })
      } finally {
        process.chdir(previousCwd)
      }
    }
    try {
      const published = await harness.ctx.teamWorkspaces.publish('shared', { allocation })
      expect(published.changedPaths).toEqual(socket === undefined ? ['output.txt'] : ['output.txt', 'socket-entry'])
      expect(published.artifacts).toMatchObject([{
        kind: 'file',
        uri: join(root, 'output.txt'),
        sourceAttemptId: attemptId,
      }])

      await expect(harness.provider.restore(harness.request, { ...allocation, id: 'forged' as never }))
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      await expect(harness.provider.reconcileRelease(harness.request, { ...allocation, id: 'forged' as never }))
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      await harness.provider.reconcileRelease(harness.request, allocation)
      await allocation.release()
    } finally {
      if (socket !== undefined) await new Promise<void>((resolve) => { socket.close(() => { resolve() }) })
    }
  })

  it('returns false rather than adapting non-shared, stale, non-local, unavailable, or cwd-mismatched eligibility', async () => {
    const root = await freshRoot()
    const child = join(root, 'child')
    await mkdir(child)
    const harness = await setup(root)
    const eligible = (): Promise<boolean> => harness.provider.eligible({ task: harness.task, binding: harness.binding })

    expect(await harness.provider.eligible({ task: { ...harness.task, workspaceMode: 'worktree' }, binding: harness.binding })).toBe(false)
    harness.state = { ...harness.state, tasks: [{ ...harness.task, revision: harness.task.revision + 1 }] }
    expect(await eligible()).toBe(false)

    harness.state = baseline().state
    harness.state = {
      ...harness.state,
      participants: [{ ...harness.state.participants[0]!, kind: 'remote-agent' }],
    }
    expect(await eligible()).toBe(false)

    harness.state = baseline().state
    harness.state = {
      ...harness.state,
      participants: [{ ...harness.state.participants[0]!, phase: 'provisioning' }],
    }
    expect(await eligible()).toBe(false)

    harness.state = baseline().state
    harness.state = {
      ...harness.state,
      activations: [{ ...harness.binding, provider: 'other' }],
    }
    expect(await eligible()).toBe(false)

    harness.state = baseline().state
    harness.state = {
      ...harness.state,
      activations: [{ ...harness.binding, activation: { ...harness.binding.activation, status: 'offline' } }],
    }
    expect(await eligible()).toBe(false)

    harness.state = baseline().state
    harness.live.clear()
    expect(await eligible()).toBe(false)

    harness.live.set(String(sessionId), { session: { id: SessionId('another-session'), header: { cwd: root } } })
    expect(await eligible()).toBe(false)

    harness.live.set(String(sessionId), { session: { id: sessionId, header: { cwd: child } } })
    expect(await eligible()).toBe(false)

    harness.live.set(String(sessionId), { session: { id: sessionId, header: { cwd: root } } })
    harness.state = { ...harness.state, team: { ...harness.state.team, phase: 'quiescing' } }
    expect(await eligible()).toBe(false)
  })

  it('rejects every stale lease, ownership, and live-Agent allocation relation before it publishes a root', async () => {
    const root = await freshRoot()
    const harness = await setup(root)
    const reject = async (message: string): Promise<void> => {
      const allocation = materialize(harness)
      await expect(allocation).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      await expect(allocation).rejects.toThrow(message)
    }

    harness.state = { ...baseline().state, tasks: [] }
    await reject('not available')

    harness.state = { ...baseline().state, team: { ...baseline().state.team, phase: 'quiescing' } }
    await reject('not active')

    harness.state = { ...baseline().state, tasks: [{ ...baseline().task, workspaceMode: 'worktree' }] }
    await reject('does not request')

    harness.state = { ...baseline().state, tasks: [{ ...baseline().task, phase: 'pending' }] }
    await reject('does not hold')

    const { lease: removedLease, ...leaseFreeTask } = baseline().task
    if (removedLease === undefined) throw new Error('baseline task has no lease to remove')
    harness.state = { ...baseline().state, tasks: [leaseFreeTask] }
    await reject('has no current')

    harness.state = {
      ...baseline().state,
      tasks: [{ ...baseline().task, lease: { ...baseline().task.lease!, expiresAt: 0 } }],
    }
    await reject('has expired')

    harness.state = {
      ...baseline().state,
      tasks: [{ ...baseline().task, lease: { ...baseline().task.lease!, attemptId: taskAttemptIdSchema.parse('other') } }],
    }
    await reject('attempt does not match')

    harness.state = {
      ...baseline().state,
      tasks: [{ ...baseline().task, lease: { ...baseline().task.lease!, assignedRevision: 7 } }],
    }
    await reject('assigned revision does not match')

    harness.state = {
      ...baseline().state,
      tasks: [{ ...baseline().task, lease: { ...baseline().task.lease!, participantId: participantIdSchema.parse('other') } }],
    }
    await reject('participant does not match')

    harness.state = {
      ...baseline().state,
      tasks: [{ ...baseline().task, lease: { ...baseline().task.lease!, activationId: activationIdSchema.parse('other') } }],
    }
    await reject('activation does not match')

    harness.state = {
      ...baseline().state,
      participants: [{ ...baseline().state.participants[0]!, kind: 'human' }],
    }
    await reject('not an active local Agent')

    harness.state = { ...baseline().state, activations: [] }
    await reject('does not match')

    harness.state = {
      ...baseline().state,
      activations: [{ ...baseline().binding, activation: { ...baseline().binding.activation, teamId: teamIdSchema.parse('other-team') } }],
    }
    await reject('does not match')

    harness.state = {
      ...baseline().state,
      activations: [{ ...baseline().binding, activation: { ...baseline().binding.activation, participantId: participantIdSchema.parse('other') } }],
    }
    await reject('does not match')

    harness.state = {
      ...baseline().state,
      activations: [{ ...baseline().binding, sessionId: SessionId('other-session') }],
    }
    await reject('does not match')

    harness.state = {
      ...baseline().state,
      activations: [{ ...baseline().binding, activation: { ...baseline().binding.activation, status: 'starting' } }],
    }
    await reject('does not match')

    harness.state = baseline().state
    harness.live.clear()
    await reject('not a live local Agent')

    harness.live.set(String(sessionId), { session: { id: sessionId, header: { cwd: join(root, 'not-the-root') } } })
    await reject('not a live local Agent')
  })

  it('rejects a policy denial and a root that disappears after mounting', async () => {
    const root = await freshRoot()
    const harness = await setup(root)
    harness.policy = { kind: 'deny', code: 'forbidden', message: 'allocation is forbidden' }
    await expect(materialize(harness))
      .rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED', message: 'allocation is forbidden' })

    harness.policy = { kind: 'allow' }
    await rm(root, { recursive: true, force: true })
    await expect(harness.provider.eligible({ task: harness.task, binding: harness.binding })).resolves.toBe(false)
    const allocation = materialize(harness)
    await expect(allocation).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(allocation).rejects.toThrow('not an existing directory')
  })

  it('publishes a portable patch and integrates it into a separate target with a content-version fence', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { artifact: true, integration: true })
    const allocation = await materialize(harness)
    await writeFile(join(root, 'changed.txt'), 'changed\n')
    await symlink('changed.txt', join(root, 'changed-link'))

    const published = await harness.ctx.teamWorkspaces.publish('shared', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('shared patch artifact was not published')
    expect(published.changedPaths).toEqual(['changed-link', 'changed.txt'])
    expect(published.artifacts).toHaveLength(2)
    expect(harness.saves).toHaveBeenCalledTimes(2)

    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: [patch] },
      integrationTaskId: 'shared-integration-task' as never,
      integrationAttemptId: 'shared-integration-attempt' as never,
      target: 'main',
      expectedTarget: 'missing',
      mode: 'proposal',
      actorId: participantId,
    }
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', request)).resolves.toMatchObject({
      status: 'proposed',
      artifact: patch,
    })

    const integrated = await harness.ctx.teamWorkspaces.integrateSource('shared-local', { ...request, mode: 'integrate' })
    expect(integrated).toMatchObject({ status: 'integrated', target: 'main', artifact: patch })
    const target = join(harness.integrationRoot!, 'main')
    expect(await readFile(join(target, 'changed.txt'), 'utf8')).toBe('changed\n')
    await expect(readlink(join(target, 'changed-link'))).resolves.toBe('changed.txt')
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', { ...request, mode: 'integrate' }))
      .resolves.toEqual(integrated)

    await writeFile(join(target, 'foreign.txt'), 'foreign\n')
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', { ...request, mode: 'integrate' }))
      .resolves.toMatchObject({ status: 'conflict', artifact: patch })

    const recoveryTarget = join(harness.integrationRoot!, 'crash-recovery')
    await mkdir(recoveryTarget)
    const recoveryRequest: TeamWorkspaceSourceIntegrateRequest = {
      ...request,
      target: 'crash-recovery',
      expectedTarget: undefined,
      integrationTaskId: 'shared-crash-recovery-task' as never,
      integrationAttemptId: 'shared-crash-recovery-attempt' as never,
      mode: 'integrate',
    }
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', recoveryRequest))
      .resolves.toMatchObject({ status: 'integrated' })
    const markerRoot = join(harness.integrationRoot!, '.clocky-team-shared-state', 'integrations')
    let recoveryMarkerPath: string | undefined
    for (const name of await readdir(markerRoot)) {
      const path = join(markerRoot, name)
      if ((await readFile(path, 'utf8')).includes('"target":"crash-recovery"')) {
        recoveryMarkerPath = path
        break
      }
    }
    if (recoveryMarkerPath === undefined) throw new Error('shared crash-recovery marker was not written')
    const recoveryMarker = JSON.parse(await readFile(recoveryMarkerPath, 'utf8')) as Record<string, unknown>
    const recoveryBackup = join(harness.integrationRoot!, `.clocky-team-shared-backup-${createHash('sha256').update(recoveryMarkerPath).digest('hex')}`)
    await rename(recoveryTarget, recoveryBackup)
    await rm(recoveryBackup, { recursive: true, force: true })
    await mkdir(recoveryBackup)
    await writeFile(recoveryMarkerPath, JSON.stringify({ ...recoveryMarker, status: 'prepared' }))
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', recoveryRequest))
      .resolves.toMatchObject({ status: 'integrated' })
    expect(await readFile(join(recoveryTarget, 'changed.txt'), 'utf8')).toBe('changed\n')

    if (harness.integrationRoot === undefined) throw new Error('Integration fixture omitted its state root')
    const recovered = await setup(root, { artifact: true, integration: true, integrationRoot: harness.integrationRoot })
    recovered.state = structuredClone(harness.state)
    const restored = await recovered.ctx.teamWorkspaces.restore('shared', recovered.request, allocation)
    expect(restored.root).toBe(root)
    await restored.release()
  })

  it('refuses source integration when durable observation is absent or truncated and when its artifact store is missing', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { artifact: true, integration: true })
    const allocation = await materialize(harness)
    await writeFile(join(root, 'output.txt'), 'source output\n')
    const published = await harness.ctx.teamWorkspaces.publish('shared', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('source integration fixture did not publish a patch')
    if (published.observation === undefined) throw new Error('source integration fixture did not observe the allocation')
    const observation = published.observation
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: [patch] },
      integrationTaskId: 'missing-observation-task' as never,
      integrationAttemptId: 'missing-observation-attempt' as never,
      target: 'main', mode: 'integrate', actorId: participantId,
    }
    const internals = harness.provider as unknown as { readonly allocations: Map<string, unknown> }
    internals.allocations.clear()
    harness.state = { ...harness.state, workspaceAllocations: harness.state.workspaceAllocations.map(value =>
      value.id === allocation.id ? { ...value, observation: undefined } : value) }
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', request))
      .rejects.toThrow('complete latest workspace observation')
    harness.state = { ...harness.state, workspaceAllocations: harness.state.workspaceAllocations.map(value =>
      value.id === allocation.id ? { ...value, observation: { ...observation, truncated: true } } : value) }
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', request))
      .rejects.toThrow('complete latest workspace observation')

    const noStoreRoot = await freshRoot()
    const noStore = await setup(noStoreRoot, { integration: true })
    await expect(noStore.ctx.teamWorkspaces.integrateSource('shared-local', request))
      .rejects.toThrow('configured artifact provider')
  })

  it('refuses integration when the existing target cannot be completely observed within its byte bound', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { artifact: true, integration: true, maxIntegrationBytes: 4096 })
    const allocation = await materialize(harness)
    await writeFile(join(root, 'output.txt'), 'small patch\n')
    const published = await harness.ctx.teamWorkspaces.publish('shared', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('bounded target fixture did not publish a patch')
    const target = join(harness.integrationRoot!, 'bounded-target')
    await mkdir(target)
    await writeFile(join(target, 'large.bin'), Buffer.alloc(4097))
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', {
      source: { teamId, taskId, attemptId, artifacts: [patch] },
      integrationTaskId: 'bounded-target-task' as never,
      integrationAttemptId: 'bounded-target-attempt' as never,
      target: 'bounded-target', mode: 'integrate', actorId: participantId,
    })).rejects.toThrow('complete bounded target observation')
    expect((await stat(target)).isDirectory()).toBe(true)
  })

  it('reports a target metadata failure after proving that the integration directory exists', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { artifact: true, integration: true })
    const allocation = await materialize(harness)
    await writeFile(join(root, 'output.txt'), 'small patch\n')
    const published = await harness.ctx.teamWorkspaces.publish('shared', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('target metadata fixture did not publish a patch')
    const target = join(harness.integrationRoot!, 'metadata-target')
    await mkdir(target)
    fsFaults.lstatPath = target
    fsFaults.lstatMode = 'second-error'
    try {
      await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', {
        source: { teamId, taskId, attemptId, artifacts: [patch] },
        integrationTaskId: 'metadata-target-task' as never,
        integrationAttemptId: 'metadata-target-attempt' as never,
        target: 'metadata-target', mode: 'integrate', actorId: participantId,
      })).rejects.toThrow('is unavailable')
      expect(fsFaults.lstatCount).toBeGreaterThanOrEqual(2)
    } finally {
      fsFaults.lstatPath = undefined
      fsFaults.lstatMode = undefined
      fsFaults.lstatCount = 0
    }
  })

  it('fails closed for integration policy, malformed patches, unsafe targets, and disabled authority', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { artifact: true, integration: true })
    const allocation = await materialize(harness)
    await writeFile(join(root, 'output.txt'), 'output\n')
    const published = await harness.ctx.teamWorkspaces.publish('shared', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('shared patch artifact was not published')
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: [patch] },
      integrationTaskId: 'shared-boundary-task' as never,
      integrationAttemptId: 'shared-boundary-attempt' as never,
      target: 'main',
      mode: 'integrate',
    }

    harness.policy = { kind: 'deny', code: 'forbidden', message: 'integration denied' }
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', request))
      .rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED', message: 'integration denied' })
    expect(harness.reads).not.toHaveBeenCalled()

    harness.policy = { kind: 'allow' }
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', { ...request, target: '../escape' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', { ...request, target: '.clocky-team-shared-state' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const malformed = await harness.saves('test-artifacts', {
      kind: 'patch',
      sourceAttemptId: attemptId,
      visibility: 'team',
      data: 'not-json',
    })
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', {
      ...request,
      source: { ...request.source, artifacts: [malformed] },
      integrationTaskId: 'shared-malformed-task' as never,
      integrationAttemptId: 'shared-malformed-attempt' as never,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const disabledRoot = await freshRoot()
    const disabled = await setup(disabledRoot, { artifact: true })
    const disabledPatch = await disabled.saves('test-artifacts', {
      kind: 'patch',
      sourceAttemptId: attemptId,
      visibility: 'team',
      data: encodeTeamWorkspaceChangeSet({
        provider: 'shared-local',
        sourceAttemptId: attemptId,
        changes: [{ path: 'output.txt', kind: 'file', data: 'b3V0cHV0Cg==' }],
      }, 4096),
    })
    await expect(disabled.ctx.teamWorkspaces.integrateSource('shared-local', {
      ...request,
      source: { ...request.source, artifacts: [disabledPatch] },
      integrationTaskId: 'shared-disabled-task' as never,
      integrationAttemptId: 'shared-disabled-attempt' as never,
    })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    await disabled.ctx.fiber.dispose()
    await harness.ctx.fiber.dispose()
  })

  it('protects target replacement, symlink ancestors, directory conflicts, and marker retry state', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { artifact: true, integration: true })
    const allocation = await materialize(harness)
    await writeFile(join(root, 'changed.txt'), 'changed\n')
    const published = await harness.ctx.teamWorkspaces.publish('shared', { allocation })
    const patch = published.artifacts.find(artifact => artifact.kind === 'patch')
    if (patch === undefined) throw new Error('shared patch artifact was not published')
    const request: TeamWorkspaceSourceIntegrateRequest = {
      source: { teamId, taskId, attemptId, artifacts: [patch] },
      integrationTaskId: 'shared-filesystem-task' as never,
      integrationAttemptId: 'shared-filesystem-attempt' as never,
      target: 'concurrent',
      expectedTarget: 'missing',
      mode: 'integrate',
    }
    const concurrent = await Promise.all([
      harness.ctx.teamWorkspaces.integrateSource('shared-local', request),
      harness.ctx.teamWorkspaces.integrateSource('shared-local', request),
    ])
    expect(concurrent[0]).toMatchObject({ status: 'integrated' })
    expect(concurrent[1]).toMatchObject({ status: 'integrated' })

    const markerRoot = join(harness.integrationRoot!, '.clocky-team-shared-state', 'integrations')
    const markerName = (await readdir(markerRoot)).find(name => name.endsWith('.json'))
    if (markerName === undefined) throw new Error('shared integration marker was not written')
    const markerPath = join(markerRoot, markerName)
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>
    await writeFile(markerPath, JSON.stringify({ ...marker, status: 'prepared' }))
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', request)).resolves.toMatchObject({ status: 'integrated' })
    await writeFile(markerPath, JSON.stringify({ ...marker, sourceTaskId: 'wrong-source' }))
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', request)).rejects.toMatchObject({
      code: 'TEAM_INVALID_ARGUMENT',
    })
    await writeFile(markerPath, '{}')
    await expect(harness.ctx.teamWorkspaces.integrateSource('shared-local', request)).rejects.toMatchObject({
      code: 'TEAM_INVALID_ARGUMENT',
    })

    const makePatch = async (name: string, changes: Parameters<typeof encodeTeamWorkspaceChangeSet>[0]['changes']) => await harness.saves('test-artifacts', {
      kind: 'patch',
      sourceAttemptId: attemptId,
      visibility: 'team',
      data: encodeTeamWorkspaceChangeSet({ provider: 'shared-local', sourceAttemptId: attemptId, changes }, 4096),
      name,
    })
    const integrate = (artifact: TeamArtifactReference, target: string, suffix: string): Promise<unknown> => harness.ctx.teamWorkspaces.integrateSource('shared-local', {
      ...request,
      source: { ...request.source, artifacts: [artifact] },
      target,
      expectedTarget: undefined,
      integrationTaskId: `shared-${suffix}-task` as never,
      integrationAttemptId: `shared-${suffix}-attempt` as never,
    })

    const existing = join(harness.integrationRoot!, 'existing')
    await mkdir(existing, { recursive: true })
    await writeFile(join(existing, 'old.txt'), 'old\n')
    await expect(integrate(patch, 'existing', 'existing')).resolves.toMatchObject({ status: 'integrated' })
    expect(await readFile(join(existing, 'old.txt'), 'utf8')).toBe('old\n')

    const outside = await freshRoot()
    await symlink(outside, join(harness.integrationRoot!, 'target-link'))
    await expect(integrate(patch, 'target-link', 'target-link')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await symlink(outside, join(harness.integrationRoot!, 'ancestor-link'))
    await expect(integrate(patch, 'ancestor-link/main', 'ancestor-link')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await writeFile(join(harness.integrationRoot!, 'file-target'), 'not a directory')
    await expect(integrate(patch, 'file-target', 'file-target')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const deleteDirectory = await makePatch('delete-directory', [{ path: 'dir', kind: 'delete' }])
    const deleteTarget = join(harness.integrationRoot!, 'delete-target')
    await mkdir(join(deleteTarget, 'dir'), { recursive: true })
    await expect(integrate(deleteDirectory, 'delete-target', 'delete-directory')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const replaceDirectory = await makePatch('replace-directory', [{ path: 'dir', kind: 'file', data: 'bmV3' }])
    await expect(integrate(replaceDirectory, 'delete-target', 'replace-directory')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const writeThroughSymlink = await makePatch('write-through-symlink', [{ path: 'changed.txt', kind: 'file', data: 'bmV3' }])
    const symlinkTarget = join(harness.integrationRoot!, 'write-link')
    await mkdir(symlinkTarget, { recursive: true })
    await symlink(outside, join(symlinkTarget, 'changed.txt'))
    await expect(integrate(writeThroughSymlink, 'write-link', 'write-through-symlink')).rejects.toMatchObject({
      code: 'TEAM_INVALID_ARGUMENT',
    })
    await expect(integrate(patch, 'dot/../existing', 'dot-segment')).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await allocation.release()
  })

  it('keeps abandoned reservations inert and reconciles concurrent shared allocations', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { artifact: true, integration: true })
    const abandoned = await harness.ctx.teamWorkspaces.prepare('shared', harness.request)
    await abandoned.abandon()
    await abandoned.abandon()
    await expect(abandoned.materialize()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })

    const preparation = await harness.ctx.teamWorkspaces.prepare('shared', harness.request)
    reserveFixtureAllocation(harness, preparation)
    const allocations = await Promise.all([preparation.materialize(), preparation.materialize()])
    expect(allocations[0]).toBe(allocations[1])
    await harness.ctx.teamWorkspaces.reconcileRelease('shared', harness.request, allocations[0])
    await expect(harness.ctx.teamWorkspaces.reconcileRelease('shared', harness.request, allocations[0])).resolves.toBeUndefined()
  })

  it('retains the baseline when provider sidecar cleanup fails and permits a later release retry', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { artifact: true, integration: true })
    const allocation = await materialize(harness)
    const stateRoot = join(harness.integrationRoot!, '.clocky-team-shared-state')
    const baselineName = (await readdir(stateRoot)).find(name => name.startsWith('baseline-'))
    if (baselineName === undefined) throw new Error('shared baseline sidecar was not written')
    const baselinePath = join(stateRoot, baselineName)
    await rm(baselinePath, { recursive: true, force: true })
    await mkdir(baselinePath)
    await expect(allocation.release()).rejects.toThrow()

    await writeFile(join(root, 'after-cleanup-error.txt'), 'still tracked\n')
    await expect(harness.ctx.teamWorkspaces.publish('shared', { allocation })).resolves.toMatchObject({
      changedPaths: ['after-cleanup-error.txt'],
    })
    await rm(baselinePath, { recursive: true, force: true })
    await expect(allocation.release()).resolves.toBeUndefined()
  })

  it('releases logical ownership even when live or recovered observation loses its durable allocation', async () => {
    const root = await freshRoot()
    const live = await setup(root)
    const allocation = await materialize(live)
    const warnLive = vi.spyOn(live.ctx.logger, 'warn').mockImplementation(() => {})
    live.state = { ...live.state, workspaceAllocations: [] }
    await allocation.release()
    expect(warnLive.mock.calls.some(([message]) => String(message).includes('release observation could not be recorded'))).toBe(true)

    const recoveryRoot = await freshRoot()
    const recovered = await setup(recoveryRoot)
    const stale = await materialize(recovered)
    const internals = recovered.provider as unknown as {
      readonly allocations: Map<string, unknown>
      readonly preparations: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()
    recovered.state = { ...recovered.state, workspaceAllocations: [] }
    const warnRecovered = vi.spyOn(recovered.ctx.logger, 'warn').mockImplementation(() => {})
    await recovered.provider.reconcileRelease(recovered.request, stale)
    expect(warnRecovered.mock.calls.some(([message]) => String(message).includes('recovery observation could not be recorded'))).toBe(true)
  })

  it('re-reads a concurrently created baseline from another provider instance', async () => {
    const root = await freshRoot()
    const integrationRoot = await freshRoot()
    const first = await setup(root, { artifact: true, integration: true, integrationRoot })
    const second = await setup(root, { artifact: true, integration: true, integrationRoot })
    const [firstAllocation, secondAllocation] = await Promise.all([materialize(first), materialize(second)])
    expect(firstAllocation.root).toBe(root)
    expect(secondAllocation.root).toBe(root)
    await firstAllocation.release()
    await secondAllocation.release()
  })

  it('rejects malformed durable baseline headers, paths, fingerprints, and digests on restore', async () => {
    const root = await freshRoot()
    await writeFile(join(root, 'seed.txt'), 'baseline content\n')
    const harness = await setup(root, { artifact: true, integration: true })
    const allocation = await materialize(harness)
    const stateRoot = join(harness.integrationRoot!, '.clocky-team-shared-state')
    const name = (await readdir(stateRoot)).find(value => value.startsWith('baseline-'))
    if (name === undefined) throw new Error('shared provider did not write its baseline')
    const pathname = join(stateRoot, name)
    const original = JSON.parse(await readFile(pathname, 'utf8')) as Record<string, unknown>
    const entries = original.baseline as Record<string, Record<string, unknown>>
    const file = entries['seed.txt']
    if (file === undefined) throw new Error('seed fingerprint was not retained')
    const withEntry = (value: unknown, path = 'seed.txt') => ({ ...original, baseline: { [path]: value } })
    const variants: readonly [string, unknown][] = [
      ['array', []],
      ['wrong version', { ...original, version: 1 }],
      ['missing baseline', { ...original, baseline: null }],
      ['array baseline', { ...original, baseline: [] }],
      ['invalid scan', { ...original, scan: {} }],
      ['empty path', withEntry(file, '')],
      ['backslash path', withEntry(file, 'bad\\path')],
      ['NUL path', withEntry(file, 'bad\0path')],
      ['absolute path', withEntry(file, '/outside')],
      ['empty segment', withEntry(file, 'bad//path')],
      ['dot segment', withEntry(file, 'bad/./path')],
      ['parent segment', withEntry(file, 'bad/../path')],
      ['null fingerprint', withEntry(null)],
      ['array fingerprint', withEntry([])],
      ['symlink wrong target', withEntry({ kind: 'symlink', target: 1 })],
      ['symlink extra field', withEntry({ kind: 'symlink', target: 'seed.txt', extra: true })],
      ['other wrong type', withEntry({ kind: 'other', type: 1 })],
      ['other extra field', withEntry({ kind: 'other', type: 'socket', extra: true })],
      ['file negative size', withEntry({ ...file, size: -1 })],
      ['file fractional size', withEntry({ ...file, size: 1.5 })],
      ['file modified time', withEntry({ ...file, modifiedAt: Number.NaN })],
      ['file missing digest', withEntry({ ...file, contentHash: undefined })],
      ['file malformed digest', withEntry({ ...file, contentHash: 'not-a-digest' })],
      ['file extra field', withEntry({ ...file, extra: true })],
      ['digest mismatch', withEntry({ ...file, size: Number(file.size) + 1 })],
    ]
    const internals = harness.provider as unknown as {
      readonly allocations: Map<string, unknown>
      readonly preparations: Map<string, unknown>
      readonly baselines: Map<string, unknown>
    }
    for (const [label, value] of variants) {
      internals.allocations.clear()
      internals.preparations.clear()
      internals.baselines.clear()
      await writeFile(pathname, JSON.stringify(value))
      await expect(harness.provider.restore(harness.request, allocation), label)
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    }
    await writeFile(pathname, '{')
    internals.allocations.clear()
    internals.preparations.clear()
    await expect(harness.provider.restore(harness.request, allocation)).rejects.toThrow('invalid provider baseline')
  })

  it.each(['EACCES', 'EEXIST'] as const)('fails a baseline %s write without admitting an unowned allocation', async (code) => {
    const root = await freshRoot()
    const harness = await setup(root)
    const preparation = await harness.provider.prepare(harness.request)
    reserveFixtureAllocation(harness, preparation)
    fsFaults.baselineWrite = code
    try {
      const operation = preparation.materialize()
      if (code === 'EEXIST') await expect(operation).rejects.toThrow('no provider baseline')
      else await expect(operation).rejects.toMatchObject({ code: 'EACCES' })
    } finally { fsFaults.baselineWrite = undefined }
  })

  it('propagates a non-absence baseline read error during restore', async () => {
    const root = await freshRoot()
    const harness = await setup(root, { artifact: true, integration: true })
    const allocation = await materialize(harness)
    const stateRoot = join(harness.integrationRoot!, '.clocky-team-shared-state')
    const name = (await readdir(stateRoot)).find(value => value.startsWith('baseline-'))
    if (name === undefined) throw new Error('shared baseline was not retained')
    const pathname = join(stateRoot, name)
    await rm(pathname)
    await mkdir(pathname)
    const internals = harness.provider as unknown as {
      readonly allocations: Map<string, unknown>
      readonly preparations: Map<string, unknown>
      readonly baselines: Map<string, unknown>
    }
    internals.allocations.clear()
    internals.preparations.clear()
    internals.baselines.clear()
    await expect(harness.provider.restore(harness.request, allocation)).rejects.toThrow()
  })

  it('rejects invalid root and provider-name configuration before registration', async () => {
    const root = await freshRoot()
    const file = join(root, 'file')
    await writeFile(file, 'not a directory')
    const missing = join(root, 'missing')

    await expect(SharedWorkspace.apply(new Context(), { root, observationExcludedRoots: [root] }))
      .rejects.toThrow('observationExcludedRoots must not contain the shared root')
    await expect(SharedWorkspace.apply(new Context(), { root, observationExcludedRoots: [missing] }))
      .rejects.toThrow('observationExcludedRoots')
    await expect(SharedWorkspace.apply(new Context(), { root: 'relative' }))
      .rejects.toThrow('root must be an absolute path')
    await expect(SharedWorkspace.apply(new Context(), { root: missing }))
      .rejects.toThrow('cannot be canonicalized')
    await expect(SharedWorkspace.apply(new Context(), { root: file }))
      .rejects.toThrow('is not a directory')
    await expect(SharedWorkspace.apply(new Context(), { root, providerName: ' ' }))
      .rejects.toThrow('providerName must be non-empty')

    await expect(SharedWorkspace.apply(new Context(), { root, integrationEnabled: true }))
      .rejects.toThrow('integrationRoot is required')
    const integrationRoot = await freshRoot()
    await expect(SharedWorkspace.apply(new Context(), { root, integrationRoot, integrationEnabled: true }))
      .rejects.toThrow('artifactProvider is required')
    await expect(SharedWorkspace.apply(new Context(), { root, integrationRoot: root }))
      .rejects.toThrow('must not overlap')
    await expect(SharedWorkspace.apply(new Context(), { root, integrationRoot, artifactProvider: ' ' }))
      .rejects.toThrow('artifactProvider must be non-empty')
    await expect(SharedWorkspace.apply(new Context(), { root, integrationRoot, maxArtifactBytes: 0 }))
      .rejects.toThrow('maxArtifactBytes must be a positive safe integer')
    await expect(SharedWorkspace.apply(new Context(), { root, integrationRoot, maxIntegrationBytes: 0 }))
      .rejects.toThrow('maxIntegrationBytes must be a positive safe integer')
    for (const field of ['observationMaxEntries', 'observationMaxHashBytes', 'observationMaxFileBytes',
      'observationMaxPaths', 'observationMaxStateBytes', 'observationMaxAllocationsPerPulse'] as const) {
      await expect(SharedWorkspace.apply(new Context(), { root, [field]: 0 }))
        .rejects.toThrow('must be a positive')
    }
    await expect(SharedWorkspace.apply(new Context(), { root, observationTimeoutMs: 2_147_483_648 }))
      .rejects.toThrow('observationTimeoutMs must be a positive bounded integer')
    await expect(SharedWorkspace.apply(new Context(), { root, observationPulseIntervalMs: 0 }))
      .rejects.toThrow('observationPulseIntervalMs must be a positive bounded timer delay')
    await expect(SharedWorkspace.apply(new Context(), { root, observationStateRoot: 'relative-state' }))
      .rejects.toThrow('observationStateRoot must not contain')
    await expect(SharedWorkspace.apply(new Context(), { root, observationStateRoot: join(root, '..') }))
      .rejects.toThrow('observationStateRoot must not contain')
    await expect(SharedWorkspace.apply(new Context(), { root, integrationRoot: 'relative-integration' }))
      .rejects.toThrow('integrationRoot must be an absolute path')
    await expect(SharedWorkspace.apply(new Context(), { root, integrationRoot: file }))
      .rejects.toThrow('integrationRoot')

    const harness = await setup(root, 'custom-shared')
    expect(harness.ctx.teamWorkspaces.getProvider('custom-shared')).toBe(harness.provider)
  })
})
