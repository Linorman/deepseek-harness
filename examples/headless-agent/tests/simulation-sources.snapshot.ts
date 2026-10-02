/** Public source inspection composes actual independent Team and Simulation authorities. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { registration } from '../../../packages/simulation/simulation-product/tests/fixtures.ts'
it.each(['json', 'sqlite'] as const)('inspects original frozen Envelope sources through the real Loader (%s)', async (backend) => {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(resolve('.tmp/simulation-sources-'))
  try {
    const directory = join(root, 'directory'); await mkdir(directory)
    await writeFile(join(directory, 'principal.json'), JSON.stringify({ version: 1, principalId: 'reader', credentialGeneration: 1,
      credentialDigest: createHash('sha256').update('source-test-credential').digest('hex') }), { mode: 0o600 })
    const imported = registration(), script = resolve('packages/simulation/simulation-product/tests/fixtures/sources-loader.ts')
    const launch = resolveExampleLaunch({ srcBin: script, libBin: script, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/headless-agent/tests/fixtures/simulation/simulation-sources/cordis.yml')],
      env: { SIMULATION_TEST_ROOT: join(root, 'world'), SIMULATION_TEST_BACKEND: backend, SIMULATION_PRODUCT_DIRECTORY: directory,
        SIMULATION_PRODUCT_SPEC: JSON.stringify(imported.spec), SIMULATION_PRODUCT_IMPORTS: JSON.stringify([imported]) } })
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: 'pipe', timeout: 25000, killSignal: 'SIGKILL' })
    let stdout = '', stderr = ''
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    const [code] = await once(child, 'exit') as [number | null, NodeJS.Signals | null]
    expect(code, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ text: '精确🙂来源正文', boundedLookup: true, defaultWithheld: true, revoked: true, unchanged: true })
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)
