/** Ordered channel-message slot data and exact saved-image loading authority. */
import type { TeamChannelAttachmentInput, TeamChannelAttachmentResult, TeamChannelMessageContent } from '@clocky/clocky-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@clocky/clocky-client-ui-slots'

/** Immutable message content plus a loader already bound to this exact Envelope. */
export interface TeamChannelMessageOwnerProps extends Pick<TeamChannelAttachmentInput, 'teamId' | 'channelId' | 'envelopeId' | 'envelopeSequence'> {
  readonly content: TeamChannelMessageContent
  readonly loadAttachment: (attachmentId: TeamChannelAttachmentInput['attachmentId'], signal?: AbortSignal) => Promise<TeamChannelAttachmentResult>
}

/** Attachment presentation receives the slot's owner data and existing media locale. */
export type TeamChannelMessageProps = PropsRuntime<'team.channel.message'> & PropsLocale<'team'>
