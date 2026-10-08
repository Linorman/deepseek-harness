// @vitest-environment jsdom
/** Team visualizations map each encoding to one loaded domain fact and never animate settled data. */
import { afterEach, beforeAll, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { en } from '../src/client/locales.ts'
import { buildSwarm, buildWorkflowFlow, progressSegments, taskState } from '../src/client/team-viz.ts'
import { MissionBanner } from '../src/client/MissionBanner.tsx'
import { TeamVisualization } from '../src/client/TeamVisualization.tsx'
import { workspaceSelection, workspaceState, workspaceTask, workspaceTaskSummary } from './workspace-fixtures.client.ts'

const t = makeTranslate(en) as never
beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never })
afterEach(cleanup)

const members = [
  { id: 'c', kind: 'local-agent', phase: 'active', role: 'coordinator', displayName: 'Coordinator' },
  { id: 'w', kind: 'local-agent', phase: 'active', role: 'worker-1', displayName: 'Worker' },
  { id: 'gone', kind: 'local-agent', phase: 'left', role: 'worker-2', displayName: 'Departed' },
] as never[]
const lease = (owner: string) => ({ attemptId: 'a' as never, participantId: owner as never, activationId: 'x' as never,
  assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1 })

it('draws off-page owners as ghosts, child Teams as clusters, and counts only loaded members', () => {
  const tasks = [
    workspaceTaskSummary(workspaceTask('Owned', { phase: 'running', lease: lease('w') })),
    workspaceTaskSummary(workspaceTask('Elsewhere', { phase: 'running', lease: lease('off-page'),
      reviewPolicy: { kind: 'participant', reviewerId: 'w' } as never })),
    workspaceTaskSummary(workspaceTask('Delegated', { phase: 'review', lease: lease('w'), delegation: { childTeamId: 'child' } as never })),
  ]
  const model = buildSwarm({ members, totalMembers: 7, readiness: [{ participantId: 'w', state: 'busy' } as never], readinessStale: true,
    tasks, channels: [], nameOf: id => id, t })
  const byId = new Map(model.items.map(item => [item.id, item]))
  expect(byId.has('gone')).toBe(false)
  expect(byId.get('w')).toMatchObject({ state: 'running', stale: true })
  expect(byId.get('c')).toMatchObject({ state: 'idle', stateLabel: en['readiness.unavailable'] })
  expect(byId.get('off-page')).toMatchObject({ ghost: true, stateLabel: en['viz.ghost'] })
  expect(byId.get('child:child')).toMatchObject({ state: 'waiting' })
  expect(model.layout.find(node => node.id === 'child:child')?.cluster).toBe('child:child')
  expect(model.edges.find(edge => edge.to === 'off-page')?.variant).toBe('ghost')
  expect(model.edges.some(edge => edge.variant === 'dashed' && edge.from === 'off-page' && edge.to === 'w')).toBe(true)
  expect({ loaded: model.loaded, total: model.total }).toEqual({ loaded: 2, total: 7 })
})

it('maps every task phase to exactly one state and builds ring segments from authoritative counts', () => {
  expect(['pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled', 'deleted'].map(phase => taskState(phase as never)))
    .toEqual(['idle', 'running', 'running', 'waiting', 'done', 'failed', 'idle', 'idle'])
  const counts = { pending: 1, assigned: 1, running: 2, review: 1, completed: 3, failed: 1, cancelled: 0, deleted: 5 }
  const { segments, total } = progressSegments(counts, t)
  expect(total).toBe(9)
  expect(segments.map(segment => [segment.state, segment.value])).toEqual([['done', 3], ['running', 3], ['waiting', 1], ['failed', 1]])
})

it('hides the critical path while a workflow window is partial and marks off-window dependencies as ghosts', () => {
  const partial = buildWorkflowFlow({ record: {} as never, teamCursor: 1, startCursor: -1, total: 3, scanned: 2, nextCursor: 1, items: [
    { templateId: 'b', subject: { text: 'B', truncated: false }, blockedBy: [{ templateId: 'a', subject: { text: 'A', truncated: false } }] },
  ] } as never, [], t)
  expect(partial.complete).toBe(false)
  expect(partial.nodes.find(node => node.id === 'a')?.ghost).toBe(true)
  expect(partial.edges).toEqual([{ from: 'a', to: 'b' }])
})

it('renders settled banner numbers without any motion tier on first paint', () => {
  const base = workspaceState()
  const state = workspaceSelection({ ...base, tasks: [workspaceTask('Done', { phase: 'completed' }), workspaceTask('Next')] })
  const view = render(<MissionBanner state={state} translate={t} />)
  expect(view.container.querySelector('[data-mission-banner]')?.textContent).toContain(`${en['workspace.completed']}1 / 2`)
  expect(view.container.querySelectorAll('[data-motion-tier]')).toHaveLength(0)
})

it('lists the same members in the list view as the topology draws', () => {
  const base = workspaceState()
  const state = workspaceSelection(base)
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  const collections = { teamId: base.team.id, members: { ...empty, items: [
    { id: 'c', teamId: base.team.id, kind: 'local-agent', phase: 'active', role: 'coordinator', displayName: { text: 'Coordinator', truncated: false }, capabilityCount: 0 },
    { id: 'w', teamId: base.team.id, kind: 'local-agent', phase: 'active', role: 'worker-1', displayName: { text: 'Worker', truncated: false }, capabilityCount: 0 },
  ] }, tasks: empty, workflowPlans: empty, artifacts: empty } as never
  const props = { state, collections, translate: t, tasks: [], onVizChange: () => {}, openTask: () => {} }
  const graph = render(<TeamVisualization {...props} viz="topology" />)
  const drawn = ['Coordinator', 'Worker'].map(name => screen.getByRole('button', { name: new RegExp(`^${name} · `) }))
  expect(drawn).toHaveLength(2)
  graph.unmount()
  render(<TeamVisualization {...props} viz="list" />)
  const list = screen.getByRole('list', { name: en['viz.swarm.title'] })
  expect(list.querySelectorAll('button')).toHaveLength(2)
  expect(screen.getByText(en['viz.loaded'].replace('{loaded}', '2').replace('{total}', '2'))).toBeTruthy()
})
