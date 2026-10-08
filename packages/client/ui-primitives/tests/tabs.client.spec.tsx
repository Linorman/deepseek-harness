// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Tabs, splitTabs, type TabItem } from '../src/Tabs.tsx'

afterEach(cleanup)

const ITEMS: TabItem[] = [
  { id: 'overview', label: '概览' },
  { id: 'tasks', label: '任务', count: 4 },
  { id: 'channels', label: '频道' },
  { id: 'members', label: '成员', count: 0 },
  { id: 'audit', label: '审计', disabled: true },
  { id: 'artifacts', label: '产物', count: 2 },
]

function Harness({ items = ITEMS, maxVisible }: { items?: TabItem[]; maxVisible?: number }) {
  const [value, setValue] = useState('overview')
  return (
    <>
      <Tabs items={items} value={value} onChange={setValue} label="团队模块" maxVisible={maxVisible} idPrefix="team" />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('Tabs', () => {
  it('selects a clicked tab and treats vertical arrows as the same roving navigation', () => {
    render(<Harness />)
    const tasks = screen.getByRole('tab', { name: '任务 4' })
    fireEvent.click(tasks)
    expect(screen.getByTestId('value').textContent).toBe('tasks')
    fireEvent.keyDown(tasks, { key: 'ArrowDown' })
    expect(screen.getByTestId('value').textContent).toBe('channels')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(screen.getByTestId('value').textContent).toBe('tasks')
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(screen.getByTestId('value').textContent).toBe('tasks')
  })

  it('leaves overflow-trigger keyboard events alone and closes its menu without changing selection', () => {
    render(<Harness maxVisible={3} />)
    const more = screen.getByRole('button', { name: '更多' })
    fireEvent.keyDown(more, { key: 'ArrowDown' })
    expect(screen.getByTestId('value').textContent).toBe('overview')
    fireEvent.click(more)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('value').textContent).toBe('overview')
  })

  it('does not focus a disposed tablist when the selection owner unmounts it', () => {
    const view = render(<Tabs items={ITEMS} value="overview" label="Modules" onChange={() => { view.unmount() }} />)
    fireEvent.keyDown(screen.getByRole('tab', { name: '概览' }), { key: 'ArrowRight' })
    expect(screen.queryByRole('tablist')).toBeNull()
  })
  it('exposes a labeled tablist whose selected tab alone is in the tab order', () => {
    render(<Harness />)
    expect(screen.getByRole('tablist', { name: '团队模块' })).toBeDefined()
    const selected = screen.getByRole('tab', { name: '概览' })
    expect(selected.getAttribute('aria-selected')).toBe('true')
    expect(selected.tabIndex).toBe(0)
    expect(selected.getAttribute('aria-controls')).toBe('team-panel-overview')
    expect(screen.getByRole('tab', { name: '任务 4' }).tabIndex).toBe(-1)
  })

  it('renders counts as part of the accessible name and marks zero counts', () => {
    render(<Harness />)
    expect(screen.getByRole('tab', { name: '任务 4' })).toBeDefined()
    const zero = screen.getByRole('tab', { name: '成员 0' }).querySelector('[data-zero]')
    expect(zero?.textContent).toBe('0')
  })

  it('moves focus and selection with arrow keys, skipping disabled tabs and wrapping', () => {
    render(<Harness />)
    const overview = screen.getByRole('tab', { name: '概览' })
    overview.focus()
    fireEvent.keyDown(overview, { key: 'ArrowRight' })
    expect(screen.getByTestId('value').textContent).toBe('tasks')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '任务 4' }))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(screen.getByTestId('value').textContent).toBe('artifacts')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(screen.getByTestId('value').textContent).toBe('members')
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(screen.getByTestId('value').textContent).toBe('overview')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(screen.getByTestId('value').textContent).toBe('artifacts')
  })

  it('ignores keys while an input method is composing', () => {
    render(<Harness />)
    const overview = screen.getByRole('tab', { name: '概览' })
    overview.focus()
    fireEvent.keyDown(overview, { key: 'ArrowRight', isComposing: true })
    expect(screen.getByTestId('value').textContent).toBe('overview')
  })

  it('moves overflow tabs into a More menu and selects from it', () => {
    render(<Harness maxVisible={3} />)
    expect(screen.queryByRole('tab', { name: '产物 2' })).toBeNull()
    const more = screen.getByRole('button', { name: '更多' })
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(more)
    fireEvent.click(screen.getByText('产物 · 2'))
    expect(screen.getByTestId('value').textContent).toBe('artifacts')
    // The selected overflow tab takes the last visible slot.
    expect(screen.getByRole('tab', { name: '产物 2' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('splitTabs', () => {
  it('keeps the selected tab visible in the last slot', () => {
    const { visible, overflow } = splitTabs(ITEMS, 'artifacts', 2)
    expect(visible.map(item => item.id)).toEqual(['overview', 'artifacts'])
    expect(overflow.map(item => item.id)).toEqual(['tasks', 'channels', 'members', 'audit'])
  })

  it('does not overflow when everything fits', () => {
    expect(splitTabs(ITEMS, 'overview', 10).overflow).toEqual([])
    expect(splitTabs(ITEMS, 'overview', undefined).overflow).toEqual([])
  })
})
