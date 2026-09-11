/** Stateless versioned direct-channel adapters. @module @clocky/clocky-team-channel-direct/direct */

import type { ImageAttachmentRef } from '@clocky/clocky-attachment'
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
} from '@clocky/clocky-team'

/** Stable adapter type shared by every direct-channel protocol version. */
export const DIRECT_CHANNEL_TYPE = 'direct'
/** Adapter version retained for existing multi-party text-only direct channels. */
export const DIRECT_CHANNEL_VERSION_V1 = 1
/** Adapter version for the product's two-party text and final-answer channel. */
export const DIRECT_CHANNEL_VERSION_V2 = 2
/** Adapter version for the product's two-party human-content and final-answer channel. */
export const DIRECT_CHANNEL_VERSION_V3 = 3
/** Adapter version for explicitly addressed or broadcast ordered-content messages. */
export const DIRECT_CHANNEL_VERSION_V4 = 4
/** Stable adapter reference for opening a version-one direct channel. */
export const DIRECT_CHANNEL_ADAPTER_V1: TeamAdapterRef = Object.freeze({
  type: DIRECT_CHANNEL_TYPE,
  version: DIRECT_CHANNEL_VERSION_V1,
})
/** Stable adapter reference for opening a version-two product direct channel. */
export const DIRECT_CHANNEL_ADAPTER_V2: TeamAdapterRef = Object.freeze({
  type: DIRECT_CHANNEL_TYPE,
  version: DIRECT_CHANNEL_VERSION_V2,
})
/** Stable adapter reference for opening a version-three product direct channel. */
export const DIRECT_CHANNEL_ADAPTER_V3: TeamAdapterRef = Object.freeze({
  type: DIRECT_CHANNEL_TYPE,
  version: DIRECT_CHANNEL_VERSION_V3,
})
/** Stable adapter reference for opening a version-four direct channel. */
export const DIRECT_CHANNEL_ADAPTER_V4: TeamAdapterRef = Object.freeze({
  type: DIRECT_CHANNEL_TYPE,
  version: DIRECT_CHANNEL_VERSION_V4,
})
/** Direct Envelope kind for an ordinary text message. */
export const DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND = 'message'
/** Direct product Envelope kind for a final answer. */
export const DIRECT_CHANNEL_FINAL_ENVELOPE_KIND = 'final'

const EMPTY_VIEW: JsonObject = Object.freeze({})
const NO_FOLLOW_UP_RECORDS: readonly ChannelAdapterRecordDraft[] = Object.freeze([])
const NO_EXPECTED_SPEAKER: ChannelExpectedNext = Object.freeze({ kind: 'none' })

/** Frozen identity and exact two-party membership for a version-two direct channel. */
export interface DirectChannelV2Manifest {
  /** Channel carrying direct product communication. */
  readonly channelId: ChannelManifest['id']
  /** Team that owns the channel. */
  readonly teamId: ChannelManifest['teamId']
  /** Exactly two distinct participants eligible to send or receive on the channel. */
  readonly participantIds: readonly [ParticipantId, ParticipantId]
}

/** Frozen identity and exact two-party membership for a version-three direct channel. */
export interface DirectChannelV3Manifest {
  /** Channel carrying direct product communication. */
  readonly channelId: ChannelManifest['id']
  /** Team that owns the channel. */
  readonly teamId: ChannelManifest['teamId']
  /** Exactly two distinct participants eligible to send or receive on the channel. */
  readonly participantIds: readonly [ParticipantId, ParticipantId]
}

/** Frozen identity and multi-party membership of a version-four direct channel. */
export interface DirectChannelV4Manifest {
  /** Channel carrying explicit direct messages. */
  readonly channelId: ChannelManifest['id']
  /** Team that owns the channel. */
  readonly teamId: ChannelManifest['teamId']
  /** Distinct immutable channel members, with at least two entries. */
  readonly participantIds: readonly ParticipantId[]
}

