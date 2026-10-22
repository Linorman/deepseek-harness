/** Real Loader and two-process helper recovery, without provider credentials. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'] as const)('retains isolated original helper output across a new %s process', async (backend) => {
  const temp = resolve('.local/post-mvp-c/snapshot'); await mkdir(temp, { recursive: true })
  const root = await mkdtemp(resolve(temp, `${backend}-`))
  const path = resolve('examples/simulation-company/tests/world-generation-scenario.ts')
  try {
    for (const restored of [false, true]) {
      const launch = resolveExampleLaunch({ srcBin: path, libBin: path, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_DRIVER_RECOVER: String(restored), TMPDIR: temp } })
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit'); let output = '', errors = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, errors).toBe(0)
        expect(JSON.parse(output)).toMatchObject({ restored, modelCalls: restored ? 0 : 1, output: 'PUBLIC_OUTPUT', inputEvents: 1, outputEvents: 1, tokens: 23 })
      } finally { child.kill('SIGKILL'); await exited }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 60000)
