import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Loader from '@clocky/cordis-plugin-loader'
import Include from '@clocky/cordis-plugin-include'
import ActivationSupervisors from '@clocky/clocky-activation-supervisor'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import { activationBindingSnapshotSchema } from '@clocky/clocky-team'
import { createProcessInspector } from '@clocky/clocky-subprocess-local'
import type { ProcessInspector } from '@clocky/clocky-subprocess-local'
import { createHttpActivationSupervisor } from '../src/client.ts'
import * as HttpClient from '../src/client.ts'
import { SdkProcessSupervisor, listenSupervisorEndpoint } from '../src/endpoint.ts'
import { validateSupervisorTarget } from '../src/protocol.ts'
import type { Config, SupervisorHttpEndpoint } from '../src/endpoint.ts'

const config: Config = {
  name: 'remote-sdk', version: 1, hostId: 'host-b', endpointId: 'endpoint-b', runtimeProvider: 'sdk', profile: 'remote-worker',
  bindHost: '127.0.0.1', port: 0, credentialEnv: 'CLOCKY_TEST_SUPERVISOR_CREDENTIAL',
  fenceGraceMs: 100, requestTimeoutMs: 1000, maxPayloadBytes: 8192, maxConcurrentOperations: 4,
}
const signal = new AbortController().signal
const cleanup: Array<() => Promise<unknown>> = []
function controlledInspector(exact = true): ProcessInspector {
  return {
    hasExactIdentity: exact,
    foregroundPgid: () => undefined,
    isStdinWaiting: () => false,
    processTree: pid => [{ pid, started: 'fixture-creation' }],
    processSession: () => [],
    isAlive: () => true,
    signalGroup() { throw new Error('Controlled health-only inspector must not signal a process group') },
    signalProcess() { throw new Error('Controlled health-only inspector must not signal a process') },
  }
}
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  delete process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL
  vi.unstubAllGlobals()
})

function binding(pid = 999999, started = 'fixture-creation', kind: 'sdk' | 'acp' = 'sdk') {
  const provider = kind === 'acp' ? 'acp' : 'sdk'
  return activationBindingSnapshotSchema.parse({
    activation: { id: 'remote-epoch', teamId: 'team-remote', participantId: 'worker-remote', status: 'running' },
    sessionId: 'session-remote', provider,
    recovery: {
      kind: kind === 'acp' ? 'acp-local-cold-replace' : 'sdk-local-cold-replace',
      version: 1, runtimeProvider: provider, profile: config.profile,
      ...kind === 'acp' ? { cwd: '/workspace' } : { agent: { provider: 'local', model: 'model' } },
      process: { hostId: config.hostId, pid, started, processGroupId: pid },
      supervisor: { name: config.name, version: config.version, hostId: config.hostId, endpointId: config.endpointId, generation: 'remote-epoch', terminationMode: 'owned-process' },
    },
  })
}
async function storage(root?: string) {
  if (root === undefined) {
    await mkdir('.tmp-supervisor', { recursive: true })
    root = await mkdtemp(join(process.cwd(), '.tmp-supervisor/http-'))
    const owned = root
    cleanup.push(async () => { await rm(owned, { recursive: true, force: true }) })
  }
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  cleanup.push(async () => { await ctx.fiber.dispose() })
  return { ctx, root }
}
function client(endpoint: SupervisorHttpEndpoint) {
  return createHttpActivationSupervisor({
    name: config.name, version: config.version, hostId: config.hostId, endpointId: config.endpointId,
    credentialEnv: config.credentialEnv, maxPayloadBytes: config.maxPayloadBytes,
    url: `http://127.0.0.1:${endpoint.port}/`, timeoutMs: 1000, allowInsecureHttp: true,
  })
}