/** Frozen identity, version, and exact membership shared by direct product channels. */
export interface DirectProductChannelManifest {
  /** Channel carrying direct product communication. */
  readonly channelId: ChannelManifest['id']
  /** Team that owns the channel. */
  readonly teamId: ChannelManifest['teamId']
  /** Direct product protocol version selected by the channel. */
  readonly version: typeof DIRECT_CHANNEL_VERSION_V2 | typeof DIRECT_CHANNEL_VERSION_V3 | typeof DIRECT_CHANNEL_VERSION_V4
  /** Exactly two distinct participants eligible to send or receive on the channel. */
  readonly participantIds: readonly [ParticipantId, ParticipantId]
}

/** One visible human text block accepted by direct v3. */
export interface DirectChannelHumanTextBlock {
  /** Human-content discriminant. */
  readonly type: 'text'
  /** Nonempty text supplied by the human sender. */
  readonly text: string
}

/** One durable image reference accepted by direct v3. */
export interface DirectChannelHumanImageBlock {
  /** Human-content discriminant. */
  readonly type: 'image'
  /** Immutable image attachment already admitted by the attachment service. */
  readonly attachment: ImageAttachmentRef
}

/** Human-visible direct v3 content; tools and model reasoning are not channel payloads. */
export type DirectChannelHumanContentBlock = DirectChannelHumanTextBlock | DirectChannelHumanImageBlock

/** Exact payload carried by one direct v3 `message` Envelope. */
export interface DirectChannelV3MessagePayload {
  /** Ordered, nonempty human text and durable image references. */
  readonly content: readonly DirectChannelHumanContentBlock[]
}

/** Ordered visible content shared by direct v3 and v4 messages. */
export type DirectChannelV4MessagePayload = DirectChannelV3MessagePayload

/**
 * Version-one point-to-point Team-channel adapter. It retains no protocol
 * state: a sender explicitly addresses one other channel member with a text
 * message, then the adapter yields exactly one delivery intent for that member.
 */
export const directChannelAdapter: TeamChannelAdapter = {
  ...DIRECT_CHANNEL_ADAPTER_V1,

  validateCreate(manifest) {
    assertDirectManifest(manifest)
  },

  initialState() {
    return null
  },

  validateSend({ manifest, state, senderId, draft }) {
    assertEmptyState(state)
    assertDirectRecipient(manifest, senderId, draft.audience)
    assertMessage(draft.kind, draft.payload)
  },

  fold(state) {
    assertEmptyState(state)
    return null
  },

  afterAccept({ state }) {
    assertEmptyState(state)
    return NO_FOLLOW_UP_RECORDS
  },

  expectedNext({ state }) {
    assertEmptyState(state)
    return NO_EXPECTED_SPEAKER
  },

  deliveryPlan({ manifest, state, envelope }) {
    assertEmptyState(state)
    const participantId = assertDirectRecipient(manifest, envelope.senderId, envelope.audience)
    assertMessage(envelope.kind, envelope.payload)
    return Object.freeze([Object.freeze({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    } satisfies DeliveryIntent)])
  },

  projectView({ state }) {
    assertEmptyState(state)
    return EMPTY_VIEW
  },
}

/**
 * Parse the strict immutable manifest for a version-two product direct channel.
 * @param manifest - channel manifest to validate before deriving a product recipient.
 * @returns frozen channel identity and its exact two participant identities.
 * @throws when the manifest does not select direct v2 or is not an exact two-party channel.
 */
export function parseDirectChannelV2Manifest(manifest: ChannelManifest): DirectChannelV2Manifest {
  return parseDirectProductManifest(manifest, DIRECT_CHANNEL_VERSION_V2)
}

/**
 * Parse the strict immutable manifest for a version-three product direct channel.
 * @param manifest - channel manifest to validate before admitting human content.
 * @returns frozen channel identity and its exact two participant identities.
 * @throws when the manifest does not select direct v3 or is not an exact two-party channel.
 */
