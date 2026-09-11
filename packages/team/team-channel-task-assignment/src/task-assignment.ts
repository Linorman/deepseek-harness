/**
 * Stateless version-one task-assignment channel protocol and its recovery
 * parsers. The manifest freezes the intended Agent binding before a task
 * attempt exists; the one durable Envelope supplies the assigned attempt fence.
 *
 * @module @clocky/clocky-team-channel-task-assignment/task-assignment
 */

import type {
  ActivationId,
  ActivationBindingSnapshot,
  ChannelAdapterRecordDraft,
  ChannelExpectedNext,
  ChannelManifest,
  DeliveryIntent,
  EnvelopeId,
  JsonObject,
  JsonValue,
  ParticipantId,
  TaskAttemptId,
  TeamAdapterRef,
  TeamChannelAdapter,
  TeamEnvelope,
  TeamEnvelopeDraft,
  TeamTaskId,
} from '@clocky/clocky-team'

/** Stable adapter type frozen into every version-one task-assignment manifest. */
export const TASK_ASSIGNMENT_CHANNEL_TYPE = 'task-assignment'
/** Stable adapter version frozen into every version-one task-assignment manifest. */
export const TASK_ASSIGNMENT_CHANNEL_VERSION = 1
/** Stable adapter reference for opening a version-one task-assignment channel. */
export const TASK_ASSIGNMENT_CHANNEL_ADAPTER: TeamAdapterRef = Object.freeze({
  type: TASK_ASSIGNMENT_CHANNEL_TYPE,
  version: TASK_ASSIGNMENT_CHANNEL_VERSION,
})
/** The only Envelope kind accepted by a version-one task-assignment channel. */
export const TASK_ASSIGNMENT_ENVELOPE_KIND = 'assignment'
/** The only manifest role accepted by a version-one task-assignment channel. */
export const TASK_ASSIGNMENT_ASSIGNEE_ROLE = 'assignee'

const LIMIT_KEYS = Object.freeze(['taskId', 'activationId', 'sessionId'] as const)
const PAYLOAD_KEYS = Object.freeze(['taskId', 'attemptId', 'assignedRevision', 'activationId', 'sessionId'] as const)
const NO_FOLLOW_UP_RECORDS: readonly ChannelAdapterRecordDraft[] = Object.freeze([])
const NO_EXPECTED_SPEAKER: ChannelExpectedNext = Object.freeze({ kind: 'none' })

/** Immutable Agent binding facts frozen when a task-assignment channel opens. */
export interface TaskAssignmentChannelLimits {
  /** Task whose eventual lease this channel carries. */
  readonly taskId: TeamTaskId
  /** Exact active Agent residency epoch expected to receive the assignment. */
  readonly activationId: ActivationId
  /** Exact Session durably bound to {@link activationId}. */
  readonly sessionId: ActivationBindingSnapshot['sessionId']
}

/** Static task, Agent binding, and assignee facts shared by the manifest and fold state. */
interface TaskAssignmentBinding extends TaskAssignmentChannelLimits {
  /** Single active participant authorized as both synthetic sender and recipient. */
  readonly assigneeId: ParticipantId
}

/** Complete immutable task-assignment manifest facts exposed to delivery Consumers. */
export interface TaskAssignmentChannelManifest extends TaskAssignmentBinding {
  /** Channel carrying the one assignment Envelope. */
  readonly channelId: ChannelManifest['id']
  /** Team that owns the channel and task. */
  readonly teamId: ChannelManifest['teamId']
}

/** Exact payload persisted in the single assignment Envelope. */
export interface TaskAssignmentEnvelopePayload extends TaskAssignmentChannelLimits {
  /** Newly minted task-attempt identity. */
  readonly attemptId: TaskAttemptId
  /** Task revision committed by assignment and fenced by owner start. */
  readonly assignedRevision: number
}

/** Parsed durable facts from the single version-one task-assignment Envelope. */
export interface TaskAssignmentEnvelope extends TaskAssignmentEnvelopePayload {
  /** Hub-minted Envelope identity used for durable delivery receipt and causal admission. */
  readonly envelopeId: EnvelopeId
  /** Team that owns the Envelope and assigned task. */
  readonly teamId: ChannelManifest['teamId']
  /** Channel that owns the Envelope. */
  readonly channelId: ChannelManifest['id']
  /** Participant authorized as both synthetic sender and delivery recipient. */
  readonly assigneeId: ParticipantId
}

/** Complete JSON fold state for a version-one task-assignment channel. */
interface TaskAssignmentState extends JsonObject {
  readonly taskId: TeamTaskId
  readonly activationId: ActivationId
  readonly sessionId: ActivationBindingSnapshot['sessionId']
  readonly assigneeId: ParticipantId
  readonly envelopeId?: EnvelopeId
  readonly attemptId?: TaskAttemptId
  readonly assignedRevision?: number
}

