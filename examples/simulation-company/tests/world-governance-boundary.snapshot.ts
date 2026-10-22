/** Build lib first for plain Node; real SIGKILL leaves original accepted votes for two independent paused recoveries. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s governance domain boundary', (backend) => {
  it.each(['before-close', 'after-close', 'pause-race'])('retains original votes across %s and two cold processes', async (stage) => {
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src', temp = resolve('.local/world-completion/tmp')
    const evidence = resolve('.local/world-completion/u14-product/boundary')
    await mkdir(temp, { recursive: true }); await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence, `${face}-${backend}-${stage}-`))
    const source = resolve('examples/simulation-company/tests/world-governance-boundary-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-governance/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: 'company',
        WORLD_GOVERNANCE_BOUNDARY_STAGE: stage, TMPDIR: temp } })
    const pids: number[] = []
    for (const round of [0, 1, 2]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        WORLD_GOVERNANCE_BOUNDARY_ROUND: String(round) }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit').then((values: unknown[]) => values)
      let stdout = '', stderr = '', timedOut = false
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 60000)
      try {
        const [code, signal] = await exited
        expect(timedOut).toBe(false)
        if (round === 0 && stage !== 'pause-race') { expect(code, stderr).toBe(null); expect(signal).toBe('SIGKILL') }
        else {
          expect(signal).toBe(null); expect(code, stderr).toBe(0)
          const result: unknown = JSON.parse(stdout)
          expect(result).toMatchObject({ face, stage, round, paused: true, ...round === 0 ? {} : { modelCalls: 0 } })
        }
        if (child.pid === undefined) throw new Error('Governance child has no original process identity')
        pids.push(child.pid)
      } finally {
        clearTimeout(timeout); child.kill('SIGKILL')
        const [code, signal] = await exited
        await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ face, backend, stage, round,
          pid: child.pid, command: launch.command, args: launch.args, exitCode: code, signal, timedOut, stdout, stderr }, null, 2) + '\n')
      }
    }
    expect(new Set(pids).size).toBe(3)
    await writeFile(resolve(root, 'complete.json'), JSON.stringify({ face, backend, stage, pids, coldModelCalls: 0 }) + '\n')
  })
})
