import { consentChannelEndpoints } from '../../../core/team/tests/channel-endpoint-consent.ts'
import { recordEnvelope } from '../../../core/team/tests/channel-envelope-record.ts'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import { SessionId } from '@clocky/clocky-session'
import {
  activationIdSchema,
  channelManifestSchema,
  teamEnvelopeDraftSchema,
  teamEnvelopeSchema,
  teamIdSchema,
  teamTaskIdSchema,
  participantIdSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ChannelManifest,
  ChannelRecord,
  JsonValue,
  ParticipantSnapshot,
  TeamActorProof,
  TeamEnvelope,
  TeamEnvelopeDraft,
  TeamSystemActivationProof,
  TeamSystemActivationScope,
} from '@clocky/clocky-team'
import * as BasicChannel from '../src/index.ts'
import {
  CONSULT_CHANNEL_ADAPTER,
  CONSULT_INITIATOR_ROLE,
  CONSULT_REVIEW_REQUEST_KIND,
  CONSULT_REQUEST_KIND,
  CONSULT_RESPONDENT_ROLE,
  CONSULT_RESPONSE_KIND,
  DISCUSSION_CHANNEL_ADAPTER,
  consultChannelAdapter,
  discussionChannelAdapter,
  resolveConsultTextDraft,
  parseConsultChannelManifest,
  parseConsultReviewAssignmentPayload,
  parseConsultReviewResponsePayload,
  parseDiscussionChannelManifest,
} from '../src/basic.ts'
import {
  WORKFLOW_CHANNEL_ADAPTER,
  parseTransitionGraph,
  parseWorkflowChannelManifest,
  workflowChannelAdapter,
} from '../../team-channel-workflow/src/workflow.ts'
import * as WorkflowChannel from '../../team-channel-workflow/src/index.ts'

const roots: string[] = []
const teamId = teamIdSchema.parse('team-basic')
const first = participantIdSchema.parse('participant-first')
const second = participantIdSchema.parse('participant-second')
const third = participantIdSchema.parse('participant-third')
const outsiderId = participantIdSchema.parse('participant-outsider')
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
type ControllerActivationBindScope = Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-bind' }>
const activationProofStores = new WeakMap<Context, WeakMap<TeamSystemActivationProof, ControllerActivationBindScope>>()

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Build a schema-valid channel manifest for a selected adapter. */
function manifest(
  adapter: ChannelManifest['adapter'],
  participants: ChannelManifest['participants'],
  limits: Record<string, JsonValue> = {},
): ChannelManifest {
  return channelManifestSchema.parse({
    id: 'channel-basic',
    teamId,
    adapter,
    participants,
    limits,
  })
}

/** Build a schema-valid text Envelope draft. */
function draft(overrides: Record<string, unknown> = {}): TeamEnvelopeDraft {
  return teamEnvelopeDraftSchema.parse({
    channelId: 'channel-basic',
    audience: [second],
    kind: 'message',
    payload: { text: 'Continue.' },
    delivery: 'turn',
    ...overrides,
  })
}

/** Build one stamped Envelope for pure adapter folds. */
function envelope(overrides: Record<string, unknown> = {}): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'envelope-basic',
    teamId,
    channelId: 'channel-basic',
    sequence: 2,
    senderId: first,
    audience: [second],
    kind: 'message',
    payload: { text: 'Continue.' },
    delivery: 'turn',
    priority: 'normal',
    createdAt: 10,
    ...overrides,
  })
}

const consultParticipants = [
  { id: first, role: CONSULT_INITIATOR_ROLE },
  { id: second, role: CONSULT_RESPONDENT_ROLE },
]

const discussionParticipants = [
  { id: first, role: 'speaker' },
  { id: second, role: 'speaker' },
  { id: third, role: 'speaker' },
]

