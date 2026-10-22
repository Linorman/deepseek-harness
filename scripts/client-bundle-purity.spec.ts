/**
 * Pins shared client-bundle preset rules: the module-edge purity gate and
 * the physical watch dependencies hidden behind virtual CSS Modules.
 */
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { browserFieldTarget, clientBundle, requestedExternals } from '../packages/client/tsdown.client.ts'

type ResolveId = (source: string) => null | { id: string; external: boolean }

interface CssModulePlugin {
  name: string
  resolveId?: (source: string, importer: string | undefined) => null | string
  load?: (this: { addWatchFile: (id: string) => void }, id: string) => Promise<unknown>
}

/** A representative dynamic bundle using the shared client baseline. */
const REQUESTING_PACKAGE = '@clocky/clocky-client-ui-conversation'

function clientConfigs(id = REQUESTING_PACKAGE) {
  return clientBundle(id, ['lib/types/index.js', 'lib/types/invariant.js'])(
    { env: { CLOCKY_BUILD_FACE: 'client' } },
  ).filter(config => config.platform === 'browser')
}

describe('client bundle build faces', () => {
  it('watches source in development and consumes emitted JavaScript in the Client build', () => {
    const bundle = clientBundle('@clocky/clocky-client-test', ['lib/types/index.js'])
    const development = bundle({ env: {} }).find(config => config.platform === 'browser')
    const artifact = bundle({ env: { CLOCKY_BUILD_FACE: 'client' } })
      .find(config => config.platform === 'browser')

    expect(development?.entry).toEqual({ client: 'src/client/index.ts' })
    expect(artifact?.entry).toEqual({ client: 'lib/types/client/index.js' })
  })
})

function clientSourceMapPath(packagePath: string): string {
  return fileURLToPath(new URL(`../packages/${packagePath}/lib/client.js.map`, import.meta.url))
}

function purityResolveId(id = REQUESTING_PACKAGE): ResolveId {
  // libEntry is spelled at every call site (no default) so the
  // package-invariants text check can see the invariant entry per package.
  const configs = clientConfigs(id)
  const plugins = (configs[0] as { plugins: { name: string; resolveId?: unknown }[] }).plugins
  const gate = plugins.find(p => p.name === 'clocky-client-bundle-purity')
  if (gate?.resolveId === undefined) throw new Error('purity plugin missing from client config')
  return gate.resolveId as ResolveId
}

function cssModulePlugin(): CssModulePlugin {
  const configs = clientConfigs()
  const plugins = (configs[0] as { plugins: CssModulePlugin[] }).plugins
  const plugin = plugins.find(candidate => candidate.name === 'clocky-css-modules-inline')
  if (plugin?.resolveId === undefined || plugin.load === undefined) {
    throw new Error('CSS Modules plugin missing from client config')
  }
  return plugin
}

