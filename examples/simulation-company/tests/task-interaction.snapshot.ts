/** Actual task/interaction association preserves each independent fulfillment rule. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s linked task completion', (backend) => {
  it.each([
    { kind: 'explicit', cognition: 'deterministic' }, { kind: 'transfer', cognition: 'deterministic' },
    { kind: 'task-completed', cognition: 'deterministic' }, { kind: 'task-completed', cognition: 'model' },
  ])('keeps $kind fulfillment separate through $cognition task completion', async ({ kind, cognition }) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/simulation-task-interaction-'))
    const fixture = resolve('examples/simulation-company/tests/task-assignment-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/cordis.yml')], env: {
        SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, TASK_DETERMINISTIC: String(cognition === 'deterministic'), TASK_COMPLETION: 'true', TASK_INTERACTION: kind,
      } })
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: 'pipe' })
    const exited = once(child, 'exit')
    let output = '', error = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
    try {
      const [code] = await exited as unknown[]
      expect(code, error).toBe(0)
      expect(JSON.parse(output)).toMatchSnapshot()
    } finally { child.kill('SIGKILL'); await exited; await rm(root, { recursive: true, force: true }) }
  })
})
