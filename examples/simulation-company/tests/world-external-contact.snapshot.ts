/** Real accepted IO, cancellation races and kill boundaries preserve original cleanup sources across independent processes. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const cases = ['retained-keeper', 'channel-io', 'commit-wins', 'unknown-read', 'unknown-close',
  'crash-channel-io', 'crash-cleanup-before-append', 'crash-cleanup-after-append']
describe.each(['company', 'laboratory'])('%s external contact cleanup', (scene) => {
  it.concurrent.each(cases.flatMap(scenarioCase => ['json', 'sqlite'].map(backend => ({ scenarioCase, backend }))))(
    '$scenarioCase in $backend preserves original identities and restores twice without inference', async ({ scenarioCase, backend }) => {
      const evidence = resolve('.local/world-completion/c20-external-contact')
      await mkdir(evidence, { recursive: true })
      const root = await mkdtemp(resolve(evidence, 'loader-')), face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
      const prefix = `${face}-${scene}-${backend}-${scenarioCase}`, crash = scenarioCase.startsWith('crash-')
      const unknownCold = scenarioCase.startsWith('unknown-')
      const fixture = resolve('examples/simulation-company/tests/world-external-contact-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-external-contact/cordis.yml')], env: {
          SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          WORLD_EXTERNAL_CONTACT: scenarioCase, TMPDIR: evidence } })
      for (const [round, recovering] of [false, true, true].entries()) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recovering), WORLD_CONTACT_FINAL: String(round === 2) },
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
            expect(crashMessage).toMatchObject({ event: 'contact-durable' })
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
            await copyFile(resolve(root, 'contact-crash-prefix.json'), resolve(evidence, `${prefix}-crash-prefix.json`))
          } else {
            expect(code, errors).toBe(0)
            expect(signal).toBe(null)
            const result = JSON.parse(output) as { modelCalls: number }
            expect(result).toMatchObject({ scene, scenarioCase, phase: 'paused', originalIdentities: true,
              originalAssets: true, exactRetry: true, pendingResultWakes: unknownCold && round < 2 ? 0 : 1, restored: recovering })
            if (recovering) expect(result.modelCalls).toBe(0)
            else expect(result.modelCalls).toBeGreaterThanOrEqual(12)
            if (unknownCold && round < 2) {
              const name = round === 0 ? 'pending' : 'pending-cold'
              await copyFile(resolve(root, `contact-${name}.json`), resolve(evidence, `${prefix}-${name}.json`))
            }
            if (!unknownCold && (round === 0 || crash && round === 1) || unknownCold && round === 2) {
              for (const name of ['original', 'input', 'journal', 'model-inputs', 'baseline'])
                await copyFile(resolve(root, `contact-${name}.json`), resolve(evidence, `${prefix}-${name}.json`))
              if (!crash) await copyFile(resolve(root, 'contact-held.json'), resolve(evidence, `${prefix}-held.json`))
            }
          }
        } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
      }
      // Keep the source/backend WALs and Sessions under this project for independent race and replay inspection.
    })
})
