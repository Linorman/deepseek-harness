// @vitest-environment jsdom
/** Registration retains authored fields when deployment choices are revoked or submissions fail. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamExecutionProfilesState } from '@clocky/clocky-client-runtime/client'
import { TeamManagementDialog } from '../src/client/TeamManagementDialog.tsx'
import { en } from '../src/client/locales.ts'
import { workspaceState } from './workspace-fixtures.client.ts'

afterEach(cleanup)
const team = workspaceState().team
const profile = { id: `profile-${'a'.repeat(64)}` as never, kind: 'local-agent' as const,
  role: 'custom-role', provider: 'runtime', model: 'test-model', available: true, reasons: [] }
function state(selected = false): TeamExecutionProfilesState {
  return { input: { teamId: team.id, kind: 'local-agent', ...selected ? { selectedId: profile.id } : {} },
    value: { teamId: team.id, kind: 'local-agent', revision: 1, allowed: true, items: [profile], ...selected ? { selected: profile } : {} },
    loading: false, disconnected: false }
}
function props() {
  return { target: { kind: 'memberInvite' as const }, state: { team, participants: [], tasks: [] }, channel: undefined,
    translate: makeTranslate(en), manage: vi.fn(async () => {}), onClose: vi.fn(),
    watchExecutionProfiles: vi.fn(() => () => {}), refreshExecutionProfiles: vi.fn(async () => {}), executionProfiles: state() }
}

it('fills a selected descriptor and retains every field after a rejected invitation', async () => {
  const p = props()
  p.manage.mockRejectedValue(new Error('Profile revoked'))
  const view = render(<TeamManagementDialog {...p} />)
  const name = view.getByLabelText(en['manage.name']) as HTMLInputElement
  fireEvent.change(name, { target: { value: 'My worker' } })
  fireEvent.click(view.getByRole('radio', { name: /custom-role/ }))
  expect(p.watchExecutionProfiles).toHaveBeenLastCalledWith({ teamId: team.id, kind: 'local-agent', selectedId: profile.id })
  view.rerender(<TeamManagementDialog {...p} executionProfiles={state(true)} />)
  expect((view.getByLabelText(en['manage.role']) as HTMLInputElement).readOnly).toBe(true)
  fireEvent.click(view.getByRole('button', { name: en['manage.memberInvite'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('Profile revoked') })
  expect(p.manage).toHaveBeenCalledWith({ operation: 'memberInvite', input: {
    executionProfileId: profile.id, displayName: 'My worker', role: profile.role, provider: profile.provider, model: profile.model,
    kind: 'local-agent', expectedCursor: team.cursor, capabilities: [],
  } }, expect.any(AbortSignal))
  expect(name.value).toBe('My worker')
  expect(p.onClose).not.toHaveBeenCalled()
  const revoked = state(true)
  view.rerender(<TeamManagementDialog {...p} executionProfiles={{ ...revoked, value: { ...revoked.value!, selected: { ...profile, available: false, reasons: ['provider-unavailable'] } } }} />)
  expect((view.getByRole('button', { name: en['manage.memberInvite'] }) as HTMLButtonElement).disabled).toBe(true)
  expect(name.value).toBe('My worker')
})

it('blocks denied catalogs, offers refresh and clears a selected profile when the kind changes', () => {
  const p = props()
  const view = render(<TeamManagementDialog {...p} />)
  fireEvent.click(view.getByRole('radio', { name: /custom-role/ }))
  fireEvent.click(view.getByRole('radio', { name: en['manage.kind.service'] }))
  expect(p.watchExecutionProfiles).toHaveBeenLastCalledWith({ teamId: team.id, kind: 'service' })
  view.rerender(<TeamManagementDialog {...p} executionProfiles={{ ...state(), input: { teamId: team.id, kind: 'service' },
    value: { teamId: team.id, kind: 'service', revision: 1, allowed: false, reason: 'not-authorized', items: [] } }} />)
  expect(view.getByText(en['manage.profileReason.not-authorized'])).toBeTruthy()
  expect((view.getByRole('button', { name: en['manage.memberInvite'] }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: en['manage.profilesRefresh'] }))
  expect(p.refreshExecutionProfiles).toHaveBeenCalledOnce()
})
