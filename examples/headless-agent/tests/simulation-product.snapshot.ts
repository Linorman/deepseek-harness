/** A credential-authenticated Host reads durable product registration while another Loader owns the run. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { registration } from '../../../packages/simulation/simulation-product/tests/fixtures.ts'
import type { SimulationProductRunInspection, SimulationProductRunPage, SimulationProductCollectionPage,
  SimulationProductObjectInspection, SimulationProductRecordsPage } from '@clocky/clocky-simulation-product'

interface Output {
  records: { ok: true; value: SimulationProductRecordsPage }
  first: { ok: true; value: SimulationProductRunPage }
  inspect: { ok: true; value: SimulationProductRunInspection }
  privateRun: { ok: false; error: { code: string } }
  missing: { ok: false; error: { code: string } }
  entities: { ok: true; value: SimulationProductCollectionPage }
  decisions: { ok: true; value: SimulationProductCollectionPage }
  operations: { ok: true; value: SimulationProductCollectionPage }
  checkpoints: { ok: true; value: SimulationProductCollectionPage }
  detail: { ok: true; value: SimulationProductObjectInspection }
}

it.each(['json', 'sqlite'] as const)('reads safe product metadata and running history without takeover or inference (%s)', async (backend) => {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'simulation-product-example-'))
  const directory = join(root, 'directory')
  await mkdir(directory)
  await writeFile(join(directory, 'principal.json'), JSON.stringify({ version: 1, principalId: 'reader', credentialGeneration: 1,
    credentialDigest: createHash('sha256').update('keyless-fixture-credential').digest('hex') }), { mode: 0o600 })
  const imported = registration()
  const fixture = resolve('packages/simulation/simulation-product/tests/fixtures/loader.ts')
  const env = { SIMULATION_TEST_ROOT: join(root, 'world'), SIMULATION_TEST_BACKEND: backend,
    SIMULATION_PRODUCT_DIRECTORY: directory, SIMULATION_PRODUCT_SPEC: JSON.stringify(imported.spec),
    SIMULATION_PRODUCT_IMPORTS: JSON.stringify([imported, registration('private-run', 'other')]) }
  const launch = (config: string) => resolveExampleLaunch({ srcBin: fixture, libBin: fixture,
    tsconfigPath: resolve('tsconfig.base.json'), configArgs: [resolve(config)], env })
  const seed = launch('examples/headless-agent/tests/fixtures/simulation/simulation-local/cordis.yml')
  const writer = spawn(seed.command, [...seed.args, 'seed'], { env: { ...process.env, ...seed.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const exit = once(writer, 'exit')
  let writerOutput = ''
  let writerErrors = ''
  writer.stdout!.on('data', (data: Buffer) => { writerOutput += data.toString() })
  writer.stderr!.on('data', (data: Buffer) => { writerErrors += data.toString() })
  const inspect = async (): Promise<Output> => {
    const command = launch('examples/headless-agent/tests/fixtures/simulation/simulation-product/cordis.yml')
    const reader = spawn(command.command, [...command.args, 'read'], { env: { ...process.env, ...command.env }, stdio: 'pipe' })
    let output = ''
    let errors = ''
    reader.stdout.on('data', (data: Buffer) => { output += data.toString() })
    reader.stderr.on('data', (data: Buffer) => { errors += data.toString() })
    const [code] = await once(reader, 'exit') as [number | null, NodeJS.Signals | null]
    expect(code, errors).toBe(0)
    expect(output).not.toContain('not-public')
    expect(output).not.toContain(root)
    expect(output).not.toContain('ownerPrincipalId')
    return JSON.parse(output) as Output
  }
  try {
    expect(await Promise.race([once(writer, 'message'), exit.then(() => { throw new Error(writerErrors || 'Writer exited before ownership') })]))
      .toEqual(['durable', undefined])
    const owned = await inspect()
    for (const result of [owned.entities, owned.decisions, owned.operations, owned.checkpoints, owned.detail]) expect(result.ok).toBe(true)
    expect(owned.records.ok).toBe(true)
    expect(owned.records.value).toMatchObject({ bodyAccess: 'withheld', totalRecords: 2,
      items: [{ body: { status: 'withheld' }, kind: { text: 'run/change' } }] })
    expect(owned.records.value.nextCursor).toBeDefined()
    expect(owned.entities.value.total).toBe(2)
    expect(owned.decisions.value.items).toMatchObject([{ id: 'source-decision', status: 'accepted', time: '9007199254740993', operationCount: 1 }])
    expect(owned.operations.value.items).toMatchObject([{ status: 'applied', publication: 'not-applicable', delivery: 'not-applicable', task: 'not-applicable' }])
    expect(owned.checkpoints.value).toMatchObject({ total: 0, items: [] })
    expect(owned.detail.value).toMatchObject({ status: 'found', value: { collection: 'decisions', section: 'execution', context: { status: 'absent' } } })
    expect(owned.privateRun).toEqual(owned.missing)
    expect(owned.inspect.value.world).toMatchObject({ owner: 'other-owner', phase: 'running', time: '9007199254740993' })
    expect({ listing: owned.first.value.items.map(row => ({ id: row.id, name: row.name })),
      world: { ...owned.inspect.value.world, observedAt: undefined }, refused: owned.privateRun.error.code }).toMatchInlineSnapshot(`
        {
          "listing": [
            {
              "id": "public-run",
              "name": {
                "text": "Registered simulation",
                "truncated": false,
              },
            },
          ],
          "refused": "simulation-product-forbidden",
          "world": {
            "decisionCount": 1,
            "entityCount": 2,
            "metrics": {
              "budgets": {
                "decisions": {
                  "limit": 1000,
                  "used": 1,
                },
                "interval": "9007199254740900",
                "messages": {
                  "limit": 1000,
                  "used": 0,
                },
                "tokens": {
                  "charged": 0,
                  "limit": 1000000,
                  "unknownAttempts": 0,
                },
                "width": "100",
              },
              "pendingDecisionCount": 0,
              "pendingExternalOperationCount": 0,
              "residentSlots": {
                "limit": 16,
                "recoveryRequired": 0,
                "used": 0,
              },
              "unknownOperationCount": 0,
            },
            "observedAt": undefined,
            "operationCount": 1,
            "owner": "other-owner",
            "phase": "running",
            "policyVersion": {
              "text": "1",
              "truncated": false,
            },
            "revision": 15,
            "rulesVersion": {
              "text": "1",
              "truncated": false,
            },
            "tickUnit": {
              "text": "minute",
              "truncated": false,
            },
            "time": "9007199254740993",
          },
        }
      `)
    writer.send('release')
    expect((await exit)[0], writerErrors).toBe(0)
    const released = await inspect()
    expect(released.first).toEqual(owned.first)
    const history = JSON.parse(writerOutput) as { revision: number; phase: string; time: string }
    expect(released.inspect.value.world).toMatchObject({ revision: history.revision, phase: history.phase, time: history.time, owner: 'unowned' })
  } finally {
    if (writer.exitCode === null && writer.signalCode === null) { writer.kill('SIGTERM'); await exit }
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
