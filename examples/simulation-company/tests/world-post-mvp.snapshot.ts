/** Keyless runnable A3 snapshots boot real Cordis configuration and consume canonical Session/tool material. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s post-MVP original governance', (backend) => {
  it.each(['proxy', 'route'])('%s retains actual sources through cold replay', async (kind) => {
    const temp = resolve('.tmp/world-post-mvp/snapshot')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, `${backend}-${kind}-`))
    const source = resolve('examples/simulation-company/tests/world-post-mvp-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_POST_MVP_FLOW: kind, TMPDIR: temp } })
    for (const recover of [false, true]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_POST_MVP_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit')
      let stdout = '', stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => child.kill('SIGKILL'), 30000)
      try {
        const [code, signal] = await exited as unknown[]
        await writeFile(resolve(root, recover ? 'cold-process.json' : 'warm-process.json'), JSON.stringify({ command: launch.command, args: launch.args, code, signal, stdout, stderr }, null, 2) + '\n')
        expect(code, stderr).toBe(0)
        const actual: unknown = JSON.parse(stdout)
        expect(actual).toMatchObject({ backend, kind, modelCalls: 0, restored: true, recoveredProcess: recover })
        if (kind === 'proxy') expect(actual).toMatchObject({ grants: [
          { principal: 'buyer', delegate: 'fee-candidate', revoked: false }, { principal: 'buyer', delegate: 'fee-candidate', revoked: true }],
        ballots: [{ voter: 'buyer', choice: 'yes', proxy: true }] })
        else expect(actual).toMatchObject({ route: { mode: 'ordered', steps: 2, membershipPolicy: 'frozen' },
          independentVotes: 3, enacted: 'Same approved text', impactRecorded: true })
      } finally { clearTimeout(timeout); child.kill('SIGKILL') }
    }
  }, 60000)
})
