/** Actual external append and receipt barriers survive SIGKILL and two independent paused cold processes. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, copyFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const stages = ['request-accepted-after', 'request-notification-lost', 'rule-before', 'rule-after', 'result-notification-lost',
  'actor-reserve-before', 'actor-reserve-after', 'actor-preparing-after', 'actor-participant-unconfirmed', 'actor-commit-before', 'actor-commit-after',
  'actor-request-accepted-after', 'actor-request-notification-lost', 'actor-result-notification-lost', 'actor-channel-unconfirmed']
describe.each(['json', 'sqlite'])('%s original external crash boundaries', (backend) => {
  it.concurrent.each(stages)('retains original accepted responsibility at %s', async (stage) => {
    const evidence = resolve('.local/world-completion/c21-external-crash')
    await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence, 'loader-')), face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    const prefix = `${face}-${backend}-${stage}`
    const fixture = resolve('examples/simulation-company/tests/world-external-crash-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-external-crash/cordis.yml')], env: {
        SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: 'company', WORLD_EXTERNAL_CRASH_STAGE: stage,
        TMPDIR: evidence } })
    for (const round of [0, 1, 2]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        WORLD_DRIVER_RECOVER: String(round !== 0), WORLD_CRASH_RESTORE_ROUND: String(round) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exited = once(child, 'exit').then((values: unknown[]) => values)
      let stdout = '', stderr = '', timedOut = false
      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 60000)
      try {
        if (round === 0) {
          const message = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(stderr) })])
          expect(message[0]).toEqual({ event: 'external-durable', stage })
          child.kill('SIGKILL')
        }
        const [code, signal] = await exited
        await writeFile(resolve(evidence, `${prefix}-process-${round}.json`), JSON.stringify({ stage, backend, face, round,
          pid: child.pid, root, command: launch.command, args: launch.args, exitCode: code, signal, timedOut, stdout, stderr }, null, 2) + '\n')
        expect(timedOut).toBe(false)
        if (round === 0) {
          expect(signal).toBe('SIGKILL')
          await copyFile(resolve(root, 'external-crash-prefix.json'), resolve(evidence, `${prefix}-prefix.json`))
          await copyFile(resolve(root, 'external-crash-input.json'), resolve(evidence, `${prefix}-input.json`))
        } else {
          expect(code, stderr).toBe(0)
          expect(JSON.parse(stdout)).toEqual({ stage, phase: 'paused', modelCalls: 0, identityAndDutiesRetained: true })
          await copyFile(resolve(root, `external-crash-cold-${round}.json`), resolve(evidence, `${prefix}-cold-${round}.json`))
        }
      } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
    }
  })
})
