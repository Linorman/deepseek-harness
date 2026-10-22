/** Real target cleanup and Native atomic cancellation survive SIGKILL without new inference or identities. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const cases = [
  { stage: 'before-invite', crash: '' }, { stage: 'after-invite', crash: '' }, { stage: 'after-channel', crash: '' },
  { stage: 'after-channel', crash: 'cleanup-member-afterIO' },
  { stage: 'after-channel', crash: 'cleanup-before-append' }, { stage: 'after-channel', crash: 'cleanup-after-append' },
]

describe.each(['json', 'sqlite'])('%s Loader world hire cleanup', (backend) => {
  it.each(cases)('preserves original cancellation at stage=$stage crash=$crash', async ({ stage, crash }) => {
    const temp = resolve('.local/world-director-mvp/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-hire-cleanup-'))
    const fixture = resolve('examples/simulation-company/tests/world-hire-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-protocol/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_RESOLUTION: 'apply',
        WORLD_HIRE_CANCEL: stage, WORLD_HIRE_CLEANUP: 'true', TMPDIR: temp } })
    const start = (recover: boolean, boundary = '') => {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        WORLD_HIRE_RECOVER: String(recover), WORLD_HIRE_CRASH: boundary }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exited = once(child, 'exit')
      let output = '', errors = ''
      child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString() })
      return { child, exited, output: () => output, errors: () => errors }
    }
    const expectComplete = (output: string, modelCalls: number) => {
      expect(JSON.parse(output)).toEqual({ phase: 'paused', cancellation: 'cancelled', reservation: 'abandoned',
        participant: stage === 'before-invite' ? 'absent' : 'left', bound: stage === 'after-channel',
        channels: stage === 'after-channel' ? 2 : 1, assignments: 0, results: 1, identitiesPreserved: true,
        cleanupEvidence: true, resultWakes: 1, exactRetry: true, modelCalls })
    }
    try {
      if (crash !== '') {
        const first = start(false, crash)
        try {
          const message = await Promise.race([once(first.child, 'message'), first.exited.then(() => { throw new Error(first.errors()) })])
          expect(message[0]).toBe('durable')
        } finally { first.child.kill('SIGKILL'); await first.exited }
      }
      const completed = start(crash !== '')
      try {
        const [code] = await completed.exited as unknown[]
        expect(code, completed.errors()).toBe(0)
        expectComplete(completed.output(), crash === '' ? 6 : 0)
      } finally { completed.child.kill('SIGKILL'); await completed.exited }
      const repeated = start(true)
      try {
        const [code] = await repeated.exited as unknown[]
        expect(code, repeated.errors()).toBe(0)
        expectComplete(repeated.output(), 0)
      } finally { repeated.child.kill('SIGKILL'); await repeated.exited }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
