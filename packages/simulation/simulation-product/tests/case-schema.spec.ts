/** Public case parsing preserves owned references and independently withheld disclosure domains. */
import { expect, it } from 'vitest'
import { simulationProductWorldCasesInputSchema, simulationProductWorldCasesPageSchema,
  simulationProductWorldCaseInputSchema, simulationProductWorldCaseInspectionSchema,
  simulationProductWorldCaseCancelCapabilitySchema } from '../src/case-schema.ts'

function lifecycle(status: string, resultId = 'result') {
  const business = ['committed', 'rejected', 'cancelled'].includes(status) ? { status, resultId } : { status: 'none' }
  return { request: { status }, plan: { status: 'none' }, execution: { callback: { status: 'none' }, business },
    notification: { request: null } }
}

const text = (text: string) => ({ text, truncated: false })
const envelope = { runId: 'public-run', snapshotRevision: 100, readVersion: 'policy-original', observedAt: 1 }
const summary = { apiVersion: 'clocky.world-case/v4', businessSummary: { status: 'unsupported' }, origin: { kind: 'decision' }, domain: 'organization', operation: 'generate-and-hire', version: '1',
  requestId: 'case-original', intentId: 'intent-original', status: 'open', lifecycle: lifecycle('open'), requesterEntityId: 'requester',
  organizationEntityId: 'organization', targetEntityId: 'position', cancel: { allowed: false, reason: 'recovery-required' } }
const plan = { id: 'plan-original', operationId: 'operation-original', sequence: 10, hash: 'sha256:original', predecessor: null,
  status: 'accepted', resolution: 'apply', rationale: { status: 'withheld' }, persona: { status: 'withheld' } }
const reservation = { id: 'intent-original', planId: 'plan-original', status: 'committed', sequence: 11, updatedSequence: 20,
  newborn: { entityId: 'newborn-original', readiness: 'ready', phase: 'active' },
  assignment: { relationId: 'assignment-original', status: 'retained' } }
const result = { id: 'result-original', sequence: 20, time: '9007199254740993', source: { kind: 'plan', planId: 'plan-original' },
  outcome: { kind: 'committed' }, payload: { entityId: 'newborn-original', relationId: 'assignment-original' } }
const committed = { ...summary, status: 'committed', lifecycle: lifecycle('committed', 'result-original'), cancel: { allowed: false, reason: 'terminal' } }
const post = { operationId: 'notification-original', status: 'pending', publication: 'unpublished',
  delivery: 'not-received', channelId: 'channel-original' }
/** Build one internally consistent fixture prefix; explicit wire-disagreement tests bypass this factory. */
function inspection(section: 'request' | 'plans' | 'execution' | 'notification', value: unknown) {
  const detail = value as {
    summary: typeof summary
    items?: typeof plan[]
    total?: number
    nextCursor?: string
    observation?: unknown
    result?: typeof result
    request?: unknown
    firstAction?: unknown
  }
  let tracks: unknown = detail.summary.lifecycle
  if (section === 'plans') tracks = { ...detail.summary.lifecycle, plan: detail.total === 0 ? { status: 'none' }
    : detail.items?.at(-1) === undefined ? detail.summary.lifecycle.plan : {
      id: detail.items.at(-1)!.id, status: detail.items.at(-1)!.status, resolution: detail.items.at(-1)!.resolution } }
  if (section === 'execution') tracks = { ...detail.summary.lifecycle, execution: { callback: detail.observation ?? { status: 'none' },
    business: detail.result === undefined ? { status: 'none' } : { status: detail.result.outcome.kind, resultId: detail.result.id } } }
  if (section === 'notification') tracks = { ...detail.summary.lifecycle, notification: { request: detail.request,
    ...detail.result === undefined ? {} : { result: detail.result },
    ...detail.firstAction === undefined ? {} : { firstAction: detail.firstAction } } }
  return { ...envelope, requestId: summary.requestId, section, status: 'found',
    value: { ...detail, summary: { ...detail.summary, lifecycle: tracks } } }
}
const request = { section: 'request', summary, source: { kind: 'decision', operationId: 'request-operation', sequence: 1, payloadHash: 'sha256:request' },
  description: { status: 'withheld' } }
const plans = { section: 'plans', summary, total: 1, items: [plan] }
const execution = { section: 'execution', summary: committed, reservation, result }
const notification = { section: 'notification', summary, request: post, result: { resultId: result.id,
  wake: { id: 'result-wake', status: 'completed', decisionId: 'notification-decision' } } }

