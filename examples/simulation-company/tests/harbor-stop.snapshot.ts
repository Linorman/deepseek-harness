/** Real Loader decisions correct a refused date jump before any request reaches the original judge. */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each([{ backend: 'json', mode: 'at-boundary', budget: 'enough' }, { backend: 'sqlite', mode: 'at-boundary', budget: 'enough' },
  { backend: 'json', mode: 'drain-admitted', budget: 'enough' }, { backend: 'sqlite', mode: 'drain-admitted', budget: 'enough' },
  { backend: 'json', mode: 'drain-admitted', budget: 'limited' }, { backend: 'sqlite', mode: 'drain-admitted', budget: 'limited' }])(
  '$backend/$mode/$budget enforces a durable Harbor boundary during a real staged decision', async ({ backend, mode, budget }) => {
    const root = await mkdtemp(resolve('.tmp/harbor-stop-loader-'))
    const fixture = resolve('examples/simulation-company/tests/harbor-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/harbor/cordis.yml')],
      env: { HARBOR_STOP_TEST: 'true', HARBOR_STOP_MODE: mode, HARBOR_STOP_BUDGET: budget, HARBOR_PROTOCOL_VERSION: '3', SIMULATION_COMPANY_ROOT: root,
        SIMULATION_COMPANY_BACKEND: backend, SIMULATION_CONTEXT_LIMIT: '524288',
        SIMULATION_BENCHMARK_TEAM_LIMITS: JSON.stringify({ maxActivationsPerTeam: 4096,
          maxEnvelopeBytes: 262144, maxChannelViewBytes: 262144, maxModelTokensPerTeam: 2000000000,
          maxTurnsPerTeam: 100000, maxWallTimeMsPerTeam: 604800000, maxPostIdempotencyEntriesPerChannel: 4096 }) } })
    let passed = false
    try {
      const { stdout } = await promisify(execFile)(launch.command, launch.args, {
        env: { ...process.env, ...launch.env }, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
      })
      expect(JSON.parse(stdout)).toEqual({ stopping: 'paused', crossingRejected: true, correctedAdvanceCount: 1,
        drainResult: mode !== 'drain-admitted' ? 'not-requested' : budget === 'limited' ? 'budget' : 'complete' })
      passed = true
    } finally { if (passed) await rm(root, { recursive: true, force: true }) }
  }, 130000)
