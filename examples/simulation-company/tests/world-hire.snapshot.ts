/** Real Loader hires reconcile the accepted plan and every original identity after SIGKILL. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s Loader world hire', (backend) => {
  it.each([undefined, 'accepted-before-reserve', 'reserve-before-prep', 'participant-afterIO', 'commit-before', 'commit-after'])(
    'retains the original plan and complete hire at crash=%s', async (crash) => {
      const temp = resolve('.local/world-completion/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-hire-loader-'))
      const fixture = resolve('examples/simulation-company/tests/world-hire-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-protocol/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_RESOLUTION: 'apply', TMPDIR: temp } })
      const start = (recover: boolean, stage = '') => {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_HIRE_RECOVER: String(recover), WORLD_HIRE_CRASH: stage }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        return { child, exited, output: () => output, errors: () => errors }
      }
      const expectComplete = (output: string, modelCalls: number, prefixReserved: boolean, prefixCommitted: boolean) => {
        expect(JSON.parse(output)).toEqual({ phase: 'paused', entities: 6, actors: 3, reservations: 1, assignments: 1, results: 1,
          firstWakes: 1, resultWakes: 1, persona: { name: 'Lin', skills: ['analysis'], traits: ['patient'], goals: ['research'] },
          identitiesPreserved: true, newSessionMaterialized: false, atomicCommit: true, exactRetry: true,
          planPreserved: true, resultPreserved: true, prefixReserved, prefixCommitted, modelCalls })
      }
      try {
        if (crash !== undefined) {
          const first = start(false, crash)
          try {
            const message = await Promise.race([once(first.child, 'message'), first.exited.then(() => { throw new Error(first.errors()) })])
            expect(message[0]).toBe('durable')
          } finally {
            first.child.kill('SIGKILL')
            const [, signal] = await first.exited as unknown[]
            expect(signal).toBe('SIGKILL')
          }
        }
        const last = start(crash !== undefined)
        try {
          const [code] = await last.exited as unknown[]
          expect(code, last.errors()).toBe(0)
          expectComplete(last.output(), crash === undefined ? 6 : 0,
            crash !== undefined && crash !== 'accepted-before-reserve', crash === 'commit-after')
        } finally { last.child.kill('SIGKILL'); await last.exited }
        // The further fresh process also checks original UUIDs when the first crash preceded their allocation.
        const repeated = start(true)
        try {
          const [code] = await repeated.exited as unknown[]
          expect(code, repeated.errors()).toBe(0)
          expectComplete(repeated.output(), 0, true, true)
        } finally { repeated.child.kill('SIGKILL'); await repeated.exited }
      } finally { await rm(root, { recursive: true, force: true }) }
    })
})
