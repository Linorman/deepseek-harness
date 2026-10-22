/** Actual Loader owners deny preparing cognition before and after two independent cold restores. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch, resolveExampleMode } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s preparing admission', (backend) => {
  it.each(['company', 'laboratory'])('denies ordinary %s cognition through every owner and cold restore', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'preparing-loader-'))
    const fixture = resolve('examples/simulation-company/tests/world-preparing-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-driver/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario, TMPDIR: temp } })
    const evidence = process.env.WORLD_PREPARING_EVIDENCE
    try {
      for (let recovery = 0; recovery < 3; recovery++) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_PREPARING_RECOVER: String(recovery !== 0) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        const timeout = setTimeout(() => { child.kill('SIGKILL') }, 30000)
        try {
          const [code, signal] = await exited as unknown[]
          if (evidence !== undefined) {
            await mkdir(resolve(evidence), { recursive: true })
            await writeFile(resolve(evidence, `${resolveExampleMode()}-${backend}-${scenario}-${recovery}.json`),
              JSON.stringify({ command: launch.command, args: launch.args, backend, scenario, recovery, code, signal,
                stdout: output, stderr: errors }, null, 2) + '\n')
          }
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ scenario, restored: recovery !== 0, readiness: 'preparing', maintenance: 0,
            ordinaryDecisions: 0, taskAttempts: 0, activations: 0, writer: false, sessionMaterialized: false,
            driverWake: 'cancelled', taskSource: 'applied', identityPreserved: true, phase: 'paused', modelCalls: 0 })
        } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
      }
      if (evidence !== undefined) {
        for (const file of ['preparing-input.json', 'preparing-proof.json']) {
          await writeFile(resolve(evidence, `${resolveExampleMode()}-${backend}-${scenario}-${file}`), await readFile(resolve(root, file)))
        }
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 100000)
})
