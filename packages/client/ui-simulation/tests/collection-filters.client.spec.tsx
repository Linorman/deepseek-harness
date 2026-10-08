// @vitest-environment jsdom
/** Committing view filters clears selection without granting execution authority. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CollectionFilters } from '../src/client/CollectionFilters.tsx'
import { en } from '../src/client/locales.ts'
import type { Route } from '../src/client/store.ts'

afterEach(cleanup)

it('commits and clears status/cognition independently while dropping old inspector identity', () => {
  const change = vi.fn()
  const view: Route = { module: 'entities', search: 'retained', runId: 'run', objectId: 'entity', section: 'knowledge' }
  const props = { view, change, t: (key: keyof typeof en) => en[key] }
  const ui = render(<CollectionFilters {...props} />)
  const status = screen.getByRole('button', { name: en.filterStatus })
  fireEvent.click(status); fireEvent.click(status)
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(status)
  fireEvent.click(screen.getByRole('menuitem', { name: en.active }))
  expect(change).toHaveBeenLastCalledWith({ ...view, status: 'active', objectId: undefined, section: undefined })
  ui.rerender(<CollectionFilters {...props} view={{ ...view, status: 'active', cognition: 'agent' }} />)
  fireEvent.click(status)
  fireEvent.click(screen.getByRole('menuitem', { name: en.all }))
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined, cognition: 'agent' }))
  const cognition = screen.getByRole('button', { name: en.filterCognition })
  fireEvent.click(cognition)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  fireEvent.click(cognition); fireEvent.click(cognition)
  fireEvent.click(cognition)
  fireEvent.click(screen.getByRole('menuitem', { name: en.none }))
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ cognition: 'none', objectId: undefined }))
  fireEvent.click(cognition)
  fireEvent.click(screen.getByRole('menuitem', { name: en.all }))
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ cognition: undefined }))
  fireEvent.click(status)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
})

it('shows exact linked entity and decision filters and clears them together', () => {
  const change = vi.fn()
  render(<CollectionFilters view={{ module: 'operations', search: '', entityId: 'entity', decisionId: 'decision' }}
    change={change} t={key => en[key]} />)
  expect(screen.getByText('entity')).toBeDefined()
  expect(screen.getByText('decision')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: en.clearFilters }))
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ entityId: undefined, decisionId: undefined }))
})
