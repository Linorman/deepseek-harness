/** Evidence schema checks do not replace Native responder, clock or source-visibility admission. */
import { expect, it } from 'vitest'
import { simulationWorldEvidenceAskSchema as askSchema, simulationWorldEvidenceSupplySchema as supplySchema,
  simulationWorldEvidenceChallengeSchema as challengeSchema, simulationWorldEvidenceRevisionSchema as revisionSchema,
  simulationWorldEvidenceFieldSchema as fieldSchema, simulationContextReferenceSchema } from '../src/index.ts'
import { simulationContextRequestSchema } from '../src/context.ts'

const references = [{ kind: 'run-event', runId: 'run', sequence: 1 },
  { kind: 'team-envelope', teamId: 'team', channelId: 'channel', envelopeId: 'envelope' }]
const answers = [{ field: 'invoice', text: 'Original observed invoice', references }]
const source = { decisionId: 'decision', operationId: 'operation', epoch: '1',
  binding: { teamId: 'team', participantId: 'participant', sessionId: 'session' } }
const ask = { kind: 'awaiting-evidence', missingFields: ['invoice'], deadline: '100', maxAttempts: 2, rationale: 'Invoice is missing' }
const supply = { kind: 'world/evidence', requestId: 'request', challengeId: 'challenge', expectedInputRevision: 0, answers }
const challenge = { id: 'challenge', requestId: 'request', planId: 'plan', inputRevision: 0, round: 1,
  fields: [{ code: 'invoice', description: 'Supply the original invoice' }], responders: ['requester'], deadline: '100', maxAttempts: 2,
  notificationOperationId: 'notify', source, sequence: 3, status: 'awaiting' }
const revision = { id: 'revision', requestId: 'request', challengeId: 'challenge', revision: 1, answers,
  source: { ...source, actorId: 'requester' }, notificationOperationId: 'notify-answer', sequence: 5, time: '99', hash: `sha256:${'a'.repeat(64)}` }

it('preserves exact text answers and provenance without filling authority or allocating revisions', () => {
  expect(askSchema.parse(ask)).toEqual(ask)
  expect(supplySchema.parse(supply)).toEqual(supply)
  expect(challengeSchema.parse(challenge)).toEqual(challenge)
  expect(revisionSchema.parse(revision)).toEqual(revision)
  expect(fieldSchema.parse(challenge.fields[0])).toEqual(challenge.fields[0])
})

it.each([
  { ...ask, responders: ['other'] }, { ...ask, actorId: 'other' }, { ...ask, missingFields: [] },
  { ...ask, missingFields: ['invoice', 'invoice'] }, { ...ask, rationale: '' }, { ...ask, deadline: '01' },
  { ...ask, deadline: -1 }, { ...ask, deadline: '1.5' }, { ...ask, maxAttempts: 0 }, { ...ask, maxAttempts: 1.5 },
  { ...ask, maxAttempts: Number.MAX_SAFE_INTEGER + 1 }, { ...ask, maxAttempts: '2' }, { ...ask, kind: 'awaiting-evidence/v2' },
])('rejects invalid or authority-expanding evidence resolutions: %j', (value) => {
  expect(askSchema.safeParse(value).success).toBe(false)
})

it.each([
  { ...supply, actorId: 'other' }, { ...supply, sessionId: 'other' }, { ...supply, binding: source.binding },
  { ...supply, expectedInputRevision: -1 }, { ...supply, expectedInputRevision: 1.5 },
  { ...supply, expectedInputRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...supply, expectedInputRevision: '1' },
  { ...supply, answers: [] }, { ...supply, answers: [answers[0], answers[0]] },
  { ...supply, answers: [{ ...answers[0], text: '' }] }, { ...supply, answers: [{ ...answers[0], text: { patch: true } }] },
  { ...supply, answers: [{ ...answers[0], actorId: 'other' }] },
  { ...supply, answers: [{ ...answers[0], references: [{ kind: 'session', sessionId: 'secret' }] }] },
  { ...supply, kind: 'world/evidence/v2' },
])('rejects forged supply authority, unsupported versions and invalid answers: %j', (value) => {
  expect(supplySchema.safeParse(value).success).toBe(false)
})

