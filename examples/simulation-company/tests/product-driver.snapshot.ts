/** Real production driver, scoped model tools and cold recovery on both native media. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s company product driver', (backend) => {
  it.each(['normal', 'resident-one', 'automatic-residency', 'request-submitted', 'request-committed', 'transfer-applied'])('executes mode=%s', async (mode) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/company-product-driver-'))
    const fixture = resolve('examples/simulation-company/tests/product-driver-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/cordis.yml')], env: { SIMULATION_COMPANY_ROOT: root,
        SIMULATION_COMPANY_BACKEND: backend, COMPANY_DRIVER_RESIDENTS: ['resident-one', 'automatic-residency'].includes(mode) ? '1' : '2',
        COMPANY_DRIVER_AUTO_RESIDENCY: String(mode === 'automatic-residency') } })
    const start = (recover: boolean, crash: string) => spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
      COMPANY_DRIVER_RECOVER: String(recover), COMPANY_DRIVER_CRASH: crash }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    const crashing = !['normal', 'resident-one', 'automatic-residency'].includes(mode)
    try {
      if (crashing) {
        const child = start(false, mode), exited = once(child, 'exit')
        let error = ''
        child.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
        try {
          const [message] = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(error) })]) as unknown[]
          expect(message).toBe('durable')
        } finally { child.kill('SIGKILL'); await exited }
      }
      const child = start(crashing, ''), exited = once(child, 'exit')
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
