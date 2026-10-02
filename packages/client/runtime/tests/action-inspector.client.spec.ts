/** Current request records remain bound to selection and permission while drafts live elsewhere. */
import { expect, it, vi } from 'vitest'
import type { TeamId, TeamHumanActionId } from '@clocky/clocky-client-connection/client'
import type { TeamActionDetailState, TeamActionInspection } from '../src/client/contract/team-tasks.ts'
import { ActionInspector } from '../src/client/teams/action-inspector.ts'
import { FakeApiClient, deferred, ok, err } from './fake-api.client.ts'

const teamId = 'inspect-team' as TeamId
const actionId = 'inspect-action' as TeamHumanActionId
function value(updatedAt = 1): TeamActionInspection {
  return { teamId, teamCursor: updatedAt, handling: { kind: 'actionable' }, action: {
    id: actionId, teamId, kind: 'question', phase: 'pending', sourceId: 'source' as never,
    sessionId: 'session' as never, participantId: 'agent' as never, details: { questions: [] }, createdAt: 1, updatedAt,
  } }
}
function setup(onPublish?: (owner: ActionInspector, state: TeamActionDetailState | undefined) => void) {
  const api = new FakeApiClient()
  let state: TeamActionDetailState | undefined
  const denied = vi.fn()
  const owner = new ActionInspector(api, (stateValue) => { state = stateValue; onPublish?.(owner, stateValue) }, denied)
  const read = vi.spyOn(api.teams, 'actionInspect').mockImplementation(async input => ok({ ...value(), teamId: input.teamId,
    action: { ...value().action, id: input.actionId, teamId: input.teamId } }))
  return { owner, read, denied, state: () => state }
}

it('retains ordinary failure content and refuses mismatched or older inspection records', async () => {
  const h = setup()
  await h.owner.read(teamId, actionId)
  const first = h.state()?.value
  h.read.mockResolvedValueOnce(err({ code: 'internal', message: 'Provider unavailable', details: {} }))
  await h.owner.read(teamId, actionId)
  expect(h.state()).toMatchObject({ value: first, error: 'Provider unavailable', loading: false })
  h.read.mockRejectedValueOnce(new Error('IO failed'))
  await h.owner.read(teamId, actionId)
  expect(h.state()?.error).toBe('IO failed')
  h.read.mockRejectedValueOnce('Unknown IO')
  await h.owner.read(teamId, actionId)
  expect(h.state()?.error).toBe('Unknown IO')
  for (const changed of [{ ...value(), teamId: 'foreign' as TeamId }, { ...value(), action: { ...value().action, teamId: 'foreign' as TeamId } },
    { ...value(), action: { ...value().action, id: 'foreign' as TeamHumanActionId } }, value(0)]) {
    h.read.mockResolvedValueOnce(ok(changed))
    await h.owner.read(teamId, actionId)
    expect(h.state()?.value).toBe(first)
    expect(h.state()?.error).toContain('identity or revision')
  }
  h.owner.close()
})

