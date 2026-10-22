/** Real paused Native World prefixes own domain reads, authenticated cursors and independently granted bodies. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationChangeSchema } from '@clocky/clocky-simulation'
import { WORLD_EXTERNAL_INTERACT_PIN } from '@clocky/clocky-simulation'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { prepareSimulationWorld } from '../src/world-preparation.ts'
import Products from '../src/index.ts'
import { matchesWorldDomainSelection, simulationProductWorldDomainInputSchema,
  simulationProductWorldDomainResultSchema } from '../src/world-read-schema.ts'
import { registration, call } from './fixtures.ts'

const canary = 'PRIVATE-WORLD-DOMAIN-NORM-CANARY'
const closes: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of closes.splice(0).reverse()) await close() })
async function fixture(backend: 'json' | 'sqlite', options: { maxBytes?: number; normCount?: number } = {}) {
  const definition = structuredClone(sample), scope = definition.organization.rootId
  const normIds = options.normCount === undefined ? ['first', 'second']
    : Array.from({ length: options.normCount }, (_, index) => `norm-${index}`)
  definition.governance.norms = normIds.map(id => ({ id, scopeId: scope, body: `${canary}-${id}`, effectiveFrom: '0',
    effectiveUntil: null, availableAt: '0', audience: { kind: 'public' as const }, enforcement: { kind: 'advisory' as const } }))
  definition.entities.push(...['vendor-one', 'vendor-two'].map(id => ({ id, name: id, description: `Private ${id}`,
    kind: 'organization' as const, cognition: 'none' as const })))
  definition.externalWorld.identities = ['vendor-one', 'vendor-two'].map(subjectId => ({ scopeId: scope, externalKey: subjectId,
    subjectId, representation: 'simulated-rule' as const }))
  definition.domains.push({ domain: WORLD_EXTERNAL_INTERACT_PIN.domain, operation: WORLD_EXTERNAL_INTERACT_PIN.operation,
    version: WORLD_EXTERNAL_INTERACT_PIN.version })
  const compiled = await compileWorldScenarioV1(definition, { ...deployment, domains: [...deployment.domains,
    { pin: WORLD_EXTERNAL_INTERACT_PIN, available: true }] })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const temporary = resolve('.local/world-completion/u05-u06-domain/tmp')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(resolve(temporary, 'world-domain-read-')), h = await createContext(root, backend)
  await h.ctx.plugin(Direct)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: { runId: 'domain-read',
    ...compiled.resolved.native } })
  const run = await h.ctx.simulations.open(selection)
  closes.push(async () => { await run.close(); await h.ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await prepareSimulationWorld(h.ctx.simulationTeams, run, { resolved: compiled.resolved, ownerName: 'world/domain-read',
    checkpoint: { id: simulationCheckpointIdSchema.parse('domain-read-checkpoint'), maxDrainRounds: 4, maxAttempts: 3 } })
  const registered = { ...registration('domain-read-product'), spec: selection.spec }
  await h.ctx.plugin(Products, { directoryStream: 'domain-read-directory', imports: [registered],
    ...options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes } })
  return { ...h, run, products: h.ctx.simulationProducts, runId: registered.id }
}

describe.each(['json', 'sqlite'] as const)('%s World domain original readers', (backend) => {
  it('reads all nine families from one actual paused prefix without opening or attaching execution', async () => {
    const h = await fixture(backend), before = h.run.snapshot(), state = before.world!
    const open = vi.spyOn(h.ctx.simulations, 'open'), attach = vi.spyOn(h.ctx.simulationTeams, 'attach')
    const person = Object.values(before.entities).find(value => value.kind === 'person')!
    const norm = Object.values(state.norms.versions).flat()[0]!, identity = Object.values(state.external.identities)[0]!
    const inputs = [
      { kind: 'overview' }, { kind: 'organization', lens: 'structure' }, { kind: 'person', personId: person.id, section: 'identity' },
      { kind: 'governance', lens: 'norms' }, { kind: 'proposal', proposalId: 'absent-original', section: 'record' },
      { kind: 'norm', versionId: JSON.stringify([norm.id, norm.version]) }, { kind: 'external' },
      { kind: 'identity', key: identity.id, section: 'record' }, { kind: 'case-extensions', requestIds: ['absent-original'] },
    ]
    const originals: unknown[] = []
    for (const selector of inputs) {
      const input = simulationProductWorldDomainInputSchema.parse({ ...selector, runId: h.runId })
      const result = await h.products.readWorldDomain(input, call())
      originals.push(result)
      expect(matchesWorldDomainSelection(input, result)).toBe(true)
      expect(result.snapshotRevision).toBe(before.revision)
      expect(result.coverage.at).toBe(before.time)
      expect(result.status).toBe(selector.kind === 'proposal' ? 'missing' : 'found')
      expect(JSON.stringify(result)).not.toContain(canary)
      expect(simulationProductWorldDomainResultSchema.safeParse({ ...result, rawNative: before }).success).toBe(false)
    }
    await writeFile(resolve('.local/world-completion/u05-u06-domain', `${backend}-host-originals.json`),
      JSON.stringify(originals, null, 2) + '\n')
    const obligations = await h.products.readWorldDomain({ runId: h.runId, kind: 'person', personId: person.id,
      section: 'obligations' }, call())
    expect(obligations.coverage).toMatchObject({ complete: true })
    expect(obligations.coverage.reason).toBeUndefined()
    expect(h.run.snapshot()).toEqual(before)
    expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled()
    const inspection = await h.products.inspect({ runId: h.runId }, call())
    expect(inspection).toMatchObject({ status: 'observed', world: { worldInitialized: true },
      operational: { status: 'unavailable', scenario: { status: 'unavailable' } } })
    await h.run.close()
    const cold = await h.products.inspect({ runId: h.runId }, call())
    expect(cold).toMatchObject({ status: 'observed', world: { worldInitialized: true, owner: 'unowned' },
      operational: { status: 'unavailable', scenario: { status: 'unavailable' } } })
    expect(h.run.snapshot()).toEqual(before)
    expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled()
    expect(h.ctx.simulationTeams.modelUsage().active).toBe(0)
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
  })
  it('binds bounded continuations to exact selectors, reader, policy lifetime and original revision', async () => {
    const h = await fixture(backend), input = { runId: h.runId, kind: 'governance', lens: 'history', limit: 1 } as const
    const first = await h.products.readWorldDomain(input, call()), cursor = first.coverage.nextCursor
    expect(cursor).toBeDefined(); expect(first.coverage).toMatchObject({ loaded: 1, total: 2, complete: false })
    const last = await h.products.readWorldDomain({ ...input, cursor: cursor!, expectedRevision: first.snapshotRevision,
      readVersion: first.readVersion }, call())
    expect(last.coverage).toMatchObject({ loaded: 1, total: 2, complete: false })
    expect(last.coverage.nextCursor).toBeUndefined()
    if (first.kind !== 'governance' || last.kind !== 'governance') throw new Error('Original governance window absent')
    expect(first.value!.norms[0]!.id).not.toBe(last.value!.norms[0]!.id)
    expect(matchesWorldDomainSelection({ ...input, at: undefined }, first)).toBe(true)
    for (const changed of [{ ...input, lens: 'norms' as const }, { ...input, limit: 2 }, { ...input, at: '0' }])
      await expect(h.products.readWorldDomain({ ...changed, cursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    await expect(h.products.readWorldDomain({ ...input, cursor }, call(new AbortController(), 'outsider')))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    const principal = call(); const nextGeneration = { ...principal, principal: { ...principal.principal,
      credentialGeneration: 2 }, credentialGeneration: 2 }
    await expect(h.products.readWorldDomain({ ...input, cursor },
      nextGeneration)).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    const revoke = h.products.contextReaderRegistrar()([{ principalId: principal.principal.id, runId: h.runId,
      entityIds: [h.run.snapshot().world!.definition.organizationEntityId], content: ['knowledge'] }])
    await expect(h.products.readWorldDomain({ ...input, cursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    revoke()
    const fresh = await h.products.readWorldDomain(input, call()), entity = Object.values(h.run.snapshot().entities)[0]!
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: entity.id, entityRevision: entity.revision,
      phase: 'inactive' }), h.run.snapshot().revision)
    await expect(h.products.readWorldDomain({ ...input, cursor: fresh.coverage.nextCursor },
      call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  })
  it('shrinks complete domain replies by bytes and retains every original across continuations', async () => {
    const maxBytes = 5000, h = await fixture(backend, { maxBytes, normCount: 20 })
    const input = { runId: h.runId, kind: 'governance', lens: 'history' } as const
    const expected = Object.values(h.run.snapshot().world!.norms.versions).flat().map(value => JSON.stringify([value.id, value.version]))
    const seen: string[] = []
    let result = await h.products.readWorldDomain(input, call()), pages = 0
    expect(result.coverage.nextCursor).toBeDefined()
    do {
      pages++
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(maxBytes)
      if (result.kind !== 'governance' || result.value === undefined) throw new Error('Original governance page absent')
      seen.push(...result.value.norms.map(value => value.id))
      const cursor = result.coverage.nextCursor
      if (cursor === undefined) break
      expect(pages).toBeLessThan(expected.length)
      result = await h.products.readWorldDomain({ ...input, cursor, expectedRevision: result.snapshotRevision,
        readVersion: result.readVersion }, call())
    } while (true)
    expect(pages).toBeGreaterThan(1)
    expect(seen).toEqual(expected)
    expect(new Set(seen).size).toBe(expected.length)
    expect(result.coverage).toMatchObject({ total: expected.length, complete: false })
  })
  it('refuses an indivisible domain row that exceeds the complete reply allowance', async () => {
    const h = await fixture(backend, { maxBytes: 500, normCount: 1 })
    await expect(h.products.readWorldDomain({ runId: h.runId, kind: 'governance', lens: 'history', limit: 1 }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  })
  it('withholds independently granted Norm bodies on a real final-publication policy revoke', async () => {
    const h = await fixture(backend), before = h.run.snapshot(), norm = Object.values(before.world!.norms.versions).flat()[0]!
    const input = { runId: h.runId, kind: 'norm', versionId: JSON.stringify([norm.id, norm.version]) } as const
    expect(JSON.stringify(await h.products.readWorldDomain(input, call()))).not.toContain(canary)
    const revoke = h.products.contextReaderRegistrar()([{ principalId: call().principal.id, runId: h.runId,
      entityIds: [norm.scope], content: ['knowledge'] }])
    try {
      expect(JSON.stringify(await h.products.readWorldDomain(input, call()))).toContain(canary)
      const parse = simulationProductWorldDomainResultSchema.parse.bind(simulationProductWorldDomainResultSchema)
      const spy = vi.spyOn(simulationProductWorldDomainResultSchema, 'parse').mockImplementationOnce((...args) => {
        const original = parse(...args); expect(JSON.stringify(original)).toContain(canary)
        queueMicrotask(revoke); return original
      })
      const retired = await h.products.readWorldDomain(input, call()); spy.mockRestore()
      expect(retired.value).toMatchObject({ body: { state: 'withheld' } })
      expect(JSON.stringify(retired)).not.toContain(canary)
      expect(h.run.snapshot()).toEqual(before)
    } finally { revoke() }
  })
  it('rejects schema-valid substituted originals and contradictory wrapper coverage', async () => {
    const h = await fixture(backend), person = Object.values(h.run.snapshot().entities).find(value => value.kind === 'person')!
    const result = await h.products.readWorldDomain({ runId: h.runId, kind: 'person', personId: person.id, section: 'identity' }, call())
    if (result.kind !== 'person' || result.value === undefined) throw new Error('Original person absent')
    expect(simulationProductWorldDomainResultSchema.safeParse({ ...result, value: { ...result.value,
      personId: 'substitution' } }).success).toBe(false)
    expect(simulationProductWorldDomainResultSchema.safeParse({ ...result, value: { ...result.value,
      runId: 'substitution' } }).success).toBe(false)
    const org = await h.products.readWorldDomain({ runId: h.runId, kind: 'organization', lens: 'structure' }, call())
    if (org.kind !== 'organization' || org.value === undefined) throw new Error('Original organization absent')
    expect(simulationProductWorldDomainResultSchema.safeParse({ ...org, value: { ...org.value, coverage: { ...org.coverage,
      scope: 'other' } } }).success).toBe(false)
  })
})