it('keeps uncertain callbacks separate from committed business and rejects invented execution observations', () => {
  const observation = { planId: plan.id, mode: 'execute', sequence: 21, updates: 2, time: '5',
    status: 'outcome-unknown', reason: 'callback-unconfirmed' }
  expect(simulationProductWorldCaseInspectionSchema.parse(inspection('execution', { ...execution, observation })))
    .toMatchObject({ value: { result, observation } })
  for (const patch of [{ status: 'settled' }, { reason: null }, { reason: 'arbitrary-error' },
    { privateDiagnostic: 'secret' }, { updates: 0 }, { sequence: -1 }]) {
    expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('execution', {
      ...execution, observation: { ...observation, ...patch } })).success).toBe(false)
  }
})

it('keeps original personnel and shared external duties distinct from business completion', () => {
  const personnel = { kind: 'personnel', id: summary.intentId, planId: 'plan-original', status: 'blocked', sequence: 3, updatedSequence: 4 }
  const representative = { ...personnel, kind: 'representative', id: 'original-shared-representative', status: 'preparing' }
  const contact = { ...personnel, kind: 'contact', status: 'reserved' }
  const selected = { section: 'execution', summary: { ...summary, operation: 'depart' }, responsibilities: [personnel] }
  const external = { ...selected, summary: { ...summary, domain: 'external', operation: 'interact', version: '3' },
    responsibilities: [representative, contact] }
  for (const value of [selected, external]) expect(simulationProductWorldCaseInspectionSchema.parse(inspection('execution', value)))
    .toMatchObject({ value })
  for (const value of [
    { ...selected, summary },
    { ...selected, responsibilities: [{ ...personnel, status: 'outcome-unknown' }] },
    { ...selected, responsibilities: [{ ...personnel, status: 'committed' }] },
    { ...selected, responsibilities: [{ ...personnel, status: 'cancelled' }] },
    { ...selected, responsibilities: [{ ...personnel, id: 'other-case' }] },
    { ...selected, responsibilities: [{ ...personnel, updatedSequence: 2 }] },
    { ...selected, responsibilities: [personnel, personnel] },
    { ...external, responsibilities: [representative, { ...contact, status: 'preparing' }] },
    { ...external, responsibilities: [{ ...representative, privatePersona: 'secret' }] },
    { ...selected, responsibilities: [] },
  ]) expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('execution', value)).success).toBe(false)
})

it('preserves original bounded case metadata and all four independent finite sections', () => {
  const page = { ...envelope, total: 1, items: [summary] }
  expect(simulationProductWorldCasesPageSchema.parse(page)).toEqual(page)
  for (const [section, value] of [['request', request], ['plans', plans], ['execution', execution], ['notification', notification]] as const) {
    expect(simulationProductWorldCaseInspectionSchema.parse(inspection(section, value))).toEqual(inspection(section, value))
  }
  const absent = { ...envelope, requestId: summary.requestId, section: 'request', status: 'missing' }
  expect(simulationProductWorldCaseInspectionSchema.parse(absent)).toEqual(absent)
})

it('rejects old summaries and relates domain-specific Persona and reservation data to the exact selector', () => {
  const { apiVersion: _api, domain: _domain, operation: _operation, version: _version,
    targetEntityId: _target, ...old } = summary
  expect(simulationProductWorldCasesPageSchema.safeParse({ ...envelope, total: 1,
    items: [{ ...old, positionEntityId: 'position' }] }).success).toBe(false)
  expect(simulationProductWorldCasesPageSchema.safeParse({ ...envelope, total: 1,
    items: [{ ...summary, positionEntityId: 'alias' }] }).success).toBe(false)
  const generic = { ...summary, domain: 'external', operation: 'interact', version: '3', targetEntityId: 'vendor' }
  const noPersona = { ...plan, persona: { status: 'not-applicable' } }
  expect(simulationProductWorldCaseInspectionSchema.parse(inspection('plans', { ...plans, summary: generic, items: [noPersona] })))
    .toMatchObject({ value: { items: [noPersona] } })
  expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('plans', { ...plans, summary: generic, items: [plan] })).success)
    .toBe(false)
  for (const patch of [{ domain: 'other' }, { operation: 'other' }, { version: '2' }]) {
    expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('execution', { ...execution,
      summary: { ...committed, ...patch } })).success).toBe(false)
  }
  const ordinaryResult = { ...result, payload: { observationId: 'original-observation' } }
  expect(simulationProductWorldCaseInspectionSchema.parse(inspection('execution', { section: 'execution',
    summary: { ...generic, status: 'committed', lifecycle: lifecycle('committed', 'result-original') }, result: ordinaryResult }))).toMatchObject({ value: { result: ordinaryResult } })
})