it('drops replaced reads and clears current denial without exposing prior body content', async () => {
  const h = setup()
  const held = deferred<Awaited<ReturnType<FakeApiClient['teams']['actionInspect']>>>()
  h.read.mockReturnValueOnce(held.promise)
  const old = h.owner.read(teamId, actionId)
  await h.owner.read(teamId, 'new' as TeamHumanActionId)
  held.resolve(ok(value()))
  await old
  expect(h.state()?.actionId).toBe('new')
  h.read.mockResolvedValueOnce(err({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', message: 'Access withdrawn', details: {} }))
  await h.owner.read(teamId, actionId)
  expect(h.state()).toBeUndefined()
  expect(h.denied).toHaveBeenCalledExactlyOnceWith(teamId)
})

it('marks received or processed answers stale until current handling is re-read', async () => {
  const h = setup()
  h.owner.observe(value().action)
  await h.owner.read(teamId, actionId)
  h.owner.observe({ ...value().action, id: 'other' as TeamHumanActionId })
  h.owner.observe({ ...value().action, teamId: 'other' as TeamId })
  h.owner.observe(value(0).action)
  expect(h.state()?.hasNewer).toBe(false)
  h.owner.observe(value(2).action)
  expect(h.state()?.hasNewer).toBe(true)
  h.owner.observe({ ...value(3).action, response: { expectedUpdatedAt: 2, idempotencyKey: 'answer' as never,
    answer: { kind: 'question', answers: [] }, acceptedAt: 3, respondedBy: 'human' as never } })
  expect(h.state()?.value?.handling).toEqual({ kind: 'waiting', reason: 'response-accepted' })
  h.owner.observe({ ...value(4).action, phase: 'resolved' })
  expect(h.state()?.value?.handling).toEqual({ kind: 'waiting', reason: 'already-processed' })
  h.owner.changed('other' as TeamId, 10)
  h.owner.changed(teamId, 1)
  h.owner.changed(teamId, 5)
  h.owner.close()
})

it('preserves disconnected content and rechecks the exact identity after handshake', async () => {
  const h = setup()
  await h.owner.reconnect()
  await h.owner.read(teamId, actionId)
  h.owner.disconnect()
  await h.owner.read(teamId, actionId)
  expect(h.read).toHaveBeenCalledOnce()
  expect(h.state()).toMatchObject({ disconnected: true, hasNewer: true, loading: false })
  await h.owner.reconnect()
  expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.state()?.disconnected).toBe(false)
  h.owner.close()
})

it.each(['read', 'close', 'disconnect'] as const)('keeps replacement reads selected during %s abort callbacks', async (operation) => {
  const h = setup()
  const held = deferred<Awaited<ReturnType<FakeApiClient['teams']['actionInspect']>>>()
  h.read.mockImplementationOnce((_input, signal) => {
    signal?.addEventListener('abort', () => { void h.owner.read(teamId, 'replacement' as TeamHumanActionId) }, { once: true })
    return held.promise
  })
  const old = h.owner.read(teamId, actionId)
  if (operation === 'read') await h.owner.read(teamId, actionId)
  else h.owner[operation]()
  held.reject(new Error('Old response'))
  await old
  if (operation === 'disconnect') expect(h.state()?.disconnected).toBe(true)
  else expect(h.state()?.actionId).toBe('replacement')
  h.owner.close()
})

it('cancels synchronously closed loading publication before provider IO', async () => {
  const h = setup((owner, state) => { if (state?.loading) owner.close() })
  await h.owner.read(teamId, actionId)
  expect(h.read).not.toHaveBeenCalled()
  expect(h.state()).toBeUndefined()
})

it('closes safely when retirement callbacks release the current request', async () => {
  const h = setup()
  h.owner.disconnect()
  await h.owner.reconnect()
  const held = deferred<Awaited<ReturnType<FakeApiClient['teams']['actionInspect']>>>()
  h.read.mockImplementationOnce((_input, signal) => {
    signal?.addEventListener('abort', () => { h.owner.close() }, { once: true })
    return held.promise
  })
  const old = h.owner.read(teamId, actionId)
  h.owner.disconnect()
  held.resolve(ok(value()))
  await old
  expect(h.state()).toBeUndefined()
})

it('refuses old responses after a newer Team fact or answer arrives during IO', async () => {
  const h = setup()
  expect(await h.owner.read(teamId, actionId)).toEqual(value())
  for (const change of ['team', 'action'] as const) {
    const held = deferred<Awaited<ReturnType<FakeApiClient['teams']['actionInspect']>>>()
    h.read.mockReturnValueOnce(held.promise)
    const current = h.owner.read(teamId, actionId)
    if (change === 'team') h.owner.changed(teamId, 3)
    else h.owner.observe(value(4).action)
    held.resolve(ok(value(change === 'team' ? 1 : 3)))
    expect(await current).toBeUndefined()
    expect(h.state()?.error).toContain('identity or revision')
  }
  h.read.mockResolvedValueOnce(ok(value(5)))
  expect(await h.owner.read(teamId, actionId)).toEqual(value(5))
  h.owner.close()
})

it('withholds a publication synchronously marked newer by its runtime consumer', async () => {
  const h = setup((owner, state) => { if (state?.value !== undefined && !state.hasNewer) owner.changed(teamId, 10) })
  expect(await h.owner.read(teamId, actionId)).toBeUndefined()
  expect(h.state()?.hasNewer).toBe(true)
  h.owner.close()
})
