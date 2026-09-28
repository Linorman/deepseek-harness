import { afterEach, expect, it } from 'vitest'
import { simulationDispatchCandidateSchema, simulationDispatchSelectionRequestSchema, simulationDecisionIdSchema,
  simulationEventSlotSchema, simulationWindowRequestSchema, simulationWakeRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'
import { assertDispatchProjection, foldDispatch, openDispatch, selectDecisions } from '../src/dispatch.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const h = await createBusinessHarness('sqlite', { maxDispatchWaitRounds: 2 })
  cleanups.push(h.close)
  const actors = [await h.actor('a'), await h.actor('b'), await h.actor('c')]
  return { ...h, actors }
}
const candidate = (id: string, entityId: string, priority = 0, deadline?: string) =>
  simulationDispatchCandidateSchema.parse({ id, entityId, priority, ...deadline === undefined ? {} : { deadline } })
const selection = (id: string, limit = 1) => simulationDispatchSelectionRequestSchema.parse({ id, limit })

it('orders different deadlines and promotes all starved actors by durable FIFO rather than object key order', async () => {
  const h = await setup()
  for (const value of [candidate('early', 'a', 0, '2'), candidate('none', 'b'), candidate('late', 'c', 0, '10')]) await h.run.queueDecision(value)
  expect(selectDecisions(h.run.snapshot(), selection('deadlines', 3))).toEqual(['early', 'late', 'none'])
  for (const id of ['early', 'none', 'late']) await h.run.cancelQueuedDecision(simulationDecisionIdSchema.parse(id), h.run.snapshot().revision)
  await h.run.queueDecision(candidate('9', 'a', -100)); await h.run.queueDecision(candidate('8', 'b', -100))
  for (let index = 0; index < 2; index += 1) {
    const urgent = candidate(`urgent-${index}`, 'c', 100, '0')
    await h.run.queueDecision(urgent)
    const reserved = await h.run.reserveDecisionWindow(selection(`round-${index}`), h.run.snapshot().revision)
    expect(reserved!.decisions).toEqual([urgent.id])
    await h.run.cancelQueuedDecision(urgent.id, h.run.snapshot().revision)
  }
  await h.run.queueDecision(candidate('1', 'c', 100, '0'))
  expect(selectDecisions(h.run.snapshot(), selection('starved', 3))).toEqual(['9', '8', '1'])
})

it('requires a unique live wake and excludes a nomination whose wake has already been claimed', async () => {
  const h = await setup(), actor = h.actors[0]!
  const wake = simulationWakeRequestSchema.parse({ id: 'wake', entityId: actor.id, time: '0', reason: 'Work' })
  await h.run.scheduleWake(wake, h.run.snapshot().revision)
  await h.run.drive({ until: simTimeSchema.parse('0') })
  const item = { ...candidate('owned', actor.id), wakeId: wake.id }
  await h.run.queueDecision(item)
  await expect(h.run.queueDecision({ ...item, id: simulationDecisionIdSchema.parse('other') })).rejects.toThrow(/exclusive pending wake/)
  const state = h.run.snapshot()
  expect(() => foldDispatch(state, { kind: 'dispatch/queued', candidate: item })).toThrow(/new decision identity/)
  expect(selectDecisions({ ...state, wakes: { ...state.wakes, [wake.id]: { ...state.wakes[wake.id]!, status: 'claimed' } } }, selection('claimed')))
    .toEqual([])
})

it('rejects missing reservation owners and mismatched durable allocation projections', async () => {
  const h = await setup()
  for (const actor of h.actors) await h.run.queueDecision(candidate(actor.id, actor.id))
  const request = selection('reserved', 2)
  const reserved = await h.run.reserveDecisionWindow(request, h.run.snapshot().revision)
  const state = h.run.snapshot(), queue = state.decisionDispatch!
  const window = simulationWindowRequestSchema.parse({ id: request.id, decisions: reserved!.decisions.map(id => ({
    id, entityId: queue.tickets[id]!.candidate.entityId, context: contextRequest(),
  })) })
  expect(() => openDispatch({ ...state, decisionDispatch: { ...queue, selections: {} } }, window)).toThrow(/active allocation is missing/)
  expect(() => foldDispatch({ ...state, decisionDispatch: { ...queue, selections: {} } },
    { kind: 'dispatch/cancelled', id: reserved!.decisions[0]! })).toThrow(/reservation/)
  expect(() => { assertDispatchProjection({ ...state, decisionDispatch: { ...queue, selections: {} } }) }).toThrow(/active allocation/)
  expect(() => { assertDispatchProjection({ ...state, decisionDispatch: { ...queue, round: simulationEventSlotSchema.parse('0') } }) })
    .toThrow(/reservation is inconsistent/)
  const absent = { ...queue.tickets }
  Reflect.deleteProperty(absent, reserved!.decisions[0]!)
  expect(() => { assertDispatchProjection({ ...state, decisionDispatch: { ...queue, tickets: absent } }) }).toThrow(/lost its allocation/)
  expect(() => foldDispatch({ ...state, decisionDispatch: { ...queue, tickets: absent } },
    { kind: 'dispatch/cancelled', id: reserved!.decisions[1]! })).toThrow(/lost its nominated decision/)
  const opened = openDispatch(state, window)
  expect(() => { assertDispatchProjection(opened) }).toThrow(/allocated order/)
  const unselected = queue.tickets[simulationDecisionIdSchema.parse('c')]!
  const malformed = { ...state, decisionDispatch: { ...queue, tickets: { ...queue.tickets,
    [unselected.candidate.id]: { ...unselected, ordinal: simulationEventSlotSchema.parse('99') },
  } } }
  expect(() => { assertDispatchProjection(malformed) }).toThrow(/ownership or age/)
})

it('refuses a candidate whose retained key disagrees with its decision identity', async () => {
  const h = await setup()
  const item = candidate('candidate', h.actors[0]!.id)
  await h.run.queueDecision(item)
  const state = h.run.snapshot(), queue = state.decisionDispatch!
  const corrupted = { ...state, decisionDispatch: { ...queue,
    tickets: { [simulationDecisionIdSchema.parse('wrong-key')]: queue.tickets[item.id]! } } }
  expect(() => foldDispatch(corrupted, { kind: 'dispatch/reserved', request: selection('allocation'), decisions: [item.id] }))
    .toThrow(/lost its nominated decision/)
})
