/** Source/built Loader runs validate complete collection, scoped input consumption and explicit cold suffix recovery. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'])('checkpoints and restores current scenario facts through the real Host carrier (%s)', async (backend) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/product-maintenance-'))
  const fixture = resolve('examples/simulation-company/tests/product-maintenance-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/product-control/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend } })
  try {
    for (const cold of [false, true]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, COMPANY_MAINTENANCE_COLD: String(cold) },
        stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit')
      let output = '', error = ''
      child.stdout.on('data', (value: Buffer) => { output += value.toString() })
      child.stderr.on('data', (value: Buffer) => { error += value.toString() })
      try { const [code] = await exited as unknown[]; expect(code, error).toBe(0); expect(JSON.parse(output)).toMatchSnapshot() }
      finally { child.kill('SIGKILL'); await exited }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
