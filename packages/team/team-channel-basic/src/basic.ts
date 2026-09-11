/** Consult and discussion channel adapters with bounded pure replay state. */

import type {
  ChannelAdapterRecordDraft,
  ChannelExpectedNext,
  ChannelManifest,
  ChannelParticipant,
  DeliveryIntent,
  JsonObject,
  JsonValue,
  ParticipantId,
  TeamAdapterRef,
  TeamChannelAdapter,
  TeamEnvelope,
  TeamEnvelopeDraft,
} from '@clocky/clocky-team'
import {
  participantIdSchema,
  taskAttemptIdSchema,
  taskAttemptResultSchema,
  teamTaskIdSchema,
} from '@clocky/clocky-team'
import type { TaskAttemptResult } from '@clocky/clocky-team'

/** Adapter type for one-request/one-response conversations. */
export const CONSULT_CHANNEL_TYPE = 'consult'
/** Version of the consult protocol. */
export const CONSULT_CHANNEL_VERSION = 1
/** Stable consult adapter identity. */
export const CONSULT_CHANNEL_ADAPTER: TeamAdapterRef = Object.freeze({
  type: CONSULT_CHANNEL_TYPE,
  version: CONSULT_CHANNEL_VERSION,
})
/** Alias naming the versioned consult adapter explicitly. */
export const CONSULT_CHANNEL_ADAPTER_V1 = CONSULT_CHANNEL_ADAPTER
/** Alias naming the versioned consult protocol explicitly. */
export const CONSULT_CHANNEL_VERSION_V1 = CONSULT_CHANNEL_VERSION
/** Role of the participant that starts a consult. */
export const CONSULT_INITIATOR_ROLE = 'initiator'
/** Role of the participant that answers a consult. */
export const CONSULT_RESPONDENT_ROLE = 'respondent'
/** Envelope kind for the first consult message. */
export const CONSULT_REQUEST_KIND = 'request'
/** Envelope kind for the consult response. */
export const CONSULT_RESPONSE_KIND = 'response'
/** Envelope kind used for a response-driven task review request. */
export const CONSULT_REVIEW_REQUEST_KIND = 'review-request'

/** Logged request identity delivered to this consult's respondent. */
export interface ConsultTextRequestAnchor {
  readonly teamId: ChannelManifest['teamId']
  readonly channelId: ChannelManifest['id']
  readonly envelopeId: TeamEnvelope['id']
  readonly taskId?: TeamEnvelope['taskId'] | undefined
  /** True for a structured task-review request, which ordinary text must not resolve. */
  readonly review: boolean
}
/** Caller text plus immutable topology and an optional already logged request. */
export interface ConsultTextDraftInput {
  readonly manifest: ChannelManifest
  readonly senderId: ParticipantId
  readonly text: string
  readonly delivery: TeamEnvelopeDraft['delivery']
  readonly audience?: readonly ParticipantId[] | null | undefined
  readonly request?: ConsultTextRequestAnchor | undefined
}

/**
 * Derive an ordinary consult request or response without reading rendered view state.
 * @param input - Current manifest, sender, text, and the respondent's logged request anchor.
 * @returns The exact peer-addressed draft; review requests require the separate review operation.
 */
export function resolveConsultTextDraft(input: ConsultTextDraftInput): TeamEnvelopeDraft {
  const manifest = parseConsultChannelManifest(input.manifest)
  if (input.text.trim().length === 0 || input.delivery !== 'turn') throw new Error('Consult text requires nonempty text and turn delivery')
  const initiating = input.senderId === manifest.initiatorId
  if (!initiating && input.senderId !== manifest.respondentId) throw new Error('Consult sender is not an immutable channel member')
  const peer = initiating ? manifest.respondentId : manifest.initiatorId
  if (input.audience !== undefined && input.audience !== null && (input.audience.length !== 1 || input.audience[0] !== peer)) {
    throw new Error('Consult text must address its exact protocol peer')
  }
  if (initiating) return { channelId: manifest.channelId, audience: [peer], kind: CONSULT_REQUEST_KIND, payload: { text: input.text }, delivery: 'turn',
    ...input.request?.taskId === undefined ? {} : { taskId: input.request.taskId } }
  const request = input.request
  if (request === undefined || request.teamId !== manifest.teamId || request.channelId !== manifest.channelId) {
    throw new Error('Consult response requires its logged request source')
  }
  if (request.review) throw new Error('Consult review responses require the task review operation')
  return { channelId: manifest.channelId, audience: [peer], kind: CONSULT_RESPONSE_KIND, payload: { text: input.text }, delivery: 'turn',
    causationId: request.envelopeId, ...request.taskId === undefined ? {} : { taskId: request.taskId } }
}

