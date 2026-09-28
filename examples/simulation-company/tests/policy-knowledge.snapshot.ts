/** Real Loader policy views include exact report bodies without model inference. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const execute = promisify(execFile)
describe.each(['json', 'sqlite'])('%s policy knowledge', (backend) => {
  it.each([false, true])('materializes reports with windowed=%s', async (windowed) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/policy-knowledge-'))
    try {
      const fixture = resolve('examples/simulation-company/tests/policy-knowledge-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, POLICY_KNOWLEDGE_WINDOW: String(windowed) } })
      const { stdout } = await execute(launch.command, launch.args, { env: { ...process.env, ...launch.env } })
      expect(JSON.parse(stdout)).toMatchSnapshot()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
