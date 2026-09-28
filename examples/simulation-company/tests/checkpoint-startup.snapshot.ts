import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s checkpoint startup', (backend) => {
  it.each(['reserved', 'released'])('settles interrupted startup with crash=%s', async (crash) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/simulation-restore-'))
    const fixture = resolve('examples/simulation-company/tests/checkpoint-startup-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, STARTUP_RECOVER: 'false' } })
    const interrupt = async (mode: string, stage: string) => {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        STARTUP_RECOVER: String(mode === 'recover'), STARTUP_CRASH: stage }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exited = once(child, 'exit')
      let error = ''
      child.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
      try {
        const [ready] = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(error) })]) as unknown[]
        expect(ready).toBe('durable')
      } finally { child.kill('SIGKILL'); await exited }
    }
    try {
      await interrupt('create', 'reserved')
      if (crash === 'released') await interrupt('recover', 'released')
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        STARTUP_RECOVER: 'true', STARTUP_CRASH: '' }, stdio: 'pipe' })
      const exited = once(child, 'exit')
      let output = '', error = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, error).toBe(0)
        expect(JSON.parse(output)).toMatchSnapshot()
      } finally { child.kill('SIGKILL'); await exited }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
