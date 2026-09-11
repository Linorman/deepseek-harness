import { recordEnvelope } from '../../../core/team/tests/channel-envelope-record.ts'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { channelManifestSchema, participantIdSchema, teamEnvelopeDraftSchema, teamEnvelopeSchema, teamIdSchema } from '@clocky/clocky-team'
import type { ChannelManifest, ChannelRecord, JsonValue, TeamChannelAdapter, TeamEnvelope, TeamEnvelopeDraft } from '@clocky/clocky-team'
import * as WorkflowChannel from '../src/index.ts'
import {
  WORKFLOW_CHANNEL_ADAPTER,
  WORKFLOW_CHANNEL_TYPE,
  WORKFLOW_CHANNEL_VERSION,
  createWorkflowChannelAdapter,
  parseTransitionGraph,
  parseWorkflowChannelManifest,
  parseWorkflowTextPayload,
  workflowChannelAdapter,
} from '../src/workflow.ts'
import type { WorkflowExtensionResolver } from '../src/workflow.ts'

const teamId = teamIdSchema.parse('team-workflow')
const first = participantIdSchema.parse('workflow-first')
const second = participantIdSchema.parse('workflow-second')
const third = participantIdSchema.parse('workflow-third')
const outsider = participantIdSchema.parse('workflow-outsider')
const participants = [
  { id: first, role: 'initiator' },
  { id: second, role: 'worker' },
  { id: third, role: 'reviewer' },
]

/** Narrow a JSON extension config object in the test resolver. */
function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Build a schema-valid workflow manifest. */
function manifest(graph: unknown = baseGraph()): ChannelManifest {
  return channelManifestSchema.parse({
    id: 'channel-workflow',
    teamId,
    adapter: WORKFLOW_CHANNEL_ADAPTER,
    participants,
    limits: { graph },
  })
}

/** Build a minimal graph that starts with the first participant. */
function baseGraph(): JsonValue {
  return {
    initial: { kind: 'participant', participantId: first },
    transitions: [{ condition: { kind: 'always' }, target: { kind: 'round-robin' } }],
    maxTurns: 4,
  }
}

/** Build a stamped workflow Envelope. */
function envelope(overrides: Record<string, unknown> = {}): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'workflow-envelope',
    teamId,
    channelId: 'channel-workflow',
    sequence: 2,
    senderId: first,
    audience: [second],
    kind: 'message',
    payload: { text: 'Continue.' },
    delivery: 'turn',
    priority: 'normal',
    createdAt: 1,
    ...overrides,
  })
}

/** Build a schema-valid workflow draft. */
function draft(overrides: Record<string, unknown> = {}): TeamEnvelopeDraft {
  return teamEnvelopeDraftSchema.parse({
    channelId: 'channel-workflow',
    audience: [second],
    kind: 'message',
    payload: { text: 'Continue.' },
    delivery: 'turn',
    ...overrides,
  })
}

