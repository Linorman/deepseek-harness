/** Actual process termination covers all report-task cross-owner commit intervals on both supported stores. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const stages = ['', 'created', 'reserved', 'assigned', 'input', 'submitted', 'window', 'effect', 'result', 'settled', 'observed']
it.each(['json', 'sqlite'].flatMap(backend => stages.map(stage => ({ backend, stage }))))
('recovers $backend three-actor report tasks through $stage actual process exit', async ({ backend, stage }) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/task-workflow-fault-'))
  const fixture = resolve('examples/simulation-company/tests/task-workflow-fault-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/product-task/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend } })
  const start = (cold: boolean, fault: string) => spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
    WORKFLOW_FAULT_COLD: String(cold), WORKFLOW_FAULT_STAGE: fault }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  try {
    if (stage !== '') {
      const first = start(false, stage), exit = once(first, 'exit')
      let error = ''
      first.stderr?.on('data', (value: Buffer) => { error += value.toString() })
      try {
        const [message] = await Promise.race([once(first, 'message', { signal: AbortSignal.timeout(30000) }),
          exit.then(() => { throw new Error(error) })]) as unknown[]
        expect(message).toBe('durable')
      } finally { first.kill('SIGKILL'); await exit }
    }
    const child = start(stage !== '', ''), exit = once(child, 'exit')
    let output = '', error = ''
    child.stdout?.on('data', (value: Buffer) => { output += value.toString() })
    child.stderr?.on('data', (value: Buffer) => { error += value.toString() })
    try {
      const [code] = await exit as unknown[]; expect(code, error).toBe(0)
      const result = JSON.parse(output) as unknown
      expect(result).toMatchObject({ recovered: stage !== '', completedTasks: 2, reports: 2,
        originalTaskPreserved: true, originalReportsPreserved: true, inventory: ['2', '0'],
        actorCount: 3, channelCount: 2, modelRequests: 0, phase: 'paused' })
      expect(result).toMatchSnapshot()
    } finally { child.kill('SIGKILL'); await exit }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 60000)
