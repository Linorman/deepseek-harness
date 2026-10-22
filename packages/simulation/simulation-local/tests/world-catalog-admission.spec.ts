/** The shipped Loader composition owns all built-in parsers and rejects malformed admission without allocating a run. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'])('%s Loader admits exact built-in versions and rejects injected request fields before effects', async (backend) => {
  const evidence = resolve(process.env.WORLD_CATALOG_EVIDENCE_ROOT ?? '.local/world-completion/thread-01a1336a-catalog/loader')
  await mkdir(evidence, { recursive: true })
  const root = await mkdtemp(resolve(evidence, `${process.env.CLOCKY_EXAMPLE_MODE ?? 'src'}-${backend}-`))
  const data = resolve(root, 'runtime'); await mkdir(data)
  const fixture = resolve('packages/simulation/simulation-local/tests/fixtures/world-catalog-admission.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/headless-agent/tests/fixtures/simulation/simulation-local/cordis.yml')],
    env: { SIMULATION_TEST_ROOT: data, SIMULATION_TEST_BACKEND: backend } })
  const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit').then((values: unknown[]) => values)
  let stdout = '', stderr = '', timedOut = false
  child.stdout.on('data', (value: Buffer) => { stdout += value.toString() })
  child.stderr.on('data', (value: Buffer) => { stderr += value.toString() })
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 20000)
  try {
    const [code, signal] = await exited
    expect({ timedOut, signal }).toEqual({ timedOut: false, signal: null })
    expect(code, stderr).toBe(0)
    const report = JSON.parse(stdout) as { rows: unknown[] }
    expect(report).toMatchObject({ backend, commits: 0, unloaded: true })
    expect(report.rows).toHaveLength(19)
  } finally {
    clearTimeout(timer); child.kill('SIGKILL')
    const [code, signal] = await exited
    await writeFile(resolve(root, 'process.json'), JSON.stringify({ command: launch.command, args: launch.args,
      code, signal, timedOut, stdout, stderr }, null, 2) + '\n')
  }
}, 25000)
