/** Real metadata owners enforce v1 routes, read lifetimes and unchanged native state before command allocation. */
import { afterEach, expect, it, vi } from 'vitest'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { companyFixture } from './company-driver-fixture.ts'
import { preflightSimulationWorld } from '../src/world-preflight.ts'

afterEach(() => { vi.restoreAllMocks() })
async function setup() {
  const h = await companyFixture('json', false), installed = structuredClone(deployment)
  installed.runtimeProfiles[0]!.model = { provider: 'company', name: 'scripted', version: '1', available: true }
  const preflight = (input: unknown = sample, signal = new AbortController().signal) =>
    preflightSimulationWorld(h.ctx, input, installed, signal, 'local')
  return { ...h, installed, preflight }
}

it('resolves actual v1 domain generations without opening a run, creating identities or invoking a model', async () => {
  const h = await setup()
  try {
    const before = h.run.snapshot(), open = vi.spyOn(h.ctx.simulations, 'open'), team = vi.spyOn(h.ctx.teams, 'createTeam')
    const invite = vi.spyOn(h.ctx.teams, 'inviteParticipant'), metadata = vi.spyOn(h.ctx.llm, 'resolveModelInfo')
    const result = await h.preflight()
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(open).not.toHaveBeenCalled(); expect(team).not.toHaveBeenCalled(); expect(invite).not.toHaveBeenCalled()
    expect(metadata).toHaveBeenCalledTimes(1)
    expect(h.run.snapshot()).toEqual(before)
    expect(h.requests).toEqual([])
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
  } finally { await h.close() }
})

it('retains declared Team defaults and ceilings independently of the actual owner observation', async () => {
  const h = await setup()
  try {
    const actual = h.ctx.teams.getCreationLimits()
    h.installed.limits.ceilings.team.maxParticipants = actual.maxParticipants + 1
    const original = structuredClone(h.installed)
    const result = await h.preflight()
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok || result.resolved.apiVersion !== 'clocky.world/v1') return
    expect(result.resolved.catalog).toEqual(original)
    expect(result.resolved.teamCeilings).toEqual(actual)
    expect(result.resolved.catalog.limits.ceilings.team.maxParticipants).toBe(actual.maxParticipants + 1)
    expect(result.resolved.limits.team.maxParticipants)
      .toBe(Math.min(original.limits.defaults.team.maxParticipants, actual.maxParticipants))
    expect(h.installed).toEqual(original)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['model', 'domain', 'malformed'] as const)('rejects %s before productive IO and exposes only field diagnostics', async (kind) => {
  const h = await setup()
  try {
    const before = h.run.snapshot(), metadata = vi.spyOn(h.ctx.llm, 'resolveModelInfo')
    if (kind === 'model') h.modelRegistration()
    if (kind === 'domain') h.installed.domains[0]!.pin.generation++
    const result = await h.preflight(kind === 'malformed' ? { ...sample, credential: 'private key' } : sample)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics.some(value => value.code === (kind === 'malformed' ? 'invalid-shape'
      : kind === 'domain' ? 'domain-unavailable' : 'model-unavailable'))).toBe(true)
    if (kind !== 'model') expect(metadata).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private key')
    expect(h.run.snapshot()).toEqual(before)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('rechecks domain acceptance after selected asynchronous metadata resolution', async () => {
  const h = await setup()
  try {
    const registry = h.ctx.simulations.domains('local'), pin = registry.pin.bind(registry)
    const lookup = vi.spyOn(registry, 'pin').mockImplementation(pin), resolve = h.ctx.llm.resolveModelInfo.bind(h.ctx.llm)
    vi.spyOn(h.ctx.llm, 'resolveModelInfo').mockImplementationOnce(async (...args) => {
      const result = await resolve(...args)
      lookup.mockImplementation(() => { throw new Error('Domain is no longer accepting') })
      return result
    })
    const result = await h.preflight()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics.some(value => value.code === 'domain-unavailable')).toBe(true)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['profile', 'template', 'domain', 'preset', 'capability'] as const)('rejects ambiguous or unpreparable installed %s metadata', async (kind) => {
  const installed = structuredClone(deployment)
  if (kind === 'profile') installed.runtimeProfiles.push(structuredClone(installed.runtimeProfiles[0]!))
  if (kind === 'template') installed.templates.push(structuredClone(installed.templates[0]!))
  if (kind === 'domain') installed.domains.push(structuredClone(installed.domains[0]!))
  if (kind === 'preset') installed.runtimeProfiles[0]!.preset = ' '
  if (kind === 'capability') installed.runtimeProfiles[0]!.capabilities = [' ']
  const result = await compileWorldScenarioV1(sample, installed)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.diagnostics.some(value => value.source === 'catalog' && value.code === 'invalid-catalog')).toBe(true)
})

it('refuses a package whose original policy or implementation pin drifted before model metadata or identity IO', async () => {
  const h = await setup()
  try {
    const metadata = vi.spyOn(h.ctx.llm, 'resolveModelInfo')
    const manifest = { id: 'company', version: '1', license: { identifier: 'LicenseRef-Private', notice: '' }, attribution: [],
      dependencies: { domains: h.installed.domains.map(entry => ({ ...entry.pin, generation: entry.pin.generation + 1 })),
        runtimeProfiles: sample.runtimeProfiles.allowed, templates: sample.runtimeProfiles.templates,
        policyVersion: h.installed.policyVersion, normPolicies: [] } }
    const result = await preflightSimulationWorld(h.ctx, sample, h.installed, new AbortController().signal, 'local', manifest)
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'domain-unavailable' }] })
    expect(metadata).not.toHaveBeenCalled()
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})
