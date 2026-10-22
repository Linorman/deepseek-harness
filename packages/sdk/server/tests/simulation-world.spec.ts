import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { dispatchSimulation } from '../src/simulation.ts'
import type { SimulationAdministration, SimulationProducts } from '@clocky/clocky-simulation-product'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'

const definition: unknown = JSON.parse(await readFile(resolve('examples/simulation-company/scenarios/world-company.json'), 'utf8'))
const v1Definition: unknown = JSON.parse(await readFile('packages/sdk/protocol/tests/fixtures/world-v1-definition.json', 'utf8'))
const directorDefinition: unknown = JSON.parse(await readFile('packages/sdk/protocol/tests/fixtures/world-director-event-definition.json', 'utf8'))
const call = { principal: { id: 'sdk-world-reader', issuer: 'test', subject: 'reader', assurance: 'test', credentialGeneration: 1 },
  credentialGeneration: 1, signal: new AbortController().signal } as AuthenticatedProductCall
const cases = [
  ['world-preflight', 'preflightWorld', { definition }],
  ['world-create', 'createWorld', { definition, commandId: 'original', name: 'World', preflight: {
    hash: `sha256:${'1'.repeat(64)}`, catalogGeneration: '1' } }],
  ['world-prepare', 'prepareWorld', { runId: 'world', commandId: 'original' }],
  ['world-export', 'exportWorldDefinition', { runId: 'world' }],
  ['world-cases-list', 'listWorldCases', { runId: 'world' }],
  ['world-case-inspect', 'inspectWorldCase', { runId: 'world', requestId: 'case', section: 'execution' }],
  ['world-case-cancel', 'cancelWorldCase', { runId: 'world', requestId: 'case', commandId: 'original', previewRevision: 3, previewHash: `sha256:${'a'.repeat(64)}` }],
  ['world-preflight', 'preflightWorld', { definition: v1Definition }],
  ['world-create', 'createWorld', { definition: v1Definition, commandId: 'original', name: 'World', preflight: {
    hash: `sha256:${'1'.repeat(64)}`, catalogGeneration: '1' } }],
  ['world-preflight', 'preflightWorld', { definition: directorDefinition }],
  ['world-branch', 'branchWorld', { source: { runId: 'parent', archiveCommandId: 'archive' },
    commandId: '11111111-1111-4111-8111-111111111111', name: 'Branch', memoryPolicy: 'public-facts' }],
  ['world-branch-read', 'readWorldBranch', { commandId: '11111111-1111-4111-8111-111111111111' }],
  ['world-causal', 'queryWorldCausal', { source: { runId: 'parent', archiveCommandId: 'archive' },
    root: 'event:1', maxDepth: 2, maxNodes: 10, maxBytes: 4096 }],
  ['world-compare', 'compareWorlds', { left: { runId: 'parent', archiveCommandId: 'archive' },
    right: { runId: 'sibling', archiveCommandId: 'archive-sibling' } }],
] as const

it.each(cases)('parses %s before optional owner lookup and preserves authenticated original parameters', async (method, owner, input) => {
  const ctx = new Context(), operation = vi.fn(async () => ({ original: 'marker' }))
  try {
    await expect(dispatchSimulation(ctx, `simulation/${method}`, { ...input, actor: 'forged' }, call)).rejects.toMatchObject({ code: -32602 })
    if (method === 'world-case-inspect' || method === 'world-cases-list') {
      ctx.provide('simulationProducts', { [owner]: operation } as unknown as SimulationProducts)
    } else {
      ctx.provide('simulationAdministration', { [owner]: operation } as unknown as SimulationAdministration)
    }
    expect(await dispatchSimulation(ctx, `simulation/${method}`, input, call)).toEqual({ original: 'marker' })
    expect(operation).toHaveBeenCalledWith(input, call)
  } finally { await ctx.fiber.dispose() }
})
