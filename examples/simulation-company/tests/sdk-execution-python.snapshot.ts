/** Python SDK consumes the same actual native continuation and authorized model-input record as the TypeScript owner. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { execa } from 'execa'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { executionTemplateJSON } from './sdk-execution-template.ts'

it.each(['json', 'sqlite'])('preserves original report inputs through the genuine Python SDK stdio client (%s)', async (backend) => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/python-sdk-execution-'))
  const launch = resolveExampleLaunch({ srcBin: resolve('packages/examples/jsonrpc-demo/src/bin.ts'),
    libBin: resolve('packages/examples/jsonrpc-demo/lib/bin.js'), tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/sdk-execution/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, COMPANY_PRODUCT_TEMPLATES: executionTemplateJSON } })
  try {
    const result = await execa(resolve('python/sdk/.venv/bin/python'), [resolve('python/sdk/tests/simulation_execution_snapshot.py')], {
      env: { ...process.env, ...launch.env, SDK_EXECUTION_COMMAND: launch.command, SDK_EXECUTION_ARGS: JSON.stringify(launch.args) },
      timeout: 45000,
    })
    expect(JSON.parse(result.stdout)).toMatchSnapshot()
  } finally { await rm(root, { recursive: true, force: true }) }
}, 60000)
