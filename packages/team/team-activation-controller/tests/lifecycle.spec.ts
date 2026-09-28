import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SessionId } from '@clocky/clocky-session'
import { activationIdSchema, activationReservationIdSchema, participantIdSchema, teamIdSchema } from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, ActivationReservationInput } from '@clocky/clocky-team'
import { LifecycleOwners } from '../src/lifecycle.ts'
import type { TeamActivationCoordinationLease, TeamActivationLifecycleOwner } from '../src/lifecycle.ts'
import type { TeamActivationRequest } from '../src/index.ts'

const request: TeamActivationRequest = {
  teamId: teamIdSchema.parse('team'), participantId: participantIdSchema.parse('participant'), sessionId: SessionId('session'),
  provider: 'local', expectedCursor: 0, seed: { kind: 'fresh' }, agent: { options: {} }, signal: new AbortController().signal,
}
const reservation: ActivationReservationInput = { teamId: request.teamId, participantId: request.participantId,
  sessionId: request.sessionId, provider: request.provider, expectedCursor: 0,
  reservationId: activationReservationIdSchema.parse('reservation') }
const binding: ActivationBindingSnapshot = { sessionId: request.sessionId, provider: request.provider,
  reservationId: reservation.reservationId,
  activation: { id: activationIdSchema.parse('epoch'), teamId: request.teamId, participantId: request.participantId, status: 'idle' } }
function lease(): TeamActivationCoordinationLease {
  return { localTerminationConfirmed: false, bind: vi.fn(() => Promise.resolve()),
    revoke: vi.fn(() => Promise.resolve()), release: vi.fn(() => Promise.resolve()) }
}
function owner(receipt: TeamActivationCoordinationLease): TeamActivationLifecycleOwner {
  return { name: 'simulation', reserve: () => Promise.resolve(receipt), recover: () => Promise.resolve(receipt),
    recoverReservation: () => Promise.resolve(receipt) }
}
const rules = { activationLifecycleOwner: 'simulation' }

it('enforces durable owner selection and rejects duplicate or unresolved ownership', async () => {
  const ctx = new Context()
  const registry = new LifecycleOwners(() => Promise.resolve())
  const receipt = lease()
  const source = owner(receipt)
  expect(registry.resolve({})).toBeUndefined()
  expect(() => registry.resolve({ activationLifecycleOwner: 1 })).toThrow(/nonempty/)
  expect(() => registry.register(ctx, { ...source, name: '' })).toThrow(/empty/)
  const release = registry.register(ctx, source)
  expect(() => registry.register(ctx, source)).toThrow(/already registered/)
  const selected = registry.resolve(rules)
  if (selected === undefined) throw new Error('missing selected owner')
  await registry.reserve(selected, 'key', request, reservation)
  await expect(registry.reserve(selected, 'key', request, reservation)).rejects.toThrow(/unresolved/)
  expect(() => { registry.assertSettled() }).toThrow(/confirmed termination/)
  await expect(registry.recover(rules, 'key', binding)).rejects.toThrow(/Unpublished startup/)
  expect(await registry.recoverReservation(rules, 'key', reservation)).toBe(receipt)
  await registry.bind('key', binding, undefined)
  expect(await registry.recover(rules, 'key', binding)).toBe(receipt)
  await expect(registry.recover(rules, 'key', { ...binding, activation: { ...binding.activation, id: activationIdSchema.parse('other') } })).rejects.toThrow(/another activation/)
  await expect(registry.recoverReservation(rules, 'key', reservation)).rejects.toThrow(/Published activation/)
  await expect(release()).rejects.toThrow(/unconfirmed startup/)
  expect(() => registry.resolve(rules)).toThrow(/unavailable/)
  await registry.revoke('key'); await registry.release('key')
  await registry.checkpoint('key')
  await release(); await release()
  registry.assertSettled()
  expect(() => registry.resolve(rules)).toThrow(/unavailable/)
  await ctx.fiber.dispose()
})

it('removes failed recovery admissions and propagates lease failures until cleanup succeeds', async () => {
  const ctx = new Context()
  const registry = new LifecycleOwners(() => Promise.resolve())
  const receipt = lease()
  const source = owner(receipt)
  let reject = true
  source.recover = () => reject ? Promise.reject(new Error('reconcile failed')) : Promise.resolve(receipt)
  source.recoverReservation = () => reject ? Promise.reject(new Error('reservation failed')) : Promise.resolve(receipt)
  const unregister = registry.register(ctx, source)
  expect(await registry.recover({}, 'unmanaged', binding)).toBeUndefined()
  expect(await registry.recoverReservation({}, 'unmanaged', reservation)).toBeUndefined()
  await expect(registry.recover(rules, 'key', binding)).rejects.toThrow('reconcile failed')
  await expect(registry.recoverReservation(rules, 'key', reservation)).rejects.toThrow('reservation failed')
  registry.assertSettled()
  reject = false
  expect(await registry.recoverReservation(rules, 'key', reservation)).toBe(receipt)
  // The assertion observes the protocol method without invoking it unbound.
  // oxlint-disable-next-line typescript/unbound-method
  const release = vi.mocked(receipt.release)
  release.mockRejectedValueOnce(new Error('not stopped'))
  await expect(registry.release('key')).rejects.toThrow('not stopped')
  expect(() => { registry.assertSettled() }).toThrow()
  await registry.release('key')
  await unregister()
  await ctx.fiber.dispose()
})

it('keeps a successor reservation when an older repeated release acknowledges late', async () => {
  const ctx = new Context()
  const first = Promise.withResolvers<undefined>()
  const repeated = Promise.withResolvers<undefined>()
  let calls = 0
  const receipt = { ...lease(), release: () => ++calls === 1 ? first.promise : calls === 2 ? repeated.promise : Promise.resolve() }
  const registry = new LifecycleOwners(() => Promise.resolve())
  const unregister = registry.register(ctx, owner(receipt))
  const selected = registry.resolve(rules)
  if (selected === undefined) throw new Error('missing selected owner')
  await registry.reserve(selected, 'key', request, reservation)
  const one = registry.release('key')
  const two = registry.release('key')
  first.resolve(undefined); await one
  await registry.reserve(selected, 'key', request, reservation)
  repeated.resolve(undefined); await two
  expect(() => { registry.assertSettled() }).toThrow(/confirmed termination/)
  await registry.release('key')
  await unregister()
  await ctx.fiber.dispose()
})