it('separates case prose grants from generated Persona disclosure', () => {
  const disclosed = { status: 'allowed', templateId: text('researcher'), templateVersion: text('1'), name: text('Lin'),
    skills: [text('analysis')], traits: [text('patient')], goals: [text('research')] }
  for (const selected of [{ ...plan, rationale: { status: 'allowed', text: text('Private case rationale') } },
    { ...plan, persona: disclosed }, { ...plan, rationale: { status: 'allowed', text: text('Private case rationale') }, persona: disclosed }]) {
    const value = { ...plans, items: [selected] }
    expect(simulationProductWorldCaseInspectionSchema.parse(inspection('plans', value))).toEqual(inspection('plans', value))
  }
  for (const persona of [{ status: 'withheld', name: text('private') }, { status: 'allowed', name: text('partial') },
    { ...disclosed, model: 'private-route' }]) {
    expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('plans', { ...plans, items: [{ ...plan, persona }] })).success).toBe(false)
  }
  for (const description of [{ status: 'withheld', text: text('private') }, { status: 'allowed', text: 'unbounded raw body' }]) {
    expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('request', { ...request, description })).success).toBe(false)
  }
})

it('refuses duplicate case or plan identities and totals that omit returned rows', () => {
  for (const value of [{ ...envelope, total: 2, items: [summary, summary] }, { ...envelope, total: 0, items: [summary] }]) {
    expect(simulationProductWorldCasesPageSchema.safeParse(value).success).toBe(false)
  }
  for (const value of [{ ...plans, total: 2, items: [plan, plan] }, { ...plans, total: 0 }]) {
    expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('plans', value)).success).toBe(false)
  }
  const successor = { ...plan, id: 'plan-successor', operationId: 'operation-successor', sequence: 12, predecessor: plan.id }
  const partial = { ...plans, total: 3, items: [successor], nextCursor: 'opaque-continuation' }
  expect(simulationProductWorldCaseInspectionSchema.parse(inspection('plans', partial))).toEqual(inspection('plans', partial))
})

it.each([
  { ...execution, reservation: undefined },
  { ...execution, reservation: { ...reservation, id: 'another-intent' } },
  { ...execution, reservation: { ...reservation, status: 'preparing' } },
  { ...execution, reservation: { ...reservation, updatedSequence: 10 } },
  { ...execution, reservation: { ...reservation, newborn: { ...reservation.newborn, readiness: 'preparing' } } },
  { ...execution, reservation: { ...reservation, assignment: { ...reservation.assignment, status: 'absent' } } },
  { ...execution, result: undefined },
  { ...execution, result: { ...result, source: { kind: 'plan', planId: 'another-plan' } } },
  { ...execution, result: { ...result, sequence: 21 } },
  { ...execution, result: { ...result, outcome: { ...result.outcome, entityId: 'another-person' } } },
  { ...execution, result: { ...result, outcome: { ...result.outcome, relationId: 'another-assignment' } } },
  { ...execution, result: { ...result, source: { kind: 'cancel', commandId: 'another-source' } } },
  { ...execution, summary },
])('refuses partial or foreign original committed ownership: %j', (value) => {
  expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('execution', value)).success).toBe(false)
})