describe('basic Team-channel adapters', () => {
  it('derives ordinary consult turns from roles and a logged request while keeping reviews separate', () => {
    const channel = manifest(CONSULT_CHANNEL_ADAPTER, consultParticipants)
    const request = resolveConsultTextDraft({ manifest: channel, senderId: first, text: 'Question', delivery: 'turn' })
    expect(request).toMatchObject({ kind: 'request', audience: [second], payload: { text: 'Question' } })
    const anchor = { teamId, channelId: channel.id, envelopeId: envelope().id, taskId: teamTaskIdSchema.parse('linked-task'), review: false }
    const response = resolveConsultTextDraft({ manifest: channel, senderId: second, text: 'Answer', delivery: 'turn', request: anchor })
    expect(response).toMatchObject({ kind: 'response', audience: [first], causationId: anchor.envelopeId, taskId: anchor.taskId })
    expect(() => resolveConsultTextDraft({ manifest: channel, senderId: second, text: 'No source', delivery: 'turn' })).toThrow('logged request')
    expect(() => resolveConsultTextDraft({ manifest: channel, senderId: second, text: 'Not a decision', delivery: 'turn', request: { ...anchor, review: true } })).toThrow('review operation')
    expect(() => resolveConsultTextDraft({ manifest: channel, senderId: second, text: 'Wrong delivery', delivery: 'context', request: anchor })).toThrow('turn delivery')
    expect(consultChannelAdapter.allowsClosedDelivery?.({ manifest: channel, state: consultChannelAdapter.initialState(channel) })).toBe(false)
  })

  it('retains structured review revision and result evidence in consult payloads', () => {
    const assignment = parseConsultReviewAssignmentPayload({
      text: 'Inspect the worker result.',
      taskId: 'task-review',
      attemptId: 'attempt-review',
      reviewRevision: 4,
      reviewerId: second,
      initiatorId: first,
      result: { summary: 'Changed files pass the focused tests.' },
    })
    expect(assignment).toMatchObject({
      taskId: 'task-review', attemptId: 'attempt-review', reviewRevision: 4,
      reviewerId: second, initiatorId: first,
      result: { summary: 'Changed files pass the focused tests.' },
    })
    expect(parseConsultReviewResponsePayload({ text: 'Needs one more test.', decision: 'rework' })).toEqual({
      text: 'Needs one more test.', decision: 'rework',
    })
    const channel = manifest(CONSULT_CHANNEL_ADAPTER, consultParticipants)
    const initial = consultChannelAdapter.initialState(channel)
    const request = envelope({
      id: 'review-request', senderId: first, audience: [second], kind: CONSULT_REVIEW_REQUEST_KIND,
      payload: {
        text: assignment.text,
        taskId: assignment.taskId,
        attemptId: assignment.attemptId,
        reviewRevision: assignment.reviewRevision,
        reviewerId: assignment.reviewerId,
        initiatorId: assignment.initiatorId,
        result: assignment.result,
      },
    })
    consultChannelAdapter.validateSend({ manifest: channel, state: initial, senderId: first, draft: request })
    expect(consultChannelAdapter.expectedNext({
      manifest: channel,
      state: consultChannelAdapter.fold(initial, recordEnvelope(request)),
    })).toEqual({ kind: 'participant', participantId: second })
  })

  it('runs a consult through one request, one response, and a terminal close request', () => {
    const channel = manifest(CONSULT_CHANNEL_ADAPTER, consultParticipants)
    const parsed = parseConsultChannelManifest(channel)
    expect(parsed.initiatorId).toBe(first)
    expect(parsed.respondentId).toBe(second)

    const initial = consultChannelAdapter.initialState(channel)
    expect(consultChannelAdapter.expectedNext({ manifest: channel, state: initial })).toEqual({
      kind: 'participant', participantId: first,
    })
    const request = envelope({
      id: 'consult-request', senderId: first, audience: [second], kind: CONSULT_REQUEST_KIND,
    })
    consultChannelAdapter.validateSend({ manifest: channel, state: initial, senderId: first, draft: draft({
      kind: CONSULT_REQUEST_KIND,
    }) })
    const waitingResponse = consultChannelAdapter.fold(initial, recordEnvelope(request))
    expect(consultChannelAdapter.expectedNext({ manifest: channel, state: waitingResponse })).toEqual({
      kind: 'participant', participantId: second,
    })

    const response = envelope({
      id: 'consult-response', senderId: second, audience: [first], kind: CONSULT_RESPONSE_KIND,
    })
    consultChannelAdapter.validateSend({ manifest: channel, state: waitingResponse, senderId: second, draft: draft({
      audience: [first], kind: CONSULT_RESPONSE_KIND,
    }) })
    const complete = consultChannelAdapter.fold(waitingResponse, recordEnvelope(response))
    expect(consultChannelAdapter.expectedNext({ manifest: channel, state: complete })).toEqual({ kind: 'none' })
    expect(consultChannelAdapter.closeAfterAccept?.({
      manifest: channel,
      state: complete,
      record: recordEnvelope(response),
    })).toBe('consult response accepted')
    expect(consultChannelAdapter.deliveryPlan({ manifest: channel, state: complete, envelope: response })).toEqual([{
      participantId: first, envelopeId: 'consult-response', delivery: 'turn',
    }])
  })

  it('rejects consult phase, role, and payload violations', () => {
    const channel = manifest(CONSULT_CHANNEL_ADAPTER, consultParticipants)
    const initial = consultChannelAdapter.initialState(channel)
    expect(() =>{  consultChannelAdapter.validateSend({
      manifest: channel, state: initial, senderId: second, draft: draft({ audience: [first], kind: CONSULT_REQUEST_KIND }),
    }) }).toThrow(/initiator/)
    expect(() => parseConsultChannelManifest(manifest(CONSULT_CHANNEL_ADAPTER, [
      { id: first, role: CONSULT_INITIATOR_ROLE },
      { id: second, role: CONSULT_INITIATOR_ROLE },
    ]))).toThrow(/initiator/)
    expect(() =>{  consultChannelAdapter.validateSend({
      manifest: channel, state: initial, senderId: first, draft: draft({ kind: CONSULT_REQUEST_KIND, payload: { text: 'x', extra: true } }),
    }) }).toThrow(/unsupported fields/)
    expect(() =>{  consultChannelAdapter.validateSend({
      manifest: channel, state: initial, senderId: first, draft: draft({ audience: [first], kind: CONSULT_REQUEST_KIND }),
    }) }).toThrow(/respondent/)
  })

  it('enforces discussion bounds and deterministic round-robin speakers', () => {
    const channel = manifest(
      DISCUSSION_CHANNEL_ADAPTER,
      discussionParticipants,
      { maxTurns: 3, speakerPolicy: 'round-robin' },
    )
    const parsed = parseDiscussionChannelManifest(channel)
    discussionChannelAdapter.validateCreate(channel)
    expect(parsed.participantIds).toEqual([first, second, third])
    let state = discussionChannelAdapter.initialState(channel)
    expect(discussionChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'participant', participantId: first })
    for (const [index, senderId] of [first, second, third].entries()) {
      const message = envelope({
        id: `discussion-${index}`,
        senderId,
        audience: null,
      })
      discussionChannelAdapter.validateSend({ manifest: channel, state, senderId, draft: draft({ audience: null }) })
      state = discussionChannelAdapter.fold(state, recordEnvelope(message, channel.participants.map(member => member.id)))
      if (index < 2) {
        expect(discussionChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({
          kind: 'participant', participantId: [second, third][index],
        })
      }
    }
    expect(discussionChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'none' })
    expect(discussionChannelAdapter.closeAfterAccept?.({
      manifest: channel,
      state,
      record: recordEnvelope(envelope({ id: 'discussion-2', senderId: third, audience: null }), channel.participants.map(member => member.id)),
    })).toBe('discussion turn limit reached')
    expect(() =>{  discussionChannelAdapter.validateSend({
      manifest: channel, state, senderId: first, draft: draft({ audience: null }),
    }) }).toThrow(/turn limit/)
  })

  it('supports free-form discussion delivery and rejects invalid audiences', () => {
    const channel = manifest(
      DISCUSSION_CHANNEL_ADAPTER,
      discussionParticipants,
      { maxTurns: 2, speakerPolicy: 'free-form' },
    )
    const state = discussionChannelAdapter.initialState(channel)
    expect(discussionChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'none' })
    expect(() =>{  discussionChannelAdapter.validateSend({
      manifest: channel, state, senderId: first, draft: draft({ audience: [first] }),
    }) }).toThrow(/sender/)
    const message = envelope({ audience: [second, third] })
    expect(discussionChannelAdapter.deliveryPlan({
      manifest: channel,
      state: discussionChannelAdapter.fold(state, recordEnvelope(message, channel.participants.map(member => member.id))),
      envelope: message,
    })).toEqual([
      { participantId: second, envelopeId: 'envelope-basic', delivery: 'turn' },
      { participantId: third, envelopeId: 'envelope-basic', delivery: 'turn' },
    ])
    expect(discussionChannelAdapter.deliveryPlan({
      manifest: channel,
      state: discussionChannelAdapter.fold(state,
        recordEnvelope(envelope({ senderId: first, audience: null }), channel.participants.map(member => member.id))),
      envelope: envelope({ senderId: first, audience: null }),
    })).toHaveLength(2)
  })

  it('parses workflow graphs and applies ordered transitions with terminal bounds', () => {
    const graph = parseTransitionGraph({
      initial: { kind: 'participant', participantId: first },
      transitions: [
        { condition: { kind: 'envelope-kind', value: 'handoff' }, target: { kind: 'participant', participantId: second } },
        { condition: { kind: 'envelope-kind', value: 'done' }, target: { kind: 'terminate' } },
      ],
      defaultTarget: { kind: 'round-robin' },
      maxTurns: 3,
    })
    const channel = manifest(WORKFLOW_CHANNEL_ADAPTER, discussionParticipants, { graph: graph as unknown as JsonValue })
    const parsed = parseWorkflowChannelManifest(channel)
    expect(parsed.graph.maxTurns).toBe(3)
    let state = workflowChannelAdapter.initialState(channel)
    expect(workflowChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'participant', participantId: first })
    const handoff = envelope({ id: 'workflow-handoff', senderId: first, kind: 'handoff', audience: [second] })
    workflowChannelAdapter.validateSend({ manifest: channel, state, senderId: first, draft: draft({ audience: [second], kind: 'handoff' }) })
    state = workflowChannelAdapter.fold(state, recordEnvelope(handoff))
    expect(workflowChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'participant', participantId: second })
    const done = envelope({ id: 'workflow-done', senderId: second, kind: 'done', audience: [first] })
    state = workflowChannelAdapter.fold(state, recordEnvelope(done))
    expect(workflowChannelAdapter.expectedNext({ manifest: channel, state })).toEqual({ kind: 'none' })
    expect(workflowChannelAdapter.closeAfterAccept?.({
      manifest: channel, state, record: recordEnvelope(done),
    })).toBe('workflow transition reached a terminal target')
    expect(() => parseTransitionGraph({
      initial: { kind: 'terminate' }, transitions: [], maxTurns: 1,
    })).toThrow(/initial target/)
  })

  it('covers consult and discussion parser and lifecycle rejection paths', () => {
    const consult = manifest(CONSULT_CHANNEL_ADAPTER, consultParticipants)
    const initial = consultChannelAdapter.initialState(consult)
    const request = envelope({ id: 'coverage-request', senderId: first, audience: [second], kind: CONSULT_REQUEST_KIND })
    const waiting = consultChannelAdapter.fold(initial, recordEnvelope(request))
    const response = envelope({ id: 'coverage-response', senderId: second, audience: [first], kind: CONSULT_RESPONSE_KIND })
    const complete = consultChannelAdapter.fold(waiting, recordEnvelope(response))
    const phaseRecord: ChannelRecord = { type: 'channel/phase', sequence: 1, createdAt: 1, phase: 'active' }
    const adapterRecord: ChannelRecord = {
      type: 'channel/adapter', sequence: 1, createdAt: 1, adapter: CONSULT_CHANNEL_ADAPTER, payload: {},
    }

    expect(() => parseConsultChannelManifest(manifest(DISCUSSION_CHANNEL_ADAPTER, discussionParticipants))).toThrow(/consult version/)
    expect(() => parseConsultChannelManifest(manifest(CONSULT_CHANNEL_ADAPTER, [
      { id: first, role: CONSULT_INITIATOR_ROLE },
    ]))).toThrow(/exactly two/)
    expect(() => parseConsultChannelManifest(manifest(CONSULT_CHANNEL_ADAPTER, consultParticipants, { limit: 1 }))).toThrow(/limits/)
    expect(() => parseConsultChannelManifest(manifest(CONSULT_CHANNEL_ADAPTER, [
      { id: first, role: CONSULT_INITIATOR_ROLE },
      { id: first, role: CONSULT_RESPONDENT_ROLE },
    ]))).toThrow(/distinct/)
    expect(() => parseConsultChannelManifest(manifest(CONSULT_CHANNEL_ADAPTER, [
      { id: first, role: 'other' },
      { id: second, role: CONSULT_RESPONDENT_ROLE },
    ]))).toThrow(/initiator/)
    expect(() => parseConsultChannelManifest(manifest(CONSULT_CHANNEL_ADAPTER, [
      { id: first, role: CONSULT_INITIATOR_ROLE },
      { id: second, role: 'other' },
    ]))).toThrow(/respondent/)

    expect(() => consultChannelAdapter.fold(null, phaseRecord)).toThrow(/state must be an object/)
    expect(() => consultChannelAdapter.fold(initial, adapterRecord)).toThrow(/adapter-owned/)
    expect(consultChannelAdapter.fold(initial, phaseRecord)).toEqual(initial)
    expect(() => consultChannelAdapter.fold(initial, recordEnvelope(response))).toThrow(/request before/)
    expect(() => consultChannelAdapter.fold(waiting, recordEnvelope(request))).toThrow(/response after/)
    expect(() => consultChannelAdapter.fold(complete, recordEnvelope(response))).toThrow(/after completion/)
    expect(consultChannelAdapter.closeAfterAccept?.({ manifest: consult, state: initial, record: recordEnvelope(request) })).toBeUndefined()
    expect(consultChannelAdapter.deliveryPlan({ manifest: consult, state: waiting, envelope: request })).toEqual([{
      participantId: second, envelopeId: request.id, delivery: 'turn',
    }])
    expect(() => consultChannelAdapter.afterAccept({
      manifest: consult, state: initial, record: recordEnvelope(request),
    })).toThrow(/does not follow/)
    expect(consultChannelAdapter.projectView({ manifest: consult, state: initial, records: [phaseRecord] })).toMatchObject({ phase: 'request' })
    expect(consultChannelAdapter.projectView({
      manifest: consult,
      state: complete,
      records: [recordEnvelope(request), recordEnvelope(response)],
    })).toMatchObject({ phase: 'complete', requestId: request.id, responseId: response.id })
    for (const payload of [{}, { text: '' }, { text: 1 as unknown as JsonValue }]) {
      expect(() => {
        consultChannelAdapter.validateSend({
          manifest: consult,
          state: initial,
          senderId: first,
          draft: draft({ kind: CONSULT_REQUEST_KIND, payload }),
        })
      }).toThrow()
    }
    expect(() => {
      consultChannelAdapter.validateSend({
        manifest: consult, state: complete, senderId: first,
        draft: draft({ kind: CONSULT_REQUEST_KIND }),
      })
    }).toThrow(/complete/)
    expect(() => {
      consultChannelAdapter.validateSend({
        manifest: consult, state: waiting, senderId: first,
        draft: draft({ audience: [first], kind: CONSULT_RESPONSE_KIND }),
      })
    }).toThrow(/respondent/)
    expect(() => {
      consultChannelAdapter.validateSend({
        manifest: consult, state: waiting, senderId: first,
        draft: draft({ audience: null, kind: CONSULT_RESPONSE_KIND }),
      })
    }).toThrow(/respondent/)
    expect(() => {
      consultChannelAdapter.validateSend({
        manifest: consult, state: waiting, senderId: first,
        draft: draft({ audience: [second, third], kind: CONSULT_RESPONSE_KIND }),
      })
    }).toThrow(/respondent/)
    expect(() => {
      consultChannelAdapter.validateSend({
        manifest: consult, state: waiting, senderId: second,
        draft: draft({ audience: null, kind: CONSULT_RESPONSE_KIND }),
      })
    }).toThrow(/initiator/)
    expect(() => {
      consultChannelAdapter.validateSend({
        manifest: consult, state: waiting, senderId: second,
        draft: draft({ audience: [second], kind: CONSULT_RESPONSE_KIND }),
      })
    }).toThrow(/initiator/)
    expect(() => {
      consultChannelAdapter.validateSend({
        manifest: consult, state: waiting, senderId: second,
        draft: draft({ audience: [first], kind: CONSULT_REQUEST_KIND }),
      })
    }).toThrow(/expects a response/)
    expect(() => {
      consultChannelAdapter.validateSend({
        manifest: consult, state: waiting, senderId: first,
        draft: draft({ kind: CONSULT_RESPONSE_KIND }),
      })
    }).toThrow(/respondent/)
    expect(() => {
      consultChannelAdapter.validateSend({
        manifest: consult, state: waiting, senderId: second,
        draft: draft({ audience: [first], kind: CONSULT_RESPONSE_KIND, delivery: 'context' }),
      })
    }).toThrow(/delivery/)
    expect(() => consultChannelAdapter.expectedNext({ manifest: consult, state: { phase: 'invalid' } })).toThrow(/invalid phase/)
    expect(() => consultChannelAdapter.expectedNext({
      manifest: consult,
      state: { phase: 'request', initiatorId: first, respondentId: second, extra: true },
    })).toThrow(/unsupported/)
    expect(() => consultChannelAdapter.expectedNext({
      manifest: consult,
      state: { phase: 'request', initiatorId: '', respondentId: second },
    })).toThrow(/initiatorId/)
    expect(() => consultChannelAdapter.expectedNext({
      manifest: consult,
      state: { phase: 'request', initiatorId: third, respondentId: second },
    })).toThrow(/does not match/)

    const discussion = manifest(DISCUSSION_CHANNEL_ADAPTER, discussionParticipants, { maxTurns: 2, speakerPolicy: 'round-robin' })
    const discussionInitial = discussionChannelAdapter.initialState(discussion)
    const discussionMessage = envelope({ id: 'coverage-discussion', senderId: first, audience: null })
    const discussionRecord = recordEnvelope(discussionMessage, discussion.participants.map(member => member.id))
    const discussionAfter = discussionChannelAdapter.fold(discussionInitial, discussionRecord)
    const discussionFinal = discussionChannelAdapter.fold(discussionAfter,
      recordEnvelope(envelope({ id: 'coverage-discussion-2', senderId: second, audience: [third] })))
    expect(discussionChannelAdapter.closeAfterAccept?.({
      manifest: discussion,
      state: discussionInitial,
      record: discussionRecord,
    })).toBeUndefined()
    expect(discussionChannelAdapter.closeAfterAccept?.({
      manifest: discussion,
      state: discussionFinal,
      record: discussionRecord,
    })).toBe('discussion turn limit reached')
    expect(discussionChannelAdapter.projectView({
      manifest: discussion,
      state: discussionInitial,
      records: [phaseRecord],
    })).toMatchObject({ turnCount: 0, expectedNext: first })
    expect(discussionChannelAdapter.projectView({
      manifest: discussion,
      state: discussionFinal,
      records: [discussionRecord],
    })).toMatchObject({ turnCount: 2, expectedNext: null })
    expect(() => parseDiscussionChannelManifest(manifest(
      CONSULT_CHANNEL_ADAPTER,
      discussionParticipants,
      { maxTurns: 2, speakerPolicy: 'round-robin' },
    ))).toThrow(/discussion version/)
    expect(() => parseDiscussionChannelManifest(manifest(
      DISCUSSION_CHANNEL_ADAPTER,
      [{ id: first, role: 'speaker' }],
      { maxTurns: 2, speakerPolicy: 'round-robin' },
    ))).toThrow(/at least two/)
    expect(() => parseDiscussionChannelManifest(manifest(
      DISCUSSION_CHANNEL_ADAPTER,
      [{ id: first, role: 'speaker' }, { id: first, role: 'speaker' }],
      { maxTurns: 2, speakerPolicy: 'round-robin' },
    ))).toThrow(/distinct/)
    for (const limits of [
      {},
      { maxTurns: '2', speakerPolicy: 'round-robin' },
      { maxTurns: 1.5, speakerPolicy: 'round-robin' },
      { maxTurns: 0, speakerPolicy: 'round-robin' },
      { maxTurns: 2, speakerPolicy: 'other' },
    ]) {
      const invalid = manifest(DISCUSSION_CHANNEL_ADAPTER, discussionParticipants, limits)
      expect(() => parseDiscussionChannelManifest(invalid)).toThrow()
    }
    expect(() => discussionChannelAdapter.fold(null, phaseRecord)).toThrow(/state must be an object/)
    expect(() => discussionChannelAdapter.fold(discussionInitial, adapterRecord)).toThrow(/adapter-owned/)
    expect(discussionChannelAdapter.fold(discussionInitial, phaseRecord)).toEqual(discussionInitial)
    expect(() => discussionChannelAdapter.fold(discussionFinal, discussionRecord)).toThrow(/exceeded/)
    expect(() => {
      discussionChannelAdapter.validateSend({
        manifest: discussion, state: discussionInitial, senderId: third,
        draft: draft({ audience: null }),
      })
    }).toThrow(/expects participant/)
    expect(() => {
      discussionChannelAdapter.validateSend({
        manifest: discussion, state: discussionInitial, senderId: outsiderId,
        draft: draft({ audience: null }),
      })
    }).toThrow(/not a channel participant/)
    expect(() => {
      discussionChannelAdapter.validateSend({
        manifest: discussion, state: discussionInitial, senderId: first,
        draft: draft({ kind: 'other' }),
      })
    }).toThrow(/only message/)
    expect(() => {
      discussionChannelAdapter.validateSend({
        manifest: discussion, state: discussionInitial, senderId: first,
        draft: draft({ audience: null, payload: { text: '' } }),
      })
    }).toThrow(/nonempty/)
    expect(() => {
      discussionChannelAdapter.validateSend({
        manifest: discussion, state: discussionInitial, senderId: first,
        draft: draft({ audience: null, payload: { text: 1 } }),
      })
    }).toThrow(/nonempty/)
    expect(() => {
      discussionChannelAdapter.validateSend({
        manifest: discussion, state: discussionInitial, senderId: first,
        draft: draft({ audience: [] }),
      })
    }).toThrow(/nonempty/)
    expect(() => {
      discussionChannelAdapter.validateSend({
        manifest: discussion, state: discussionInitial, senderId: first,
        draft: draft({ audience: [second, second] }),
      })
    }).toThrow(/nonempty/)
    expect(() => {
      discussionChannelAdapter.validateSend({
        manifest: discussion, state: discussionInitial, senderId: first,
        draft: draft({ audience: [first] }),
      })
    }).toThrow(/sender/)
    expect(() => {
      discussionChannelAdapter.validateSend({
        manifest: discussion, state: discussionInitial, senderId: first,
        draft: draft({ audience: [third, outsiderId] }),
      })
    }).toThrow(/participants/)
    expect(() => discussionChannelAdapter.afterAccept({
      manifest: discussion, state: discussionInitial, record: discussionRecord,
    })).toThrow(/no sender state/)
    expect(() => discussionChannelAdapter.fold(discussionInitial, discussionRecord)).not.toThrow()
    for (const invalid of [
      envelope({ kind: 'other' }),
      envelope({ delivery: 'steer' }),
      envelope({ senderId: outsiderId }),
      envelope({ senderId: second }),
      envelope({ payload: {} }),
      envelope({ audience: [] }),
      envelope({ audience: [first] }),
      envelope({ audience: [second, second] }),
      envelope({ audience: [outsiderId] }),
    ]) {
      expect(() => discussionChannelAdapter.fold(discussionInitial, recordEnvelope(invalid))).toThrow()
    }
    for (const state of [
      { participantIds: [first], maxTurns: 2, speakerPolicy: 'round-robin', turnCount: 0 },
      { participantIds: [first, first], maxTurns: 2, speakerPolicy: 'round-robin', turnCount: 0 },
      { participantIds: [first, second], maxTurns: '2', speakerPolicy: 'round-robin', turnCount: 0 },
      { participantIds: [first, second], maxTurns: 2, speakerPolicy: 'other', turnCount: 0 },
      { participantIds: [first, second], maxTurns: 2, speakerPolicy: 'round-robin', turnCount: -1 },
      { participantIds: [first, second], maxTurns: 2, speakerPolicy: 'round-robin', turnCount: 3 },
      { participantIds: [first, second], maxTurns: 2, speakerPolicy: 'round-robin', turnCount: 0, lastSenderId: outsiderId },
      { participantIds: [first, second], maxTurns: 2, speakerPolicy: 'round-robin', turnCount: 0, extra: true },
    ]) {
      expect(() => discussionChannelAdapter.expectedNext({ manifest: discussion, state: state })).toThrow()
    }
    expect(() => discussionChannelAdapter.expectedNext({
      manifest: discussion,
      state: { ...discussionInitial as object, maxTurns: 3 },
    })).toThrow(/does not match/)
  })
})

