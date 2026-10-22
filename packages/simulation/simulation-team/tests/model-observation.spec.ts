/** Read selection never expands authority, and result references cannot rewrite a frozen notification. */
import { expect, it, vi } from 'vitest'
import type { Agent } from '@clocky/clocky-agent'
import { Session, SessionId } from '@clocky/clocky-session'
import { simulationDecisionIdSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { decisionInput } from '../src/input.ts'
import { modelAccess } from '../src/model.ts'
import { contextConsumption } from '../src/context-consumption.ts'

it('reads selected frozen chapters and submits only the exact current result reference', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const actor = await h.actor('reader'), id = simulationDecisionIdSchema.parse('observe')
    await actor.lease.openDecision(id, h.run.snapshot().revision)
    const prepared = await actor.lease.prepareContext(id, contextRequest())
    if (prepared.status !== 'prepared') throw new Error('context missing')
    const input = decisionInput(prepared.view)
    expect(input).toEqual(decisionInput(prepared.view))
    expect(input.content).toEqual([{ type: 'text', text: `A new simulation decision is open: ${prepared.view.inputId}. `
      + 'Call simulation_observe to read this decision’s current context before choosing actions. '
      + 'Earlier tool results and submissions belong to earlier decisions; they do not complete this one. '
      + 'Finish this decision with simulation_submit. If no action is needed, stage an empty proposal list and submit it. '
      + 'A written summary alone does not submit a decision.' }])
    const session = Session.create(SessionId('observing'))
    session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
    session.append('user/message', decisionInput(prepared.view), { surfaceOp: 'append' })
    // modelAccess only needs canonical input reconciliation; real Agent scheduling is exercised by Web replay.
    const agent = { session, inbox: { nextTurn: [], nextStep: [] }, cancel: vi.fn() } as unknown as Agent
    const access = modelAccess(agent, h.run, actor.lease, () => {}, () => {})
    const signal = new AbortController().signal
    const selected = await access({ kind: 'observe', sections: ['goals', 'identity'] }, signal)
    if (selected.status !== 'observed') throw new Error('observation missing')
    expect(selected.sections.map(value => value.kind)).toEqual(['identity', 'goals'])
    expect(selected.sections).toEqual(prepared.view.content.filter(value => value.kind === 'identity' || value.kind === 'goals'))
    for (const sections of [[], ['hidden'], ['identity', 'identity']])
      await expect(access({ kind: 'observe', sections }, signal)).rejects.toThrow(/distinct/)
    await expect(access({ kind: 'observe', sections: ['input'], detail: 'full' }, signal)).rejects.toThrow(/Choose/)
    const notification = { kind: 'communication/post' as const, recipient: actor.id, channelId: 'channel' as never,
      deliverAt: '0' as never, text: '{"resultId":"original","outcome":{"kind":"committed"}}' }
    const scope = { kind: 'result' as const, resultId: 'original' as never, intentId: 'intent' as never, baseRevision: 0, notification }
    vi.spyOn(actor.lease, 'readPreparedContext').mockResolvedValue({ ...prepared, world: scope })
    const snapshot = h.run.snapshot.bind(h.run)
    vi.spyOn(h.run, 'snapshot').mockImplementation(() => {
      const state = snapshot(), decision = state.decisions[id]!
      return { ...state, decisions: { ...state.decisions, [id]: { ...decision, context: { ...prepared, world: scope } } } }
    })
    const consumed = vi.spyOn(actor.lease, 'recordContextConsumption').mockResolvedValue(
      contextConsumption(snapshot().decisions[id]!, session.id, session.events))
    const submit = vi.spyOn(actor.lease, 'submitDecision').mockImplementation(async () => ({ ...snapshot().decisions[id]!, status: 'submitted' }))
    await expect(access({ kind: 'submit', notification: { resultId: 'other' } }, signal)).rejects.toThrow(/current frozen/)
    expect(submit).not.toHaveBeenCalled()
    await access({ kind: 'submit', notification: { resultId: 'original' } }, signal)
    expect(submit).toHaveBeenCalledExactlyOnceWith(id, [{ after: [], action: notification }])
    expect(consumed).toHaveBeenCalledOnce()
  } finally { await h.close() }
})

it('retains valid staging across rejected replacements and submits the corrected decision idempotently', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const actor = await h.actor('stager'), id = simulationDecisionIdSchema.parse('replacement')
    await actor.lease.openDecision(id, h.run.snapshot().revision)
    const prepared = await actor.lease.prepareContext(id, contextRequest())
    if (prepared.status !== 'prepared') throw new Error('context missing')
    const session = Session.create(SessionId('staging'))
    session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
    session.append('user/message', decisionInput(prepared.view), { surfaceOp: 'append' })
    const agent = { session, inbox: { nextTurn: [], nextStep: [] }, cancel: vi.fn() } as unknown as Agent
    const access = modelAccess(agent, h.run, actor.lease, () => {}, () => {})
    const signal = new AbortController().signal
    expect(await access({ kind: 'stage', proposals: [] }, signal)).toEqual({ status: 'staged', count: 0, effects: 'none' })
    await expect(access({ kind: 'stage', proposals: [{ action: { kind: 'unknown' } }] as never }, signal))
      .rejects.toThrow(/previous staged list is unchanged/)
    expect(h.run.snapshot().decisions[id]?.status).toBe('open')
    const first = await access({ kind: 'submit' }, signal)
    expect(await access({ kind: 'submit' }, signal)).toEqual(first)
    expect(first).toMatchObject({ status: 'accepted', operationIds: [] })
    expect(h.run.snapshot().decisions[id]?.operationIds).toEqual([])
    expect(Object.keys(h.run.snapshot().decisions)).toEqual([id])
  } finally { await h.close() }
})