it('preserves later inactive or terminated newborn phases without rewriting the committed result', () => {
  for (const phase of ['inactive', 'terminated']) {
    const value = { ...execution, reservation: { ...reservation, newborn: { ...reservation.newborn, phase } } }
    expect(simulationProductWorldCaseInspectionSchema.parse(inspection('execution', value))).toEqual(inspection('execution', value))
  }
  const pending = { section: 'execution', summary, reservation: { ...reservation, status: 'reserved', updatedSequence: 11,
    newborn: { ...reservation.newborn, phase: 'absent', readiness: 'absent' }, assignment: { ...reservation.assignment, status: 'absent' } } }
  expect(simulationProductWorldCaseInspectionSchema.parse(inspection('execution', pending))).toEqual(inspection('execution', pending))
  const cancelled = { ...execution, summary: { ...committed, status: 'cancelled', lifecycle: lifecycle('cancelled', 'result-original') },
    reservation: { ...reservation, status: 'abandoned', newborn: { ...reservation.newborn, phase: 'terminated', readiness: 'abandoned' },
      assignment: { ...reservation.assignment, status: 'absent' }, cleanup: { sequence: 20, participant: 'left' } },
    result: { ...result, source: { kind: 'cancel', commandId: 'cancel-original' }, outcome: { kind: 'cancelled' } } }
  expect(simulationProductWorldCaseInspectionSchema.parse(inspection('execution', cancelled))).toEqual(inspection('execution', cancelled))
  for (const patch of [{ phase: 'active' }, { readiness: 'preparing' }]) {
    expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('execution', { ...cancelled,
      reservation: { ...cancelled.reservation, newborn: { ...cancelled.reservation.newborn, ...patch } } })).success).toBe(false)
  }
})

it('requires original stale and cleanup transitions while preserving predecessor and source facts', () => {
  const stale = { ...plan, status: 'stale', stale: { phase: 'execution', reason: 'read-set-changed', sequence: 12 } }
  expect(simulationProductWorldCaseInspectionSchema.parse(inspection('plans', { ...plans, items: [stale] })).value)
    .toEqual(inspection('plans', { ...plans, items: [stale] }).value)
  for (const item of [{ ...plan, status: 'stale' }, { ...plan, stale: stale.stale },
    { ...stale, stale: { ...stale.stale, sequence: 9 } }, { ...plan, persona: { status: 'not-applicable' } }]) {
    expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('plans', { ...plans, items: [item] })).success).toBe(false)
  }
  for (const cleanup of [{ sequence: 20, participant: 'left' }, { sequence: 19, participant: 'left' }]) {
    expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('execution',
      { ...execution, reservation: { ...reservation, cleanup } })).success).toBe(false)
  }
})

it('keeps a completed result wake distinct from publication and durable receipt', () => {
  const parsed = simulationProductWorldCaseInspectionSchema.parse(inspection('notification', notification))
  expect(parsed.value).toEqual(inspection('notification', notification).value)
  for (const value of [{ ...post, delivery: 'received' }, { ...post, envelopeId: 'fabricated-envelope' },
    { ...post, publication: 'published' }, { ...post, text: 'private notification body' }]) {
    expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('notification', { ...notification, request: value })).success).toBe(false)
  }
  const delivered = { ...post, publication: 'published', delivery: 'received', envelopeId: 'original-envelope' }
  expect(simulationProductWorldCaseInspectionSchema.parse(inspection('notification',
    { ...notification, request: delivered })).value).toEqual(inspection('notification', { ...notification, request: delivered }).value)
})

