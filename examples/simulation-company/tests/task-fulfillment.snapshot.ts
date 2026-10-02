/** Three fulfillment strategies remain distinct through the actual Loader, scoped executor and canonical task result. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'].flatMap(backend => ['explicit', 'transfer', 'task-completed'].map(fulfillment => ({ backend, fulfillment }))))
('keeps $backend $fulfillment fulfillment distinct from task completion in production execution', async ({ backend, fulfillment }) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/task-fulfillment-'))
  const fixture = resolve('examples/simulation-company/tests/task-executor-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/cordis.yml')], env: {
      SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend,
      TASK_EXECUTOR_COGNITION: 'deterministic', TASK_EXECUTOR_FULFILLMENT: fulfillment,
    } })
  const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: 'pipe' })
  const exit = once(child, 'exit')
  let output = '', error = ''
  child.stdout.on('data', (value: Buffer) => { output += value.toString() })
  child.stderr.on('data', (value: Buffer) => { error += value.toString() })
  try {
    const [code] = await exit as unknown[]; expect(code, error).toBe(0)
    const result = JSON.parse(output) as unknown
    expect(result).toMatchObject({ task: 'completed', fulfillment,
      fulfillmentBeforeConfirm: fulfillment === 'explicit' ? 'open' : 'fulfilled', completionDoesNotBypassCreditor: true })
    expect(result).toMatchSnapshot()
  } finally { child.kill('SIGKILL'); await exit; await rm(root, { recursive: true, force: true }) }
}, 45000)