/** Envelope fields shared by drafts and Hub-stamped records. */
interface AssignmentEnvelopeData {
  readonly audience: readonly ParticipantId[] | null
  readonly kind: string
  readonly payload: JsonObject
  readonly delivery: TeamEnvelopeDraft['delivery']
  readonly causationId?: EnvelopeId
  readonly taskId?: TeamTaskId
}

/**
 * Parse a version-one task-assignment manifest for a recovery or delivery Consumer.
 * @param manifest - immutable channel manifest to validate.
 * @returns frozen task, binding, channel, and single-assignee facts.
 * @throws when the manifest is not this adapter's exact version-one protocol.
 */
export function parseTaskAssignmentChannelManifest(manifest: ChannelManifest): TaskAssignmentChannelManifest {
  if (
    manifest.adapter.type !== TASK_ASSIGNMENT_CHANNEL_TYPE
    || manifest.adapter.version !== TASK_ASSIGNMENT_CHANNEL_VERSION
  ) {
    throw new Error('task-assignment channel manifest does not select task-assignment version 1')
  }
  if (manifest.participants.length !== 1) {
    throw new Error('task-assignment channel requires exactly one assignee participant')
  }
  const participant = manifest.participants[0]
  if (participant?.role !== TASK_ASSIGNMENT_ASSIGNEE_ROLE) {
    throw new Error('task-assignment channel participant must use the assignee role')
  }
  const limits = parseLimits(manifest.limits)
  return Object.freeze({
    channelId: manifest.id,
    teamId: manifest.teamId,
    assigneeId: participant.id,
    ...limits,
  })
}

/**
 * Parse the one Hub-stamped assignment Envelope against its frozen manifest.
 * @param manifest - immutable task-assignment manifest that owns the Envelope.
 * @param envelope - Hub-stamped Envelope discovered from a channel WAL or delivery claim.
 * @returns frozen assignment and owner-start fence facts.
 * @throws when the Envelope is not the manifest's exact synthetic assignment turn.
 */
export function parseTaskAssignmentEnvelope(
  manifest: ChannelManifest,
  envelope: TeamEnvelope,
): TaskAssignmentEnvelope {
  const assignment = parseTaskAssignmentChannelManifest(manifest)
  if (envelope.channelId !== assignment.channelId || envelope.teamId !== assignment.teamId) {
    throw new Error('task-assignment Envelope does not belong to its manifest channel and Team')
  }
  const payload = parseAssignmentEnvelopeData(assignment, envelope.senderId, envelope)
  return Object.freeze({
    envelopeId: envelope.id,
    channelId: envelope.channelId,
    teamId: envelope.teamId,
    assigneeId: assignment.assigneeId,
    ...payload,
  })
}

/**
 * Version-one task-assignment adapter. It preserves assignment facts in fold
 * state so recovery validates the accepted Envelope rather than trusting a
 * mutable task projection, and it derives one durable recipient delivery.
 */
