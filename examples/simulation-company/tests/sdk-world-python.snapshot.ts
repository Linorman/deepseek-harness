/** Python source and installed-wheel clients use the same real World runtime and independent-process recovery. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'

describe.each(['json', 'sqlite'])('%s World Python SDK', (backend) => {
  it.each(['company', 'laboratory'])('preserves %s SDK original World commands and cold state', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const artifacts = resolve('.local/world-completion/u13-sdk')
    await mkdir(artifacts, { recursive: true })
    const root = await mkdtemp(resolve(artifacts, `${process.env.CLOCKY_EXAMPLE_MODE ?? 'src'}-${backend}-${scenario}-legacy-py-`))
    const installed = catalog()
    installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
    const launch = resolveExampleLaunch({ srcBin: resolve('packages/examples/jsonrpc-demo/src/bin.ts'),
      libBin: resolve('packages/examples/jsonrpc-demo/lib/bin.js'), tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/sdk-world-management/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
        SDK_WORLD_PRODUCT_CONFIGURATION: JSON.stringify({ provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } }),
        TMPDIR: temp } })
    const wheel = process.env.SDK_WORLD_INSTALLED
    if (process.env.CLOCKY_EXAMPLE_MODE === 'lib' && wheel === undefined) throw new Error('Built Python SDK verification requires SDK_WORLD_INSTALLED')
    const result = await execa(resolve('python/sdk/.venv/bin/python'), [resolve('python/sdk/tests/simulation_world_snapshot.py')], {
      env: { ...process.env, ...launch.env, SDK_WORLD_COMMAND: launch.command, SDK_WORLD_ARGS: JSON.stringify(launch.args),
        PYTHONDONTWRITEBYTECODE: '1', PYTHONPYCACHEPREFIX: resolve(root, 'pycache'), PYTHONPATH: wheel ?? resolve('python/sdk/src'),
        ...wheel === undefined ? {} : { SDK_WORLD_INSTALLED: wheel, PYTHONPATH: wheel } }, timeout: 60000, reject: false })
    await writeFile(resolve(root, 'stdout.log'), result.stdout + '\n')
    await writeFile(resolve(root, 'stderr.log'), result.stderr + '\n')
    expect(result.exitCode, `${root}\n${result.stderr}`).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ scenario, world: true, modelCalls: 18, coldModelCalls: 0, originalCommands: true,
      caseSections: 4, cancellation: 'blocked-terminal', installedWheel: wheel !== undefined,
      unknownRequiredRejected: true, unknownStopRejected: true })

  })
})
