/** Declarative bounded workflow channel adapter and transition graph parser. */

import {
  isDeepStrictEqual,
} from 'node:util'
import type {
  ChannelAdapterRecordDraft,
  ChannelExpectedNext,
  ChannelManifest,
  DeliveryIntent,
  JsonObject,
  JsonValue,
  ParticipantId,
  TeamAdapterRef,
  TeamChannelAdapter,
  TeamChannelAdapterRuntimeLease,
  TeamEnvelope,
  TeamEnvelopeDraft,
} from '@clocky/clocky-team'

/** Adapter type for declarative participant transitions. */
export const WORKFLOW_CHANNEL_TYPE = 'workflow'
/** Version of the declarative workflow protocol. */
export const WORKFLOW_CHANNEL_VERSION = 1
/** Stable workflow adapter identity. */
export const WORKFLOW_CHANNEL_ADAPTER: TeamAdapterRef = Object.freeze({
  type: WORKFLOW_CHANNEL_TYPE,
  version: WORKFLOW_CHANNEL_VERSION,
})
/** Alias naming the versioned workflow adapter explicitly. */
export const WORKFLOW_CHANNEL_ADAPTER_V1 = WORKFLOW_CHANNEL_ADAPTER
/** Alias naming the versioned workflow protocol explicitly. */
export const WORKFLOW_CHANNEL_VERSION_V1 = WORKFLOW_CHANNEL_VERSION
/** Manifest limit key containing the transition graph. */
export const WORKFLOW_GRAPH_LIMIT = 'graph'

/** A workflow condition evaluated against the just-accepted Envelope. */
export type WorkflowCondition =
  | { readonly kind: 'always' }
  | { readonly kind: 'envelope-kind'; readonly value: string }
  | { readonly kind: 'payload-present'; readonly path: string }
  | { readonly kind: 'payload-equals'; readonly path: string; readonly value: JsonValue }
  | { readonly kind: 'extension'; readonly name: string; readonly version: number; readonly config: JsonValue }

/** A workflow target resolved to a next speaker by the adapter. */
export type WorkflowTarget =
  | { readonly kind: 'participant'; readonly participantId: ParticipantId }
  | { readonly kind: 'round-robin' }
  | { readonly kind: 'stay' }
  | { readonly kind: 'return-to-initiator' }
  | { readonly kind: 'terminate' }
  | { readonly kind: 'extension'; readonly name: string; readonly version: number; readonly config: JsonValue }

/** One ordered condition-to-target edge in a TransitionGraph. */
export interface WorkflowTransition {
  /** Ordered condition evaluated against a newly accepted Envelope. */
  readonly condition: WorkflowCondition
  /** Target speaker or terminal action selected when the condition matches. */
  readonly target: WorkflowTarget
}

/** JSON-serializable bounded transition graph frozen into a workflow channel. */
export interface TransitionGraph {
  /** Speaker or action expected before the first Envelope. */
  readonly initial: WorkflowTarget
  /** Ordered post-Envelope transitions; the first matching condition wins. */
  readonly transitions: readonly WorkflowTransition[]
  /** Explicit fallback target when no transition condition matches. */
  readonly defaultTarget?: WorkflowTarget
  /** Hard upper bound on accepted Envelopes, including cycles. */
  readonly maxTurns: number
}

/** Concrete target returned by a validated workflow target extension. */
export type WorkflowResolvedTarget =
  | { readonly kind: 'participant'; readonly participantId: ParticipantId }
  | { readonly kind: 'terminate' }

/** Versioned extension implementation resolved by the workflow adapter. */
export interface WorkflowExtensionResolver {
  /** Resolve one exact extension implementation retained by the deployment. */
  get(kind: 'condition' | 'target', name: string, version: number): {
    validate(value: JsonValue): void
    evaluate?: (input: { readonly config: JsonValue; readonly envelope: TeamEnvelope; readonly state: JsonValue }) => boolean
    resolve?: (input: { readonly config: JsonValue; readonly state: JsonValue }) => WorkflowResolvedTarget
  } | undefined
}

