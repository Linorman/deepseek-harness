/** Workflow inspection retains one versioned window through navigation, failures and reconnect. */
import { expect, it, vi } from 'vitest'
import type { TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamWorkflowDetailState, TeamWorkflowInspection } from '../src/client/contract/team-tasks.ts'
import { WorkflowInspector } from '../src/client/teams/workflow-inspector.ts'
import { FakeApiClient, deferred, err, ok } from './fake-api.client.ts'

const teamId = 'workflow-team' as TeamId
const planId = 'workflow' as TeamWorkflowInspection['record']['id']
function page(startCursor = -1, revision = 1): TeamWorkflowInspection {
  return { record: { id: planId, teamId, revision, phase: 'compiling', name: 'Workflow',
    bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 } },
  teamCursor: revision, startCursor, total: 2, scanned: 1,
  items: [{ templateId: `template-${startCursor + 1}` as never, subject: { text: 'Task', truncated: false }, blockedBy: [] }],
  ...startCursor === -1 ? { nextCursor: 0 } : {} }
}
function setup() {
  const api = new FakeApiClient()
  let state: TeamWorkflowDetailState | undefined
  const inspector = new WorkflowInspector(api, (value) => { state = value })
  const read = vi.spyOn(api.teams, 'workflowPlanInspect').mockResolvedValue(ok(page()))
  return { inspector, read, state: () => state }
}

it('keeps one window, reuses an opened view, and pins subsequent pages to the loaded revision', async () => {
  const f = setup()
  await f.inspector.read(teamId, planId)
  await f.inspector.read(teamId, planId)
  expect(f.read).toHaveBeenCalledTimes(1)
  f.read.mockResolvedValueOnce(ok(page(0)))
  await f.inspector.read(teamId, planId, 'next')
  expect(f.read).toHaveBeenLastCalledWith({ teamId, planId, afterCursor: 0, limit: 64, expectedRevision: 1 }, expect.any(AbortSignal))
  expect(f.state()?.value?.items).toHaveLength(1)
  expect(f.state()?.value?.startCursor).toBe(0)
  await f.inspector.read(teamId, planId, 'next')
  expect(f.read).toHaveBeenCalledTimes(2)
  await f.inspector.read(teamId, planId, 'first')
  expect(f.state()?.value?.startCursor).toBe(-1)
})

it('keeps a readable old revision after a failed refresh and prevents paging it after a newer event', async () => {
  const f = setup()
  await f.inspector.read(teamId, planId)
  f.inspector.changed(teamId, planId, 2)
  await f.inspector.read(teamId, planId, 'next')
  expect(f.read).toHaveBeenCalledTimes(1)
  f.read.mockResolvedValueOnce(err({ code: 'internal', message: 'unavailable', details: {} }))
  await f.inspector.read(teamId, planId, 'refresh')
  expect(f.state()).toMatchObject({ hasNewer: true, error: 'unavailable', value: { record: { revision: 1 } } })
  f.read.mockResolvedValueOnce(ok(page(-1, 2)))
  await f.inspector.read(teamId, planId, 'refresh')
  expect(f.state()).toMatchObject({ hasNewer: false, value: { record: { revision: 2 } } })
  expect(f.state()?.error).toBeUndefined()
})

it('ignores a dismissed late reply and revalidates retained data on reconnect', async () => {
  const f = setup()
  const pending = deferred<Awaited<ReturnType<typeof f.read>>>()
  f.read.mockReturnValueOnce(pending.promise)
  const opening = f.inspector.read(teamId, planId)
  const signal = f.read.mock.calls[0]?.[1]
  f.inspector.close()
  expect(signal?.aborted).toBe(true)
  pending.resolve(ok(page()))
  await opening
  expect(f.state()).toBeUndefined()
  await f.inspector.read(teamId, planId)
  f.inspector.disconnect()
  expect(f.state()).toMatchObject({ disconnected: true, value: { record: { id: planId } } })
  await f.inspector.reconnect()
  expect(f.state()?.disconnected).toBe(false)
})

