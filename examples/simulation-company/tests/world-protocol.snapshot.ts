import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s Loader world protocol', (backend) => {
  it.each([
    ['apply', false, 'pending'], ['reject', false, 'pending'], ['apply', true, 'pending'], ['reject', true, 'pending'],
    ['apply', true, 'cancelled'], ['reject', true, 'cancelled'], ['reject', true, 'rejected'],
  ] as const)(
    'retains %s with crash=%s at %s', async (resolution, crash, terminal) => {
      const temp = resolve('.local/world-completion/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-protocol-'))
      try {
        const fixture = resolve('examples/simulation-company/tests/world-protocol-scenario.ts')
        const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
          configArgs: [resolve('examples/simulation-company/tests/fixtures/world-protocol/cordis.yml')],
          env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend,
            WORLD_RESOLUTION: resolution, WORLD_TERMINAL: terminal, TMPDIR: temp } })
        if (crash) {
          const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_CRASH: 'accepted-plan' },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
          const exited = once(child, 'exit')
          let errors = ''
          child.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString() })
          try {
            const [ready] = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(errors) })]) as unknown[]
            expect(ready).toBe('durable')
          } finally { child.kill('SIGKILL'); await exited }
        }
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_RECOVER: String(crash) }, stdio: 'pipe' })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ cases: 1, plans: 1, actors: 2, entities: 5, effects: terminal,
            results: terminal === 'pending' ? 0 : 1, notificationWakes: terminal === 'pending' ? 0 : 1,
            resolution: resolution === 'apply'
              ? { kind: 'apply', persona: { name: 'Lin', skills: ['analysis'], traits: ['patient'], goals: ['research'] } }
              : { kind: 'reject', reason: 'insufficient-information' },
            originalNotificationConsumed: true, privateReceipt: true, originalPlanPreserved: true,
            phase: crash ? 'paused' : 'running', modelCalls: crash ? 0 : 6 })
        } finally { child.kill('SIGKILL'); await exited }
      } finally { await rm(root, { recursive: true, force: true }) }
    })
})
