/** Real process exits at product/native maintenance commits retain one original collection and every current business fact. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'].flatMap(backend => ['accepted', 'native-begin', 'native-complete', 'terminal'].map(stage => [backend, stage])))
('reconciles original native maintenance after %s %s process exit', async (backend, stage) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/product-maintenance-crash-'))
  const fixture = resolve('examples/simulation-company/tests/product-maintenance-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/product-control/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend } })
  const start = (cold: boolean, crash: string) => spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
    COMPANY_MAINTENANCE_COLD: String(cold), COMPANY_MAINTENANCE_CRASH: crash }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  try {
    const first = start(false, stage)
    const firstExit = once(first, 'exit')
    let error = ''
    first.stderr!.on('data', (value: Buffer) => { error += value.toString() })
    try {
      const [message] = await Promise.race([once(first, 'message'), firstExit.then(() => { throw new Error(error) })]) as unknown[]
      expect(message).toBe('durable')
    } finally { first.kill('SIGKILL'); await firstExit }
    const recovered = start(true, '')
    const ended = once(recovered, 'exit')
    let output = '', stderr = ''
    recovered.stdout!.on('data', (value: Buffer) => { output += value.toString() })
    recovered.stderr!.on('data', (value: Buffer) => { stderr += value.toString() })
    try { const [code] = await ended as unknown[]; expect(code, stderr).toBe(0); expect(JSON.parse(output)).toMatchSnapshot() }
    finally { recovered.kill('SIGKILL'); await ended }
  } finally { await rm(root, { recursive: true, force: true }) }
})
