/** Real Loader cancellation withdraws preparation proofs while retaining durable cleanup responsibility. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s Loader world preparation cancellation', (backend) => {
  it.each(['before-invite', 'after-invite', 'after-channel'])('withdraws preparation at %s', async (stage) => {
    const temp = resolve('.local/world-director-mvp/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-hire-cancellation-'))
    const fixture = resolve('examples/simulation-company/tests/world-hire-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-protocol/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_RESOLUTION: 'apply',
        WORLD_HIRE_CANCEL: stage, WORLD_HIRE_RECOVER: 'false', WORLD_HIRE_CRASH: '', TMPDIR: temp } })
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    let output = '', errors = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
    try {
      const [code] = await exited as unknown[]
      expect(code, errors).toBe(0)
      expect(JSON.parse(output)).toEqual({ phase: 'paused', cancellation: 'cancel-requested', reservation: 'cancel-requested',
        participant: stage === 'before-invite' ? 'absent' : stage === 'after-invite' ? 'invited' : 'active',
        bound: stage === 'after-channel', channels: stage === 'after-channel' ? 2 : 1,
        assignments: 0, results: 0, identitiesPreserved: true, exactRetry: true, modelCalls: 6 })
    } finally {
      child.kill('SIGKILL')
      await exited
      await rm(root, { recursive: true, force: true })
    }
  })
})
