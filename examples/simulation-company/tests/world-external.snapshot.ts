/** Real independent processes exercise installed external domains in both portable scenes and persistence backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['company', 'laboratory'])('%s external rule', (scene) => {
  it.each(['json', 'sqlite'])('retains original identity/input/output in %s and restores twice without inference', async (backend) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const evidence = process.env.WORLD_CHECKPOINT_EXTERNAL_EVIDENCE_ROOT
    if (evidence !== undefined) await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence ?? temp, 'external-loader-'))
    const fixture = resolve('examples/simulation-company/tests/world-external-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-external/cordis.yml')], env: {
        SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene, TMPDIR: temp } })
    try {
      for (const [round, recovering] of [false, true, true].entries()) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recovering) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        const timeout = setTimeout(() => { child.kill('SIGKILL') }, 30000)
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code, signal] = await exited as unknown[]
          expect(code, errors).toBe(0)
          const result = JSON.parse(output) as { modelCalls: number }
          expect(result).toMatchObject({ identities: 2, evaluations: 3, stableKey: true, unknownPreserved: true,
            resourcesUnchanged: true, unsafePayloadRejected: true, recordedOutcome: true, checkpointComplete: true, phase: 'paused' })
          if (recovering) expect(result.modelCalls).toBe(0)
          else expect(result.modelCalls).toBeGreaterThan(0)
          const mode = process.env.CLOCKY_EXAMPLE_MODE ?? 'source'
          if (!recovering) {
            for (const name of ['original', 'input', 'journal']) await copyFile(resolve(root, `external-${name}.json`),
              resolve(temp, `c14-external-${mode}-${scene}-${backend}-${name}.json`))
          }
          await writeFile(resolve(temp, `c14-external-${mode}-${scene}-${backend}-process-${round}.json`), JSON.stringify({
            scene, backend, mode, round, command: launch.command, args: launch.args, pid: child.pid, exitCode: code, signal,
            stdout: output, stderr: errors, result,
          }, null, 2))
          if (evidence !== undefined) await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({
            scene, backend, face: process.env.CLOCKY_EXAMPLE_MODE ?? 'src', round, command: launch.command, args: launch.args,
            pid: child.pid, exitCode: code, signal, stdout: output, stderr: errors, result }, null, 2))
        } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
      }
    } finally { if (evidence === undefined) await rm(root, { recursive: true, force: true }) }
  })
})
