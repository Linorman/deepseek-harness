/** Projection-only fault fixtures; the complete-world Loader matrix verifies actual accepted contact/receipt provenance. */
import { expect, it } from 'vitest'
import { simulationExternalContactSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { projectWorldDomain } from '../src/world-read-projection.ts'
import { simulationProductWorldDomainInputSchema, simulationProductWorldDomainResultSchema } from '../src/world-read-schema.ts'

const secret = 'PRIVATE-CONTACT-CHANNEL-PROSE-CANARY'
function fixture() {
  const contacts = [1, 2].map(index => simulationExternalContactSchema.parse({ id: `intent-${index}`, identityId: 'identity',
    representativeIntentId: 'representative', generation: 1, requestId: `case-${index}`, planId: `plan-${index}`,
    requesterEntityId: `caller-${index}`, channel: { key: `conversation-${index}`, channelId: `channel-${index}` },
    status: 'committed', sequence: index * 10, updatedSequence: index * 10 }))
  // Only projector-consumed fields are populated. This does not assert Native acceptance or writable restoration of these fixtures.
  const state = { revision: 100, time: '9', spec: { runId: 'native', tickUnit: 'minute' }, latestCheckpointId: undefined,
    entities: Object.fromEntries(['subject', 'representative-person', 'caller-1', 'caller-2'].map(id => [id, { id, profile: { name: id } }])),
    operations: {}, decisions: {}, wakes: {}, world: { definition: {}, plans: {},
      intents: Object.fromEntries(contacts.map(value => [value.id, { id: value.id, targetEntityId: 'subject' }])),
      requests: Object.fromEntries(contacts.map((value, index) => [value.requestId, { id: value.requestId, intentId: value.id,
        sequence: index + 1, requesterEntityId: value.requesterEntityId, operationId: `request-${index + 1}`, notificationOperationId: null, plans: [],
        source: { kind: 'decision', decisionId: `request-decision-${index + 1}` } }])),
      results: Object.fromEntries(contacts.map((value, index) => [`result-${index + 1}`, { requestId: value.requestId, time: String(index + 1) }])),
      facts: {}, external: { identities: { identity: { id: 'identity', subjectRef: 'subject', representation: 'simulated-actor',
        policyRef: 'clocky.external.representative/1', revision: 1, sequence: 1 } }, contacts: Object.fromEntries(contacts.map(value => [value.id, value])),
      interactions: {}, adjudications: {}, representatives: { representative: { id: 'representative', identityId: 'identity',
        requestId: 'case-1', status: 'committed', updatedSequence: 10, identities: { entityId: 'representative-person', binding: { teamId: 'team', participantId: 'representative', sessionId: 'session' } } } } } } } as unknown as SimulationSnapshot
  return { state, contacts }
}
function view(state: SimulationSnapshot, offset = 0, limit = 1) {
  const input = simulationProductWorldDomainInputSchema.parse({ kind: 'identity', runId: 'product', key: 'identity', section: 'interactions', limit })
  const projected = projectWorldDomain(state, input, { runId: input.runId, at: state.time, limit,
    text: text => ({ text, truncated: false }), context: () => false, case: () => true, persona: () => false, resident: () => false,
    page: (items, scope) => ({ items: items.slice(offset, offset + limit), coverage: { loaded: items.slice(offset, offset + limit).length,
      total: items.length, revision: state.revision, scope, at: state.time, complete: offset === 0 && items.length <= limit } }) })
  return simulationProductWorldDomainResultSchema.parse({ apiVersion: 'clocky.world-read/v1', kind: input.kind, runId: input.runId,
    snapshotRevision: state.revision, readVersion: 'policy', observedAt: 1, selection: input, status: 'found', ...projected })
}

it('includes contact records as metadata, pages their own sources, and never upgrades ready representation into an observed reply', () => {
  const { state, contacts } = fixture(), first = view(state), second = view(state, 1)
  if (first.kind !== 'identity' || second.kind !== 'identity' || first.value === undefined || second.value === undefined) throw new Error('No identity')
  expect(first.coverage).toMatchObject({ loaded: 1, total: 2, complete: false })
  expect(first.value.interactions[0]).toMatchObject({ id: contacts[0]!.id, kind: 'simulated-actor', sampled: false,
    outcome: { text: 'contact:committed; reply-post:unobserved; publication:unconfirmed; delivery:unconfirmed' },
    disclosure: { state: 'not-applicable' } })
  expect(second.value.interactions[0]!.id).toBe(contacts[1]!.id)
  expect(first.value.sources).toContainEqual({ kind: 'record', sequence: state.world!.requests[contacts[0]!.requestId]!.sequence })
  expect(second.value.sources).toContainEqual({ kind: 'record', sequence: state.world!.requests[contacts[1]!.requestId]!.sequence })
  expect(first.value.sources).toContainEqual({ kind: 'record', sequence: contacts[0]!.sequence })
  expect(first.value.sources).not.toContainEqual({ kind: 'record', sequence: contacts[1]!.sequence })
  expect(second.value.sources).toContainEqual({ kind: 'record', sequence: contacts[1]!.sequence })
  expect(second.value.latest).toEqual({ at: second.value.interactions[0]!.at, summary: second.value.interactions[0]!.outcome })
})

it('links a response post through the exact Native delivery wake without requiring a frozen Envelope or claiming Session consumption', () => {
  const { state } = fixture(), contact = state.world!.external.contacts['intent-1' as never]!
  const inquiries = { id: 'inquiry', entityId: 'caller-1', decisionId: 'inquiry-decision', action: { kind: 'communication/post',
    channelId: contact.channel.channelId, recipient: 'representative-person', text: secret }, status: 'applied',
  result: { sequence: 30, time: '3' }, delivery: { wakeId: 'original-inquiry-wake',
    receipt: { envelopeId: 'original-inquiry', cursor: 3 } },
  outbox: { receipt: { envelopeId: 'original-inquiry', channelId: contact.channel.channelId, teamId: 'team', sequence: 3 } } }
  const reply = { id: 'reply', entityId: 'representative-person', decisionId: 'reply-decision', action: { kind: 'communication/post',
    channelId: contact.channel.channelId, recipient: 'caller-1', text: secret }, status: 'applied',
  result: { sequence: 40, time: '4' }, outbox: { receipt: { envelopeId: 'original-reply', channelId: contact.channel.channelId, teamId: 'team', sequence: 5 } } }
  const augmented = { ...state, operations: { inquiry: inquiries, reply }, wakes: {
    'original-inquiry-wake': { eventId: 'original-inquiry-wake', entityId: 'representative-person', status: 'completed', decisionId: 'reply-decision' },
  }, decisions: {
    'inquiry-decision': { time: '3', closedAt: 29, context: { status: 'prepared', world: { kind: 'first-action', intentId: contact.id }, view: { sources: [] } } },
    'reply-decision': { time: '4', closedAt: 39, wakeId: 'unrelated-case-wake', context: { status: 'prepared',
      view: { sources: [{ kind: 'run-event', runId: 'native', sequence: 30 }] } } },
  } } as unknown as SimulationSnapshot
  const unrelated = view(augmented, 1)
  if (unrelated.kind !== 'identity' || unrelated.value === undefined) throw new Error('No identity')
  expect(unrelated.value.interactions[0]!.outcome.text).toContain('reply-post:unobserved')
  const corrected = { ...augmented, decisions: { ...augmented.decisions, 'reply-decision': {
    ...augmented.decisions['reply-decision' as never]!, wakeId: 'original-inquiry-wake' } } } as SimulationSnapshot
  const observed = view(corrected, 1)
  if (observed.kind !== 'identity' || observed.value === undefined) throw new Error('No identity')
  expect(observed.value.interactions[0]).toMatchObject({ id: contact.id, at: '4', outcome: {
    text: 'contact:committed; reply-post:applied; publication:published; delivery:unconfirmed' } })
  expect(observed.value.interactions[0]!.basis.text).toContain('delivery-wake')
  expect(observed.value.sources).toContainEqual({ kind: 'envelope', id: 'original-reply', envelopeId: 'original-reply', teamId: 'team',
    channelId: contact.channel.channelId, envelopeSequence: 5, decisionId: 'reply-decision' })
  expect(JSON.stringify(observed)).not.toContain(secret)
  for (const wake of [
    { ...corrected.wakes['original-inquiry-wake' as never]!, decisionId: 'different-decision' },
    { ...corrected.wakes['original-inquiry-wake' as never]!, entityId: 'different-person' },
    { ...corrected.wakes['original-inquiry-wake' as never]!, status: 'cancelled' },
  ]) {
    const unrelatedWake = view({ ...corrected, wakes: { 'original-inquiry-wake': wake } } as unknown as SimulationSnapshot, 1)
    if (unrelatedWake.kind !== 'identity' || unrelatedWake.value === undefined) throw new Error('No identity')
    expect(unrelatedWake.value.interactions[0]!.outcome.text).toContain('reply-post:unobserved')
  }
  for (const receipt of [{ envelopeId: 'different-envelope', cursor: 3 }, { envelopeId: 'original-inquiry', cursor: 4 }]) {
    const unrelatedReceipt = view({ ...corrected, operations: { ...corrected.operations,
      inquiry: { ...inquiries, delivery: { ...inquiries.delivery, receipt } } } } as unknown as SimulationSnapshot, 1)
    if (unrelatedReceipt.kind !== 'identity' || unrelatedReceipt.value === undefined) throw new Error('No identity')
    expect(unrelatedReceipt.value.interactions[0]!.outcome.text).toContain('reply-post:unobserved')
  }
})