describe('client bundle purity gate', () => {
  const resolveId = purityResolveId()

  it('leaves default externals and non-scoped specifiers alone', () => {
    expect(resolveId('@clocky/clocky-client-ui-slots')).toBeNull()
    expect(resolveId('@clocky/clocky-client-ui-primitives')).toBeNull()
    expect(resolveId('@clocky/clocky-client-runtime/client')).toBeNull()
    expect(resolveId('react')).toBeNull()
    expect(resolveId('zod')).toBeNull()
  })

  it('rejects the retired web-react platform package', () => {
    expect(() => resolveId('@clocky/clocky-client-web-react')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-client-web-react/store')).toThrow(/purity/)
  })

  it('lets inline-safe wire layers inline', () => {
    expect(resolveId('@clocky/clocky-host-apiproxy/api')).toBeNull()
    expect(resolveId('@clocky/clocky-session/surface')).toBeNull()
    expect(resolveId('@clocky/clocky-brand')).toBeNull()
    expect(resolveId('@clocky/clocky-team/schema')).toBeNull()
    expect(resolveId('@clocky/clocky-simulation-product/schema')).toBeNull()
    expect(resolveId('@clocky/clocky-simulation-product/world-schema')).toBeNull()
    expect(resolveId('@clocky/clocky-simulation-product/world-read-schema')).toBeNull()
    expect(resolveId('@clocky/clocky-simulation-product/world-management-schema')).toBeNull()
    expect(resolveId('@clocky/clocky-simulation/world-management')).toBeNull()
    expect(() => resolveId('@clocky/clocky-simulation-product/world-management-schema/private')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-simulation/world-management/private')).toThrow(/purity/)
    expect(resolveId('@clocky/clocky-simulation/personnel-obligations')).toBeNull()
    expect(() => resolveId('@clocky/clocky-simulation/personnel-obligations/private')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-simulation-product/world-read-schema/private')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-simulation-product/world-schema/private')).toThrow(/purity/)
    expect(resolveId('@clocky/clocky-simulation-scenario')).toBeNull()
    expect(resolveId('@clocky/clocky-simulation/world')).toBeNull()
    for (const leaf of [
      'tokens', 'world-domain', 'world-domain-types', 'world-domains', 'world-domain-registry', 'world-authoring', 'world-generation',
      'run-control-observation',
    ]) {
      expect(resolveId(`@clocky/clocky-simulation/${leaf}`)).toBeNull()
      expect(() => resolveId(`@clocky/clocky-simulation/${leaf}/private`)).toThrow(/purity/)
    }
    expect(() => resolveId('@clocky/clocky-simulation-scenario/invariant')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-simulation/world/private')).toThrow(/purity/)
    expect(resolveId('@clocky/clocky-simulation/checkpoint-diagnostics-schema')).toBeNull()
    expect(() => resolveId('@clocky/clocky-simulation/checkpoint-diagnostics')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-simulation')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-simulation-product')).toThrow(/purity/)
    expect(resolveId('@clocky/clocky-team/selection')).toBeNull()
    expect(() => resolveId('@clocky/clocky-team')).toThrow(/purity/)
  })

  it('lets exact generated Remote contributions inline without admitting their package implementation', () => {
    expect(resolveId('@clocky/clocky-compat-goal/remote')).toBeNull()
    expect(() => resolveId('@clocky/clocky-compat-goal')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-compat-goal/client')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-compat-goal/remote/nested')).toThrow(/purity/)
  })

  it('throws on any other @clocky leak', () => {
    expect(() => resolveId('@clocky/clocky-agent')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-client-web')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-team')).toThrow(/purity/)
  })

  it('throws on cross-plugin value imports — bare plugin names and /client subpaths alike', () => {
    expect(() => resolveId('@clocky/clocky-client-connection')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-client-runtime')).toThrow(/purity/)
    expect(() => resolveId('@clocky/clocky-client-ui-layout/client')).toThrow(/purity/)
  })

  it('admits the parser-preloaded runtime for every dynamic bundle', () => {
    expect(resolveId('@clocky/clocky-client-runtime/client')).toBeNull()
    const withoutRequest = purityResolveId('@clocky/clocky-client-ui-team')
    expect(withoutRequest('@clocky/clocky-client-runtime/client')).toBeNull()
  })

  it('externalizes the baseline independently of each package manifest', () => {
    const requesting = clientConfigs()[0]?.deps as { neverBundle: (specifier: string) => boolean }
    const plain = clientConfigs('@clocky/clocky-client-connection')[0]?.deps as {
      neverBundle: (specifier: string) => boolean
    }

    expect(requesting.neverBundle('react')).toBe(true)
    expect(requesting.neverBundle('zod')).toBe(false)
    expect(plain.neverBundle('react')).toBe(true)
    expect(plain.neverBundle('@clocky/clocky-client-runtime/client')).toBe(true)
  })
})