/** Adapter type for bounded multi-party discussion. */
export const DISCUSSION_CHANNEL_TYPE = 'discussion'
/** Version of the discussion protocol. */
export const DISCUSSION_CHANNEL_VERSION = 1
/** Stable discussion adapter identity. */
export const DISCUSSION_CHANNEL_ADAPTER: TeamAdapterRef = Object.freeze({
  type: DISCUSSION_CHANNEL_TYPE,
  version: DISCUSSION_CHANNEL_VERSION,
})
/** Alias naming the versioned discussion adapter explicitly. */
export const DISCUSSION_CHANNEL_ADAPTER_V1 = DISCUSSION_CHANNEL_ADAPTER
/** Alias naming the versioned discussion protocol explicitly. */
export const DISCUSSION_CHANNEL_VERSION_V1 = DISCUSSION_CHANNEL_VERSION
/** Discussion limit key selecting a hard turn bound. */
export const DISCUSSION_MAX_TURNS_LIMIT = 'maxTurns'
/** Discussion limit key selecting the speaker policy. */
export const DISCUSSION_SPEAKER_POLICY_LIMIT = 'speakerPolicy'
/** Deterministic discussion speaker policy. */
export type DiscussionSpeakerPolicy = 'round-robin' | 'free-form'

const NO_FOLLOW_UP_RECORDS: readonly ChannelAdapterRecordDraft[] = Object.freeze([])
const NO_EXPECTED_SPEAKER: ChannelExpectedNext = Object.freeze({ kind: 'none' })

/** Parsed consult membership and channel identity. */
export interface ConsultChannelManifest {
  /** Consult channel identity. */
  readonly channelId: ChannelManifest['id']
  /** Owning Team identity. */
  readonly teamId: ChannelManifest['teamId']
  /** Participant that submits the request. */
  readonly initiatorId: ParticipantId
  /** Participant that submits the response. */
  readonly respondentId: ParticipantId
}

/** Structured review evidence embedded in a consult request. */
export interface ConsultReviewAssignmentPayload {
  /** Human-readable review prompt retained beside structured evidence. */
  readonly text: string
  /** Reviewed task identity. */
  readonly taskId: ReturnType<typeof teamTaskIdSchema.parse>
  /** Completed attempt identity. */
  readonly attemptId: ReturnType<typeof taskAttemptIdSchema.parse>
  /** Exact task revision the response must fence. */
  readonly reviewRevision: number
  /** Configured reviewer identity. */
  readonly reviewerId: ReturnType<typeof participantIdSchema.parse>
  /** Participant that submitted the result and receives the response. */
  readonly initiatorId: ReturnType<typeof participantIdSchema.parse>
  /** Result summary, evidence, and artifact references from the worker. */
  readonly result: TaskAttemptResult
}

/** Structured response retained by the review consult channel. */
export interface ConsultReviewResponsePayload {
  /** Human-readable acceptance or rework reason. */
  readonly text: string
  /** Decision that the Hub must apply to the reviewed task. */
  readonly decision: 'accepted' | 'rework'
}

/** Parsed discussion membership and immutable limits. */
export interface DiscussionChannelManifest {
  /** Discussion channel identity. */
  readonly channelId: ChannelManifest['id']
  /** Owning Team identity. */
  readonly teamId: ChannelManifest['teamId']
  /** Ordered discussion participants. */
  readonly participantIds: readonly ParticipantId[]
  /** Hard accepted-Envelope turn bound. */
  readonly maxTurns: number
  /** Speaker selection policy. */
  readonly speakerPolicy: DiscussionSpeakerPolicy
}

interface ConsultState extends JsonObject {
  readonly phase: 'request' | 'response' | 'complete'
  readonly initiatorId: ParticipantId
  readonly respondentId: ParticipantId
  readonly requestId?: string
  readonly responseId?: string
}

