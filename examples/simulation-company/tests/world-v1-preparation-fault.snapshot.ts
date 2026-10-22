/** Cross-owner real public v1 preparation requires SIGKILL at a persisted boundary and two new cold Loader processes. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const allStages = ['command-accepted', 'team-reserved', 'team-created-lost', 'team-confirmed', 'entity-created',
  'participant-reserved', 'participant-invited-lost', 'participant-active-before-bind', 'participant-bound',
  'channel-reserved', 'channel-opened-lost', 'channel-partial-consent', 'channel-confirmed', 'relation-created',
  'bootstrap-retained', 'bootstrap-before-applied', 'bootstrap-applied', 'checkpoint-requested', 'checkpoint-published-lost',
  'command-completed-lost', 'checkpoint-session-read-io-failed']
const stages = process.env.WORLD_V1_PREPARATION_STAGES?.split(',') ?? allStages
for (const stage of stages) if (!allStages.includes(stage)) throw new Error(`Unknown preparation boundary: ${stage}`)
describe.each(['json', 'sqlite'])('%s actual v1 preparation power-loss boundaries', (backend) => {
  it.concurrent.each(stages)('preserves original cross-owner responsibility at %s', async (stage) => {
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    const evidence = resolve(process.env.WORLD_V1_PREPARATION_EVIDENCE_ROOT ?? '.local/world-completion/c31-v1-preparation')
    await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence, `${face}-${backend}-${stage}-`))
    const fixture = resolve('examples/simulation-company/tests/world-v1-preparation-fault-scenario.ts')
    const config = resolve('examples/simulation-company/tests/fixtures/world-v1-preparation-fault/cordis.yml')
    const inputs = await Promise.all([fixture, config,
      resolve('examples/simulation-company/tests/world-v1-preparation-fault.snapshot.ts'),
      resolve('examples/simulation-company/tests/fixtures/world-v1-preparation-fault/deployment.ts'),
      resolve('examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts'),
      resolve('examples/simulation-company/tests/world-external-mediated-model.ts')].map(async (path) => {
      const bytes = await readFile(path), filename = path.split('/').at(-1)!
      const label = path.includes('/world-v1-product/') ? `c30-${filename}` : filename
      await writeFile(resolve(root, `input-${label}`), bytes)
      return { path, copy: `input-${label}`, sha256: createHash('sha256').update(bytes).digest('hex') }
    }))
    await writeFile(resolve(root, 'fixture-inputs.json'), JSON.stringify(inputs, null, 2))
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'), configArgs: [config],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_V1_PREPARATION_STAGE: stage, TMPDIR: evidence } })
    for (const round of [0, 1, 2]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_V1_PREPARATION_ROUND: String(round) },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exited = once(child, 'exit').then((values: unknown[]) => values)
      let stdout = '', stderr = '', timedOut = false, failure: string | undefined, barrier: unknown
      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString() }); child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 90000)
      try {
        if (round === 0) {
          const message = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(stderr) })])
          barrier = message[0]; expect(barrier).toEqual({ event: 'v1-preparation-boundary', stage }); child.kill('SIGKILL')
        }
        const [code, signal] = await exited
        expect(timedOut).toBe(false)
        if (round === 0) expect(signal).toBe('SIGKILL')
        else { expect(signal).toBe(null); expect(code, stderr).toBe(0)
          expect(JSON.parse(stdout)).toMatchObject({ stage, round, face, backend, phase: 'paused', modelCalls: 0,
            originalInputRetained: true, originalCanonicalIdsRetained: true, originalDataAppliedOnce: true,
            checkpointPublishedOnce: true }) }
      } catch (error) { failure = String(error); throw error }
      finally {
        clearTimeout(timeout); child.kill('SIGKILL'); const [code, signal] = await exited
        await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ stage, round, face, backend, command: launch.command,
          args: launch.args, pid: child.pid, barrier, exitCode: code, signal, timedOut, failure, stdout, stderr }, null, 2) + '\n')
      }
    }
    await writeFile(resolve(root, 'complete.json'), JSON.stringify({ face, stage, backend, rounds: 3, root }) + '\n')
  })
})
