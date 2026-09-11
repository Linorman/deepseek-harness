import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

describe('ACP Team-run bridge', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('creates an opaque ACP projection of one Team and completes it through an explicit final Envelope', async () => {
    harness = await makeBridgeHarness({ scenarios: [{ kind: 'final', text: 'Completed Team result.' }] })
    const initialized = await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const [team] = (await harness.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items
    if (team === undefined) throw new Error('expected ACP Team')
    const coordinator = harness.ctx.agents.list().find(agent => agent.session.header.teamId === team.id)

    expect(initialized.agentCapabilities?.promptCapabilities).toEqual({ image: false, audio: false, embeddedContext: false })
    expect(sessionId).not.toBe(coordinator?.session.id)
    expect(coordinator?.session.header.teamId).toBe(team.id)
    expect(typeof coordinator?.session.header.participantId).toBe('string')
    expect(coordinator?.session.header.cwd).toBe(process.cwd())
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Complete this task.' }] }))
      .resolves.toEqual({ stopReason: 'end_turn' })

    expect(harness.sessionUpdates).toEqual([{
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Completed Team result.' } },
    }])
    const request = harness.adapter.requests[0]
    const message = request?.messages.at(-1)
    if (message === undefined || message.role !== 'user') throw new Error('expected coordinator user message')
    const [prefix, input] = message.content
    expect(prefix).toMatchObject({ type: 'text' })
    if (prefix?.type !== 'text') throw new Error('expected direct-message prefix')
    expect(prefix.text).toContain('Direct message from')
    expect(input).toEqual({ type: 'text', text: 'Complete this task.' })
    await expect(harness.ctx.teams.getTeam({ teamId: team.id })).resolves.toMatchObject({ team: { phase: 'completed' } })
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'again' }] }))
      .rejects.toThrow('ACP session is complete')
  })

  it('admits image input into the direct-v3 human Envelope without persisting inline base64', async () => {
    harness = await makeBridgeHarness({ imageCapable: true, scenarios: [{ kind: 'final', text: 'Image reviewed.' }] })
    const initialized = await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    expect(initialized.agentCapabilities?.promptCapabilities?.image).toBe(true)
    await harness.client.prompt({
      sessionId,
      prompt: [
        { type: 'text', text: 'Inspect this image.' },
        { type: 'image', data: 'AQ==', mimeType: 'image/png' },
      ],
    })

    expect(harness.attachments?.saved.map(item => [...item.data])).toEqual([[1]])
    const content = harness.adapter.requests[0]?.messages.at(-1)?.content
    expect(content?.map(block => block.type)).toEqual(['text', 'text', 'image'])
    expect(JSON.stringify(content)).not.toContain('AQ==')
  })

  it('preserves committed coordinator text and avoids duplicating an equal final Envelope', async () => {
    harness = await makeBridgeHarness({ scenarios: [{
      kind: 'final', text: 'The exact final answer.', assistantText: 'The exact final answer.',
    }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Answer.' }] })

    expect(harness.sessionUpdates).toEqual([{
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The exact final answer.' } },
    }])
  })

  it('adds an explicit final output after earlier committed coordinator text', async () => {
    harness = await makeBridgeHarness({ scenarios: [{
      kind: 'final', text: 'Final answer.', assistantText: 'Working result.',
    }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Answer.' }] })

    expect(harness.sessionUpdates).toEqual([
      { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working result.' } } },
      { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Final answer.' } } },
    ])
  })

  it('reports a coordinator turn that ends without an explicit final Envelope', async () => {
    harness = await makeBridgeHarness({ scenarios: [{ kind: 'no-final' }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Finish silently.' }] }))
      .rejects.toThrow('coordinator turn ended completed before an explicit final Envelope')
  })

  it('rejects the prompt when a committed coordinator image cannot be projected to ACP', async () => {
    harness = await makeBridgeHarness({ scenarios: [{ kind: 'final', text: 'Final answer.', missingImage: true }] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Answer.' }] }))
      .rejects.toThrow('assistant output delivery failed')
  })
})
