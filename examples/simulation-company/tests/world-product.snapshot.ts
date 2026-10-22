/** Actual product command recovery, authenticated fetch and identity owners survive process exits. */
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World original product creation', (backend) => {
  it.each(['company', 'laboratory'])('creates a paused %s through the actual product command', async (scenario) => { await exercise(backend, scenario) })
  it.each(['company', 'laboratory'])('creates a paused %s from safe YAML without inference', async (scenario) => {
    await exercise(backend, scenario, undefined, 'yaml')
  })
  it.each(['accepted', 'terminal',
    ...['director', 'requester', 'observer'].flatMap(id => ['participant-reserved', 'participant-created', 'ready']
      .flatMap(stage => [`before-${stage}/${id}`, `after-${stage}/${id}`])),
    ...['world-director:requester', 'world-director:observer'].flatMap(id => ['channel-reserved', 'channel-created']
      .flatMap(stage => [`before-${stage}/${id}`, `after-${stage}/${id}`])),
  ])(
    'reconciles the same command and identities after exit at %s', async (stage) => { await exercise(backend, 'company', stage) })
})

async function exercise(backend: string, scenario: string, crash?: string, format = 'json'): Promise<void> {
  const temp = resolve('.local/world-director-mvp/tmp')
  await mkdir(temp, { recursive: true })
  const root = await mkdtemp(resolve(temp, 'world-original-product-'))
  const fixture = resolve('examples/simulation-company/tests/world-product-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/world-product/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
      WORLD_RESOLUTION: 'apply', WORLD_INPUT_FORMAT: format, TMPDIR: temp } })
  const children = new Set<ChildProcess>()
  onTestFinished(async () => { await Promise.all([...children].map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited
  })) })
  const start = (recover: boolean, stage?: string) => {
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
      WORLD_PRODUCT_RECOVER: String(recover), WORLD_PRODUCT_CRASH: stage ?? '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    children.add(child); child.once('exit', () => { children.delete(child) })
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
      expect(JSON.parse(last.output())).toEqual({ scenario, originalCommand: true, originalAllocation: true, identitiesPreserved: true,
        phase: 'paused', originalDefinition: true, modelCalls: 0, originalQuery: 'completed', portableExport: true })
    } finally { last.child.kill('SIGKILL'); await last.exited }
  } finally { await rm(root, { recursive: true, force: true }) }
}
