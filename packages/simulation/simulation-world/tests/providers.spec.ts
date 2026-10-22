/** Real Native/Team checkpoint restoration checks provider admission before writable ownership. */
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { SimulationWorldDomainRegistry, simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simulationWorldDomainPinSchema } from '@clocky/clocky-simulation'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { simulationTemp } from '../../simulation-local/tests/temp.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import SimulationWorldExecutions, { builtinWorldExecutionProviders } from '../src/providers.ts'
import type { WorldExecutionProvider } from '../src/providers.ts'
import { SimulationWorldDriver } from '../src/driver.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })

async function fixture(backend: 'json' | 'sqlite') {
  const compiled = await compileWorldScenarioV1(sample, deployment)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const root = await simulationTemp('world-providers'), h = await createContext(root, backend)
  await h.ctx.plugin(Direct)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
    spec: { runId: 'world-providers', ...compiled.resolved.native } })
  const run = await h.ctx.simulations.open(selection)
  const request = { id: simulationCheckpointIdSchema.parse('original'), implementationVersion: 'world/1', maxAttempts: 3 }
  await prepareSimulationWorld(h.ctx.simulationTeams, run, { resolved: compiled.resolved, ownerName: 'world-providers/original',
    checkpoint: { id: request.id, maxDrainRounds: 4, maxAttempts: 3 } })
  const original = run.snapshot(), required = original.world!.definition.operations[0]!
  await run.close()
  cleanups.push(async () => { await h.ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const inspection = { provider: selection.provider, spec: selection.spec }
  const restoreSelection = { ...selection, mode: 'open' as const }
  const restore = () => h.ctx.simulationTeams.restore(restoreSelection, request)
  const originalOpen = h.ctx.simulations.open.bind(h.ctx.simulations)
  const open = vi.spyOn(h.ctx.simulations, 'open'), attach = vi.spyOn(h.ctx.simulationTeams, 'attach'), models = vi.spyOn(h.ctx.llm, 'stream')
  return { ...h, original, required, inspection, restoreSelection, request, restore, open, originalOpen, attach, models,
    resolved: compiled.resolved }
}

describe.each(['json', 'sqlite'] as const)('%s execution provider restoration', (backend) => {
  it.each(['absent', 'missing', 'schema', 'artifact', 'generation', 'parser', 'closed'] as const)(
    'refuses %s execution capability before writable open and leaves the original journal unchanged', async (variant) => {
      const h = await fixture(backend), catalog = new SimulationWorldDomainRegistry<WorldExecutionProvider>()
      const closers: Array<() => Promise<void>> = []
      if (variant !== 'absent') {
        for (const entry of builtinWorldExecutionProviders) {
          const selected = entry.definition.domain === h.required.domain && entry.definition.operation === h.required.operation
            && entry.definition.version === h.required.version
          if (selected && variant === 'missing') continue
          const pin = simulationWorldDomainPinSchema.parse({ ...h.required,
            schemaRef: selected && variant === 'schema' ? 'other/schema' : h.required.schemaRef,
            implementationRef: selected && variant === 'artifact' ? 'other/artifact' : h.required.implementationRef,
            generation: selected && variant === 'generation' ? 2 : h.required.generation })
          const definition = selected ? { ...entry.definition, schemaRef: pin.schemaRef,
            schemas: variant === 'parser' ? { ...entry.definition.schemas, request: entry.definition.schemas.request.refine(() => true) }
              : entry.definition.schemas } : entry.definition
          const dispose = catalog.register(definition, selected ? { ...entry, definition,
            ref: pin.implementationRef, generation: pin.generation } : entry)
          closers.push(dispose)
          if (selected && variant === 'closed') await dispose()
        }
        const remove = h.ctx.simulationTeams.registerWorldExecutionCatalog(catalog)
        cleanups.push(async () => { remove(); await Promise.all(closers.map(close => close())) })
      }
      await expect(h.restore()).rejects.toMatchObject({ code: variant === 'absent' || variant === 'closed'
        ? 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' : variant === 'missing' ? 'SIM_WORLD_OPERATION_UNKNOWN' : 'SIM_WORLD_IMPLEMENTATION_MISMATCH' })
      expect(h.open).not.toHaveBeenCalled(); expect(h.attach).not.toHaveBeenCalled(); expect(h.models).not.toHaveBeenCalled()
      expect((await h.ctx.simulations.inspect(h.inspection))!.snapshot).toEqual(h.original)
    })

  it('rechecks the current execution generation after exclusive open and refuses retirement before any phase or Team movement', async () => {
    const h = await fixture(backend), catalog = new SimulationWorldDomainRegistry<WorldExecutionProvider>()
    const disposers = builtinWorldExecutionProviders.map(entry => catalog.register(entry.definition, entry))
    const remove = h.ctx.simulationTeams.registerWorldExecutionCatalog(catalog)
    cleanups.push(async () => { remove(); await Promise.all(disposers.map(close => close())) })
    const open = h.open.mockImplementationOnce(async (selection) => {
      const run = await h.originalOpen(selection)
      for (const dispose of disposers) void dispose()
      return run
    })
    await expect(h.restore()).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' })
    expect(open).toHaveBeenCalledTimes(1); expect(h.attach).not.toHaveBeenCalled(); expect(h.models).not.toHaveBeenCalled()
    expect((await h.ctx.simulations.inspect(h.inspection))!.snapshot).toEqual(h.original)
  })

  it('restores exact providers paused without callbacks and refuses a driver with missing handlers', async () => {
    const h = await fixture(backend), fiber = h.ctx.plugin(SimulationWorldExecutions)
    await fiber
    const restored = await h.restore()
    cleanups.push(() => restored.run.close())
    expect(restored.run.snapshot()).toEqual(h.original); expect(h.models).not.toHaveBeenCalled()
    const ownerName = restored.run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']
    if (typeof ownerName !== 'string') throw new Error('Canonical owner is absent')
    const anchor = { checkpointId: h.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }, lifetime = new AbortController().signal
    expect(() => new SimulationWorldDriver(restored.run, restored.connection, h.resolved, anchor, lifetime, h.ctx, []))
      .toThrow(/not installed|unknown/i)
    const driver = new SimulationWorldDriver(restored.run, restored.connection, h.resolved, anchor, lifetime, h.ctx,
      h.ctx.simulationWorldExecutions.handlers({
        run: restored.run,
        connection: restored.connection,
        resolved: h.resolved,
        anchor,
        lifetime,
      }))
    expect((await driver.advance()).reason).toBe('paused'); expect(h.models).not.toHaveBeenCalled()
    await restored.run.close()
    await fiber.dispose()
    h.open.mockClear()
    await expect(h.restore()).rejects.toMatchObject({ code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' })
    expect(h.open).not.toHaveBeenCalled()
  })
})