interface DiscussionState extends JsonObject {
  readonly participantIds: readonly ParticipantId[]
  readonly maxTurns: number
  readonly speakerPolicy: DiscussionSpeakerPolicy
  readonly turnCount: number
  readonly lastSenderId?: ParticipantId
}

/**
 * Parse the exact two-party consult manifest.
 * @param manifest - immutable channel configuration to validate.
 * @returns the initiator and respondent identities.
 */
export function parseConsultChannelManifest(manifest: ChannelManifest): ConsultChannelManifest {
  if (manifest.adapter.type !== CONSULT_CHANNEL_TYPE || manifest.adapter.version !== CONSULT_CHANNEL_VERSION) {
    throw new Error('consult channel manifest does not select consult version 1')
  }
  if (manifest.participants.length !== 2) throw new Error('consult channel requires exactly two participants')
  if (Object.keys(manifest.limits).length !== 0) throw new Error('consult channel does not accept adapter limits')
  const initiator = participantWithRole(manifest.participants, CONSULT_INITIATOR_ROLE, 'initiator')
  const respondent = participantWithRole(manifest.participants, CONSULT_RESPONDENT_ROLE, 'respondent')
  if (initiator.id === respondent.id) throw new Error('consult channel participants must be distinct')
  return Object.freeze({
    channelId: manifest.id,
    teamId: manifest.teamId,
    initiatorId: initiator.id,
    respondentId: respondent.id,
  })
}

/**
 * Parse a discussion manifest and its bounded speaker policy.
 * @param manifest - immutable channel configuration to validate.
 * @returns the ordered roster and discussion limits.
 */
export function parseDiscussionChannelManifest(manifest: ChannelManifest): DiscussionChannelManifest {
  if (manifest.adapter.type !== DISCUSSION_CHANNEL_TYPE || manifest.adapter.version !== DISCUSSION_CHANNEL_VERSION) {
    throw new Error('discussion channel manifest does not select discussion version 1')
  }
  if (manifest.participants.length < 2) throw new Error('discussion channel requires at least two participants')
  const participantIds = manifest.participants.map(participant => participant.id)
  if (new Set(participantIds).size !== participantIds.length) throw new Error('discussion participants must be distinct')
  const limits = exactDiscussionLimits(manifest.limits)
  return Object.freeze({
    channelId: manifest.id,
    teamId: manifest.teamId,
    participantIds: Object.freeze([...participantIds]),
    ...limits,
  })
}

/** Consult protocol: one request, one response, then an atomic channel close. */
export const consultChannelAdapter: TeamChannelAdapter = {
  ...CONSULT_CHANNEL_ADAPTER,

  validateCreate(manifest) {
    parseConsultChannelManifest(manifest)
  },

  initialState(manifest) {
    const parsed = parseConsultChannelManifest(manifest)
    return initialConsultState(parsed)
  },

  validateSend({ manifest, state, senderId, draft }) {
    const parsed = parseConsultChannelManifest(manifest)
    const current = parseConsultState(state)
    assertConsultStateMatchesManifest(current, parsed)
    parseConsultDraft(parsed, current.phase, senderId, draft)
  },

  fold(state, record) {
    const current = parseConsultState(state)
    if (record.type !== 'channel/envelope') {
      if (record.type === 'channel/adapter') throw new Error('consult channel does not accept adapter-owned records')
      return current
    }
    if (current.phase === 'complete') throw new Error('consult channel cannot accept an Envelope after completion')
    const parsed = parseConsultEnvelope(current, record.envelope)
    return parsed.kind === CONSULT_RESPONSE_KIND
      ? Object.freeze({
        ...current,
        phase: 'complete',
        responseId: record.envelope.id,
        requestId: current.requestId as string,
      })
      : Object.freeze({ ...current, phase: 'response', requestId: record.envelope.id })
  },

  afterAccept({ state, record }) {
    const current = parseConsultState(state)
    parseAcceptedConsultEnvelope(current, record.envelope)
    return NO_FOLLOW_UP_RECORDS
  },

  closeAfterAccept({ state }) {
    const current = parseConsultState(state)
    return current.phase === 'complete' ? 'consult response accepted' : undefined
  },

  allowsClosedDelivery({ manifest, state }) {
    const parsed = parseConsultChannelManifest(manifest)
    const current = parseConsultState(state)
    assertConsultStateMatchesManifest(current, parsed)
    return current.phase === 'complete'
  },

  expectedNext({ manifest, state }) {
    const parsed = parseConsultChannelManifest(manifest)
    const current = parseConsultState(state)
    assertConsultStateMatchesManifest(current, parsed)
    if (current.phase === 'request') return Object.freeze({ kind: 'participant', participantId: parsed.initiatorId })
    if (current.phase === 'response') return Object.freeze({ kind: 'participant', participantId: parsed.respondentId })
    return NO_EXPECTED_SPEAKER
  },

  deliveryPlan({ manifest, state, envelope }) {
    const parsed = parseConsultChannelManifest(manifest)
    const current = parseConsultState(state)
    assertConsultStateMatchesManifest(current, parsed)
    const message = parseAcceptedConsultEnvelope(current, envelope)
    const participantId = message.kind === CONSULT_RESPONSE_KIND ? parsed.initiatorId : parsed.respondentId
    return Object.freeze([Object.freeze({
      participantId,
      envelopeId: envelope.id,
      delivery: 'turn' as const,
    } satisfies DeliveryIntent)])
  },

  projectView({ manifest, state, records }) {
    const parsed = parseConsultChannelManifest(manifest)
    const current = parseConsultState(state)
    assertConsultStateMatchesManifest(current, parsed)
    return Object.freeze({
      phase: current.phase,
      ...current.requestId === undefined ? {} : { requestId: current.requestId },
      ...current.responseId === undefined ? {} : { responseId: current.responseId },
      messages: Object.freeze(records.flatMap(record => record.type === 'channel/envelope'
        ? [{
          id: record.envelope.id,
          senderId: record.envelope.senderId,
          kind: record.envelope.kind,
          payload: record.envelope.payload,
        }]
        : [])),
    })
  },
}

