import { globSync } from 'node:fs'
import { dirname } from 'node:path'
import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.CLOCKY_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env, cwd = process.cwd() }) => {
  const client = isBuildFaceClient(env?.CLOCKY_BUILD_FACE)
  return {
    // Manifest discovery excludes the private root and package directories
    // left behind by deleted workspaces.
    workspace: globSync(['vendor/*/package.json', 'packages/*/*/package.json', 'apps/cli/package.json'], { cwd })
      .map(manifest => dirname(manifest).replaceAll('\\', '/')).sort(),
    // Packages without a local config inherit Host entries; the Client pass
    // requires explicit entries.
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