it('rejects unsupported selectors, private transport fields, mismatched section identities and unsafe counters', () => {
  expect(simulationProductWorldCasesInputSchema.parse({ runId: 'public-run', status: 'open', expectedRevision: 100, limit: 1 }))
    .toEqual({ runId: 'public-run', status: 'open', expectedRevision: 100, limit: 1 })
  for (const patch of [{ provider: 'private' }, { principal: 'owner' }, { status: 'unknown' }, { limit: 0 },
    { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
    expect(simulationProductWorldCasesInputSchema.safeParse({ runId: 'public-run', ...patch }).success).toBe(false)
  }
  for (const patch of [{ section: 'session' }, { section: 'request', cursor: 'opaque' }, { requestId: '' },
    { actor: 'private' }, { expectedRevision: -1 }, { readVersion: '' }]) {
    expect(simulationProductWorldCaseInputSchema.safeParse({ runId: 'public-run', requestId: summary.requestId, section: 'plans', ...patch })
      .success).toBe(false)
  }
  for (const patch of [{ requestId: 'another-case' }, { section: 'execution' }, { status: 'missing' }, { native: { private: 'body' } }]) {
    expect(simulationProductWorldCaseInspectionSchema.safeParse({ ...inspection('request', request), ...patch }).success).toBe(false)
  }
  expect(simulationProductWorldCaseCancelCapabilitySchema.safeParse({ allowed: true, reason: 'ready' }).success).toBe(false)
  expect(simulationProductWorldCaseCancelCapabilitySchema.safeParse({ allowed: true, reason: 'recovery-required' }).success).toBe(false)
  expect(simulationProductWorldCaseCancelCapabilitySchema.safeParse({ allowed: false, reason: 'ready' }).success).toBe(false)
})

it('preserves waiting cases and plans while refusing unknown variants or invented Persona', () => {
  const waiting = { ...summary, status: 'awaiting-evidence', lifecycle: lifecycle('awaiting-evidence') }
  const waitingPlan = { ...plan, resolution: 'awaiting-evidence', persona: { status: 'not-applicable' } }
  const page = { ...envelope, total: 1, items: [waiting] }
  expect(simulationProductWorldCasesPageSchema.parse(page)).toEqual(page)
  expect(simulationProductWorldCasesInputSchema.parse({ runId: 'run', status: 'awaiting-evidence' }).status).toBe('awaiting-evidence')
  const detail = inspection('plans', { ...plans, summary: waiting, items: [waitingPlan] })
  expect(simulationProductWorldCaseInspectionSchema.parse(detail)).toEqual(detail)
  for (const changed of [{ ...waitingPlan, resolution: 'awaiting-evidence/v2' },
    { ...waitingPlan, persona: { status: 'withheld' } }, { ...waitingPlan, challenge: { responders: ['other'] } }])
    expect(simulationProductWorldCaseInspectionSchema.safeParse(
      inspection('plans', { ...plans, summary: waiting, items: [changed] })).success).toBe(false)
  expect(simulationProductWorldCasesPageSchema.safeParse({ ...page,
    items: [{ ...waiting, status: 'waiting-for-anything' }] }).success).toBe(false)
})

it('bounds evidence projection to latest records and separates answer text disclosure from trusted field descriptions', () => {
  const challenge = { id: 'challenge', status: 'answered', round: 1, fields: [{ code: 'invoice', description: text('Original invoice') }],
    responders: ['requester'], deadline: '100', maxAttempts: 2, attemptsUsed: 1 }
  const revision = { id: 'revision', revision: 1, sequence: 20, actorId: 'requester', answers: { status: 'withheld' } }
  const evidence = { inputRevision: 1, latestChallenge: challenge, latestRevision: revision }
  const value = inspection('request', { ...request, evidence })
  expect(simulationProductWorldCaseInspectionSchema.parse(value)).toEqual(value)
  const allowed = { ...evidence, latestRevision: { ...revision,
    answers: { status: 'allowed', items: [{ field: 'invoice', text: text('Receipt from the authorized answer') }] } } }
  expect(simulationProductWorldCaseInspectionSchema.parse(inspection('request', { ...request, evidence: allowed })))
    .toEqual(inspection('request', { ...request, evidence: allowed }))
  for (const changed of [{ ...evidence, inputRevision: 2 }, { ...evidence, revisions: [revision] },
    { ...evidence, latestChallenge: { ...challenge, responders: ['requester', 'requester'] } },
    { ...evidence, latestChallenge: { ...challenge, fields: [...challenge.fields, ...challenge.fields] } },
    { ...evidence, latestChallenge: { ...challenge, deadline: '01' } },
    { ...evidence, latestChallenge: { ...challenge, attemptsUsed: 3 } },
    { ...evidence, latestRevision: { ...revision, binding: { sessionId: 'private' } } },
    { ...evidence, latestRevision: { ...revision, answers: { status: 'withheld', items: allowed.latestRevision.answers.items } } }])
    expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('request', { ...request, evidence: changed })).success).toBe(false)
})

it.each(['evidence-deadline', 'evidence-exhausted'] as const)(
  'preserves %s provenance without relabeling it as cancellation or business plan', (kind) => {
    const expired = { ...summary, status: 'rejected', lifecycle: lifecycle('rejected', 'result-original') }
    const deadline = { ...result, source: { kind, challengeId: 'challenge', ...kind === 'evidence-deadline' ? { eventId: 'deadline' } : { decisionId: 'decision' } },
      outcome: { kind: 'rejected', reason: 'insufficient-information' }, payload: {} }
    const value = inspection('execution', { section: 'execution', summary: expired, result: deadline })
    expect(simulationProductWorldCaseInspectionSchema.parse(value)).toEqual(value)
    for (const changed of [{ ...deadline, source: { ...deadline.source, commandId: 'fabricated' } },
      { ...deadline, source: { kind, challengeId: 'challenge' } },
      { ...deadline, source: { kind, challengeId: 'challenge',
        ...kind === 'evidence-deadline' ? { decisionId: 'wrong-kind' } : { eventId: 'wrong-kind' } } },
      { ...deadline, outcome: { kind: 'rejected', reason: 'policy' } }])
      expect(simulationProductWorldCaseInspectionSchema.safeParse(inspection('execution',
        { section: 'execution', summary: expired, result: changed })).success).toBe(false)
  })

