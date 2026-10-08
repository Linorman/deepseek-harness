import type { Context } from '@clocky/cordis'
import type {
  ContextMessageNode, ConversationNodeDefinition, SteeringMessageNode, UserMessageNode,
} from '@clocky/clocky-client-runtime/client'
import {
  contextForm, contextProvenance, deriveEventMessage, isAppendSurfaceEvent, isReplacementSurfaceEvent,
} from '@clocky/clocky-client-runtime/client'
import type { InboxState } from './inbox.ts'
import { chatNode } from './common.ts'

interface ReferencedUserMessageNode extends UserMessageNode {
  /** Labels cited by the immediately following session-reference context. */
  readonly referenceLabels?: readonly string[]
}

interface ReferencedSteeringMessageNode extends SteeringMessageNode {
  /** Labels cited by the immediately following session-reference context. */
  readonly referenceLabels?: readonly string[]
}

type MessageNode = ReferencedUserMessageNode | ReferencedSteeringMessageNode | ContextMessageNode

declare module '@clocky/clocky-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Ordinary turn-opening user message. */
    user: ReferencedUserMessageNode
    /** User message admitted into an active turn. */
    steering: ReferencedSteeringMessageNode
    /** Non-user context injected into model history. */
    context: ContextMessageNode
  }
}

function isCompactionCheckpoint(event: Parameters<ConversationNodeDefinition['match']>[0]): boolean {
  if (event.type !== 'user/message' || !isReplacementSurfaceEvent(event)) return false
  const source = event.data.source
  return source.kind === 'plugin' && source.plugin === 'compact'
}

/** Read Team delivery intent without importing the Host-only delivery Consumer package. */
function teamDeliveryOf(source: unknown): 'context' | 'turn' | 'steer' | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const candidate = source as { readonly kind?: unknown; readonly delivery?: unknown }
  if (candidate.kind !== 'team-envelope') return undefined
  switch (candidate.delivery) {
    case 'context':
    case 'turn':
    case 'steer':
      return candidate.delivery
    default:
      return undefined
  }
}

/** User, steering, and injected-context message classification Definition. */
export const messageDefinition: ConversationNodeDefinition<MessageNode> = {
  kind: 'input-message',
  target: 'chat',
  match: (event) => {
    if (!isAppendSurfaceEvent(event)) return null
    if (event.type === 'team/channel-view') return { id: String(event.seq), role: 'start' }
    return event.type === 'user/message' && !isCompactionCheckpoint(event)
      ? { id: String(event.data.id), role: 'start' }
      : null
  },
  start: (_context, match, reader) => {
    if (match.event.type === 'team/channel-view') {
      return {
        kind: 'user',
        seq: match.event.seq,
        time: match.event.time,
        content: match.event.data.content,
        source: deriveEventMessage(match.event)?.source,
      }
    }
    if (match.event.type !== 'user/message') throw new Error('input-message start requires user/message')
    const event = match.event
    const source = event.data.source
    const teamDelivery = teamDeliveryOf(event.data.source)
    if (teamDelivery === 'turn') {
      return {
        kind: 'user',
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source,
      }
    }
    if (teamDelivery === 'steer') {
      return {
        kind: 'steering',
        messageId: event.data.id,
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source,
      }
    }
    if (event.data.source.kind !== 'user') {
      return {
        kind: 'context',
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
        provenance: contextProvenance(event.data.source),
        form: contextForm(event.data.source),
      }
    }
    const claimed = reader.previous<InboxState>('inbox-next-step')?.state.claimed.has(String(event.data.id)) === true
    return claimed
      ? {
        kind: 'steering',
        messageId: event.data.id,
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
      }
      : {
        kind: 'user',
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
      }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return chatNode(context, context.state.kind, context.state.seq, context.state)
  },
}

/**
 * Register the user, steering, and injected-context message contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerMessageConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(messageDefinition)
}