/** Discussion protocol with explicit addressing and a hard turn bound. */
export const discussionChannelAdapter: TeamChannelAdapter = {
  ...DISCUSSION_CHANNEL_ADAPTER,

  validateCreate(manifest) {
    parseDiscussionChannelManifest(manifest)
  },

  initialState(manifest) {
    const parsed = parseDiscussionChannelManifest(manifest)
    return initialDiscussionState(parsed)
  },

  validateSend({ manifest, state, senderId, draft }) {
    const parsed = parseDiscussionChannelManifest(manifest)
    const current = parseDiscussionState(state)
    assertDiscussionStateMatchesManifest(current, parsed)
    assertDiscussionDraft(parsed, current, senderId, draft)
  },

  fold(state, record) {
    const current = parseDiscussionState(state)
    if (record.type !== 'channel/envelope') {
      if (record.type === 'channel/adapter') throw new Error('discussion channel does not accept adapter-owned records')
      return current
    }
    if (current.turnCount >= current.maxTurns) throw new Error('discussion channel exceeded its turn limit')
    assertDiscussionEnvelope(current, record.envelope)
    return Object.freeze({
      ...current,
      turnCount: current.turnCount + 1,
      lastSenderId: record.envelope.senderId,
    })
  },

  afterAccept({ state, record }) {
    const current = parseDiscussionState(state)
    assertDiscussionEnvelope(current, record.envelope, 'after')
    return NO_FOLLOW_UP_RECORDS
  },

  closeAfterAccept({ state }) {
    const current = parseDiscussionState(state)
    return current.turnCount >= current.maxTurns ? 'discussion turn limit reached' : undefined
  },

  allowsClosedDelivery({ manifest, state }) {
    const parsed = parseDiscussionChannelManifest(manifest)
    const current = parseDiscussionState(state)
    assertDiscussionStateMatchesManifest(current, parsed)
    return current.turnCount >= current.maxTurns
  },

  expectedNext({ manifest, state }) {
    const parsed = parseDiscussionChannelManifest(manifest)
    const current = parseDiscussionState(state)
    assertDiscussionStateMatchesManifest(current, parsed)
    if (current.turnCount >= current.maxTurns || current.speakerPolicy === 'free-form') return NO_EXPECTED_SPEAKER
    return Object.freeze({ kind: 'participant', participantId: nextRoundRobinParticipant(parsed.participantIds, current.lastSenderId) })
  },

  deliveryPlan({ manifest, state, envelope }) {
    const parsed = parseDiscussionChannelManifest(manifest)
    const current = parseDiscussionState(state)
    assertDiscussionStateMatchesManifest(current, parsed)
    assertDiscussionEnvelope(current, envelope, 'after')
    const audience = envelope.audience === null
      ? parsed.participantIds.filter(participantId => participantId !== envelope.senderId)
      : [...envelope.audience]
    return Object.freeze(audience.map(participantId => Object.freeze({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    } satisfies DeliveryIntent)))
  },

  projectView({ manifest, state, records }) {
    const parsed = parseDiscussionChannelManifest(manifest)
    const current = parseDiscussionState(state)
    assertDiscussionStateMatchesManifest(current, parsed)
    return Object.freeze({
      turnCount: current.turnCount,
      maxTurns: current.maxTurns,
      speakerPolicy: current.speakerPolicy,
      expectedNext: current.turnCount >= current.maxTurns || current.speakerPolicy === 'free-form'
        ? null
        : nextRoundRobinParticipant(parsed.participantIds, current.lastSenderId),
      messages: Object.freeze(records.flatMap(record => record.type === 'channel/envelope'
        ? [{
          id: record.envelope.id,
          senderId: record.envelope.senderId,
          kind: record.envelope.kind,
          payload: record.envelope.payload,
        }]
        : [])),
    })
  },
}