it('requires terminal challenge evidence without allowing a settlement to precede creation', () => {
  for (const status of ['answered', 'expired', 'exhausted', 'cancelled']) {
    const terminal = { ...challenge, status, settledSequence: 4,
      ...status === 'answered' ? { responseRevisionId: 'revision' } : {} }
    expect(challengeSchema.parse(terminal)).toEqual(terminal)
    expect(challengeSchema.safeParse({ ...terminal, settledSequence: undefined }).success).toBe(false)
    for (const settledSequence of [0, 2, 3, 3.5, Number.MAX_SAFE_INTEGER + 1])
      expect(challengeSchema.safeParse({ ...terminal, settledSequence }).success).toBe(false)
    expect(challengeSchema.safeParse({ ...terminal,
      responseRevisionId: status === 'answered' ? undefined : 'unrelated' }).success).toBe(false)
  }
  for (const change of [{ settledSequence: 4 }, { responseRevisionId: 'revision' }, { status: 'unknown' },
    { fields: [] }, { fields: [challenge.fields[0], challenge.fields[0]] }, { responders: [] },
    { responders: ['requester', 'requester'] }, { round: 0 }, { inputRevision: -1 }, { deadline: '001' },
    { source: { ...source, actorId: 'injected' } }])
    expect(challengeSchema.safeParse({ ...challenge, ...change }).success).toBe(false)
})

it('rejects invalid accepted revisions without coercing their time, version, hash or actual source', () => {
  for (const change of [{ revision: 0 }, { revision: 1.5 }, { revision: '1' }, { sequence: 0 },
    { time: '-1' }, { time: '01' }, { time: 1 }, { time: '1.5' }, { hash: 'a'.repeat(64) },
    { hash: `sha256:${'A'.repeat(64)}` }, { hash: `sha256:${'a'.repeat(63)}` },
    { source: { ...source } }, { source: { ...revision.source, epoch: '0' } }, { version: 2 }])
    expect(revisionSchema.safeParse({ ...revision, ...change }).success).toBe(false)
})

it('rejects unknown keys and missing required fields throughout the original wire records', () => {
  function corruptions(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      const items: unknown[] = value
      return items.flatMap((item, i) => corruptions(item).map(changed => items.map((v, j) => i === j ? changed : v)))
    }
    if (typeof value !== 'object' || value === null) return []
    const object = value as Record<string, unknown>
    return [{ ...object, unexpected: true }, ...Object.keys(object).map(key =>
      Object.fromEntries(Object.entries(object).filter(([field]) => field !== key))),
    ...Object.entries(object).flatMap(([key, item]) => corruptions(item).map(changed => ({ ...object, [key]: changed })))]
  }
  for (const [schema, value] of [[askSchema, ask], [supplySchema, supply], [challengeSchema, challenge],
    [revisionSchema, revision], [fieldSchema, challenge.fields[0]]] as const)
    for (const changed of corruptions(value)) expect(schema.safeParse(changed).success, JSON.stringify(changed)).toBe(false)
})

it('keeps shared context reference parsing identical in ordinary context and evidence inputs', () => {
  const context = { maxBytes: 4096, teamCursor: 0, personaVersion: '1', modelVersion: '1', sources: references,
    sections: [{ kind: 'evidence', required: true, blocks: [{ type: 'text', text: 'Original source' }] }] }
  expect(simulationContextRequestSchema.parse(context)).toEqual(context)
  for (const ref of references) expect(simulationContextReferenceSchema.parse(ref)).toEqual(ref)
  for (const ref of [{ ...references[0], sequence: 0 }, { ...references[0], sequence: 1.5 },
    { ...references[0], runId: '' }, { ...references[1], sessionId: 'injected' }, { kind: 'future-reference' }]) {
    expect(simulationContextRequestSchema.safeParse({ ...context, sources: [ref] }).success).toBe(false)
    expect(supplySchema.safeParse({ ...supply, answers: [{ ...answers[0], references: [ref] }] }).success).toBe(false)
  }
})
