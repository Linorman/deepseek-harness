/** Keyless authenticated creation retains its original allocation across Loader process exits. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s company product creation', (backend) => {
  it.each([undefined, 'accepted', 'directory', 'native', 'entity', 'checkpoint', 'terminal'])('reconciles crash=%s before inference', async (crash) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/company-product-creation-'))
    const fixture = resolve('examples/simulation-company/tests/product-administration-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/product-administration/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend } })
    const start = (recover: boolean, stage: string) => spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
      COMPANY_PRODUCT_RECOVER: String(recover), COMPANY_PRODUCT_CRASH: stage }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    try {
      if (crash !== undefined) {
        const child = start(false, crash)
        const exited = once(child, 'exit')
        let error = ''
        child.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
        try {
          const [message] = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(error) })]) as unknown[]
          expect(message).toBe('durable')
        } finally { child.kill('SIGKILL'); await exited }
      }
      const child = start(crash !== undefined, '')
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
