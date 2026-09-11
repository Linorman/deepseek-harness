/** Ordered Team message text and images use the shared thumbnail and original-image preview. */
import { useCallback, useEffect, useRef } from 'react'
import type { TeamChannelMessageProps } from '@clocky/clocky-client-ui-team/client'
import { MessageImage } from '../MessageImage.tsx'
import css from './ChannelMessage.module.css'

/** Render source order and retire outstanding image requests when this message leaves the page. */
export function ChannelMessage({ content, loadAttachment, t }: TeamChannelMessageProps) {
  const requests = useRef(new Set<AbortController>())
  useEffect(() => () => { for (const request of requests.current) request.abort(); requests.current.clear() }, [])
  const load = useCallback(async (attachment: Extract<typeof content[number], { type: 'image' }>['attachment']) => {
    const request = new AbortController()
    requests.current.add(request)
    try {
      const result = await loadAttachment(attachment.attachmentId, request.signal)
      request.signal.throwIfAborted()
      return `data:${result.attachment.mediaType};base64,${result.data}`
    } finally { requests.current.delete(request) }
  }, [loadAttachment])
  return <div className={css.content}>{content.map((part, index) => part.type === 'text'
    ? <p className={css.text} key={index}>{part.text}</p>
    : <MessageImage key={`${part.attachment.attachmentId}:${index}`} attachment={part.attachment}
      load={load} variant="single" labels={{ image: t('channel.image'), open: t('channel.previewImage'),
        openNamed: label => t('channel.previewNamedImage', { label }), loading: t('channel.loadingImage'), loadFailed: t('channel.retryImage'),
        lightbox: { dialog: t('channel.previewImage'), close: t('channel.closeImage') } }} />)}</div>
}
