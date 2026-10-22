/** The shared SDK parser consumes common results while hiring references remain domain payload. */
import { expect, it } from 'vitest'
import { simulationWorldCaseResultSchema } from '../src/simulation.ts'

function lifecycle(status: string, resultId = 'result') {
  const business = ['committed', 'rejected', 'cancelled'].includes(status) ? { status, resultId } : { status: 'none' }
  return { request: { status }, plan: { status: 'none' }, execution: { callback: { status: 'none' }, business },
    notification: { request: null } }
}

const worldExecutionResult = {
  runId: 'run', snapshotRevision: 4, readVersion: 'policy', observedAt: 1, requestId: 'case', section: 'execution', status: 'found',
  value: { section: 'execution', summary: { apiVersion: 'clocky.world-case/v4', businessSummary: { status: 'unsupported' }, origin: { kind: 'decision' }, domain: 'organization', operation: 'generate-and-hire', version: '1', requestId: 'case', intentId: 'intent', status: 'committed', lifecycle: lifecycle('committed'), requesterEntityId: 'requester',
    organizationEntityId: 'organization', targetEntityId: 'position', cancel: { allowed: false, reason: 'terminal' } },
  result: { id: 'result', sequence: 4, time: '5', source: { kind: 'plan', planId: 'plan' },
    outcome: { kind: 'committed' }, payload: { entityId: 'newborn', relationId: 'assignment' } },
  reservation: { id: 'intent', planId: 'plan', status: 'committed', sequence: 3, updatedSequence: 4,
    newborn: { entityId: 'newborn', readiness: 'ready', phase: 'active' }, assignment: { relationId: 'assignment', status: 'retained' } } },
}

it('strictly parses hiring references from common result payload and retains its original reservation', () => {
  expect(simulationWorldCaseResultSchema.parse(worldExecutionResult)).toEqual(worldExecutionResult)
})

it.each([
  { ...worldExecutionResult.value.result, outcome: { kind: 'committed', entityId: 'newborn', relationId: 'assignment' } },
  { ...worldExecutionResult.value.result, payload: { entityId: 'replacement', relationId: 'assignment' } },
  { ...worldExecutionResult.value.result, payload: { entityId: 'newborn', relationId: 'replacement' } },
  { ...worldExecutionResult.value.result, payload: { entityId: 'newborn' } },
  { ...worldExecutionResult.value.result, payload: { relationId: 'assignment' } },
  { ...worldExecutionResult.value.result, payload: { entityId: 'newborn', relationId: 'assignment', privateRationale: 'secret' } },
  { ...worldExecutionResult.value.result, payload: undefined },
  { ...worldExecutionResult.value.result, source: { kind: 'plan', planId: 'replacement' } },
])('returns a failed safeParse for malformed or substituted hiring payload instead of throwing: %j', (result) => {
  expect(simulationWorldCaseResultSchema.safeParse({ ...worldExecutionResult, value: { ...worldExecutionResult.value, result } }).success)
    .toBe(false)
})

it('accepts a JSON domain result without allocating a hiring reservation', () => {
  const { reservation: _reservation, ...value } = worldExecutionResult.value
  const result = { ...value.result, payload: { bookingId: 'booking', roomEntityId: 'room', interval: { from: '5', until: '10' } } }
  const response = { ...worldExecutionResult, value: { ...value, summary: { ...value.summary,
    domain: 'facility', operation: 'reserve-room', version: '1', targetEntityId: 'room' }, result } }
  expect(simulationWorldCaseResultSchema.parse(response)).toEqual(response)
})

it('requires an explicit null for a scenario notification with no Channel post and refuses invented post fields', () => {
  const response = { ...worldExecutionResult, section: 'notification', value: { section: 'notification',
    summary: worldExecutionResult.value.summary, request: null,
    result: { resultId: 'result', wake: { id: 'scenario-result-wake', status: 'completed', decisionId: 'result-decision' } } } }
  response.value.summary = { ...response.value.summary, lifecycle: { ...response.value.summary.lifecycle,
    notification: { request: null, result: response.value.result } } as typeof response.value.summary.lifecycle }
  expect(simulationWorldCaseResultSchema.parse(response)).toEqual(response)
  const { request: _request, ...withoutRequest } = response.value
  expect(simulationWorldCaseResultSchema.safeParse({ ...response, value: withoutRequest }).success).toBe(false)
  expect(simulationWorldCaseResultSchema.safeParse({ ...response, value: { ...response.value,
    request: { kind: 'director-event', channelId: 'self', envelopeId: 'fabricated' } } }).success).toBe(false)
})

it.each([NaN, Infinity, { nested: [Number.NEGATIVE_INFINITY] }, { callback: () => undefined }, { values: new Set(['value']) }])(
  'rejects non-JSON generic result payloads: %j', (payload) => {
    const { reservation: _reservation, ...value } = worldExecutionResult.value
    expect(simulationWorldCaseResultSchema.safeParse({ ...worldExecutionResult, value: { ...value,
      summary: { ...value.summary, domain: 'facility', operation: 'reserve-room' },
      result: { ...value.result, payload } } }).success).toBe(false)
  },
)
