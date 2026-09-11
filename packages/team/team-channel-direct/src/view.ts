/** Built-in pure channel view policies for Team transcript consumers. */

import type { TeamViewPolicy } from '@clocky/clocky-team'

/** Full ordered channel transcript projection. */
export const FULL_TRANSCRIPT_VIEW_POLICY: TeamViewPolicy = {
  type: 'full-transcript',
  version: 1,
  project: ({ records }) => ({
    messages: records.flatMap(record => record.type === 'channel/envelope'
      ? [{
        id: record.envelope.id,
        sequence: record.envelope.sequence,
        senderId: record.envelope.senderId,
        audience: record.envelope.audience,
        kind: record.envelope.kind,
        payload: record.envelope.payload,
      }]
      : []),
  }),
}

/** Directed metadata projection retaining sender/audience without payload amplification. */
export const DIRECTED_VIEW_POLICY: TeamViewPolicy = {
  type: 'directed',
  version: 1,
  project: ({ records }) => ({
    messages: records.flatMap(record => record.type === 'channel/envelope'
      ? [{
        id: record.envelope.id,
        sequence: record.envelope.sequence,
        senderId: record.envelope.senderId,
        audience: record.envelope.audience,
        kind: record.envelope.kind,
      }]
      : []),
  }),
}

/** Recent-window view bounded to the most recent twenty accepted Envelopes. */
export const RECENT_WINDOW_VIEW_POLICY: TeamViewPolicy = {
  type: 'recent-window',
  version: 1,
  project: ({ records }) => {
    const messages = records.flatMap(record => record.type === 'channel/envelope'
      ? [{
        id: record.envelope.id,
        sequence: record.envelope.sequence,
        senderId: record.envelope.senderId,
        kind: record.envelope.kind,
        payload: record.envelope.payload,
      }]
      : [])
    return { messages: messages.slice(-20) }
  },
}

/** Latest durable summary followed by its still-uncovered ordered suffix. */
export const SUMMARIZED_WINDOW_VIEW_POLICY: TeamViewPolicy = {
  type: 'summarized-window',
  version: 1,
  project: ({ records }) => {
    const summary = records.findLast(record => record.type === 'channel/summary')
    const coveredThrough = summary?.type === 'channel/summary' ? summary.coveredSequenceRange.to : -1
    const tail = records.flatMap(record => record.type === 'channel/envelope'
      && record.envelope.sequence > coveredThrough
      ? [{ id: record.envelope.id, sequence: record.envelope.sequence, senderId: record.envelope.senderId,
        kind: record.envelope.kind, payload: record.envelope.payload }]
      : [])
    if (summary?.type !== 'channel/summary') return { messages: tail, sourceEnvelopeIds: tail.map(message => message.id) }
    return {
      messages: [{ id: summary.idempotencyKey, sequence: summary.coveredSequenceRange.to,
        kind: 'summary', summary: summary.text }, ...tail],
      sourceEnvelopeIds: [...summary.sourceEnvelopeIds, ...tail.map(message => message.id)],
      coveredSequenceRange: { ...summary.coveredSequenceRange },
      sourceFingerprint: summary.sourceFingerprint,
      policy: { ...summary.policy },
    }
  },
}