describe('client bundle module requests', () => {
  it('requests what the declaration lists', () => {
    const requests = requestedExternals('@clocky/clocky-client-fixture', {
      external: ['react', 'react/jsx-runtime', '@clocky/clocky-client-ui-slots'],
    })

    expect([...requests].sort()).toEqual([
      '@clocky/clocky-client-ui-slots', 'react', 'react/jsx-runtime',
    ])
  })

  it('requests nothing when the declaration is absent', () => {
    expect(requestedExternals('@clocky/clocky-client-fixture', {}).size).toBe(0)
  })

  it('rejects a malformed declaration instead of reading past it', () => {
    expect(() => requestedExternals('@clocky/clocky-client-fixture', { external: 'react' }))
      .toThrow(/clocky\.client\.external must be a string array/)
  })
})

describe('client bundle debug artifacts', () => {
  it('emits source maps for plugin TS and TSX outside the Vite module graph', () => {
    const configs = clientConfigs()
    expect(configs[0]?.sourcemap).toBe(true)
  })

  it('maps first-party sources to their repository package paths', () => {
    const configs = clientConfigs('@clocky/clocky-client-ui-team')
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    const source = transform('../src/client/TeamActivity.tsx', clientSourceMapPath('client/ui-team'))
    expect(source).toBe('../../../packages/client/ui-team/src/client/TeamActivity.tsx')
    const resolved = new URL(source, 'https://clocky.test/plugins/@clocky/clocky-client-ui-team/client.js.map')
    expect(resolved.pathname).toBe('/packages/client/ui-team/src/client/TeamActivity.tsx')
  })

  it('maps dual-face host sources to the host package group', () => {
    const configs = clientConfigs('@clocky/clocky-host-directory-picker-native')
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    const source = transform('../src/client/index.ts', clientSourceMapPath('host/directory-picker-native'))
    expect(source).toBe('../../../packages/host/directory-picker-native/src/client/index.ts')
  })

  it('maps inlined workspace sources to packages and leaves dependencies outside it unchanged', () => {
    const configs = clientConfigs('@clocky/clocky-client-connection')
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    const sourceMapPath = clientSourceMapPath('client/connection')
    const workspaceSource = transform('../../../host/apiproxy/src/api/rpc.ts', sourceMapPath)
    expect(workspaceSource).toBe('../../../packages/host/apiproxy/src/api/rpc.ts')
    const resolved = new URL(workspaceSource, 'https://clocky.test/plugins/@clocky/clocky-client-connection/client.js.map')
    expect(resolved.pathname).toBe('/packages/host/apiproxy/src/api/rpc.ts')

    const dependencySource = '../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js'
    expect(transform(dependencySource, sourceMapPath)).toBe(dependencySource)
  })
})

describe('client bundle CSS Modules watch graph', () => {
  it('registers the physical stylesheet read behind a virtual module', async () => {
    const plugin = cssModulePlugin()
    const importer = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/queue/QueueDock.tsx',
      import.meta.url,
    ))
    const stylesheet = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/queue/QueueDock.module.css',
      import.meta.url,
    ))
    const virtualId = plugin.resolveId?.('./QueueDock.module.css', importer)
    if (virtualId === null || virtualId === undefined) throw new Error('CSS Modules import was not resolved')
    const addWatchFile = vi.fn()

    await plugin.load?.call({ addWatchFile }, virtualId)

    expect(addWatchFile).toHaveBeenCalledExactlyOnceWith(stylesheet)
  })
})

describe('browser builds of inlined dependencies', () => {
  const yaml = `${dirname(createRequire(new URL('../packages/simulation/simulation-scenario/package.json', import.meta.url))
    .resolve('yaml/package.json'))}/`
  it('maps a Node build file to the browser build its package declares', () => {
    // yaml's Node build imports `process`, which the browser module table cannot answer.
    expect(browserFieldTarget(`${yaml}dist/index.js`)).toBe(`${yaml}browser/index.js`)
    expect(browserFieldTarget(`${yaml}dist/util.js`)).toBe(`${yaml}browser/dist/util.js`)
  })
  it('leaves files without a declared browser replacement unchanged', () => {
    expect(browserFieldTarget(`${yaml}dist/log.js`)).toBeUndefined()
    expect(browserFieldTarget(fileURLToPath(import.meta.url))).toBeUndefined()
  })
})
