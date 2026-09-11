// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { ChannelRecord } from '@clocky/clocky-client-runtime/client'
import type { TeamChannelMessageOwnerProps } from '../src/client/channel-message-types.ts'
import { ChannelEnvelope } from '../src/client/ChannelEnvelope.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('binds the media slot loader to its actual Envelope sequence and identity', async () => {
  const attachment = { attachmentId: 'saved-image' as never, mediaType: 'image/png' as const, width: 1, height: 1, bytes: 4 }
  const record: Extract<ChannelRecord, { type: 'channel/envelope' }> = { type: 'channel/envelope', envelope: {
    teamId: 'actual-team' as never, channelId: 'actual-channel' as never, id: 'actual-envelope' as never, sequence: 23,
    senderId: 'sender' as never, audience: null, kind: 'message', delivery: 'context', priority: 'normal', createdAt: 1,
    payload: { content: [{ type: 'text', text: 'Before' }, { type: 'image', attachment }, { type: 'text', text: 'After' }] },
  }, deliveryIntents: [] }
  let owner: TeamChannelMessageOwnerProps | undefined
  const readAttachment = vi.fn(async () => ({ attachment, data: 'dGlueQ==' }))
  render(<ChannelEnvelope record={record} sender="Actual sender" richContent readAttachment={readAttachment} translate={makeTranslate(en)}
    renderSlot={(name, input) => {
      if (name !== 'team.channel.message') throw new Error('Unexpected child slot')
      // RenderSlotFn's unresolved generic conditional prevents even a direct cast after the exact-key check.
      // The bridge retains the real render-site payload; no owner fields are synthesized here.
      owner = input as unknown as TeamChannelMessageOwnerProps
      return <p>Media slot</p>
    }} />)
  if (owner === undefined) throw new Error('The declared media slot was not rendered')
  expect(owner.content.map(part => part.type)).toEqual(['text', 'image', 'text'])
  await owner.loadAttachment(attachment.attachmentId)
  expect(readAttachment).toHaveBeenCalledWith({ teamId: 'actual-team', channelId: 'actual-channel', envelopeId: 'actual-envelope',
    envelopeSequence: 23, attachmentId: 'saved-image' }, undefined)
})
