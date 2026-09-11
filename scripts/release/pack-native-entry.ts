/** Pack the native Landlock entry needed by the Clocky sandbox consumer probe. */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { removeOwnedTree, run } from './process.ts'

const root = resolve(import.meta.dirname, '../..')
const packageDirectory = resolve(root, 'native/landlock-run/packages/entry')

/** Pack the workspace-owned native entry into an explicit output directory. */
function main(): void {
  const { values } = parseArgs({
    options: { out: { type: 'string', default: '.tmp/p0-gate/npm-native' } },
    allowPositionals: false,
  })
  const destination = localOutput(values.out)
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as {
    readonly name?: unknown
    readonly version?: unknown
  }
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error('native Landlock entry manifest has no name/version')
  }
  const filename = `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`
  removeOwnedTree(destination)
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  run('pnpm', ['--dir', packageDirectory, 'pack', '--pack-destination', destination], { cwd: root })
  const tarball = join(destination, filename)
  if (!existsSync(tarball)) throw new Error(`native Landlock entry produced no tarball at ${tarball}`)
  console.log(`release pack: native Landlock entry in ${values.out}`)
}

if (import.meta.main) main()

/** Keep the destructive pack destination inside this repository. */
function localOutput(pathValue: string): string {
  const destination = resolve(root, pathValue)
  const fromRoot = relative(root, destination)
  if (fromRoot === '' || isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`native Landlock pack output must be a repository-relative directory, got ${JSON.stringify(pathValue)}`)
  }
  return destination
}