describe('basic channel adapter integration', () => {
  it('closes a consult channel in the same Hub admission that accepts its response', async () => {
    const parent = joinTempParent()
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(`${parent}/basic-hub-`)
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    ctx.teams.registerViewPolicy({ type: 'test-directed', version: 1, project: () => ({}) })
    await ctx.plugin(BasicChannel)
    await ctx.plugin(WorkflowChannel)
    try {
      const created = await createTestRootTeam(ctx, { goal: { objective: 'Consult', budgets: {} }, rules: {}, budgets: {} })
      let state = await ctx.teams.getTeam({ teamId: created.team.id })
      const initiator = await inviteActive(ctx, state.team.id, first, CONSULT_INITIATOR_ROLE)
      state = await ctx.teams.getTeam({ teamId: state.team.id })
      const respondent = await inviteActive(ctx, state.team.id, second, CONSULT_RESPONDENT_ROLE)
      state = await ctx.teams.getTeam({ teamId: state.team.id })
      let channel = await openTestChannel(ctx, {
        teamId: state.team.id,
        expectedCursor: state.team.cursor,
        adapter: CONSULT_CHANNEL_ADAPTER,
        viewPolicy: { type: 'test-directed', version: 1 },
        participants: [{ id: initiator.id, role: CONSULT_INITIATOR_ROLE }, { id: respondent.id, role: CONSULT_RESPONDENT_ROLE }],
        limits: {},
      })
      channel = await consentChannelEndpoints(ctx, channel, [
        { participantId: initiator.id, actor: await activeActor(ctx, created.team.id, initiator) },
        { participantId: respondent.id, actor: await activeActor(ctx, created.team.id, respondent) },
      ], (manifest) => { consultChannelAdapter.validateCreate(manifest) })
      const request = await ctx.teams.postChannelEnvelope({
        actor: await activeActor(ctx, created.team.id, initiator),
        expectedCursor: channel.cursor,
        draft: draft({ channelId: channel.manifest.id, audience: [respondent.id], kind: CONSULT_REQUEST_KIND }),
      })
      const afterRequest = await ctx.teams.getChannel({ channelId: channel.manifest.id })
      await ctx.teams.postChannelEnvelope({
        actor: await activeActor(ctx, created.team.id, respondent),
        expectedCursor: afterRequest.cursor,
        draft: draft({ channelId: channel.manifest.id, audience: [initiator.id], kind: CONSULT_RESPONSE_KIND }),
      })
      const closed = await ctx.teams.getChannel({ channelId: channel.manifest.id })
      expect(request.kind).toBe(CONSULT_REQUEST_KIND)
      expect(closed.phase).toBe('closed')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

/** Return the project-local temporary parent used by integration fixtures. */
function joinTempParent(): string {
  return `${process.cwd()}/.tmp`
}

/** Invite and activate one participant for a Hub integration fixture. */
async function inviteActive(
  ctx: Context,
  teamId: ReturnType<typeof teamIdSchema.parse>,
  id: ReturnType<typeof participantIdSchema.parse>,
  role: string,
) {
  let state = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName: String(id),
    role,
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, { teamId, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'provisioning' })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, { teamId, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'active' })
}

/** Persist one test-owned activation binding through a single-call controller proof. */
async function bindActivation(
  ctx: Context,
  input: { readonly expectedCursor: number; readonly binding: ActivationBindingSnapshot },
): Promise<ActivationBindingSnapshot> {
  let proofs = activationProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemActivationProof, ControllerActivationBindScope>()
    proofs = sourceProofs
    activationProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemActivationProofSource({
      name: TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE,
      resolveActivationProof: proof => sourceProofs.get(proof),
    })
  }
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test activation controller proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemActivationProof
  proofs.set(actor, { kind: 'activation-controller-bind', ...input })
  try {
    return await ctx.teams.bindActivation({ actor, ...input })
  } finally {
    proofs.delete(actor)
  }
}

/** Issue an opaque proof for one active local test participant. */
async function activeActor(
  ctx: Context,
  teamId: ReturnType<typeof teamIdSchema.parse>,
  participant: ParticipantSnapshot,
): Promise<TeamActorProof> {
  const current = await ctx.teams.getTeam({ teamId })
  const binding = current.activations.find(candidate => candidate.activation.participantId === participant.id)
    ?? await bindActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse(`activation-basic-${participant.id}`),
          teamId,
          participantId: participant.id,
          status: 'idle',
        },
        sessionId: SessionId(`session-basic-${participant.id}`),
        provider: 'basic-channel-test',
      },
    })
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}