/**
 * Parse a consult text payload and retain only its stable protocol fields.
 * @param payload - JSON payload from a consult Envelope.
 * @returns the validated text value.
 */
export function parseConsultTextPayload(payload: JsonObject): { readonly text: string } {
  if (Object.hasOwn(payload, 'taskId')) return parseConsultReviewAssignmentPayload(payload)
  if (Object.hasOwn(payload, 'decision')) return parseConsultReviewResponsePayload(payload)
  exactKeys(payload, ['text'], 'consult message payload')
  if (typeof payload.text !== 'string' || payload.text.length === 0) {
    throw new Error('consult message text must be a nonempty string')
  }
  return Object.freeze({ text: payload.text })
}

/**
 * Parse the response-driven review decision payload.
 * @param payload - JSON payload from a review response Envelope.
 * @returns the validated review decision.
 */
export function parseConsultReviewResponsePayload(payload: JsonObject): ConsultReviewResponsePayload {
  exactKeys(payload, ['text', 'decision'], 'consult review response payload')
  if (typeof payload.text !== 'string' || payload.text.length === 0) {
    throw new Error('consult review response text must be a nonempty string')
  }
  if (payload.decision !== 'accepted' && payload.decision !== 'rework') {
    throw new Error('consult review response decision must be accepted or rework')
  }
  return Object.freeze({ text: payload.text, decision: payload.decision })
}

/**
 * Parse the structured response-driven review assignment payload.
 * @param payload - JSON payload from a review assignment Envelope.
 * @returns the validated review assignment.
 */
export function parseConsultReviewAssignmentPayload(payload: JsonObject): ConsultReviewAssignmentPayload {
  exactKeys(payload, ['text', 'taskId', 'attemptId', 'reviewRevision', 'reviewerId', 'initiatorId', 'result'], 'consult review assignment payload')
  if (typeof payload.text !== 'string' || payload.text.length === 0) {
    throw new Error('consult review assignment text must be a nonempty string')
  }
  if (typeof payload.reviewRevision !== 'number' || !Number.isSafeInteger(payload.reviewRevision) || payload.reviewRevision < 1) {
    throw new Error('consult review assignment revision must be a positive safe integer')
  }
  return Object.freeze({
    text: payload.text,
    taskId: teamTaskIdSchema.parse(payload.taskId),
    attemptId: taskAttemptIdSchema.parse(payload.attemptId),
    reviewRevision: payload.reviewRevision,
    reviewerId: participantIdSchema.parse(payload.reviewerId),
    initiatorId: participantIdSchema.parse(payload.initiatorId),
    result: taskAttemptResultSchema.parse(payload.result),
  })
}

/**
 * Parse one discussion text payload.
 * @param payload - JSON payload from a discussion Envelope.
 * @returns the validated text value.
 */
export function parseDiscussionTextPayload(payload: JsonObject): { readonly text: string } {
  exactKeys(payload, ['text'], 'discussion message payload')
  if (typeof payload.text !== 'string' || payload.text.length === 0) {
    throw new Error('discussion message text must be a nonempty string')
  }
  return Object.freeze({ text: payload.text })
}

