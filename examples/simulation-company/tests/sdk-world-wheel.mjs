/** Distribution gate: run `pnpm run build` first; uv builds and installs this checkout, then both SDK launch modes run serially. */
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { execa } from 'execa'

const base = resolve('.local/world-completion/u13-sdk'), temp = resolve('.local/world-completion/tmp')
await mkdir(base, { recursive: true }); await mkdir(temp, { recursive: true })
const root = await mkdtemp(resolve(base, 'distribution-'))
for (const path of ['packages/sdk/client/lib/index.js', 'packages/examples/jsonrpc-demo/lib/bin.js',
  'packages/simulation/simulation-product/lib/index.js']) {
  try { await access(path) }
  catch (cause) { throw new Error('SDK distribution verification requires `pnpm run build` before this script', { cause }) }
}
const env = { ...process.env, TMPDIR: temp, UV_CACHE_DIR: resolve(root, 'uv-cache'),
  PYTHONDONTWRITEBYTECODE: '1', PYTHONPYCACHEPREFIX: resolve(root, 'pycache'), CLOCKY_SNAPSHOT_MAX_CONCURRENCY: '1' }
const commands = []
const run = async (name, command, args, extra = {}) => {
  const result = await execa(command, args, { env: { ...env, ...extra }, reject: false })
  await writeFile(resolve(root, `${name}.stdout.log`), result.stdout + '\n')
  await writeFile(resolve(root, `${name}.stderr.log`), result.stderr + '\n')
  commands.push({ name, command, args, exitCode: result.exitCode })
  await writeFile(resolve(root, 'commands.json'), JSON.stringify(commands, null, 2) + '\n')
  if (result.exitCode !== 0) throw new Error(`${name} failed; preserved logs: ${root}`)
}
await run('build-wheel', 'uv', ['build', 'python/sdk', '--wheel', '--out-dir', resolve(root, 'dist')])
const wheel = resolve(root, 'dist/clocky_sdk-0.0.0.dev0-py3-none-any.whl'), installed = resolve(root, 'installed')
await run('install-wheel', 'uv', ['pip', 'install', '--python', resolve('python/sdk/.venv/bin/python'),
  '--target', installed, '--no-deps', wheel])
const snapshotArgs = ['exec', 'vitest', 'run', '--config', 'vitest.snapshot.config.ts',
  'examples/simulation-company/tests/sdk-world.snapshot.ts', 'examples/simulation-company/tests/sdk-world-python.snapshot.ts',
  'examples/simulation-company/tests/sdk-world-management.snapshot.ts', '--maxWorkers=1']
await run('source', 'pnpm', snapshotArgs, { CLOCKY_EXAMPLE_MODE: 'src', SDK_WORLD_INSTALLED: undefined })
await run('lib-wheel', 'pnpm', snapshotArgs, { CLOCKY_EXAMPLE_MODE: 'lib', SDK_WORLD_INSTALLED: installed })
await writeFile(resolve(root, 'proof.json'), JSON.stringify({ wheel, sha256: createHash('sha256').update(await readFile(wheel)).digest('hex'),
  installed, driverPid: process.pid, prerequisites: 'Current pnpm run build; existing Python SDK test environment supplies dependencies; actual runtime is explicitly selected Node stdio, not a bundled runtime binary.',
  commands }, null, 2) + '\n')
console.log(root)
