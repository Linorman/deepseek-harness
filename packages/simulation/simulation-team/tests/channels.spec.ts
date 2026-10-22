import { afterEach, describe, expect, it, vi } from 'vitest'
import { rm } from 'node:fs/promises'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { simulationChannelSpecSchema, simulationChangeSchema, simulationEntityIdSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { createContext } from './harness.ts'
import { simulationTemp } from '../../simulation-local/tests/temp.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const spec = simulationChannelSpecSchema.parse({ key: 'purchase', members: [{ entityId: 'buyer', role: 'sender' },
  { entityId: 'supplier', role: 'recipient' }], limits: {} })
async function setup(backend: 'json' | 'sqlite') {
  const root = await simulationTemp('channels')
  const { ctx } = await createContext(root, backend)
  await ctx.plugin(Direct)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
    outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
    phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000', relationRules: [],
  } })
  const run = await ctx.simulations.open(selection)
  cleanups.push(async () => { await run.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Company', budgets: {} }, budgets: {} }, 'simulation/company')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/company')
  for (const member of spec.members) {
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: member.entityId, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    await connection.ensureParticipant(member.entityId, { displayName: member.role, role: member.role, capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'mock/default' })
  }
  return { ctx, run, connection, teamId: team.team.id, selection }
}

describe.each(['json', 'sqlite'] as const)('%s channel bootstrap', (backend) => {
  it.each(['reserved', 'wal', 'attached', 'consent', 'confirmed'] as const)('recovers a lost %s response without duplicating a channel or activation', async (stage) => {
    const { ctx, run, connection, teamId, selection } = await setup(backend)
    if (stage === 'reserved') {
      const original = run.reserveChannel.bind(run)
      vi.spyOn(run, 'reserveChannel').mockImplementationOnce(async (...args) => { await original(...args); throw new Error('response lost') })
    } else if (stage === 'wal') {
      const open = ctx.storageLog.open.bind(ctx.storageLog)
      vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name.startsWith('channel/')) {
          const append = stream.append.bind(stream)
          vi.spyOn(stream, 'append').mockImplementationOnce(async (...args) => { await append(...args); throw new Error('response lost') })
        }
        return stream
      })
    } else if (stage === 'attached') {
      const original = ctx.teams.openChannel.bind(ctx.teams)
      vi.spyOn(ctx.teams, 'openChannel').mockImplementationOnce(async (...args) => { await original(...args); throw new Error('response lost') })
    } else if (stage === 'consent') {
      const original = ctx.teams.acknowledgeChannelInvitation.bind(ctx.teams)
      vi.spyOn(ctx.teams, 'acknowledgeChannelInvitation').mockImplementationOnce(async (...args) => { await original(...args); throw new Error('response lost') })
    } else {
      const original = run.confirmChannel.bind(run)
      vi.spyOn(run, 'confirmChannel').mockImplementationOnce(async (...args) => { await original(...args); throw new Error('response lost') })
    }
    await expect(connection.ensureChannel(spec)).rejects.toThrow('response lost')
    vi.restoreAllMocks()
    const reserved = run.snapshot().channelReservations?.[spec.key]
    expect(reserved).toBeDefined()
    if (stage !== 'confirmed') await expect(run.setPhase('running', run.snapshot().revision)).rejects.toThrow(/invitations must finish/)
    await run.close()
    const reopened = await ctx.simulations.open({ ...selection, mode: 'open' })
    cleanups.push(() => reopened.close())
    const resumed = await ctx.simulationTeams.attach(reopened, teamId, 'simulation/company')
    const channel = await resumed.ensureChannel(spec)
    expect(channel.manifest.id).toBe(reserved?.channelId)
    expect(channel.phase).toBe('active')
    expect((await resumed.ensureChannel(spec)).manifest.id).toBe(channel.manifest.id)
    const state = await ctx.teams.getTeam({ teamId })
    expect(state.channelIds).toEqual([channel.manifest.id])
    expect(state.activations).toEqual([])
    const admission = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
    expect(admission.invitations.map(value => value.status)).toEqual(['acknowledged', 'acknowledged'])
    await reopened.setPhase('running', reopened.snapshot().revision)
    await expect(resumed.ensureChannel({ ...spec, limits: { changed: true } })).rejects.toThrow(/changed its membership/)
  })

  it('rejects changed payloads and revokes consent when a member becomes inactive during open policy', async () => {
    const { ctx, run, connection, teamId } = await setup(backend)
    const open = ctx.teams.openChannel.bind(ctx.teams)
    vi.spyOn(ctx.teams, 'openChannel').mockImplementationOnce(async (request) => {
      await expect(open({ ...request, limits: { forged: true } })).rejects.toThrow(/does not authorize/)
      return await open(request)
    })
    ctx.teams.registerPolicy('channel-open', { name: 'retire-member', async apply(_request, next) {
      const entityId = simulationEntityIdSchema.parse('supplier')
      await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: entityId,
        entityRevision: run.snapshot().entities[entityId]!.revision, phase: 'inactive' }), run.snapshot().revision)
      return await next()
    } })
    await expect(connection.ensureChannel(spec)).rejects.toThrow(/failed to resolve/)
    expect((await ctx.teams.getTeam({ teamId })).channelIds).toEqual([])
    expect(run.snapshot().channelReservations?.[spec.key]?.confirmed).toBe(false)
  })

  it('keeps the original invitation deadline when recovery occurs after expiry', async () => {
    const { ctx, run, connection, teamId } = await setup(backend)
    const open = ctx.teams.openChannel.bind(ctx.teams)
    vi.spyOn(ctx.teams, 'openChannel').mockImplementationOnce(async (...args) => { await open(...args); throw new Error('response lost') })
    await expect(connection.ensureChannel(spec)).rejects.toThrow('response lost')
    const channelId = run.snapshot().channelReservations![spec.key]!.channelId
    const initial = await ctx.teams.getChannelAdmission({ channelId })
    const deadline = initial.invitations[0]!.deadline
    vi.spyOn(Date, 'now').mockReturnValue(deadline + 1)
    await expect(connection.ensureChannel(spec)).rejects.toThrow()
    const current = await ctx.teams.getChannelAdmission({ channelId })
    expect(current.invitations.map(value => value.deadline)).toEqual(initial.invitations.map(value => value.deadline))
    expect(current.channel.phase).not.toBe('active')
    expect((await ctx.teams.getTeam({ teamId })).channelIds).toEqual([channelId])
    expect(run.snapshot().channelReservations![spec.key]!.confirmed).toBe(false)
  })

  it('rejects repeated members and membership changes before reserving a target', async () => {
    const { run, connection } = await setup(backend)
    expect(() => connection.ensureChannel({ ...spec, members: [spec.members[0]!, spec.members[0]!] })).toThrow()
    await run.setPhase('running', run.snapshot().revision)
    await expect(connection.ensureChannel(spec)).rejects.toThrow(/reservation requires/)
    expect(run.snapshot().channelReservations).toBeUndefined()
  })
})

