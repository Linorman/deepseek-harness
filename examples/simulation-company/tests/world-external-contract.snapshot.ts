/** Actual independent Loader processes preserve external representative cognition across both scenes and storage backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['company', 'laboratory'])('%s shared external representative', (scene) => {
  it.each(['json', 'sqlite'])('prepares canonical cognition and restores twice without inference in %s', async (backend) => {
    const evidence = resolve('.local/world-completion/c17-external-contract')
    await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence, 'loader-'))
    const fixture = resolve('examples/simulation-company/tests/world-external-contract-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-external-contract/cordis.yml')], env: {
        SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene, TMPDIR: evidence } })
    const mode = process.env.CLOCKY_EXAMPLE_MODE ?? 'source'
    let complete = false
    try {
      for (const [round, recovering] of [false, true, true].entries()) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recovering) }, stdio: ['ignore', 'pipe', 'pipe'] })
        let timedOut = false
        const exited = once(child, 'exit'), timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 45000)
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code, signal] = await exited as unknown[]
          await writeFile(resolve(evidence, `${mode}-${scene}-${backend}-process-${round}.json`), JSON.stringify({
            scene, backend, mode, round, command: launch.command, args: launch.args, pid: child.pid, exitCode: code, signal, timedOut,
            stdout: output, stderr: errors,
          }, null, 2))
          expect(timedOut, errors).toBe(false)
          expect(code, errors).toBe(0)
          const result = JSON.parse(output) as { modelCalls: number }
          expect(result).toMatchObject({ identities: 1, representatives: 1, independentSession: true, canonicalSenders: 9,
            contacts: 3, privateBuyerChannels: 2, concurrentReservationHeld: true, originalSupplierContracts: 1,
            contractTermsPreserved: true, contractHistoryPreserved: true, contractPartiesPreserved: true,
            pendingReuseAccepted: true, staleSuperseded: true, sharedSession: true, sameBuyerChannelReused: true,
            privateInputsExcluded: true, resourcesUnchanged: true, assignmentsUnchanged: true,
            originalSubjectPreserved: true, ordinaryReply: true, checkpointComplete: true, phase: 'paused' })
          if (recovering) expect(result.modelCalls).toBe(0)
          else {
            expect(result.modelCalls).toBeGreaterThan(0)
            for (const name of ['original', 'input', 'session', 'model-inputs', 'held', 'baseline', 'contract-sessions']) {
              await copyFile(resolve(root, `external-contract-${name}.json`), resolve(evidence, `${mode}-${scene}-${backend}-${name}.json`))
            }
          }
        } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
      }
      complete = true
    } finally {
      // Failed Native/Session prefixes remain available inside the project for diagnosis and exact replay.
      if (complete) await rm(root, { recursive: true, force: true })
    }
  })
})
