/** Real Loader bootstraps both definitions and reconciles original reservations after SIGKILL. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World initial preparation', (backend) => {
  it.each(['company', 'laboratory'])('prepares a paused %s through real Loader owners', async (scenario) => { await exercise(scenario, backend) })
  it.each(['participant-reserved', 'participant-created', 'channel-reserved', 'channel-created', 'ready', 'checkpoint'])(
    'reuses original company identities after process exit at %s', async (stage) => { await exercise('company', backend, stage) })
})

async function exercise(scenario: string, backend: string, crash?: string): Promise<void> {
  const temp = resolve('.local/world-director-mvp/tmp')
  await mkdir(temp, { recursive: true })
  const root = await mkdtemp(resolve(temp, 'world-preparation-loader-'))
  const fixture = resolve('examples/simulation-company/tests/world-preparation-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/world-preparation/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
      WORLD_RESOLUTION: 'apply', TMPDIR: temp } })
  const start = (recover: boolean, stage?: string) => {
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
      WORLD_PREPARATION_RECOVER: String(recover), WORLD_PREPARATION_CRASH: stage ?? '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    const exited = once(child, 'exit')
    let output = '', errors = ''
    child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString() })
    return { child, exited, output: () => output, errors: () => errors }
  }
  try {
    if (crash !== undefined) {
      const first = start(false, crash)
      try {
        const [message] = await Promise.race([once(first.child, 'message'), first.exited.then(() => { throw new Error(first.errors()) })]) as unknown[]
        expect(message).toBe('durable')
      } finally { first.child.kill('SIGKILL'); await first.exited }
    }
    const last = start(crash !== undefined)
    try {
      const [code] = await last.exited as unknown[]
      expect(code, last.errors()).toBe(0)
      expect(JSON.parse(last.output())).toEqual({ scenario, phase: 'paused', entities: 5, actors: 3, channels: 2,
        ready: true, initialWake: 1, checkpoint: 'completed', identityPreserved: true, originalDefinitionPreserved: true,
        frozenTeamLimits: true, modelCalls: 0, sessionsMaterialized: 0 })
    } finally { last.child.kill('SIGKILL'); await last.exited }
  } finally { await rm(root, { recursive: true, force: true }) }
}