it('requires strict v2 lifecycle tracks and keeps committed business independent of an unknown callback and notification', () => {
  const callback = { planId: 'plan-original', mode: 'execute', sequence: 21, updates: 2, time: '5',
    status: 'outcome-unknown', reason: 'callback-unconfirmed' }
  const tracks = { ...committed.lifecycle, plan: { id: 'plan-original', status: 'accepted', resolution: 'apply' },
    execution: { ...committed.lifecycle.execution, callback },
    notification: { request: post, result: { resultId: 'result-original', wake: { id: 'wake', status: 'completed' },
      post: { ...post, status: 'outcome-unknown', publication: 'unknown' } } } }
  const original = { ...committed, lifecycle: tracks }
  const page = { ...envelope, total: 1, items: [original] }
  expect(simulationProductWorldCasesPageSchema.parse(page)).toEqual(page)
  const { lifecycle: _tracks, ...old } = original
  for (const item of [{ ...original, apiVersion: 'clocky.world-case/v1' }, old,
    { ...original, lifecycle: { ...tracks, request: { status: 'open' } } },
    { ...original, lifecycle: { ...tracks, execution: { ...tracks.execution, business: { status: 'none' } } } },
    { ...original, lifecycle: { ...tracks, privatePayload: 'secret' } },
    { ...original, lifecycle: { ...tracks, plan: { status: 'none', id: 'invented' } } },
    { ...original, lifecycle: { ...tracks, execution: { ...tracks.execution, callback: { ...callback, reason: null } } } },
    { ...original, lifecycle: { ...tracks, notification: {} } }]) {
    expect(simulationProductWorldCasesPageSchema.safeParse({ ...page, items: [item] }).success).toBe(false)
  }
})

it('refuses detail tracks from another prefix while allowing a genuinely intermediate plan page', () => {
  const executed = simulationProductWorldCaseInspectionSchema.parse(inspection('execution', execution))
  if (executed.value?.section !== 'execution') throw new Error('Missing original execution fixture')
  const callback = { planId: plan.id, mode: 'execute', sequence: 21, updates: 2, time: '5',
    status: 'outcome-unknown', reason: 'callback-unconfirmed' }
  for (const value of [{ ...executed.value, observation: callback },
    { ...executed.value, summary: { ...executed.value.summary, lifecycle: { ...executed.value.summary.lifecycle,
      execution: { ...executed.value.summary.lifecycle.execution, callback } } } },
    { ...executed.value, result: { ...result, id: 'another-result' } },
    { ...executed.value, result: undefined }])
    expect(simulationProductWorldCaseInspectionSchema.safeParse({ ...executed, value }).success).toBe(false)
  const notified = simulationProductWorldCaseInspectionSchema.parse(inspection('notification', notification))
  if (notified.value?.section !== 'notification') throw new Error('Missing original notification fixture')
  for (const value of [{ ...notified.value, request: null },
    { ...notified.value, result: { resultId: 'another-result', wake: { id: 'different-wake', status: 'scheduled' } } },
    { ...notified.value, firstAction: { wake: { id: 'extra-wake', status: 'scheduled' } } }])
    expect(simulationProductWorldCaseInspectionSchema.safeParse({ ...notified, value }).success).toBe(false)
  const planned = simulationProductWorldCaseInspectionSchema.parse(inspection('plans', plans))
  if (planned.value?.section !== 'plans') throw new Error('Missing original plan fixture')
  const intermediate = { ...planned, value: { ...planned.value, total: 2, nextCursor: 'next-page',
    items: [{ ...plan, id: 'earlier-plan' }] } }
  expect(simulationProductWorldCaseInspectionSchema.safeParse(intermediate).success).toBe(true)
  expect(simulationProductWorldCaseInspectionSchema.safeParse({ ...intermediate,
    value: { ...intermediate.value, nextCursor: undefined } }).success).toBe(false)
  expect(simulationProductWorldCaseInspectionSchema.safeParse({ ...planned,
    value: { ...planned.value, total: 0, items: [] } }).success).toBe(false)
})
