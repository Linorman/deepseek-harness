import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamChannelAttachmentInput } from '../src/client/contract/team-tasks.ts'
import { TeamTaskRuntime } from '../src/client/teams/service.ts'
import { FakeApiClient, deferred, err, ok } from './fake-api.client.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
function setup() {
  const ctx = new Context(); contexts.push(ctx)
  const api = new FakeApiClient()
  return { api, tasks: new TeamTaskRuntime(ctx, api) }
}

describe('channel media API ownership', () => {
  it('sends ordered encoded content through Host admission instead of constructing durable references', async () => {
    const { api, tasks } = setup()
    const selection = await tasks.open('media-owner' as never)
    const channelId = selection.state.channelIds[0]!
    const post = vi.spyOn(api.teams, 'channelInput').mockResolvedValue(err({ code: 'internal', message: 'Host rejected image bytes', details: {} }))
    const content = [{ type: 'text' as const, text: 'Before' }, { type: 'image' as const, mediaType: 'image/png' as const, data: 'encoded', name: 'tiny.png' },
      { type: 'text' as const, text: 'After' }]
    const input = { channelId, expectedCursor: 7, audience: null, content, delivery: 'context' as const, idempotencyKey: 'encoded-retry' as never }
    await expect(tasks.manage(selection.teamId, { operation: 'channelInput', input })).rejects.toThrow('Host rejected image bytes')
    expect(post).toHaveBeenCalledWith(input, undefined)
    expect(api.callsOf('team.channel.post')).toEqual([])
  })

  it('retains the exact saved Envelope sequence on image reads and drops cancelled results', async () => {
    const { api, tasks } = setup()
    const input: TeamChannelAttachmentInput = { teamId: 'team' as never, channelId: 'channel' as never,
      envelopeId: 'envelope' as never, envelopeSequence: 19, attachmentId: 'image' as never }
    const response = deferred<Awaited<ReturnType<FakeApiClient['teams']['channelAttachment']>>>()
    const read = vi.spyOn(api.teams, 'channelAttachment').mockImplementation(async () => await response.promise)
    const controller = new AbortController()
    const pending = tasks.readChannelAttachment(input, controller.signal)
    controller.abort(new Error('Message view closed'))
    response.resolve(ok({ attachment: { attachmentId: input.attachmentId, mediaType: 'image/png', width: 1, height: 1, bytes: 4 }, data: 'dGlueQ==' }))
    await expect(pending).rejects.toThrow('Message view closed')
    expect(read).toHaveBeenCalledWith(input, controller.signal)
  })
})
