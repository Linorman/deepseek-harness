import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s conflict retry', (backend) => {
  it.each(['refresh', 'bounded', 'queued', 'claimed', 'exhausted', 'blocked'])('replans through real model tools: %s', async (mode) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/conflict-retry-'))
    try {
      const fixture = resolve('examples/simulation-company/tests/retry-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/cordis.yml')], env: { SIMULATION_COMPANY_ROOT: root,
          SIMULATION_COMPANY_BACKEND: backend, SIMULATION_RETRY_STALE: String(mode !== 'refresh' && mode !== 'blocked'),
          SIMULATION_RETRY_BLOCKED: String(mode === 'blocked') } })
      const recovery = ['queued', 'claimed', 'exhausted'].includes(mode)
      if (recovery) {
        const interrupted = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          SIMULATION_RETRY_CRASH: mode, SIMULATION_RETRY_RECOVER: 'false' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const stopped = once(interrupted, 'exit')
        let error = ''
        interrupted.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
        try {
          const [ready] = await Promise.race([once(interrupted, 'message'), stopped.then(() => { throw new Error(error) })]) as unknown[]
          expect(ready).toBe('durable')
        } finally { interrupted.kill('SIGKILL'); await stopped }
      }
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        SIMULATION_RETRY_CRASH: '', SIMULATION_RETRY_RECOVER: String(recovery) }, stdio: 'pipe' })
      const exited = once(child, 'exit')
      let output = ''
      let error = ''
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
