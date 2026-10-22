/** World company and laboratory have one identical driver and real keyless model/tool/Team execution. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World driver', (backend) => {
  it.each(['company', 'laboratory'].flatMap(scenario => [
    { scenario, pause: false, schemaRepair: false }, { scenario, pause: true, schemaRepair: false },
    { scenario, pause: false, schemaRepair: true },
  ]))(
    'drives $scenario with pauseDuringMaintenance=$pause and schemaRepair=$schemaRepair to independent newborn and idle', async ({ scenario, pause, schemaRepair }) => {
      const temp = resolve(process.env.WORLD_RESULT_EVIDENCE_ROOT ?? '.local/world-director-mvp/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-driver-'))
      const fixture = resolve('examples/simulation-company/tests/world-driver-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-driver/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_DRIVER_PAUSE: String(pause), WORLD_DRIVER_SCHEMA_REPAIR: String(schemaRepair), TMPDIR: temp } })
      const execute = async (recover: boolean) => {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code] = await exited as unknown[]
          if (process.env.WORLD_RESULT_EVIDENCE_ROOT !== undefined) await writeFile(resolve(root,
            recover ? 'cold-process.json' : 'warm-process.json'), JSON.stringify({ backend, scenario, pause,
            mode: process.env.CLOCKY_EXAMPLE_MODE ?? 'src', command: launch.command, args: launch.args,
            pid: child.pid, code, stdout: output, stderr: errors }, null, 2) + '\n')
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ scenario, result: 'committed', requests: 1, plans: 1, hires: 1,
            newborn: scenario === 'company' ? 'Lin' : 'Kai', independentSession: true, firstAction: true, notified: true,
            privateInputsExcluded: true, stop: 'idle', modelCalls: recover ? 0 : schemaRepair ? 20 : 18 })
        } finally { child.kill('SIGKILL'); await exited }
      }
      try { await execute(false); await execute(true) }
      finally { if (process.env.WORLD_RESULT_EVIDENCE_ROOT === undefined) await rm(root, { recursive: true, force: true }) }
    },
  )
})
