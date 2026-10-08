// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { HeroLauncher } from '../src/client/skeleton/HeroLauncher.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function mount(overrides: Partial<Parameters<typeof HeroLauncher>[0]> = {}) {
  const props = {
    cwd: undefined, agentPreset: undefined, pickFolder: vi.fn(async () => {}), setDraftText: vi.fn(), focusComposer: vi.fn(),
    t: makeTranslate(zh) as never, ...overrides,
  }
  render(<HeroLauncher {...props} />)
  return props
}

describe('HeroLauncher', () => {
  it('offers a folder chip that opens the Host picker', () => {
    const props = mount()
    const group = screen.getByRole('group', { name: zh['launcher.label'] })
    fireEvent.click(within(group).getByRole('button', { name: zh['launcher.folder.choose'] }))
    expect(props.pickFolder).toHaveBeenCalledOnce()
  })

  it('shows the chosen folder by name and keeps the full path in the tooltip', () => {
    mount({ cwd: '/Users/dev/repo-a' })
    const chip = screen.getByRole('button', { name: 'repo-a' })
    expect(chip.getAttribute('title')).toContain('/Users/dev/repo-a')
  })

  it('disables the folder chip when no Host picker exists', () => {
    mount({ pickFolder: undefined })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['launcher.folder.choose'] }).disabled).toBe(true)
  })

  it('names the coordinator preset', () => {
    mount({ agentPreset: 'research' })
    expect(screen.getByText('research')).toBeDefined()
  })

  it('fills the composer with a starter and returns focus to it', () => {
    const props = mount()
    const list = screen.getByRole('list', { name: zh['launcher.starters'] })
    expect(within(list).getAllByRole('button')).toHaveLength(3)
    fireEvent.click(within(list).getByRole('button', { name: zh['launcher.starter.2'] }))
    expect(props.setDraftText).toHaveBeenCalledWith(zh['launcher.starter.2'])
    expect(props.focusComposer).toHaveBeenCalledOnce()
  })
})
