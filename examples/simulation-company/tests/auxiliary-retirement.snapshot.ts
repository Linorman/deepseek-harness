/** Real Loader coverage for auxiliary model ownership during actor retirement. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s auxiliary retirement', (backend) => {
  it.each(['hibernate', 'close', 'checkpoint', 'lease', 'service-bootstrap'])('drains %s provider cleanup before releasing residency', async (mode) => {
    const root = await mkdtemp(resolve('examples/simulation-company/.tmp-aux-retirement-'))
    const config = resolve(root, 'cordis.yml')
    await copyFile(resolve('examples/simulation-company/cordis.yml'), config)
    const fixture = resolve('examples/simulation-company/tests/auxiliary-retirement-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'), configArgs: [config],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, SIMULATION_AUX_RETIREMENT: mode } })
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: 'pipe' })
    const exited = once(child, 'exit')
    const deadline = setTimeout(() => { child.kill('SIGKILL') }, 15000)
    let output = '', error = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
    try {
      const [code, signal] = await exited as unknown[]
      expect(signal, error).toBeNull()
      expect(code, error).toBe(0)
      expect(JSON.parse(output)).toMatchSnapshot()
    } finally { clearTimeout(deadline); child.kill('SIGKILL'); await exited; await rm(root, { recursive: true, force: true }) }
  })
})
