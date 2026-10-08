/** Principal retirement cancels queued inspect publishing and late query resolutions. */
import { expect, it, vi } from 'vitest'
import { ClientCordisInspectRegistry } from '../src/client/inspect-registry.ts'

it('holds manifest publication during authentication loss and resumes once explicitly connected', async () => {
  const sync = vi.fn().mockResolvedValue(undefined)
  const registry = new ClientCordisInspectRegistry({ sync, resolve: vi.fn().mockResolvedValue(undefined) })
  registry.register({ manifest: { id: 'read-only', description: 'Local facts', methods: [] },
    query: () => Promise.resolve(null) })
  registry.clearAuthorization()
  registry.publish()
  await Promise.resolve(); await Promise.resolve()
  expect(sync).not.toHaveBeenCalled()
  registry.resumeAuthorization()
  registry.publish()
  await vi.waitFor(() => { expect(sync).toHaveBeenCalledOnce() })
})

it('cancels an in-flight private query without resolving it to another principal', async () => {
  let release: (value: string) => void = () => {}
  const gate = new Promise<string>((resolve) => { release = resolve })
  const resolve = vi.fn().mockResolvedValue(undefined)
  const query = vi.fn(() => gate)
  const registry = new ClientCordisInspectRegistry({ sync: vi.fn().mockResolvedValue(undefined), resolve })
  registry.register({ manifest: { id: 'private', description: 'Private facts', methods: [
    { name: 'read', description: 'Read one fact', inputSchema: {}, outputSchema: {} },
  ] }, query })
  const pending = registry.query({ provider: 'private', method: 'read', agentId: 'private-session' as never,
    requestId: 'private-query' as never })
  registry.clearAuthorization()
  registry.resumeAuthorization()
  release('private-old')
  await pending
  expect(resolve).not.toHaveBeenCalled()
})
