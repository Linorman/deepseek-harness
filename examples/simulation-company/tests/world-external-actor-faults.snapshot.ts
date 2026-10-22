/** Each real normal-path barrier is killed once and restored by two independent processes without inference. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const stages = ['actor-reserve-before', 'actor-reserve-after', 'actor-preparing-after', 'actor-participant-unconfirmed',
  'actor-commit-before', 'actor-commit-after', 'director-channel-unconfirmed', 'requester-channel-unconfirmed',
  'result-notice-before-post', 'contact-post-lost', 'contact-session-before-ack', 'contact-ack-after',
  'reply-post-lost', 'reply-session-before-ack', 'reply-ack-after']
describe.each(['company', 'laboratory'])('%s normal external actor faults', (scene) => {
  it.concurrent.each(stages.flatMap(stage => ['json', 'sqlite'].map(backend => ({ stage, backend }))))(
    '$stage in $backend preserves original sources through two cold processes', async ({ stage, backend }) => {
      const evidence = resolve(process.env.WORLD_ACTOR_FAULT_EVIDENCE_ROOT ?? '.local/world-completion/c22-external-actor-faults')
      await mkdir(evidence, { recursive: true })
      const root = await mkdtemp(resolve(evidence, 'loader-')), face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
      const prefix = `${face}-${scene}-${backend}-${stage}`
      const fixture = resolve('examples/simulation-company/tests/world-external-actor-faults-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-external-actor-faults/cordis.yml')], env: {
          SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          WORLD_ACTOR_FAULT: stage, TMPDIR: evidence } })
      for (const round of [0, 1, 2]) {
        const environment = { ...launch.env, WORLD_DRIVER_RECOVER: String(round !== 0), WORLD_FAULT_FINAL: String(round === 2) }
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const exited = once(child, 'exit')
        let stdout = '', stderr = '', timedOut = false, crashMessage: unknown
        const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 60000)
        child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
        child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        try {
          if (round === 0) {
            const message = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(stderr) })])
            crashMessage = message[0]
            expect(crashMessage).toMatchObject({ event: 'actor-fault-durable', stage, scene,
              modelCalls: stage.startsWith('reply') ? 12 : stage.startsWith('actor') || stage.endsWith('channel-unconfirmed') ? 6 : 9 })
            child.kill('SIGKILL')
          }
          const [code, signal] = await exited as unknown[]
          await writeFile(resolve(evidence, `${prefix}-process-${round}.json`), JSON.stringify({ stage, scene, backend, face, round,
            root, pid: child.pid, command: launch.command, args: launch.args, environment,
            exitCode: code, signal, timedOut, intentionalCrash: round === 0, crashMessage, stdout, stderr }, null, 2) + '\n')
          expect(timedOut).toBe(false)
          if (round === 0) {
            expect(code).toBe(null)
            expect(signal).toBe('SIGKILL')
            for (const name of ['prefix', 'input', 'model-inputs'])
              await copyFile(resolve(root, `fault-${name}.json`), resolve(evidence, `${prefix}-${name}.json`))
          } else {
            expect(code, stderr).toBe(0)
            expect(signal).toBe(null)
            expect(JSON.parse(stdout)).toMatchObject({ stage, scene, phase: 'paused', modelCalls: 0,
              originalIdentities: true, originalResources: true, originalCanonicalPrefixes: true, finalCold: round === 2 })
            await copyFile(resolve(root, `fault-cold-${round}.json`), resolve(evidence, `${prefix}-cold-${round}.json`))
          }
        } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
      }
    })
})
