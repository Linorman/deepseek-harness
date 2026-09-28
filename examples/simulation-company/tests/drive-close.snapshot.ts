/** Coordinator teardown preserves accepted drive completion through the real Loader. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s coordinator teardown', (backend) => {
  it.each([{ fails: false, outbound: false, input: '' }, { fails: true, outbound: false, input: '' },
    { fails: false, outbound: true, input: '' }, { fails: true, outbound: true, input: '' },
    { fails: false, outbound: false, input: 'queued' }, { fails: true, outbound: false, input: 'queued' },
    { fails: false, outbound: false, input: 'consumed' }, { fails: true, outbound: false, input: 'consumed' },
    { fails: false, outbound: false, input: 'completed' }, { fails: true, outbound: false, input: 'completed' },
    { fails: false, outbound: false, input: 'drift' }, { fails: true, outbound: false, input: 'drift' },
    { fails: false, input: 'drift', drift: 'config' }, { fails: false, input: 'drift', drift: 'system' },
    { fails: false, input: 'drift', drift: 'tools' },
    { fails: false, input: 'queued', checkpoint: true }, { fails: true, input: 'queued', checkpoint: true },
    { fails: false, input: 'consumed', checkpoint: true }, { fails: true, input: 'consumed', checkpoint: true },
    { fails: false, input: 'completed', checkpoint: true }, { fails: true, input: 'completed', checkpoint: true },
    { fails: false, lifecycle: 'service' }, { fails: true, lifecycle: 'service' },
    { fails: false, lifecycle: 'receive' }, { fails: true, lifecycle: 'receive' },
    { fails: false, lifecycle: 'recover' }, { fails: true, lifecycle: 'recover' }])('drains admitted work %j', async ({ fails, outbound, input, lifecycle, checkpoint, drift }) => {
    const root = await mkdtemp(resolve('examples/simulation-company/.tmp-drive-close-'))
    const config = resolve(root, 'cordis.yml')
    await copyFile(resolve('examples/simulation-company/cordis.yml'), config)
    const fixture = resolve('examples/simulation-company/tests/drive-close-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [config],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend,
        SIMULATION_DRIVE_FAILURE: String(fails), SIMULATION_CLOSE_OUTBOX: String(outbound), SIMULATION_CLOSE_INPUT: input ?? '', SIMULATION_CLOSE_LIFECYCLE: lifecycle ?? '', SIMULATION_CLOSE_CHECKPOINT: String(checkpoint ?? false),
        SIMULATION_MODEL_DRIFT: drift ?? 'conversation' } })
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: 'pipe' })
    const exited = once(child, 'exit')
    const deadline = setTimeout(() => { child.kill('SIGKILL') }, 15000)
    let output = '', error = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
    try {
      const [code, signal] = await exited as unknown[]
      expect(signal).toBeNull()
      expect(code, error).toBe(0)
      expect(JSON.parse(output)).toMatchSnapshot()
    } finally { clearTimeout(deadline); child.kill('SIGKILL'); await exited; await rm(root, { recursive: true, force: true }) }
  })
})