export function parseDirectChannelV3Manifest(manifest: ChannelManifest): DirectChannelV3Manifest {
  return parseDirectProductManifest(manifest, DIRECT_CHANNEL_VERSION_V3)
}

/**
 * Parse a version-four direct manifest without narrowing its roster to a single peer.
 * @param manifest - immutable channel configuration.
 * @returns frozen channel identity and all distinct participant ids.
 */
export function parseDirectChannelV4Manifest(manifest: ChannelManifest): DirectChannelV4Manifest {
  assertDirectManifest(manifest, DIRECT_CHANNEL_VERSION_V4)
  return Object.freeze({ channelId: manifest.id, teamId: manifest.teamId,
    participantIds: Object.freeze(manifest.participants.map(participant => participant.id)) })
}

/**
 * Resolve an explicit subset or every other manifest member for a direct v4 message.
 * @param manifest - immutable version-four channel configuration.
 * @param senderId - authenticated sender that must belong to the channel.
 * @param audience - nonempty distinct subset excluding the sender, or null for broadcast.
 * @returns detached ordered recipient identities.
 */
export function directChannelV4Recipients(
  manifest: ChannelManifest, senderId: ParticipantId, audience: readonly ParticipantId[] | null,
): readonly ParticipantId[] {
  const parsed = parseDirectChannelV4Manifest(manifest)
  if (!parsed.participantIds.includes(senderId)) throw new Error('direct version 4 sender must be a channel participant')
  const recipients = audience === null ? parsed.participantIds.filter(id => id !== senderId) : [...audience]
  if (recipients.length === 0 || new Set(recipients).size !== recipients.length
    || recipients.some(id => id === senderId || !parsed.participantIds.includes(id))) {
    throw new Error('direct version 4 audience must be a nonempty distinct subset of other channel participants')
  }
  return Object.freeze(recipients)
}

/**
 * Parse a product direct-channel manifest without duplicating version and membership checks.
 * @param manifest - direct v2, v3 or exact human/coordinator v4 product manifest.
 * @returns frozen channel identity, selected product version, and exact membership.
 * @throws when the manifest is not a supported exact two-party product channel.
 */
export function parseDirectProductChannelManifest(manifest: ChannelManifest): DirectProductChannelManifest {
  const version = manifest.adapter.version
  if (
    manifest.adapter.type !== DIRECT_CHANNEL_TYPE
    || (version !== DIRECT_CHANNEL_VERSION_V2 && version !== DIRECT_CHANNEL_VERSION_V3 && version !== DIRECT_CHANNEL_VERSION_V4)
  ) {
    throw new Error('direct product channel manifest does not select direct version 2, 3 or 4')
  }
  const parsed = parseDirectProductManifest(manifest, version)
  return Object.freeze({ ...parsed, version })
}

/** Parse one exact two-party product manifest for its selected protocol version. */
function parseDirectProductManifest(
  manifest: ChannelManifest,
  version: typeof DIRECT_CHANNEL_VERSION_V2 | typeof DIRECT_CHANNEL_VERSION_V3 | typeof DIRECT_CHANNEL_VERSION_V4,
): DirectChannelV2Manifest {
  if (manifest.adapter.type !== DIRECT_CHANNEL_TYPE || manifest.adapter.version !== version) {
    throw new Error(`direct channel manifest does not select direct version ${String(version)}`)
  }
  assertDirectProductParticipantCount(manifest.participants, version)
  const [first, second] = manifest.participants
  if (first.id === second.id) {
    throw new Error(`direct version ${String(version)} channel participants must be distinct`)
  }
  if (Object.keys(manifest.limits).length !== 0) {
    throw new Error(`direct version ${String(version)} channel does not accept adapter limits`)
  }
  if (version === DIRECT_CHANNEL_VERSION_V4
    && (manifest.participants.filter(participant => participant.role === 'human').length !== 1
      || manifest.participants.filter(participant => participant.role === 'coordinator').length !== 1)) {
    throw new Error('direct version 4 product channel requires one human and one coordinator role')
  }
  return Object.freeze({
    channelId: manifest.id,
    teamId: manifest.teamId,
    participantIds: Object.freeze([first.id, second.id] as const),
  })
}

