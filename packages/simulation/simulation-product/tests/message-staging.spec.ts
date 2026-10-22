/** Actual Agent tools must reject Participant addressing before concluding the model turn. */
import { expect, it } from 'vitest'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { simulationDecisionIdSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { companyFixture } from './company-driver-fixture.ts'

it('lets the model correct its recipient in the same decision without recovery or duplicate effects', async () => {
  const h = await companyFixture('sqlite')
  try {
    const state = h.run.snapshot(), sender = state.entities[simulationEntityIdSchema.parse('buyer')]!, target = state.entities[simulationEntityIdSchema.parse('supplier')]!
    const channel = Object.values(state.channelReservations ?? {}).find(value => value.spec.members.some(v => v.entityId === sender.id)
      && value.spec.members.some(v => v.entityId === target.id))
    if (channel === undefined || target.binding === undefined) throw new Error('canonical peer route missing')
    const action = { kind: 'communication/post', channelId: channel.channelId, text: 'hello', deliverAt: '0' }
    const model = new MockAdapter([
      toolCallResponse('bad', 'simulation_stage', { proposals: [{ after: [], action: { ...action, recipient: target.binding.participantId } }] }),
      toolCallResponse('fixed', 'simulation_stage', { proposals: [{ after: [], action: { ...action, recipient: target.id } }] }),
      toolCallResponse('submit', 'simulation_submit', {}),
    ])
    h.ctx.llm.registerAdapter(['reply-fixture'], model)
    const lease = await h.connection.activate(sender.id, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { options: { provider: 'reply-fixture', model: 'scripted' } }, signal: h.lifetime.signal })
    await h.start()
    const result = await h.connection.executeDecision(sender.id, simulationDecisionIdSchema.parse('correct-recipient'), contextRequest())
    expect(result.status).toBe('accepted')
    expect(model.requests).toHaveLength(3)
    const results = lease.localAgent!.session.events.filter(value => value.type === 'tool/result')
    expect(JSON.stringify(results[0])).toContain('simulation Entity ID')
    expect(h.run.snapshot().phase).toBe('running')
    expect(Object.values(h.run.snapshot().operations).filter(value => value.action.kind === 'communication/post')).toHaveLength(1)
  } finally { await h.close() }
})
