/** Actual independent Loader processes preserve external representative cognition across both scenes and storage backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['company', 'laboratory'])('%s independent external representative', (scene) => {
  it.each(['json', 'sqlite'])('prepares canonical cognition and restores twice without inference in %s', async (backend) => {
    const evidence = resolve(process.env.WORLD_MEDIATED_ACTOR_EVIDENCE_ROOT ?? '.local/world-completion/c23-mediated-actor')
    await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence, `loader-${scene}-${backend}-`))
    const fixture = resolve('examples/simulation-company/tests/world-external-mediated-actor-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-external-mediated-actor/cordis.yml')], env: {
        SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene, TMPDIR: evidence } })
    const mode = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    const inputs = await Promise.all([fixture, fixture.replace('-scenario.ts', '-model.ts'),
      resolve('examples/simulation-company/tests/fixtures/world-external-mediated-actor/cordis.yml'),
      resolve('examples/simulation-company/cordis.yml'), resolve(`examples/simulation-company/scenarios/world-${scene}.json`),
      resolve('packages/simulation/simulation-scenario/tests/fixtures.ts')].map(async path => ({ path,
      sha256: createHash('sha256').update(await readFile(path)).digest('hex') })))
    await writeFile(resolve(root, 'frozen-inputs.json'), JSON.stringify({ mode, scene, backend, inputs }, null, 2))
    {
      for (const [round, recovering] of [false, true, true].entries()) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recovering) }, stdio: ['ignore', 'pipe', 'pipe'] })
        let timedOut = false
        const exited = once(child, 'exit'), timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 90000)
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code, signal] = await exited as unknown[]
          await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({
            scene, backend, mode, round, command: launch.command, args: launch.args, pid: child.pid, exitCode: code, signal, timedOut, root,
            stdout: output, stderr: errors,
          }, null, 2))
          expect(timedOut).toBe(false)
          expect(signal).toBe(null)
          expect(code, errors).toBe(0)
          const result = JSON.parse(output) as { modelCalls: number }
          expect(result).toMatchObject({ identities: 1, representatives: 1, independentSession: true, canonicalSenders: 9,
            preparingDenied: true, privateInputsExcluded: true, resourcesUnchanged: true, assignmentsUnchanged: true,
            originalSubjectPreserved: true, ordinaryReply: true, checkpointComplete: true, mediatedActual: true,
            sameCallerExplicitReuse: true, originalCustodyObserved: true, phase: 'paused' })
          if (recovering) expect(result.modelCalls).toBe(0)
          else {
            expect(result.modelCalls).toBeGreaterThan(0)
            for (const name of ['original', 'input', 'session', 'model-inputs', 'contract-baseline']) {
              await copyFile(resolve(root,
                `external-mediated-actor-${name}.json`), resolve(evidence, `${mode}-${scene}-${backend}-${name}.json`))
            }
          }
        } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
      }
      await writeFile(resolve(root, 'complete.json'), JSON.stringify({ mode, scene, backend, rounds: 3, root }))
    }
  })
})
