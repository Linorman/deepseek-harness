/** Scenario objective diagnostics must precede original-command and Native/Team allocation. */
import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import Products from '../src/index.ts'
import Administration from '../src/administration.ts'
import { simulationProductWorldCreateInputSchema } from '../src/world-schema.ts'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import { companyFixture } from './company-driver-fixture.ts'
import { call } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('rejects a whitespace-only %s objective before accepting or allocating anything', async (backend) => {
  const h = await companyFixture(backend, false)
  try {
    await h.ctx.plugin(Products, { directoryStream: 'world-description-products' })
    const installed = catalog()
    installed.runtimeProfiles[0]!.model = { provider: 'company', name: 'scripted', version: '1', available: true }
    await h.ctx.plugin(Administration, { journalStream: 'world-description-commands', templates: [],
      world: { provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } } })
    const definition = worldScenarioSchema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8')))
    const administration = h.ctx.simulationAdministration
    const preview = await administration.preflightWorld({ definition }, call())
    if (preview.status !== 'ready') throw new Error(JSON.stringify(preview.diagnostics))
    definition.metadata.description = ' \t\n\u00a0\u3000'
    const input = simulationProductWorldCreateInputSchema.parse({ commandId: 'blank-description', name: 'Blank description', definition,
      preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } })
    const open = vi.spyOn(h.ctx.simulations, 'open'), createTeam = vi.spyOn(h.ctx.teams, 'createTeam')
    expect(await administration.preflightWorld({ definition }, call())).toEqual({ status: 'invalid', diagnostics: [{
      source: 'scenario', path: ['metadata', 'description'], code: 'invalid-shape',
      message: 'Scenario description must contain non-whitespace text',
    }] })
    await expect(administration.createWorld(input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_PREFLIGHT_CHANGED' })
    expect(await administration.request({ commandId: input.commandId }, call())).toEqual({ status: 'not-found', commandId: input.commandId })
    expect((await h.ctx.simulationProducts.list({}, call())).items).toEqual([])
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
    expect(h.requests).toEqual([])
    expect(open).not.toHaveBeenCalled()
    expect(createTeam).not.toHaveBeenCalled()
  } finally { vi.restoreAllMocks(); await h.close() }
})