it('keeps channel provisioning unconfirmed for missing reservation or substituted target state', async () => {
  const { ctx, run, connection } = await setup('sqlite')
  const reserve = run.reserveChannel.bind(run)
  const missing = vi.spyOn(run, 'reserveChannel').mockImplementationOnce(async (...args) => {
    const state = await reserve(...args)
    vi.spyOn(run, 'snapshot').mockReturnValueOnce({ ...state, channelReservations: {} })
    return state
  })
  await expect(connection.ensureChannel(spec)).rejects.toThrow(/lost its reservation/)
  missing.mockRestore(); vi.restoreAllMocks()
  const open = ctx.teams.openChannel.bind(ctx.teams)
  const { channelIdSchema } = await import('@clocky/clocky-team')
  const foreign = vi.spyOn(ctx.teams, 'openChannel').mockImplementationOnce(async (request) => {
    expect(() => JSON.stringify(request.actor)).toThrow(/runtime-only/)
    const channel = await open(request)
    return { ...channel, manifest: { ...channel.manifest, id: channelIdSchema.parse('foreign') } }
  })
  await expect(connection.ensureChannel(spec)).rejects.toThrow(/another identity/)
  foreign.mockRestore()
  const acknowledge = ctx.teams.acknowledgeChannelInvitation.bind(ctx.teams)
  const incomplete = vi.spyOn(ctx.teams, 'acknowledgeChannelInvitation').mockImplementation(async (request) => {
    const result = await acknowledge(request)
    return { ...result, channel: { ...result.channel, phase: 'closed' as const } }
  })
  try { await expect(connection.ensureChannel(spec)).rejects.toThrow(/every required consent/) }
  finally { incomplete.mockRestore() }
  expect(run.snapshot().channelReservations![spec.key]!.confirmed).toBe(false)
  expect((await connection.ensureChannel(spec)).phase).toBe('active')
})

it('rejects membership retired after channel reservation before issuing target authority', async () => {
  const { run, connection } = await setup('sqlite')
  const reserve = run.reserveChannel.bind(run)
  const changed = vi.spyOn(run, 'reserveChannel').mockImplementationOnce(async (...args) => {
    const reserved = await reserve(...args)
    const id = spec.members[0]!.entityId
    await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id,
      entityRevision: run.snapshot().entities[id]!.revision, phase: 'inactive' }), run.snapshot().revision)
    return reserved
  })
  try { await expect(connection.ensureChannel(spec)).rejects.toThrow(/active canonical binding/) }
  finally { changed.mockRestore() }
  expect(run.snapshot().channelReservations![spec.key]!.confirmed).toBe(false)
})
