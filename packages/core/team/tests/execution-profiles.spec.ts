/** Deployment catalogs are bounded, revocable observations rather than invitation authority. */
import { Context } from '@clocky/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionProfiles } from '../src/execution-profiles.ts'
import { teamExecutionProfileSchema, teamExecutionProfilesPageSchema } from '../src/schema.ts'
import type { ParticipantInviteInput, TeamExecutionProfileRegistration } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const input = { teamId: 'profile-team' as never, kind: 'local-agent' as const }
function registration(index = 1): TeamExecutionProfileRegistration {
  return { profile: teamExecutionProfileSchema.parse({ id: `profile-${index.toString(16).padStart(64, '0')}`,
    kind: 'local-agent', role: `worker-${index}`, provider: 'local', model: 'mock/model' }), availability: () => [] }
}
function setup() {
  const ctx = new Context(); contexts.push(ctx)
  return { ctx, catalog: new ExecutionProfiles() }
}
function invite(entry: TeamExecutionProfileRegistration): ParticipantInviteInput {
  const { id, ...descriptor } = entry.profile
  return { ...descriptor, executionProfileId: id, teamId: input.teamId, displayName: 'Worker', capabilities: [], expectedCursor: 1 }
}

it('removes registrations with their owner and permits replacement without stale-disposer removal', async () => {
  const { ctx, catalog } = setup()
  const entry = registration()
  let stop: (() => void) | undefined
  const fiber = await ctx.plugin((caller) => { stop = catalog.register(caller, entry) })
  expect(catalog.page(input, 1, 10000).items).toHaveLength(1)
  expect(() => catalog.register(ctx, entry)).toThrow('already registered')
  await fiber.dispose()
  expect(catalog.page(input, 1, 10000).items).toEqual([])
  catalog.register(ctx, entry)
  stop?.()
  expect(catalog.page(input, 1, 10000).items).toHaveLength(1)
})

it('validates current availability and the complete selected invitation descriptor', () => {
  const { ctx, catalog } = setup()
  const entry = registration()
  const availability = vi.fn<TeamExecutionProfileRegistration['availability']>(() => [])
  const stop = catalog.register(ctx, { ...entry, availability })
  expect(() =>{  catalog.assertInvitation(invite(entry)) }).not.toThrow()
  for (const patch of [{ kind: 'remote-agent' as const }, { role: 'other' }, { provider: 'other' }, { preset: 'other' }, { model: 'other' }, { authScheme: 'other' }]) {
    expect(() =>{  catalog.assertInvitation({ ...invite(entry), ...patch }) }).toThrow('does not match')
  }
  availability.mockReturnValue(['provider-unavailable'])
  expect(catalog.page(input, 1, 10000).items[0]).toMatchObject({ available: false, reasons: ['provider-unavailable'] })
  expect(() =>{  catalog.assertInvitation(invite(entry)) }).toThrow('unavailable')
  stop()
  expect(() =>{  catalog.assertInvitation(invite(entry)) }).toThrow('unavailable')
  const { executionProfileId: _id, ...manual } = invite(entry)
  expect(() =>{  catalog.assertInvitation(manual) }).not.toThrow()
})

it('retains a selected off-page profile and rejects foreign or changed continuation', () => {
  const { ctx, catalog } = setup()
  const entries = [registration(1), registration(2), registration(3)]
  const stops = entries.map(entry => catalog.register(ctx, entry))
  const selectedId = entries[2]!.profile.id
  const first = catalog.page({ ...input, selectedId }, 1, 10000)
  expect(first.items.map(item => item.id)).toEqual([entries[0]!.profile.id])
  expect(first.selected?.id).toBe(selectedId)
  expect(teamExecutionProfilesPageSchema.parse(first)).toEqual(first)
  const second = catalog.page({ ...input, cursor: first.nextCursor! }, 1, 10000)
  expect(second.items[0]?.id).toBe(entries[1]!.profile.id)
  const last = catalog.page({ ...input, cursor: second.nextCursor! }, 1, 10000)
  expect(last.nextCursor).toBeUndefined()
  expect(() => catalog.page({ ...input, teamId: 'other' as never, cursor: first.nextCursor! }, 1, 10000)).toThrow('changed')
  expect(() => catalog.page({ ...input, kind: 'remote-agent', cursor: first.nextCursor! }, 1, 10000)).toThrow('changed')
  expect(() => catalog.page({ ...input, kind: 'remote-agent', selectedId }, 1, 10000)).toThrow('another member kind')
  stops[0]!()
  expect(() => catalog.page({ ...input, cursor: first.nextCursor! }, 1, 10000)).toThrow('changed')
})

it('accounts for complete response bytes and accepts an exactly fitting final row', () => {
  const { ctx, catalog } = setup()
  catalog.register(ctx, registration())
  expect(catalog.page({ ...input, kind: 'service' }, 1, 10000).items).toEqual([])
  const page = catalog.page(input, 1, 10000)
  const bytes = Buffer.byteLength(JSON.stringify(page))
  expect(catalog.page(input, 1, bytes)).toEqual(page)
  expect(() => catalog.page(input, 1, bytes - 1)).toThrow('row exceeds')
  expect(() => catalog.page(input, 1, 1)).toThrow('metadata exceeds')
  catalog.register(ctx, registration(2))
  const first = catalog.page(input, 1, 10000)
  const bounded = catalog.page(input, 5, Buffer.byteLength(JSON.stringify(first)))
  expect(bounded).toEqual(first)
})

it('conceals profile data and skips availability callbacks when permission is denied', () => {
  const { ctx, catalog } = setup()
  const entry = registration()
  const availability = vi.fn(() => [])
  catalog.register(ctx, { ...entry, availability })
  const denied = catalog.page({ ...input, selectedId: entry.profile.id,
    cursor: { ...input, revision: 99, offset: 0 } }, 1, 10000, 'not-authorized')
  expect(denied).toMatchObject({ allowed: false, reason: 'not-authorized', items: [] })
  expect(denied.selected).toBeUndefined()
  expect(availability).not.toHaveBeenCalled()
})

it('rejects registry mutation during an availability observation', () => {
  const { ctx, catalog } = setup()
  catalog.register(ctx, { ...registration(), availability: () => { catalog.register(ctx, registration(2)); return [] } })
  expect(() => catalog.page(input, 1, 10000)).toThrow('during observation')
})
