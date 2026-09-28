/** A failed expiry write and failed logger still stop inference without a fabricated timeout. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'])('stops %s inference after expiry storage and logging failures', async (backend) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/simulation-deadline-failure-'))
  const fixture = resolve('examples/simulation-company/tests/window-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend,
      SIMULATION_MODEL_LIMIT: '2', SIMULATION_MODEL_QUEUE_LIMIT: '16', SIMULATION_WINDOW_TIMEOUT: 'true',
      SIMULATION_WINDOW_REVERSE: 'true', SIMULATION_EXPIRY_FAILURE: 'true' } })
  const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: 'pipe' })
  const exited = once(child, 'exit')
  const deadline = setTimeout(() => { child.kill('SIGKILL') }, 15000)
  let output = '', error = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
  try {
    const [code, signal] = await exited as unknown[]
    expect(signal).toBeNull()
    expect(code, error).toBe(0)
    expect(JSON.parse(output)).toMatchSnapshot()
  } finally { clearTimeout(deadline); child.kill('SIGKILL'); await exited; await rm(root, { recursive: true, force: true }) }
})
