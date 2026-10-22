/** Source and shipped package faces enforce the same pre-release durable format policy through the Loader. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'])('rejects obsolete and required unknown %s histories without model calls', async (backend) => {
  const temp = resolve('.local/world-completion/tmp'), evidence = resolve('.local/world-completion/b05-version-policy')
  await mkdir(temp, { recursive: true }); await mkdir(evidence, { recursive: true })
  const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src', root = await mkdtemp(resolve(evidence, `${face}-${backend}-`))
  const source = resolve('examples/simulation-company/tests/world-version-policy-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/world-norm-role/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, TMPDIR: temp } })
  const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit').then((values: unknown[]) => values)
  let stdout = '', stderr = '', timedOut = false
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
  try {
    const [code, signal] = await exited
    expect(timedOut).toBe(false); expect(signal).toBe(null); expect(code, stderr).toBe(0)
    const result = JSON.parse(stdout) as { version: number }
    expect(result).toEqual({ face, backend, version: result.version, obsoleteStreams: result.version + 2,
      refusals: (result.version + 2) * 2, compilerRefusals: 11, authorRefusals: 3, unknownRequiredRejected: true, modelCalls: 0 })
  } finally {
    clearTimeout(timeout); child.kill('SIGKILL'); const [exitCode, signal] = await exited
    await writeFile(resolve(root, 'process.json'), JSON.stringify({ face, backend, pid: child.pid, command: launch.command,
      args: launch.args, exitCode, signal, timedOut, stdout, stderr }, null, 2) + '\n')
  }
})
