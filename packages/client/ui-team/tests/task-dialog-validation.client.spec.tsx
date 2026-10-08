// @vitest-environment jsdom
/** Task creation validates user input before retaining an authenticated command. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamManagementCommand } from '@clocky/clocky-client-runtime/client'
import { TeamTaskDialog } from '../src/client/TeamTaskDialog.tsx'
import { en } from '../src/client/locales.ts'
import { workspaceState } from './workspace-fixtures.client.ts'

afterEach(cleanup)

it('focuses invalid creation fields and submits only normalized bounded input', async () => {
  const team = workspaceState().team
  const manage = vi.fn<(command: TeamManagementCommand) => Promise<void>>(async () => {})
  const close = vi.fn()
  const view = render(<TeamTaskDialog target={{ kind: 'taskCreate' }}
    state={{ team, tasks: [], participants: [] }} translate={makeTranslate(en)} manage={manage} onClose={close}
    watchTaskCapabilities={() => () => {}} taskCapabilities={{
      input: { teamId: team.id, integration: false, readScopes: [], writeScopes: [] },
      loading: false, disconnected: false, value: { teamId: team.id, teamCursor: team.cursor,
        observationId: 'observation' as never, observedAt: 1, create: { allowed: true, reasons: [] }, maxAttempts: 3,
        workspaceModes: [{ mode: 'shared', allowed: true, reasons: [] }],
        readScopes: { editable: true, accepted: true }, writeScopes: { editable: true, accepted: true } },
    }} />)
  const submit = view.getByRole('button', { name: en['taskForm.taskCreate'] })
  fireEvent.click(submit)
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.subjectRequired'])
  expect(document.activeElement).toBe(view.getByLabelText(en['taskForm.subject']))
  fireEvent.change(view.getByLabelText(en['taskForm.subject']), { target: { value: '  Migration  ' } })
  fireEvent.click(submit)
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.descriptionRequired'])
  expect(document.activeElement).toBe(view.getByLabelText(en['taskForm.description']))
  fireEvent.change(view.getByLabelText(en['taskForm.description']), { target: { value: '  Verify rollout.  ' } })
  fireEvent.click(view.getByText(en['taskForm.advanced']))
  fireEvent.change(view.getByLabelText(en['taskForm.priority']), { target: { value: '1.5' } })
  fireEvent.click(submit)
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.integerRequired'])
  expect(document.activeElement).toBe(view.getByLabelText(en['taskForm.priority']))
  fireEvent.change(view.getByLabelText(en['taskForm.priority']), { target: { value: '1' } })
  fireEvent.change(view.getByLabelText(en['taskForm.maxAttempts']), { target: { value: '0' } })
  fireEvent.click(submit)
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.positiveRequired'])
  fireEvent.change(view.getByLabelText(en['taskForm.maxAttempts']), { target: { value: '4' } })
  fireEvent.click(submit)
  expect(view.getByRole('alert').textContent).toBe(makeTranslate(en)('taskForm.attemptLimit', { max: 3 }))
  fireEvent.change(view.getByLabelText(en['taskForm.maxAttempts']), { target: { value: '2' } })
  fireEvent.change(view.getByLabelText(en['taskForm.maxTokens']), { target: { value: '-1' } })
  fireEvent.click(submit)
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.budgetRequired'])
  fireEvent.change(view.getByLabelText(en['taskForm.maxTokens']), { target: { value: '500' } })
  fireEvent.change(view.getByLabelText(en['taskForm.maxTurns']), { target: { value: '1.5' } })
  fireEvent.click(submit)
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.budgetRequired'])
  expect(manage).not.toHaveBeenCalled()
  fireEvent.change(view.getByLabelText(en['taskForm.maxTurns']), { target: { value: '2' } })
  fireEvent.click(submit)
  await waitFor(() => { expect(manage).toHaveBeenCalledOnce() })
  expect(manage.mock.calls[0]?.[0]).toMatchObject({ operation: 'taskCreate', input: {
    subject: 'Migration', description: 'Verify rollout.', priority: 1, maxAttempts: 2,
    budget: { maxTotalTokens: 500, maxTurns: 2 }, workspaceMode: 'shared',
  } })
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
})
