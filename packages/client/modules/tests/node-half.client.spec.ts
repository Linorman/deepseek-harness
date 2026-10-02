/** Node-half composition diagnostics for package metadata and built client bundles. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { Context, FiberState } from '@clocky/cordis'
import Loader from '@clocky/cordis-plugin-loader'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderIndexInjections, type WebServer, type WebRoute } from '@clocky/clocky-host-webserver'
import * as modulesClient from '../src/client/index.ts'
import { ClientModuleRegistry, bootInjections, orderByModuleGraph, type Config } from '../src/index.ts'
import type { ClientModuleLoaderTarget, WebBootEntry, WebBootGraph } from '../src/client/index.ts'

const MODULES_ID = '@clocky/clocky-client-modules'
const RUNTIME_ID = '@clocky/clocky-client-runtime'

let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

/** Create a resolvable package whose client export points at the returned path. */
function writePackage(
  packageName: string,
  metadata: Record<string, unknown> = { clocky: { client: { platform: 'web' } } },
): string {
  const temporary = join(process.cwd(), '.tmp/client-module-node-half')
  mkdirSync(temporary, { recursive: true })
  root ??= realpathSync(mkdtempSync(join(temporary, 'fixture-')))
  const pkgRoot = join(root, 'node_modules', ...packageName.split('/'))
  const clientPath = join(pkgRoot, 'lib', 'client.js')
  mkdirSync(pkgRoot, { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({
    name: packageName,
    exports: {
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    ...metadata,
  }))
  return clientPath
}

/** Create a built package with the supplied client declaration. */
function writeBuiltPackage(packageName: string, client: Record<string, unknown>): void {
  const clientPath = writePackage(packageName, { clocky: { client: { platform: 'web', ...client } } })
  mkdirSync(dirname(clientPath), { recursive: true })
  writeFileSync(clientPath, 'module.exports = {}\n')
}

/** Construct the node-half service and capture its plugin-bundle route. */
function constructWithRoute(packageNames: string[], config: Config = {}): { service: ClientModuleRegistry; route: WebRoute } {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  ctx.provide('loader', {
    *entries() {
      for (const packageName of packageNames) {
        yield { options: { name: packageName, config: { hostOnly: 'never-forwarded-marker' } }, fiber: { state: FiberState.ACTIVE }, disabled: false }
      }
    },
  })
  let route: WebRoute | undefined
  const webServer: Pick<WebServer, 'port' | 'register' | 'tapIndex'> = {
    port: 0,
    register: (candidate) => {
      if (candidate.path === '/plugins') route = candidate
      return () => {}
    },
    tapIndex: () => () => {},
  }
  ctx.provide('webServer', webServer as WebServer)
  const service = new ClientModuleRegistry(ctx, config)
  if (route === undefined) throw new Error('client bundle route was not registered')
  return { service, route }
}

/** Construct the node-half service over the enabled fixture entries. */
function construct(packageNames: string[]): ClientModuleRegistry {
  return constructWithRoute(packageNames).service
}

/** Execute the exact first inline script emitted by the Host boot rows. */
function injectedFacade(graph: WebBootGraph): { html: string; target: ClientModuleLoaderTarget } {
  const html = renderIndexInjections(
    '<html><head></head><body><script type="module" src="/index.js"></script></body></html>',
    bootInjections(graph),
  )
  const source = /<head><script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (source === undefined) throw new Error('missing injected ModuleLoader facade script')
  const window: { __ModuleLoader__?: ClientModuleLoaderTarget } = {}
  runInNewContext(source, { window })
  if (window.__ModuleLoader__ === undefined) throw new Error('facade script did not install __ModuleLoader__')
  return { html, target: window.__ModuleLoader__ }
}

it('publishes only explicitly configured browser options and includes them in the graph revision', () => {
  writeBuiltPackage('configured-client', {})
  const empty = constructWithRoute(['configured-client']).service.graph()
  const config = { browserConfig: { 'configured-client': { maxDrafts: 4, nested: { enabled: true } } } }
  const configured = constructWithRoute(['configured-client'], config).service.graph()
  expect(configured.entries[0]?.config).toEqual(config.browserConfig['configured-client'])
  expect(configured.rev).not.toBe(empty.rev)
  expect(JSON.stringify(configured)).not.toContain('never-forwarded-marker')
  config.browserConfig['configured-client'].nested.enabled = false
  expect(configured.entries[0]?.config).toMatchObject({ nested: { enabled: true } })
  expect(empty.entries[0]).not.toHaveProperty('config')
})

it('refuses non-JSON options and unknown browser config targets', () => {
  writeBuiltPackage('configured-client', {})
  expect(() => constructWithRoute(['configured-client'], { browserConfig: { missing: {} } })).toThrow(/not a declared browser plugin/)
  expect(() => constructWithRoute(['configured-client'], { browserConfig: { 'configured-client': { invalid: Infinity } } })).toThrow()
})

const bootGraph = (): WebBootGraph => ({
  rev: 'graph',
  entries: [
    { id: MODULES_ID, url: '/plugins/modules.js?rev=m', rev: 'm' },
    { id: RUNTIME_ID, url: '/plugins/runtime.js?rev=r', rev: 'r' },
  ],
})

describe('HTML bootstrap facade', () => {
  it('precedes blocking preloads and the boot graph, then becomes the live registration target', async () => {
    const graph = bootGraph()
    const { html, target } = injectedFacade(graph)
    const facadeAt = html.indexOf('window.__ModuleLoader__=')
    const modulesAt = html.indexOf('<script src="/plugins/modules.js?rev=m"></script>')
    const runtimeAt = html.indexOf('<script src="/plugins/runtime.js?rev=r"></script>')
    const graphAt = html.indexOf('globalThis["__CLOCKY_BOOT__"] = ')
    const entryAt = html.indexOf('<script type="module" src="/index.js"></script>')
    expect([facadeAt, modulesAt, runtimeAt, graphAt, entryAt]).toEqual([...new Set([
      facadeAt, modulesAt, runtimeAt, graphAt, entryAt,
    ])].sort((a, b) => a - b))

    target.load({ id: MODULES_ID, factory: () => modulesClient })
    target.load({ id: RUNTIME_ID, factory: () => ({ marker: 'runtime' }) })
    const system = target.create({ boot: graph, staticModules: {} })

    expect(target.mode).toBe('live')
    expect(target.pendingQueue).toEqual([])
    expect(system.manifest.rev).toBe('graph')
    expect(await system.import(MODULES_ID)).toBe(modulesClient)
    expect(await system.import(`${RUNTIME_ID}/client`)).toEqual({ marker: 'runtime' })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow('create called after module-system boot')
  })

  it('rejects a page that did not preload the modules bundle', () => {
    const graph = bootGraph()
    const { target } = injectedFacade(graph)
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`HTML did not preload ${MODULES_ID}/client.js`)
  })

  it('rejects a bootstrap bundle with a runtime external', () => {
    const graph = bootGraph()
    const { target } = injectedFacade(graph)
    target.load({
      id: MODULES_ID,
      factory: (require) => {
        require('react')
        return modulesClient
      },
    })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`${MODULES_ID}/client.js requested external "react"`)
  })

  it.each([
    null,
    { ...modulesClient, createClientModuleSystem: undefined },
    { ...modulesClient, apply: undefined },
  ])('rejects a bootstrap bundle without the complete module face', (exports) => {
    const graph = bootGraph()
    const { target } = injectedFacade(graph)
    target.load({ id: MODULES_ID, factory: () => exports as unknown as Record<string, unknown> })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`${MODULES_ID}/client.js did not export the bootstrap module face`)
  })
})