/** Runtime-only retained extensions selected by one validated workflow graph. */
export interface WorkflowExtensionLeaseSet extends WorkflowExtensionResolver {
  /** Release every exact extension retained by this graph once. */
  release(): void
}

/** A resolver that can retain every extension selected by a validated graph. */
export interface WorkflowExtensionLeaseAcquirer extends WorkflowExtensionResolver {
  /**
   * Retain the exact accepting extension implementations referenced by a graph.
   * @param graph - graph already validated for a workflow channel.
   * @returns a release-once resolver for the graph's exact implementations.
   */
  acquireForGraph(graph: TransitionGraph): WorkflowExtensionLeaseSet
}

/** A release-once workflow adapter wrapper bound to exact extension implementations. */
export interface WorkflowExtensionLeaseHandle extends TeamChannelAdapterRuntimeLease {
  /** Adapter whose graph resolution uses the retained extension implementations. */
  readonly adapter: TeamChannelAdapter
  /** Release every extension retained by this active channel once. */
  release(): void
}

/** A workflow adapter that can bind one active channel to retained extensions. */
export interface WorkflowExtensionLeaseableAdapter extends TeamChannelAdapter {
  /**
   * Validate a manifest and retain every extension it selects for one channel.
   * @param manifest - immutable workflow channel manifest.
   * @returns a release-once adapter wrapper bound to its exact extensions.
   */
  acquireExtensionLeases(manifest: ChannelManifest): WorkflowExtensionLeaseHandle
  /** Generic Team adapter-retention hook used by providers without importing this package. */
  acquireRuntimeLease(manifest: ChannelManifest): TeamChannelAdapterRuntimeLease
}

/** Parsed workflow channel manifest with its ordered participant roster. */
export interface WorkflowChannelManifest {
  /** Workflow channel identity. */
  readonly channelId: ChannelManifest['id']
  /** Owning Team identity. */
  readonly teamId: ChannelManifest['teamId']
  /** Ordered participants used by round-robin targets. */
  readonly participantIds: readonly ParticipantId[]
  /** First participant, used by `return-to-initiator`. */
  readonly initiatorId: ParticipantId
  /** Validated immutable transition graph. */
  readonly graph: TransitionGraph
}

interface WorkflowState extends JsonObject {
  readonly participantIds: readonly ParticipantId[]
  readonly initiatorId: ParticipantId
  readonly graph: JsonObject
  readonly maxTurns: number
  readonly turnCount: number
  readonly expectedTarget: JsonObject
  readonly lastSenderId?: ParticipantId
}

type ResolvedWorkflowTarget =
  | { readonly kind: 'participant'; readonly participantId: ParticipantId }
  | { readonly kind: 'terminate' }

const NO_FOLLOW_UP_RECORDS: readonly ChannelAdapterRecordDraft[] = Object.freeze([])
const NO_EXPECTED_SPEAKER: ChannelExpectedNext = Object.freeze({ kind: 'none' })

/**
 * Parse a strict JSON transition graph.
 * @param value - untrusted graph-shaped JSON value.
 * @param resolver - optional exact versioned extension registry.
 * @returns the validated immutable graph.
 */
export function parseTransitionGraph(value: JsonValue, resolver?: WorkflowExtensionResolver): TransitionGraph {
  if (!isObject(value)) throw new Error('workflow graph must be an object')
  const hasDefault = Object.hasOwn(value, 'defaultTarget')
  exactKeys(value, hasDefault
    ? ['initial', 'transitions', 'defaultTarget', 'maxTurns']
    : ['initial', 'transitions', 'maxTurns'], 'workflow graph')
  const initial = parseTarget(value.initial, resolver)
  if (initial.kind === 'terminate') throw new Error('workflow graph initial target cannot terminate')
  if (!Array.isArray(value.transitions)) throw new Error('workflow graph transitions must be an array')
  const transitionValues = value.transitions as unknown as readonly JsonValue[]
  const transitions = transitionValues.map((transition, index) => parseTransition(transition, index, resolver))
  const defaultTarget = hasDefault ? parseTarget(value.defaultTarget, resolver) : undefined
  const maxTurns = positiveSafeInteger(value.maxTurns, 'workflow graph maxTurns')
  return Object.freeze({
    initial,
    transitions: Object.freeze(transitions),
    ...defaultTarget === undefined ? {} : { defaultTarget },
    maxTurns,
  })
}

