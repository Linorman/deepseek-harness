/** Keyless real Loader and Host controls own scheduling; cold discovery keeps the completed original history read-only. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'])('drives, pauses and queries original product scheduling requests (%s)', async (backend) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/company-control-'))
  const fixture = resolve('examples/simulation-company/tests/product-control-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/product-control/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend } })
  try {
    for (const restart of [false, true]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        COMPANY_CONTROL_RESTART: String(restart) }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit')
      let output = '', error = ''
      child.stdout.on('data', (value: Buffer) => { output += value.toString() })
      child.stderr.on('data', (value: Buffer) => { error += value.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, error).toBe(0)
        expect(JSON.parse(output)).toMatchSnapshot()
      } finally { child.kill('SIGKILL'); await exited }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
