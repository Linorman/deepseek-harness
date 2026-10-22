/** Deployment preflight observes real owners without acquiring a new run or starting a model. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { worldScenarioSchema, compileWorldScenario } from '@clocky/clocky-simulation-scenario'
import { preflightSimulationWorld } from '../src/world-preflight.ts'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import { companyFixture } from './company-driver-fixture.ts'
import AgentDefaultModel from '@clocky/clocky-agent-default-model'
import { ReasoningEffortId } from '@clocky/clocky-llm'

afterEach(() => { vi.restoreAllMocks() })

it('resolves the saved default without mutating deployment metadata and rejects a change during metadata IO', async () => {
  const h = await setup()
  try {
    await h.ctx.plugin(AgentDefaultModel, {})
    const selection = vi.spyOn(h.ctx.agentDefaultModel, 'currentSelection')
    const preflight = () => preflightSimulationWorld(h.ctx, h.definition, h.installed,
      new AbortController().signal, undefined, undefined, { source: 'agent-default' })
    const before = structuredClone(h.installed), open = vi.spyOn(h.ctx.simulations, 'open')
    expect(await preflight()).toMatchObject({ ok: false, diagnostics: [{ code: 'model-unavailable' }] })
    selection.mockReturnValue({ provider: 'company', model: 'scripted' })
    const ready = await preflight()
    expect(ready.ok).toBe(true)
    if (!ready.ok) throw new Error('Configured default should compile')
    expect(ready.resolved.generatedActorRuntime.model).toMatchObject({ provider: 'company', name: 'scripted', available: true })
    expect(h.installed).toEqual(before)
    const metadata = h.ctx.llm.resolveModelInfo.bind(h.ctx.llm)
    vi.spyOn(h.ctx.llm, 'resolveModelInfo').mockImplementationOnce(async (...args) => {
      const info = await metadata(...args)
      selection.mockReturnValue({ provider: 'company', model: 'changed' })
      return info
    })
    expect(await preflight()).toMatchObject({ ok: false, diagnostics: [{ code: 'model-unavailable' }] })
    selection.mockReturnValue({ provider: 'company', model: 'scripted', reasoningEffort: ReasoningEffortId('high') })
    expect(await preflight()).toMatchObject({ ok: false, diagnostics: [{ code: 'model-unavailable' }] })
    expect(open).not.toHaveBeenCalled()
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})
async function setup(contextLimits?: Parameters<typeof companyFixture>[4]) {
  const h = await companyFixture('json', false, {}, undefined, contextLimits)
  const installed = catalog()
  installed.runtimeProfiles[0]!.model = { provider: 'company', name: 'scripted', version: 'model-1', available: true }
  const definition = worldScenarioSchema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8')))
  const preflight = (input: unknown = definition, signal = new AbortController().signal) =>
    preflightSimulationWorld(h.ctx, input, installed, signal)
  return { ...h, installed, definition, preflight }
}

it('freezes actual deployment caps and metadata with zero writes, identities, permits, Sessions or inference', async () => {
  const h = await setup()
  try {
    const installed = structuredClone(h.installed), before = h.run.snapshot()
    const limits = h.ctx.teams.getCreationLimits()
    const open = vi.spyOn(h.ctx.storageLog, 'open'), runOpen = vi.spyOn(h.ctx.simulations, 'open')
    const create = vi.spyOn(h.ctx.teams, 'createTeam'), invite = vi.spyOn(h.ctx.teams, 'inviteParticipant')
    const activate = vi.spyOn(h.ctx.teamActivations, 'activate'), metadata = vi.spyOn(h.ctx.llm, 'resolveModelInfo')
    const result = await h.preflight()
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) throw new Error('Expected a ready preflight')
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      expect(result.resolved.limits.team[key]).toBeLessThanOrEqual(limits[key])
    }
    expect(result.resolved.actors[0]?.runtime.model).toMatchObject({ provider: 'company', name: 'scripted', available: true })
    expect(metadata).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
    expect(runOpen).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(invite).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
    expect(h.run.snapshot()).toEqual(before)
    expect(h.installed).toEqual(installed)
    expect(h.requests).toEqual([])
    expect(h.ctx.simulationTeams.modelUsage().active).toBe(0)
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
    expect(Object.isFrozen(result.resolved)).toBe(true)
  } finally { await h.close() }
})

it('caps catalog defaults to the actual Host ceiling and changes the preview commitment without allocating identities', async () => {
  const h = await setup()
  try {
    const actual = h.ctx.teams.getCreationLimits()
    h.installed.limits.defaults.team.maxParticipants = actual.maxParticipants + 1
    h.installed.limits.ceilings.team.maxParticipants = actual.maxParticipants + 1
    const original = await compileWorldScenario(h.definition, h.installed)
    const current = await h.preflight()
    expect(original.ok && current.ok, JSON.stringify({ original, current })).toBe(true)
    if (!original.ok || !current.ok) throw new Error('Expected both preflight commitments')
    expect(current.resolved.limits.team.maxParticipants).toBe(actual.maxParticipants)
    expect(current.preview.hash).not.toBe(original.preview.hash)
    h.definition.limits = { team: { maxParticipants: actual.maxParticipants + 1 } }
    const rejected = await h.preflight()
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.diagnostics.some(value => value.code === 'capacity')).toBe(true)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('rejects malformed shapes and unknown references before any adapter metadata lookup', async () => {
  const h = await setup()
  try {
    const metadata = vi.spyOn(h.ctx.llm, 'resolveModelInfo')
    for (const input of ['{', { ...h.definition, code: 'arbitrary host code' },
      { ...h.definition, runtimeProfile: { id: 'missing', version: '1' } }]) {
      expect((await h.preflight(input)).ok).toBe(false)
    }
    expect(metadata).not.toHaveBeenCalled()
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['provider', 'metadata', 'preset', 'runtime'] as const)('rejects unavailable %s without inference or private diagnostics', async (failure) => {
  const h = await setup()
  try {
    const profile = h.installed.runtimeProfiles[0]!
    if (failure === 'provider') h.modelRegistration()
    if (failure === 'metadata') vi.spyOn(h.ctx.llm, 'resolveModelInfo').mockRejectedValueOnce(new Error('Private provider key and endpoint'))
    if (failure === 'preset') profile.preset = 'missing-preset'
    const caller = failure === 'runtime' ? h.ctx.isolate('agentRuntimes') : h.ctx
    const result = await preflightSimulationWorld(caller, h.definition, h.installed, new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('Private provider key')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('does not probe unused installed profiles and rejects provider revocation during a selected metadata read', async () => {
  const h = await setup()
  try {
    h.installed.runtimeProfiles.push({ ...structuredClone(h.installed.runtimeProfiles[0]!), id: 'unused',
      model: { provider: 'unavailable-unselected', name: 'unused', version: '1', available: true } })
    const metadata = vi.spyOn(h.ctx.llm, 'resolveModelInfo')
    expect((await h.preflight()).ok).toBe(true)
    expect(metadata).toHaveBeenCalledTimes(1)
    metadata.mockRestore()
    const resolve = h.ctx.llm.resolveModelInfo.bind(h.ctx.llm)
    vi.spyOn(h.ctx.llm, 'resolveModelInfo').mockImplementationOnce(async (...args) => {
      const info = await resolve(...args)
      h.modelRegistration()
      return info
    })
    expect((await h.preflight()).ok).toBe(false)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('propagates caller cancellation during metadata IO without publishing a ready compilation', async () => {
  const h = await setup()
  try {
    const lifetime = new AbortController(), resolve = h.ctx.llm.resolveModelInfo.bind(h.ctx.llm)
    vi.spyOn(h.ctx.llm, 'resolveModelInfo').mockImplementationOnce(async (...args) => {
      const info = await resolve(...args)
      lifetime.abort(new Error('Preview revoked'))
      return info
    })
    await expect(h.preflight(h.definition, lifetime.signal)).rejects.toThrow('Preview revoked')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('refuses a proven request/context minimum before allocating World ownership', async () => {
  const h = await setup()
  try {
    const open = vi.spyOn(h.ctx.simulations, 'open')
    vi.spyOn(h.ctx.simulationTeams, 'requestCapacity').mockReturnValue({ status: 'impossible', dimension: 'context-window', minimumRequired: '514', limit: 256 })
    expect(await h.preflight()).toMatchObject({ ok: false, diagnostics: [{ code: 'capacity', source: 'preflight' }] })
    expect(open).not.toHaveBeenCalled()
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})


it('refuses the real runtime-shared initial identity bytes before any Native or Session allocation', async () => {
  const h = await setup()
  try {
    h.installed.templates[0]!.template.description = '猫'.repeat(30000)
    const before = h.run.snapshot(), sessions = h.ctx.sessions.list().map(session => session.id)
    const open = vi.spyOn(h.ctx.simulations, 'open'), model = h.ctx.simulationTeams.modelUsage()
    const result = await h.preflight()
    expect(result).toMatchObject({ ok: false, diagnostics: [{ source: 'preflight', code: 'capacity' }] })
    if (result.ok) throw new Error('Oversized required initial role identity must refuse')
    expect(result.diagnostics[0]?.message).toContain('context-bytes')
    expect(result.diagnostics[0]?.message).toContain('bytes')
    expect(result.diagnostics[0]?.message).toContain('unknown')
    expect(JSON.stringify(result)).not.toContain('猫')
    expect(open).not.toHaveBeenCalled()
    expect(h.ctx.sessions.list().map(session => session.id)).toEqual(sessions)
    expect(h.ctx.simulationTeams.modelUsage()).toEqual(model)
    expect(h.run.snapshot()).toEqual(before)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})

it('uses actual model metadata once to refuse a known required input floor even when the policy-only minimum fits', async () => {
  const h = await setup({ requestPolicy: { maxOutputTokens: 64, safetyMarginTokens: 0, inputSafetyFactor: 1.5, compactionAttempts: 0 } })
  try {
    h.installed.templates[0]!.template.description = 'known initial role '.repeat(400)
    const resolve = h.ctx.llm.resolveModelInfo.bind(h.ctx.llm)
    const metadata = vi.spyOn(h.ctx.llm, 'resolveModelInfo').mockImplementation(async (...args) => ({
      ...await resolve(...args), context: { contextWindow: 256 },
    }))
    const open = vi.spyOn(h.ctx.simulations, 'open')
    const result = await h.preflight()
    expect(result).toMatchObject({ ok: false, diagnostics: [{ source: 'preflight', code: 'capacity' }] })
    if (result.ok) throw new Error('Initial role input must not fit this declared context window')
    expect(result.diagnostics[0]?.message).toContain('context-window')
    expect(metadata).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})


it('records measured known initial subsets while leaving full-envelope and long-run feasibility explicitly unknown', async () => {
  const h = await setup()
  try {
    const measure = h.ctx.simulationTeams.requestCapacity.bind(h.ctx.simulationTeams)
    const measurements: Array<NonNullable<ReturnType<typeof measure>['sizing']>> = []
    vi.spyOn(h.ctx.simulationTeams, 'requestCapacity').mockImplementation((request) => {
      const result = measure(request)
      if (result.sizing !== undefined) measurements.push(result.sizing)
      return result
    })
    const result = await h.preflight()
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Initial subset should fit the fixture')
    expect(measurements).toHaveLength(result.resolved.actors.length)
    expect(measurements.every(value => value.requiredContextBytes > 0 && value.estimatedInputTokens > 0
      && value.completeEnvelope === 'unknown' && value.futureConsumption === 'unknown')).toBe(true)
    const directory = resolve('.tmp/w6-initial-evidence')
    await mkdir(directory, { recursive: true })
    await writeFile(resolve(directory, 'measurements.json'), JSON.stringify({
      source: 'runtime-shared initial World identity/authority/commitment subset',
      byteLimit: 65536, tokensPerRequest: result.resolved.native.tokensPerModelRequest,
      measurements, modelCalls: h.requests.length, completeEnvelope: 'unknown', futureConsumption: 'unknown',
    }, null, 2) + '\n')
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})