/**
 * Parse and validate a workflow manifest, including every participant target.
 * @param manifest - immutable channel configuration to validate.
 * @param resolver - optional exact versioned extension registry.
 * @returns the ordered roster and validated graph.
 */
export function parseWorkflowChannelManifest(manifest: ChannelManifest, resolver?: WorkflowExtensionResolver): WorkflowChannelManifest {
  if (manifest.adapter.type !== WORKFLOW_CHANNEL_TYPE || manifest.adapter.version !== WORKFLOW_CHANNEL_VERSION) {
    throw new Error('workflow channel manifest does not select workflow version 1')
  }
  if (manifest.participants.length < 2) throw new Error('workflow channel requires at least two participants')
  const participantIds = manifest.participants.map(participant => participant.id)
  if (new Set(participantIds).size !== participantIds.length) throw new Error('workflow participants must be distinct')
  exactKeys(manifest.limits, [WORKFLOW_GRAPH_LIMIT], 'workflow channel limits')
  const graph = parseTransitionGraph(requireJsonValue(manifest.limits[WORKFLOW_GRAPH_LIMIT], 'workflow graph'), resolver)
  const members = new Set(participantIds)
  validateTargets(graph, members)
  return Object.freeze({
    channelId: manifest.id,
    teamId: manifest.teamId,
    participantIds: Object.freeze([...participantIds]),
    initiatorId: participantIds[0] as ParticipantId,
    graph,
  })
}

/**
 * Workflow protocol with ordered transitions, explicit fallback, and bounded termination.
 * @param resolver - optional exact versioned extension registry.
 * @returns the workflow channel adapter.
 */
export function createWorkflowChannelAdapter(resolver: WorkflowExtensionLeaseAcquirer): WorkflowExtensionLeaseableAdapter
/**
 * Build a workflow adapter when extension retention is not available.
 * @param resolver - optional exact versioned extension resolver.
 * @returns a workflow channel adapter selected by the manifest.
 */
export function createWorkflowChannelAdapter(resolver?: WorkflowExtensionResolver): TeamChannelAdapter
/**
 * Build the workflow adapter, retaining graph extensions when the resolver supports leases.
 * @param resolver - optional exact versioned extension resolver.
 * @returns a workflow channel adapter selected by the manifest.
 */
