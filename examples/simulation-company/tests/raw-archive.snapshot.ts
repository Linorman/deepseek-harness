/** Real Loader preservation covers unsupported original versions and permission revocation for both storage backends. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'])('preserves original unknown Native bytes through authenticated Host (%s)', async (backend) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/raw-archive-loader-'))
  const fixture = resolve('examples/simulation-company/tests/raw-archive-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/raw-archive/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend } })
  let passed = false
  try {
    const { stdout } = await promisify(execFile)(launch.command, launch.args, { env: { ...process.env, ...launch.env },
      timeout: 60000, maxBuffer: 1024 * 1024 })
    expect(JSON.parse(stdout)).toEqual({ originalVersion: 101, rawOnly: true, physicalDatabaseCopy: false, originalBytesPreserved: true,
      nativeOwnerCreated: false, permissionRevoked: true, modelRequests: 0 })
    passed = true
  } finally { if (passed) await rm(root, { recursive: true, force: true }) }
}, 70000)
