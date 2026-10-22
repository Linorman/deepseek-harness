/** Real committee votes and original resolution survive process cold restore on both Native backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s independent governance', (backend) => {
  it.each(['company', 'laboratory'])('retains original votes and sole resolution in %s', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const evidence = resolve('.local/world-completion/u14-product/governance')
    await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence, `${process.env.CLOCKY_EXAMPLE_MODE ?? 'src'}-${backend}-${scenario}-`))
    const fixture = resolve('examples/simulation-company/tests/world-governance-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-governance/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario, TMPDIR: temp } })
    for (const recover of [false, true]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        WORLD_DRIVER_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit')
      let output = '', errors = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, errors).toBe(0)
        const result = JSON.parse(output) as { modelCalls: number }
        expect(result).toMatchObject({ scenario, independentSessions: 2, actualVotes: 2,
          actualChannel: true, soleResolution: true, restored: recover })
        expect(result.modelCalls).toBe(recover ? 0 : 39)
      } finally {
        child.kill('SIGKILL')
        const [code, signal] = await exited as unknown[]
        await writeFile(resolve(root, `process-${recover ? 'cold' : 'warm'}.json`), JSON.stringify({ recover, pid: child.pid,
          command: launch.command, args: launch.args, exitCode: code, signal, stdout: output, stderr: errors }, null, 2) + '\n')
      }
    }
  })
})
