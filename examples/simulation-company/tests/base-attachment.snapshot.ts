/** Real Loader attachment and two cold processes preserve ordinary runs without a World bootstrap. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'])('attaches ordinary %s runs without World authority, model dispatch or Native writes', async (backend) => {
  const evidence = resolve('.local/world-completion/c18-base-attachment')
  await mkdir(evidence, { recursive: true })
  const root = await mkdtemp(resolve(evidence, 'loader-')), face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
  const fixture = resolve('examples/simulation-company/tests/base-attachment-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/base-attachment/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, TMPDIR: evidence,
      SIMULATION_MODEL_LIMIT: '1', SIMULATION_MODEL_QUEUE_LIMIT: '4' } })
  for (const [round, recovering] of [false, true, true].entries()) {
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
      BASE_ATTACHMENT_RECOVER: String(recovering) }, stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    let output = '', errors = '', timedOut = false
    const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 45000)
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
    try {
      const [code, signal] = await exited as unknown[]
      await writeFile(resolve(evidence, `${face}-${backend}-${round}.json`), JSON.stringify({ command: launch.command,
        args: launch.args, pid: child.pid, code, signal, timedOut, stdout: output, stderr: errors }, null, 2))
      expect(timedOut).toBe(false)
      expect(code, errors).toBe(0)
      expect(signal).toBeNull()
      expect(JSON.parse(output)).toEqual({ attached: true, world: false, nativeTeamReservation: false, modelCalls: 0,
        appendCount: 0, phase: 'paused', restored: recovering })
    } finally { clearTimeout(deadline); child.kill('SIGKILL'); await exited }
  }
})
