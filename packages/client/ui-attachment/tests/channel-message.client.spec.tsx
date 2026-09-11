// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { TeamChannelMessageProps } from '@clocky/clocky-client-ui-team/client'
import { ChannelMessage } from '../src/client/ChannelMessage.tsx'

afterEach(cleanup)
const attachment = { attachmentId: 'channel-image' as never, mediaType: 'image/png' as const, width: 1, height: 1, bytes: 4, name: 'tiny.png' }
const t: TeamChannelMessageProps['t'] = (key, vars) => {
  if (key === 'channel.previewNamedImage') return `View image ${String(vars?.label)}`
  const labels: Record<string, string> = { 'channel.image': 'Image', 'channel.previewImage': 'Original image',
    'channel.loadingImage': 'Loading image', 'channel.retryImage': 'Retry image', 'channel.closeImage': 'Close image' }
  return labels[key] ?? key
}
function props(loadAttachment: TeamChannelMessageProps['loadAttachment']): TeamChannelMessageProps {
  return { teamId: 'media-team', channelId: 'media-channel', envelopeId: 'media-envelope', envelopeSequence: 7,
    content: [{ type: 'text', text: 'Before image' }, { type: 'image', attachment }, { type: 'text', text: 'After image' }],
    loadAttachment, t } as TeamChannelMessageProps
}

describe('channel message media slot', () => {
  it('preserves text/image order and reuses the original-image preview', async () => {
    const load = vi.fn(async () => ({ attachment, data: 'dGlueQ==' }))
    const view = render(<ChannelMessage {...props(load)} />)
    const image = await view.findByAltText('tiny.png')
    expect(view.getByText('Before image').compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(image.compareDocumentPosition(view.getByText('After image')) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(load).toHaveBeenCalledWith(attachment.attachmentId, expect.any(AbortSignal))
    fireEvent.click(view.getByRole('button', { name: 'View image tiny.png' }))
    expect(view.getByRole('dialog', { name: 'Original image' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Close image' }))
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('offers retry after an authorized image read fails', async () => {
    const load = vi.fn<TeamChannelMessageProps['loadAttachment']>().mockRejectedValueOnce(new Error('Temporary image read failure'))
      .mockResolvedValue({ attachment, data: 'dGlueQ==' })
    const view = render(<ChannelMessage {...props(load)} />)
    fireEvent.click(await view.findByRole('button', { name: 'Retry image' }))
    await view.findByAltText('tiny.png')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('cancels its owned image fetch when the message leaves the view', async () => {
    let signal: AbortSignal | undefined
    const load: TeamChannelMessageProps['loadAttachment'] = async (_id, inputSignal) => {
      signal = inputSignal
      return await new Promise((_resolve, reject) => { inputSignal?.addEventListener('abort', () => { reject(inputSignal.reason) }, { once: true }) })
    }
    const view = render(<ChannelMessage {...props(load)} />)
    await waitFor(() => { expect(signal).toBeDefined() })
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
})
