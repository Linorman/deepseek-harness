/** Real original Native initialization and subsequent canonical model work survive two separate paused cold processes. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s actual Native World bootstrap', (backend) => {
  it.concurrent.each(['initial', 'goal', 'position'])('keeps initial data, source and $0 behavior across two cold processes', async (scenarioCase) => {
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    const evidence = resolve(process.env.WORLD_BOOTSTRAP_EVIDENCE_ROOT ?? '.local/world-completion/c28-world-bootstrap')
    await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence, `${face}-${backend}-${scenarioCase}-`))
    const fixture = resolve('examples/simulation-company/tests/world-bootstrap-scenario.ts')
    const config = resolve('examples/simulation-company/tests/fixtures/world-bootstrap/cordis.yml')
    const inputs = await Promise.all([fixture, config,
      resolve('examples/simulation-company/tests/world-external-mediated-model.ts'),
      resolve('examples/simulation-company/cordis.yml'), resolve('examples/simulation-company/scenarios/world-company.json'),
      resolve('packages/simulation/simulation-scenario/tests/fixtures.ts')].map(async path => ({ path,
      sha256: createHash('sha256').update(await readFile(path)).digest('hex') })))
    await writeFile(resolve(root, 'frozen-inputs.json'), JSON.stringify({ scenarioCase, backend, face, inputs }, null, 2))
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'), configArgs: [config],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_BOOTSTRAP_CASE: scenarioCase, TMPDIR: evidence } })
    for (const round of [0, 1, 2]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_BOOTSTRAP_RECOVER: String(round !== 0),
        WORLD_BOOTSTRAP_ROUND: String(round) }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit').then((values: unknown[]) => values)
      let stdout = '', stderr = '', timedOut = false, failure: string | undefined
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 90000)
      try {
        const [code, signal] = await exited
        expect(timedOut).toBe(false); expect(signal).toBe(null); expect(code, stderr).toBe(0)
        const result = JSON.parse(stdout) as { modelCalls: number }
        expect(result).toMatchObject({ scenarioCase, phase: 'paused', initializedFromRealSource: true, originalDataRetained: true,
          horizonRejected: true, initialCheckpointInert: true, noPrebuiltIntent: true, originalCanonicalSources: true })
        if (round !== 0 || scenarioCase === 'position') expect(result.modelCalls).toBe(0)
        else expect(result.modelCalls).toBeGreaterThan(0)
      } catch (error) { failure = String(error); throw error }
      finally {
        clearTimeout(timeout); child.kill('SIGKILL')
        const [code, signal] = await exited
        await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ scenarioCase, backend, face, round, root,
          command: launch.command, args: launch.args, pid: child.pid, exitCode: code, signal, timedOut, failure, stdout, stderr }, null, 2) + '\n')
      }
    }
    await writeFile(resolve(root, 'complete.json'), JSON.stringify({ scenarioCase, backend, face, rounds: 3, root }))
  })
})
