import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s simulation company', (backend) => {
  const crashes = [undefined, 'transfer-applied', 'transfer-accepted', 'transfer-before-accept', 'resident-one',
    'task-before-accept', 'task-accepted', 'task-created'] as const
  const run = async (crash: typeof crashes[number], opaqueIds = false, bootstrapMismatch = false): Promise<void> => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/simulation-company-'))
    try {
      const fixture = resolve('examples/simulation-company/tests/scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, SIMULATION_AUTO_RESIDENCY: String(crash === 'resident-one'),
          SIMULATION_OPAQUE_DECISIONS: String(opaqueIds), SIMULATION_BOOTSTRAP_RESPONSE_FAULT: String(bootstrapMismatch) } })
      if (crash !== undefined && crash !== 'resident-one') {
        const interrupted = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          SIMULATION_COMPANY_CRASH: crash }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const stopped = once(interrupted, 'exit')
        let error = ''
        interrupted.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
        try {
          const [ready] = await Promise.race([once(interrupted, 'message'), stopped.then(() => { throw new Error(error) })]) as unknown[]
          expect(ready).toBe('durable')
        } finally { interrupted.kill('SIGKILL'); await stopped }
      }
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        SIMULATION_COMPANY_MODE: crash === undefined || crash === 'resident-one' ? 'create' : 'open' }, stdio: 'pipe' })
      const exited = once(child, 'exit')
      let output = ''
      let error = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, error).toBe(0)
        const result = JSON.parse(output) as {
          bootstrapResponseRejected?: boolean
          decisions: Array<{ id: string }>
          requests: Array<{ decision: string }>
        }
        if (bootstrapMismatch) expect(result.bootstrapResponseRejected).toBe(true)
        expect(bootstrapMismatch ? { bootstrapResponseRejected: result.bootstrapResponseRejected,
          decisions: result.decisions.map(value => value.id) }
          : opaqueIds ? { decisions: result.decisions.filter(item => ['constructor', 'toString', '__proto__'].includes(item.id)),
            requests: result.requests.filter(item => ['constructor', 'toString', '__proto__'].includes(item.decision)) } : result).toMatchSnapshot()
      } finally {
        child.kill('SIGKILL')
        await exited
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  }
  it.each(crashes)('runs model procurement with crash=%s', async (crash) => { await run(crash) })
  it('executes and retries opaque decision identifiers through prepared model inputs', async () => { await run(undefined, true) })
  it('recovers a substituted participant response before running the company', async () => { await run(undefined, false, true) })
})
