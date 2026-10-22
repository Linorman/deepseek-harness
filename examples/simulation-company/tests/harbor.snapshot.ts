/** Real Loader/Native/Team case integration, with only the external model scripted. */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each([{ backend: 'json', version: '3' }, { backend: 'sqlite', version: '3' },
  { backend: 'sqlite', version: '2' }, { backend: 'sqlite', version: '1' }])(
  '$backend / v$version runs actor-chosen effects through independent Sessions and original World authority', async ({ backend, version }) => {
    const root = await mkdtemp(resolve('.tmp/harbor-loader-'))
    const fixture = resolve('examples/simulation-company/tests/harbor-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/harbor/cordis.yml')],
      env: { HARBOR_PROTOCOL_VERSION: version, SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, SIMULATION_CONTEXT_LIMIT: '524288',
        SIMULATION_BENCHMARK_TEAM_LIMITS: JSON.stringify({ maxActivationsPerTeam: 4096,
          maxEnvelopeBytes: 262144, maxChannelViewBytes: 262144,
          maxModelTokensPerTeam: 2000000000, maxTurnsPerTeam: 100000,
          maxWallTimeMsPerTeam: 604800000, maxPostIdempotencyEntriesPerChannel: 4096 }) } })
    let passed = false
    try {
      for (const recovering of [false, true]) {
        const { stdout } = await promisify(execFile)(launch.command, launch.args, {
          env: { ...process.env, ...launch.env, HARBOR_RECOVER: String(recovering) }, timeout: 60000, maxBuffer: 2 * 1024 * 1024,
        })
        expect(JSON.parse(stdout)).toEqual({ day: 1, caseDecisions: 5, independentSessions: 14, businessProjection: 'accepted/unknown',
          modelActors: recovering ? 0 : 14, directorInferred: !recovering, stop: 'idle' })
      }
      passed = true
    } finally { if (passed) await rm(root, { recursive: true, force: true }) }
  }, 130000)