describe('client bundle activation', () => {
  it('allows sibling clocky roles', () => {
    const currentName = '@fixture/current-client-field'
    const clientPath = writePackage(currentName, {
      clocky: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web' },
        profile: { bundles: [] },
      },
    })
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')
    expect(construct([currentName]).graph().entries.map(entry => entry.id)).toEqual([currentName])
  })

  it('groups missing bundles under one source-build instruction with a package/path list', () => {
    const firstName = '@fixture/missing-first'
    const secondName = '@fixture/missing-second'
    const firstPath = writePackage(firstName)
    const secondPath = writePackage(secondName)
    expect(() => construct([firstName, secondName])).toThrow([
      'client-modules: 2 client packages failed to compose:',
      '  client bundles not found; run `pnpm run build` before launch:',
      `    - package: ${firstName}`,
      `      path: ${firstPath}`,
      `    - package: ${secondName}`,
      `      path: ${secondPath}`,
    ].join('\n'))
  })

  it('does not report other bundle read failures as missing builds', () => {
    const packageName = '@fixture/unreadable-client'
    const clientPath = writePackage(packageName)
    mkdirSync(clientPath, { recursive: true })
    let thrown: unknown
    try {
      construct([packageName])
    } catch (error) {
      thrown = error
    }
    expect(String(thrown)).toContain('client-modules: 1 client package failed to compose:')
    expect(String(thrown)).toContain('  other failures:')
    expect(String(thrown)).toContain('EISDIR')
    expect(String(thrown)).not.toContain('pnpm run build')
  })

  it('serves the source map beside a registered client bundle', async () => {
    const packageName = '@fixture/source-map'
    const clientPath = writePackage(packageName)
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')
    const map = '{"version":3,"sources":["src/client/index.tsx"]}\n'
    writeFileSync(`${clientPath}.map`, map)
    const { route } = constructWithRoute([packageName])
    let status = 0
    let headers: Record<string, string> | undefined
    let body = ''
    const response = {
      writeHead(nextStatus: number, nextHeaders?: Record<string, string>) {
        status = nextStatus
        headers = nextHeaders
        return response
      },
      end(chunk?: Uint8Array) {
        body = chunk === undefined ? '' : Buffer.from(chunk).toString('utf8')
        return response
      },
    } as unknown as ServerResponse

    await route.handler({
      method: 'GET',
      url: `/plugins/${packageName}/client.js.map`,
    } as IncomingMessage, response)

    expect(status).toBe(200)
    expect(headers).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
    })
    expect(body).toBe(map)
  })
})

