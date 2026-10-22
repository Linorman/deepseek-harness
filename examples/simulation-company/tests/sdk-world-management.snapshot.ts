/** Build prerequisites: compiled Host packages; lib mode additionally requires the client build and a freshly installed Python wheel. */
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { WORLD_HIRE_EXISTING_PIN } from '@clocky/clocky-simulation'
import { worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import { sample, deployment } from '../../../packages/simulation/simulation-scenario/tests/v1-fixtures.ts'

for (const backend of ['json', 'sqlite']) describe(`${backend} v1 distributed management SDK`, () => {
  it.each(['typescript', 'python'])('retains original actual user hire through %s and independent Host recovery', async (language) => {
    const mode = process.env.CLOCKY_EXAMPLE_MODE === 'lib' ? 'lib' : 'src'
    const temp = resolve('.local/world-completion/tmp'), artifacts = resolve('.local/world-completion/u13-sdk')
    await mkdir(temp, { recursive: true }); await mkdir(artifacts, { recursive: true })
    const root = await mkdtemp(resolve(artifacts, `${mode}-${backend}-${language}-`))
    const installed = structuredClone(deployment)
    installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
    installed.domains.push({ pin: WORLD_HIRE_EXISTING_PIN, available: true })
    const definition = worldScenarioV1Schema.parse({ ...sample,
      domains: [...sample.domains, { domain: WORLD_HIRE_EXISTING_PIN.domain, operation: WORLD_HIRE_EXISTING_PIN.operation,
        version: WORLD_HIRE_EXISTING_PIN.version }], organization: { ...sample.organization,
        grants: [...sample.organization.grants, { id: 'sdk-existing-eligibility', personId: 'observer', domain: 'organization',
          operation: 'hire-existing', version: '1', scopeId: sample.organization.rootId, targetId: sample.organization.rootId,
          relation: 'eligible-for-hire', validFrom: '0', validUntil: null }] },
      behavior: { initialGoals: [], calendars: [], directorEvents: [] } })
    await writeFile(resolve(root, 'definition.json'), JSON.stringify(definition, null, 2) + '\n')
    const launch = resolveExampleLaunch({ mode, srcBin: resolve('packages/examples/jsonrpc-demo/src/bin.ts'),
      libBin: resolve('packages/examples/jsonrpc-demo/lib/bin.js'), tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/sdk-world-management/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend,
        SDK_WORLD_PRODUCT_CONFIGURATION: JSON.stringify({ provider: 'local', catalog: installed,
          checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } }), TMPDIR: temp } })
    const wheel = process.env.SDK_WORLD_INSTALLED
    if (mode === 'lib' && language === 'python' && wheel === undefined) throw new Error('U13 lib Python requires SDK_WORLD_INSTALLED')
    const env = { ...process.env, ...launch.env, SDK_WORLD_LAUNCH: JSON.stringify(launch), SDK_WORLD_MODE: mode,
      SDK_WORLD_CLIENT_ENTRY: resolve(`packages/sdk/client/${mode === 'src' ? 'src/index.ts' : 'lib/index.js'}`),
      PYTHONDONTWRITEBYTECODE: '1', PYTHONPYCACHEPREFIX: resolve(root, 'pycache'),
      PYTHONPATH: wheel ?? resolve('python/sdk/src'), ...wheel === undefined ? {} : { SDK_WORLD_INSTALLED: resolve(wheel) } }
    const result = await execa(language === 'python' ? resolve('python/sdk/.venv/bin/python') : process.execPath,
      language === 'python' ? [resolve('python/sdk/tests/simulation_world_management_snapshot.py')]
        : [...mode === 'src' ? ['--import', 'tsx/esm'] : [], resolve('examples/simulation-company/tests/sdk-world-management-client.mjs')],
      { env, timeout: 60000, reject: false })
    await writeFile(resolve(root, 'stdout.log'), result.stdout + '\n')
    await writeFile(resolve(root, 'stderr.log'), result.stderr + '\n')
    expect(result.exitCode, `${root}\n${result.stderr}`).toBe(0)
    const proof: unknown = JSON.parse(await readFile(resolve(root, 'proof.json'), 'utf8'))
    expect(proof).toMatchObject({ apiVersion: 'clocky.world/v1', language, mode, backend, business: 'committed',
      modelCalls: 0, coldModelCalls: 0, exactOriginal: true, caseSections: 4, coldReadonlyOpens: 0 })
  })
})
