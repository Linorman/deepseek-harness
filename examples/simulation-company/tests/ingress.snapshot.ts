import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s external ingress', (backend) => {
  it.each([undefined, 'received', 'claimed', 'flushed', 'consumed', 'accepted'])('preserves ordered model delivery with crash=%s', async (crash) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/simulation-ingress-'))
    try {
      const fixture = resolve('examples/simulation-company/tests/ingress-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend } })
      if (crash !== undefined) {
        const interrupted = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          SIMULATION_INGRESS_CRASH: crash, SIMULATION_INGRESS_RECOVER: 'false' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const stopped = once(interrupted, 'exit')
        let error = ''
        interrupted.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
        try {
          const [ready] = await Promise.race([once(interrupted, 'message'), stopped.then(() => { throw new Error(error) })]) as unknown[]
          expect(ready).toBe('durable')
        } finally { interrupted.kill('SIGKILL'); await stopped }
      }
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        SIMULATION_INGRESS_CRASH: '', SIMULATION_INGRESS_RECOVER: String(crash !== undefined) }, stdio: 'pipe' })
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
