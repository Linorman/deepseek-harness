import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION, RequestError, type Stream } from '@agentclientprotocol/sdk'
import { Context } from '@clocky/cordis'
import { AttachmentError } from '@clocky/clocky-attachment'
import { TeamError } from '@clocky/clocky-team'
import type { TeamId, TeamSystemPhaseProof, TeamSystemPhaseScope } from '@clocky/clocky-team'
import * as AcpPlugin from '../src/index.ts'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

/** Stall one Team through the scheduler's exact proof-only lifecycle seam. */
async function stallTeam(ctx: Context, teamId: TeamId): Promise<void> {
  const proofs = new WeakMap<TeamSystemPhaseProof, TeamSystemPhaseScope>()
  const unregister = ctx.teams.registerSystemPhaseProofSource({
    name: 'team-scheduler-dag',
    resolvePhaseProof: proof => proofs.get(proof),
  })
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('ACP phase proof is runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemPhaseProof
  const state = await ctx.teams.getTeam({ teamId })
  const reason = { code: 'TEST_STALLED', message: 'The ACP edge test needs a non-active Team.' }
  proofs.set(actor, { kind: 'scheduler-stall', teamId, phase: 'stalled', reason })
  try {
    await ctx.teams.transitionTeamPhase({
      teamId,
      actor,
      expectedCursor: state.team.cursor,
      phase: 'stalled',
      reason,
    })
  } finally {
    proofs.delete(actor)
    unregister()
  }
}

describe('ACP Team bridge edge cases', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
    vi.restoreAllMocks()
  })

  it('authenticates as a no-op and rejects new requests after bridge disposal', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await expect(harness.client.authenticate({ methodId: 'unused' })).resolves.toEqual({})

    await harness.acpFiber.dispose()

    await expect(harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).rejects.toThrow('ACP bridge has been disposed')
  })

  it('cancels a final-result wait after Team completion but before ACP settlement', async () => {
    harness = await makeBridgeHarness({ scenarios: [{ kind: 'final', text: 'Final.' }] })
    const reached = Promise.withResolvers<undefined>()
    const releaseFinal = Promise.withResolvers<undefined>()
    const waitForFinal = harness.ctx.teamRuns.waitForFinal.bind(harness.ctx.teamRuns)
    vi.spyOn(harness.ctx.teamRuns, 'waitForFinal').mockImplementation(async (request) => {
      const final = await waitForFinal(request)
      reached.resolve(undefined)
      await releaseFinal.promise
      return final
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const [team] = (await harness.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items
    if (team === undefined) throw new Error('expected ACP Team')
    const prompt = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Answer.' }] })
    await reached.promise
    await vi.waitFor(async () => { expect((await harness!.ctx.teams.getTeam({ teamId: team.id })).team.phase).toBe('completed') })

    await harness.client.cancel({ sessionId })
    releaseFinal.resolve(undefined)

    await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
  })

  it('does not request an interrupt for a no-longer-active Team', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const [team] = (await harness.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items
    if (team === undefined) throw new Error('expected ACP Team')
    await stallTeam(harness.ctx, team.id)
    const teamRunInterrupt = vi.spyOn(harness.ctx.teamRuns, 'requestCoordinatorInterrupt')
    const interrupt = vi.spyOn(harness.ctx.teams, 'requestParticipantInterrupt')

    await harness.client.cancel({ sessionId })

    expect(teamRunInterrupt).toHaveBeenCalledWith(team.id)
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('contains an output projection failure that occurs outside an ACP prompt', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = harness.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('expected coordinator Agent')
    const warn = vi.spyOn(harness.ctx.logger, 'warn')

    harness.ctx.emit('session/event', agent.session, {
      type: 'assistant/message',
      data: {
        turn: 1,
        message: {
          id: 'outside-output' as never,
          role: 'assistant',
          content: [{
            type: 'image',
            attachment: {
              attachmentId: 'missing' as never,
              mediaType: 'image/png',
              bytes: 1,
              width: 1,
              height: 1,
            },
          }],
        },
      },
    } as never)

    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('assistant output conversion failed')) })
  })

  it('maps invalid, internal, request, and generic prompt failures without retaining the slot', async () => {
    harness = await makeBridgeHarness({ imageCapable: true })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: '  ' }] })).rejects.toThrow('empty prompt')
    vi.spyOn(harness.attachments!, 'saveImages').mockRejectedValueOnce(new AttachmentError('disk failed', 'ATTACHMENT_WRITE_FAILED'))
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'image', data: 'AQ==', mimeType: 'image/png' }] }))
      .rejects.toThrow('unable to persist the prompt image batch')
    vi.spyOn(harness.ctx.teamRuns, 'postHumanInput').mockRejectedValueOnce(RequestError.invalidParams(undefined, 'rejected post'))
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'post.' }] })).rejects.toThrow('rejected post')
    vi.spyOn(harness.ctx.teamRuns, 'postHumanInput').mockRejectedValueOnce(new Error('synthetic post failure'))
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'post again.' }] }))
      .rejects.toThrow('prompt was not queued: synthetic post failure')
  })

  it('cleans an in-flight creation that loses the connection race', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const create = harness.ctx.teamRuns.create.bind(harness.ctx.teamRuns)
    const run = await create({ objective: 'Race cleanup.', cwd: process.cwd() })
    const gate = Promise.withResolvers<typeof run>()
    const delayedCreate = vi.spyOn(harness.ctx.teamRuns, 'create').mockImplementation(async () => await gate.promise)
    const created = harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await vi.waitFor(() => { expect(delayedCreate).toHaveBeenCalled() })

    await harness.acpFiber.dispose()
    gate.resolve(run)

    await expect(created).rejects.toThrow('connection closed during session/new')
    await expect(harness.ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
  })

  it('releases a TeamRun that fails to publish its required local coordinator', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const create = harness.ctx.teamRuns.create.bind(harness.ctx.teamRuns)
    const run = await create({ objective: 'Missing coordinator.', cwd: process.cwd() })
    vi.spyOn(harness.ctx.teamRuns, 'create').mockResolvedValue({
      ...run,
      coordinatorLease: { ...run.coordinatorLease, localAgent: undefined },
    })

    await expect(harness.client.newSession({ cwd: process.cwd(), mcpServers: [] }))
      .rejects.toThrow('Team run did not publish a local coordinator')
    await expect(harness.ctx.teams.getTeam({ teamId: run.teamId })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
  })

  it('aggregates Team-run release failures and shares one no-session quiescence boundary', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const rejected = vi.spyOn(harness.ctx.teamRuns, 'cancel').mockRejectedValueOnce(new Error('release failed'))

    const warn = vi.spyOn(harness.ctx.logger, 'warn')
    await harness.closeClientTransport()
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ACP Team teardown failed for 1 session(s): release failed'))
    })
    expect(rejected).toHaveBeenCalledOnce()

    const empty = await makeBridgeHarness()
    try {
      await empty.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      await empty.closeClientTransport()
      await empty.acpFiber.dispose()
    } finally {
      await empty.dispose()
    }
  })

  it('validates direct plugin retry configuration', async () => {
    const ctx = new Context()
    try {
      expect(() => { AcpPlugin.apply(ctx, { interruptRetryAttempts: 0, stream: {} as Stream }) }).toThrow('positive safe integer')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not hide a non-cursor interrupt rejection', async () => {
    harness = await makeBridgeHarness({ scenarios: [{ kind: 'hang' }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const warn = vi.spyOn(harness.ctx.logger, 'warn')
    vi.spyOn(harness.ctx.teamRuns, 'requestCoordinatorInterrupt').mockRejectedValueOnce(new TeamError('forbidden', 'TEAM_INVALID_ARGUMENT'))
    const prompt = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Wait.' }] })
    await harness.adapter.started.promise

    await harness.client.cancel({ sessionId })

    await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('Team interrupt request failed')) })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Team interrupt request failed'))
  })
})