/** Require the exact cardinality that lets a product Consumer derive one peer. */
function assertDirectProductParticipantCount(
  participants: readonly ChannelParticipant[],
  version: typeof DIRECT_CHANNEL_VERSION_V2 | typeof DIRECT_CHANNEL_VERSION_V3 | typeof DIRECT_CHANNEL_VERSION_V4,
): asserts participants is readonly [ChannelParticipant, ChannelParticipant] {
  if (participants.length !== 2) {
    throw new Error(`direct version ${String(version)} channel requires exactly two participants`)
  }
}

/**
 * Resolve the other participant of a validated version-two direct channel.
 * @param manifest - version-two product direct manifest to inspect.
 * @param participantId - current sender or recipient whose peer is needed.
 * @returns the other immutable channel participant.
 * @throws when `participantId` is not a member of the exact two-party channel.
 */
export function directChannelV2Peer(manifest: ChannelManifest, participantId: ParticipantId): ParticipantId {
  return directProductPeer(
    parseDirectChannelV2Manifest(manifest),
    participantId,
    'direct version 2 channel participant must be one of the two channel participants',
  )
}

/**
 * Resolve the other participant of a validated version-three direct channel.
 * @param manifest - version-three product direct manifest to inspect.
 * @param participantId - current sender or recipient whose peer is needed.
 * @returns the other immutable channel participant.
 * @throws when `participantId` is not a member of the exact two-party channel.
 */
export function directChannelV3Peer(manifest: ChannelManifest, participantId: ParticipantId): ParticipantId {
  return directProductPeer(
    parseDirectChannelV3Manifest(manifest),
    participantId,
    'direct version 3 channel participant must be one of the two channel participants',
  )
}

/**
 * Resolve the peer of a supported exact two-party direct product channel.
 * @param manifest - direct product manifest to inspect.
 * @param participantId - current sender or recipient whose peer is needed.
 * @returns the other immutable channel participant.
 * @throws when `participantId` is not a member of the exact two-party channel.
 */
export function directProductChannelPeer(manifest: ChannelManifest, participantId: ParticipantId): ParticipantId {
  return directProductPeer(
    parseDirectProductChannelManifest(manifest),
    participantId,
    'direct product channel participant must be one of the two channel participants',
  )
}

/** Resolve the other member from a parser-validated exact two-party direct channel. */
function directProductPeer(
  parsed: Pick<DirectChannelV2Manifest, 'participantIds'>,
  participantId: ParticipantId,
  errorMessage: string,
): ParticipantId {
  const [first, second] = parsed.participantIds
  if (participantId === first) return second
  if (participantId === second) return first
  throw new Error(errorMessage)
}

/** Build the sole direct-product final draft after exact peer derivation. */
function directFinalDraft(manifest: ChannelManifest, senderId: ParticipantId, text: string) {
  return Object.freeze({
    audience: Object.freeze([directProductChannelPeer(manifest, senderId)]),
    kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
    payload: Object.freeze({ text }),
    delivery: 'turn' as const,
  })
}

/**
 * Version-two product direct-channel adapter. It validates the exact two-party
 * product channel, keeps v1's explicit recipient checks, and admits text
 * messages or final answers without scheduling a reply or retaining fold state.
 */