/** Build the initial consult state from a validated manifest. */
function initialConsultState(manifest: ConsultChannelManifest): ConsultState {
  return Object.freeze({
    phase: 'request',
    initiatorId: manifest.initiatorId,
    respondentId: manifest.respondentId,
  })
}

/** Build the initial discussion state from a validated manifest. */
function initialDiscussionState(manifest: DiscussionChannelManifest): DiscussionState {
  return Object.freeze({
    participantIds: Object.freeze([...manifest.participantIds]),
    maxTurns: manifest.maxTurns,
    speakerPolicy: manifest.speakerPolicy,
    turnCount: 0,
  })
}

/** Validate one consult draft against the current protocol phase. */
function parseConsultDraft(
  manifest: ConsultChannelManifest,
  phase: ConsultState['phase'],
  senderId: ParticipantId,
  draft: TeamEnvelopeDraft,
): void {
  const expectedKind = phase === 'request' ? CONSULT_REQUEST_KIND : CONSULT_RESPONSE_KIND
  const expectedSender = phase === 'request' ? manifest.initiatorId : manifest.respondentId
  const expectedRecipient = phase === 'request' ? manifest.respondentId : manifest.initiatorId
  if (phase === 'complete') throw new Error('consult channel is complete')
  if (senderId !== expectedSender) throw new Error(`consult ${expectedKind} must be sent by its ${phase === 'request' ? 'initiator' : 'respondent'}`)
  if (draft.audience === null || draft.audience.length !== 1 || draft.audience[0] !== expectedRecipient) {
    throw new Error(`consult ${expectedKind} must address exactly its ${phase === 'request' ? 'respondent' : 'initiator'}`)
  }
  const validRequestKind = draft.kind === CONSULT_REQUEST_KIND || draft.kind === CONSULT_REVIEW_REQUEST_KIND
  if (phase === 'request' ? !validRequestKind : draft.kind !== expectedKind) {
    throw new Error(`consult channel expects a ${expectedKind} Envelope`)
  }
  if (draft.delivery !== 'turn') throw new Error(`consult ${expectedKind} delivery must be turn`)
  parseConsultTextPayload(draft.payload)
}

/** Validate one accepted consult Envelope against its current state. */
function parseConsultEnvelope(state: ConsultState, envelope: TeamEnvelope): { readonly kind: string } {
  const manifest: ConsultChannelManifest = {
    channelId: envelope.channelId,
    teamId: envelope.teamId,
    initiatorId: state.initiatorId,
    respondentId: state.respondentId,
  }
  const isRequest = envelope.kind === CONSULT_REQUEST_KIND || envelope.kind === CONSULT_REVIEW_REQUEST_KIND
  parseConsultDraft(manifest, isRequest ? 'request' : 'response', envelope.senderId, envelope)
  if (state.phase === 'request' && !isRequest) {
    throw new Error('consult channel expects its request before its response')
  }
  if (state.phase === 'response' && envelope.kind !== CONSULT_RESPONSE_KIND) {
    throw new Error('consult channel expects its response after its request')
  }
  return envelope
}

/** Validate one consult Envelope against the state produced by accepting it. */
function parseAcceptedConsultEnvelope(state: ConsultState, envelope: TeamEnvelope): { readonly kind: string } {
  const phase = envelope.kind === CONSULT_REQUEST_KIND || envelope.kind === CONSULT_REVIEW_REQUEST_KIND ? 'request' : 'response'
  const parsed = parseConsultEnvelopeShape(state, phase, envelope)
  const expectedAfter = phase === 'request' ? 'response' : 'complete'
  if (state.phase !== expectedAfter) throw new Error('consult channel state does not follow its accepted Envelope')
  return parsed
}

/** Validate a consult Envelope's phase-specific sender, audience, and payload. */
function parseConsultEnvelopeShape(
  state: ConsultState,
  phase: 'request' | 'response',
  envelope: TeamEnvelope,
): { readonly kind: string } {
  const manifest: ConsultChannelManifest = {
    channelId: envelope.channelId,
    teamId: envelope.teamId,
    initiatorId: state.initiatorId,
    respondentId: state.respondentId,
  }
  parseConsultDraft(manifest, phase, envelope.senderId, envelope)
  return envelope
}

