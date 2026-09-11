/** Browser attachment plugin: fills conversation's composer and message-image slots. */
import type { ClientContext } from '@clocky/clocky-client-runtime/client'
import type {} from '@clocky/clocky-client-ui-conversation/client'
import type {} from '@clocky/clocky-client-ui-team/client'
import { ComposerAttachments } from './ComposerAttachments.tsx'
import { MessageImages } from './MessageImages.tsx'
import { ChannelMessage } from './ChannelMessage.tsx'

/** Slot registry required by this presentation plugin. */
export const inject = ['slots']

/** Register attachment presentation without exporting React components as package values. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('team.channel.message', () => ctx.slots.register({
    name: 'team.channel.message', locale: 'team',
  }, ChannelMessage))
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
  }, ComposerAttachments))
  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
}