export const taskAssignmentChannelAdapter: TeamChannelAdapter = {
  ...TASK_ASSIGNMENT_CHANNEL_ADAPTER,

  validateCreate(manifest) {
    parseTaskAssignmentChannelManifest(manifest)
  },

  initialState(manifest) {
    return stateFromManifest(parseTaskAssignmentChannelManifest(manifest))
  },

  validateSend({ manifest, state, senderId, draft }) {
    const assignment = parseTaskAssignmentChannelManifest(manifest)
    const current = parseState(state)
    assertStateMatchesManifest(current, assignment)
    if (current.envelopeId !== undefined) {
      throw new Error('task-assignment channel already accepted its assignment Envelope')
    }
    parseAssignmentEnvelopeData(assignment, senderId, draft)
  },

  fold(state, record) {
    const current = parseState(state)
    if (record.type === 'channel/adapter') {
      throw new Error('task-assignment channel does not accept adapter-owned records')
    }
    if (record.type !== 'channel/envelope') return current
    if (current.envelopeId !== undefined) {
      throw new Error('task-assignment channel cannot retain more than one assignment Envelope')
    }
    const assignment = bindingFromState(current)
    const payload = parseAssignmentEnvelopeData(assignment, record.envelope.senderId, record.envelope)
    return Object.freeze({
      ...current,
      envelopeId: record.envelope.id,
      attemptId: payload.attemptId,
      assignedRevision: payload.assignedRevision,
    })
  },

  afterAccept({ manifest, state, record }) {
    const assignment = parseTaskAssignmentChannelManifest(manifest)
    const current = parseState(state)
    assertStateMatchesManifest(current, assignment)
    if (current.envelopeId !== record.envelope.id) {
      throw new Error('task-assignment post-accept state must retain the accepted Envelope id')
    }
    parseAssignmentEnvelopeData(assignment, record.envelope.senderId, record.envelope)
    return NO_FOLLOW_UP_RECORDS
  },

  expectedNext({ manifest, state }) {
    const assignment = parseTaskAssignmentChannelManifest(manifest)
    const current = parseState(state)
    assertStateMatchesManifest(current, assignment)
    return current.envelopeId === undefined
      ? Object.freeze({ kind: 'participant' as const, participantId: assignment.assigneeId })
      : NO_EXPECTED_SPEAKER
  },

  deliveryPlan({ manifest, state, envelope }) {
    const assignment = parseTaskAssignmentChannelManifest(manifest)
    const current = parseState(state)
    assertStateMatchesManifest(current, assignment)
    if (current.envelopeId !== envelope.id) {
      throw new Error('task-assignment delivery requires the accepted assignment Envelope')
    }
    parseAssignmentEnvelopeData(assignment, envelope.senderId, envelope)
    return Object.freeze([Object.freeze({
      participantId: assignment.assigneeId,
      envelopeId: envelope.id,
      delivery: 'turn' as const,
    } satisfies DeliveryIntent)])
  },

  projectView({ manifest, state, records }) {
    const assignment = parseTaskAssignmentChannelManifest(manifest)
    const current = parseState(state)
    assertStateMatchesManifest(current, assignment)
    let accepted: TaskAssignmentEnvelope | undefined
    for (const record of records) {
      if (record.type !== 'channel/envelope') continue
      if (accepted !== undefined) {
        throw new Error('task-assignment channel view cannot contain more than one assignment Envelope')
      }
      const payload = parseAssignmentEnvelopeData(assignment, record.envelope.senderId, record.envelope)
      accepted = Object.freeze({
        envelopeId: record.envelope.id,
        channelId: manifest.id,
        teamId: manifest.teamId,
        assigneeId: assignment.assigneeId,
        ...payload,
      })
    }
    if (current.envelopeId === undefined && accepted !== undefined) {
      throw new Error('task-assignment channel state is missing its accepted assignment Envelope')
    }
    if (current.envelopeId !== undefined && accepted === undefined) {
      throw new Error('task-assignment channel state retains an absent assignment Envelope')
    }
    if (
      accepted !== undefined
      && (
        current.envelopeId !== accepted.envelopeId
        || current.attemptId !== accepted.attemptId
        || current.assignedRevision !== accepted.assignedRevision
      )
    ) {
      throw new Error('task-assignment channel state does not match its accepted Envelope')
    }
    return Object.freeze({
      assigneeId: assignment.assigneeId,
      taskId: assignment.taskId,
      activationId: assignment.activationId,
      sessionId: assignment.sessionId,
      ...current.envelopeId === undefined ? {} : {
        envelopeId: current.envelopeId,
        attemptId: current.attemptId,
        assignedRevision: current.assignedRevision,
      },
    })
  },
}

/** Parse strict immutable task and Agent binding facts from manifest limits. */
function parseLimits(limits: JsonObject): TaskAssignmentChannelLimits {
  assertExactKeys(limits, LIMIT_KEYS, 'task-assignment channel limits')
  return Object.freeze({
    taskId: requireIdentifier(limits.taskId, 'task-assignment channel taskId') as TeamTaskId,
    activationId: requireIdentifier(limits.activationId, 'task-assignment channel activationId') as ActivationId,
    sessionId: requireIdentifier(
      limits.sessionId,
      'task-assignment channel sessionId',
    ) as ActivationBindingSnapshot['sessionId'],
  })
}

