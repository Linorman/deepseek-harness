/** Original representation snapshots preserve actual generation changes and history. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
it.each(['json', 'sqlite'])('%s representation switch snapshot', async (backend) => {
  const temp = resolve('.tmp/world-post-mvp-bc/representation-snapshot'); await mkdir(temp, { recursive: true })
  const source = resolve('examples/simulation-company/tests/world-representation-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [], env: { SIMULATION_COMPANY_BACKEND: backend, TMPDIR: temp } })
  const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit'); let stdout = '', stderr = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000)
  try {
    const [code] = await exited as unknown[]; expect(code, stderr).toBe(0)
    const result = JSON.parse(stdout) as Record<string, unknown>; delete result.backend
    expect(result).toMatchSnapshot()
  } finally { clearTimeout(timeout); child.kill('SIGKILL') }
}, 60000)