/** Validate one discussion draft against membership, turn policy, and recipient rules. */
function assertDiscussionDraft(
  manifest: DiscussionChannelManifest,
  state: DiscussionState,
  senderId: ParticipantId,
  draft: TeamEnvelopeDraft,
): void {
  if (state.turnCount >= state.maxTurns) throw new Error('discussion channel reached its turn limit')
  if (!manifest.participantIds.includes(senderId)) throw new Error('discussion sender is not a channel participant')
  if (state.speakerPolicy === 'round-robin' && senderId !== nextRoundRobinParticipant(manifest.participantIds, state.lastSenderId)) {
    throw new Error(`discussion expects participant '${nextRoundRobinParticipant(manifest.participantIds, state.lastSenderId)}' to speak next`)
  }
  if (draft.kind !== 'message') throw new Error('discussion channel accepts only message Envelopes')
  parseDiscussionTextPayload(draft.payload)
  assertDiscussionAudience(manifest.participantIds, senderId, draft.audience)
}

/** Validate one accepted discussion Envelope after the preceding fold. */
function assertDiscussionEnvelope(state: DiscussionState, envelope: TeamEnvelope, phase: 'before' | 'after' = 'before'): void {
  if (envelope.kind !== 'message') throw new Error('discussion channel accepts only message Envelopes')
  if (envelope.delivery === 'steer') throw new Error('discussion message delivery cannot be steer')
  if (!state.participantIds.includes(envelope.senderId)) throw new Error('discussion sender is not a channel participant')
  const expectedSender = phase === 'after' ? state.lastSenderId : nextRoundRobinParticipant(state.participantIds, state.lastSenderId)
  if (phase === 'after' && expectedSender === undefined) throw new Error('discussion accepted Envelope has no sender state')
  if (state.speakerPolicy === 'round-robin' && envelope.senderId !== expectedSender) {
    throw new Error('discussion Envelope sender is not the expected round-robin participant')
  }
  parseDiscussionTextPayload(envelope.payload)
  assertDiscussionAudience(state.participantIds, envelope.senderId, envelope.audience)
}

/** Validate an explicit or broadcast discussion audience. */
function assertDiscussionAudience(
  participantIds: readonly ParticipantId[],
  senderId: ParticipantId,
  audience: readonly ParticipantId[] | null,
): void {
  if (audience === null) return
  if (audience.length === 0 || new Set(audience).size !== audience.length) {
    throw new Error('discussion audience must be nonempty and distinct')
  }
  for (const participantId of audience) {
    if (participantId === senderId) throw new Error('discussion audience cannot contain the sender')
    if (!participantIds.includes(participantId)) throw new Error('discussion audience must contain channel participants')
  }
}

/** Resolve the next round-robin speaker, starting with the first participant. */
function nextRoundRobinParticipant(participantIds: readonly ParticipantId[], lastSenderId: ParticipantId | undefined): ParticipantId {
  if (lastSenderId === undefined) return participantIds[0] as ParticipantId
  const index = participantIds.indexOf(lastSenderId)
  /* v8 ignore next -- parsed state and manifest membership make an unknown sender unreachable. */
  if (index < 0) throw new Error(`discussion state names unknown sender '${lastSenderId}'`)
  return participantIds[(index + 1) % participantIds.length] as ParticipantId
}

/** Parse strict discussion limits. */
function exactDiscussionLimits(limits: JsonObject): Pick<DiscussionChannelManifest, 'maxTurns' | 'speakerPolicy'> {
  exactKeys(limits, [DISCUSSION_MAX_TURNS_LIMIT, DISCUSSION_SPEAKER_POLICY_LIMIT], 'discussion channel limits')
  if (typeof limits[DISCUSSION_MAX_TURNS_LIMIT] !== 'number'
    || !Number.isSafeInteger(limits[DISCUSSION_MAX_TURNS_LIMIT])
    || limits[DISCUSSION_MAX_TURNS_LIMIT] < 1) {
    throw new Error('discussion maxTurns must be a positive safe integer')
  }
  const speakerPolicy = limits[DISCUSSION_SPEAKER_POLICY_LIMIT]
  if (speakerPolicy !== 'round-robin' && speakerPolicy !== 'free-form') {
    throw new Error('discussion speakerPolicy must be round-robin or free-form')
  }
  return {
    maxTurns: limits[DISCUSSION_MAX_TURNS_LIMIT],
    speakerPolicy,
  }
}