describe('shared module declarations', () => {
  it('accepts external requests and carries them onto the graph row', () => {
    const packageName = '@fixture/shared-declared'
    writeBuiltPackage(packageName, { external: ['react'] })
    expect(construct([packageName]).graph().entries).toEqual([{
      id: packageName,
      url: expect.stringContaining(`/plugins/${packageName}/client.js?rev=`) as unknown as string,
      rev: expect.any(String) as unknown as string,
      external: ['react'],
    }])
  })

  it('omits external when the package declares no requests', () => {
    const packageName = '@fixture/shared-absent'
    writeBuiltPackage(packageName, {})
    const [row] = construct([packageName]).graph().entries
    expect(row).not.toHaveProperty('external')
  })

  it('rejects a non-array external', () => {
    const packageName = '@fixture/external-not-array'
    writeBuiltPackage(packageName, { external: 'react' })
    expect(() => construct([packageName]))
      .toThrow(`client-modules: ${packageName} clocky.client.external must be a string array`)
  })
})

describe('module graph order', () => {
  const entry = (id: string, fields: Partial<WebBootEntry> = {}): WebBootEntry =>
    ({ id, url: `/plugins/${id}/client.js?rev=0`, rev: '0', ...fields })
  const ids = (entries: readonly WebBootEntry[]): string[] => entries.map(row => row.id)

  it('places every requested package row before its consumers along a chain', () => {
    expect(ids(orderByModuleGraph([
      entry('ui', { external: ['slots'] }),
      entry('slots', { external: ['render'] }),
      entry('render'),
    ]))).toEqual(['render', 'slots', 'ui'])
  })

  it('places a shared package row before both arms of a diamond', () => {
    expect(ids(orderByModuleGraph([
      entry('app', { external: ['left', 'right'] }),
      entry('left', { external: ['vendor'] }),
      entry('right', { external: ['vendor'] }),
      entry('vendor'),
    ]))).toEqual(['vendor', 'left', 'right', 'app'])
  })

  it('resolves a /client request onto the requested package row', () => {
    expect(ids(orderByModuleGraph([
      entry('ui', { external: ['runtime/client'] }),
      entry('runtime'),
    ]))).toEqual(['runtime', 'ui'])
  })

  it('leaves a request no row answers to the static assembly channel', () => {
    expect(ids(orderByModuleGraph([
      entry('consumer', { external: ['@clocky/cordis'] }),
      entry('other'),
    ]))).toEqual(['consumer', 'other'])
  })

  it('rejects a cycle and names the packages on it', () => {
    expect(() => orderByModuleGraph([
      entry('a', { external: ['b'] }),
      entry('b', { external: ['a'] }),
    ])).toThrow('client-modules: module graph cycle a -> b -> a')
  })

  it('rejects a row requesting its own package name', () => {
    expect(() => orderByModuleGraph([entry('solo', { external: ['solo'] })]))
      .toThrow('client-modules: "solo" requests module "solo" that it answers itself')
  })

  it('composes the served graph in module-graph order', () => {
    const consumerName = '@fixture/order-consumer'
    const dependencyName = '@fixture/order-dependency'
    writeBuiltPackage(consumerName, { external: [dependencyName] })
    writeBuiltPackage(dependencyName, {})
    expect(ids(construct([consumerName, dependencyName]).graph().entries))
      .toEqual([dependencyName, consumerName])
  })

  it('fails activation loud when scanned packages form a module cycle', () => {
    writeBuiltPackage('@fixture/cycle-a', { external: ['@fixture/cycle-b'] })
    writeBuiltPackage('@fixture/cycle-b', { external: ['@fixture/cycle-a'] })
    expect(() => construct(['@fixture/cycle-a', '@fixture/cycle-b']))
      .toThrow('module graph cycle @fixture/cycle-a -> @fixture/cycle-b -> @fixture/cycle-a')
  })
})