describe('authenticated supervisor endpoint', () => {
  it('validates secure URL and credential configuration before creating a remote provider', () => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'test-supervisor-credential'
    const remoteConfig = {
      name: config.name, version: config.version, hostId: config.hostId, endpointId: config.endpointId,
      url: 'http://example.test/', credentialEnv: config.credentialEnv, timeoutMs: 100,
      maxPayloadBytes: config.maxPayloadBytes,
    }
    expect(() => createHttpActivationSupervisor({ ...remoteConfig, url: 'http://example.test/' })).toThrow(/HTTPS/u)
    expect(() => createHttpActivationSupervisor({ ...remoteConfig, url: 'https://user:pass@example.test/' })).toThrow(/HTTPS/u)
    delete process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL
    expect(() => createHttpActivationSupervisor({ ...remoteConfig, url: 'https://example.test/' })).toThrow(/credential environment/u)
  })

  it('maps transport, HTTP, response, and request-bound failures without leaking wire details', async () => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'test-supervisor-credential'
    const remoteConfig = {
      name: config.name, version: config.version, hostId: config.hostId, endpointId: config.endpointId,
      url: 'https://example.test/', credentialEnv: config.credentialEnv, timeoutMs: 100,
      maxPayloadBytes: config.maxPayloadBytes,
    }
    const current = binding()
    const remote = createHttpActivationSupervisor(remoteConfig)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(remote.health(current, signal)).resolves.toMatchObject({ status: 'unreachable' })
    await expect(remote.fence(current, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_TERMINATION_UNCONFIRMED' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })))
    await expect(remote.health(current, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_UNAVAILABLE' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"SUPERVISOR_GENERATION_MISMATCH"}', { status: 409 })))
    await expect(remote.fence(current, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_GENERATION_MISMATCH' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })))
    await expect(remote.health(current, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_TERMINATION_UNCONFIRMED' })

    const tiny = createHttpActivationSupervisor({ ...remoteConfig, maxPayloadBytes: 1 })
    await expect(tiny.health(current, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_INVALID' })
  })

  it('accepts a valid observation and rejects an invalid observation payload', async () => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'test-supervisor-credential'
    const remoteConfig = {
      name: config.name, version: config.version, hostId: config.hostId, endpointId: config.endpointId,
      url: 'https://example.test/', credentialEnv: config.credentialEnv, timeoutMs: 100,
      maxPayloadBytes: config.maxPayloadBytes,
    }
    const current = binding()
    const descriptor = current.recovery!.supervisor
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ descriptor, status: 'reachable' }), { status: 200 })))
    await expect(createHttpActivationSupervisor(remoteConfig).health(current, signal)).resolves.toMatchObject({ status: 'reachable', descriptor })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ descriptor, status: 'gone' }), { status: 200 })))
    await expect(createHttpActivationSupervisor(remoteConfig).health(current, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_INVALID' })
  })

  it.each(['headers', 'body'] as const)('preserves caller cancellation while reading supervisor %s', async (stage) => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'test-supervisor-credential'
    const remote = createHttpActivationSupervisor({
      name: config.name, version: config.version, hostId: config.hostId, endpointId: config.endpointId,
      url: 'https://example.test/', credentialEnv: config.credentialEnv, timeoutMs: 100,
      maxPayloadBytes: config.maxPayloadBytes,
    })
    const controller = new AbortController()
    const reason = new Error('Recovery caller cancelled')
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (stage === 'headers') { controller.abort(reason); throw reason }
      return new Response(new ReadableStream({
        pull(stream) { controller.abort(reason); stream.error(reason) },
      }))
    }))
    await expect(remote.health(binding(), controller.signal)).rejects.toBe(reason)
  })

  it('rejects unrecognized remote error codes without exposing the response details', async () => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'test-supervisor-credential'
    const remote = createHttpActivationSupervisor({
      name: config.name, version: config.version, hostId: config.hostId, endpointId: config.endpointId,
      url: 'https://example.test/', credentialEnv: config.credentialEnv, timeoutMs: 100,
      maxPayloadBytes: config.maxPayloadBytes,
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"PRIVATE_DIAGNOSTIC"}', { status: 409 })))
    await expect(remote.fence(binding(), signal)).rejects.toMatchObject({
      code: 'SUPERVISOR_INVALID', message: 'Supervisor rejected the exact execution operation',
    })
  })

  it('fails closed for routing, authentication, malformed, oversized, and valid HTTP requests', async () => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'test-supervisor-credential'
    const current = binding()
    const observation = { descriptor: current.recovery!.supervisor!, status: 'reachable' as const }
    const provider = {
      name: config.name,
      version: config.version,
      validate: vi.fn(),
      health: vi.fn(async () => observation),
      fence: vi.fn(async () => ({ ...observation, status: 'terminated' as const })),
    }
    const endpoint = await listenSupervisorEndpoint(provider, config)
    cleanup.push(endpoint.close)
    const url = `http://127.0.0.1:${endpoint.port}/`
    const authorization = { authorization: 'Bearer test-supervisor-credential' }
    await expect(fetch(url, { method: 'GET', headers: authorization })).resolves.toMatchObject({ status: 404 })
    await expect(fetch(`${url}wrong`, { method: 'POST', headers: authorization, body: '{}' })).resolves.toMatchObject({ status: 404 })
    await expect(fetch(url, { method: 'POST', body: '{}' })).resolves.toMatchObject({ status: 401 })

    const malformed = await fetch(url, { method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: 'not-json' })
    expect(malformed.status).toBe(409)
    await expect(malformed.json()).resolves.toEqual({ code: 'SUPERVISOR_INVALID' })
    const oversized = await fetch(url, {
      method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: 'x'.repeat(config.maxPayloadBytes + 1),
    })
    expect(oversized.status).toBe(409)
    await expect(oversized.json()).resolves.toEqual({ code: 'SUPERVISOR_INVALID' })

    const valid = await fetch(url, {
      method: 'POST', headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, operation: 'health', binding: current }),
    })
    expect(valid.status).toBe(200)
    await expect(valid.json()).resolves.toEqual(observation)
    expect(provider.validate).toHaveBeenCalled()
    expect(provider.health).toHaveBeenCalled()
  })

  it('returns typed generation and endpoint failures before transport admission', () => {
    const current = binding()
    const missing = structuredClone(current)
    if (missing.recovery === undefined) throw new Error('supervisor test binding has no recovery plan')
    delete missing.recovery.supervisor
    expect(() => validateSupervisorTarget(missing, config)).toThrow(expect.objectContaining({
      code: 'SUPERVISOR_UNAVAILABLE',
    }))

    const generationMismatch = structuredClone(current)
    Object.assign(generationMismatch.recovery!.supervisor!, { generation: 'old-epoch' })
    expect(() => validateSupervisorTarget(generationMismatch, config)).toThrow(expect.objectContaining({
      code: 'SUPERVISOR_GENERATION_MISMATCH',
    }))

    const endpointMismatch = structuredClone(current)
    Object.assign(endpointMismatch.recovery!.supervisor!, { endpointId: 'other-endpoint' })
    expect(() => validateSupervisorTarget(endpointMismatch, config)).toThrow(expect.objectContaining({
      code: 'SUPERVISOR_INVALID',
    }))
  })

  it('loads the client and registry through cordis.yml and observes a durable remote owner', async () => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'test-supervisor-credential'
    const { ctx, root } = await storage()
    const owner = new SdkProcessSupervisor(config, ctx.storageLog, controlledInspector())
    const current = binding()
    await owner.admitOwned(current)
    const endpoint = await listenSupervisorEndpoint(owner, config)
    cleanup.push(endpoint.close)
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@clocky/clocky-activation-supervisor'",
      "- name: '@clocky/clocky-activation-supervisor-http/client'",
      '  config:', '    name: remote-sdk', '    version: 1', '    hostId: host-b', '    endpointId: endpoint-b',
      `    url: http://127.0.0.1:${endpoint.port}/`, '    credentialEnv: CLOCKY_TEST_SUPERVISOR_CREDENTIAL',
      '    timeoutMs: 1000', '    maxPayloadBytes: 8192', '    allowInsecureHttp: true', '',
    ].join('\n'))
    const hub = new Context()
    cleanup.push(async () => { await hub.fiber.dispose() })
    hub.baseUrl = pathToFileURL(root).href + '/'
    await hub.plugin(Loader)
    hub.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@clocky/clocky-activation-supervisor', ActivationSupervisors],
      ['@clocky/clocky-activation-supervisor-http/client', HttpClient],
    ])
    hub.loader.internal = {
      version: 'v2',
      loadCache: new Map(),
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`Unexpected supervisor Loader import: ${specifier}`)
        return modules.get(specifier)
      },
      register() { throw new Error('This source-only Loader fixture does not register Node hooks') },
      getOrCreateModuleJob() { throw new Error('This source-only Loader fixture does not compile module jobs') },
      resolveSync() { throw new Error('This source-only Loader fixture resolves its declared module map') },
      load() { throw new Error('This source-only Loader fixture loads its declared module map') },
    }
    await hub.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await hub.loader.await()
    const observed = await hub.activationSupervisors.health(current, signal)
    expect({ host: observed.descriptor.hostId, generation: observed.descriptor.generation, status: observed.status }).toMatchInlineSnapshot(`
      {
        "generation": "remote-epoch",
        "host": "host-b",
        "status": "reachable",
      }
    `)
  })

  it('persists owner admission across restart and rejects substituted process facts', async () => {
    const first = await storage()
    const inspector = controlledInspector()
    const current = binding()
    const owner = new SdkProcessSupervisor(config, first.ctx.storageLog, inspector)
    await expect(owner.health(current, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_UNAVAILABLE' })
    await owner.admitOwned(current)
    await first.ctx.fiber.dispose()
    const restarted = await storage(first.root)
    const recovered = new SdkProcessSupervisor(config, restarted.ctx.storageLog, inspector)
    await expect(recovered.health(current, signal)).resolves.toMatchObject({ status: 'reachable' })
    await expect(recovered.health(binding(999998, 'another-process'), signal)).rejects.toMatchObject({ code: 'SUPERVISOR_GENERATION_MISMATCH' })
    const missingEpoch = structuredClone(current)
    Object.assign(missingEpoch.activation, { id: 'unowned-epoch' })
    Object.assign(missingEpoch.recovery!.supervisor!, { generation: 'unowned-epoch' })
    await expect(recovered.health(missingEpoch, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_UNAVAILABLE' })
  })

  it('accepts the ACP local recovery record through the same authenticated supervisor seam', async () => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'test-supervisor-credential'
    const { ctx } = await storage()
    const acpConfig: Config = {
      name: config.name, version: config.version, hostId: config.hostId, endpointId: config.endpointId,
      runtimeProvider: 'acp', profile: config.profile, bindHost: config.bindHost, port: config.port,
      credentialEnv: config.credentialEnv, fenceGraceMs: config.fenceGraceMs, requestTimeoutMs: config.requestTimeoutMs,
      maxPayloadBytes: config.maxPayloadBytes, maxConcurrentOperations: config.maxConcurrentOperations,
    }
    const current = binding(999999, 'fixture-creation', 'acp')
    const owner = new SdkProcessSupervisor(acpConfig, ctx.storageLog, controlledInspector())
    await owner.admitOwned(current)
    const endpoint = await listenSupervisorEndpoint(owner, acpConfig)
    cleanup.push(endpoint.close)
    const remote = createHttpActivationSupervisor({
      name: acpConfig.name, version: acpConfig.version, hostId: acpConfig.hostId, endpointId: acpConfig.endpointId,
      credentialEnv: acpConfig.credentialEnv, maxPayloadBytes: acpConfig.maxPayloadBytes,
      url: `http://127.0.0.1:${endpoint.port}/`, timeoutMs: 1000, allowInsecureHttp: true,
    })
    await expect(remote.health(current, signal)).resolves.toMatchObject({
      status: 'reachable', descriptor: current.recovery!.supervisor,
    })
  })

  it('requires authentication and exact owner enrollment through the real HTTP route', async () => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'test-supervisor-credential'
    const { ctx } = await storage()
    const owner = new SdkProcessSupervisor(config, ctx.storageLog, controlledInspector())
    const current = binding()
    await owner.admitOwned(current)
    const endpoint = await listenSupervisorEndpoint(owner, config)
    cleanup.push(endpoint.close)
    const remote = client(endpoint)
    await expect(remote.health(current, signal)).resolves.toMatchObject({ status: 'reachable', descriptor: current.recovery!.supervisor })
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(401)
    const altered = binding(999998, 'another-process')
    await expect(remote.fence(altered, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_GENERATION_MISMATCH' })
    await endpoint.close()
    await expect(remote.health(current, signal)).resolves.toMatchObject({ status: 'unreachable' })
    await expect(remote.fence(current, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_TERMINATION_UNCONFIRMED' })
  })

  it('reloads the credential for existing clients and endpoints after rotation', async () => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'initial-supervisor-credential'
    const { ctx } = await storage()
    const owner = new SdkProcessSupervisor(config, ctx.storageLog, controlledInspector())
    const current = binding()
    await owner.admitOwned(current)
    const endpoint = await listenSupervisorEndpoint(owner, config)
    cleanup.push(endpoint.close)
    const remote = client(endpoint)

    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'rotated-supervisor-credential'
    await expect(remote.health(current, signal)).resolves.toMatchObject({ status: 'reachable' })

    delete process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL
    await expect(remote.health(current, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_UNAVAILABLE' })
    const unavailable = await fetch(`http://127.0.0.1:${endpoint.port}/`, {
      method: 'POST',
      headers: { authorization: 'Bearer rotated-supervisor-credential', 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, operation: 'health', binding: current }),
    })
    expect(unavailable.status).toBe(503)
  })

  it('rejects unsupported host inspection without pretending macOS timestamps are exact', async () => {
    const { ctx } = await storage()
    expect(() => new SdkProcessSupervisor(config, ctx.storageLog, controlledInspector(false))).toThrow('exact process creation identities')
  })

  it('retires the durable owner and refuses new recovery operations', async () => {
    const { ctx } = await storage()
    const owner = new SdkProcessSupervisor(config, ctx.storageLog, controlledInspector())
    await owner.close()
    await expect(owner.health(binding(), signal)).rejects.toMatchObject({ code: 'SUPERVISOR_UNAVAILABLE' })
  })

  it.skipIf(process.platform === 'win32')('fences a real owned detached process over HTTP and replays its terminated generation after endpoint restart', async () => {
    process.env.CLOCKY_TEST_SUPERVISOR_CREDENTIAL = 'test-supervisor-credential'
    const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    await once(child.stdout, 'data')
    const exited = once(child, 'exit')
    cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited } })
    const inspector = createProcessInspector()
    const identity = inspector.processTree(child.pid!).find(item => item.pid === child.pid)
    expect(identity).toBeDefined()
    const current = binding(identity!.pid, identity!.started)
    const { ctx } = await storage()
    const owner = new SdkProcessSupervisor(config, ctx.storageLog, inspector)
    await owner.admitOwned(current)
    const endpoint = await listenSupervisorEndpoint(owner, config)
    cleanup.push(endpoint.close)
    const remote = client(endpoint)
    await expect(remote.health(current, signal)).resolves.toMatchObject({ status: 'reachable' })
    await expect(remote.fence(current, signal)).resolves.toMatchObject({ status: 'terminated' })
    await exited
    expect(inspector.isAlive(identity!)).toBe(false)
    await endpoint.close()
    const restarted = await listenSupervisorEndpoint(new SdkProcessSupervisor(config, ctx.storageLog, inspector), config)
    cleanup.push(restarted.close)
    await expect(client(restarted).fence(current, signal)).resolves.toMatchObject({ status: 'terminated' })
  })
})
