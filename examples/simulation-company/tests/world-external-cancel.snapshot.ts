/** Real accepted IO, cancellation races and kill boundaries preserve original cleanup sources across independent processes. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const cases = ['before-reserve', 'participant-io', 'channel-io', 'commit-wins', 'unknown-read', 'unknown-close',
  'crash-channel-io', 'crash-abandon-before-append', 'crash-abandon-after-append']
const selected = process.env.WORLD_CHECKPOINT_CANCEL_ONLY === undefined ? cases : process.env.WORLD_CHECKPOINT_CANCEL_ONLY.split(',')
describe.each(['company', 'laboratory'])('%s external representative cleanup', (scene) => {
  it.concurrent.each(selected.flatMap(scenarioCase => ['json', 'sqlite'].map(backend => ({ scenarioCase, backend }))))(
    '$scenarioCase in $backend preserves original identities and restores twice without inference', async ({ scenarioCase, backend }) => {
      const evidence = resolve(process.env.WORLD_CHECKPOINT_CANCEL_EVIDENCE_ROOT ?? '.local/world-completion/c19-external-cleanup')
      await mkdir(evidence, { recursive: true })
      const root = await mkdtemp(resolve(evidence, 'loader-')), face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
      const prefix = `${face}-${scene}-${backend}-${scenarioCase}`, crash = scenarioCase.startsWith('crash-')
      const unknownCold = scenarioCase.startsWith('unknown-')
      const fixture = resolve('examples/simulation-company/tests/world-external-cancel-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-external-cancel/cordis.yml')], env: {
          SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          WORLD_EXTERNAL_CANCEL: scenarioCase, TMPDIR: evidence } })
      for (const [round, recovering] of [false, true, true].entries()) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recovering), WORLD_CANCEL_FINAL: String(round === 2) },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const exited = once(child, 'exit')
        let timedOut = false, output = '', errors = '', crashMessage: unknown
        const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 60000)
        child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          if (crash && !recovering) {
            const message = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(errors) })])
            crashMessage = message[0]
            expect(crashMessage).toMatchObject({ event: 'cancel-durable', modelCalls: 6 })
            child.kill('SIGKILL')
          }
          const [code, signal] = await exited as unknown[]
          await writeFile(resolve(evidence, `${prefix}-process-${round}.json`), JSON.stringify({ scene, backend, face, scenarioCase,
            round, root, command: launch.command, args: launch.args, pid: child.pid, exitCode: code, signal, timedOut,
            intentionalCrash: crash && !recovering, crashMessage, stdout: output, stderr: errors }, null, 2))
          expect(timedOut).toBe(false)
          if (crash && !recovering) {
            expect(code).toBe(null)
            expect(signal).toBe('SIGKILL')
            await copyFile(resolve(root, 'cancel-crash-prefix.json'), resolve(evidence, `${prefix}-crash-prefix.json`))
          } else {
            expect(code, errors).toBe(0)
            expect(signal).toBe(null)
            const result = JSON.parse(output) as { modelCalls: number }
            expect(result).toMatchObject({ scene, scenarioCase, phase: 'paused', originalIdentities: true,
              originalAssets: true, exactRetry: true, pendingResultWakes: unknownCold && round < 2 ? 0 : 1, restored: recovering })
            expect(result.modelCalls).toBe(recovering ? 0 : 6)
            if (unknownCold && round < 2) {
              const name = round === 0 ? 'pending' : 'pending-cold'
              await copyFile(resolve(root, `cancel-${name}.json`), resolve(evidence, `${prefix}-${name}.json`))
            }
            if (!unknownCold && (round === 0 || crash && round === 1) || unknownCold && round === 2) {
              for (const name of ['original', 'input', 'journal', 'model-inputs'])
                await copyFile(resolve(root, `cancel-${name}.json`), resolve(evidence, `${prefix}-${name}.json`))
              if (!crash) await copyFile(resolve(root, 'cancel-held.json'), resolve(evidence, `${prefix}-held.json`))
            }
          }
        } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
      }
      // Keep the source/backend WALs and Sessions under this project for independent race and replay inspection.
    })
})
