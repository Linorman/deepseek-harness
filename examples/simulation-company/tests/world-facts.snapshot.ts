/** JSON/SQLite facts are read through real public tools, then reconstructed in an independent restored process. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World facts', (backend) => {
  it('freezes exact body versions and sources, bounds publication and restores without inference', async () => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'facts-loader-'))
    const fixture = resolve('examples/simulation-company/tests/world-facts-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-protocol/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_RESOLUTION: 'apply', TMPDIR: temp } })
    try {
      for (const recovering of [false, true]) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_FACTS_RECOVER: String(recovering) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ facts: 5, versions: 6, frozenViews: 2, privateAudience: true, sourceFrozen: true,
            beliefSeparate: true, unauthorizedToolRejected: true, intervalBoundaries: true, modelCalls: recovering ? 0 : 14 })
        } finally { child.kill('SIGKILL'); await exited }
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
