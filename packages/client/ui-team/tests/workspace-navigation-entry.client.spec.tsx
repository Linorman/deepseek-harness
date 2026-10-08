// @vitest-environment jsdom
/** The sidebar entry opens Team and expands only a collapsed sidebar. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { WorkspaceNavigation } from '../src/client/WorkspaceNavigation.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('marks the current Team workspace and opens it without changing a wide sidebar', () => {
  const open = vi.fn()
  const expandSidebar = vi.fn()
  const view = render(<WorkspaceNavigation wide workspace="team" useSessions={vi.fn() as never} useWorkspaces={vi.fn() as never} expandSidebar={expandSidebar}
    open={open} t={makeTranslate(en)} />)
  const entry = view.getByRole('button', { name: en['workspace.entry'] })
  expect(entry.getAttribute('aria-current')).toBe('page')
  expect(entry.textContent).toBe(en['workspace.entry'])
  fireEvent.click(entry)
  expect(open).toHaveBeenCalledOnce()
  expect(expandSidebar).not.toHaveBeenCalled()
})

it('opens Team and expands a collapsed sidebar from another workspace', () => {
  const open = vi.fn()
  const expandSidebar = vi.fn()
  const view = render(<WorkspaceNavigation wide={false} workspace="simulation" useSessions={vi.fn() as never} useWorkspaces={vi.fn() as never} expandSidebar={expandSidebar}
    open={open} t={makeTranslate(en)} />)
  const entry = view.getByRole('button', { name: en['workspace.entry'] })
  expect(entry.hasAttribute('aria-current')).toBe(false)
  expect(entry.textContent).toBe('')
  fireEvent.click(entry)
  expect(open).toHaveBeenCalledOnce()
  expect(expandSidebar).toHaveBeenCalledOnce()
})
