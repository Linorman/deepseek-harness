// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CommandPalette, filterPalette, fuzzyScore, type PaletteSection } from '../src/CommandPalette.tsx'

afterEach(cleanup)
// jsdom has no layout, so it omits scrollIntoView; the palette calls it for the active row.
beforeAll(() => { Element.prototype.scrollIntoView = () => {} })

const SECTIONS: PaletteSection[] = [
  { id: 'teams', label: '团队任务', items: [
    { id: 'team-release', label: '发布准备', hint: '~/repo-a', keywords: ['release'] },
    { id: 'team-docs', label: '归档旧版文档', hint: '~/repo-b' },
  ] },
  { id: 'actions', label: '操作', items: [
    { id: 'new-team', label: '新建团队任务', shortcut: ['⌘', 'N'] },
    { id: 'settings', label: '打开设置' },
  ] },
]
const LABELS = { title: '命令面板', placeholder: '搜索团队、会话或命令', empty: '没有匹配结果' }

function open(onSelect = vi.fn(), onClose = vi.fn()) {
  render(<CommandPalette open sections={SECTIONS} labels={LABELS} onSelect={onSelect} onClose={onClose}
    renderPreview={item => <span>预览：{item.label}</span>} />)
  return { onSelect, onClose, input: screen.getByRole('combobox', { name: '命令面板' }) }
}

describe('fuzzy matching', () => {
  it('keeps stable owner order on equal matches and ranks a stronger match first', () => {
    const sections = [{ id: 'matches', label: 'Matches', items: [
      { id: 'weak', label: 'zabc' }, { id: 'first', label: 'abc' }, { id: 'second', label: 'abc' },
    ] }]
    expect(filterPalette(sections, 'abc')[0]?.items.map(item => item.id)).toEqual(['first', 'second', 'weak'])
  })
  it('matches subsequences and rejects missing characters', () => {
    expect(fuzzyScore('rl', 'release')).not.toBeNull()
    expect(fuzzyScore('xz', 'release')).toBeNull()
    expect(fuzzyScore('', 'anything')).toBe(1)
  })

  it('ranks contiguous and word-start matches first and drops empty sections', () => {
    const ranked = filterPalette(SECTIONS, 'release')
    expect(ranked.map(section => section.id)).toEqual(['teams'])
    expect(ranked[0]!.items.map(item => item.id)).toEqual(['team-release'])
    expect(filterPalette(SECTIONS, '设置')[0]!.items[0]!.id).toBe('settings')
  })
})

describe('CommandPalette', () => {
  it('renders a contribution icon without turning it into the option accessible name', () => {
    render(<CommandPalette open sections={[{ id: 'one', label: 'One', items: [
      { id: 'action', label: 'Action', icon: <svg data-testid="action-icon" /> },
    ] }]} labels={LABELS} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'Action' })).toBeDefined()
    expect(screen.getByTestId('action-icon').parentElement?.getAttribute('aria-hidden')).toBe('true')
  })

  it('does not restore an opener removed while the palette is open', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const view = render(<CommandPalette open sections={SECTIONS} labels={LABELS} onSelect={vi.fn()} onClose={vi.fn()} />)
    trigger.remove()
    view.unmount()
    expect(document.activeElement).toBe(document.body)
  })
  it('retains IME Process keys and does not choose an empty result window', () => {
    const { input, onSelect } = open()
    fireEvent.keyDown(input, { key: 'Process' })
    fireEvent.keyDown(input, { key: 'Tab' })
    fireEvent.change(input, { target: { value: 'unmatched' } })
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) fireEvent.keyDown(input, { key })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('chooses a pointer-hovered row and omits the optional preview', () => {
    const onSelect = vi.fn(), onClose = vi.fn()
    render(<CommandPalette open sections={SECTIONS} labels={LABELS} onSelect={onSelect} onClose={onClose} />)
    const first = screen.getByRole('option', { name: /发布准备/ })
    fireEvent.pointerMove(first)
    const second = screen.getByRole('option', { name: /归档旧版文档/ })
    fireEvent.pointerMove(second)
    expect(second.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(second)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'team-docs' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('returns focus on close and renders nothing during its closed lifetime', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const props = { sections: SECTIONS, labels: LABELS, onSelect: vi.fn(), onClose: vi.fn() }
    const view = render(<CommandPalette open {...props} />)
    view.rerender(<CommandPalette open={false} {...props} />)
    expect(document.activeElement).toBe(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
    trigger.remove()
  })
  it('focuses the combobox and marks the first option active', () => {
    const { input } = open()
    expect(document.activeElement).toBe(input)
    const first = screen.getByRole('option', { name: /发布准备/ })
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id)
    expect(screen.getByText('预览：发布准备')).toBeDefined()
  })

  it('moves with arrow keys across sections, wraps, and selects with Enter', () => {
    const { input, onSelect, onClose } = open()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /新建团队任务/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: /打开设置/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'settings' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('filters as the query changes and shows the empty state', () => {
    const { input } = open()
    fireEvent.change(input, { target: { value: '归档' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.change(input, { target: { value: 'zzzz' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe('没有匹配结果')
  })

  it('ignores navigation keys while an input method is composing', () => {
    const { input, onSelect } = open()
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true })
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: /发布准备/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('closes on Escape through the dialog cancel event', () => {
    const { onClose } = open()
    fireEvent(screen.getByRole('dialog', { name: '命令面板' }), new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