describe('workflow graph parser and adapter', () => {
  it('validates and evaluates versioned condition and target extensions', () => {
    const resolver: WorkflowExtensionResolver = {
      get(kind, name, version) {
        if (version !== 1) return undefined
        if (kind === 'condition' && name === 'payload-status') {
          return {
            validate(value) {
              if (!isRecord(value) || typeof value.expected !== 'string') throw new Error('expected status config')
            },
            evaluate({ config, envelope }) {
              return isRecord(config) && envelope.payload.status === config.expected
            },
          }
        }
        if (kind === 'target' && name === 'configured-participant') {
          return {
            validate(value) {
              if (!isRecord(value) || typeof value.participantId !== 'string') throw new Error('expected participant config')
            },
            resolve({ config }) {
              if (!isRecord(config)) throw new Error('expected participant config')
              return { kind: 'participant', participantId: config.participantId as typeof first }
            },
          }
        }
        return undefined
      },
    }
    const adapter = createWorkflowChannelAdapter(resolver)
    const graph = {
      initial: { kind: 'extension', name: 'configured-participant', version: 1, config: { participantId: first } },
      transitions: [{
        condition: { kind: 'extension', name: 'payload-status', version: 1, config: { expected: 'go' } },
        target: { kind: 'extension', name: 'configured-participant', version: 1, config: { participantId: third } },
      }],
      defaultTarget: { kind: 'terminate' },
      maxTurns: 2,
    } as const
    const channel = manifest(graph)
    adapter.validateCreate(channel)
    let state = adapter.initialState(channel)
    const message = envelope({ senderId: first, payload: { status: 'go' } })
    adapter.validateSend({ manifest: channel, state, senderId: first, draft: draft({ payload: { status: 'go' } }) })
    state = adapter.fold(state, recordEnvelope(message))
    expect(adapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'participant', participantId: third })
    expect(() => { createWorkflowChannelAdapter({ get: () => undefined }).validateCreate(channel) }).toThrow(/not registered/)
  })

  it('rejects unavailable extension execution, resolution, and graph admission', () => {
    const conditionGraph = manifest({
      initial: { kind: 'participant', participantId: first },
      transitions: [{
        condition: { kind: 'extension', name: 'missing-evaluate', version: 1, config: {} },
        target: { kind: 'terminate' },
      }],
      maxTurns: 2,
    })
    const missingCondition = createWorkflowChannelAdapter({
      get(kind, name) {
        return kind === 'condition' && name === 'missing-evaluate' ? { validate() {} } : undefined
      },
    })
    const conditionState = missingCondition.initialState(conditionGraph)
    expect(() => missingCondition.fold(conditionState, recordEnvelope(envelope({ id: 'missing-evaluate', senderId: first })))).toThrow(/unavailable/)
    expect(() => { createWorkflowChannelAdapter({ get: () => undefined }).validateCreate(conditionGraph) }).toThrow(/not registered/)

    const targetGraph = manifest({
      initial: { kind: 'extension', name: 'configured-target', version: 1, config: {} },
      transitions: [],
      maxTurns: 1,
    })
    const missingTarget = createWorkflowChannelAdapter({
      get(kind, name) {
        return kind === 'target' && name === 'configured-target' ? { validate() {} } : undefined
      },
    })
    expect(() => missingTarget.expectedNext({
      manifest: targetGraph,
      state: missingTarget.initialState(targetGraph),
    })).toThrow(/unavailable/)
    const unknownTarget = createWorkflowChannelAdapter({
      get(kind, name) {
        return kind === 'target' && name === 'configured-target'
          ? { validate() {}, resolve() { return { kind: 'participant' as const, participantId: outsider } } }
          : undefined
      },
    })
    expect(() => unknownTarget.expectedNext({
      manifest: targetGraph,
      state: unknownTarget.initialState(targetGraph),
    })).toThrow(/unknown participant/)
  })

  it('parses every target and condition and applies the first matching transition', () => {
    const graph = parseTransitionGraph({
      initial: { kind: 'round-robin' },
      transitions: [
        { condition: { kind: 'payload-present', path: 'meta.flag' }, target: { kind: 'stay' } },
        { condition: { kind: 'payload-equals', path: 'meta.status', value: 'ok' }, target: { kind: 'return-to-initiator' } },
        { condition: { kind: 'envelope-kind', value: 'handoff' }, target: { kind: 'participant', participantId: second } },
        { condition: { kind: 'always' }, target: { kind: 'terminate' } },
      ],
      defaultTarget: { kind: 'participant', participantId: third },
      maxTurns: 4,
    })
    const channel = manifest(graph)
    const parsed = parseWorkflowChannelManifest(channel)
    workflowChannelAdapter.validateCreate(channel)
    let state = workflowChannelAdapter.initialState(channel)
    expect(workflowChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'participant', participantId: first })

    const firstMessage = envelope({ id: 'workflow-flag', senderId: first, payload: { meta: { flag: true } } })
    workflowChannelAdapter.validateSend({ manifest: channel, state, senderId: first, draft: draft({ payload: { meta: { flag: true } } }) })
    state = workflowChannelAdapter.fold(state, recordEnvelope(firstMessage))
    expect(workflowChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'participant', participantId: first })
    expect(workflowChannelAdapter.deliveryPlan({ manifest: channel, state, envelope: firstMessage })).toEqual([{
      participantId: second, envelopeId: firstMessage.id, delivery: 'turn',
    }])
    expect(workflowChannelAdapter.afterAccept({ manifest: channel, state, record: recordEnvelope(firstMessage) })).toEqual([])

    const secondMessage = envelope({ id: 'workflow-status', senderId: first, audience: null, payload: { meta: { status: 'ok' } } })
    state = workflowChannelAdapter.fold(state, recordEnvelope(secondMessage, channel.participants.map(member => member.id)))
    expect(workflowChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'participant', participantId: first })
    expect(workflowChannelAdapter.deliveryPlan({ manifest: channel, state, envelope: secondMessage })).toEqual([
      { participantId: second, envelopeId: secondMessage.id, delivery: 'turn' },
      { participantId: third, envelopeId: secondMessage.id, delivery: 'turn' },
    ])

    const handoff = envelope({ id: 'workflow-handoff', senderId: first, kind: 'handoff', audience: [second] })
    state = workflowChannelAdapter.fold(state, recordEnvelope(handoff))
    expect(workflowChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'participant', participantId: second })
    const terminal = envelope({ id: 'workflow-terminal', senderId: second, kind: 'message', audience: [first], payload: { text: 'done' } })
    state = workflowChannelAdapter.fold(state, recordEnvelope(terminal))
    expect(workflowChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'none' })
    expect(workflowChannelAdapter.closeAfterAccept?.({ manifest: channel, state, record: recordEnvelope(terminal) })).toBe('workflow transition reached a terminal target')
    expect(parsed.initiatorId).toBe(first)
    expect(workflowChannelAdapter.projectView({
      manifest: channel,
      state,
      records: [
        recordEnvelope(firstMessage),
        recordEnvelope(secondMessage, channel.participants.map(member => member.id)),
        recordEnvelope(handoff),
        recordEnvelope(terminal),
      ],
    })).toMatchObject({ turnCount: 4, expectedNext: null })
    expect(workflowChannelAdapter.projectView({ manifest: channel, state: workflowChannelAdapter.initialState(channel), records: [{ type: 'channel/phase', sequence: 1, createdAt: 1, phase: 'active' }] })).toMatchObject({ expectedNext: first, messages: [] })
  })

  it('resolves stay, return, round-robin, and default targets', () => {
    for (const [target, expected] of [
      [{ kind: 'stay' }, first],
      [{ kind: 'return-to-initiator' }, first],
      [{ kind: 'round-robin' }, second],
      [{ kind: 'participant', participantId: third }, third],
    ] as const) {
      const channel = manifest({
        initial: target.kind === 'stay' ? target : { kind: 'participant', participantId: first },
        transitions: [{ condition: { kind: 'always' }, target }],
        maxTurns: 2,
      })
      const initial = workflowChannelAdapter.initialState(channel)
      const message = envelope({ senderId: first })
      const next = workflowChannelAdapter.fold(initial, recordEnvelope(message))
      expect(workflowChannelAdapter.expectedNext({ manifest: channel, state: next })).toEqual({ kind: 'participant', participantId: expected })
      if (target.kind === 'stay') {
        const repeated = workflowChannelAdapter.fold(next, recordEnvelope(envelope({ id: 'workflow-stay-2', senderId: expected })))
        expect(workflowChannelAdapter.expectedNext({ manifest: channel, state: repeated })).toEqual({ kind: 'none' })
      }
    }
    const channel = manifest({
      initial: { kind: 'participant', participantId: first },
      transitions: [],
      defaultTarget: { kind: 'participant', participantId: third },
      maxTurns: 2,
    })
    const state = workflowChannelAdapter.fold(workflowChannelAdapter.initialState(channel), recordEnvelope(envelope({ senderId: first })))
    expect(workflowChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'participant', participantId: third })
    expect(workflowChannelAdapter.closeAfterAccept?.({
      manifest: channel, state, record: recordEnvelope(envelope({ senderId: first })),
    })).toBeUndefined()
    const noDefault = manifest({ initial: { kind: 'participant', participantId: first }, transitions: [], maxTurns: 1 })
    const terminal = workflowChannelAdapter.fold(workflowChannelAdapter.initialState(noDefault),
      recordEnvelope(envelope({ senderId: first })))
    expect(workflowChannelAdapter.expectedNext({ manifest: noDefault, state: terminal })).toEqual({ kind: 'none' })
  })

  it('validates graph, state, envelope, audience, and payload boundaries', () => {
    const channel = manifest()
    const initial = workflowChannelAdapter.initialState(channel)
    const phaseRecord: ChannelRecord = { type: 'channel/phase', sequence: 1, createdAt: 1, phase: 'active' }
    const adapterRecord: ChannelRecord = { type: 'channel/adapter', sequence: 1, createdAt: 1, adapter: WORKFLOW_CHANNEL_ADAPTER, payload: {} }
    expect(() => workflowChannelAdapter.fold(null, phaseRecord)).toThrow(/state must be an object/)
    expect(workflowChannelAdapter.fold(initial, phaseRecord)).toEqual(initial)
    expect(() => workflowChannelAdapter.fold(initial, adapterRecord)).toThrow(/adapter-owned/)
    expect(() => {
      workflowChannelAdapter.validateSend({ manifest: channel, state: initial, senderId: second, draft: draft() })
    }).toThrow(/expects/)
    expect(() => {
      workflowChannelAdapter.validateSend({ manifest: channel, state: initial, senderId: outsider, draft: draft() })
    }).toThrow(/expects/)
    expect(() => {
      workflowChannelAdapter.validateSend({
        manifest: channel, state: initial, senderId: first, draft: draft({ audience: [] }),
      })
    }).toThrow(/nonempty/)
    expect(() => {
      workflowChannelAdapter.validateSend({
        manifest: channel, state: initial, senderId: first, draft: draft({ audience: [first] }),
      })
    }).toThrow(/sender/)
    expect(() => {
      workflowChannelAdapter.validateSend({
        manifest: channel, state: initial, senderId: first, draft: draft({ audience: [outsider] }),
      })
    }).toThrow(/participants/)
    expect(() => {
      workflowChannelAdapter.validateSend({
        manifest: channel, state: initial, senderId: first, draft: draft({ delivery: 'steer' }),
      })
    }).toThrow(/steer/)
    const emptyKind = {
      channelId: 'channel-workflow', audience: [second], kind: '', payload: {}, delivery: 'context',
    } as unknown as TeamEnvelopeDraft
    expect(() => {
      workflowChannelAdapter.validateSend({ manifest: channel, state: initial, senderId: first, draft: emptyKind })
    }).toThrow(/nonempty/)
    expect(() => workflowChannelAdapter.deliveryPlan({
      manifest: channel, state: initial, envelope: envelope(),
    })).toThrow(/expected participant/)
    expect(() => workflowChannelAdapter.afterAccept({
      manifest: channel,
      state: initial,
      record: recordEnvelope(envelope()),
    })).toThrow(/expected participant/)
    const terminalGraph = manifest({ initial: { kind: 'participant', participantId: first }, transitions: [], maxTurns: 1 })
    const terminalState = workflowChannelAdapter.fold(workflowChannelAdapter.initialState(terminalGraph),
      recordEnvelope(envelope({ senderId: first })))
    expect(() => {
      workflowChannelAdapter.validateSend({ manifest: terminalGraph, state: terminalState, senderId: first, draft: draft() })
    }).toThrow(/terminal/)
    for (const invalid of [
      { ...envelope(), kind: '' } as unknown as TeamEnvelope,
      envelope({ delivery: 'steer' }), envelope({ senderId: outsider }),
    ]) {
      expect(() => workflowChannelAdapter.fold(initial, recordEnvelope(invalid))).toThrow()
    }
    expect(() => {
      workflowChannelAdapter.validateSend({ manifest: channel, state: initial, senderId: first, draft: draft({ audience: null }) })
    }).not.toThrow()
    const mismatch = { ...initial as object, initiatorId: second } as unknown as JsonValue
    expect(() => workflowChannelAdapter.expectedNext({ manifest: channel, state: mismatch })).toThrow(/does not match/)
    expect(() => parseWorkflowTextPayload({})).toThrow()
    expect(() => parseWorkflowTextPayload({ text: '' })).toThrow()
    expect(() => parseWorkflowTextPayload({ text: 1 })).toThrow()
    expect(parseWorkflowTextPayload({ text: 'ok' })).toEqual({ text: 'ok' })

    const malformedStates: JsonValue[] = [
      [],
      { participantIds: [first], initiatorId: first, graph: baseGraph(), maxTurns: 4, turnCount: 0, expectedTarget: { kind: 'participant', participantId: first } },
      { participantIds: [first, first], initiatorId: first, graph: baseGraph(), maxTurns: 4, turnCount: 0, expectedTarget: { kind: 'participant', participantId: first } },
      { participantIds: [first, second], initiatorId: outsider, graph: baseGraph(), maxTurns: 4, turnCount: 0, expectedTarget: { kind: 'participant', participantId: first } },
      { participantIds: [first, second], initiatorId: first, graph: baseGraph(), maxTurns: 3, turnCount: 0, expectedTarget: { kind: 'participant', participantId: first } },
      { participantIds: [first, second], initiatorId: first, graph: baseGraph(), maxTurns: 4, turnCount: -1, expectedTarget: { kind: 'participant', participantId: first } },
      { participantIds: [first, second], initiatorId: first, graph: baseGraph(), maxTurns: 4, turnCount: 5, expectedTarget: { kind: 'participant', participantId: first } },
      { participantIds: [first, second], initiatorId: first, graph: baseGraph(), maxTurns: 4, turnCount: 0, expectedTarget: { kind: 'participant', participantId: outsider } },
      { participantIds: [first, second], initiatorId: first, graph: baseGraph(), maxTurns: 4, turnCount: 0, expectedTarget: { kind: 'participant', participantId: first }, lastSenderId: outsider },
      { participantIds: [first, second], initiatorId: first, graph: baseGraph(), maxTurns: 4, turnCount: 0, expectedTarget: { kind: 'participant', participantId: first }, extra: true },
    ]
    for (const state of malformedStates) expect(() => workflowChannelAdapter.expectedNext({ manifest: channel, state })).toThrow()
  })

  it('rejects malformed graph definitions before channel creation', () => {
    const badGraphs: JsonValue[] = [
      null,
      { initial: null, transitions: [], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [], maxTurns: 1, extra: true },
      { initial: { kind: 'terminate' }, transitions: [], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: 'bad', maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [null], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [{}], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [{ condition: { kind: 'always' } }], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [{ target: { kind: 'terminate' } }], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [{ condition: null, target: { kind: 'terminate' } }], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [{ condition: undefined, target: { kind: 'terminate' } }], maxTurns: 1 } as unknown as JsonValue,
      { initial: { kind: 'participant', participantId: first }, transitions: [{ condition: { kind: 'unknown' }, target: { kind: 'terminate' } }], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [{ condition: { kind: 'always' }, target: { kind: 'unknown' } }], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [], defaultTarget: { kind: 'unknown' }, maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [], maxTurns: 0 },
      { initial: { kind: 'participant', participantId: first }, transitions: [], maxTurns: 1.5 },
      { initial: { kind: 'participant', participantId: first }, transitions: [{ condition: { kind: 'payload-present', path: '' }, target: { kind: 'terminate' } }], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [{ condition: { kind: 'payload-present', path: 'a-b' }, target: { kind: 'terminate' } }], maxTurns: 1 },
      { initial: { kind: 'participant', participantId: first }, transitions: [{ condition: { kind: 'payload-equals', path: 'a' }, target: { kind: 'terminate' } }], maxTurns: 1 },
    ]
    for (const graph of badGraphs) expect(() => parseTransitionGraph(graph)).toThrow()
    expect(() => parseWorkflowChannelManifest({
      ...manifest(), adapter: { type: WORKFLOW_CHANNEL_TYPE, version: WORKFLOW_CHANNEL_VERSION + 1 },
    })).toThrow(/workflow version/)
    expect(() => parseWorkflowChannelManifest({ ...manifest(), participants: [participants[0]!] })).toThrow(/at least two/)
    expect(() => parseWorkflowChannelManifest({ ...manifest(), participants: [{ id: first, role: 'a' }, { id: first, role: 'b' }] })).toThrow(/distinct/)
    expect(() => parseWorkflowChannelManifest({ ...manifest({ initial: { kind: 'participant', participantId: outsider }, transitions: [], maxTurns: 1 }) })).toThrow(/not a channel participant/)
    expect(() => parseWorkflowChannelManifest({ ...manifest(), limits: {} })).toThrow(/limits/)
    expect(() => parseWorkflowChannelManifest({ ...manifest(), limits: { graph: baseGraph(), extra: true } })).toThrow(/limits/)
  })

  it('registers the adapter through its Cordis plugin', () => {
    const registerAdapter = vi.fn()
    WorkflowChannel.apply({ teams: { registerAdapter } } as never)
    expect(registerAdapter).toHaveBeenCalledWith(workflowChannelAdapter)
  })

  it('owns versioned extensions through effect-scoped Cordis registration', async () => {
    const ctx = new Context()
    const registerAdapter = vi.fn()
    Object.defineProperty(ctx, 'teams', { value: { registerAdapter } })
    const added = vi.fn()
    const removed = vi.fn()
    ctx.on('workflow/extension-added', added)
    ctx.on('workflow/extension-removed', removed)

    WorkflowChannel.apply(ctx)
    const registry = ctx.workflowExtensions
    const condition: WorkflowChannel.WorkflowExtension = {
      kind: 'condition',
      name: 'payload-status',
      version: 1,
      validate() {},
      evaluate() { return true },
    }
    const target: WorkflowChannel.WorkflowExtension = {
      kind: 'target',
      name: 'configured-target',
      version: 2,
      validate() {},
      resolve() { return { kind: 'terminate' } },
    }
    const disposeCondition = registry.register(condition)
    const disposeTarget = registry.register(target)
    expect(registerAdapter).toHaveBeenCalledOnce()
    expect(registerAdapter.mock.calls[0]?.[0]).not.toBe(workflowChannelAdapter)
    expect(registry.list()).toEqual([
      { kind: 'condition', name: 'payload-status', version: 1 },
      { kind: 'target', name: 'configured-target', version: 2 },
    ])
    expect(registry.get('condition', condition.name, condition.version)).toBe(condition)
    expect(registry.get('condition', 'missing', 1)).toBeUndefined()
    expect(added).toHaveBeenNthCalledWith(1, { kind: 'condition', name: condition.name, version: condition.version })
    expect(added).toHaveBeenNthCalledWith(2, { kind: 'target', name: target.name, version: target.version })
    expect(() => registry.register(condition)).toThrow(/already registered/)

    for (const invalid of [
      { ...condition, name: '' },
      { ...condition, name: ' payload-status' },
      { ...condition, version: 0 },
      { ...condition, version: 1.5 },
      { ...condition, evaluate: undefined },
      { ...target, resolve: undefined },
    ]) {
      expect(() => registry.register(invalid as never)).toThrow(/name\/version is invalid/)
    }

    disposeCondition()
    expect(registry.get('condition', condition.name, condition.version)).toBeUndefined()
    expect(removed).toHaveBeenCalledWith({ kind: 'condition', name: condition.name, version: condition.version })
    disposeCondition()
    expect(removed).toHaveBeenCalledTimes(1)
    disposeTarget()
    expect(registry.list()).toEqual([])
    expect(removed).toHaveBeenNthCalledWith(2, { kind: 'target', name: target.name, version: target.version })
    await ctx.fiber.dispose()
  })

  it('retains exact extension implementations for an active adapter across provider HMR retirement', async () => {
    const ctx = new Context()
    const registerAdapter = vi.fn()
    Object.defineProperty(ctx, 'teams', { value: { registerAdapter } })
    WorkflowChannel.apply(ctx)
    const registry = ctx.workflowExtensions
    const graph = {
      initial: { kind: 'extension', name: 'next-speaker', version: 1, config: {} },
      transitions: [{
        condition: { kind: 'extension', name: 'take-transition', version: 1, config: {} },
        target: { kind: 'extension', name: 'next-speaker', version: 1, config: {} },
      }],
      defaultTarget: { kind: 'participant', participantId: third },
      maxTurns: 3,
    } as const
    const channel = manifest(graph)
    const originalCondition: WorkflowChannel.WorkflowExtension = {
      kind: 'condition',
      name: 'take-transition',
      version: 1,
      validate() {},
      evaluate() { return true },
    }
    const originalTarget: WorkflowChannel.WorkflowExtension = {
      kind: 'target',
      name: 'next-speaker',
      version: 1,
      validate() {},
      resolve() { return { kind: 'participant', participantId: first } },
    }
    const originalProvider = await ctx.plugin(Object.assign((pluginCtx: Context) => {
      pluginCtx.workflowExtensions.register(originalCondition)
      pluginCtx.workflowExtensions.register(originalTarget)
    }, { inject: ['workflowExtensions'] }))

    try {
      const registered = registerAdapter.mock.calls[0]?.[0] as TeamChannelAdapter
      expect(WorkflowChannel.isWorkflowExtensionLeaseableAdapter(registered)).toBe(true)
      if (!WorkflowChannel.isWorkflowExtensionLeaseableAdapter(registered)) throw new Error('workflow adapter cannot retain extensions')
      registered.validateCreate(channel)
      const active = registered.acquireExtensionLeases(channel)
      const activeAdapter = active.adapter
      const withoutExtensions = registered.acquireExtensionLeases(manifest(baseGraph()))
      withoutExtensions.release()
      expect(registry.getLeaseMetrics()).toEqual({
        acceptingExtensions: 2,
        retiredExtensions: 0,
        activeExtensionLeases: 2,
      })

      await originalProvider.dispose()
      expect(registry.list()).toEqual([])
      expect(registry.getLeaseMetrics()).toEqual({
        acceptingExtensions: 0,
        retiredExtensions: 2,
        activeExtensionLeases: 2,
      })
      expect(() => { registered.validateCreate(channel) }).toThrow(/not registered/)
      expect(() => { registered.acquireExtensionLeases(channel) }).toThrow(/not registered/)

      let activeState = activeAdapter.initialState(channel)
      expect(activeAdapter.expectedNext({ manifest: channel, state: activeState })).toEqual({ kind: 'participant', participantId: first })
      activeState = activeAdapter.fold(activeState, recordEnvelope(envelope({ id: 'retained-old', senderId: first })))
      expect(activeAdapter.expectedNext({ manifest: channel, state: activeState })).toEqual({ kind: 'participant', participantId: first })

      const replacementProvider = await ctx.plugin(Object.assign((pluginCtx: Context) => {
        pluginCtx.workflowExtensions.register({
          kind: 'condition',
          name: 'take-transition',
          version: 1,
          validate() {},
          evaluate() { return false },
        })
        pluginCtx.workflowExtensions.register({
          kind: 'target',
          name: 'next-speaker',
          version: 1,
          validate() {},
          resolve() { return { kind: 'participant', participantId: second } },
        })
      }, { inject: ['workflowExtensions'] }))
      try {
        const replacement = registered.acquireExtensionLeases(channel)
        try {
          let replacementState = replacement.adapter.initialState(channel)
          expect(replacement.adapter.expectedNext({ manifest: channel, state: replacementState })).toEqual({ kind: 'participant', participantId: second })
          replacementState = replacement.adapter.fold(replacementState, recordEnvelope(envelope({ id: 'retained-new', senderId: second, audience: [first] })))
          expect(replacement.adapter.expectedNext({ manifest: channel, state: replacementState })).toEqual({ kind: 'participant', participantId: third })
          expect(activeAdapter.expectedNext({ manifest: channel, state: activeState })).toEqual({ kind: 'participant', participantId: first })
        } finally {
          replacement.release()
        }
      } finally {
        await replacementProvider.dispose()
      }

      active.release()
      active.release()
      expect(registry.getLeaseMetrics()).toEqual({
        acceptingExtensions: 0,
        retiredExtensions: 0,
        activeExtensionLeases: 0,
      })
      expect(() => activeAdapter.initialState(channel)).toThrow(/not registered/)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
