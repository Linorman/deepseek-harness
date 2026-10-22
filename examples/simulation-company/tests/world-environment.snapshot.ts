/** Environment and subjective learning snapshots preserve actual sampled and model-visible domain values. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
it.each(['json', 'sqlite'])('%s environment and experience snapshot', async (backend) => {
  const temp = resolve('.tmp/world-post-mvp/c3/snapshot'); await mkdir(temp, { recursive: true })
  const source = resolve('examples/simulation-company/tests/world-environment-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [], env: { SIMULATION_COMPANY_BACKEND: backend, SIMULATION_ENVIRONMENT_MODEL: 'supply-fixed/1', TMPDIR: temp } })
  const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit'); let stdout = '', stderr = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000)
  try {
    const [code] = await exited as [number | null, NodeJS.Signals | null]; expect(code, stderr).toBe(0)
    const result = JSON.parse(stdout) as Record<string, unknown>; delete result.backend
    expect(result).toMatchSnapshot()
  } finally { clearTimeout(timeout); child.kill('SIGKILL') }
}, 60000)
