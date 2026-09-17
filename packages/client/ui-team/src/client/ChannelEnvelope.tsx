/** Readable message content delegates media rendering through the Team's declared slot. */
import { useCallback, useMemo } from 'react'
import type { ChannelRecord, TeamChannelAttachmentInput, TeamChannelAttachmentResult, TeamChannelMessageContent } from '@clocky/clocky-client-runtime/client'
import type { PropsRenderSlots } from '@clocky/clocky-client-ui-slots'
import type { TeamKey } from './locales.ts'
import css from './TeamBrowser.module.css'

/** Render admitted content while binding all image reads to its actual Team/channel/Envelope tuple. */
export function ChannelEnvelope({ record, sender, richContent, renderSlot, readAttachment, translate: t }: {
  readonly record: Extract<ChannelRecord, { type: 'channel/envelope' }>
  readonly sender: string
  readonly richContent: boolean
  readonly renderSlot?: PropsRenderSlots<'team.channel.message'>['renderSlot'] | undefined
  readonly readAttachment?: ((input: TeamChannelAttachmentInput, signal?: AbortSignal) => Promise<TeamChannelAttachmentResult>) | undefined
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
}) {
  const envelope = record.envelope
  const content = useMemo<TeamChannelMessageContent>(() => {
    if (typeof envelope.payload.text === 'string') return [{ type: 'text', text: envelope.payload.text }]
    // The Hub's direct v3/v4 adapter validates these admitted message parts before WAL publication.
    if (!richContent || !Array.isArray(envelope.payload.content)) return []
    const parts: readonly unknown[] = envelope.payload.content
    return parts as TeamChannelMessageContent
  }, [envelope, richContent])
  const loadAttachment = useCallback(async (attachmentId: TeamChannelAttachmentInput['attachmentId'], signal?: AbortSignal) => {
    if (readAttachment === undefined) throw new Error(t('channel.imageUnavailable'))
    return await readAttachment({ teamId: envelope.teamId, channelId: envelope.channelId, envelopeId: envelope.id,
      envelopeSequence: envelope.sequence, attachmentId }, signal)
  }, [readAttachment, envelope.teamId, envelope.channelId, envelope.id, envelope.sequence, t])
  const fallback = content.map((part, index) => <p key={index} className={css.humanText}>
    {part.type === 'text' ? part.text : t('channel.imageUnavailable')}
  </p>)
  return <article className={css.channelMessage} data-channel-message={envelope.id}>
    <header className={css.channelMessageHeader}><strong>{sender}</strong>
      <time dateTime={new Date(envelope.createdAt).toISOString()}>
        {new Intl.DateTimeFormat(t('channel.dateLocale'), { hour: '2-digit', minute: '2-digit' }).format(envelope.createdAt)}
      </time>
    </header>
    {renderSlot?.('team.channel.message', { teamId: envelope.teamId, channelId: envelope.channelId,
      envelopeId: envelope.id, envelopeSequence: envelope.sequence, content, loadAttachment }, { fallback }) ?? fallback}
  </article>
}
