import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s checkpoint execution identity', (backend) => {
  it('rejects replacing the Team before the first entity binding', async () => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/checkpoint-owner-'))
    const fixture = resolve('examples/simulation-company/tests/checkpoint-owner-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend } })
    try {
      const { stdout } = await promisify(execFile)(launch.command, launch.args, { env: { ...process.env, ...launch.env } })
      expect(JSON.parse(stdout)).toMatchSnapshot()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