export const directChannelV2Adapter: TeamChannelAdapter = {
  ...DIRECT_CHANNEL_ADAPTER_V2,

  validateCreate(manifest) {
    parseDirectChannelV2Manifest(manifest)
  },

  initialState(manifest) {
    parseDirectChannelV2Manifest(manifest)
    return null
  },

  validateSend({ manifest, state, senderId, draft }) {
    parseDirectChannelV2Manifest(manifest)
    assertEmptyState(state)
    assertDirectRecipient(manifest, senderId, draft.audience)
    assertDirectV2Envelope(draft.kind, draft.payload)
  },

  prepareFinal({ manifest, state, senderId, text }) {
    parseDirectChannelV2Manifest(manifest)
    assertEmptyState(state)
    return directFinalDraft(manifest, senderId, text)
  },

  fold(state) {
    assertEmptyState(state)
    return null
  },

  afterAccept({ manifest, state }) {
    parseDirectChannelV2Manifest(manifest)
    assertEmptyState(state)
    return NO_FOLLOW_UP_RECORDS
  },

  expectedNext({ manifest, state }) {
    parseDirectChannelV2Manifest(manifest)
    assertEmptyState(state)
    return NO_EXPECTED_SPEAKER
  },

  deliveryPlan({ manifest, state, envelope }) {
    parseDirectChannelV2Manifest(manifest)
    assertEmptyState(state)
    const participantId = assertDirectRecipient(manifest, envelope.senderId, envelope.audience)
    assertDirectV2Envelope(envelope.kind, envelope.payload)
    return Object.freeze([Object.freeze({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    } satisfies DeliveryIntent)])
  },

  projectView({ manifest, state }) {
    parseDirectChannelV2Manifest(manifest)
    assertEmptyState(state)
    return EMPTY_VIEW
  },
}

/**
 * Version-three product direct-channel adapter. It accepts human text and
 * durable image references in `message` Envelopes, preserves direct v2's final
 * answer, and neither schedules a reply nor retains fold state.
 */
export const directChannelV3Adapter: TeamChannelAdapter = {
  ...DIRECT_CHANNEL_ADAPTER_V3,

  validateCreate(manifest) {
    parseDirectChannelV3Manifest(manifest)
  },

  initialState(manifest) {
    parseDirectChannelV3Manifest(manifest)
    return null
  },

  validateSend({ manifest, state, senderId, draft }) {
    parseDirectChannelV3Manifest(manifest)
    assertEmptyState(state)
    assertDirectRecipient(manifest, senderId, draft.audience)
    assertDirectV3Envelope(draft.kind, draft.payload)
  },

  prepareFinal({ manifest, state, senderId, text }) {
    parseDirectChannelV3Manifest(manifest)
    assertEmptyState(state)
    return directFinalDraft(manifest, senderId, text)
  },

  fold(state) {
    assertEmptyState(state)
    return null
  },

  afterAccept({ manifest, state }) {
    parseDirectChannelV3Manifest(manifest)
    assertEmptyState(state)
    return NO_FOLLOW_UP_RECORDS
  },

  expectedNext({ manifest, state }) {
    parseDirectChannelV3Manifest(manifest)
    assertEmptyState(state)
    return NO_EXPECTED_SPEAKER
  },

  deliveryPlan({ manifest, state, envelope }) {
    parseDirectChannelV3Manifest(manifest)
    assertEmptyState(state)
    const participantId = assertDirectRecipient(manifest, envelope.senderId, envelope.audience)
    assertDirectV3Envelope(envelope.kind, envelope.payload)
    return Object.freeze([Object.freeze({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    } satisfies DeliveryIntent)])
  },

  projectView({ manifest, state }) {
    parseDirectChannelV3Manifest(manifest)
    assertEmptyState(state)
    return EMPTY_VIEW
  },
}

