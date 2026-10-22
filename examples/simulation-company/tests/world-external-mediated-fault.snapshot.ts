/** Real mediated append/Channel barriers require SIGKILL and two fresh paused, inference-free Loader processes. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const stages = ['request-accepted-after', 'request-channel-before', 'request-notification-lost', 'plan-accepted-after',
  'adjudication-before', 'adjudication-after', 'leaf-before', 'leaf-after', 'delayed-notification-lost']
describe.each(['json', 'sqlite'])('%s actual mediated power-loss boundaries', (backend) => {
  it.concurrent.each(stages)('preserves the original responsibility at %s', async (stage) => {
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    const evidence = resolve(process.env.WORLD_MEDIATED_FAULT_EVIDENCE_ROOT ?? '.local/world-completion/c25-mediated-fault')
    await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence, `${face}-${backend}-${stage}-`))
    const fixture = resolve('examples/simulation-company/tests/world-external-mediated-fault-scenario.ts')
    const config = resolve('examples/simulation-company/tests/fixtures/world-external-mediated-fault/cordis.yml')
    const inputs = await Promise.all([fixture, fixture.replace('-scenario.ts', '-model.ts'), config,
      resolve('examples/simulation-company/cordis.yml'), resolve('examples/simulation-company/scenarios/world-company.json'),
      resolve('packages/simulation/simulation-scenario/tests/fixtures.ts')].map(async path => ({ path,
      sha256: createHash('sha256').update(await readFile(path)).digest('hex') })))
    await writeFile(resolve(root, 'frozen-inputs.json'), JSON.stringify({ stage, backend, face, inputs }, null, 2))
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [config], env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend,
        WORLD_MEDIATED_FAULT_STAGE: stage, TMPDIR: evidence } })
    for (const round of [0, 1, 2]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        WORLD_MEDIATED_FAULT_RECOVER: String(round !== 0), WORLD_MEDIATED_FAULT_ROUND: String(round) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exited = once(child, 'exit').then((values: unknown[]) => values)
      let stdout = '', stderr = '', timedOut = false
      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 60000)
      try {
        if (round === 0) {
          const message = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(stderr) })])
          expect(message[0]).toEqual({ event: 'mediated-durable-boundary', stage })
          child.kill('SIGKILL')
        }
        const [code, signal] = await exited
        await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ stage, backend, face, round, root,
          pid: child.pid, command: launch.command, args: launch.args, exitCode: code, signal, timedOut, stdout, stderr }, null, 2) + '\n')
        expect(timedOut).toBe(false)
        if (round === 0) expect(signal).toBe('SIGKILL')
        else {
          expect(signal).toBe(null)
          expect(code, stderr).toBe(0)
          expect(JSON.parse(stdout)).toMatchObject({ stage, phase: 'paused', modelCalls: 0, originalResponsibilityRetained: true,
            canonicalSourceRetained: true, privateInputsExcluded: true })
        }
      } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
    }
    await writeFile(resolve(root, 'complete.json'), JSON.stringify({ face, stage, backend, rounds: 3, root }))
  })
})