it('rejects a reply older than an observed event without replacing the current page', async () => {
  const f = setup()
  await f.inspector.read(teamId, planId)
  f.inspector.changed(teamId, planId, 3)
  f.read.mockResolvedValueOnce(ok(page(-1, 2)))
  await f.inspector.read(teamId, planId, 'refresh')
  expect(f.state()?.value?.record.revision).toBe(1)
  expect(f.state()?.error).toContain('stale')
})

it('does not send a request after loading publication closes the inspector', async () => {
  const api = new FakeApiClient()
  const read = vi.spyOn(api.teams, 'workflowPlanInspect')
  let close = () => {}
  const inspector = new WorkflowInspector(api, (state) => { if (state?.loading) close() })
  close = () => { inspector.close() }
  await inspector.read(teamId, planId)
  expect(read).not.toHaveBeenCalled()
})

it.each(['close', 'replace'] as const)('keeps a reentrant replacement while %s retires the previous read', async (operation) => {
  const f = setup()
  const pending = deferred<Awaited<ReturnType<typeof f.read>>>()
  const replacement = 'replacement' as typeof planId
  f.read.mockImplementationOnce((_input, signal) => {
    if (signal === undefined) throw new Error('Inspection must carry cancellation')
    signal.addEventListener('abort', () => { void f.inspector.read(teamId, replacement) }, { once: true })
    return pending.promise
  }).mockResolvedValueOnce(ok({ ...page(), record: { ...page().record, id: replacement } }))
  const old = f.inspector.read(teamId, planId)
  if (operation === 'close') f.inspector.close()
  else await f.inspector.read(teamId, 'superseded' as typeof planId)
  await vi.waitFor(() => { expect(f.state()?.value?.record.id).toBe(replacement) })
  pending.resolve(ok(page()))
  await old
  expect(f.state()?.planId).toBe(replacement)
})

it('ignores unrelated changes and can refresh after an initial failure', async () => {
  const f = setup()
  f.inspector.disconnect()
  await f.inspector.reconnect()
  f.inspector.changed(teamId, planId, 1)
  f.read.mockImplementationOnce(() => { throw 'transport reset' })
  await f.inspector.read(teamId, planId)
  expect(f.state()?.error).toBe('transport reset')
  f.inspector.changed('foreign' as TeamId, planId, 9)
  f.inspector.changed(teamId, 'foreign' as typeof planId, 9)
  f.inspector.changed(teamId, planId, 1)
  await f.inspector.read(teamId, planId, 'refresh')
  f.inspector.changed(teamId, planId, 1)
  expect(f.state()?.hasNewer).toBe(false)
})

it('ignores an error from a dismissed request', async () => {
  const f = setup()
  const pending = deferred<Awaited<ReturnType<typeof f.read>>>()
  f.read.mockReturnValueOnce(pending.promise)
  const read = f.inspector.read(teamId, planId)
  f.inspector.close()
  pending.reject(new Error('late failure'))
  await read
  expect(f.state()).toBeUndefined()
})

it('rejects an overfilled workflow page while retaining its previous data', async () => {
  const f = setup()
  await f.inspector.read(teamId, planId)
  const value = page()
  f.read.mockResolvedValueOnce(ok({ ...value, nextCursor: undefined, total: 65, scanned: 65,
    record: { ...value.record, bounds: { ...value.record.bounds, maxTasks: 65 } },
    items: Array.from({ length: 65 }, (_, index) => ({ templateId: `task-${index}` as never,
      subject: { text: 'Task', truncated: false }, blockedBy: [] })),
  }))
  await f.inspector.read(teamId, planId, 'refresh')
  expect(f.state()?.error).toContain('row limit')
  expect(f.state()?.value?.items).toHaveLength(1)
})