/** Direct v4 preserves explicit messaging intent and creates independent recipient deliveries without automatic replies. */
export const directChannelV4Adapter: TeamChannelAdapter = {
  ...DIRECT_CHANNEL_ADAPTER_V4,
  allowParticipantRemoval({ manifest, state, participantId, retainedParticipantIds }) {
    const parsed = parseDirectChannelV4Manifest(manifest)
    assertEmptyState(state)
    return parsed.participantIds.includes(participantId) && !retainedParticipantIds.includes(participantId)
      && retainedParticipantIds.length >= 2 && retainedParticipantIds.every(id => parsed.participantIds.includes(id))
  },
  validateCreate(manifest) { parseDirectChannelV4Manifest(manifest) },
  initialState(manifest) { parseDirectChannelV4Manifest(manifest); return null },
  validateSend({ manifest, state, senderId, draft }) {
    assertEmptyState(state)
    assertDirectV4Envelope(manifest, senderId, draft.audience, draft.kind, draft.payload, draft.delivery)
  },
  prepareFinal({ manifest, state, senderId, text }) {
    assertEmptyState(state)
    parseDirectChannelV4Manifest(manifest)
    parseDirectProductChannelManifest(manifest)
    if (manifest.participants.find(participant => participant.id === senderId)?.role !== 'coordinator') {
      throw new Error('direct version 4 final sender must be the coordinator peer')
    }
    return directFinalDraft(manifest, senderId, text)
  },
  fold(state) { assertEmptyState(state); return null },
  afterAccept({ manifest, state }) { parseDirectChannelV4Manifest(manifest); assertEmptyState(state); return NO_FOLLOW_UP_RECORDS },
  expectedNext({ manifest, state }) { parseDirectChannelV4Manifest(manifest); assertEmptyState(state); return NO_EXPECTED_SPEAKER },
  deliveryPlan({ manifest, state, envelope }) {
    assertEmptyState(state)
    const recipients = assertDirectV4Envelope(manifest, envelope.senderId, envelope.audience, envelope.kind,
      envelope.payload, envelope.delivery)
    return Object.freeze(recipients.map(participantId => Object.freeze({
      participantId, envelopeId: envelope.id, delivery: envelope.delivery,
    } satisfies DeliveryIntent)))
  },
  projectView({ manifest, state }) { parseDirectChannelV4Manifest(manifest); assertEmptyState(state); return EMPTY_VIEW },
}

/** Validate the full v4 message/final request before deriving durable recipient intents. */
function assertDirectV4Envelope(
  manifest: ChannelManifest, senderId: ParticipantId, audience: readonly ParticipantId[] | null,
  kind: string, payload: JsonObject, delivery: string,
): readonly ParticipantId[] {
  const recipients = directChannelV4Recipients(manifest, senderId, audience)
  if (kind === DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND) {
    parseDirectChannelV4MessagePayload(payload)
    return recipients
  }
  if (kind !== DIRECT_CHANNEL_FINAL_ENVELOPE_KIND) throw new Error('direct version 4 accepts only message or final Envelopes')
  parseDirectProductChannelManifest(manifest)
  if (audience === null || recipients.length !== 1 || delivery !== 'turn'
    || manifest.participants.find(participant => participant.id === senderId)?.role !== 'coordinator'
    || manifest.participants.find(participant => participant.id === recipients[0])?.role !== 'human') {
    throw new Error('direct version 4 final must use turn delivery addressed only to the human peer')
  }
  assertObjectFields(payload, ['text'], [], 'direct version 4 final payload must contain only text')
  if (typeof payload.text !== 'string' || payload.text.length === 0) throw new Error('direct version 4 final text must be nonempty')
  return recipients
}

/**
 * Parse an exact direct v3 human-message payload.
 * @param payload - message payload from a direct v3 Envelope.
 * @returns a frozen ordered sequence of text and durable image-reference blocks.
 * @throws when the payload has extra fields, is empty, or contains non-human content.
 */
export function parseDirectChannelV3MessagePayload(payload: JsonObject): DirectChannelV3MessagePayload {
  return parseDirectContent(payload, DIRECT_CHANNEL_VERSION_V3)
}

/**
 * Parse ordered text/image content in a direct v4 message.
 * @param payload - exact JSON content payload.
 * @returns frozen content blocks backed by durable image references.
 */
export function parseDirectChannelV4MessagePayload(payload: JsonObject): DirectChannelV4MessagePayload {
  return parseDirectContent(payload, DIRECT_CHANNEL_VERSION_V4)
}

