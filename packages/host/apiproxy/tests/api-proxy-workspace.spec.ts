import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRegistry from '@clocky/clocky-agent'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import Storage from '@clocky/clocky-storage'
import { DomainFacility } from '@clocky/clocky-storage-domain'
import UserQuestionService from '@clocky/clocky-user-questions'
import { DirectoryPickerError } from '@clocky/clocky-host-directory-picker'
import type { DirectoryPickerCapability } from '@clocky/clocky-host-directory-picker'
import WorkspaceRegistry from '@clocky/clocky-workspace'
import type { HostFrame, WorkspaceId } from '@clocky/clocky-host-apiproxy/api'
import type { RpcRequest, RpcResponse } from '@clocky/clocky-host-apiproxy/api/rpc'
import { RpcId } from '@clocky/clocky-host-apiproxy/api/rpc'
import { createApiProxy } from '@clocky/clocky-host-apiproxy'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`workspace-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

async function nextHostFrame(
  stream: AsyncIterator<RpcRequest<HostFrame>>,
): Promise<RpcRequest<HostFrame>> {
  const next = await stream.next()
  if (next.done === true) throw new Error('Host stream ended before the expected increment')
  return next.value
}

/** Compose the API over real Session, Agent, Storage, Domain, and Workspace services. */
async function harness(
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'clocky-apiproxy-workspace-'))),
  picker: DirectoryPickerCapability = { kind: 'native', pick: async () => null },
  extras: {
    openPath?: (path: string, signal: AbortSignal) => Promise<void>
    canOpenPath?: () => boolean
  } = {},
) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)

  // Structural picker fake: the gateway only reads capability(); a stable
  // object per harness mirrors the seam's stability contract.
  ctx.provide('directoryPicker', { capability: () => picker } as never)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
    ...extras.openPath === undefined ? {} : { openPath: extras.openPath },
    ...extras.canOpenPath === undefined ? {} : { canOpenPath: extras.canOpenPath },
  })
  return { api, ctx, storageDomain, root }
}

/** Stage one directory under the harness root for path adoption. */
function stageDir(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path)
  return path
}

describe('host.pickDirectory', () => {
  it('returns a selected path or explicit cancellation from the native capability', async () => {
    const selected = await harness(undefined, { kind: 'native', pick: async () => '/tmp/project' })
    expect((await selected.api.host.pickDirectory(request({}), new AbortController().signal)).result)
      .toEqual({ ok: true, value: { path: '/tmp/project' } })

    const cancelled = await harness(undefined, { kind: 'native', pick: async () => null })
    expect((await cancelled.api.host.pickDirectory(request({}), new AbortController().signal)).result)
      .toEqual({ ok: true, value: { path: null } })
  })

  it('propagates abort into the native capability as a cancelled RPC error', async () => {
    const { api } = await harness(undefined, {
      kind: 'native',
      pick: signal => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      }),
    })
    const abort = new AbortController()
    const pending = api.host.pickDirectory(request({}), abort.signal)
    abort.abort()
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('folds a non-abort native-chooser failure into an internal error', async () => {
    const { api } = await harness(undefined, { kind: 'native', pick: async () => { throw new Error('no chooser installed') } })
    const response = await api.host.pickDirectory(request({}), new AbortController().signal)
    expect(response.result).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('refuses the native RPC under a browse composition', async () => {
    const { api } = await harness(undefined, BROWSE_STUB)
    const response = await api.host.pickDirectory(request({}), new AbortController().signal)
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'directory-picker-unavailable', details: { capability: 'browse' } },
    })
  })
})

/** Canned browse capability: one listing, one created path, typed failures on demand. */
const BROWSE_STUB: DirectoryPickerCapability = {
  kind: 'browse',
  list: async (path) => {
    if (path === '/denied') throw new DirectoryPickerError('directory-unreadable', '/denied', 'cannot list /denied')
    const target = path ?? '/home/user'
    return {
      path: target,
      home: '/home/user',
      crumbs: [{ name: '/', path: '/', hidden: false }],
      entries: [{ name: 'projects', path: `${target}/projects`, hidden: false }],
      truncated: false,
    }
  },
  createDirectory: async (path, name) => {
    if (name === 'taken') throw new DirectoryPickerError('directory-exists', `${path}/${name}`, 'already exists')
    if (name === 'unwritable') throw new Error('disk detached')
    return `${path}/${name}`
  },
}

describe('host.listDirectory / host.createDirectory', () => {
  it('serves listings and creation through the browse capability, defaulting to home', async () => {
    const { api } = await harness(undefined, BROWSE_STUB)
    const home = await api.host.listDirectory(request({}), new AbortController().signal)
    expect(home.result).toMatchObject({ ok: true, value: { path: '/home/user', home: '/home/user' } })
    const listed = await api.host.listDirectory(request({ path: '/home/user/projects' }), new AbortController().signal)
    expect(listed.result).toMatchObject({ ok: true, value: { path: '/home/user/projects' } })
    const created = await api.host.createDirectory(request({ path: '/home/user', name: 'fresh' }))
    expect(created.result).toEqual({ ok: true, value: { path: '/home/user/fresh' } })
  })

  it('maps typed picker failures onto the wire error codes and folds unknown throws to internal', async () => {
    const { api } = await harness(undefined, BROWSE_STUB)
    expect((await api.host.listDirectory(request({ path: '/denied' }), new AbortController().signal)).result).toMatchObject({
      ok: false, error: { code: 'directory-unreadable', details: { path: '/denied' } },
    })
    expect((await api.host.createDirectory(request({ path: '/home/user', name: 'taken' }))).result).toMatchObject({
      ok: false, error: { code: 'directory-exists' },
    })
    expect((await api.host.createDirectory(request({ path: '/home/user', name: 'unwritable' }))).result).toMatchObject({
      ok: false, error: { code: 'internal' },
    })
  })

  it('reports an aborted listing as cancelled, like the other signal-following RPCs', async () => {
    const { api } = await harness(undefined, {
      kind: 'browse',
      list: (_path, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('scan aborted')) }, { once: true })
      }),
      createDirectory: async () => '/never',
    })
    const abort = new AbortController()
    const pending = api.host.listDirectory(request({}), abort.signal)
    abort.abort()
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('refuses the browse RPCs under a native composition', async () => {
    const { api } = await harness()
    expect((await api.host.listDirectory(request({}), new AbortController().signal)).result).toMatchObject({
      ok: false, error: { code: 'directory-picker-unavailable', details: { capability: 'native' } },
    })
    expect((await api.host.createDirectory(request({ path: '/x', name: 'y' }))).result).toMatchObject({
      ok: false, error: { code: 'directory-picker-unavailable', details: { capability: 'native' } },
    })
  })
})

describe('host.openPath', () => {
  it('describes whether this deployment can reach a user-visible native desktop', async () => {
    const visible = await harness(undefined, undefined, { canOpenPath: () => true })
    const headless = await harness(undefined, undefined, { canOpenPath: () => false })
    expect(expectOk(await visible.api.host.describe(request({}))).canOpenPath).toBe(true)
    expect(expectOk(await headless.api.host.describe(request({}))).canOpenPath).toBe(false)
    expect(expectOk(await visible.api.host.describe(request({}))).home).toBe(homedir())
  })

  it('opens through the injected native boundary', async () => {
    const opened: string[] = []
    const { api } = await harness(undefined, undefined, {
      openPath: async (path) => { opened.push(path) },
    })
    expect((await api.host.openPath(request({ path: '/tmp/a.txt' }), new AbortController().signal)).result)
      .toEqual({ ok: true, value: { opened: true } })
    expect(opened).toEqual(['/tmp/a.txt'])
  })

  it('propagates abort into the native boundary as a cancelled RPC error', async () => {
    const { api } = await harness(undefined, undefined, {
      openPath: (_path, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      }),
    })
    const abort = new AbortController()
    const pending = api.host.openPath(request({ path: '/tmp/a.txt' }), abort.signal)
    abort.abort()
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})

describe('workspace.create', () => {
  it('serializes concurrent creates of one path into a single registration', async () => {
    const { api, root } = await harness()
    const target = stageDir(root, 'alpha')
    const responses = await Promise.all([
      api.workspace.create(request({ path: target })),
      api.workspace.create(request({ path: target })),
    ])
    const values = responses.map(response => expectOk(response))
    const created = values.find(value => value.created)
    const resolved = values.find(value => !value.created)

    expect(created).toMatchObject({ workspace: { path: target, title: 'alpha' } })
    expect(resolved?.workspace.workspaceId).toBe(created?.workspace.workspaceId)
    expect(expectOk(await api.workspace.list(request({}))).items).toHaveLength(1)
  })

  it('adopts only existing directories', async () => {
    const { api, root } = await harness()
    const existing = stageDir(root, 'existing')
    const first = expectOk(await api.workspace.create(request({ path: existing })))
    const repeated = expectOk(await api.workspace.create(request({ path: existing })))
    expect(first).toMatchObject({ created: true, workspace: { path: existing, title: 'existing' } })
    expect(repeated).toMatchObject({ created: false, workspace: { workspaceId: first.workspace.workspaceId } })

    expectOk(await api.workspace.rename(request({
      workspaceId: first.workspace.workspaceId,
      title: 'renamed-existing',
    })))
    const reopened = expectOk(await api.workspace.create(request({ path: existing })))
    expect(reopened.workspace.title).toBe('renamed-existing')

    const missing = join(root, 'missing')
    const missingResult = await api.workspace.create(request({ path: missing }))
    expect(missingResult.result).toMatchObject({ ok: false, error: { code: 'workspace-invalid-path' } })
    expect(existsSync(missing)).toBe(false)
  })

  it('adopts different paths that derive the same Workspace title', async () => {
    const { api, root } = await harness()
    const first = join(root, 'one', 'project')
    const second = join(root, 'two', 'project')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    const firstResult = expectOk(await api.workspace.create(request({ path: first })))
    const secondResult = expectOk(await api.workspace.create(request({ path: second })))
    expect(firstResult).toMatchObject({
      created: true,
      workspace: { path: first, title: 'project' },
    })
    expect(secondResult).toMatchObject({
      created: true,
      workspace: { path: second, title: 'project' },
    })
    expect(secondResult.workspace.workspaceId).not.toBe(firstResult.workspace.workspaceId)
    expect(expectOk(await api.workspace.list(request({}))).items.map(workspace => workspace.path))
      .toEqual([second, first])
  })
})

describe('workspace.insertBefore', () => {
  it('commits the complete order, streams one order frame, and maps unknown ids', async () => {
    const { api, ctx, root } = await harness()
    const first = expectOk(await api.workspace.create(request({ path: stageDir(root, 'first') }))).workspace
    const second = expectOk(await api.workspace.create(request({ path: stageDir(root, 'second') }))).workspace
    const third = expectOk(await api.workspace.create(request({ path: stageDir(root, 'third') }))).workspace

    const abort = new AbortController()
    const listWorkspaces = vi.spyOn(ctx.workspaceRegistry, 'list')
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    expect(listWorkspaces).toHaveBeenCalledTimes(1)
    const changed = nextHostFrame(stream)
    const reordered = expectOk(await api.workspace.insertBefore(request({
      workspaceId: first.workspaceId,
      beforeWorkspaceId: second.workspaceId,
    })))
    expect(reordered.workspaceIds).toEqual([third.workspaceId, first.workspaceId, second.workspaceId])
    expect(await changed).toMatchObject({
      payload: {
        type: 'host/workspace-order-changed',
        workspaceIds: [third.workspaceId, first.workspaceId, second.workspaceId],
      },
    })
    expect(expectOk(await api.workspace.list(request({}))).items.map(item => item.workspaceId))
      .toEqual(reordered.workspaceIds)

    const missingSource = await api.workspace.insertBefore(request({
      workspaceId: 'missing' as WorkspaceId,
    }))
    expect(missingSource.result).toMatchObject({
      ok: false, error: { code: 'workspace-not-found', details: { workspaceId: 'missing' } },
    })
    const missingAnchor = await api.workspace.insertBefore(request({
      workspaceId: first.workspaceId,
      beforeWorkspaceId: 'missing-anchor' as WorkspaceId,
    }))
    expect(missingAnchor.result).toMatchObject({
      ok: false, error: { code: 'workspace-not-found', details: { workspaceId: 'missing-anchor' } },
    })
    abort.abort()
  })
})

describe('Host Workspace increments', () => {
  it('keeps internal child lineage out of summaries and creation increments', async () => {
    const { api, ctx } = await harness()
    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const pending = nextHostFrame(stream)
    const childId = SessionId('session-subagent-child')

    ctx.sessions.create(childId, {
      meta: {
        cwd: '/tmp',
        parentSession: SessionId('session-parent'),
      },
    })

    const added = await pending
    expect(added).toMatchObject({
      payload: {
        type: 'host/session-added',
        sessionId: childId,
        cwd: '/tmp',
      },
    })
    expect(added.payload).not.toHaveProperty('parentSessionId')
    expect(added.payload).not.toHaveProperty('origin')
    const summary = expectOk(await api.sessions.list(request({}))).items
      .find(item => item.sessionId === childId)
    expect(summary).toMatchObject({ sessionId: childId, cwd: '/tmp' })
    expect(summary).not.toHaveProperty('parentSessionId')
    expect(summary).not.toHaveProperty('origin')
    abort.abort()
  })

  it('streams a committed Workspace increment after an empty baseline', async () => {
    const { api, root } = await harness()
    expect(expectOk(await api.workspace.list(request({}))).items).toEqual([])

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const workspaceIncrement = nextHostFrame(stream)
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
    expect(await workspaceIncrement).toMatchObject({
      payload: { type: 'host/workspace-changed', workspace: { workspaceId: workspace.workspaceId } },
    })
    abort.abort()
  })

  it('does not publish a Workspace whose registry-order commit fails', async () => {
    const { api, storageDomain, root } = await harness()
    const domain = storageDomain.get('workspace')
    if (domain === undefined) throw new Error('workspace domain is not open')
    vi.spyOn(domain.global, 'set').mockRejectedValueOnce(new Error('simulated registry order failure'))
    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const next = stream.next()

    const failed = await api.workspace.create(request({ path: stageDir(root, 'ghost') }))
    expect(failed.result.ok).toBe(false)
    expect(expectOk(await api.workspace.list(request({}))).items).toEqual([])
    abort.abort()
    expect(await next).toMatchObject({ done: true })
  })

  it('deletes the registration, keeps its session and folder, and streams one removal', async () => {
    const { api, ctx, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'delete-me') }))).workspace
    const sessionId = SessionId('session-kept-after-workspace-delete')
    ctx.sessions.create(sessionId, { meta: { cwd: workspace.path } })
    const workspaceEntity = ctx.workspaceRegistry.list()[0]
    if (workspaceEntity === undefined) throw new Error('workspace missing from registry')
    await workspaceEntity.attachSession(sessionId)

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const removed = nextHostFrame(stream)
    expectOk(await api.workspace.delete(request({ workspaceId: workspace.workspaceId })))
    expect(await removed).toMatchObject({
      payload: { type: 'host/workspace-removed', workspaceId: workspace.workspaceId },
    })
    expect(expectOk(await api.workspace.list(request({}))).items).toEqual([])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(sessionId)
    expect(ctx.sessions.get(sessionId)).toBeDefined()
    expect(existsSync(workspace.path)).toBe(true)

    const missing = await api.workspace.delete(request({ workspaceId: workspace.workspaceId }))
    expect(missing.result).toMatchObject({
      ok: false,
      error: { code: 'workspace-not-found', details: { workspaceId: workspace.workspaceId } },
    })

    const reregistered = expectOk(await api.workspace.create(request({ path: workspace.path }))).workspace
    expect(reregistered.workspaceId).not.toBe(workspace.workspaceId)
    expect(reregistered.path).toBe(workspace.path)
    expect(reregistered.sessionIds).toEqual([])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(sessionId)
    abort.abort()
  })

  it('archives a session into the global set, keeps its accounting, and streams the set once', async () => {
    const { api, ctx, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'archive-home') }))).workspace
    const sessionId = SessionId('session-to-archive')
    ctx.sessions.create(sessionId, { meta: { cwd: workspace.path } })
    const workspaceEntity = ctx.workspaceRegistry.list()[0]
    if (workspaceEntity === undefined) throw new Error('workspace missing from registry')
    await workspaceEntity.attachSession(sessionId)
    expect(expectOk(await api.workspace.list(request({}))).archivedSessionIds).toEqual([])

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const changed = nextHostFrame(stream)
    expect(expectOk(await api.workspace.archiveSession(request({ sessionId }))).archivedSessionIds)
      .toEqual([sessionId])
    expect(await changed).toMatchObject({
      payload: { type: 'host/archived-sessions-changed', archivedSessionIds: [sessionId] },
    })

    // Accounting and the session itself are untouched; list re-baselines the set.
    const listed = expectOk(await api.workspace.list(request({})))
    expect(listed.archivedSessionIds).toEqual([sessionId])
    expect(listed.items[0]?.sessionIds).toEqual([sessionId])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(sessionId)

    // The idempotent repeat emits no second archive frame.
    const after = nextHostFrame(stream)
    expect(expectOk(await api.workspace.archiveSession(request({ sessionId }))).archivedSessionIds)
      .toEqual([sessionId])
    const otherSession = SessionId('session-after-archive')
    ctx.sessions.create(otherSession, { meta: { cwd: workspace.path } })
    expect((await after).payload.type).not.toBe('host/archived-sessions-changed')

    const missing = await api.workspace.archiveSession(request({ sessionId: SessionId('session-ghost') }))
    expect(missing.result).toMatchObject({
      ok: false,
      error: { code: 'session-not-found', details: { sessionId: 'session-ghost' } },
    })
    abort.abort()
  })
})
