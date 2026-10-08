// @vitest-environment jsdom
/** Team deep links preserve an actionable failure and let the user reset the requested target. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@clocky/clocky-client-runtime/client'
import type { HostDescription } from '@clocky/clocky-client-connection/client'
import { LocaleRuntime } from '@clocky/clocky-client-locale/client'
import { SlotTestRuntime } from '@clocky/clocky-client-test-runtime'
import { WorkspaceNavigationError } from '../src/client/navigation-error.ts'
import { apply, inject } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { workspaceSelection, workspaceState } from './workspace-fixtures.client.ts'

afterEach(cleanup)

it('retries an unavailable Team deep link and resets to an unselected workspace', async () => {
  const runtime = await SlotTestRuntime.create()
  const originalUrl = window.location.href
  const hostDescription = createSnapshotStore<HostDescription | undefined>(undefined)
  runtime.provide('connection', { hostDescription })
  runtime.provide('layout', { showWorkspace: vi.fn(), toggleSidebar: vi.fn(), registerCommands: vi.fn(() => () => {}) })
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({ 'team.workspace': { kind: 'single', scope: 'root' } },
    ({ renderSlot }) => renderSlot('team.workspace', {}))
  const failure = new WorkspaceNavigationError('missing', 'Selected Team was removed')
  const inspect = vi.fn(async () => { throw failure })
  runtime.teamTasks.stub('inspect', inspect)
  window.history.replaceState(null, '', '?workspace=team&team=removed&view=tasks')
  try {
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()
    expect(view.getByRole('status').textContent).toBe(en['workspace.loadingTarget'])
    await act(async () => { hostDescription.set({ version: 'test', cwd: '/', attachedSessions: 0, home: '/',
      canOpenPath: false, authorizationScope: 'a'.repeat(64) as HostDescription['authorizationScope'] }) })
    const heading = await view.findByRole('heading', { name: en['workspace.targetUnavailable'] })
    expect(document.activeElement).toBe(heading)
    expect(view.getByRole('alert').textContent).toContain(en['workspace.navigation.missing'])
    fireEvent.click(view.getByRole('button', { name: en['workspace.retryNavigation'] }))
    await waitFor(() => { expect(inspect).toHaveBeenCalledTimes(2) })
    fireEvent.click(view.getByRole('button', { name: en['workspace.resetNavigation'] }))
    await waitFor(() => { expect(view.queryByRole('heading', { name: en['workspace.targetUnavailable'] })).toBeNull() })
    expect(new URL(window.location.href).searchParams.has('team')).toBe(false)
  } finally {
    await runtime.dispose()
    window.history.replaceState(null, '', originalUrl)
  }
})

it('navigates a selected Team through its real workspace modules and updates the shareable route', async () => {
  const runtime = await SlotTestRuntime.create()
  const originalUrl = window.location.href
  const hostDescription = createSnapshotStore<HostDescription | undefined>({ version: 'test', cwd: '/',
    attachedSessions: 0, home: '/', canOpenPath: false,
    authorizationScope: 'a'.repeat(64) as HostDescription['authorizationScope'] })
  runtime.provide('connection', { hostDescription })
  runtime.provide('layout', { showWorkspace: vi.fn(), toggleSidebar: vi.fn(), registerCommands: vi.fn(() => () => {}) })
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({ 'team.workspace': { kind: 'single', scope: 'root' } },
    ({ renderSlot }) => renderSlot('team.workspace', {}))
  const team = workspaceState()
  runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: team.team.id,
    selected: { teamId: team.team.id, state: workspaceSelection(team), coordinatorSessionId: undefined } })
  window.history.replaceState(null, '', '?workspace=team')
  try {
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()
    expect(view.getByRole('main', { name: en['detail.title'] })).toBeTruthy()
    expect(view.getByText(en['overview.noMembers'])).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: en['workspace.tasks'] }))
    await waitFor(() => { expect(new URL(window.location.href).searchParams.get('view')).toBe('tasks') })
    expect([en['taskView.search'], en['taskView.searchTeam']]).toContain(view.getByRole('textbox').getAttribute('aria-label'))
    fireEvent.click(view.getByRole('button', { name: en['workspace.overview'] }))
    await waitFor(() => { expect(new URL(window.location.href).searchParams.get('view')).toBe('overview') })
    expect(view.getByText(en['overview.noMembers'])).toBeTruthy()
  } finally {
    await runtime.dispose()
    window.history.replaceState(null, '', originalUrl)
  }
})
