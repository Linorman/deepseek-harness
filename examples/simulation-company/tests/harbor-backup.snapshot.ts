/** Full original case state is mandatory for writable restore; the source is made unavailable before target validation. */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'] as const)('%s cold restores a full Harbor private bundle with every original owner', async (backend) => {
  const root = await mkdtemp(resolve('.tmp/harbor-backup-loader-'))
  const fixture = resolve('examples/simulation-company/tests/harbor-backup-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/harbor/cordis.yml')],
    env: { HARBOR_STOP_TEST: 'true', HARBOR_STOP_MODE: 'at-boundary', HARBOR_PROTOCOL_VERSION: '3', SIMULATION_COMPANY_ROOT: root,
      SIMULATION_COMPANY_BACKEND: backend, SIMULATION_CONTEXT_LIMIT: '524288',
      SIMULATION_BENCHMARK_TEAM_LIMITS: JSON.stringify({ maxActivationsPerTeam: 4096, maxEnvelopeBytes: 262144,
        maxChannelViewBytes: 262144, maxModelTokensPerTeam: 2000000000, maxTurnsPerTeam: 100000,
        maxWallTimeMsPerTeam: 604800000, maxPostIdempotencyEntriesPerChannel: 4096 }) } })
  let passed = false
  try {
    const { stdout } = await promisify(execFile)(launch.command, launch.args, { env: { ...process.env, ...launch.env },
      timeout: 180000, maxBuffer: 2 * 1024 * 1024 })
    const value = z.object({ backup: z.literal('complete'), sourceOffline: z.literal(true), caseDay: z.literal(12),
      externalOwners: z.literal(1), stoppingPreserved: z.literal(true), nativeOnlySave: z.literal('external-state-required'),
      sessions: z.number() }).parse(JSON.parse(stdout.trim().split('\n').at(-1)!))
    expect(value).toMatchObject({ backup: 'complete', sourceOffline: true, caseDay: 12, externalOwners: 1, stoppingPreserved: true, nativeOnlySave: 'external-state-required' })
    expect(value.sessions).toBeGreaterThan(0)
    passed = true
  } finally {
    if (passed) for (const directory of [root, `${root}-offline`, `${root}-restored`]) await rm(directory, { recursive: true, force: true })
  }
}, 190000)
