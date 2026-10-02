/** A second real Loader process observes a held Simulation owner without takeover or inference. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import type { SimulationRunObservation } from '@clocky/clocky-simulation'

it.each(['json', 'sqlite'] as const)('observes an owned and subsequently released run through the real Loader (%s)', async (backend) => {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'simulation-readonly-example-'))
  const fixture = resolve('packages/simulation/simulation-local/tests/fixtures/loader.ts')
  const config = resolve('examples/headless-agent/tests/fixtures/simulation/simulation-local/cordis.yml')
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [config], env: { SIMULATION_TEST_ROOT: root, SIMULATION_TEST_BACKEND: backend } })
  const environment = { ...process.env, ...launch.env }
  const writer = spawn(launch.command, [...launch.args, 'create', 'hold'], { env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const exit = once(writer, 'exit')
  let writerOutput = ''
  let writerErrors = ''
  if (writer.stdout === null || writer.stderr === null) throw new Error('Readonly example requires configured writer output pipes')
  writer.stdout.on('data', (data: Buffer) => { writerOutput += data.toString() })
  writer.stderr.on('data', (data: Buffer) => { writerErrors += data.toString() })
  const inspect = async (): Promise<SimulationRunObservation> => {
    const reader = spawn(launch.command, [...launch.args, 'inspect'], { env: environment, stdio: 'pipe' })
    let output = ''
    let errors = ''
    reader.stdout.on('data', (data: Buffer) => { output += data.toString() })
    reader.stderr.on('data', (data: Buffer) => { errors += data.toString() })
    const [code] = await once(reader, 'exit') as [number | null, NodeJS.Signals | null]
    expect(code, errors).toBe(0)
    return JSON.parse(output) as SimulationRunObservation
  }
  try {
    expect(await Promise.race([once(writer, 'message'), exit.then(() => { throw new Error(writerErrors || 'Writer exited before ownership') })]))
      .toEqual(['durable', undefined])
    const active = await inspect()
    expect(active.snapshot).toEqual(JSON.parse(writerOutput))
    expect({ owner: active.owner, phase: active.snapshot.phase, revision: active.snapshot.revision,
      time: active.snapshot.time, entities: Object.keys(active.snapshot.entities).sort() }).toMatchInlineSnapshot(`
      {
        "entities": [
          "buyer",
          "warehouse",
        ],
        "owner": "other-owner",
        "phase": "running",
        "revision": 4,
        "time": "0",
      }
    `)
    writer.send('release')
    expect((await exit)[0], writerErrors).toBe(0)
    const released = await inspect()
    expect(released).toEqual({ snapshot: active.snapshot, owner: 'unowned' })
  } finally {
    if (writer.exitCode === null && writer.signalCode === null) { writer.kill('SIGTERM'); await exit }
    await rm(root, { recursive: true, force: true })
  }
})
