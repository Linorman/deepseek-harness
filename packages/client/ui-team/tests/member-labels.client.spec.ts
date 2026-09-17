/** Coordinator form labels use explicit membership metadata, independent from roster paging. */
import { expect, it } from 'vitest'
import { memberLabels, type MemberLabel } from '../src/client/member-labels.ts'
import { workspaceSelection, workspaceState } from './workspace-fixtures.client.ts'

function selection(phase: 'active' | 'left') {
  const state = workspaceState()
  const id = 'coordinator' as MemberLabel['id']
  return workspaceSelection({ ...state,
    participants: [{ id, teamId: state.team.id, kind: 'local-agent', phase, displayName: 'Coordinator', role: 'coordinator', capabilities: [] }],
    activations: [{ activation: { id: 'epoch' as never, teamId: state.team.id, participantId: id, status: phase === 'left' ? 'offline' : 'idle' },
      sessionId: 'session' as never, provider: 'local' }],
  })
}

it('adds at most one known coordinator and preserves its actual membership phase', () => {
  const page: MemberLabel[] = []
  expect(memberLabels(selection('left'), page)).toEqual([{ id: 'coordinator', kind: 'local-agent', phase: 'left',
    displayName: 'Coordinator', role: 'coordinator' }])
  expect(page).toEqual([])
})

it('keeps the current page when the coordinator is loaded or unavailable', () => {
  const page = memberLabels(selection('active'), [])
  expect(memberLabels(selection('active'), page)).toBe(page)
  expect(memberLabels(workspaceSelection(workspaceState()), page)).toBe(page)
})
