/** Production product owner and automatic task executor retain original effects across actual process exits. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const cases = ['json', 'sqlite'].flatMap(backend => ['model', 'deterministic'].map(cognition => ({ backend, cognition })))
const stages = ['', 'created', 'reserved', 'assigned', 'input', 'decision', 'effect', 'result', 'settled', 'observed']

it.each(cases.flatMap(value => stages.map(stage => ({ ...value, stage }))))
('runs actual $backend $cognition product tasks through $stage process exit', async ({ backend, cognition, stage }) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/company-product-task-'))
  const fixture = resolve('examples/simulation-company/tests/product-task-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/product-task/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, COMPANY_TASK_COGNITION: cognition } })
  const start = (cold: boolean, crash: string) => spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
    COMPANY_TASK_COLD: String(cold), COMPANY_TASK_CRASH: crash }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  try {
    if (stage !== '') {
      const first = start(false, stage), ended = once(first, 'exit')
      let error = ''
      first.stderr!.on('data', (value: Buffer) => { error += value.toString() })
      try {
        const [message] = await Promise.race([once(first, 'message'), ended.then(() => { throw new Error(error) })]) as unknown[]
        expect(message).toBe('durable')
      } finally { first.kill('SIGKILL'); await ended }
    }
    const child = start(stage !== '', ''), ended = once(child, 'exit')
    let output = '', error = ''
    child.stdout!.on('data', (value: Buffer) => { output += value.toString() })
    child.stderr!.on('data', (value: Buffer) => { error += value.toString() })
    try { const [code] = await ended as unknown[]; expect(code, error).toBe(0); expect(JSON.parse(output)).toMatchSnapshot() }
    finally { child.kill('SIGKILL'); await ended }
  } finally { await rm(root, { recursive: true, force: true }) }
})
