/** Artifact bytes survive ordinary failure but never target or authorization retirement. */
import { expect, it, vi } from 'vitest'
import type { TeamArtifactDetailState } from '../src/client/contract/team-tasks.ts'
import { ArtifactInspector } from '../src/client/teams/artifact-inspector.ts'
import { FakeApiClient, deferred, ok, err } from './fake-api.client.ts'

const teamId = 'team' as import('@clocky/clocky-client-connection/client').TeamId
const bytes = { artifact: { id: 'report', provider: 'local', kind: 'report' as const, uri: 'artifact://report', visibility: 'team' as const },
  bytes: 4, data: 'dGVzdA==' }
function setup(onPublish?: (reader: ArtifactInspector, state: TeamArtifactDetailState | undefined) => void) {
  const api = new FakeApiClient()
  let state: TeamArtifactDetailState | undefined
  const denied = vi.fn()
  const reader = new ArtifactInspector(api, (value) => { state = value; onPublish?.(reader, value) }, denied)
  const read = vi.spyOn(api.teams, 'artifactRead').mockResolvedValue(ok(bytes))
  return { reader, read, denied, state: () => state }
}

it('retains the exact approved bytes after refresh failure and replaces them only on successful retry', async () => {
  const h = setup()
  await h.reader.read(teamId, 'report')
  h.read.mockRejectedValueOnce(new Error('Disconnected transport'))
  await h.reader.read(teamId, 'report')
  expect(h.state()).toMatchObject({ artifactId: 'report', value: bytes, stale: true, error: 'Disconnected transport' })
  await h.reader.read(teamId, 'report')
  expect(h.state()).toMatchObject({ value: bytes, stale: false, loading: false })
  expect(h.state()?.error).toBeUndefined()
})

it('cancels old target reads and never displays another reference under the new identity', async () => {
  const h = setup(), pending = deferred<Awaited<ReturnType<typeof h.read>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const old = h.reader.read(teamId, 'report')
  h.read.mockResolvedValueOnce(ok({ ...bytes, artifact: { ...bytes.artifact, id: 'new' } }))
  await h.reader.read(teamId, 'new')
  expect(h.read.mock.calls[0]?.[1]?.aborted).toBe(true)
  pending.resolve(ok(bytes)); await old
  expect(h.state()?.value?.artifact.id).toBe('new')
  h.read.mockResolvedValueOnce(ok(bytes))
  await h.reader.read(teamId, 'new')
  expect(h.state()?.error).toContain('another reference')
  expect(h.state()?.value?.artifact.id).toBe('new')
})

it('preserves readable bytes across disconnection but rejects late responses and revalidates after reconnect', async () => {
  const h = setup(), pending = deferred<Awaited<ReturnType<typeof h.read>>>()
  await h.reader.read(teamId, 'report')
  h.read.mockReturnValueOnce(pending.promise)
  const old = h.reader.read(teamId, 'report')
  h.reader.disconnect()
  pending.resolve(ok({ ...bytes, data: 'bmV3' })); await old
  expect(h.state()).toMatchObject({ value: bytes, disconnected: true, stale: true, loading: false })
  await h.reader.reconnect()
  expect(h.state()).toMatchObject({ value: bytes, disconnected: false, stale: false })
})

it('releases private bytes and prevents a pending response from republishing after known revocation', async () => {
  const h = setup(), pending = deferred<Awaited<ReturnType<typeof h.read>>>()
  await h.reader.read(teamId, 'report')
  h.read.mockReturnValueOnce(pending.promise)
  const old = h.reader.read(teamId, 'report')
  h.reader.close()
  pending.resolve(ok(bytes)); await old
  expect(h.state()).toBeUndefined()
  h.read.mockResolvedValueOnce(err({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', message: 'Access removed', details: {} }))
  await h.reader.read(teamId, 'report')
  expect(h.denied).toHaveBeenCalledWith(teamId)
  expect(h.state()).toBeUndefined()
})

it('honors cancellation during publication before dispatching obsolete reads', async () => {
  const h = setup((reader, state) => { if (state?.loading) reader.close() })
  await h.reader.read(teamId, 'report')
  expect(h.read).not.toHaveBeenCalled()
  expect(h.state()).toBeUndefined()
})

it('lets a newer target selected by cancellation replace the interrupted request', async () => {
  const h = setup(), pending = deferred<Awaited<ReturnType<typeof h.read>>>()
  h.read.mockImplementationOnce(async (_input, signal) => {
    signal?.addEventListener('abort', () => { void h.reader.read(teamId, 'new') }, { once: true })
    return await pending.promise
  }).mockResolvedValueOnce(ok({ ...bytes, artifact: { ...bytes.artifact, id: 'new' } }))
  const old = h.reader.read(teamId, 'report')
  await h.reader.read(teamId, 'interrupted')
  pending.resolve(ok(bytes)); await old
  expect(h.read.mock.calls.map(([input]) => input.artifactId)).toEqual(['report', 'new'])
  expect(h.state()?.value?.artifact.id).toBe('new')
})

it('blocks cancellation callbacks from reopening a retired byte window', async () => {
  const h = setup(), pending = deferred<Awaited<ReturnType<typeof h.read>>>()
  h.read.mockImplementationOnce(async (_input, signal) => {
    signal?.addEventListener('abort', () => { void h.reader.read(teamId, 'new') }, { once: true })
    return await pending.promise
  })
  const old = h.reader.read(teamId, 'report')
  h.reader.close()
  pending.resolve(ok(bytes)); await old
  expect(h.read).toHaveBeenCalledTimes(1)
  expect(h.state()).toBeUndefined()
})

it('does not publish malformed or miscounted wire bytes to preview and download consumers', async () => {
  const h = setup()
  for (const data of ['not-base64', 'AA==']) {
    h.read.mockResolvedValueOnce(ok({ ...bytes, data }))
    await h.reader.read(teamId, 'report')
    expect(h.state()?.value).toBeUndefined()
    expect(h.state()?.error).toContain('encoded byte metadata')
  }
})
