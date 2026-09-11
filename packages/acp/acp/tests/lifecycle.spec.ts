import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { CallId } from '@clocky/clocky-llm'
import { SessionId } from '@clocky/clocky-session'
import { TeamError } from '@clocky/clocky-team'
import ApprovalService from '@clocky/clocky-user-approval'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

describe('ACP Team lifecycle', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('records a trusted human soft interrupt and retries a cursor conflict before settling cancellation', async () => {
    harness = await makeBridgeHarness({ scenarios: [{ kind: 'hang' }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const [team] = (await harness.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items
    if (team === undefined) throw new Error('expected ACP Team')
    const request = harness.ctx.teamRuns.requestCoordinatorInterrupt.bind(harness.ctx.teamRuns)
    const interrupt = vi.spyOn(harness.ctx.teamRuns, 'requestCoordinatorInterrupt')
      .mockRejectedValueOnce(new TeamError('stale cursor', 'TEAM_CURSOR_CONFLICT'))
      .mockImplementation(request)
    const prompt = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Wait.' }] })
    await harness.adapter.started.promise

    await harness.client.cancel({ sessionId })

    await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
    await vi.waitFor(() => { expect(interrupt).toHaveBeenCalledTimes(2) })
    expect(interrupt).toHaveBeenCalledTimes(2)
    expect(interrupt.mock.calls[1]).toEqual([team.id])
  })

  it('contains an exhausted soft-interrupt failure while preserving ACP cancellation semantics', async () => {
    harness = await makeBridgeHarness({ scenarios: [{ kind: 'hang' }], config: { interruptRetryAttempts: 1 } })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const interrupt = vi.spyOn(harness.ctx.teamRuns, 'requestCoordinatorInterrupt')
      .mockRejectedValueOnce(new TeamError('stale cursor', 'TEAM_CURSOR_CONFLICT'))
    const warn = vi.spyOn(harness.ctx.logger, 'warn')
    const prompt = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Wait.' }] })
    await harness.adapter.started.promise

    await harness.client.cancel({ sessionId })

    await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
    await vi.waitFor(() => { expect(interrupt).toHaveBeenCalledOnce() })
    expect(interrupt).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Team interrupt request failed'))
  })

  it('uses TeamRun cancellation and release when the ACP bridge disposes', async () => {
    harness = await makeBridgeHarness({ scenarios: [{ kind: 'hang' }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const [team] = (await harness.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items
    if (team === undefined) throw new Error('expected ACP Team')
    const cancel = vi.spyOn(harness.ctx.teamRuns, 'cancel')
    const prompt = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Wait.' }] })
    await harness.adapter.started.promise

    await harness.acpFiber.dispose()

    await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
    expect(cancel).toHaveBeenCalledWith(team.id)
    await expect(harness.ctx.teams.getTeam({ teamId: team.id })).resolves.toMatchObject({ team: { phase: 'cancelled' } })
  })

  it('projects bridge-owned approval requests through the opaque ACP session id', async () => {
    harness = await makeBridgeHarness()
    await harness.ctx.plugin(ApprovalService)
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = harness.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('expected coordinator Agent')
    agent.session.append('turn/start', { turn: 1 })

    await expect(harness.ctx.approval.request({ agent, toolName: 'bash', callId: CallId('approval-1') })).resolves.toBe('allowed-once')

    expect(harness.permissionRequests).toMatchObject([{ sessionId, toolCall: { toolCallId: 'approval-1' } }])
  })

  it('maps cancelled and rejected approval choices while delegating unaddressable or foreign requests', async () => {
    harness = await makeBridgeHarness()
    await harness.ctx.plugin(ApprovalService)
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = harness.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('expected coordinator Agent')
    agent.session.append('turn/start', { turn: 1 })

    harness.onPermission = () => ({ outcome: { outcome: 'cancelled' } })
    await expect(harness.ctx.approval.request({ agent, toolName: 'bash', callId: CallId('approval-cancel') })).resolves.toBe('cancelled')
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'unknown' } })
    await expect(harness.ctx.approval.request({ agent, toolName: 'bash', callId: CallId('approval-reject') })).resolves.toBe('rejected')
    await expect(harness.ctx.approval.request({ agent, toolName: 'bash' })).resolves.toBe('unavailable')
    const foreign = await harness.ctx.agents.create({ sessionId: SessionId('acp-foreign'), agentOptions: { provider: 'mock', model: 'mock' } })
    foreign.agent.session.append('turn/start', { turn: 1 })
    await expect(harness.ctx.approval.request({ agent: foreign.agent, toolName: 'bash', callId: CallId('approval-foreign') }))
      .resolves.toBe('unavailable')
    await foreign.dispose()
  })

  it('rejects prompt work for an unknown bridge session and limits prompts to one in-flight Team run', async () => {
    harness = await makeBridgeHarness({ scenarios: [{ kind: 'hang' }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await expect(harness.client.prompt({ sessionId: 'unknown', prompt: [{ type: 'text', text: 'go' }] })).rejects.toThrow('unknown session')
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const prompt = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Wait.' }] })
    await harness.adapter.started.promise
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'again' }] })).rejects.toThrow('already in flight')
    await harness.client.cancel({ sessionId })
    await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
  })

  it('rejects invalid session options and ignores an unknown cancellation', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })

    await expect(harness.client.newSession({ cwd: 'relative', mcpServers: [] })).rejects.toThrow('absolute path')
    await expect(harness.client.newSession({ cwd: process.cwd(), mcpServers: [], additionalDirectories: ['/tmp/extra'] }))
      .rejects.toThrow('additionalDirectories')
    await expect(harness.client.newSession({
      cwd: process.cwd(),
      mcpServers: [{ name: 'extra', command: 'node', args: [], env: [] }],
    })).rejects.toThrow('mcpServers')
    await expect(harness.client.cancel({ sessionId: 'unknown' })).resolves.toBeUndefined()
  })
})
