/** Verify that private legacy compatibility remains outside shipped product surfaces. */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { releaseFamily } from './release/families.ts'

/** Package groups retained only for explicit in-repository compatibility compositions. */
export const PRIVATE_COMPATIBILITY_GLOBS = [
  'packages/compat/*/package.json',
  'packages/subagent/*/package.json',
  'packages/workflow/*/package.json',
  'packages/goal/*/package.json',
  'packages/client/ui-goal/package.json',
] as const

/** Default configurations whose model-visible composition is shipped or carrier-backed. */
const DEFAULT_CONFIG_GLOBS = ['apps/cli/config/agent-presets/*/agent.cordis.yml'] as const
const DEFAULT_CONFIG_FILES = [
  'packages/bundle/base/cordis.patch.yml',
  'packages/bundle/headless/cordis.patch.yml',
  'packages/bundle/web-app/cordis.patch.yml',
  'python/sdk-runtime/src/clocky_runtime/runtime/cordis.yml',
] as const

/** Explicit compatibility compositions that keep the private packages consumed. */
const COMPATIBILITY_CONFIG_FILES = [
  'examples/headless-agent/cordis.yml',
  'examples/acp-agent/legacy-subagent.cordis.yml',
  'examples/jsonrpc-agent/tests/fixtures/compat/subagent-clocky-sdk/cordis.yml',
] as const

/** A parsed package manifest field used by this release gate. */
interface PackageManifest {
  readonly name?: unknown
  readonly private?: unknown
  readonly publishConfig?: unknown
  readonly dependencies?: Record<string, unknown>
  readonly optionalDependencies?: Record<string, unknown>
  readonly peerDependencies?: Record<string, unknown>
}

/** Results from one source/config/catalog/carrier cutover check. */
export interface LegacyCutoverResult {
  /** Private compatibility package names discovered in the repository. */
  readonly compatibilityPackages: readonly string[]
  /** Public release members discovered after private filtering. */
  readonly releaseMembers: readonly string[]
  /** Human-readable failures; empty means the current cutover is coherent. */
  readonly failures: readonly string[]
}

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function packageName(manifest: PackageManifest, path: string): string | undefined {
  return typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : basename(path, '.json')
}

function packagePaths(root: string): string[] {
  return PRIVATE_COMPATIBILITY_GLOBS.flatMap(pattern => globSync(pattern, { cwd: root })).sort()
}

function defaultConfigPaths(root: string): string[] {
  return [
    ...DEFAULT_CONFIG_FILES,
    ...DEFAULT_CONFIG_GLOBS.flatMap(pattern => globSync(pattern, { cwd: root })),
  ]
}

function packageReferences(manifest: PackageManifest): readonly string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]
}

function scanText(root: string, paths: readonly string[], names: readonly string[], failures: string[], label: string): void {
  for (const relative of paths) {
    const path = resolve(root, relative)
    if (!existsSync(path)) {
      failures.push(`${label}: missing ${relative}`)
      continue
    }
    const text = readFileSync(path, 'utf8')
    const hits = names.filter(name => text.includes(name))
    if (hits.length > 0) failures.push(`${label}: ${relative} references ${hits.join(', ')}`)
  }
}

/**
 * Check source/config/tool/catalog/runtime-carrier and packed release reachability.
 * @param root - repository root.
 * @returns discovered compatibility packages, public release members, and failures.
 */
export function verifyLegacyCutover(root = resolve(import.meta.dirname, '..')): LegacyCutoverResult {
  const failures: string[] = []
  const paths = packagePaths(root)
  const manifests = paths.map(path => ({ path, manifest: readJson(resolve(root, path)) }))
  const compatibilityPackages = manifests
    .map(({ path, manifest }) => packageName(manifest, path))
    .filter((name): name is string => name !== undefined)
    .sort()
  const forbiddenProductPackages = [...new Set([
    ...compatibilityPackages,
    ...compatibilityPackages.map(name => name.replace('@clocky/clocky-compat-', '@clocky/clocky-')),
    '@clocky/clocky-client-ui-goal',
  ])]

  if (compatibilityPackages.length === 0) failures.push('compatibility inventory is empty')
  for (const { path, manifest } of manifests) {
    if (!path.startsWith('packages/compat/')) failures.push(`${path}: compatibility package must live under packages/compat`)
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@clocky/clocky-compat-')) {
      failures.push(`${path}: compatibility package must use @clocky/clocky-compat-* naming`)
    }
    if (manifest.private !== true) failures.push(`${path}: compatibility package must be private`)
    if (manifest.publishConfig !== undefined) failures.push(`${path}: compatibility package must omit publishConfig`)
  }

  const members = releaseFamily('clocky').members(root)
  const releaseMembers = members.map(member => member.name).sort()
  const releaseSet = new Set(releaseMembers)
  for (const name of forbiddenProductPackages) {
    if (releaseSet.has(name)) failures.push(`${name}: private compatibility package is still in the Clocky release family`)
  }
  for (const member of members) {
    const manifest = member.manifest as PackageManifest
    const references = [...packageReferences(manifest), ...Object.keys(manifest.peerDependencies ?? {})]
    const hits = forbiddenProductPackages.filter(name => references.includes(name))
    if (hits.length > 0) failures.push(`${member.name}: public package depends on private compatibility: ${hits.join(', ')}`)
  }

  const runtimeManifest = readJson(resolve(root, 'python/sdk-runtime/package.json'))
  const runtimeNames = packageReferences(runtimeManifest)
  const runtimeHits = forbiddenProductPackages.filter(name => runtimeNames.includes(name))
  if (runtimeHits.length > 0) failures.push(`python/sdk-runtime/package.json: carrier depends on ${runtimeHits.join(', ')}`)

  const defaultToolNames = forbiddenProductPackages.filter(name => /\/clocky-(?:compat-)?tool-/.test(name))
  scanText(root, defaultConfigPaths(root), forbiddenProductPackages, failures, 'default composition')
  scanText(root, ['docs/tool-catalog.md'], defaultToolNames, failures, 'product tool catalog')
  for (const relative of COMPATIBILITY_CONFIG_FILES) {
    const path = resolve(root, relative)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    if (!compatibilityPackages.some(name => text.includes(name))) failures.push(`compatibility composition: ${relative} has no legacy consumer`)
  }

  const retiredGoalOutputs = globSync('packages/host/apiproxy/lib/types/api/goals{,.schema}.{js,js.map,d.ts,d.ts.map}', { cwd: root })
  if (retiredGoalOutputs.length > 0) failures.push(`built Host contains retired Goal API files: ${retiredGoalOutputs.sort().join(', ')}`)

  const tarballDir = resolve(root, 'dist/npm')
  if (existsSync(tarballDir)) {
    const tarballNames = globSync('*.tgz', { cwd: tarballDir }).sort()
    const leaked = tarballNames.filter(file => forbiddenProductPackages.some(name => file.includes(name.replace('@', '').replace('/', '-'))))
    if (leaked.length > 0) failures.push(`packed release contains private compatibility tarballs: ${leaked.join(', ')}`)
  }

  return { compatibilityPackages, releaseMembers, failures }
}

if (import.meta.main) {
  const result = verifyLegacyCutover()
  if (result.failures.length > 0) {
    console.error('verify-legacy-cutover: legacy product/release cutover failed:')
    for (const failure of result.failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log(`verify-legacy-cutover: ${result.compatibilityPackages.length} private compatibility packages excluded from ${result.releaseMembers.length} public Clocky members.`)
  }
}
