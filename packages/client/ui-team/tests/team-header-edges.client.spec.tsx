// @vitest-environment jsdom
/** Team header actions keep navigation and deliberate lifecycle decisions separate. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { TeamHeader } from '../src/client/TeamHeader.tsx'
import { en } from '../src/client/locales.ts'
import { workspaceSelection, workspaceState } from './workspace-fixtures.client.ts'

afterEach(cleanup)

it('switches a Team module without starting work and requires an explicit stop confirmation', async () => {
  const onCancel = vi.fn(async () => {})
  const onViewChange = vi.fn()
  const view = render(<TeamHeader state={workspaceSelection(workspaceState())} view="overview" translate={makeTranslate(en)}
    onCancel={onCancel} onViewChange={onViewChange} artifactCount={0} />)
  fireEvent.click(view.getByRole('button', { name: en['workspace.tasks'] }))
  expect(onViewChange).toHaveBeenCalledWith('tasks')
  const more = view.getByRole('button', { name: /More/ })
  fireEvent.click(more)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(more.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(more)
  fireEvent.click(view.getByRole('menuitem', { name: en['workspace.workflows'] }))
  expect(onViewChange).toHaveBeenLastCalledWith('workflows')
  fireEvent.click(more)
  fireEvent.click(view.getByRole('menuitem', { name: en['workspace.audit'] }))
  expect(onViewChange).toHaveBeenLastCalledWith('audit')
  fireEvent.click(more)
  fireEvent.click(view.getByRole('menuitem', { name: en['workspace.attention'] }))
  expect(onViewChange).toHaveBeenLastCalledWith('attention')
  const teamActions = view.getByRole('button', { name: en['workspace.teamActions'] })
  fireEvent.click(teamActions)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(teamActions.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(teamActions)
  fireEvent.click(view.getByRole('menuitem', { name: en['workspace.stopTeam'] }))
  const dialog = within(view.getByRole('dialog', { name: en['workspace.stopTeam'] }))
  fireEvent.click(dialog.getAllByRole('button', { name: en['detail.task.stopCancel'] })[0]!)
  expect(onCancel).not.toHaveBeenCalled()
  fireEvent.click(teamActions)
  fireEvent.click(view.getByRole('menuitem', { name: en['workspace.stopTeam'] }))
  fireEvent.click(within(view.getByRole('dialog', { name: en['workspace.stopTeam'] }))
    .getByRole('button', { name: en['workspace.stopTeam'] }))
  await waitFor(() => { expect(onCancel).toHaveBeenCalledOnce() })
  await waitFor(() => { expect(view.queryByRole('dialog', { name: en['workspace.stopTeam'] })).toBeNull() })
})

it('keeps a stop confirmation visible during submission and reports a failed decision', async () => {
  let reject!: (reason: Error) => void
  const onCancel = vi.fn(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise }))
  const view = render(<TeamHeader state={workspaceSelection(workspaceState())} view="overview" translate={makeTranslate(en)}
    onCancel={onCancel} />)
  fireEvent.click(view.getByRole('button', { name: en['workspace.teamActions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['workspace.stopTeam'] }))
  const dialog = within(view.getByRole('dialog', { name: en['workspace.stopTeam'] }))
  fireEvent.click(dialog.getByRole('button', { name: en['workspace.stopTeam'] }))
  expect(dialog.getByText(en['detail.task.stopLoading'])).toBeTruthy()
  fireEvent.click(dialog.getAllByRole('button', { name: en['detail.task.stopCancel'] })[0]!)
  expect(view.getByRole('dialog', { name: en['workspace.stopTeam'] })).toBeTruthy()
  reject(new Error('Stop request changed'))
  await waitFor(() => { expect(dialog.getByRole('alert').textContent).toBe('Stop request changed') })
  fireEvent.click(dialog.getAllByRole('button', { name: en['detail.task.stopCancel'] })[1]!)
  expect(view.queryByRole('dialog', { name: en['workspace.stopTeam'] })).toBeNull()
  expect(view.getByRole('alert').textContent).toBe('Stop request changed')
})

it('shows the exact stall diagnosis, copies it and returns focus to its trigger', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const original = workspaceState()
  const state = workspaceSelection({ ...original, team: { ...original.team, phase: 'stalled', workspacePath: '/projects/release' } })
  const view = render(<TeamHeader state={{ ...state, stallReason: { code: 'RECOVERY_REQUIRED',
    message: { text: 'Coordinator needs recovery.', truncated: false } } }}
  view="overview" translate={makeTranslate(en)} />)
  expect(view.getByRole('navigation', { name: en['header.breadcrumb'] }).textContent).toContain('release')
  const trigger = view.getByRole('button', { name: en['header.whyStalled'] })
  fireEvent.click(trigger)
  const diagnosis = within(view.getByRole('dialog', { name: en['header.diagnosis'] }))
  expect(diagnosis.getByText('Coordinator needs recovery.')).toBeTruthy()
  fireEvent.click(diagnosis.getByRole('button', { name: en['header.copyDetails'] }))
  await waitFor(() => { expect(writeText).toHaveBeenCalledWith('RECOVERY_REQUIRED\nCoordinator needs recovery.') })
  fireEvent.keyDown(view.getByRole('dialog', { name: en['header.diagnosis'] }), { key: 'Escape' })
  expect(view.queryByRole('dialog', { name: en['header.diagnosis'] })).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('uses bounded metadata fallbacks and presents terminal inspection without execution controls', async () => {
  const base = workspaceSelection(workspaceState())
  const state = { ...base, team: { ...base.team, phase: 'completed' as const },
    metadata: { kind: 'unavailable' as const, reason: 'too-large' as const },
    attentionCounts: { recovery: 1, humanActions: 1, reviews: 0, total: 2 } }
  const openCoordinator = vi.fn(async () => {})
  const view = render(<TeamHeader state={state} view="overview" translate={makeTranslate(en)}
    openCoordinator={openCoordinator} onResume={vi.fn(async () => {})} onCancel={vi.fn(async () => {})} />)
  expect(view.getByText(en['workspace.metadataUnavailable'])).toBeTruthy()
  expect(view.getByRole('heading', { level: 1 }).textContent).toBe('Release preparation')
  expect(view.getByText('Needs your attention', { selector: 'dt' }).parentElement?.textContent).toBe('Needs your attention2')
  expect(view.queryByRole('button', { name: en.resume })).toBeNull()
  expect(view.queryByRole('button', { name: en['workspace.teamActions'] })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en['workspace.inspectCoordinator'] }))
  await waitFor(() => { expect(openCoordinator).toHaveBeenCalledOnce() })
})

it('offers separate resume and inspection for a stalled Team without conflating their effects', async () => {
  const original = workspaceState()
  const state = workspaceSelection({ ...original, team: { ...original.team, phase: 'stalled' } })
  const onResume = vi.fn(async () => {}), openCoordinator = vi.fn(async () => {})
  const view = render(<TeamHeader state={state} view="overview" translate={makeTranslate(en)}
    onResume={onResume} openCoordinator={openCoordinator} />)
  fireEvent.click(view.getByRole('button', { name: en['workspace.openCoordinator'] }))
  await waitFor(() => { expect(openCoordinator).toHaveBeenCalledOnce() })
  expect(onResume).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en.resume }))
  await waitFor(() => { expect(onResume).toHaveBeenCalledOnce() })
})

it('keeps absent attention unknown and displays a non-Error stop rejection', async () => {
  const state = { ...workspaceSelection(workspaceState()), attentionCounts: undefined }
  const onCancel = vi.fn(async () => {})
  onCancel.mockRejectedValueOnce('Stop request was refused')
  const view = render(<TeamHeader state={state} view="overview" translate={makeTranslate(en)} onCancel={onCancel} />)
  expect(view.getByText(en['workspace.attention'], { selector: 'dt' }).parentElement?.textContent).toBe(`${en['workspace.attention']}—`)
  fireEvent.click(view.getByRole('button', { name: en['workspace.teamActions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['workspace.stopTeam'] }))
  fireEvent.click(within(view.getByRole('dialog', { name: en['workspace.stopTeam'] }))
    .getByRole('button', { name: en['workspace.stopTeam'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Stop request was refused') })
  expect(onCancel).toHaveBeenCalledOnce()
})