/** Parse the one exact assignment turn against manifest-backed static facts. */
function parseAssignmentEnvelopeData(
  assignment: TaskAssignmentBinding,
  senderId: ParticipantId,
  envelope: AssignmentEnvelopeData,
): TaskAssignmentEnvelopePayload {
  if (senderId !== assignment.assigneeId) {
    throw new Error('task-assignment Envelope sender must be the assignee')
  }
  if (envelope.audience === null || envelope.audience.length !== 1 || envelope.audience[0] !== assignment.assigneeId) {
    throw new Error('task-assignment Envelope must address exactly its assignee')
  }
  if (envelope.kind !== TASK_ASSIGNMENT_ENVELOPE_KIND) {
    throw new Error('task-assignment channel accepts only assignment Envelopes')
  }
  if (envelope.delivery !== 'turn') {
    throw new Error('task-assignment Envelope delivery must be turn')
  }
  if (envelope.causationId !== undefined) {
    throw new Error('task-assignment Envelope cannot carry a causation id')
  }
  if (envelope.taskId !== assignment.taskId) {
    throw new Error('task-assignment Envelope taskId must match channel limits')
  }
  assertExactKeys(envelope.payload, PAYLOAD_KEYS, 'task-assignment Envelope payload')
  const payload: TaskAssignmentEnvelopePayload = Object.freeze({
    taskId: requireIdentifier(envelope.payload.taskId, 'task-assignment Envelope payload taskId') as TeamTaskId,
    attemptId: requireIdentifier(envelope.payload.attemptId, 'task-assignment Envelope payload attemptId') as TaskAttemptId,
    assignedRevision: requirePositiveSafeInteger(
      envelope.payload.assignedRevision,
      'task-assignment Envelope payload assignedRevision',
    ),
    activationId: requireIdentifier(envelope.payload.activationId, 'task-assignment Envelope payload activationId') as ActivationId,
    sessionId: requireIdentifier(
      envelope.payload.sessionId,
      'task-assignment Envelope payload sessionId',
    ) as ActivationBindingSnapshot['sessionId'],
  })
  if (
    payload.taskId !== assignment.taskId
    || payload.activationId !== assignment.activationId
    || payload.sessionId !== assignment.sessionId
  ) {
    throw new Error('task-assignment Envelope payload must match channel task and Agent binding limits')
  }
  return payload
}

/** Build the initial, strict JSON fold state from a parsed manifest. */
function stateFromManifest(manifest: TaskAssignmentChannelManifest): TaskAssignmentState {
  return Object.freeze({
    taskId: manifest.taskId,
    activationId: manifest.activationId,
    sessionId: manifest.sessionId,
    assigneeId: manifest.assigneeId,
  })
}

/** Parse strict fold state, including the all-or-nothing accepted-envelope facts. */
function parseState(state: JsonValue): TaskAssignmentState {
  if (!isObject(state)) throw new Error('task-assignment channel state must be an object')
  const hasAssignment = Object.hasOwn(state, 'envelopeId')
  assertExactKeys(
    state,
    hasAssignment
      ? ['taskId', 'activationId', 'sessionId', 'assigneeId', 'envelopeId', 'attemptId', 'assignedRevision']
      : ['taskId', 'activationId', 'sessionId', 'assigneeId'],
    'task-assignment channel state',
  )
  const parsed = state as TaskAssignmentState
  requireIdentifier(parsed.taskId, 'task-assignment channel state taskId')
  requireIdentifier(parsed.activationId, 'task-assignment channel state activationId')
  requireIdentifier(parsed.sessionId, 'task-assignment channel state sessionId')
  requireIdentifier(parsed.assigneeId, 'task-assignment channel state assigneeId')
  if (hasAssignment) {
    requireIdentifier(parsed.envelopeId, 'task-assignment channel state envelopeId')
    requireIdentifier(parsed.attemptId, 'task-assignment channel state attemptId')
    requirePositiveSafeInteger(parsed.assignedRevision, 'task-assignment channel state assignedRevision')
  }
  return parsed
}

/** Project parsed static state facts into the binding facts needed by WAL folding. */
function bindingFromState(state: TaskAssignmentState): TaskAssignmentBinding {
  return Object.freeze({
    assigneeId: state.assigneeId,
    taskId: state.taskId,
    activationId: state.activationId,
    sessionId: state.sessionId,
  })
}

/** Reject a state whose static facts no longer equal its immutable manifest. */
function assertStateMatchesManifest(state: TaskAssignmentState, manifest: TaskAssignmentBinding): void {
  if (
    state.taskId !== manifest.taskId
    || state.activationId !== manifest.activationId
    || state.sessionId !== manifest.sessionId
    || state.assigneeId !== manifest.assigneeId
  ) {
    throw new Error('task-assignment channel state does not match its manifest')
  }
}

/** Require an exact own-key set without accepting extra recovery data. */
function assertExactKeys(
  value: JsonObject,
  keys: readonly string[],
  subject: string,
): void {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${subject} has unsupported fields`)
  }
}

/** Identify a JSON object before reading strict adapter-owned fields. */
function isObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require one opaque durable or wire identifier. */
function requireIdentifier(value: JsonValue | undefined, subject: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${subject} must be a nonempty string`)
  return value
}

/** Require a positive JSON-safe integer used as the assigned task revision. */
function requirePositiveSafeInteger(value: JsonValue | undefined, subject: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${subject} must be a positive safe integer`)
  }
  return value
}
