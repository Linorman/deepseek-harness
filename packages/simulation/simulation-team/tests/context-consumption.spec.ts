/** Canonical consumption survives summary presentation changes without weakening original input evidence. */
import { expect, it } from 'vitest'
import { Session, SessionId } from '@clocky/clocky-session'
import { CompactionId } from '@clocky/clocky-compaction'
import { createUserMessage } from '@clocky/clocky-llm'
import { simulationDecisionIdSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { contextConsumption } from '../src/context-consumption.ts'
import { decisionInput } from '../src/input.ts'

it('attests the original input after repeated completed summary restorations and refuses unproven replacements', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const session = Session.create(SessionId('reader'))
    const actor = await h.actor('reader', undefined, async decision => contextConsumption(decision, session.id, session.events)), id = simulationDecisionIdSchema.parse('compressed')
    await actor.lease.openDecision(id, h.run.snapshot().revision)
    const prepared = await actor.lease.prepareContext(id, contextRequest())
    if (prepared.status !== 'prepared') throw new Error('fixture context missing')
    const decision = h.run.snapshot().decisions[id]!
    session.append('turn/start', { turn: 1 })
    const original = session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
    const entered = session.append('user/message', decisionInput(prepared.view), { surfaceOp: 'append' })
    const expected = contextConsumption(decision, session.id, session.events)
    let current = original
    for (let index = 0; index < 2; index++) {
      const compactionId = CompactionId(`summary-${index}`)
      const start = session.append('compaction/start', { compactionId, turn: 1 })
      const summary = session.append('compaction/summary', { compactionId, summary: [{ type: 'text', text: 'Earlier history summarized.' }],
        shadowedRange: { start: current.seq, end: current.seq }, shadowedSeqs: [current.seq], shadowedTokenCount: 20,
        provider: 'fixture', model: 'summary' })
      session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Earlier history summarized.' }],
        source: { kind: 'user' } }), { surfaceOp: { op: 'replace', start: current.seq, end: current.seq }, sourceEventSeqs: [start.seq, summary.seq, current.seq] })
      session.append('compaction/end', { compactionId, turn: 1 })
      current = session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
      expect(contextConsumption(decision, session.id, session.events)).toEqual(expected)
    }
    expect(expected.viewSequence).toBe(original.seq)
    expect(expected.consumedSequence).toBe(entered.seq)
    await actor.lease.startDecision(id, Date.now())
    expect(await actor.lease.recordContextConsumption(id)).toEqual(expected)
    expect((await actor.lease.submitDecision(id, [])).status).toBe('accepted')
    expect(h.run.snapshot().decisions[id]?.consumption).toEqual(expected)
    const retained = [...session.events]
    session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
    expect(() => contextConsumption(decision, session.id, session.events)).toThrow(/provenance/)
    const changed = retained.map(event => event.seq === current.seq ? { ...event, data: { ...prepared.view, time: '999' } } : event)
    expect(() => contextConsumption(decision, session.id, changed as typeof session.events)).toThrow()
    session.append('user/message', decisionInput(prepared.view), { surfaceOp: 'append' })
    expect(() => contextConsumption(decision, session.id, session.events)).toThrow()
  } finally { await h.close() }
})
