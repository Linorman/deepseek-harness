/** Process loss preserves source attempt identity and cold retirement without inference. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s production Simulation task assignment', (backend) => {
  it.each([undefined, 'reserved', 'assigned', 'observed'])('retains exact responsibility with crash=%s', async (stage) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/simulation-task-assignment-'))
    const fixture = resolve('examples/simulation-company/tests/task-assignment-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, TASK_ASSIGNMENT_STAGE: stage ?? '' } })
    const start = (recover: boolean, crash: string) => spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
      TASK_ASSIGNMENT_RECOVER: String(recover), TASK_ASSIGNMENT_CRASH: crash }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    try {
      if (stage !== undefined) {
        const child = start(false, stage)
        const exited = once(child, 'exit')
        let error = ''
        child.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
        try {
          const [ready] = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(error) })]) as unknown[]
          expect(ready).toBe('durable')
        } finally { child.kill('SIGKILL'); await exited }
      }
      const child = start(stage !== undefined, '')
      const exited = once(child, 'exit')
      let output = '', error = ''
      child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, error).toBe(0)
        expect(JSON.parse(output)).toMatchSnapshot()
      } finally { child.kill('SIGKILL'); await exited }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