it('advertises only settled active entries across required-service loss, reload and owner disposal', async () => {
  const packageName = '@fixture/required-client'
  writeBuiltPackage(packageName, {})
  const packageRoot = join(root!, 'node_modules', '@fixture', 'required-client')
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: packageName, type: 'module',
    exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
    clocky: { client: { platform: 'web' } } }))
  writeFileSync(join(packageRoot, 'lib/index.js'), `
export const inject = ['moduleAvailabilitySource']
export async function apply(ctx) {
  const state = ctx.get('moduleAvailabilitySource')
  state.started++
  await state.ready
  ctx.effect(() => { state.active++; return () => { state.active--; state.disposed++ } })
}
`)
  const ctx = new Context()
  const gate = Promise.withResolvers<undefined>()
  const state = { ready: gate.promise, started: 0, active: 0, disposed: 0 }
  const provider = { apply(context: Context) { context.reflect.provide('moduleAvailabilitySource', state) } }
  const webServer: Pick<WebServer, 'port' | 'register' | 'tapIndex'> = { port: 0, register: () => () => {}, tapIndex: () => () => {} }
  ctx.provide('webServer', webServer as WebServer)
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  await ctx.plugin(Loader, { baseUrl: ctx.baseUrl })
  const registry = new ClientModuleRegistry(ctx)
  const observed: number[] = []
  const unsubscribe = registry.onGraphChanged(() => { observed.push(registry.graph().entries.length) })
  let first: ReturnType<Context['plugin']> | undefined, second: ReturnType<Context['plugin']> | undefined
  try {
    const id = await ctx.loader.create({ name: packageName })
    const entry = ctx.loader.resolve(id)
    await ctx.loader.await()
    expect(entry.fiber?.state).toBe(FiberState.PENDING)
    expect(registry.graph().entries).toEqual([])
    first = ctx.plugin(provider); await first
    await vi.waitFor(() => { expect(entry.fiber?.state).toBe(FiberState.LOADING) })
    expect(state.started).toBe(1)
    expect(registry.graph().entries).toEqual([])
    gate.resolve(undefined); await ctx.loader.await()
    expect(registry.graph().entries).toHaveLength(1)
    const row = registry.graph().entries[0]!
    expect(entry.fiber?.state).toBe(FiberState.ACTIVE)
    expect(state.active).toBe(1)
    await first.dispose(); await ctx.loader.await()
    expect(registry.graph().entries).toEqual([])
    expect(entry.fiber?.state).toBe(FiberState.PENDING)
    expect(state).toMatchObject({ active: 0, disposed: 1 })
    second = ctx.plugin(provider); await second; await ctx.loader.await()
    expect(registry.graph().entries).toEqual([row])
    expect(state).toMatchObject({ active: 1, started: 2, disposed: 1 })
    expect(observed).toEqual([1, 0, 1])
    unsubscribe()
    await ctx.fiber.dispose()
    expect(state).toMatchObject({ active: 0, disposed: 2 })
    expect(observed).toEqual([1, 0, 1])
  } finally { unsubscribe(); gate.resolve(undefined); await first?.dispose(); await second?.dispose(); await ctx.fiber.dispose() }
})

