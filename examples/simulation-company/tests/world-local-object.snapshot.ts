/** Keyless real-Loader local mutation snapshot; scoped Native execution preserves another original context. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'])('%s executes local name mutation through the real Loader', async (backend) => {
  const temp = resolve('.tmp/world-post-mvp/b3c-loader'); await mkdir(temp, { recursive: true })
  const root = await mkdtemp(resolve(temp, `${backend}-`)), source = resolve('examples/simulation-company/tests/world-local-object-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, TMPDIR: temp } })
  const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit'); let stdout = '', stderr = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000)
  try {
    const [code, signal] = await exited as unknown[]
    await writeFile(resolve(root, 'process.json'), JSON.stringify({ command: launch.command, args: launch.args, code, signal, stdout, stderr }) + '\n')
    expect(code, stderr).toBe(0)
    const value: unknown = JSON.parse(stdout)
    expect(value).toMatchObject({ backend, modelCalls: 0, name: 'Renamed object-a', windowPreserved: true, contextPreserved: true,
      maintenanceCount: 0, result: { execution: { kind: 'local', owner: 'native' } } })
  } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
}, 45000)