/** Share the ordered content parser while retaining protocol-specific diagnostics. */
function parseDirectContent(payload: JsonObject, version: 3 | 4): DirectChannelV3MessagePayload {
  assertObjectFields(payload, ['content'], [], `direct version ${version} message payload must contain only content`)
  const content = payload.content
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error(`direct version ${version} message content must be a nonempty array`)
  }
  return Object.freeze({
    content: Object.freeze(content.map((value: JsonValue) => parseDirectChannelHumanContentBlock(value, version))),
  })
}

/** Parse and freeze one ordered direct text or image block. */
function parseDirectChannelHumanContentBlock(value: JsonValue, version: 3 | 4): DirectChannelHumanContentBlock {
  if (!isJsonObject(value)) {
    throw new Error(`direct version ${version} message content must contain only text or image blocks`)
  }
  switch (value.type) {
    case 'text':
      assertObjectFields(value, ['type', 'text'], [], `direct version ${version} text block must contain only type and text`)
      if (typeof value.text !== 'string' || value.text.length === 0) {
        throw new Error(`direct version ${version} text block text must be a nonempty string`)
      }
      return Object.freeze({ type: 'text', text: value.text })
    case 'image':
      assertObjectFields(value, ['type', 'attachment'], [], `direct version ${version} image block must contain only type and attachment`)
      return Object.freeze({ type: 'image', attachment: parseDirectChannelImageReference(value.attachment, version) })
    default:
      throw new Error(`direct version ${version} message content must contain only text or image blocks`)
  }
}

/** Parse and freeze one durable image reference without admitting encoded bytes. */
function parseDirectChannelImageReference(value: JsonValue, version: 3 | 4): ImageAttachmentRef {
  if (!isJsonObject(value)) {
    throw new Error(`direct version ${version} image block attachment must be an image reference`)
  }
  assertObjectFields(
    value,
    ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
    ['name', 'originalDimensions'],
    `direct version ${version} image attachment contains unsupported fields`,
  )
  if (typeof value.attachmentId !== 'string' || value.attachmentId.length === 0) {
    throw new Error(`direct version ${version} image attachmentId must be a nonempty string`)
  }
  if (!isImageMediaType(value.mediaType)) {
    throw new Error(`direct version ${version} image mediaType is unsupported`)
  }
  const bytes = positiveSafeInteger(value.bytes, 'bytes', version)
  const width = positiveSafeInteger(value.width, 'width', version)
  const height = positiveSafeInteger(value.height, 'height', version)
  if (value.name !== undefined && typeof value.name !== 'string') {
    throw new Error(`direct version ${version} image name must be a string`)
  }
  const originalDimensions = value.originalDimensions === undefined
    ? undefined
    : parseDirectChannelOriginalDimensions(value.originalDimensions, version)
  return Object.freeze({
    attachmentId: value.attachmentId as ImageAttachmentRef['attachmentId'],
    mediaType: value.mediaType,
    bytes,
    width,
    height,
    ...value.name === undefined ? {} : { name: value.name },
    ...originalDimensions === undefined ? {} : { originalDimensions },
  })
}

/** Parse one optional pre-normalization image-dimension record. */
function parseDirectChannelOriginalDimensions(value: JsonValue, version: 3 | 4): NonNullable<ImageAttachmentRef['originalDimensions']> {
  if (!isJsonObject(value)) {
    throw new Error(`direct version ${version} image originalDimensions must contain only width and height`)
  }
  assertObjectFields(
    value,
    ['width', 'height'],
    [],
    `direct version ${version} image originalDimensions must contain only width and height`,
  )
  return Object.freeze({
    width: positiveSafeInteger(value.width, 'originalDimensions.width', version),
    height: positiveSafeInteger(value.height, 'originalDimensions.height', version),
  })
}

/** Require finite positive safe-integer image metadata. */
function positiveSafeInteger(value: JsonValue, field: string, version: 3 | 4): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`direct version ${version} image ${field} must be a positive safe integer`)
  }
  return value
}

