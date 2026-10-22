/** Actual independent candidate decisions and paid hiring replay on both durable backends without provider keys. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each([['json', false, 'accepted', 'on-acceptance'], ['sqlite', false, 'accepted', 'on-acceptance'], ['json', true, 'accepted', 'on-acceptance'], ['sqlite', true, 'accepted', 'on-acceptance'],
  ['json', true, 'declined', 'on-acceptance'], ['sqlite', true, 'declined', 'on-acceptance'], ['json', true, 'withdrawn', 'on-acceptance'], ['sqlite', true, 'withdrawn', 'on-acceptance'],
  ['json', false, 'accepted', 'on-proposal'], ['sqlite', false, 'accepted', 'on-proposal'],
  ['json', true, 'accepted', 'on-proposal'], ['sqlite', true, 'accepted', 'on-proposal']] as const)('%s actual hiring market generated=%s terminal=%s policy=%s', (backend, generated, terminal, policy) => {
  it('retains the original candidate, accepted terms, single fee and assignment across cold restore', async () => {
    const temp = resolve('.tmp/world-post-mvp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'market-'))
    const fixture = resolve('examples/simulation-company/tests/world-hiring-market-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-hiring-market/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_MARKET_GENERATED: String(generated),
        WORLD_MARKET_TERMINAL: terminal, WORLD_MARKET_POLICY: policy, TMPDIR: temp } })
    try {
      for (const recovered of [false, true]) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_DRIVER_RECOVER: String(recovered) },
          stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code] = await exited as unknown[]
          const evidence = resolve(temp, `a2-${policy}-${terminal}-${generated ? 'generated-' : ''}${backend}-${recovered ? 'recovered' : 'create'}`)
          await writeFile(`${evidence}.stdout.json`, output)
          await writeFile(`${evidence}.stderr.log`, errors)
          expect(code, errors).toBe(0)
          const result = JSON.parse(output) as { modelCalls: number }
          expect(result).toMatchObject({ accepted: terminal === 'accepted', terminal, uniqueAssignment: true, originalIdentity: true, noPrivateLeak: true,
            exactRetry: true, recovered })
          if (recovered) expect(result.modelCalls).toBe(0)
          else expect(result.modelCalls).toBeGreaterThan(0)
        } finally { child.kill('SIGKILL'); await exited }
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 120000)
})
