// @vitest-environment jsdom
/** Overview actions route to their owning views and retain bounded member and artifact identities. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamArtifactReference, TeamAttentionState, TeamMemberReadinessState } from '@clocky/clocky-client-runtime/client'
import { TeamOverview } from '../src/client/TeamOverview.tsx'
import { en } from '../src/client/locales.ts'
import { workspaceMemberSummary, workspaceSelection, workspaceState } from './workspace-fixtures.client.ts'

afterEach(cleanup)

it('opens exact member and artifact targets and routes every overview inventory control', () => {
  const base = workspaceState()
  const member = { id: 'worker' as never, teamId: base.team.id, displayName: 'Worker', kind: 'local-agent' as const,
    phase: 'active' as const, role: 'worker', capabilities: [] }
  const state = workspaceSelection({ ...base, participants: [member] })
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  const collections = { teamId: base.team.id, members: { ...empty, items: [workspaceMemberSummary(member)] },
    tasks: empty, workflowPlans: empty, artifacts: empty }
  const artifact: TeamArtifactReference = { id: 'artifact-one', provider: 'local', kind: 'report', uri: 'artifact://', visibility: 'team' }
  const unavailable: TeamArtifactReference = { id: 'artifact-two', kind: 'log', uri: 'artifact://trace', visibility: 'team' }
  const navigate = vi.fn(), openMember = vi.fn(), openArtifact = vi.fn()
  const view = render(<TeamOverview state={state} collections={collections} translate={makeTranslate(en)}
    artifacts={[artifact, unavailable]} openTask={vi.fn()} openMember={openMember} navigate={navigate}
    openArtifact={openArtifact} inspectActivity={vi.fn()} />)
  const memberSection = view.getByRole('region', { name: en['overview.members'] })
  fireEvent.click(within(memberSection).getByRole('button', { name: 'Worker' }))
  expect(openMember).toHaveBeenCalledExactlyOnceWith(member.id)
  const artifactSection = view.getByRole('region', { name: en['overview.artifacts'] })
  fireEvent.click(within(artifactSection).getByRole('button', { name: artifact.id }))
  expect(openArtifact).toHaveBeenCalledExactlyOnceWith(artifact)
  expect(within(artifactSection).getByRole('button', { name: 'trace' }).hasAttribute('disabled')).toBe(true)
  for (const [section, destination] of [
    [en['workspace.execution'], 'tasks'], [en['overview.members'], 'members'], [en['overview.artifacts'], 'artifacts'],
  ] as const) {
    fireEvent.click(within(view.getByRole('region', { name: section })).getByRole('button', { name: en['overview.viewAll'] }))
    expect(navigate).toHaveBeenLastCalledWith(destination)
  }
})

it('shows readiness freshness and reports a failed Session open before a successful retry', async () => {
  const base = workspaceState()
  const member = { id: 'worker' as never, teamId: base.team.id, displayName: 'Worker', kind: 'local-agent' as const,
    phase: 'active' as const, role: 'worker', capabilities: [] }
  const state = workspaceSelection({ ...base, participants: [member] })
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  const collections = { teamId: base.team.id, members: { ...empty, items: [workspaceMemberSummary(member)] },
    tasks: empty, workflowPlans: empty, artifacts: empty }
  const readiness: TeamMemberReadinessState = { input: { teamId: base.team.id, participantIds: [member.id] },
    loading: false, disconnected: false, value: { teamId: base.team.id, teamCursor: state.team.cursor,
      items: [{ participantId: member.id, participation: 'active', state: 'ready', reasons: [],
        observationId: 'observed' as never, observedAt: 1 }] } }
  const openParticipantSession = vi.fn().mockRejectedValueOnce('Session unavailable')
    .mockRejectedValueOnce(new Error('Session expired')).mockResolvedValueOnce(undefined)
  const view = render(<TeamOverview state={state} collections={collections} memberReadiness={readiness}
    translate={makeTranslate(en)} artifacts={[]} openTask={vi.fn()} navigate={vi.fn()}
    openParticipantSession={openParticipantSession} inspectActivity={vi.fn()} />)
  expect(view.getByText(en['readiness.state.ready'])).toBeTruthy()
  const open = view.getByRole('button', { name: `${en['taskView.openSession']} Worker` })
  fireEvent.click(open)
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Session unavailable') })
  fireEvent.click(open)
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Session expired') })
  fireEvent.click(open)
  await waitFor(() => { expect(view.queryByRole('alert')).toBeNull() })
  expect(openParticipantSession).toHaveBeenNthCalledWith(3, member.id)
  view.rerender(<TeamOverview state={state} collections={collections} memberReadiness={{ ...readiness,
    disconnected: true }} translate={makeTranslate(en)} artifacts={[]} openTask={vi.fn()} navigate={vi.fn()}
  openParticipantSession={openParticipantSession} inspectActivity={vi.fn()} />)
  expect(view.getByText(`${en['readiness.state.ready']} · ${en['readiness.stale']}`)).toBeTruthy()
  view.rerender(<TeamOverview state={{ ...state, metadata: { kind: 'unavailable', reason: 'too-large' } }}
    collections={collections} translate={makeTranslate(en)} artifacts={[]} openTask={vi.fn()}
    navigate={vi.fn()} inspectActivity={vi.fn()} />)
  expect(view.container.querySelector('summary')?.textContent).toContain('—')
})

it('refreshes a newer pending preview and opens each exact responsibility', async () => {
  const base = workspaceState()
  const state = workspaceSelection(base)
  const counts = { recovery: 1, humanActions: 1, reviews: 1, total: 3 }
  const attentionPreview: TeamAttentionState = { teamId: base.team.id, limit: 3, loading: false,
    disconnected: false, hasNewer: true, page: { teamId: base.team.id, teamCursor: state.team.cursor,
      counts, items: [
        { kind: 'team-recovery', id: base.team.id, createdAt: 1,
          reason: { code: 'stalled', message: { text: 'Recovery needed', truncated: false } },
          handling: { kind: 'actionable' } },
        { kind: 'task-review', id: 'review' as never, createdAt: 2, revision: 1,
          subject: { text: 'Review work', truncated: false }, reviewerId: 'human' as never,
          handling: { kind: 'actionable' } },
        { kind: 'human-action', id: 'question' as never, createdAt: 3, updatedAt: 3,
          actionKind: 'question', handling: { kind: 'actionable' } },
      ] } }
  const refreshAttentionPreview = vi.fn(async () => {})
  const openPendingAction = vi.fn(async () => {})
  const navigate = vi.fn(), openTask = vi.fn()
  const view = render(<TeamOverview state={state} attentionPreview={attentionPreview}
    refreshAttentionPreview={refreshAttentionPreview} openPendingAction={openPendingAction}
    translate={makeTranslate(en)} artifacts={[]} openTask={openTask} navigate={navigate} inspectActivity={vi.fn()} />)
  const section = view.getByRole('region', { name: en['workspace.attention'] })
  fireEvent.click(within(section).getByRole('button', { name: en['attention.refreshPreview'] }))
  await waitFor(() => { expect(refreshAttentionPreview).toHaveBeenCalledExactlyOnceWith(base.team.id) })
  fireEvent.click(within(section).getByRole('button', { name: en['attention.teamRecovery'] }))
  expect(navigate).toHaveBeenLastCalledWith('audit')
  fireEvent.click(within(section).getByRole('button', { name: 'Review work' }))
  expect(openTask).toHaveBeenCalledExactlyOnceWith('review')
  fireEvent.click(within(section).getByRole('button', { name: en['detail.question'] }))
  await waitFor(() => { expect(openPendingAction).toHaveBeenCalledExactlyOnceWith(base.team.id, 'question') })
  fireEvent.click(within(section).getByRole('button', { name: en['attention.viewAll'] }))
  expect(navigate).toHaveBeenLastCalledWith('attention')
})
