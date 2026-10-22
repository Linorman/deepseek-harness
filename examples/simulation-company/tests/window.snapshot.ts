import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

/** A deadline may settle the held stream before SIGKILL; both histories retain the same charged unknown responsibility. */
function interruptedOutput(value: unknown, slow: string): unknown {
  const output = value as { decisions: Array<{ id: string; status: string; cancellation?: string }>
    tokenAttempts: Record<'reserved' | 'unknown' | 'settled' | 'not-dispatched', number>
    tokens: { used: number; limit: number } }
  const prior = output.decisions.find(decision => decision.id === slow)
  expect(prior?.status).toBe('cancelled')
  expect(['writer-revoked', 'timeout']).toContain(prior?.cancellation)
  const { reserved, unknown, ...attempts } = output.tokenAttempts
  expect(Number.isSafeInteger(reserved) && reserved >= 0).toBe(true)
  expect(Number.isSafeInteger(unknown) && unknown >= 0).toBe(true)
  expect(reserved + unknown).toBe(2)
  expect(attempts).toEqual({ settled: 6, 'not-dispatched': 0 })
  expect(output.tokens).toEqual({ used: 20120, limit: 1000000 })
  return { ...output, decisions: output.decisions.map(decision => decision === prior
    ? { ...decision, cancellation: 'interrupted-before-recovery' } : decision),
  tokenAttempts: { ...attempts, unresolved: reserved + unknown } }
}

describe.each([{ backend: 'json', timeout: false, limit: 2 }, { backend: 'sqlite', timeout: false, limit: 2 },
  { backend: 'json', timeout: false, limit: 1 }, { backend: 'sqlite', timeout: false, limit: 1 },
  { backend: 'json', timeout: false, limit: 1, close: true }, { backend: 'sqlite', timeout: false, limit: 1, close: true },
  { backend: 'json', timeout: true, limit: 2 }, { backend: 'sqlite', timeout: true, limit: 2 }])('$backend model decision window timeout=$timeout limit=$limit close=$close', ({ backend, timeout, limit, close }) => {
  it.each(limit === 1 ? [undefined] : timeout ? [undefined, 'submitted', 'expired'] : [undefined, 'cohort', 'reserved', 'budget', 'tokens', 'submitted'])('keeps the resource outcome with crash=%s', async (crash) => {
    const results: unknown[] = []
    for (const reverse of timeout ? [true] : [false, true]) {
      await mkdir(resolve('.tmp'), { recursive: true })
      const root = await mkdtemp(resolve('.tmp/simulation-window-'))
      try {
        const fixture = resolve('examples/simulation-company/tests/window-scenario.ts')
        const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
          configArgs: [resolve('examples/simulation-company/cordis.yml')], env: {
            SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, SIMULATION_WINDOW_REVERSE: String(reverse),
            SIMULATION_WINDOW_TIMEOUT: String(timeout), SIMULATION_MODEL_LIMIT: String(limit),
            SIMULATION_MODEL_CLOSE: String(close ?? false), SIMULATION_BUDGET_LIMIT: String(crash === 'budget'),
          } })
        if (crash !== undefined) {
          const interrupted = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
            SIMULATION_WINDOW_CRASH: crash }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
          const stopped = once(interrupted, 'exit')
          let error = ''
          interrupted.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
          try {
            const [ready] = await Promise.race([once(interrupted, 'message'), stopped.then(() => { throw new Error(error) })]) as unknown[]
            expect(ready).toBe('durable')
          } finally { interrupted.kill('SIGKILL'); await stopped }
        }
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          SIMULATION_WINDOW_RECOVER: String(crash !== undefined) }, stdio: 'pipe' })
        const exited = once(child, 'exit')
        let output = ''
        let error = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
        try {
          const [code] = await exited as unknown[]
          expect(code, error).toBe(0)
          const observed: unknown = JSON.parse(output)
          results.push(timeout && crash === 'submitted' ? interruptedOutput(observed, reverse ? 'a' : 'b') : observed)
        } finally { child.kill('SIGKILL'); await exited }
      } finally { await rm(root, { recursive: true, force: true }) }
    }
    if (!timeout) expect(results[0]).toEqual(results[1])
    expect(results[0]).toMatchSnapshot()
  })
})
