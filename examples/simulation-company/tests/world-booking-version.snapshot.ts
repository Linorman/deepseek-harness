/** Writable restore refuses missing or replaced original domain artifacts before inference on both backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch, resolveExampleMode } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s original booking manifest', (backend) => {
  it.each(['company', 'laboratory'])('refuses unavailable artifacts when restoring %s', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const evidence = process.env.WORLD_BOOKING_VERSION_EVIDENCE_ROOT
    if (evidence !== undefined) await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence ?? temp, 'booking-version-'))
    const fixture = resolve('examples/simulation-company/tests/world-booking-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-driver/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
        WORLD_DOMAIN_BOOKING: 'true', TMPDIR: temp } })
    try {
      const cases = [ { native: 'original', execution: 'original' },
        ...['missing', 'schema', 'implementation', 'generation'].map(native => ({ native, execution: 'original' })),
        ...['missing', 'schema', 'implementation', 'generation', 'parser', 'closed'].map(execution => ({ native: 'original', execution })),
        { native: 'original', execution: 'original' } ]
      for (const [index, selected] of cases.entries()) {
        const installation = selected.native
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(index !== 0), BOOKING_INSTALLATION: installation,
          BOOKING_EXECUTION_INSTALLATION: selected.execution },
        stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code, signal] = await exited as unknown[]
          if (evidence !== undefined) await writeFile(resolve(root, `${index}-process.json`), JSON.stringify({
            backend, scenario,
            mode: resolveExampleMode(), selected, pid: child.pid, command: launch.command, args: launch.args,
            code, signal, output, errors }, null, 2))
          expect(code, errors).toBe(0)
          if (selected.execution !== 'original') expect(JSON.parse(output)).toEqual({ scenario, executionUnavailable: true,
            installation: selected.execution, writableOpenCalls: 0, attachmentCalls: 0, executionBindings: 0, modelCalls: 0 })
          else if (installation === 'original') expect(JSON.parse(output)).toMatchObject({ booking: true, mutations: 1, modelCalls: index === 0 ? 15 : 0 })
          else expect(JSON.parse(output)).toEqual({ scenario, unavailable: true, installation, modelCalls: 0 })
        } finally { child.kill('SIGKILL'); await exited }
      }
    } finally { if (evidence === undefined) await rm(root, { recursive: true, force: true }) }
  }, 180000)
})
