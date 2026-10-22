/** SIGKILL leaves actual callback responsibility; fresh product readers and the original provider reconcile without inference. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const stages = (process.env.WORLD_EXECUTION_STAGES ?? 'rejected,blocked,armed,participant,committed,notification').split(',')
it.each(['json', 'sqlite'].flatMap(backend => stages.map(stage => ({ backend, stage }))))(
  '$backend preserves independent cases across $stage SIGKILL and original recovery', async ({ backend, stage }) => {
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    const base = resolve(process.env.WORLD_EXECUTION_EVIDENCE_ROOT ?? '.local/world-completion/p12-execution-faults')
    await mkdir(base, { recursive: true }); const root = await mkdtemp(resolve(base, `${face}-${backend}-${stage}-`))
    const fixture = resolve('examples/simulation-company/tests/world-execution-observation-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_EXECUTION_STAGE: stage, TMPDIR: base } })
    for (const round of [0, 1, 2]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_EXECUTION_ROUND: String(round) },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exit = once(child, 'exit').then((values: unknown[]) => values)
      let stdout = '', stderr = '', timedOut = false
      if (!child.stdout || !child.stderr) throw new Error('Scenario requires captured stdout and stderr')
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 90000)
      try {
        if (round === 0) {
          const ready = once(child, 'message').then(([message]: unknown[]) => message)
          expect(await Promise.race([ready, exit.then((value) => { throw new Error(JSON.stringify({ value, stderr })) })])).toBe('durable')
          child.kill('SIGKILL')
        }
        const [code, signal] = await exit
        expect(timedOut).toBe(false)
        if (round === 0) { expect(code).toBe(null); expect(signal).toBe('SIGKILL') }
        else { expect(code, stderr).toBe(0); expect(signal).toBe(null)
          expect(JSON.parse(stdout)).toMatchObject({ stage, round, phase: 'paused', modelCalls: 0 }) }
      } finally {
        clearTimeout(timeout); child.kill('SIGKILL'); const [code, signal] = await exit
        await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ face, backend, stage, round, pid: child.pid,
          command: launch.command, args: launch.args, code, signal, timedOut, stdout, stderr }, null, 2) + '\n')
      }
    }
  })
