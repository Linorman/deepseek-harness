/** Durable maintenance survives process death at admission, retirement and completion boundaries. */
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s structural maintenance', (backend) => {
  it.each([undefined, 'draining', 'quiescent', 'completed'])('retains its original responsibility at crash=%s', async (crash) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/world-maintenance-'))
    const fixture = resolve('examples/simulation-company/tests/maintenance-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/headless-agent/tests/fixtures/simulation/simulation-team/cordis.yml')],
      env: { SIMULATION_TEST_ROOT: root, SIMULATION_TEST_BACKEND: backend, SIMULATION_TEST_TOOL_MODE: 'native' } })
    const children = new Set<ChildProcess>()
    const start = (recover: boolean, stage: string) => {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        MAINTENANCE_RECOVER: String(recover), MAINTENANCE_CRASH: stage }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      children.add(child)
      child.once('exit', () => { children.delete(child) })
      return child
    }
    try {
      if (crash !== undefined) {
        const child = start(false, crash), exited = once(child, 'exit')
        let error = ''
        child.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
        try {
          const ready = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(error) })])
          expect(ready[0]).toBe('durable')
        } finally { child.kill('SIGKILL'); await exited }
      }
      const child = start(crash !== undefined, ''), exited = once(child, 'exit')
      let output = '', error = ''
      child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, error).toBe(0)
        expect(JSON.parse(output)).toMatchSnapshot()
      } finally { child.kill('SIGKILL'); await exited }
    } finally {
      await Promise.all([...children].map(async (child) => {
        const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited
      }))
      await rm(root, { recursive: true, force: true })
    }
  })
})
