/** Identity display is independent of collection windows and reveals no private member fields. */
import { expect, it } from 'vitest'
import { resolveTeamIdentities } from '../src/identity-resolution.ts'
import { participantSnapshotSchema, teamIdentityResolveInputSchema, teamIdentityResolvePageSchema } from '../src/schema.ts'

const input = teamIdentityResolveInputSchema.parse({ teamId: 'identities', participantIds: ['first', 'absent', 'left', 'first'] })
const members = new Map(['first', 'left'].map((id) => {
  const member = participantSnapshotSchema.parse({ id, teamId: input.teamId, kind: 'local-agent', displayName: '成员🙂很长的名字',
    role: 'private-role', capabilities: ['private'], phase: id === 'left' ? 'left' : 'active', provider: 'private-runtime' })
  return [member.id, member] as const
}))

it('deduplicates requested identities and resolves only exact lookups with Unicode-safe name prefixes', () => {
  expect(input.participantIds).toEqual(['first', 'absent', 'left'])
  const directOnly = new Proxy(members, { get(target, property) {
    if (property === 'get') return target.get.bind(target)
    throw new Error('Identity resolution must not enumerate the member collection')
  } })
  const result = resolveTeamIdentities(directOnly, 7, input, 3, 7, 10000)
  expect(teamIdentityResolvePageSchema.parse(result)).toEqual(result)
  expect(result.items).toEqual([
    { participantId: 'first', state: 'resolved', displayName: { text: '成员', truncated: true }, phase: 'active' },
    { participantId: 'absent', state: 'unavailable' },
    { participantId: 'left', state: 'resolved', displayName: { text: '成员', truncated: true }, phase: 'left' },
  ])
  expect(result.nextCursor).toBeUndefined()
})

it('uses bounded continuation and refuses a changed revision or an out-of-range offset', () => {
  const first = resolveTeamIdentities(members, 7, input, 1, 100, 10000)
  expect(first.nextCursor).toBe(1)
  const second = resolveTeamIdentities(members, 7, { ...input, afterCursor: first.nextCursor!, expectedTeamCursor: 7 }, 1, 100, 10000)
  expect(second.items).toEqual([{ participantId: 'absent', state: 'unavailable' }])
  expect(second.nextCursor).toBe(2)
  expect(() => resolveTeamIdentities(members, 8, { ...input, expectedTeamCursor: 7 }, 1, 100, 10000)).toThrow('changed')
  expect(() => resolveTeamIdentities(members, 7, { ...input, afterCursor: 4 }, 1, 100, 10000)).toThrow('exceeds the requested set')
  expect(resolveTeamIdentities(members, 7, { ...input, afterCursor: 3 }, 1, 100, 10000).items).toEqual([])
})

it('bounds the complete serialized response including continuation and admits an exactly fitting final row', () => {
  const full = resolveTeamIdentities(members, 1, input, 1, 100, 10000)
  const bytes = Buffer.byteLength(JSON.stringify(full))
  expect(resolveTeamIdentities(members, 1, input, 3, 100, bytes)).toEqual(full)
  expect(() => resolveTeamIdentities(members, 1, input, 3, 100, bytes - 1)).toThrow('row exceeds')
  expect(() => resolveTeamIdentities(members, 1, input, 3, 100, 1)).toThrow('metadata exceeds')
  const one = { ...input, participantIds: [input.participantIds[0]!] }
  const final = resolveTeamIdentities(members, 1, one, 1, 100, 10000)
  expect(resolveTeamIdentities(members, 1, one, 1, 100, Buffer.byteLength(JSON.stringify(final)))).toEqual(final)
})

it('rejects wire pages with duplicate identities, empty continuation or leaked private fields', () => {
  const page = resolveTeamIdentities(members, 1, input, 1, 100, 10000)
  expect(() => teamIdentityResolvePageSchema.parse({ ...page, items: [page.items[0], page.items[0]] })).toThrow()
  expect(() => teamIdentityResolvePageSchema.parse({ ...page, items: [] })).toThrow()
  expect(() => teamIdentityResolvePageSchema.parse({ ...page, items: [{ ...page.items[0], provider: 'secret' }] })).toThrow()
})