it('keeps one published package row while a sibling entry waits for a different required service', async () => {
  const packageName = '@fixture/sibling-client'
  writeBuiltPackage(packageName, {})
  const packageRoot = join(root!, 'node_modules', '@fixture', 'sibling-client')
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: packageName, type: 'module',
    exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
    clocky: { client: { platform: 'web' } } }))
  writeFileSync(join(packageRoot, 'lib/index.js'), `
export function apply(ctx, config) {
  const state = ctx.get(config.source)
  ctx.effect(() => { state.active++; return () => { state.active--; state.disposed++ } })
}
`)
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  const webServer: Pick<WebServer, 'port' | 'register' | 'tapIndex'> = { port: 0, register: () => () => {}, tapIndex: () => () => {} }
  ctx.provide('webServer', webServer as WebServer)
  await ctx.plugin(Loader, { baseUrl: ctx.baseUrl })
  const state = { active: 0, disposed: 0 }
  const first = ctx.plugin({ apply(context: Context) { context.reflect.provide('firstAvailabilitySource', state) } })
  await first
  const registry = new ClientModuleRegistry(ctx)
  const changes: number[] = []
  const unsubscribe = registry.onGraphChanged(() => { changes.push(registry.graph().entries.length) })
  try {
    const activeId = await ctx.loader.create({ name: packageName, inject: ['firstAvailabilitySource'], config: { source: 'firstAvailabilitySource' } })
    const waitingId = await ctx.loader.create({ name: packageName, inject: ['secondAvailabilitySource'], config: { source: 'secondAvailabilitySource' } })
    await ctx.loader.await()
    expect(ctx.loader.resolve(activeId).fiber?.state).toBe(FiberState.ACTIVE)
    expect(ctx.loader.resolve(waitingId).fiber?.state).toBe(FiberState.PENDING)
    const row = registry.graph().entries[0]!
    expect(registry.graph().entries).toEqual([row])
    expect(changes).toEqual([1])
    const second = ctx.plugin({ apply(context: Context) { context.reflect.provide('secondAvailabilitySource', state) } })
    await second; await ctx.loader.await()
    expect(state.active).toBe(2)
    expect(registry.graph().entries).toEqual([row])
    expect(changes).toEqual([1])
    await second.dispose(); await ctx.loader.await()
    expect(ctx.loader.resolve(waitingId).fiber?.state).toBe(FiberState.PENDING)
    expect(registry.graph().entries).toEqual([row])
    expect(state).toEqual({ active: 1, disposed: 1 })
    expect(changes).toEqual([1])
    await first.dispose(); await ctx.loader.await()
    expect(registry.graph().entries).toEqual([])
    expect(state).toEqual({ active: 0, disposed: 2 })
    expect(changes).toEqual([1, 0])
  } finally { unsubscribe(); await first.dispose(); await ctx.fiber.dispose() }
})
