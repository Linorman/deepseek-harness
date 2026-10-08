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
  fireEvent.submit(view.getByRole('dialog').querySelector('form')!)
  expect(view.getByRole('alert').textContent).toBe(en['manage.profileUnavailable'])
  expect(p.manage).not.toHaveBeenCalled()
  view.rerender(<TeamManagementDialog {...p} executionProfiles={{ ...state(),
    input: { teamId: team.id, kind: 'service' }, loading: true, disconnected: true,
    error: 'Profiles offline', value: undefined }} />)
  expect(view.getByText(en['manage.profilesLoading'])).toBeTruthy()
  expect(view.getAllByRole('status').map(item => item.textContent)).toContain(en['manage.profileUnavailable'])
  expect(view.getAllByRole('alert').map(item => item.textContent)).toContain('Profiles offline')
  view.rerender(<TeamManagementDialog {...p} executionProfiles={{ ...state(),
    input: { teamId: team.id, kind: 'service' }, value: { teamId: team.id,
      kind: 'service', revision: 1, allowed: true, items: [] } }} />)
  expect(view.getByText(en['manage.profilesEmpty'])).toBeTruthy()
})

it('pages profile choices, returns to manual fields and submits an authored member invitation', async () => {
  const p = props()
  const first = state()
  const cursor = { teamId: team.id, kind: 'local-agent' as const, revision: 1, offset: 1 }
  const view = render(<TeamManagementDialog {...p} executionProfiles={{ ...first,
    value: { ...first.value!, nextCursor: cursor, items: [{ ...profile,
      preset: 'fast', available: false, reasons: ['provider-unavailable'] }] } }} />)
  expect(document.body.textContent).toContain(en['readiness.reason.provider-unavailable'])
  fireEvent.click(view.getByRole('button', { name: en['manage.profilesNext'] }))
  expect(p.watchExecutionProfiles).toHaveBeenLastCalledWith({ teamId: team.id,
    kind: 'local-agent', cursor })
  fireEvent.click(view.getByRole('button', { name: en['manage.profilesRefresh'] }))
  expect(p.watchExecutionProfiles).toHaveBeenLastCalledWith({ teamId: team.id, kind: 'local-agent' })
  view.rerender(<TeamManagementDialog {...p} executionProfiles={state(true)} />)
  fireEvent.click(view.getByRole('radio', { name: /custom-role/ }))
  expect((view.getByLabelText(en['manage.role']) as HTMLInputElement).readOnly).toBe(true)
  fireEvent.click(view.getByRole('radio', { name: en['manage.manualProfile'] }))
  fireEvent.change(view.getByLabelText(en['manage.name']), { target: { value: '  Manual worker  ' } })
  fireEvent.change(view.getByLabelText(en['manage.role']), { target: { value: 'reviewer' } })
  fireEvent.change(view.getByLabelText(en['manage.capabilities']), { target: { value: 'search, search, write' } })
  fireEvent.change(view.getByLabelText(en['manage.provider']), { target: { value: 'local' } })
  fireEvent.change(view.getByLabelText(en['manage.preset']), { target: { value: 'fast' } })
  fireEvent.change(view.getByLabelText(en['manage.model']), { target: { value: 'model-a' } })
  fireEvent.click(view.getByRole('button', { name: en['manage.memberInvite'] }))
  await waitFor(() => { expect(p.manage).toHaveBeenCalledWith({ operation: 'memberInvite', input: {
    expectedCursor: team.cursor, kind: 'local-agent', displayName: 'Manual worker', role: 'reviewer',
    capabilities: ['search', 'write'], provider: 'local', preset: 'fast', model: 'model-a',
  } }, expect.any(AbortSignal)) })
  expect(p.onClose).toHaveBeenCalledOnce()
})