/** Parse strict consult state. */
function parseConsultState(value: JsonValue): ConsultState {
  if (!isObject(value)) throw new Error('consult channel state must be an object')
  if (value.phase !== 'request' && value.phase !== 'response' && value.phase !== 'complete') {
    throw new Error('consult channel state has an invalid phase')
  }
  exactKeys(value, value.phase === 'request'
    ? ['phase', 'initiatorId', 'respondentId']
    : value.phase === 'response'
      ? ['phase', 'initiatorId', 'respondentId', 'requestId']
      : ['phase', 'initiatorId', 'respondentId', 'requestId', 'responseId'], 'consult channel state')
  requireIdentifier(value.initiatorId, 'consult state initiatorId')
  requireIdentifier(value.respondentId, 'consult state respondentId')
  if (value.phase !== 'request') requireIdentifier(value.requestId, 'consult state requestId')
  if (value.phase === 'complete') requireIdentifier(value.responseId, 'consult state responseId')
  return value as ConsultState
}

/** Parse strict discussion state. */
function parseDiscussionState(value: JsonValue): DiscussionState {
  if (!isObject(value)) throw new Error('discussion channel state must be an object')
  const hasLastSender = Object.hasOwn(value, 'lastSenderId')
  exactKeys(value, hasLastSender
    ? ['participantIds', 'maxTurns', 'speakerPolicy', 'turnCount', 'lastSenderId']
    : ['participantIds', 'maxTurns', 'speakerPolicy', 'turnCount'], 'discussion channel state')
  if (!Array.isArray(value.participantIds) || value.participantIds.length < 2
    || value.participantIds.some(participantId => typeof participantId !== 'string' || participantId.length === 0)) {
    throw new Error('discussion state participantIds must contain at least two identifiers')
  }
  if (new Set(value.participantIds).size !== value.participantIds.length) throw new Error('discussion state participants must be distinct')
  if (typeof value.maxTurns !== 'number' || !Number.isSafeInteger(value.maxTurns) || value.maxTurns < 1) {
    throw new Error('discussion state maxTurns must be a positive safe integer')
  }
  if (value.speakerPolicy !== 'round-robin' && value.speakerPolicy !== 'free-form') throw new Error('discussion state speakerPolicy is invalid')
  if (typeof value.turnCount !== 'number' || !Number.isSafeInteger(value.turnCount) || value.turnCount < 0 || value.turnCount > value.maxTurns) {
    throw new Error('discussion state turnCount is outside its limit')
  }
  if (hasLastSender && (typeof value.lastSenderId !== 'string' || !value.participantIds.includes(value.lastSenderId))) {
    throw new Error('discussion state lastSenderId is not a participant')
  }
  return value as DiscussionState
}

/** Verify that parsed consult state retains manifest identities. */
function assertConsultStateMatchesManifest(state: ConsultState, manifest: ConsultChannelManifest): void {
  if (state.initiatorId !== manifest.initiatorId || state.respondentId !== manifest.respondentId) {
    throw new Error('consult channel state does not match its manifest')
  }
}

/** Verify that parsed discussion state retains manifest identities and limits. */
function assertDiscussionStateMatchesManifest(state: DiscussionState, manifest: DiscussionChannelManifest): void {
  if (state.maxTurns !== manifest.maxTurns || state.speakerPolicy !== manifest.speakerPolicy
    || state.participantIds.length !== manifest.participantIds.length
    || state.participantIds.some((participantId, index) => participantId !== manifest.participantIds[index])) {
    throw new Error('discussion channel state does not match its manifest')
  }
}

/** Find the participant carrying one required role and reject duplicate roles. */
function participantWithRole(
  participants: readonly ChannelParticipant[],
  role: string,
  label: string,
): ChannelParticipant {
  const matches = participants.filter(participant => participant.role === role)
  if (matches.length !== 1) throw new Error(`consult channel requires exactly one ${label} participant`)
  return matches[0] as ChannelParticipant
}

/** Require an exact object-key set before reading protocol JSON. */
function exactKeys(value: JsonObject, keys: readonly string[], subject: string): void {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`${subject} has unsupported fields`)
}

/** Recognize a JSON object. */
function isObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require one opaque identifier in adapter-owned state. */
function requireIdentifier(value: JsonValue | undefined, subject: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${subject} must be a nonempty string`)
  return value
}
