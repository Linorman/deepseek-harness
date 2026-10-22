/** Candidate preparation and accepted hiring resume across real process loss without replacing identity or consent. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s generated market recovery', (backend) => {
  it.each(['participant-afterIO', 'candidate-ready', 'commit-before', 'commit-after'])('retains original responsibility at %s', async (cut) => {
    const temp = resolve('.tmp/world-post-mvp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'market-crash-'))
    const fixture = resolve('examples/simulation-company/tests/world-hiring-market-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-hiring-market/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_MARKET_GENERATED: 'true', TMPDIR: temp } })
    const start = (recover: boolean, partial: boolean, stage = '') => {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_MARKET_CUT: stage,
        WORLD_DRIVER_RECOVER: String(recover), WORLD_MARKET_PARTIAL: String(partial) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exited = once(child, 'exit')
      let output = '', errors = ''
      child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString() })
      return { child, exited, output: () => output, errors: () => errors }
    }
    try {
      const first = start(false, false, cut)
      try {
        const message = await Promise.race([once(first.child, 'message'), first.exited.then(() => { throw new Error(first.errors()) })])
        expect(message[0]).toBe('durable')
      } finally { first.child.kill('SIGKILL'); await first.exited }
      for (const partial of [true, false]) {
        const next = start(true, partial)
        try {
          const [code] = await next.exited as unknown[]
          await writeFile(resolve(temp, `a2-crash-${backend}-${cut}-${partial}.log`), next.output() + next.errors())
          expect(code, next.errors()).toBe(0)
          expect(JSON.parse(next.output())).toMatchObject({ accepted: true, originalIdentity: true, exactRetry: true })
        } finally { next.child.kill('SIGKILL'); await next.exited }
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 120000)
})