export function createWorkflowChannelAdapter(resolver?: WorkflowExtensionResolver): TeamChannelAdapter {
  const adapter: TeamChannelAdapter = {
    ...WORKFLOW_CHANNEL_ADAPTER,

    validateCreate(manifest) {
      parseWorkflowChannelManifest(manifest, resolver)
    },

    initialState(manifest) {
      const parsed = parseWorkflowChannelManifest(manifest, resolver)
      return initialWorkflowState(parsed)
    },

    validateSend({ manifest, state, senderId, draft }) {
      const parsed = parseWorkflowChannelManifest(manifest, resolver)
      const current = parseWorkflowState(state, resolver)
      assertWorkflowStateMatchesManifest(current, parsed)
      assertWorkflowDraft(current, senderId, draft, resolver)
    },

    fold(state, record) {
      const current = parseWorkflowState(state, resolver)
      if (record.type !== 'channel/envelope') {
        if (record.type === 'channel/adapter') throw new Error('workflow channel does not accept adapter-owned records')
        return current
      }
      assertWorkflowEnvelope(current, record.envelope, 'before', resolver)
      const nextTarget = selectTarget(current, record.envelope, resolver)
      return Object.freeze({
        ...current,
        turnCount: current.turnCount + 1,
        expectedTarget: targetValue(current.turnCount + 1 >= current.maxTurns ? { kind: 'terminate' } : nextTarget),
        lastSenderId: record.envelope.senderId,
      })
    },

    afterAccept({ state, record }) {
      const current = parseWorkflowState(state, resolver)
      assertWorkflowEnvelope(current, record.envelope, 'after', resolver)
      return NO_FOLLOW_UP_RECORDS
    },

    closeAfterAccept({ state }) {
      const current = parseWorkflowState(state, resolver)
      return current.turnCount >= current.maxTurns || resolveTarget(parseTarget(current.expectedTarget, resolver), current, resolver).kind === 'terminate'
        ? 'workflow transition reached a terminal target'
        : undefined
    },

    allowsClosedDelivery({ manifest, state }) {
      const parsed = parseWorkflowChannelManifest(manifest, resolver)
      const current = parseWorkflowState(state, resolver)
      assertWorkflowStateMatchesManifest(current, parsed)
      return current.turnCount > 0 && (current.turnCount >= current.maxTurns
        || resolveTarget(parseTarget(current.expectedTarget, resolver), current, resolver).kind === 'terminate')
    },

    expectedNext({ manifest, state }) {
      const parsed = parseWorkflowChannelManifest(manifest, resolver)
      const current = parseWorkflowState(state, resolver)
      assertWorkflowStateMatchesManifest(current, parsed)
      const target = resolveTarget(parseTarget(current.expectedTarget, resolver), current, resolver)
      return target.kind === 'terminate'
        ? NO_EXPECTED_SPEAKER
        : Object.freeze({ kind: 'participant', participantId: target.participantId })
    },

    deliveryPlan({ manifest, state, envelope }) {
      const parsed = parseWorkflowChannelManifest(manifest, resolver)
      const current = parseWorkflowState(state, resolver)
      assertWorkflowStateMatchesManifest(current, parsed)
      assertWorkflowEnvelope(current, envelope, 'after', resolver)
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
      const parsed = parseWorkflowChannelManifest(manifest, resolver)
      const current = parseWorkflowState(state, resolver)
      assertWorkflowStateMatchesManifest(current, parsed)
      const expected = resolveTarget(parseTarget(current.expectedTarget, resolver), current, resolver)
      return Object.freeze({
        turnCount: current.turnCount,
        maxTurns: current.maxTurns,
        expectedNext: expected.kind === 'terminate' ? null : expected.participantId,
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
  if (!isWorkflowExtensionLeaseAcquirer(resolver)) return adapter
  const leaseable: WorkflowExtensionLeaseableAdapter = {
    ...adapter,
    acquireExtensionLeases(manifest: ChannelManifest) {
      const graph = parseWorkflowChannelManifest(manifest, resolver).graph
      const extensions = resolver.acquireForGraph(graph)
      return Object.freeze({
        adapter: createWorkflowChannelAdapter(extensions),
        release: () => { extensions.release() },
      })
    },
    acquireRuntimeLease(manifest) {
      return this.acquireExtensionLeases(manifest)
    },
  }
  return leaseable
}

/**
 * Recognize an adapter that binds an active workflow channel to extension leases.
 * @param adapter - channel adapter selected by one durable manifest.
 * @returns whether the adapter can retain its graph extensions for an active channel.
 */
export function isWorkflowExtensionLeaseableAdapter(adapter: TeamChannelAdapter): adapter is WorkflowExtensionLeaseableAdapter {
  return typeof (adapter as Partial<WorkflowExtensionLeaseableAdapter>).acquireExtensionLeases === 'function'
}

/** Built-in workflow adapter with no deployment extensions. */
export const workflowChannelAdapter: TeamChannelAdapter = createWorkflowChannelAdapter()

/**
 * Parse one workflow text payload used by the simple adapter examples.
 * @param payload - JSON payload to validate.
 * @returns the validated text value.
 */
export function parseWorkflowTextPayload(payload: JsonObject): { readonly text: string } {
  exactKeys(payload, ['text'], 'workflow message payload')
  if (typeof payload.text !== 'string' || payload.text.length === 0) throw new Error('workflow message text must be nonempty')
  return Object.freeze({ text: payload.text })
}

/** Build state from the immutable manifest. */
function initialWorkflowState(manifest: WorkflowChannelManifest): WorkflowState {
  return Object.freeze({
    participantIds: Object.freeze([...manifest.participantIds]),
    initiatorId: manifest.initiatorId,
    graph: graphValue(manifest.graph),
    maxTurns: manifest.graph.maxTurns,
    turnCount: 0,
    expectedTarget: targetValue(manifest.graph.initial),
  })
}

/** Validate one workflow draft before the Hub stamps it. */
function assertWorkflowDraft(
  state: WorkflowState,
  senderId: ParticipantId,
  draft: TeamEnvelopeDraft,
  resolver?: WorkflowExtensionResolver,
): void {
  const expected = resolveTarget(parseTarget(state.expectedTarget, resolver), state, resolver)
  if (expected.kind === 'terminate') throw new Error('workflow channel has reached a terminal target')
  if (senderId !== expected.participantId) throw new Error(`workflow expects participant '${expected.participantId}' to speak next`)
  if (draft.audience !== null) assertAudience(state.participantIds, senderId, draft.audience)
  if (draft.kind.length === 0) throw new Error('workflow Envelope kind must be nonempty')
  if (draft.delivery === 'steer') throw new Error('workflow Envelope delivery cannot be steer')
}

/** Validate an accepted workflow Envelope against the pre- or post-fold state. */
function assertWorkflowEnvelope(
  state: WorkflowState,
  envelope: TeamEnvelope,
  phase: 'before' | 'after',
  resolver?: WorkflowExtensionResolver,
): void {
  if (envelope.kind.length === 0) throw new Error('workflow Envelope kind must be nonempty')
  if (envelope.delivery === 'steer') throw new Error('workflow Envelope delivery cannot be steer')
  if (!state.participantIds.includes(envelope.senderId)) throw new Error('workflow sender is not a channel participant')
  const expected = phase === 'before'
    ? resolveTarget(parseTarget(state.expectedTarget, resolver), state, resolver)
    : state.lastSenderId === undefined ? { kind: 'terminate' as const } : { kind: 'participant' as const, participantId: state.lastSenderId }
  if (expected.kind === 'terminate' || envelope.senderId !== expected.participantId) {
    throw new Error('workflow Envelope sender is not the expected participant')
  }
  if (envelope.audience !== null) assertAudience(state.participantIds, envelope.senderId, envelope.audience)
}

/** Choose the first matching transition or the explicit terminal fallback. */
function selectTarget(state: WorkflowState, envelope: TeamEnvelope, resolver?: WorkflowExtensionResolver): WorkflowTarget {
  const graph = parseTransitionGraph(state.graph, resolver)
  const transition = graph.transitions.find(candidate => matches(candidate.condition, envelope, state, resolver))
  return transition?.target ?? graph.defaultTarget ?? { kind: 'terminate' }
}

/** Evaluate one declarative condition against an accepted Envelope. */
function matches(
  condition: WorkflowCondition,
  envelope: TeamEnvelope,
  state: WorkflowState,
  resolver?: WorkflowExtensionResolver,
): boolean {
  switch (condition.kind) {
    case 'always':
      return true
    case 'envelope-kind':
      return envelope.kind === condition.value
    case 'payload-present':
      return readPath(envelope.payload, condition.path) !== undefined
    case 'payload-equals':
      return isDeepStrictEqual(readPath(envelope.payload, condition.path), condition.value)
    case 'extension': {
      const extension = resolver?.get('condition', condition.name, condition.version)
      if (extension?.evaluate === undefined) throw new Error(`workflow condition extension '${condition.name}@${String(condition.version)}' is unavailable`)
      return extension.evaluate({ config: condition.config, envelope, state })
    }
    /* v8 ignore next 2 -- WorkflowCondition is a closed union parsed before evaluation. */
    default:
      return false
  }
}

/** Resolve an abstract workflow target to one concrete next speaker. */
function resolveTarget(target: WorkflowTarget, state: WorkflowState, resolver?: WorkflowExtensionResolver): ResolvedWorkflowTarget {
  switch (target.kind) {
    case 'participant':
      return target
    case 'terminate':
      return target
    case 'return-to-initiator':
      return { kind: 'participant', participantId: state.initiatorId }
    case 'stay':
      return state.lastSenderId === undefined
        ? { kind: 'participant', participantId: state.initiatorId }
        : { kind: 'participant', participantId: state.lastSenderId }
    case 'round-robin':
      return {
        kind: 'participant',
        participantId: nextParticipant(state.participantIds, state.lastSenderId),
      }
    case 'extension': {
      const extension = resolver?.get('target', target.name, target.version)
      if (extension?.resolve === undefined) throw new Error(`workflow target extension '${target.name}@${String(target.version)}' is unavailable`)
      const resolved = extension.resolve({ config: target.config, state })
      if (resolved.kind === 'participant' && !state.participantIds.includes(resolved.participantId)) {
        throw new Error(`workflow target extension '${target.name}@${String(target.version)}' returned an unknown participant`)
      }
      return resolved
    }
    /* v8 ignore next 2 -- WorkflowTarget is a closed union parsed before resolution. */
    default:
      return assertNever(target)
  }
}

/** Return the next ordered participant, starting with the first roster entry. */
function nextParticipant(participantIds: readonly ParticipantId[], lastSenderId: ParticipantId | undefined): ParticipantId {
  if (lastSenderId === undefined) return participantIds[0] as ParticipantId
  const index = participantIds.indexOf(lastSenderId)
  /* v8 ignore next -- parsed state and graph targets keep lastSenderId in the roster. */
  if (index < 0) throw new Error(`workflow state names unknown sender '${lastSenderId}'`)
  return participantIds[(index + 1) % participantIds.length] as ParticipantId
}

/** Validate a workflow audience without allowing self-addressing or duplicates. */
function assertAudience(participantIds: readonly ParticipantId[], senderId: ParticipantId, audience: readonly ParticipantId[]): void {
  if (audience.length === 0 || new Set(audience).size !== audience.length) throw new Error('workflow audience must be nonempty and distinct')
  for (const participantId of audience) {
    if (participantId === senderId) throw new Error('workflow audience cannot contain the sender')
    if (!participantIds.includes(participantId)) throw new Error('workflow audience must contain channel participants')
  }
}

/** Validate all participant targets before a workflow channel is opened. */
function validateTargets(graph: TransitionGraph, members: ReadonlySet<ParticipantId>): void {
  const targets = [
    graph.initial,
    ...graph.transitions.map(transition => transition.target),
    ...(graph.defaultTarget === undefined ? [] : [graph.defaultTarget]),
  ]
  for (const target of targets) {
    if (target.kind === 'participant' && !members.has(target.participantId)) {
      throw new Error(`workflow target participant '${target.participantId}' is not a channel participant`)
    }
  }
}

/** Parse the strict immutable workflow fold state. */
function parseWorkflowState(value: JsonValue, resolver?: WorkflowExtensionResolver): WorkflowState {
  if (!isObject(value)) throw new Error('workflow channel state must be an object')
  const hasLastSender = Object.hasOwn(value, 'lastSenderId')
  exactKeys(value, hasLastSender
    ? ['participantIds', 'initiatorId', 'graph', 'maxTurns', 'turnCount', 'expectedTarget', 'lastSenderId']
    : ['participantIds', 'initiatorId', 'graph', 'maxTurns', 'turnCount', 'expectedTarget'], 'workflow channel state')
  if (!Array.isArray(value.participantIds) || value.participantIds.length < 2
    || value.participantIds.some(participantId => typeof participantId !== 'string' || participantId.length === 0)) {
    throw new Error('workflow state participantIds must contain at least two identifiers')
  }
  if (new Set(value.participantIds).size !== value.participantIds.length) throw new Error('workflow state participants must be distinct')
  requireIdentifier(value.initiatorId, 'workflow state initiatorId')
  if (!value.participantIds.includes(value.initiatorId)) throw new Error('workflow state initiator is not a participant')
  const graph = parseTransitionGraph(requireJsonValue(value.graph, 'workflow state graph'), resolver)
  if (value.maxTurns !== graph.maxTurns) throw new Error('workflow state maxTurns does not match its graph')
  if (typeof value.turnCount !== 'number' || !Number.isSafeInteger(value.turnCount) || value.turnCount < 0 || value.turnCount > value.maxTurns) {
    throw new Error('workflow state turnCount is outside its graph limit')
  }
  const expectedTarget = parseTarget(value.expectedTarget, resolver)
  if (expectedTarget.kind === 'participant' && !value.participantIds.includes(expectedTarget.participantId)) {
    throw new Error('workflow state expected target is not a participant')
  }
  if (hasLastSender && (typeof value.lastSenderId !== 'string' || !value.participantIds.includes(value.lastSenderId))) {
    throw new Error('workflow state lastSenderId is not a participant')
  }
  return value as WorkflowState
}

/** Verify that the fold state still equals the immutable manifest. */
function assertWorkflowStateMatchesManifest(state: WorkflowState, manifest: WorkflowChannelManifest): void {
  if (state.initiatorId !== manifest.initiatorId || state.maxTurns !== manifest.graph.maxTurns
    || state.participantIds.length !== manifest.participantIds.length
    || state.participantIds.some((participantId, index) => participantId !== manifest.participantIds[index])
    || !isDeepStrictEqual(state.graph, graphValue(manifest.graph))) {
    throw new Error('workflow channel state does not match its manifest')
  }
}

/** Convert a graph to the lossless JSON shape retained in fold state. */
function graphValue(graph: TransitionGraph): JsonObject {
  return structuredClone(graph) as unknown as JsonObject
}

/** Convert one target to a JSON object for durable state. */
function targetValue(target: WorkflowTarget): JsonObject {
  return Object.freeze({ ...target })
}

/** Parse one ordered graph transition. */
function parseTransition(value: JsonValue, index: number, resolver?: WorkflowExtensionResolver): WorkflowTransition {
  if (!isObject(value)) throw new Error(`workflow transition ${index} must be an object`)
  exactKeys(value, ['condition', 'target'], `workflow transition ${index}`)
  return Object.freeze({
    condition: parseCondition(requireJsonValue(value.condition, `workflow transition ${index} condition`), resolver),
    target: parseTarget(value.target, resolver),
  })
}

/** Parse one declarative condition. */
function parseCondition(value: JsonValue, resolver?: WorkflowExtensionResolver): WorkflowCondition {
  if (!isObject(value) || typeof value.kind !== 'string') throw new Error('workflow condition must be an object with a kind')
  switch (value.kind) {
    case 'always':
      exactKeys(value, ['kind'], 'workflow always condition')
      return { kind: 'always' }
    case 'envelope-kind':
      exactKeys(value, ['kind', 'value'], 'workflow envelope-kind condition')
      return { kind: 'envelope-kind', value: requireText(value.value, 'workflow condition value') }
    case 'payload-present':
      exactKeys(value, ['kind', 'path'], 'workflow payload-present condition')
      return { kind: 'payload-present', path: requirePath(value.path) }
    case 'payload-equals':
      exactKeys(value, ['kind', 'path', 'value'], 'workflow payload-equals condition')
      return { kind: 'payload-equals', path: requirePath(value.path), value: value.value as JsonValue }
    case 'extension': {
      exactKeys(value, ['kind', 'name', 'version', 'config'], 'workflow extension condition')
      const name = requireText(value.name, 'workflow condition extension name')
      const version = positiveSafeInteger(value.version, 'workflow condition extension version')
      const config = requireJsonValue(value.config, 'workflow condition extension config')
      const extension = resolver?.get('condition', name, version)
      if (extension === undefined) throw new Error(`workflow condition extension '${name}@${String(version)}' is not registered`)
      extension.validate(config)
      return { kind: 'extension', name, version, config }
    }
    default:
      throw new Error(`workflow condition kind '${value.kind}' is unsupported`)
  }
}

/** Parse one abstract workflow target. */
function parseTarget(value: JsonValue | undefined, resolver?: WorkflowExtensionResolver): WorkflowTarget {
  if (!isObject(value) || typeof value.kind !== 'string') throw new Error('workflow target must be an object with a kind')
  switch (value.kind) {
    case 'participant':
      exactKeys(value, ['kind', 'participantId'], 'workflow participant target')
      return { kind: 'participant', participantId: requireIdentifier(value.participantId, 'workflow target participantId') as ParticipantId }
    case 'round-robin':
    case 'stay':
    case 'return-to-initiator':
    case 'terminate':
      exactKeys(value, ['kind'], `workflow ${value.kind} target`)
      return { kind: value.kind }
    case 'extension': {
      exactKeys(value, ['kind', 'name', 'version', 'config'], 'workflow extension target')
      const name = requireText(value.name, 'workflow target extension name')
      const version = positiveSafeInteger(value.version, 'workflow target extension version')
      const config = requireJsonValue(value.config, 'workflow target extension config')
      const extension = resolver?.get('target', name, version)
      if (extension === undefined) throw new Error(`workflow target extension '${name}@${String(version)}' is not registered`)
      extension.validate(config)
      return { kind: 'extension', name, version, config }
    }
    default:
      throw new Error(`workflow target kind '${value.kind}' is unsupported`)
  }
}

/** Require a strict object-key set. */
function exactKeys(value: JsonObject, keys: readonly string[], subject: string): void {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`${subject} has unsupported fields`)
}

/** Read a dotted property path from a JSON object. */
function readPath(value: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue = value
  for (const segment of path.split('.')) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment] as JsonValue
  }
  return current
}

/** Require one non-empty text field. */
function requireText(value: JsonValue | undefined, subject: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${subject} must be a nonempty string`)
  return value
}

/** Require one valid dotted JSON path. */
function requirePath(value: JsonValue | undefined): string {
  const path = requireText(value, 'workflow condition path')
  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(path)) throw new Error('workflow condition path is invalid')
  return path
}

/** Require one positive safe integer. */
function positiveSafeInteger(value: JsonValue | undefined, subject: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${subject} must be a positive safe integer`)
  return value
}

/** Require one opaque identifier. */
function requireIdentifier(value: JsonValue | undefined, subject: string): string {
  return requireText(value, subject)
}

/** Require one present JSON value before passing it to a strict parser. */
function requireJsonValue(value: JsonValue | undefined, subject: string): JsonValue {
  if (value === undefined) throw new Error(`${subject} is required`)
  return value
}

/** Exhaustive target fallback for closed local unions. */
/* v8 ignore next 3 -- WorkflowTarget is a closed union parsed before resolution. */
function assertNever(value: never): never {
  throw new Error(`unreachable workflow target ${String(value)}`)
}

/** Recognize a JSON object. */
function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Recognize a resolver that can retain exact implementations for a graph. */
function isWorkflowExtensionLeaseAcquirer(resolver: WorkflowExtensionResolver | undefined): resolver is WorkflowExtensionLeaseAcquirer {
  return typeof (resolver as Partial<WorkflowExtensionLeaseAcquirer> | undefined)?.acquireForGraph === 'function'
}
