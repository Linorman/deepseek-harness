/** Real SDK stdio creates, inspects, cancels and cold-restores both World scenarios without a second owner or generation. */
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { execa } from 'execa'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { HarnessClient, SdkProtocolError } from '@clocky/clocky-sdk-client'
import { simulationWorldPreflightParamsSchema } from '@clocky/clocky-sdk-protocol'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'

describe.each(['json', 'sqlite'])('%s World TypeScript SDK', (backend) => {
  it.each(['company', 'laboratory'])('preserves %s original commands, case sections and explicit cold restore', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const artifacts = resolve('.local/world-completion/u13-sdk')
    await mkdir(artifacts, { recursive: true })
    const root = await mkdtemp(resolve(artifacts, `${process.env.CLOCKY_EXAMPLE_MODE ?? 'src'}-${backend}-${scenario}-legacy-ts-`))
    const installed = catalog()
    installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
    const launch = resolveExampleLaunch({ srcBin: resolve('packages/examples/jsonrpc-demo/src/bin.ts'),
      libBin: resolve('packages/examples/jsonrpc-demo/lib/bin.js'), tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/sdk-world-management/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend,
        SDK_WORLD_PRODUCT_CONFIGURATION: JSON.stringify({ provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } }),
        TMPDIR: temp } })
    if (process.env.CLOCKY_EXAMPLE_MODE === 'lib') {
      const result = await execa(process.execPath, [resolve('examples/simulation-company/tests/sdk-world-built-client.mjs')], {
        env: { ...process.env, ...launch.env, WORLD_SCENARIO: scenario, SDK_WORLD_LAUNCH: JSON.stringify(launch) },
        timeout: 60000, reject: false })
      await writeFile(resolve(root, 'stdout.log'), result.stdout + '\n')
      await writeFile(resolve(root, 'stderr.log'), result.stderr + '\n')
      expect(result.exitCode, `${root}\n${result.stderr}`).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ scenario, builtClient: true, modelCalls: 18, coldModelCalls: 0,
        originalCommands: true, caseSections: 4, cancellation: 'blocked-terminal', unknownRequiredRejected: true, unknownStopRejected: true })
      return
    }
    const wire: unknown[] = [], pids: number[] = []
    const open = () => {
      const client = new HarnessClient({ command: launch.command, args: launch.args,
        env: { ...process.env as Record<string, string>, ...launch.env }, requestTimeoutMs: 30000 })
      const request = client.request.bind(client)
      client.request = async (method, params, options) => {
        const result = await request(method, params, options)
        if (method.startsWith('simulation/')) wire.push({ pid: client.pid, method, params, result })
        return result
      }
      return client
    }
    let sdk = open()
    const initialize = async () => {
      await sdk.initialize({ credential: 'sdk-company-test-credential', cwd: process.cwd(),
        provider: 'world-driver-scripted', model: 'scripted' })
      if (sdk.pid === undefined) throw new Error('World SDK process has no original identity')
      pids.push(sdk.pid)
    }
    const wait = async <T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> => {
      for (let round = 0; round < 2000; round++) {
        const value = await read()
        if (ready(value)) return value
        await new Promise(done => setTimeout(done, 5))
      }
      throw new Error('Original World SDK operation did not settle')
    }
    const settled = (commandId: string) => wait(() => sdk.getSimulationRequest({ commandId }),
      value => value.status === 'found' && value.request.status !== 'accepted')
    const calls = async () => z.strictObject({ calls: z.number().int().nonnegative() })
      .parse(JSON.parse(await readFile(resolve(root, 'sdk-world-model-count.json'), 'utf8'))).calls
    try {
      await initialize()
      const source: unknown = JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8'))
      const draft = simulationWorldPreflightParamsSchema.parse({ definition: source })
      const preview = await sdk.preflightSimulationWorld(draft)
      expect(preview.status).toBe('ready')
      if (preview.status !== 'ready') throw new Error('World SDK preflight rejected its installed scenario')
      expect(await calls()).toBe(0)
      const input = { commandId: 'sdk-world-create', name: 'SDK World', definition: draft.definition,
        preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } }
      const created = await sdk.createSimulationWorld(input), runId = created.runId
      expect((await settled(input.commandId)).status).toBe('found')
      expect((await sdk.createSimulationWorld(input)).runId).toBe(runId)
      const prepared = { runId, commandId: 'sdk-world-prepare' }
      await sdk.prepareSimulationWorld(prepared)
      expect((await settled(prepared.commandId)).status).toBe('found')
      expect((await sdk.getSimulationControl({ runId })).phase).toBe('paused')
      expect(await calls()).toBe(0)
      const exported = await sdk.exportSimulationWorldDefinition({ runId })
      expect(exported.definition).toEqual(draft.definition)
      expect((await sdk.preflightSimulationWorld({ definition: exported.definition })).status).toBe('ready')
      expect(await calls()).toBe(0)
      const start = { runId, managementId: 'sdk-world-start', phase: 'running' as const }
      await sdk.manageSimulation(start)
      await wait(() => sdk.getSimulationControl({ runId }), value => value.stop === 'idle' && !value.inFlight)
      expect(await calls()).toBe(18)
      const page = await sdk.listSimulationWorldCases({ runId, limit: 1 })
      expect(page.total).toBe(1)
      const original = page.items[0]!
      expect(original.status).toBe('committed')
      const sections = []
      for (const section of ['request', 'plans', 'execution', 'notification'] as const) {
        sections.push(await sdk.inspectSimulationWorldCase({ runId, requestId: original.requestId, section }))
      }
      expect(sections.every(value => value.status === 'found')).toBe(true)
      const cancel = { runId, requestId: original.requestId, commandId: 'sdk-world-original-cancel' }
      expect(original.cancel).toEqual({ allowed: false, reason: 'terminal' })
      await expect(sdk.cancelSimulationWorldCase(cancel as never)).rejects.toBeInstanceOf(SdkProtocolError)
      expect(await sdk.getSimulationRequest({ commandId: cancel.commandId })).toEqual({ status: 'not-found', commandId: cancel.commandId })
      expect((await sdk.listSimulationWorldCases({ runId })).items[0]?.status).toBe('committed')
      expect(await calls()).toBe(18)
      await sdk.manageSimulation({ runId, managementId: 'sdk-world-pause', phase: 'paused' })
      const checkpoint = { runId, commandId: 'sdk-world-checkpoint' }
      await sdk.checkpointSimulation(checkpoint)
      const completed = await settled(checkpoint.commandId)
      if (completed.status !== 'found' || completed.request.status !== 'completed' || completed.request.checkpointId === undefined) {
        throw new Error('World SDK checkpoint did not complete')
      }
      const checkpointId = completed.request.checkpointId
      await sdk.close()
      sdk = open()
      await initialize()
      expect((await sdk.getSimulationControl({ runId })).owner).toBe('not-held')
      expect(await calls()).toBe(0)
      await sdk.restoreSimulation({ runId, commandId: 'sdk-world-restore', checkpointId })
      const restored = await settled('sdk-world-restore')
      expect(restored.status === 'found' && restored.request.status).toBe('completed')
      expect((await sdk.getSimulationControl({ runId })).phase).toBe('paused')
      const repeated = await sdk.manageSimulation(start)
      expect(repeated.control.phase).toBe('paused')
      expect((await sdk.createSimulationWorld(input)).runId).toBe(runId)
      expect((await sdk.prepareSimulationWorld(prepared)).status).toBe('completed')
      await expect(sdk.cancelSimulationWorldCase(cancel as never)).rejects.toBeInstanceOf(SdkProtocolError)
      expect(await sdk.getSimulationRequest({ commandId: cancel.commandId })).toEqual({ status: 'not-found', commandId: cancel.commandId })
      expect((await sdk.exportSimulationWorldDefinition({ runId })).definition).toEqual(exported.definition)
      expect((await sdk.listSimulationWorldCases({ runId })).items).toEqual(page.items)
      for (const [index, section] of (['request', 'plans', 'execution', 'notification'] as const).entries()) {
        const read = await sdk.inspectSimulationWorldCase({ runId, requestId: original.requestId, section })
        expect(read.value).toEqual(sections[index]!.value)
      }
      expect(await calls()).toBe(0)
      expect(new Set(pids).size).toBe(2)
      await writeFile(resolve(root, 'proof.json'), JSON.stringify({ scenario, mode: 'src', language: 'typescript', backend,
        pids, modelCalls: 18, coldModelCalls: 0, originalCommands: true, caseSections: 4, cancellation: 'blocked-terminal' }, null, 2) + '\n')
    } finally {
      await sdk.close()
      await writeFile(resolve(root, 'wire.json'), JSON.stringify(wire, null, 2) + '\n')
    }
  })
})