/** Restrict the direct v3 image media types to the attachment service's current raster vocabulary. */
function isImageMediaType(value: JsonValue): value is ImageAttachmentRef['mediaType'] {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

/** Check required and optional own fields before reading a JSON-shaped object. */
function assertObjectFields<const RequiredFields extends readonly string[]>(
  value: JsonObject,
  required: RequiredFields,
  optional: readonly string[],
  errorMessage: string,
): asserts value is JsonObject & { readonly [Field in RequiredFields[number]]: JsonValue } {
  if (
    required.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !required.includes(field) && !optional.includes(field))
  ) {
    throw new Error(errorMessage)
  }
}

/** Recognize one JSON object without accepting arrays or null. */
function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reject a manifest that does not identify this adapter or two distinct members. */
function assertDirectManifest(manifest: ChannelManifest, version: 1 | 4 = DIRECT_CHANNEL_VERSION_V1): void {
  if (
    manifest.adapter.type !== DIRECT_CHANNEL_TYPE
    || manifest.adapter.version !== version
  ) {
    throw new Error(`direct channel manifest does not select direct version ${version}`)
  }
  if (manifest.participants.length < 2) {
    throw new Error('direct channel requires at least two participants')
  }
  const ids = manifest.participants.map(participant => participant.id)
  if (new Set(ids).size !== ids.length) {
    throw new Error('direct channel participants must be distinct')
  }
  if (Object.keys(manifest.limits).length !== 0) {
    throw new Error('direct channel does not accept adapter limits')
  }
}

/** Reject broadcast, multi-recipient, self-addressed, or nonmember delivery. */
function assertDirectRecipient(
  manifest: ChannelManifest,
  senderId: ParticipantId,
  audience: readonly ParticipantId[] | null,
): ParticipantId {
  if (audience === null || audience.length !== 1) {
    throw new Error('direct channel requires exactly one explicit recipient')
  }
  const recipientId = audience[0] as ParticipantId
  if (recipientId === senderId) throw new Error('direct channel recipient cannot be the sender')
  const members = new Set(manifest.participants.map(participant => participant.id))
  if (!members.has(senderId) || !members.has(recipientId)) {
    throw new Error('direct channel sender and recipient must be channel participants')
  }
  return recipientId
}

/** Require the one direct-protocol message kind and its complete payload fields. */
function assertMessage(kind: string, payload: JsonObject): void {
  if (kind !== DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND) throw new Error('direct channel accepts only message Envelopes')
  if (Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'text')) {
    throw new Error('direct channel message payload must contain only text')
  }
  if (typeof payload.text !== 'string' || payload.text.length === 0) {
    throw new Error('direct channel message text must be a nonempty string')
  }
}

/** Require one version-two text or final Envelope with no undeclared payload fields. */
function assertDirectV2Envelope(kind: string, payload: JsonObject): void {
  if (kind !== DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND && kind !== DIRECT_CHANNEL_FINAL_ENVELOPE_KIND) {
    throw new Error('direct version 2 channel accepts only message or final Envelopes')
  }
  if (Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'text')) {
    throw new Error(`direct version 2 ${kind} payload must contain only text`)
  }
  if (typeof payload.text !== 'string' || payload.text.length === 0) {
    throw new Error(`direct version 2 ${kind} text must be a nonempty string`)
  }
}

/** Require one version-three human-content message or a text-only final Envelope. */
function assertDirectV3Envelope(kind: string, payload: JsonObject): void {
  if (kind === DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND) {
    parseDirectChannelV3MessagePayload(payload)
    return
  }
  if (kind === DIRECT_CHANNEL_FINAL_ENVELOPE_KIND) {
    if (Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'text')) {
      throw new Error('direct version 3 final payload must contain only text')
    }
    if (typeof payload.text !== 'string' || payload.text.length === 0) {
      throw new Error('direct version 3 final text must be a nonempty string')
    }
    return
  }
  throw new Error('direct version 3 channel accepts only message or final Envelopes')
}

/** Detect invalid checkpoint or adapter state before accepting another record. */
function assertEmptyState(state: JsonValue): void {
  if (state !== null) throw new Error('direct channel state must be null')
}
