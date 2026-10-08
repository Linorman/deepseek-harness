/** Source lookup keeps exact Team authority and provenance even when channel reads race. */
import { expect, it } from 'vitest'
import { envelopeSourceParts, readEnvelopeSource } from '../src/envelope-source.ts'

const source = { teamId: 'team', channelId: 'channel', envelopeId: 'envelope' } as never
const position = { afterCursor: 2, limit: 3 }
const envelope = { id: 'envelope', teamId: 'team', channelId: 'channel', sequence: 3,
  payload: { content: [{ type: 'text', text: 'a🙂' }] } }

function context(options: { owner?: string
  manifestTeam?: string
  manifestChannel?: string
  records?: unknown[]
  nextCursor?: number
  failure?: unknown
} = {}) {
  const teams = { resolveIdentities: async () => undefined,
    getChannelOwner: async () => ({ teamId: options.owner ?? 'team' }),
    readChannelPage: async () => {
      if (options.failure !== undefined) throw options.failure
      return { channel: { manifest: { teamId: options.manifestTeam ?? 'team',
        id: options.manifestChannel ?? 'channel' } }, records: options.records ?? [], nextCursor: options.nextCursor }
    } }
  const humans = { withProof: async (_call: unknown, _request: unknown, run: (actor: unknown) => Promise<unknown>) => run({}) }
  return { get: (key: string) => key === 'teams' ? teams : humans } as never
}

it('withholds mismatched owners, pages and envelopes, and refuses nonadvancing search cursors', async () => {
  const read = (ctx: ReturnType<typeof context>, override: { afterCursor: number; limit: number; envelopeSequence?: number } = position) =>
    readEnvelopeSource(ctx, source, {} as never, override, () => undefined)
  expect(await read({ get: () => undefined } as never)).toEqual({ status: 'unavailable' })
  expect(await read(context({ owner: 'other' }))).toEqual({ status: 'withheld' })
  expect(await read(context({ manifestTeam: 'other' }))).toEqual({ status: 'withheld' })
  expect(await read(context({ manifestChannel: 'other' }))).toEqual({ status: 'withheld' })
  expect(await read(context({ records: [{ type: 'channel/envelope', envelope: { ...envelope, teamId: 'other' } }] })))
    .toEqual({ status: 'withheld' })
  expect(await read(context({ records: [{ type: 'channel/envelope', envelope: { ...envelope, sequence: 4 } }] }),
    { ...position, envelopeSequence: 3 })).toEqual({ status: 'withheld' })
  expect(await read(context({ nextCursor: 2 }))).toEqual({ status: 'unavailable' })
  expect(await read(context({ nextCursor: 4 }))).toEqual({ status: 'searching', afterCursor: 4 })
  expect(await read(context({ records: [{ type: 'channel/envelope', envelope }] }))).toEqual({ status: 'found', envelope })
  expect(await read(context())).toEqual({ status: 'missing' })
  expect(await read(context({ failure: { code: 'TEAM_CHANNEL_NOT_FOUND' } }))).toEqual({ status: 'withheld' })
  expect(await read(context({ failure: new Error('storage unavailable') }))).toEqual({ status: 'unavailable' })
})

it('renders only original plain text blocks in UTF-8-safe parts', () => {
  expect([...envelopeSourceParts({ ...envelope, payload: {} } as never, 4)])
    .toEqual([{ block: 0, body: { status: 'unsupported' } }])
  expect([...envelopeSourceParts({ ...envelope, payload: { content: [null, [], { type: 'image', data: 'private' },
    { type: 'text', text: 3 }, { type: 'text', text: 'a🙂' }] } } as never, 4)]).toEqual([
    { block: 0, body: { status: 'unsupported' } },
    { block: 1, body: { status: 'unsupported' } },
    { block: 2, body: { status: 'unsupported' } },
    { block: 3, body: { status: 'unsupported' } },
    { block: 4, body: { status: 'text', text: 'a', part: 0, parts: 2 } },
    { block: 4, body: { status: 'text', text: '🙂', part: 1, parts: 2 } },
  ])
})
